import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { totpOf } from "../../worker/test/app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const PORT = Number(process.env.P99_APP_PORT || 8853);
const APP_HOST = "app.localhost";
const APP = `http://${APP_HOST}:${PORT}`;
const SHOP = "shop.example.com";
const DOCS = "docs.example.com";
const GONE = "gone.example.com";
const TITLE = "The cart total stays at zero";
const ADA = { name: "Ada Lovelace", email: "ada@example.com" };
const GRACE = { name: "Grace Hopper", email: "grace@example.com" };
const MARY = { name: "Mary Jackson", email: "mary@example.com" };
const LIN = { name: "Lin Okafor", email: "lin@example.com" };
const WORDS = {
  needs: "Enter your e-mail and the 6-digit code.",
  denied: "That e-mail and code don't match. Check the e-mail, wait for the next code and try again.",
  limited: "Too many tries. Wait a few minutes, then try again.",
  failed: "Something went wrong; try again.",
  offline: "You're offline; try again when you're back.",
  none: "No spaces yet. Ask the person who invited you for a P99 link.",
  badName: "Use 3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit.",
  taken: "That username is taken; try another.",
};

let passed = 0;
function ok(name) {
  passed++;
  console.log(`ok - ${name}`);
}

async function worker() {
  const wrangler = join(repo, "worker", "node_modules", ".bin", "wrangler");
  if (!existsSync(wrangler)) throw new Error("app-check: run npm ci in worker/ first");
  const state = join(repo, "tmp", "app-worker");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  const env = { ...process.env, CI: "1" };
  const migrated = spawnSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { cwd: join(repo, "worker"), stdio: ["ignore", "ignore", "inherit"], env });
  if (migrated.status !== 0) throw new Error("app-check: the migrations did not apply");
  const vars = [`KEY_P99:${secret}`, "CODE_PEPPER:app-check", `APP_HOST:${APP_HOST}`, "LICENSE_STATE:studio"];
  const dev = spawn(wrangler, ["dev", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state, "--var", ...vars, "--show-interactive-dev-session=false", "--log-level", "warn"], { cwd: join(repo, "worker"), stdio: ["ignore", "inherit", "inherit"], env });
  process.on("exit", () => dev.kill("SIGTERM"));
  const upstream = `http://127.0.0.1:${PORT}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${upstream}/_p99/health`)).status < 500) break;
    } catch {}
    if (i > 300) throw new Error("app-check: the Worker did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const signed = async (method, pq, body, actor = ADA) => {
    const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const who = Buffer.from(JSON.stringify({ name: actor.name, email: actor.email })).toString("base64url");
    const sha = createHash("sha256").update(raw).digest("hex");
    const ts = Math.floor(Date.now() / 1000);
    const path = "/_p99/v1" + pq;
    const sig = createHmac("sha256", secret).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
    const headers = { "X-P99-Key-Id": "p99", "X-P99-Actor": who, "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}` };
    if (body != null) headers["Content-Type"] = "application/json";
    const res = await fetch(upstream + path, { method, headers, body: body == null ? undefined : raw });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${pq}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  await signed("PUT", "/envs/production", { kind: "release", position: 1, notify: false });
  for (const host of [SHOP, DOCS, GONE]) await signed("PUT", `/hosts/${host}`, { env: "production", config: {} });
  const person = async (who, hosts, manager = false) => {
    const minted = await signed("POST", "/codes", { name: who.name, email: who.email, hosts, manager, totp: true });
    return { ...who, id: minted.code.id, key: minted.totp_key };
  };
  const people = {
    ada: await person(ADA, [SHOP, DOCS]),
    grace: await person(GRACE, [DOCS], true),
    mary: await person(MARY, [GONE]),
    lin: await person(LIN, [SHOP]),
  };
  await signed("DELETE", `/hosts/${GONE}`);
  await signed(
    "POST",
    `/issues?host=${SHOP}`,
    { client_uid: "00000000-0000-4000-8000-000000000001", kind: "bug", title: TITLE, body: "", page: { url: `https://${SHOP}/cart`, path: "/cart", title: "Cart" }, context: {}, marks: [] },
    ADA,
  );
  await signed(
    "POST",
    `/issues?host=${DOCS}`,
    { client_uid: "00000000-0000-4000-8000-000000000002", kind: "bug", title: "The search finds nothing", body: "", page: { url: `https://${DOCS}/search`, path: "/search", title: "Search" }, context: {}, marks: [] },
    LIN,
  );
  return { people, signed, close: () => dev.kill("SIGTERM") };
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function launch() {
  return chromium.launch({
    executablePath: process.env.P99_CHROMIUM || "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${APP}`, "--hide-scrollbars"],
  });
}

async function visit(browser, path = "/") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addInitScript(openShadow);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(APP + path);
  return { ctx, p, errors };
}

const screen = (p) => p.locator("#app").getAttribute("data-screen");

async function waitScreen(p, name) {
  await p.waitForFunction((n) => document.getElementById("app").dataset.screen === n && !document.querySelector("#app .app-wait"), name);
}

async function said(p) {
  const error = p.locator("#signin .app-error");
  await error.waitFor({ state: "visible" });
  await p.waitForFunction(() => !document.querySelector("#signin button[type=submit]").disabled);
  return error.textContent();
}

async function signIn(p, email, totp) {
  await p.fill("#signin input[name=email]", email);
  await p.fill("#signin input[name=totp]", totp);
  await p.click("#signin button[type=submit]");
}

function wrong(code) {
  return code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
}

async function spacesShown(p) {
  await waitScreen(p, "spaces");
  return p.locator(".app-space").evaluateAll((links) =>
    links.map((a) => ({
      host: a.querySelector(".app-host").textContent,
      href: a.getAttribute("href"),
      role: a.querySelector(".app-role")?.textContent ?? null,
      count: a.querySelector(".app-count").textContent,
      open: a.querySelector(".app-count").dataset.open,
    })),
  );
}

async function check(back) {
  const { ada, grace, mary, lin } = back.people;
  const browser = await launch();
  try {
    const { ctx, p, errors } = await visit(browser);
    assert.equal(await screen(p), "signin");
    assert.equal(await p.locator("#signin input[name=email]").evaluate((e) => e === document.activeElement), true);
    await p.click("#signin button[type=submit]");
    assert.equal(await said(p), WORDS.needs);
    assert.equal(await p.locator("#signin input[name=totp]").getAttribute("aria-invalid"), "true");
    ok("signing in with nothing filled in asks for the e-mail and the 6-digit code");

    await signIn(p, ada.email, wrong(totpOf(ada.key)));
    assert.equal(await said(p), WORDS.denied);
    assert.equal(await p.inputValue("#signin input[name=totp]"), "");
    assert.equal(await p.inputValue("#signin input[name=email]"), ada.email);
    assert.equal(await p.locator("#signin input[name=totp]").evaluate((e) => e === document.activeElement), true);
    assert.equal(await p.textContent("#signin button[type=submit]"), "Sign in");
    ok("a wrong code says the e-mail and code don't match, clears the code and keeps the e-mail");

    await signIn(p, ` ${ada.email.toUpperCase()} `, totpOf(ada.key).replace(/^(\d{3})/, "$1 "));
    assert.deepEqual(await spacesShown(p), [
      { host: DOCS, href: `#space=${DOCS}`, role: null, count: "0 open", open: "false" },
      { host: SHOP, href: `#space=${SHOP}`, role: null, count: "1 open", open: "true" },
    ]);
    assert.equal(await p.textContent(".app-list h1"), "Your spaces");
    const badge = p.locator(".app-bar .app-badge");
    assert.match(await badge.getAttribute("src"), /^\/_p99\/badges\/studio\.svg\?v=/);
    assert.equal(await badge.getAttribute("alt"), "Studio licence");
    ok("the right code opens the list of spaces, sorted, with only her own open items counted and the licence badge");

    await p.click(`a.app-space[href="#space=${SHOP}"]`);
    await p.locator("p99-root").getByText(TITLE).first().waitFor();
    assert.equal(await screen(p), "space");
    assert.equal(await p.locator("p99-root").count(), 1);
    ok("opening a space shows its items in the full-page panel");

    await p.evaluate(() => (location.hash = ""));
    await spacesShown(p);
    assert.equal(await p.locator("p99-root").count(), 0);
    ok("leaving a space closes its panel and goes back to the spaces");

    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    assert.equal(await p.textContent(".app-profile h1"), "Profile");
    assert.equal(await p.textContent(".app-who b"), ada.name);
    assert.equal(await p.textContent(".app-who span"), ada.email);
    await p.fill(".app-profile input[name=username]", "A!");
    await p.click(".app-profile button[type=submit]");
    assert.equal(await p.textContent(".app-profile .app-status"), WORDS.badName);
    assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    await p.fill(".app-profile input[name=username]", "Ada.Lovelace");
    await p.click(".app-profile button[type=submit]");
    await p.waitForFunction(() => document.querySelector(".app-profile .app-status").textContent === "Saved.");
    assert.equal(await p.inputValue(".app-profile input[name=username]"), "ada.lovelace");
    assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), null);
    ok("the profile refuses a bad username on the page and saves a good one in lower case");

    await p.route("**/_p99/app/spaces", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }));
    await p.goto(APP + "/");
    await waitScreen(p, "problem");
    assert.equal(await p.textContent(".app-problem .app-error"), WORDS.failed);
    await ctx.setOffline(true);
    await p.click(".app-problem button");
    await p.waitForFunction((w) => document.querySelector(".app-problem .app-error")?.textContent === w, WORDS.offline);
    await ctx.setOffline(false);
    await p.unroute("**/_p99/app/spaces");
    await p.click(".app-problem button");
    assert.equal((await spacesShown(p)).length, 2);
    ok("a list that fails to load says so, says when the browser is offline, and Try again loads it");

    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    await p.click(".app-profile .app-quiet");
    await waitScreen(p, "signin");
    assert.equal(await p.evaluate(() => location.hash), "");
    await p.goto(APP + "/");
    assert.equal(await screen(p), "signin");
    ok("signing out ends the session, and a reload still asks to sign in");

    await signIn(p, ada.email, totpOf(ada.key, 1));
    await spacesShown(p);
    await back.signed("POST", `/codes/${ada.id}/revoke`, null);
    await p.goto(APP + "/");
    await waitScreen(p, "signin");
    assert.equal(await p.locator("#signin .app-error").isHidden(), true);
    ok("a session whose code was revoked lands on the sign-in form");
    assert.deepEqual(errors, []);
    await ctx.close();

    const g = await visit(browser, "/#profile");
    assert.equal(await screen(g.p), "signin");
    await signIn(g.p, grace.email, totpOf(grace.key));
    await waitScreen(g.p, "profile");
    await g.p.fill(".app-profile input[name=username]", "ada.lovelace");
    await g.p.click(".app-profile button[type=submit]");
    await g.p.waitForFunction((w) => document.querySelector(".app-profile .app-status").textContent === w, WORDS.taken);
    assert.equal(await g.p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    ok("signing in from a profile link opens the profile, and a username someone holds is taken");

    const isMe = (url) => url.pathname === "/_p99/api/me";
    const patchAs = (status) => (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status, contentType: "application/json", body: '{"message":"no"}' }) : route.continue();
    await g.p.route(isMe, patchAs(500));
    await g.p.fill(".app-profile input[name=username]", "grace.hopper");
    await g.p.click(".app-profile button[type=submit]");
    await g.p.waitForFunction((w) => document.querySelector(".app-profile .app-status").textContent === w, WORDS.failed);
    assert.equal(await g.p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    assert.equal(await g.p.locator(".app-profile button[type=submit]").isDisabled(), false);
    assert.equal(await screen(g.p), "profile");
    ok("a profile save that fails on the server says something went wrong and stays on the profile");
    await g.p.unroute(isMe);
    await g.p.route(isMe, patchAs(401));
    await g.p.click(".app-profile button[type=submit]");
    await waitScreen(g.p, "signin");
    assert.equal(await g.p.locator("#signin .app-error").isHidden(), true);
    ok("a profile save answered as signed out lands on the sign-in form");
    await g.p.unroute(isMe);

    await g.p.goto(APP + "/");
    assert.deepEqual(await spacesShown(g.p), [{ host: DOCS, href: `#space=${DOCS}`, role: "Manager", count: "1 open", open: "true" }]);
    ok("a manager's space carries the Manager mark and counts every open item, not only her own");

    const isPanel = (url) => url.pathname === "/_p99/panel.js";
    await g.p.route(isPanel, (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
    await g.p.click(`a.app-space[href="#space=${DOCS}"]`);
    await waitScreen(g.p, "problem");
    assert.equal(await g.p.textContent(".app-problem .app-error"), WORDS.failed);
    assert.equal(await g.p.locator("p99-root").count(), 0);
    ok("a space whose panel fails to load says so and leaves no panel behind");
    await g.p.unroute(isPanel);
    await g.p.click(".app-problem button");
    await waitScreen(g.p, "space");
    await g.p.waitForFunction(() => document.querySelectorAll("p99-root").length === 1 && !document.querySelector(".app-wait"));
    ok("Try again after a failed panel load loads the panel and mounts it once");
    assert.deepEqual(g.errors, []);
    await g.ctx.close();

    const m = await visit(browser);
    await signIn(m.p, mary.email, totpOf(mary.key));
    await waitScreen(m.p, "spaces");
    assert.equal(await m.p.textContent(".app-empty"), WORDS.none);
    assert.equal(await m.p.locator(".app-space").count(), 0);
    ok("a person whose spaces are all gone is told to ask for a P99 link");
    await m.ctx.close();

    const l = await visit(browser);
    const right = totpOf(lin.key);
    await l.p.route("**/_p99/app/signin", (route) => route.fulfill({ status: 429, contentType: "application/json", body: '{"message":"too many tries"}' }));
    await signIn(l.p, lin.email, right);
    assert.equal(await said(l.p), WORDS.limited);
    assert.equal(await screen(l.p), "signin");
    assert.equal(await l.p.inputValue("#signin input[name=totp]"), "");
    assert.equal(await l.p.inputValue("#signin input[name=email]"), lin.email);
    ok("a sign-in the Worker holds back for too many tries says to wait and keeps the e-mail");
    await l.p.unroute("**/_p99/app/signin");
    await signIn(l.p, lin.email, right);
    assert.deepEqual((await spacesShown(l.p)).map((s) => s.host), [SHOP]);
    ok("once the Worker lets her try again, the same code signs in");
    assert.deepEqual(l.errors, []);
    await l.ctx.close();

    console.log(`${passed} checks passed against the Worker`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const back = await worker();
  try {
    await check(back);
  } finally {
    back.close();
  }
}

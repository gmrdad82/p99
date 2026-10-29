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
const SPACE_NAME = "Northwind";
const PROJECTS = { Shop: [SHOP], Docs: [DOCS], Old: [GONE] };
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
  none: "Nothing in this space is open to you yet. Ask the person who invited you for a P99 link.",
  pictureBad: "That file isn't a picture P99 can read; pick a PNG, JPEG or WebP.",
  pictureSaved: "Your picture is saved.",
  licenceSaved: "Saved. The badge shows the licence now.",
  licenceRemoved: "Removed. This space is on Free.",
  licenceKept: "Removed. This space still has Studio from its own setup.",
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
  const vars = [`KEY_P99:${secret}`, "CODE_PEPPER:app-check", `APP_HOST:${APP_HOST}`, "LICENSE_STATE:studio", "SPACE:northwind", `SPACE_NAME:${SPACE_NAME}`];
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
  for (const [project, hosts] of Object.entries(PROJECTS)) {
    await signed("POST", "/projects", { name: project });
    for (const host of hosts) await signed("PUT", `/hosts/${host}`, { env: "production", project, config: {} });
  }
  const person = async (who, hosts, manager = false) => {
    const minted = await signed("POST", "/codes", { name: who.name, email: who.email, hosts, role: manager ? "owner" : "user", totp: true });
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


async function header(p) {
  return p.evaluate(() => {
    const bar = document.querySelector(".app-bar");
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    const mark = bar.querySelector("a.app-mark");
    const badge = bar.querySelector(".app-badge");
    return {
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      position: getComputedStyle(bar).position,
      mark: mark ? mark.getAttribute("href") : null,
      lockup: !!bar.querySelector("img.app-lockup"),
      name: bar.querySelector(".app-space-name")?.textContent ?? null,
      badge: badge ? badge.getAttribute("src") : null,
      sites: document.querySelectorAll(".app-space, .app-spaces").length,
    };
  });
}

async function boardShown(p) {
  await waitScreen(p, "board");
  await p.waitForFunction(() => {
    const r = document.querySelector("p99-root.app-board")?.shadowRoot;
    return r && r.querySelector(".p99-board.is-page.is-open") && (r.querySelector(".p99-col[data-label]") || r.querySelector(".p99-board-state"));
  }, null, { timeout: 15000 });
}

async function itemsShown(p) {
  await waitScreen(p, "items");
  await p.waitForFunction(() => document.querySelector("p99-root.app-full")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 15000 });
}

async function picturePng(p, w, h) {
  const b64 = await p.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#0000ff";
    g.fillRect((w - h) / 2, 0, h, h);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h]);
  return Buffer.from(b64, "base64");
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
    await itemsShown(p);
    const top = await header(p);
    assert.equal(top.position, "fixed");
    assert.equal(top.mark, "#");
    assert.equal(top.lockup, true);
    assert.equal(top.name, SPACE_NAME);
    assert.match(top.badge, /^\/_p99\/badges\/studio\.svg\?v=/);
    assert.equal(top.sites, 0);
    assert.equal(await p.locator("p99-root").count(), 1);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("p99-root.app-full").shadowRoot.querySelector(".p99-head")).display), "none");
    ok("the right code opens the space: its name and licence badge in one fixed header, her items below it, and no list of sites");

    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    assert.deepEqual((await header(p)).rect, top.rect);
    assert.equal(await p.locator("p99-root").count(), 0);
    assert.equal(await p.getAttribute(".app-profile a.app-back", "href"), "#");
    assert.equal(await p.locator(".app-licence").count(), 0);
    ok("Profile keeps the same header in the same place, has a back link, and shows no licence field to a User");

    await p.keyboard.press("Escape");
    await itemsShown(p);
    assert.deepEqual((await header(p)).rect, top.rect);
    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    await p.click(".app-profile a.app-back");
    await itemsShown(p);
    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    await p.click(".app-bar a.app-mark");
    await itemsShown(p);
    ok("Esc, the back link and the P99 mark each leave Profile for the space");

    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    assert.equal(await p.textContent(".app-profile h1"), "Profile");
    assert.equal(await p.textContent(".app-who b"), ada.name);
    assert.equal(await p.textContent(".app-who span"), ada.email);
    await p.fill(".app-profile input[name=username]", "A!");
    await p.click(".app-profile button[type=submit]");
    assert.equal(await p.textContent(".app-profile > .app-status"), WORDS.badName);
    assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    await p.fill(".app-profile input[name=username]", "Ada.Lovelace");
    await p.click(".app-profile button[type=submit]");
    await p.waitForFunction(() => document.querySelector(".app-profile > .app-status").textContent === "Saved.");
    assert.equal(await p.inputValue(".app-profile input[name=username]"), "ada.lovelace");
    assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), null);
    ok("the profile refuses a bad username on the page and saves a good one in lower case");

    let upload = null;
    const faces = [];
    const isAvatar = (url) => url.pathname === "/_p99/api/me/avatar";
    await p.route(isAvatar, (route) => {
      const r = route.request();
      if (r.method() === "PUT") {
        upload = { type: r.headers()["content-type"], body: r.postDataBuffer() };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ avatar: "/_p99/api/avatars/ada.lovelace?v=2" }) });
      }
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await p.route((url) => url.pathname === "/_p99/api/avatars/ada.lovelace", (route) => faces.push(new URL(route.request().url()).searchParams.get("v")) && route.fulfill({ status: 200, contentType: upload ? upload.type : "image/png", body: upload ? upload.body : Buffer.alloc(0) }));
    await p.setInputFiles(".app-picture input[type=file]", { name: "wide.png", mimeType: "image/png", buffer: await picturePng(p, 400, 200) });
    await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureSaved);
    assert.ok(upload && /^image\/(webp|jpeg|png)$/.test(upload.type), `the picture goes up as an image (${upload && upload.type})`);
    assert.ok(upload.body.length <= 256 * 1024, `and under 256 KB (${upload.body.length})`);
    const sent = await p.evaluate(async ([type, b64]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:${type};base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const corner = Array.from(g.getImageData(2, 2, 1, 1).data.slice(0, 3));
      return { w: bmp.width, h: bmp.height, corner };
    }, [upload.type, upload.body.toString("base64")]);
    assert.deepEqual([sent.w, sent.h], [256, 256]);
    assert.ok(sent.corner[2] > 200 && sent.corner[0] < 60, `the square is cut from the middle, so its corner is the blue centre, not the red sides (${sent.corner})`);
    await p.waitForFunction(() => /^blob:/.test(document.querySelector(".app-bar .app-me img")?.src || "") && /^blob:/.test(document.querySelector(".app-face img")?.src || ""));
    assert.equal(faces.at(-1), "2", "the replaced picture is fetched at the new version the Worker sent, never from the old URL");
    ok("a wide picture is cropped square from its middle, sent at 256 × 256 under 256 KB, and shows in the header and on Profile at once");

    await p.click(".app-picture .app-unpick");
    await p.waitForFunction(() => /^data:image\/svg/.test(document.querySelector(".app-face img")?.src || "") && document.querySelector(".app-picture .app-unpick").hidden);
    ok("removing the picture brings the generated pattern back and hides Remove");

    await p.setInputFiles(".app-picture input[type=file]", { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not a picture") });
    await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureBad);
    ok("a file that isn't a picture is refused in the page and nothing is sent");
    await p.unroute(isAvatar);

    const scroll = await p.evaluate(() => ({ width: getComputedStyle(document.documentElement).scrollbarWidth, color: getComputedStyle(document.documentElement).scrollbarColor }));
    assert.equal(scroll.width, "thin");
    assert.notEqual(scroll.color, "auto");
    ok("the page's scrollbars are thin and themed, with no script scroller");

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
    await itemsShown(p);
    ok("a space that fails to load says so, says when the browser is offline, and Try again loads it");

    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
    await p.click(".app-profile .app-actions .app-quiet");
    await waitScreen(p, "signin");
    assert.equal(await p.evaluate(() => location.hash), "");
    await p.goto(APP + "/");
    assert.equal(await screen(p), "signin");
    ok("signing out ends the session, and a reload still asks to sign in");

    await signIn(p, ada.email, totpOf(ada.key, 1));
    await itemsShown(p);
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
    await g.p.waitForFunction((w) => document.querySelector(".app-profile > .app-status").textContent === w, WORDS.taken);
    assert.equal(await g.p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    ok("signing in from a profile link opens the profile, and a username someone holds is taken");

    const isMe = (url) => url.pathname === "/_p99/api/me";
    const patchAs = (status) => (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status, contentType: "application/json", body: '{"message":"no"}' }) : route.continue();
    await g.p.route(isMe, patchAs(500));
    await g.p.fill(".app-profile input[name=username]", "grace.hopper");
    await g.p.click(".app-profile button[type=submit]");
    await g.p.waitForFunction((w) => document.querySelector(".app-profile > .app-status").textContent === w, WORDS.failed);
    assert.equal(await g.p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
    assert.equal(await g.p.locator(".app-profile button[type=submit]").isDisabled(), false);
    assert.equal(await screen(g.p), "profile");
    ok("a profile save that fails on the server says something went wrong and stays on the profile");
    await g.p.unroute(isMe);

    const licences = [];
    const isLicence = (url) => url.pathname === "/_p99/api/licence";
    await g.p.route(isLicence, (route) => {
      const r = route.request();
      licences.push({ method: r.method(), body: r.postData() ? JSON.parse(r.postData()) : null });
      if (r.method() === "DELETE") {
        const first = licences.filter((l) => l.method === "DELETE").length === 1;
        const licence = first ? { state: "studio", link: "hideable" } : { state: "free", link: "shown" };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ licence, removed: true }) });
      }
      const key = JSON.parse(r.postData() || "{}").key;
      if (key !== "P99-AGENCY-EXAMPLE") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "that key isn't valid for this build" }) });
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ licence: { state: "agency", link: "hideable" } }) });
    });
    assert.equal(await g.p.locator(".app-licence textarea[name=licence]").count(), 1);
    await g.p.fill(".app-licence textarea[name=licence]", "nonsense");
    await g.p.click(".app-licence button[type=submit]");
    await g.p.waitForFunction(() => document.querySelector(".app-licence .app-status").textContent === "that key isn't valid for this build");
    assert.equal(await g.p.getAttribute(".app-licence textarea", "aria-invalid"), "true");
    assert.match((await header(g.p)).badge, /studio\.svg/);
    await g.p.fill(".app-licence textarea[name=licence]", "  P99-AGENCY-EXAMPLE \n");
    await g.p.click(".app-licence button[type=submit]");
    await g.p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, WORDS.licenceSaved);
    assert.match((await header(g.p)).badge, /\/_p99\/badges\/agency\.svg\?v=/);
    assert.equal(await g.p.inputValue(".app-licence textarea"), "");
    assert.deepEqual(licences.filter((l) => l.method === "PUT").map((l) => l.body.key), ["nonsense", "P99-AGENCY-EXAMPLE"]);
    assert.equal(await g.p.locator(".app-licence .app-quiet").isHidden(), false);
    await g.p.click(".app-licence .app-quiet");
    await g.p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, WORDS.licenceKept);
    assert.match((await header(g.p)).badge, /\/_p99\/badges\/studio\.svg\?v=/);
    assert.equal(await g.p.locator(".app-licence .app-quiet").isHidden(), true);
    await g.p.fill(".app-licence textarea[name=licence]", "P99-AGENCY-EXAMPLE");
    await g.p.click(".app-licence button[type=submit]");
    await g.p.waitForFunction(() => /agency\.svg/.test(document.querySelector(".app-bar .app-pill img")?.src || ""));
    assert.equal(await g.p.locator(".app-licence .app-quiet").isHidden(), false);
    await g.p.click(".app-licence .app-quiet");
    await g.p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, WORDS.licenceRemoved);
    assert.match((await header(g.p)).badge, /\/_p99\/badges\/free\.svg\?v=/);
    assert.equal(await g.p.locator(".app-licence .app-quiet").isHidden(), true);
    await g.p.unroute(isLicence);
    ok("an Owner pastes a licence key on Profile: a bad one is named, a good one changes the badge at once, and Remove puts Free back");

    const asked = [];
    g.p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/_p99/api/board") asked.push(u.searchParams); });
    await g.p.click(".app-bar a.app-mark");
    await boardShown(g.p);
    assert.deepEqual((await header(g.p)).sites, 0);
    const chips = await g.p.locator(".app-project").evaluateAll((list) => list.map((b) => [b.dataset.name, b.querySelector(".app-hosts")?.textContent ?? null, b.getAttribute("aria-pressed")]));
    assert.deepEqual(chips, [["", null, "true"], ["Docs", DOCS, "false"]]);
    const page = await g.p.evaluate(() => { const r = document.querySelector("p99-root.app-board").shadowRoot; return { x: !!r.querySelector(".p99-board .p99-x"), role: r.querySelector(".p99-board").getAttribute("role"), logo: !!r.querySelector(".p99-board-head .p99-logo") }; });
    assert.deepEqual(page, { x: false, role: "region", logo: false });
    ok("an Owner's space opens on the board with its projects and their sites as the narrowing, under the page's own header");

    const narrowed = g.p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/board");
    await g.p.click('.app-project[data-name="Docs"]');
    await narrowed;
    assert.equal(await g.p.getAttribute('.app-project[data-name="Docs"]', "aria-pressed"), "true");
    assert.equal(asked.at(-1)?.getAll("project").join(), "Docs");
    await g.p.keyboard.press("Escape");
    assert.equal(await g.p.evaluate(() => document.querySelector("p99-root.app-board").shadowRoot.querySelector(".p99-board").hidden), false);
    ok("picking a project narrows the board to it, and Esc leaves the page's board open");

    await g.p.waitForFunction(() => document.querySelector("p99-root.app-board").shadowRoot.querySelector(".p99-card"), null, { timeout: 15000 });
    await g.p.evaluate(() => document.querySelector("p99-root.app-board").shadowRoot.querySelector(".p99-card").click());
    await g.p.waitForFunction(() => document.querySelector("p99-root.app-sheet")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=item]"), null, { timeout: 15000 });
    const sheet = await g.p.evaluate(() => {
      const r = document.querySelector("p99-root.app-sheet").shadowRoot;
      const x = r.querySelector(".p99-panel .p99-x").getBoundingClientRect();
      return { title: r.querySelector("#p99-title").textContent, name: r.querySelector(".p99-logo-name")?.textContent ?? null, x: [Math.round(x.width), Math.round(x.height)], round: parseFloat(getComputedStyle(r.querySelector(".p99-panel .p99-x")).borderTopLeftRadius) >= 20 };
    });
    assert.deepEqual(sheet, { title: "The search finds nothing", name: SPACE_NAME, x: [40, 40], round: true });
    await g.p.keyboard.press("Escape");
    await g.p.waitForFunction(() => !document.querySelector("p99-root.app-sheet").shadowRoot.querySelector(".p99-panel.is-open"));
    assert.equal(await screen(g.p), "board");
    ok("a card opens in the side panel over the board, named by the space, with the round close button; Esc shuts it and the board stays");

    await g.p.goto(APP + `/#space=${DOCS}`);
    await boardShown(g.p);
    assert.equal(await g.p.evaluate(() => location.hash), "");
    assert.equal(await g.p.getAttribute('.app-project[data-name="Docs"]', "aria-pressed"), "true");
    ok("an old #space= link opens the board narrowed to that site's project");

    await g.p.route(isMe, patchAs(401));
    await g.p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(g.p, "profile");
    await g.p.click(".app-profile button[type=submit]");
    await waitScreen(g.p, "signin");
    assert.equal(await g.p.locator("#signin .app-error").isHidden(), true);
    ok("a profile save answered as signed out lands on the sign-in form");
    await g.p.unroute(isMe);
    assert.deepEqual(g.errors, []);
    await g.ctx.close();

    const a2 = await visit(browser);
    const isPanel = (url) => url.pathname === "/_p99/panel.js";
    await a2.p.route(isPanel, (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
    await signIn(a2.p, lin.email, totpOf(lin.key));
    await waitScreen(a2.p, "problem");
    assert.equal(await a2.p.textContent(".app-problem .app-error"), WORDS.failed);
    assert.equal(await a2.p.locator("p99-root").count(), 0);
    ok("a space whose panel fails to load says so and leaves no panel behind");
    await a2.p.unroute(isPanel);
    const reloaded = a2.p.waitForResponse((r) => isPanel(new URL(r.url())) && r.status() === 200);
    await a2.p.click(".app-problem button");
    await reloaded;
    await itemsShown(a2.p);
    await a2.p.waitForFunction(() => document.querySelectorAll("p99-root").length === 1 && !document.querySelector(".app-wait"));
    ok("Try again after a failed panel load loads the panel and mounts it once");
    await a2.ctx.close();

    const m = await visit(browser);
    await signIn(m.p, mary.email, totpOf(mary.key));
    await waitScreen(m.p, "board");
    assert.equal(await m.p.textContent(".app-empty"), WORDS.none);
    assert.equal(await m.p.locator("p99-root").count(), 0);
    ok("a person whose sites are all gone is told to ask for a P99 link");
    await m.ctx.close();

    const l = await visit(browser);
    const right = totpOf(lin.key, 1);
    await l.p.route("**/_p99/app/signin", (route) => route.fulfill({ status: 429, contentType: "application/json", body: '{"message":"too many tries"}' }));
    await signIn(l.p, lin.email, right);
    assert.equal(await said(l.p), WORDS.limited);
    assert.equal(await screen(l.p), "signin");
    assert.equal(await l.p.inputValue("#signin input[name=totp]"), "");
    assert.equal(await l.p.inputValue("#signin input[name=email]"), lin.email);
    ok("a sign-in the Worker holds back for too many tries says to wait and keeps the e-mail");
    await l.p.unroute("**/_p99/app/signin");
    await signIn(l.p, lin.email, right);
    await itemsShown(l.p);
    ok("once the Worker lets her try again, the same code signs her into the space");
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

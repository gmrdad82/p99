import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const work = resolve(repo, process.env.P99_WORK || "tmp/web-manage");
const stills = resolve(repo, process.env.P99_STILLS || "tmp/renders");
const PORT = Number(process.env.P99_PROXY_PORT || 8913);
const HOST = "shop.example.com";
const PAGE = `http://${HOST}/checkout`;
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
const UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const phone = (width) => ({ viewport: { width, height: 833 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const SIZES = [["411", phone(411)], ["1440", DESK]];

mkdirSync(stills, { recursive: true });
const serve = spawn(process.execPath, [join(here, "serve.mjs")], {
  env: { ...process.env, P99_WORK: work, P99_PROXY_PORT: String(PORT), P99_WORKER_PORT: String(PORT + 1) },
  stdio: ["ignore", "inherit", "inherit"],
});
let failed = 0;
const done = (code) => {
  serve.kill("SIGTERM");
  process.exit(code);
};

async function api(method, pq, body, actor = ADA) {
  const key = readFileSync(join(work, "key"), "utf8").trim();
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const who = Buffer.from(JSON.stringify(actor)).toString("base64url");
  const sha = createHash("sha256").update(raw).digest("hex");
  const ts = Math.floor(Date.now() / 1000);
  const path = "/_p99/v1" + pq;
  const sig = createHmac("sha256", key).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
  const headers = { "X-P99-Key-Id": "p99", "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}`, "X-P99-Actor": who };
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: body == null ? undefined : raw });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const must = async (...a) => {
  const r = await api(...a);
  if (r.status >= 300) throw new Error(`${a[0]} ${a[1]}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

function check(name, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

const file = (kind, title) =>
  must("POST", `/issues?host=${HOST}`, { client_uid: randomUUID(), kind, title, body: "", page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" }, context: {}, marks: [] }, GRACE);

const S = (sel) => `p99-root >> .p99-panel.is-open ${sel}`;

try {
  for (let i = 0; ; i++) {
    const r = await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false }).catch((e) => ({ status: 0, e }));
    if (r.status === 200 || r.status === 201) break;
    if (i > 120) throw new Error("the local Worker did not come up");
    await sleep(500);
  }
  await must("PUT", `/hosts/${HOST}`, { env: "production", config: {} });
  const code = (await must("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], manager: true })).secret;
  await must("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST], manager: false });
  await must("POST", "/codes", { name: "Linus Park", email: "linus@example.com", hosts: [HOST], manager: false });
  await file("bug", "The cart total doesn't update after removing a bag");
  await file("feature", "Let returning customers reorder from a receipt");
  const canada = await file("question", "Do you ship to Canada?");
  const cart = await file("bug", "The cart badge shows 0 after a refresh");
  const main = await file("improvement", "Make the checkout button easier to reach on a phone");
  const byKeys = await file("task", "Delete me by keyboard");
  const byHold = await file("task", "Delete me by a hold, with reduced motion");

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
  const open = async (opts, key, scheme = "light", motion = "no-preference") => {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, reducedMotion: motion });
    await ctx.addInitScript(openShadow);
    const p = await ctx.newPage();
    await p.goto(`${PAGE}#p99=${code}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .f"), null, { timeout: 15000 });
    await p.goto(`${PAGE}#p99=${key}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-delete"), null, { timeout: 15000 });
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const zone = (p) =>
    p.evaluate(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      const box = r.querySelector(".p99-delete");
      const sc = r.querySelector(".p99-scroll");
      const at = (e) => e.getBoundingClientRect();
      const kids = [box.querySelector("h3"), box.querySelector("p"), box.querySelector("label"), box.querySelector("input"), box.querySelector(".p99-danger")].map(at);
      const z = at(box);
      const inside = kids.every((k) => k.left >= z.left && k.right <= z.right + 0.5 && k.top >= z.top && k.bottom <= z.bottom + 0.5);
      const apart = kids.every((k, j) => j === 0 || k.top >= kids[j - 1].bottom - 0.5);
      const gap = kids[4].top - kids[3].bottom;
      const full = Math.abs(kids[4].width - kids[3].width) < 1;
      return { inside, apart, gap, full, wide: sc.scrollWidth <= sc.clientWidth, onScreen: z.left >= 0 && z.right <= innerWidth };
    });
  const button = (p) => p.evaluate(() => {
    const b = document.querySelector("p99-root").shadowRoot.querySelector(".p99-danger");
    return { disabled: b.disabled, name: b.textContent, holding: b.classList.contains("is-holding") };
  });
  const toZone = (p) => p.evaluate(() => { const sc = document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll"); sc.scrollTop = sc.scrollHeight; });
  const toManage = (p) => p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const sc = r.querySelector(".p99-scroll");
    sc.scrollTop += r.querySelector(".p99-manage").getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
  });

  for (const width of [360, 411]) {
    const { ctx, p } = await open(phone(width), main.key);
    await toZone(p);
    const z = await zone(p);
    check(`at ${width}px the danger zone holds its parts in order, nothing overlaps or clips (${JSON.stringify(z)})`, z.inside && z.apart && z.gap >= 12 && z.full && z.wide && z.onScreen);
    const b0 = await button(p);
    check(`at ${width}px the button is disabled until the key is typed`, b0.disabled);
    await p.locator(S(".p99-delete input")).pressSequentially(main.key.slice(0, -1) + "9");
    check(`  and stays disabled for a wrong key`, (await button(p)).disabled);
    await p.locator(S(".p99-delete input")).fill("");
    await p.locator(S(".p99-delete input")).pressSequentially(main.key.toLowerCase());
    check(`  and turns on for the key typed in lower case`, !(await button(p)).disabled);
    await ctx.close();
  }

  {
    const { ctx, p } = await open(DESK, main.key);
    await toZone(p);
    const z = await zone(p);
    check(`at 1440px the danger zone holds its parts in order (${JSON.stringify(z)})`, z.inside && z.apart && z.gap >= 12 && z.full && z.wide);
    await p.locator(S(".p99-delete input")).fill(main.key);
    const b = await button(p);
    check(`the button's accessible name says what it does: "${b.name}"`, b.name.includes(main.key) && !b.disabled);
    const pressed = await p.evaluate(() => {
      const btn = document.querySelector("p99-root").shadowRoot.querySelector(".p99-danger");
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.route("**/_p99/api/issues/*", (r) => (r.request().method() === "DELETE" ? r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"held back"}' }) : r.continue()));
    await p.mouse.move(pressed.x, pressed.y);
    await p.mouse.down();
    await p.waitForTimeout(500);
    await p.mouse.up();
    const early = await p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-delete .p99-status-line").textContent);
    check(`a release before 1.2 s cancels the hold and says so ("${early}")`, !(await button(p)).holding && /holding/i.test(early));
    check("  and the item is still there", (await api("GET", `/issues/${main.key}?host=${HOST}`)).status === 200);
    await ctx.close();
  }

  {
    const { ctx, p } = await open(DESK, byKeys.key);
    await p.locator(S(".p99-delete input")).fill(byKeys.key);
    await p.locator(S(".p99-danger")).focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1500);
    check("by keyboard, Enter on the button deletes once the key matches", (await api("GET", `/issues/${byKeys.key}?host=${HOST}`)).status === 404);
    await ctx.close();
  }

  {
    const { ctx, p } = await open(phone(411), byHold.key, "light", "reduce");
    await toZone(p);
    await p.locator(S(".p99-delete input")).fill(byHold.key);
    const r = await p.evaluate(() => {
      const b = document.querySelector("p99-root").shadowRoot.querySelector(".p99-danger").getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    const cdp = await ctx.newCDPSession(p);
    const touch = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: r.x, y: r.y }] });
    await touch("touchStart");
    await p.waitForTimeout(600);
    const mid = await p.evaluate(() => getComputedStyle(document.querySelector("p99-root").shadowRoot.querySelector(".p99-danger"), "::before").transform);
    await p.waitForTimeout(900);
    await touch("touchEnd");
    await p.waitForTimeout(1200);
    check(`with reduced motion the fill doesn't move (${mid}) and a 1.5 s touch hold still deletes`, /matrix\(0, 0, 0, 1|none/.test(mid) && (await api("GET", `/issues/${byHold.key}?host=${HOST}`)).status === 404);
    await ctx.close();
  }

  const listbox = (p, sel) =>
    p.evaluate((s) => {
      const r = document.querySelector("p99-root").shadowRoot;
      const input = r.querySelector(s + " [role=combobox]");
      const lb = r.getElementById(input.getAttribute("aria-controls"));
      const panel = r.querySelector(".p99-panel").getBoundingClientRect();
      const b = lb.getBoundingClientRect();
      return {
        open: input.getAttribute("aria-expanded") === "true" && !lb.hidden,
        items: Array.from(lb.querySelectorAll("[role=option]:not([aria-disabled])"), (li) => li.textContent),
        active: input.getAttribute("aria-activedescendant") ? r.getElementById(input.getAttribute("aria-activedescendant"))?.textContent : null,
        fits: b.left >= panel.left && b.right <= panel.right + 0.5 && b.right <= innerWidth,
        value: input.value,
      };
    }, sel);
  const hidden = (p, name) => p.evaluate((n) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-manage [name=${n}]`).value, name);
  const pickers = { assignee: ".p99-picker:nth-of-type(1)", duplicate: ".p99-picker:nth-of-type(2)" };
  const sel = (k) => `.p99-manage ${pickers[k]}`;

  for (const [label, opts] of [["360", phone(360)], ["1440", DESK]]) {
    const { ctx, p } = await open(opts, main.key);
    const touch = label !== "1440";
    const hit = (s) => (touch ? p.locator(S(s)).tap() : p.locator(S(s)).click());
    await toManage(p);

    await hit(`${sel("assignee")} [role=combobox]`);
    await p.waitForTimeout(400);
    let l = await listbox(p, sel("assignee"));
    check(`${label}: the assignee picker opens with Unassigned and the people (${l.items.join(" | ")})`, l.open && l.items[0] === "Unassigned" && l.items.some((t) => t.includes("@grace.hopper")) && !l.items.some((t) => t.includes("@example.com")) && l.fits);
    await p.keyboard.type("hop");
    await p.waitForTimeout(200);
    l = await listbox(p, sel("assignee"));
    check(`${label}:   typing filters it to Grace, first one active`, l.items.length === 1 && /grace/.test(l.active || ""));
    await p.keyboard.press("Enter");
    check(`${label}:   Enter picks her`, (await hidden(p, "assignee")) === "grace.hopper" && (await listbox(p, sel("assignee"))).value === "@grace.hopper" && !(await listbox(p, sel("assignee"))).open);
    await hit(`${sel("assignee")} [role=combobox]`);
    await p.waitForTimeout(300);
    await hit(`${sel("assignee")} [role=option]:has-text("@linus.park")`);
    check(`${label}:   a ${touch ? "tap" : "click"} picks Linus`, (await hidden(p, "assignee")) === "linus.park");

    await hit(`${sel("duplicate")} [role=combobox]`);
    await p.waitForTimeout(500);
    l = await listbox(p, sel("duplicate"));
    check(`${label}: the duplicate picker lists this site's items, newest first, never the item itself (${l.items.length})`, l.open && l.items.length >= 4 && !l.items.some((t) => t.startsWith(main.key)) && l.items[0].startsWith(cart.key) && l.fits);
    await p.keyboard.type("badge");
    await p
      .waitForFunction((s) => {
        const r = document.querySelector("p99-root").shadowRoot;
        const lb = r.getElementById(r.querySelector(s + " [role=combobox]").getAttribute("aria-controls"));
        return lb.querySelectorAll("[role=option]:not([aria-disabled])").length === 1;
      }, sel("duplicate"), { timeout: 5000 })
      .catch(() => {});
    l = await listbox(p, sel("duplicate"));
    check(`${label}:   typing words searches (${l.items.join(" | ")})`, l.items.length === 1 && l.items[0].startsWith(cart.key));
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("ArrowUp");
    await p.keyboard.press("Enter");
    check(`${label}:   the arrows and Enter pick it`, (await hidden(p, "duplicate_of")) === cart.key);
    await p.locator(S(`${sel("duplicate")} [role=combobox]`)).blur();
    await hit(`${sel("duplicate")} [role=combobox]`);
    await p.waitForTimeout(500);
    await hit(`${sel("duplicate")} [role=option]:has-text("Canada")`);
    check(`${label}:   a ${touch ? "tap" : "click"} picks another`, (await hidden(p, "duplicate_of")) === canada.key);

    const moves = await p.evaluate(() => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-manage .p99-move-to option"), (o) => o.value));
    const drop = await p.evaluate(() => { const o = document.querySelector("p99-root").shadowRoot.querySelector(".p99-manage .p99-move-to option:last-child"); return o && o.dataset.drop; });
    check(`${label}: Move to lists the labels on my boards and ends with Drop (${moves.join(" | ")})`, moves[0] === "Inbox" && moves.includes("Done") && drop === "Done");
    const gone = await p.evaluate(() => !document.querySelector("p99-root").shadowRoot.querySelector(".p99-tag-pick, .p99-manage [name=priority], .p99-manage [name=status]"));
    check(`${label}: no labels picker, Priority or Status select in Manage`, gone);
    const wide = await p.evaluate(() => { const s = document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll"); return s.scrollWidth <= s.clientWidth; });
    check(`${label}: nothing in Manage scrolls sideways`, wide);
    if (label === "1440") {
      await p.locator(S(".p99-manage > button[type=submit]")).click();
      await p.waitForTimeout(1500);
      const got = (await api("GET", `/issues/${main.key}?host=${HOST}`)).json.issue;
      check(`Save sends the picks (${got.assignee && got.assignee.username}, ${got.duplicate_of})`, got.assignee && got.assignee.username === "linus.park" && !!got.duplicate_of);
      await must("PATCH", `/issues/${main.key}?host=${HOST}`, { assignee: null, duplicate_of: null, resolution: null });
      const moved = await open(DESK, main.key);
      const pickMove = async (opt) => {
        await moved.p.waitForFunction(() => document.querySelectorAll("p99-root").length && document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open .p99-move-to option").length > 2);
        await toManage(moved.p);
        await moved.p.locator(S(".p99-move-to select")).selectOption(opt);
        await moved.p.locator(S(".p99-manage > button[type=submit]")).click();
        await moved.p.waitForTimeout(1500);
        return (await api("GET", `/issues/${main.key}?host=${HOST}`)).json.issue;
      };
      const doing = await pickMove({ label: "Doing" });
      check(`Save with Move to Doing moves the item (${doing.label}, ${doing.stage})`, doing.label === "Doing" && doing.stage === "in_progress");
      const dropped = await pickMove({ label: "Drop (close without fixing)" });
      check(`Drop closes it under Done without fixing (${dropped.label}, ${dropped.resolution}, ${dropped.stage})`, dropped.label === "Done" && dropped.resolution === "abandoned" && dropped.stage === "dropped");
      await must("PATCH", `/issues/${main.key}?host=${HOST}`, { resolution: null });
      await moved.ctx.close();
    }
    await ctx.close();
  }

  const still = async (p, name) => {
    await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur?.());
    await p.screenshot({ path: join(stills, name), animations: "disabled" });
    console.log(`still ${join(stills, name)}`);
  };
  for (const scheme of ["light", "dark"]) {
    for (const [size, opts] of SIZES) {
      const { ctx, p } = await open(opts, main.key, scheme);
      await toZone(p);
      await p.waitForTimeout(300);
      await still(p, `danger-${size}-${scheme}.png`);
      await p.locator(S(".p99-delete input")).fill(main.key);
      await p.route("**/_p99/api/issues/*", (r) => (r.request().method() === "DELETE" ? r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"held back"}' }) : r.continue()));
      const b = await p.evaluate(() => {
        const r = document.querySelector("p99-root").shadowRoot;
        r.activeElement?.blur?.();
        const x = r.querySelector(".p99-danger").getBoundingClientRect();
        return { x: x.x + x.width / 2, y: x.y + x.height / 2 };
      });
      await p.mouse.move(b.x, b.y);
      const t0 = Date.now();
      await p.mouse.down();
      await p.evaluate(() => {
        const btn = document.querySelector("p99-root").shadowRoot.querySelector(".p99-danger");
        for (const a of btn.getAnimations({ subtree: true })) { a.pause(); a.currentTime = 600; }
      });
      await p.screenshot({ path: join(stills, `danger-hold-${size}-${scheme}.png`) });
      const took = Date.now() - t0;
      await p.mouse.up();
      check(`still danger-hold-${size}-${scheme}.png caught the fill half way, ${took} ms into the hold`, took < 1150);
      for (const k of Object.keys(pickers)) {
        await toManage(p);
        await p.evaluate((q) => document.querySelector("p99-root").shadowRoot.querySelector(q).focus({ preventScroll: true }), `.p99-manage ${pickers[k]} [role=combobox]`);
        await p.waitForTimeout(600);
        if (k === "duplicate") { await p.keyboard.type("cart"); await p.waitForTimeout(700); }
        if (k === "labels") await p.keyboard.press("ArrowDown");
        await p.screenshot({ path: join(stills, `picker-${k}-${size}-${scheme}.png`), animations: "disabled" });
        console.log(`still ${join(stills, `picker-${k}-${size}-${scheme}.png`)}`);
        await p.keyboard.press("Escape");
        await p.locator(S(`${sel(k)} [role=combobox]`)).blur();
      }
      await ctx.close();
    }
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `manage-check: ${failed} failed` : "manage-check: all passed");
done(failed ? 1 : 0);

import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const work = join(repo, "tmp", "web");
const images = join(repo, "docs", "images");
const PORT = Number(process.env.P99_PROXY_PORT || 8799);
const HOST = "shop.example.com";
const ORIGIN = `http://${HOST}`;
const PAGE = `${ORIGIN}/checkout`;
const FPS = 30;
const VIEW = { width: 1280, height: 800 };
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };

const key = readFileSync(join(work, "key"), "utf8").trim();
mkdirSync(join(work, "tmp"), { recursive: true });
process.env.TMPDIR = join(work, "tmp");

async function api(method, pq, body, actor = ADA) {
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const who = actor ? Buffer.from(JSON.stringify(actor)).toString("base64url") : "";
  const sha = createHash("sha256").update(raw).digest("hex");
  const ts = Math.floor(Date.now() / 1000);
  const path = "/_p99/v1" + pq;
  const sig = createHmac("sha256", key).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
  const headers = { "X-P99-Key-Id": "p99", "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}` };
  if (actor) headers["X-P99-Actor"] = who;
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: body == null ? undefined : raw });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pq}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const page = (path, title) => ({ url: `https://${HOST}${path}`, path, title });
let uids = 0;
const uid = () => `00000000-0000-4000-8000-${String(++uids).padStart(12, "0")}`;

async function seed() {
  await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false });
  await api("PUT", `/hosts/${HOST}`, { env: "production", config: { theme: { accent: "#b5621e" } } });
  await api("PUT", "/hosts/docs.example.org", { env: "production", config: {} });
  const file = (host, actor, kind, title, body, at) =>
    api("POST", `/issues?host=${host}`, { client_uid: uid(), kind, title, body, page: { ...at, url: `https://${host}${at.path}` }, context: {}, marks: [] }, actor);
  await file("docs.example.org", ADA, "question", "Does the brew guide cover cold brew ratios?", "Readers ask for a ratio table next to the steeping times.", page("/guides/brewing", "Brewing guides"));
  const cart = await file(HOST, GRACE, "bug", "The cart total doesn't update after removing a bag", "I removed the second bag of House Espresso and the total stayed at $76.", page("/cart", "Your bag · Northwind Coffee"));
  await file(HOST, ADA, "feature", "Let returning customers reorder from a receipt", "", page("/account/orders", "Orders · Northwind Coffee"));
  await file("docs.example.org", GRACE, "improvement", "The grind size chart is hard to read on a phone", "", page("/guides/grind", "Grind sizes"));
  const say = (actor, body) => api("POST", `/issues/${cart.key}/comments?host=${HOST}`, { client_uid: uid(), body, internal: false }, actor);
  await say(ADA, "Thanks, Grace. I can see it when the last bag of a kind is removed: the total keeps the old line.");
  await say(GRACE, "Same on my phone, in Safari.");
  await api("PATCH", `/issues/${cart.key}?host=${HOST}`, { status: "doing" }, ADA);
  await say({ ...ADA, agent: true }, "Found it: the total was summed before the line was removed. The fix is on main with a test for the last bag, and goes out with the next release.");
  const minted = await api("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST], manager: false }, ADA);
  writeFileSync(join(work, "code"), minted.secret, { mode: 0o600 });
  const home = join(work, "home", ".config", "p99");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.toml"),
    `default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "0123456789abcdef0123456789abcdef"
token = "unused"
key_id = "p99"
key = "${key}"
url = "http://127.0.0.1:${PORT}/_p99"

[hosts."${HOST}"]
account = "main"
env = "production"

[hosts."docs.example.org"]
account = "main"
env = "production"
`,
    { mode: 0o600 },
  );
  return { thread: cart.key };
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function cursorScript() {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.setAttribute("data-p99-ignore", "");
    dot.setAttribute("aria-hidden", "true");
    Object.assign(dot.style, {
      position: "fixed", left: "0", top: "0", width: "22px", height: "22px", margin: "-11px 0 0 -11px", borderRadius: "50%",
      background: "rgba(20,20,28,.55)", border: "2px solid #fff", boxShadow: "0 1px 6px rgba(0,0,0,.45)", pointerEvents: "none",
      zIndex: "2147483647", transform: "translate(-100px,-100px)", transition: "none",
    });
    document.documentElement.append(dot);
    let x = -100, y = -100, down = false;
    const draw = () => { dot.style.transform = `translate(${x}px,${y}px) scale(${down ? 0.72 : 1})`; };
    addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
    addEventListener("pointerdown", () => { down = true; draw(); }, true);
    addEventListener("pointerup", () => { down = false; draw(); }, true);
  });
}

const machine = () => ({
  arch: execFileSync("uname", ["-m"]).toString().trim(),
  cpu: cpus()[0]?.model.trim(),
  chromium: execFileSync("/usr/bin/chromium", ["--version"]).toString().trim(),
});

async function launch() {
  return chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
}

async function open(browser, scheme = "light", withCursor = true, motion = "no-preference") {
  const code = readFileSync(join(work, "code"), "utf8").trim();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: motion });
  await ctx.addInitScript(openShadow);
  if (withCursor) await ctx.addInitScript(cursorScript);
  const p = await ctx.newPage();
  await p.goto(`${PAGE}#p99=${code}`);
  await p.waitForFunction(() => !location.hash && document.querySelector("p99-root"));
  return { ctx, p };
}

const inside = (p, sel) =>
  p.evaluate((s) => {
    const n = document.querySelector("p99-root")?.shadowRoot?.querySelector(s);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return b.width || b.height ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  }, sel);
const outside = (p, sel) =>
  p.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);

async function clip() {
  const frames = join(work, "frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const browser = await launch();
  const { p } = await open(browser, "light", true, "reduce");
  await p.goto(PAGE);
  await p.waitForFunction(() => {
    const r = document.querySelector("p99-root")?.shadowRoot;
    return r && !r.querySelector(".w button:not(.f)").hidden;
  });
  const cdp = await p.context().newCDPSession(p);
  let n = 0;
  let held = 0;
  let at = { x: 760, y: 520 };
  const advance = async (ms) => {
    const done = new Promise((r) => cdp.once("Emulation.virtualTimeBudgetExpired", r));
    await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: ms });
    await done;
  };
  let inflight = [];
  const frame = async () => {
    let shot = null;
    const pending = [cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }).then((r) => { shot = r; }), ...inflight];
    inflight = [];
    let done = false;
    const all = Promise.all(pending).then(() => { done = true; });
    await advance(1000 / FPS);
    for (;;) {
      await Promise.race([all, new Promise((r) => setTimeout(r, 40))]);
      if (done) break;
      await advance(4);
      held++;
    }
    writeFileSync(join(frames, String(n++).padStart(5, "0") + ".png"), Buffer.from(shot.data, "base64"));
  };
  const mouse = {
    move: (x, y) => inflight.push(p.mouse.move(x, y)),
    down: () => inflight.push(p.mouse.down()),
    up: () => inflight.push(p.mouse.up()),
  };
  const skip = async (ms) => {
    await Promise.all(inflight);
    inflight = [];
    await advance(ms);
  };
  const tick = async (ms) => {
    for (let i = Math.max(1, Math.round(ms / (1000 / FPS))); i > 0; i--) await frame();
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const glide = async (to, steps = 15) => {
    const from = at;
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      await tick(33);
    }
    at = to;
  };
  const center = (b) => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });
  const until = async (fn, ms = 6000) => {
    for (let t = 0; t < ms; t += 1000 / FPS) {
      if (await fn()) return;
      await frame();
    }
    throw new Error("timed out: " + fn);
  };
  const press = async () => {
    await mouse.down();
    await tick(66);
    await mouse.up();
    await tick(33);
  };
  const click = async (sel) => {
    let b;
    await until(async () => (b = await inside(p, sel)));
    await glide(center(b));
    await tick(150);
    await press();
  };
  const type = async (text, ms = 62) => {
    for (const ch of text) {
      inflight.push(p.keyboard.type(ch));
      await tick(ms);
    }
  };
  const scrollTo = async (sel, pad = 16, steps = 1) => {
    const from = await p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll").scrollTop);
    const to = await p.evaluate(
      ([s, pad]) => {
        const r = document.querySelector("p99-root").shadowRoot;
        const sc = r.querySelector(".p99-scroll");
        const n = r.querySelector(s);
        const bar = r.querySelector(".p99-actions");
        const floor = s !== ".p99-actions" && bar ? bar.getBoundingClientRect().top : sc.getBoundingClientRect().bottom;
        const top = n.getBoundingClientRect().bottom - floor + sc.scrollTop + pad;
        return Math.max(0, Math.min(top, sc.scrollHeight - sc.clientHeight));
      },
      [sel, pad],
    );
    for (let i = 1; i <= steps; i++) {
      await p.evaluate((y) => { document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll").scrollTop = y; }, Math.round(from + (to - from) * ease(i / steps)));
      await frame();
    }
  };

  await mouse.move(at.x, at.y);
  await tick(400);
  await click(".w button.f");
  await until(() => inside(p, ".p99-panel.is-open .p99-new input[name=title]"));
  await tick(250);
  await click(".p99-kinds input[value=bug]");
  await tick(200);
  await click(".p99-new input[name=title]");
  await type("Pay button stays grey");
  await tick(300);
  await click(".p99-new textarea[name=body]");
  await type("Card accepted, but Pay never turns on.", 40);
  await tick(200);
  await scrollTo(".p99-capture-actions");
  await tick(200);
  await click(".p99-mark-start");
  await skip(400);
  await until(() => inside(p, ".p99-mark-layer"));
  await tick(250);
  const form = await outside(p, "#payment");
  await glide({ x: Math.round(form.x - 10), y: Math.round(form.y - 10) });
  await tick(200);
  await mouse.down();
  await tick(66);
  at = { x: Math.round(form.x - 10), y: Math.round(form.y - 10) };
  await glide({ x: Math.round(form.x + form.w + 10), y: Math.round(form.y + form.h + 10) }, 16);
  await mouse.up();
  await tick(300);
  await click(".p99-mark-done");
  await skip(400);
  await until(() => inside(p, ".p99-regions:not([hidden]) .p99-region img"), 15000);
  await tick(200);
  await scrollTo(".p99-regions");
  await tick(1300);
  await click(".p99-actions button[type=submit]");
  await until(() => inside(p, ".p99-panel.is-open [data-view=item]"), 15000);
  await tick(1100);
  await click(".p99-back");
  await until(() => inside(p, ".p99-panel.is-open .p99-items"), 8000);
  await tick(1300);
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance" });
  await browser.close();
  console.log(`record: ${n} frames in ${frames}, ${held} nudges of 4 ms while a frame was pending`);
}

async function shot(p, name, clip) {
  await p.screenshot({ path: join(images, name), clip, animations: "disabled" });
  console.log(`record: docs/images/${name}`);
}

async function stills(thread) {
  const browser = await launch();
  for (const scheme of ["light", "dark"]) {
    const { ctx, p } = await open(browser, scheme, false);
    await p.goto(PAGE);
    await p.waitForFunction(() => {
      const r = document.querySelector("p99-root")?.shadowRoot;
      const n = r && r.querySelector(".w .n");
      return n && !n.hidden;
    });
    await p.evaluate(() => document.activeElement?.blur());
    await shot(p, `badge-${scheme}.png`, { x: 1280 - 420, y: 800 - 240, width: 420, height: 240 });
    await ctx.close();
  }
  for (const scheme of ["light", "dark"]) {
    const { ctx, p } = await open(browser, scheme, false);
    await p.goto(`${PAGE}#p99=${thread}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-ai"));
    await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur());
    await shot(p, `panel-${scheme}.png`);
    await ctx.close();
  }
  const { ctx, p } = await open(browser, "light", false);
  await p.goto(PAGE);
  await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button.f"));
  const press = async (sel) => {
    await p.evaluate((s) => document.querySelector("p99-root").shadowRoot.querySelector(s).scrollIntoView({ block: "center" }), sel);
    const b = await inside(p, sel);
    await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  };
  await press(".w button.f");
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new"));
  await p.waitForTimeout(400);
  await press(".p99-new input[name=title]");
  await p.keyboard.type("Pay button stays grey");
  await press(".p99-new textarea[name=body]");
  await p.keyboard.type("Card accepted, but Pay never turns on.");
  await press(".p99-mark-start");
  await p.waitForTimeout(400);
  const form = await outside(p, "#payment");
  await p.mouse.move(form.x - 10, form.y - 10);
  await p.mouse.down();
  await p.mouse.move(form.x + form.w + 10, form.y + form.h + 10, { steps: 8 });
  await p.mouse.up();
  await press(".p99-mark-done");
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-regions:not([hidden]) .p99-region img"), null, { timeout: 15000 });
  await p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const sc = r.querySelector(".p99-scroll");
    const n = r.querySelector(".p99-regions");
    sc.scrollTop += n.getBoundingClientRect().bottom - r.querySelector(".p99-actions").getBoundingClientRect().top + 16;
    r.activeElement?.blur();
  });
  await p.waitForTimeout(600);
  await shot(p, "capture.png");
  await ctx.close();
  await browser.close();
}

function totpNow(key) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of key.replace(/\s/g, "")) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const at = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function totp() {
  const browser = await launch();
  for (const scheme of ["light", "dark"]) {
    const minted = await api("POST", "/codes", { client_uid: randomUUID(), name: GRACE.name, email: GRACE.email, hosts: [HOST], manager: false, totp: true }, ADA);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: scheme });
    await ctx.addInitScript(openShadow);
    const p = await ctx.newPage();
    await p.goto(`${PAGE}#p99=${minted.secret}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button.f"));
    const b = await inside(p, ".w button.f");
    await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-verify"));
    await p.waitForTimeout(600);
    await shot(p, `verify-${scheme}.png`);
    await p.evaluate((code) => {
      const r = document.querySelector("p99-root").shadowRoot;
      r.querySelector(".p99-verify input").value = code;
      r.querySelector(".p99-verify").requestSubmit();
    }, totpNow(minted.totp_key));
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new"), null, { timeout: 15000 });
    const stored = await p.evaluate(() => localStorage.getItem("p99:code"));
    if (!/^\w{12}\.[0-9a-f]{32}$/.test(stored)) throw new Error("record: the browser kept no device after the code");
    await p.goto(PAGE);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button.f"));
    const again = await inside(p, ".w button.f");
    await p.mouse.click(again.x + again.w / 2, again.y + again.h / 2);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new"), null, { timeout: 15000 });
    console.log(`record: ${scheme}: the code was asked once, then the browser went straight to the form`);
    await ctx.close();
  }
  await browser.close();
}

function timingScript() {
  const t = (window.__p99t = {});
  const q = Document.prototype.querySelector;
  Document.prototype.querySelector = function (s) {
    if (t.start == null && /^meta\[name="?p99"?\]\[content="?off"?\]$/.test(s)) t.start = performance.now();
    return q.call(this, s);
  };
  const look = () => {
    const r = document.querySelector("p99-root")?.shadowRoot;
    if (t.painted == null && r?.querySelector(".w button.f")) t.painted = performance.now();
    if (t.click != null && t.panel == null && r?.querySelector(".p99-panel.is-open .p99-new")) t.panel = performance.now();
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
  addEventListener("pointerdown", () => { t.click = performance.now(); }, true);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function measure() {
  const code = readFileSync(join(work, "code"), "utf8").trim();
  const browser = await launch();
  const context = async () => {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    await ctx.addInitScript((c) => localStorage.setItem("p99:code", c), code);
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript(timingScript);
    return ctx;
  };
  const read = async (p) => {
    await p.waitForFunction(() => window.__p99t.painted != null);
    return p.evaluate(() => window.__p99t);
  };
  const cold = [], warm = [], panel = [], coldNav = [], warmNav = [];
  for (let i = 0; i < 10; i++) {
    const ctx = await context();
    const p = await ctx.newPage();
    await p.goto(PAGE);
    const a = await read(p);
    cold.push(a.painted - a.start);
    coldNav.push(a.painted);
    await p.goto(PAGE);
    const b = await read(p);
    warm.push(b.painted - b.start);
    warmNav.push(b.painted);
    await p.waitForTimeout(300);
    const box = await inside(p, ".w button.f");
    await p.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
    await p.waitForFunction(() => window.__p99t.panel != null);
    const c = await p.evaluate(() => window.__p99t);
    panel.push(c.panel - c.click);
    await ctx.close();
  }
  await browser.close();
  const r = (xs) => ({ median: +median(xs).toFixed(1), min: +Math.min(...xs).toFixed(1), max: +Math.max(...xs).toFixed(1) });
  const out = {
    machine: machine(),
    loader_cold_ms: r(cold),
    loader_warm_ms: r(warm),
    navigation_to_button_cold_ms: r(coldNav),
    navigation_to_button_warm_ms: r(warmNav),
    panel_cold_ms: r(panel),
  };
  writeFileSync(join(work, "measure.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

const step = process.argv[2] || "all";
const seeded = join(work, "seeded.json");
if (step === "seed" || step === "all") writeFileSync(seeded, JSON.stringify(await seed()));
if (!existsSync(seeded)) throw new Error("record: run the seed step first");
const { thread } = JSON.parse(readFileSync(seeded, "utf8"));
if (step === "clip" || step === "all") await clip();
if (step === "stills" || step === "all") await stills(thread);
if (step === "measure" || step === "all") await measure();
if (step === "totp" || step === "all") await totp();

import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const work = resolve(repo, process.env.P99_WORK || "tmp/pitomd");
const images = join(repo, "docs", "images");
const PORT = Number(process.env.P99_PROXY_PORT || 8899);
const SITE = process.env.P99_SITE || "127.0.0.1:4321";
const HOST = "dev.pitomd.com";
const LIVE = "pitomd.com";
const ORIGIN = `http://${HOST}`;
const PAGE = `${ORIGIN}/splicer/`;
const FPS = 30;
const VIEW = { width: 1280, height: 800 };
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
const CONFIG = { corner: "bottom-right", above: ".umb-top, .to-top" };

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

let uids = 0;
const uid = () => `00000000-0000-4000-8000-${String(++uids).padStart(12, "0")}`;

async function seed() {
  await api("PUT", "/envs/dev", { kind: "development", position: 1, notify: false });
  await api("PUT", "/envs/production", { kind: "release", position: 2, notify: false });
  await api("PUT", `/hosts/${HOST}`, { env: "dev", config: CONFIG });
  await api("PUT", `/hosts/${LIVE}`, { env: "production", config: CONFIG });
  const file = (host, actor, kind, title, body, path, ptitle) =>
    api("POST", `/issues?host=${host}`, { client_uid: uid(), kind, title, body, page: { url: `https://${host}${path}`, path, title: ptitle }, context: {}, marks: [] }, actor);
  await file(LIVE, ADA, "question", "Should the FAQ say where the speech model lives?", "", "/splicer/", "Splicer — Cut fast. Freaking fast.");
  const wrap = await file(HOST, GRACE, "bug", "The Buy button wraps under the price on a narrow window", "At 1100 px the label breaks onto a second line inside the price card.", "/splicer/", "Splicer — Cut fast. Freaking fast.");
  await file(HOST, ADA, "improvement", "Give the clip rail screenshot a caption", "", "/splicer/", "Splicer — Cut fast. Freaking fast.");
  const say = (actor, body) => api("POST", `/issues/${wrap.key}/comments?host=${HOST}`, { client_uid: uid(), body, internal: false }, actor);
  await say(ADA, "Thanks, Grace. I see it at 1100 px: the label breaks under the price.");
  await say(GRACE, "Same in Firefox, and on a tablet held upright.");
  await api("PATCH", `/issues/${wrap.key}?host=${HOST}`, { status: "in_progress" }, ADA);
  await say({ ...ADA, agent: true }, "Found it: the button had no minimum width, so the price card squeezed it. The fix is on main with a check at 1100 px.");
  const minted = await api("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST, LIVE], manager: false }, ADA);
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
env = "dev"

[hosts."${LIVE}"]
account = "main"
env = "production"
`,
    { mode: 0o600 },
  );
  return { thread: wrap.key };
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function quietDev() {
  addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "astro-dev-toolbar,vite-error-overlay{display:none!important}";
    document.head.append(s);
  });
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

function worker(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataBuffer();
  return new Promise((done) => {
    const headers = { ...req.headers(), host: HOST };
    if (body) headers["content-length"] = String(body.length);
    const up = request({ host: "127.0.0.1", port: PORT, method: req.method(), path: url.pathname + url.search, headers }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => done(route.fulfill({ status: r.statusCode, headers: Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, String(v)])), body: Buffer.concat(chunks) })));
    });
    up.on("error", () => done(route.fulfill({ status: 502, body: "the local Worker is not up" })));
    up.end(body || undefined);
  });
}

async function launch(clipping = false) {
  return chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [
      `--host-resolver-rules=MAP ${HOST} ${SITE}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`,
      "--hide-scrollbars",
      "--font-render-hinting=none",
      ...(clipping ? ["--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-threaded-animation", "--disable-threaded-scrolling"] : []),
    ],
  });
}

async function context(browser, { scheme = "light", cursor = true, motion = "no-preference", p99 = true, media = true } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: motion, serviceWorkers: "block" });
  await ctx.addInitScript(openShadow);
  await ctx.addInitScript(quietDev);
  if (cursor) await ctx.addInitScript(cursorScript);
  await ctx.route(/^https?:\/\/(?!dev\.pitomd\.com\/)/, (r) => r.abort());
  if (!media) await ctx.route(/\.(mp4|webm|m4v|mov)(\?|$)/, (r) => r.abort());
  if (p99) await ctx.route(`${ORIGIN}/_p99/**`, worker);
  else await ctx.route(`${ORIGIN}/_p99/**`, (r) => r.fulfill({ status: 404, body: "" }));
  return ctx;
}

async function open(browser, opts = {}) {
  const code = readFileSync(join(work, "code"), "utf8").trim();
  const ctx = await context(browser, opts);
  const p = await ctx.newPage();
  await p.goto(`${PAGE}#p99=${code}`);
  await p.waitForFunction(() => !location.hash && document.querySelector("p99-root"));
  await p.goto(PAGE);
  await p.waitForFunction(() => {
    const r = document.querySelector("p99-root")?.shadowRoot;
    return r && !r.querySelector(".w button:not(.f)").hidden;
  });
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
    const n = document.querySelector(s);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { x: b.x, y: b.y, w: b.width, h: b.height, visible: cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.01 && b.bottom > 0 && b.top < innerHeight };
  }, sel);

async function shot(p, name, clip) {
  await p.screenshot({ path: join(images, name), clip, animations: "disabled" });
  console.log(`pitomd: docs/images/${name}`);
}

const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const round = (b) => b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 10) / 10 : v]));

async function headerState(p) {
  return p.evaluate(() => {
    const n = document.querySelector("header");
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { cls: n.className, top: Math.round(b.top), bottom: Math.round(b.bottom), transform: getComputedStyle(n).transform };
  });
}

async function scrollSteps(p, to, steps = 12) {
  const from = await p.evaluate(() => scrollY);
  for (let i = 1; i <= steps; i++) {
    await p.mouse.wheel(0, (to - from) / steps);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(700);
}

async function place() {
  const browser = await launch();
  const report = {};
  const crop = { x: VIEW.width - 420, y: VIEW.height - 240, width: 420, height: 240 };
  for (const p99 of [false, true]) {
    const ctx = await context(browser, { cursor: false, p99 });
    const p = await ctx.newPage();
    if (p99) {
      const code = readFileSync(join(work, "code"), "utf8").trim();
      await p.goto(`${PAGE}#p99=${code}`);
      await p.waitForFunction(() => !location.hash && document.querySelector("p99-root"));
    }
    await p.goto(PAGE);
    if (p99) await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button.f"));
    await p.mouse.move(640, 400);
    await p.waitForTimeout(800);
    const r = (report[p99 ? "with" : "without"] = { steps: [] });
    const look = async (label) => {
      r.steps.push({
        label,
        scrollY: await p.evaluate(() => scrollY),
        header: await headerState(p),
        top: round(await outside(p, ".umb-top")),
        toTop: round(await outside(p, ".to-top")),
        button: p99 ? round(await inside(p, ".w button.f")) : null,
        wrap: p99 ? round(await inside(p, ".w")) : null,
      });
    };
    await look("top");
    if (p99) await shot(p, "pitomd-corner.png", crop);
    await scrollSteps(p, Math.round(VIEW.height * 0.75));
    await look("down 75%");
    await scrollSteps(p, Math.round(VIEW.height * 2));
    await look("down 200%");
    if (p99) await shot(p, "pitomd-corner-scrolled.png", crop);
    await scrollSteps(p, Math.round(VIEW.height * 1.6), 6);
    await look("up to 160%");
    await scrollSteps(p, 0, 12);
    await look("back to top");
    await ctx.close();
  }
  await browser.close();
  for (const s of report.with.steps) s.collides = overlap(s.button, s.top?.visible ? s.top : null) || overlap(s.button, s.toTop?.visible ? s.toTop : null);
  writeFileSync(join(work, "placement.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function recorder(p, frames) {
  const cdp = await p.context().newCDPSession(p);
  let n = 0;
  let held = 0;
  let inflight = [];
  const advance = async (ms) => {
    const done = new Promise((r) => cdp.once("Emulation.virtualTimeBudgetExpired", r));
    await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: ms });
    await done;
  };
  const frame = async () => {
    let shot = null;
    const pending = [cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }).then((r) => { shot = r; }), ...inflight];
    inflight = [];
    let done = false;
    const all = Promise.all(pending).then(() => { done = true; });
    await advance(1000 / FPS);
    for (let k = 0; ; k++) {
      await Promise.race([all, new Promise((r) => setTimeout(r, 40))]);
      if (done) break;
      if (k > 750) throw new Error(`pitomd: frame ${n} stays pending`);
      await advance(4);
      held++;
    }
    writeFileSync(join(frames, String(n++).padStart(5, "0") + ".png"), Buffer.from(shot.data, "base64"));
  };
  const r = {
    at: { x: 900, y: 420 },
    push: (x) => inflight.push(x),
    frame,
    count: () => n,
    held: () => held,
    async skip(ms) {
      await Promise.all(inflight);
      inflight = [];
      await advance(ms);
    },
    async tick(ms) {
      for (let i = Math.max(1, Math.round(ms / (1000 / FPS))); i > 0; i--) await frame();
    },
    async glide(to, steps = 15) {
      const from = r.at;
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        r.push(p.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k));
        await r.tick(33);
      }
      r.at = to;
    },
    async until(fn, ms = 6000) {
      for (let t = 0; t < ms; t += 1000 / FPS) {
        if (await fn()) return;
        await frame();
      }
      throw new Error("timed out: " + fn);
    },
    async press() {
      r.push(p.mouse.down());
      await r.tick(66);
      r.push(p.mouse.up());
      await r.tick(33);
    },
    async click(sel) {
      let b;
      await r.until(async () => (b = await inside(p, sel)));
      await r.glide(center(b));
      await r.tick(150);
      await r.press();
    },
    async type(text, ms = 62) {
      for (const ch of text) {
        r.push(p.keyboard.type(ch));
        await r.tick(ms);
      }
    },
    async panelTo(sel, steps = 2) {
      const at = () => p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll").scrollTop);
      const from = await at();
      const to = await p.evaluate((s) => {
        const root = document.querySelector("p99-root").shadowRoot;
        const sc = root.querySelector(".p99-scroll");
        const bar = root.querySelector(".p99-actions");
        const floor = bar ? bar.getBoundingClientRect().top : sc.getBoundingClientRect().bottom;
        const top = root.querySelector(s).getBoundingClientRect().bottom - floor + sc.scrollTop + 16;
        return Math.max(0, Math.min(top, sc.scrollHeight - sc.clientHeight));
      }, sel);
      for (let i = 1; i <= steps; i++) {
        await p.evaluate((y) => { document.querySelector("p99-root").shadowRoot.querySelector(".p99-scroll").scrollTop = y; }, Math.round(from + (to - from) * ease(i / steps)));
        await frame();
      }
    },
    stop: () => cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance" }),
  };
  return r;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const center = (b) => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });
const sectionTop = (p, sel) => p.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY), sel);

async function clip() {
  const frames = join(work, "frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const browser = await launch(true);
  const { p } = await open(browser, { media: false, motion: "reduce" });
  const dl = await sectionTop(p, "#download");
  await p.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), dl - 40);
  await p.waitForTimeout(900);
  const r = await recorder(p, frames);
  r.push(p.mouse.move(r.at.x, r.at.y));
  await r.tick(900);
  await r.click(".w button.f");
  await r.until(() => inside(p, ".p99-panel.is-open .p99-new input[name=title]"));
  await r.tick(250);
  await r.click(".p99-kinds input[value=feature]");
  await r.tick(200);
  await r.click(".p99-new input[name=title]");
  await r.type("The download button could say which platform it detected", 50);
  await r.tick(300);
  await r.panelTo(".p99-capture-actions");
  await r.tick(200);
  await r.click(".p99-mark-start");
  await r.skip(400);
  await r.until(() => inside(p, ".p99-mark-layer"));
  await r.tick(250);
  const b = await outside(p, "#download a.key-mustard");
  const a = { x: Math.round(b.x - 14), y: Math.round(b.y - 14) };
  const z = { x: Math.round(b.x + b.w + 14), y: Math.round(b.y + b.h + 14) };
  await r.glide(a);
  await r.tick(200);
  r.push(p.mouse.down());
  await r.tick(66);
  r.at = a;
  await r.glide(z, 16);
  r.push(p.mouse.up());
  await r.tick(300);
  await r.click(".p99-mark-done");
  await r.skip(400);
  await r.until(() => inside(p, ".p99-regions:not([hidden]) .p99-region img"), 15000);
  await r.tick(200);
  await r.panelTo(".p99-regions");
  await r.tick(800);
  await r.click(".p99-actions button[type=submit]");
  await r.until(() => inside(p, ".p99-panel.is-open [data-view=item]"), 15000);
  await r.tick(1800);
  await r.stop();
  await browser.close();
  console.log(`pitomd: ${r.count()} frames in ${frames}, ${r.held()} nudges of 4 ms while a frame was pending`);
}

async function stills(thread) {
  const browser = await launch();
  for (const [scheme, sel, pad] of [["light", "#demo", 120], ["dark", "#price", 40]]) {
    const ctx = await context(browser, { scheme, cursor: false });
    const p = await ctx.newPage();
    const code = readFileSync(join(work, "code"), "utf8").trim();
    await p.goto(`${PAGE}#p99=${code}`);
    await p.waitForFunction(() => !location.hash && document.querySelector("p99-root"));
    await p.goto(PAGE);
    const y = await sectionTop(p, sel);
    await p.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y + pad);
    await p.waitForTimeout(500);
    await p.evaluate((t) => { location.hash = "p99=" + t; }, thread);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-ai"), null, { timeout: 15000 });
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur());
    await shot(p, `pitomd-panel-${scheme}.png`);
    await ctx.close();
  }
  await browser.close();
}

function tui() {
  const bin = join(repo, "target", "release");
  if (!existsSync(join(bin, "p99"))) throw new Error("pitomd: cargo build --release first");
  const out = join(work, "renders");
  rmSync(out, { recursive: true, force: true });
  execFileSync("prec", ["clip", "p99", "arrives", "--app-dir", repo, "--bin", bin, "--size", "1280x800", "--fps", "30", "--no-archive", "--out", out, "--set", `launch=P99_CONFIG=${join(work, "home", ".config", "p99", "config.toml")} p99 tui`], { stdio: "inherit" });
}

function find(dir, test) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = find(full, test);
      if (hit) return hit;
    } else if (test(e.name)) return full;
  }
  return null;
}

function gif() {
  const web = join(work, "web.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(work, "frames", "%05d.png"), "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-pix_fmt", "yuv420p", "-r", String(FPS), web], { stdio: "inherit" });
  const term = find(join(work, "renders"), (n) => n.endsWith(".mp4"));
  if (!term) throw new Error("pitomd: run the tui step first");
  const joined = join(work, "pitomd.mp4");
  execFileSync("pcod", ["join", web, term, joined, "--crf", "1", "--force", "--no-progress"], { stdio: "inherit" });
  execFileSync("pcod", [joined, join(images, "pitomd.gif"), "--size", "1280", "--fps", "12", "--force", "--no-progress"], { stdio: "inherit" });
  console.log("pitomd: docs/images/pitomd.gif");
}

const step = process.argv[2] || "all";
const seeded = join(work, "seeded.json");
if (step === "seed" || step === "all") writeFileSync(seeded, JSON.stringify(await seed()));
if (!existsSync(seeded)) throw new Error("pitomd: run the seed step first");
const { thread } = JSON.parse(readFileSync(seeded, "utf8"));
if (step === "place" || step === "all") await place();
if (step === "stills" || step === "all") await stills(thread);
if (step === "clip" || step === "all") {
  await clip();
  tui();
  gif();
}
if (step === "frames") await clip();
if (step === "tui") tui();
if (step === "gif") gif();

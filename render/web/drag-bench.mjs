import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith("--")) flags.set(a.slice(2), "1");
  else { flags.set(a.slice(2), v); i++; }
}
const BASE = flags.get("base") || "main";
const ROUNDS = Number(flags.get("rounds") || 8);
const CARDS = Number(flags.get("cards") || 70);
const STEPS = Number(flags.get("steps") || 190);
const BURST = Number(flags.get("burst") || 1);
const CSS = flags.get("css") || "";
const [W, H] = (flags.get("view") || "1440x900").split("x").map(Number);
const PORT = Number(process.env.P99_BENCH_PORT || 8833);
const BUDGET = 1000 / 120;
const work = join(repo, "tmp", "bench", "drag");
const OUT = resolve(repo, flags.get("out") || join(work, "drag-bench.json"));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const COLUMNS = ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"];
const WORDS_OF = ["new", "planned", "in-progress", "needs-you", "stuck", "landed", "done"];
const WORDS = "cart total coupon refund invoice shipping banner header footer search filter checkout address postcode payment receipt avatar upload preview colour contrast mobile tablet layout spacing tooltip modal dropdown carousel".split(" ");
const PEOPLE = [null, { username: "ada.lovelace", avatar: null }, null, { username: "grace.hopper", avatar: null }];

function tree(ref) {
  const dir = join(work, ref.replace(/[^\w.-]/g, "_"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = spawnSync("git", ["archive", "--format=tar", ref, "worker/src/web"], { cwd: repo, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`drag-bench: git archive ${ref} failed: ${tar.stderr}`);
  const x = spawnSync("tar", ["-x", "-C", dir], { input: tar.stdout });
  if (x.status !== 0) throw new Error("drag-bench: tar failed");
  return join(dir, "worker", "src", "web");
}

function cardsFor(n) {
  const out = [];
  let id = 0;
  for (const label of COLUMNS) {
    for (let i = 0; i < n; i++) {
      id++;
      const len = 3 + ((id * 7) % 14);
      const title = Array.from({ length: len }, (_, k) => WORDS[(id * 3 + k * 5) % WORDS.length]).join(" ");
      out.push({ key: `BUG-${id}`, kind: "bug", title: title[0].toUpperCase() + title.slice(1), label, assignee: PEOPLE[id % PEOPLE.length], order: String((i + 1) / (n + 1)) });
    }
  }
  return out;
}

function side(name, web) {
  const host = `${name}.example.com`;
  const cards = cardsFor(CARDS);
  const board = { id: "1", name: "Bench", owner: null, mine: true, columns: COLUMNS.map((label) => ({ label, closes: label === "Done" })) };
  const api = (method, path, body) => {
    if (path.startsWith("/me")) return [200, { name: "Ada Lovelace", email: "ada@example.com", username: "ada.lovelace", avatar: null, manager: true, host, env: "production", version: "bench", counts: { mine_open: 0, mine_unread: 0, page_open: 0 }, theme: { accent: "#b5621e" }, strings: {} }];
    if (method === "GET" && path === "/boards") return [200, { boards: [board] }];
    if (method === "GET" && path === "/boards/1") return [200, { board, cards }];
    if (method === "GET" && path === "/board") return [200, { board: { lanes: COLUMNS.map((label, i) => ({ word: WORDS_OF[i], label, closes: label === "Done" })) }, cards }];
    if (method === "POST" && path === "/move") {
      const b = JSON.parse(body || "{}");
      const c = cards.find((x) => x.key === b.key);
      return c ? [200, { card: { ...c, label: b.to } }] : [404, { message: "no such item" }];
    }
    if (method === "POST" && path === "/stream-ticket") return [201, { ticket: "bench", expires_in: 60 }];
    if (method === "GET" && path.startsWith("/issues")) return [200, { issues: [], next_cursor: null }];
    return [404, { message: "no such route" }];
  };
  return { name, host, origin: `http://${host}`, web, api };
}

function serve(sides) {
  const by = new Map(sides.map((s) => [s.host, s]));
  const server = createServer((req, res) => {
    const s = by.get(String(req.headers.host || "").split(":")[0]);
    const url = new URL(req.url, "http://localhost");
    if (!s) { res.writeHead(404); return res.end(); }
    if (url.pathname.startsWith("/_p99/api/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const [status, data] = s.api(req.method, url.pathname.slice(9), body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      });
      return;
    }
    let full = null;
    if (url.pathname === "/" || url.pathname === "/checkout") full = join(here, "site", "checkout.html");
    else if (url.pathname.startsWith("/_p99/")) full = join(s.web, url.pathname.slice(6));
    if (!full || (!full.startsWith(here) && !full.startsWith(s.web)) || !existsSync(full)) { res.writeHead(404); return res.end(); }
    let text = readFileSync(full);
    if (/\.(js|css|html)$/.test(full)) {
      let t = text.toString("utf8").split("__P99_VERSION__").join("bench");
      if (url.pathname === "/_p99/p99.js") t = t.split("__P99_HOST__").join(JSON.stringify({ t: "#b5621e" }));
      text = t;
    }
    res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(text);
  });
  const sockets = new Set();
  server.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on("data", (b) => { if ((b[0] & 15) === 8) socket.end(); });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(() => { for (const s of sockets) s.destroy(); server.close(); })));
}

function instrument() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { return s.call(this, { ...init, mode: "open" }); };
  self.__frames = [];
  self.__bench = false;
  let t0 = 0;
  const probe = document.createElement("i");
  probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none";
  const ro = new ResizeObserver(() => {
    if (!t0) return;
    self.__frames.push(performance.now() - t0);
    t0 = 0;
  });
  addEventListener("DOMContentLoaded", () => document.documentElement.append(probe));
  addEventListener("pointermove", () => {
    if (!self.__bench || t0) return;
    t0 = performance.now();
    requestAnimationFrame(() => { ro.unobserve(probe); ro.observe(probe); });
  }, true);
}

async function open(browser, s) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await ctx.addInitScript(instrument);
  if (CSS && s.name === "branch") await ctx.addInitScript((css) => {
    const adopt = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "adoptedStyleSheets");
    Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", {
      get() { return adopt.get.call(this); },
      set(v) {
        const extra = new CSSStyleSheet();
        extra.replaceSync(css);
        adopt.set.call(this, v.filter((x) => !x.__bench).concat([Object.assign(extra, { __bench: true })]));
      },
    });
  }, CSS);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${s.origin}/checkout#p99=benchcode01`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button:not(.f)");
    return b && !b.hidden;
  });
  await p.locator("p99-root .w button:not(.f)").click();
  await p.locator("p99-root .p99-board-open").click();
  await p.waitForFunction((n) => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card").length >= n, CARDS * COLUMNS.length);
  await p.waitForTimeout(500);
  return { s, ctx, p, errors };
}

const settle = (p) => p.waitForFunction(() => {
  const r = document.querySelector("p99-root").shadowRoot;
  return !r.querySelector(".p99-ghost") && r.getAnimations().every((a) => a.playState !== "running" || a.effect.getTiming().iterations === Infinity);
});

function path(g) {
  const [a, b, c, d] = g.cols;
  const top = (k) => k.top + 70, bot = (k) => k.bottom - 70, mid = (k) => (k.top + k.bottom) / 2, x = (k) => (k.left + k.right) / 2;
  const legs = [
    [g.x, g.y], [x(a), bot(a)], [x(b), mid(b)], [x(b), top(b)], [x(c), bot(c)], [x(d), mid(d)],
    [x(d), d.bottom - 20], [x(d), d.bottom - 16], [x(c), mid(c)], [x(a), top(a)], [g.x, g.y],
  ];
  const len = [];
  for (let i = 1; i < legs.length; i++) len.push(Math.max(1, Math.hypot(legs[i][0] - legs[i - 1][0], legs[i][1] - legs[i - 1][1])));
  const total = len.reduce((s, v) => s + v, 0);
  const pts = [];
  for (let i = 1; i < legs.length; i++) {
    const n = Math.max(i === 7 ? 24 : 2, Math.round((STEPS * len[i - 1]) / total));
    for (let k = 1; k <= n; k++) pts.push([legs[i - 1][0] + ((legs[i][0] - legs[i - 1][0]) * k) / n, legs[i - 1][1] + ((legs[i][1] - legs[i - 1][1]) * k) / n]);
  }
  return pts;
}

async function drag(page, keep) {
  const { p } = page;
  await p.bringToFront();
  const g = await p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    for (const l of r.querySelectorAll(".p99-cards")) l.scrollTop = 0;
    r.querySelector(".p99-cols").scrollLeft = 0;
    const card = r.querySelectorAll(".p99-col")[0].querySelectorAll(".p99-card")[2].getBoundingClientRect();
    return { x: card.left + card.width / 2, y: card.top + 20, cols: Array.from(r.querySelectorAll(".p99-cards"), (l) => { const b = l.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }) };
  });
  await p.mouse.move(g.x, g.y);
  await p.mouse.down();
  await p.evaluate((on) => { self.__frames.length = 0; self.__bench = on; }, keep);
  const pts = path(g);
  for (let i = 0; i < pts.length; i++) {
    await p.mouse.move(pts[i][0], pts[i][1]);
    if ((i + 1) % BURST === 0) await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  const frames = await p.evaluate(() => { self.__bench = false; return self.__frames.splice(0); });
  await p.keyboard.press("Escape");
  await p.mouse.up();
  await settle(p);
  return frames;
}

function stats(v) {
  const s = [...v].sort((a, b) => a - b);
  const q = (x) => (s.length ? s[Math.min(s.length - 1, Math.ceil(x * s.length) - 1)] : 0);
  const r = (x) => Math.round(x * 100) / 100;
  return { frames: s.length, median: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), worst: r(s.at(-1) || 0), over: r((100 * s.filter((x) => x > BUDGET).length) / (s.length || 1)) };
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

async function main() {
  mkdirSync(work, { recursive: true });
  const xdg = join(repo, "tmp", "xd");
  rmSync(xdg, { recursive: true, force: true });
  mkdirSync(xdg, { recursive: true, mode: 0o700 });
  const sides = [side("base", tree(BASE)), side("branch", join(repo, "worker", "src", "web"))];
  const stop = await serve(sides);
  const env = { ...process.env, XDG_RUNTIME_DIR: xdg, TMPDIR: xdg };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const browser = await chromium.launch({
    executablePath: process.env.P99_CHROMIUM || "/usr/bin/chromium",
    env,
    args: [`--host-resolver-rules=${sides.map((s) => `MAP ${s.host} 127.0.0.1:${PORT}`).join(",")}`, `--unsafely-treat-insecure-origin-as-secure=${sides.map((s) => s.origin).join(",")}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
  const all = { base: [], branch: [] };
  const rounds = [];
  try {
    const pages = {};
    for (const s of sides) pages[s.name] = await open(browser, s);
    for (const s of sides) await drag(pages[s.name], false);
    for (let r = 0; r < ROUNDS; r++) {
      const order = r % 2 ? ["branch", "base"] : ["base", "branch"];
      const round = {};
      for (const name of order) {
        const f = await drag(pages[name], true);
        all[name].push(...f);
        round[name] = stats(f);
      }
      rounds.push(round);
      console.log(`round ${r + 1}/${ROUNDS}: base p99 ${round.base.p99} ms (${round.base.frames} frames), branch p99 ${round.branch.p99} ms (${round.branch.frames} frames)`);
    }
    for (const s of sides) if (pages[s.name].errors.length) throw new Error(`${s.name} page errors: ${pages[s.name].errors.join("; ")}`);
  } finally {
    await browser.close();
    stop();
  }
  const pooled = { base: stats(all.base), branch: stats(all.branch) };
  const med = (name, k) => Math.round(median(rounds.map((r) => r[name][k])) * 100) / 100;
  const per = Object.fromEntries(["base", "branch"].map((n) => [n, Object.fromEntries(["median", "p95", "p99", "worst", "over"].map((k) => [k, med(n, k)]))]));
  const load = (await import("node:os")).loadavg();
  const result = { base: BASE, rounds: ROUNDS, cards: CARDS, steps: STEPS, burst: BURST, css: CSS || null, view: `${W}x${H}`, budget_ms: Math.round(BUDGET * 100) / 100, load, pooled, median_of_rounds: per, per_round: rounds };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${CARDS} cards a column, ${ROUNDS} alternated rounds, load ${load.map((x) => x.toFixed(1)).join(" ")}`);
  console.log("side    frames  median  p95    p99    worst  over 8.33 ms");
  for (const n of ["base", "branch"]) {
    const p = pooled[n];
    console.log(`${n.padEnd(7)} ${String(p.frames).padEnd(7)} ${String(p.median).padEnd(7)} ${String(p.p95).padEnd(6)} ${String(p.p99).padEnd(6)} ${String(p.worst).padEnd(6)} ${p.over}%`);
  }
  console.log(`median of rounds: base p99 ${per.base.p99} ms, worst ${per.base.worst} ms; branch p99 ${per.branch.p99} ms, worst ${per.branch.worst} ms`);
  console.log(`raw: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

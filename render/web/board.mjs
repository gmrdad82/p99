import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const web = join(repo, "worker", "src", "web");
const out = resolve(repo, process.env.P99_RENDERS || "tmp/renders");
const PORT = Number(process.env.P99_BOARD_PORT || 8823);
const UPSTREAM = Number(process.env.P99_WORKER_PORT || 8813);
export const HOST = "shop.example.com";
export const ELSEWHERE = "elsewhere.example.com";
const ORIGIN = `http://${HOST}`;
const CODE = "boarddraft01";
export const USER_CODE = "boardvisit01";
const VIEW = { width: 1440, height: 900 };
const SIZES = [["360", { width: 360, height: 780 }], ["411", { width: 411, height: 860 }], ["1440", VIEW]];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
const STRICT = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const ADA = { name: "Ada Lovelace", email: "ada@example.com", username: "ada.lovelace" };
const GRACE = { name: "Grace Hopper", email: "grace@example.com", username: "grace.hopper" };
const LIN = { name: "Lin Okafor", email: "lin@example.com", username: "lin.okafor" };

export const LANES = [["new", "New"], ["planned", "Planned"], ["in-progress", "In progress"], ["needs-you", "Needs you"], ["stuck", "Stuck"], ["landed", "Landed"], ["done", "Done", true]]
  .map(([word, label, closes = false]) => ({ word, label, closes }));
const laneOf = (to) => LANES.find((l) => l.word === to) || LANES.filter((l) => l.label.toLowerCase() === String(to).toLowerCase())[0] || null;
const long = (label, tag) => Array.from({ length: 30 }, (_, i) => [`${tag}-${i + 1}`, "task", `${label} card ${i + 1}`, label, null]);
const items = [
  ["BUG-14", "bug", "The cart total doesn't update after removing a bag", "New", GRACE],
  ["FEAT-9", "feature", "Let returning customers reorder from a receipt", "New", null, "Splicer"],
  ["IMP-6", "improvement", "The grind size chart is hard to read on a phone", "New", null],
  ["BUG-11", "bug", "Gift card field accepts letters and then rejects the order", "In progress", ADA],
  ["TASK-3", "task", "Swap the hero photo for the autumn roast", "In progress", LIN, "Splicer", HOST, true],
  ["BUG-9", "bug", "Product images jump while the page loads", "Landed", ADA],
  ["Q-4", "question", "Can we ship to the Canary Islands?", "Landed", GRACE],
  ["BUG-12", "bug", "Apple Pay sheet closes on the second tap", "Stuck", ADA],
  ["BUG-31", "bug", "The other shop's receipt prints twice", "Stuck", null, "Manfred", ELSEWHERE],
  ["BUG-7", "bug", "Order confirmation mail shows the wrong delivery date", "Done", ADA],
  ["FEAT-5", "feature", "Show the roast date on every bag", "Done", LIN, "Manfred"],
  ...long("Planned", "LB"),
  ...long("Needs you", "LR"),
].map(([key, kind, title, label, assignee, project = null, host = HOST, agent = false]) => ({ key, kind, title, label, assignee, project, host, agent, reporter: GRACE }));
const orders = new Map();
{
  const n = new Map();
  for (const it of items) {
    const k = (n.get(it.label) || 0) + 1;
    n.set(it.label, k);
    orders.set(it.key, String(k / 10));
  }
}

const at = (label) => LANES.findIndex((l) => l.label === label);
const cardOf = (i) => {
  const lane = LANES[at(i.label)];
  const peers = items.filter((x) => x.label === i.label).sort((x, y) => (orders.get(x.key) < orders.get(y.key) ? -1 : 1));
  return {
    key: i.key, kind: i.kind, project: i.project, status: lane.word, label: i.label, lane: lane.closes ? null : peers.indexOf(i) + 1,
    title: i.title, host: i.host, assignee: i.assignee ? i.assignee.username : null, order: orders.get(i.key) || "0.5",
    changed_at: "2026-10-22T09:00:00.000Z", changed_by: { name: ADA.name, username: ADA.username, agent: i.agent, via: i.agent ? "pci" : null },
  };
};
export const PROJECTS = [{ name: "Splicer", hosts: [HOST] }, { name: "Manfred", hosts: [ELSEWHERE] }];
export const HOME = PROJECTS[0].name;
const projectOf = (i) => i.project || (PROJECTS.find((p) => p.hosts.includes(i.host)) || {}).name || null;
export function oneBoard(query = new URLSearchParams()) {
  const projects = query.getAll("project").map((p) => p.toLowerCase());
  const statuses = query.getAll("status");
  const host = query.get("host");
  const source = query.get("source");
  const cards = items
    .filter((i) => (!projects.length || (projectOf(i) && projects.includes(projectOf(i).toLowerCase())))
      && (!statuses.length || statuses.includes(LANES[at(i.label)].word))
      && (!host || i.host === host)
      && (!source || (source === "agent") === i.agent))
    .map(cardOf)
    .sort((x, y) => at(x.label) - at(y.label) || (x.order < y.order ? -1 : x.order > y.order ? 1 : 0));
  return { board: { lanes: LANES.map(({ word, label, closes }) => ({ word, label, closes })) }, cards };
}

const sockets = new Set();
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}
function publish(ev) {
  for (const s of sockets) s.write(frame(JSON.stringify({ host: HOST, ...ev })));
}

function between(lo, hi) { return String(((lo == null ? 0 : Number(lo)) + (hi == null ? 1 : Number(hi))) / 2); }
function move(body, word = false) {
  const it = items.find((i) => i.key === body.key);
  if (!it) return [404, { message: "no such item" }];
  if (it.label.toLowerCase() !== String(body.from).toLowerCase()) return [409, { error: "moved", message: "this card moved; refreshed" }];
  const lane = laneOf(body.to);
  if (!lane) return [400, { message: "to is not a lane" }];
  const from = it.label;
  it.label = lane.label;
  if (from !== lane.label) publish({ type: "label", key: it.key, from, to: word ? lane.word : lane.label, host: it.host });
  const peers = items.filter((i) => i !== it && i.label === lane.label).map((i) => ({ key: i.key, order: orders.get(i.key) || "0.5" })).sort((x, y) => (x.order < y.order ? -1 : 1));
  const spot = body.before ? peers.findIndex((x) => x.key === body.before) : body.after ? peers.findIndex((x) => x.key === body.after) + 1 : 0;
  const order = between(spot > 0 ? peers[spot - 1].order : null, spot < peers.length ? peers[spot].order : null);
  orders.set(it.key, order);
  publish({ type: "order", key: it.key, order, host: it.host });
  return [200, { card: cardOf(it) }];
}

const ME = { name: ADA.name, email: ADA.email, username: ADA.username, avatar: null, manager: true, role: "owner", host: HOST, env: "production", version: "draft", counts: { mine_open: 0, mine_unread: 0, page_open: 2, waiting: 3 }, theme: { accent: "#b5621e" }, strings: {} };
const USER = { ...ME, name: GRACE.name, email: GRACE.email, username: GRACE.username, manager: false, role: "user", counts: { mine_open: 1, mine_unread: 0, page_open: 0, waiting: null } };

function api(method, path, body, owner) {
  const url = new URL(path, "http://stub");
  if (url.pathname === "/me") return [200, owner ? ME : USER];
  if (method === "GET" && url.pathname === "/space") return [200, { space: { slug: "pito", name: "Northwind" }, projects: PROJECTS.map((p) => ({ ...p, open: items.filter((i) => projectOf(i) === p.name).length, closed: 0 })) }];
  if (method === "GET" && url.pathname === "/issues") return [200, { issues: [], next_cursor: null }];
  if (!owner) return [403, { message: "only an Owner can do this" }];
  if (method === "GET" && url.pathname === "/board") return [200, oneBoard(url.searchParams)];
  if (method === "GET" && url.pathname === "/labels") return [200, { labels: LANES.map((l, i) => ({ id: i + 1, name: l.label, closes: l.closes })) }];
  if (method === "GET" && url.pathname === "/projects") return [200, { projects: [{ name: "Manfred", open: 2, done: 0 }, { name: "Splicer", open: 2, done: 0 }] }];
  if (method === "GET" && url.pathname === "/cards/waiting") {
    const cards = oneBoard(new URLSearchParams("status=needs-you&status=stuck&status=landed")).cards;
    return [200, { count: cards.length, cards }];
  }
  if (method === "POST" && url.pathname === "/move") return move(JSON.parse(body || "{}"));
  if (method === "POST" && url.pathname === "/stream-ticket") return [201, { ticket: "draft-ticket", expires_in: 60 }];
  return [404, { message: "no such route" }];
}

function serveFile(res, path) {
  if (path === "/strict" || path === "/host.css") {
    const page = readFileSync(join(here, "site", "checkout.html"), "utf8");
    const css = /<style>([\s\S]*?)<\/style>/.exec(page)[1] + "\n* { scrollbar-width: thin; scrollbar-color: #8a8f98 transparent; }\n*::-webkit-scrollbar { width: 6px; height: 6px; }\n";
    if (path === "/host.css") {
      res.writeHead(200, { "content-type": TYPES[".css"], "cache-control": "no-cache" });
      return res.end(css);
    }
    res.writeHead(200, { "content-type": TYPES[".html"], "content-security-policy": STRICT, "cache-control": "no-cache" });
    return res.end(page.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/host.css">'));
  }
  if (path === "/light" || path === "/dark") {
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
    return res.end(forced(readFileSync(join(here, "site", "checkout.html"), "utf8"), path.slice(1)));
  }
  let full = null;
  if (path === "/" || path === "/checkout") full = join(here, "site", "checkout.html");
  else if (path.startsWith("/_p99/")) full = join(web, path.slice(6));
  if (!full || (!full.startsWith(here) && !full.startsWith(web)) || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  let text = readFileSync(full);
  if (/\.(js|css|html|svg)$/.test(full)) {
    text = text.toString("utf8").split("__P99_VERSION__").join("draft");
    if (path === "/_p99/p99.js") text = text.split("__P99_HOST__").join(JSON.stringify({ t: "#b5621e" }));
  }
  res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(text);
}

export function forced(page, scheme) {
  const dark = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/;
  const own = dark.exec(page)[1];
  return page.replace("color-scheme:light dark", `color-scheme:${scheme}`).replace(dark, scheme === "dark" ? `:root{${own}}` : "");
}

export function stub() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/_p99/api/")) return serveFile(res, url.pathname);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const code = req.headers["x-p99-code"];
      const [status, data] = code === CODE || code === USER_CODE ? api(req.method, url.pathname.slice(9) + url.search, body, code === CODE) : [401, { message: "unknown code" }];
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    });
  });
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/_p99/api/stream" || url.searchParams.get("t") !== "draft-ticket") return socket.destroy();
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on("data", (b) => { if ((b[0] & 15) === 8) socket.end(); });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({
    name: "stub",
    code: CODE,
    key: (id) => id,
    other: async (body, word = false) => move(body, word),
    drop: () => { for (const s of sockets) s.destroy(); },
    open: () => sockets.size,
    close: () => server.close(),
  })));
}

async function worker() {
  const wrangler = join(repo, "worker", "node_modules", ".bin", "wrangler");
  if (!existsSync(wrangler)) throw new Error("board: run npm ci in worker/ first");
  const state = join(repo, "tmp", "board-worker");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  const env = { ...process.env, CI: "1" };
  const migrated = spawnSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { cwd: join(repo, "worker"), stdio: ["ignore", "ignore", "inherit"], env });
  if (migrated.status !== 0) throw new Error("board: the migrations did not apply");
  const dev = spawn(wrangler, ["dev", "--ip", "127.0.0.1", "--port", String(UPSTREAM), "--persist-to", state, "--var", `KEY_P99:${secret}`, "--var", "CODE_PEPPER:board-check", "--show-interactive-dev-session=false", "--log-level", "warn"], { cwd: join(repo, "worker"), stdio: ["ignore", "inherit", "inherit"], env });
  process.on("exit", () => dev.kill("SIGTERM"));
  const upstream = `http://127.0.0.1:${UPSTREAM}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${upstream}/_p99/health`)).status < 500) break;
    } catch {}
    if (i > 300) throw new Error("board: the Worker did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const signed = async (method, pq, body, actor = ADA) => {
    const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const who = actor ? Buffer.from(JSON.stringify({ name: actor.name, email: actor.email })).toString("base64url") : "";
    const sha = createHash("sha256").update(raw).digest("hex");
    const ts = Math.floor(Date.now() / 1000);
    const path = "/_p99/v1" + pq;
    const sig = createHmac("sha256", secret).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
    const headers = { "X-P99-Key-Id": "p99", "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}` };
    if (actor) headers["X-P99-Actor"] = who;
    if (body != null) headers["Content-Type"] = "application/json";
    const res = await fetch(upstream + path, { method, headers, body: body == null ? undefined : raw });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`${method} ${pq}: ${res.status} ${text}`); e.status = res.status; throw e; }
    return text ? JSON.parse(text) : null;
  };
  const on = `?host=${HOST}`;
  await signed("PUT", "/envs/production", { kind: "release", position: 1, notify: false });
  for (const p of PROJECTS) await signed("POST", "/projects", { name: p.name });
  await signed("PUT", `/hosts/${HOST}`, { env: "production", project: HOME, config: { theme: { accent: "#b5621e" } } });
  await signed("PUT", `/hosts/${ELSEWHERE}`, { env: "production", project: PROJECTS[1].name, config: {} });
  const minted = await signed("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST, ELSEWHERE], role: "owner" });
  await signed("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST, ELSEWHERE], role: "owner" });
  await signed("POST", "/codes", { name: LIN.name, email: LIN.email, hosts: [HOST, ELSEWHERE], role: "owner" });
  const keys = new Map();
  let uid = 0;
  for (const it of items) {
    const on = `?host=${it.host}`;
    const made = await signed("POST", `/issues${on}`, { client_uid: `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`, kind: it.kind, title: it.title, body: "", page: { url: `https://${it.host}/checkout`, path: "/checkout", title: "Checkout" }, context: {}, marks: [] }, it.reporter);
    keys.set(it.key, made.key);
    if (it.assignee) await signed("PATCH", `/issues/${made.key}${on}`, { assignee: it.assignee.username });
    if (it.project) await signed("PATCH", `/issues/${made.key}${on}`, { project: it.project });
    const now = (await signed("GET", `/issues/${made.key}${on}`)).issue.label;
    const lane = LANES[at(it.label)];
    if (now.toLowerCase() !== lane.label.toLowerCase()) await signed("POST", `/move${on}`, { key: made.key, from: now, to: lane.word });
  }
  const piped = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/_p99/") || (!url.pathname.startsWith("/_p99/api/") && existsSync(join(web, url.pathname.slice(6))))) return serveFile(res, url.pathname);
    const up = request({ host: "127.0.0.1", port: UPSTREAM, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const up = connect(UPSTREAM, "127.0.0.1", () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const both = { socket, up };
    piped.add(both);
    const gone = () => { piped.delete(both); socket.destroy(); up.destroy(); };
    socket.on("close", gone);
    up.on("close", gone);
    socket.on("error", gone);
    up.on("error", gone);
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const sent = (body) => ({ ...body, key: keys.get(body.key), ...(body.before ? { before: keys.get(body.before) } : {}), ...(body.after ? { after: keys.get(body.after) } : {}) });
  return {
    name: "worker",
    code: minted.secret,
    key: (id) => keys.get(id),
    other: async (body, who = GRACE) => {
      try { return [200, await signed("POST", `/move${on}`, sent(body), who)]; } catch (e) { return [e.status || 500, { message: e.message }]; }
    },
    drop: () => { for (const p of piped) { p.socket.destroy(); p.up.destroy(); } },
    open: () => piped.size,
    close: () => { server.close(); dev.kill("SIGTERM"); },
  };
}

export function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

export function launch(bars = false) {
  return chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`, ...(bars ? [] : ["--hide-scrollbars"]), "--font-render-hinting=none"],
    ignoreDefaultArgs: bars ? ["--hide-scrollbars"] : [],
  });
}

export async function board(browser, back, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.view || VIEW, deviceScaleFactor: 1, colorScheme: opts.scheme || process.env.P99_SCHEME || "light", reducedMotion: opts.motion || "no-preference", hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await ctx.addInitScript(openShadow);
  if (opts.pick) await ctx.addInitScript((v) => localStorage.setItem("p99:pick", v), JSON.stringify(opts.pick));
  const p = await ctx.newPage();
  const errors = [];
  const seen = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/_p99/api/")) seen.push({ method: r.method(), path: u.pathname.slice(9), query: u.search, body: r.postData() ? JSON.parse(r.postData()) : null });
  });
  await p.goto(`${ORIGIN}/${opts.page || (opts.strict ? "strict" : "checkout")}#p99=${back.code}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button:not(.f)");
    return b && !b.hidden;
  });
  await p.locator("p99-root .w button:not(.f)").click();
  await p.locator("p99-root .p99-board-open").click();
  await p.waitForFunction((least) => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card").length > least, opts.least ?? 5);
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live");
  await p.waitForTimeout(400);
  return { ctx, p, errors, seen };
}

const R = (p, fn, arg) => p.evaluate(fn, arg);

function luminance([r, g, b]) {
  const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};
const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);

export async function themeOf(p, host = "p99-root", bare = false) {
  const bareCss = ":host{--p99-art:none!important;--p99-head-art:none!important}";
  const probe = ".p99-board-name h2,.p99-live,.p99-board .p99-logo,.p99-board-new,.p99-board .p99-x{visibility:hidden!important}.p99-board-head{transition:none!important}";
  if (bare) await p.evaluate(([h, css]) => { const r = document.querySelector(h).shadowRoot; const s = new CSSStyleSheet(); s.replaceSync(css); s.__p99Probe = true; r.adoptedStyleSheets = r.adoptedStyleSheets.concat([s]); }, [host, bareCss]);
  const facts = await p.evaluate((h) => {
    const r = document.querySelector(h).shadowRoot;
    const box = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; };
    const title = r.querySelector("#p99-board-title");
    const live = r.querySelector(".p99-live");
    const card = r.querySelector(".p99-card");
    return { title: getComputedStyle(title).color, live: getComputedStyle(live).color, card: getComputedStyle(card).backgroundColor, at: { title: box(title), live: box(live) } };
  }, host);
  await p.evaluate(([h, css]) => { const r = document.querySelector(h).shadowRoot; const s = new CSSStyleSheet(); s.replaceSync(css); s.__p99Probe = true; r.adoptedStyleSheets = r.adoptedStyleSheets.concat([s]); }, [host, probe]);
  const shots = {};
  for (const k of ["title", "live"]) shots[k] = (await p.screenshot({ clip: facts.at[k], animations: "disabled" })).toString("base64");
  await p.evaluate((h) => { const r = document.querySelector(h).shadowRoot; r.adoptedStyleSheets = r.adoptedStyleSheets.filter((x) => !x.__p99Probe); }, host);
  const blank = await p.context().newPage();
  const behind = await blank.evaluate(async (all) => {
    const out = {};
    for (const [k, b64] of Object.entries(all)) {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
      out[k] = sum.map((v) => Math.round(v / (d.length / 4)));
    }
    return out;
  }, shots);
  await blank.close();
  if (bare) await p.evaluate((h) => { const r = document.querySelector(h).shadowRoot; r.adoptedStyleSheets = r.adoptedStyleSheets.filter((x) => !x.__p99Probe); }, host);
  const dark = (c) => luminance(c) < 0.18;
  return {
    title: contrast(rgb(facts.title), behind.title),
    live: contrast(rgb(facts.live), behind.live),
    ground: dark(behind.title) ? "dark" : "light",
    cards: dark(rgb(facts.card)) ? "dark" : "light",
    behind,
  };
}
const column = (p, label) => R(p, (l) => {
  const c = Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col")).find((x) => x.dataset.label === l);
  return c ? Array.from(c.querySelectorAll(".p99-card"), (e) => e.dataset.id) : null;
}, label);
const settle = (p) => p.waitForFunction(() => {
  const r = document.querySelector("p99-root").shadowRoot;
  return !r.querySelector(".p99-ghost") && r.getAnimations().every((a) => a.playState !== "running" || a.effect.getTiming().iterations === Infinity);
});
const shown = (p, sel) => p.waitForFunction((s) => document.querySelector("p99-root").shadowRoot.querySelector(s), sel);
const hidden = (p) => R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board").hidden);
const title = (p) => R(p, () => document.querySelector("p99-root").shadowRoot.querySelector("#p99-board-title").textContent);
const card = (id) => `p99-root .p99-card[data-id="${id}"]`;
const inCol = (label, id) => `.p99-col[data-label="${label}"] .p99-card[data-id="${id}"]`;
const panelOpen = (p) => R(p, () => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open"));
async function shutPanel(p) {
  await p.waitForTimeout(400);
  if (!(await panelOpen(p))) return;
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel").hidden);
}

async function drag(p, from, to, steps = 12) {
  const a = await p.locator(card(from)).boundingBox();
  const b = await p.locator(card(to)).boundingBox();
  const x0 = a.x + a.width / 2, y0 = a.y + 20, x1 = b.x + b.width / 2, y1 = b.y + 6;
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await p.waitForTimeout(16);
  }
}

async function reopen(p, source) {
  await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board .p99-x").click());
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board").hidden);
  if (!(await R(p, () => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]")))) await p.locator("p99-root .w button:not(.f)").click();
  await p.locator(`p99-root .p99-panel.is-open .p99-pick input[name=source][value="${source}"]`).check({ force: true });
  await p.locator("p99-root .p99-board-open").click();
  await p.waitForFunction(() => { const r = document.querySelector("p99-root").shadowRoot; return r.querySelector(".p99-board.is-open") && r.querySelectorAll(".p99-card").length > 5; });
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live");
  await p.waitForTimeout(400);
}

async function check(back) {
  const K = back.key;
  const browser = await launch();
  let passed = 0;
  const ok = (name) => { passed++; console.log(`ok - ${name}`); };
  try {
    const { p, errors, seen } = await board(browser, back);
    const moves = () => seen.filter((c) => c.method === "POST" && c.path === "/move");
    const lastMove = () => moves().at(-1)?.body;
    assert.equal(await title(p), "Board");
    assert.deepEqual(await R(p, () => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col"), (c) => [c.dataset.word, c.dataset.label])), LANES.map((l) => [l.word, l.label]));
    assert.deepEqual(await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return [!!r.querySelector(".p99-pick-board"), !!r.querySelector(".p99-menu"), !!r.querySelector(".p99-watch")]; }), [false, false, false]);
    assert.ok(seen.some((c) => c.method === "GET" && c.path === "/board") && !seen.some((c) => c.path.startsWith("/boards")));
    ok("the Board button opens the one board from /board: seven lanes in order, no picker, no /boards read");

    const head = () => R(p, () => {
      const r = document.querySelector("p99-root").shadowRoot;
      const roll = r.querySelector(".p99-roll");
      const done = r.querySelectorAll(".p99-col[data-closes] .p99-card").length;
      const total = r.querySelectorAll(".p99-cols .p99-card").length;
      const feet = Array.from(r.querySelectorAll(".p99-cols .p99-card"), (e) => {
        const foot = e.querySelector(".p99-card-foot");
        const who = e.querySelector(".p99-who");
        const project = e.querySelector(".p99-card-project");
        const top = e.querySelector(".p99-card-top");
        return { foot: !!foot, last: e.lastElementChild === foot, who: !who || who.parentElement === foot, project: !project || project.parentElement === foot, top: top.children.length, right: !who || !project || who.getBoundingClientRect().left > project.getBoundingClientRect().right };
      });
      return { text: roll.textContent, hidden: roll.hidden, title: roll.title, want: `${done}/${total}`, words: `${done} of ${total} done`, feet };
    });
    const opened = await head();
    assert.ok(!opened.hidden && opened.text === opened.want && opened.title === opened.words, `the head counts the cards in the closing lane over every card shown: ${JSON.stringify(opened)}`);
    assert.ok(opened.feet.every((f) => f.who && f.project && f.top === 1 && f.right && (!f.foot || f.last)), `a card's project and assignee share its last row, the face on the right: ${JSON.stringify(opened.feet.filter((f) => !(f.who && f.project && f.top === 1 && f.right)))}`);
    assert.ok(opened.feet.some((f) => f.foot), "some cards carry a project or an assignee");
    ok("the head shows done over all the cards shown, and a card's project and assignee sit together on its last row, the face on the right, as the approved draft has them");

    await p.evaluate(() => {
      self.__loaf = [];
      new PerformanceObserver((l) => self.__loaf.push(...l.getEntries().map((e) => e.duration))).observe({ type: "long-animation-frame" });
    });
    await drag(p, K("FEAT-9"), K("TASK-3"), 40);
    const easing = await R(p, () => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card")).flatMap((e) => e.getAnimations().map((a) => a.effect.getTiming().easing)));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await settle(p);
    assert.ok(easing.every((x) => x.startsWith("cubic-bezier")), `card animations ease: ${easing}`);
    assert.deepEqual(lastMove(), { key: K("FEAT-9"), from: "New", to: "in-progress", before: K("TASK-3") });
    const next = async () => { const d = await column(p, "In progress"); return d[d.indexOf(K("FEAT-9")) + 1]; };
    assert.equal(await next(), K("TASK-3"));
    await p.waitForTimeout(400);
    assert.equal(await next(), K("TASK-3"));
    const loaf = await R(p, () => self.__loaf);
    ok(`mouse drag sends {key, from, to, before} with the lane's word and no board, and the live echo keeps FEAT-9 before TASK-3 (${loaf.length} long animation frames)`);

    await p.locator(card(K("BUG-9"))).focus();
    await p.keyboard.press("Space");
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Enter");
    await settle(p);
    assert.equal(lastMove().key, K("BUG-9"));
    assert.equal(lastMove().from, "Landed");
    assert.equal(lastMove().to, "done");
    await p.waitForTimeout(500);
    await settle(p);
    assert.ok((await column(p, "Done")).includes(K("BUG-9")));
    ok("keyboard: Space lifts BUG-9, an arrow carries it to Done, Enter drops it");

    const before = seen.length;
    await p.locator(card(K("Q-4"))).focus();
    await p.keyboard.press("Space");
    await p.keyboard.press("ArrowLeft");
    await p.keyboard.press("Escape");
    await settle(p);
    assert.ok((await column(p, "Landed")).includes(K("Q-4")));
    assert.equal(seen.slice(before).filter((c) => c.path === "/move").length, 0);
    assert.equal(await hidden(p), false);
    ok("keyboard: Escape puts Q-4 back with no move sent, and the board stays open");

    await p.route("**/_p99/api/move", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the database is busy" }) }), { times: 1 });
    await drag(p, K("IMP-6"), K("Q-4"));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await shown(p, ".p99-board-note");
    await settle(p);
    assert.ok((await column(p, "New")).includes(K("IMP-6")));
    ok("a failed move animates IMP-6 back to New and says so");

    await back.other({ key: "BUG-14", from: "New", to: "landed" });
    await shown(p, inCol("Landed", K("BUG-14")));
    const live = await R(p, (id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${id}"]`).getAnimations().map((a) => a.effect.getTiming().easing), K("BUG-14"));
    await settle(p);
    assert.ok(live.length && live.every((x) => x.startsWith("cubic-bezier")), `live move eases: ${live}`);
    ok("live: Grace, another Owner, moves BUG-14 to Landed and it slides there on my board, eased");

    const loads = () => seen.filter((c) => c.method === "GET" && c.path === "/board").length;
    const was = loads();
    await p.route("**/_p99/api/move", async (r) => {
      await back.other({ key: "BUG-11", from: "In progress", to: "landed" });
      return r.continue();
    }, { times: 1 });
    await drag(p, K("BUG-11"), K("BUG-7"));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-note")?.textContent === "this card moved; refreshed");
    await p.waitForFunction((id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-label="Landed"] .p99-card[data-id="${id}"]`), K("BUG-11"));
    await settle(p);
    assert.ok(loads() > was);
    assert.equal(lastMove().from, "In progress");
    ok("a stale drag (Grace moved BUG-11 first) gets the 409 line, the board reloads, and BUG-11 sits where she put it");

    await back.other({ key: "Q-4", from: "Landed", to: "Stuck" });
    await shown(p, inCol("Stuck", K("Q-4")));
    ok("live: a move by lane name slides Q-4 into Stuck");

    await back.other({ key: "FEAT-9", from: "In progress", to: "in-progress", after: "TASK-3" }, ADA);
    await p.waitForTimeout(500);
    await settle(p);
    const doing = await column(p, "In progress");
    assert.equal(doing.at(-1), K("FEAT-9"));
    ok("live: an order event from my other tab slides FEAT-9 to the end of In progress");

    back.drop();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live").dataset.state !== "live");
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live").dataset.state === "live", null, { timeout: 8000 });
    ok("the stream reconnects with a fresh ticket after the socket drops");

    const done = await column(p, "Done");
    const list = await p.locator('p99-root .p99-col[data-label="Done"] .p99-cards').boundingBox();
    const first = await p.locator(card(done[0])).boundingBox();
    const second = await p.locator(card(done[1])).boundingBox();
    const from = await p.locator(card(K("TASK-3"))).boundingBox();
    const gx = list.x + list.width / 2, edge = list.y + list.height - 12, mid = (first.y + first.height + second.y) / 2;
    const sent0 = moves().length;
    await p.mouse.move(from.x + from.width / 2, from.y + 20);
    await p.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(from.x + from.width / 2 + ((gx - from.x - from.width / 2) * i) / 12, from.y + 20 + ((edge - from.y - 20) * i) / 12);
      await p.waitForTimeout(16);
    }
    for (let i = 0; i < 24; i++) {
      await p.mouse.move(gx + (i % 2 ? 30 : -30), edge);
      await p.waitForTimeout(16);
    }
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(gx, edge + ((mid - edge) * i) / 12);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(260);
    await p.mouse.up();
    await settle(p);
    assert.equal(moves().length, sent0 + 1);
    assert.deepEqual(lastMove(), { key: K("TASK-3"), from: "In progress", to: "done", before: done[1] });
    assert.deepEqual(await column(p, "Done"), [done[0], K("TASK-3"), ...done.slice(1)]);
    await p.waitForFunction(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      return r.querySelector(".p99-roll").textContent === `${r.querySelectorAll(".p99-cols .p99-col[data-closes] .p99-card").length}/${r.querySelectorAll(".p99-cols .p99-card").length}`;
    }, null, { timeout: 2000 });
    const counted = await head();
    assert.ok(counted.text === counted.want && parseInt(counted.text, 10) > parseInt(opened.text, 10), `a drop into Done counts in the head at once: ${opened.text} then ${counted.text}`);
    ok("a drag that sweeps the bottom edge of a short column, then moves up, drops where the pointer is, and the head's done count follows it");

    const sent1 = moves().length;
    await drag(p, K("FEAT-9"), K("IMP-6"));
    await back.other({ key: "BUG-14", from: "Landed", to: "done" });
    await p.waitForTimeout(500);
    const held = (await column(p, "Landed")).includes(K("BUG-14"));
    await p.mouse.up();
    await settle(p);
    await shown(p, inCol("Done", K("BUG-14")));
    await p.waitForTimeout(500);
    await settle(p);
    const twice = await R(p, (ids) => ids.map((id) => document.querySelector("p99-root").shadowRoot.querySelectorAll(`.p99-card[data-id="${id}"]`).length), [K("BUG-14"), K("FEAT-9")]);
    assert.equal(held, true);
    assert.deepEqual(twice, [1, 1]);
    assert.equal(moves().length, sent1 + 1);
    assert.deepEqual(lastMove(), { key: K("FEAT-9"), from: "In progress", to: "new", before: K("IMP-6") });
    assert.deepEqual(await column(p, "New"), [K("FEAT-9"), K("IMP-6")]);
    ok("live: Grace's move during my mouse drag waits for the drop, then applies once, with one move sent");

    const gets = () => seen.filter((c) => c.method === "GET" && c.path === "/board");
    const got = () => p.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/_p99/api/board");
    const once = (ids) => R(p, (xs) => xs.map((id) => document.querySelector("p99-root").shadowRoot.querySelectorAll(`.p99-card[data-id="${id}"]`).length), ids);
    const ghosted = () => R(p, () => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-ghost"));
    const hold = async () => {
      let open, came;
      const gate = new Promise((r) => (open = r)), arrived = new Promise((r) => (came = r));
      await p.route((u) => u.pathname === "/_p99/api/board", async (r) => { came(); await gate; return r.continue(); }, { times: 1 });
      return { arrived, open };
    };
    const press = async (id) => {
      const b = await p.locator(card(id)).boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + 20);
      await p.mouse.down();
    };

    const sent2 = moves().length, mark = seen.length;
    let early = -1;
    await p.route("**/_p99/api/move", async (r) => {
      await new Promise((w) => setTimeout(w, 600));
      early = gets().filter((c) => seen.indexOf(c) >= mark).length;
      return r.continue();
    }, { times: 1 });
    await drag(p, K("IMP-6"), K("FEAT-9"));
    await back.other({ key: "IMP-6", from: "New", to: "new", after: "FEAT-9" }, ADA);
    await p.waitForTimeout(500);
    const queued = await ghosted();
    const posted = p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/move"));
    const dropAt = seen.length;
    await p.mouse.up();
    await posted;
    assert.equal(early, 0);
    await got();
    await settle(p);
    await p.waitForTimeout(400);
    assert.equal(queued, true);
    assert.equal(gets().filter((c) => seen.indexOf(c) >= dropAt).length, 1);
    assert.equal(moves().length, sent2 + 1);
    assert.deepEqual(lastMove(), { key: K("IMP-6"), from: "New", to: "new", before: K("FEAT-9") });
    assert.deepEqual(await column(p, "New"), [K("IMP-6"), K("FEAT-9")]);
    ok("an order event about the card I'm dragging waits for the drop; its reload goes out after my move's POST, once");

    await reopen(p, "human");
    assert.equal(await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-filter").textContent), "showing People");
    assert.ok(seen.some((c) => c.method === "GET" && c.path === "/board" && new URLSearchParams(c.query).get("source") === "human"));

    const done1 = await column(p, "Done");
    const dest = await p.locator(card(done1[0])).boundingBox();
    const qa = await p.locator(card(K("BUG-11"))).boundingBox();
    const sent3 = moves().length;
    const h1 = await hold();
    await back.other({ key: "Q-4", from: "Stuck", to: "done" });
    await h1.arrived;
    await drag(p, K("FEAT-9"), K("BUG-11"));
    const landed = got();
    h1.open();
    await landed;
    await p.waitForTimeout(100);
    const during = { qa: await column(p, "Landed"), ghost: await ghosted(), q4: (await column(p, "Stuck")).includes(K("Q-4")) };
    const x0 = qa.x + qa.width / 2, y0 = qa.y + 6, x1 = dest.x + dest.width / 2, y1 = dest.y + 6;
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(260);
    const follows = (await column(p, "Done"))[0];
    const upAt = seen.length;
    await p.mouse.up();
    await settle(p);
    await shown(p, inCol("Done", K("Q-4")));
    await settle(p);
    const after = await column(p, "Done");
    assert.deepEqual(during, { qa: [K("FEAT-9"), K("BUG-11")], ghost: true, q4: true });
    assert.equal(follows, K("FEAT-9"));
    assert.equal(moves().length, sent3 + 1);
    assert.deepEqual(lastMove(), { key: K("FEAT-9"), from: "New", to: "done", before: done1[0] });
    const postAt = seen.findIndex((c, i) => i >= upAt && c.method === "POST" && c.path === "/move");
    assert.ok(postAt >= 0 && gets().some((c) => seen.indexOf(c) > postAt));
    assert.ok(after.indexOf(K("FEAT-9")) >= 0 && after.indexOf(K("FEAT-9")) < after.indexOf(done1[0]));
    assert.deepEqual(await column(p, "New"), [K("IMP-6")]);
    assert.deepEqual(await column(p, "Landed"), [K("BUG-11")]);
    assert.deepEqual(await once([K("FEAT-9"), K("Q-4"), K("BUG-11")]), [1, 1, 1]);
    ok("under a filter a move reloads the board; a load that lands while I drag keeps the ghost and the slot under the pointer, and paints after the drop's POST");

    const sent4 = moves().length;
    const h2 = await hold();
    await back.other({ key: "BUG-12", from: "Stuck", to: "landed" });
    await h2.arrived;
    await press(K("IMP-6"));
    const landed2 = got();
    h2.open();
    await landed2;
    await p.waitForTimeout(400);
    const pressed = { bug12: (await column(p, "Landed")).includes(K("BUG-12")), ghost: await ghosted() };
    await p.mouse.up();
    await shown(p, inCol("Landed", K("BUG-12")));
    await shutPanel(p);
    assert.deepEqual(pressed, { bug12: false, ghost: false });
    assert.equal(moves().length, sent4);
    assert.equal(await hidden(p), false);
    ok("a board load that lands during a press that never lifts paints when the button comes up");

    await back.other({ key: "BUG-12", from: "Landed", to: "stuck" });
    await shown(p, inCol("Stuck", K("BUG-12")));
    await settle(p);
    const h3 = await hold();
    await back.other({ key: "BUG-12", from: "Stuck", to: "done" });
    await h3.arrived;
    await press(K("IMP-6"));
    const landed3 = got();
    h3.open();
    await landed3;
    await p.waitForTimeout(400);
    const cancelled = (await column(p, "Done")).includes(K("BUG-12"));
    await R(p, (id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${id}"]`).dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse" })), K("IMP-6"));
    await shown(p, inCol("Done", K("BUG-12")));
    await p.mouse.up();
    await shutPanel(p);
    assert.equal(cancelled, false);
    assert.equal(moves().length, sent4);
    ok("a board load that lands during a press the browser cancels paints at the cancel");

    await back.other({ key: "BUG-12", from: "Done", to: "stuck" });
    await shown(p, inCol("Stuck", K("BUG-12")));
    await settle(p);
    await press(K("IMP-6"));
    await p.mouse.move(6, 6);
    await p.mouse.up();
    const outside = { ghost: await ghosted(), hidden: await hidden(p) };
    await back.other({ key: "BUG-12", from: "Stuck", to: "landed" });
    await shown(p, inCol("Landed", K("BUG-12")));
    await settle(p);
    await shutPanel(p);
    assert.deepEqual(outside, { ghost: false, hidden: false });
    assert.equal(moves().length, sent4);
    assert.deepEqual(await column(p, "New"), [K("IMP-6")]);
    ok("a press released outside the board ends there, so the next reload still paints");

    await reopen(p, "");
    assert.equal(await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-filter").hidden), true);

    await R(p, () => { self.__stop = (e) => e.stopPropagation(); document.addEventListener("pointerup", self.__stop); });
    const sent5 = moves().length;
    await drag(p, K("IMP-6"), K("BUG-11"));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await settle(p);
    const pair = async (a, b) => { const c = await column(p, "Landed"); return c.indexOf(a) >= 0 && c.indexOf(b) === c.indexOf(a) + 1; };
    const hosted = { ghost: await ghosted(), qa: await pair(K("IMP-6"), K("BUG-11")), first: lastMove() };
    await shutPanel(p);
    await drag(p, K("BUG-11"), K("IMP-6"));
    await p.waitForTimeout(260);
    const relifted = await ghosted();
    await p.mouse.up();
    await settle(p);
    await shutPanel(p);
    await R(p, () => document.removeEventListener("pointerup", self.__stop));
    assert.deepEqual(hosted, { ghost: false, qa: true, first: { key: K("IMP-6"), from: "New", to: "landed", before: K("BUG-11") } });
    assert.equal(relifted, true);
    assert.equal(moves().length, sent5 + 2);
    assert.deepEqual(lastMove(), { key: K("BUG-11"), from: "Landed", to: "landed", before: K("IMP-6") });
    assert.equal(await pair(K("BUG-11"), K("IMP-6")), true);
    assert.equal(await ghosted(), false);
    ok("a host page that stops pointerup on its document still lets my drop land, and the next press lifts");

    await settle(p);
    const lane = (l) => `p99-root .p99-col[data-label="${l}"] .p99-cards`;
    const roll = (l, y) => R(p, ([x, v]) => {
      const e = document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-label="${x}"] .p99-cards`);
      if (v != null) e.scrollTop = v;
      return e.scrollTop;
    }, [l, y]);
    const calm = () => p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.getAnimations().every((a) => a.playState !== "running" || a.effect.getTiming().iterations === Infinity));
    const spot = (l, off, skip) => R(p, ([x, o, s]) => {
      const e = document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-label="${x}"] .p99-cards`);
      const top = e.getBoundingClientRect().top;
      const c = Array.from(e.children).find((n) => n.dataset.id !== s && n.getBoundingClientRect().top >= top + o);
      const b = c.getBoundingClientRect();
      return { id: c.dataset.id, x: b.left + b.width / 2, y: b.top + b.height / 4, h: b.height };
    }, [l, off, skip || null]);
    const glide = async (x0, y0, x1, y1, n = 12) => {
      for (let i = 1; i <= n; i++) {
        await p.mouse.move(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
        await p.waitForTimeout(16);
      }
    };
    const tally = () => R(p, () => {
      const r = document.querySelector("p99-root").shadowRoot;
      const ids = Array.from(r.querySelectorAll(".p99-card"), (e) => e.dataset.id);
      return {
        counts: Array.from(r.querySelectorAll(".p99-col"), (c) => Number(c.querySelector(".p99-count").textContent) === c.querySelectorAll(".p99-card").length),
        once: new Set(ids).size === ids.length,
        stray: Array.from(r.querySelectorAll(".p99-card")).filter((e) => e.style.translate || e.classList.contains("is-placeholder") || e.classList.contains("is-lifted")).length,
        ghost: !!r.querySelector(".p99-ghost"),
      };
    });
    const tidy = { counts: LANES.map(() => true), once: true, stray: 0, ghost: false };
    const ahead = (list, id, at) => { const l = list.filter((x) => x !== id); l.splice(l.indexOf(at), 0, id); return l; };

    const back0 = await column(p, "Planned"), rev0 = await column(p, "Needs you");
    assert.deepEqual([back0.length, rev0.length], [30, 30]);
    const lb = await p.locator(lane("Planned")).boundingBox();
    const lifted0 = await p.locator(card(back0[1])).boundingBox();
    assert.ok(30 * lifted0.height > 2 * lb.height, `Planned overflows: ${30 * lifted0.height} in ${lb.height}`);
    const sentL = moves().length;
    const ax = lifted0.x + lifted0.width / 2, ay = lifted0.y + 20, cx = lb.x + lb.width / 2;
    await p.mouse.move(ax, ay);
    await p.mouse.down();
    await glide(ax, ay, cx, lb.y + lb.height - 16);
    const far = 5 * lifted0.height;
    await p.waitForFunction(([sel, v]) => document.querySelector("p99-root").shadowRoot.querySelector(sel).scrollTop >= v, ['.p99-col[data-label="Planned"] .p99-cards', far]);
    await glide(cx, lb.y + lb.height - 16, cx, lb.y + lb.height / 2, 4);
    await calm();
    const rolled = await roll("Planned");
    const t1 = await spot("Planned", 100, back0[1]);
    await glide(cx, lb.y + lb.height / 2, t1.x, t1.y);
    await p.waitForTimeout(260);
    await p.mouse.up();
    await settle(p);
    assert.ok(rolled >= far && back0.indexOf(t1.id) >= 6, `autoscrolled ${rolled}px to ${t1.id}`);
    assert.equal(moves().length, sentL + 1);
    assert.deepEqual(lastMove(), { key: back0[1], from: "Planned", to: "planned", before: t1.id });
    assert.deepEqual(await column(p, "Planned"), ahead(back0, back0[1], t1.id));
    assert.deepEqual(await tally(), tidy);
    ok(`a long column autoscrolls under a held drag (${Math.round(rolled)}px) and the drop lands on the card under the pointer`);

    const back1 = await column(p, "Planned");
    await roll("Planned", 3 * lifted0.height);
    await roll("Needs you", 0);
    const s2 = await spot("Planned", 150);
    const lr = await p.locator(lane("Needs you")).boundingBox();
    await p.mouse.move(s2.x, s2.y);
    await p.mouse.down();
    await glide(s2.x, s2.y, s2.x, s2.y + 12, 3);
    await p.waitForFunction(() => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-ghost"));
    const scrolledTo = await roll("Needs you", 6 * lifted0.height);
    await p.waitForTimeout(100);
    const t2 = await spot("Needs you", 100);
    await glide(s2.x, s2.y + 12, t2.x, t2.y);
    await p.waitForTimeout(260);
    const kept = await roll("Needs you");
    await p.mouse.up();
    await settle(p);
    assert.ok(scrolledTo >= 5 * lifted0.height && rev0.indexOf(t2.id) >= 6, `Needs you scrolled ${scrolledTo}px to ${t2.id}`);
    assert.equal(moves().length, sentL + 2);
    assert.deepEqual(lastMove(), { key: s2.id, from: "Planned", to: "needs-you", before: t2.id });
    assert.deepEqual(await column(p, "Planned"), back1.filter((x) => x !== s2.id));
    assert.deepEqual(await column(p, "Needs you"), ahead(rev0, s2.id, t2.id));
    assert.deepEqual(await tally(), tidy);
    ok(`a column scrolled mid-drag takes the cross on the card under the pointer (scrolled ${Math.round(scrolledTo)}px, ${Math.round(kept)}px at the drop)`);

    const back2 = await column(p, "Planned"), rev2 = await column(p, "Needs you");
    await roll("Planned", 0);
    await roll("Needs you", 0);
    const a3 = await p.locator(card(back2[1])).boundingBox();
    const r3 = await spot("Needs you", 0);
    await p.mouse.move(a3.x + a3.width / 2, a3.y + 20);
    await p.mouse.down();
    await glide(a3.x + a3.width / 2, a3.y + 20, r3.x, r3.y + 2 * r3.h);
    await glide(r3.x, r3.y + 2 * r3.h, r3.x, r3.y + 4 * r3.h, 6);
    await p.waitForTimeout(260);
    const crossed = await R(p, (id) => { const r = document.querySelector("p99-root").shadowRoot; return { col: r.querySelector(`.p99-card[data-id="${id}"]`).closest(".p99-col").dataset.label, focus: !!r.activeElement }; }, back2[1]);
    await p.keyboard.press("Escape");
    await settle(p);
    const home = await R(p, () => document.querySelector("p99-root").shadowRoot.activeElement?.dataset.id);
    await p.mouse.up();
    await settle(p);
    await shutPanel(p);
    assert.deepEqual(crossed, { col: "Needs you", focus: true });
    assert.equal(home, back2[1]);
    assert.equal(await hidden(p), false);
    assert.equal(moves().length, sentL + 2);
    assert.deepEqual(await column(p, "Planned"), back2);
    assert.deepEqual(await column(p, "Needs you"), rev2);
    assert.deepEqual(await tally(), tidy);
    ok("Escape on a mouse drag that crossed columns puts the card home, sends nothing, and both counts match");

    const back3 = await column(p, "Planned"), rev3 = await column(p, "Needs you");
    const a4 = await p.locator(card(back3[0])).boundingBox();
    const ax4 = a4.x + a4.width / 2, ay4 = a4.y + 20;
    await p.mouse.move(ax4, ay4);
    await p.mouse.down();
    await glide(ax4, ay4, ax4, ay4 + 3 * a4.height);
    await calm();
    const slid = await R(p, (id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${id}"]`).style.translate, back3[0]);
    await p.setViewportSize({ width: 1000, height: VIEW.height });
    await p.waitForTimeout(200);
    await calm();
    const t4b = await p.locator(card(rev3[1])).boundingBox();
    await glide(ax4, ay4 + 3 * a4.height, t4b.x + t4b.width / 2, t4b.y + t4b.height / 4);
    await p.waitForTimeout(260);
    await p.mouse.up();
    await settle(p);
    const narrow = await p.locator(lane("Needs you")).boundingBox();
    const a5 = await p.locator(card(back3[2])).boundingBox();
    await p.mouse.move(a5.x + a5.width / 2, a5.y + 20);
    await p.mouse.down();
    await glide(a5.x + a5.width / 2, a5.y + 20, a5.x + a5.width / 2, a5.y + 40, 3);
    await p.waitForTimeout(100);
    const relift = await ghosted();
    await p.keyboard.press("Escape");
    await settle(p);
    await p.mouse.up();
    await settle(p);
    await shutPanel(p);
    await p.setViewportSize(VIEW);
    await p.waitForTimeout(200);
    assert.ok(parseFloat(slid.split(" ")[1]) >= 2 * a4.height, `two slots down: ${slid}`);
    assert.ok(narrow.x < lr.x, `the narrow layout moved Needs you left of where it was (${narrow.x} < ${lr.x})`);
    assert.equal(relift, true);
    assert.equal(moves().length, sentL + 3);
    assert.deepEqual(lastMove(), { key: back3[0], from: "Planned", to: "needs-you", before: rev3[1] });
    assert.deepEqual(await column(p, "Planned"), back3.slice(1));
    assert.deepEqual(await column(p, "Needs you"), ahead(rev3, back3[0], rev3[1]));
    assert.deepEqual(await tally(), tidy);
    ok("a window resized mid-drag measures again: the drop lands where the pointer is in the new layout, and the next press lifts");

    const anyOwner = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { mine: r.querySelector(".p99-board").dataset.mine, help: r.querySelectorAll(".p99-card[aria-describedby=p99-drag-help]").length === r.querySelectorAll(".p99-card").length }; });
    assert.deepEqual(anyOwner, { mine: "true", help: true });
    ok("every card on the one board can be moved by me, an Owner, with the drag help on each");

    await p.locator(card(K("FEAT-9"))).click();
    await shown(p, ".p99-panel.is-open");
    assert.ok(seen.some((c) => c.path === `/issues/${K("FEAT-9")}`));
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open"));
    assert.equal(await hidden(p), false);
    ok("an item card opens its thread in the panel; Escape closes the panel and leaves the board open");

    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board").hidden);
    await p.waitForTimeout(500);
    assert.equal(back.open(), 0);
    ok("Escape closes the board and its WebSocket");
    assert.deepEqual(errors, []);

    const quiet = await board(browser, back, { motion: "reduce" });
    await drag(quiet.p, K("IMP-6"), K("BUG-7"));
    const running = await R(quiet.p, () => document.querySelector("p99-root").shadowRoot.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).map((a) => `${a.animationName || a.transitionProperty || a.id} on ${a.effect.target?.className}`));
    await quiet.p.mouse.up();
    assert.deepEqual(running, []);
    ok("with reduced motion nothing animates");
    await quiet.ctx.close();

    const cardsOf = (b) => R(b.p, () => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card"), (e) => e.dataset.id));
    const boardRead = (b) => b.seen.filter((c) => c.method === "GET" && c.path === "/board").at(-1)?.query ?? null;
    const site = await board(browser, back);
    const here = await cardsOf(site);
    assert.ok(!here.includes(K("BUG-31")) && here.includes(K("BUG-14")), `This project, the default, keeps ${HOME}'s cards and drops ${ELSEWHERE}'s: ${here}`);
    assert.equal(boardRead(site), `?project=${HOME}`);
    await site.ctx.close();
    const every = await board(browser, back, { pick: { view: "projects", projects: [], source: "" }, least: 0 });
    assert.ok((await cardsOf(every)).includes(K("BUG-31")), `Projects shows ${ELSEWHERE}'s BUG-31`);
    assert.equal(boardRead(every), "");
    await every.ctx.close();
    ok(`This project, the default, asks /board?project=${HOME}, the project ${HOST} belongs to; Projects shows every host's cards`);

    const lanes = await board(browser, back);
    await drag(lanes.p, K("LB-2"), K("LR-3"), 18);
    const crossing = await R(lanes.p, () => {
      const r = document.querySelector("p99-root").shadowRoot;
      const shifts = r.getAnimations().filter((a) => a.id === "p99-shift");
      const lists = Array.from(r.querySelectorAll(".p99-cards"));
      const off = shifts.filter((a) => {
        const e = a.effect.target, list = e.closest(".p99-cards"), box = list.getBoundingClientRect(), b = e.getBoundingClientRect();
        return b.bottom < box.top - b.height * 2 || b.top > box.bottom + b.height * 2;
      }).length;
      return { shifts: shifts.length, off, dragging: r.querySelector(".p99-board").classList.contains("is-dragging"), cards: lists.reduce((n, l) => n + l.children.length, 0), transition: getComputedStyle(r.querySelector(".p99-card:not(.is-placeholder)")).transitionDuration };
    });
    await lanes.p.mouse.up();
    await settle(lanes.p);
    const dropped = await R(lanes.p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board").classList.contains("is-dragging"));
    assert.ok(crossing.dragging && !dropped, `the board carries is-dragging only while a card is held (${crossing.dragging}, ${dropped})`);
    assert.ok(crossing.shifts < 30 && crossing.off === 0, `crossing into a 30-card lane animates only the rows near its view: ${JSON.stringify(crossing)}`);
    assert.match(crossing.transition, /^0s(, 0s)*$/, `cards run no transitions while a card is held (${crossing.transition})`);
    await lanes.ctx.close();
    ok("a drag across long lanes animates only the rows in view and turns card transitions off until the drop");

    const barred = await launch(true);
    try {
      for (const view of [{ width: 1245, height: 1290 }, { width: 1024, height: 768 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
        for (const scheme of ["light", "dark"]) {
          const at = `${view.width}x${view.height} ${scheme}`;
          const s = await board(barred, back, { view, scheme, touch: view.width < 600, strict: true });
          const cols = () => R(s.p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft);
          const lane = (word) => R(s.p, (w) => {
            const l = document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-word=${w}] .p99-cards`);
            const r = l.getBoundingClientRect();
            return { at: [r.x + r.width / 2, r.y + r.height / 2], fits: l.scrollHeight <= l.clientHeight, top: l.scrollTop };
          }, word);
          const box = await R(s.p, () => {
            const r = document.querySelector("p99-root").shadowRoot;
            const b = r.querySelector(".p99-board").getBoundingClientRect();
            const c = r.querySelector(".p99-cols");
            const cb = c.getBoundingClientRect();
            c.scrollLeft = c.scrollWidth;
            const set = c.scrollLeft;
            c.scrollLeft = 0;
            const l = r.querySelector(".p99-col[data-word=planned] .p99-cards");
            return {
              wide: c.scrollWidth > c.clientWidth, bar: c.offsetHeight - c.clientHeight, lane: l.offsetWidth - l.clientWidth, panel: getComputedStyle(r.querySelector(".p99-panel")).scrollbarColor, nulls: Array.from(r.querySelectorAll(".p99-card"), (e) => e.textContent).filter((x) => x.endsWith("null")).length,
              inside: cb.bottom < b.bottom && cb.left >= b.left && cb.right <= b.right, window: b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth, set,
            };
          });
          assert.ok(box.wide && box.bar === 8 && box.lane > 0 && box.lane <= 8 && box.panel === "auto" && box.nulls === 0 && box.inside && box.window && box.set > 0, `${at}: ${JSON.stringify(box)}`);
          const fresh = await lane("new");
          assert.ok(fresh.fits, `${at}: the New lane fits its cards`);
          await s.p.mouse.move(...fresh.at);
          await s.p.mouse.wheel(0, 300);
          await s.p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft > 0);
          await R(s.p, () => {
            const c = document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols");
            const col = c.querySelector(".p99-col[data-word=planned]");
            c.scrollLeft = Math.max(0, col.offsetLeft + col.offsetWidth / 2 - c.clientWidth / 2);
          });
          const x0 = await cols();
          const full = await lane("planned");
          assert.ok(!full.fits && full.top === 0, `${at}: the Planned lane overflows`);
          await s.p.mouse.move(...full.at);
          await s.p.mouse.wheel(0, 300);
          await s.p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-col[data-word=planned] .p99-cards").scrollTop > 0);
          assert.equal(await cols(), x0, `${at}: the wheel over a full lane scrolls its cards and leaves the lanes where they are`);
          await s.p.mouse.wheel(60, 0);
          await s.p.waitForFunction((was) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft > was, x0);
          const x1 = await cols();
          await s.p.keyboard.down("Shift");
          await s.p.mouse.wheel(0, 60);
          await s.p.keyboard.up("Shift");
          await s.p.waitForFunction((was) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft > was, x1);
          await s.ctx.close();
        }
      }
    } finally {
      await barred.close();
    }
    ok("1245, 1024, 800 and 390 wide, light and dark: lanes that don't fit scroll sideways by a sideways swipe or shift+wheel anywhere, and by the plain wheel where no lane can scroll; a full lane still scrolls its cards; on a strict-CSP host whose * rule sets scrollbar-color, the lane and lanes bars stay P99's 8px bars, inside the dialog");

    for (const [size, view] of SIZES) {
      for (const scheme of ["light", "dark"]) {
        const s = await board(browser, back, { view, scheme, touch: size !== "1440" });
        const fit = await R(s.p, () => {
          const r = document.querySelector("p99-root").shadowRoot;
          const head = r.querySelector(".p99-board-head").getBoundingClientRect();
          const live = r.querySelector(".p99-live").getBoundingClientRect();
          const x = r.querySelector(".p99-board .p99-x").getBoundingClientRect();
          return { wide: document.documentElement.scrollWidth <= innerWidth, x: x.right <= innerWidth && x.right <= head.right + 0.5, live: live.right <= x.left };
        });
        assert.deepEqual(fit, { wide: true, x: true, live: true }, `${size} ${scheme}`);
        mkdirSync(out, { recursive: true });
        await s.p.screenshot({ path: join(out, `board-${size}-${scheme}.png`), animations: "disabled" });
        await s.ctx.close();
      }
    }
    ok(`360, 411 and 1440 wide, light and dark: the head fits and nothing scrolls sideways (stills in ${out})`);

    for (const [page, scheme] of [["light", "light"], ["light", "dark"], ["dark", "dark"], ["dark", "light"]]) {
      const s = await board(browser, back, { scheme, page, motion: "reduce" });
      for (const bare of [false, true]) {
        const at = `a ${page} page in a ${scheme} browser${bare ? ", the texture not loaded" : ""}`;
        const t = await themeOf(s.p, "p99-root", bare);
        assert.ok(t.title >= 4.5 && t.live >= 4.5, `${at}: the head's words read at 4.5:1 or more on their own background ${JSON.stringify(t)}`);
        assert.ok(t.ground === scheme && t.cards === scheme, `${at}: the background and the cards are both ${scheme} ${JSON.stringify(t)}`);
      }
      await s.p.screenshot({ path: join(out, `board-page-${page}-browser-${scheme}.png`), animations: "disabled" });
      await s.ctx.close();
    }
    ok("a light or dark page in a light or dark browser, with or without the texture: the board's background, lanes and cards take the browser's theme, and the head's title and LIVE read at 4.5:1 or more");
    console.log(`${passed} checks passed against the ${back.name}`);
  } finally {
    await browser.close();
  }
}

async function draft(back) {
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  try {
    const { p } = await board(browser, back);
    const box = await p.locator(card(back.key("FEAT-9"))).boundingBox();
    const dest = await p.locator(card(back.key("TASK-3"))).boundingBox();
    const x0 = box.x + box.width / 2, y0 = box.y + 20, tx = dest.x + dest.width / 2 - 26, ty = dest.y + 6;
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(x0 + ((tx - x0) * i) / 12, y0 + ((ty - y0) * i) / 12);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(450);
    const file = join(out, `board-draft-${process.env.P99_SCHEME || "light"}.png`);
    await p.screenshot({ path: file });
    console.log(file);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const back = process.argv.includes("--worker") ? await worker() : await stub();
  try {
    await (process.argv[2] === "check" ? check(back) : draft(back));
  } finally {
    back.close();
  }
}

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
const HOST = "shop.example.com";
const ORIGIN = `http://${HOST}`;
const CODE = "boarddraft01";
const VIEW = { width: 1440, height: 900 };
const SIZES = [["360", { width: 360, height: 780 }], ["411", { width: 411, height: 860 }], ["1440", VIEW]];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const ADA = { name: "Ada Lovelace", email: "ada@example.com", username: "ada.lovelace" };
const GRACE = { name: "Grace Hopper", email: "grace@example.com", username: "grace.hopper" };
const LIN = { name: "Lin Okafor", email: "lin@example.com", username: "lin.okafor" };
const face = (p) => (p ? { username: p.username, avatar: null } : null);

const col = (label, closes = false) => ({ label, closes });
const boards = [
  { id: "1", name: "Shop", owner: ADA, columns: [col("Inbox"), col("Doing"), col("QA ready"), col("Done", true)] },
  { id: "2", name: "Launch", owner: ADA, columns: [col("Inbox"), col("Doing"), col("Done", true)] },
  { id: "3", name: "QA", owner: GRACE, columns: [col("QA ready"), col("Testing"), col("Done", true)] },
];
const items = [
  ["BUG-14", "bug", "The cart total doesn't update after removing a bag", "Inbox", GRACE],
  ["FEAT-9", "feature", "Let returning customers reorder from a receipt", "Inbox", null],
  ["IMP-6", "improvement", "The grind size chart is hard to read on a phone", "Inbox", null],
  ["BUG-11", "bug", "Gift card field accepts letters and then rejects the order", "Doing", ADA],
  ["TASK-3", "task", "Swap the hero photo for the autumn roast", "Doing", LIN],
  ["BUG-9", "bug", "Product images jump while the page loads", "QA ready", ADA],
  ["Q-4", "question", "Can we ship to the Canary Islands?", "QA ready", GRACE],
  ["BUG-12", "bug", "Apple Pay sheet closes on the second tap", "Testing", ADA],
  ["BUG-7", "bug", "Order confirmation mail shows the wrong delivery date", "Done", ADA],
  ["FEAT-5", "feature", "Show the roast date on every bag", "Done", LIN],
].map(([key, kind, title, label, assignee]) => ({ key, kind, title, label, assignee, reporter: GRACE }));
const orders = new Map(boards.map((b) => [b.id, new Map()]));
for (const b of boards) {
  const n = new Map();
  for (const it of items) {
    if (!b.columns.some((c) => c.label === it.label)) continue;
    const k = (n.get(it.label) || 0) + 1;
    n.set(it.label, k);
    orders.get(b.id).set(it.key, String(k / 10));
  }
}

const summary = (b, me) => ({ id: b.id, name: b.name, owner: face(b.owner), mine: b.owner === me, columns: b.columns });
function boardView(id, me) {
  const b = boards.find((x) => x.id === id);
  if (!b) return null;
  const at = (l) => b.columns.findIndex((c) => c.label === l);
  const o = orders.get(b.id);
  const cards = items.filter((i) => at(i.label) >= 0).map((i) => ({ key: i.key, kind: i.kind, title: i.title, label: i.label, assignee: face(i.assignee), order: o.get(i.key) || "0.5" }))
    .sort((x, y) => at(x.label) - at(y.label) || (x.order < y.order ? -1 : x.order > y.order ? 1 : 0));
  return { board: summary(b, me), cards };
}

const sockets = new Set();
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}
function publish(ev) {
  for (const s of sockets) s.write(frame(JSON.stringify({ ...ev, host: HOST })));
}

function between(lo, hi) { return String(((lo == null ? 0 : Number(lo)) + (hi == null ? 1 : Number(hi))) / 2); }
function move(body, me = ADA) {
  const it = items.find((i) => i.key === body.key);
  if (!it) return [404, { message: "no such item" }];
  if (it.label !== body.from) return [409, { error: "moved", message: "this card moved; refreshed" }];
  const b = body.board != null ? boards.find((x) => x.id === String(body.board)) : null;
  if (body.board != null && !b) return [404, { message: "no such board" }];
  if (b && b.owner !== me) return [403, { message: "that board isn't yours" }];
  if (!boards.some((x) => x.owner === me && x.columns.some((c) => c.label === body.to))) return [403, { message: "that label isn't on your boards" }];
  const from = it.label;
  it.label = body.to;
  if (from !== body.to) publish({ type: "label", key: it.key, from, to: body.to });
  let order = null;
  if (b) {
    const o = orders.get(b.id);
    const peers = items.filter((i) => i !== it && i.label === body.to).map((i) => ({ key: i.key, order: o.get(i.key) || "0.5" })).sort((x, y) => (x.order < y.order ? -1 : 1));
    const at = body.before ? peers.findIndex((x) => x.key === body.before) : body.after ? peers.findIndex((x) => x.key === body.after) + 1 : 0;
    order = between(at > 0 ? peers[at - 1].order : null, at < peers.length ? peers[at].order : null);
    o.set(it.key, order);
    publish({ type: "order", board: b.id, key: it.key, order });
  }
  return [200, { card: { key: it.key, kind: it.kind, title: it.title, label: it.label, assignee: face(it.assignee), order } }];
}

function api(method, path, body) {
  if (path.startsWith("/me")) return [200, { name: ADA.name, email: ADA.email, username: ADA.username, avatar: null, manager: true, host: HOST, env: "production", version: "draft", counts: { mine_open: 0, mine_unread: 0, page_open: 2 }, theme: { accent: "#b5621e" }, strings: {} }];
  if (method === "GET" && path === "/boards") return [200, { boards: boards.map((b) => summary(b, ADA)).sort((a, b) => b.mine - a.mine) }];
  if (method === "GET" && path.startsWith("/boards/")) {
    const v = boardView(decodeURIComponent(path.slice(8)), ADA);
    return v ? [200, v] : [404, { message: "no such board" }];
  }
  if (method === "POST" && path === "/move") return move(JSON.parse(body || "{}"));
  if (method === "POST" && path === "/stream-ticket") return [201, { ticket: "draft-ticket", expires_in: 60 }];
  if (method === "GET" && path.startsWith("/issues")) return [200, { issues: [], next_cursor: null }];
  return [404, { message: "no such route" }];
}

function serveFile(res, path) {
  let full = null;
  if (path === "/" || path === "/checkout") full = join(here, "site", "checkout.html");
  else if (path.startsWith("/_p99/")) full = join(web, path.slice(6));
  if (!full || (!full.startsWith(here) && !full.startsWith(web)) || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  let text = readFileSync(full, "utf8").split("__P99_VERSION__").join("draft");
  if (path === "/_p99/p99.js") text = text.split("__P99_HOST__").join(JSON.stringify({ t: "#b5621e" }));
  res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(text);
}

function stub() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/_p99/api/")) return serveFile(res, url.pathname);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const [status, data] = req.headers["x-p99-code"] === CODE ? api(req.method, url.pathname.slice(9), body) : [401, { message: "unknown code" }];
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
    board: (id) => id,
    other: async (body, who = GRACE) => move(body, who),
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
  const at = `?host=${HOST}`;
  await signed("PUT", "/envs/production", { kind: "release", position: 1, notify: false });
  await signed("PUT", `/hosts/${HOST}`, { env: "production", config: { theme: { accent: "#b5621e" } } });
  const minted = await signed("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], manager: true });
  await signed("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST], manager: true });
  await signed("POST", "/codes", { name: LIN.name, email: LIN.email, hosts: [HOST], manager: true });
  const ids = new Map();
  const own = async (who, list) => {
    const first = (await signed("GET", `/boards${at}`, null, who)).boards.find((b) => b.mine);
    const made = [];
    for (const [k, b] of list.entries()) {
      const body = { name: b.name, columns: b.columns };
      const got = k === 0 ? await signed("PUT", `/boards/${first.id}${at}`, body, who) : await signed("POST", `/boards${at}`, body, who);
      made.push(((got && got.board) || got || first).id ?? first.id);
    }
    list.forEach((b, k) => ids.set(b.id, made[k]));
  };
  await own(ADA, boards.filter((b) => b.owner === ADA));
  await own(GRACE, boards.filter((b) => b.owner === GRACE));
  const keys = new Map();
  let uid = 0;
  for (const it of items) {
    const made = await signed("POST", `/issues${at}`, { client_uid: `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`, kind: it.kind, title: it.title, body: "", page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" }, context: {}, marks: [] }, it.reporter);
    keys.set(it.key, made.key);
    if (it.assignee) await signed("PATCH", `/issues/${made.key}${at}`, { assignee: it.assignee.username });
    const by = boards.find((b) => b.owner === ADA && b.columns.some((c) => c.label === it.label)) ? ADA : GRACE;
    const on = boards.find((b) => b.owner === by && b.columns.some((c) => c.label === it.label));
    if (it.label !== "Inbox") await signed("POST", `/move${at}`, { key: made.key, from: "Inbox", to: it.label, board: ids.get(on.id) }, by);
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
  const sent = (body) => ({ ...body, key: keys.get(body.key), ...(body.board != null ? { board: ids.get(body.board) } : {}), ...(body.before ? { before: keys.get(body.before) } : {}), ...(body.after ? { after: keys.get(body.after) } : {}) });
  return {
    name: "worker",
    code: minted.secret,
    key: (id) => keys.get(id),
    board: (id) => ids.get(id),
    other: async (body, who = GRACE) => {
      try { return [200, await signed("POST", `/move${at}`, sent(body), who)]; } catch (e) { return [e.status || 500, { message: e.message }]; }
    },
    drop: () => { for (const p of piped) { p.socket.destroy(); p.up.destroy(); } },
    open: () => piped.size,
    close: () => { server.close(); dev.kill("SIGTERM"); },
  };
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function launch() {
  return chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
}

async function board(browser, back, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.view || VIEW, deviceScaleFactor: 1, colorScheme: opts.scheme || process.env.P99_SCHEME || "light", reducedMotion: opts.motion || "no-preference", hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await ctx.addInitScript(openShadow);
  const p = await ctx.newPage();
  const errors = [];
  const seen = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/_p99/api/")) seen.push({ method: r.method(), path: u.pathname.slice(9), body: r.postData() ? JSON.parse(r.postData()) : null });
  });
  await p.goto(`${ORIGIN}/checkout#p99=${back.code}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button:not(.f)");
    return b && !b.hidden;
  });
  await p.locator("p99-root .w button:not(.f)").click();
  await p.locator("p99-root .p99-board-open").click();
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card").length > 5);
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live");
  await p.waitForTimeout(400);
  return { ctx, p, errors, seen };
}

const R = (p, fn, arg) => p.evaluate(fn, arg);
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

async function pick(p, text, key = false) {
  if (key) {
    await p.locator("p99-root .p99-pick-board").focus();
    await p.keyboard.press("Enter");
  } else await p.locator("p99-root .p99-pick-board").click();
  await shown(p, ".p99-menu.is-open");
  await p.locator(`p99-root .p99-menu [role=option]:has-text("${text}")`).click();
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
    assert.equal(await title(p), "Shop");
    assert.deepEqual(await R(p, () => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col"), (c) => c.dataset.label)), ["Inbox", "Doing", "QA ready", "Done"]);
    assert.equal(await column(p, "Testing"), null);
    ok("the board opens on my first board, its columns are its labels, and items labelled elsewhere stay off it");

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
    assert.deepEqual(lastMove(), { key: K("FEAT-9"), from: "Inbox", to: "Doing", board: back.board("1"), before: K("TASK-3") });
    const next = async () => { const d = await column(p, "Doing"); return d[d.indexOf(K("FEAT-9")) + 1]; };
    assert.equal(await next(), K("TASK-3"));
    await p.waitForTimeout(400);
    assert.equal(await next(), K("TASK-3"));
    const loaf = await R(p, () => self.__loaf);
    ok(`mouse drag sends {key, from, to, board, before}, and the live echo keeps FEAT-9 before TASK-3 (${loaf.length} long animation frames)`);

    await p.locator(card(K("BUG-9"))).focus();
    await p.keyboard.press("Space");
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Enter");
    await settle(p);
    assert.equal(lastMove().key, K("BUG-9"));
    assert.equal(lastMove().from, "QA ready");
    assert.equal(lastMove().to, "Done");
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
    assert.ok((await column(p, "QA ready")).includes(K("Q-4")));
    assert.equal(seen.slice(before).filter((c) => c.path === "/move").length, 0);
    assert.equal(await hidden(p), false);
    ok("keyboard: Escape puts Q-4 back with no move sent, and the board stays open");

    await p.route("**/_p99/api/move", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the database is busy" }) }), { times: 1 });
    await drag(p, K("IMP-6"), K("Q-4"));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await shown(p, ".p99-board-note");
    await settle(p);
    assert.ok((await column(p, "Inbox")).includes(K("IMP-6")));
    ok("a failed move animates IMP-6 back to Inbox and says so");

    await back.other({ key: "BUG-14", from: "Inbox", to: "QA ready", board: "3" });
    await shown(p, inCol("QA ready", K("BUG-14")));
    const live = await R(p, (id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${id}"]`).getAnimations().map((a) => a.effect.getTiming().easing), K("BUG-14"));
    await settle(p);
    assert.ok(live.length && live.every((x) => x.startsWith("cubic-bezier")), `live move eases: ${live}`);
    ok("live: Grace's handoff to QA ready slides BUG-14 onto my board, eased");

    const loads = () => seen.filter((c) => c.method === "GET" && c.path.startsWith("/boards/")).length;
    const was = loads();
    await p.route("**/_p99/api/move", async (r) => {
      await back.other({ key: "BUG-11", from: "Doing", to: "QA ready", board: "3" });
      return r.continue();
    }, { times: 1 });
    await drag(p, K("BUG-11"), K("BUG-7"));
    await p.waitForTimeout(260);
    await p.mouse.up();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-note")?.textContent === "this card moved; refreshed");
    await p.waitForFunction((id) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-label="QA ready"] .p99-card[data-id="${id}"]`), K("BUG-11"));
    await settle(p);
    assert.ok(loads() > was);
    assert.equal(lastMove().from, "Doing");
    ok("a stale drag (Grace moved BUG-11 first) gets the 409 line, the board reloads, and BUG-11 sits where she put it");

    await back.other({ key: "Q-4", from: "QA ready", to: "Testing", board: "3" });
    await p.waitForFunction((id) => !document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${id}"]`), K("Q-4"));
    ok("live: a label my board doesn't have takes Q-4 off it");

    await back.other({ key: "FEAT-9", from: "Doing", to: "Doing", board: "1", after: "TASK-3" }, ADA);
    await p.waitForTimeout(500);
    await settle(p);
    const doing = await column(p, "Doing");
    assert.equal(doing.at(-1), K("FEAT-9"));
    ok("live: an order event from my other tab slides FEAT-9 to the end of Doing");

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
    assert.deepEqual(lastMove(), { key: K("TASK-3"), from: "Doing", to: "Done", board: back.board("1"), before: done[1] });
    assert.deepEqual(await column(p, "Done"), [done[0], K("TASK-3"), ...done.slice(1)]);
    ok("a drag that sweeps the bottom edge of a short column, then moves up, drops where the pointer is");

    const qa = await column(p, "QA ready");
    const sent1 = moves().length;
    await drag(p, K("FEAT-9"), K("IMP-6"));
    await back.other({ key: qa[0], from: "QA ready", to: "Done", board: "3" });
    await p.waitForTimeout(500);
    const held = (await column(p, "QA ready")).includes(qa[0]);
    await p.mouse.up();
    await settle(p);
    await shown(p, inCol("Done", qa[0]));
    await p.waitForTimeout(500);
    await settle(p);
    const twice = await R(p, (ids) => ids.map((id) => document.querySelector("p99-root").shadowRoot.querySelectorAll(`.p99-card[data-id="${id}"]`).length), [qa[0], K("FEAT-9")]);
    assert.equal(held, true);
    assert.deepEqual(twice, [1, 1]);
    assert.equal(moves().length, sent1 + 1);
    assert.deepEqual(lastMove(), { key: K("FEAT-9"), from: "Doing", to: "Inbox", board: back.board("1"), before: K("IMP-6") });
    assert.deepEqual(await column(p, "Inbox"), [K("FEAT-9"), K("IMP-6")]);
    ok("live: Grace's move during my mouse drag waits for the drop, then applies once, with one move sent");

    await pick(p, "@" + GRACE.username);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector("#p99-board-title").textContent === "QA");
    await settle(p);
    const watch = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { line: r.querySelector(".p99-watch").textContent, mine: r.querySelector(".p99-board").dataset.mine, help: r.querySelectorAll(".p99-card[aria-describedby]").length }; });
    assert.deepEqual(watch, { line: "watching @" + GRACE.username, mine: "false", help: 0 });
    const sent = moves().length;
    await drag(p, K("BUG-11"), K("BUG-12"));
    await p.waitForTimeout(200);
    const ghost = await R(p, () => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-ghost"));
    await p.mouse.up();
    await shutPanel(p);
    await p.locator(card(K("BUG-12"))).focus();
    await p.keyboard.press("Space");
    const lifted = await R(p, () => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-card.is-lifted"));
    await shutPanel(p);
    assert.equal(moves().length, sent);
    assert.equal(ghost || lifted, false);
    ok("the picker lists Grace's board by @username; on it I watch read-only: no drag, no lift, no move sent");

    await pick(p, "Launch", true);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector("#p99-board-title").textContent === "Launch");
    assert.equal(await R(p, () => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col").length), 3);
    await pick(p, "Shop");
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector("#p99-board-title").textContent === "Shop");
    ok("the picker switches between my boards (3 and 4 columns)");

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
    await drag(quiet.p, K("IMP-6"), K("FEAT-5"));
    const running = await R(quiet.p, () => document.querySelector("p99-root").shadowRoot.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).map((a) => `${a.animationName || a.transitionProperty || a.id} on ${a.effect.target?.className}`));
    await quiet.p.mouse.up();
    assert.deepEqual(running, []);
    ok("with reduced motion nothing animates");

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

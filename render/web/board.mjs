import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const web = join(repo, "worker", "src", "web");
const out = resolve(repo, process.env.P99_RENDERS || "tmp/renders");
const PORT = Number(process.env.P99_BOARD_PORT || 8823);
const HOST = "shop.example.com";
const ORIGIN = `http://${HOST}`;
const CODE = "boarddraft01";
const VIEW = { width: 1440, height: 900 };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const ADA = { name: "Ada Lovelace", email: "ada@example.com" };
const GRACE = { name: "Grace Hopper", email: "grace@example.com" };
const LIN = { name: "Lin Okafor", email: "lin@example.com" };

const statuses = [
  { key: "inbox", name: "Inbox", position: 0 },
  { key: "doing", name: "Doing", position: 1 },
  { key: "review", name: "Review", position: 2 },
  { key: "done", name: "Done", position: 3 },
];
const label = { checkout: { name: "checkout", color: "#3b7dd8" }, mobile: { name: "mobile", color: "#8a5300" }, copy: { name: "copy", color: "#1f6b35" }, perf: { name: "perf", color: "#8f1d12" } };
const boards = [
  { slug: "shop-example-com", name: "shop.example.com", host: HOST, parent: null, status: "inbox", position: 0 },
  { slug: "checkout-v2", name: "Checkout v2", host: HOST, parent: "shop-example-com", status: "doing", position: 1024 },
  { slug: "spring-catalogue", name: "Spring catalogue", host: HOST, parent: "shop-example-com", status: "inbox", position: 3072 },
];
const items = [
  ["BUG-14", "bug", "The cart total doesn't update after removing a bag", "inbox", 1024, GRACE, "urgent", [label.checkout], "shop-example-com"],
  ["FEAT-9", "feature", "Let returning customers reorder from a receipt", "inbox", 2048, null, "normal", [], "shop-example-com"],
  ["IMP-6", "improvement", "The grind size chart is hard to read on a phone", "inbox", 4096, null, "low", [label.mobile], "shop-example-com"],
  ["BUG-11", "bug", "Gift card field accepts letters and then rejects the order", "doing", 2048, ADA, "high", [label.checkout], "shop-example-com"],
  ["TASK-3", "task", "Swap the hero photo for the autumn roast", "doing", 4096, LIN, null, [label.copy], "shop-example-com"],
  ["BUG-9", "bug", "Product images jump while the page loads", "review", 1024, ADA, "normal", [label.perf, label.mobile], "shop-example-com"],
  ["Q-4", "question", "Can we ship to the Canary Islands?", "review", 2048, GRACE, null, [], "shop-example-com"],
  ["BUG-7", "bug", "Order confirmation mail shows the wrong delivery date", "done", 1024, ADA, "high", [], "shop-example-com", "fixed"],
  ["FEAT-5", "feature", "Show the roast date on every bag", "done", 2048, LIN, null, [label.copy], "shop-example-com", "fixed"],
  ["BUG-5", "bug", "Footer link to the returns policy is a 404", "done", 3072, null, null, [], "shop-example-com", "duplicate"],
  ["BUG-12", "bug", "Apple Pay sheet closes on the second tap", "doing", 1024, ADA, "urgent", [label.checkout, label.mobile], "checkout-v2"],
  ["FEAT-8", "feature", "Save the address for next time", "inbox", 1024, null, null, [label.checkout], "checkout-v2"],
  ["IMP-5", "improvement", "One-page checkout", "inbox", 2048, null, null, [label.checkout], "checkout-v2"],
  ["TASK-2", "task", "Move the coupon field under the total", "review", 1024, GRACE, null, [], "checkout-v2"],
  ["BUG-8", "bug", "Shipping estimate missing for PO boxes", "done", 1024, ADA, null, [], "checkout-v2", "fixed"],
  ["BUG-6", "bug", "Card errors read as a page crash", "done", 2048, ADA, "high", [], "checkout-v2", "fixed"],
  ["IMP-4", "improvement", "Bigger tap targets on the payment step", "done", 3072, LIN, null, [label.mobile], "checkout-v2", "fixed"],
  ["FEAT-10", "feature", "Spring blends landing page", "doing", 1024, LIN, null, [label.copy], "spring-catalogue"],
  ["TASK-4", "task", "Photograph the four spring bags", "inbox", 1024, null, null, [], "spring-catalogue"],
  ["TASK-5", "task", "Tasting notes for each blend", "inbox", 2048, null, null, [label.copy], "spring-catalogue"],
  ["TASK-6", "task", "Price list for wholesale", "inbox", 3072, null, null, [], "spring-catalogue"],
  ["TASK-1", "task", "Pick the spring blends", "done", 1024, GRACE, null, [], "spring-catalogue", "fixed"],
].map(([key, kind, title, status, position, assignee, priority, labels, board, resolution]) => ({ key, kind, title, status, position, assignee, priority, labels, board, resolution: resolution || null, reporter: GRACE }));

function subtree(slug) {
  const out = [slug];
  for (let i = 0; i < out.length; i++) for (const b of boards) if (b.parent === out[i]) out.push(b.slug);
  return out;
}
function rollup(slug) {
  const set = new Set(subtree(slug));
  const mine = items.filter((i) => set.has(i.board));
  return { done: mine.filter((i) => i.status === "done").length, total: mine.length };
}
const order = (a, b) => statuses.findIndex((s) => s.key === a.status) - statuses.findIndex((s) => s.key === b.status) || a.position - b.position;
const summary = (b) => ({ ...b, rollup: rollup(b.slug) });
function boardView(slug) {
  const b = boards.find((x) => x.slug === slug);
  if (!b) return null;
  const cards = [
    ...items.filter((i) => i.board === slug).map((i) => ({ type: "item", key: i.key, kind: i.kind, title: i.title, status: i.status, resolution: i.resolution, position: i.position, assignee: i.assignee, reporter: { name: i.reporter.name, agent: false }, priority: i.priority, labels: i.labels })),
    ...boards.filter((x) => x.parent === slug).map((x) => ({ type: "board", slug: x.slug, name: x.name, status: x.status, position: x.position, rollup: rollup(x.slug) })),
  ].sort(order);
  return { statuses, board: summary(b), cards };
}

const sockets = new Set();
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}
export function publish(ev) {
  for (const s of sockets) s.write(frame(JSON.stringify(ev)));
}

function place(list, target, before, after) {
  const peers = list.filter((x) => x !== target).sort((a, b) => a.position - b.position);
  const at = before ? peers.findIndex((x) => x.id === before) : after ? peers.findIndex((x) => x.id === after) + 1 : 0;
  const lo = at > 0 ? peers[at - 1].position : at === 0 && peers.length ? peers[0].position - 1024 : 0;
  const hi = at >= 0 && at < peers.length ? peers[at].position : lo + 2048;
  return (lo + hi) / 2;
}
function move(body) {
  const id = body.target;
  const isBoard = id.startsWith("board:");
  const it = isBoard ? boards.find((b) => b.slug === id.slice(6)) : items.find((i) => i.key === id);
  if (!it) return [404, { message: "no such card" }];
  const from = it.status;
  const to = body.to || it.status;
  const home = isBoard ? it.parent : it.board;
  const peers = [...items.filter((i) => i.board === home && i.status === to).map((i) => ({ id: i.key, position: i.position, ref: i })), ...boards.filter((b) => b.parent === home && b.status === to).map((b) => ({ id: "board:" + b.slug, position: b.position, ref: b }))];
  const self = peers.find((p) => p.ref === it) || null;
  it.position = place(peers, self, body.before, body.after);
  it.status = to;
  const changed = [];
  if (isBoard) {
    publish({ type: "board.move", board: it.slug, parent: it.parent, from, to, position: it.position });
    const set = new Set(subtree(it.slug));
    for (const i of items) if (set.has(i.board) && i.status !== to) { const f = i.status; i.status = to; if (to === "done" && !i.resolution) i.resolution = "fixed"; changed.push(i.key); publish({ type: "move", key: i.key, board: i.board, from: f, to, position: i.position }); }
  } else {
    if (to === "done" && !it.resolution) it.resolution = body.resolution || "fixed";
    if (to !== "done") it.resolution = null;
    changed.push(it.key);
    publish({ type: "move", key: it.key, board: it.board, from, to, position: it.position });
  }
  return [200, { moved: isBoard ? { type: "board", slug: it.slug, status: it.status, position: it.position } : { type: "item", key: it.key, status: it.status, position: it.position }, changed }];
}

function api(method, path, body) {
  if (path.startsWith("/me")) return [200, { name: ADA.name, email: ADA.email, manager: true, host: HOST, env: "production", version: "draft", counts: { mine_open: 0, mine_unread: 0, page_open: 2 }, theme: { accent: "#b5621e" }, strings: {} }];
  if (method === "GET" && path === "/boards") return [200, { statuses, boards: boards.map(summary) }];
  if (method === "GET" && path.startsWith("/boards/")) {
    const v = boardView(decodeURIComponent(path.slice(8)));
    return v ? [200, v] : [404, { message: "no such board" }];
  }
  if (method === "POST" && path === "/move") return move(JSON.parse(body || "{}"));
  if (method === "POST" && path === "/stream-ticket") return [200, { ticket: "draft-ticket" }];
  if (method === "GET" && path.startsWith("/issues")) return [200, { issues: [], next_cursor: null }];
  return [404, { message: "no such route" }];
}

function serveFile(res, path) {
  let full = null;
  let text = null;
  if (path === "/" || path === "/checkout") full = join(here, "site", "checkout.html");
  else if (path.startsWith("/_p99/")) full = join(web, path.slice(6) === "p99.js" ? "p99.js" : path.slice(6));
  if (!full || !full.startsWith(here) && !full.startsWith(web) || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  text = readFileSync(full, "utf8").split("__P99_VERSION__").join("draft");
  if (path === "/_p99/p99.js") text = text.split("__P99_HOST__").join(JSON.stringify({ t: "#b5621e" }));
  res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(text);
}

export function serve(port = PORT) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/_p99/api/")) return serveFile(res, url.pathname);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const [status, data] = req.headers["x-p99-code"] === CODE ? api(req.method, url.pathname.slice(9) + url.search.replace(/^\?.*/, ""), body) : [401, { message: "unknown code" }];
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
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

async function draft() {
  mkdirSync(out, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
  try {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: process.env.P99_SCHEME || "light" });
    await ctx.addInitScript(openShadow);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("page:", e.message));
    await p.goto(`${ORIGIN}/checkout#p99=${CODE}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w button:not(.f)") && !document.querySelector("p99-root").shadowRoot.querySelector(".w button:not(.f)").hidden);
    await p.locator("p99-root .w button:not(.f)").click();
    await p.locator("p99-root .p99-board-open").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-card").length > 5);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live");
    await p.waitForTimeout(500);
    const box = await p.locator('p99-root .p99-card[data-id="FEAT-9"]').boundingBox();
    const dest = await p.locator('p99-root .p99-card[data-id="TASK-3"]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 20);
    await p.mouse.down();
    const tx = dest.x + dest.width / 2 - 26, ty = dest.y + 6;
    for (let i = 1; i <= 12; i++) {
      await p.mouse.move(box.x + box.width / 2 + ((tx - box.x - box.width / 2) * i) / 12, box.y + 20 + ((ty - box.y - 20) * i) / 12);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(450);
    const file = join(out, `board-draft-${process.env.P99_SCHEME || "light"}.png`);
    await p.screenshot({ path: file });
    console.log(file);
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await draft();

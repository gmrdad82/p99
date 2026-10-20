import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const work = join(root, ".wrangler");
const state = join(work, "test-state");
const port = Number(process.env.P99_TEST_PORT || 8791);
const base = `http://127.0.0.1:${port}`;
const keys = {
  test: "test-secret",
  p99: randomBytes(24).toString("hex"),
};

const VECTOR = {
  actorJson: '{"email":"ada@example.com","name":"Ada Lovelace"}',
  actor: "eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UifQ",
  body: '{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}',
  path: "/_p99/v1/issues?host=example.com",
  hash: "ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf",
  auth: "v1 ts=1760400000,sig=89b1d507574a2e8bb9c58d3ba92a29eab0f03baad0e422c4882f17c8ba33505a",
};

const SEED_SQL = `
INSERT INTO usage (actor_email, day, issues, comments, bytes) VALUES ('grace@example.com', date('now'), 30, 200, 0);
`;

const LEGACY_ROWS = [
  [901, "new"],
  [902, "confirmed"],
  [903, "in_progress"],
  [904, "waiting"],
  [905, "resolved"],
  [906, "abandoned"],
  [907, "duplicate"],
];

const LEGACY_SQL = [
  ...LEGACY_ROWS.map(([id, status]) => {
    const open = ["new", "confirmed", "in_progress", "waiting"].includes(status);
    const at = "'2025-01-01T00:00:00.000Z'";
    return `INSERT INTO items (id, client_uid, kind, status, open, title, body, origin_env, host, page_url, page_path, page_title,
      reporter_email, reporter_name, reporter_json, duplicate_of, context_json, marks_json, search_text, activity_at,
      public_activity_at, created_at, updated_at, closed_at)
      VALUES (${id}, 'legacy-${id}', 'bug', '${status}', ${open ? 1 : 0}, 'Legacy ${status}', '', 'production', 'legacy.example',
      'https://legacy.example/', '/', '', 'old@example.com', 'Old', '{}', ${status === "duplicate" ? 905 : "NULL"}, '{}', '[]',
      'legacy ${status}', ${at}, ${at}, ${at}, ${at}, ${open ? "NULL" : at});`;
  }),
  `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env, created_at)
   VALUES (902, 'legacy-comment-902', 'old@example.com', 'Old', 0, 'Still there.', 0, 'production', '2025-01-02T00:00:00.000Z');`,
  `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at)
   VALUES (905, NULL, 'status', '{"from":"confirmed","to":"resolved"}', 0, '2025-01-03T00:00:00.000Z');`,
].join("\n");

const PLACEMENT = { corner: "top-left", offset: { x: 24, y: 40 }, theme: { accent: "#3b7dd8" } };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const actorHeader = (actor) => Buffer.from(JSON.stringify(actor)).toString("base64url");
const grace = { email: "grace@example.com", name: "Grace Hopper", agent: true };

function sign({ secret, ts, method, path, actor, hash }) {
  const sig = createHmac("sha256", secret).update(`v1\n${ts}\n${method}\n${path}\n${actor}\n${hash}`).digest("hex");
  return `v1 ts=${ts},sig=${sig}`;
}

async function call(method, path, { actor = grace, body, raw, type, keyId = "p99", tamper } = {}) {
  const bytes = raw ?? (body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)));
  const hash = sha256(bytes);
  const actorText = actor ? actorHeader(actor) : "";
  const ts = Math.floor(Date.now() / 1000);
  let auth = sign({ secret: keys[keyId] || "unknown", ts, method, path, actor: actorText, hash });
  if (tamper === "sig") auth = auth.slice(0, -1) + (auth.endsWith("0") ? "1" : "0");
  const headers = { "x-p99-key-id": keyId, "x-p99-auth": auth, "x-content-sha256": hash };
  if (actorText) headers["x-p99-actor"] = actorText;
  if (bytes.length > 0) headers["content-type"] = type ?? "application/json";
  const response = await fetch(base + path, { method, headers, body: bytes.length > 0 ? bytes : undefined });
  return { status: response.status, json: await jsonOf(response), response };
}

function listen(path, heard) {
  const ts = Math.floor(Date.now() / 1000);
  const actor = actorHeader(grace);
  const hash = sha256(Buffer.alloc(0));
  const auth = sign({ secret: keys.p99, ts, method: "GET", path, actor, hash });
  const socket = new WebSocket(base.replace(/^http/, "ws") + path, {
    headers: { "x-p99-key-id": "p99", "x-p99-actor": actor, "x-content-sha256": hash, "x-p99-auth": auth },
  });
  socket.addEventListener("message", (message) => heard.push(JSON.parse(message.data)));
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => reject(new Error("the stream did not open")));
  });
}

function ticketSocket(ticket, heard = []) {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/_p99/api/stream?t=${ticket}`);
  socket.addEventListener("message", (message) => heard.push(JSON.parse(message.data)));
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => resolve(null));
  });
}

async function browse(method, path, code, body) {
  const headers = {};
  if (code !== undefined) headers["x-p99-code"] = code;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}/_p99/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await jsonOf(response), response };
}

async function jsonOf(response) {
  return response.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(await response.text()) : null;
}

function issueBody(overrides = {}) {
  return {
    client_uid: randomUUID(),
    kind: "bug",
    title: "The total does not update",
    body: "Open an order and change its quantity.",
    page: { url: "https://example.com/orders?token=secret#top", path: "/orders", title: "Orders" },
    context: { viewport: { w: 1280, h: 800 } },
    marks: [],
    ...overrides,
  };
}

async function mint(name, email, hosts, manager = false) {
  const minted = await call("POST", "/_p99/v1/codes", { body: { name, email, hosts, manager } });
  assert.equal(minted.status, 201, JSON.stringify(minted.json));
  return minted.json;
}

const hookHits = [];
let hookAnswer = 500;

function hookStub() {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      hookHits.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") });
      response.writeHead(hookAnswer).end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function wranglerSync(args) {
  const result = spawnSync(wrangler, args, { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

async function waitForHealth(child) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error("wrangler dev exited; see .wrangler/test-dev.log");
    try {
      const response = await fetch(`${base}/_p99/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("wrangler dev did not answer /_p99/health in 60 s");
}

async function main() {
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  const migrations = join(root, "migrations");
  const before = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql") && f < "0004")
    .sort();
  const legacy = join(work, "test-legacy.sql");
  writeFileSync(
    legacy,
    [
      ...before.map((f) => readFileSync(join(migrations, f), "utf8")),
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);",
      ...before.map((f) => `INSERT INTO d1_migrations (name) VALUES ('${f}');`),
      LEGACY_SQL,
    ].join("\n"),
  );
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", legacy]);
  wranglerSync(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  const seed = join(work, "test-seed.sql");
  writeFileSync(seed, SEED_SQL);
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", seed]);
  const log = openSync(join(work, "test-dev.log"), "w");
  const vars = Object.entries(keys).map(([id, secret]) => `KEY_${id.toUpperCase()}:${secret}`);
  vars.push("CODE_PEPPER:test-pepper", "TICKET_TTL_MS:1500");
  const stub = await hookStub();
  vars.push(`HOOKS_TEST_ORIGIN:http://127.0.0.1:${stub.address().port}`);
  for (const host of ["127.0.0.1", "localhost"]) {
    vars.push(`GITHUB_HOOK_${sha256(Buffer.from(host)).slice(0, 16).toUpperCase()}:github-hook-secret`);
  }
  const child = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
      "--var",
      ...vars,
    ],
    { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", log, log], detached: true },
  );
  const stop = () => {
    stub.close();
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  process.on("exit", stop);
  try {
    await waitForHealth(child);
    await run();
  } finally {
    stop();
  }
}

async function run() {
  await check("the contract's signing vector reproduces", () => {
    assert.equal(Buffer.from(VECTOR.actorJson).toString("base64url"), VECTOR.actor);
    assert.equal(sha256(Buffer.from(VECTOR.body)), VECTOR.hash);
    const auth = sign({ secret: "test-secret", ts: 1760400000, method: "POST", path: VECTOR.path, actor: VECTOR.actor, hash: VECTOR.hash });
    assert.equal(auth, VECTOR.auth);
  });

  await check("the vendored capture library is the one NOTICE records", () => {
    const notice = readFileSync(join(root, "..", "NOTICE"), "utf8");
    const recorded = /sha256 ([0-9a-f]{64})\./.exec(notice);
    assert.ok(recorded, "NOTICE records no sha256");
    assert.equal(sha256(readFileSync(join(root, "src", "web", "vendor", "modern-screenshot-4.7.0.js"))), recorded[1]);
  });

  await check("a stale, a bad or an unknown signature is refused", async () => {
    const stale = await fetch(base + VECTOR.path, {
      method: "POST",
      headers: {
        "x-p99-key-id": "test",
        "x-p99-actor": VECTOR.actor,
        "x-content-sha256": VECTOR.hash,
        "x-p99-auth": VECTOR.auth,
        "content-type": "application/json",
      },
      body: VECTOR.body,
    });
    assert.equal(stale.status, 401);
    assert.equal((await stale.json()).error, "unauthorized");
    assert.equal((await call("GET", "/_p99/v1/hosts", { tamper: "sig" })).status, 401);
    assert.equal((await call("GET", "/_p99/v1/hosts", { keyId: "nokey" })).status, 401);
    const ts = Math.floor(Date.now() / 1000);
    const actor = actorHeader(grace);
    const empty = sha256(Buffer.alloc(0));
    const crossed = await fetch(`${base}/_p99/v1/hosts`, {
      headers: {
        "x-p99-key-id": "p99",
        "x-p99-actor": actor,
        "x-content-sha256": empty,
        "x-p99-auth": sign({ secret: keys.test, ts, method: "GET", path: "/_p99/v1/hosts", actor, hash: empty }),
      },
    });
    assert.equal(crossed.status, 401);
  });

  await check("an unknown host is refused before it is listed", async () => {
    assert.equal((await fetch(`${base}/_p99/p99.js`)).status, 404);
    assert.equal((await browse("GET", "/me", "0123-4567-89ab")).status, 404);
    const health = await fetch(`${base}/_p99/health`);
    assert.deepEqual(await health.json(), { ok: true, version: "dev" });
  });

  assert.equal((await call("PUT", "/_p99/v1/envs/dev", { body: { kind: "development", position: 0 } })).status, 200);
  assert.equal((await call("PUT", "/_p99/v1/envs/production", { body: { kind: "release", position: 1, notify: true } })).status, 200);
  const putLocal = await call("PUT", "/_p99/v1/hosts/127.0.0.1", { body: { env: "production", config: PLACEMENT } });
  assert.equal(putLocal.status, 200, JSON.stringify(putLocal.json));
  assert.equal((await call("PUT", "/_p99/v1/hosts/localhost", { body: { env: "dev", config: PLACEMENT } })).status, 200);

  const both = await mint("Ada Lovelace", "ada@example.com", ["127.0.0.1", "localhost"]);
  const me = await browse("GET", "/me?path=%2Forders", both.secret);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const here = me.json.host;
  const there = here === "127.0.0.1" ? "localhost" : "127.0.0.1";
  const adaHere = await mint("Ada Lovelace", "ada@example.com", [here]);
  const adaThere = await mint("Ada Lovelace", "ada@example.com", [there]);
  const graceHere = await mint("Grace Hopper", "grace@example.com", [here]);

  await check("a code works only on its hosts, and a revoked code is refused", async () => {
    const spaced = adaHere.secret.toUpperCase().replace(/(.{4})(?!$)/g, "$1-");
    assert.equal((await browse("GET", "/me", spaced)).status, 200);
    assert.equal((await browse("GET", "/me", adaThere.secret)).status, 401);
    assert.equal((await browse("GET", "/me", "zzzzzzzzzzzz")).status, 401);
    assert.equal((await browse("GET", "/me")).status, 401);
    const doomed = await mint("Ada Lovelace", "ada@example.com", [here]);
    assert.equal((await browse("GET", "/me", doomed.secret)).status, 200);
    const revoked = await call("POST", `/_p99/v1/codes/${doomed.code.id}/revoke`);
    assert.equal(revoked.status, 200);
    assert.ok(revoked.json.revoked_at);
    assert.equal((await browse("GET", "/me", doomed.secret)).status, 401);
  });

  const heard = [];
  const stream = await listen(`/_p99/v1/stream?host=${here}`, heard);
  const filed = await browse("POST", "/issues", adaHere.secret, issueBody());
  const key = filed.json && filed.json.key;

  await check("a signed client on the stream hears an item filed through the browser", async () => {
    for (let i = 0; i < 50 && !heard.some((e) => e.key === key); i++) await new Promise((r) => setTimeout(r, 100));
    stream.close();
    const event = heard.find((e) => e.key === key);
    assert.ok(event, JSON.stringify(heard));
    assert.equal(event.type, "item");
    assert.equal(event.host, here);
    assert.equal(event.by.name, "Ada Lovelace");
  });

  await check("a reporter cannot read another's item, and the page address loses its query", async () => {
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.equal(filed.json.page.url, `https://${here}/orders`);
    assert.equal(filed.json.host, here);
    assert.equal((await browse("GET", `/issues/${key}`, adaHere.secret)).status, 200);
    assert.equal((await browse("GET", `/issues/${key}`, graceHere.secret)).status, 404);
    assert.equal((await browse("GET", "/issues?scope=all", graceHere.secret)).status, 403);
    const mine = await browse("GET", "/issues?scope=mine", graceHere.secret);
    assert.equal(mine.json.issues.some((i) => i.key === key), false);
    assert.equal((await browse("GET", `/issues/${key}`, adaThere.secret)).status, 401);
  });

  await check("an item filed through the browser reads the same through the signed API", async () => {
    const signed = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(signed.json.issue.key, key);
    const comment = await call("POST", `/_p99/v1/issues/${key}/comments?host=${here}`, {
      body: { client_uid: randomUUID(), body: "Confirmed on the orders page." },
    });
    assert.equal(comment.status, 201);
    assert.equal(comment.json.author.agent, true);
    const hung = await fetch(`${base}/_p99/api/issues/${key}/attachments/${randomUUID()}?comment=${comment.json.id}&name=note.txt`, {
      method: "PUT",
      headers: { "x-p99-code": adaHere.secret, "content-type": "text/plain" },
      body: "not the manager's file",
    });
    assert.equal(hung.status, 404);
  });

  await check("a reporter sees no internal comment, file or manager's e-mail, and cannot manage", async () => {
    const internal = await call("POST", `/_p99/v1/issues/${key}/comments?host=${here}`, {
      body: { client_uid: randomUUID(), body: "Internal: check the cart service.", internal: true },
    });
    assert.equal(internal.status, 201, JSON.stringify(internal.json));
    const stored = await call(
      "PUT",
      `/_p99/v1/issues/${key}/attachments/${randomUUID()}?host=${here}&comment=${internal.json.id}&name=trace.txt`,
      { raw: Buffer.from("cart: 500\n"), type: "text/plain" },
    );
    assert.equal(stored.status, 201, JSON.stringify(stored.json));
    const seen = await browse("GET", `/issues/${key}`, adaHere.secret);
    assert.equal(seen.status, 200);
    assert.equal(seen.json.comments.some((cm) => cm.internal || cm.id === internal.json.id), false);
    assert.equal(seen.json.attachments.some((a) => a.id === stored.json.id), false);
    assert.ok(seen.json.comments.length > 0);
    assert.equal(seen.json.comments.some((cm) => cm.author.email === grace.email), false);
    assert.ok(seen.json.events.some((ev) => ev.actor === null && ev.actor_name === grace.name), JSON.stringify(seen.json.events));
    assert.equal((await browse("GET", `/files/${stored.json.id}`, adaHere.secret)).status, 404);
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { kind: "task" })).status, 403);
    const file = await call("GET", `/_p99/v1/files/${stored.json.id}?host=${here}`);
    assert.equal(file.status, 200);
    assert.match(file.response.headers.get("content-disposition"), /^attachment;/);
    assert.equal(file.response.headers.get("x-content-type-options"), "nosniff");
    assert.match(file.response.headers.get("content-security-policy"), /sandbox/);
    const forged = await fetch(`${base}/_p99/api/issues/${key}/attachments/${randomUUID()}?role=screenshot&name=shot.png`, {
      method: "PUT",
      headers: { "x-p99-code": adaHere.secret, "content-type": "image/png" },
      body: "<html><script>alert(1)</script></html>",
    });
    assert.equal(forged.status, 400);
  });

  await check("only managers set and see priority and labels, and the filters return the right rows", async () => {
    const issue = (k, extra = "") => call("GET", `/_p99/v1/issues/${k}?host=${here}${extra}`);
    const set = (k, body) => call("PATCH", `/_p99/v1/issues/${k}?host=${here}`, { body });
    const file = async (title) => (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title }) })).json.key;
    const [one, two] = [await file("Labelled one"), await file("Labelled two")];
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { priority: "urgent" })).status, 403);
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { labels: ["ui"] })).status, 403);
    const tagged = await set(key, { priority: "urgent", labels: { add: ["Checkout", "ui"] } });
    assert.equal(tagged.status, 200, JSON.stringify(tagged.json));
    assert.equal(tagged.json.priority, "urgent");
    assert.deepEqual(tagged.json.labels.map((t) => t.name), ["Checkout", "ui"]);
    assert.match(tagged.json.labels[0].color, /^#[0-9a-f]{6}$/);
    assert.equal((await set(one, { priority: "high", labels: { add: ["UI"] } })).json.labels[0].name, "ui");
    assert.equal((await set(two, { priority: "bogus" })).status, 400);
    const seen = await browse("GET", `/issues/${key}`, adaHere.secret);
    assert.equal(seen.json.issue.priority, null);
    assert.deepEqual(seen.json.issue.labels, []);
    assert.equal(seen.json.events.some((ev) => ev.kind === "priority" || ev.kind === "labels"), false);
    const mine = await browse("GET", "/issues?scope=mine", adaHere.secret);
    assert.ok(mine.json.issues.every((i) => i.priority === null && i.labels.length === 0));
    assert.equal((await browse("GET", "/issues?scope=mine&label=ui", adaHere.secret)).status, 403);
    assert.equal((await browse("GET", "/issues?scope=mine&priority=urgent", adaHere.secret)).status, 403);
    assert.equal((await browse("GET", "/labels", adaHere.secret)).status, 403);
    const keys = async (q) =>
      (await call("GET", `/_p99/v1/issues?scope=all&host=*&${q}`)).json.issues.map((i) => i.key).filter((k) => [key, one, two].includes(k)).sort();
    assert.deepEqual(await keys("label=UI"), [key, one].sort());
    assert.deepEqual(await keys("label=ui&label=checkout"), [key]);
    assert.deepEqual(await keys("priority=urgent&priority=high"), [key, one].sort());
    assert.deepEqual(await keys("priority=none"), [two]);
    assert.equal((await call("GET", `/_p99/v1/issues?scope=all&priority=soon`)).status, 400);
    assert.equal((await call("POST", "/_p99/v1/labels", { body: { name: "CHECKOUT" } })).status, 409);
    assert.equal((await call("POST", "/_p99/v1/labels", { body: { name: "copy", color: "red" } })).status, 400);
    assert.equal((await call("POST", "/_p99/v1/labels", { body: { name: "copy", color: "#57AB5A" } })).json.color, "#57ab5a");
    const renamed = await call("PATCH", "/_p99/v1/labels/ui", { body: { name: "web ui" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.equal(renamed.json.items, 2);
    assert.deepEqual((await issue(one)).json.issue.labels.map((t) => t.name), ["web ui"]);
    assert.equal((await call("PATCH", `/_p99/v1/labels/copy?host=${here}`, { body: { name: "words" } })).status, 403);
    const listed = await call("GET", "/_p99/v1/labels");
    assert.deepEqual(listed.json.labels.map((l) => [l.name, l.items]), [["Checkout", 1], ["copy", 0], ["web ui", 2]]);
    const gone = await call("DELETE", `/_p99/v1/labels/${encodeURIComponent("web ui")}`);
    assert.deepEqual(gone.json, { name: "web ui", items: 2 });
    assert.deepEqual((await issue(key)).json.issue.labels.map((t) => t.name), ["Checkout"]);
    const board = await call("GET", `/_p99/v1/boards/${here.replace(/\./g, "-")}?host=${here}`);
    assert.equal(board.status, 200, JSON.stringify(board.json));
    const card = board.json.cards.find((cd) => cd.key === key);
    assert.equal(card.priority, "urgent");
    assert.deepEqual(card.labels.map((t) => t.name), ["Checkout"]);
    const cleared = await set(key, { priority: null, labels: [] });
    assert.equal(cleared.json.priority, null);
    assert.deepEqual(cleared.json.labels, []);
  });

  await check("a page path that leaves the host is refused", async () => {
    const page = { url: "https://example.com/x", path: "/\\evil.example/x", title: "Orders" };
    assert.equal((await browse("POST", "/issues", adaHere.secret, issueBody({ page }))).status, 400);
  });

  await check("a manager over the daily limits still files, and others are stopped", async () => {
    const managed = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "The crème brûlée costs too much" }) });
    assert.equal(managed.status, 201, JSON.stringify(managed.json));
    assert.equal((await browse("POST", "/issues", graceHere.secret, issueBody())).status, 429);
  });

  await check("search ignores diacritics and case", async () => {
    const keys = async (q) =>
      (await call("GET", `/_p99/v1/issues?scope=all&host=*&q=${encodeURIComponent(q)}`)).json.issues.map((i) => i.key);
    const found = await keys("CREME brulee");
    assert.equal(found.length, 1);
    assert.deepEqual(await keys("Crème Brûlée"), found);
  });

  await check("an import keeps its keys, skips what it already holds, and new items number above it", async () => {
    const records = [
      {
        type: "item",
        key: "BUG-7",
        kind: "bug",
        title: "The café menu shows the wrong price",
        body: "The crème brûlée costs 12,50 € on the menu and 13 € at checkout.",
        status: "confirmed",
        duplicate_of: null,
        reporter: { email: "ada@example.com", name: "Ada Lovelace", agent: false },
        assignee: null,
        env: null,
        page: { url: "https://example.com/menu", path: "/menu", title: "Menu" },
        context: {},
        marks: [],
        created_at: "2025-03-01T10:00:00Z",
        updated_at: "2025-03-02T10:00:00Z",
        closed_at: null,
      },
      {
        type: "comment",
        item: "BUG-7",
        uid: "legacy-comment-1",
        author: { email: "grace@example.com", name: "Grace Hopper", agent: false, manager: true },
        body: "Confirmed: the café price is off.",
        internal: false,
        created_at: "2025-03-02T09:00:00Z",
      },
      { type: "landing", item: "BUG-7", env: "production", sha: "0123456789abcdef", at: "2025-03-03T10:00:00Z" },
      { type: "read", item: "BUG-7", email: "ada@example.com", at: "2025-03-02T10:00:00Z" },
      { type: "manager", email: "grace@example.com" },
    ];
    const attachment = { type: "attachment", item: "BUG-7", uid: "legacy-file-1", comment: "legacy-comment-1" };
    const dry = await call("POST", `/_p99/v1/import?host=${here}&dry_run=1`, { body: records });
    assert.equal(dry.status, 200, JSON.stringify(dry.json));
    assert.equal(dry.json.counts.item.new, 1);
    assert.equal((await call("GET", `/_p99/v1/issues/BUG-7?host=${here}`)).status, 404);
    assert.equal((await call("POST", `/_p99/v1/import?host=${here}`, { body: records, keyId: "test" })).status, 403);

    const path = `/_p99/v1/import?host=${here}&dry_run=0`;
    const first = await call("POST", path, { body: records });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    for (const type of ["item", "comment", "landing", "read"]) assert.equal(first.json.counts[type].new, 1, type);
    assert.deepEqual(first.json.managers, ["grace@example.com"]);
    const file = Buffer.from("total: 12,50 €\n");
    const put = await call(
      "PUT",
      `/_p99/v1/import/attachments/legacy-file-1?host=${here}&item=BUG-7&comment=legacy-comment-1&role=file&name=${encodeURIComponent("café.txt")}&created_at=2025-03-02T09%3A00%3A00Z`,
      { raw: file, type: "text/plain" },
    );
    assert.equal(put.status, 201, JSON.stringify(put.json));

    const again = await call("POST", path, { body: [...records, attachment] });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    for (const type of ["item", "comment", "attachment", "landing", "read"]) {
      assert.deepEqual(again.json.counts[type], { new: 0, existing: 1, conflicts: [] }, type);
    }
    assert.deepEqual(again.json.upload, []);
    const renamed = await call("POST", path, { body: [{ ...records[0], title: "Another title" }] });
    assert.equal(renamed.json.counts.item.conflicts.length, 1);
    const finish = await call("POST", `/_p99/v1/import/finish?host=${here}`, { body: { items: ["BUG-7"], duplicates: [] } });
    assert.equal(finish.status, 200, JSON.stringify(finish.json));

    const thread = await call("GET", `/_p99/v1/issues/BUG-7?host=${here}`);
    assert.equal(thread.status, 200, JSON.stringify(thread.json));
    assert.equal(thread.json.issue.key, "BUG-7");
    assert.equal(thread.json.issue.title, "The café menu shows the wrong price");
    assert.equal(thread.json.issue.comments, 1);
    assert.equal(thread.json.issue.attachments, 1);
    assert.equal(thread.json.comments.length, 1);
    assert.equal(thread.json.attachments[0].name, "café.txt");
    assert.deepEqual(thread.json.comments[0].attachments, [thread.json.attachments[0].id]);
    assert.equal(thread.json.issue.landing.envs[0].env, "production");

    const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody() });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.ok(filed.json.id > 7, `the next item is ${filed.json.key}`);
  });

  await check("a chat hook takes only Slack and Discord webhooks, never answers its URL, and a failing one never fails a write", async () => {
    const tail = "aaaabbbbccccWXYZ";
    const slack = `https://hooks.slack.com/services/T0001/B0002/${tail}`;
    const refused = [
      "http://hooks.slack.com/services/T0001/B0002/abc",
      "https://hooks.slack.com.evil.example/services/T0001/B0002/abc",
      "https://evil.example/services/T0001/B0002/abc",
      "https://hooks.slack.com/services/T0001/B0002/abc?x=1",
      "https://hooks.slack.com:8443/services/T0001/B0002/abc",
      "https://user@hooks.slack.com/services/T0001/B0002/abc",
      "https://hooks.slack.com/workflows/T0001/abc",
      "https://discord.com/api/v10/users/@me",
      "https://cdn.discordapp.com/api/webhooks/1/abc",
      "https://127.0.0.1/api/webhooks/1/abc",
    ];
    for (const url of refused) assert.equal((await call("PUT", `/_p99/v1/hooks/${here}`, { body: { url } })).status, 400, url);
    const wrong = await call("PUT", `/_p99/v1/hooks/${here}`, { body: { service: "discord", url: slack } });
    assert.equal(wrong.status, 400);
    const set = await call("PUT", `/_p99/v1/hooks/${here}`, { body: { service: "slack", url: slack, events: ["status", "new"] } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.events, ["new", "status"]);
    assert.equal(set.json.hint, tail.slice(-4));
    const listed = await call("GET", "/_p99/v1/hooks");
    assert.equal(listed.json.hooks.length, 1);
    for (const answer of [set, listed]) assert.equal(JSON.stringify(answer.json).includes(tail), false);

    hookAnswer = 500;
    hookHits.length = 0;
    const filed = await browse("POST", "/issues", adaHere.secret, issueBody({ title: "The hook <!channel> sees @everyone" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    for (let i = 0; i < 50 && hookHits.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(hookHits.length, 1);
    const hit = hookHits[0];
    assert.equal(hit.path, `/slack/services/T0001/B0002/${tail}`);
    const said = JSON.stringify(hit.body);
    assert.ok(said.includes(filed.json.key));
    assert.ok(said.includes("Ada Lovelace"));
    assert.equal(said.includes("ada@example.com"), false);
    assert.equal(said.includes("<!channel>"), false);

    assert.equal((await call("PUT", "/_p99/v1/statuses/doing", { body: { name: "Building" } })).status, 200);
    hookHits.length = 0;
    const patched = await call("PATCH", `/_p99/v1/issues/${filed.json.key}?host=${here}`, { body: { status: "doing" } });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    for (let i = 0; i < 50 && hookHits.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(hookHits.length, 1);
    assert.equal(hookHits[0].body.blocks.filter((b) => b.type === "section").length, 1);
    assert.ok(JSON.stringify(hookHits[0].body).includes("Moved to Building"));
    assert.equal((await call("PUT", "/_p99/v1/statuses/doing", { body: { name: "Doing" } })).status, 200);

    const tested = await call("POST", `/_p99/v1/hooks/${here}/test`);
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual(tested.json.results.map((r) => [r.service, r.ok, r.status]), [["slack", false, "500"]]);
    const after = await call("GET", `/_p99/v1/hooks?host=${here}`);
    assert.equal(after.json.hooks[0].last_status, "500");
    assert.equal((await call("DELETE", `/_p99/v1/hooks/${here}?service=slack`)).status, 204);
    assert.equal((await call("DELETE", `/_p99/v1/hooks/${here}`)).status, 404);
  });

  const hookSecret = "github-hook-secret";
  const deliver = async (event, payload, { id = randomUUID(), secret = hookSecret, signature } = {}) => {
    const bytes = Buffer.from(JSON.stringify(payload));
    const headers = { "content-type": "application/json", "x-github-event": event, "x-github-delivery": id };
    const sig = signature ?? `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
    if (sig) headers["x-hub-signature-256"] = sig;
    const response = await fetch(`${base}/_p99/v1/github`, { method: "POST", headers, body: bytes });
    return { status: response.status, json: await jsonOf(response) };
  };
  const pullEvent = (number, action, merged, body) => ({
    action,
    repository: { full_name: "acme/shop" },
    pull_request: { number, merged, title: "Keep the totals in step", body, html_url: `https://github.com/acme/shop/pull/${number}` },
  });
  const fileHere = async (on = here) => (await call("POST", `/_p99/v1/issues?host=${on}`, { body: issueBody() })).json;
  const threadOf = async (item, on = here) => (await call("GET", `/_p99/v1/issues/${item.key}?host=${on}`)).json.issue;

  await check("a GitHub delivery with a bad or no signature is refused, and a replayed one does nothing", async () => {
    const linked = await call("PUT", `/_p99/v1/github/${here}`, { body: { repo: "acme/shop" } });
    assert.equal(linked.status, 200, JSON.stringify(linked.json));
    assert.equal(linked.json.secret, true);
    const first = await fileHere();
    const second = await fileHere();
    const fixes = pullEvent(41, "closed", true, `Fixes: ${first.key}`);
    assert.equal((await deliver("pull_request", fixes, { secret: "not-the-secret" })).status, 401);
    assert.equal((await deliver("pull_request", fixes, { signature: "" })).status, 401);
    assert.equal((await threadOf(first)).closed_at, null);
    const id = randomUUID();
    const once = await deliver("pull_request", pullEvent(42, "opened", false, `Refs: ${first.key}`), { id });
    assert.equal(once.status, 200, JSON.stringify(once.json));
    assert.deepEqual(once.json.linked, [first.key]);
    const again = await deliver("pull_request", pullEvent(42, "closed", true, `Fixes: ${second.key}`), { id });
    assert.equal(again.status, 204);
    const untouched = await threadOf(second);
    assert.equal(untouched.closed_at, null);
    assert.deepEqual(untouched.github, []);
    assert.equal((await deliver("ping", { zen: "Keep it logically awesome." })).status, 204);
  });

  await check("a merged pull request with Fixes marks only that item, and never an item of another host", async () => {
    const fixed = await fileHere();
    const referred = await fileHere();
    const bystander = await fileHere();
    const away = await fileHere(there);
    const body = `Totals refresh.\n\nFixes: ${fixed.key}, ${away.key}\nRefs: ${referred.key}`;
    const merged = await deliver("pull_request", pullEvent(43, "closed", true, body));
    assert.equal(merged.status, 200, JSON.stringify(merged.json));
    assert.deepEqual(merged.json.changed, [fixed.key]);
    const done = await threadOf(fixed);
    assert.ok(done.closed_at, JSON.stringify(done));
    assert.equal(done.status, "done");
    assert.equal(done.resolution, "fixed");
    assert.deepEqual(
      done.github.map((g) => [g.kind, g.rel, g.number]),
      [["pull", "fixes", 43]],
    );
    const refs = await threadOf(referred);
    assert.equal(refs.closed_at, null);
    assert.deepEqual(refs.github.map((g) => g.rel), ["refs"]);
    assert.equal((await threadOf(bystander)).closed_at, null);
    const other = await threadOf(away, there);
    assert.equal(other.closed_at, null);
    assert.deepEqual(other.github, []);
  });

  await check("the loader carries the host's placement and version", async () => {
    const response = await fetch(`${base}/_p99/p99.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control"), /max-age=300/);
    const served = await response.text();
    const source = readFileSync(join(root, "src", "web", "p99.js"), "utf8");
    assert.equal(served.includes("__P99_"), false);
    if (source.includes("__P99_HOST__")) {
      assert.ok(served.includes('"c":"top-left"'));
      assert.ok(served.includes('"t":"#3b7dd8"'));
    }
    assert.equal(served.length === 0, source.length === 0);
  });

  await check("a code with an authenticator opens nothing until a 6-digit code trusts the browser, and a used code is refused", async () => {
    const minted = await mint("Ada Lovelace", "ada@example.com", ["127.0.0.1", "localhost"]);
    const set = await call("POST", `/_p99/v1/codes/${minted.code.id}/totp`);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.code.totp, true);
    const blocked = await browse("GET", "/me", minted.secret);
    assert.equal(blocked.status, 428);
    assert.equal(blocked.json.error, "totp_required");
    const totp = (offset) => {
      const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = 0;
      let value = 0;
      const bytes = [];
      for (const ch of set.json.totp_key) {
        value = (value << 5) | abc.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
          bytes.push((value >>> (bits - 8)) & 255);
          bits -= 8;
        }
      }
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
      const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
      return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
    };
    const wrong = await browse("POST", "/verify", minted.secret, { totp: totp(5) });
    assert.equal(wrong.status, 400);
    const right = totp(0);
    const verified = await browse("POST", "/verify", minted.secret, { totp: right });
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    assert.match(verified.json.device, /^[0-9a-f]{32}$/);
    const replay = await browse("POST", "/verify", minted.secret, { totp: right });
    assert.equal(replay.status, 400);
    const trusted = await browse("GET", "/me", `${minted.secret}.${verified.json.device}`);
    assert.equal(trusted.status, 200, JSON.stringify(trusted.json));
    const stranger = await browse("GET", "/me", `${minted.secret}.${"0".repeat(32)}`);
    assert.equal(stranger.status, 428);
  });

  await check("0004 maps every old status to its column and resolution, and keeps the item's thread", async () => {
    const want = {
      901: ["inbox", null, true],
      902: ["doing", null, true],
      903: ["doing", null, true],
      904: ["review", null, true],
      905: ["done", "fixed", false],
      906: ["done", "abandoned", false],
      907: ["done", "duplicate", false],
    };
    for (const [id, [status, resolution, open]] of Object.entries(want)) {
      const got = await call("GET", `/_p99/v1/issues/BUG-${id}?host=*`);
      assert.equal(got.status, 200, JSON.stringify(got.json));
      const issue = got.json.issue;
      assert.deepEqual([issue.status, issue.resolution, issue.closed_at === null], [status, resolution, open], `BUG-${id}`);
      assert.equal(issue.board, "legacy-example");
    }
    assert.equal((await call("GET", "/_p99/v1/issues/BUG-907?host=*")).json.issue.duplicate_of, "BUG-905");
    const thread = await call("GET", "/_p99/v1/issues/BUG-902?host=*");
    assert.equal(thread.json.comments.length, 1);
    const old = await call("GET", "/_p99/v1/issues/BUG-905?host=*");
    assert.ok(old.json.events.some((e) => e.kind === "status" && e.detail.to === "resolved"));
    const board = await call("GET", "/_p99/v1/boards/legacy-example");
    assert.equal(board.status, 200, JSON.stringify(board.json));
    assert.deepEqual(board.json.board.rollup, { done: 3, total: 7 });
    const doing = board.json.cards.filter((c) => c.status === "doing").map((c) => c.key);
    assert.deepEqual(doing, ["BUG-903", "BUG-902"]);
  });

  const boards = await call("GET", `/_p99/v1/boards?host=${here}`);
  const home = boards.json.boards.find((b) => b.home && b.host === here);

  await check("a board card moved to done moves every item in its subtree, and its rollup follows", async () => {
    assert.ok(home, JSON.stringify(boards.json));
    const site = await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "Site v2", parent: home.slug } });
    assert.equal(site.status, 201, JSON.stringify(site.json));
    assert.equal(site.json.slug, "site-v2");
    const checkout = await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "Checkout", parent: "site-v2", status: "Doing" } });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    const one = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Cascade one" }) })).json;
    const two = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Cascade two" }) })).json;
    assert.equal(one.board, home.slug);
    assert.equal(one.status, "inbox");
    const moved = await call("POST", `/_p99/v1/move?host=${here}`, { body: { target: one.key, board: "site-v2", to: "doing" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.deepEqual(moved.json.changed, [one.key]);
    assert.equal((await call("POST", "/_p99/v1/move", { body: { target: two.key, board: "checkout" } })).status, 200);
    const done = await call("POST", `/_p99/v1/move?host=${here}`, { body: { target: "board:site-v2", to: "done" } });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual([...done.json.changed].sort(), [one.key, two.key].sort());
    assert.deepEqual(done.json.moved.rollup, { done: 2, total: 2 });
    for (const key of [one.key, two.key]) {
      const issue = (await call("GET", `/_p99/v1/issues/${key}?host=${here}`)).json.issue;
      assert.deepEqual([issue.status, issue.resolution], ["done", "fixed"], key);
    }
    const inside = await call("GET", "/_p99/v1/boards/site-v2");
    assert.equal(inside.json.cards.find((c) => c.type === "board").status, "done");
    const cycle = await call("POST", "/_p99/v1/move", { body: { target: "board:site-v2", board: "checkout" } });
    assert.equal(cycle.status, 400);
  });

  await check("reporters neither see nor move boards", async () => {
    assert.equal((await browse("GET", "/boards", adaHere.secret)).status, 403);
    assert.equal((await browse("GET", `/boards/${home.slug}`, adaHere.secret)).status, 403);
    assert.equal((await browse("POST", "/move", adaHere.secret, { target: key, to: "doing" })).status, 403);
    assert.equal((await browse("GET", `/issues?scope=mine&board=${home.slug}`, adaHere.secret)).status, 403);
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { status: "doing" })).status, 403);
    assert.equal((await browse("POST", "/stream-ticket", adaHere.secret)).status, 403);
    const listed = await browse("GET", "/issues?scope=mine", adaHere.secret);
    assert.ok(listed.json.issues.length > 0);
    assert.ok(listed.json.issues.every((i) => i.board === null && i.position === null));
  });

  const boss = await mint("Grace Hopper", "grace@example.com", [here], true);

  await check("a manager scoped to one host can't reach another host's board", async () => {
    const away = await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Over there" } });
    assert.equal(away.status, 201, JSON.stringify(away.json));
    assert.equal(away.json.host, there);
    assert.equal((await browse("GET", "/boards", boss.secret)).json.boards.some((b) => b.host !== here), false);
    assert.equal((await browse("GET", `/boards/${away.json.slug}`, boss.secret)).status, 404);
    assert.equal((await browse("POST", "/move", boss.secret, { target: `board:${away.json.slug}`, to: "done" })).status, 404);
    assert.equal((await browse("POST", "/move", boss.secret, { target: key, board: away.json.slug })).status, 404);
    assert.equal((await browse("DELETE", `/boards/${away.json.slug}`, boss.secret)).status, 404);
    assert.equal((await call("POST", `/_p99/v1/move?host=${here}`, { body: { target: `board:${away.json.slug}`, to: "done" } })).status, 404);
    assert.equal((await browse("GET", `/boards/${home.slug}`, boss.secret)).status, 200);
  });

  await check("a stream ticket opens one socket, once, and expires", async () => {
    const first = await browse("POST", "/stream-ticket", boss.secret);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.ok(!JSON.stringify(first.json).includes(boss.secret));
    const heard = [];
    const socket = await ticketSocket(first.json.ticket, heard);
    assert.ok(socket, "the first use opens");
    assert.equal(await ticketSocket(first.json.ticket), null, "the second use is refused");
    const filed = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Heard on the ticket" }) })).json;
    await call("POST", `/_p99/v1/move?host=${here}`, { body: { target: filed.key, to: "review" } });
    for (let i = 0; i < 50 && !heard.some((e) => e.type === "move" && e.key === filed.key); i++) await new Promise((r) => setTimeout(r, 100));
    socket.close();
    const move = heard.find((e) => e.type === "move" && e.key === filed.key);
    assert.ok(move, JSON.stringify(heard));
    assert.deepEqual([move.from, move.to, move.board], ["inbox", "review", home.slug]);
    const late = await browse("POST", "/stream-ticket", boss.secret);
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(await ticketSocket(late.json.ticket), null, "an expired ticket is refused");
    assert.equal(await ticketSocket("0".repeat(48)), null);
  });

  await check("capture.js is an ES module that exports the panel's capture, marking and context calls", async () => {
    const response = await fetch(`${base}/_p99/capture.js?v=dev`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript/);
    assert.match(response.headers.get("cache-control"), /immutable/);
    const text = await response.text();
    const module = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
    for (const name of ["capture", "elementsAt", "context"]) assert.equal(typeof module[name], "function", name);
  });

  console.log(`${passed} checks passed`);
}

main().catch((error) => {
  console.error(`not ok - ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});

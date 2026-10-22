import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mergeFeedChecks } from "./merge-feed.mjs";
import { deleteChecks } from "./delete.mjs";
import { linkChecks } from "./links.mjs";
import { peopleChecks } from "./people.mjs";
import { migrateChecks } from "./migrate.mjs";
import { APP_HOST, LICENSE_STATE, appChecks } from "./app.mjs";
import { brandChecks, hideableLinkChecks } from "./brand.mjs";
import { widgetStories } from "./stories/widget.mjs";
import { triageStories } from "./stories/triage.mjs";
import { licenceStories } from "./stories/licence.mjs";
import { safetyStories } from "./stories/safety.mjs";
import { criticalChecks } from "./critical.mjs";
import { coverWorker } from "./inspect.mjs";

if (process.env.P99_COVERAGE) delete process.env.NODE_V8_COVERAGE;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const work = join(root, ".wrangler");
const state = join(work, "test-state");
const port = Number(process.env.P99_TEST_PORT || 8791);
let base = `http://127.0.0.1:${port}`;
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
INSERT INTO mail (id, provider, sender, updated_at) VALUES (1, 'resend', 'P99 <p99@example.com>', '2026-10-20T00:00:00Z');
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
  ...[
    ["Zoë Ångström", "zoe@example.com"],
    ["Zoë Ångström", "zoe.a@example.com"],
    ["Admin", "admin@example.com"],
  ].map(
    ([name, email], n) => `INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by)
     VALUES ('legacy-${n}', '0000', '${name}', '${email}', '["legacy.example"]', 0, '2025-01-01T00:00:00.000Z', 'old@example.com');`,
  ),
  "UPDATE items SET assignee = 'Old.Hand@example.com' WHERE id = 902;",
].join("\n");

const LANE_ROWS = [
  [951, "low", "2025-02-01"],
  [952, null, "2025-02-02"],
  [953, "urgent", "2025-02-05"],
  [954, "high", "2025-02-03"],
  [955, "urgent", "2025-02-04"],
  [956, "normal", "2025-02-06"],
  [957, "high", "2025-02-07"],
];

const LANE_SQL = [
  `INSERT INTO boards (id, slug, name, host, home, created_at, updated_at) VALUES (950, 'lanes-example', 'lanes.example', 'lanes.example', 1, '2025-02-01', '2025-02-01');`,
  `INSERT INTO boards (id, slug, name, host, parent_id, status, position, created_at, updated_at) VALUES (951, 'lanes-nested', 'Nested', 'lanes.example', 950, 'inbox', 2500, '2025-02-01', '2025-02-01');`,
  ...LANE_ROWS.map(([id, priority, day], n) => {
    const at = `'${day}T00:00:00.000Z'`;
    return `INSERT INTO items (id, client_uid, kind, status, open, title, body, origin_env, host, page_url, page_path, page_title,
      reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at,
      created_at, updated_at, board_id, position, priority)
      VALUES (${id}, 'lane-${id}', 'bug', 'inbox', 1, 'Lane ${id}', '', 'production', 'lanes.example', 'https://lanes.example/', '/', '',
      'old@example.com', 'Old', '{}', '{}', '[]', 'lane', ${at}, ${at}, ${at}, ${at}, 950, ${1000 * (n + 1)}, ${priority ? `'${priority}'` : "NULL"});`;
  }),
  `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at) VALUES (953, 'old@example.com', 'priority', '{"from":null,"to":"urgent"}', 1, '2025-02-05T00:00:00.000Z');`,
  `INSERT INTO labels (id, name, color, created_at) VALUES (900, 'legacy tag', '#57ab5a', '2025-02-01'), (901, 'review', '#986ee2', '2025-02-01');`,
  `INSERT INTO item_labels (item_id, label_id) VALUES (951, 900), (952, 900), (952, 901);`,
  `UPDATE statuses SET name = 'Building' WHERE key = 'doing';`,
].join("\n");

const TAG_COUNT = `SELECT count(DISTINCT il.item_id) AS n FROM item_labels il JOIN items i ON i.id = il.item_id WHERE il.label_id <> i.label_id`;

const sent = [];

function fakeResend() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url === "/emails/batch" && request.headers.authorization === "Bearer test-resend") {
        for (const message of JSON.parse(body)) sent.push(message);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [] }));
        return;
      }
      response.writeHead(401);
      response.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function until(what, fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`gave up waiting for ${what}`);
}

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
const failed = [];
const reds = [];
const unexpected = [];
const firstLine = (error) => String(error?.message ?? error).split("\n")[0];
async function check(name, fn) {
  try {
    await fn();
  } catch (error) {
    failed.push(name);
    console.log(`not ok - ${name}`);
    console.error(error?.stack ?? error);
    return;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
async function red(name, bug, fn) {
  try {
    await fn();
  } catch (error) {
    if (error?.harness) {
      failed.push(name);
      console.log(`not ok - ${name}`);
      console.error(error.stack);
      return;
    }
    reds.push(name);
    console.log(`not ok - ${name} # TODO red until fixed: ${bug} (${firstLine(error)})`);
    return;
  }
  unexpected.push(name);
  console.log(`not ok - ${name} # passed while marked red: ${bug}; make it a check`);
}

function wranglerSync(args) {
  const result = spawnSync(wrangler, args, { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

function d1count(sql) {
  const result = spawnSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", sql], {
    cwd: root,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`d1 ${sql} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout)[0].results[0].n;
}

async function waitForHealth(child, origin, logName) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited; see .wrangler/${logName}`);
    try {
      const response = await fetch(`${origin}/_p99/health`);
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
  const files = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const before = files.filter((f) => f < "0004");
  const lanes = files.filter((f) => f >= "0004" && f < "0011");
  const legacy = join(work, "test-legacy.sql");
  writeFileSync(
    legacy,
    [
      ...before.map((f) => readFileSync(join(migrations, f), "utf8")),
      LEGACY_SQL,
      ...lanes.map((f) => readFileSync(join(migrations, f), "utf8")),
      LANE_SQL,
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);",
      ...[...before, ...lanes].map((f) => `INSERT INTO d1_migrations (name) VALUES ('${f}');`),
    ].join("\n"),
  );
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", legacy]);
  wranglerSync(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  const seed = join(work, "test-seed.sql");
  writeFileSync(seed, SEED_SQL);
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", seed]);
  const vars = Object.entries(keys).map(([id, secret]) => `KEY_${id.toUpperCase()}:${secret}`);
  vars.push("CODE_PEPPER:test-pepper", "TICKET_TTL_MS:1500", `APP_HOST:${APP_HOST}`, `LICENSE_STATE:${LICENSE_STATE}`);
  const stub = await hookStub();
  vars.push(`HOOKS_TEST_ORIGIN:http://127.0.0.1:${stub.address().port}`);
  for (const host of ["127.0.0.1", "localhost"]) {
    vars.push(`GITHUB_HOOK_${sha256(Buffer.from(host)).slice(0, 16).toUpperCase()}:github-hook-secret`);
  }
  const resend = await fakeResend();
  vars.push("RESEND_API_KEY:test-resend", `RESEND_API_URL:http://127.0.0.1:${resend.address().port}`);
  let dev = null;
  process.on("exit", () => dev?.stop());
  try {
    dev = await startDev(port, [...vars, "LICENSE_LINK:shown"], "test-dev.log");
    const here = await run();
    await dev.stop();
    base = `http://127.0.0.1:${port + 1}`;
    dev = await startDev(port + 1, [...vars, "LICENSE_LINK:hideable"], "test-dev-hideable.log");
    await hideableLinkChecks({ call, browse, mint, check, here, placement: PLACEMENT });
    await licenceStories({ base, call, browse, mint, check, red, here, placement: PLACEMENT, root });
    console.log(`${passed} checks passed, ${reds.length} known red, ${failed.length} failed, ${unexpected.length} red that passed`);
    if (failed.length + unexpected.length > 0) process.exitCode = 1;
  } finally {
    await dev?.stop();
    stub.close();
    resend.close();
    resend.closeAllConnections();
  }
}

async function startDev(at, vars, logName) {
  const log = openSync(join(work, logName), "w");
  const covering = process.env.P99_COVERAGE;
  const inspector = covering ? ["--inspector-port", String(at + 1000)] : [];
  const child = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--port",
      String(at),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
      ...inspector,
      "--var",
      ...vars,
    ],
    { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", log, log], detached: true },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {}
  };
  let cover = null;
  const stop = async () => {
    if (cover) {
      const taking = cover;
      cover = null;
      await taking.save(join(covering, `worker-${at}.json`)).catch((error) => {
        console.error(`coverage: ${error.message}`);
        process.exitCode = 1;
      });
    }
    signal("SIGTERM");
    const late = setTimeout(() => signal("SIGKILL"), 10000);
    await exited;
    clearTimeout(late);
  };
  try {
    if (covering) cover = await coverWorker(at + 1000, join(work, "tmp"));
    await waitForHealth(child, `http://127.0.0.1:${at}`, logName);
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
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

  await check("priority, tags and status are refused as fields, a list keeps one label, and no answer carries them", async () => {
    const set = (k, body) => call("PATCH", `/_p99/v1/issues/${k}?host=${here}`, { body });
    for (const body of [{ priority: "urgent" }, { priority: null }, { labels: ["ui"] }, { labels: { add: ["ui"] } }, { status: "shelved" }]) {
      assert.equal((await set(key, body)).status, 400, JSON.stringify(body));
    }
    assert.match((await set(key, { priority: "high" })).json.message, /place in its lane/);
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { priority: "high" })).status, 400);
    assert.equal((await browse("PATCH", `/issues/${key}`, adaHere.secret, { labels: ["ui"] })).status, 400);
    assert.equal((await call("GET", `/_p99/v1/issues?scope=all&host=*&priority=urgent`)).status, 400);
    assert.equal((await call("GET", `/_p99/v1/issues?scope=all&host=*&status=shelved`)).status, 400);
    assert.equal((await browse("GET", "/issues?scope=mine&label=Inbox", adaHere.secret)).status, 403);
    const inbox = await call("GET", `/_p99/v1/issues?scope=all&host=${here}&label=Inbox`);
    assert.ok(inbox.json.issues.some((i) => i.key === key));
    assert.ok(inbox.json.issues.every((i) => i.label === "Inbox"));
    const answers = [
      (await call("GET", `/_p99/v1/issues/${key}?host=${here}`)).json,
      (await call("GET", `/_p99/v1/issues?scope=all&host=*`)).json,
      (await browse("GET", `/issues/${key}`, adaHere.secret)).json,
      (await browse("GET", "/issues?scope=mine", adaHere.secret)).json,
    ];
    for (const answer of answers) assert.doesNotMatch(JSON.stringify(answer.issue ?? answer.issues), /"(priority|labels|status|board|position)":/);
    const mine = (await browse("GET", `/issues/${key}`, adaHere.secret)).json.issue;
    assert.deepEqual([mine.stage, mine.label], ["received", null]);
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
    assert.deepEqual([thread.json.issue.label, thread.json.issue.stage], ["Building", "in_progress"]);
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
      "https://user" + "@hooks.slack.com/services/T0001/B0002/abc",
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

    assert.equal((await call("GET", `/_p99/v1/boards?host=${here}`)).status, 200);
    hookHits.length = 0;
    const moved = await call("POST", `/_p99/v1/move?host=${here}`, { body: { key: filed.json.key, from: "Inbox", to: "Building" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(hookHits.length, 0);
    const closed = await call("POST", `/_p99/v1/move?host=${here}`, { body: { key: filed.json.key, from: "Building", to: "Done" } });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    for (let i = 0; i < 50 && hookHits.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(hookHits.length, 1);
    assert.equal(hookHits[0].body.blocks.filter((b) => b.type === "section").length, 1);
    assert.ok(JSON.stringify(hookHits[0].body).includes("Moved to Done"));

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
    assert.equal(done.stage, "fixed");
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
      assert.equal(served.includes('"l":1'), false, "P99 blue on the dark face is under 3:1, so the + takes the dark fallback");
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

  await check("0004 and 0011 map every old status to its label and resolution, and keep the item's thread and its old tags", async () => {
    const want = {
      901: ["Inbox", "received", null],
      902: ["Building", "in_progress", null],
      903: ["Building", "in_progress", null],
      904: ["review", "in_progress", null],
      905: ["Done", "fixed", "fixed"],
      906: ["Done", "dropped", "abandoned"],
      907: ["Done", "duplicate", "duplicate"],
    };
    for (const [id, [label, stage, resolution]] of Object.entries(want)) {
      const got = await call("GET", `/_p99/v1/issues/BUG-${id}?host=*`);
      assert.equal(got.status, 200, JSON.stringify(got.json));
      const issue = got.json.issue;
      assert.deepEqual([issue.label, issue.stage, issue.resolution, issue.closed_at === null], [label, stage, resolution, resolution === null], `BUG-${id}`);
    }
    assert.equal((await call("GET", "/_p99/v1/issues/BUG-907?host=*")).json.issue.duplicate_of, "BUG-905");
    assert.equal((await call("GET", "/_p99/v1/issues/BUG-902?host=*")).json.comments.length, 1);
    const old = await call("GET", "/_p99/v1/issues/BUG-905?host=*");
    assert.ok(old.json.events.some((e) => e.kind === "status" && e.detail.to === "resolved"));
    const labels = (await call("GET", "/_p99/v1/labels")).json.labels;
    assert.deepEqual(labels.slice(0, 4).map((l) => [l.name, l.closes]), [["Inbox", false], ["Building", false], ["review", false], ["Done", true]]);
    assert.equal(labels.some((l) => l.name === "legacy tag"), false);
    assert.equal(await d1count("SELECT count(*) AS n FROM item_labels WHERE item_id IN (951, 952)"), 3);
    assert.equal(await d1count(TAG_COUNT), 2);
  });

  await check("the lane migration keeps each lane in its old priority order, then its old place, and flattens nested boards", async () => {
    const boards = await call("GET", "/_p99/v1/boards");
    assert.equal(boards.status, 200, JSON.stringify(boards.json));
    const lanes = boards.json.boards.find((b) => b.id === 950);
    const nested = boards.json.boards.find((b) => b.id === 951);
    assert.ok(lanes && nested, JSON.stringify(boards.json));
    assert.equal(lanes.mine, true);
    assert.deepEqual(lanes.columns.map((col) => col.label), ["Inbox", "Building", "review", "Done"]);
    const board = await call("GET", "/_p99/v1/boards/950");
    assert.equal(board.status, 200, JSON.stringify(board.json));
    const lane = board.json.cards.filter((cd) => cd.label === "Inbox").map((cd) => cd.key);
    assert.deepEqual(lane, ["BUG-953", "BUG-955", "BUG-954", "BUG-957", "BUG-956", "BUG-951", "BUG-952"]);
    assert.ok(board.json.cards.every((cd) => cd.key.startsWith("BUG-95")));
    const flat = await call("GET", "/_p99/v1/boards/951");
    assert.equal(flat.json.cards.length, 7);
    const legacy = boards.json.boards.find((b) => b.name === "legacy.example");
    const building = (await call("GET", `/_p99/v1/boards/${legacy.id}`)).json.cards.filter((cd) => cd.label === "Building").map((cd) => cd.key);
    assert.deepEqual(building, ["BUG-903", "BUG-902"]);
    const thread = await call("GET", "/_p99/v1/issues/BUG-953?host=*");
    assert.equal(thread.json.events.some((e) => e.kind === "priority"), false);
  });

  const kate = await mint("Margaret Hamilton", "margaret@example.com", [here], true);
  const boss = await mint("Grace Hopper", "grace@example.com", [here], true);
  const fileOn = async (title) => (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title }) })).json.key;
  const mineHere = (await call("GET", `/_p99/v1/boards?host=${here}`)).json.boards.find((b) => b.mine);
  const move = (body) => call("POST", `/_p99/v1/move?host=${here}`, { body });
  const cards = async (id, as) => (as ? await browse("GET", `/boards/${id}`, as) : await call("GET", `/_p99/v1/boards/${id}?host=${here}`)).json.cards;

  await check("a manager gets one board on first use; a move replaces the label, a stale one is 409, and each item shows at most once", async () => {
    assert.ok(mineHere, "grace's board here");
    assert.deepEqual(mineHere.columns.map((col) => col.label), ["Inbox", "Building", "review", "Done"]);
    assert.equal((await call("GET", `/_p99/v1/boards?host=${here}`)).json.boards.filter((b) => b.mine).length, 1);
    const [a, b, c] = [await fileOn("Card A"), await fileOn("Card B"), await fileOn("Card C")];
    const moved = await move({ key: a, from: "Inbox", to: "Building", board: mineHere.id });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.card.label, "Building");
    assert.match(moved.json.card.order, /^[0-9A-Za-z]+$/);
    const stale = await move({ key: a, from: "Inbox", to: "review", board: mineHere.id });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.json, { error: "moved", message: "this card moved; refreshed" });
    assert.equal((await call("GET", `/_p99/v1/issues/${a}?host=${here}`)).json.issue.label, "Building");
    assert.equal((await move({ key: b, from: "Inbox", to: "Building", board: mineHere.id, after: a })).status, 200);
    assert.equal((await move({ key: c, from: "Inbox", to: "Building", board: mineHere.id, before: a })).status, 200);
    const ours = (list) => list.filter((cd) => cd.label === "Building" && [a, b, c].includes(cd.key)).map((cd) => cd.key);
    let lane = ours(await cards(mineHere.id));
    assert.deepEqual(lane, [c, a, b]);
    assert.equal((await move({ key: c, from: "Building", to: "Building", board: mineHere.id, after: b })).status, 200);
    lane = ours(await cards(mineHere.id));
    assert.deepEqual(lane, [a, b, c]);
    const qa = await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "QA", columns: [{ label: "Building" }, { label: "QA ready" }, { label: "Done", closes: true }] } });
    assert.equal(qa.status, 201, JSON.stringify(qa.json));
    assert.deepEqual(qa.json.columns, [{ label: "Building", closes: false }, { label: "QA ready", closes: false }, { label: "Done", closes: true }]);
    assert.equal((await move({ key: a, from: "Building", to: "QA ready", board: qa.json.id })).status, 200);
    const onQa = await cards(qa.json.id);
    const onMine = await cards(mineHere.id);
    assert.ok(onQa.some((cd) => cd.key === a && cd.label === "QA ready"));
    assert.equal(onMine.some((cd) => cd.key === a), false);
    for (const list of [onQa, onMine]) {
      assert.equal(new Set(list.map((cd) => cd.key)).size, list.length);
      const labels = new Set(list.map((cd) => cd.label));
      assert.ok([...labels].every((l) => (list === onQa ? ["Building", "QA ready", "Done"] : ["Inbox", "Building", "review", "Done"]).includes(l)));
    }
    assert.equal(onQa.some((cd) => cd.label === "Inbox"), false);
    const none = await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "Too few", columns: ["Inbox", "Done"] } });
    assert.equal(none.status, 400);
    assert.equal((await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "Third", columns: ["Inbox", "Building", "Done"] } })).status, 201);
    assert.equal((await call("POST", `/_p99/v1/boards?host=${here}`, { body: { name: "Fourth", columns: ["Inbox", "Building", "Done"] } })).status, 409);
  });

  await check("watchers see the owner's exact view and can't drag; any manager sets a label through their own boards; reporters can't", async () => {
    const owner = await cards(mineHere.id);
    const listed = await browse("GET", "/boards", kate.secret);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.ok(listed.json.boards[0].mine);
    const watched = listed.json.boards.find((b) => b.id === mineHere.id);
    assert.equal(watched.mine, false);
    assert.deepEqual(await cards(mineHere.id, kate.secret), owner);
    const card = owner.find((cd) => cd.label === "Building");
    const refused = await browse("POST", "/move", kate.secret, { key: card.key, from: "Building", to: "review", board: mineHere.id });
    assert.equal(refused.status, 403);
    assert.equal((await browse("PUT", `/boards/${mineHere.id}`, kate.secret, { name: "Mine now" })).status, 403);
    assert.equal((await browse("DELETE", `/boards/${mineHere.id}`, kate.secret)).status, 403);
    assert.equal((await browse("POST", "/move", kate.secret, { key: card.key, from: "Building", to: "QA ready" })).status, 400);
    const set = await browse("POST", "/move", kate.secret, { key: card.key, from: "Building", to: "review" });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.card.label, "review");
    assert.equal((await browse("GET", "/boards", adaHere.secret)).status, 403);
    assert.equal((await browse("GET", `/boards/${mineHere.id}`, adaHere.secret)).status, 403);
    assert.equal((await browse("GET", "/labels", adaHere.secret)).status, 403);
    assert.equal((await browse("POST", "/move", adaHere.secret, { key, from: "Inbox", to: "Building" })).status, 403);
    assert.equal((await browse("POST", "/stream-ticket", adaHere.secret)).status, 403);
  });

  await check("a board, a watch and a move of another host are a 404, and only the owner deletes a board, never their last", async () => {
    const away = await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Over there", columns: ["Inbox", "Building", "Done"] } });
    assert.equal(away.status, 201, JSON.stringify(away.json));
    assert.equal((await browse("GET", "/boards", boss.secret)).json.boards.some((b) => b.id === away.json.id), false);
    assert.equal((await browse("GET", `/boards/${away.json.id}`, boss.secret)).status, 404);
    assert.equal((await browse("POST", "/move", boss.secret, { key, from: "Inbox", to: "Building", board: away.json.id })).status, 404);
    assert.equal((await browse("PUT", `/boards/${away.json.id}`, boss.secret, { name: "Mine" })).status, 404);
    assert.equal((await browse("DELETE", `/boards/${away.json.id}`, boss.secret)).status, 404);
    const elsewhere = (await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title: "Far away" }) })).json.key;
    assert.equal((await browse("POST", "/move", boss.secret, { key: elsewhere, from: "Inbox", to: "Building" })).status, 404);
    assert.equal((await browse("GET", `/boards/${mineHere.id}`, boss.secret)).status, 200);
    const own = (await call("GET", `/_p99/v1/boards?host=${there}`)).json.boards.filter((b) => b.mine);
    assert.deepEqual(own.map((b) => b.id), [away.json.id]);
    assert.equal((await call("DELETE", `/_p99/v1/boards/${away.json.id}?host=${there}`)).status, 409);
    assert.equal((await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Spare", columns: ["Inbox", "Building", "Done"] } })).status, 201);
    assert.equal((await call("DELETE", `/_p99/v1/boards/${away.json.id}?host=${there}`)).status, 204);
  });

  await check("a closing label closes the item and mails its reporter; other label changes mail no one", async () => {
    const mailed = (k) => sent.filter((m) => m.to[0] === "ada@example.com" && m.subject.startsWith(`[${k}]`)).length;
    const filed = (await browse("POST", "/issues", adaHere.secret, issueBody({ title: "Close me" }))).json.key;
    assert.equal((await move({ key: filed, from: "Inbox", to: "Building", board: mineHere.id })).status, 200);
    assert.equal((await move({ key: filed, from: "Building", to: "review", board: mineHere.id })).status, 200);
    assert.equal((await browse("GET", `/issues/${filed}`, adaHere.secret)).json.issue.stage, "in_progress");
    const closed = await move({ key: filed, from: "review", to: "Done", board: mineHere.id });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    const issue = (await browse("GET", `/issues/${filed}`, adaHere.secret)).json.issue;
    assert.deepEqual([issue.stage, issue.resolution, Boolean(issue.closed_at)], ["fixed", "fixed", true]);
    await until("the closing mail", () => mailed(filed) === 1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(mailed(filed), 1);
    const reopened = await browse("PATCH", `/issues/${filed}`, adaHere.secret, { resolution: null });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
    assert.deepEqual([reopened.json.stage, reopened.json.resolution], ["received", null]);
    const dropped = await browse("PATCH", `/issues/${filed}`, adaHere.secret, { resolution: "abandoned" });
    assert.deepEqual([dropped.json.stage, dropped.json.resolution], ["dropped", "abandoned"]);
    assert.equal((await call("GET", `/_p99/v1/issues/${filed}?host=${here}`)).json.issue.label, "Done");
  });

  await check("1.8's status payloads still work: a reporter drops and reopens their own, a list filters by a status key", async () => {
    const filed = (await browse("POST", "/issues", adaHere.secret, issueBody({ title: "Old words" }))).json.key;
    const mine = (body) => browse("PATCH", `/issues/${filed}`, adaHere.secret, body);
    const dropped = await mine({ status: "done", resolution: "abandoned" });
    assert.equal(dropped.status, 200, JSON.stringify(dropped.json));
    assert.deepEqual([dropped.json.stage, dropped.json.resolution], ["dropped", "abandoned"]);
    assert.equal((await mine({ status: "inbox" })).status, 403);
    assert.equal((await call("PATCH", `/_p99/v1/issues/${filed}?host=${here}`, { body: { status: "done" } })).json.stage, "fixed");
    const reopened = await mine({ status: "inbox" });
    assert.deepEqual([reopened.status, reopened.json.stage], [200, "received"]);
    assert.equal((await mine({ status: "doing" })).status, 403);
    const doing = await call("PATCH", `/_p99/v1/issues/${filed}?host=${here}`, { body: { status: "doing" } });
    assert.deepEqual([doing.json.label, doing.json.stage], ["Building", "in_progress"]);
    const keys = async (status) => (await call("GET", `/_p99/v1/issues?scope=all&host=${here}&status=${status}`)).json.issues.map((i) => i.key);
    assert.ok((await keys("doing")).includes(filed));
    assert.equal((await keys("inbox")).includes(filed), false);
    assert.ok((await browse("GET", "/issues?scope=mine&status=doing", adaHere.secret)).json.issues.some((i) => i.key === filed));
  });

  await check("a label rename changes the name on every board, and a one-host manager can't rename a label other hosts use", async () => {
    const labels = (await call("GET", `/_p99/v1/labels?host=${here}`)).json.labels;
    const qa = labels.find((l) => l.name === "QA ready");
    assert.ok(qa.boards.some((b) => b.name === "QA"));
    const done = labels.find((l) => l.name === "Done");
    assert.equal((await browse("PATCH", `/labels/${done.id}`, boss.secret, { name: "Shipped" })).status, 403);
    const renamed = await call("PATCH", `/_p99/v1/labels/${qa.id}`, { body: { name: "Ready for QA" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    const qaBoard = (await call("GET", `/_p99/v1/boards?host=${here}`)).json.boards.find((b) => b.name === "QA");
    assert.deepEqual(qaBoard.columns.map((col) => col.label), ["Building", "Ready for QA", "Done"]);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${qa.id}`, { body: { name: "inbox" } })).status, 409);
  });

  await check("a one-host manager can't close or rename a label that items of another host carry, even off every board", async () => {
    const far = (await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title: "Parked far away" }) })).json.key;
    const park = await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Park", columns: ["Inbox", "Parked", "Done"] } });
    assert.equal(park.status, 201, JSON.stringify(park.json));
    const moved = await call("POST", `/_p99/v1/move?host=${there}`, { body: { key: far, from: "Inbox", to: "Parked", board: park.json.id } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal((await call("PUT", `/_p99/v1/boards/${park.json.id}?host=${there}`, { body: { columns: ["Inbox", "Building", "Done"] } })).status, 200);
    const parked = (await call("GET", "/_p99/v1/labels")).json.labels.find((l) => l.name === "Parked");
    const closing = await browse("POST", "/boards", boss.secret, { name: "Closer", columns: ["Inbox", { label: "Parked", closes: true }, "Done"] });
    assert.equal(closing.status, 403, JSON.stringify(closing.json));
    assert.equal((await browse("PATCH", `/labels/${parked.id}`, boss.secret, { name: "Gone" })).status, 403);
    const still = (await call("GET", `/_p99/v1/issues/${far}?host=${there}`)).json.issue;
    assert.deepEqual([still.label, still.stage], ["Parked", "in_progress"]);
    assert.equal((await call("DELETE", `/_p99/v1/boards/${park.json.id}?host=${there}`)).status, 204);
  });

  await check("a move finds its column in any case and keeps the card among its neighbours", async () => {
    const accents = await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Accents", columns: ["Inbox", "Évalué", "Done"] } });
    assert.equal(accents.status, 201, JSON.stringify(accents.json));
    const fileThere = async (title) => (await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title }) })).json.key;
    const [x, y] = [await fileThere("Accent X"), await fileThere("Accent Y")];
    const moveThere = (body) => call("POST", `/_p99/v1/move?host=${there}`, { body: { board: accents.json.id, ...body } });
    assert.equal((await moveThere({ key: x, from: "Inbox", to: "Évalué" })).status, 200);
    const after = await moveThere({ key: y, from: "Inbox", to: "évalué", after: x });
    assert.equal(after.status, 200, JSON.stringify(after.json));
    const lane = (await call("GET", `/_p99/v1/boards/${accents.json.id}?host=${there}`)).json.cards.filter((cd) => cd.label === "Évalué").map((cd) => cd.key);
    assert.deepEqual(lane, [x, y]);
    assert.equal((await call("DELETE", `/_p99/v1/boards/${accents.json.id}?host=${there}`)).status, 204);
  });

  await check("a one-host manager sees and hears only the labels of their host and the defaults; labels on no board and no item go and don't count", async () => {
    const far = await call("POST", `/_p99/v1/boards?host=${there}`, { body: { name: "Far", columns: ["Inbox", "Far only", "Done"] } });
    assert.equal(far.status, 201, JSON.stringify(far.json));
    const all = (await call("GET", "/_p99/v1/labels")).json.labels;
    const farOnly = all.find((l) => l.name === "Far only");
    assert.ok(farOnly && all.some((l) => l.name === "Parked"));
    const seen = (await browse("GET", "/labels", boss.secret)).json.labels.map((l) => l.name);
    assert.equal(seen.includes("Far only") || seen.includes("Parked"), false, JSON.stringify(seen));
    assert.deepEqual(seen.slice(0, 4), all.slice(0, 4).map((l) => l.name));
    assert.ok(seen.includes("Ready for QA"));
    const heard = [];
    const socket = await ticketSocket((await browse("POST", "/stream-ticket", boss.secret)).json.ticket, heard);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${farOnly.id}`, { body: { name: "Far away only" } })).status, 200);
    const qa = all.find((l) => l.name === "Ready for QA");
    assert.equal((await call("PATCH", `/_p99/v1/labels/${qa.id}`, { body: { name: "QA ready" } })).status, 200);
    await until("the rename here", () => heard.some((e) => e.type === "labels" && e.names[1] === "QA ready"));
    socket.close();
    assert.equal(heard.some((e) => e.type === "labels" && e.names[1] === "Far away only"), false, JSON.stringify(heard));
    assert.equal(heard.some((e) => "hosts" in e), false);
    wranglerSync([
      "d1", "execute", "DB", "--local", "--persist-to", state, "--command",
      "INSERT INTO labels (name, color, created_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 250) SELECT 'Orphan ' || i, '#539bf5', '2026-10-20T00:00:00Z' FROM n",
    ]);
    const changed = await call("PUT", `/_p99/v1/boards/${far.json.id}?host=${there}`, { body: { columns: ["Inbox", "Fresh one", "Done"] } });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(d1count("SELECT count(*) AS n FROM labels WHERE name LIKE 'Orphan %' OR name = 'Far away only'"), 0);
    assert.equal(d1count("SELECT count(*) AS n FROM labels WHERE role IS NOT NULL"), 4);
    assert.equal(d1count("SELECT count(*) AS n FROM labels WHERE name IN ('Fresh one', 'Parked')"), 2);
    assert.equal((await call("DELETE", `/_p99/v1/boards/${far.json.id}?host=${there}`)).status, 204);
    assert.equal(d1count("SELECT count(*) AS n FROM labels WHERE name = 'Fresh one'"), 0);
  });

  await check("a stream ticket opens one socket, once, and expires; a move is heard as a label change and an order", async () => {
    const first = await browse("POST", "/stream-ticket", boss.secret);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.ok(!JSON.stringify(first.json).includes(boss.secret));
    const heard = [];
    const socket = await ticketSocket(first.json.ticket, heard);
    assert.ok(socket, "the first use opens");
    assert.equal(await ticketSocket(first.json.ticket), null, "the second use is refused");
    const filed = await fileOn("Heard on the ticket");
    await move({ key: filed, from: "Inbox", to: "review", board: mineHere.id });
    for (let i = 0; i < 50 && !heard.some((e) => e.type === "order" && e.key === filed); i++) await new Promise((r) => setTimeout(r, 100));
    socket.close();
    const label = heard.find((e) => e.type === "label" && e.key === filed);
    const order = heard.find((e) => e.type === "order" && e.key === filed);
    assert.ok(label && order, JSON.stringify(heard));
    assert.deepEqual([label.from, label.to, label.host], ["Inbox", "review", here]);
    assert.deepEqual([order.board, typeof order.order, order.host], [mineHere.id, "string", here]);
    const late = await browse("POST", "/stream-ticket", boss.secret);
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(await ticketSocket(late.json.ticket), null, "an expired ticket is refused");
    assert.equal(await ticketSocket("0".repeat(48)), null);
  });

  await check("a reporter's mail opens their item with their code, its opt-out works only for that item, and an opted-out reporter gets no more mail", async () => {
    const linus = await mint("Linus Pauling", "linus@example.com", [here]);
    const one = (await browse("POST", "/issues", linus.secret, issueBody({ title: "First" }))).json.key;
    const two = (await browse("POST", "/issues", linus.secret, issueBody({ title: "Second" }))).json.key;
    const reply = (k) => call("POST", `/_p99/v1/issues/${k}/comments?host=${here}`, { body: { client_uid: randomUUID(), body: "Looking into it." } });
    const to = (k) => sent.filter((m) => m.to[0] === "linus@example.com" && m.subject.startsWith(`[${k}]`));
    assert.equal((await reply(one)).status, 201);
    const [first] = await until("the first reply's mail", () => to(one).length === 1 && to(one));
    assert.ok(first.text.includes(`https://${here}/_p99/open?to=%2Forders&item=${one}#${linus.secret}`), first.text);
    assert.equal(first.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    const token = /\/_p99\/mail\?t=(\S+)/.exec(first.text)[1];
    const [id, email, mac] = token.split(".");
    const twoId = two.split("-")[1];
    const optOut = (t, init) => fetch(`${base}/_p99/mail?t=${t}`, init);
    const flipped = mac.slice(0, -2) + (mac.endsWith("AA") ? "AB" : "AA");
    assert.equal((await optOut(`${id}.${email}.${flipped}`)).status, 404);
    assert.equal((await optOut(`${twoId}.${email}.${mac}`)).status, 404);
    assert.equal((await optOut(`${id}.${Buffer.from("grace@example.com").toString("base64url")}.${mac}`)).status, 404);
    const off = await optOut(token);
    assert.equal(off.status, 200);
    assert.match(await off.text(), /No more mail about/);
    assert.equal((await reply(one)).status, 201);
    assert.equal((await reply(two)).status, 201);
    await until("the second item's mail", () => to(two).length === 1);
    const skipped = await until("the opted-out mail's event", async () => {
      const events = (await call("GET", `/_p99/v1/issues/${one}?host=${here}`)).json.events.filter((e) => e.kind === "mail" && e.detail.to === "linus@example.com");
      return events.length === 2 && events;
    });
    assert.equal(skipped[1].detail.status, "opted_out");
    assert.equal(to(one).length, 1);
    const undo = await optOut(token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "undo=1" });
    assert.match(await undo.text(), /back on/);
    const open = await fetch(`${base}/_p99/open?to=%2Forders&item=${one}`);
    assert.equal(open.status, 200);
    assert.match(open.headers.get("content-security-policy"), /script-src 'sha256-/);
    assert.ok((await open.text()).includes(`content="/orders#p99=${one}"`));
    assert.equal((await fetch(`${base}/_p99/open?to=%2F%2Fevil.example`)).status, 404);
  });

  await check("the sealed copy of a code never appears in an API response", async () => {
    const minted = await mint("Rosalind Franklin", "rosalind@example.com", [here]);
    const read = spawnSync(
      wrangler,
      ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", "SELECT sealed_code FROM codes WHERE sealed_code IS NOT NULL"],
      { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" },
    );
    const sealed = JSON.parse(read.stdout)[0].results.map((r) => r.sealed_code);
    assert.ok(sealed.length >= 2, read.stdout);
    const filed = (await browse("POST", "/issues", minted.secret, issueBody())).json.key;
    const answers = [
      minted,
      (await call("GET", "/_p99/v1/codes")).json,
      (await call("GET", `/_p99/v1/codes?host=${here}`)).json,
      (await browse("GET", "/me", minted.secret)).json,
      (await browse("GET", `/issues/${filed}`, minted.secret)).json,
      (await browse("GET", "/issues?scope=mine", minted.secret)).json,
      (await call("GET", `/_p99/v1/issues/${filed}?host=${here}`)).json,
      (await call("GET", `/_p99/v1/issues?host=${here}`)).json,
    ];
    for (const answer of answers) {
      const text = JSON.stringify(answer);
      assert.equal(/sealed/.test(text), false, text);
      for (const s of sealed) assert.equal(text.includes(s), false);
    }
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

  await criticalChecks({ base, call, browse, mint, check, issueBody, here, sha256, keys, sign, actorHeader, state });
  await mergeFeedChecks({ base, call, browse, mint, check, issueBody, here, there, placement: PLACEMENT });
  await deleteChecks({ base, call, browse, mint, check, issueBody, here, state, wrangler, root });
  await linkChecks({ base, call, browse, check, here, there, sent, keys, root, work });
  await peopleChecks({ call, browse, mint, check, issueBody, here, there });
  await safetyStories({ base, call, browse, mint, check, red, issueBody, here, there, keys, root, wrangler, work });
  await brandChecks({ call, browse, mint, check, here, placement: PLACEMENT });
  await migrateChecks({ check, root, work });
  await appChecks({ base, call, browse, mint, check, issueBody, here, there, keys });
  await widgetStories({ base, call, browse, mint, check, red, issueBody, here, there, state, wrangler, root });
  await triageStories({ call, browse, mint, check, red, issueBody, here, listen, wrangler, state, root });
  await check("board.js is served as the module the panel imports for managers", async () => {
    const response = await fetch(`${base}/_p99/board.js?v=dev`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript/);
    assert.match(await response.text(), /^export function open\(/m);
  });

  return here;
}

main().catch((error) => {
  console.error(`not ok - ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});

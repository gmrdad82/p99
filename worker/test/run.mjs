import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  production: randomBytes(24).toString("hex"),
  dev: randomBytes(24).toString("hex"),
};

const VECTOR = {
  actorJson: '{"email":"ada@example.com","name":"Ada Lovelace","rank":"administrator","person":"ada@example.com"}',
  actor:
    "eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UiLCJyYW5rIjoiYWRtaW5pc3RyYXRvciIsInBlcnNvbiI6ImFkYUBleGFtcGxlLmNvbSJ9",
  body: '{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}',
  path: "/_p99/v1/issues?host=example.com",
  hash: "ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf",
  auth: "v1 ts=1760400000,sig=16d2f29dfa22138f0f5311fb84704288459905c2f4e3ac37cf5cacfaf08b2566",
};

const OLD_ITEMS_SQL = `
CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_tracker.sql');
INSERT INTO items (id, client_uid, kind, status, open, title, body, origin_env, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at, created_at, updated_at)
VALUES
  (7, 'old-7', 'bug', 'new', 1, 'The old total', '', 'production', 'https://example.com/orders', '/orders', 'Orders',
   'ada@example.com', 'Ada Lovelace', '{"email":"ada@example.com","name":"Ada Lovelace","rank":"everyone","person":1}',
   '{}', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  (9, 'old-9', 'feature', 'confirmed', 1, 'An old idea', '', 'production', 'https://example.com/', '/', 'Home',
   'grace@example.com', 'Grace Hopper', '{"email":"grace@example.com","name":"Grace Hopper","rank":"everyone","person":2}',
   '{}', '[]', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
INSERT INTO comments (id, item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env, created_at)
VALUES (3, 9, 'old-c-3', 'grace@example.com', 'Grace Hopper', 0, 'Still wanted.', 0, 'production', '2026-01-03T00:00:00.000Z');
UPDATE items SET comment_count = 1, public_comment_count = 1 WHERE id = 9;
INSERT INTO usage (actor_email, day, issues, comments, bytes) VALUES ('grace@example.com', date('now'), 30, 200, 0);
`;

const PLACEMENT = { corner: "top-left", offset: { x: 24, y: 40 }, theme: { accent: "#3b7dd8" } };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const actorHeader = (actor) => Buffer.from(JSON.stringify(actor)).toString("base64url");
const grace = { email: "grace@example.com", name: "Grace Hopper", rank: "super_administrator", agent: "claude" };
const ada = { email: "ada@example.com", name: "Ada Lovelace", rank: "everyone" };

function sign({ secret, ts, method, path, actor, hash }) {
  const sig = createHmac("sha256", secret).update(`v1\n${ts}\n${method}\n${path}\n${actor}\n${hash}`).digest("hex");
  return `v1 ts=${ts},sig=${sig}`;
}

async function call(method, path, { actor = grace, body, keyId = "p99", tamper } = {}) {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const hash = sha256(bytes);
  const actorText = actor ? actorHeader(actor) : "";
  const ts = Math.floor(Date.now() / 1000);
  let auth = sign({ secret: keys[keyId] || "unknown", ts, method, path, actor: actorText, hash });
  if (tamper === "sig") auth = auth.slice(0, -1) + (auth.endsWith("0") ? "1" : "0");
  const headers = { "x-tracker-key-id": keyId, "x-tracker-auth": auth, "x-content-sha256": hash };
  if (actorText) headers["x-tracker-actor"] = actorText;
  if (bytes.length > 0) headers["content-type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: bytes.length > 0 ? bytes : undefined });
  return { status: response.status, json: await jsonOf(response), response };
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
  const oldSchema = join(work, "test-old.sql");
  writeFileSync(oldSchema, readFileSync(join(root, "migrations", "0001_tracker.sql"), "utf8") + OLD_ITEMS_SQL);
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", oldSchema]);
  wranglerSync(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  const log = openSync(join(work, "test-dev.log"), "w");
  const vars = Object.entries(keys).map(([id, secret]) => `KEY_${id.toUpperCase()}:${secret}`);
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

  await check("a stale, a bad or an unknown signature is refused", async () => {
    const stale = await fetch(base + VECTOR.path, {
      method: "POST",
      headers: {
        "x-tracker-key-id": "test",
        "x-tracker-actor": VECTOR.actor,
        "x-content-sha256": VECTOR.hash,
        "x-tracker-auth": VECTOR.auth,
        "content-type": "application/json",
      },
      body: VECTOR.body,
    });
    assert.equal(stale.status, 401);
    assert.equal((await stale.json()).error, "unauthorized");
    assert.equal((await call("GET", "/_p99/v1/hosts", { tamper: "sig" })).status, 401);
    assert.equal((await call("GET", "/v1/hosts", { keyId: "nokey" })).status, 401);
    const ts = Math.floor(Date.now() / 1000);
    const actor = actorHeader(grace);
    const empty = sha256(Buffer.alloc(0));
    const crossed = await fetch(`${base}/v1/hosts`, {
      headers: {
        "x-tracker-key-id": "p99",
        "x-tracker-actor": actor,
        "x-content-sha256": empty,
        "x-tracker-auth": sign({ secret: keys.dev, ts, method: "GET", path: "/v1/hosts", actor, hash: empty }),
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

  await check("an old database keeps its keys and numbers and gets its host", async () => {
    const seven = await call("GET", "/_p99/v1/issues/BUG-7?host=127.0.0.1");
    assert.equal(seven.status, 200);
    assert.equal(seven.json.issue.key, "BUG-7");
    assert.equal(seven.json.issue.host, "127.0.0.1");
    const nine = await call("GET", "/_p99/v1/issues/9");
    assert.equal(nine.json.issue.key, "FEAT-9");
    assert.equal(nine.json.comments.length, 1);
    const all = await call("GET", "/_p99/v1/issues?scope=all&host=*");
    assert.deepEqual(all.json.issues.map((i) => [i.key, i.host]), [["FEAT-9", "127.0.0.1"], ["BUG-7", "127.0.0.1"]]);
    assert.equal((await call("GET", "/_p99/v1/issues/BUG-7?host=localhost")).status, 404);
    assert.equal((await call("GET", "/_p99/v1/issues?scope=all&host=nope.example.com")).status, 404);
  });

  const both = await mint("Ada Lovelace", "ada@example.com", ["127.0.0.1", "localhost"]);
  const me = await browse("GET", "/me?path=%2Forders", both.secret);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const here = me.json.host;
  const there = here === "127.0.0.1" ? "localhost" : "127.0.0.1";
  const hereEnv = here === "127.0.0.1" ? "production" : "dev";
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

  const filed = await browse("POST", "/issues", adaHere.secret, issueBody());
  const key = filed.json && filed.json.key;

  await check("a reporter cannot read another's item, and the page address loses its query", async () => {
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.equal(filed.json.page.url, "https://example.com/orders");
    assert.equal(filed.json.host, here);
    assert.ok(filed.json.id > 9);
    assert.equal((await browse("GET", `/issues/${key}`, adaHere.secret)).status, 200);
    assert.equal((await browse("GET", `/issues/${key}`, graceHere.secret)).status, 404);
    assert.equal((await browse("GET", "/issues?scope=all", graceHere.secret)).status, 403);
    const mine = await browse("GET", "/issues?scope=mine", graceHere.secret);
    assert.equal(mine.json.issues.some((i) => i.key === key), false);
    assert.equal((await browse("GET", `/issues/${key}`, adaThere.secret)).status, 401);
  });

  await check("an item filed through the browser keeps its key across the old route", async () => {
    const old = await call("GET", `/v1/issues/${key}`, { keyId: hereEnv, actor: ada });
    assert.equal(old.status, 200, JSON.stringify(old.json));
    assert.equal(old.json.issue.key, key);
    assert.equal(old.json.issue.host, here);
    const signed = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(signed.json.issue.key, key);
    const comment = await call("POST", `/_p99/v1/issues/${key}/comments?host=${here}`, {
      body: { client_uid: randomUUID(), body: "Confirmed on the orders page." },
    });
    assert.equal(comment.status, 201);
    assert.equal(comment.json.author.agent, "claude");
  });

  await check("a manager over the daily limits still files, and others are stopped", async () => {
    const managed = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "The crème brûlée costs too much" }) });
    assert.equal(managed.status, 201, JSON.stringify(managed.json));
    assert.equal((await browse("POST", "/issues", graceHere.secret, issueBody())).status, 429);
  });

  await check("search ignores diacritics and case, on new and adopted items", async () => {
    const keys = async (q) =>
      (await call("GET", `/_p99/v1/issues?scope=all&host=*&q=${encodeURIComponent(q)}`)).json.issues.map((i) => i.key);
    const found = await keys("CREME brulee");
    assert.equal(found.length, 1);
    assert.deepEqual(await keys("Crème Brûlée"), found);
    assert.deepEqual(await keys("old TOTAL"), ["BUG-7"]);
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
      assert.ok(served.includes('"corner":"top-left"'));
      assert.ok(served.includes('"accent":"#3b7dd8"'));
    }
    assert.equal(served.length === 0, source.length === 0);
  });

  await check("capture.js is an ES module whose default export is the capture library", async () => {
    const response = await fetch(`${base}/_p99/capture.js?v=dev`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript/);
    assert.match(response.headers.get("cache-control"), /immutable/);
    const text = await response.text();
    const module = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
    assert.equal(typeof module.default.domToCanvas, "function");
  });

  console.log(`${passed} checks passed`);
}

main().catch((error) => {
  console.error(`not ok - ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});

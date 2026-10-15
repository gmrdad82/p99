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
  wranglerSync(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  const seed = join(work, "test-seed.sql");
  writeFileSync(seed, SEED_SQL);
  wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", seed]);
  const log = openSync(join(work, "test-dev.log"), "w");
  const vars = Object.entries(keys).map(([id, secret]) => `KEY_${id.toUpperCase()}:${secret}`);
  vars.push("CODE_PEPPER:test-pepper");
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

  const filed = await browse("POST", "/issues", adaHere.secret, issueBody());
  const key = filed.json && filed.json.key;

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

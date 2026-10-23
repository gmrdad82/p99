import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { LANE_NAMES } from "../src/cards.js";
import { SEED as FOLD_SEED, label as labelOf } from "./fold.mjs";

const AT = "'2026-01-01T00:00:00.000Z'";

const SEED_18 = `
INSERT INTO hosts (host, env, config_json, created_at) VALUES
  ('example.com', 'production', '{"above":"#footer","off":["/admin"]}', ${AT}),
  ('shop.example.com', 'production', '{}', ${AT});
INSERT INTO codes (id, hash, hint, name, email, hosts_json, manager, created_at, created_by) VALUES
  (1, 'h1', 'a', 'Ada Lovelace', 'ada@example.com', '["example.com"]', 1, ${AT}, 'setup'),
  (2, 'h2', 'b', 'Grace Hopper', 'grace@example.com', '["example.com"]', 0, ${AT}, 'ada@example.com'),
  (3, 'h3', 'c', 'Ada Lovelace', 'ada.l@example.com', '["shop.example.com"]', 0, ${AT}, 'ada@example.com'),
  (4, 'h4', 'd', 'Jo', 'jo@example.com', '["example.com"]', 0, ${AT}, 'ada@example.com');
INSERT INTO boards (id, slug, name, host, parent_id, status, position, home, created_at, updated_at) VALUES
  (1, 'example-com', 'example.com', 'example.com', NULL, 'inbox', 0, 1, ${AT}, ${AT}),
  (2, 'shop-example-com', 'shop.example.com', 'shop.example.com', NULL, 'inbox', 0, 1, ${AT}, ${AT}),
  (3, 'checkout', 'Checkout', 'shop.example.com', 2, 'doing', 1024, 0, ${AT}, ${AT}),
  (4, 'roadmap', 'Roadmap', NULL, NULL, 'inbox', 0, 0, ${AT}, ${AT});
UPDATE statuses SET name = 'QA' WHERE key = 'review';
INSERT INTO labels (id, name, color, created_at) VALUES (1, 'ux', '#336699', ${AT}), (2, 'qa', '#993366', ${AT});
${[
  [1, "bug", "inbox", 1, 1024, null, "example.com", "Grace@Example.com", 0],
  [2, "feature", "inbox", 1, 2048, "urgent", "example.com", "new@example.com", 0],
  [3, "bug", "inbox", 1, 3072, "low", "example.com", null, 0],
  [4, "question", "doing", 3, 1024, "high", "shop.example.com", null, 0],
  [5, "task", "review", 3, 1024, null, "shop.example.com", null, 0],
  [6, "bug", "done", 2, 1024, null, "shop.example.com", null, 0],
  [7, "improvement", "inbox", 4, 1024, null, "example.com", null, 1],
]
  .map(
    ([id, kind, status, board, position, priority, host, assignee, agent]) => `INSERT INTO items (id, client_uid, kind, status, open, title, body,
  origin_env, host, page_url, page_path, page_title, reporter_email, reporter_name, reporter_json, reporter_agent, assignee, context_json,
  marks_json, search_text, activity_at, public_activity_at, created_at, updated_at, closed_at, resolution, board_id, position, priority)
  VALUES (${id}, 'seed-${id}', '${kind}', '${status}', ${status === "done" ? 0 : 1}, 'Item ${id}', '', 'production', '${host}',
  'https://${host}/', '/', '', 'ada@example.com', 'Ada Lovelace', '{}', ${agent}, ${assignee ? `'${assignee}'` : "NULL"}, '{}', '[]',
  'item ${id}', ${AT}, ${AT}, ${AT}, ${AT}, ${status === "done" ? AT : "NULL"}, ${status === "done" ? "'fixed'" : "NULL"}, ${board},
  ${position}, ${priority ? `'${priority}'` : "NULL"});`,
  )
  .join("\n")}
INSERT INTO item_labels (item_id, label_id) VALUES (1, 1), (2, 2), (4, 1), (5, 2);
INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env, author_agent, created_at)
  VALUES (1, 'seed-c1', 'grace@example.com', 'Grace Hopper', 0, 'Seen it.', 0, 'production', 1, ${AT});
INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at) VALUES
  (1, 'grace@example.com', 0, 'status', '{"from":"inbox","to":"doing"}', 0, ${AT}),
  (1, 'grace@example.com', 0, 'status', '{"from":"doing","to":"done","resolution":"abandoned"}', 0, ${AT}),
  (1, 'grace@example.com', 0, 'status', '{"from":"done","to":"inbox"}', 0, ${AT}),
  (1, 'ada@example.com', 0, 'status', '{"from":"inbox","to":"review"}', 0, ${AT}),
  (3, 'jo@example.com', 0, 'status', '{"from":"new","to":"resolved"}', 0, ${AT}),
  (3, 'owner@example.com', 1, 'title', '{"from":"a","to":"b"}', 0, ${AT});
`;

const SEED_17 = `
INSERT INTO hosts (host, env, config_json, created_at) VALUES
  ('example.com', 'production', '{"above":"#footer","off":["/admin"]}', ${AT}),
  ('shop.example.com', 'production', '{}', ${AT});
INSERT INTO codes (id, hash, hint, name, email, hosts_json, manager, created_at, created_by, revoked_at) VALUES
  (1, 'h0', 'z', 'Old Manager', 'old@example.com', '["*"]', 1, ${AT}, 'setup', ${AT}),
  (2, 'h1', 'a', 'Ada Lovelace', 'ada@example.com', '["example.com","shop.example.com"]', 1, ${AT}, 'setup', NULL),
  (3, 'h2', 'b', 'Grace Hopper', 'grace@example.com', '["example.com"]', 0, ${AT}, 'ada@example.com', NULL),
  (4, 'h4', 'd', 'Jo', 'jo@example.com', '["example.com"]', 0, ${AT}, 'ada@example.com', NULL);
${[
  [1, "bug", "new", "example.com", "Grace@Example.com", 0, null],
  [2, "feature", "new", "example.com", "new@example.com", 0, null],
  [3, "bug", "confirmed", "example.com", null, 0, null],
  [4, "question", "in_progress", "shop.example.com", null, 0, null],
  [5, "task", "waiting", "shop.example.com", null, 0, null, "jo@example.com"],
  [6, "bug", "resolved", "example.com", null, 0, null],
  [7, "improvement", "abandoned", "example.com", null, 1, null],
  [8, "bug", "duplicate", "shop.example.com", null, 0, 6],
  [9, "bug", "resolved", "old.example.com", null, 0, null],
]
  .map(([id, kind, status, host, assignee, agent, duplicate, reporter = "ada@example.com"]) => {
    const open = ["new", "confirmed", "in_progress", "waiting"].includes(status);
    return `INSERT INTO items (id, client_uid, kind, status, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  activity_at, public_activity_at, created_at, updated_at, closed_at)
  VALUES (${id}, 'seed-${id}', '${kind}', '${status}', ${open ? 1 : 0}, 'Item ${id}', '', 'production', '${host}',
  'https://${host}/', '/', '', '${reporter}', 'Ada Lovelace', '{}', ${agent}, ${assignee ? `'${assignee}'` : "NULL"},
  ${duplicate ?? "NULL"}, '{}', '[]', 'item ${id}', ${AT}, ${AT}, ${AT}, ${AT}, ${open ? "NULL" : AT});`;
  })
  .join("\n")}
INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at) VALUES
  (4, 'grace@example.com', 0, 'status', '{"from":"confirmed","to":"in_progress"}', 0, ${AT}),
  (2, 'jo@example.com', 0, 'status', '{"from":"new","to":"abandoned"}', 0, ${AT}),
  (2, 'jo@example.com', 0, 'status', '{"from":"abandoned","to":"new"}', 0, ${AT}),
  (6, 'ada@example.com', 0, 'status', '{"from":"waiting","to":"resolved"}', 0, ${AT}),
  (5, 'jo@example.com', 0, 'status', '{"from":"waiting","to":"confirmed"}', 0, ${AT}),
  (3, 'owner@example.com', 1, 'title', '{"from":"a","to":"b"}', 0, ${AT});
`;

function binary(root) {
  if (process.env.P99_BIN) return process.env.P99_BIN;
  const built = ["release", "debug"]
    .map((profile) => join(root, "..", "target", profile, "p99"))
    .filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (built.length === 0) throw new Error("no p99 binary to drive; run cargo build first or set P99_BIN");
  return built[0];
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function d1(root, upTo) {
  const db = new DatabaseSync(":memory:");
  if (upTo === null) return db;
  const dir = join(root, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f < upTo)
    .sort();
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  for (const f of files) {
    db.exec(readFileSync(join(dir, f), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(f);
  }
  return db;
}

function cloudflare(state) {
  const reply = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (c) => chunks.push(c));
    request.on("end", () => {
      const path = request.url.split("?")[0];
      if (request.headers.authorization !== "Bearer test-token") return reply(response, 403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
      if (request.method === "POST" && /\/d1\/database\/[^/]+\/query$/.test(path)) {
        const { sql, params = [] } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        state.sql.push(sql);
        try {
          const single = /^\s*SELECT\b/i.test(sql) && !sql.trim().replace(/;$/, "").includes(";");
          const batch = () => {
            state.db.exec("BEGIN");
            try {
              state.db.exec(sql);
              state.db.exec("COMMIT");
            } catch (error) {
              state.db.exec("ROLLBACK");
              throw error;
            }
            return [];
          };
          const results = params.length > 0 || single ? state.db.prepare(sql).all(...params) : batch();
          return reply(response, 200, { success: true, result: [{ results, success: true, meta: {} }] });
        } catch (error) {
          return reply(response, 400, { success: false, errors: [{ code: 7500, message: `${error.message}: SQLITE_ERROR` }] });
        }
      }
      if (request.method === "GET" && path.endsWith("/workers/scripts/p99/settings")) {
        return reply(response, 200, {
          success: true,
          result: { bindings: [{ type: "ratelimit", name: "RATE", namespace_id: "1001", simple: { limit: 120, period: 60 } }] },
        });
      }
      if (request.method === "GET" && path.endsWith("/workers/scripts")) {
        return reply(response, 200, { success: true, result: [{ id: "p99", migration_tag: "p99-hub-1" }] });
      }
      if (request.method === "GET" && path.endsWith("/secrets")) {
        return reply(response, 200, { success: true, result: [{ name: "CODE_PEPPER" }] });
      }
      if (request.method === "PUT" && path.endsWith("/workers/scripts/p99")) state.uploads += 1;
      return reply(response, 200, { success: true, result: request.method === "GET" ? [] : {}, result_info: { total_pages: 1 } });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function migrateChecks({ check, root, work }) {
  const dir = join(work, "migrate");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "home"), { recursive: true });
  const config = join(dir, "config.toml");
  writeFileSync(
    config,
    [
      'default_account = "local"',
      "[me]",
      'name = "Ada Lovelace"',
      'email = "ada@example.com"',
      "[accounts.local]",
      'account_id = "acc"',
      'database_id = "db"',
      'token = ""',
      'key = "unused"',
      'url = "https://p99.example.com/_p99"',
      "",
    ].join("\n"),
  );
  chmodSync(config, 0o600);
  const state = { db: d1(root, "0011"), sql: [], uploads: 0 };
  state.db.exec(SEED_18);
  const server = await cloudflare(state);
  const p99 = binary(root);
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(p99, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: join(dir, "home"),
          XDG_CONFIG_HOME: join(dir, "home"),
          XDG_RUNTIME_DIR: join(dir, "home"),
          P99_CONFIG: config,
          P99_TOKEN: "test-token",
          P99_CLOUDFLARE_API: `http://127.0.0.1:${server.address().port}`,
          NO_COLOR: "1",
        },
      });
      const out = { stdout: "", stderr: "" };
      child.stdout.on("data", (c) => (out.stdout += c));
      child.stderr.on("data", (c) => (out.stderr += c));
      const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
      child.on("error", reject);
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve({ ...out, status });
      });
    });
  const plan = async () => {
    state.sql = [];
    const out = await run(["migrate", "--plan", "--json"]);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(state.sql.length > 0);
    for (const sql of state.sql) assert.match(sql, /^SELECT /, sql);
    return JSON.parse(out.stdout);
  };
  const writes = () => state.sql.filter((sql) => !/^SELECT /.test(sql));

  try {
    let first;
    await check("migrate --plan reads a seeded 1.8 database with SELECTs only and names every change and decision", async () => {
      first = await plan();
      const p = first.plan;
      assert.equal(first.hash, createHash("sha256").update(canonical(p)).digest("hex"));
      assert.deepEqual(p.pending.map((n) => n.slice(0, 4)), ["0011", "0012", "0013", "0016", "0017"]);
      assert.deepEqual(
        p.labels.map((l) => [l.status, l.label, l.open, l.items]),
        [["inbox", "Inbox", 4, 4], ["doing", "Doing", 1, 1], ["review", "QA", 1, 1], ["done", "Done", 0, 1]],
      );
      assert.deepEqual(p.owner, { email: "ada@example.com", name: "Ada Lovelace" });
      assert.deepEqual(p.boards.map((b) => [b.slug, b.parent, b.items]), [["example-com", null, 3], ["shop-example-com", null, 1], ["checkout", "shop-example-com", 2], ["roadmap", null, 1]]);
      assert.equal(p.nested, 1);
      assert.deepEqual(p.order, [{ board: "example-com", label: "Inbox", cards: 3, moves: 3 }]);
      assert.deepEqual(p.tags, [{ tag: "qa", items: 1 }, { tag: "ux", items: 2 }]);
      assert.equal(p.tagged, 3);
      assert.deepEqual(p.members.map((m) => [m.email, m.changes]), [["grace@example.com", 1], ["jo@example.com", 1]]);
      assert.deepEqual(p.collisions, [{ label: "QA", with: "qa", kind: "tag" }]);
      assert.equal(p.people.rows, 5);
      assert.deepEqual(
        p.people.usernames.map((u) => [u.email, u.username, u.why]),
        [["ada.l@example.com", "ada.lovelace2", "numbered"], ["jo@example.com", "member", "member"], ["new@example.com", "new", "e-mail"]],
      );
      assert.deepEqual(p.agents.map((a) => [a.email, a.shown]), [["ada@example.com", "@ada.lovelace 🤖"], ["grace@example.com", "@grace.hopper 🤖"], ["owner@example.com", null]]);
      assert.deepEqual(p.kinds.map((k) => [k.prefix, k.items]), [["BUG", 3], ["FEAT", 1], ["IMP", 1], ["Q", 1], ["TASK", 1]]);
      assert.deepEqual(p.hosts[0], { host: "example.com", env: "production", above: "#footer", off: ["/admin"] });
      assert.equal(p.url, "https://p99.example.com/_p99");
      assert.equal(p.decisions.length, 5, p.decisions.join("\n"));
      assert.doesNotMatch(p.decisions.join("\n"), /a person may have/);
      assert.match(p.people.digest, /^[0-9a-f]{64}$/);
      assert.equal((await plan()).hash, first.hash);
      const text = await run(["migrate", "--plan"]);
      assert.match(text.stdout, new RegExp(`Plan hash: ${first.hash}\n`));
    });

    await check("deploy refuses gated migrations without the plan's hash, and a stale hash once the data moved, writing nothing", async () => {
      state.sql = [];
      const bare = await run(["deploy", "--no-check"]);
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /^p99: 0011.*--accept-plan <hash>\n$/);
      assert.deepEqual(writes(), []);
      state.db.exec("INSERT INTO item_labels (item_id, label_id) VALUES (3, 1);");
      const stale = await run(["deploy", "--no-check", "--accept-plan", first.hash]);
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /the plan changed since that hash was taken/);
      assert.deepEqual(writes(), []);
      assert.equal(state.uploads, 0);
    });

    await check("deploy applies the gated migrations with the current plan's hash, and an account past them or new needs none", async () => {
      const now = await plan();
      assert.notEqual(now.hash, first.hash);
      const ok = await run(["--json", "deploy", "--no-check", "--accept-plan", now.hash]);
      assert.equal(ok.status, 0, ok.stderr);
      const report = JSON.parse(ok.stdout);
      assert.equal(report.migrations.accepted, now.hash);
      assert.equal(state.uploads, 1);
      const names = state.db.prepare("SELECT name FROM d1_migrations").all().map((r) => r.name);
      const bundled = JSON.parse((await run(["--json", "bundle"])).stdout).migrations;
      assert.deepEqual(bundled.filter((n) => !names.includes(n)), []);
      if (state.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'people'").get()) {
        const people = Object.fromEntries(state.db.prepare("SELECT email, username FROM people").all().map((r) => [r.email, r.username]));
        for (const u of now.plan.people.usernames) assert.equal(people[u.email], u.username, u.email);
        for (const a of now.plan.agents.filter((a) => a.shown)) assert.equal(a.shown, `@${people[a.email]} 🤖`);
      }
      const again = await run(["deploy", "--no-check"]);
      assert.equal(again.status, gatedBundled(bundled) ? 0 : 1, again.stderr);
      const past = (await plan()).plan;
      assert.equal(past.old_tags, undefined);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM item_labels").get().n, 0);
      assert.doesNotMatch((await run(["migrate", "--plan"])).stdout, /Old tags beyond the label/);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n, 0);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'archived'").get().n, 0);
      state.db = d1(root, null);
      const fresh = await run(["deploy", "--no-check"]);
      assert.equal(fresh.status, 0, fresh.stderr);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM d1_migrations").get().n, bundled.length);
    });

    let old;
    await check("migrate --plan reads a seeded 1.7 database and maps every 1.7 status to its 1.9 label and stage with exact counts", async () => {
      state.db = d1(root, "0004");
      state.db.exec(SEED_17);
      old = await plan();
      const p = old.plan;
      assert.equal(old.hash, createHash("sha256").update(canonical(p)).digest("hex"));
      assert.deepEqual(p.pending.map((n) => n.slice(0, 4)), ["0004", "0011", "0012", "0013", "0016", "0017"]);
      assert.deepEqual(
        p.statuses.map((s) => [s.status, s.label, s.stage, s.open, s.items]),
        [
          ["new", "Inbox", "received", 2, 2],
          ["confirmed", "Doing", "in_progress", 1, 1],
          ["in_progress", "Doing", "in_progress", 1, 1],
          ["waiting", "Review", "in_progress", 1, 1],
          ["resolved", "Done", "fixed", 0, 2],
          ["abandoned", "Done", "dropped", 0, 1],
          ["duplicate", "Done", "duplicate", 0, 1],
        ],
      );
      assert.equal(p.labels, undefined);
      assert.deepEqual(p.owner, { email: "ada@example.com", name: "Ada Lovelace" });
      assert.deepEqual(p.boards.map((b) => [b.name, b.items]), [["example.com", 5], ["old.example.com", 1], ["shop.example.com", 3]]);
      assert.deepEqual(p.members.map((m) => [m.email, m.changes]), [["grace@example.com", 1]]);
      assert.equal(p.people.rows, 5);
      assert.deepEqual(
        p.people.usernames.map((u) => [u.email, u.username, u.why]),
        [["jo@example.com", "member", "member"], ["new@example.com", "new", "e-mail"]],
      );
      assert.deepEqual(p.agents.map((a) => [a.email, a.shown]), [["ada@example.com", "@ada.lovelace 🤖"], ["owner@example.com", null]]);
      assert.deepEqual(p.kinds.map((k) => [k.prefix, k.items, k.open]), [["BUG", 5, 2], ["FEAT", 1, 1], ["IMP", 1, 0], ["Q", 1, 1], ["TASK", 1, 1]]);
      assert.deepEqual(p.hosts[0], { host: "example.com", env: "production", above: "#footer", off: ["/admin"] });
      assert.equal(p.decisions.length, 3, p.decisions.join("\n"));
      assert.match(p.decisions.join("\n"), /old\.example\.com, which their code doesn't cover/);
      const text = await run(["migrate", "--plan"]);
      assert.match(text.stdout, /new {10}-> Inbox {3}received {5}2 open, 2 in all\n/);
      assert.match(text.stdout, new RegExp(`Plan hash: ${old.hash}\n`));
    });

    await check("deploy refuses a 1.7 account without its plan's hash or with another plan's, writing nothing", async () => {
      const uploads = state.uploads;
      state.sql = [];
      const bare = await run(["deploy", "--no-check"]);
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /^p99: 0004_boards\.sql, 0011.*--accept-plan <hash>\n$/);
      const other = await run(["deploy", "--no-check", "--accept-plan", first.hash]);
      assert.equal(other.status, 1);
      assert.match(other.stderr, /the plan changed since that hash was taken/);
      state.db.exec("UPDATE items SET status = 'confirmed' WHERE id = 1;");
      const moved = await run(["deploy", "--no-check", "--accept-plan", old.hash]);
      assert.equal(moved.status, 1);
      assert.match(moved.stderr, /the plan changed since that hash was taken/);
      state.db.exec("UPDATE items SET status = 'new' WHERE id = 1;");
      assert.deepEqual(writes(), []);
      assert.equal(state.uploads, uploads);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM d1_migrations").get().n, 3);
      assert.equal((await plan()).hash, old.hash);
    });

    await check("deploy with the 1.7 plan's hash lands every item on the label and lane the plan named, then deletes the old boards and labels", async () => {
      const ok = await run(["--json", "deploy", "--no-check", "--accept-plan", old.hash]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(JSON.parse(ok.stdout).migrations.accepted, old.hash);
      const items = state.db
        .prepare("SELECT i.id, l.name AS label, i.resolution, i.open, i.duplicate_of FROM items i JOIN labels l ON l.id = i.label_id JOIN board_positions p ON p.item_id = i.id JOIN boards b ON b.id = p.board_id AND b.cards = 1 ORDER BY i.id")
        .all()
        .map((r) => [r.id, r.label, r.resolution, r.open, r.duplicate_of]);
      assert.deepEqual(items, [
        [1, "New", null, 1, null],
        [2, "New", null, 1, null],
        [3, "In progress", null, 1, null],
        [4, "In progress", null, 1, null],
        [5, "Landed", null, 1, null],
        [6, "Done", "fixed", 0, null],
        [7, "Done", "abandoned", 0, null],
        [8, "Done", "duplicate", 0, 6],
        [9, "Done", "fixed", 0, null],
      ]);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n, 0);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM board_positions p JOIN boards b ON b.id = p.board_id WHERE b.cards = 0").get().n, 0);
      const lane = state.db
        .prepare("SELECT p.item_id FROM board_positions p JOIN boards b ON b.id = p.board_id AND b.cards = 1 JOIN labels l ON l.id = p.label_id WHERE l.name = 'New' ORDER BY p.key")
        .all()
        .map((r) => r.item_id);
      assert.deepEqual(lane, [2, 1]);
      assert.deepEqual(state.db.prepare("SELECT name, owner FROM boards WHERE cards = 1").all().map((r) => [r.name, r.owner]), [["Cards", old.plan.owner.email]]);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'archived'").get().n, 0);
      assert.deepEqual(state.db.prepare("SELECT name FROM labels ORDER BY id").all().map((r) => r.name).sort(), [...LANE_NAMES].sort());
      const people = Object.fromEntries(state.db.prepare("SELECT email, username FROM people").all().map((r) => [r.email, r.username]));
      assert.equal(Object.keys(people).length, old.plan.people.rows);
      for (const u of old.plan.people.usernames) assert.equal(people[u.email], u.username, u.email);
      for (const a of old.plan.agents.filter((a) => a.shown)) assert.equal(a.shown, `@${people[a.email]} 🤖`);
    });

    await check("a 1.7 account whose managers are all revoked plans no owner, asks for a manager code, and deploys boards with none", async () => {
      state.db = d1(root, "0004");
      state.db.exec(SEED_17);
      state.db.exec(`UPDATE codes SET revoked_at = ${AT} WHERE manager = 1;`);
      const none = await plan();
      assert.equal(none.plan.owner, null);
      assert.match(none.plan.decisions.join("\n"), /no live Owner code exists to own the boards/);
      const ok = await run(["--json", "deploy", "--no-check", "--accept-plan", none.hash]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n, 0);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 1").get().n, 1);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE owner IS NOT NULL").get().n, 0);
    });

    await check("a deploy cut off between 0004 and 0005 picks up with this CLI: 0005 to 0010 go ahead, then the plan reads and gates the rest", async () => {
      state.db = d1(root, "0005");
      const uploads = state.uploads;
      state.sql = [];
      const bare = await run(["deploy", "--no-check"]);
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /^p99: 0011.*--accept-plan <hash>\n$/);
      const names = state.db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((r) => r.name.slice(0, 4));
      assert.deepEqual(names, ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"]);
      assert.equal(state.uploads, uploads);
      const now = await plan();
      assert.deepEqual(now.plan.pending.map((n) => n.slice(0, 4)), ["0011", "0012", "0013", "0016", "0017"]);
    });

    await check("a 1.11 account plans 0017 with SELECTs only, a refused deploy changes nothing, and the accepted one carries a stray item and leaves no archive", async () => {
      state.db = d1(root, "0016");
      state.db.exec(FOLD_SEED);
      state.db.exec(readFileSync(join(root, "migrations", "0016_one_board.sql"), "utf8"));
      state.db.prepare("INSERT INTO d1_migrations (name) VALUES ('0016_one_board.sql')").run();
      state.db.exec(`UPDATE items SET label_id = ${labelOf("Triage")} WHERE id = 6;`);
      const p = await plan();
      assert.deepEqual(p.plan.pending, ["0017_delete_archived.sql"]);
      assert.equal(p.plan.one_board, undefined);
      const prune = p.plan.delete_archived;
      assert.equal(prune.lanes, 7);
      assert.deepEqual(prune.boards.map((b) => [b.id, b.name, b.owner, b.columns, b.places]), [
        [11, "Ada's board", "ada@example.com", 4, 4],
        [12, "Grace's board", "grace@example.com", 4, 4],
        [13, "Ada's QA", "ada@example.com", 3, 2],
      ]);
      assert.deepEqual(prune.labels.filter((l) => l.items > 0), [{ label: "Triage", items: 1, open: 1, closed: 0 }]);
      assert.equal(prune.tags, 1);
      assert.equal(p.plan.old_tags, undefined);
      assert.ok(p.plan.decisions.some((d) => d.startsWith("1 item on the old label Triage is not on the one board: 0017 moves 1 open to In progress")), p.plan.decisions.join("\n"));
      const text = (await run(["migrate", "--plan"])).stdout;
      assert.match(text, /\nDelete what the one board carries \(0017\)\n/);
      assert.match(text, /  deleted: 3 old boards \(Ada's board \(ada@example\.com\), Grace's board \(grace@example\.com\), Ada's QA \(ada@example\.com\)\), with their 11 columns and 10 card places\n/);
      assert.doesNotMatch(text, /archived,|archived labels|read-only/);
      assert.doesNotMatch(text, /Old tags beyond the label/);
      assert.match(text, /  deleted old tags: 1 \(item_labels rows nothing reads\)\n/);

      const snapshot = () => ["boards", "board_columns", "board_positions", "labels", "items", "events", "item_labels", "archived"].map((t) => state.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
      const before = snapshot();
      const uploads = state.uploads;
      state.sql = [];
      const bare = await run(["deploy", "--no-check"]);
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /^p99: 0017_delete_archived\.sql change this account's data: .*--accept-plan <hash>\n$/);
      assert.deepEqual(writes(), []);
      assert.deepEqual(snapshot(), before);
      assert.equal(state.uploads, uploads);
      const wrong = await run(["deploy", "--no-check", "--accept-plan", "0".repeat(64)]);
      assert.equal(wrong.status, 1);
      assert.deepEqual(writes(), []);
      assert.deepEqual(snapshot(), before);

      const ok = await run(["--json", "deploy", "--no-check", "--accept-plan", p.hash]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(state.uploads, uploads + 1);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n, 0);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'archived'").get().n, 0);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM item_labels").get().n, 0);
      assert.deepEqual(state.db.prepare("SELECT name FROM labels").all().map((r) => r.name).sort(), [...LANE_NAMES].sort());
      assert.equal(state.db.prepare("SELECT l.name FROM items i JOIN labels l ON l.id = i.label_id WHERE i.id = 6").get().name, "In progress");
      const history = state.db.prepare("SELECT detail_json FROM events WHERE item_id = 6 AND kind = 'label' ORDER BY id").all().map((e) => JSON.parse(e.detail_json));
      assert.deepEqual(history, [{ from: "Triage", to: "In progress", migrated: true }, { from: "Triage", to: "In progress", migrated: true }]);
      assert.equal(state.db.prepare("SELECT count(*) AS n FROM events").get().n, before[5].length + 1);
      const after = await plan();
      assert.deepEqual(after.plan.pending, []);
      assert.equal(after.plan.delete_archived, undefined);
      const again = await run(["deploy", "--no-check"]);
      assert.equal(again.status, 0, again.stderr);
    });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

function gatedBundled(bundled) {
  return ["0011", "0012", "0013", "0016", "0017"].every((g) => bundled.some((n) => n.startsWith(`${g}_`)));
}

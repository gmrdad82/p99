import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANES, LANE_NAMES } from "../src/cards.js";

const AT = (day) => `'2026-02-${String(day).padStart(2, "0")}T09:00:00.000Z'`;
const WWW = "www.example.com";
export const BUSIEST = "dev.example.com";
const STAGING = "staging.example.com";
const OPEN = 70;
const MERGED = { 71: 5, 72: 12, 73: 40 };
const PEOPLE = [
  ["Margaret Hamilton", "margaret@example.com"],
  ["Katherine Johnson", "katherine@example.com"],
  ["Alan Turing", "alan@example.com"],
];
const THREAD = ["comments", "attachments", "mail_optouts", "reads", "people", "codes", "hosts"];

const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const row = (table, values) => `INSERT INTO ${table} (${Object.keys(values).join(", ")}) VALUES (${Object.values(values).map(q).join(", ")});`;

const kindOf = (id) => (id === 7 ? "bug" : id === 33 ? "improvement" : "question");
const hostOf = (id) => (id > OPEN ? WWW : id % 10 === 0 ? WWW : id % 23 === 0 ? STAGING : BUSIEST);
const rankOf = (id) => (id * 29) % 71;
const keyOf = (id) => `${{ bug: "BUG", improvement: "IMP", question: "Q" }[kindOf(id)]}-${id}`;

function seedSql() {
  const out = [
    row("hosts", { host: WWW, env: "production", config_json: "{}", created_at: "2026-02-01T09:00:00.000Z" }),
    row("hosts", { host: BUSIEST, env: "staging", config_json: "{}", created_at: "2026-02-01T09:00:00.000Z" }),
    row("hosts", { host: STAGING, env: "staging", config_json: "{}", created_at: "2026-02-01T09:00:00.000Z" }),
    `INSERT INTO codes (id, hash, hint, name, email, hosts_json, manager, created_at, created_by) VALUES
      (1, 'w1', 'a', 'Ada Lovelace', 'ada@example.com', '["*"]', 1, ${AT(1)}, 'setup'),
      (2, 'w2', 'b', 'Grace Hopper', 'grace@example.com', '["${WWW}","${BUSIEST}","${STAGING}"]', 1, ${AT(1)}, 'ada@example.com');`,
    `INSERT INTO people (email, username, created_at) VALUES ('ada@example.com', 'ada', ${AT(1)}), ('grace@example.com', 'grace', ${AT(1)});`,
    `INSERT INTO boards (id, name, host, owner, created_at, updated_at, cards) VALUES
      (21, '${WWW}', '${WWW}', 'grace@example.com', ${AT(1)}, ${AT(1)}, 0),
      (22, '${BUSIEST}', '${BUSIEST}', 'ada@example.com', ${AT(2)}, ${AT(2)}, 0),
      (23, '${STAGING}', '${STAGING}', 'grace@example.com', ${AT(3)}, ${AT(3)}, 0);`,
  ];
  for (const board of [21, 22, 23]) {
    ["Inbox", "Doing", "Review", "Done"].forEach((name, at) =>
      out.push(`INSERT INTO board_columns (board_id, label_id, position) VALUES (${board}, (SELECT id FROM labels WHERE name = '${name}'), ${at});`),
    );
  }
  let comment = 0;
  for (let id = 1; id <= OPEN + 3; id++) {
    const open = id <= OPEN;
    const label = id === 7 ? "Doing" : open ? "Inbox" : "Done";
    const [name, email] = PEOPLE[id % PEOPLE.length];
    const host = hostOf(id);
    const day = 2 + (id % 20);
    const notes = id % 3 === 0 ? 1 : 0;
    const files = id % 5 === 0 ? 1 : 0;
    out.push(
      `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title, reporter_email,
        reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text, comment_count,
        public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at, created_at, updated_at, closed_at,
        resolution, project, reporter_via) VALUES (${id}, 'webram-${id}', '${kindOf(id)}', (SELECT id FROM labels WHERE name = '${label}'), ${open ? 1 : 0},
        ${q(`Question ${id} about the order form`)}, ${q(`Line one of ${id}.\nLine two, with "quotes" and a café.`)}, 'production', '${host}',
        'https://${host}/order?step=${id}', '/order', 'Order', '${email}', '${name}', '{"lang":"ro"}', 0,
        ${id === 7 ? "'ada@example.com'" : id % 4 === 0 ? "'grace@example.com'" : "NULL"}, ${MERGED[id] ?? "NULL"},
        '{"viewport":{"w":1280,"h":800}}', '[]', 'question ${id}', ${2 + notes}, 2, ${1 + files}, ${1 + files},
        ${AT(day + 1)}, ${AT(day + 1)}, ${AT(day)}, ${AT(day + 1)}, ${open ? "NULL" : AT(day + 1)}, ${open ? "NULL" : "'duplicate'"}, NULL, NULL);`,
    );
    out.push(
      row("comments", { item_id: id, client_uid: `webram-c${++comment}`, author_email: "ada@example.com", author_name: "Ada Lovelace", author_manager: 1, body: `Thanks, looking at ${id}.`, internal: 0, origin_env: "production", author_agent: 0, created_at: `2026-02-${String(day).padStart(2, "0")}T10:00:00.000Z`, author_via: null }),
    );
    const reply = comment + 1;
    out.push(
      row("comments", { item_id: id, client_uid: `webram-c${++comment}`, author_email: email, author_name: name, author_manager: 0, body: `> Thanks, looking at ${id}.\n\nStill happens on mobile.`, internal: 0, origin_env: "production", author_agent: 0, created_at: `2026-02-${String(day).padStart(2, "0")}T11:00:00.000Z`, author_via: null }),
    );
    if (notes) out.push(row("comments", { item_id: id, client_uid: `webram-c${++comment}`, author_email: "grace@example.com", author_name: "Grace Hopper", author_manager: 1, body: "Internal: same as the cart bug.", internal: 1, origin_env: "production", author_agent: 1, created_at: `2026-02-${String(day).padStart(2, "0")}T12:00:00.000Z`, author_via: "pci·board" }));
    out.push(row("attachments", { item_id: id, client_uid: `webram-a${id}`, comment_id: null, internal: 0, role: "screenshot", mark: null, name: "screen.png", type: "image/png", bytes: 20480 + id, sha256: String(id).padStart(64, "0"), r2_key: `att/${id}/screen.png`, actor_email: email, origin_env: "production", created_at: `2026-02-${String(day).padStart(2, "0")}T09:00:00.000Z`, stored_at: `2026-02-${String(day).padStart(2, "0")}T09:00:01.000Z`, stored_token: null }));
    if (files) out.push(`INSERT INTO attachments (item_id, client_uid, comment_id, internal, role, mark, name, type, bytes, sha256, r2_key, actor_email, origin_env, created_at, stored_at, stored_token) VALUES (${id}, 'webram-f${id}', (SELECT id FROM comments WHERE client_uid = 'webram-c${reply}'), 0, 'file', NULL, 'log.txt', 'text/plain', 512, '${String(id).padStart(64, "f")}', 'att/${id}/log.txt', '${email}', 'production', ${AT(day)}, ${AT(day)}, NULL);`);
    const event = (kind, detail, extra = {}) => out.push(row("events", { item_id: id, actor_email: "ada@example.com", actor_agent: 0, kind, detail_json: JSON.stringify(detail), internal: 0, at: `2026-02-${String(day).padStart(2, "0")}T13:00:00.000Z`, actor_via: null, ...extra }));
    event("mail", { to: email, template: "reply", ok: true, status: "sent" }, { internal: 1 });
    if (id % 6 === 0) {
      event("label", { from: "Inbox", to: "Review" });
      event("label", { from: "Review", to: "Inbox" });
    }
    if (id === 7) event("label", { from: "Inbox", to: "Doing" });
    if (id === 7 || id % 4 === 0) event("assign", { from: null, to: id === 7 ? "ada@example.com" : "grace@example.com" });
    if (!open) event("merge", { into: keyOf(MERGED[id]) });
    if (id <= OPEN) {
      out.push(`INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (22, ${id}, (SELECT id FROM labels WHERE name = '${label}'), 'k${String(rankOf(id)).padStart(3, "0")}');`);
      if (host === WWW) out.push(`INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (21, ${id}, (SELECT id FROM labels WHERE name = '${label}'), 'k${String(100 - id).padStart(3, "0")}');`);
    } else {
      out.push(`INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (22, ${id}, (SELECT id FROM labels WHERE name = 'Done'), 'd${id}');`);
    }
    if (id % 9 === 0) out.push(row("reads", { actor_email: "ada@example.com", item_id: id, read_at: `2026-02-${String(day).padStart(2, "0")}T14:00:00.000Z` }));
  }
  out.push(row("mail_optouts", { item_id: 12, email: PEOPLE[0][1], at: "2026-02-20T09:00:00.000Z" }));
  return out.join("\n");
}

function all(db, sql) {
  return db.prepare(sql).all().map((r) => ({ ...r }));
}

function snapshot(db) {
  const out = Object.fromEntries(THREAD.map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY rowid`)]));
  out.items = all(db, "SELECT * FROM items ORDER BY id").map(({ label_id, ...rest }) => rest);
  out.events = all(db, "SELECT * FROM events ORDER BY id");
  out.followers = all(db, "SELECT duplicate_of, reporter_email FROM items WHERE duplicate_of IS NOT NULL ORDER BY id");
  return out;
}

function lanesOf(db) {
  return Object.fromEntries(
    all(db, "SELECT i.id, l.name FROM items i JOIN labels l ON l.id = i.label_id ORDER BY i.id").map((r) => [r.id, r.name]),
  );
}

function laneOrder(db, name) {
  return all(
    db,
    `SELECT bp.item_id FROM board_positions bp JOIN boards b ON b.id = bp.board_id AND b.cards = 1 JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
     JOIN labels l ON l.id = i.label_id WHERE l.name = '${name}' ORDER BY bp.key`,
  ).map((r) => r.item_id);
}

function columnOrder(db, board, name) {
  return all(
    db,
    `SELECT bp.item_id FROM board_positions bp JOIN labels l ON l.id = bp.label_id JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
     WHERE bp.board_id = ${board} AND l.name = '${name}' ORDER BY bp.key`,
  ).map((r) => r.item_id);
}

function n(db, sql) {
  return db.prepare(sql).get().n;
}

export function dumpSql(db) {
  const out = ["PRAGMA defer_foreign_keys = true;"];
  const tables = all(db, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid");
  for (const t of tables) out.push(`${t.sql};`);
  for (const t of tables) for (const r of all(db, `SELECT * FROM "${t.name}" ORDER BY rowid`)) out.push(row(`"${t.name}"`, r));
  for (const i of all(db, "SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY rowid")) out.push(`${i.sql};`);
  return out.join("\n");
}

export async function webramChecks({ check, root, work, state, run, plan, writes, d1 }) {
  const fixture = () => {
    state.db = d1(root, "0016");
    state.db.exec(seedSql());
    return state.db;
  };

  await check("[webram] three hosts' boards and 70 items with whole threads: 0016 then 0017 in one deploy keep every thread byte for byte, the busiest board's order, and leave no archive", async () => {
    const db = fixture();
    const before = snapshot(db);
    const labels = lanesOf(db);
    const order = { New: columnOrder(db, 22, "Inbox"), "In progress": columnOrder(db, 22, "Doing") };
    assert.equal(before.items.length, OPEN + 3);
    assert.deepEqual(
      Object.entries(before.items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + (i.open ? 1 : 0) }), {})).sort(),
      [["bug", 1], ["improvement", 1], ["question", 68]],
    );
    assert.equal(order.New.length, 69);
    assert.notDeepEqual(order.New, [...order.New].sort((a, b) => a - b));

    const p = await plan();
    assert.deepEqual(p.plan.pending, ["0016_one_board.sql", "0017_delete_archived.sql"]);
    const fold = p.plan.one_board;
    assert.equal(fold.cards_board, "make");
    assert.deepEqual(
      fold.labels.filter((l) => l.items > 0).map((l) => [l.label, l.open, l.to]),
      [["Doing", 1, "in-progress"], ["Inbox", 69, "new"]],
    );
    assert.deepEqual(fold.boards.filter((b) => b.placed > 0).map((b) => [b.name, b.placed]), [[BUSIEST, 73]]);
    const counts = p.plan.count_check;
    const moved = 70;
    assert.deepEqual(counts.before, {
      items: 73,
      comments: before.comments.length,
      attachments: before.attachments.length,
      events: before.events.length,
      labels: [{ label: "Doing", items: 1 }, { label: "Done", items: 3 }, { label: "Inbox", items: 69 }],
    });
    assert.deepEqual(counts.after, {
      items: 73,
      comments: before.comments.length,
      attachments: before.attachments.length,
      events: before.events.length + moved,
      lanes: LANE_NAMES.map((lane) => ({ lane, items: { New: 69, "In progress": 1, Done: 3 }[lane] ?? 0 })),
    });
    const text = (await run(["migrate", "--plan"])).stdout;
    assert.match(text, new RegExp(`\nCount check\n  before: 73 items, ${before.comments.length} comments, ${before.attachments.length} attachments, ${before.events.length} events\n`));
    assert.match(text, /\n  before, by label: Doing 1, Done 3, Inbox 69\n/);
    assert.match(text, new RegExp(`\n  after:  73 items, ${before.comments.length} comments, ${before.attachments.length} attachments, ${before.events.length + moved} events\n`));
    assert.match(text, /\n  after, by lane: New 69, In progress 1, Done 3\n/);
    assert.match(text, /\n  the order in each lane: dev\.example\.com \(ada@example\.com\) 73 cards\n/);
    assert.doesNotMatch(text, /archived labels|archived boards|archived, read-only|read-only/);

    const uploads = state.uploads;
    const ok = await run(["--json", "deploy", "--no-check", "--accept-plan", p.hash]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout).migrations.applied, ["0016_one_board.sql", "0017_delete_archived.sql"]);
    assert.equal(state.uploads, uploads + 1);
    const guarded = state.sql.find((sql) => sql.includes("INSERT INTO d1_migrations (name) VALUES ('0017_delete_archived.sql')"));
    assert.match(guarded, /CONSTRAINT count_check_events CHECK \(events = \d+\)/);
    assert.equal(n(db, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'count_check'"), 0);

    const after = snapshot(db);
    for (const t of [...THREAD, "items", "followers"]) assert.deepEqual(after[t], before[t], t);
    assert.deepEqual(after.events.slice(0, before.events.length), before.events);
    const added = after.events.slice(before.events.length);
    assert.equal(added.length, moved);
    const lanes = lanesOf(db);
    const word = Object.fromEntries(fold.labels.map((l) => [l.label, l.to]));
    for (const [id, was] of Object.entries(labels)) {
      const now = lanes[id];
      if (was === "Done") {
        assert.equal(now, "Done", id);
        continue;
      }
      assert.equal(LANES[LANE_NAMES.indexOf(now)], word[was], `item ${id}`);
      assert.deepEqual(
        added.filter((e) => e.item_id === Number(id)).map((e) => [e.kind, JSON.parse(e.detail_json)]),
        [["label", { from: was, to: now, migrated: true }]],
        `item ${id}`,
      );
    }
    assert.deepEqual(laneOrder(db, "New"), order.New);
    assert.deepEqual(laneOrder(db, "In progress"), order["In progress"]);
    assert.deepEqual(laneOrder(db, "Done").sort(), [71, 72, 73]);
    assert.deepEqual(all(db, "SELECT name, host FROM boards").map((b) => [b.name, b.host]), [["Cards", null]]);
    assert.equal(n(db, "SELECT count(*) AS n FROM board_columns WHERE board_id NOT IN (SELECT id FROM boards WHERE cards = 1)"), 0);
    assert.equal(n(db, "SELECT count(*) AS n FROM board_positions WHERE board_id NOT IN (SELECT id FROM boards WHERE cards = 1)"), 0);
    assert.deepEqual(all(db, "SELECT name FROM labels ORDER BY name").map((l) => l.name), [...LANE_NAMES].sort());
    assert.equal(n(db, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'archived'"), 0);
    assert.equal(n(db, "SELECT count(*) AS n FROM item_labels"), 0);

    const again = await run(["--json", "deploy", "--no-check"]);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout).migrations.applied, []);
    assert.deepEqual(snapshot(db), after);

    writeFileSync(join(work, "webram.sql"), dumpSql(db));
    const visible = (host) => order.New.filter((id) => hostOf(id) === host).map(keyOf);
    writeFileSync(
      join(work, "webram.json"),
      JSON.stringify({ new: visible(BUSIEST), "in-progress": order["In progress"].map(keyOf) }),
    );
  });

  await check("[webram] a count that differs after 0017 refuses the deploy: 0016 and 0017 roll back together, the 1.10 Worker still running reads its boards as before, nothing is uploaded, and the next plan runs both again", async () => {
    const db = fixture();
    const p = await plan();
    const comments = n(db, "SELECT count(*) AS n FROM comments");
    db.exec("CREATE TRIGGER lose_a_note AFTER DELETE ON boards BEGIN DELETE FROM comments WHERE id = (SELECT max(id) FROM comments WHERE internal = 1); END;");
    const was = dumpSql(db);
    const columns = [21, 22, 23].map((board) => ["Inbox", "Doing", "Review", "Done"].map((name) => columnOrder(db, board, name)));
    assert.equal(columns[1][0].length, 69);
    const uploads = state.uploads;
    state.sql = [];
    const refused = await run(["deploy", "--no-check", "--accept-plan", p.hash]);
    assert.equal(refused.status, 1);
    assert.equal(
      refused.stderr,
      `p99: the count check stopped 0017: the comments no longer count ${comments} as the plan said, so every migration of this deploy rolled back: the database is as the deploy found it and the Worker is not uploaded; read \`p99 migrate --plan\` again\n`,
    );
    assert.equal(state.uploads, uploads);
    const sent = writes().filter((sql) => sql.includes("INSERT INTO d1_migrations"));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].indexOf("('0016_one_board.sql')") < sent[0].indexOf("CREATE TABLE count_check"));
    assert.equal(dumpSql(db), was);
    assert.deepEqual(all(db, "SELECT name FROM d1_migrations WHERE name >= '0016'"), []);
    assert.deepEqual([21, 22, 23].map((board) => ["Inbox", "Doing", "Review", "Done"].map((name) => columnOrder(db, board, name))), columns);
    assert.equal(n(db, "SELECT count(*) AS n FROM boards WHERE cards = 1"), 0);
    assert.equal(n(db, "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'prune\\_%' ESCAPE '\\' OR name = 'count_check'"), 0);

    db.exec("DROP TRIGGER lose_a_note;");
    const next = await plan();
    assert.deepEqual(next.plan.pending, ["0016_one_board.sql", "0017_delete_archived.sql"]);
    assert.deepEqual(next.plan.count_check, p.plan.count_check);
    assert.equal(next.hash, p.hash);
    const ok = await run(["deploy", "--no-check", "--accept-plan", next.hash]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(n(db, "SELECT count(*) AS n FROM comments"), comments);
    assert.equal(n(db, "SELECT count(*) AS n FROM boards WHERE cards = 0"), 0);
    assert.equal(n(db, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'archived'"), 0);
  });

  await check("[webram] a lane count that differs after 0017 names the lane in the refusal", async () => {
    const db = fixture();
    const p = await plan();
    db.exec(
      "CREATE TRIGGER drift AFTER DELETE ON boards BEGIN UPDATE items SET label_id = (SELECT id FROM labels WHERE name = 'Planned') WHERE id = (SELECT min(id) FROM items WHERE open = 1 AND label_id = (SELECT id FROM labels WHERE name = 'New')); END;",
    );
    const refused = await run(["deploy", "--no-check", "--accept-plan", p.hash]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^p99: the count check stopped 0017: the items in New no longer count 69 as the plan said, so every migration of this deploy rolled back: the database is as the deploy found it/);
    assert.equal(n(db, "SELECT count(*) AS n FROM boards WHERE cards = 0"), 3);
    assert.equal(n(db, "SELECT count(*) AS n FROM boards WHERE cards = 1"), 0);
    assert.deepEqual(all(db, "SELECT name FROM d1_migrations WHERE name >= '0016'"), []);
    assert.equal(writes().some((sql) => sql.includes("count_check_lane_0")), true);
  });
}

export async function webramBoardChecks({ check, browse, mint, work }) {
  const want = JSON.parse(readFileSync(join(work, "webram.json"), "utf8"));
  await check("[webram] the one board reads from the busiest host's panel with an Owner code in its old board's order, and its old boards are gone", async () => {
    const owner = await mint("Ada Lovelace", "ada@example.com", [BUSIEST], true);
    const read = await browse("GET", "/board", owner.secret);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.deepEqual(read.json.board.lanes.map((l) => l.word), LANES);
    for (const [status, keys] of Object.entries(want)) {
      assert.ok(keys.length > 0, status);
      assert.deepEqual(read.json.cards.filter((c) => c.status === status).map((c) => c.key), keys, status);
    }
    assert.ok(read.json.cards.every((c) => c.host === BUSIEST));
    for (const path of ["/boards/21", "/boards/22", "/boards/23"]) assert.equal((await browse("GET", path, owner.secret)).status, 404, path);
  });
}

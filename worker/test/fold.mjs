import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LANES, LANE_NAMES, useKit } from "../src/cards.js";
import {
  ARCHIVED_BOARDS,
  ARCHIVED_CARDS,
  BOARDS_DEPRECATED,
  BOARDS_GONE,
  LANES_SQL,
  LIVE_LABEL,
  anchorOf,
  archivedOf,
  boardCardOf,
  boardFilter,
  laneOf,
  lanesOf,
  oneBoardSql,
  sawLane,
} from "../src/one-board.js";

const AT = (day) => `'2026-01-0${day}T00:00:00.000Z'`;
const FOLD = "0016_one_board.sql";
const TABLES = ["archived", "board_columns", "board_positions", "boards", "codes", "events", "item_labels", "items", "labels"];

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const refused = (status, message) => (error) => error instanceof Refused && error.status === status && (message === undefined || error.message === message);

function unitKit() {
  useKit({
    clean: (value) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "") : value),
    fail: (status, message) => {
      throw new Refused(status, message);
    },
    keyOf: (kind, id) => `${{ bug: "BUG", feature: "FEAT", task: "TASK" }[kind] || "BUG"}-${id}`,
    parseKey: (raw) => {
      const m = /^(?:[A-Za-z]+-)?(\d{1,15})$/.exec(String(raw));
      return m ? Number(m[1]) : null;
    },
  });
}

function migrated(root, upTo) {
  const db = new DatabaseSync(":memory:");
  const dir = join(root, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < upTo).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

function fold(root, db) {
  db.exec(readFileSync(join(root, "migrations", FOLD), "utf8"));
}

function label(name) {
  return `(SELECT id FROM labels WHERE name = '${name}')`;
}

function item(id, name, { open = 1, resolution = null, project = null, host = "example.com", day = 1, kind = "bug", assignee = null } = {}) {
  return `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
    reporter_email, reporter_name, reporter_json, reporter_agent, assignee, context_json, marks_json, search_text, activity_at, public_activity_at,
    created_at, updated_at, closed_at, resolution, project)
    VALUES (${id}, 'fold-${id}', '${kind}', ${label(name)}, ${open}, 'Item ${id}', '', 'production', '${host}', 'https://${host}/', '/', '',
    'grace@example.com', 'Grace Hopper', '{}', 0, ${assignee ? `'${assignee}'` : "NULL"}, '{}', '[]', 'item ${id}', ${AT(day)}, ${AT(day)},
    ${AT(day)}, ${AT(day)}, ${open ? "NULL" : AT(day)}, ${resolution ? `'${resolution}'` : "NULL"}, ${project ? `'${project}'` : "NULL"});`;
}

function column(board, name, position) {
  return `INSERT INTO board_columns (board_id, label_id, position) VALUES (${board}, ${label(name)}, ${position});`;
}

function place(board, itemId, name, key) {
  return `INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (${board}, ${itemId}, ${label(name)}, '${key}');`;
}

const SEED = [
  `INSERT INTO codes (id, hash, hint, name, email, hosts_json, manager, created_at, created_by, revoked_at) VALUES
    (1, 'h1', 'a', 'Old Owner', 'old@example.com', '["*"]', 1, ${AT(1)}, 'setup', ${AT(2)}),
    (2, 'h2', 'b', 'Ada Lovelace', 'ada@example.com', '["*"]', 1, ${AT(1)}, 'setup', NULL),
    (3, 'h3', 'c', 'Grace Hopper', 'grace@example.com', '["example.com"]', 1, ${AT(1)}, 'ada@example.com', NULL),
    (4, 'h4', 'd', 'Jo', 'jo@example.com', '["example.com"]', 0, ${AT(1)}, 'ada@example.com', NULL);`,
  `INSERT INTO people (email, username, created_at) VALUES ('ada@example.com', 'ada', ${AT(1)}), ('grace@example.com', 'grace', ${AT(1)});`,
  `INSERT INTO labels (name, color, created_at, closes) VALUES
    ('QA ready', '#539bf5', ${AT(1)}, 0), ('Triage', '#986ee2', ${AT(1)}, 0), ('Shipped', '#57ab5a', ${AT(1)}, 1),
    ('New', '#539bf5', ${AT(4)}, 0), ('Planned', '#986ee2', ${AT(4)}, 0), ('In progress', '#c69026', ${AT(4)}, 0),
    ('Stuck', '#e5534b', ${AT(4)}, 0), ('Landed', '#39a5a0', ${AT(4)}, 0), ('legacy tag', '#57ab5a', ${AT(1)}, 0);`,
  `INSERT INTO boards (id, name, host, owner, created_at, updated_at, cards) VALUES
    (11, 'Ada''s board', NULL, 'ada@example.com', ${AT(1)}, ${AT(1)}, 0),
    (12, 'Grace''s board', 'example.com', 'grace@example.com', ${AT(2)}, ${AT(2)}, 0),
    (13, 'Ada''s QA', NULL, 'ada@example.com', ${AT(3)}, ${AT(3)}, 0),
    (14, 'Cards', NULL, 'grace@example.com', ${AT(4)}, ${AT(4)}, 1);`,
  column(11, "Inbox", 0),
  column(11, "Doing", 1),
  column(11, "QA ready", 2),
  column(11, "Done", 3),
  column(12, "Triage", 0),
  column(12, "Doing", 1),
  column(12, "Review", 2),
  column(12, "Shipped", 3),
  column(13, "QA ready", 0),
  column(13, "Review", 1),
  column(13, "Done", 2),
  ...["New", "Planned", "In progress", "Stuck", "Landed", "Done"].map((name, at) => column(14, name, at)),
  item(1, "Inbox", { day: 1 }),
  item(2, "Doing", { day: 1, assignee: "ada@example.com" }),
  item(3, "Review", { day: 1 }),
  item(4, "Done", { open: 0, resolution: "fixed", day: 1 }),
  item(5, "QA ready", { day: 2 }),
  item(6, "Triage", { day: 2 }),
  item(7, "Shipped", { open: 0, resolution: "abandoned", day: 2 }),
  item(9, "Stuck", { project: "Splicer", kind: "feature", host: "shop.example.com", day: 4 }),
  item(10, "Landed", { project: "Splicer", kind: "feature", host: "shop.example.com", day: 4 }),
  item(11, "Inbox", { day: 3 }),
  item(12, "Inbox", { day: 3 }),
  item(13, "Done", { day: 3 }),
  item(14, "Doing", { day: 3, host: "shop.example.com" }),
  place(11, 1, "Inbox", "a1"),
  place(11, 2, "Doing", "a0"),
  place(12, 2, "Doing", "Zz"),
  place(11, 5, "QA ready", "a0"),
  place(13, 5, "QA ready", "a5"),
  place(12, 6, "Triage", "a0"),
  place(13, 3, "Review", "a0"),
  place(12, 14, "Doing", "a1"),
  place(11, 4, "Done", "a0"),
  place(12, 7, "Shipped", "a0"),
  place(14, 9, "Stuck", "a0"),
  place(14, 10, "Landed", "a0"),
  `INSERT INTO item_labels (item_id, label_id) VALUES (1, ${label("legacy tag")});`,
  `INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at) VALUES (9, 'grace@example.com', 1, 'link', '{"ref":"pci#1"}', 0, ${AT(5)});`,
].join("\n");

function counts(db) {
  return Object.fromEntries(
    TABLES.map((t) => [t, db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t).n ? db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n : 0]),
  );
}

function dump(db) {
  return Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}

function seeded(root) {
  const db = migrated(root, FOLD);
  db.exec(SEED);
  return db;
}

function laneNames(db) {
  return db.prepare(LANES_SQL).all().map((l) => l.name);
}

function laneOfItem(db, id) {
  return db.prepare(`SELECT l.name FROM items i JOIN labels l ON l.id = i.label_id WHERE i.id = ?`).get(id).name;
}

function lane(db, name) {
  return db
    .prepare(
      `SELECT bp.item_id FROM board_positions bp JOIN boards b ON b.id = bp.board_id AND b.cards = 1 JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
       JOIN labels l ON l.id = i.label_id WHERE l.name = ? ORDER BY bp.key`,
    )
    .all(name)
    .map((r) => r.item_id);
}

function boardRows(db, v, filter) {
  const { sql, binds } = oneBoardSql(v, { projects: [], hosts: [], source: null, statuses: [], ...filter });
  return db.prepare(sql).all(...binds);
}

const ALL = { all: true, host: null };

async function unitChecks(check) {
  unitKit();
  const lanes = LANE_NAMES.map((name, id) => ({ id: id + 100, name, role: null, closes: id === 6 ? 1 : 0 }));

  await check("[fold] a lane is named by its word, by position, or by one lane's name, an exact name winning over one that only folds alike", async () => {
    LANES.forEach((word, at) => assert.equal(laneOf(lanes, word), lanes[at]));
    assert.equal(laneOf(lanes, "Needs you"), lanes[3]);
    assert.equal(laneOf(lanes, "needs YOU"), lanes[3]);
    assert.equal(laneOf(lanes, "IN PROGRESS"), lanes[2]);
    for (const bad of ["Inbox", "Doing", "needs_you", "", "Done!", undefined]) assert.equal(laneOf(lanes, bad), null, String(bad));
    const twins = [...lanes.slice(0, 2), { id: 9, name: "Révisé" }, { id: 10, name: "revise" }];
    assert.equal(laneOf(twins, "REVISE"), twins[3]);
    assert.equal(laneOf(twins, "Révisé"), twins[2]);
    assert.equal(laneOf(twins, "RÉVISÉ"), null);
    assert.equal(sawLane(twins, { label_id: 9, label_name: "Révisé" }, "revise"), false);
    assert.equal(sawLane(twins, { label_id: 9, label_name: "Révisé" }, "RÉVISÉ"), true);
    assert.equal(laneOf(lanes.slice(0, 3), "stuck"), null);
  });

  await check("[fold] the board's filter reads project, host, source and status, and refuses a bad source, status or project", async () => {
    const read = (query) => boardFilter({}, new URLSearchParams(query));
    assert.deepEqual(read(""), { projects: [], hosts: [], source: null, statuses: [] });
    assert.deepEqual(read("project=Splicer&project=%20Paper%20&project=Splicer&host=Shop.Example.com&host=*&host=&source=agent&status=done&status=new&status=done"), {
      projects: ["Splicer", "Paper"],
      hosts: ["shop.example.com"],
      source: 1,
      statuses: [0, 6],
    });
    assert.equal(read("source=human").source, 0);
    assert.deepEqual(read("status=needs-you&status=landed").statuses, [3, 5]);
    assert.throws(() => read("source=robot"), refused(400, "source must be human or agent"));
    assert.throws(() => read("status=blocked"), refused(400, `status must be one of ${LANES.join(", ")}`));
    assert.throws(() => read("status=Done"), refused(400));
    assert.throws(() => read(`project=${"p".repeat(41)}`), refused(400, "a project name has 1 to 40 characters"));
    assert.throws(() => read("project="), refused(400));
  });

  await check("[fold] a board row becomes the contract's board card: status by lane, place null in Done, the assignee's username, no e-mail", async () => {
    const row = {
      id: 41, kind: "feature", project: "Splicer", lane: 3, place: 2, label_name: "Needs you", title: "Export", host: "shop.example.com",
      assignee: "ada@example.com", assignee_username: "ada", ord: "a0", changed_at: "2026-10-22T09:00:00.000Z",
      changed_email: "ada@example.com", changed_name: "Ada Lovelace", changed_username: "ada", changed_agent: 1, changed_via: "pci",
    };
    assert.deepEqual(boardCardOf(row), {
      key: "FEAT-41", kind: "feature", project: "Splicer", status: "needs-you", label: "Needs you", lane: 2, title: "Export",
      host: "shop.example.com", assignee: "ada", order: "a0", changed_at: "2026-10-22T09:00:00.000Z",
      changed_by: { name: "Ada Lovelace", username: "ada", agent: true, via: "pci" },
    });
    assert.equal(/@/.test(JSON.stringify(boardCardOf(row))), false);
    const plain = boardCardOf({ ...row, kind: "bug", project: null, lane: 6, assignee: null, ord: null, changed_agent: 0 });
    assert.deepEqual([plain.key, plain.project, plain.status, plain.lane, plain.assignee, plain.order, plain.changed_by.via], ["BUG-41", null, "done", null, null, null, null]);
    assert.equal(boardCardOf({ ...row, lane: 0, place: 1 }).lane, 1);
    assert.equal(boardCardOf({ ...row, assignee_username: undefined }).assignee, null);
    assert.equal(boardCardOf({ ...row, lane: 9 }).status, null);
  });

  await check("[fold] the lanes answer is word, label and closes in order", async () => {
    assert.deepEqual(lanesOf(lanes.slice(0, 2)), [{ word: "new", label: "New", closes: false }, { word: "planned", label: "Planned", closes: false }]);
    assert.deepEqual(lanesOf(lanes).at(-1), { word: "done", label: "Done", closes: true });
    assert.equal(lanesOf([...lanes, { name: "Extra", closes: 0 }]).at(-1).word, null);
  });

  await check("[fold] an archived board answers its owner's username, its columns and its cards, marked archived", async () => {
    const board = { id: 7, name: "Old", owner: "ada@example.com", owner_username: "ada", columns: '[{"label":"Inbox","closes":0},{"label":"Done","closes":1}]' };
    const cards = [{ id: 3, kind: "bug", title: "T", label: "Inbox", assignee: "grace@example.com", assignee_username: "grace", ord: "a0" }];
    assert.deepEqual(archivedOf(board, cards), {
      id: 7, name: "Old", owner: { username: "ada" },
      columns: [{ label: "Inbox", closes: false }, { label: "Done", closes: true }],
      cards: [{ key: "BUG-3", kind: "bug", title: "T", label: "Inbox", assignee: { username: "grace" }, order: "a0" }],
      archived: true,
    });
    const bare = archivedOf({ ...board, owner: null, columns: null }, [{ ...cards[0], assignee: null, ord: null }]);
    assert.deepEqual([bare.owner, bare.columns, bare.cards[0].assignee, bare.cards[0].order], [null, [], null, null]);
    assert.equal(/@/.test(JSON.stringify(archivedOf(board, cards))), false);
  });

  await check("[fold] before or after names one neighbour by key; both, or a non-key, is refused", async () => {
    assert.equal(anchorOf({}), null);
    assert.equal(anchorOf({ before: null, after: null }), null);
    assert.deepEqual(anchorOf({ before: "BUG-12" }), { side: "before", raw: "BUG-12", id: 12 });
    assert.deepEqual(anchorOf({ after: "7" }), { side: "after", raw: "7", id: 7 });
    assert.throws(() => anchorOf({ before: "BUG-1", after: "BUG-2" }), refused(400, "give before or after, not both"));
    assert.throws(() => anchorOf({ after: "not a key" }), refused(400, "not a key is not an item key"));
  });

  await check("[fold] a move's from matches the item's lane by name or by word, else it moved", async () => {
    const row = { label_id: 102, label_name: "In progress" };
    assert.equal(sawLane(lanes, row, "In progress"), true);
    assert.equal(sawLane(lanes, row, "in PROGRESS"), true);
    assert.equal(sawLane(lanes, row, "in-progress"), true);
    assert.equal(sawLane(lanes, row, "new"), false);
    assert.equal(sawLane(lanes, row, "Doing"), false);
    assert.equal(sawLane(lanes, { label_id: 55, label_name: "Doing" }, "Doing"), true);
  });

  await check("[fold] the one board's SQL binds every filter value and never splices one into the text", async () => {
    const { sql, binds } = oneBoardSql({ all: false, host: "x.example'--" }, { projects: ["a'b"], hosts: ["h'1"], source: 1, statuses: [0, 3] });
    assert.deepEqual(binds, ["x.example'--", "a'b", "h'1", 1, 0, 3]);
    assert.equal(sql.includes("'--"), false);
    assert.equal(sql.includes("a'b"), false);
    assert.equal(oneBoardSql(ALL, { projects: [], hosts: [], source: null, statuses: [] }).binds.length, 0);
    assert.equal(BOARDS_GONE, "boards are one per account; see p99 board");
    assert.equal(BOARDS_DEPRECATED, "one board per account since 1.10; read /board");
  });
}

export async function foldChecks({ check, root }) {
  await unitChecks(check);

  await check("[fold] 0016 maps every item to the lane the plan says, closed ones keeping their resolution, and inserts Needs you into a six-lane Cards board", async () => {
    const db = seeded(root);
    fold(root, db);
    assert.deepEqual(laneNames(db), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    const expected = { 1: "New", 2: "In progress", 3: "Landed", 4: "Done", 5: "In progress", 6: "New", 7: "Done", 9: "Stuck", 10: "Landed", 11: "New", 12: "New", 13: "In progress", 14: "In progress" };
    for (const [id, name] of Object.entries(expected)) assert.equal(laneOfItem(db, Number(id)), name, `item ${id}`);
    const closed = db.prepare("SELECT id, open, resolution, closed_at IS NOT NULL AS closed FROM items WHERE id IN (4, 7, 13) ORDER BY id").all();
    assert.deepEqual(closed.map((r) => [r.id, r.open, r.resolution, r.closed]), [[4, 0, "fixed", 1], [7, 0, "abandoned", 1], [13, 1, null, 0]]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM items WHERE open = 1 AND label_id = (SELECT id FROM labels WHERE role = 'done')").get().n, 0);
    const closes = db.prepare(LANES_SQL).all().map((l) => l.closes);
    assert.deepEqual(closes, [0, 0, 0, 0, 0, 0, 1]);
    const roles = Object.fromEntries(db.prepare("SELECT role, name FROM labels WHERE role IS NOT NULL").all().map((r) => [r.role, r.name]));
    assert.deepEqual(roles, { inbox: "New", doing: "In progress", review: "Landed", done: "Done" });
    assert.equal(db.prepare("SELECT cards FROM boards WHERE id = 14").get().cards, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 1").get().n, 1);
  });

  await check("[fold] each moved item gets one migrated label event with its old column's name and no actor, and nothing else does", async () => {
    const db = seeded(root);
    fold(root, db);
    const events = db.prepare("SELECT item_id, actor_email, actor_agent, actor_via, internal, detail_json FROM events WHERE kind = 'label' ORDER BY item_id").all();
    assert.deepEqual(
      events.map((e) => [e.item_id, JSON.parse(e.detail_json)]),
      [
        [1, { from: "Inbox", to: "New", migrated: true }],
        [2, { from: "Doing", to: "In progress", migrated: true }],
        [3, { from: "Review", to: "Landed", migrated: true }],
        [5, { from: "QA ready", to: "In progress", migrated: true }],
        [6, { from: "Triage", to: "New", migrated: true }],
        [7, { from: "Shipped", to: "Done", migrated: true }],
        [11, { from: "Inbox", to: "New", migrated: true }],
        [12, { from: "Inbox", to: "New", migrated: true }],
        [13, { from: "Done", to: "In progress", migrated: true }],
        [14, { from: "Doing", to: "In progress", migrated: true }],
      ],
    );
    for (const e of events) assert.deepEqual([e.actor_email, e.actor_agent, e.actor_via, e.internal], [null, 0, null, 1]);
    const last = db.prepare("SELECT max(id) AS id FROM events WHERE item_id = 9 AND actor_email IS NOT NULL AND kind <> 'mail'").get().id;
    assert.equal(db.prepare("SELECT kind FROM events WHERE id = ?").get(last).kind, "link");
  });

  await check("[fold] each lane keeps the oldest Owner's order first, column by column, then the other boards by age, then newest first", async () => {
    const db = seeded(root);
    fold(root, db);
    assert.deepEqual(lane(db, "New"), [1, 6, 12, 11]);
    assert.deepEqual(lane(db, "In progress"), [2, 5, 14, 13]);
    assert.deepEqual(lane(db, "Landed"), [3, 10]);
    assert.deepEqual(lane(db, "Done"), [4, 7]);
    assert.deepEqual(lane(db, "Stuck"), [9]);
    const keys = db.prepare("SELECT bp.key FROM board_positions bp JOIN boards b ON b.id = bp.board_id WHERE b.cards = 1").all().map((r) => r.key);
    for (const key of keys) assert.match(key, /^(a[0-9A-Za-z]|b[0-9A-Za-z]{2}|c[0-9A-Za-z]{3})$/);
    const rows = boardRows(db, ALL, {});
    const placed = rows.filter((r) => r.lane === 0).map((r) => [r.id, r.place]);
    assert.deepEqual(placed, [[1, 1], [6, 2], [12, 3], [11, 4]]);
  });

  await check("[fold] the oldest live Owner's boards lead even when a revoked Owner's code is older, and a fresh account folds with no Owner", async () => {
    const db = seeded(root);
    db.exec(`UPDATE boards SET owner = 'old@example.com' WHERE id = 12; UPDATE boards SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = 12;`);
    fold(root, db);
    assert.deepEqual(lane(db, "New"), [1, 6, 12, 11]);
    const fresh = migrated(root, FOLD);
    fold(root, fresh);
    assert.deepEqual(laneNames(fresh), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    assert.equal(fresh.prepare("SELECT owner FROM boards WHERE cards = 1").get().owner, null);
    assert.deepEqual(fresh.prepare("SELECT kind, id FROM archived ORDER BY kind, id").all().map((r) => [r.kind, r.id]).filter((r) => r[0] !== "label"), [["fold", 0]]);
    assert.equal(fresh.prepare("SELECT count(*) AS n FROM labels l WHERE " + LIVE_LABEL).get().n, 7);
  });

  await check("[fold] an account with no Cards board gets one with seven lanes, owned by the oldest live Owner, Done its closing lane", async () => {
    const db = seeded(root);
    db.exec("DELETE FROM board_positions WHERE board_id = 14; DELETE FROM board_columns WHERE board_id = 14; DELETE FROM boards WHERE id = 14; UPDATE items SET project = NULL;");
    fold(root, db);
    const board = db.prepare("SELECT id, owner, host FROM boards WHERE cards = 1").get();
    assert.deepEqual([board.owner, board.host], ["ada@example.com", null]);
    assert.deepEqual(laneNames(db), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    assert.equal(laneOfItem(db, 9), "Stuck");
    assert.equal(laneOfItem(db, 10), "Landed");
    assert.equal(db.prepare("SELECT closes FROM labels WHERE name = 'Done'").get().closes, 1);
  });

  await check("[fold] old boards and labels are archived, not deleted: no row goes, the old order stays, and only lanes are live", async () => {
    const db = seeded(root);
    const before = counts(db);
    const oldPositions = db.prepare("SELECT * FROM board_positions WHERE board_id <> 14 ORDER BY board_id, item_id").all();
    fold(root, db);
    const after = counts(db);
    for (const t of TABLES) assert.ok(after[t] >= before[t], `${t}: ${before[t]} -> ${after[t]}`);
    assert.equal(after.boards, before.boards);
    assert.equal(after.board_columns, before.board_columns + 1);
    assert.equal(after.labels, before.labels + 1);
    assert.equal(after.events, before.events + 10);
    assert.equal(after.items, before.items);
    assert.equal(after.item_labels, before.item_labels);
    assert.deepEqual(db.prepare("SELECT * FROM board_positions WHERE board_id <> 14 ORDER BY board_id, item_id").all(), oldPositions);
    const archived = db.prepare("SELECT kind, id FROM archived ORDER BY kind, id").all();
    assert.deepEqual(archived.filter((a) => a.kind === "board").map((a) => a.id), [11, 12, 13]);
    const archivedLabels = db.prepare("SELECT l.name FROM archived a JOIN labels l ON l.id = a.id WHERE a.kind = 'label' ORDER BY l.name").all().map((r) => r.name);
    assert.deepEqual(archivedLabels, ["Doing", "Inbox", "legacy tag", "QA ready", "Review", "Shipped", "Triage"]);
    assert.equal(archived.filter((a) => a.kind === "fold").length, 1);
    const live = db.prepare(`SELECT l.name FROM labels l WHERE ${LIVE_LABEL} ORDER BY l.id`).all().map((r) => r.name);
    assert.deepEqual(new Set(live), new Set(LANE_NAMES));
    assert.equal(db.prepare(`SELECT count(*) AS n FROM items i WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.id = i.label_id AND ${LIVE_LABEL})`).get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'one\\_%' ESCAPE '\\'").get().n, 0);
  });

  await check("[fold] running 0016 twice changes nothing the second time", async () => {
    const db = seeded(root);
    fold(root, db);
    const once = dump(db);
    fold(root, db);
    assert.deepEqual(dump(db), once);
  });

  await check("[fold] the archived boards read back with the items they showed at the fold, under their old column names, in their old order", async () => {
    const db = seeded(root);
    fold(root, db);
    const boards = db.prepare(ARCHIVED_BOARDS).all(1, null, null);
    assert.deepEqual(boards.map((b) => [b.id, b.name, b.owner_username]), [[11, "Ada's board", "ada"], [12, "Grace's board", "grace"], [13, "Ada's QA", "ada"]]);
    assert.deepEqual(JSON.parse(boards[1].columns).map((c) => [c.label, c.closes]), [["Triage", 0], ["Doing", 0], ["Review", 0], ["Shipped", 1]]);
    const cards = db.prepare(ARCHIVED_CARDS).all(1, null, null);
    const on = (id) => cards.filter((r) => r.board_id === id).map((r) => [r.id, r.label]);
    assert.deepEqual(on(11), [[12, "Inbox"], [11, "Inbox"], [1, "Inbox"], [14, "Doing"], [2, "Doing"], [5, "QA ready"], [13, "Done"], [4, "Done"]]);
    assert.deepEqual(on(12), [[6, "Triage"], [2, "Doing"], [3, "Review"], [7, "Shipped"]]);
    assert.deepEqual(on(13), [[5, "QA ready"], [3, "Review"], [13, "Done"], [4, "Done"]]);
    assert.equal(cards.some((r) => r.id === 9 || r.id === 10), false);
    assert.equal(cards.find((r) => r.id === 2 && r.board_id === 11).assignee_username, "ada");
    const scoped = db.prepare(ARCHIVED_BOARDS).all(0, "example.com", null);
    assert.deepEqual(scoped.map((b) => b.id), [12]);
    const scopedCards = db.prepare(ARCHIVED_CARDS).all(0, "example.com", null);
    assert.equal(scopedCards.some((r) => r.id === 14), false);
    assert.deepEqual(db.prepare(ARCHIVED_BOARDS).all(1, null, 13).map((b) => b.id), [13]);
    assert.deepEqual(db.prepare(ARCHIVED_BOARDS).all(1, null, 14), []);
  });

  await check("[fold] the one board lists every item a viewer may see, in lane order, and each filter narrows it", async () => {
    const db = seeded(root);
    fold(root, db);
    const ids = (v, filter) => boardRows(db, v, filter).map((r) => r.id);
    assert.deepEqual(ids(ALL, {}), [1, 6, 12, 11, 2, 5, 14, 13, 9, 3, 10, 4, 7]);
    assert.deepEqual(ids({ all: false, host: "shop.example.com" }, {}), [14, 9, 10]);
    assert.deepEqual(ids(ALL, { projects: ["splicer"] }), [9, 10]);
    assert.deepEqual(ids(ALL, { hosts: ["shop.example.com"] }), [14, 9, 10]);
    assert.deepEqual(ids(ALL, { statuses: [3, 4, 5] }), [9, 3, 10]);
    assert.deepEqual(ids(ALL, { statuses: [6] }), [4, 7]);
    assert.deepEqual(ids(ALL, { source: 1 }), [9]);
    assert.deepEqual(ids(ALL, { source: 0 }).includes(9), false);
    assert.deepEqual(ids(ALL, { projects: ["Nope"] }), []);
    const row = boardRows(db, ALL, {}).find((r) => r.id === 9);
    assert.deepEqual([row.lane, row.place, row.changed_email, row.changed_agent, row.changed_name, row.changed_username], [4, 1, "grace@example.com", 1, "Grace Hopper", "grace"]);
    const moved = boardRows(db, ALL, {}).find((r) => r.id === 1);
    assert.equal(moved.changed_at, "2026-01-01T00:00:00.000Z");
    const shop = boardRows(db, { all: false, host: "shop.example.com" }, {}).find((r) => r.id === 14);
    assert.equal(shop.place, 1);
  });
}

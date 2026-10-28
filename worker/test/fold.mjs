import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LANES, LANE_NAMES, useKit } from "../src/cards.js";
import {
  BOARDS_DEPRECATED,
  BOARDS_GONE,
  LANES_SQL,
  anchorOf,
  boardCardOf,
  boardFilter,
  laneOf,
  lanesOf,
  oneBoardSql,
  sawLane,
} from "../src/one-board.js";
import { stageOf } from "../src/boards.js";

const AT = (day) => `'2026-01-0${day}T00:00:00.000Z'`;
export const FOLD = "0016_one_board.sql";
const LIVE_LABEL = "(NOT EXISTS (SELECT 1 FROM archived a WHERE a.kind = 'label' AND a.id = l.id))";
const TABLES = ["archived", "board_columns", "board_positions", "boards", "codes", "events", "item_labels", "items", "labels"];

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const refused = (status, message) => (error) => error instanceof Refused && error.status === status && (message === undefined || error.message === message);

export function unitKit() {
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

export function migrated(root, upTo) {
  const db = new DatabaseSync(":memory:");
  const dir = join(root, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < upTo).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

export function fold(root, db) {
  db.exec(readFileSync(join(root, "migrations", FOLD), "utf8"));
}

export function label(name) {
  return `(SELECT id FROM labels WHERE name = '${name}')`;
}

export function item(id, name, { open = 1, resolution = null, project = null, host = "example.com", day = 1, kind = "bug", assignee = null, v19 = false } = {}) {
  return `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
    reporter_email, reporter_name, reporter_json, reporter_agent, assignee, context_json, marks_json, search_text, activity_at, public_activity_at,
    created_at, updated_at, closed_at, resolution${v19 ? "" : ", project"})
    VALUES (${id}, 'fold-${id}', '${kind}', ${label(name)}, ${open}, 'Item ${id}', '', 'production', '${host}', 'https://${host}/', '/', '',
    'grace@example.com', 'Grace Hopper', '{}', 0, ${assignee ? `'${assignee}'` : "NULL"}, '{}', '[]', 'item ${id}', ${AT(day)}, ${AT(day)},
    ${AT(day)}, ${AT(day)}, ${open ? "NULL" : AT(day)}, ${resolution ? `'${resolution}'` : "NULL"}${v19 ? "" : `, ${project ? `'${project}'` : "NULL"}`});`;
}

export function column(board, name, position) {
  return `INSERT INTO board_columns (board_id, label_id, position) VALUES (${board}, ${label(name)}, ${position});`;
}

export function place(board, itemId, name, key) {
  return `INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (${board}, ${itemId}, ${label(name)}, '${key}');`;
}

export const SEED = [
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

export function counts(db) {
  return Object.fromEntries(
    TABLES.map((t) => [t, db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t).n ? db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n : 0]),
  );
}

export function dump(db) {
  const has = (t) => db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t).n > 0;
  return Object.fromEntries(TABLES.map((t) => [t, has(t) ? db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() : []]));
}

export function seeded(root, extra = "") {
  const db = migrated(root, FOLD);
  db.exec(SEED);
  db.exec(extra);
  return db;
}

function stages(db) {
  const rows = db.prepare("SELECT i.id, i.open, i.resolution, l.role AS label_role FROM items i JOIN labels l ON l.id = i.label_id ORDER BY i.id").all();
  return Object.fromEntries(rows.map((r) => [r.id, stageOf(r)]));
}

export function laneNames(db) {
  return db.prepare(LANES_SQL).all().map((l) => l.name);
}

export function laneOfItem(db, id) {
  return db.prepare(`SELECT l.name FROM items i JOIN labels l ON l.id = i.label_id WHERE i.id = ?`).get(id).name;
}

export function lane(db, name) {
  return db
    .prepare(
      `SELECT bp.item_id FROM board_positions bp JOIN boards b ON b.id = bp.board_id AND b.cards = 1 JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
       JOIN labels l ON l.id = i.label_id WHERE l.name = ? ORDER BY bp.key`,
    )
    .all(name)
    .map((r) => r.item_id);
}

export function boardRows(db, v, filter) {
  const { sql, binds } = oneBoardSql(v, { projects: [], hosts: [], source: null, statuses: [], ...filter });
  return db.prepare(sql).all(...binds);
}

export const ALL = { all: true, host: null };

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
    assert.equal(BOARDS_DEPRECATED, "one board per account since 1.11; read /board");
  });
}

export async function foldChecks({ check, root }) {
  await unitChecks(check);

  await check("[fold] 0016 maps every item to the lane the plan says, closed ones keeping their resolution, and inserts Needs you into a six-lane Cards board", async () => {
    const db = seeded(root);
    fold(root, db);
    assert.deepEqual(laneNames(db), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    const expected = { 1: "New", 2: "In progress", 3: "Landed", 4: "Done", 5: "In progress", 6: "In progress", 7: "Done", 9: "Stuck", 10: "Landed", 11: "New", 12: "New", 13: "In progress", 14: "In progress" };
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

  await check("[fold] an item's row for its own old label follows it to its lane, so the fold makes no old tag; real tags stay as they were", async () => {
    const db = seeded(root, "INSERT INTO item_labels (item_id, label_id) SELECT id, label_id FROM items WHERE id IN (2, 3);");
    const tags = () => db.prepare("SELECT il.item_id, l.name FROM item_labels il JOIN labels l ON l.id = il.label_id JOIN items i ON i.id = il.item_id WHERE il.label_id <> i.label_id ORDER BY 1, 2").all().map((r) => [r.item_id, r.name]);
    const before = tags();
    fold(root, db);
    assert.deepEqual(tags(), before);
    assert.deepEqual(tags(), [[1, "legacy tag"]]);
    const own = db.prepare("SELECT il.item_id, l.name FROM item_labels il JOIN labels l ON l.id = il.label_id WHERE il.item_id IN (2, 3) ORDER BY 1").all().map((r) => [r.item_id, r.name]);
    assert.deepEqual(own, [[2, "In progress"], [3, "Landed"]]);
    const once = dump(db).item_labels;
    fold(root, db);
    assert.deepEqual(dump(db).item_labels, once);
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
        [6, { from: "Triage", to: "In progress", migrated: true }],
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
    assert.deepEqual(lane(db, "New"), [1, 12, 11]);
    assert.deepEqual(lane(db, "In progress"), [2, 5, 6, 14, 13]);
    assert.deepEqual(lane(db, "Landed"), [3, 10]);
    assert.deepEqual(lane(db, "Done"), [4, 7]);
    assert.deepEqual(lane(db, "Stuck"), [9]);
    const keys = db.prepare("SELECT bp.key FROM board_positions bp JOIN boards b ON b.id = bp.board_id WHERE b.cards = 1").all().map((r) => r.key);
    for (const key of keys) assert.match(key, /^(a[0-9A-Za-z]|b[0-9A-Za-z]{2}|c[0-9A-Za-z]{3})$/);
    const rows = boardRows(db, ALL, {});
    const placed = rows.filter((r) => r.lane === 0).map((r) => [r.id, r.place]);
    assert.deepEqual(placed, [[1, 1], [12, 2], [11, 3]]);
  });

  await check("[fold] the oldest live Owner's boards lead even when a revoked Owner's code is older, and a fresh account folds with no Owner", async () => {
    const db = seeded(root);
    db.exec(`UPDATE boards SET owner = 'old@example.com' WHERE id = 12; UPDATE boards SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = 12;`);
    fold(root, db);
    assert.deepEqual(lane(db, "In progress"), [2, 5, 6, 14, 13]);
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

  await check("[fold] 0016 alone deletes no row: it marks the old boards and labels, keeps the old order, and only lanes are live until 0017 deletes the rest", async () => {
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

  await check("[fold] the plan's own queries list exactly the labels 0016 then moves items from, whether the Cards board gets Needs you, is reset or is filled", async () => {
    const plan = (name) => readFileSync(join(root, "..", "src", "fold", `${name}.sql`), "utf8");
    for (const [how, extra, step] of [
      ["insert", "", 6],
      ["reset", "UPDATE labels SET name = 'Needs you' WHERE name = 'Stuck';", 6],
      ["fill", "DELETE FROM board_columns WHERE board_id = 14;", 0],
    ]) {
      const db = seeded(root, extra);
      const cards = db.prepare(plan("boards")).all().find((b) => b.cards === 1);
      assert.equal(cards.columns, step, how);
      const listed = db.prepare(plan("labels")).all().filter((r) => r.items > 0).map((r) => r.label).sort();
      const unplaced = db.prepare(plan("unplaced")).get().items;
      fold(root, db);
      const lanes = new Set(laneNames(db));
      const moved = [...new Set(db.prepare("SELECT json_extract(detail_json, '$.from') AS f FROM events WHERE kind = 'label' AND json_extract(detail_json, '$.migrated')").all().map((r) => r.f))]
        .filter((f) => !lanes.has(f))
        .sort();
      assert.deepEqual(listed, moved, how);
      assert.ok(listed.includes("Triage") && listed.includes("Shipped"), `${how}: ${listed}`);
      assert.ok(unplaced > 0, how);
    }
  });

  await check("[fold] the count check's prediction, read before 0016, is what 0016 and 0017 then leave in every lane and in the events, for each Cards board shape and for a 1.9 account", async () => {
    const read = (name) => readFileSync(join(root, "..", "src", "counts", `${name}.sql`), "utf8");
    const [foldSql, totals, laneSql] = ["fold", "totals", "lane"].map(read);
    const prune = readFileSync(join(root, "migrations", "0017_delete_archived.sql"), "utf8");
    const predicted = (db, sql) => {
      const before = { ...db.prepare(totals).get() };
      const rows = db.prepare(sql).all();
      const moved = rows.reduce((sum, r) => sum + r.moved, 0);
      const lanes = LANE_NAMES.map((_, at) => rows.find((r) => r.lane === at)?.items ?? 0);
      assert.equal(lanes.reduce((sum, n) => sum + n, 0), before.items);
      return { want: { ...before, events: before.events + moved, lanes }, moved };
    };
    const deployed = (db, before = "") => {
      db.exec("BEGIN");
      try {
        db.exec(before);
        fold(root, db);
        db.exec(prune);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const lanes = LANE_NAMES.map((_, at) => db.prepare(`SELECT ${laneSql.trim().replaceAll("{lane}", String(at))} AS n`).get().n);
      return { ...db.prepare(totals).get(), lanes };
    };
    const keep = `INSERT INTO labels (name, color, created_at, closes) VALUES ('Needs you', '#e0823d', ${AT(4)}, 0);
      UPDATE board_columns SET position = position + 1 WHERE board_id = 14 AND position >= 3; ${column(14, "Needs you", 3)}
      ${item(15, "Needs you", { day: 4 })} ${place(14, 15, "Needs you", "a0")} ${item(16, "Landed", { open: 0, resolution: "fixed", day: 4 })}`;
    const odd = `UPDATE labels SET name = 'Next up' WHERE name = 'Planned'; DELETE FROM board_columns WHERE board_id = 14 AND label_id = ${label("Stuck")};
      ${item(15, "Next up", { day: 4 })} ${place(14, 15, "Next up", "a0")}`;
    for (const [how, extra, columns] of [
      ["make", "DELETE FROM board_positions WHERE board_id = 14; DELETE FROM board_columns WHERE board_id = 14; DELETE FROM boards WHERE id = 14;", null],
      ["fill", "DELETE FROM board_columns WHERE board_id = 14;", 0],
      ["insert", "", 6],
      ["insert, a renamed lane", "UPDATE labels SET name = 'Next up' WHERE name = 'Planned';", 6],
      ["reset, six with Needs you", "UPDATE labels SET name = 'Needs you' WHERE name = 'Stuck';", 6],
      ["reset, odd columns", odd, 5],
      ["keep", keep, 7],
    ]) {
      const db = seeded(root, extra);
      const cards = db.prepare("SELECT count(*) AS n FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1").get().n;
      const board = db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 1").get().n;
      assert.deepEqual([board, cards], columns === null ? [0, 0] : [1, columns], how);
      const { want, moved } = predicted(db, foldSql);
      assert.ok(moved > 0 && moved < want.items, `${how}: ${moved}`);
      assert.deepEqual(deployed(db), want, how);
    }

    const v19 = migrated(root, "0014");
    v19.exec(
      [
        `INSERT INTO codes (id, hash, hint, name, email, hosts_json, manager, created_at, created_by, revoked_at) VALUES
          (2, 'h2', 'b', 'Ada Lovelace', 'ada@example.com', '["*"]', 1, ${AT(1)}, 'setup', NULL);`,
        `INSERT INTO labels (name, color, created_at, closes) VALUES ('QA ready', '#539bf5', ${AT(1)}, 0), ('Triage', '#986ee2', ${AT(1)}, 0), ('Shipped', '#57ab5a', ${AT(1)}, 1);`,
        `INSERT INTO boards (id, name, host, owner, created_at, updated_at) VALUES (11, 'Ada''s board', NULL, 'ada@example.com', ${AT(1)}, ${AT(1)}),
          (12, 'Grace''s board', 'example.com', 'grace@example.com', ${AT(2)}, ${AT(2)});`,
        ...["Inbox", "Doing", "QA ready", "Done"].map((name, at) => column(11, name, at)),
        ...["Triage", "Doing", "Review", "Shipped"].map((name, at) => column(12, name, at)),
        item(1, "Inbox", { v19: true }),
        item(2, "Doing", { v19: true }),
        item(3, "Review", { v19: true }),
        item(4, "Done", { open: 0, resolution: "fixed", v19: true }),
        item(5, "QA ready", { v19: true }),
        item(6, "Triage", { v19: true }),
        item(7, "Shipped", { open: 0, resolution: "abandoned", v19: true }),
        item(13, "Done", { day: 3, v19: true }),
        item(15, "Shipped", { day: 2, v19: true }),
        place(11, 1, "Inbox", "a0"),
        place(11, 4, "Done", "a0"),
        place(12, 6, "Triage", "a0"),
      ].join("\n"),
    );
    assert.equal(v19.prepare("SELECT count(*) AS n FROM pragma_table_info('boards') WHERE name = 'cards'").get().n, 0);
    assert.throws(() => v19.prepare(foldSql).all(), /no such column/);
    const uncarded = foldSql.replaceAll("b.cards", "0");
    const { want, moved } = predicted(v19, uncarded);
    assert.ok(moved > 0 && moved < want.items, String(moved));
    const cut = ["0014_backup_cut.sql", "0015_cards.sql"].map((f) => readFileSync(join(root, "migrations", f), "utf8")).join("\n");
    assert.deepEqual(deployed(v19, cut), want);
  });

  await check("[fold] running 0016 twice changes nothing the second time", async () => {
    const db = seeded(root);
    fold(root, db);
    const once = dump(db);
    fold(root, db);
    assert.deepEqual(dump(db), once);
  });

  await check("[fold] the one board lists every item a viewer may see, in lane order, and each filter narrows it", async () => {
    const db = seeded(root);
    fold(root, db);
    const ids = (v, filter) => boardRows(db, v, filter).map((r) => r.id);
    assert.deepEqual(ids(ALL, {}), [1, 12, 11, 2, 5, 6, 14, 13, 9, 3, 10, 4, 7]);
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

  await check("[fold] an open item on a custom closing column goes to In progress, still open with no resolution, never to Done", async () => {
    const db = seeded(root, item(15, "Shipped", { day: 2 }));
    fold(root, db);
    assert.equal(laneOfItem(db, 15), "In progress");
    assert.deepEqual({ ...db.prepare("SELECT open, resolution, closed_at FROM items WHERE id = 15").get() }, { open: 1, resolution: null, closed_at: null });
    const events = db.prepare("SELECT detail_json FROM events WHERE item_id = 15 AND kind = 'label'").all().map((e) => JSON.parse(e.detail_json));
    assert.deepEqual(events, [{ from: "Shipped", to: "In progress", migrated: true }]);
    assert.equal(laneOfItem(db, 7), "Done");
  });

  await check("[fold] a six-lane Cards board that already has a lane called Needs you is set to the seven lanes, its Needs you cards kept there", async () => {
    const db = seeded(root, "UPDATE labels SET name = 'Needs you' WHERE name = 'Stuck';");
    fold(root, db);
    assert.deepEqual(laneNames(db), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    assert.deepEqual(db.prepare(LANES_SQL).all().map((l) => l.closes), [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(laneOfItem(db, 9), "Needs you");
    assert.equal(laneOfItem(db, 10), "Landed");
    assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE item_id IN (9, 10) AND kind = 'label'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM archived WHERE kind = 'fold'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'one\\_%' ESCAPE '\\'").get().n, 0);
    const once = dump(db);
    fold(root, db);
    assert.deepEqual(dump(db), once);
  });

  await check("[fold] a Cards board with odd columns is set to the seven lanes, and a card on a column that isn't a lane moves to In progress", async () => {
    const db = seeded(root, `UPDATE labels SET name = 'Next up' WHERE name = 'Planned'; DELETE FROM board_columns WHERE board_id = 14 AND label_id = ${label("Stuck")}; ${item(15, "Next up", { day: 4 })} ${place(14, 15, "Next up", "a0")}`);
    assert.equal(db.prepare("SELECT count(*) AS n FROM board_columns WHERE board_id = 14").get().n, 5);
    fold(root, db);
    assert.deepEqual(laneNames(db), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    assert.deepEqual(db.prepare(LANES_SQL).all().map((l) => l.closes), [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(laneOfItem(db, 15), "In progress");
    assert.equal(laneOfItem(db, 9), "Stuck");
    assert.equal(laneOfItem(db, 10), "Landed");
    const moved = db.prepare("SELECT detail_json FROM events WHERE item_id = 15 AND kind = 'label'").all().map((e) => JSON.parse(e.detail_json));
    assert.deepEqual(moved, [{ from: "Next up", to: "In progress", migrated: true }]);
    assert.ok(db.prepare("SELECT 1 FROM archived a JOIN labels l ON l.id = a.id WHERE a.kind = 'label' AND l.name = 'Next up'").get());
    assert.equal(db.prepare("SELECT count(*) AS n FROM items WHERE label_id IN (SELECT id FROM archived WHERE kind = 'label')").get().n, 0);
  });

  await check("[fold] after a reset the renamed lane's cards read on the one board in In progress, their history names the lane, and 0016 leaves the label for 0017", async () => {
    const db = seeded(root, `UPDATE labels SET name = 'Next up' WHERE name = 'Planned'; DELETE FROM board_columns WHERE board_id = 14 AND label_id = ${label("Stuck")}; ${item(15, "Next up", { project: "Splicer", kind: "feature", host: "shop.example.com", day: 4 })} ${place(14, 15, "Next up", "a0")}`);
    const nextUp = db.prepare("SELECT id FROM labels WHERE name = 'Next up'").get().id;
    const archivedBefore = db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n;
    fold(root, db);
    unitKit();
    const card = boardRows(db, ALL, { projects: ["Splicer"] }).map(boardCardOf).find((c) => c.key === "FEAT-15");
    assert.deepEqual([card.status, card.label, card.project, card.title], ["in-progress", "In progress", "Splicer", "Item 15"]);
    assert.deepEqual(boardRows(db, ALL, { statuses: [2] }).map((r) => r.id).filter((id) => id === 15), [15]);
    const history = db.prepare("SELECT detail_json FROM events WHERE item_id = 15 AND kind = 'label'").all().map((e) => JSON.parse(e.detail_json));
    assert.deepEqual(history, [{ from: "Next up", to: "In progress", migrated: true }]);
    assert.deepEqual({ ...db.prepare("SELECT id, name FROM labels WHERE id = ?").get(nextUp) }, { id: nextUp, name: "Next up" });
    assert.ok(db.prepare("SELECT 1 FROM archived WHERE kind = 'label' AND id = ?").get(nextUp));
    assert.equal(laneNames(db).includes("Next up"), false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM boards WHERE cards = 0").get().n, archivedBefore);
  });

  await check("[fold] a six-lane Cards board with a renamed lane gets Needs you fourth, the renamed lane kept in its place", async () => {
    const db = seeded(root, "UPDATE labels SET name = 'Next up' WHERE name = 'Planned';");
    fold(root, db);
    assert.deepEqual(laneNames(db), ["New", "Next up", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    assert.deepEqual(db.prepare(LANES_SQL).all().map((l) => l.closes), [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(laneOfItem(db, 9), "Stuck");
    assert.equal(db.prepare("SELECT count(*) AS n FROM archived WHERE kind = 'fold'").get().n, 1);
  });

  await check("[fold] a visitor's stage stays the same through the fold, a report on a custom first column included", async () => {
    const db = seeded(root);
    const before = stages(db);
    fold(root, db);
    const after = stages(db);
    const changed = Object.fromEntries(Object.keys(before).filter((id) => before[id] !== after[id]).map((id) => [id, [before[id], after[id]]]));
    assert.deepEqual(changed, {});
    assert.equal(after[6], "in_progress");
    assert.equal(after[1], "received");
  });
}

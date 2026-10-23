import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const worker = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(worker, "migrations");
const query = (name) => readFileSync(join(worker, "..", "src", "fold", `${name}.sql`), "utf8");
const AT = "2026-01-01T00:00:00.000Z";

function before0016() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql") && f < "0016").sort()) {
    db.exec(readFileSync(join(migrations, f), "utf8"));
  }
  db.prepare(
    "INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by) VALUES ('h1', 'a', 'Ada Lovelace', 'ada@example.com', '[\"*\"]', 1, ?, 'setup'), ('h2', 'b', 'Grace Hopper', 'grace@example.com', '[\"*\"]', 1, ?, 'ada@example.com')",
  ).run(AT, AT);
  return db;
}

function role(db, name) {
  return db.prepare("SELECT id FROM labels WHERE role = ?").get(name).id;
}

function label(db, name, closes = 0) {
  db.prepare("INSERT INTO labels (name, color, created_at, closes) VALUES (?, '#336699', ?, ?)").run(name, AT, closes);
  return db.prepare("SELECT id FROM labels WHERE name = ?").get(name).id;
}

function board(db, name, owner, cards, created, columns) {
  const id = Number(
    db
      .prepare("INSERT INTO boards (name, host, owner, created_at, updated_at, cards) VALUES (?, NULL, ?, ?, ?, ?)")
      .run(name, owner, created, created, cards).lastInsertRowid,
  );
  columns.forEach((labelId, position) =>
    db.prepare("INSERT INTO board_columns (board_id, label_id, position) VALUES (?, ?, ?)").run(id, labelId, position),
  );
  return id;
}

let uid = 0;
function item(db, labelId, open, places = []) {
  uid += 1;
  const id = Number(
    db
      .prepare(
        `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
          reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at,
          created_at, updated_at, closed_at, resolution)
        VALUES (?, 'bug', ?, ?, ?, '', 'production', 'example.com', 'https://example.com/', '/', '', 'ada@example.com',
          'Ada Lovelace', '{}', '{}', '[]', '', ?, ?, ?, ?, ?, ?)`,
      )
      .run(`fold-${uid}`, labelId, open ? 1 : 0, `Item ${uid}`, AT, AT, AT, AT, open ? null : AT, open ? null : "fixed")
      .lastInsertRowid,
  );
  places.forEach(([boardId, key]) =>
    db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, ?)").run(boardId, id, labelId, key),
  );
  return id;
}

function laneOf(row) {
  if (row.role === "inbox") return 0;
  if (row.role === "review") return 5;
  return 2;
}

function plan(db) {
  return {
    boards: db.prepare(query("boards")).all(),
    labels: db.prepare(query("labels")).all(),
    unplaced: db.prepare(query("unplaced")).get().items,
  };
}

function fold(db) {
  db.exec(readFileSync(join(migrations, "0016_one_board.sql"), "utf8"));
  const lanes = Object.fromEntries(
    db
      .prepare("SELECT bc.position AS lane, l.name AS name FROM board_columns bc JOIN boards b ON b.id = bc.board_id JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1")
      .all()
      .map((r) => [r.lane, r.name]),
  );
  const moved = {};
  for (const e of db
    .prepare(
      "SELECT json_extract(e.detail_json, '$.from') AS from_name, json_extract(e.detail_json, '$.to') AS to_name, i.open AS open FROM events e JOIN items i ON i.id = e.item_id WHERE e.kind = 'label' AND json_extract(e.detail_json, '$.migrated') = 1",
    )
    .all()) {
    const m = (moved[e.from_name] ??= { items: 0, open: 0, toOpen: new Set(), toClosed: new Set() });
    m.items += 1;
    m.open += e.open;
    (e.open ? m.toOpen : m.toClosed).add(e.to_name);
  }
  return { lanes, moved };
}

function predicts(db) {
  const before = plan(db);
  const total = db.prepare("SELECT count(*) AS n FROM items").get().n;
  assert.equal(
    before.boards.reduce((n, b) => n + b.placed, 0) + before.unplaced,
    total,
    "each item counts once: on its first-ranked board or as unplaced",
  );
  const { lanes, moved } = fold(db);
  const shown = before.labels.filter((r) => r.items > 0);
  assert.deepEqual(shown.map((r) => r.label).sort(), Object.keys(moved).sort(), "the plan lists exactly the labels 0016 moves");
  for (const row of shown) {
    const m = moved[row.label];
    assert.equal(m.items, row.items, row.label);
    assert.equal(m.open, row.open, row.label);
    if (row.open > 0) assert.deepEqual([...m.toOpen], [lanes[laneOf(row)]], row.label);
    if (row.items > row.open) assert.deepEqual([...m.toClosed], [lanes[6]], row.label);
  }
  return { before, lanes, moved };
}

test("a Cards board with six columns: the plan predicts every move 0016 makes and a custom Needs you becomes the lane", () => {
  const db = before0016();
  const [inbox, doing, review, done] = ["inbox", "doing", "review", "done"].map((r) => role(db, r));
  const [nw, planned, progress, stuck, landed] = ["New", "Planned", "In progress", "Stuck", "Landed"].map((n) => label(db, n));
  const triage = label(db, "Triage");
  const qa = label(db, "QA ready");
  const shipped = label(db, "Shipped", 1);
  const needs = label(db, "Needs you");
  const cards = board(db, "Cards", "ada@example.com", 1, "2026-01-01T00:00:00.000Z", [nw, planned, progress, stuck, landed, done]);
  const web = board(db, "Web", "ada@example.com", 0, "2026-01-02T00:00:00.000Z", [triage, doing, qa, shipped]);
  const ops = board(db, "Ops", "grace@example.com", 0, "2026-01-03T00:00:00.000Z", [inbox, review, done]);
  item(db, triage, true, [[web, "a0"]]);
  item(db, triage, true, [[web, "a1"], [cards, "a0"], [ops, "a0"]]);
  item(db, qa, true);
  item(db, shipped, true, [[web, "a2"]]);
  item(db, shipped, false, [[web, "a3"]]);
  item(db, inbox, true, [[ops, "a1"]]);
  item(db, inbox, false);
  item(db, review, true, [[ops, "a2"]]);
  item(db, doing, true, [[web, "a4"], [ops, "a3"]]);
  item(db, needs, true, [[cards, "a1"]]);
  item(db, nw, true, [[cards, "a2"]]);
  item(db, done, false);

  const { before, lanes, moved } = predicts(db);
  assert.deepEqual(
    before.boards.map((b) => [b.name, b.columns, b.placed]),
    [
      ["Web", 4, 5],
      ["Cards", 6, 2],
      ["Ops", 3, 2],
    ],
  );
  assert.equal(before.unplaced, 3);
  assert.equal(before.labels.find((r) => r.label === "Needs you"), undefined);
  assert.equal(lanes[3], "Needs you");
  assert.equal(moved["Needs you"], undefined);
  assert.deepEqual([...moved.Triage.toOpen], ["In progress"]);
  assert.deepEqual([...moved["QA ready"].toOpen], ["In progress"]);
  assert.deepEqual([...moved.Shipped.toClosed], [lanes[6]]);
});

test("a Cards board with seven lanes and a renamed fourth: a label still called Needs you is shown and moved", () => {
  const db = before0016();
  const [inbox, done] = ["inbox", "done"].map((r) => role(db, r));
  const lanes = ["New", "Planned", "In progress", "Waiting on me", "Stuck", "Landed"].map((n) => label(db, n));
  const needs = label(db, "Needs you");
  const cards = board(db, "Cards", "ada@example.com", 1, AT, [...lanes, done]);
  const web = board(db, "Web", "ada@example.com", 0, AT, [needs, inbox, done]);
  item(db, needs, true, [[web, "a0"]]);
  item(db, needs, false, [[web, "a1"], [cards, "a0"]]);
  item(db, inbox, true);
  item(db, lanes[3], true, [[cards, "a1"]]);

  const { before, moved } = predicts(db);
  const row = before.labels.find((r) => r.label === "Needs you");
  assert.equal(row.items, 2);
  assert.equal(row.open, 1);
  assert.deepEqual([...moved["Needs you"].toOpen], ["In progress"]);
  assert.equal(moved["Waiting on me"], undefined);
  assert.deepEqual(
    before.boards.map((b) => [b.name, b.placed]),
    [
      ["Web", 2],
      ["Cards", 1],
    ],
  );
});

test("no Cards board: the lane names already in use stay as lanes and every other label is predicted", () => {
  const db = before0016();
  const [inbox, doing, review, done] = ["inbox", "doing", "review", "done"].map((r) => role(db, r));
  const nw = label(db, "New");
  const needs = label(db, "Needs you");
  const custom = label(db, "Later");
  const web = board(db, "Web", "ada@example.com", 0, AT, [custom, inbox, doing, review, done]);
  item(db, nw, true);
  item(db, needs, true, [[web, "a0"]]);
  item(db, custom, true, [[web, "a1"]]);
  item(db, inbox, true, [[web, "a2"]]);
  item(db, doing, false, [[web, "a3"]]);
  item(db, review, true);
  item(db, done, false, [[web, "a4"]]);

  const { before, lanes, moved } = predicts(db);
  for (const name of ["New", "Needs you", "Planned", "Stuck"]) {
    assert.equal(before.labels.find((r) => r.label === name), undefined, name);
  }
  assert.equal(before.labels.find((r) => r.role === "done"), undefined);
  assert.deepEqual(Object.values(lanes), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
  assert.deepEqual([...moved.Later.toOpen], ["In progress"]);
  assert.deepEqual([...moved.Review.toOpen], ["Landed"]);
  assert.deepEqual([...moved.Doing.toClosed], ["Done"]);
});

test("a Cards board of six with its own Needs you, or of four, is reset to the seven lanes and the plan predicts every move", () => {
  for (const [how, names] of [
    ["six with Needs you", ["New", "Planned", "In progress", "Needs you", "Landed"]],
    ["four", ["New", "Next up", "Landed"]],
  ]) {
    const db = before0016();
    const [inbox, done] = ["inbox", "done"].map((r) => role(db, r));
    const columns = names.map((n) => label(db, n));
    const triage = label(db, "Triage");
    const cards = board(db, "Cards", "ada@example.com", 1, AT, [...columns, done]);
    const web = board(db, "Web", "ada@example.com", 0, AT, [triage, inbox, done]);
    item(db, triage, true, [[web, "a0"]]);
    item(db, inbox, true, [[web, "a1"]]);
    columns.forEach((id, at) => item(db, id, true, [[cards, `a${at}`]]));

    const { before, lanes, moved } = predicts(db);
    assert.deepEqual(Object.values(lanes), ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"], how);
    assert.deepEqual([...moved.Triage.toOpen], ["In progress"], how);
    for (const kept of names.filter((n) => Object.values(lanes).includes(n))) assert.equal(moved[kept], undefined, `${how}: ${kept}`);
    if (names.includes("Next up")) assert.deepEqual([...moved["Next up"].toOpen], ["In progress"], how);
    assert.ok(before.labels.some((r) => r.label === "Triage"), how);
  }
});

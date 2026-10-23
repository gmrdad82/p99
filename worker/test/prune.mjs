import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_NAMES } from "../src/cards.js";
import { LANES_SQL } from "../src/one-board.js";
import { ALL, boardRows, dump, fold, item, label, lane, laneOfItem, migrated, place, seeded } from "./fold.mjs";

const PRUNE = "0017_delete_archived.sql";
const PLAN = ["lanes", "boards", "labels", "orders", "tags"];

function prune(root, db) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  try {
    db.exec(readFileSync(join(root, "migrations", PRUNE), "utf8"));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function folded(root, extra = "", after = "") {
  const db = seeded(root, extra);
  fold(root, db);
  db.exec(after);
  return db;
}

function planOf(root, db) {
  const read = (name) => readFileSync(join(root, "..", "src", "prune", `${name}.sql`), "utf8");
  const [lanes, boards, labels, orders, tags] = PLAN.map((name) => db.prepare(read(name)).all());
  return { lanes: lanes[0].lanes, boards, labels, orders: orders[0].unplaced, tags: tags[0].tags };
}

function has(db, table) {
  return db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).n > 0;
}

function n(db, sql, ...binds) {
  return db.prepare(sql).get(...binds).n;
}

function events(db) {
  return db.prepare("SELECT id, item_id, kind, detail_json, at FROM events ORDER BY id").all().map((e) => ({ ...e }));
}

function lanes(db) {
  return Object.fromEntries(LANE_NAMES.map((name) => [name, lane(db, name)]));
}

function lastKey(db, name) {
  return db
    .prepare(
      `SELECT max(bp.key) AS k FROM board_positions bp JOIN boards b ON b.id = bp.board_id AND b.cards = 1 JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
       JOIN labels l ON l.id = i.label_id WHERE l.name = ?`,
    )
    .get(name).k;
}

function keyOf(db, id) {
  return db.prepare("SELECT bp.key FROM board_positions bp JOIN boards b ON b.id = bp.board_id AND b.cards = 1 WHERE bp.item_id = ?").get(id)?.key ?? null;
}

function gone(db) {
  assert.equal(n(db, "SELECT count(*) AS n FROM boards WHERE cards = 0"), 0);
  assert.equal(n(db, "SELECT count(*) AS n FROM board_columns WHERE board_id NOT IN (SELECT id FROM boards WHERE cards = 1)"), 0);
  assert.equal(n(db, "SELECT count(*) AS n FROM board_positions WHERE board_id NOT IN (SELECT id FROM boards WHERE cards = 1)"), 0);
  assert.deepEqual(db.prepare("SELECT name FROM labels ORDER BY name").all().map((r) => r.name), [...LANE_NAMES].sort());
  assert.deepEqual(db.prepare(LANES_SQL).all().map((l) => l.name), LANE_NAMES);
  assert.equal(n(db, "SELECT count(*) AS n FROM item_labels"), 0);
  assert.equal(has(db, "archived"), false);
  assert.equal(n(db, "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'prune\\_%' ESCAPE '\\'"), 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}

export async function pruneChecks({ check, root }) {
  await check("[prune] an old board with nothing the one board lacks is deleted with its columns and places; every item's history and place stays", async () => {
    const db = folded(root);
    const before = { events: events(db), lanes: lanes(db), rows: boardRows(db, ALL, {}).map((r) => [r.id, r.lane, r.place, r.ord]) };
    const labelsOf = db.prepare("SELECT id, label_id FROM items ORDER BY id").all().map((r) => [r.id, r.label_id]);
    const plan = planOf(root, db);
    assert.equal(plan.lanes, 7);
    assert.deepEqual(plan.boards.map((b) => [b.id, b.columns, b.places]), [[11, 4, 4], [12, 4, 4], [13, 3, 2]]);
    assert.deepEqual(plan.labels.filter((l) => l.items > 0), []);
    assert.deepEqual(plan.labels.map((l) => l.label), ["Doing", "Inbox", "legacy tag", "QA ready", "Review", "Shipped", "Triage"]);
    assert.equal(plan.orders, 0);
    assert.equal(plan.tags, 1);
    prune(root, db);
    gone(db);
    assert.deepEqual(events(db), before.events);
    assert.deepEqual(lanes(db), before.lanes);
    assert.deepEqual(boardRows(db, ALL, {}).map((r) => [r.id, r.lane, r.place, r.ord]), before.rows);
    assert.deepEqual(db.prepare("SELECT id, label_id FROM items ORDER BY id").all().map((r) => [r.id, r.label_id]), labelsOf);
    const history = db.prepare("SELECT detail_json FROM events WHERE item_id = 6 AND kind = 'label'").all().map((e) => JSON.parse(e.detail_json));
    assert.deepEqual(history, [{ from: "Triage", to: "In progress", migrated: true }]);
  });

  await check("[prune] an item left on an old label is a decision in the plan, and 0017 carries it onto its lane after the last card, in its old board order", async () => {
    const db = folded(root, "", `UPDATE items SET label_id = ${label("QA ready")} WHERE id = 5; UPDATE items SET label_id = ${label("Triage")} WHERE id = 6;
      ${item(21, "Shipped", { open: 0, resolution: "fixed", day: 3 })} ${place(12, 21, "Shipped", "a1")}`);
    const plan = planOf(root, db);
    assert.deepEqual(
      plan.labels.filter((l) => l.items > 0).map((l) => [l.label, l.items, l.open]),
      [["QA ready", 1, 1], ["Shipped", 1, 0], ["Triage", 1, 1]],
    );
    const tail = lastKey(db, "In progress");
    const doneTail = lastKey(db, "Done");
    const before = lane(db, "In progress");
    const at = n(db, "SELECT count(*) AS n FROM events");
    prune(root, db);
    gone(db);
    assert.equal(laneOfItem(db, 5), "In progress");
    assert.equal(laneOfItem(db, 6), "In progress");
    assert.equal(laneOfItem(db, 21), "Done");
    assert.deepEqual(lane(db, "In progress"), [...before.filter((id) => id !== 5 && id !== 6), 5, 6]);
    assert.deepEqual([keyOf(db, 5), keyOf(db, 6)], [`${tail}Va0V`, `${tail}Va1V`]);
    assert.equal(keyOf(db, 21), `${doneTail}Va0V`);
    assert.deepEqual({ ...db.prepare("SELECT open, resolution FROM items WHERE id = 21").get() }, { open: 0, resolution: "fixed" });
    const moved = db
      .prepare("SELECT item_id, detail_json, actor_email, internal FROM events WHERE id > ? ORDER BY id")
      .all(at)
      .map((e) => [e.item_id, JSON.parse(e.detail_json), e.actor_email, e.internal]);
    assert.deepEqual(moved, [
      [5, { from: "QA ready", to: "In progress", migrated: true }, null, 1],
      [6, { from: "Triage", to: "In progress", migrated: true }, null, 1],
      [21, { from: "Shipped", to: "Done", migrated: true }, null, 1],
    ]);
  });

  await check("[prune] an order only an old board holds is a decision, and the item gets a place on the one board after its lane's last card", async () => {
    const db = folded(root, "", "DELETE FROM board_positions WHERE board_id = 14 AND item_id = 4;");
    assert.equal(keyOf(db, 4), null);
    assert.equal(planOf(root, db).orders, 1);
    const tail = lastKey(db, "Done");
    prune(root, db);
    gone(db);
    assert.equal(keyOf(db, 4), `${tail}Va0V`);
    assert.equal(laneOfItem(db, 4), "Done");
  });

  await check("[prune] a carried item lands first in a lane with no placed card, keyed as 0016 keys a lane", async () => {
    const db = folded(root, "", `DELETE FROM board_positions WHERE board_id = 14 AND label_id = ${label("In progress")}; UPDATE items SET label_id = ${label("Triage")} WHERE id = 6;`);
    assert.equal(lastKey(db, "In progress"), null);
    prune(root, db);
    gone(db);
    assert.equal(keyOf(db, 6), "a0");
    assert.equal(lane(db, "In progress")[0], 6);
  });

  await check("[prune] the old tags 0016 left unused are deleted, every one, since nothing reads item_labels", async () => {
    const db = folded(root, "INSERT INTO item_labels (item_id, label_id) SELECT id, label_id FROM items WHERE id IN (2, 3);");
    assert.ok(n(db, "SELECT count(*) AS n FROM item_labels") >= 3);
    assert.equal(planOf(root, db).tags, n(db, "SELECT count(*) AS n FROM item_labels"));
    prune(root, db);
    assert.equal(n(db, "SELECT count(*) AS n FROM item_labels"), 0);
  });

  await check("[prune] a second run of 0017 changes nothing", async () => {
    const db = folded(root, "", `UPDATE items SET label_id = ${label("Triage")} WHERE id = 6;`);
    prune(root, db);
    const once = dump(db);
    const at = events(db);
    prune(root, db);
    assert.deepEqual(dump(db), once);
    assert.deepEqual(events(db), at);
    const plan = planOf(root, db);
    assert.deepEqual([plan.boards, plan.labels, plan.orders, plan.tags], [[], [], 0, 0]);
  });

  await check("[prune] a 1.10 account running 0016 then 0017 together ends on the one board with no archive, every item in the lane 0016 gave it", async () => {
    const only = folded(root);
    const db = seeded(root);
    fold(root, db);
    prune(root, db);
    gone(db);
    assert.deepEqual(lanes(db), lanes(only));
    assert.equal(n(db, "SELECT count(*) AS n FROM items"), n(only, "SELECT count(*) AS n FROM items"));
    assert.equal(n(db, "SELECT count(*) AS n FROM events"), n(only, "SELECT count(*) AS n FROM events"));
    assert.equal(n(db, "SELECT count(*) AS n FROM items i WHERE i.label_id NOT IN (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)"), 0);
  });

  await check("[prune] a fresh account runs 0016 and 0017 and has the seven lanes and nothing else", async () => {
    const db = migrated(root, "0016");
    fold(root, db);
    prune(root, db);
    gone(db);
    assert.equal(n(db, "SELECT count(*) AS n FROM boards"), 1);
  });

  await check("[prune] with a Cards board short of seven lanes 0017 deletes no board, label or place, only the unread tags and the empty archive", async () => {
    const db = folded(root, "", `DELETE FROM board_positions WHERE board_id = 14 AND label_id = ${label("Stuck")}; DELETE FROM board_columns WHERE board_id = 14 AND label_id = ${label("Stuck")}; UPDATE items SET label_id = ${label("Triage")} WHERE id = 6;`);
    assert.equal(planOf(root, db).lanes, 6);
    const keep = (d) => ["boards", "board_columns", "board_positions", "labels", "items", "events"].map((t) => d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
    const before = keep(db);
    prune(root, db);
    assert.deepEqual(keep(db), before);
    assert.equal(laneOfItem(db, 6), "Triage");
    assert.equal(n(db, "SELECT count(*) AS n FROM item_labels"), 0);
    assert.equal(has(db, "archived"), false);
  });

  await check("[prune] a statement that fails midway rolls the whole of 0017 back, deleting nothing", async () => {
    const db = folded(root, "", `UPDATE items SET label_id = ${label("Triage")} WHERE id = 6;`);
    const before = dump(db);
    db.exec("CREATE TRIGGER no_drop BEFORE DELETE ON boards BEGIN SELECT RAISE(ABORT, 'refused'); END;");
    assert.throws(() => prune(root, db), /refused/);
    assert.deepEqual(dump(db), before);
    assert.equal(laneOfItem(db, 6), "Triage");
  });

  await check("[prune] the plan's queries only read and list exactly what 0017 then deletes and carries", async () => {
    const db = folded(root, "", `UPDATE items SET label_id = ${label("Triage")} WHERE id = 6; DELETE FROM board_positions WHERE board_id = 14 AND item_id = 4;`);
    const plan = planOf(root, db);
    const boards = plan.boards.map((b) => b.id);
    const labels = plan.labels.map((l) => l.label);
    const carried = plan.labels.filter((l) => l.items > 0).map((l) => l.label);
    const places = plan.boards.reduce((sum, b) => sum + b.places, 0);
    assert.equal(places, n(db, "SELECT count(*) AS n FROM board_positions WHERE board_id <> 14"));
    const at = n(db, "SELECT max(id) AS n FROM events");
    prune(root, db);
    assert.deepEqual(boards.filter((id) => n(db, "SELECT count(*) AS n FROM boards WHERE id = ?", id) > 0), []);
    assert.deepEqual(labels.filter((name) => n(db, "SELECT count(*) AS n FROM labels WHERE name = ?", name) > 0), []);
    const moved = db.prepare("SELECT json_extract(detail_json, '$.from') AS f FROM events WHERE id > ?").all(at).map((r) => r.f);
    assert.deepEqual(moved, carried);
    assert.notEqual(keyOf(db, 4), null);
  });
}

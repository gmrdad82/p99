import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LABEL_COLUMNS, LABEL_JOIN, closeItem, placeIn, postMove, useKit } from "../src/boards.js";
import { useKit as useCardKit } from "../src/cards.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-10-23T09:00:00.000Z";
const HOST = "shop.example.com";
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const MOVED = "this card moved; refreshed";

class Refused extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const mails = [];
const fail = (status, message, code) => {
  throw new Refused(status, message, code);
};
const keyOf = (kind, id) => `${kind === "feature" ? "FEAT" : "BUG"}-${id}`;
const parseKey = (raw) => {
  const match = /^(?:[A-Za-z]{1,10}-)?(\d{1,15})$/.exec(String(raw).trim());
  return match ? Number(match[1]) : null;
};
const json = (status, body) => ({ status, body });

useCardKit({ fail, json, keyOf, parseKey });

useKit({
  MAX_JSON_BYTES: 1 << 20,
  fail,
  json,
  keyOf,
  parseKey,
  readJson: async (c) => c.body,
  refuseAgentClose: () => {},
  requireManager: (c) => {
    if (!c.manager) throw new Refused(403, "only managers may do this");
  },
  sendMail: (c, row, token, mail) => mails.push({ id: row.id, ...mail }),
  REPORTERS_TOKEN: "reporters",
});

function world() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, file), "utf8"));
  return db;
}

const LANES_OF = `SELECT b.id AS board, l.id, l.name FROM boards b JOIN board_columns bc ON bc.board_id = b.id
  JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 ORDER BY bc.position`;
const probe = world().prepare(LANES_OF).all();
const BOARD = probe[0].board;
const [NEW, , WORKING, , , LANDED, DONE] = probe.map((l) => l.id);
const [NEW_NAME, , WORKING_NAME, , , LANDED_NAME] = probe.map((l) => l.name);

function item(db, id, label, key = null) {
  db.prepare(
    `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
       reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at, created_at, updated_at)
     VALUES (?, ?, 'bug', ?, 1, ?, '', 'production', ?, ?, '/', '', 'grace@example.com', 'Grace Hopper', '{}', '{}', '[]', '', ?, ?, ?, ?)`,
  ).run(id, `uid-${id}`, label, `Report ${id}`, HOST, `https://${HOST}/`, NOW, NOW, NOW, NOW);
  if (key !== null) db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, ?)").run(BOARD, id, label, key);
}

function numbered(sql, args) {
  const order = [];
  const text = sql.replace(/\?(\d+)/g, (_, n) => {
    order.push(args[Number(n) - 1]);
    return "?";
  });
  return [text, order];
}

function d1(db, seam = async () => {}) {
  let batches = 0;
  const statement = (sql, args) => {
    const run = () => {
      const [text, order] = numbered(sql, args);
      const prepared = db.prepare(text);
      if (prepared.columns().length > 0) return { results: prepared.all(...order).map((r) => ({ ...r })), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(prepared.run(...order).changes) } };
    };
    return {
      bind: (...next) => statement(sql, next),
      first: async () => run().results[0] ?? null,
      all: async () => run(),
      run: async () => run(),
      exec: run,
    };
  };
  return {
    prepare: (sql) => statement(sql, []),
    batch: async (list) => {
      batches += 1;
      await seam(batches);
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = list.map((s) => s.exec());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function context(DB, body) {
  return { env: { DB }, actor: ADA, manager: true, browser: false, scope: { all: true, host: null }, now: NOW, pushes: [], body };
}

async function answer(fn) {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    return { status: error.status, body: { message: error.message, error: error.code } };
  }
}

async function race(db, bodies) {
  const log = [];
  const out = new Array(bodies.length);
  const go = async (i) => {
    const DB = d1(db, async (n) => {
      if (n !== 1) return;
      log.push(`read ${i}`);
      if (i + 1 < bodies.length) await go(i + 1);
      log.push(`write ${i}`);
    });
    out[i] = await answer(() => postMove(context(DB, bodies[i])));
  };
  await go(0);
  return { out, log };
}

function readsFirst(count) {
  return [...Array.from({ length: count }, (_, i) => `read ${i}`), ...Array.from({ length: count }, (_, i) => `write ${count - 1 - i}`)];
}

function events(db, id, kind) {
  return db.prepare("SELECT detail_json FROM events WHERE item_id = ? AND kind = ? ORDER BY id").all(id, kind).map((r) => JSON.parse(r.detail_json));
}

function positions(db, id) {
  return db.prepare("SELECT label_id, key FROM board_positions WHERE board_id = ? AND item_id = ?").all(BOARD, id).map((r) => ({ ...r }));
}

function labelOf(db, id) {
  return db.prepare("SELECT label_id, open FROM items WHERE id = ?").get(id);
}

function rowOf(db, id) {
  return { ...db.prepare(`SELECT i.*, ${LABEL_COLUMNS} FROM items i ${LABEL_JOIN} WHERE i.id = ?`).get(id) };
}

function winnersAndLosers(out) {
  const won = out.filter((r) => r.status === 200);
  const lost = out.filter((r) => r.status !== 200);
  for (const r of lost) assert.deepEqual(r, { status: 409, body: { message: MOVED, error: "moved" } });
  return { won, lost };
}

test("the account's board has its seven lanes, so the races below run on the one board every client moves on", () => {
  assert.equal(probe.length, 7);
  assert.equal(new Set(probe.map((l) => l.board)).size, 1);
  assert.deepEqual([NEW_NAME, WORKING_NAME, LANDED_NAME], ["New", "In progress", "Landed"]);
});

test("six moves of one card into In progress that all read before any wrote make one move, one label event, one status event and one order key; the other five get 409", async () => {
  const db = world();
  item(db, 11, NEW, "a0");
  item(db, 12, WORKING, "a0");
  const { out, log } = await race(db, Array.from({ length: 6 }, () => ({ key: "BUG-11", from: "new", to: "in-progress" })));
  assert.deepEqual(log, readsFirst(6));
  const { won, lost } = winnersAndLosers(out);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 5);
  assert.equal(won[0].body.card.label, WORKING_NAME);
  assert.deepEqual(events(db, 11, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
  assert.deepEqual(events(db, 11, "status"), [{ from: "received", to: "in_progress" }]);
  assert.deepEqual(positions(db, 11), [{ label_id: WORKING, key: won[0].body.card.order }]);
  assert.deepEqual({ ...labelOf(db, 11) }, { label_id: WORKING, open: 1 });
  assert.deepEqual(positions(db, 12), [{ label_id: WORKING, key: "a0" }]);
});

test("two moves of one card into different lanes, both read first: the one that writes first lands, the other gets 409 and writes no event or key", async () => {
  const db = world();
  item(db, 21, NEW);
  const { out, log } = await race(db, [
    { key: "BUG-21", from: NEW_NAME, to: "landed" },
    { key: "BUG-21", from: NEW_NAME, to: "in-progress" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  assert.deepEqual(events(db, 21, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
  assert.equal(events(db, 21, "status").length, 1);
  assert.equal(labelOf(db, 21).label_id, WORKING);
  assert.deepEqual(positions(db, 21), [{ label_id: WORKING, key: out[1].body.card.order }]);
});

test("two moves of one card into one lane at different places, both read first: the winner's place stands and the loser writes no key over it", async () => {
  const db = world();
  item(db, 25, NEW, "a0");
  item(db, 26, WORKING, "a0");
  const { out, log } = await race(db, [
    { key: "BUG-25", from: "new", to: "in-progress", before: "BUG-26" },
    { key: "BUG-25", from: "new", to: "in-progress", after: "BUG-26" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  assert.ok(out[1].body.card.order > "a0", out[1].body.card.order);
  assert.deepEqual(positions(db, 25), [{ label_id: WORKING, key: out[1].body.card.order }]);
  assert.deepEqual(events(db, 25, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
});

test("two different cards moved into one lane at once both land, each with one event and one order key in that lane", async () => {
  const db = world();
  item(db, 31, NEW, "a0");
  item(db, 32, NEW, "a1");
  item(db, 33, WORKING, "a0");
  const { out, log } = await race(db, [
    { key: "BUG-31", from: "new", to: "in-progress" },
    { key: "BUG-32", from: "new", to: "in-progress", after: "BUG-33" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.deepEqual(out.map((r) => r.status), [200, 200]);
  for (const [id, r] of [[31, out[0]], [32, out[1]]]) {
    assert.deepEqual(events(db, id, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
    assert.equal(labelOf(db, id).label_id, WORKING);
    assert.deepEqual(positions(db, id), [{ label_id: WORKING, key: r.body.card.order }]);
  }
  assert.ok(out[0].body.card.order < "a0", out[0].body.card.order);
  assert.ok(out[1].body.card.order > "a0", out[1].body.card.order);
  assert.deepEqual(positions(db, 33), [{ label_id: WORKING, key: "a0" }]);
});

test("two different cards moved into a lane that holds an unkeyed card both land, each with one event and one order key, though each rebalances the lane", async () => {
  const db = world();
  item(db, 101, NEW, "a0");
  item(db, 102, NEW, "a1");
  item(db, 103, WORKING);
  const { out, log } = await race(db, [
    { key: "BUG-101", from: "new", to: "in-progress" },
    { key: "BUG-102", from: "new", to: "in-progress" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.deepEqual(out.map((r) => r.status), [200, 200]);
  for (const id of [101, 102]) {
    assert.deepEqual(events(db, id, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
    assert.equal(labelOf(db, id).label_id, WORKING);
    assert.equal(positions(db, id).length, 1);
    assert.equal(positions(db, id)[0].label_id, WORKING);
  }
  assert.equal(positions(db, 103).length, 1);
});

test("two cards raced to the top of one lane share a key, and a later move anchored between them rebalances the lane instead of failing", async () => {
  const db = world();
  item(db, 111, NEW, "a0");
  item(db, 112, NEW, "a1");
  item(db, 113, WORKING, "a0");
  item(db, 114, NEW, "a2");
  const { out } = await race(db, [
    { key: "BUG-111", from: "new", to: "in-progress" },
    { key: "BUG-112", from: "new", to: "in-progress" },
  ]);
  assert.deepEqual(out.map((r) => r.status), [200, 200]);
  assert.equal(positions(db, 111)[0].key, positions(db, 112)[0].key);
  const moved = await answer(() => postMove(context(d1(db), { key: "BUG-114", from: "new", to: "in-progress", after: "BUG-112" })));
  assert.equal(moved.status, 200);
  assert.deepEqual(events(db, 114, "label"), [{ from: NEW_NAME, to: WORKING_NAME }]);
  const column = db.prepare("SELECT item_id, key FROM board_positions WHERE board_id = ? AND label_id = ? ORDER BY key").all(BOARD, WORKING);
  assert.deepEqual(column.map((r) => r.item_id), [112, 114, 111, 113]);
  assert.equal(new Set(column.map((r) => r.key)).size, 4);
  assert.equal(moved.body.card.order, column[1].key);
});

test("placing between two cards that share a key rebalances the whole column in order, before or after the anchor", () => {
  const column = [{ id: 1, key: "Zz" }, { id: 2, key: "Zz" }, { id: 3, key: "a0" }];
  for (const [side, anchorId] of [["after", 1], ["before", 2]]) {
    const { key, rows } = placeIn(column, 9, { raw: `BUG-${anchorId}`, side }, anchorId);
    assert.deepEqual(rows.map((r) => r.id), [1, 9, 2, 3]);
    const keys = rows.map((r) => r.key);
    assert.deepEqual([...keys].sort(), keys);
    assert.equal(new Set(keys).size, 4);
    assert.equal(key, rows.find((r) => r.id === 9).key);
  }
});

test("two reorders of one card in its own lane, both read first: one lands, the other gets 409, the card keeps the winner's one key", async () => {
  const db = world();
  item(db, 41, WORKING, "a0");
  item(db, 42, WORKING, "a1");
  item(db, 43, WORKING, "a2");
  const { out, log } = await race(db, [
    { key: "BUG-41", from: "in-progress", to: "in-progress", after: "BUG-43" },
    { key: "BUG-41", from: "in-progress", to: "in-progress", after: "BUG-42" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  const key = out[1].body.card.order;
  assert.ok(key > "a1" && key < "a2", key);
  assert.deepEqual(positions(db, 41), [{ label_id: WORKING, key }]);
  assert.deepEqual(events(db, 41, "label"), []);
});

test("a reorder and a move of one card out of its lane, both read first: the move lands and the reorder gets 409 and writes no key", async () => {
  const db = world();
  item(db, 45, WORKING, "a0");
  item(db, 46, WORKING, "a1");
  const { out, log } = await race(db, [
    { key: "BUG-45", from: "in-progress", to: "in-progress", after: "BUG-46" },
    { key: "BUG-45", from: "in-progress", to: "landed" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  assert.deepEqual(events(db, 45, "label"), [{ from: WORKING_NAME, to: LANDED_NAME }]);
  assert.deepEqual(positions(db, 45), [{ label_id: LANDED, key: out[1].body.card.order }]);
});

test("three moves of one card into Done, all read first, close it once: one label event, one status event, one mail, and no key in Done", async () => {
  const db = world();
  item(db, 51, LANDED, "a0");
  mails.length = 0;
  const { out } = await race(db, Array.from({ length: 3 }, () => ({ key: "BUG-51", from: "landed", to: "done" })));
  const { won, lost } = winnersAndLosers(out);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 2);
  assert.equal(won[0].body.card.order, null);
  assert.deepEqual({ ...labelOf(db, 51) }, { label_id: DONE, open: 0 });
  assert.deepEqual(events(db, 51, "label").map((e) => e.from), [LANDED_NAME]);
  assert.deepEqual(events(db, 51, "status"), [{ from: "in_progress", to: "fixed", resolution: "fixed" }]);
  assert.deepEqual(mails.map((m) => m.id), [51]);
  assert.deepEqual(positions(db, 51), [{ label_id: LANDED, key: "a0" }]);
});

test("a move that read a lane the card already left is refused before any write, and a move from where it is now lands", async () => {
  const db = world();
  item(db, 61, NEW, "a0");
  const DB = d1(db);
  assert.equal((await answer(() => postMove(context(DB, { key: "BUG-61", from: "new", to: "in-progress" })))).status, 200);
  const stale = await answer(() => postMove(context(DB, { key: "BUG-61", from: "new", to: "landed" })));
  assert.deepEqual(stale, { status: 409, body: { message: MOVED, error: "moved" } });
  const next = await answer(() => postMove(context(DB, { key: "BUG-61", from: WORKING_NAME, to: "landed" })));
  assert.equal(next.status, 200);
  assert.deepEqual(events(db, 61, "label"), [
    { from: NEW_NAME, to: WORKING_NAME },
    { from: WORKING_NAME, to: LANDED_NAME },
  ]);
  assert.deepEqual(positions(db, 61), [{ label_id: LANDED, key: next.body.card.order }]);
});

test("a reorder still lands when nothing moved the card since its read", async () => {
  const db = world();
  item(db, 71, WORKING, "a0");
  item(db, 72, WORKING, "a1");
  const moved = await answer(() => postMove(context(d1(db), { key: "BUG-71", from: "in-progress", to: "in-progress", after: "BUG-72" })));
  assert.equal(moved.status, 200);
  assert.ok(moved.body.card.order > "a1", moved.body.card.order);
  assert.deepEqual(positions(db, 71), [{ label_id: WORKING, key: moved.body.card.order }]);
});

test("a card with no order key yet is moved once even when two moves read it unkeyed", async () => {
  const db = world();
  item(db, 81, NEW);
  const { out } = await race(db, [
    { key: "BUG-81", from: "new", to: "in-progress" },
    { key: "BUG-81", from: "new", to: "landed" },
  ]);
  assert.equal(out[1].status, 200);
  assert.equal(out[0].status, 409);
  assert.deepEqual(events(db, 81, "label"), [{ from: NEW_NAME, to: LANDED_NAME }]);
  assert.deepEqual(positions(db, 81), [{ label_id: LANDED, key: out[1].body.card.order }]);
});

test("two closes of one item from the same read write one status event and send one mail", async () => {
  const db = world();
  item(db, 91, WORKING);
  const row = rowOf(db, 91);
  mails.length = 0;
  const first = await answer(() => closeItem(context(d1(db), {}), row, "fixed"));
  const second = await answer(() => closeItem(context(d1(db), {}), row, "fixed"));
  assert.equal(first.open, 0);
  assert.deepEqual(second, { status: 409, body: { message: MOVED, error: "moved" } });
  assert.deepEqual(events(db, 91, "status"), [{ from: "in_progress", to: "fixed", resolution: "fixed" }]);
  assert.equal(events(db, 91, "label").length, 1);
  assert.equal(labelOf(db, 91).label_id, DONE);
  assert.deepEqual(mails.map((m) => m.id), [91]);
});

test("a reorder's order push and its label push name the card's project, so a project grant's live board hears them", async () => {
  const db = world();
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (5, 'Atlas', ?)").run(NOW);
  item(db, 81, WORKING, "a0");
  item(db, 82, WORKING, "a1");
  item(db, 83, NEW, "a0");
  db.prepare("UPDATE items SET host = NULL, project_id = 5 WHERE id IN (81, 83)").run();
  const reorder = context(d1(db), { key: "BUG-81", from: "in-progress", to: "in-progress", after: "BUG-82" });
  assert.equal((await answer(() => postMove(reorder))).status, 200);
  assert.deepEqual(reorder.hooked.filter((e) => e.type === "order").map((e) => [e.key, e.host, e.projects]), [["BUG-81", null, [5]]]);
  const moved = context(d1(db), { key: "BUG-83", from: "new", to: "in-progress" });
  assert.equal((await answer(() => postMove(moved))).status, 200);
  assert.deepEqual(moved.hooked.map((e) => [e.type, e.projects]), [["label", [5]], ["order", [5]]]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LABEL_COLUMNS, LABEL_JOIN, closeItem, postMove, useKit } from "../src/boards.js";
import { cardSide } from "../src/cards-read.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-10-23T09:00:00.000Z";
const HOST = "shop.example.com";
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const MOVED = "this card moved; refreshed";
const [INBOX, DOING, REVIEW, DONE] = [1, 2, 3, 4];
const BOARD = 1;

class Refused extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const mails = [];

useKit({
  MAX_JSON_BYTES: 1 << 20,
  cardSide,
  fail: (status, message, code) => {
    throw new Refused(status, message, code);
  },
  json: (status, body) => ({ status, body }),
  keyOf: (kind, id) => `${kind === "feature" ? "FEAT" : "BUG"}-${id}`,
  parseKey: (raw) => {
    const match = /^(?:[A-Za-z]{1,10}-)?(\d{1,15})$/.exec(String(raw).trim());
    return match ? Number(match[1]) : null;
  },
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
  db.prepare("INSERT INTO boards (id, name, host, owner, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)").run(BOARD, "Ada's board", ADA.email, NOW, NOW);
  for (const [position, label] of [INBOX, DOING, REVIEW, DONE].entries()) {
    db.prepare("INSERT INTO board_columns (board_id, label_id, position) VALUES (?, ?, ?)").run(BOARD, label, position);
  }
  return db;
}

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
      if (n === 1) log.push(`read ${i}`);
      if (n !== 2) return;
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

test("six moves of one card into Doing that all read before any wrote make one move, one label event, one status event and one order key; the other five get 409", async () => {
  const db = world();
  item(db, 11, INBOX, "a0");
  item(db, 12, DOING, "a0");
  const { out, log } = await race(db, Array.from({ length: 6 }, () => ({ key: "BUG-11", from: "Inbox", to: "Doing", board: BOARD })));
  assert.deepEqual(log, readsFirst(6));
  const { won, lost } = winnersAndLosers(out);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 5);
  assert.equal(won[0].body.card.label, "Doing");
  assert.deepEqual(events(db, 11, "label"), [{ from: "Inbox", to: "Doing" }]);
  assert.deepEqual(events(db, 11, "status"), [{ from: "received", to: "in_progress" }]);
  assert.deepEqual(positions(db, 11), [{ label_id: DOING, key: won[0].body.card.order }]);
  assert.deepEqual({ ...labelOf(db, 11) }, { label_id: DOING, open: 1 });
  assert.deepEqual(positions(db, 12), [{ label_id: DOING, key: "a0" }]);
});

test("two moves of one card by label alone, both read first: the one that writes first lands, the other gets 409 and writes no event", async () => {
  const db = world();
  item(db, 21, INBOX);
  const { out, log } = await race(db, [
    { key: "BUG-21", from: "Inbox", to: "Review" },
    { key: "BUG-21", from: "Inbox", to: "Doing" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  assert.deepEqual(events(db, 21, "label"), [{ from: "Inbox", to: "Doing" }]);
  assert.equal(events(db, 21, "status").length, 1);
  assert.equal(labelOf(db, 21).label_id, DOING);
  assert.deepEqual(positions(db, 21), []);
});

test("two different cards moved into one column at once both land, each with one event and one order key in that column", async () => {
  const db = world();
  item(db, 31, INBOX, "a0");
  item(db, 32, INBOX, "a1");
  item(db, 33, DOING, "a0");
  const { out, log } = await race(db, [
    { key: "BUG-31", from: "Inbox", to: "Doing", board: BOARD },
    { key: "BUG-32", from: "Inbox", to: "Doing", board: BOARD, after: "BUG-33" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.deepEqual(out.map((r) => r.status), [200, 200]);
  for (const [id, r] of [[31, out[0]], [32, out[1]]]) {
    assert.deepEqual(events(db, id, "label"), [{ from: "Inbox", to: "Doing" }]);
    assert.equal(labelOf(db, id).label_id, DOING);
    assert.deepEqual(positions(db, id), [{ label_id: DOING, key: r.body.card.order }]);
  }
  assert.ok(out[0].body.card.order < "a0", out[0].body.card.order);
  assert.ok(out[1].body.card.order > "a0", out[1].body.card.order);
  assert.deepEqual(positions(db, 33), [{ label_id: DOING, key: "a0" }]);
});

test("two reorders of one card in its own column, both read first: one lands, the other gets 409, the card keeps the winner's one key", async () => {
  const db = world();
  item(db, 41, DOING, "a0");
  item(db, 42, DOING, "a1");
  item(db, 43, DOING, "a2");
  const { out, log } = await race(db, [
    { key: "BUG-41", from: "Doing", to: "Doing", board: BOARD, after: "BUG-43" },
    { key: "BUG-41", from: "Doing", to: "Doing", board: BOARD, after: "BUG-42" },
  ]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200);
  assert.deepEqual(out[0], { status: 409, body: { message: MOVED, error: "moved" } });
  const key = out[1].body.card.order;
  assert.ok(key > "a1" && key < "a2", key);
  assert.deepEqual(positions(db, 41), [{ label_id: DOING, key }]);
  assert.deepEqual(events(db, 41, "label"), []);
});

test("three moves of one card onto the closing column, all read first, close it once: one label event, one status event, one mail", async () => {
  const db = world();
  item(db, 51, REVIEW, "a0");
  mails.length = 0;
  const { out } = await race(db, Array.from({ length: 3 }, () => ({ key: "BUG-51", from: "Review", to: "Done", board: BOARD })));
  const { won, lost } = winnersAndLosers(out);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 2);
  assert.deepEqual({ ...labelOf(db, 51) }, { label_id: DONE, open: 0 });
  assert.deepEqual(events(db, 51, "label"), [{ from: "Review", to: "Done" }]);
  assert.deepEqual(events(db, 51, "status"), [{ from: "in_progress", to: "fixed", resolution: "fixed" }]);
  assert.deepEqual(mails.map((m) => m.id), [51]);
  assert.equal(positions(db, 51).length, 1);
});

test("a move that read a label the card already left is refused before any write, and a move from where it is now lands", async () => {
  const db = world();
  item(db, 61, INBOX, "a0");
  const DB = d1(db);
  assert.equal((await answer(() => postMove(context(DB, { key: "BUG-61", from: "Inbox", to: "Doing", board: BOARD })))).status, 200);
  const stale = await answer(() => postMove(context(DB, { key: "BUG-61", from: "Inbox", to: "Review", board: BOARD })));
  assert.deepEqual(stale, { status: 409, body: { message: MOVED, error: "moved" } });
  const next = await answer(() => postMove(context(DB, { key: "BUG-61", from: "Doing", to: "Review", board: BOARD })));
  assert.equal(next.status, 200);
  assert.deepEqual(events(db, 61, "label"), [
    { from: "Inbox", to: "Doing" },
    { from: "Doing", to: "Review" },
  ]);
  assert.deepEqual(positions(db, 61), [{ label_id: REVIEW, key: next.body.card.order }]);
});

test("a reorder still lands when nothing moved the card since its read", async () => {
  const db = world();
  item(db, 71, DOING, "a0");
  item(db, 72, DOING, "a1");
  const moved = await answer(() => postMove(context(d1(db), { key: "BUG-71", from: "Doing", to: "Doing", board: BOARD, after: "BUG-72" })));
  assert.equal(moved.status, 200);
  assert.ok(moved.body.card.order > "a1", moved.body.card.order);
  assert.deepEqual(positions(db, 71), [{ label_id: DOING, key: moved.body.card.order }]);
});

test("a card on the board with no order key yet is moved once even when two moves read it unkeyed", async () => {
  const db = world();
  item(db, 81, INBOX);
  const { out } = await race(db, [
    { key: "BUG-81", from: "Inbox", to: "Doing", board: BOARD },
    { key: "BUG-81", from: "Inbox", to: "Review", board: BOARD },
  ]);
  assert.equal(out[1].status, 200);
  assert.equal(out[0].status, 409);
  assert.deepEqual(events(db, 81, "label"), [{ from: "Inbox", to: "Review" }]);
  assert.deepEqual(positions(db, 81), [{ label_id: REVIEW, key: out[1].body.card.order }]);
});

test("two closes of one item from the same read write one status event and send one mail", async () => {
  const db = world();
  item(db, 91, DOING);
  const row = rowOf(db, 91);
  mails.length = 0;
  const first = await answer(() => closeItem(context(d1(db), {}), row, "fixed"));
  const second = await answer(() => closeItem(context(d1(db), {}), row, "fixed"));
  assert.equal(first.open, 0);
  assert.deepEqual(second, { status: 409, body: { message: MOVED, error: "moved" } });
  assert.deepEqual(events(db, 91, "status"), [{ from: "in_progress", to: "fixed", resolution: "fixed" }]);
  assert.equal(events(db, 91, "label").length, 1);
  assert.deepEqual(mails.map((m) => m.id), [91]);
});

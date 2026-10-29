import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LABEL_COLUMNS, LABEL_JOIN, useKit as useBoardKit } from "../src/boards.js";
import { useKit as useCardKit } from "../src/cards.js";
import { cardsBoard, patchProject, postCardStatus } from "../src/cards-write.js";
import { leaveNeedsYou } from "../src/needs-you.js";
import { isChars } from "../src/text.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-10-23T09:00:00.000Z";
const HOST = "shop.example.com";
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const GRACE = { email: "grace@example.com", name: "Grace Hopper", agent: false };
const MOVED = { status: 409, body: { message: "this card moved; refreshed", error: "moved" } };

class Refused extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new Refused(status, message, code);
};
const keyOf = (kind, id) => `${kind === "feature" ? "FEAT" : "BUG"}-${id}`;
const parseKey = (raw) => {
  const match = /^(?:[A-Za-z]{1,10}-)?(\d{1,15})$/.exec(String(raw).trim());
  return match ? Number(match[1]) : null;
};
const requireManager = (c) => {
  if (!c.manager) fail(403, "only managers may do this");
};
const json = (status, body) => ({ status, body });

function query(firstBinds = []) {
  const binds = [...firstBinds];
  return {
    binds,
    bind(value) {
      binds.push(value);
      return `?${binds.length}`;
    },
  };
}

useBoardKit({
  MAX_JSON_BYTES: 1 << 20,
  fail,
  json,
  keyOf,
  parseKey,
  readJson: async (c) => c.body,
  requireManager,
  sendMail: () => {},
  REPORTERS_TOKEN: "reporters",
});

useCardKit({
  MAX_BODY_CHARS: 65536,
  MAX_JSON_BYTES: 1 << 20,
  MAX_TITLE_CHARS: 200,
  clean: (value) => value,
  fail,
  isChars,
  isUid: (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value),
  isUniqueViolation: (error) => /UNIQUE constraint failed/i.test(String(error && error.message)),
  issueResponse: async (c, id, status) => json(status, { id }),
  json,
  keyOf,
  loadItem: async (c, raw) => {
    const row = await c.env.DB.prepare(`SELECT i.*, ${LABEL_COLUMNS} FROM items i ${LABEL_JOIN} WHERE i.id = ?1`).bind(parseKey(raw)).first();
    if (!row) fail(404, "no such item");
    return row;
  },
  parseKey,
  push: (c, type, row, extra = {}) => c.pushes.push({ type, ...extra }),
  query,
  readJson: async (c) => c.body,
  readStatement: (c, itemId) =>
    c.env.DB.prepare(
      `INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at`,
    ).bind(c.actor.email, itemId, c.now),
  requireEmptyBody: () => {},
  requireManager,
});

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

const DIR = {
  hosts: new Map([[HOST, { host: HOST, env: "production", config: {}, project_id: 2 }]]),
  projects: new Map([
    [1, { id: 1, name: "Paper" }],
    [2, { id: 2, name: "Splicer" }],
  ]),
};

function context(DB, body) {
  return { env: { DB }, actor: ADA, manager: true, browser: false, scope: { all: true, host: null }, reach: { all: true, projects: null }, dir: DIR, now: NOW, pushes: [], body };
}

async function world() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, file), "utf8"));
  const made = await cardsBoard(context(d1(db), {}));
  const inbox = db.prepare("SELECT id FROM labels WHERE role = 'inbox'").get().id;
  return { db, board: made.board, lanes: made.lanes.map((l) => l.id), inbox };
}

function item(w, id, label, project, key = null) {
  if (project !== null) w.db.prepare("INSERT OR IGNORE INTO projects (name, created_at) VALUES (?, ?)").run(project, NOW);
  const projectId = project === null ? null : w.db.prepare("SELECT id FROM projects WHERE name = ?").get(project).id;
  w.db.prepare(
    `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
       reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at, created_at, updated_at, project, project_id)
     VALUES (?, ?, 'feature', ?, 1, ?, '', 'production', ?, ?, '/', '', 'grace@example.com', 'Grace Hopper', '{}', '{}', '[]', '', ?, ?, ?, ?, ?, ?)`,
  ).run(id, `uid-${id}`, label, `Card ${id}`, HOST, `https://${HOST}/`, NOW, NOW, NOW, NOW, project, projectId);
  if (key !== null) w.db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, ?)").run(w.board, id, label, key);
}

function rowOf(w, id) {
  return { ...w.db.prepare(`SELECT i.*, ${LABEL_COLUMNS} FROM items i ${LABEL_JOIN} WHERE i.id = ?`).get(id) };
}

async function answer(fn) {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    return { status: error.status, body: { message: error.message, error: error.code } };
  }
}

async function race(w, calls) {
  const log = [];
  const out = new Array(calls.length);
  const contexts = new Array(calls.length);
  const go = async (i) => {
    const DB = d1(w.db, async (n) => {
      if (n !== 1) return;
      log.push(`read ${i}`);
      if (i + 1 < calls.length) await go(i + 1);
      log.push(`write ${i}`);
    });
    contexts[i] = context(DB, calls[i].body);
    out[i] = await answer(() => calls[i].run(contexts[i]));
  };
  await go(0);
  return { out, log, contexts };
}

function readsFirst(count) {
  return [...Array.from({ length: count }, (_, i) => `read ${i}`), ...Array.from({ length: count }, (_, i) => `write ${count - 1 - i}`)];
}

function events(w, id, kind) {
  return w.db.prepare("SELECT detail_json FROM events WHERE item_id = ? AND kind = ? ORDER BY id").all(id, kind).map((r) => JSON.parse(r.detail_json));
}

function positions(w, id) {
  return w.db.prepare("SELECT label_id, key FROM board_positions WHERE board_id = ? AND item_id = ?").all(w.board, id).map((r) => ({ ...r }));
}

function comments(w, id) {
  return w.db.prepare("SELECT client_uid FROM comments WHERE item_id = ? ORDER BY id").all(id).map((r) => r.client_uid);
}

function itemOf(w, id) {
  return { ...w.db.prepare("SELECT label_id, project, comment_count FROM items WHERE id = ?").get(id) };
}

const status = (key, word, note, uid) => ({ body: { status: word, note, client_uid: uid }, run: (c) => postCardStatus(c, key) });
const project = (w, id, name) => ({ body: {}, run: (c) => patchProject(c, rowOf(w, id), { project: name }) });

test("two status moves of one card into one lane with a note each, both read first: one lands with its comment and order key, the loser gets 409 and stores no comment, comment event or key", async () => {
  const w = await world();
  item(w, 11, w.lanes[0], "Splicer", "a0");
  item(w, 12, w.lanes[2], "Splicer", "a0");
  const { out, log, contexts } = await race(w, [status("FEAT-11", "in-progress", "Picked up by Ada", "note-a"), status("FEAT-11", "in-progress", "Picked up by Grace", "note-b")]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200, JSON.stringify(out[1]));
  assert.deepEqual(out[0], MOVED);
  assert.deepEqual(comments(w, 11), ["note-b"]);
  assert.equal(events(w, 11, "comment").length, 1);
  assert.equal(itemOf(w, 11).comment_count, 1);
  assert.equal(events(w, 11, "label").length, 1);
  const order = contexts[1].pushes.find((p) => p.type === "order");
  assert.ok(order, JSON.stringify(contexts[1].pushes));
  assert.deepEqual(positions(w, 11), [{ label_id: w.lanes[2], key: order.order }]);
  assert.equal(contexts[0].pushes.length, 0);
  assert.deepEqual(positions(w, 12), [{ label_id: w.lanes[2], key: "a0" }]);
});

test("three status moves of one card into one lane without notes, all read first, write one label event and one order key; both losers get 409", async () => {
  const w = await world();
  item(w, 21, w.lanes[0], "Splicer", "a0");
  const { out, log } = await race(w, Array.from({ length: 3 }, () => ({ body: { status: "planned" }, run: (c) => postCardStatus(c, "FEAT-21") })));
  assert.deepEqual(log, readsFirst(3));
  assert.equal(out[2].status, 200, JSON.stringify(out[2]));
  assert.deepEqual(out.slice(0, 2), [MOVED, MOVED]);
  assert.equal(events(w, 21, "label").length, 1);
  assert.equal(positions(w, 21).length, 1);
  assert.equal(itemOf(w, 21).label_id, w.lanes[1]);
});

test("two cards moved into one lane at once with a note each both land, each with its one comment and one order key", async () => {
  const w = await world();
  item(w, 31, w.lanes[0], "Splicer", "a0");
  item(w, 32, w.lanes[0], "Splicer", "a1");
  const { out } = await race(w, [status("FEAT-31", "stuck", "Waits on the codec", "note-31"), status("FEAT-32", "stuck", "Waits on the mixer", "note-32")]);
  assert.deepEqual(out.map((r) => r.status), [200, 200]);
  for (const [id, uid] of [[31, "note-31"], [32, "note-32"]]) {
    assert.deepEqual(comments(w, id), [uid]);
    assert.equal(events(w, id, "comment").length, 1);
    assert.equal(events(w, id, "label").length, 1);
    assert.equal(positions(w, id).length, 1);
    assert.equal(itemOf(w, id).label_id, w.lanes[4]);
  }
});

test("a note on a card that stays in its lane is still stored when nothing races it", async () => {
  const w = await world();
  item(w, 41, w.lanes[1], "Splicer", "a0");
  const c = context(d1(w.db), { status: "planned", note: "Still planned", client_uid: "note-41" });
  const out = await answer(() => postCardStatus(c, "FEAT-41"));
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual(comments(w, 41), ["note-41"]);
  assert.equal(events(w, 41, "comment").length, 1);
  assert.deepEqual(events(w, 41, "label"), []);
  assert.deepEqual(positions(w, 41), [{ label_id: w.lanes[1], key: "a0" }]);
});

test("two project sets of one plain issue at once, both read first: the winner's name and one project event stand; the loser gets 409 and writes nothing, and the issue keeps its lane", async () => {
  const w = await world();
  item(w, 51, w.inbox, null);
  const { out, log } = await race(w, [project(w, 51, "Paper"), project(w, 51, "Splicer")]);
  assert.deepEqual(log, readsFirst(2));
  assert.equal(out[1].status, 200, JSON.stringify(out[1]));
  assert.deepEqual(out[0], MOVED);
  assert.deepEqual(itemOf(w, 51), { label_id: w.inbox, project: "Splicer", comment_count: 0 });
  assert.deepEqual(events(w, 51, "project"), [{ from: null, to: "Splicer" }]);
  assert.deepEqual(events(w, 51, "label"), []);
  assert.deepEqual(positions(w, 51), []);
});

test("two project clears of one card in a lane at once, both read first: one project event, the card stays in its lane with its key; the loser gets 409", async () => {
  const w = await world();
  item(w, 61, w.lanes[2], "Splicer", "a0");
  const { out } = await race(w, [project(w, 61, null), project(w, 61, null)]);
  assert.deepEqual(out[1], { status: 200, body: { id: 61 } });
  assert.deepEqual(out[0], MOVED);
  assert.deepEqual(itemOf(w, 61), { label_id: w.lanes[2], project: null, comment_count: 0 });
  assert.deepEqual(events(w, 61, "project"), [{ from: "Splicer", to: null }]);
  assert.deepEqual(events(w, 61, "label"), []);
  assert.deepEqual(positions(w, 61), [{ label_id: w.lanes[2], key: "a0" }]);
});

test("a project rename of one card raced by a clear, both read first: the first to write stands with its one event; the other gets 409", async () => {
  const w = await world();
  item(w, 65, w.lanes[1], "Splicer", "a0");
  const { out } = await race(w, [project(w, 65, "Paper"), project(w, 65, null)]);
  assert.deepEqual(out[1], { status: 200, body: { id: 65 } });
  assert.deepEqual(out[0], MOVED);
  assert.equal(itemOf(w, 65).project, null);
  assert.deepEqual(events(w, 65, "project"), [{ from: "Splicer", to: null }]);
});

test("a project set on a plain issue already open in the first lane lands without a move", async () => {
  const w = await world();
  item(w, 71, w.lanes[0], null);
  const out = await answer(() => patchProject(context(d1(w.db), {}), rowOf(w, 71), { project: "Splicer" }));
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual(itemOf(w, 71), { label_id: w.lanes[0], project: "Splicer", comment_count: 0 });
  assert.deepEqual(events(w, 71, "project"), [{ from: null, to: "Splicer" }]);
  assert.deepEqual(events(w, 71, "label"), []);
});

test("two replies that each take one card out of Needs you, both read first: one moves it back with one label event and one key; the other writes no event, and no key over a reorder that landed since", async () => {
  const w = await world();
  item(w, 81, w.lanes[3], "Splicer", "a0");
  item(w, 82, w.lanes[2], "Splicer", "a0");
  const row = rowOf(w, 81);
  const plans = [];
  for (const actor of [ADA, GRACE]) plans.push(await leaveNeedsYou({ ...context(d1(w.db), {}), actor }, row));
  for (const plan of plans) assert.equal(plan.statements.length > 0, true);
  const DB = d1(w.db);
  const won = await DB.batch(plans[1].statements);
  const [placed] = positions(w, 81);
  assert.equal(placed.label_id, w.lanes[2]);
  assert.ok(placed.key < "a0", placed.key);
  w.db.prepare("UPDATE board_positions SET key = 'a1' WHERE item_id = 81").run();
  const lost = await DB.batch(plans[0].statements);
  assert.equal(won[0].meta.changes, 1);
  assert.equal(lost[0].meta.changes, 0);
  assert.equal(itemOf(w, 81).label_id, w.lanes[2]);
  assert.equal(events(w, 81, "label").length, 1);
  assert.deepEqual(positions(w, 81), [{ label_id: w.lanes[2], key: "a1" }]);
  assert.deepEqual(positions(w, 82), [{ label_id: w.lanes[2], key: "a0" }]);
});

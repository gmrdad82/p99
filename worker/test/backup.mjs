import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { BACKUP_TABLES, backupDue, backupStep, cutRows, forwardOf, pageKey, pageQuery, pullLanes } from "../src/backup.js";

const MONDAY = new Date("2026-10-19T03:00:00.000Z");
const DATE = "2026-10-19";
const AT = "2026-10-01T00:00:00.000Z";
const LIST_PAGE = 3;

const minutes = (from, n) => new Date(from.getTime() + n * 60000);

function migrated(root) {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, file), "utf8"));
  return db;
}

function numbered(sql, args) {
  const order = [];
  const text = sql.replace(/\?(\d+)/g, (_, n) => {
    order.push(args[Number(n) - 1]);
    return "?";
  });
  return [text, order];
}

function d1(db) {
  const statement = (sql, args) => {
    const [text, order] = numbered(sql, args);
    return {
      bind: (...next) => statement(sql, next),
      first: async () => {
        const row = db.prepare(text).get(...order);
        return row ? { ...row } : null;
      },
      all: async () => ({ results: db.prepare(text).all(...order).map((r) => ({ ...r })) }),
      run: async () => ({ meta: { changes: Number(db.prepare(text).run(...order).changes) } }),
    };
  };
  return {
    prepare: (sql) => statement(sql, []),
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of list) out.push(await s.all());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function r2() {
  const objects = new Map();
  const bucket = {
    objects,
    failDeletes: 0,
    async put(key, text, options = {}) {
      objects.set(key, { text: String(text), customMetadata: { ...(options.customMetadata || {}) } });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { text: async () => o.text, customMetadata: o.customMetadata } : null;
    },
    async list({ prefix = "", cursor, include = [] } = {}) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
      const shown = keys.slice(0, LIST_PAGE);
      const truncated = keys.length > LIST_PAGE;
      return {
        objects: shown.map((key) => (include.includes("customMetadata") ? { key, customMetadata: objects.get(key).customMetadata } : { key })),
        truncated,
        cursor: truncated ? shown[shown.length - 1] : undefined,
      };
    },
    async delete(keys) {
      if (bucket.failDeletes > 0) {
        bucket.failDeletes -= 1;
        throw new Error("bucket unavailable");
      }
      for (const key of [].concat(keys)) objects.delete(key);
    },
  };
  return bucket;
}

function setup(root) {
  const db = migrated(root);
  return { db, env: { DB: d1(db), BUCKET: r2() } };
}

const indexOf = (name) => BACKUP_TABLES.findIndex((t) => t.name === name);

const board = (db, name) =>
  db.prepare("INSERT INTO boards (name, host, created_at, updated_at) VALUES (?, 'example.com', ?, ?) RETURNING id").get(name, AT, AT).id;

const label = (db, name) => db.prepare("INSERT INTO labels (name, color, created_at) VALUES (?, '#e5534b', ?) RETURNING id").get(name, AT).id;

async function logged(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return lines;
}

const inbox = (db) => db.prepare("SELECT id FROM labels WHERE role = 'inbox'").get().id;

function fileItem(db, uid, label = inbox(db)) {
  const { id } = db
    .prepare(
      `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
         reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at,
         created_at, updated_at)
       VALUES (?, 'bug', ?, 1, ?, '', 'production', 'example.com', 'https://example.com/', '/', 'Home', 'ada@example.com',
         'Ada Lovelace', '{}', '{}', '[]', ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(uid, label, `Item ${uid}`, uid, AT, AT, AT, AT);
  db.prepare("INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at) VALUES (?, 'ada@example.com', 'filed', '{}', 0, ?)").run(id, AT);
  return id;
}

function comment(db, item, uid) {
  return db
    .prepare(
      `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env, created_at)
       VALUES (?, ?, 'grace@example.com', 'Grace Hopper', 0, 'Seen it too.', 0, 'production', ?) RETURNING id`,
    )
    .get(item, uid, AT).id;
}

function deleteItem(db, id) {
  for (const table of ["events", "comments", "board_positions", "item_labels"]) db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(id);
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
}

const runRow = (db, date = DATE) => {
  const row = db.prepare("SELECT * FROM backup_runs WHERE date = ?").get(date);
  return row ? { ...row } : null;
};

async function runToEnd(env, db, from = MONDAY, between = async () => {}) {
  for (let tick = 0; tick < 80; tick++) {
    await backupStep(env, minutes(from, tick * 15));
    const open = db.prepare("SELECT count(*) AS n FROM backup_runs WHERE finished_at IS NULL").get().n;
    if (open === 0) return tick + 1;
    await between(tick);
  }
  throw new Error("the backup never finished");
}

function pagesOf(bucket, date = DATE) {
  return [...bucket.objects]
    .filter(([key]) => key.startsWith(`backups/${date}/`))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, o]) => ({ key, run: o.customMetadata.run, ...JSON.parse(o.text) }));
}

function restore(root, pages) {
  const db = migrated(root);
  db.exec("BEGIN");
  for (const table of new Set(pages.map((p) => p.table))) db.exec(`DELETE FROM "${table}"`);
  for (const p of pages) {
    for (const { _rowid, ...row } of p.rows) {
      if (p.table === "sqlite_sequence") db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(row.name);
      const names = Object.keys(row);
      db.prepare(`INSERT INTO "${p.table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
        ...names.map((n) => row[n]),
      );
    }
  }
  db.exec("COMMIT");
  const dangling = db.prepare("PRAGMA foreign_key_check").all().map((r) => ({ ...r }));
  return { db, dangling };
}

const rowsOf = (pages, table) => pages.filter((p) => p.table === table).flatMap((p) => p.rows);

export async function backupChecks({ check, root }) {
  await check("[backup] a backup is due on the first run, after eight days, and on a Monday from 03:00 UTC once per date", async () => {
    assert.equal(backupDue(null, MONDAY), true);
    assert.equal(backupDue({ date: "2026-10-12", started_at: "2026-10-12T03:00:00.000Z" }, MONDAY), true);
    assert.equal(backupDue({ date: DATE, started_at: "2026-10-19T03:00:00.000Z" }, minutes(MONDAY, 60)), false);
    assert.equal(backupDue({ date: "2026-10-12", started_at: "2026-10-12T03:00:00.000Z" }, new Date("2026-10-19T02:59:00.000Z")), false);
    assert.equal(backupDue({ date: "2026-10-19", started_at: "2026-10-19T03:00:00.000Z" }, new Date("2026-10-27T03:00:00.000Z")), true);
    assert.equal(backupDue({ date: "2026-10-14", started_at: "2026-10-14T03:00:00.000Z" }, new Date("2026-10-20T04:00:00.000Z")), false);
  });

  await check("[backup] a page key pads the page number to four digits under the run's date", async () => {
    assert.equal(pageKey(DATE, "items", 7), "backups/2026-10-19/items-0007.json");
    assert.equal(pageKey(DATE, "sqlite_sequence", 1234), "backups/2026-10-19/sqlite_sequence-1234.json");
  });

  await check("[backup] every page query binds exactly the parameters it names, cut tables at their mark and item rows at the items mark", async () => {
    const marks = { items: 9, comments: 4, hosts: 2 };
    for (const table of BACKUP_TABLES) {
      const { sql, binds } = pageQuery(table, marks, 0);
      const named = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      assert.equal(named, binds.length, table.name);
      assert.equal(sql.includes("rowid <= ?4"), Boolean(table.cut), table.name);
      assert.equal(sql.includes("item_id <="), Boolean(table.item), table.name);
    }
    assert.deepEqual(pageQuery(BACKUP_TABLES.find((t) => t.name === "comments"), marks, 3).binds.slice(3), [4, 9]);
    assert.deepEqual(pageQuery(BACKUP_TABLES.find((t) => t.name === "people"), marks, 0).binds.slice(3), [0]);
    assert.equal(pageQuery(BACKUP_TABLES.find((t) => t.name === "labels"), marks, 0).binds.length, 3);
  });

  await check("[backup] every table is paged after every table it points at, the lanes first and the key counters last", async () => {
    const names = BACKUP_TABLES.map((t) => t.name);
    assert.equal(names[names.length - 1], "sqlite_sequence");
    assert.deepEqual(names.slice(0, 3), ["labels", "boards", "board_columns"]);
    for (const table of BACKUP_TABLES) {
      for (const lane of Object.values(table.refs ?? {})) assert.ok(indexOf(lane) < indexOf(table.name), `${table.name} -> ${lane}`);
      if (table.item) assert.ok(indexOf("items") < indexOf(table.name), table.name);
      if (table.lane) assert.equal(table.cut, undefined, table.name);
    }
    for (const [child, parent] of [
      ["attachments", "comments"],
      ["code_devices", "codes"],
      ["items", "labels"],
      ["board_columns", "boards"],
      ["board_columns", "labels"],
      ["board_positions", "boards"],
      ["item_labels", "labels"],
    ]) {
      assert.ok(indexOf(parent) < indexOf(child), `${child} -> ${parent}`);
    }
    for (const [name, refs] of [
      ["board_columns", ["boards", "labels"]],
      ["items", ["labels"]],
      ["board_positions", ["boards", "labels"]],
      ["item_labels", ["labels"]],
    ]) {
      assert.deepEqual(Object.values(BACKUP_TABLES[indexOf(name)].refs).sort(), refs, name);
    }
  });

  await check("[backup] a row pointing at a lane the backup lacks brings it along once; one whose lane is gone is left out", async () => {
    const table = BACKUP_TABLES[indexOf("board_positions")];
    const held = { labels: [1, 2], boards: [7] };
    const snapshot = {
      labels: [
        { _rowid: 1, id: 1, name: "Inbox" },
        { _rowid: 9, id: 9, name: "Blocked" },
      ],
      boards: [
        { _rowid: 7, id: 7, name: "QA" },
        { _rowid: 8, id: 8, name: "Release" },
      ],
    };
    const rows = [
      { _rowid: 1, board_id: 7, label_id: 1 },
      { _rowid: 2, board_id: 7, label_id: 9 },
      { _rowid: 3, board_id: 8, label_id: 9 },
      { _rowid: 4, board_id: 7, label_id: 2 },
      { _rowid: 5, board_id: 6, label_id: 1 },
      { _rowid: 6, board_id: 7, label_id: 5 },
    ];
    const pull = pullLanes(table, rows, held, snapshot);
    assert.deepEqual(pull.rows.map((r) => r._rowid), [1, 2, 3, 4]);
    assert.deepEqual(pull.dropped, [5, 6]);
    assert.deepEqual(pull.pulled.labels.map((r) => r.id), [9]);
    assert.deepEqual(pull.pulled.boards.map((r) => r.id), [8]);
    assert.deepEqual(held, { labels: [1, 2], boards: [7] });
    const quiet = pullLanes(table, rows.slice(0, 1), held, snapshot);
    assert.deepEqual(quiet, { rows: rows.slice(0, 1), pulled: { boards: [], labels: [] }, dropped: [] });
    const items = BACKUP_TABLES[indexOf("items")];
    assert.deepEqual(pullLanes(items, [{ _rowid: 3, label_id: 9 }], { labels: [] }, { labels: [] }).dropped, [3]);
  });

  await check("[backup] a merge pointer past its page waits for its target's page, and stays waiting when the target never comes", async () => {
    const items = BACKUP_TABLES[indexOf("items")];
    const first = [
      { _rowid: 1, duplicate_of: 9 },
      { _rowid: 2, duplicate_of: 1 },
      { _rowid: 3, duplicate_of: 3 },
      { _rowid: 4, duplicate_of: null },
      { _rowid: 5, duplicate_of: 12 },
    ];
    const waiting = forwardOf(items, first, [], 1);
    assert.deepEqual(waiting, [
      [1, 9, 1],
      [5, 12, 1],
    ]);
    const second = [
      { _rowid: 8, duplicate_of: null },
      { _rowid: 9, duplicate_of: null },
      { _rowid: 11, duplicate_of: null },
    ];
    assert.deepEqual(forwardOf(items, second, waiting, 2), [[5, 12, 1]]);
    assert.deepEqual(forwardOf(items, [], [[5, 12, 1]], 3), [[5, 12, 1]]);
  });

  await check("[backup] a row merged into an item filed after the cut keeps no pointer past the cut; others are left as they are", async () => {
    const items = BACKUP_TABLES.find((t) => t.name === "items");
    const rows = [
      { id: 1, duplicate_of: null },
      { id: 2, duplicate_of: 1 },
      { id: 3, duplicate_of: 12 },
    ];
    assert.deepEqual(cutRows(items, { items: 5 }, rows), [
      { id: 1, duplicate_of: null },
      { id: 2, duplicate_of: 1 },
      { id: 3, duplicate_of: null },
    ]);
    assert.equal(rows[2].duplicate_of, 12);
    const comments = BACKUP_TABLES.find((t) => t.name === "comments");
    assert.equal(cutRows(comments, { items: 5 }, rows), rows);
  });

  await check("[backup] a restore never hands a deleted item's key out again, even the newest one", async () => {
    const { db, env } = setup(root);
    const kept = fileItem(db, "kept");
    const doomed = fileItem(db, "doomed");
    deleteItem(db, doomed);
    await runToEnd(env, db);
    const pages = pagesOf(env.BUCKET);
    const counters = rowsOf(pages, "sqlite_sequence");
    assert.equal(counters.find((r) => r.name === "items").seq, doomed);
    assert.deepEqual(rowsOf(pages, "items").map((r) => r.id), [kept]);
    const { db: back, dangling } = restore(root, pages);
    assert.deepEqual(dangling, []);
    const next = fileItem(back, "after the restore");
    assert.ok(next > doomed, `the next item took ${next}, the deleted one had ${doomed}`);
    assert.equal(back.prepare("SELECT count(*) AS n FROM sqlite_sequence WHERE name = 'items'").get().n, 1);
  });

  await check("[backup] a restore without the key counters would reuse the deleted key, so the counters page is what keeps it", async () => {
    const { db, env } = setup(root);
    fileItem(db, "kept");
    const doomed = fileItem(db, "doomed");
    deleteItem(db, doomed);
    await runToEnd(env, db);
    const { db: back } = restore(root, pagesOf(env.BUCKET).filter((p) => p.table !== "sqlite_sequence"));
    assert.equal(fileItem(back, "after a partial restore"), doomed);
  });

  await check("[backup] a second run on the same date (forced by dropping the first run's row) replaces the first whole: no page of the first is left", async () => {
    const { db, env } = setup(root);
    for (let i = 0; i < 4; i++) comment(db, fileItem(db, `item-${i}`), `comment-${i}`);
    const board = db.prepare("INSERT INTO boards (name, host, created_at, updated_at) VALUES ('QA', 'example.com', ?, ?) RETURNING id").get(AT, AT).id;
    db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) SELECT ?, id, label_id, 'a' || id FROM items").run(board);
    await runToEnd(env, db);
    const first = pagesOf(env.BUCKET);
    const firstRun = runRow(db);
    db.prepare("INSERT INTO backup_runs (date, started_at, finished_at, pages) VALUES ('2026-10-12', '2026-10-12T03:00:00.000Z', '2026-10-12T04:00:00.000Z', 1)").run();
    await env.BUCKET.put(pageKey("2026-10-12", "items", 1), JSON.stringify({ table: "items", page: 1, rows: [] }));
    await env.BUCKET.put(pageKey(DATE, "items", 9), JSON.stringify({ table: "items", page: 9, rows: [] }));
    for (const id of db.prepare("SELECT id FROM items").all().map((r) => r.id)) deleteItem(db, id);
    db.prepare("DELETE FROM backup_runs WHERE date = ?").run(DATE);
    const listed = [...env.BUCKET.objects.keys()].filter((k) => k.startsWith(`backups/${DATE}/`)).sort();
    assert.ok(listed.indexOf(pageKey(DATE, "items", 9)) >= LIST_PAGE, "the stale page sits past the bucket's first listing page");
    await runToEnd(env, db, minutes(MONDAY, 120));
    const second = pagesOf(env.BUCKET);
    const secondRun = runRow(db);
    assert.ok(secondRun.started_at > firstRun.started_at);
    assert.equal(second.length, secondRun.pages);
    assert.deepEqual(second.map((p) => p.key), first.map((p) => p.key));
    assert.deepEqual(second.filter((p) => p.run !== secondRun.started_at).map((p) => p.key), []);
    assert.deepEqual(rowsOf(second, "items"), []);
    assert.deepEqual(rowsOf(second, "comments"), []);
    assert.ok(second.every((p) => p.run === secondRun.started_at), "every page names the run that wrote it");
    assert.equal(env.BUCKET.objects.has(pageKey("2026-10-12", "items", 1)), true, "another date's run is left alone");
  });

  await check("[backup] a run whose sweep fails stays open and finishes the sweep on the next step", async () => {
    const { db, env } = setup(root);
    fileItem(db, "one");
    await env.BUCKET.put(pageKey(DATE, "items", 7), JSON.stringify({ table: "items", page: 7, rows: [] }));
    env.BUCKET.failDeletes = 1;
    let failed = 0;
    for (let tick = 0; tick < 80 && runRow(db)?.finished_at == null; tick++) {
      try {
        await backupStep(env, minutes(MONDAY, tick * 15));
      } catch (error) {
        assert.match(error.message, /bucket unavailable/);
        failed += 1;
        assert.equal(runRow(db).finished_at, null);
        assert.equal(runRow(db).table_index, BACKUP_TABLES.length);
      }
    }
    assert.equal(failed, 1);
    const run = runRow(db);
    assert.ok(run.finished_at);
    assert.equal(env.BUCKET.objects.has(pageKey(DATE, "items", 7)), false);
    assert.equal(pagesOf(env.BUCKET).length, run.pages);
  });

  await check("[backup] a backup taken while items are filed, merged and moved restores with no row pointing at one it lacks", async () => {
    const { db, env } = setup(root);
    const board = db.prepare("INSERT INTO boards (name, host, created_at, updated_at) VALUES ('QA', 'example.com', ?, ?) RETURNING id").get(AT, AT).id;
    const old = [];
    for (let i = 0; i < 3; i++) {
      const id = fileItem(db, `old-${i}`);
      comment(db, id, `old-comment-${i}`);
      db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, ?)").run(board, id, inbox(db), `a${i}`);
      old.push(id);
    }
    let late = null;
    let lane = null;
    await runToEnd(env, db, MONDAY, async (tick) => {
      if (tick !== 0) return;
      const run = runRow(db);
      assert.ok(run.table_index > 0 && run.table_index < BACKUP_TABLES.findIndex((t) => t.name === "board_positions"), `step 1 ended at ${run.table_index}`);
      late = fileItem(db, "filed during the run");
      comment(db, late, "late-comment");
      comment(db, old[0], "late-comment-on-old");
      db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, 'z')").run(board, late, inbox(db));
      db.prepare("INSERT INTO item_labels (item_id, label_id) VALUES (?, ?)").run(late, inbox(db));
      db.prepare("UPDATE items SET open = 0, resolution = 'duplicate', duplicate_of = ? WHERE id = ?").run(late, old[1]);
      lane = db.prepare("INSERT INTO labels (name, color, created_at) VALUES ('Blocked', '#e5534b', ?) RETURNING id").get(AT).id;
      db.prepare("UPDATE items SET label_id = ? WHERE id = ?").run(lane, old[2]);
      db.prepare("UPDATE board_positions SET label_id = ? WHERE item_id = ?").run(lane, old[2]);
    });
    assert.ok(late, "no step ended mid-run");
    const pages = pagesOf(env.BUCKET);
    const { db: back, dangling } = restore(root, pages);
    assert.deepEqual(dangling, []);
    assert.deepEqual(back.prepare("SELECT id FROM items ORDER BY id").all().map((r) => r.id), old);
    assert.equal(back.prepare("SELECT count(*) AS n FROM comments").get().n, 3);
    assert.equal(back.prepare("SELECT count(*) AS n FROM events WHERE item_id = ?").get(late).n, 0);
    assert.equal(back.prepare("SELECT count(*) AS n FROM board_positions WHERE item_id = ?").get(late).n, 0);
    assert.equal(back.prepare("SELECT count(*) AS n FROM item_labels").get().n, 0);
    assert.equal(back.prepare("SELECT duplicate_of FROM items WHERE id = ?").get(old[1]).duplicate_of, null);
    assert.equal(back.prepare("SELECT name FROM labels WHERE id = ?").get(lane)?.name, "Blocked");
    assert.ok(back.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get().seq >= late);
    assert.ok(fileItem(back, "after the restore") > late);
    const run = runRow(db);
    assert.equal(JSON.parse(run.rows_json).items, old.length);
    assert.equal(JSON.parse(run.marks_json).items, old[old.length - 1]);
  });

  await check("[backup] a run left open by a version without the cut starts over with one, and finishes whole", async () => {
    const { db, env } = setup(root);
    const id = fileItem(db, "one");
    db.prepare("INSERT INTO backup_runs (date, started_at, table_index, after_rowid, page, pages, rows_json) VALUES (?, '2026-10-19T03:00:00.000Z', 3, 0, 0, 3, '{\"items\":1}')").run(DATE);
    await env.BUCKET.put(pageKey(DATE, "items", 1), JSON.stringify({ table: "items", page: 1, rows: [] }));
    await runToEnd(env, db, minutes(MONDAY, 15));
    const run = runRow(db);
    assert.equal(run.started_at, minutes(MONDAY, 15).toISOString());
    assert.ok(run.marks_json);
    const pages = pagesOf(env.BUCKET);
    assert.equal(pages.length, run.pages);
    assert.deepEqual(rowsOf(pages, "items").map((r) => r.id), [id]);
    assert.ok(pages.every((p) => p.run === run.started_at));
    assert.equal(JSON.parse(run.rows_json).items, 1);
  });

  await check("[backup] a step on a date with nothing due writes nothing", async () => {
    const { db, env } = setup(root);
    db.prepare("INSERT INTO backup_runs (date, started_at, finished_at) VALUES (?, ?, ?)").run(DATE, MONDAY.toISOString(), MONDAY.toISOString());
    await backupStep(env, minutes(MONDAY, 30));
    assert.equal(env.BUCKET.objects.size, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM backup_runs").get().n, 1);
  });

  await check("[backup] a board and a column label made between the lane pages come along, and the restore points at nothing it lacks", async () => {
    const { db, env } = setup(root);
    const many = db.prepare("INSERT INTO labels (name, color, created_at) VALUES (?, '#539bf5', ?)");
    for (let i = 0; i < 2500; i++) many.run(`Lane ${i}`, AT);
    const qa = board(db, "QA");
    const moved = fileItem(db, "moved");
    let made = null;
    await runToEnd(env, db, MONDAY, async () => {
      if (made || runRow(db).table_index !== indexOf("board_columns")) return;
      const release = board(db, "Release");
      const blocked = label(db, "Blocked");
      db.prepare("INSERT INTO board_columns (board_id, label_id, position) VALUES (?, ?, 0)").run(release, blocked);
      db.prepare("UPDATE items SET label_id = ? WHERE id = ?").run(blocked, moved);
      db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, 'a0')").run(qa, moved, blocked);
      made = { release, blocked };
    });
    assert.ok(made, "no step ended between the boards and their columns");
    const pages = pagesOf(env.BUCKET);
    const { db: back, dangling } = restore(root, pages);
    assert.deepEqual(dangling, []);
    assert.equal(back.prepare("SELECT name FROM boards WHERE id = ?").get(made.release)?.name, "Release");
    assert.equal(back.prepare("SELECT name FROM labels WHERE id = ?").get(made.blocked)?.name, "Blocked");
    assert.equal(back.prepare("SELECT label_id FROM board_columns WHERE board_id = ?").get(made.release)?.label_id, made.blocked);
    assert.equal(back.prepare("SELECT label_id FROM items WHERE id = ?").get(moved).label_id, made.blocked);
    for (const lane of ["labels", "boards"]) {
      const mine = pages.filter((p) => p.table === lane);
      assert.deepEqual(mine.map((p) => p.page), mine.map((_, i) => i + 1), lane);
      assert.equal(JSON.parse(runRow(db).held_json).pages[lane], mine.length, lane);
    }
    assert.equal(rowsOf(pages, "labels").filter((r) => r.id === made.blocked).length, 1, "a lane comes along once");
    assert.equal(JSON.parse(runRow(db).rows_json).labels, rowsOf(pages, "labels").length);
  });

  await check("[backup] a board deleted, a label swept and a merge target deleted mid-run restore with nothing dangling, and the log names the cleared pointer", async () => {
    const { db, env } = setup(root);
    const qa = board(db, "QA");
    const spare = board(db, "Spare");
    const flaky = label(db, "Flaky");
    const ids = [];
    for (let i = 0; i < 300; i++) ids.push(fileItem(db, `bulk-${i}`));
    const merged = ids[0];
    const target = ids[ids.length - 1];
    db.prepare("UPDATE items SET open = 0, resolution = 'duplicate', duplicate_of = ? WHERE id = ?").run(target, merged);
    db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, 'a0')").run(qa, ids[1], inbox(db));
    db.prepare("INSERT INTO board_positions (board_id, item_id, label_id, key) VALUES (?, ?, ?, 'a0')").run(spare, ids[2], inbox(db));
    db.prepare("INSERT INTO item_labels (item_id, label_id) VALUES (?, ?)").run(ids[3], flaky);
    let cut = null;
    const lines = await logged(() =>
      runToEnd(env, db, MONDAY, async () => {
        const run = runRow(db);
        if (cut || run.table_index !== indexOf("items") || run.after_rowid < merged || run.after_rowid >= target) return;
        db.prepare("UPDATE items SET duplicate_of = NULL WHERE duplicate_of = ?").run(target);
        deleteItem(db, target);
        db.prepare("DELETE FROM board_positions WHERE board_id = ?").run(spare);
        db.prepare("DELETE FROM boards WHERE id = ?").run(spare);
        db.prepare("DELETE FROM item_labels WHERE label_id = ?").run(flaky);
        db.prepare("DELETE FROM labels WHERE id = ?").run(flaky);
        cut = run.after_rowid;
      }),
    );
    assert.ok(cut, "no step ended between the two items pages");
    const pages = pagesOf(env.BUCKET);
    assert.ok(pages.filter((p) => p.table === "items").length >= 2, "the items span two pages");
    const { db: back, dangling } = restore(root, pages);
    assert.deepEqual(dangling, []);
    assert.equal(back.prepare("SELECT duplicate_of FROM items WHERE id = ?").get(merged).duplicate_of, null);
    assert.equal(back.prepare("SELECT count(*) AS n FROM items WHERE id = ?").get(target).n, 0);
    assert.equal(back.prepare("SELECT count(*) AS n FROM board_positions WHERE board_id = ?").get(spare).n, 0);
    assert.equal(back.prepare("SELECT count(*) AS n FROM item_labels").get().n, 0);
    assert.equal(back.prepare("SELECT count(*) AS n FROM board_positions WHERE board_id = ?").get(qa).n, 1);
    assert.equal(back.prepare("SELECT count(*) AS n FROM items").get().n, ids.length - 1);
    const held = JSON.parse(runRow(db).held_json);
    assert.deepEqual(held.cleared, [merged]);
    assert.deepEqual(held.forward, []);
    assert.equal(held.dropped, undefined);
    assert.ok(pages.every((p) => p.run === runRow(db).started_at), "the rewritten page still names its run");
    assert.ok(lines.some((l) => l.includes(`merge pointer cleared on items ${merged}`)), lines.join("\n"));
  });

  await check("[backup] a merge target filed before the cut and kept keeps its pointer across items pages", async () => {
    const { db, env } = setup(root);
    board(db, "QA");
    board(db, "Spare");
    const ids = [];
    for (let i = 0; i < 300; i++) ids.push(fileItem(db, `bulk-${i}`));
    db.prepare("UPDATE items SET open = 0, resolution = 'duplicate', duplicate_of = ? WHERE id = ?").run(ids[ids.length - 1], ids[0]);
    await runToEnd(env, db);
    const pages = pagesOf(env.BUCKET);
    assert.ok(pages.filter((p) => p.table === "items").length >= 2, "the items span two pages");
    assert.equal(rowsOf(pages, "items").find((r) => r.id === ids[0]).duplicate_of, ids[ids.length - 1]);
    const held = JSON.parse(runRow(db).held_json);
    assert.equal(held.cleared, undefined);
    assert.deepEqual(held.forward, []);
    assert.deepEqual(restore(root, pages).dangling, []);
  });

  await check("[backup] a run left open by a version without the lane record starts over, so its table order can't skip a table", async () => {
    const { db, env } = setup(root);
    const id = fileItem(db, "one");
    db.prepare(
      "INSERT INTO backup_runs (date, started_at, table_index, after_rowid, page, pages, rows_json, marks_json) VALUES (?, '2026-10-19T03:00:00.000Z', 20, 0, 0, 20, '{}', '{\"items\":1}')",
    ).run(DATE);
    await runToEnd(env, db, minutes(MONDAY, 15));
    const run = runRow(db);
    assert.equal(run.started_at, minutes(MONDAY, 15).toISOString());
    assert.ok(run.held_json);
    assert.deepEqual(rowsOf(pagesOf(env.BUCKET), "items").map((r) => r.id), [id]);
    assert.ok(rowsOf(pagesOf(env.BUCKET), "labels").length > 0);
  });

  await check("[backup] the authenticator devices and the files still waiting to go are in the backup, each at the cut", async () => {
    const { db, env } = setup(root);
    const code = db
      .prepare("INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by) VALUES ('h1', 'h1', 'Ada Lovelace', 'ada@example.com', '[]', 1, ?, 'P99') RETURNING id")
      .get(AT).id;
    db.prepare("INSERT INTO code_devices (code_id, token_hash, created_at) VALUES (?, 'device-1', ?)").run(code, AT);
    db.prepare("INSERT INTO deletions (r2_key, item_id, due_at) VALUES ('files/1/a.png', 1, ?)").run(AT);
    let late = false;
    await runToEnd(env, db, MONDAY, async () => {
      if (late) return;
      db.prepare("INSERT INTO code_devices (code_id, token_hash, created_at) VALUES (?, 'device-2', ?)").run(code, AT);
      db.prepare("INSERT INTO deletions (r2_key, item_id, due_at) VALUES ('files/2/b.png', 2, ?)").run(AT);
      late = true;
    });
    const pages = pagesOf(env.BUCKET);
    assert.deepEqual(rowsOf(pages, "code_devices").map((r) => r.token_hash), ["device-1"]);
    assert.deepEqual(rowsOf(pages, "deletions").map((r) => r.r2_key), ["files/1/a.png"]);
    assert.deepEqual(restore(root, pages).dangling, []);
  });
}

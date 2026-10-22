import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { BACKUP_TABLES, backupDue, backupStep, cutRows, pageKey, pageQuery } from "../src/backup.js";

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

  await check("[backup] the lanes and the key counters are paged after every row that points at them, the counters last", async () => {
    const names = BACKUP_TABLES.map((t) => t.name);
    assert.equal(names[names.length - 1], "sqlite_sequence");
    for (const lane of ["labels", "boards", "board_columns"]) {
      assert.ok(names.indexOf(lane) > names.indexOf("board_positions"), lane);
      assert.ok(names.indexOf(lane) > names.indexOf("items"), lane);
      assert.ok(names.indexOf(lane) > names.indexOf("item_labels"), lane);
      assert.equal(BACKUP_TABLES.find((t) => t.name === lane).cut, undefined, lane);
    }
    assert.ok(names.indexOf("items") < names.indexOf("comments"));
    assert.ok(names.indexOf("comments") < names.indexOf("attachments"));
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

  await check("[backup] a second run on the same date replaces the first whole: no page of the first is left", async () => {
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
    await runToEnd(env, db, minutes(MONDAY, 120));
    const second = pagesOf(env.BUCKET);
    const secondRun = runRow(db);
    assert.ok(secondRun.started_at > firstRun.started_at);
    assert.equal(second.length, secondRun.pages);
    assert.deepEqual(second.map((p) => p.key), first.map((p) => p.key));
    assert.deepEqual(second.filter((p) => p.run !== secondRun.started_at).map((p) => p.key), []);
    assert.deepEqual(rowsOf(second, "items"), []);
    assert.deepEqual(rowsOf(second, "comments"), []);
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
}

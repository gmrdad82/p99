import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { PATCH_TRIES, fieldStatements, writeFields } from "../src/patch.js";
import { fold } from "../src/text.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T0 = "2026-10-23T09:00:00.000Z";
const ADA = { actor: "ada@example.com", now: "2026-10-23T10:00:00.000Z", agent: 0, via: null };
const GRACE = { actor: "grace@example.com", now: "2026-10-23T10:00:01.000Z", agent: 1, via: "cli" };

function local() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  db.prepare(
    `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, page_url, page_path, page_title,
       reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at,
       created_at, updated_at, host, reporter_agent, search_text, reporter_via)
     VALUES ('u-1', 'bug', (SELECT id FROM labels WHERE role = 'inbox'), 1, 'Checkout total is wrong', 'Steps: add two',
       'production', 'https://example.com/checkout', '/checkout', 'Checkout', 'ada@example.com', 'Ada Lovelace', '{}', '{}', '[]',
       ?1, ?1, ?1, ?1, 'example.com', 0, ?2, NULL)`,
  ).run(T0, fold("Checkout total is wrong Steps: add two"));
  const batches = [];
  const DB = {
    prepare(sql) {
      return { sql, args: [], bind: (...args) => ({ sql, args }) };
    },
    async batch(list) {
      batches.push(list.length);
      db.exec("BEGIN");
      try {
        const out = list.map((s) => ({ meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }));
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const read = () => ({ ...db.prepare("SELECT * FROM items WHERE id = 1").get() });
  const events = () =>
    db
      .prepare("SELECT kind, actor_email, actor_agent, actor_via, detail_json, at FROM events WHERE item_id = 1 ORDER BY id")
      .all()
      .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));
  return { db, DB, read, events, batches };
}

const never = () => {
  throw new Error("no reload expected");
};
const refused = () => {
  throw new Error("conflict");
};

test("a title patch and an assignee patch that interleave both survive, one event each", async () => {
  const { DB, read, events } = local();
  const first = read();
  const second = read();
  const b = await writeFields(DB, GRACE, second, { assignee: "grace@example.com" }, { reload: never, conflict: refused });
  const a = await writeFields(DB, ADA, first, { title: "Checkout total ignores the coupon" }, { reload: never, conflict: refused });
  const row = read();
  assert.equal(row.title, "Checkout total ignores the coupon");
  assert.equal(row.assignee, "grace@example.com");
  assert.equal(row.search_text, fold("Checkout total ignores the coupon Steps: add two"));
  assert.equal(row.updated_at, ADA.now);
  assert.deepEqual(a.changed, ["title"]);
  assert.deepEqual(b.changed, ["assignee"]);
  const seen = events();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.actor_email, e.detail]),
    [
      ["assignee", "grace@example.com", { from: null, to: "grace@example.com" }],
      ["title", "ada@example.com", { from: "Checkout total is wrong", to: "Checkout total ignores the coupon" }],
    ],
  );
  assert.deepEqual([seen[0].actor_agent, seen[0].actor_via, seen[0].at], [1, "cli", GRACE.now]);
  assert.deepEqual([seen[1].actor_agent, seen[1].actor_via, seen[1].at], [0, null, ADA.now]);
});

test("the old whole-row write under the same interleaving loses the assignee, so the forced race is real", async () => {
  const { DB, read } = local();
  const first = read();
  const second = read();
  await writeFields(DB, GRACE, second, { assignee: "grace@example.com" }, { reload: never, conflict: refused });
  await DB.batch([
    DB.prepare(
      `UPDATE items SET kind = ?2, assignee = ?3, title = ?4, body = ?5, updated_at = ?6, activity_at = ?6, search_text = ?7
       WHERE id = ?1`,
    ).bind(first.id, first.kind, first.assignee, "Checkout total ignores the coupon", first.body, ADA.now, "x"),
  ]);
  assert.equal(read().assignee, null);
});

test("the same field patched twice at once: the last write wins, two events chained, one row", async () => {
  const { db, DB, read, events } = local();
  const first = read();
  const second = read();
  await writeFields(DB, ADA, first, { title: "Coupon ignored" }, { reload: never, conflict: refused });
  await writeFields(DB, GRACE, second, { title: "Coupon ignored at checkout" }, { reload: never, conflict: refused });
  assert.equal(read().title, "Coupon ignored at checkout");
  assert.equal(db.prepare("SELECT count(*) AS n FROM items").get().n, 1);
  assert.deepEqual(
    events().map((e) => e.detail),
    [
      { from: "Checkout total is wrong", to: "Coupon ignored" },
      { from: "Coupon ignored", to: "Coupon ignored at checkout" },
    ],
  );
});

test("the same assignee patched twice at once: the last write wins with two events", async () => {
  const { DB, read, events } = local();
  const first = read();
  const second = read();
  await writeFields(DB, ADA, first, { assignee: "ada@example.com" }, { reload: never, conflict: refused });
  await writeFields(DB, GRACE, second, { assignee: "grace@example.com" }, { reload: never, conflict: refused });
  assert.equal(read().assignee, "grace@example.com");
  assert.deepEqual(
    events().map((e) => e.detail),
    [
      { from: null, to: "ada@example.com" },
      { from: "ada@example.com", to: "grace@example.com" },
    ],
  );
});

test("a title patch racing a body patch reloads once and keeps both, with search text of both", async () => {
  const { DB, read, events, batches } = local();
  const first = read();
  const second = read();
  await writeFields(DB, GRACE, second, { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  let reloads = 0;
  const done = await writeFields(DB, ADA, first, { title: "Coupon ignored" }, {
    reload: async () => {
      reloads += 1;
      return read();
    },
    conflict: refused,
  });
  const row = read();
  assert.equal(reloads, 1);
  assert.deepEqual(batches, [2, 2, 2]);
  assert.deepEqual([row.title, row.body], ["Coupon ignored", "Steps: add a coupon"]);
  assert.equal(row.search_text, fold("Coupon ignored Steps: add a coupon"));
  assert.equal(done.row.body, "Steps: add a coupon");
  assert.deepEqual(done.changed, ["title"]);
  assert.deepEqual(
    events().map((e) => [e.kind, e.detail]),
    [
      ["body", { from: "Steps: add two", to: "Steps: add a coupon" }],
      ["title", { from: "Checkout total is wrong", to: "Coupon ignored" }],
    ],
  );
});

test("an assignee and a title in one patch, racing a body patch: the assignee lands once and the title retries alone", async () => {
  const { DB, read, events } = local();
  const first = read();
  await writeFields(DB, GRACE, read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  const done = await writeFields(DB, ADA, first, { assignee: "ada@example.com", title: "Coupon ignored" }, { reload: async () => read(), conflict: refused });
  const row = read();
  assert.deepEqual([row.assignee, row.title, row.body], ["ada@example.com", "Coupon ignored", "Steps: add a coupon"]);
  assert.deepEqual(done.changed, ["assignee", "title"]);
  assert.deepEqual(
    events().map((e) => e.kind),
    ["body", "assignee", "title"],
  );
});

test("a text write that keeps losing its guard gives up after the tries and writes no title", async () => {
  const { DB, read, events, batches } = local();
  const stale = read();
  await writeFields(DB, GRACE, read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  let reloads = 0;
  await assert.rejects(
    writeFields(DB, ADA, stale, { title: "Coupon ignored" }, {
      reload: async () => {
        reloads += 1;
        return stale;
      },
      conflict: refused,
    }),
    /conflict/,
  );
  assert.equal(reloads, PATCH_TRIES);
  assert.equal(batches.length, 1 + PATCH_TRIES);
  assert.equal(read().title, "Checkout total is wrong");
  assert.deepEqual(events().map((e) => e.kind), ["body"]);
});

test("a reload that refuses stops the write with its refusal", async () => {
  const { DB, read } = local();
  const stale = read();
  await writeFields(DB, GRACE, read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  await assert.rejects(
    writeFields(DB, ADA, stale, { title: "Coupon ignored" }, {
      reload: async () => {
        throw new Error("the title can no longer be changed");
      },
      conflict: refused,
    }),
    /can no longer/,
  );
  assert.equal(read().title, "Checkout total is wrong");
});

test("a patch to the values already there writes no event and keeps the timestamps", async () => {
  const { DB, read, events } = local();
  const row = read();
  const done = await writeFields(DB, ADA, row, { title: row.title, body: row.body, kind: "bug", assignee: null }, { reload: never, conflict: refused });
  assert.deepEqual(done.changed, []);
  assert.deepEqual(events(), []);
  assert.deepEqual([read().updated_at, read().activity_at], [T0, T0]);
});

test("a patch with no field runs no batch at all", async () => {
  const { DB, read, batches } = local();
  const row = read();
  const done = await writeFields(DB, ADA, row, {}, { extra: [DB.prepare("SELECT 1")], reload: never, conflict: refused });
  assert.deepEqual(done, { row, changed: [] });
  assert.deepEqual(batches, []);
});

test("kind, assignee to no one and body each log from and to as the row held them at write time", async () => {
  const { DB, read, events } = local();
  await writeFields(DB, GRACE, read(), { assignee: "grace@example.com" }, { reload: never, conflict: refused });
  const stale = { ...read(), assignee: "someone@example.com", kind: "task" };
  const done = await writeFields(DB, ADA, stale, { kind: "feature", assignee: null, title: "Crème brûlée \"quoted\"", body: "" }, { reload: never, conflict: refused });
  assert.deepEqual(done.changed, ["kind", "assignee", "title", "body"]);
  const row = read();
  assert.deepEqual([row.kind, row.assignee, row.title, row.body], ["feature", null, "Crème brûlée \"quoted\"", ""]);
  assert.equal(row.search_text, "creme brulee \"quoted\" ");
  assert.deepEqual(
    events().slice(1).map((e) => [e.kind, e.detail]),
    [
      ["kind", { from: "bug", to: "feature" }],
      ["assignee", { from: "grace@example.com", to: null }],
      ["title", { from: "Checkout total is wrong", to: "Crème brûlée \"quoted\"" }],
      ["body", { from: "Steps: add two", to: "" }],
    ],
  );
});

test("the extra statements ride in the same batch as the fields", async () => {
  const { db, DB, read, batches } = local();
  const extra = DB.prepare("INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3)").bind("ada@example.com", 1, ADA.now);
  await writeFields(DB, ADA, read(), { title: "Coupon ignored" }, { extra: [extra], reload: never, conflict: refused });
  assert.deepEqual(batches, [2]);
  assert.equal(db.prepare("SELECT read_at FROM reads WHERE item_id = 1").get().read_at, ADA.now);
});

test("a write that fails inside the batch leaves the row and the events untouched", async () => {
  const { DB, read, events } = local();
  await assert.rejects(
    writeFields(DB, ADA, read(), { kind: "epic" }, { reload: never, conflict: refused }),
    /CHECK/,
  );
  assert.equal(read().kind, "bug");
  assert.deepEqual(events(), []);
});

test("the statements guard only the text field that was not given", () => {
  const { DB, read } = local();
  const row = read();
  const sql = (values) => fieldStatements(DB, ADA, row, values).statements.map((s) => s.sql).join("\n");
  assert.match(sql({ title: "x" }), /body IS \?6/);
  assert.doesNotMatch(sql({ title: "x" }), /title IS \?6/);
  assert.match(sql({ body: "x" }), /title IS \?6/);
  assert.doesNotMatch(sql({ title: "x", body: "y" }), /\bIS \?[67]\b/);
  assert.doesNotMatch(sql({ assignee: "x" }), /title|body/);
  const { events, text } = fieldStatements(DB, ADA, row, { assignee: "x", title: "y" });
  assert.deepEqual([events, text], [{ assignee: 0, title: 2 }, 3]);
});

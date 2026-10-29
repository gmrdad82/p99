import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { BODY_REFUSED, PATCH_CONFLICT, PATCH_TRIES, TITLE_REFUSED, mayEditText, patchValues, textRefusal, useKit, writeFields, writePatch } from "../src/patch.js";
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
  assert.equal(reloads, PATCH_TRIES - 1);
  assert.equal(batches.length, 1 + PATCH_TRIES);
  assert.equal(read().title, "Checkout total is wrong");
  assert.deepEqual(events().map((e) => e.kind), ["body"]);
});

test("a patch to the values already there writes no event and keeps the timestamps", async () => {
  const { DB, read, events } = local();
  const row = read();
  const done = await writeFields(DB, ADA, row, { title: row.title, body: row.body, kind: "bug", assignee: null }, { reload: never, conflict: refused });
  assert.deepEqual(done.changed, []);
  assert.deepEqual(events(), []);
  assert.deepEqual([read().updated_at, read().activity_at], [T0, T0]);
});

test("a patch that changes nothing still marks the item read for its caller, who looked at it", async () => {
  const { db, DB, read, events } = local();
  const row = read();
  const extra = DB.prepare("INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3)").bind("ada@example.com", 1, ADA.now);
  const done = await writeFields(DB, ADA, row, { assignee: null }, { extra: [extra], reload: never, conflict: refused });
  assert.deepEqual(done.changed, []);
  assert.deepEqual(events(), []);
  assert.equal(db.prepare("SELECT read_at FROM reads WHERE item_id = 1").get().read_at, ADA.now);
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
  assert.deepEqual(batches, [3]);
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

test("an assignee and a title in one patch that keeps losing its body guard writes nothing at all, then conflicts", async () => {
  const { DB, read, events, batches } = local();
  const stale = read();
  await writeFields(DB, GRACE, read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  await assert.rejects(
    writeFields(DB, ADA, stale, { assignee: "ada@example.com", kind: "task", title: "Coupon ignored" }, { reload: async () => stale, conflict: refused }),
    /conflict/,
  );
  const row = read();
  assert.equal(batches.length, 1 + PATCH_TRIES);
  assert.deepEqual([row.assignee, row.kind, row.title, row.body], [null, "bug", "Checkout total is wrong", "Steps: add a coupon"]);
  assert.deepEqual(events().map((e) => e.kind), ["body"]);
});

test("a patch writes only the fields its body names, keeping a cleared assignee and leaving out status and project", () => {
  const next = { kind: "task", assignee: null, title: "Coupon ignored", body: "Steps: add a coupon" };
  const named = (body) => (field) => Object.prototype.hasOwnProperty.call(body, field);
  assert.deepEqual(patchValues(named({ title: "x" }), next), { title: "Coupon ignored" });
  assert.deepEqual(patchValues(named({ assignee: null }), next), { assignee: null });
  assert.deepEqual(patchValues(named({ status: "done" }), next), {});
  assert.deepEqual(patchValues(named({ project: "web" }), next), {});
  assert.deepEqual(patchValues(named({ body: "", kind: "task", status: "doing" }), next), { kind: "task", body: "Steps: add a coupon" });
  assert.deepEqual(patchValues(() => true, next), next);
});

test("the details' refusal names an Owner, the role word every output uses, never a manager", () => {
  assert.equal(BODY_REFUSED, "only an Owner, or the person who filed it while the card is new, may change the details");
  assert.doesNotMatch(`${BODY_REFUSED} ${TITLE_REFUSED}`, /manager|member/i);
});

test("only an Owner, or the reporter of an open item still in New, may edit the text", () => {
  const ada = { manager: false, actor: { email: "ada@example.com" } };
  const boss = { manager: true, actor: { email: "grace@example.com" } };
  const mine = { reporter_email: "ada@example.com", open: 1, label_role: "inbox" };
  assert.equal(mayEditText(ada, mine), true);
  assert.equal(mayEditText(boss, { ...mine, reporter_email: "x@example.com", open: 0, label_role: "done" }), true);
  assert.equal(mayEditText(ada, { ...mine, label_role: "doing" }), false);
  assert.equal(mayEditText(ada, { ...mine, open: 0 }), false);
  assert.equal(mayEditText(ada, { ...mine, reporter_email: "grace@example.com" }), false);
  const moved = { ...mine, label_role: "review" };
  assert.equal(textRefusal(ada, moved, { title: "x", body: "y" }), TITLE_REFUSED);
  assert.equal(textRefusal(ada, moved, { body: "y" }), BODY_REFUSED);
  assert.equal(textRefusal(ada, moved, { assignee: null }), null);
  assert.equal(textRefusal(ada, mine, { title: "x" }), null);
});

function handler(world, { manager, actor, between = () => {} }) {
  const loads = [];
  useKit({
    fail(status, message) {
      throw Object.assign(new Error(message), { status });
    },
    async loadItem(c, rawKey) {
      loads.push(rawKey);
      const row = world.db.prepare("SELECT i.*, lb.role AS label_role FROM items i JOIN labels lb ON lb.id = i.label_id WHERE i.id = 1").get();
      between();
      return { ...row };
    },
    readStatement(c, itemId) {
      return c.env.DB.prepare("INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at").bind(
        c.actor.email,
        itemId,
        c.now,
      );
    },
  });
  const c = { env: { DB: world.DB }, manager, actor: { email: actor.actor }, now: actor.now };
  const write = (row, body) => {
    const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
    const next = { kind: row.kind, assignee: row.assignee, title: row.title, body: row.body };
    for (const field of Object.keys(next)) if (has(field)) next[field] = body[field];
    return writePatch(c, "BUG-1", { ...row, label_role: "inbox" }, has, next, actor);
  };
  return { c, loads, write };
}

const moveTo = (db, role) => db.prepare("UPDATE items SET label_id = (SELECT id FROM labels WHERE role = ?1) WHERE id = 1").run(role);

test("the handler's write: a reporter whose item left the inbox mid-patch is refused with 403 and nothing of theirs lands", async () => {
  const world = local();
  const stale = world.read();
  await writeFields(world.DB, GRACE, world.read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  moveTo(world.db, "doing");
  const { loads, write } = handler(world, { manager: false, actor: ADA });
  await assert.rejects(write(stale, { title: "Coupon ignored" }), (e) => e.status === 403 && e.message === TITLE_REFUSED);
  assert.deepEqual(loads, ["BUG-1"]);
  assert.equal(world.read().title, "Checkout total is wrong");
  assert.deepEqual(world.events().map((e) => e.kind), ["body"]);
});

test("the handler's write: a reporter still in the inbox reloads once and keeps both texts", async () => {
  const world = local();
  const stale = world.read();
  await writeFields(world.DB, GRACE, world.read(), { body: "Steps: add a coupon" }, { reload: never, conflict: refused });
  const { loads, write } = handler(world, { manager: false, actor: ADA });
  const done = await write(stale, { title: "Coupon ignored" });
  assert.deepEqual(loads, ["BUG-1"]);
  assert.deepEqual(done.changed, ["title"]);
  assert.deepEqual([world.read().title, world.read().body], ["Coupon ignored", "Steps: add a coupon"]);
  assert.equal(world.db.prepare("SELECT read_at FROM reads WHERE actor_email = 'ada@example.com'").get().read_at, ADA.now);
});

test("the handler's write: a manager whose body guard misses on every try gets 409 and the item keeps its assignee and title", async () => {
  const world = local();
  const stale = world.read();
  let edits = 0;
  const bump = () => {
    edits += 1;
    world.db.prepare("UPDATE items SET body = ?1 WHERE id = 1").run(`Steps: edit ${edits}`);
  };
  bump();
  const { loads, write } = handler(world, { manager: true, actor: ADA, between: bump });
  await assert.rejects(write(stale, { assignee: "ada@example.com", title: "Coupon ignored" }), (e) => e.status === 409 && e.message === PATCH_CONFLICT);
  assert.equal(loads.length, PATCH_TRIES - 1);
  const row = world.read();
  assert.deepEqual([row.assignee, row.title], [null, "Checkout total is wrong"]);
  assert.deepEqual(world.events(), []);
});

test("the handler's race: Grace's assignee PATCH lands between Ada's read and her title PATCH, and both stick", async () => {
  const world = local();
  const adaRead = world.read();
  const grace = handler(world, { manager: true, actor: GRACE });
  const g = await grace.write(world.read(), { assignee: "grace@example.com" });
  const ada = handler(world, { manager: true, actor: ADA });
  const a = await ada.write(adaRead, { title: "Checkout total ignores the coupon" });
  const row = world.read();
  assert.deepEqual([row.title, row.assignee, row.body, row.kind], ["Checkout total ignores the coupon", "grace@example.com", "Steps: add two", "bug"]);
  assert.deepEqual([g.changed, a.changed], [["assignee"], ["title"]]);
  assert.deepEqual([grace.loads, ada.loads], [[], []]);
  assert.deepEqual(
    world.events().map((e) => [e.kind, e.actor_email]),
    [
      ["assignee", "grace@example.com"],
      ["title", "ada@example.com"],
    ],
  );
});

test("the handler's race: Ada's title PATCH lands between Grace's read and her assignee PATCH, and both stick", async () => {
  const world = local();
  const graceRead = world.read();
  const ada = handler(world, { manager: true, actor: ADA });
  await ada.write(world.read(), { title: "Checkout total ignores the coupon" });
  const grace = handler(world, { manager: true, actor: GRACE });
  const g = await grace.write(graceRead, { assignee: "grace@example.com" });
  const row = world.read();
  assert.deepEqual([row.title, row.assignee], ["Checkout total ignores the coupon", "grace@example.com"]);
  assert.equal(row.search_text, fold("Checkout total ignores the coupon Steps: add two"));
  assert.deepEqual(g.changed, ["assignee"]);
  assert.deepEqual(world.events().map((e) => e.kind), ["title", "assignee"]);
});

test("the handler's race: a status-only PATCH from a stale read writes none of the four fields back", async () => {
  const world = local();
  const stale = world.read();
  await handler(world, { manager: true, actor: GRACE }).write(world.read(), { assignee: "grace@example.com", title: "Coupon ignored" });
  const { write } = handler(world, { manager: true, actor: ADA });
  const done = await write(stale, { status: "doing" });
  assert.deepEqual(done.changed, []);
  assert.deepEqual([world.read().assignee, world.read().title], ["grace@example.com", "Coupon ignored"]);
  assert.deepEqual(world.events().map((e) => e.kind), ["assignee", "title"]);
});

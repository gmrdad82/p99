import { ROBOT } from "./cards.js";

const R2_BATCH = 1000;
const UPLOAD_GRACE_MS = 15 * 60 * 1000;
const ITEM_TABLES = ["attachments", "comments", "events", "reads", "item_labels", "board_positions", "github_links", "mail_optouts", "build_items", "landings"];

let K = null;

export function useKit(kit) {
  K = kit;
}

async function dropObjects(env, keys) {
  for (let at = 0; at < keys.length; at += R2_BATCH) await env.BUCKET.delete(keys.slice(at, at + R2_BATCH));
}

export function actorWord(c) {
  if (!c.actor) return "P99";
  return c.actor.agent ? `${c.actor.name} ${ROBOT}` : c.actor.name;
}

export async function deleteIssue(c, rawKey) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const row = await K.loadItem(c, rawKey);
  const { DB } = c.env;
  const key = K.keyOf(row.kind, row.id);
  const later = new Date(Date.parse(c.now) + UPLOAD_GRACE_MS).toISOString();
  const actor = c.actor ? c.actor.email : null;
  const agent = c.actor && c.actor.agent ? 1 : 0;
  const via = agent ? (c.actor.via ?? null) : null;
  const done = await DB.batch([
    DB.prepare(
      `SELECT i.id, l.name FROM items i JOIN labels l ON l.id = i.label_id WHERE i.duplicate_of = ?1 AND i.open = 0`,
    ).bind(row.id),
    DB.prepare(
      `INSERT INTO deletions (r2_key, item_id, due_at)
       SELECT r2_key, item_id, CASE WHEN stored_at IS NULL THEN ?2 ELSE ?3 END FROM attachments WHERE item_id = ?1
       ON CONFLICT (r2_key) DO NOTHING
       RETURNING r2_key`,
    ).bind(row.id, later, c.now),
    DB.prepare(
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
       SELECT id, ?2, 'status', json_object('from', resolution, 'to', 'received', 'deleted', ?3), 0, ?4, ?5, ?6
       FROM items WHERE duplicate_of = ?1 AND open = 0
       RETURNING item_id`,
    ).bind(row.id, actor, key, c.now, agent, via),
    DB.prepare(
      `UPDATE items SET duplicate_of = NULL,
         label_id = CASE WHEN open = 0 THEN (SELECT id FROM labels WHERE role = 'inbox') ELSE label_id END,
         open = 1, resolution = NULL, closed_at = NULL,
         updated_at = ?2, activity_at = ?2, public_activity_at = ?2
       WHERE duplicate_of = ?1
       RETURNING id, kind, title, host, (SELECT name FROM labels WHERE id = items.label_id) AS label`,
    ).bind(row.id, c.now),
    ...ITEM_TABLES.map((table) => DB.prepare(`DELETE FROM ${table} WHERE item_id = ?1`).bind(row.id)),
    DB.prepare("DELETE FROM items WHERE id = ?1 RETURNING id").bind(row.id),
  ]);
  if (done[done.length - 1].results.length === 0) K.fail(404, "no such item");
  const was = new Map(done[0].results.map((r) => [r.id, r.name]));
  const keys = done[1].results.map((r) => r.r2_key);
  const unlinked = done[3].results;
  const reopened = new Set(done[2].results.map((r) => r.item_id));
  const comments = done[4 + ITEM_TABLES.indexOf("comments")].meta.changes ?? 0;
  let retrying = 0;
  if (keys.length > 0) {
    try {
      await dropObjects(c.env, keys);
      const left = await DB.prepare("DELETE FROM deletions WHERE item_id = ?1 AND due_at <= ?2 RETURNING r2_key").bind(row.id, c.now).all();
      retrying = keys.length - left.results.length;
    } catch (error) {
      retrying = keys.length;
      console.error(error && error.stack ? error.stack : String(error));
    }
  }
  K.push(c, "delete", row, { label: row.label_name ?? null });
  const by = c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent), via: c.actor.agent ? (c.actor.via ?? null) : null } : null;
  for (const r of unlinked) {
    if (!reopened.has(r.id) || !c.env.HUB) continue;
    c.pushes.push({ type: "label", key: K.keyOf(r.kind, r.id), host: r.host, title: r.title, from: was.get(r.id) ?? null, to: r.label, by, at: c.now });
  }
  console.log(`deleted ${key} by ${actorWord(c)}: ${comments} comments, ${keys.length} files`);
  return K.json(200, {
    key,
    comments,
    files: keys.length,
    retrying,
    unlinked: unlinked.map((r) => K.keyOf(r.kind, r.id)),
  });
}

export async function sweepDeletions(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare("SELECT r2_key FROM deletions WHERE due_at <= ?1 ORDER BY due_at LIMIT ?2").bind(now, R2_BATCH).all();
  if (results.length === 0) return;
  const keys = results.map((r) => r.r2_key);
  await dropObjects(env, keys);
  await env.DB.prepare("DELETE FROM deletions WHERE r2_key IN (SELECT value FROM json_each(?1)) AND due_at <= ?2").bind(JSON.stringify(keys), now).run();
}

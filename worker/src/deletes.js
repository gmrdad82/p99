import { topOf } from "./boards.js";

const R2_BATCH = 1000;
const UPLOAD_GRACE_MS = 15 * 60 * 1000;
const ITEM_TABLES = ["attachments", "comments", "events", "reads", "item_labels", "github_links", "mail_optouts", "build_items", "landings"];

let K = null;

export function useKit(kit) {
  K = kit;
}

async function dropObjects(env, keys) {
  for (let at = 0; at < keys.length; at += R2_BATCH) await env.BUCKET.delete(keys.slice(at, at + R2_BATCH));
}

function actorWord(c) {
  if (!c.actor) return "P99";
  return c.actor.agent ? `${c.actor.name}*` : c.actor.name;
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
  const done = await DB.batch([
    DB.prepare(
      `INSERT INTO deletions (r2_key, item_id, due_at)
       SELECT r2_key, item_id, CASE WHEN stored_at IS NULL THEN ?2 ELSE ?3 END FROM attachments WHERE item_id = ?1
       ON CONFLICT (r2_key) DO NOTHING
       RETURNING r2_key`,
    ).bind(row.id, later, c.now),
    DB.prepare(
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
       SELECT id, ?2, 'status', json_object('from', 'done', 'to', 'inbox', 'from_resolution', resolution, 'deleted', ?3), 0, ?4, ?5
       FROM items WHERE duplicate_of = ?1 AND status = 'done'
       RETURNING item_id`,
    ).bind(row.id, actor, key, c.now, agent),
    DB.prepare(
      `UPDATE items SET duplicate_of = NULL,
         position = CASE WHEN status = 'done' THEN ${topOf("items.board_id", "'inbox'")} ELSE position END,
         open = 1, resolution = NULL, closed_at = NULL,
         status = CASE WHEN status = 'done' THEN 'inbox' ELSE status END,
         updated_at = ?2, activity_at = ?2, public_activity_at = ?2
       WHERE duplicate_of = ?1
       RETURNING id, kind, title, host, board_id, status, position`,
    ).bind(row.id, c.now),
    ...ITEM_TABLES.map((table) => DB.prepare(`DELETE FROM ${table} WHERE item_id = ?1`).bind(row.id)),
    DB.prepare("DELETE FROM items WHERE id = ?1 RETURNING id").bind(row.id),
  ]);
  if (done[done.length - 1].results.length === 0) K.fail(404, "no such item");
  const keys = done[0].results.map((r) => r.r2_key);
  const unlinked = done[2].results;
  const reopened = new Set(done[1].results.map((r) => r.item_id));
  const comments = done[3 + ITEM_TABLES.indexOf("comments")].meta.changes ?? 0;
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
  K.push(c, "delete", row, { board: row.board_slug ?? null });
  if (unlinked.length > 0) {
    const ids = [...new Set(unlinked.map((r) => r.board_id))];
    const { results } = await DB.prepare("SELECT id, slug FROM boards WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(ids)).all();
    const slugs = new Map(results.map((b) => [b.id, b.slug]));
    const by = c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent) } : null;
    for (const r of unlinked) {
      if (!reopened.has(r.id) || !c.env.HUB) continue;
      c.pushes.push({
        type: "move",
        key: K.keyOf(r.kind, r.id),
        host: r.host,
        title: r.title,
        board: slugs.get(r.board_id) ?? null,
        from: "done",
        to: "inbox",
        position: r.position,
        by,
        at: c.now,
      });
    }
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

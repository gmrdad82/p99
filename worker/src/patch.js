import { fold } from "./text.js";

export const PATCH_FIELDS = ["kind", "assignee", "title", "body"];
export const PATCH_TRIES = 3;
export const TITLE_REFUSED = "the title can no longer be changed";
export const BODY_REFUSED = "only an Owner, or the person who filed it while the card is new, may change the details";
export const PATCH_CONFLICT = "the card changed while saving; try again";

let K = null;

export function useKit(kit) {
  K = kit;
}

const given = (values, field) => Object.prototype.hasOwnProperty.call(values, field);

export function patchValues(has, next) {
  const values = {};
  for (const field of PATCH_FIELDS) if (has(field)) values[field] = next[field];
  return values;
}

export function mayEditText(c, row) {
  return Boolean(c.manager) || (row.reporter_email === c.actor.email && Boolean(row.open) && row.label_role === "inbox");
}

export function textRefusal(c, row, values) {
  if (mayEditText(c, row)) return null;
  if (given(values, "title")) return TITLE_REFUSED;
  if (given(values, "body")) return BODY_REFUSED;
  return null;
}

function textGuard(row, values) {
  const title = given(values, "title");
  const body = given(values, "body");
  if (title === body) return null;
  return title ? { column: "body", value: row.body } : { column: "title", value: row.title };
}

const guarded = (guard, n) => (guard ? ` AND ${guard.column} IS ?${n}` : "");
const guardBind = (guard) => (guard ? [guard.value] : []);

function eventInsert(DB, at, row, field, value, guard) {
  return DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
     SELECT id, ?2, '${field}', json_object('from', ${field}, 'to', ?3), 0, ?4, ?5, ?6 FROM items
     WHERE id = ?1 AND ${field} IS NOT ?3${guarded(guard, 7)}`,
  ).bind(row.id, at.actor, value, at.now, at.agent, at.via, ...guardBind(guard));
}

export function fieldStatements(DB, at, row, values) {
  const statements = [];
  const events = {};
  const guard = textGuard(row, values);
  for (const field of ["kind", "assignee"]) {
    if (!given(values, field)) continue;
    events[field] = statements.length;
    statements.push(
      eventInsert(DB, at, row, field, values[field], guard),
      DB.prepare(
        `UPDATE items SET ${field} = ?2, updated_at = ?3, activity_at = ?3 WHERE id = ?1 AND ${field} IS NOT ?2${guarded(guard, 4)}`,
      ).bind(row.id, values[field], at.now, ...guardBind(guard)),
    );
  }
  let text = -1;
  if (given(values, "title") || given(values, "body")) {
    const title = given(values, "title") ? values.title : row.title;
    const body = given(values, "body") ? values.body : row.body;
    for (const field of ["title", "body"]) {
      if (!given(values, field)) continue;
      events[field] = statements.length;
      statements.push(eventInsert(DB, at, row, field, values[field], guard));
    }
    text = statements.length;
    statements.push(
      DB.prepare(
        `UPDATE items SET title = ?2, body = ?3, search_text = ?4,
           updated_at = CASE WHEN title IS NOT ?2 OR body IS NOT ?3 THEN ?5 ELSE updated_at END,
           activity_at = CASE WHEN title IS NOT ?2 OR body IS NOT ?3 THEN ?5 ELSE activity_at END
         WHERE id = ?1${guarded(guard, 6)}`,
      ).bind(row.id, title, body, fold(`${title} ${body ?? ""}`), at.now, ...guardBind(guard)),
    );
  }
  return { statements, events, text };
}

export async function writeFields(DB, at, row, values, { extra = [], reload, conflict }) {
  let current = row;
  for (let attempt = 0; attempt < PATCH_TRIES; attempt += 1) {
    const { statements, events, text } = fieldStatements(DB, at, current, values);
    if (statements.length === 0) return { row: current, changed: [] };
    const results = await DB.batch([...statements, ...extra]);
    if (text < 0 || results[text].meta.changes > 0) {
      const changed = PATCH_FIELDS.filter((f) => given(events, f) && results[events[f]].meta.changes > 0);
      return { row: { ...current, ...values }, changed };
    }
    if (attempt + 1 < PATCH_TRIES) current = await reload();
  }
  return conflict();
}

export function writePatch(c, rawKey, row, has, next, at) {
  const values = patchValues(has, next);
  return writeFields(c.env.DB, at, row, values, {
    extra: [K.readStatement(c, row.id)],
    reload: async () => {
      const fresh = await K.loadItem(c, rawKey);
      const refusal = textRefusal(c, fresh, values);
      if (refusal) K.fail(403, refusal);
      return fresh;
    },
    conflict: () => K.fail(409, PATCH_CONFLICT),
  });
}

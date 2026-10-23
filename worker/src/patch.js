import { fold } from "./text.js";

export const PATCH_FIELDS = ["kind", "assignee", "title", "body"];
export const PATCH_TRIES = 3;

const given = (values, field) => Object.prototype.hasOwnProperty.call(values, field);

function eventInsert(DB, at, row, field, value, guard, binds) {
  return DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
     SELECT id, ?2, '${field}', json_object('from', ${field}, 'to', ?3), 0, ?4, ?5, ?6 FROM items
     WHERE id = ?1 AND ${field} IS NOT ?3${guard.replace("?6", "?7")}`,
  ).bind(row.id, at.actor, value, at.now, at.agent, at.via, ...binds);
}

export function fieldStatements(DB, at, row, values) {
  const statements = [];
  const events = {};
  for (const field of ["kind", "assignee"]) {
    if (!given(values, field)) continue;
    events[field] = statements.length;
    statements.push(
      eventInsert(DB, at, row, field, values[field], "", []),
      DB.prepare(`UPDATE items SET ${field} = ?2, updated_at = ?3, activity_at = ?3 WHERE id = ?1 AND ${field} IS NOT ?2`).bind(
        row.id,
        values[field],
        at.now,
      ),
    );
  }
  let text = -1;
  if (given(values, "title") || given(values, "body")) {
    const both = given(values, "title") && given(values, "body");
    const title = given(values, "title") ? values.title : row.title;
    const body = given(values, "body") ? values.body : row.body;
    const guard = both ? "" : given(values, "title") ? " AND body IS ?6" : " AND title IS ?6";
    const binds = both ? [] : [given(values, "title") ? row.body : row.title];
    for (const field of ["title", "body"]) {
      if (!given(values, field)) continue;
      events[field] = statements.length;
      statements.push(eventInsert(DB, at, row, field, values[field], guard, binds));
    }
    text = statements.length;
    statements.push(
      DB.prepare(
        `UPDATE items SET title = ?2, body = ?3, search_text = ?4,
           updated_at = CASE WHEN title IS NOT ?2 OR body IS NOT ?3 THEN ?5 ELSE updated_at END,
           activity_at = CASE WHEN title IS NOT ?2 OR body IS NOT ?3 THEN ?5 ELSE activity_at END
         WHERE id = ?1${guard}`,
      ).bind(row.id, title, body, fold(`${title} ${body ?? ""}`), at.now, ...binds),
    );
  }
  return { statements, events, text };
}

export async function writeFields(DB, at, row, values, { extra = [], reload, conflict }) {
  let current = row;
  let pending = values;
  const changed = new Set();
  for (let attempt = 0; attempt < PATCH_TRIES; attempt += 1) {
    const { statements, events, text } = fieldStatements(DB, at, current, pending);
    if (statements.length === 0) return { row: current, changed: [] };
    const results = await DB.batch([...statements, ...extra]);
    for (const [field, index] of Object.entries(events)) if (results[index].meta.changes > 0) changed.add(field);
    if (text < 0 || results[text].meta.changes > 0) {
      return { row: { ...current, ...values }, changed: PATCH_FIELDS.filter((f) => changed.has(f)) };
    }
    current = await reload();
    pending = {};
    for (const field of ["title", "body"]) if (given(values, field)) pending[field] = values[field];
  }
  return conflict();
}

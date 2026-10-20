let MAX_JSON_BYTES, clean, eventStatement, fail, isObject, isUniqueViolation, json, push, readJson, requireEmptyBody, requireManager;

export function bindLabels(helpers) {
  ({ MAX_JSON_BYTES, clean, eventStatement, fail, isObject, isUniqueViolation, json, push, readJson, requireEmptyBody, requireManager } =
    helpers);
}

const COLORS = ["#e5534b", "#e0823d", "#c69026", "#57ab5a", "#39a5a0", "#539bf5", "#986ee2", "#d260a8"];
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._:+-]{0,31}$/u;
const MAX_LABELS = 200;
const MAX_ITEM_LABELS = 20;
const MAX_FILTER_LABELS = 10;

export function labelName(raw) {
  if (typeof raw !== "string") return null;
  const name = clean(raw).trim().replace(/\s+/g, " ");
  return NAME.test(name) ? name : null;
}

function needName(raw) {
  const name = labelName(raw);
  if (name === null) fail(400, "a label name is 1 to 32 letters, digits, spaces or . _ : + -, starting with a letter or digit");
  return name;
}

function needColor(raw) {
  if (typeof raw !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.trim())) fail(400, "color must be #rrggbb");
  return raw.trim().toLowerCase();
}

function colorFor(name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

const NO_PRIORITY = "items have no priority: an item's place in its lane is its priority, so move it up or down the lane";

function names(list, what) {
  if (!Array.isArray(list)) fail(400, `${what} must be a list of label names`);
  const out = [];
  for (const raw of list) {
    const name = needName(raw);
    if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

function decodeName(raw) {
  try {
    return needName(decodeURIComponent(raw));
  } catch (error) {
    if (error instanceof URIError) fail(400, "the label name is not valid");
    throw error;
  }
}

export function labelRowsStatement(DB, ids) {
  return DB.prepare(
    `SELECT il.item_id, l.name, l.color FROM item_labels il JOIN labels l ON l.id = il.label_id
     WHERE il.item_id IN (SELECT value FROM json_each(?1)) ORDER BY l.name COLLATE NOCASE`,
  ).bind(JSON.stringify(ids));
}

export function boardLabelsStatement(DB, slug) {
  return DB.prepare(
    `SELECT il.item_id, l.name, l.color FROM item_labels il JOIN labels l ON l.id = il.label_id
     WHERE il.item_id IN (SELECT id FROM items WHERE board_id = (SELECT id FROM boards WHERE slug = ?1)) ORDER BY l.name COLLATE NOCASE`,
  ).bind(slug);
}

export function labelsByItem(result) {
  const out = new Map();
  for (const row of (result && result.results) || []) {
    if (!out.has(row.item_id)) out.set(row.item_id, []);
    out.get(row.item_id).push({ name: row.name, color: row.color });
  }
  return out;
}

export function tagsOf(row, c) {
  return {
    labels: c.manager ? (row.labels ?? []) : [],
  };
}

export function labelFilters(c, params, q, where) {
  if (params.has("priority")) fail(400, NO_PRIORITY);
  const wanted = params.getAll("label");
  if (wanted.length === 0) return;
  requireManager(c);
  if (wanted.length > MAX_FILTER_LABELS) fail(400, `at most ${MAX_FILTER_LABELS} labels`);
  for (const raw of wanted) {
    const name = needName(raw);
    where.push(
      `EXISTS (SELECT 1 FROM item_labels il JOIN labels l ON l.id = il.label_id WHERE il.item_id = i.id AND l.name = ${q.bind(name)})`,
    );
  }
}

export async function labelChanges(c, row, body) {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const out = { statements: [], what: [] };
  if (has("priority")) fail(400, NO_PRIORITY);
  if (!has("labels")) return out;
  requireManager(c);
  const { DB } = c.env;
  const actor = c.actor.email;
  const edit = body.labels;
  const exact = Array.isArray(edit);
  if (!exact && !isObject(edit)) fail(400, "labels must be a list of names, or {add, remove}");
  const add = exact ? names(edit, "labels") : names(edit.add ?? [], "labels.add");
  const remove = exact ? [] : names(edit.remove ?? [], "labels.remove");
  const results = await DB.batch([
    DB.prepare(
      `SELECT l.name FROM item_labels il JOIN labels l ON l.id = il.label_id WHERE il.item_id = ?1 ORDER BY l.name COLLATE NOCASE`,
    ).bind(row.id),
    DB.prepare(`SELECT name FROM labels WHERE name IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(add)),
    DB.prepare("SELECT COUNT(*) AS n FROM labels"),
  ]);
  const current = results[0].results.map((r) => r.name);
  const known = new Map(results[1].results.map((r) => [r.name.toLowerCase(), r.name]));
  const on = (list, name) => list.some((n) => n.toLowerCase() === name.toLowerCase());
  const added = add.filter((n) => !on(current, n)).map((n) => known.get(n.toLowerCase()) ?? n);
  const dropped = exact ? current.filter((n) => !on(add, n)) : current.filter((n) => on(remove, n) && !on(add, n));
  if (added.length === 0 && dropped.length === 0) return out;
  if (current.length + added.length - dropped.length > MAX_ITEM_LABELS) fail(400, `an item holds up to ${MAX_ITEM_LABELS} labels`);
  const fresh = added.filter((n) => !known.has(n.toLowerCase()));
  if (results[2].results[0].n + fresh.length > MAX_LABELS) fail(400, `an account holds up to ${MAX_LABELS} labels`);
  for (const name of fresh) {
    out.statements.push(
      DB.prepare("INSERT OR IGNORE INTO labels (name, color, created_at) VALUES (?1, ?2, ?3)").bind(
        name,
        colorFor(name),
        c.now,
      ),
    );
  }
  for (const name of added) {
    out.statements.push(
      DB.prepare(
        "INSERT OR IGNORE INTO item_labels (item_id, label_id) SELECT ?1, id FROM labels WHERE name = ?2",
      ).bind(row.id, name),
    );
  }
  for (const name of dropped) {
    out.statements.push(
      DB.prepare("DELETE FROM item_labels WHERE item_id = ?1 AND label_id = (SELECT id FROM labels WHERE name = ?2)").bind(
        row.id,
        name,
      ),
    );
  }
  out.statements.push(eventStatement(c, row.id, actor, "labels", { added, removed: dropped }, true));
  out.what.push("labels");
  if (fresh.length > 0) push(c, "labels", null, { action: "created", names: fresh });
  return out;
}

function labelOf(row) {
  return { name: row.name, color: row.color, items: row.items ?? 0 };
}

async function findLabel(c, name) {
  const row = await c.env.DB.prepare("SELECT id, name, color FROM labels WHERE name = ?1").bind(name).first();
  if (!row) fail(404, "no such label");
  return row;
}

function requireEveryHost(c) {
  requireManager(c);
  if (!c.scope.all) fail(403, "labels are shared by every host: rename, recolour or remove them from the CLI, without --host");
}

export async function listLabels(c) {
  requireEmptyBody(c);
  requireManager(c);
  const hostOnly = c.scope.all ? "" : " AND i.host = ?1";
  const statement = c.env.DB.prepare(
    `SELECT l.name, l.color,
       (SELECT COUNT(*) FROM item_labels il JOIN items i ON i.id = il.item_id WHERE il.label_id = l.id${hostOnly}) AS items
     FROM labels l ORDER BY l.name COLLATE NOCASE`,
  );
  const { results } = await (c.scope.all ? statement : statement.bind(c.scope.host)).all();
  return json(200, { labels: results.map(labelOf) });
}

export async function postLabel(c) {
  requireManager(c);
  const body = await readJson(c, MAX_JSON_BYTES);
  const name = needName(body.name);
  const color = body.color === undefined || body.color === null ? colorFor(name) : needColor(body.color);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM labels").first();
  if (count.n >= MAX_LABELS) fail(400, `an account holds up to ${MAX_LABELS} labels`);
  try {
    await c.env.DB.prepare("INSERT INTO labels (name, color, created_at) VALUES (?1, ?2, ?3)").bind(name, color, c.now).run();
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, `a label called ${name} exists`);
    throw error;
  }
  push(c, "labels", null, { action: "created", names: [name] });
  return json(201, labelOf({ name, color }));
}

export async function patchLabel(c, rawName) {
  requireEveryHost(c);
  const body = await readJson(c, MAX_JSON_BYTES);
  const label = await findLabel(c, decodeName(rawName));
  const name = body.name === undefined ? label.name : needName(body.name);
  const color = body.color === undefined ? label.color : needColor(body.color);
  if (name === label.name && color === label.color) return json(200, labelOf(label));
  try {
    await c.env.DB.prepare("UPDATE labels SET name = ?2, color = ?3 WHERE id = ?1").bind(label.id, name, color).run();
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, `a label called ${name} exists`);
    throw error;
  }
  push(c, "labels", null, { action: name === label.name ? "recolored" : "renamed", names: [label.name, name] });
  const items = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM item_labels WHERE label_id = ?1").bind(label.id).first();
  return json(200, labelOf({ name, color, items: items.n }));
}

export async function deleteLabel(c, rawName) {
  requireEveryHost(c);
  requireEmptyBody(c);
  const label = await findLabel(c, decodeName(rawName));
  const results = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM item_labels WHERE label_id = ?1").bind(label.id),
    c.env.DB.prepare("DELETE FROM labels WHERE id = ?1").bind(label.id),
  ]);
  push(c, "labels", null, { action: "removed", names: [label.name] });
  return json(200, { name: label.name, items: results[0].meta.changes ?? 0 });
}

export const LABEL_ROUTES = [
  ["GET", /^\/labels$/, listLabels],
  ["POST", /^\/labels$/, postLabel],
  ["PATCH", /^\/labels\/([^/]+)$/, patchLabel],
  ["DELETE", /^\/labels\/([^/]+)$/, deleteLabel],
];

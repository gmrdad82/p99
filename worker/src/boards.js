import { noteHook } from "./hooks.js";
import { LONG_KEY, generateKeyBetween, generateNKeysBetween } from "./order.js";
import { isChars, namedBy, sameCase, sameFolded } from "./text.js";

export const RESOLUTIONS = ["fixed", "abandoned", "duplicate"];
export const DEFAULT_ROLES = ["inbox", "doing", "review", "done"];
export const LEGACY_STATUSES = {
  inbox: ["inbox", null],
  doing: ["doing", null],
  review: ["review", null],
  done: ["done", "fixed"],
  new: ["inbox", null],
  confirmed: ["doing", null],
  in_progress: ["doing", null],
  waiting: ["review", null],
  resolved: ["done", "fixed"],
  abandoned: ["done", "abandoned"],
  duplicate: ["done", "duplicate"],
};
export const START_LABEL = "(SELECT id FROM labels WHERE role = 'inbox')";
export const LABEL_COLUMNS = "lb.name AS label_name, lb.role AS label_role, lb.closes AS label_closes";
export const LABEL_JOIN = "JOIN labels lb ON lb.id = i.label_id";

const MIN_COLUMNS = 3;
const MAX_COLUMNS = 5;
const MAX_BOARDS = 3;
const MAX_LABELS = 200;
const MAX_NAME_CHARS = 100;
const USED = "(l.role IS NOT NULL OR EXISTS (SELECT 1 FROM board_columns bc WHERE bc.label_id = l.id) OR EXISTS (SELECT 1 FROM items i WHERE i.label_id = l.id))";
const ORPHANS = `SELECT l.id FROM labels l WHERE NOT ${USED} AND NOT EXISTS (SELECT 1 FROM item_labels il WHERE il.label_id = l.id)`;
const LABEL_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._:+-]{0,31}$/u;
const COLORS = ["#e5534b", "#e0823d", "#c69026", "#57ab5a", "#39a5a0", "#539bf5", "#986ee2", "#d260a8"];
const MOVED = "this card moved; refreshed";
const TICKET_TTL_MS = 60 * 1000;
const TICKET = /^[0-9a-f]{48}$/;

let K = null;

export function useKit(kit) {
  K = kit;
}

export function boardView(c) {
  if (!c.browser) return c.scope;
  const hosts = c.code ? c.code.hosts : [];
  const every = c.dir.hosts.size > 0 && [...c.dir.hosts.keys()].every((h) => hosts.includes(h));
  return every ? { all: true, host: null } : { all: false, host: c.scope.host };
}

function sees(v, host) {
  return v.all || (host !== null && host === v.host);
}

function space(v) {
  return v.all ? null : v.host;
}

export function stageOf(row) {
  if (!row.open) return row.resolution === "abandoned" ? "dropped" : row.resolution === "duplicate" ? "duplicate" : "fixed";
  return row.label_role === "inbox" ? "received" : "in_progress";
}

export function statusOf(raw, resolution) {
  if (typeof raw !== "string") return null;
  if (resolution !== undefined && resolution !== null && !RESOLUTIONS.includes(resolution)) return null;
  const legacy = LEGACY_STATUSES[raw];
  if (!legacy) return null;
  return { role: legacy[0], resolution: legacy[0] === "done" ? (resolution ?? legacy[1]) : null };
}

function person(email, username) {
  return email ? { username: username ?? null } : null;
}

function nameSql(column) {
  return `(SELECT username FROM people WHERE email = ${column})`;
}

function pushOf(c, event) {
  const full = { by: c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent) } : null, at: c.now, ...event };
  noteHook(c, full);
  if (c.env.HUB) c.pushes.push(full);
}

function colorFor(name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function labelName(raw) {
  const name = typeof raw === "string" ? K.clean(raw).trim().replace(/\s+/g, " ") : "";
  if (!LABEL_NAME.test(name)) K.fail(400, "a label is 1 to 32 letters, digits, spaces or . _ : + -, starting with a letter or digit");
  return name;
}

function boardName(raw) {
  const name = typeof raw === "string" ? K.clean(raw).replace(/\s+/g, " ").trim() : "";
  if (!isChars(name, 1, MAX_NAME_CHARS)) K.fail(400, `name must be 1 to ${MAX_NAME_CHARS} characters`);
  return name;
}

function boardId(raw) {
  const text = String(raw);
  if (!/^\d{1,15}$/.test(text)) K.fail(404, "no such board");
  return Number(text);
}

function sawLabel(row, from, columns) {
  if (sameCase(row.label_name, from)) return true;
  return sameFolded(row.label_name, from) && !columns.some((r) => r.label_id !== row.label_id && sameCase(r.name, from));
}

function boardsSql(where) {
  return `SELECT b.id, b.name, b.host, b.owner, ${nameSql("b.owner")} AS owner_username,
    (SELECT json_group_array(json_object('id', l.id, 'label', l.name, 'closes', l.closes)) FROM
      (SELECT l.id, l.name, l.closes FROM board_columns bc JOIN labels l ON l.id = bc.label_id WHERE bc.board_id = b.id ORDER BY bc.position) l
    ) AS columns
    FROM boards b WHERE ${where}`;
}

function boardOf(c, row) {
  const columns = JSON.parse(row.columns || "[]");
  return {
    id: row.id,
    name: row.name,
    owner: person(row.owner, row.owner_username),
    mine: row.owner !== null && row.owner === c.actor.email,
    columns: columns.map((col) => ({ label: col.label, closes: Boolean(col.closes) })),
  };
}

function cardOf(row) {
  return {
    key: K.keyOf(row.kind, row.id),
    kind: row.kind,
    title: row.title,
    label: row.label,
    assignee: person(row.assignee, row.assignee_username),
    order: row.ord ?? null,
  };
}

function scopeBinds(v) {
  return [v.all ? 1 : 0, v.host];
}

export async function listLabels(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.closes, l.role,
       (SELECT json_group_array(json_object('id', b.id, 'name', b.name, 'owner_username', ${nameSql("b.owner")}))
        FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = l.id AND (?1 OR b.host = ?2)) AS boards
     FROM labels l
     WHERE l.role IS NOT NULL
       OR EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = l.id AND (?1 OR b.host = ?2))
       OR EXISTS (SELECT 1 FROM items i WHERE i.label_id = l.id AND (?1 OR i.host = ?2))
     ORDER BY l.role IS NULL, CASE l.role WHEN 'inbox' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 2 WHEN 'done' THEN 3 END, l.name COLLATE NOCASE`,
  )
    .bind(...scopeBinds(v))
    .all();
  return K.json(200, {
    labels: results.map((l) => ({
      id: l.id,
      name: l.name,
      closes: Boolean(l.closes),
      boards: JSON.parse(l.boards || "[]").map((b) => ({ id: b.id, name: b.name, owner_username: b.owner_username ?? null })),
    })),
  });
}

async function guardLabel(c, v, labelId) {
  if (v.all) return;
  const elsewhere = await c.env.DB.prepare(
    `SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = ?1 AND (b.host IS NULL OR b.host <> ?2)
     UNION ALL SELECT 1 FROM items WHERE label_id = ?1 AND host <> ?2 LIMIT 1`,
  )
    .bind(labelId, v.host)
    .first();
  if (elsewhere) K.fail(403, "that label is used on other hosts; change it from the CLI, without --host");
}

export async function patchLabel(c, rawId) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const v = boardView(c);
  const { DB } = c.env;
  const label = await DB.prepare("SELECT id, name, closes, role FROM labels WHERE id = ?1").bind(boardId(rawId)).first();
  if (!label) K.fail(404, "no such label");
  const name = labelName(body.name);
  if (name === label.name) return K.json(200, { id: label.id, name, closes: Boolean(label.closes) });
  await guardLabel(c, v, label.id);
  let used;
  try {
    [, used] = await DB.batch([
      DB.prepare("UPDATE labels SET name = ?2 WHERE id = ?1").bind(label.id, name),
      DB.prepare(
        `SELECT b.host FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = ?1 AND b.host IS NOT NULL
         UNION SELECT host FROM items WHERE label_id = ?1`,
      ).bind(label.id),
    ]);
  } catch (error) {
    if (K.isUniqueViolation(error)) K.fail(409, `a label called ${name} exists`);
    throw error;
  }
  const hosts = label.role === null ? { hosts: used.results.map((r) => r.host) } : {};
  pushOf(c, { type: "labels", host: null, ...hosts, action: "renamed", names: [label.name, name] });
  return K.json(200, { id: label.id, name, closes: Boolean(label.closes) });
}

async function ensureBoard(c, v) {
  const { DB } = c.env;
  const me = c.actor.email;
  const at = space(v);
  const results = await DB.batch([
    DB.prepare("UPDATE boards SET owner = ?1, updated_at = ?2 WHERE owner IS NULL AND (?3 OR host = ?4)").bind(me, c.now, ...scopeBinds(v)),
    DB.prepare(
      `INSERT INTO boards (name, host, owner, created_at, updated_at)
       SELECT ?4, ?2, ?1, ?3, ?3 WHERE NOT EXISTS (SELECT 1 FROM boards WHERE owner = ?1 AND host IS ?2)
       RETURNING id`,
    ).bind(me, at, c.now, c.actor.name ? `${c.actor.name}'s board` : "My board"),
  ]);
  const made = results[1].results[0];
  if (made) {
    await DB.prepare(
      `INSERT INTO board_columns (board_id, label_id, position)
       SELECT ?1, id, CASE role WHEN 'inbox' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 2 ELSE 3 END FROM labels WHERE role IS NOT NULL`,
    )
      .bind(made.id)
      .run();
  }
}

export async function getBoards(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  await ensureBoard(c, v);
  const { results } = await c.env.DB.prepare(`${boardsSql("(?1 OR b.host = ?2)")} ORDER BY b.owner IS NOT ?3, owner_username, b.owner, b.id`)
    .bind(...scopeBinds(v), c.actor.email)
    .all();
  return K.json(200, { boards: results.map((r) => boardOf(c, r)) });
}

export async function getBoard(c, rawId) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  const id = boardId(rawId);
  const row = await c.env.DB.prepare(
    `${boardsSql("b.id = ?3 AND (?1 OR b.host = ?2)")
      .replace(
        "AS columns",
        `AS columns,
    (SELECT json_group_array(json_object('id', x.id, 'kind', x.kind, 'title', x.title, 'label', x.label, 'assignee', x.assignee,
        'assignee_username', x.assignee_username, 'ord', x.ord)) FROM
      (SELECT i.id, i.kind, i.title, l.name AS label, i.assignee, CASE WHEN i.assignee IS NULL THEN NULL ELSE ${nameSql("i.assignee")} END AS assignee_username,
         bp.key AS ord, bc.position AS col
       FROM board_columns bc JOIN labels l ON l.id = bc.label_id
       JOIN items i ON i.label_id = bc.label_id AND (b.host IS NULL OR i.host = b.host) AND (?1 OR i.host = ?2)
       LEFT JOIN board_positions bp ON bp.board_id = b.id AND bp.item_id = i.id AND bp.label_id = i.label_id
       WHERE bc.board_id = b.id
       ORDER BY bc.position, bp.key IS NOT NULL, bp.key, i.id DESC) x
    ) AS cards`,
      )}`,
  )
    .bind(...scopeBinds(v), id)
    .first();
  if (!row) K.fail(404, "no such board");
  return K.json(200, { board: boardOf(c, row), cards: JSON.parse(row.cards || "[]").map(cardOf) });
}

async function columnsOf(c, v, raw) {
  if (!Array.isArray(raw) || raw.length < MIN_COLUMNS || raw.length > MAX_COLUMNS) {
    K.fail(400, `a board has ${MIN_COLUMNS} to ${MAX_COLUMNS} columns`);
  }
  const wanted = raw.map((col) => {
    if (!K.isObject(col) && typeof col !== "string") K.fail(400, "a column is {label, closes}");
    const label = labelName(typeof col === "string" ? col : col.label);
    const closes = typeof col === "string" || col.closes === undefined || col.closes === null ? null : col.closes;
    if (closes !== null && typeof closes !== "boolean") K.fail(400, "closes must be true or false");
    return { label, closes };
  });
  if (new Set(wanted.map((w) => w.label.toLowerCase())).size !== wanted.length) K.fail(400, "a board's columns are different labels");
  const { DB } = c.env;
  const [known, count] = await DB.batch([
    DB.prepare("SELECT id, name, closes FROM labels WHERE name IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(wanted.map((w) => w.label))),
    DB.prepare(`SELECT count(*) AS n FROM labels l WHERE ${USED}`),
  ]);
  const byName = new Map(known.results.map((l) => [l.name.toLowerCase(), l]));
  const fresh = wanted.filter((w) => !byName.has(w.label.toLowerCase()));
  if (count.results[0].n + fresh.length > MAX_LABELS) K.fail(400, `an account holds up to ${MAX_LABELS} labels`);
  for (const w of wanted) {
    const l = byName.get(w.label.toLowerCase());
    if (l && w.closes !== null && Boolean(l.closes) !== w.closes) await guardLabel(c, v, l.id);
  }
  return { wanted, byName };
}

async function writeColumns(c, board, plan) {
  const { DB } = c.env;
  const { wanted, byName } = plan;
  const statements = [];
  for (const w of wanted) {
    const closes = w.closes ?? Boolean(byName.get(w.label.toLowerCase())?.closes);
    statements.push(
      DB.prepare("INSERT OR IGNORE INTO labels (name, color, created_at, closes) VALUES (?1, ?2, ?3, ?4)").bind(w.label, colorFor(w.label), c.now, closes ? 1 : 0),
    );
  }
  const flips = wanted.filter((w) => byName.has(w.label.toLowerCase()) && w.closes !== null && Boolean(byName.get(w.label.toLowerCase()).closes) !== w.closes);
  for (const w of flips) {
    statements.push(
      DB.prepare("UPDATE labels SET closes = ?2 WHERE name = ?1").bind(w.label, w.closes ? 1 : 0),
      w.closes
        ? DB.prepare(
            `UPDATE items SET open = 0, resolution = 'fixed', closed_at = ?2, updated_at = ?2
             WHERE open = 1 AND label_id = (SELECT id FROM labels WHERE name = ?1)`,
          ).bind(w.label, c.now)
        : DB.prepare(
            `UPDATE items SET open = 1, resolution = NULL, duplicate_of = NULL, closed_at = NULL, updated_at = ?2
             WHERE open = 0 AND label_id = (SELECT id FROM labels WHERE name = ?1)`,
          ).bind(w.label, c.now),
    );
  }
  statements.push(
    DB.prepare("DELETE FROM board_columns WHERE board_id = ?1").bind(board),
    DB.prepare(
      `INSERT INTO board_columns (board_id, label_id, position)
       SELECT ?1, l.id, j.key FROM json_each(?2) j JOIN labels l ON l.name = j.value`,
    ).bind(board, JSON.stringify(wanted.map((w) => w.label))),
    ...sweepLabels(DB),
  );
  await DB.batch(statements);
}

function sweepLabels(DB) {
  return [
    DB.prepare(`DELETE FROM board_positions WHERE label_id IN (${ORPHANS})`),
    DB.prepare(`DELETE FROM labels WHERE id IN (${ORPHANS})`),
  ];
}

async function ownBoard(c, v, rawId) {
  const b = await c.env.DB.prepare("SELECT id, name, host, owner FROM boards WHERE id = ?1").bind(boardId(rawId)).first();
  if (!b || !sees(v, b.host)) K.fail(404, "no such board");
  if (b.owner !== c.actor.email) K.fail(403, "only its owner changes a board; others watch it");
  return b;
}

async function boardResponse(c, v, id, status) {
  const row = await c.env.DB.prepare(boardsSql("b.id = ?1")).bind(id).first();
  return K.json(status, boardOf(c, row));
}

export async function postBoard(c) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const v = boardView(c);
  const name = boardName(body.name);
  const plan = await columnsOf(c, v, body.columns);
  const { DB } = c.env;
  const made = await DB.prepare(
    `INSERT INTO boards (name, host, owner, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?4 WHERE (SELECT count(*) FROM boards WHERE owner = ?3 AND host IS ?2) < ?5
     RETURNING id`,
  )
    .bind(name, space(v), c.actor.email, c.now, MAX_BOARDS)
    .first();
  if (!made) K.fail(409, `a person has up to ${MAX_BOARDS} boards here`);
  await writeColumns(c, made.id, plan);
  pushOf(c, { type: "board", action: "created", board: made.id, host: space(v) });
  return boardResponse(c, v, made.id, 201);
}

export async function putBoard(c, rawId) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const v = boardView(c);
  const b = await ownBoard(c, v, rawId);
  const name = body.name === undefined ? b.name : boardName(body.name);
  const plan = body.columns === undefined ? null : await columnsOf(c, v, body.columns);
  if (name !== b.name) await c.env.DB.prepare("UPDATE boards SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(b.id, name, c.now).run();
  if (plan) await writeColumns(c, b.id, plan);
  pushOf(c, { type: "board", action: "changed", board: b.id, host: b.host });
  return boardResponse(c, v, b.id, 200);
}

export async function deleteBoard(c, rawId) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  const b = await ownBoard(c, v, rawId);
  const { DB } = c.env;
  const left = await DB.prepare("SELECT count(*) AS n FROM boards WHERE owner = ?1 AND host IS ?2").bind(b.owner, b.host).first();
  if (left.n <= 1) K.fail(409, "that is your last board here; it stays");
  await DB.batch([
    DB.prepare("DELETE FROM board_columns WHERE board_id = ?1").bind(b.id),
    DB.prepare("DELETE FROM board_positions WHERE board_id = ?1").bind(b.id),
    DB.prepare("DELETE FROM boards WHERE id = ?1").bind(b.id),
    ...sweepLabels(DB),
  ]);
  pushOf(c, { type: "board", action: "deleted", board: b.id, host: b.host });
  return new Response(null, { status: 204 });
}

function itemMail(c, row, closed, resolution, mergedInto) {
  if (!c.actor || !c.manager || !row.reporter_email) return;
  K.sendMail(c, row, K.REPORTERS_TOKEN, {
    template: "status",
    status: closed ? "done" : "inbox",
    resolution,
    ...(mergedInto && resolution === "duplicate" ? { merged_into: mergedInto } : {}),
    ref: `status-${c.now}`,
  });
}

function labelStatements(c, row, to, opts = {}) {
  const { DB } = c.env;
  const closes = Boolean(to.closes);
  const wasOpen = Boolean(row.open);
  const resolution = closes ? (opts.resolution ?? (wasOpen ? "fixed" : row.resolution)) : null;
  const next = { ...row, label_id: to.id, label_name: to.name, label_role: to.role ?? null, label_closes: to.closes, open: closes ? 0 : 1, resolution };
  const statusChanged = stageOf(row) !== stageOf(next);
  const openChanged = wasOpen === closes;
  const statements = [
    DB.prepare(
      `UPDATE items SET label_id = ?3, open = ?4, resolution = ?5,
         duplicate_of = CASE WHEN ?5 = 'duplicate' THEN COALESCE(?8, duplicate_of) END,
         closed_at = CASE WHEN ?4 THEN NULL WHEN open = 1 THEN ?6 ELSE closed_at END,
         updated_at = ?6, activity_at = ?6,
         public_activity_at = CASE WHEN ?7 THEN ?6 ELSE public_activity_at END
       WHERE id = ?1 AND label_id = ?2`,
    ).bind(row.id, row.label_id, to.id, closes ? 0 : 1, resolution, c.now, statusChanged ? 1 : 0, opts.duplicateOf ?? null),
  ];
  const events = [];
  const actor = c.actor ? c.actor.email ?? null : null;
  const agent = c.actor && c.actor.agent ? 1 : 0;
  if (row.label_id !== to.id) events.push({ kind: "label", detail: { from: row.label_name, to: to.name }, internal: 1 });
  if (statusChanged) {
    const detail = { from: stageOf(row), to: stageOf(next) };
    if (resolution) detail.resolution = resolution;
    events.push({ kind: "status", detail, internal: 0 });
  }
  if (events.length > 0) {
    statements.push(
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
         SELECT ?1, ?2, json_extract(value, '$.kind'), json_extract(value, '$.detail'), json_extract(value, '$.internal'), ?3, ?4
         FROM json_each(?5) WHERE (SELECT label_id FROM items WHERE id = ?1) = ?6`,
      ).bind(row.id, actor, c.now, agent, JSON.stringify(events.map((e) => ({ ...e, detail: JSON.stringify(e.detail) }))), to.id),
    );
  }
  const after = () => {
    const key = K.keyOf(row.kind, row.id);
    if (row.label_id !== to.id || openChanged) {
      pushOf(c, {
        type: "label",
        key,
        host: row.host,
        title: row.title,
        from: row.label_name,
        to: to.name,
        ...(openChanged ? { done: closes ? "closed" : "reopened", resolution } : {}),
      });
    }
    if (openChanged) itemMail(c, row, closes, resolution, opts.mergedInto);
  };
  return { statements, next, after };
}

async function closingLabel(c, row) {
  const people = [c.manager && c.actor ? c.actor.email : null, row.assignee].filter(Boolean);
  const { results } = await c.env.DB.prepare(
    `SELECT b.owner, l.id, l.name, l.role, l.closes FROM boards b
     JOIN board_columns mine ON mine.board_id = b.id AND mine.label_id = ?2
     JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id AND l.closes = 1
     WHERE b.owner IN (SELECT value FROM json_each(?1)) AND (b.host IS NULL OR b.host = ?3)
     ORDER BY b.id, bc.position DESC`,
  )
    .bind(JSON.stringify(people), row.label_id, row.host)
    .all();
  for (const who of people) {
    const found = results.find((r) => r.owner === who);
    if (found) return found;
  }
  return await c.env.DB.prepare(
    "SELECT id, name, role, closes FROM labels WHERE closes = 1 ORDER BY role = 'done' DESC, id LIMIT 1",
  ).first();
}

export async function closeItem(c, row, resolution, opts = {}) {
  const to = row.label_closes ? { id: row.label_id, name: row.label_name, role: row.label_role, closes: 1 } : await closingLabel(c, row);
  if (!to) K.fail(409, "no label closes items; mark one with p99 boards set --closes");
  return applyLabel(c, row, to, { ...opts, resolution });
}

export async function reopenItem(c, row, role = "inbox") {
  const to = await c.env.DB.prepare("SELECT id, name, role, closes FROM labels WHERE role = ?1").bind(role).first();
  return applyLabel(c, row, to, {});
}

async function applyLabel(c, row, to, opts) {
  const plan = labelStatements(c, row, to, opts);
  const results = await c.env.DB.batch(plan.statements);
  if (!results[0].meta.changes) K.fail(409, MOVED, "moved");
  plan.after();
  return plan.next;
}

export function labelChangeStatements(c, row, to, opts = {}) {
  return labelStatements(c, row, to, opts);
}

function findItem(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 40) K.fail(400, "key must be an item key");
  const id = K.parseKey(raw);
  if (id === null) K.fail(404, `no item ${raw}`);
  return id;
}

function anchorOf(body) {
  const before = body.before ?? null;
  const after = body.after ?? null;
  if (before !== null && after !== null) K.fail(400, "give before or after, not both");
  if (before !== null) return { side: "before", raw: String(before) };
  if (after !== null) return { side: "after", raw: String(after) };
  return null;
}

function placeIn(column, selfId, anchor, anchorId) {
  const list = column.filter((r) => r.id !== selfId);
  let slot = 0;
  if (anchor) {
    const at = list.findIndex((r) => r.id === anchorId);
    if (at < 0) K.fail(400, `${anchor.raw} is not in that column of the board`);
    slot = anchor.side === "before" ? at : at + 1;
  }
  const unkeyed = list.filter((r) => r.key === null).length;
  if (unkeyed === 0 || slot > unkeyed) {
    const prev = slot > 0 ? list[slot - 1].key : null;
    const next = slot < list.length ? list[slot].key : null;
    const key = generateKeyBetween(prev, next);
    if (key.length <= LONG_KEY) return { key, rows: [{ id: selfId, key }] };
  }
  const ordered = [...list.slice(0, slot), { id: selfId }, ...list.slice(slot)];
  const keys = generateNKeysBetween(null, null, ordered.length);
  const rows = ordered.map((r, i) => ({ id: r.id, key: keys[i] }));
  return { key: keys[slot], rows };
}

export async function postMove(c) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  for (const f of ["key", "from", "to"]) if (typeof body[f] !== "string" || body[f].length === 0) K.fail(400, `${f} is required`);
  for (const f of ["before", "after"]) if (body[f] !== undefined && body[f] !== null && typeof body[f] !== "string") K.fail(400, `${f} must be an item key`);
  const v = boardView(c);
  const { DB } = c.env;
  const id = findItem(body.key);
  const hasBoard = body.board !== undefined && body.board !== null;
  const board = hasBoard ? boardId(body.board) : null;
  const anchor = anchorOf(body);
  if (anchor && !hasBoard) K.fail(400, "before and after place a card on a board; give board too");
  const anchorId = anchor ? K.parseKey(anchor.raw) : null;
  if (anchor && anchorId === null) K.fail(400, `${anchor.raw} is not an item key`);
  const reads = await DB.batch([
    DB.prepare(`SELECT i.*, ${LABEL_COLUMNS}, ${nameSql("i.assignee")} AS assignee_username FROM items i ${LABEL_JOIN} WHERE i.id = ?1 AND (?2 OR i.host = ?3)`).bind(id, ...scopeBinds(v)),
    DB.prepare(
      `SELECT b.id, b.host, b.owner, l.id AS label_id, l.name, l.role, l.closes FROM boards b
       JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id
       WHERE (b.owner = ?1 OR b.id = ?2) AND (?3 OR b.host = ?4)`,
    ).bind(c.actor.email, board, ...scopeBinds(v)),
    hasBoard
      ? DB.prepare(
          `SELECT i.id, i.label_id, bp.key FROM boards b JOIN board_columns bc ON bc.board_id = b.id
           JOIN items i ON i.label_id = bc.label_id AND (b.host IS NULL OR i.host = b.host) AND (?2 OR i.host = ?3)
           LEFT JOIN board_positions bp ON bp.board_id = b.id AND bp.item_id = i.id AND bp.label_id = i.label_id
           WHERE b.id = ?1 ORDER BY bp.key IS NOT NULL, bp.key, i.id DESC`,
        ).bind(board, ...scopeBinds(v))
      : DB.prepare("SELECT 1"),
  ]);
  const row = reads[0].results[0];
  if (!row) K.fail(404, `no item ${body.key}`);
  const columns = reads[1].results;
  if (hasBoard) {
    const on = columns.filter((r) => r.id === board);
    if (on.length === 0) K.fail(404, "no such board");
    if (on[0].owner !== c.actor.email) K.fail(403, "only its owner moves cards on a board; others watch it");
    if (on[0].host !== null && on[0].host !== row.host) K.fail(404, "no such board");
  }
  const mine = columns.filter((r) => r.owner === c.actor.email && (r.host === null || r.host === row.host) && (!hasBoard || r.id === board));
  const target = namedBy(mine, body.to, (r) => r.name)[0];
  if (!target) K.fail(400, hasBoard ? `${body.to} is not a column of that board` : `${body.to} is not a label on your boards`);
  if (!sawLabel(row, body.from, columns)) K.fail(409, MOVED, "moved");
  const to = { id: target.label_id, name: target.name, role: target.role, closes: target.closes };
  const resolution = body.resolution ?? null;
  if (resolution !== null && (!RESOLUTIONS.includes(resolution) || !to.closes)) K.fail(400, "a resolution goes with a label that closes");
  if (resolution === "duplicate" && row.duplicate_of === null) K.fail(400, "a duplicate needs duplicate_of; set it with p99 merge");
  const plan = labelStatements(c, row, to, { resolution: resolution ?? undefined });
  const place = hasBoard ? placeIn(reads[2].results.filter((r) => r.label_id === to.id), row.id, anchor, anchorId) : null;
  const statements = [...plan.statements];
  if (place) {
    statements.push(
      DB.prepare(
        `INSERT INTO board_positions (board_id, item_id, label_id, key)
         SELECT ?1, json_extract(j.value, '$.id'), ?2, json_extract(j.value, '$.key') FROM json_each(?3) j
         WHERE (SELECT label_id FROM items WHERE id = ?4) = ?2
         ON CONFLICT (board_id, item_id) DO UPDATE SET label_id = excluded.label_id, key = excluded.key`,
      ).bind(board, to.id, JSON.stringify(place.rows), row.id),
    );
  }
  const results = await DB.batch(statements);
  if (!results[0].meta.changes) K.fail(409, MOVED, "moved");
  plan.after();
  const key = K.keyOf(row.kind, row.id);
  if (place) pushOf(c, { type: "order", board, key, order: place.key, host: row.host, ...(place.rows.length > 1 ? { rebalanced: true } : {}) });
  const card = cardOf({
    ...row,
    label: to.name,
    assignee_username: row.assignee_username ?? null,
    ord: place ? place.key : null,
  });
  return K.json(200, { card });
}

export async function postStreamTicket(c) {
  K.requireManager(c);
  if (!c.env.HUB) K.fail(404, "this Worker has no push yet; run p99 deploy");
  const v = boardView(c);
  const hosts = v.all ? null : c.code ? c.code.hosts.filter((h) => c.dir.hosts.has(h)) : [v.host];
  const ticket = K.hex(crypto.getRandomValues(new Uint8Array(24)));
  const ttl = Math.min(TICKET_TTL_MS, Number(c.env.TICKET_TTL_MS) || TICKET_TTL_MS);
  await K.hubOf(c.env).ticket(await K.sha256Hex(K.encoder.encode(ticket)), { hosts, until: Date.now() + ttl });
  return K.json(201, { ticket, expires_in: Math.ceil(ttl / 1000) });
}

export async function ticketStream(request, env, url) {
  if (request.method !== "GET") K.fail(404, "no such route");
  const dir = await K.loadDirectory(env);
  if (!dir.hosts.has(url.hostname)) K.fail(404, "no such host");
  if (!env.HUB) K.fail(404, "this Worker has no push yet; run p99 deploy");
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") K.fail(400, "the stream takes a WebSocket upgrade");
  const ticket = url.searchParams.get("t") || "";
  if (!TICKET.test(ticket)) K.fail(401, "a valid stream ticket is required");
  const target = new URL("https://hub.p99/connect");
  target.searchParams.set("ticket", await K.sha256Hex(K.encoder.encode(ticket)));
  target.searchParams.set("origin", url.hostname);
  return K.hubOf(env).fetch(new Request(target, request));
}

export async function redeemTicket(storage, url) {
  const hash = url.searchParams.get("ticket");
  const key = `ticket:${hash}`;
  const entry = await storage.get(key);
  if (entry) await storage.delete(key);
  if (!entry || entry.until < Date.now()) return null;
  const origin = url.searchParams.get("origin");
  if (entry.hosts !== null && !entry.hosts.includes(origin)) return null;
  return { hosts: entry.hosts };
}

export async function storeTicket(storage, hash, entry) {
  await storage.put(`ticket:${hash}`, entry);
  const now = Date.now();
  const stale = [];
  for (const [key, value] of await storage.list({ prefix: "ticket:", limit: 200 })) {
    if (!value || value.until < now) stale.push(key);
  }
  if (stale.length > 0) await storage.delete(stale);
}

export const BOARD_ROUTES = [
  ["GET", /^\/labels$/, listLabels],
  ["PATCH", /^\/labels\/(\d{1,15})$/, patchLabel],
  ["GET", /^\/boards$/, getBoards],
  ["POST", /^\/boards$/, postBoard],
  ["GET", /^\/boards\/([^/]+)$/, getBoard],
  ["PUT", /^\/boards\/([^/]+)$/, putBoard],
  ["DELETE", /^\/boards\/([^/]+)$/, deleteBoard],
  ["POST", /^\/move$/, postMove],
];

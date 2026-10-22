import { boardView } from "./boards.js";
import { DEFAULT_CARDS_LIMIT, K, LANES, MAX_CARDS_LIMIT, laneIndex, laneWord, notCard, personOf, projectName } from "./cards.js";
import { peopleOf } from "./people.js";

const DONE_LANE = LANES.length - 1;
const SOURCES = { human: 0, agent: 1 };
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;
const SINCE_RULE = "since must be a time like 2026-10-22T08:00:00Z";
const MAX_SHOWN_KEY = 40;
const EMAIL_FIELDS = { assignee: ["from", "to"], mail: ["to"] };
const HANDLES = [
  ["reporter_email", "reporter_username", "reporter_name"],
  ["changed_email", "changed_username", "changed_name"],
  ["by_email", "by_username", "by_name"],
  ["author_email", "author_username", "author_name"],
];
const LANES_CTE = `lanes AS (
    SELECT bc.label_id, cb.id AS board_id,
      (SELECT count(*) FROM board_columns o WHERE o.board_id = bc.board_id AND o.position < bc.position) AS lane
    FROM boards cb JOIN board_columns bc ON bc.board_id = cb.id WHERE cb.cards = 1)`;
const NAMES_SQL = `SELECT j.value AS email, COALESCE(
    (SELECT name FROM codes WHERE lower(email) = j.value AND name <> '' ORDER BY id DESC LIMIT 1),
    (SELECT reporter_name FROM items WHERE reporter_email = j.value AND reporter_name <> '' ORDER BY id DESC LIMIT 1),
    (SELECT author_name FROM comments WHERE item_id IN (SELECT value FROM json_each(?2)) AND author_email = j.value AND author_name <> '' ORDER BY id DESC LIMIT 1)) AS name
  FROM json_each(?1) j`;

function handleSql(email) {
  return `(SELECT username FROM people WHERE email = ${email})`;
}

function laneSql(item, lane) {
  return `COALESCE(${lane}.lane, CASE WHEN ${item}.open THEN 0 ELSE ${DONE_LANE} END)`;
}

function lastChangeSql(item) {
  return `(SELECT max(x.id) FROM events x WHERE x.item_id = ${item}.id AND x.actor_email IS NOT NULL AND x.kind <> 'mail')`;
}

function lastSourceSql(item) {
  return `COALESCE((SELECT actor_agent FROM events WHERE id = ${lastChangeSql(item)}), ${item}.reporter_agent)`;
}

const CHANGED_AT = "COALESCE(e.at, i.created_at)";
const CHANGED_AGENT = "CASE WHEN e.id IS NULL THEN i.reporter_agent ELSE e.actor_agent END";

function columnsSql(body) {
  return `i.id, i.kind, i.project, i.title, ${body ? "i.body," : ""} i.host, i.open, i.created_at, i.comment_count,
      i.reporter_email, i.reporter_name, i.reporter_agent, i.reporter_via, lb.name AS label_name,
      ${CHANGED_AT} AS changed_at,
      COALESCE(e.actor_email, i.reporter_email) AS changed_email,
      ${CHANGED_AGENT} AS changed_agent,
      CASE WHEN e.id IS NULL THEN i.reporter_via ELSE e.actor_via END AS changed_via,
      CASE WHEN COALESCE(e.actor_email, i.reporter_email) = i.reporter_email THEN i.reporter_name END AS changed_name`;
}

const HEAVY_JOINS = `JOIN labels lb ON lb.id = i.label_id LEFT JOIN events e ON e.id = ${lastChangeSql("i")}`;
const HANDLE_COLUMNS = `${handleSql("page.reporter_email")} AS reporter_username, ${handleSql("page.changed_email")} AS changed_username`;
const PAGE_ORDER = "ORDER BY lane, keyed, COALESCE(ord, ''), id DESC";

function listSql(scope, lanes, outer, limit) {
  return `WITH ${LANES_CTE},
    ranked AS (
      SELECT id, lane, ord, ord IS NOT NULL AS keyed, ROW_NUMBER() OVER (PARTITION BY lane ORDER BY ord IS NOT NULL, ord, id DESC) AS place FROM (
        SELECT i.id, ${laneSql("i", "ln")} AS lane, bp.key AS ord FROM items i
        LEFT JOIN lanes ln ON ln.label_id = i.label_id
        LEFT JOIN board_positions bp ON bp.board_id = ln.board_id AND bp.item_id = i.id AND bp.label_id = i.label_id
        WHERE i.project IS NOT NULL AND ${scope("i")})
      WHERE ${lanes}),
    page AS (
      SELECT r.lane, r.ord, r.keyed, r.place, ${columnsSql(false)}
      FROM ranked r JOIN items i ON i.id = r.id ${HEAVY_JOINS}
      ${outer.length ? `WHERE ${outer.join(" AND ")}` : ""}
      ORDER BY r.lane, r.keyed, COALESCE(r.ord, ''), r.id DESC LIMIT ${limit})
    SELECT page.*, ${HANDLE_COLUMNS} FROM page ${PAGE_ORDER}`;
}

function oneSql(scope, id, body) {
  return `WITH ${LANES_CTE},
    t AS (
      SELECT i.id, ${laneSql("i", "ln")} AS lane, bp.key AS ord FROM items i
      LEFT JOIN lanes ln ON ln.label_id = i.label_id
      LEFT JOIN board_positions bp ON bp.board_id = ln.board_id AND bp.item_id = i.id AND bp.label_id = i.label_id
      WHERE i.id = ${id} AND i.project IS NOT NULL AND ${scope("i")}),
    peers AS (
      SELECT o.id FROM t JOIN items o ON o.label_id = (SELECT label_id FROM lanes WHERE lane = t.lane) WHERE t.lane < ${DONE_LANE}
      UNION
      SELECT o.id FROM t JOIN items o ON o.open = 1 WHERE t.lane = 0 AND o.label_id NOT IN (SELECT label_id FROM lanes)),
    page AS (
      SELECT t.lane, t.ord, t.ord IS NOT NULL AS keyed,
        CASE WHEN t.lane = ${DONE_LANE} THEN NULL ELSE 1 + (
          SELECT count(*) FROM peers p JOIN items o ON o.id = p.id
          LEFT JOIN board_positions op ON op.board_id = (SELECT id FROM boards WHERE cards = 1) AND op.item_id = o.id AND op.label_id = o.label_id
          WHERE o.project IS NOT NULL AND ${scope("o")}
            AND (op.key IS NOT NULL, COALESCE(op.key, ''), -o.id) < (t.ord IS NOT NULL, COALESCE(t.ord, ''), -t.id)) END AS place,
        ${columnsSql(body)}
      FROM t JOIN items i ON i.id = t.id ${HEAVY_JOINS})
    SELECT page.*, ${HANDLE_COLUMNS} FROM page`;
}

function linksSql() {
  return `SELECT e.item_id, e.detail_json, e.at, e.actor_email AS by_email, e.actor_agent AS by_agent, e.actor_via AS by_via,
      NULL AS by_name, ${handleSql("e.actor_email")} AS by_username
    FROM events e WHERE e.item_id IN (SELECT value FROM json_each(?1)) AND e.kind = 'link' ORDER BY e.id`;
}

function scopeOf(v, q) {
  if (v.all) return () => "1";
  const host = q.bind(v.host);
  return (item) => `${item}.host = ${host}`;
}

function shownKey(raw) {
  let text;
  try {
    text = decodeURIComponent(String(raw));
  } catch {
    text = String(raw);
  }
  return [...K.clean(text).trim()].slice(0, MAX_SHOWN_KEY).join("");
}

function detailOf(json) {
  try {
    const value = JSON.parse(json);
    return value !== null && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function addressesOf(value) {
  return (Array.isArray(value) ? value : [value]).filter((v) => typeof v === "string" && v.length > 0);
}

export function emailsIn(kind, detail, out = new Set()) {
  for (const field of EMAIL_FIELDS[kind] ?? []) for (const email of addressesOf(detail[field])) out.add(email.toLowerCase());
  return out;
}

export function scrubEmails(kind, detail, handles) {
  const fields = EMAIL_FIELDS[kind];
  if (!fields) return detail;
  const out = { ...detail };
  const handle = (email) => ({ username: handles.get(email.toLowerCase()) ?? null });
  for (const field of fields) {
    const value = out[field];
    if (Array.isArray(value)) out[field] = addressesOf(value).map(handle);
    else if (typeof value === "string" && value.length > 0) out[field] = handle(value);
    else if (value !== undefined && value !== null) out[field] = null;
  }
  return out;
}

async function settle(c, rows, ids = []) {
  const nameless = new Set();
  for (const row of rows) {
    for (const [email, , name] of HANDLES) {
      if (!row[email] || row[name]) continue;
      if (c.actor && row[email] === c.actor.email && c.actor.name) row[name] = c.actor.name;
      else nameless.add(row[email]);
    }
  }
  if (nameless.size > 0) {
    const { results } = await c.env.DB.prepare(NAMES_SQL).bind(JSON.stringify([...nameless]), JSON.stringify(ids)).all();
    const names = new Map(results.map((r) => [r.email, r.name]));
    for (const row of rows) for (const [email, , name] of HANDLES) if (row[email] && !row[name]) row[name] = names.get(row[email]) ?? null;
  }
  const wanted = [];
  for (const row of rows) {
    for (const [email, handle, name] of HANDLES) if (row[email] && row[handle] == null) wanted.push({ email: row[email], name: row[name] });
  }
  if (wanted.length === 0) return;
  const handles = await peopleOf(c.env.DB, wanted, c.now);
  for (const row of rows) {
    for (const [email, handle] of HANDLES) if (row[email] && row[handle] == null) row[handle] = handles.get(String(row[email]).toLowerCase()) ?? null;
  }
}

export function linkOf(row) {
  const detail = detailOf(row.detail_json);
  return {
    ref: typeof detail.ref === "string" ? detail.ref : null,
    note: typeof detail.note === "string" ? detail.note : null,
    by: row.by_email ? personOf(row.by_name, row.by_username, row.by_agent, row.by_via) : null,
    at: row.at,
  };
}

export function cardOf(row, links = []) {
  return {
    key: K.keyOf(row.kind, row.id),
    kind: row.kind,
    project: row.project,
    status: laneWord(row.lane),
    label: row.label_name,
    lane: row.lane === DONE_LANE ? null : row.place,
    title: row.title,
    host: row.host,
    reporter: personOf(row.reporter_name, row.reporter_username, row.reporter_agent, row.reporter_via),
    created_at: row.created_at,
    changed_at: row.changed_at,
    changed_by: personOf(row.changed_name, row.changed_username, row.changed_agent, row.changed_via),
    comments: row.comment_count,
    links,
  };
}

async function linksFor(c, ids) {
  if (ids.length === 0) return new Map();
  const { results } = await c.env.DB.prepare(linksSql()).bind(JSON.stringify(ids)).all();
  await settle(c, results, ids);
  const byItem = new Map(ids.map((id) => [id, []]));
  for (const row of results) byItem.get(row.item_id).push(linkOf(row));
  return byItem;
}

async function cardRow(c, raw, body = false) {
  const id = K.parseKey(raw);
  if (id === null) K.fail(404, `no item ${shownKey(raw)}`);
  const v = boardView(c);
  const q = K.query();
  const scope = scopeOf(v, q);
  const { DB } = c.env;
  const [card, plain] = await DB.batch([
    DB.prepare(oneSql(scope, q.bind(id), body)).bind(...q.binds),
    DB.prepare("SELECT id, kind, host FROM items WHERE id = ?1").bind(id),
  ]);
  const row = card.results[0];
  if (row) return row;
  const item = plain.results[0];
  if (!item || !(v.all || item.host === v.host)) K.fail(404, `no item ${shownKey(raw)}`);
  K.fail(409, notCard(K.keyOf(item.kind, item.id)));
}

export async function loadCard(c, raw) {
  K.requireManager(c);
  const row = await cardRow(c, raw);
  await settle(c, [row], [row.id]);
  return cardOf(row, (await linksFor(c, [row.id])).get(row.id));
}

function encodeCursor(row) {
  return btoa(JSON.stringify([row.lane, row.keyed, row.ord ?? "", -row.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(text) {
  let value;
  try {
    value = JSON.parse(atob(text.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    K.fail(400, "cursor is not valid");
  }
  const ok =
    Array.isArray(value) &&
    value.length === 4 &&
    Number.isInteger(value[0]) &&
    (value[1] === 0 || value[1] === 1) &&
    typeof value[2] === "string" &&
    value[2].length <= 200 &&
    Number.isSafeInteger(value[3]) &&
    value[3] < 0;
  if (!ok) K.fail(400, "cursor is not valid");
  return value;
}

export function sinceOf(text) {
  const m = RFC3339.exec(text);
  if (!m) K.fail(400, SINCE_RULE);
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (m[8] === "Z" || (Number(m[9]) <= 23 && Number(m[10]) <= 59));
  const at = Date.parse(text);
  if (!real || !Number.isFinite(at)) K.fail(400, SINCE_RULE);
  return new Date(at).toISOString();
}

function sourceOf(text) {
  if (!Object.hasOwn(SOURCES, text)) K.fail(400, "source must be human or agent");
  return SOURCES[text];
}

export function limitOf(text) {
  const limit = text === null ? DEFAULT_CARDS_LIMIT : Number(text);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CARDS_LIMIT) K.fail(400, `limit must be 1 to ${MAX_CARDS_LIMIT}`);
  return limit;
}

export async function listCards(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const params = c.url.searchParams;
  const v = boardView(c);
  const q = K.query();
  const scope = scopeOf(v, q);
  const outer = [];
  const projects = params.getAll("project").map(projectName);
  if (projects.length > 0) outer.push(`i.project COLLATE NOCASE IN (${projects.map((p) => q.bind(p)).join(", ")})`);
  const statuses = params.getAll("status").map((word) => {
    const at = laneIndex(word);
    if (at < 0) K.fail(400, `status must be one of ${LANES.join(", ")}`);
    return at;
  });
  const lanes = statuses.length > 0 ? `lane IN (${[...new Set(statuses)].map((s) => q.bind(s)).join(", ")})` : `lane < ${DONE_LANE}`;
  const since = params.get("since");
  if (since !== null) outer.push(`${CHANGED_AT} >= ${q.bind(sinceOf(since))}`);
  const source = params.get("source");
  if (source !== null) outer.push(`${CHANGED_AGENT} = ${q.bind(sourceOf(source))}`);
  const host = params.get("host");
  if (host !== null && host !== "*") outer.push(`i.host = ${q.bind(host.toLowerCase())}`);
  const cursor = params.get("cursor");
  if (cursor) {
    const [lane, keyed, ord, id] = decodeCursor(cursor);
    outer.push(`(r.lane, r.keyed, COALESCE(r.ord, ''), -r.id) > (${q.bind(lane)}, ${q.bind(keyed)}, ${q.bind(ord)}, ${q.bind(id)})`);
  }
  const limit = limitOf(params.get("limit"));
  const { results } = await c.env.DB.prepare(listSql(scope, lanes, outer, q.bind(limit + 1)))
    .bind(...q.binds)
    .all();
  const page = results.slice(0, limit);
  const ids = page.map((row) => row.id);
  await settle(c, page, ids);
  const links = await linksFor(c, ids);
  return K.json(200, {
    cards: page.map((row) => cardOf(row, links.get(row.id))),
    next_cursor: results.length > limit ? encodeCursor(page[page.length - 1]) : null,
  });
}

export async function getCard(c, rawKey) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const row = await cardRow(c, rawKey, true);
  const { DB } = c.env;
  const [linked, said, happened] = await DB.batch([
    DB.prepare(linksSql()).bind(JSON.stringify([row.id])),
    DB.prepare(
      `SELECT id, author_email, author_name, author_agent, author_via, ${handleSql("author_email")} AS author_username, body, internal, created_at
       FROM comments WHERE item_id = ?1 ORDER BY id`,
    ).bind(row.id),
    DB.prepare(
      `SELECT e.kind, e.detail_json, e.at, e.actor_email AS by_email, e.actor_agent AS by_agent, e.actor_via AS by_via,
         NULL AS by_name, ${handleSql("e.actor_email")} AS by_username
       FROM events e WHERE e.item_id = ?1 ORDER BY e.id`,
    ).bind(row.id),
  ]);
  const [links, comments, events] = [linked.results, said.results, happened.results];
  await settle(c, [row, ...links, ...comments, ...events], [row.id]);
  const details = events.map((ev) => detailOf(ev.detail_json));
  const mentioned = [...events.reduce((out, ev, at) => emailsIn(ev.kind, details[at], out), new Set())];
  const handles = new Map();
  if (mentioned.length > 0) {
    const { results } = await DB.prepare("SELECT email, username FROM people WHERE email IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(mentioned)).all();
    for (const r of results) handles.set(r.email, r.username);
  }
  return K.json(200, {
    card: { ...cardOf(row, links.map(linkOf)), body: row.body },
    comments: comments.map((cm) => ({
      id: cm.id,
      author: personOf(cm.author_name, cm.author_username, cm.author_agent, cm.author_via),
      body: cm.body,
      internal: Boolean(cm.internal),
      created_at: cm.created_at,
    })),
    events: events.map((ev, at) => ({
      kind: ev.kind,
      detail: scrubEmails(ev.kind, details[at], handles),
      by: ev.by_email ? personOf(ev.by_name, ev.by_username, ev.by_agent, ev.by_via) : null,
      at: ev.at,
    })),
  });
}

export async function listProjects(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  const q = K.query();
  const { results } = await c.env.DB.prepare(
    `SELECT f.project AS name, g.open, g.done FROM
       (SELECT min(i.id) AS first, sum(i.open) AS open, sum(1 - i.open) AS done FROM items i
        WHERE i.project IS NOT NULL AND ${scopeOf(v, q)("i")} GROUP BY i.project) g
     JOIN items f ON f.id = g.first ORDER BY f.project COLLATE NOCASE, f.project`,
  )
    .bind(...q.binds)
    .all();
  return K.json(200, { projects: results.map((r) => ({ name: r.name, open: r.open, done: r.done })) });
}

export function cardSide(board, item) {
  return `((${item}.project IS NOT NULL) = (${board}.cards = 1))`;
}

export function cardFilters(c, params, q, where) {
  const source = params.get("source");
  if (source === null) return where;
  K.requireManager(c);
  where.push(`${lastSourceSql("i")} = ${q.bind(sourceOf(source))}`);
  return where;
}

export const CARD_READS = [
  ["GET", /^\/cards$/, listCards],
  ["GET", /^\/cards\/([^/]+)$/, getCard],
  ["GET", /^\/projects$/, listProjects],
];

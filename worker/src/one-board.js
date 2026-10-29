import { K, LANES, personOf, projectName } from "./cards.js";
import { LABEL_COLUMNS, LABEL_JOIN, MOVED, RESOLUTIONS, boardView, inView, labelChangeStatements, placeIn, pushOf } from "./boards.js";
import { cardsBoard } from "./cards-write.js";
import { peopleOf } from "./people.js";
import { namedBy, sameFolded } from "./text.js";
import { viewSql } from "./grants.js";
import { withAvatars } from "./avatars.js";

export const BOARDS_GONE = "boards are one per space; see p99 board";

const DONE = LANES.length - 1;
const SOURCES = { human: 0, agent: 1 };
const MAX_KEY_CHARS = 40;
export const LANES_SQL = `SELECT l.id, l.name, l.role, l.closes FROM boards b JOIN board_columns bc ON bc.board_id = b.id
  JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 ORDER BY bc.position`;
const LANE_ROWS = `SELECT i.id, i.host, i.project_id, bp.key FROM items i
  LEFT JOIN board_positions bp ON bp.board_id = ?1 AND bp.item_id = i.id AND bp.label_id = i.label_id
  WHERE i.label_id = ?2 ORDER BY bp.key IS NOT NULL, bp.key, i.id DESC`;
const CHANGED_EMAIL = "COALESCE(e.actor_email, i.reporter_email)";
const CHANGED_AGENT = "CASE WHEN e.id IS NULL THEN i.reporter_agent ELSE e.actor_agent END";
export function laneOf(lanes, to) {
  const at = LANES.indexOf(to);
  if (at >= 0) return lanes[at] ?? null;
  const named = namedBy(lanes, to, (l) => l.name);
  return named.length === 1 ? named[0] : null;
}

export function boardFilter(c, params) {
  const projects = [...new Set(params.getAll("project").map(projectName))];
  const hosts = [...new Set(params.getAll("host").map((h) => h.trim().toLowerCase()))].filter((h) => h !== "" && h !== "*");
  const source = params.get("source");
  if (source !== null && !Object.hasOwn(SOURCES, source)) K.fail(400, "source must be human or agent");
  const statuses = params.getAll("status").map((word) => {
    const at = LANES.indexOf(word);
    if (at < 0) K.fail(400, `status must be one of ${LANES.join(", ")}`);
    return at;
  });
  return { projects, hosts, source: source === null ? null : SOURCES[source], statuses: [...new Set(statuses)].sort((a, b) => a - b) };
}

export function oneBoardSql(v, filter) {
  const binds = [];
  const bind = (value) => {
    binds.push(value);
    return `?${binds.length}`;
  };
  const scope = viewSql(v, bind);
  const outer = [];
  if (filter.projects.length > 0) outer.push(`i.project_id IN (SELECT id FROM projects WHERE name IN (${filter.projects.map(bind).join(", ")}))`);
  if (filter.hosts.length > 0) outer.push(`i.host IN (${filter.hosts.map(bind).join(", ")})`);
  if (filter.source !== null) outer.push(`${CHANGED_AGENT} = ${bind(filter.source)}`);
  if (filter.statuses.length > 0) outer.push(`r.lane IN (${filter.statuses.map(bind).join(", ")})`);
  const sql = `WITH lanes AS (
      SELECT bc.label_id, cb.id AS board_id, row_number() OVER (ORDER BY bc.position) - 1 AS lane
      FROM boards cb JOIN board_columns bc ON bc.board_id = cb.id WHERE cb.cards = 1),
    placed AS (
      SELECT i.id, COALESCE(ln.lane, CASE WHEN i.open THEN 0 ELSE ${DONE} END) AS lane, bp.key AS ord FROM items i
      LEFT JOIN lanes ln ON ln.label_id = i.label_id
      LEFT JOIN board_positions bp ON bp.board_id = ln.board_id AND bp.item_id = i.id AND bp.label_id = i.label_id
      WHERE ${scope}),
    ranked AS (
      SELECT id, lane, ord, row_number() OVER (PARTITION BY lane ORDER BY ord IS NOT NULL, ord, id DESC) AS place FROM placed)
    SELECT r.lane, r.ord, r.place, i.id, i.kind, (SELECT p.name FROM projects p WHERE p.id = i.project_id) AS project, i.title, i.host, i.assignee, lb.name AS label_name,
      COALESCE(e.at, i.created_at) AS changed_at, ${CHANGED_EMAIL} AS changed_email, ${CHANGED_AGENT} AS changed_agent,
      CASE WHEN e.id IS NULL THEN i.reporter_via ELSE e.actor_via END AS changed_via,
      CASE WHEN ${CHANGED_EMAIL} = i.reporter_email AND i.reporter_name <> '' THEN i.reporter_name
        ELSE (SELECT name FROM codes WHERE lower(email) = ${CHANGED_EMAIL} AND name <> '' ORDER BY id DESC LIMIT 1) END AS changed_name,
      (SELECT username FROM people WHERE email = ${CHANGED_EMAIL}) AS changed_username,
      (SELECT username FROM people WHERE email = i.assignee) AS assignee_username
    FROM ranked r JOIN items i ON i.id = r.id JOIN labels lb ON lb.id = i.label_id
    LEFT JOIN events e ON e.id = (SELECT max(x.id) FROM events x WHERE x.item_id = i.id AND x.actor_email IS NOT NULL AND x.kind <> 'mail')
    ${outer.length > 0 ? `WHERE ${outer.join(" AND ")}` : ""}
    ORDER BY r.lane, r.place`;
  return { sql, binds };
}

export function lanesOf(rows) {
  return rows.map((l, at) => ({ word: LANES[at] ?? null, label: l.name, closes: Boolean(l.closes) }));
}

export function boardCardOf(row) {
  return {
    key: K.keyOf(row.kind, row.id),
    kind: row.kind,
    project: row.project ?? null,
    status: LANES[row.lane] ?? null,
    label: row.label_name,
    lane: row.lane === DONE ? null : row.place,
    title: row.title,
    host: row.host,
    assignee: row.assignee ? (row.assignee_username ?? null) : null,
    order: row.ord ?? null,
    changed_at: row.changed_at,
    changed_by: personOf(row.changed_name, row.changed_username, row.changed_agent, row.changed_via),
  };
}

async function settle(c, rows) {
  const wanted = [];
  for (const row of rows) {
    if (!row.changed_name && c.actor && row.changed_email === c.actor.email) row.changed_name = c.actor.name || null;
    if (row.changed_email && row.changed_username == null) wanted.push({ email: row.changed_email, name: row.changed_name });
    if (row.assignee && row.assignee_username == null) wanted.push({ email: row.assignee, name: "" });
  }
  if (wanted.length === 0) return;
  const handles = await peopleOf(c.env.DB, wanted, c.now);
  const handle = (email) => handles.get(String(email).toLowerCase()) ?? null;
  for (const row of rows) {
    if (row.changed_email && row.changed_username == null) row.changed_username = handle(row.changed_email);
    if (row.assignee && row.assignee_username == null) row.assignee_username = handle(row.assignee);
  }
}

async function oneBoard(c) {
  const filter = boardFilter(c, c.url.searchParams);
  const { sql, binds } = oneBoardSql(boardView(c), filter);
  const { DB } = c.env;
  const [lanes, rows] = await DB.batch([DB.prepare(LANES_SQL), DB.prepare(sql).bind(...binds)]);
  await settle(c, rows.results);
  const cards = rows.results.map(boardCardOf);
  await withAvatars(DB, cards.map((card) => card.changed_by));
  return { board: { lanes: lanesOf(lanes.results) }, cards };
}

export async function getOneBoard(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  return K.json(200, await oneBoard(c));
}

export async function goneBoards(c) {
  K.requireManager(c);
  K.fail(410, BOARDS_GONE);
}

export function anchorOf(body) {
  const before = body.before ?? null;
  const after = body.after ?? null;
  if (before !== null && after !== null) K.fail(400, "give before or after, not both");
  if (before === null && after === null) return null;
  const anchor = before !== null ? { side: "before", raw: String(before) } : { side: "after", raw: String(after) };
  const id = K.parseKey(anchor.raw);
  if (id === null) K.fail(400, `${anchor.raw} is not an item key`);
  return { ...anchor, id };
}

export function sawLane(lanes, row, from) {
  const named = laneOf(lanes, from);
  return named ? named.id === row.label_id : sameFolded(row.label_name, from);
}

export async function moveByLane(c, body) {
  if (body.key.length > MAX_KEY_CHARS) K.fail(400, "key must be an item key");
  const id = K.parseKey(body.key);
  if (id === null) K.fail(404, `no item ${body.key}`);
  const anchor = anchorOf(body);
  const v = boardView(c);
  const { DB } = c.env;
  const one = await cardsBoard(c);
  if (!one || one.lanes.length !== LANES.length) K.fail(409, "this space's board has no seven lanes yet; run p99 deploy");
  const target = laneOf(one.lanes, body.to);
  if (!target && namedBy(one.lanes, body.to, (l) => l.name).length > 1) K.fail(400, `${body.to} names more than one lane; give its exact name`);
  if (!target) K.fail(400, `${body.to} is not a lane; give ${LANES.join(", ")} or a lane's name`);
  const row = await DB.prepare(
    `SELECT i.*, ${LABEL_COLUMNS}, (SELECT username FROM people WHERE email = i.assignee) AS assignee_username,
       (SELECT key FROM board_positions WHERE board_id = ?2 AND item_id = i.id AND label_id = i.label_id) AS seen_key
     FROM items i ${LABEL_JOIN} WHERE i.id = ?1`,
  )
    .bind(id, one.board)
    .first();
  if (!row || !inView(v, row)) K.fail(404, `no item ${body.key}`);
  if (!sawLane(one.lanes, row, body.from)) K.fail(409, MOVED, "moved");
  const to = { id: target.id, name: target.name, role: target.role, closes: target.closes };
  const resolution = body.resolution ?? null;
  if (resolution !== null && (!RESOLUTIONS.includes(resolution) || !to.closes)) K.fail(400, "a resolution goes with a label that closes");
  if (resolution === "duplicate" && row.duplicate_of === null) K.fail(400, "a duplicate needs duplicate_of; set it with p99 merge");
  const plan = labelChangeStatements(c, row, to, { resolution: resolution ?? undefined, seen: { board: one.board, key: row.seen_key ?? null } });
  let place = null;
  if (anchor !== null || (row.label_id !== to.id && !to.closes)) {
    const { results } = await DB.prepare(LANE_ROWS).bind(one.board, to.id).all();
    if (anchor !== null && !results.some((r) => r.id === anchor.id && r.id !== row.id && inView(v, r))) {
      K.fail(400, `${anchor.raw} is not in that lane`);
    }
    place = placeIn(results, row.id, anchor, anchor?.id ?? null);
  }
  const statements = [...plan.statements];
  if (place) {
    statements.push(
      DB.prepare(
        `INSERT INTO board_positions (board_id, item_id, label_id, key)
         SELECT ?1, json_extract(j.value, '$.id'), ?2, json_extract(j.value, '$.key') FROM json_each(?3) j
         WHERE changes() > 0
         ON CONFLICT (board_id, item_id) DO UPDATE SET label_id = excluded.label_id, key = excluded.key`,
      ).bind(one.board, to.id, JSON.stringify(place.rows)),
    );
  }
  const results = await DB.batch(statements);
  if (!results[0].meta.changes) K.fail(409, MOVED, "moved");
  plan.after();
  const key = K.keyOf(row.kind, row.id);
  if (place) pushOf(c, { type: "order", board: one.board, key, order: place.key, host: row.host, projects: row.project_id === null || row.project_id === undefined ? [] : [row.project_id], ...(place.rows.length > 1 ? { rebalanced: true } : {}) });
  return K.json(200, {
    card: {
      key,
      kind: row.kind,
      title: row.title,
      label: to.name,
      assignee: row.assignee ? { username: row.assignee_username ?? null } : null,
      order: place ? place.key : null,
    },
  });
}

export const ONE_BOARD_ROUTES = [
  ["GET", /^\/board$/, getOneBoard],
  ["GET", /^\/boards$/, goneBoards],
  ["POST", /^\/boards$/, goneBoards],
  ["GET", /^\/boards\/([^/]+)$/, goneBoards],
  ["PUT", /^\/boards\/([^/]+)$/, goneBoards],
  ["DELETE", /^\/boards\/([^/]+)$/, goneBoards],
];

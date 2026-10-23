import { K, LANES, LANE_NAMES, MAX_NOTE_CHARS, MAX_REF_CHARS, PERSON_CLOSES, laneIndex, notCard, personOf, projectName, refuseAgentUncard } from "./cards.js";
import { loadCard } from "./cards-read.js";
import { MOVED, labelChangeStatements, placeIn } from "./boards.js";

export const CARDS_BOARD = "Cards";
const LANE_COLORS = ["#539bf5", "#986ee2", "#c69026", "#e0823d", "#e5534b", "#39a5a0"];
const UID_RULE = "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores";
const STATUS_RULE = `status must be ${LANES.slice(0, -1).join(", ")} or ${LANES.at(-1)}`;
const REF_RULE = `a link has 1 to ${MAX_REF_CHARS} characters`;
const NOTE_RULE = `a note has at most ${MAX_NOTE_CHARS} characters`;
const LANES_SQL = `SELECT b.id AS board, l.id, l.name, l.role, l.closes FROM boards b
  JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id
  WHERE b.cards = 1 ORDER BY bc.position`;
const AUTHOR = "(SELECT username FROM people WHERE email = cm.author_email) AS author_username";

export function lanesStatement(c) {
  return c.env.DB.prepare(LANES_SQL);
}

export function lanesOf(results) {
  if (results.length === 0) return null;
  return { board: results[0].board, lanes: results.map((r) => ({ id: r.id, name: r.name, role: r.role ?? null, closes: r.closes })) };
}

export async function cardsBoard(c) {
  const { DB } = c.env;
  const found = lanesOf((await DB.prepare(LANES_SQL).all()).results);
  if (found) return found;
  const fresh = JSON.stringify(LANE_NAMES.slice(0, -1).map((name, i) => ({ name, color: LANE_COLORS[i] })));
  const results = await DB.batch([
    DB.prepare(
      `INSERT INTO labels (name, color, created_at)
       SELECT json_extract(value, '$.name'), json_extract(value, '$.color'), ?2 FROM json_each(?1) WHERE true
       ON CONFLICT (name) DO NOTHING`,
    ).bind(fresh, c.now),
    DB.prepare(
      `INSERT OR IGNORE INTO boards (name, host, owner, created_at, updated_at, cards)
       SELECT ?1, NULL, ?2, ?3, ?3, 1 WHERE NOT EXISTS (SELECT 1 FROM boards WHERE cards = 1)`,
    ).bind(CARDS_BOARD, c.actor.email, c.now),
    DB.prepare(
      `INSERT OR IGNORE INTO board_columns (board_id, label_id, position)
       SELECT b.id, l.id, COALESCE(j.key, ?2) FROM boards b JOIN labels l LEFT JOIN json_each(?1) j ON l.name = j.value
       WHERE b.cards = 1 AND (j.key IS NOT NULL OR l.role = 'done')
         AND NOT EXISTS (SELECT 1 FROM board_columns bc WHERE bc.board_id = b.id)`,
    ).bind(JSON.stringify(LANE_NAMES.slice(0, -1)), LANES.length - 1),
    DB.prepare(LANES_SQL),
  ]);
  return lanesOf(results[3].results);
}

function laneAt(lanes, index) {
  const lane = lanes.lanes[index];
  if (!lane) K.fail(409, `the Cards board has no ${LANES[index]} lane`);
  return lane;
}

export async function topOf(c, board, labelId, selfId) {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, bp.key FROM items i
     LEFT JOIN board_positions bp ON bp.board_id = ?1 AND bp.item_id = i.id AND bp.label_id = i.label_id
     WHERE i.label_id = ?2
     ORDER BY bp.key IS NOT NULL, bp.key, i.id DESC`,
  )
    .bind(board, labelId)
    .all();
  return placeIn(results, selfId, null, null);
}

export function placeStatement(c, board, labelId, place, uid, won = false) {
  return c.env.DB.prepare(
    `INSERT INTO board_positions (board_id, item_id, label_id, key)
     SELECT ?1, COALESCE(NULLIF(json_extract(j.value, '$.id'), 0), (SELECT id FROM items WHERE client_uid = ?4)), ?2, json_extract(j.value, '$.key')
     FROM json_each(?3) j WHERE CASE WHEN ?5 THEN changes() > 0 ELSE (SELECT label_id FROM items WHERE client_uid = ?4) = ?2 END
     ON CONFLICT (board_id, item_id) DO UPDATE SET label_id = excluded.label_id, key = excluded.key`,
  ).bind(board, labelId, JSON.stringify(place.rows), uid, won ? 1 : 0);
}

function viaOf(c) {
  return c.actor && c.actor.agent ? (c.actor.via ?? null) : null;
}

function agentOf(c) {
  return c.actor && c.actor.agent ? 1 : 0;
}

function eventStatement(c, itemId, kind, detail, internal) {
  return c.env.DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(itemId, c.actor.email, kind, JSON.stringify(detail), internal ? 1 : 0, c.now, agentOf(c), viaOf(c));
}

function projectEvent(c, itemId, detail) {
  return c.env.DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
     SELECT ?1, ?2, 'project', ?3, 1, ?4, ?5, ?6 WHERE changes() > 0`,
  ).bind(itemId, c.actor.email, JSON.stringify(detail), c.now, agentOf(c), viaOf(c));
}

function projectStatement(c, itemId, from, name) {
  return c.env.DB.prepare("UPDATE items SET project = ?3, updated_at = ?4, activity_at = ?4 WHERE id = ?1 AND project IS ?2").bind(itemId, from, name, c.now);
}

function usernameStatement(c) {
  return c.env.DB.prepare("SELECT username FROM people WHERE email = ?1").bind(c.actor.email);
}

function commentJson(row) {
  return {
    id: row.id,
    author: personOf(row.author_name, row.author_username, row.author_agent, row.author_via),
    body: row.body,
    internal: Boolean(row.internal),
    created_at: row.created_at,
  };
}

async function commentByUid(c, uid) {
  return await c.env.DB.prepare(`SELECT cm.*, ${AUTHOR} FROM comments cm WHERE cm.client_uid = ?1`).bind(uid).first();
}

function shownKey(rawKey) {
  let text = String(rawKey);
  try {
    text = decodeURIComponent(text);
  } catch {}
  return [...K.clean(text).trim()].slice(0, 40).join("");
}

async function itemRow(c, rawKey) {
  try {
    return await K.loadItem(c, rawKey);
  } catch (error) {
    if (error && error.status === 404) K.fail(404, `no item ${shownKey(rawKey)}`);
    throw error;
  }
}

async function cardRow(c, rawKey) {
  K.requireManager(c);
  const row = await itemRow(c, rawKey);
  if (row.project === null || row.project === undefined) K.fail(409, notCard(K.keyOf(row.kind, row.id)));
  return row;
}

async function spelling(c, name) {
  const used = await c.env.DB.prepare("SELECT project FROM items WHERE project = ?1 ORDER BY id LIMIT 1").bind(name).first();
  return used ? used.project : name;
}

function targetHost(c, body) {
  if (c.browser) return { host: c.hostRow.host, env: c.hostRow.env };
  const name = c.scope.all ? body.host : c.scope.host;
  const host = typeof name === "string" ? c.dir.hosts.get(name) : null;
  if (!host) K.fail(400, "host must name a listed host");
  return { host: host.host, env: host.env };
}

function noteOf(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") K.fail(400, `note must be text; ${NOTE_RULE}`);
  const text = K.clean(raw).trim();
  if (text.length === 0) return null;
  return text;
}

export function refuseAgentClose(c, row, to) {
  if (c.actor && c.actor.agent && row && row.project !== null && row.project !== undefined && to && to.closes) K.fail(403, PERSON_CLOSES);
  return to;
}

export async function postCard(c) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  if (!K.isUid(body.client_uid)) K.fail(400, UID_RULE);
  const { DB } = c.env;
  const replay = async (id) => K.json(200, { card: await loadCard(c, String(id)) });
  const existing = await DB.prepare("SELECT id, reporter_email, project FROM items WHERE client_uid = ?1").bind(body.client_uid).first();
  if (existing) {
    if (existing.reporter_email !== c.actor.email || existing.project === null) K.fail(409, "client_uid is already used");
    return replay(existing.id);
  }
  const project = await spelling(c, projectName(body.project));
  const kind = body.kind === undefined || body.kind === null ? "feature" : body.kind;
  if (typeof kind !== "string" || !Object.hasOwn(K.KIND_PREFIXES, kind)) K.fail(400, "kind must be bug, feature, improvement, question or task");
  const title = K.validTitle(body.title);
  if (title === null) K.fail(400, `title must be 1 to ${K.MAX_TITLE_CHARS} characters`);
  const text = K.clean(body.body ?? "");
  if (!K.isChars(text, 0, K.MAX_BODY_CHARS)) K.fail(400, `body must be at most ${K.MAX_BODY_CHARS} characters`);
  const target = targetHost(c, body);
  const lanes = await cardsBoard(c);
  const lane = { ...laneAt(lanes, 0), closes: 0 };
  const place = await topOf(c, lanes.board, lane.id, 0);
  const uid = body.client_uid;
  const byUid = "FROM items WHERE client_uid = ?1";
  const reporter = JSON.stringify({ email: c.actor.email, name: c.actor.name, agent: Boolean(c.actor.agent) });
  let results;
  try {
    results = await DB.batch([
      DB.prepare(
        `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, page_url, page_path, page_title,
           reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at,
           created_at, updated_at, host, reporter_agent, search_text, project, reporter_via)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, '/', ?4, ?8, ?9, ?10, '{}', '[]', ?11, ?11, ?11, ?11, ?12, ?13, ?14, ?15, ?16)
         RETURNING id`,
      ).bind(
        uid,
        kind,
        lane.id,
        title,
        text,
        target.env,
        `https://${target.host}/`,
        c.actor.email,
        c.actor.name,
        reporter,
        c.now,
        target.host,
        agentOf(c),
        K.searchText(title, text),
        project,
        viaOf(c),
      ),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT id, ?2, 'created', ?3, 0, ?4, ?5, ?6 ${byUid}`,
      ).bind(uid, c.actor.email, JSON.stringify({ kind, title }), c.now, agentOf(c), viaOf(c)),
      DB.prepare(
        `INSERT INTO reads (actor_email, item_id, read_at) SELECT ?2, id, ?3 ${byUid}
         ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at`,
      ).bind(uid, c.actor.email, c.now),
      placeStatement(c, lanes.board, lane.id, place, uid),
    ]);
  } catch (error) {
    if (!K.isUniqueViolation(error)) throw error;
    const raced = await DB.prepare(`SELECT id, reporter_email, project ${byUid}`).bind(uid).first();
    if (!raced || raced.reporter_email !== c.actor.email || raced.project === null) K.fail(409, "client_uid is already used");
    return replay(raced.id);
  }
  const id = results[0].results[0].id;
  K.push(c, "item", { id, kind, host: target.host, title }, { label: lane.name, project });
  return K.json(201, { card: await loadCard(c, String(id)) });
}

export async function postCardStatus(c, rawKey) {
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const row = await cardRow(c, rawKey);
  const index = typeof body.status === "string" ? laneIndex(body.status) : -1;
  if (index < 0) K.fail(400, STATUS_RULE);
  const note = noteOf(body.note);
  if (note !== null && !K.isChars(note, 0, K.MAX_BODY_CHARS)) K.fail(400, `note must be at most ${K.MAX_BODY_CHARS} characters`);
  if (note !== null && !K.isUid(body.client_uid)) K.fail(400, UID_RULE);
  const closing = index === LANES.length - 1;
  if (closing) refuseAgentClose(c, row, { closes: 1 });
  const key = K.keyOf(row.kind, row.id);
  const { DB } = c.env;
  if (note !== null) {
    const seen = await commentByUid(c, body.client_uid);
    if (seen) {
      if (seen.author_email !== c.actor.email || seen.item_id !== row.id) K.fail(409, "client_uid is already used");
      return K.json(200, { card: await loadCard(c, key), comment: commentJson(seen) });
    }
  }
  const lanes = await cardsBoard(c);
  const to = { ...laneAt(lanes, index), closes: closing ? 1 : 0 };
  const moving = row.label_id !== to.id || Boolean(row.open) === closing;
  const plan = moving ? labelChangeStatements(c, row, to, closing ? { resolution: "fixed" } : {}) : null;
  const statements = plan ? [...plan.statements] : [];
  let place = null;
  if (row.label_id !== to.id && !closing) {
    place = await topOf(c, lanes.board, to.id, row.id);
    statements.push(placeStatement(c, lanes.board, to.id, place, row.client_uid, true));
  }
  if (note !== null) {
    statements.push(
      DB.prepare(
        `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal,
           origin_env, created_at, author_agent, author_via)
         SELECT ?1, ?2, ?3, ?4, 1, ?5, 0, ?6, ?7, ?8, ?9 WHERE CASE WHEN ?11 THEN changes() > 0 ELSE (SELECT label_id FROM items WHERE id = ?1) = ?10 END`,
      ).bind(row.id, body.client_uid, c.actor.email, c.actor.name, note, c.actionEnv ?? row.origin_env, c.now, agentOf(c), viaOf(c), to.id, plan ? 1 : 0),
      DB.prepare(
        `UPDATE items SET comment_count = comment_count + 1, public_comment_count = public_comment_count + 1,
           activity_at = ?2, updated_at = ?2, public_activity_at = ?2
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM comments WHERE client_uid = ?3 AND item_id = ?1)`,
      ).bind(row.id, c.now, body.client_uid),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT ?1, ?2, 'comment', json_object('comment_id', id, 'internal', json('false')), 0, ?3, ?5, ?6
         FROM comments WHERE client_uid = ?4 AND item_id = ?1`,
      ).bind(row.id, c.actor.email, c.now, body.client_uid, agentOf(c), viaOf(c)),
      K.readStatement(c, row.id),
    );
  }
  if (statements.length > 0) {
    let results;
    try {
      results = await DB.batch(statements);
    } catch (error) {
      if (!K.isUniqueViolation(error)) throw error;
      K.fail(409, "client_uid is already used");
    }
    if (moving && !results[0].meta.changes) K.fail(409, "this card moved; refreshed", "moved");
  }
  if (plan) plan.after();
  if (place) K.push(c, "order", row, { board: lanes.board, order: place.key, ...(place.rows.length > 1 ? { rebalanced: true } : {}) });
  const answer = { card: await loadCard(c, key) };
  if (note !== null) {
    K.push(c, "comment", row, { internal: false });
    answer.comment = commentJson(await commentByUid(c, body.client_uid));
  }
  return K.json(200, answer);
}

export async function postCardLink(c, rawKey) {
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const row = await cardRow(c, rawKey);
  const ref = typeof body.ref === "string" ? K.clean(body.ref).trim() : "";
  if (ref.length < 1 || [...ref].length > MAX_REF_CHARS) K.fail(400, REF_RULE);
  const note = noteOf(body.note);
  if (note !== null && [...note].length > MAX_NOTE_CHARS) K.fail(400, NOTE_RULE);
  const { DB } = c.env;
  const results = await DB.batch([
    eventStatement(c, row.id, "link", { ref, note }, true),
    DB.prepare("UPDATE items SET updated_at = ?2, activity_at = ?2 WHERE id = ?1").bind(row.id, c.now),
    K.readStatement(c, row.id),
    usernameStatement(c),
  ]);
  const username = results[3].results[0]?.username ?? null;
  K.push(c, "change", row, { what: ["link"] });
  return K.json(201, {
    key: K.keyOf(row.kind, row.id),
    link: { ref, note, by: personOf(c.actor.name, username, c.actor.agent, viaOf(c)), at: c.now },
  });
}

export async function postCardComment(c, rawKey) {
  const row = await cardRow(c, rawKey);
  const answer = await K.postComment(c, rawKey);
  const made = await answer.json();
  const stored = await commentByUid(c, made.client_uid);
  return K.json(answer.status, { key: K.keyOf(row.kind, row.id), comment: commentJson(stored) });
}

export async function patchProject(c, row, body) {
  K.requireManager(c);
  if (Object.keys(body).some((field) => field !== "project")) K.fail(400, "project is changed on its own");
  refuseAgentUncard(c, row, body);
  const from = row.project ?? null;
  const name = body.project === null ? null : await spelling(c, projectName(body.project));
  const answer = async () => (name === null ? K.issueResponse(c, row.id, 200) : K.json(200, { card: await loadCard(c, K.keyOf(row.kind, row.id)) }));
  if (from === name) return answer();
  const { DB } = c.env;
  const results = await DB.batch([projectStatement(c, row.id, from, name), projectEvent(c, row.id, { from, to: name }), K.readStatement(c, row.id)]);
  if (!results[0].meta.changes) K.fail(409, MOVED, "moved");
  K.push(c, "change", row, { what: ["project"] });
  return answer();
}

export const CARD_WRITES = [
  ["POST", /^\/cards$/, postCard],
  ["POST", /^\/cards\/([^/]+)\/status$/, postCardStatus],
  ["POST", /^\/cards\/([^/]+)\/links$/, postCardLink],
  ["POST", /^\/cards\/([^/]+)\/comments$/, postCardComment],
];

import { noteHook } from "./hooks.js";
import { boardLabelsStatement, labelRowsStatement, labelsByItem } from "./labels.js";
import { assigneeColumn, assigneeOf } from "./people.js";

export const STATUSES = ["inbox", "doing", "review", "done"];
export const OPEN_STATUSES = new Set(["inbox", "doing", "review"]);
export const RESOLUTIONS = ["fixed", "abandoned", "duplicate"];
export const LEGACY_STATUSES = {
  new: ["inbox", null],
  confirmed: ["doing", null],
  in_progress: ["doing", null],
  waiting: ["review", null],
  resolved: ["done", "fixed"],
  abandoned: ["done", "abandoned"],
  duplicate: ["done", "duplicate"],
};

const GAP = 1024;
const MIN_GAP = 1e-9;
const MAX_NAME_CHARS = 100;
const MAX_STATUS_NAME_CHARS = 40;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TICKET_TTL_MS = 60 * 1000;
const TICKET = /^[0-9a-f]{48}$/;
const ITEM_COLUMNS = `i.id, i.kind, i.title, i.host, i.status, i.resolution, i.open, i.board_id, i.position, i.duplicate_of,
  i.assignee, i.reporter_email, i.reporter_name, i.reporter_agent, i.origin_env, i.page_path, i.closed_at, i.priority,
  ${assigneeColumn()}`;

let K = null;

export function useKit(kit) {
  K = kit;
}

export function statusOf(raw, resolution) {
  if (typeof raw !== "string") return null;
  if (resolution !== undefined && resolution !== null && !RESOLUTIONS.includes(resolution)) return null;
  if (STATUSES.includes(raw)) return { status: raw, resolution: resolution ?? null };
  const legacy = LEGACY_STATUSES[raw];
  if (!legacy) return null;
  return { status: legacy[0], resolution: resolution ?? legacy[1] };
}

export function topOf(board, status) {
  return `(SELECT COALESCE(min(p), ${GAP}) - ${GAP} FROM (
    SELECT min(x.position) AS p FROM items x WHERE x.board_id = ${board} AND x.status = ${status}
    UNION ALL SELECT min(y.position) FROM boards y WHERE y.parent_id = ${board} AND y.status = ${status}))`;
}

export function homeSlug(host) {
  return host.replace(/\./g, "-");
}

export function homeStatement(DB, host, now) {
  return DB.prepare(
    `INSERT INTO boards (slug, name, host, home, created_at, updated_at)
     SELECT CASE WHEN EXISTS (SELECT 1 FROM boards WHERE slug = ?2) THEN ?2 || '-' || lower(hex(randomblob(3))) ELSE ?2 END,
       ?1, ?1, 1, ?3, ?3
     WHERE NOT EXISTS (SELECT 1 FROM boards WHERE host = ?1 AND home = 1)
     ON CONFLICT DO NOTHING`,
  ).bind(host, homeSlug(host), now);
}

export function boardView(c) {
  if (!c.browser) return c.scope;
  const hosts = c.code ? c.code.hosts : [];
  const every = c.dir.hosts.size > 0 && [...c.dir.hosts.keys()].every((h) => hosts.includes(h));
  return every ? { all: true, host: null } : { all: false, host: c.scope.host };
}

function sees(v, host) {
  return v.all || host === v.host;
}

function statusesOf(rows) {
  return rows.map((r) => ({ key: r.key, name: r.name, position: r.position }));
}

async function loadStatuses(DB) {
  return statusesOf((await DB.prepare("SELECT key, name, position FROM statuses ORDER BY position").all()).results);
}

function resolveStatus(statuses, raw) {
  if (typeof raw !== "string") K.fail(400, "a status is its key or its name");
  const text = raw.trim();
  if (STATUSES.includes(text)) return text;
  const legacy = LEGACY_STATUSES[text];
  if (legacy) return legacy[0];
  const lower = text.toLowerCase();
  const found = statuses.find((s) => s.key === lower || s.name.toLowerCase() === lower);
  if (!found) K.fail(400, `no status is called ${text}; the statuses are ${statuses.map((s) => s.name).join(", ")}`);
  return found.key;
}

async function loadTree(c, v, extra = []) {
  const { DB } = c.env;
  const binds = v.all ? [] : [v.host];
  const results = await DB.batch([
    DB.prepare(`SELECT * FROM boards ${v.all ? "" : "WHERE host = ?1"} ORDER BY id`).bind(...binds),
    DB.prepare(
      `SELECT board_id, count(*) AS total, sum(status = 'done') AS done FROM items
       ${v.all ? "" : "WHERE board_id IN (SELECT id FROM boards WHERE host = ?1)"} GROUP BY board_id`,
    ).bind(...binds),
    DB.prepare("SELECT key, name, position FROM statuses ORDER BY position"),
    ...extra,
  ]);
  const boards = results[0].results;
  const byId = new Map(boards.map((b) => [b.id, b]));
  const bySlug = new Map(boards.map((b) => [b.slug, b]));
  const kids = new Map();
  for (const b of boards) {
    if (b.parent_id === null || !byId.has(b.parent_id)) continue;
    if (!kids.has(b.parent_id)) kids.set(b.parent_id, []);
    kids.get(b.parent_id).push(b.id);
  }
  const own = new Map(results[1].results.map((r) => [r.board_id, { done: r.done || 0, total: r.total || 0 }]));
  const sums = new Map();
  const subtree = (id) => {
    const out = [];
    const seen = new Set();
    const walk = (at) => {
      if (seen.has(at)) return;
      seen.add(at);
      out.push(at);
      for (const kid of kids.get(at) || []) walk(kid);
    };
    walk(id);
    return out;
  };
  const rollup = (id) => {
    if (!sums.has(id)) {
      const total = { done: 0, total: 0 };
      for (const at of subtree(id)) {
        const n = own.get(at);
        if (n) {
          total.done += n.done;
          total.total += n.total;
        }
      }
      sums.set(id, total);
    }
    return sums.get(id);
  };
  return { boards, byId, bySlug, kids, rollup, subtree, statuses: statusesOf(results[2].results), extra: results.slice(3) };
}

function boardOf(tree, b) {
  const parent = b.parent_id === null ? null : tree.byId.get(b.parent_id);
  return {
    slug: b.slug,
    name: b.name,
    host: b.host,
    parent: parent ? parent.slug : null,
    status: b.status,
    position: b.position,
    home: Boolean(b.home),
    rollup: tree.rollup(b.id),
  };
}

function boardCard(tree, b) {
  return { type: "board", slug: b.slug, name: b.name, status: b.status, position: b.position, rollup: tree.rollup(b.id) };
}

function itemCard(row) {
  return {
    type: "item",
    key: K.keyOf(row.kind, row.id),
    kind: row.kind,
    title: row.title,
    status: row.status,
    resolution: row.resolution ?? null,
    position: row.position,
    assignee: assigneeOf(row),
    reporter: { name: row.reporter_name ?? null, agent: Boolean(row.reporter_agent) },
    priority: row.priority ?? null,
    labels: Array.isArray(row.labels) ? row.labels : [],
  };
}

function slugParam(raw) {
  let slug;
  try {
    slug = decodeURIComponent(String(raw));
  } catch {
    K.fail(404, "no such board");
  }
  if (!SLUG.test(slug)) K.fail(404, "no such board");
  return slug;
}

function boardIn(tree, slug) {
  const b = tree.bySlug.get(slug);
  if (!b) K.fail(404, `no board is called ${slug}`);
  return b;
}

function validName(value, max) {
  const name = typeof value === "string" ? K.clean(value).replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > max) K.fail(400, `name must be 1 to ${max} characters`);
  return name;
}

function slugify(name) {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return base || "board";
}

function pushOf(c, event) {
  const full = { by: c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent) } : null, at: c.now, ...event };
  noteHook(c, full);
  if (c.env.HUB) c.pushes.push(full);
}

export async function getStatuses(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  return K.json(200, { statuses: await loadStatuses(c.env.DB) });
}

export async function putStatus(c, rawKey) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const key = String(rawKey);
  if (!STATUSES.includes(key)) K.fail(404, `no such status; the keys are ${STATUSES.join(", ")}`);
  const name = validName(body.name, MAX_STATUS_NAME_CHARS);
  const statuses = await loadStatuses(c.env.DB);
  const lower = name.toLowerCase();
  if (statuses.some((s) => s.key !== key && (s.name.toLowerCase() === lower || s.key === lower))) {
    K.fail(409, `another status is already called ${name}`);
  }
  await c.env.DB.prepare("UPDATE statuses SET name = ?2 WHERE key = ?1").bind(key, name).run();
  pushOf(c, { type: "statuses", host: null });
  return K.json(200, { statuses: statuses.map((s) => (s.key === key ? { ...s, name } : s)) });
}

export async function getBoards(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const tree = await loadTree(c, boardView(c));
  return K.json(200, { statuses: tree.statuses, boards: tree.boards.map((b) => boardOf(tree, b)) });
}

function cardOrder(statuses) {
  const rank = new Map(statuses.map((s) => [s.key, s.position]));
  return (a, b) => (rank.get(a.status) ?? 99) - (rank.get(b.status) ?? 99) || a.position - b.position;
}

export async function getBoard(c, rawSlug) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const v = boardView(c);
  const slug = slugParam(rawSlug);
  const { DB } = c.env;
  const tree = await loadTree(c, v, [
    DB.prepare(
      `SELECT ${ITEM_COLUMNS} FROM items i WHERE i.board_id = (SELECT id FROM boards WHERE slug = ?1) AND (?2 OR i.host = ?3)`,
    ).bind(slug, v.all ? 1 : 0, v.host),
    boardLabelsStatement(DB, slug),
  ]);
  const board = boardIn(tree, slug);
  const labels = labelsByItem(tree.extra[1]);
  const cards = [
    ...tree.extra[0].results.map((row) => itemCard({ ...row, labels: labels.get(row.id) })),
    ...(tree.kids.get(board.id) || []).map((id) => boardCard(tree, tree.byId.get(id))),
  ].sort(cardOrder(tree.statuses));
  return K.json(200, { statuses: tree.statuses, board: boardOf(tree, board), cards });
}

async function freeSlug(DB, base) {
  const { results } = await DB.prepare("SELECT slug FROM boards WHERE slug = ?1 OR slug LIKE ?2")
    .bind(base, `${base}-%`)
    .all();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

function topStatement(DB, parentId, status) {
  if (parentId === null) return DB.prepare(`SELECT COALESCE(min(position), ${GAP}) - ${GAP} AS p FROM boards WHERE parent_id IS NULL`);
  return DB.prepare(`SELECT ${topOf("?1", "?2")} AS p`).bind(parentId, status);
}

export async function postBoard(c) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const v = boardView(c);
  const tree = await loadTree(c, v);
  const name = validName(body.name, MAX_NAME_CHARS);
  const parent = body.parent === undefined || body.parent === null ? null : boardIn(tree, String(body.parent));
  let host;
  if (body.host !== undefined && body.host !== null) {
    host = String(body.host).toLowerCase();
    if (!c.dir.hosts.has(host)) K.fail(400, `${host} is not a listed host`);
    if (!sees(v, host)) K.fail(403, `this key or code does not reach ${host}`);
  } else {
    host = parent ? parent.host : v.all ? null : v.host;
  }
  if (parent && parent.host !== null && parent.host !== host) K.fail(400, `a board inside ${parent.slug} belongs to ${parent.host}`);
  const status = body.status === undefined || body.status === null ? "inbox" : resolveStatus(tree.statuses, body.status);
  let slug;
  if (body.slug !== undefined && body.slug !== null) {
    slug = String(body.slug);
    if (!SLUG.test(slug)) K.fail(400, "slug must be 1 to 64 lowercase letters, digits or dashes, starting and ending with a letter or digit");
  }
  const { DB } = c.env;
  const top = (await topStatement(DB, parent ? parent.id : null, status).first()).p;
  for (let attempt = 0; attempt < 3; attempt++) {
    const chosen = slug ?? (await freeSlug(DB, slugify(name)));
    try {
      const row = await DB.prepare(
        `INSERT INTO boards (slug, name, host, parent_id, status, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) RETURNING *`,
      )
        .bind(chosen, name, host, parent ? parent.id : null, status, top, c.now)
        .first();
      tree.byId.set(row.id, row);
      pushOf(c, { type: "board", action: "created", board: row.slug, host: row.host });
      return K.json(201, boardOf(tree, row));
    } catch (error) {
      if (!K.isUniqueViolation(error)) throw error;
      if (slug !== undefined) K.fail(409, `a board is already called ${slug}`);
    }
  }
  K.fail(409, "the board's slug was taken meanwhile; try again");
}

export async function patchBoard(c, rawSlug) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const tree = await loadTree(c, boardView(c));
  const board = boardIn(tree, slugParam(rawSlug));
  if (body.name === undefined) return K.json(200, boardOf(tree, board));
  const name = validName(body.name, MAX_NAME_CHARS);
  if (name !== board.name) {
    await c.env.DB.prepare("UPDATE boards SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(board.id, name, c.now).run();
    board.name = name;
    pushOf(c, { type: "board", action: "renamed", board: board.slug, host: board.host });
  }
  return K.json(200, boardOf(tree, board));
}

export async function deleteBoard(c, rawSlug) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const tree = await loadTree(c, boardView(c));
  const board = boardIn(tree, slugParam(rawSlug));
  if (board.home) K.fail(409, `${board.slug} is the home board of ${board.host}, where its new items land; it stays`);
  const { meta } = await c.env.DB.prepare(
    `DELETE FROM boards WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM items WHERE board_id = ?1)
       AND NOT EXISTS (SELECT 1 FROM boards WHERE parent_id = ?1)`,
  )
    .bind(board.id)
    .run();
  if (!meta.changes) K.fail(409, `${board.slug} still holds items or boards; move them out first`);
  pushOf(c, { type: "board", action: "deleted", board: board.slug, host: board.host });
  return new Response(null, { status: 204 });
}

function columnStatement(DB, parentId, status) {
  if (parentId === null) {
    return DB.prepare("SELECT 'board' AS type, id, position FROM boards WHERE parent_id IS NULL ORDER BY position, id");
  }
  return DB.prepare(
    `SELECT 'item' AS type, id, position FROM items WHERE board_id = ?1 AND status = ?2
     UNION ALL SELECT 'board' AS type, id, position FROM boards WHERE parent_id = ?1 AND status = ?2
     ORDER BY position, id`,
  ).bind(parentId, status);
}

async function placement(c, parentId, status, self, anchor, side) {
  const { DB } = c.env;
  if (!anchor) return { position: (await topStatement(DB, parentId, status).first()).p, renumber: [] };
  const column = (await columnStatement(DB, parentId, status).all()).results.filter(
    (r) => !(r.type === self.type && r.id === self.id),
  );
  const at = column.findIndex((r) => r.type === anchor.type && r.id === anchor.id);
  if (at < 0) K.fail(400, "the card to place against is not in that column");
  const neighbour = side === "before" ? column[at - 1] : column[at + 1];
  const edge = column[at].position;
  if (!neighbour) return { position: side === "before" ? edge - GAP : edge + GAP, renumber: [] };
  if (Math.abs(neighbour.position - edge) >= MIN_GAP * 2) return { position: (neighbour.position + edge) / 2, renumber: [] };
  const slot = side === "before" ? at : at + 1;
  const ordered = [...column.slice(0, slot), self, ...column.slice(slot)];
  const spread = ordered.map((r, i) => ({ ...r, position: (i + 1) * GAP }));
  const moved = spread[slot].position;
  const list = (type) => JSON.stringify(spread.filter((r) => r.type === type && !(r === spread[slot])).map((r) => [r.id, r.position]));
  const renumber = [
    DB.prepare(
      `UPDATE items SET position = json_extract(j.value, '$[1]') FROM json_each(?1) j WHERE items.id = json_extract(j.value, '$[0]')`,
    ).bind(list("item")),
    DB.prepare(
      `UPDATE boards SET position = json_extract(j.value, '$[1]') FROM json_each(?1) j WHERE boards.id = json_extract(j.value, '$[0]')`,
    ).bind(list("board")),
  ];
  return { position: moved, renumber };
}

async function findCard(c, v, raw, what = "target") {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 80) K.fail(400, `${what} must be an item key or board:<slug>`);
  const { DB } = c.env;
  if (raw.startsWith("board:")) {
    const slug = raw.slice("board:".length);
    if (!SLUG.test(slug)) K.fail(404, `no board is called ${slug}`);
    const b = await DB.prepare("SELECT * FROM boards WHERE slug = ?1").bind(slug).first();
    if (!b || !sees(v, b.host)) K.fail(404, `no board is called ${slug}`);
    return { type: "board", id: b.id, row: b };
  }
  const id = K.parseKey(raw);
  if (id === null) K.fail(400, `${what} must be an item key or board:<slug>`);
  const row = await DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = ?1`).bind(id).first();
  if (!row || !sees(v, row.host)) K.fail(404, `no item ${raw}`);
  return { type: "item", id: row.id, row };
}

function anchorOf(opts) {
  const before = opts.before ?? null;
  const after = opts.after ?? null;
  if (before !== null && after !== null) K.fail(400, "give before or after, not both");
  if (before !== null) return { side: "before", raw: before };
  if (after !== null) return { side: "after", raw: after };
  return null;
}

function anchorStatus(anchor) {
  return anchor.row.status;
}

function itemMail(c, row, status, resolution) {
  if (!c.actor || !row.reporter_email) return;
  K.sendMail(c, row, K.REPORTERS_TOKEN, {
    template: "status",
    status,
    resolution,
    ...(row.merged_into && resolution === "duplicate" ? { merged_into: row.merged_into } : {}),
    ref: `status-${c.now}`,
  });
}

export async function moveItem(c, row, opts = {}) {
  const v = boardView(c);
  const { DB } = c.env;
  const current = await DB.prepare("SELECT * FROM boards WHERE id = ?1").bind(row.board_id).first();
  let board = current;
  if (opts.board !== undefined && opts.board !== null) {
    const slug = String(opts.board);
    board = SLUG.test(slug) ? await DB.prepare("SELECT * FROM boards WHERE slug = ?1").bind(slug).first() : null;
    if (!board || !sees(v, board.host)) K.fail(404, `no board is called ${slug}`);
    if (board.host !== null && board.host !== row.host) K.fail(400, `${K.keyOf(row.kind, row.id)} belongs to ${row.host}; ${board.slug} holds ${board.host}'s items`);
  }
  const anchor = anchorOf(opts);
  let target = null;
  if (anchor) {
    target = await findCard(c, v, String(anchor.raw), anchor.side);
    const inBoard = target.type === "item" ? target.row.board_id === board.id : target.row.parent_id === board.id;
    if (!inBoard) K.fail(400, `${anchor.raw} is not on ${board.slug}`);
  }
  let to = row.status;
  if (opts.to !== undefined && opts.to !== null) {
    to = STATUSES.includes(opts.to) ? opts.to : resolveStatus(await loadStatuses(DB), opts.to);
    if (target && anchorStatus(target) !== to) K.fail(400, `${anchor.raw} is not in that column`);
  } else if (target) {
    to = anchorStatus(target);
  }
  let resolution = null;
  if (opts.resolution !== undefined && opts.resolution !== null) {
    if (!RESOLUTIONS.includes(opts.resolution)) K.fail(400, `resolution must be ${RESOLUTIONS.join(", ")}`);
    if (to !== "done") K.fail(400, "a resolution goes with done");
    resolution = opts.resolution;
  } else if (to === "done") {
    resolution = row.status === "done" ? row.resolution : "fixed";
  }
  if (resolution === "duplicate" && row.duplicate_of === null) K.fail(400, "a duplicate needs duplicate_of; set it with p99 status <KEY> duplicate --duplicate-of <KEY>");
  const key = K.keyOf(row.kind, row.id);
  const statusChanged = to !== row.status || resolution !== (row.resolution ?? null);
  const boardChanged = board.id !== row.board_id;
  if (!statusChanged && !boardChanged && !target) {
    const labels = labelsByItem(await labelRowsStatement(DB, [row.id]).all()).get(row.id);
    return { moved: itemCard({ ...row, status: to, resolution, labels }), changed: [] };
  }
  const place =
    !target && !boardChanged && to === row.status
      ? { position: row.position, renumber: [] }
      : await placement(c, board.id, to, { type: "item", id: row.id }, target, anchor && anchor.side);
  const open = OPEN_STATUSES.has(to);
  const touched = statusChanged || boardChanged;
  const statements = [
    ...place.renumber,
    DB.prepare(
      `UPDATE items SET status = ?2, resolution = ?3, open = ?4, board_id = ?5, position = ?6,
         duplicate_of = CASE WHEN ?3 = 'duplicate' THEN duplicate_of END,
         closed_at = CASE WHEN ?4 THEN NULL WHEN open = 1 THEN ?7 ELSE closed_at END,
         updated_at = CASE WHEN ?8 THEN ?7 ELSE updated_at END,
         activity_at = CASE WHEN ?8 THEN ?7 ELSE activity_at END,
         public_activity_at = CASE WHEN ?9 THEN ?7 ELSE public_activity_at END
       WHERE id = ?1`,
    ).bind(row.id, to, resolution, open ? 1 : 0, board.id, place.position, c.now, touched ? 1 : 0, statusChanged ? 1 : 0),
  ];
  const actor = c.actor ? c.actor.email ?? null : null;
  if (statusChanged) {
    const detail = { from: row.status, to };
    if (resolution) detail.resolution = resolution;
    if (row.resolution) detail.from_resolution = row.resolution;
    statements.push(K.eventStatement(c, row.id, actor, "status", detail));
  }
  if (boardChanged) statements.push(K.eventStatement(c, row.id, actor, "board", { from: current.slug, to: board.slug }, true));
  const done = await DB.batch([...statements, labelRowsStatement(DB, [row.id])]);
  const labels = labelsByItem(done[done.length - 1]).get(row.id);
  const moved = { ...row, status: to, resolution, open: open ? 1 : 0, board_id: board.id, position: place.position, labels };
  pushOf(c, {
    type: "move",
    key,
    host: row.host,
    title: row.title,
    board: board.slug,
    from: row.status,
    to,
    position: place.position,
    ...(boardChanged ? { from_board: current.slug } : {}),
  });
  if (statusChanged) itemMail(c, row, to, resolution);
  return { moved: { ...itemCard(moved), board: board.slug }, changed: touched ? [key] : [] };
}

async function moveBoard(c, v, b, opts) {
  const { DB } = c.env;
  const tree = await loadTree(c, v);
  const self = tree.byId.get(b.id);
  let parentId = self.parent_id;
  if (Object.prototype.hasOwnProperty.call(opts, "board")) {
    if (opts.board === null) parentId = null;
    else {
      const parent = boardIn(tree, String(opts.board));
      if (tree.subtree(self.id).includes(parent.id)) K.fail(400, `${self.slug} cannot go inside itself or one of its own boards`);
      if (parent.host !== null && parent.host !== self.host) K.fail(400, `${parent.slug} holds ${parent.host}'s boards; ${self.slug} is ${self.host ? `${self.host}'s` : "account-wide"}`);
      parentId = parent.id;
    }
  }
  const anchor = anchorOf(opts);
  let target = null;
  if (anchor) {
    target = await findCard(c, v, String(anchor.raw), anchor.side);
    const inParent = target.type === "item" ? parentId !== null && target.row.board_id === parentId : target.row.parent_id === parentId;
    if (!inParent) K.fail(400, `${anchor.raw} does not sit beside ${self.slug}`);
  }
  let to = self.status;
  if (opts.to !== undefined && opts.to !== null) {
    to = resolveStatus(tree.statuses, opts.to);
    if (target && parentId !== null && anchorStatus(target) !== to) K.fail(400, `${anchor.raw} is not in that column`);
  } else if (target && parentId !== null) {
    to = anchorStatus(target);
  }
  if (opts.resolution !== undefined && opts.resolution !== null) {
    if (!RESOLUTIONS.includes(opts.resolution)) K.fail(400, `resolution must be ${RESOLUTIONS.join(", ")}`);
    if (to !== "done") K.fail(400, "a resolution goes with done");
  }
  const resolution = to === "done" ? (opts.resolution ?? "fixed") : null;
  const columnChanged = to !== self.status;
  const parentChanged = parentId !== self.parent_id;
  const place =
    !target && !parentChanged && !columnChanged
      ? { position: self.position, renumber: [] }
      : await placement(c, parentId, to, { type: "board", id: self.id }, target, anchor && anchor.side);
  const statements = [
    ...place.renumber,
    DB.prepare("UPDATE boards SET status = ?2, parent_id = ?3, position = ?4, updated_at = ?5 WHERE id = ?1").bind(
      self.id,
      to,
      parentId,
      place.position,
      c.now,
    ),
  ];
  let items = [];
  if (columnChanged) {
    const ids = tree.subtree(self.id);
    const below = JSON.stringify(ids.filter((id) => id !== self.id));
    items = (
      await DB.prepare(
        `SELECT ${ITEM_COLUMNS}, b.slug AS board_slug FROM items i JOIN boards b ON b.id = i.board_id
         WHERE i.board_id IN (SELECT value FROM json_each(?1)) AND i.status <> ?2 AND (?3 OR i.host = ?4)
         ORDER BY i.board_id, i.position`,
      )
        .bind(JSON.stringify(ids), to, v.all ? 1 : 0, v.host)
        .all()
    ).results;
    const list = JSON.stringify(items.map((r) => r.id));
    const done = to === "done";
    statements.push(
      DB.prepare("UPDATE boards SET status = ?2, updated_at = ?3 WHERE id IN (SELECT value FROM json_each(?1))").bind(below, to, c.now),
      DB.prepare(
        `UPDATE items SET status = ?2, resolution = ?3, open = ?4, duplicate_of = NULL,
           closed_at = CASE WHEN ?4 THEN NULL ELSE ?5 END, updated_at = ?5, activity_at = ?5, public_activity_at = ?5
         WHERE id IN (SELECT value FROM json_each(?1))`,
      ).bind(list, to, done ? resolution : null, done ? 0 : 1, c.now),
    );
    if (items.length > 0) {
      const events = items.map((r) => ({
        id: r.id,
        detail: JSON.stringify({ from: r.status, to, ...(done ? { resolution } : {}), ...(r.resolution ? { from_resolution: r.resolution } : {}), board: self.slug }),
      }));
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
           SELECT json_extract(value, '$.id'), ?2, 'status', json_extract(value, '$.detail'), 0, ?3, ?4 FROM json_each(?1)`,
        ).bind(JSON.stringify(events), c.actor ? c.actor.email ?? null : null, c.now, c.actor && c.actor.agent ? 1 : 0),
      );
    }
  }
  await DB.batch(statements);
  const parent = parentId === null ? null : tree.byId.get(parentId);
  pushOf(c, {
    type: "board.move",
    host: self.host,
    board: self.slug,
    parent: parent ? parent.slug : null,
    from: self.status,
    to,
    position: place.position,
  });
  for (const r of items) {
    pushOf(c, {
      type: "move",
      key: K.keyOf(r.kind, r.id),
      host: r.host,
      title: r.title,
      board: r.board_slug,
      from: r.status,
      to,
      position: r.position,
    });
    itemMail(c, r, to, to === "done" ? resolution : null);
  }
  const after = await loadTree(c, v);
  const moved = after.byId.get(self.id) || { ...self, status: to, parent_id: parentId, position: place.position };
  return { moved: { ...boardCard(after, moved), parent: parent ? parent.slug : null }, changed: items.map((r) => K.keyOf(r.kind, r.id)) };
}

export async function postMove(c) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  if (!["to", "board", "before", "after"].some((f) => has(f) && (body[f] !== null || f === "board"))) {
    K.fail(400, "a move needs to, board, before or after");
  }
  for (const f of ["to", "before", "after", "resolution"]) {
    if (has(f) && body[f] !== null && typeof body[f] !== "string") K.fail(400, `${f} must be a string`);
  }
  if (has("board") && body.board !== null && typeof body.board !== "string") K.fail(400, "board must be a slug");
  const v = boardView(c);
  const target = await findCard(c, v, body.target);
  if (target.type === "board") return K.json(200, await moveBoard(c, v, target.row, body));
  if (has("board") && body.board === null) K.fail(400, "an item always sits on a board");
  return K.json(200, await moveItem(c, target.row, body));
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
  ["GET", /^\/statuses$/, getStatuses],
  ["PUT", /^\/statuses\/([a-z]+)$/, putStatus],
  ["GET", /^\/boards$/, getBoards],
  ["POST", /^\/boards$/, postBoard],
  ["GET", /^\/boards\/([^/]+)$/, getBoard],
  ["PATCH", /^\/boards\/([^/]+)$/, patchBoard],
  ["DELETE", /^\/boards\/([^/]+)$/, deleteBoard],
  ["POST", /^\/move$/, postMove],
];

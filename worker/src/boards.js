import { LANES } from "./cards.js";
import { moveByLane } from "./one-board.js";
import { noteHook } from "./hooks.js";
import { LONG_KEY, generateKeyBetween, generateNKeysBetween } from "./order.js";

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

const LABEL_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._:+-]{0,31}$/u;
export const MOVED = "this card moved; refreshed";
const CARD_LANES = "SELECT l.id, l.name, l.role, l.closes FROM boards b JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 ORDER BY bc.position";
const CARD_REOPENS = { inbox: 0, doing: 2, review: 5 };
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

function nameSql(column) {
  return `(SELECT username FROM people WHERE email = ${column})`;
}

export function pushOf(c, event) {
  const full = { by: c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent), via: c.actor.agent ? (c.actor.via ?? null) : null } : null, at: c.now, ...event };
  noteHook(c, full);
  if (c.env.HUB) c.pushes.push(full);
}

function labelName(raw) {
  const name = typeof raw === "string" ? K.clean(raw).trim().replace(/\s+/g, " ") : "";
  if (!LABEL_NAME.test(name)) K.fail(400, "a label is 1 to 32 letters, digits, spaces or . _ : + -, starting with a letter or digit");
  return name;
}

function labelId(raw) {
  const text = String(raw);
  if (!/^\d{1,15}$/.test(text)) K.fail(404, "no such lane");
  return Number(text);
}

export async function listLabels(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.closes, b.id AS board_id, b.name AS board_name, ${nameSql("b.owner")} AS owner_username
     FROM boards b JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id
     WHERE b.cards = 1 ORDER BY bc.position`,
  ).all();
  return K.json(200, {
    labels: results.map((l, at) => ({
      id: l.id,
      name: l.name,
      word: LANES[at] ?? null,
      closes: Boolean(l.closes),
      boards: [{ id: l.board_id, name: l.board_name, owner_username: l.owner_username ?? null }],
    })),
  });
}

export async function patchLabel(c, rawId) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const v = boardView(c);
  const { DB } = c.env;
  const label = await DB.prepare(
    "SELECT l.id, l.name, l.closes FROM boards b JOIN board_columns bc ON bc.board_id = b.id JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 AND l.id = ?1",
  )
    .bind(labelId(rawId))
    .first();
  if (!label) K.fail(404, "no such lane");
  const name = labelName(body.name);
  if (name === label.name) return K.json(200, { id: label.id, name, closes: Boolean(label.closes) });
  if (!v.all) K.fail(403, "the lanes are the account's; rename one from the CLI, without --host");
  try {
    await DB.prepare("UPDATE labels SET name = ?2 WHERE id = ?1").bind(label.id, name).run();
  } catch (error) {
    if (K.isUniqueViolation(error)) {
      const old = await DB.prepare("SELECT 1 AS n FROM labels l JOIN archived a ON a.kind = 'label' AND a.id = l.id WHERE l.name = ?1").bind(name).first();
      K.fail(409, old ? `an old label holds the name ${name}` : `a label called ${name} exists`);
    }
    throw error;
  }
  pushOf(c, { type: "labels", host: null, action: "renamed", names: [label.name, name] });
  return K.json(200, { id: label.id, name, closes: Boolean(label.closes) });
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
  K.refuseAgentClose(c, row, to);
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
  const via = agent ? (c.actor.via ?? null) : null;
  if (row.label_id !== to.id) events.push({ kind: "label", detail: { from: row.label_name, to: to.name }, internal: 1 });
  if (statusChanged) {
    const detail = { from: stageOf(row), to: stageOf(next) };
    if (resolution) detail.resolution = resolution;
    events.push({ kind: "status", detail, internal: 0 });
  }
  if (events.length > 0) {
    statements.push(
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT ?1, ?2, json_extract(value, '$.kind'), json_extract(value, '$.detail'), json_extract(value, '$.internal'), ?3, ?4, ?7
         FROM json_each(?5) WHERE (SELECT label_id FROM items WHERE id = ?1) = ?6`,
      ).bind(row.id, actor, c.now, agent, JSON.stringify(events.map((e) => ({ ...e, detail: JSON.stringify(e.detail) }))), to.id, via),
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

async function oneLane(c, index) {
  const { results } = await c.env.DB.prepare(CARD_LANES).all();
  const lane = results.at(index);
  return lane ? { ...lane, closes: index === -1 ? 1 : 0 } : null;
}

export async function closeItem(c, row, resolution, opts = {}) {
  const to = row.label_closes ? { id: row.label_id, name: row.label_name, role: row.label_role, closes: 1 } : await oneLane(c, -1);
  if (!to) K.fail(409, "no lane closes items; run p99 deploy");
  return applyLabel(c, row, to, { ...opts, resolution });
}

export async function reopenItem(c, row, role = "inbox") {
  const to = (await oneLane(c, CARD_REOPENS[role] ?? 0)) ?? (await c.env.DB.prepare("SELECT id, name, role, closes FROM labels WHERE role = ?1").bind(role).first());
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

export function placeIn(column, selfId, anchor, anchorId) {
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
  return moveByLane(c, body);
}

export async function postStreamTicket(c) {
  K.requireManager(c);
  if (!c.env.HUB) K.fail(404, "this Worker has no push yet; run p99 deploy");
  const v = boardView(c);
  const hosts = v.all ? null : c.code ? c.code.hosts.filter((h) => c.dir.hosts.has(h)) : [v.host];
  const ticket = K.hex(crypto.getRandomValues(new Uint8Array(24)));
  const ttl = Math.min(TICKET_TTL_MS, Number(c.env.TICKET_TTL_MS) || TICKET_TTL_MS);
  await K.hubOf(c.env).ticket(await K.sha256Hex(K.encoder.encode(ticket)), { hosts, code: c.code ? c.code.id : null, until: Date.now() + ttl });
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

export async function liveCodes(DB, ids) {
  const wanted = [...new Set(ids.filter((id) => id !== null && id !== undefined))];
  if (wanted.length === 0) return new Set();
  try {
    const { results } = await DB.prepare("SELECT id FROM codes WHERE id IN (SELECT value FROM json_each(?1)) AND revoked_at IS NULL")
      .bind(JSON.stringify(wanted))
      .all();
    return new Set(results.map((r) => r.id));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    return null;
  }
}

export async function liveSockets(DB, sockets) {
  const live = await liveCodes(DB, sockets.map(([, seen]) => seen.code));
  return sockets.filter(([socket, seen]) => {
    if (seen.code === undefined || seen.code === null) return true;
    if (live === null) return false;
    if (live.has(seen.code)) return true;
    try {
      socket.close(4001, "this code was revoked");
    } catch {}
    return false;
  });
}

export async function fanOut(DB, sockets, events) {
  const lines = events.map(({ hosts, ...event }) => [hosts ?? [event.host ?? null], event.type === "labels" && !hosts, JSON.stringify(event)]);
  for (const [socket, seen] of await liveSockets(DB, sockets)) {
    const wanted = seen.hosts ?? (seen.host ? [seen.host] : null);
    for (const [hosts, every, line] of lines) {
      if (wanted !== null && !every && !hosts.some((h) => wanted.includes(h))) continue;
      try {
        socket.send(line);
      } catch {}
    }
  }
}

export function publisher(DB, sockets) {
  let tail = Promise.resolve();
  return (events) => {
    const run = tail.then(() => fanOut(DB, sockets(), events));
    tail = run.catch(() => {});
    return run;
  };
}

export async function redeemTicket(storage, url, DB) {
  const hash = url.searchParams.get("ticket");
  const key = `ticket:${hash}`;
  const entry = await storage.get(key);
  if (entry) await storage.delete(key);
  if (!entry || entry.until < Date.now()) return null;
  const origin = url.searchParams.get("origin");
  if (entry.hosts !== null && !entry.hosts.includes(origin)) return null;
  const code = entry.code ?? null;
  if (code !== null && !(await liveCodes(DB, [code]))?.has(code)) return null;
  return { hosts: entry.hosts, code };
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
  ["POST", /^\/move$/, postMove],
];

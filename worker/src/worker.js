import { composeMail } from "./mail.js";
import loaderSource from "./web/p99.js";
import panelSource from "./web/panel.js";
import cssSource from "./web/p99.css";
import concreteSource from "./web/art/concrete.svg";
import concreteDarkSource from "./web/art/concrete-dark.svg";
import captureVendor from "./web/vendor/modern-screenshot-4.7.0.js";

const KEY_IDS = { p99: ["KEY_P99", "KEY_P99_NEXT"], test: ["KEY_TEST"] };
const KIND_PREFIXES = { bug: "BUG", feature: "FEAT", improvement: "IMP", question: "Q", task: "TASK" };
const STATUSES = ["new", "confirmed", "in_progress", "waiting", "resolved", "abandoned", "duplicate"];
const OPEN_STATUSES = new Set(["new", "confirmed", "in_progress", "waiting"]);
const RANKS = ["everyone", "administrator", "super_administrator"];
const ENV_KINDS = ["development", "release"];
const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];
const ERROR_CODES = {
  400: "invalid",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "too_large",
  429: "rate_limited",
  500: "internal",
};

const MAX_SKEW_SECONDS = 300;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_BUILD_BYTES = 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 20000;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_MARKS = 10;
const MAX_MARK_ELEMENTS = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_ITEM = 30;
const MAX_BUILD_ITEMS = 5000;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const MAX_CODE_HOSTS = 50;
const SNIFF_BYTES = 1024;
const DAILY_LIMITS = { issues: 30, comments: 200, bytes: 100 * 1024 * 1024 };
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const MAIL_CAP = 100;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CODE_LENGTH = 12;
const CODE_TTL_MS = 60 * 1000;
const CODE_CACHE_MAX = 2000;
const CODE_TOUCH_MS = 60 * 60 * 1000;
const DIRECTORY_TTL_MS = 30 * 1000;
const MANAGERS_TOKEN = Symbol("managers");

const ATTACHMENT_ROLES = ["screenshot", "page", "region", "file"];
const IMAGE_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const EMPTY_ZIP = [0x50, 0x4b, 0x05, 0x06];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FILE_SIGNATURES = {
  "image/png": (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  "image/webp": (h) => asciiAt(h, 0, "RIFF") && asciiAt(h, 8, "WEBP"),
  "image/gif": (h) => asciiAt(h, 0, "GIF87a") || asciiAt(h, 0, "GIF89a"),
  "application/pdf": (h) => asciiAt(h, 0, "%PDF-"),
  "text/plain": isPlainText,
  "text/csv": isPlainText,
  "text/x-log": isPlainText,
  "application/json": isPlainText,
  "application/zip": isZip,
  "application/x-zip-compressed": isZip,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZip,
  "application/vnd.oasis.opendocument.text": isZip,
  "application/vnd.oasis.opendocument.spreadsheet": isZip,
  "application/vnd.oasis.opendocument.presentation": isZip,
  "application/msword": (h) => startsWith(h, OLE),
  "application/vnd.ms-excel": (h) => startsWith(h, OLE),
  "application/vnd.ms-powerpoint": (h) => startsWith(h, OLE),
};

const BACKUP_PREFIX = "backups/";
const BACKUP_TABLES = [
  {
    name: "items",
    size: "length(title) + length(body) + length(context_json) + length(marks_json) + length(reporter_json) + length(page_url) + 500",
  },
  { name: "comments", size: "length(body) + 300" },
  { name: "attachments", size: "length(name) + 400" },
  { name: "events", size: "length(detail_json) + 200" },
  { name: "reads", size: "150" },
  { name: "builds", size: "200" },
  { name: "build_items", size: "length(subject) + 150" },
  { name: "landings", size: "150" },
  { name: "hosts", size: "length(config_json) + 200" },
  { name: "envs", size: "100" },
  { name: "codes", size: "length(hosts_json) + 400" },
];
const BACKUP_PAGE_ROWS = 1000;
const BACKUP_PAGE_BYTES = 128 * 1024;
const BACKUP_STEP_PAGES = 6;
const BACKUP_STEP_BYTES = 512 * 1024;
const BACKUP_RETAIN_DATES = 8;
const BACKUP_WEEKDAY = 1;
const BACKUP_HOUR = 3;
const USAGE_RETAIN_DAYS = 7;
const BRANCH_BUILD_RETAIN_DAYS = 30;

const JS_TYPE = "text/javascript; charset=utf-8";
const CAPTURE_SOURCE = `var exports = {}, module = {};\n${captureVendor}\nexport default exports;\n`;
const STATIC_FILES = {
  "/_p99/p99.js": { source: loaderSource, type: JS_TYPE, loader: true },
  "/_p99/panel.js": { source: panelSource, type: JS_TYPE },
  "/_p99/p99.css": { source: cssSource, type: "text/css; charset=utf-8" },
  "/_p99/capture.js": { source: CAPTURE_SOURCE, type: JS_TYPE },
  "/_p99/art/concrete.svg": { source: concreteSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/art/concrete-dark.svg": { source: concreteDarkSource, type: "image/svg+xml; charset=utf-8" },
};

class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new Failure(status, message);
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function errorResponse(status, message) {
  return json(status, { error: ERROR_CODES[status] || "internal", message });
}

function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function asciiAt(bytes, offset, text) {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function isZip(bytes) {
  return startsWith(bytes, ZIP) || startsWith(bytes, EMPTY_ZIP);
}

function isPlainText(bytes) {
  if (bytes.length === 0) return true;
  if (bytes.includes(0)) return false;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (/^\s*<(?:!doctype|html|svg|\?xml)/i.test(head)) return false;
  return !/<(?:html|svg|script|iframe|object|embed)[\s>/]/i.test(head);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexBytes(text) {
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256Hex(bytes) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

const encoder = new TextEncoder();

function base64UrlBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8Bytes(text) {
  return encoder.encode(text).byteLength;
}

function keyOf(kind, id) {
  return `${KIND_PREFIXES[kind] || "BUG"}-${id}`;
}

function parseKey(raw) {
  let text;
  try {
    text = decodeURIComponent(String(raw));
  } catch {
    return null;
  }
  const match = /^(?:[A-Za-z]{1,10}-)?(\d{1,15})$/.exec(text.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isUid(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function isText(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isEmail(value) {
  return isText(value, 3, 254) && /^[^\s@]+@[^\s@]+$/.test(value);
}

function isEnvName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value);
}

function isHostName(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value)
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function today(now) {
  return now.slice(0, 10);
}

function managersOf(env) {
  return String(env.MANAGERS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function decodeActor(header) {
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(header)) return null;
  let actor;
  try {
    actor = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlBytes(header)));
  } catch {
    return null;
  }
  if (!isObject(actor)) return null;
  if (!isEmail(actor.email)) return null;
  if (!isText(actor.name, 0, 200)) return null;
  if (!RANKS.includes(actor.rank)) return null;
  if (actor.function !== null && actor.function !== undefined && !isText(actor.function, 0, 100)) return null;
  if (actor.agent !== null && actor.agent !== undefined && typeof actor.agent !== "boolean") return null;
  const agent = actor.agent === true;
  let party = null;
  if (actor.party !== null && actor.party !== undefined) {
    if (!isObject(actor.party)) return null;
    const { id, name } = actor.party;
    if (!(isNumber(id) || isText(id, 1, 64)) || !isText(name, 0, 300)) return null;
    party = { id, name };
  }
  let person = null;
  if (actor.person !== null && actor.person !== undefined) {
    if (!(Number.isSafeInteger(actor.person) || isText(actor.person, 1, 254))) return null;
    person = actor.person;
  }
  const email = actor.email.toLowerCase();
  return {
    email,
    name: actor.name || email,
    rank: actor.rank,
    agent,
    function: actor.function ?? null,
    party,
    person,
  };
}

function isLocal(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

let directory = null;

async function loadDirectory(env) {
  if (directory && Date.now() - directory.at < DIRECTORY_TTL_MS) return directory;
  const [hosts, envs] = await env.DB.batch([
    env.DB.prepare("SELECT host, env, config_json, created_at FROM hosts ORDER BY host"),
    env.DB.prepare("SELECT name, kind, position, notify FROM envs ORDER BY position, name"),
  ]);
  directory = {
    at: Date.now(),
    hosts: new Map(hosts.results.map((r) => [r.host, hostOf(r)])),
    envs: new Map(envs.results.map((r) => [r.name, envOf(r)])),
  };
  return directory;
}

function forgetDirectory() {
  directory = null;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function hostOf(row) {
  return { host: row.host, env: row.env, config: parseJson(row.config_json, {}), created_at: row.created_at };
}

function envOf(row) {
  return { name: row.name, kind: row.kind, position: row.position, notify: Boolean(row.notify) };
}

function envKind(dir, name) {
  const known = dir.envs.get(name);
  return known ? known.kind : "release";
}

async function verifySignature(request, env, url) {
  const keyId = request.headers.get("x-p99-key-id") || "";
  if (!Object.hasOwn(KEY_IDS, keyId)) fail(401, "unknown or missing X-P99-Key-Id");
  if (keyId === "test" && !isLocal(url)) fail(401, "the test key is accepted only on localhost");
  const secrets = KEY_IDS[keyId].map((name) => env[name]).filter((s) => typeof s === "string" && s.length > 0);
  if (secrets.length === 0) fail(401, "unknown or missing X-P99-Key-Id");
  const auth = /^v1 ts=(\d{1,12}),sig=([0-9a-f]{64})$/.exec(request.headers.get("x-p99-auth") || "");
  if (!auth) fail(401, "missing or malformed X-P99-Auth");
  const bodyHash = request.headers.get("x-content-sha256") || "";
  if (!/^[0-9a-f]{64}$/.test(bodyHash)) fail(401, "missing or malformed X-Content-SHA256");
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(auth[1])) > MAX_SKEW_SECONDS) {
    fail(401, "the signature's timestamp is outside the allowed window");
  }
  const actorHeader = request.headers.get("x-p99-actor") ?? "";
  const message = encoder.encode(
    `v1\n${auth[1]}\n${request.method}\n${url.pathname}${url.search}\n${actorHeader}\n${bodyHash}`,
  );
  const signature = hexBytes(auth[2]);
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    if (await crypto.subtle.verify("HMAC", key, signature, message)) {
      return { bodyHash, actorHeader };
    }
  }
  fail(401, "the signature does not verify");
}

const codeCache = new Map();

function normaliseCode(raw) {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const text = raw
    .toLowerCase()
    .replace(/[\s-]/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
  return /^[0-9a-hjkmnp-tv-z]{12}$/.test(text) ? text : null;
}

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let secret = "";
  for (const b of bytes) secret += CODE_ALPHABET[b & 31];
  return secret;
}

async function findCode(env, hash) {
  const hit = codeCache.get(hash);
  if (hit && Date.now() - hit.at < CODE_TTL_MS) return hit.row;
  const row = await env.DB.prepare("SELECT * FROM codes WHERE hash = ?1").bind(hash).first();
  const entry = row ? { ...row, hosts: parseJson(row.hosts_json, []) } : null;
  if (codeCache.size >= CODE_CACHE_MAX) codeCache.clear();
  codeCache.set(hash, { at: Date.now(), row: entry });
  return entry;
}

async function authoriseCode(env, ctx, header, host, now) {
  const secret = normaliseCode(header);
  if (!secret) fail(401, "a valid X-P99-Code is required");
  const code = await findCode(env, await sha256Hex(encoder.encode(secret)));
  if (!code || code.revoked_at || !code.hosts.includes(host)) fail(401, "this code is not valid here");
  if (env.RATE) {
    const outcome = await env.RATE.limit({ key: `code:${code.id}` });
    if (!outcome.success) fail(429, "too many requests with this code; try again in a minute");
  }
  const nowMs = Date.parse(now);
  if (!code.last_used_at || nowMs - Date.parse(code.last_used_at) >= CODE_TOUCH_MS) {
    const before = new Date(nowMs - CODE_TOUCH_MS).toISOString();
    code.last_used_at = now;
    ctx.waitUntil(
      env.DB.prepare("UPDATE codes SET last_used_at = ?2 WHERE id = ?1 AND (last_used_at IS NULL OR last_used_at <= ?3)")
        .bind(code.id, now, before)
        .run()
        .catch(() => {}),
    );
  }
  return code;
}

async function readBody(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) fail(413, `the body is larger than ${maxBytes} bytes`);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      fail(413, `the body is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return joinChunks(chunks, total);
}

async function readJson(c, maxBytes) {
  const bytes = await readBody(c.request, maxBytes);
  if (c.signed && (await sha256Hex(bytes)) !== c.bodyHash) fail(401, "the body does not match X-Content-SHA256");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isObject(value)) fail(400, "the body must be a JSON object");
    return value;
  } catch (error) {
    if (error instanceof Failure) throw error;
    fail(400, "the body is not valid JSON");
  }
}

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(String(error && error.message));
}

function requireEmptyBody(c) {
  if (c.signed && c.bodyHash !== EMPTY_SHA256) fail(401, "the body does not match X-Content-SHA256");
}

function requireManager(c) {
  if (!c.manager) fail(403, "only managers may do this");
}

function query(firstBinds = []) {
  const binds = [...firstBinds];
  return {
    binds,
    bind(value) {
      binds.push(value);
      return `?${binds.length}`;
    },
  };
}

function scopeClause(c, q, alias = "i") {
  return c.scope.all ? null : `${alias}.host = ${q.bind(c.scope.host)}`;
}

function inScope(c, row) {
  return c.scope.all || row.host === c.scope.host;
}

async function checkUsage(c, field, amount) {
  if (c.manager) return;
  const row = await c.env.DB.prepare(`SELECT ${field} AS used FROM usage WHERE actor_email = ?1 AND day = ?2`)
    .bind(c.actor.email, today(c.now))
    .first();
  if ((row ? row.used : 0) + amount > DAILY_LIMITS[field]) fail(429, `the daily limit for ${field} is reached`);
}

function usageStatement(c, field, amount) {
  return c.env.DB.prepare(
    `INSERT INTO usage (actor_email, day, ${field}) VALUES (?1, ?2, ?3)
     ON CONFLICT (actor_email, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`,
  ).bind(c.actor.email, today(c.now), amount);
}

function readStatement(c, itemId) {
  return c.env.DB.prepare(
    `INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at`,
  ).bind(c.actor.email, itemId, c.now);
}

function agentOf(c) {
  return c.actor && c.actor.agent ? 1 : 0;
}

function eventStatement(c, itemId, actorEmail, kind, detail, internal = false) {
  return c.env.DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(itemId, actorEmail, kind, JSON.stringify(detail), internal ? 1 : 0, c.now, agentOf(c));
}

function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function searchText(title, body) {
  return fold(`${title} ${body ?? ""}`);
}

const ITEM_SELECT = `SELECT i.*, d.kind AS duplicate_kind FROM items i LEFT JOIN items d ON d.id = i.duplicate_of`;

async function loadItem(c, raw) {
  const id = parseKey(raw);
  if (id === null) fail(404, "no such item");
  const row = await c.env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id).first();
  if (!row || !inScope(c, row) || (!c.manager && row.reporter_email !== c.actor.email)) fail(404, "no such item");
  return row;
}

function actionEnv(c, row) {
  return c.actionEnv ?? row.origin_env;
}

function landingStatements(env, ids) {
  const list = JSON.stringify(ids);
  return [
    env.DB.prepare(
      `SELECT env, branch, sha, version, dirty, announced_at FROM builds
       WHERE branch = 'main' OR env NOT IN (SELECT name FROM envs WHERE kind = 'development')`,
    ),
    env.DB.prepare(
      "SELECT item_id, env, branch, rel, sha, subject FROM build_items WHERE item_id IN (SELECT value FROM json_each(?1))",
    ).bind(list),
    env.DB.prepare("SELECT item_id, env, at FROM landings WHERE item_id IN (SELECT value FROM json_each(?1))").bind(
      list,
    ),
  ];
}

function countedBuilds(builds, dir) {
  const counted = Object.create(null);
  for (const b of builds) {
    if (envKind(dir, b.env) === "development") {
      if (b.branch === "main") counted[b.env] = b;
    } else if (!counted[b.env] || b.announced_at > counted[b.env].announced_at) {
      counted[b.env] = b;
    }
  }
  return counted;
}

function envOrder(dir, counted) {
  const known = [...dir.envs.keys()];
  const extra = Object.keys(counted)
    .filter((name) => !dir.envs.has(name))
    .sort();
  return [...known, ...extra];
}

function landingContext(results, dir) {
  const [builds, rows, landings] = results.map((r) => r.results || []);
  const counted = countedBuilds(builds, dir);
  return { dir, counted, order: envOrder(dir, counted), rows, landings };
}

function emptyLandingContext(dir) {
  return { dir, counted: Object.create(null), order: [...dir.envs.keys()], rows: [], landings: [] };
}

function isCounted(counted, row) {
  const build = counted[row.env];
  return Boolean(build && build.branch === row.branch);
}

function landingOf(itemId, lc) {
  const landing = { branch: false, envs: [] };
  const fixes = lc.rows.filter((r) => r.item_id === itemId && r.rel === "fixes");
  for (const name of lc.order) {
    const build = lc.counted[name];
    if (!build || !fixes.some((r) => r.env === name && r.branch === build.branch)) continue;
    const first = lc.landings.find((l) => l.item_id === itemId && l.env === name);
    const at = first ? first.at : build.announced_at;
    landing.envs.push({ env: name, kind: envKind(lc.dir, name), at, sha: build.sha, version: build.version });
  }
  if (landing.envs.length === 0) landing.branch = fixes.some((r) => !isCounted(lc.counted, r) && r.branch !== "main");
  return landing;
}

function commitsOf(itemId, lc) {
  const bySha = new Map();
  for (const row of lc.rows) {
    if (row.item_id !== itemId) continue;
    let commit = bySha.get(row.sha);
    if (!commit) {
      commit = { sha: row.sha, subject: row.subject, rel: row.rel, envs: [] };
      bySha.set(row.sha, commit);
    }
    if (row.rel === "fixes") commit.rel = "fixes";
    if (isCounted(lc.counted, row) && !commit.envs.includes(row.env)) commit.envs.push(row.env);
  }
  return [...bySha.values()];
}

function summaryOf(row, c, lc) {
  return {
    id: row.id,
    key: keyOf(row.kind, row.id),
    kind: row.kind,
    status: row.status,
    title: row.title,
    host: row.host,
    env: row.origin_env,
    page: { url: row.page_url, path: row.page_path, title: row.page_title },
    reporter: { email: row.reporter_email, name: row.reporter_name, agent: Boolean(row.reporter_agent) },
    assignee: row.assignee,
    created_at: row.created_at,
    updated_at: row.updated_at,
    comments: c.manager ? row.comment_count : row.public_comment_count,
    attachments: c.manager ? row.attachment_count : row.public_attachment_count,
    unread: Boolean(row.unread),
    landing: landingOf(row.id, lc),
  };
}

function issueOf(row, c, lc) {
  return {
    ...summaryOf(row, c, lc),
    body: row.body,
    reporter: {
      ...parseJson(row.reporter_json, {}),
      email: row.reporter_email,
      name: row.reporter_name,
      agent: Boolean(row.reporter_agent),
    },
    duplicate_of: row.duplicate_of === null ? null : keyOf(row.duplicate_kind, row.duplicate_of),
    closed_at: row.closed_at,
    context: parseJson(row.context_json, {}),
    marks: parseJson(row.marks_json, []),
    commits: commitsOf(row.id, lc),
  };
}

function commentOf(row, attachmentIds = []) {
  return {
    id: row.id,
    client_uid: row.client_uid,
    author: {
      email: row.author_email,
      name: row.author_name,
      manager: Boolean(row.author_manager),
      agent: Boolean(row.author_agent),
    },
    body: row.body,
    internal: Boolean(row.internal),
    created_at: row.created_at,
    attachments: attachmentIds,
  };
}

function attachmentOf(row) {
  return {
    id: row.id,
    client_uid: row.client_uid,
    role: row.role,
    mark: row.mark,
    name: row.name,
    type: row.type,
    bytes: row.bytes,
    sha256: row.sha256,
    comment_id: row.comment_id,
    created_at: row.created_at,
  };
}

function eventOf(row) {
  return {
    actor: row.actor_email,
    agent: Boolean(row.actor_agent),
    kind: row.kind,
    detail: parseJson(row.detail_json, {}),
    at: row.at,
  };
}

function codeOf(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    hosts: parseJson(row.hosts_json, []),
    manager: Boolean(row.manager),
    hint: row.hint,
    created_at: row.created_at,
    created_by: row.created_by,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
  };
}

async function issueResponse(c, id, status) {
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id),
    ...landingStatements(c.env, [id]),
  ]);
  const row = results[0].results[0];
  return json(status, issueOf({ ...row, unread: 0 }, c, landingContext(results.slice(1), c.dir)));
}

function pageLink(row) {
  if (!row.host || !isHostName(row.host)) return null;
  try {
    const origin = `https://${row.host}`;
    const url = new URL(`${origin}${row.page_path}`);
    if (url.origin !== origin) return null;
    url.search = "";
    url.hash = `p99=${keyOf(row.kind, row.id)}`;
    return url.toString();
  } catch {
    return null;
  }
}

function mailOn(env) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

function sendMail(c, row, recipients, data) {
  if (!mailOn(c.env)) return;
  const content = composeMail({
    key: keyOf(row.kind, row.id),
    kind: row.kind,
    title: row.title,
    link: pageLink(row),
    actorName: c.actor ? (c.actor.agent ? `${c.actor.name}*` : c.actor.name) : "P99",
    ...data,
  });
  c.outbox.push({ item_id: row.id, host: row.host ?? null, to: recipients, template: data.template, ref: data.ref, ...content });
}

function mailable(address, c) {
  return Boolean(address) && !address.endsWith(".invalid") && address !== (c.actor ? c.actor.email : null);
}

async function flushMail(c) {
  const { env } = c;
  try {
    const queued = c.outbox.splice(0);
    let codeManagers = null;
    const mails = [];
    for (const mail of queued) {
      let targets = mail.to;
      if (targets === MANAGERS_TOKEN) {
        if (!codeManagers) {
          codeManagers = (
            await env.DB.prepare("SELECT email, hosts_json FROM codes WHERE manager = 1 AND revoked_at IS NULL").all()
          ).results;
        }
        targets = [
          ...managersOf(env),
          ...codeManagers.filter((r) => parseJson(r.hosts_json, []).includes(mail.host)).map((r) => r.email.toLowerCase()),
        ];
      }
      for (const to of new Set(targets)) if (mailable(to, c)) mails.push({ ...mail, to });
    }
    if (mails.length === 0) return;
    const outcomes = mails.map(() => ({ ok: false, status: "capped" }));
    const sending = mails.slice(0, MAIL_CAP);
    const key = await sha256Hex(encoder.encode(sending.map((m) => `${m.item_id} ${m.template} ${m.ref} ${m.to}`).join("\n")));
    let outcome;
    try {
      const response = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json; charset=utf-8",
          "idempotency-key": `p99-${key}`,
        },
        body: JSON.stringify(
          sending.map((m) => ({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html })),
        ),
      });
      outcome = { ok: response.ok, status: response.status };
      if (!response.ok) console.error(`mail batch of ${sending.length} failed with ${response.status}`);
    } catch (error) {
      console.error(`mail batch of ${sending.length} failed: ${error.message}`);
      outcome = { ok: false, status: "error" };
    }
    for (let i = 0; i < sending.length; i++) outcomes[i] = outcome;
    if (mails.length > MAIL_CAP) console.error(`${mails.length - MAIL_CAP} mails over the cap of ${MAIL_CAP} were not sent`);
    const events = mails.map((m, i) => ({
      item_id: m.item_id,
      detail: JSON.stringify({ to: m.to, template: m.template, ...outcomes[i] }),
    }));
    await env.DB.prepare(
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
       SELECT json_extract(value, '$.item_id'), ?2, 'mail', json_extract(value, '$.detail'), 1, ?3, ?4 FROM json_each(?1)`,
    )
      .bind(JSON.stringify(events), c.actor ? c.actor.email : null, c.now, agentOf(c))
      .run();
  } catch (error) {
    console.error(`mail flush failed: ${error.message}`);
  }
}

function cleanPath(path) {
  return path.split(/[?#]/)[0];
}

function validPage(page) {
  if (!isObject(page)) return null;
  if (!isText(page.url, 1, 2048) || !/^https?:\/\//i.test(page.url)) return null;
  let url;
  try {
    const parsed = new URL(page.url);
    parsed.search = "";
    parsed.hash = "";
    url = parsed.toString();
  } catch {
    return null;
  }
  if (!isText(page.path, 1, 2048)) return null;
  const path = cleanPath(page.path);
  if (!isText(path, 1, 512) || !path.startsWith("/")) return null;
  const title = page.title ?? "";
  if (!isText(title, 0, 300)) return null;
  return { url, path, title };
}

function validBox(box, keys) {
  if (!box || typeof box !== "object") return null;
  const out = {};
  for (const key of keys) {
    if (!isNumber(box[key])) return null;
    out[key] = box[key];
  }
  return out;
}

function validMarks(marks) {
  if (marks === undefined || marks === null) return [];
  if (!Array.isArray(marks) || marks.length > MAX_MARKS) return null;
  const out = [];
  for (const mark of marks) {
    if (!mark || typeof mark !== "object") return null;
    const rect = validBox(mark.rect, ["x", "y", "w", "h"]);
    const viewport = validBox(mark.viewport, ["w", "h", "scroll_x", "scroll_y", "dpr"]);
    if (!rect || !viewport) return null;
    const elements = mark.elements ?? [];
    if (!Array.isArray(elements) || elements.length > MAX_MARK_ELEMENTS) return null;
    const cleanElements = [];
    for (const element of elements) {
      if (!element || typeof element !== "object") return null;
      const box = validBox(element.box, ["x", "y", "w", "h"]);
      const selector = element.selector ?? "";
      const label = element.label ?? "";
      const text = element.text ?? "";
      if (!box || !isText(selector, 0, 1000) || !isText(label, 0, 300) || !isText(text, 0, 1000)) return null;
      cleanElements.push({ selector, label, text, box });
    }
    out.push({ rect, viewport, elements: cleanElements });
  }
  return out;
}

function validTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= MAX_TITLE_CHARS ? title : null;
}

function validStringMap(value, unsafe) {
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 200) return null;
  const out = {};
  for (const [key, text] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || !isText(text, 0, 2000)) return null;
    if (unsafe && unsafe.test(text)) return null;
    out[key] = text;
  }
  return out;
}

function validConfig(value) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) return null;
  const out = {};
  if (value.corner !== undefined && value.corner !== null) {
    if (!CORNERS.includes(value.corner)) return null;
    out.corner = value.corner;
  }
  if (value.offset !== undefined && value.offset !== null) {
    const offset = validBox(value.offset, ["x", "y"]);
    if (!offset) return null;
    out.offset = offset;
  }
  if (value.above !== undefined && value.above !== null) {
    if (!isText(value.above, 1, 300)) return null;
    out.above = value.above;
  }
  if (value.off !== undefined && value.off !== null) {
    if (!Array.isArray(value.off) || value.off.length > 100) return null;
    if (!value.off.every((p) => isText(p, 1, 300) && p.startsWith("/"))) return null;
    out.off = value.off;
  }
  if (value.theme !== undefined && value.theme !== null) {
    const theme = validStringMap(value.theme, /[<>{};\\]/);
    if (!theme) return null;
    out.theme = theme;
  }
  if (value.strings !== undefined && value.strings !== null) {
    const strings = validStringMap(value.strings);
    if (!strings) return null;
    out.strings = strings;
  }
  if (utf8Bytes(JSON.stringify(out)) > MAX_CONFIG_BYTES) return null;
  return out;
}

function placementOf(config) {
  return {
    corner: config.corner || "bottom-right",
    offset: config.offset || { x: 16, y: 16 },
    above: config.above || null,
    off: config.off || [],
    accent: (config.theme && config.theme.accent) || null,
  };
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function health(env) {
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    return errorResponse(500, "the database is unreachable");
  }
  return json(200, { ok: true, version: env.VERSION || "dev" });
}

async function serveStatic(request, env, url) {
  const file = STATIC_FILES[url.pathname];
  if (!file || (request.method !== "GET" && request.method !== "HEAD")) fail(404, "no such file");
  const dir = await loadDirectory(env);
  const host = dir.hosts.get(url.hostname);
  if (!host) fail(404, "no such host");
  const version = env.VERSION || "dev";
  let text = file.source.split("__P99_VERSION__").join(version);
  if (file.loader) text = text.split("__P99_HOST__").join(scriptJson(placementOf(host.config)));
  const immutable = !file.loader && url.searchParams.has("v");
  return new Response(request.method === "HEAD" ? null : text, {
    status: 200,
    headers: {
      "content-type": file.type,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function postBuilds(c) {
  const body = await readJson(c, MAX_BUILD_BYTES);
  if (!isEnvName(body.env)) fail(400, "env must name an environment");
  const envName = body.env;
  if (!isText(body.sha, 7, 64) || !/^[0-9a-f]+$/.test(body.sha)) fail(400, "sha must be a lowercase hex commit id");
  if (!isText(body.branch, 1, 200)) fail(400, "branch must be 1 to 200 characters");
  if (!isText(body.version, 1, 100)) fail(400, "version must be 1 to 100 characters");
  if (typeof body.dirty !== "boolean") fail(400, "dirty must be a boolean");
  const listed = body.items ?? [];
  if (!Array.isArray(listed) || listed.length > MAX_BUILD_ITEMS) fail(400, `items must be at most ${MAX_BUILD_ITEMS}`);
  const seen = new Set();
  const items = [];
  for (const entry of listed) {
    if (!entry || typeof entry !== "object") fail(400, "every item must be an object");
    const itemId = parseKey(entry.id);
    if (itemId === null) fail(400, "an item id is not a key or a number");
    if (entry.rel !== "fixes" && entry.rel !== "refs") fail(400, "rel must be fixes or refs");
    if (!isText(entry.sha, 7, 64) || !/^[0-9a-f]+$/.test(entry.sha)) fail(400, "an item sha is not a commit id");
    const subject = typeof entry.subject === "string" ? entry.subject.slice(0, 300) : "";
    const unique = `${itemId} ${entry.rel} ${entry.sha}`;
    if (seen.has(unique)) continue;
    seen.add(unique);
    items.push({ item_id: itemId, rel: entry.rel, sha: entry.sha, subject });
  }
  const { DB } = c.env;
  const previous = await DB.prepare("SELECT sha, dirty FROM builds WHERE env = ?1 AND branch = ?2")
    .bind(envName, body.branch)
    .first();
  const unchanged = previous && previous.sha === body.sha && !previous.dirty && !body.dirty;
  const statements = [];
  if (!unchanged) {
    const list = JSON.stringify(items);
    statements.push(
      DB.prepare(
        `DELETE FROM build_items WHERE env = ?1 AND branch = ?2 AND (item_id, rel, sha) NOT IN (
           SELECT json_extract(value, '$.item_id'), json_extract(value, '$.rel'), json_extract(value, '$.sha')
           FROM json_each(?3))`,
      ).bind(envName, body.branch, list),
      DB.prepare(
        `INSERT INTO build_items (env, branch, item_id, rel, sha, subject)
         SELECT ?1, ?2, json_extract(j.value, '$.item_id'), json_extract(j.value, '$.rel'),
                json_extract(j.value, '$.sha'), json_extract(j.value, '$.subject')
         FROM json_each(?3) j
         WHERE EXISTS (SELECT 1 FROM items WHERE id = json_extract(j.value, '$.item_id'))
         ON CONFLICT DO NOTHING`,
      ).bind(envName, body.branch, list),
    );
  }
  statements.push(
    DB.prepare(
      `INSERT INTO builds (env, branch, sha, version, dirty, announced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (env, branch) DO UPDATE SET sha = excluded.sha, version = excluded.version,
         dirty = excluded.dirty, announced_at = excluded.announced_at`,
    ).bind(envName, body.branch, body.sha, body.version, body.dirty ? 1 : 0, c.now),
  );
  const counts = envKind(c.dir, envName) === "development" ? body.branch === "main" : true;
  if (counts) {
    statements.push(
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at)
         SELECT DISTINCT b.item_id, NULL, 'landed', ?5, 0, ?4 FROM build_items b
         WHERE b.env = ?1 AND b.branch = ?2 AND b.rel = 'fixes'
           AND NOT EXISTS (SELECT 1 FROM landings l WHERE l.item_id = b.item_id AND l.env = ?1)`,
      ).bind(
        envName,
        body.branch,
        body.sha,
        c.now,
        JSON.stringify({ env: envName, branch: body.branch, sha: body.sha, version: body.version }),
      ),
      DB.prepare(
        `INSERT INTO landings (item_id, env, sha, at)
         SELECT DISTINCT item_id, ?1, ?3, ?4 FROM build_items WHERE env = ?1 AND branch = ?2 AND rel = 'fixes'
         ON CONFLICT DO NOTHING
         RETURNING item_id`,
      ).bind(envName, body.branch, body.sha, c.now),
    );
  }
  const results = await DB.batch(statements);
  if (counts) {
    const landed = results[results.length - 1].results.map((r) => r.item_id);
    if (landed.length > 0) await announceLandings(c, envName, body, landed);
  }
  return new Response(null, { status: 204 });
}

async function announceLandings(c, envName, body, landed) {
  const known = c.dir.envs.get(envName);
  if (!known || !known.notify || !mailOn(c.env)) return;
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, title, host, origin_env, page_path, reporter_email FROM items WHERE id IN (SELECT value FROM json_each(?1))",
  )
    .bind(JSON.stringify(landed))
    .all();
  for (const row of results) {
    sendMail(c, row, [row.reporter_email], { template: "landed", env: envName, version: body.version, ref: `${envName}-${body.sha}` });
  }
}

async function countsFor(c, path) {
  if (path !== null && !isText(path, 1, 512)) fail(400, "path must be 1 to 512 characters");
  const { DB } = c.env;
  const email = c.actor.email;
  const activity = c.manager ? "i.activity_at" : "i.public_activity_at";
  const scoped = (sqlOf, first = []) => {
    const q = query(first);
    const where = sqlOf(q);
    const scope = scopeClause(c, q);
    if (scope) where.push(scope);
    return { where: where.join(" AND "), binds: q.binds };
  };
  const statement = (prefix, built) => DB.prepare(`${prefix} WHERE ${built.where}`).bind(...built.binds);
  const statements = [
    statement("SELECT count(*) AS n FROM items i", scoped(() => ["i.reporter_email = ?1", "i.open = 1"], [email])),
    statement(
      "SELECT count(*) AS n FROM items i LEFT JOIN reads r ON r.actor_email = ?1 AND r.item_id = i.id",
      scoped(() => ["i.reporter_email = ?1", `${activity} > COALESCE(r.read_at, '')`], [email]),
    ),
  ];
  if (path !== null) {
    statements.push(
      statement(
        "SELECT count(*) AS n FROM items i",
        scoped((q) => {
          const where = [`i.page_path = ${q.bind(path)}`, "i.open = 1"];
          if (!c.manager) where.push(`i.reporter_email = ${q.bind(email)}`);
          return where;
        }),
      ),
    );
  }
  if (c.manager) statements.push(statement("SELECT count(*) AS n FROM items i", scoped(() => ["i.open = 1"])));
  const results = (await DB.batch(statements)).map((r) => r.results[0].n);
  return {
    page_open: path !== null ? results[2] : null,
    mine_open: results[0],
    mine_unread: results[1],
    all_open: c.manager ? results[results.length - 1] : null,
  };
}

async function getCounts(c) {
  requireEmptyBody(c);
  return json(200, await countsFor(c, c.url.searchParams.get("path")));
}

async function getMe(c) {
  const counts = await countsFor(c, c.url.searchParams.get("path"));
  const config = c.hostRow.config;
  return json(200, {
    name: c.actor.name,
    email: c.actor.email,
    manager: c.manager,
    host: c.hostRow.host,
    env: c.hostRow.env,
    version: c.env.VERSION || "dev",
    counts,
    theme: config.theme || {},
    strings: config.strings || {},
  });
}

async function listIssues(c) {
  requireEmptyBody(c);
  const params = c.url.searchParams;
  const scope = params.get("scope") || "mine";
  const where = [];
  const q = query([c.actor.email]);
  if (scope === "mine") {
    where.push("i.reporter_email = ?1");
  } else if (scope === "all") {
    requireManager(c);
  } else if (scope === "page") {
    const path = params.get("path");
    if (!isText(path, 1, 512)) fail(400, "scope page needs a path");
    where.push(`i.page_path = ${q.bind(path)}`);
    if (!c.manager) where.push("i.reporter_email = ?1");
  } else {
    fail(400, "scope must be mine, all or page");
  }
  const hostScope = scopeClause(c, q);
  if (hostScope) where.push(hostScope);
  const status = params.get("status") || "any";
  if (status === "open") where.push("i.open = 1");
  else if (status === "closed") where.push("i.open = 0");
  else if (STATUSES.includes(status)) where.push(`i.status = ${q.bind(status)}`);
  else if (status !== "any") fail(400, "status must be open, closed, any or a status");
  const kind = params.get("kind");
  if (kind) {
    if (!KIND_PREFIXES[kind]) fail(400, "kind is not known");
    where.push(`i.kind = ${q.bind(kind)}`);
  }
  const text = (params.get("q") || "").trim();
  if (text.length > 200) fail(400, "q must be at most 200 characters");
  if (text.length > 0) {
    const like = q.bind(`%${fold(text).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const match = `i.search_text LIKE ${like} ESCAPE '\\'`;
    const id = parseKey(text);
    where.push(id !== null ? `(i.id = ${q.bind(id)} OR ${match})` : `(${match})`);
  }
  const cursor = params.get("cursor");
  if (cursor) {
    const after = parseKey(cursor);
    if (after === null) fail(400, "cursor is not valid");
    where.push(`i.id < ${q.bind(after)}`);
  }
  const limitText = params.get("limit");
  const limit = limitText === null ? DEFAULT_LIST_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) fail(400, `limit must be 1 to ${MAX_LIST_LIMIT}`);
  const activity = c.manager ? "i.activity_at" : "i.public_activity_at";
  const sql = `SELECT i.id, i.kind, i.status, i.title, i.host, i.origin_env, i.page_url, i.page_path, i.page_title,
      i.reporter_email, i.reporter_name, i.reporter_agent, i.assignee, i.created_at, i.updated_at, i.comment_count,
      i.public_comment_count, i.attachment_count, i.public_attachment_count,
      ${activity} > COALESCE(r.read_at, '') AS unread
    FROM items i LEFT JOIN reads r ON r.actor_email = ?1 AND r.item_id = i.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY i.id DESC LIMIT ${q.bind(limit + 1)}`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...q.binds)
    .all();
  const page = results.slice(0, limit);
  const lc =
    page.length > 0
      ? landingContext(await c.env.DB.batch(landingStatements(c.env, page.map((row) => row.id))), c.dir)
      : emptyLandingContext(c.dir);
  return json(200, {
    issues: page.map((row) => summaryOf(row, c, lc)),
    next_cursor: results.length > limit ? String(page[page.length - 1].id) : null,
  });
}

function creationTarget(c, body) {
  if (c.browser) return { host: c.hostRow.host, env: c.hostRow.env };
  const name = (c.scope.all ? null : c.scope.host) ?? body.host;
  const host = typeof name === "string" ? c.dir.hosts.get(name) : null;
  if (!host) fail(400, "host must name a listed host");
  return { host: host.host, env: host.env };
}

function reporterJson(c) {
  return JSON.stringify(c.browser ? { email: c.actor.email, name: c.actor.name } : c.actor);
}

async function createIssue(c) {
  const body = await readJson(c, MAX_JSON_BYTES);
  if (!isUid(body.client_uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const existing = await c.env.DB.prepare("SELECT id, reporter_email FROM items WHERE client_uid = ?1")
    .bind(body.client_uid)
    .first();
  if (existing) {
    if (existing.reporter_email !== c.actor.email) fail(409, "client_uid is already used");
    return issueResponse(c, existing.id, 200);
  }
  if (!KIND_PREFIXES[body.kind]) fail(400, "kind must be bug, feature, improvement, question or task");
  if (body.kind === "task") requireManager(c);
  const title = validTitle(body.title);
  if (title === null) fail(400, `title must be 1 to ${MAX_TITLE_CHARS} characters`);
  const text = body.body ?? "";
  if (!isText(text, 0, MAX_BODY_CHARS)) fail(400, `body must be at most ${MAX_BODY_CHARS} characters`);
  const page = validPage(body.page);
  if (!page) fail(400, "page must have an http(s) url, a path starting with / and a title");
  const context = body.context ?? {};
  if (!isObject(context)) fail(400, "context must be an object");
  const contextJson = JSON.stringify(context);
  if (utf8Bytes(contextJson) > MAX_CONTEXT_BYTES) fail(413, "context is larger than 64 KB");
  const marks = validMarks(body.marks);
  if (marks === null) fail(400, `marks must be at most ${MAX_MARKS} marks with rect, viewport and elements`);
  const target = creationTarget(c, body);
  await checkUsage(c, "issues", 1);
  const { DB } = c.env;
  const byUid = "FROM items WHERE client_uid = ?1";
  const reporter = reporterJson(c);
  let results;
  try {
    results = await DB.batch([
      DB.prepare(
        `INSERT INTO items (client_uid, kind, status, open, title, body, origin_env, page_url, page_path, page_title,
           reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at,
           created_at, updated_at, host, reporter_agent, search_text)
         VALUES (?1, ?2, 'new', 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?14, ?14, ?15, ?16, ?17)
         RETURNING id`,
      ).bind(
        body.client_uid,
        body.kind,
        title,
        text,
        target.env,
        page.url,
        page.path,
        page.title,
        c.actor.email,
        c.actor.name,
        reporter,
        contextJson,
        JSON.stringify(marks),
        c.now,
        target.host,
        agentOf(c),
        searchText(title, text),
      ),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
         SELECT id, ?2, 'created', ?3, 0, ?4, ?5 ${byUid}`,
      ).bind(body.client_uid, c.actor.email, JSON.stringify({ kind: body.kind, title }), c.now, agentOf(c)),
      DB.prepare(
        `INSERT INTO reads (actor_email, item_id, read_at) SELECT ?2, id, ?3 ${byUid}
         ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at`,
      ).bind(body.client_uid, c.actor.email, c.now),
      usageStatement(c, "issues", 1),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await DB.prepare(`SELECT id, reporter_email ${byUid}`).bind(body.client_uid).first();
    if (!raced || raced.reporter_email !== c.actor.email) fail(409, "client_uid is already used");
    return issueResponse(c, raced.id, 200);
  }
  const id = results[0].results[0].id;
  const row = {
    id,
    kind: body.kind,
    status: "new",
    title,
    body: text,
    host: target.host,
    origin_env: target.env,
    page_url: page.url,
    page_path: page.path,
    page_title: page.title,
    reporter_email: c.actor.email,
    reporter_name: c.actor.name,
    reporter_agent: c.actor.agent,
    reporter_json: reporter,
    assignee: null,
    duplicate_of: null,
    closed_at: null,
    context_json: contextJson,
    marks_json: JSON.stringify(marks),
    comment_count: 0,
    public_comment_count: 0,
    attachment_count: 0,
    public_attachment_count: 0,
    created_at: c.now,
    updated_at: c.now,
    unread: 0,
  };
  if (!c.manager) sendMail(c, row, MANAGERS_TOKEN, { template: "created", body: text, ref: "created" });
  return json(201, issueOf(row, c, emptyLandingContext(c.dir)));
}

async function getIssue(c, rawKey) {
  requireEmptyBody(c);
  const row = await loadItem(c, rawKey);
  const { DB } = c.env;
  const visible = c.manager ? "" : " AND internal = 0";
  const results = await DB.batch([
    DB.prepare(`SELECT * FROM comments WHERE item_id = ?1${visible} ORDER BY id`).bind(row.id),
    DB.prepare(`SELECT * FROM attachments WHERE item_id = ?1 AND stored_at IS NOT NULL${visible} ORDER BY id`).bind(row.id),
    DB.prepare(`SELECT * FROM events WHERE item_id = ?1${visible} ORDER BY id`).bind(row.id),
    ...landingStatements(c.env, [row.id]),
    readStatement(c, row.id),
  ]);
  const [comments, attachments, events] = results.slice(0, 3).map((r) => r.results);
  const lc = landingContext(results.slice(3, 6), c.dir);
  const byComment = new Map();
  for (const a of attachments) {
    if (a.comment_id === null) continue;
    if (!byComment.has(a.comment_id)) byComment.set(a.comment_id, []);
    byComment.get(a.comment_id).push(a.id);
  }
  return json(200, {
    issue: issueOf({ ...row, unread: 0 }, c, lc),
    comments: comments.map((cm) => commentOf(cm, byComment.get(cm.id) || [])),
    attachments: attachments.map(attachmentOf),
    events: events.map(eventOf),
  });
}

async function patchIssue(c, rawKey) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const row = await loadItem(c, rawKey);
  const reporter = row.reporter_email === c.actor.email;
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const next = {
    status: row.status,
    kind: row.kind,
    assignee: row.assignee,
    duplicate_of: row.duplicate_of,
    title: row.title,
    body: row.body,
  };
  if (has("title")) {
    if (!c.manager && !(reporter && row.status === "new")) fail(403, "the title can no longer be changed");
    next.title = validTitle(body.title);
    if (next.title === null) fail(400, `title must be 1 to ${MAX_TITLE_CHARS} characters`);
  }
  if (has("body")) {
    if (!(reporter && row.status === "new")) fail(403, "only the reporter may change the body, while the item is new");
    if (!isText(body.body, 0, MAX_BODY_CHARS)) fail(400, `body must be at most ${MAX_BODY_CHARS} characters`);
    next.body = body.body;
  }
  if (has("kind")) {
    requireManager(c);
    if (!KIND_PREFIXES[body.kind]) fail(400, "kind is not known");
    next.kind = body.kind;
  }
  if (has("assignee")) {
    requireManager(c);
    const assignee = body.assignee === null ? null : String(body.assignee).trim().toLowerCase();
    if (assignee !== null && !isEmail(assignee)) fail(400, "the assignee must be an e-mail address");
    next.assignee = assignee;
  }
  if (has("duplicate_of")) {
    requireManager(c);
    if (body.duplicate_of === null) {
      next.duplicate_of = null;
    } else {
      const target = parseKey(body.duplicate_of);
      if (target === null || target === row.id) fail(400, "duplicate_of must name another item");
      const exists = await c.env.DB.prepare("SELECT id, host, origin_env FROM items WHERE id = ?1").bind(target).first();
      if (!exists || !inScope(c, exists)) fail(400, "duplicate_of names no item");
      next.duplicate_of = target;
      if (!has("status")) next.status = "duplicate";
    }
  }
  if (has("status")) {
    if (!STATUSES.includes(body.status)) fail(400, "status is not known");
    const allowed =
      c.manager ||
      (reporter && body.status === "abandoned" && OPEN_STATUSES.has(row.status)) ||
      (reporter && body.status === "new" && row.status === "resolved") ||
      body.status === row.status;
    if (!allowed) fail(403, "this status change is not allowed");
    next.status = body.status;
  }
  if (next.status === "duplicate" && next.duplicate_of === null) fail(400, "a duplicate needs duplicate_of");
  if (next.status !== "duplicate") next.duplicate_of = null;

  const statements = [];
  const actor = c.actor.email;
  let publicChange = false;
  if (next.status !== row.status || next.duplicate_of !== row.duplicate_of) {
    const detail = { from: row.status, to: next.status };
    if (next.duplicate_of !== null) detail.duplicate_of = next.duplicate_of;
    statements.push(eventStatement(c, row.id, actor, "status", detail));
    publicChange = true;
  }
  if (next.kind !== row.kind) statements.push(eventStatement(c, row.id, actor, "kind", { from: row.kind, to: next.kind }));
  if (next.assignee !== row.assignee) {
    statements.push(eventStatement(c, row.id, actor, "assignee", { from: row.assignee, to: next.assignee }));
  }
  if (next.title !== row.title) statements.push(eventStatement(c, row.id, actor, "title", { from: row.title, to: next.title }));
  if (next.body !== row.body) statements.push(eventStatement(c, row.id, actor, "title", { field: "body" }));
  if (statements.length === 0) return issueResponse(c, row.id, 200);

  const open = OPEN_STATUSES.has(next.status);
  const closedAt = open ? null : row.open ? c.now : row.closed_at;
  statements.unshift(
    c.env.DB.prepare(
      `UPDATE items SET status = ?2, open = ?3, kind = ?4, assignee = ?5, duplicate_of = ?6, title = ?7, body = ?8,
         closed_at = ?9, updated_at = ?10, activity_at = ?10,
         public_activity_at = CASE WHEN ?11 THEN ?10 ELSE public_activity_at END, search_text = ?12
       WHERE id = ?1`,
    ).bind(
      row.id,
      next.status,
      open ? 1 : 0,
      next.kind,
      next.assignee,
      next.duplicate_of,
      next.title,
      next.body,
      closedAt,
      c.now,
      publicChange ? 1 : 0,
      searchText(next.title, next.body),
    ),
  );
  statements.push(readStatement(c, row.id));
  await c.env.DB.batch(statements);
  if (c.manager && next.status !== row.status) {
    sendMail(c, { ...row, kind: next.kind, title: next.title }, [row.reporter_email], {
      template: "status",
      status: next.status,
      ref: `status-${c.now}`,
    });
  }
  return issueResponse(c, row.id, 200);
}

async function postComment(c, rawKey) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const row = await loadItem(c, rawKey);
  if (!isUid(body.client_uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const { DB } = c.env;
  const existing = await DB.prepare("SELECT * FROM comments WHERE client_uid = ?1").bind(body.client_uid).first();
  if (existing) {
    if (existing.author_email !== c.actor.email || existing.item_id !== row.id) fail(409, "client_uid is already used");
    return json(200, commentOf(existing, await commentAttachmentIds(c, row.id, existing.id)));
  }
  if (typeof body.body !== "string" || body.body.trim().length === 0 || body.body.length > MAX_BODY_CHARS) {
    fail(400, `body must be 1 to ${MAX_BODY_CHARS} characters`);
  }
  const internal = body.internal === true;
  if (body.internal !== undefined && typeof body.internal !== "boolean") fail(400, "internal must be a boolean");
  if (internal) requireManager(c);
  await checkUsage(c, "comments", 1);
  const reopen = row.reporter_email === c.actor.email && !internal;
  let results;
  try {
    results = await DB.batch([
      DB.prepare(
        `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal,
           origin_env, created_at, author_agent)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         RETURNING *`,
      ).bind(
        row.id,
        body.client_uid,
        c.actor.email,
        c.actor.name,
        c.manager ? 1 : 0,
        body.body,
        internal ? 1 : 0,
        actionEnv(c, row),
        c.now,
        agentOf(c),
      ),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
         SELECT ?1, ?2, 'status', '{"from":"waiting","to":"confirmed"}', 0, ?3, ?5 FROM items
         WHERE id = ?1 AND status = 'waiting' AND ?4`,
      ).bind(row.id, c.actor.email, c.now, reopen ? 1 : 0, agentOf(c)),
      DB.prepare(
        `UPDATE items SET comment_count = comment_count + 1,
           public_comment_count = public_comment_count + ?2,
           activity_at = ?3, updated_at = ?3,
           public_activity_at = CASE WHEN ?2 THEN ?3 ELSE public_activity_at END,
           status = CASE WHEN ?4 AND status = 'waiting' THEN 'confirmed' ELSE status END
         WHERE id = ?1`,
      ).bind(row.id, internal ? 0 : 1, c.now, reopen ? 1 : 0),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
         SELECT ?1, ?2, 'comment', json_object('comment_id', id, 'internal', json(?3)), ?4, ?5, ?7
         FROM comments WHERE client_uid = ?6`,
      ).bind(row.id, c.actor.email, internal ? "true" : "false", internal ? 1 : 0, c.now, body.client_uid, agentOf(c)),
      readStatement(c, row.id),
      usageStatement(c, "comments", 1),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await DB.prepare("SELECT * FROM comments WHERE client_uid = ?1").bind(body.client_uid).first();
    if (!raced || raced.author_email !== c.actor.email || raced.item_id !== row.id) fail(409, "client_uid is already used");
    return json(200, commentOf(raced, await commentAttachmentIds(c, row.id, raced.id)));
  }
  const inserted = results[0].results[0];
  if (!c.manager) {
    sendMail(c, row, MANAGERS_TOKEN, { template: "comment_to_managers", body: body.body, ref: `comment-${inserted.id}` });
  } else if (!internal) {
    sendMail(c, row, [row.reporter_email], { template: "comment_to_reporter", body: body.body, ref: `comment-${inserted.id}` });
  }
  return json(201, commentOf(inserted));
}

async function commentAttachmentIds(c, itemId, commentId) {
  const { results } = await c.env.DB.prepare(
    "SELECT id FROM attachments WHERE item_id = ?1 AND comment_id = ?2 AND stored_at IS NOT NULL ORDER BY id",
  )
    .bind(itemId, commentId)
    .all();
  return results.map((r) => r.id);
}

function checkSignature(type, head) {
  const check = FILE_SIGNATURES[type];
  if (!check || !check(head)) fail(400, `the content does not look like ${type}`);
}

function joinChunks(chunks, total) {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function streamToBucket(c, key, length, type, name, mark) {
  const fixed = new FixedLengthStream(length);
  const writer = fixed.writable.getWriter();
  const options = {
    httpMetadata: { contentType: type },
    customMetadata: mark === null ? { name } : { name, mark: String(mark) },
  };
  if (c.bodyHash) options.sha256 = c.bodyHash;
  const put = c.env.BUCKET.put(key, fixed.readable, options);
  put.catch(() => {});
  const digest = c.bodyHash ? null : new crypto.DigestStream("SHA-256");
  const digestWriter = digest ? digest.getWriter() : null;
  const write = async (chunk) => {
    await writer.write(chunk);
    if (digestWriter) await digestWriter.write(chunk);
  };
  const reader = c.request.body.getReader();
  const pending = [];
  let pendingBytes = 0;
  let sniffed = false;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > length) fail(413, "the body is longer than its Content-Length");
      if (sniffed) {
        await write(value);
        continue;
      }
      pending.push(value);
      pendingBytes += value.byteLength;
      if (pendingBytes >= SNIFF_BYTES) {
        checkSignature(type, joinChunks(pending, pendingBytes).subarray(0, SNIFF_BYTES));
        sniffed = true;
        for (const chunk of pending.splice(0)) await write(chunk);
      }
    }
    if (total !== length) fail(400, "the body is shorter than its Content-Length");
    if (!sniffed) {
      checkSignature(type, joinChunks(pending, pendingBytes));
      for (const chunk of pending.splice(0)) await write(chunk);
    }
    await writer.close();
    if (digestWriter) await digestWriter.close();
  } catch (error) {
    await reader.cancel().catch(() => {});
    await writer.abort(error).catch(() => {});
    if (digestWriter) await digestWriter.abort(error).catch(() => {});
    await put.catch(() => {});
    throw error;
  }
  try {
    await put;
  } catch (error) {
    if (/sha-?256|checksum|digest|hash/i.test(String(error && error.message))) {
      fail(400, "the body does not match X-Content-SHA256");
    }
    throw error;
  }
  return digest ? hex(await digest.digest) : c.bodyHash;
}

async function putAttachment(c, rawKey, rawUid) {
  const row = await loadItem(c, rawKey);
  const uid = decodeURIComponentSafe(rawUid);
  if (!isUid(uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const { DB } = c.env;
  const settled = async (found) => {
    const same =
      found.item_id === row.id && found.actor_email === c.actor.email && (!c.bodyHash || found.sha256 === c.bodyHash || !found.stored_at);
    if (same && !found.stored_at) return found;
    if (c.request.body) await c.request.body.cancel().catch(() => {});
    if (!same) fail(409, "client_uid is already used");
    return json(200, attachmentOf(found));
  };
  const byUid = DB.prepare("SELECT * FROM attachments WHERE client_uid = ?1").bind(uid);
  let reserved = await byUid.first();
  if (reserved) {
    reserved = await settled(reserved);
    if (reserved instanceof Response) return reserved;
  }
  const params = c.url.searchParams;
  const role = params.get("role") || "file";
  if (!ATTACHMENT_ROLES.includes(role)) fail(400, "role must be screenshot, page, region or file");
  const markText = params.get("mark");
  let mark = null;
  if (role === "region") {
    const marks = parseJson(row.marks_json, []);
    mark = markText !== null && /^\d{1,2}$/.test(markText) ? Number(markText) : -1;
    if (mark < 0 || mark >= marks.length) fail(400, "a region needs mark, the index of one of the item's marks");
  } else if (markText !== null && markText !== "") {
    fail(400, "only a region carries a mark");
  }
  const name = (params.get("name") || "").trim();
  if (!isText(name, 1, 200) || /[\u0000-\u001f\u007f/\\]/.test(name)) fail(400, "name must be 1 to 200 characters, no slashes");
  const type = (c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (role === "file" ? !FILE_SIGNATURES[type] : !IMAGE_TYPES.has(type)) {
    fail(400, `the type ${type || "(none)"} is not allowed for a ${role}`);
  }
  let commentId = null;
  let internal = false;
  const commentParam = params.get("comment");
  if (commentParam) {
    const comment = await DB.prepare("SELECT id, internal FROM comments WHERE id = ?1 AND item_id = ?2")
      .bind(Number(commentParam) || 0, row.id)
      .first();
    if (!comment || (comment.internal && !c.manager)) fail(404, "no such comment on this item");
    commentId = comment.id;
    internal = Boolean(comment.internal);
  }
  const declared = c.request.headers.get("content-length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) fail(400, "Content-Length is required");
  const length = Number(declared);
  if (length > MAX_FILE_BYTES) fail(413, "a file may be at most 20 MiB");
  if (length === 0 || !c.request.body) fail(400, "the file is empty");
  if (row.attachment_count >= MAX_FILES_PER_ITEM) fail(409, `an item holds at most ${MAX_FILES_PER_ITEM} files`);
  await checkUsage(c, "bytes", length);
  if (!reserved) {
    reserved = await DB.prepare(
      `INSERT INTO attachments (item_id, client_uid, comment_id, internal, role, name, type, bytes, sha256, r2_key,
         actor_email, origin_env, created_at, mark)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT (client_uid) DO NOTHING
       RETURNING *`,
    )
      .bind(
        row.id,
        uid,
        commentId,
        internal ? 1 : 0,
        role,
        name,
        type,
        length,
        c.bodyHash || "",
        `issues/${row.id}/${uid}`,
        c.actor.email,
        actionEnv(c, row),
        c.now,
        mark,
      )
      .first();
    if (!reserved) {
      const raced = await settled(await byUid.first());
      if (raced instanceof Response) return raced;
      reserved = raced;
    }
  }
  if (reserved.bytes !== length) fail(400, "Content-Length differs from the first attempt with this client_uid");
  const sha256 = await streamToBucket(c, reserved.r2_key, length, reserved.type, reserved.name, reserved.mark);
  const token = crypto.randomUUID();
  const mine = "EXISTS (SELECT 1 FROM attachments WHERE id = ?1 AND stored_token = ?2)";
  const results = await DB.batch([
    DB.prepare("UPDATE attachments SET stored_at = ?3, stored_token = ?2, sha256 = ?4 WHERE id = ?1 AND stored_at IS NULL").bind(
      reserved.id,
      token,
      c.now,
      sha256,
    ),
    DB.prepare(
      `UPDATE items SET attachment_count = attachment_count + 1,
         public_attachment_count = public_attachment_count + ?4,
         activity_at = ?5, updated_at = ?5,
         public_activity_at = CASE WHEN ?4 THEN ?5 ELSE public_activity_at END
       WHERE id = ?3 AND ${mine}`,
    ).bind(reserved.id, token, row.id, reserved.internal ? 0 : 1, c.now),
    DB.prepare(
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent)
       SELECT ?3, ?4, 'attachment', ?5, ?6, ?7, ?8 WHERE ${mine}`,
    ).bind(
      reserved.id,
      token,
      row.id,
      c.actor.email,
      JSON.stringify({
        attachment_id: reserved.id,
        name: reserved.name,
        role: reserved.role,
        mark: reserved.mark,
        comment_id: reserved.comment_id,
      }),
      reserved.internal,
      c.now,
      agentOf(c),
    ),
    DB.prepare(
      `INSERT INTO usage (actor_email, day, bytes) SELECT ?3, ?4, ?5 WHERE ${mine}
       ON CONFLICT (actor_email, day) DO UPDATE SET bytes = bytes + excluded.bytes`,
    ).bind(reserved.id, token, c.actor.email, today(c.now), length),
    readStatement(c, row.id),
  ]);
  return json(results[0].meta.changes === 1 ? 201 : 200, attachmentOf({ ...reserved, sha256 }));
}

function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function getFile(c, rawId) {
  requireEmptyBody(c);
  const row = await c.env.DB.prepare(
    `SELECT a.*, i.reporter_email, i.host FROM attachments a JOIN items i ON i.id = a.item_id
     WHERE a.id = ?1 AND a.stored_at IS NOT NULL`,
  )
    .bind(Number(rawId))
    .first();
  if (!row || !inScope(c, row)) fail(404, "no such file");
  if (!c.manager && (row.reporter_email !== c.actor.email || row.internal)) fail(404, "no such file");
  const object = await c.env.BUCKET.get(row.r2_key);
  if (!object) fail(404, "no such file");
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.type,
      "content-length": String(row.bytes),
      "content-disposition": contentDisposition(row.name),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
      "x-content-sha256": row.sha256,
    },
  });
}

async function listHosts(c) {
  requireEmptyBody(c);
  requireManager(c);
  const { results } = await c.env.DB.prepare("SELECT host, env, config_json, created_at FROM hosts ORDER BY host").all();
  return json(200, { hosts: results.map(hostOf) });
}

async function putHost(c, rawHost) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const host = decodeURIComponentSafe(rawHost).toLowerCase();
  if (!isHostName(host)) fail(400, "host must be a host name");
  if (!isEnvName(body.env)) fail(400, "env must be 1 to 32 lowercase letters, digits, dashes or underscores");
  const config = validConfig(body.config);
  if (config === null) fail(400, "config is not valid");
  const { DB } = c.env;
  const row = await DB.prepare(
    `INSERT INTO hosts (host, env, config_json, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (host) DO UPDATE SET env = excluded.env, config_json = excluded.config_json
     RETURNING host, env, config_json, created_at`,
  )
    .bind(host, body.env, JSON.stringify(config), c.now)
    .first();
  forgetDirectory();
  return json(200, hostOf(row));
}

async function deleteHost(c, rawHost) {
  requireEmptyBody(c);
  const host = decodeURIComponentSafe(rawHost).toLowerCase();
  const { meta } = await c.env.DB.prepare("DELETE FROM hosts WHERE host = ?1").bind(host).run();
  forgetDirectory();
  if (!meta.changes) fail(404, "no such host");
  return new Response(null, { status: 204 });
}

async function listEnvs(c) {
  requireEmptyBody(c);
  requireManager(c);
  const { results } = await c.env.DB.prepare("SELECT name, kind, position, notify FROM envs ORDER BY position, name").all();
  return json(200, { envs: results.map(envOf) });
}

async function putEnv(c, rawName) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const name = decodeURIComponentSafe(rawName);
  if (!isEnvName(name)) fail(400, "the environment's name must be 1 to 32 lowercase letters, digits, dashes or underscores");
  if (!ENV_KINDS.includes(body.kind)) fail(400, "kind must be development or release");
  const position = body.position ?? 0;
  if (!Number.isSafeInteger(position) || Math.abs(position) > 1000000) fail(400, "position must be an integer");
  const notify = body.notify ?? false;
  if (typeof notify !== "boolean") fail(400, "notify must be a boolean");
  const row = await c.env.DB.prepare(
    `INSERT INTO envs (name, kind, position, notify) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (name) DO UPDATE SET kind = excluded.kind, position = excluded.position, notify = excluded.notify
     RETURNING name, kind, position, notify`,
  )
    .bind(name, body.kind, position, notify ? 1 : 0)
    .first();
  forgetDirectory();
  return json(200, envOf(row));
}

async function listCodes(c) {
  requireEmptyBody(c);
  const host = c.url.searchParams.get("host");
  const statement =
    host && host !== "*"
      ? c.env.DB.prepare(
          "SELECT * FROM codes WHERE EXISTS (SELECT 1 FROM json_each(codes.hosts_json) WHERE value = ?1) ORDER BY id DESC",
        ).bind(host)
      : c.env.DB.prepare("SELECT * FROM codes ORDER BY id DESC");
  const { results } = await statement.all();
  return json(200, { codes: results.map(codeOf) });
}

async function postCode(c) {
  const body = await readJson(c, MAX_JSON_BYTES);
  if (!isText(body.name, 1, 200) || body.name.trim().length === 0) fail(400, "name must be 1 to 200 characters");
  if (!isEmail(body.email)) fail(400, "email must be an e-mail address");
  if (!Array.isArray(body.hosts) || body.hosts.length === 0 || body.hosts.length > MAX_CODE_HOSTS) {
    fail(400, `hosts must list 1 to ${MAX_CODE_HOSTS} hosts`);
  }
  const hosts = [...new Set(body.hosts.map((h) => String(h).toLowerCase()))];
  for (const host of hosts) if (!c.dir.hosts.has(host)) fail(400, `${host} is not a listed host`);
  const manager = body.manager ?? false;
  if (typeof manager !== "boolean") fail(400, "manager must be a boolean");
  const secret = newSecret();
  const hash = await sha256Hex(encoder.encode(secret));
  const row = await c.env.DB.prepare(
    `INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     RETURNING *`,
  )
    .bind(hash, secret.slice(-4), body.name.trim(), body.email.toLowerCase(), JSON.stringify(hosts), manager ? 1 : 0, c.now, c.actor.email)
    .first();
  codeCache.delete(hash);
  return json(201, {
    code: codeOf(row),
    secret,
    links: hosts.map((host) => `https://${host}/?p99=${secret}`),
  });
}

async function revokeCode(c, rawId) {
  requireEmptyBody(c);
  const row = await c.env.DB.prepare(
    "UPDATE codes SET revoked_at = COALESCE(revoked_at, ?2) WHERE id = ?1 RETURNING *",
  )
    .bind(Number(rawId), c.now)
    .first();
  codeCache.clear();
  if (!row) fail(404, "no such code");
  return json(200, codeOf(row));
}

async function backupStatus(c) {
  requireEmptyBody(c);
  requireManager(c);
  const { results } = await c.env.DB.prepare("SELECT * FROM backup_runs ORDER BY date DESC LIMIT 8").all();
  const view = (run) =>
    run && {
      date: run.date,
      started_at: run.started_at,
      finished_at: run.finished_at,
      pages: run.pages,
      rows: parseJson(run.rows_json, {}),
    };
  return json(200, {
    last: view(results.find((r) => r.finished_at !== null)) || null,
    running: view(results.find((r) => r.finished_at === null)) || null,
  });
}

function backupDue(last, nowDate) {
  if (!last) return true;
  const days = (nowDate.getTime() - Date.parse(last.started_at)) / 86400000;
  if (days >= 8) return true;
  return (
    nowDate.getUTCDay() === BACKUP_WEEKDAY &&
    nowDate.getUTCHours() >= BACKUP_HOUR &&
    last.date !== nowDate.toISOString().slice(0, 10)
  );
}

async function backupStep(env) {
  const { DB } = env;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  let run = await DB.prepare("SELECT * FROM backup_runs WHERE finished_at IS NULL ORDER BY date DESC LIMIT 1").first();
  if (!run) {
    const last = await DB.prepare("SELECT date, started_at FROM backup_runs ORDER BY date DESC LIMIT 1").first();
    if (!backupDue(last, nowDate)) return;
    const date = now.slice(0, 10);
    const branchCutoff = new Date(nowDate.getTime() - BRANCH_BUILD_RETAIN_DAYS * 86400000).toISOString();
    const stale = `SELECT env, branch FROM builds WHERE branch <> 'main' AND announced_at < ?1
      AND env IN (SELECT name FROM envs WHERE kind = 'development')`;
    await DB.batch([
      DB.prepare("INSERT OR REPLACE INTO backup_runs (date, started_at) VALUES (?1, ?2)").bind(date, now),
      DB.prepare("DELETE FROM usage WHERE day < ?1").bind(
        new Date(nowDate.getTime() - USAGE_RETAIN_DAYS * 86400000).toISOString().slice(0, 10),
      ),
      DB.prepare(`DELETE FROM build_items WHERE (env, branch) IN (${stale})`).bind(branchCutoff),
      DB.prepare(`DELETE FROM builds WHERE (env, branch) IN (${stale})`).bind(branchCutoff),
    ]);
    run = await DB.prepare("SELECT * FROM backup_runs WHERE date = ?1").bind(date).first();
  }
  const rows = parseJson(run.rows_json, {});
  let { table_index: tableIndex, after_rowid: afterRowid, page, pages } = run;
  let written = 0;
  for (let step = 0; step < BACKUP_STEP_PAGES && written < BACKUP_STEP_BYTES && tableIndex < BACKUP_TABLES.length; step++) {
    const table = BACKUP_TABLES[tableIndex];
    const { results } = await DB.prepare(
      `SELECT rowid AS _rowid, * FROM ${table.name} WHERE rowid > ?1 AND rowid <= (
         SELECT max(r) FROM (
           SELECT rowid AS r, sum(${table.size}) OVER (ORDER BY rowid ROWS UNBOUNDED PRECEDING) AS running
           FROM ${table.name} WHERE rowid > ?1 ORDER BY rowid LIMIT ?2
         ) WHERE running <= ?3 OR r = (SELECT min(rowid) FROM ${table.name} WHERE rowid > ?1)
       ) ORDER BY rowid`,
    )
      .bind(afterRowid, BACKUP_PAGE_ROWS, BACKUP_PAGE_BYTES)
      .all();
    if (results.length > 0 || page === 0) {
      page += 1;
      const text = JSON.stringify({ exported_at: now, table: table.name, page, rows: results });
      await env.BUCKET.put(`${BACKUP_PREFIX}${run.date}/${table.name}-${String(page).padStart(4, "0")}.json`, text, {
        httpMetadata: { contentType: "application/json" },
      });
      written += text.length;
      pages += 1;
      rows[table.name] = (rows[table.name] || 0) + results.length;
    }
    if (results.length === 0) {
      tableIndex += 1;
      afterRowid = 0;
      page = 0;
    } else {
      afterRowid = results[results.length - 1]._rowid;
    }
    const finished = tableIndex >= BACKUP_TABLES.length;
    await DB.prepare(
      `UPDATE backup_runs SET table_index = ?2, after_rowid = ?3, page = ?4, pages = ?5, rows_json = ?6, finished_at = ?7
       WHERE date = ?1`,
    )
      .bind(run.date, tableIndex, afterRowid, page, pages, JSON.stringify(rows), finished ? new Date().toISOString() : null)
      .run();
    if (finished) {
      await pruneBackups(env);
      console.log(`backup ${run.date} finished: ${pages} pages`);
    }
  }
}

async function pruneBackups(env) {
  const { results } = await env.DB.prepare("SELECT date FROM backup_runs ORDER BY date DESC").all();
  const doomed = results.slice(BACKUP_RETAIN_DATES).map((r) => r.date);
  for (const date of doomed) {
    let cursor;
    do {
      const listed = await env.BUCKET.list({ prefix: `${BACKUP_PREFIX}${date}/`, cursor });
      const keys = listed.objects.map((o) => o.key);
      if (keys.length > 0) await env.BUCKET.delete(keys);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    await env.DB.prepare("DELETE FROM backup_runs WHERE date = ?1").bind(date).run();
  }
}

const ITEM_ROUTES = [
  ["GET", /^\/issues$/, listIssues],
  ["POST", /^\/issues$/, createIssue],
  ["GET", /^\/issues\/([^/]+)$/, getIssue],
  ["PATCH", /^\/issues\/([^/]+)$/, patchIssue],
  ["POST", /^\/issues\/([^/]+)\/comments$/, postComment],
  ["PUT", /^\/issues\/([^/]+)\/attachments\/([^/]+)$/, putAttachment],
  ["GET", /^\/files\/(\d{1,15})$/, getFile],
];

const BROWSER_ROUTES = [["GET", /^\/me$/, getMe], ...ITEM_ROUTES];

const SIGNED_ROUTES = [
  ["POST", /^\/builds$/, postBuilds, { actor: false }],
  ["GET", /^\/counts$/, getCounts, { listed: true }],
  ...ITEM_ROUTES.map(([method, pattern, handler]) => [method, pattern, handler, { listed: handler === listIssues }]),
  ["GET", /^\/hosts$/, listHosts, {}],
  ["PUT", /^\/hosts\/([^/]+)$/, putHost, {}],
  ["DELETE", /^\/hosts\/([^/]+)$/, deleteHost, {}],
  ["GET", /^\/envs$/, listEnvs, {}],
  ["PUT", /^\/envs\/([^/]+)$/, putEnv, {}],
  ["GET", /^\/codes$/, listCodes, {}],
  ["POST", /^\/codes$/, postCode, {}],
  ["POST", /^\/codes\/(\d{1,15})\/revoke$/, revokeCode, {}],
  ["GET", /^\/admin\/backup-status$/, backupStatus, {}],
];

function findRoute(routes, method, path) {
  for (const route of routes) {
    if (route[0] !== method) continue;
    const match = route[1].exec(path);
    if (match) return { route, args: match.slice(1) };
  }
  return null;
}

async function runHandler(c, handler, args) {
  const response = await handler(c, ...args);
  if (c.outbox.length > 0) c.ctx.waitUntil(flushMail(c));
  return response;
}

async function browserRequest(request, env, ctx, url, path) {
  const dir = await loadDirectory(env);
  const hostRow = dir.hosts.get(url.hostname);
  if (!hostRow) fail(404, "no such host");
  const now = new Date().toISOString();
  const code = await authoriseCode(env, ctx, request.headers.get("x-p99-code"), hostRow.host, now);
  const found = findRoute(BROWSER_ROUTES, request.method, path);
  if (!found) fail(404, "no such route");
  const declaredHash = request.headers.get("x-content-sha256");
  const c = {
    request,
    env,
    ctx,
    url,
    dir,
    browser: true,
    signed: false,
    bodyHash: declaredHash && /^[0-9a-f]{64}$/.test(declaredHash) ? declaredHash : null,
    actor: { email: code.email.toLowerCase(), name: code.name, agent: false },
    manager: Boolean(code.manager) || managersOf(env).includes(code.email.toLowerCase()),
    scope: { all: false, host: hostRow.host },
    hostRow,
    actionEnv: hostRow.env,
    now,
    outbox: [],
  };
  return runHandler(c, found.route[2], found.args);
}

async function signedRequest(request, env, ctx, url, path) {
  const signed = await verifySignature(request, env, url);
  let actor = null;
  if (signed.actorHeader !== "") {
    actor = decodeActor(signed.actorHeader);
    if (!actor) fail(400, "X-P99-Actor is not a valid actor");
  }
  const found = findRoute(SIGNED_ROUTES, request.method, path);
  if (!found) fail(404, "no such route");
  const options = found.route[3];
  if (options.actor !== false && !actor) fail(401, "X-P99-Actor is required");
  const dir = await loadDirectory(env);
  const host = url.searchParams.get("host");
  const all = host === null || host === "*";
  if (!all && options.listed && !dir.hosts.has(host)) fail(404, "no such host");
  const c = {
    request,
    env,
    ctx,
    url,
    dir,
    browser: false,
    signed: true,
    bodyHash: signed.bodyHash,
    actor,
    manager: Boolean(actor),
    scope: { all, host: all ? null : host },
    hostRow: null,
    actionEnv: null,
    now: new Date().toISOString(),
    outbox: [],
  };
  return runHandler(c, found.route[2], found.args);
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/_p99/health") return health(env);
  if (path.startsWith("/_p99/api/")) return browserRequest(request, env, ctx, url, path.slice("/_p99/api".length));
  if (path.startsWith("/_p99/v1/")) return signedRequest(request, env, ctx, url, path.slice("/_p99/v1".length));
  if (path.startsWith("/_p99/")) return serveStatic(request, env, url);
  fail(404, "no such route");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      if (error instanceof Failure) return errorResponse(error.status, error.message);
      console.error(error && error.stack ? error.stack : String(error));
      return errorResponse(500, "internal error");
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backupStep(env));
  },
};

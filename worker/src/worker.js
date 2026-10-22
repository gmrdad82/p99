import { DurableObject } from "cloudflare:workers";
import { composeMail, REPORTER_TEMPLATES } from "./mail.js";
import { mailer, mailPage, mailSettings, openLink, optedOut, optOutLink, optOutToken, reporterCodes, sealCode } from "./mailer.js";
import {
  BOARD_ROUTES,
  RESOLUTIONS,
  LABEL_COLUMNS,
  LABEL_JOIN,
  START_LABEL,
  closeItem,
  publisher,
  redeemTicket,
  liveSockets,
  reopenItem,
  stageOf,
  statusOf,
  storeTicket,
  ticketStream,
  postStreamTicket,
  useKit,
} from "./boards.js";
import { flushHooks, hookRoutes, noteHook, noteLanded } from "./hooks.js";
import { licenseState, linkShown } from "./license.js";
import { deleteGithub, githubDelivery, githubLinks, githubLinksStatement, listGithub, openGithubIssue, putGithub, useKit as useGithubKit } from "./github.js";
import { bindLabels, labelFilters, refuseGone } from "./labels.js";
import { FEED_LIMIT, feedFormat, feedResponse } from "./feed.js";
import { deleteIssue, sweepDeletions, useKit as useDeleteKit } from "./deletes.js";
import { backupStep } from "./backup.js";
import { accessLink, mailLink, relinkCode, useKit as useLinkKit } from "./links.js";
import { assigneeColumn, assigneeEmail, assigneeOf, peopleOf, peopleRoutes, signedPeopleRoutes, usernameFor, useKit as usePeopleKit } from "./people.js";
import { appRequest, isApp, sameText, useKit as useAppKit } from "./standalone.js";
import { ipKey } from "./tries.js";
import { chars, fold, isChars, searchMatch } from "./text.js";
import { ROBOT, actorVia, useKit as useCardKit } from "./cards.js";
import { CARD_READS, cardFilters, cardSide } from "./cards-read.js";
import { CARD_WRITES, patchProject, refuseAgentClose } from "./cards-write.js";
import loaderSource from "./web/p99.js";
import panelSource from "./web/panel.js";
import boardSource from "./web/board.js";
import avatarSource from "./web/avatar.js";
import cssSource from "./web/p99.css";
import concreteSource from "./web/art/concrete.svg";
import concreteDarkSource from "./web/art/concrete-dark.svg";
import lockupDarkSource from "./web/art/lockup-dark.svg";
import badgeFreeSource from "./web/badges/free.svg";
import badgeStudioSource from "./web/badges/studio.svg";
import badgeAgencySource from "./web/badges/agency.svg";
import badgeOwnerSource from "./web/badges/owner.svg";
import badgeFfSource from "./web/badges/ff.svg";
import captureVendor from "./web/vendor/modern-screenshot-4.7.0.js";
import shotSource from "./web/shot.js";

const KEY_IDS = { p99: ["KEY_P99", "KEY_P99_NEXT"], test: ["KEY_TEST"] };
const KIND_PREFIXES = { bug: "BUG", feature: "FEAT", improvement: "IMP", question: "Q", task: "TASK" };
const ENV_KINDS = ["development", "release"];
const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];
const ERROR_CODES = {
  400: "invalid",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "too_large",
  428: "totp_required",
  429: "rate_limited",
  500: "internal",
};

const MAX_SKEW_SECONDS = 60;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_BUILD_BYTES = 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 20000;
const MAX_QUERY_CHARS = 200;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_MARKS = 10;
const MAX_MARK_ELEMENTS = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_ITEM = 30;
const MAX_BUILD_ITEMS = 5000;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 500;
const MAX_FINISH_ITEMS = 5000;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const MAX_CODE_HOSTS = 50;
const SNIFF_BYTES = 1024;
const DAILY_LIMITS = { issues: 30, comments: 200, bytes: 100 * 1024 * 1024 };
const DAILY_PHRASES = { issues: "30 items", comments: "200 comments", bytes: "100 MB of files" };
const MAIL_CAP = 100;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CODE_LENGTH = 12;
const CODE_TTL_MS = 10 * 1000;
const STATIC_CACHE_MAX = 256;
const CODE_CACHE_MAX = 2000;
const CODE_TOUCH_MS = 60 * 60 * 1000;
const TOTP_STEP_SECONDS = 30;
const TOTP_MAX_FAILS = 10;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIRECTORY_TTL_MS = 30 * 1000;
const HUB_NAME = "hub";
const MANAGERS_TOKEN = Symbol("managers");
const REPORTERS_TOKEN = Symbol("reporters");
const MAX_MERGE_ITEMS = 50;

const ATTACHMENT_ROLES = ["screenshot", "page", "region", "file"];
const IMAGE_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const BLOCKED_NAMES = /\.(html?|xhtml|svg|xml|js|mjs|cjs|jar|exe|msi|dll|com|scr|bat|cmd|ps1|vbs|hta|lnk|sh|dmg|app|url|webloc)[.\s]*$/i;
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

const JS_TYPE = "text/javascript; charset=utf-8";
const CAPTURE_SOURCE = `const ms = (() => {\nvar exports = {}, module = {};\n${captureVendor}\nreturn exports;\n})();\n${shotSource}`;
const STATIC_FILES = {
  "/_p99/p99.js": { source: loaderSource, type: JS_TYPE, loader: true },
  "/_p99/panel.js": { source: panelSource, type: JS_TYPE },
  "/_p99/board.js": { source: boardSource, type: JS_TYPE },
  "/_p99/avatar.js": { source: avatarSource, type: JS_TYPE },
  "/_p99/p99.css": { source: cssSource, type: "text/css; charset=utf-8" },
  "/_p99/capture.js": { source: CAPTURE_SOURCE, type: JS_TYPE },
  "/_p99/art/concrete.svg": { source: concreteSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/art/concrete-dark.svg": { source: concreteDarkSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/art/lockup-dark.svg": { source: lockupDarkSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/badges/free.svg": { source: badgeFreeSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/badges/studio.svg": { source: badgeStudioSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/badges/agency.svg": { source: badgeAgencySource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/badges/owner.svg": { source: badgeOwnerSource, type: "image/svg+xml; charset=utf-8" },
  "/_p99/badges/ff.svg": { source: badgeFfSource, type: "image/svg+xml; charset=utf-8" },
};

class Failure extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, message, code) {
  throw new Failure(status, message, code);
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function errorResponse(status, message, code) {
  return json(status, { error: code || ERROR_CODES[status] || "internal", message });
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

let pepperKey = null;

async function codeHash(env, secret) {
  const pepper = env.CODE_PEPPER;
  if (typeof pepper !== "string" || pepper.length === 0) fail(500, "the Worker has no CODE_PEPPER secret; run p99 deploy");
  if (!pepperKey || pepperKey.pepper !== pepper) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    pepperKey = { pepper, key };
  }
  return hex(await crypto.subtle.sign("HMAC", pepperKey.key, encoder.encode(secret)));
}

const encoder = new TextEncoder();

let totpKey = null;

async function totpCipher(env) {
  await codeHash(env, "");
  if (!totpKey || totpKey.pepper !== env.CODE_PEPPER) {
    const base = await crypto.subtle.importKey("raw", encoder.encode(env.CODE_PEPPER), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: encoder.encode("p99 totp"), info: new Uint8Array(0) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    totpKey = { pepper: env.CODE_PEPPER, key };
  }
  return totpKey.key;
}

async function sealTotp(env, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await totpCipher(env), bytes);
  return hex(iv) + "." + hex(sealed);
}

async function openTotp(env, text) {
  const [iv, sealed] = text.split(".");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexBytes(iv) }, await totpCipher(env), hexBytes(sealed)));
}

function base32(bytes) {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

async function totpAt(key, step) {
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = n & 255;
    n = Math.floor(n / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const at = mac[mac.length - 1] & 15;
  const binary = ((mac[at] & 127) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
  return String(binary % 1000000).padStart(6, "0");
}

async function newTotp(env) {
  const secret = crypto.getRandomValues(new Uint8Array(20));
  return { sealed: await sealTotp(env, secret), key: base32(secret) };
}

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

const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function clean(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "") : value;
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
  if (actor.agent !== null && actor.agent !== undefined && typeof actor.agent !== "boolean") return null;
  if (actor.via !== null && actor.via !== undefined && typeof actor.via !== "string") return null;
  const email = actor.email.toLowerCase();
  const agent = actor.agent === true;
  return { email, name: actor.name || email, agent, via: agent ? actorVia(actor.via) : null };
}

function isLocal(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

let directory = null;

async function loadDirectory(env) {
  if (directory && Date.now() - directory.at < DIRECTORY_TTL_MS) return directory;
  const [hosts, envs, mail] = await env.DB.batch([
    env.DB.prepare("SELECT host, env, config_json, created_at FROM hosts ORDER BY host"),
    env.DB.prepare("SELECT name, kind, position, notify FROM envs ORDER BY position, name"),
    env.DB.prepare("SELECT provider, sender FROM mail WHERE id = 1"),
  ]);
  directory = {
    at: Date.now(),
    hosts: new Map(hosts.results.map((r) => [r.host, hostOf(r)])),
    envs: new Map(envs.results.map((r) => [r.name, envOf(r)])),
    mail: mail.results[0] ?? null,
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
    fail(401, "the signature's timestamp is more than a minute away from the Worker's clock; check this computer's clock");
  }
  const actorHeader = request.headers.get("x-p99-actor") ?? "";
  const message = encoder.encode(
    `v1\n${auth[1]}\n${request.method}\n${url.pathname}${url.search}\n${actorHeader}\n${bodyHash}`,
  );
  const signature = hexBytes(auth[2]);
  for (const secret of secrets) {
    let key = signingKeys.get(secret);
    if (!key) {
      key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      signingKeys.set(secret, key);
    }
    if (await crypto.subtle.verify("HMAC", key, signature, message)) {
      return { bodyHash, actorHeader, keyId };
    }
  }
  fail(401, "the signature does not verify");
}

const codeCache = new Map();
const signingKeys = new Map();

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

async function findCode(env, request, hash) {
  const hit = codeCache.get(hash);
  if (hit && Date.now() - hit.at < CODE_TTL_MS) return hit.row;
  if (env.RATE) {
    const ip = ipKey(request.headers.get("cf-connecting-ip") || "?");
    const outcome = await env.RATE.limit({ key: `miss:${ip}` });
    if (!outcome.success) fail(429, "too many requests; try again in a minute");
  }
  const row = await env.DB.prepare("SELECT * FROM codes WHERE hash = ?1").bind(hash).first();
  const entry = row ? { ...row, hosts: parseJson(row.hosts_json, []) } : null;
  codeCache.delete(hash);
  if (codeCache.size >= CODE_CACHE_MAX) codeCache.delete(codeCache.keys().next().value);
  codeCache.set(hash, { at: Date.now(), row: entry });
  return entry;
}

const deviceCache = new Map();

async function trustedDevice(env, code, device) {
  if (!device || !/^[0-9a-f]{32}$/.test(device)) return false;
  const hash = await codeHash(env, "device:" + device);
  const hit = deviceCache.get(hash);
  if (hit && Date.now() - hit.at < CODE_TTL_MS) return hit.code === code.id;
  const row = await env.DB.prepare("SELECT code_id FROM code_devices WHERE token_hash = ?1").bind(hash).first();
  deviceCache.delete(hash);
  if (deviceCache.size >= CODE_CACHE_MAX) deviceCache.delete(deviceCache.keys().next().value);
  deviceCache.set(hash, { at: Date.now(), code: row ? row.code_id : null });
  return Boolean(row) && row.code_id === code.id;
}

async function authoriseCode(env, ctx, request, header, host, now) {
  const [part, device] = typeof header === "string" ? header.split(".", 2) : [];
  const secret = normaliseCode(part);
  if (!secret) fail(401, "a valid X-P99-Code is required");
  const code = await findCode(env, request, await codeHash(env, secret));
  if (!code || code.revoked_at || !code.hosts.includes(host)) fail(401, "this code is not valid here");
  if (!code.sealed_code) {
    code.sealed_code = "sealing";
    ctx.waitUntil(
      sealCode(env, secret)
        .then((sealed) =>
          env.DB.prepare("UPDATE codes SET sealed_code = ?2 WHERE id = ?1 AND sealed_code IS NULL").bind(code.id, sealed).run(),
        )
        .catch(() => {}),
    );
  }
  code.trusted = !code.totp_secret || (await trustedDevice(env, code, device));
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

async function readJsonValue(c, maxBytes) {
  const bytes = await readBody(c.request, maxBytes);
  if (c.signed && (await sha256Hex(bytes)) !== c.bodyHash) fail(401, "the body does not match X-Content-SHA256");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(400, "the body is not valid JSON");
  }
}

async function readJson(c, maxBytes) {
  const value = await readJsonValue(c, maxBytes);
  if (!isObject(value)) fail(400, "the body must be a JSON object");
  return value;
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

function usageQuery(c, field) {
  if (c.manager) return null;
  return c.env.DB.prepare(`SELECT ${field} AS used FROM usage WHERE actor_email = ?1 AND day = ?2`).bind(
    c.actor.email,
    today(c.now),
  );
}

function checkUsage(c, field, amount, row) {
  if (c.manager) return;
  if ((row ? row.used : 0) + amount > DAILY_LIMITS[field]) fail(429, `today's limit of ${DAILY_PHRASES[field]} is reached`);
}

async function firstRows(DB, statements) {
  const live = statements.filter(Boolean);
  const results = live.length > 0 ? await DB.batch(live) : [];
  let next = 0;
  return statements.map((statement) => (statement ? (results[next++].results[0] ?? null) : null));
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

function viaOf(c) {
  return c.actor && c.actor.agent ? (c.actor.via ?? null) : null;
}

function eventStatement(c, itemId, actorEmail, kind, detail, internal = false) {
  return c.env.DB.prepare(
    `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(itemId, actorEmail, kind, JSON.stringify(detail), internal ? 1 : 0, c.now, agentOf(c), viaOf(c));
}

function searchText(title, body) {
  return fold(`${title} ${body ?? ""}`);
}

const ITEM_SELECT = `SELECT i.*, d.kind AS duplicate_kind, ${LABEL_COLUMNS}, ${assigneeColumn()} FROM items i
  LEFT JOIN items d ON d.id = i.duplicate_of ${LABEL_JOIN}`;

function itemKeyId(raw) {
  const id = parseKey(raw);
  if (id === null) fail(404, "no such item");
  return id;
}

function mineClause(email, alias = "i") {
  return `(${alias}.reporter_email = ${email} OR ${alias}.id IN (SELECT duplicate_of FROM items WHERE reporter_email = ${email} AND duplicate_of IS NOT NULL))`;
}

function followStatement(c, id) {
  return c.env.DB.prepare("SELECT 1 AS follows FROM items WHERE duplicate_of = ?1 AND reporter_email = ?2 LIMIT 1").bind(
    id,
    c.actor.email,
  );
}

function isFollower(c, row) {
  return !c.manager && row.reporter_email !== c.actor.email;
}

function allowedItem(c, row, follows = false) {
  if (!row || !inScope(c, row) || (!c.manager && row.reporter_email !== c.actor.email && !follows)) fail(404, "no such item");
  return row;
}

async function loadItem(c, raw) {
  const id = itemKeyId(raw);
  const [row, follow] = await firstRows(c.env.DB, [
    c.env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id),
    c.manager ? null : followStatement(c, id),
  ]);
  return allowedItem(c, row, Boolean(follow));
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
    env.DB.prepare("SELECT item_id, env, sha, at FROM landings WHERE item_id IN (SELECT value FROM json_each(?1))").bind(
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
  const before = landing.envs.length;
  for (const l of lc.landings) {
    if (l.item_id !== itemId || landing.envs.some((e) => e.env === l.env)) continue;
    landing.envs.push({ env: l.env, kind: envKind(lc.dir, l.env), at: l.at, sha: l.sha, version: null });
  }
  if (landing.envs.length > before) {
    const rank = (name) => {
      const i = lc.order.indexOf(name);
      return i < 0 ? lc.order.length : i;
    };
    landing.envs.sort((a, b) => rank(a.env) - rank(b.env));
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
    stage: stageOf(row),
    label: c.manager ? row.label_name : null,
    resolution: row.resolution ?? null,
    project: c.manager ? (row.project ?? null) : null,
    title: row.title,
    host: row.host,
    env: row.origin_env,
    page: { url: row.page_url, path: row.page_path, title: row.page_title },
    reporter: {
      email: c.manager || row.reporter_email === c.actor.email ? row.reporter_email : null,
      name: row.reporter_name,
      agent: Boolean(row.reporter_agent),
      via: row.reporter_agent ? (row.reporter_via ?? null) : null,
    },
    assignee: c.manager ? assigneeOf(row) : null,
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
    duplicate_of: row.duplicate_of === null ? null : keyOf(row.duplicate_kind, row.duplicate_of),
    closed_at: row.closed_at,
    context: parseJson(row.context_json, {}),
    marks: parseJson(row.marks_json, []),
    commits: commitsOf(row.id, lc),
  };
}

function commentOf(row, c, attachmentIds = []) {
  return {
    id: row.id,
    client_uid: row.client_uid,
    author: {
      email: c.manager || row.author_email === c.actor.email ? row.author_email : null,
      name: row.author_name,
      manager: Boolean(row.author_manager),
      agent: Boolean(row.author_agent),
      via: row.author_agent ? (row.author_via ?? null) : null,
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

function eventOf(row, c, names, handles) {
  const open = c.manager || row.actor_email === c.actor.email;
  const name = row.actor_email === null ? null : names.get(row.actor_email) || row.actor_name || null;
  const detail = parseJson(row.detail_json, {});
  if (row.kind === "assignee") {
    for (const end of ["from", "to"]) {
      if (!c.manager) delete detail[end];
      else if (detail[end]) detail[end] = { username: handles.get(String(detail[end]).toLowerCase()) ?? null };
    }
  }
  return {
    actor: open ? row.actor_email : null,
    actor_name: name,
    agent: Boolean(row.actor_agent),
    via: row.actor_agent ? (row.actor_via ?? null) : null,
    kind: row.kind,
    detail,
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
    totp: Boolean(row.totp_secret),
  };
}

async function issueResponse(c, id, status) {
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id),
    ...landingStatements(c.env, [id]),
  ]);
  const row = results[0].results[0];
  return json(status, issueOf({ ...row, unread: 0 }, c, landingContext(results.slice(1, 4), c.dir)));
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

function mailOn(c) {
  return mailSettings(c.env, c.dir.mail) !== null;
}

function sendMail(c, row, recipients, data) {
  if (!mailOn(c)) return;
  const content = {
    key: keyOf(row.kind, row.id),
    kind: row.kind,
    title: row.title,
    actorName: c.actor ? (c.actor.agent ? `${c.actor.name} ${ROBOT}` : c.actor.name) : "P99",
    ...data,
  };
  c.outbox.push({
    item_id: row.id,
    host: row.host ?? null,
    path: row.page_path,
    link: pageLink(row),
    to: recipients,
    template: data.template,
    ref: data.ref,
    content,
  });
}

function hubOf(env) {
  return env.HUB.get(env.HUB.idFromName(HUB_NAME));
}

function push(c, type, row, extra = {}) {
  const event = {
    type,
    key: row ? keyOf(row.kind, row.id) : null,
    host: row ? (row.host ?? null) : (c.scope.host ?? null),
    title: row ? row.title : null,
    by: c.actor ? { name: c.actor.name, agent: Boolean(c.actor.agent), via: viaOf(c) } : null,
    at: c.now,
    ...extra,
  };
  noteHook(c, event);
  if (c.env.HUB) c.pushes.push(event);
}

async function flushPushes(c) {
  try {
    await hubOf(c.env).publish(c.pushes.splice(0));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
  }
}

async function codesRevoked(env) {
  if (!env.HUB) return;
  try {
    await hubOf(env).revoked();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
  }
}

async function openStream(c) {
  if (!c.env.HUB) fail(404, "this Worker has no push yet; run p99 deploy");
  if ((c.request.headers.get("upgrade") || "").toLowerCase() !== "websocket") fail(400, "the stream takes a WebSocket upgrade");
  const target = new URL("https://hub.p99/connect");
  if (!c.scope.all) target.searchParams.set("host", c.scope.host);
  return hubOf(c.env).fetch(new Request(target, c.request));
}

export class P99Hub extends DurableObject {
  #publish;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.#publish = publisher(env.DB, () => this.#sockets());
  }

  async fetch(request) {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response(null, { status: 400 });
    const url = new URL(request.url);
    let hosts = url.searchParams.has("host") ? [url.searchParams.get("host")] : null;
    let code = null;
    if (url.searchParams.has("ticket")) {
      const redeemed = await redeemTicket(this.ctx.storage, url, this.env.DB);
      if (!redeemed) return errorResponse(401, "the stream ticket is unknown, used or expired");
      hosts = redeemed.hosts;
      code = redeemed.code;
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ hosts, code });
    return new Response(null, { status: 101, webSocket: client });
  }

  async ticket(hash, entry) {
    await storeTicket(this.ctx.storage, hash, entry);
  }

  async revoked() {
    await liveSockets(this.env.DB, this.#sockets());
  }

  #sockets() {
    return this.ctx.getWebSockets().map((socket) => [socket, socket.deserializeAttachment() || {}]);
  }

  async publish(events) {
    await this.#publish(events);
  }

  async webSocketMessage() {}

  async webSocketClose(socket, code, reason) {
    try {
      socket.close(code, reason);
    } catch {}
  }

  async webSocketError(socket) {
    try {
      socket.close(1011, "error");
    } catch {}
  }
}

async function reportersOf(DB, ids) {
  const { results } = await DB.prepare(
    `SELECT id AS item_id, reporter_email AS email FROM items WHERE id IN (SELECT value FROM json_each(?1))
     UNION SELECT duplicate_of, reporter_email FROM items WHERE duplicate_of IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify([...new Set(ids)]))
    .all();
  const out = new Map();
  for (const r of results) {
    if (!out.has(r.item_id)) out.set(r.item_id, []);
    out.get(r.item_id).push(r.email);
  }
  return out;
}

function hostLink(host) {
  return Boolean(host) && isHostName(host);
}

function mailable(address, c) {
  return Boolean(address) && !address.endsWith(".invalid") && address !== (c.actor ? c.actor.email : null);
}

async function flushMail(c) {
  const { env } = c;
  try {
    const queued = c.outbox.splice(0);
    let codeManagers = null;
    const reportersWanted = queued.filter((m) => m.to === REPORTERS_TOKEN).map((m) => m.item_id);
    const reporters = reportersWanted.length > 0 ? await reportersOf(env.DB, reportersWanted) : new Map();
    const mails = [];
    for (const mail of queued) {
      let targets = mail.to;
      if (targets === REPORTERS_TOKEN) targets = reporters.get(mail.item_id) || [];
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
    const provider = mailer(env, mailSettings(env, c.dir.mail));
    if (!provider) return;
    const skipped = await optedOut(env.DB, mails);
    const outcomes = mails.map((m) =>
      skipped.has(`${m.item_id} ${m.to}`) ? { ok: false, status: "opted_out" } : { ok: false, status: "capped" },
    );
    const live = mails.map((m, i) => i).filter((i) => !skipped.has(`${mails[i].item_id} ${mails[i].to}`));
    const sending = live.slice(0, Math.min(MAIL_CAP, provider.batch));
    const reporting = sending.map((i) => mails[i]).filter((m) => REPORTER_TEMPLATES.has(m.template) && hostLink(m.host));
    const codes = await reporterCodes(env, reporting);
    const messages = [];
    for (const i of sending) {
      const m = mails[i];
      let link = m.link;
      let optOut = null;
      if (REPORTER_TEMPLATES.has(m.template) && hostLink(m.host)) {
        const code = codes.get(`${m.to} ${m.host}`);
        if (code) link = openLink(m.host, m.path, m.content.key, code);
        optOut = optOutLink(m.host, await optOutToken(env, m.item_id, m.to));
      }
      const theme = c.dir.hosts.get(m.host)?.config.theme;
      messages.push({
        to: m.to,
        ...composeMail({ ...m.content, link, optOut, theme }),
        ...(optOut ? { headers: { "List-Unsubscribe": `<${optOut}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      });
    }
    if (messages.length > 0) {
      const key = await sha256Hex(encoder.encode(sending.map((i) => mails[i]).map((m) => `${m.item_id} ${m.template} ${m.ref} ${m.to}`).join("\n")));
      let outcome;
      try {
        outcome = await provider.send(messages, `p99-${key}`);
        if (!outcome.ok) console.error(`mail batch of ${messages.length} failed with ${outcome.status}`);
      } catch (error) {
        console.error(`mail batch of ${messages.length} failed: ${error.message}`);
        outcome = { ok: false, status: "error" };
      }
      for (const i of sending) outcomes[i] = outcome;
    }
    if (live.length > sending.length) console.error(`${live.length - sending.length} mails over the cap of ${sending.length} were not sent`);
    const events = mails.map((m, i) => ({
      item_id: m.item_id,
      detail: JSON.stringify({ to: m.to, template: m.template, ...outcomes[i] }),
    }));
    await env.DB.prepare(
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
       SELECT json_extract(value, '$.item_id'), ?2, 'mail', json_extract(value, '$.detail'), 1, ?3, ?4, ?5 FROM json_each(?1)`,
    )
      .bind(JSON.stringify(events), c.actor ? c.actor.email : null, c.now, agentOf(c), viaOf(c))
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
  if (!isText(path, 1, 512) || !/^\/(?![\/\\])/.test(path) || /[\\\s\u0000-\u001f\u007f]/.test(path)) return null;
  const title = clean(page.title ?? "");
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
      const selector = clean(element.selector ?? "");
      const label = clean(element.label ?? "");
      const text = clean(element.text ?? "");
      if (!box || !isText(selector, 0, 1000) || !isText(label, 0, 300) || !isText(text, 0, 1000)) return null;
      cleanElements.push({ selector, label, text, box });
    }
    out.push({ rect, viewport, elements: cleanElements });
  }
  return out;
}

function validTitle(value) {
  if (typeof value !== "string") return null;
  const title = clean(value).replace(/\s+/g, " ").trim();
  return isChars(title, 1, MAX_TITLE_CHARS) ? title : null;
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
    try {
      for (const p of value.off) RegExp(offSource(p));
    } catch {
      return null;
    }
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
  if (value.feed !== undefined && value.feed !== null) {
    if (typeof value.feed !== "boolean") return null;
    if (value.feed) out.feed = true;
  }
  if (value.link !== undefined && value.link !== null) {
    if (typeof value.link !== "boolean") return null;
    if (!value.link) out.link = false;
  }
  if (utf8Bytes(JSON.stringify(out)) > MAX_CONFIG_BYTES) return null;
  return out;
}

function offSource(p) {
  return `^${p.replace(/[\\^$.?+(){}|[\]]/g, "\\$&").replace(/\*\*?/g, (m) => (m[1] ? ".*" : "[^/]*"))}/?$`;
}

function placementOf(config) {
  const out = {};
  if (config.corner) out.c = config.corner;
  if (config.offset) out.o = config.offset;
  if (config.above) out.a = config.above;
  if (config.off && config.off.length) out.f = config.off.map(offSource);
  if (config.theme && config.theme.accent) {
    out.t = config.theme.accent;
    if (legibleOnDark(out.t)) out.l = 1;
  }
  return out;
}

function luminance(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!hex) return null;
  const digits = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(digits.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function legibleOnDark(color) {
  const glyph = luminance(color);
  return glyph !== null && (glyph + 0.05) / (luminance("#2a3b50") + 0.05) >= 3;
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

const staticCache = new Map();

async function serveStatic(request, env, url) {
  const file = STATIC_FILES[url.pathname];
  if (!file || (request.method !== "GET" && request.method !== "HEAD")) fail(404, "no such file");
  const dir = await loadDirectory(env);
  const host = dir.hosts.get(url.hostname);
  if (!host) fail(404, "no such host");
  const version = env.VERSION || "dev";
  const placement = file.loader ? scriptJson(placementOf(host.config)) : "";
  const key = `${url.pathname}|${version}|${placement}`;
  let text = staticCache.get(key);
  if (text === undefined) {
    text = file.source.split("__P99_VERSION__").join(version);
    if (file.loader) text = text.split("__P99_HOST__").join(placement);
    if (staticCache.size >= STATIC_CACHE_MAX) staticCache.delete(staticCache.keys().next().value);
    staticCache.set(key, text);
  }
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
  if (!c.dir.envs.has(envName) && !(await c.env.DB.prepare("SELECT 1 FROM envs WHERE name = ?1").bind(envName).first())) {
    fail(400, `no environment is called ${envName}; p99 hosts add <host> --env ${envName} makes one`);
  }
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
    const subject = typeof entry.subject === "string" ? clean(entry.subject).slice(0, 300) : "";
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
    if (envKind(c.dir, envName) === "release") noteLanded(c, landed, envName, body.version);
  }
  return new Response(null, { status: 204 });
}

async function announceLandings(c, envName, body, landed) {
  const known = c.dir.envs.get(envName);
  if (!known || !known.notify || !mailOn(c)) return;
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, title, host, origin_env, page_path, reporter_email FROM items WHERE id IN (SELECT value FROM json_each(?1))",
  )
    .bind(JSON.stringify(landed))
    .all();
  for (const row of results) {
    sendMail(c, row, REPORTERS_TOKEN, { template: "landed", env: envName, version: body.version, ref: `${envName}-${body.sha}` });
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
    statement("SELECT count(*) AS n FROM items i", scoped(() => [mineClause("?1"), "i.open = 1"], [email])),
    statement(
      "SELECT count(*) AS n FROM items i LEFT JOIN reads r ON r.actor_email = ?1 AND r.item_id = i.id",
      scoped(() => [mineClause("?1"), `${activity} > COALESCE(r.read_at, '')`], [email]),
    ),
  ];
  if (path !== null) {
    statements.push(
      statement(
        "SELECT count(*) AS n FROM items i",
        scoped((q) => {
          const where = [`i.page_path = ${q.bind(path)}`, "i.open = 1"];
          if (!c.manager) where.push(mineClause(q.bind(email)));
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
  const [counts, username] = await Promise.all([countsFor(c, c.url.searchParams.get("path")), usernameFor(c)]);
  const config = c.hostRow.config;
  return json(200, {
    name: c.actor.name,
    email: c.actor.email,
    username,
    manager: c.manager,
    host: c.hostRow.host,
    env: c.hostRow.env,
    version: c.env.VERSION || "dev",
    counts,
    theme: config.theme || {},
    strings: config.strings || {},
    link: linkShown(c.env, config),
    license: licenseState(c.env),
  });
}

async function listIssues(c) {
  requireEmptyBody(c);
  const params = c.url.searchParams;
  const scope = params.get("scope") || "mine";
  const where = [];
  const q = query([c.actor.email]);
  if (scope === "mine") {
    where.push(mineClause("?1"));
  } else if (scope === "all") {
    requireManager(c);
  } else if (scope === "page") {
    const path = params.get("path");
    if (!isText(path, 1, 512)) fail(400, "scope page needs a path");
    where.push(`i.page_path = ${q.bind(path)}`);
    if (!c.manager) where.push(mineClause("?1"));
  } else {
    fail(400, "scope must be mine, all or page");
  }
  const hostScope = scopeClause(c, q);
  if (hostScope) where.push(hostScope);
  await labelFilters(c, params, q, where);
  cardFilters(c, params, q, where);
  const status = params.get("status") || "any";
  const asked = status === "open" || status === "closed" || status === "any" ? null : statusOf(status);
  if (status === "open") where.push("i.open = 1");
  else if (status === "closed") where.push("i.open = 0");
  else if (asked && asked.role === "done") {
    where.push("i.open = 0");
    if (asked.resolution && status !== "done") where.push(`i.resolution = ${q.bind(asked.resolution)}`);
  } else if (asked) where.push(`i.open = 1 AND i.label_id = (SELECT id FROM labels WHERE role = ${q.bind(asked.role)})`);
  else if (status !== "any") fail(400, "status must be open, closed, any or a status key; label= keeps one label");
  if (params.has("board")) fail(400, "items sit on no board; a board shows the items whose label is one of its columns");
  const kind = params.get("kind");
  if (kind) {
    if (!KIND_PREFIXES[kind]) fail(400, "kind is not known");
    where.push(`i.kind = ${q.bind(kind)}`);
  }
  const text = (params.get("q") || "").trim();
  if (chars(text) > MAX_QUERY_CHARS) fail(400, `q must be at most ${MAX_QUERY_CHARS} characters`);
  if (text.length > 0) {
    const match = searchMatch("i.search_text", text, (v) => q.bind(v));
    const id = parseKey(text);
    where.push(id !== null ? `(i.id = ${q.bind(id)} OR ${match})` : `(${match})`);
  }
  const counting = {
    sql: `SELECT COUNT(*) AS n FROM items i ${LABEL_JOIN} LEFT JOIN reads r ON r.actor_email = ?1 AND r.item_id = i.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    binds: [...q.binds],
  };
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
  const sql = `SELECT i.id, i.kind, i.open, i.resolution, i.project, i.title, i.host, i.origin_env, i.page_url, i.page_path,
      i.page_title, i.reporter_email, i.reporter_name, i.reporter_agent, i.reporter_via, i.assignee, i.created_at, i.updated_at,
      i.comment_count, i.public_comment_count, i.attachment_count, i.public_attachment_count, ${LABEL_COLUMNS},
      ${assigneeColumn()}, ${activity} > COALESCE(r.read_at, '') AS unread
    FROM items i ${LABEL_JOIN} LEFT JOIN reads r ON r.actor_email = ?1 AND r.item_id = i.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY i.id DESC LIMIT ${q.bind(limit + 1)}`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...q.binds)
    .all();
  const page = results.slice(0, limit);
  const ids = page.map((row) => row.id);
  const extra = page.length > 0 ? await c.env.DB.batch(landingStatements(c.env, ids)) : [];
  const lc = page.length > 0 ? landingContext(extra.slice(0, 3), c.dir) : emptyLandingContext(c.dir);
  const more = results.length > limit;
  const answer = {
    issues: page.map((row) => summaryOf(row, c, lc)),
    next_cursor: more ? String(page[page.length - 1].id) : null,
  };
  if (!cursor) answer.total = more ? (await c.env.DB.prepare(counting.sql).bind(...counting.binds).first()).n : page.length;
  return json(200, answer);
}

function creationTarget(c, body) {
  if (c.browser) return { host: c.hostRow.host, env: c.hostRow.env };
  const name = (c.scope.all ? null : c.scope.host) ?? body.host;
  const host = typeof name === "string" ? c.dir.hosts.get(name) : null;
  if (!host) fail(400, "host must name a listed host");
  return { host: host.host, env: host.env };
}

function reporterJson(c) {
  return JSON.stringify({ email: c.actor.email, name: c.actor.name, agent: Boolean(c.actor.agent) });
}

async function createIssue(c) {
  const body = await readJson(c, MAX_JSON_BYTES);
  if (!isUid(body.client_uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const { DB } = c.env;
  const [existing, used] = await firstRows(DB, [
    DB.prepare("SELECT id, reporter_email FROM items WHERE client_uid = ?1").bind(body.client_uid),
    usageQuery(c, "issues"),
  ]);
  if (existing) {
    if (existing.reporter_email !== c.actor.email) fail(409, "client_uid is already used");
    return issueResponse(c, existing.id, 200);
  }
  if (!KIND_PREFIXES[body.kind]) fail(400, "kind must be bug, feature, improvement, question or task");
  if (body.kind === "task") requireManager(c);
  const title = validTitle(body.title);
  if (title === null) fail(400, `title must be 1 to ${MAX_TITLE_CHARS} characters`);
  const text = clean(body.body ?? "");
  if (!isChars(text, 0, MAX_BODY_CHARS)) fail(400, `body must be at most ${MAX_BODY_CHARS} characters`);
  const page = validPage(body.page);
  if (!page) fail(400, "page must have an http(s) url, a path starting with / and a title");
  const context = body.context ?? {};
  if (!isObject(context)) fail(400, "context must be an object");
  const contextJson = JSON.stringify(context);
  if (utf8Bytes(contextJson) > MAX_CONTEXT_BYTES) fail(413, "context is larger than 64 KB");
  const marks = validMarks(body.marks);
  if (marks === null) fail(400, `marks must be at most ${MAX_MARKS} marks with rect, viewport and elements`);
  const target = creationTarget(c, body);
  page.url = `https://${target.host}${page.path}`;
  checkUsage(c, "issues", 1, used);
  const byUid = "FROM items WHERE client_uid = ?1";
  const reporter = reporterJson(c);
  let results;
  try {
    results = await DB.batch([
      DB.prepare(
        `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, page_url, page_path, page_title,
           reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at,
           created_at, updated_at, host, reporter_agent, search_text, reporter_via)
         VALUES (?1, ?2, ${START_LABEL}, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?14, ?14, ?15, ?16, ?17, ?18)
         RETURNING id, (SELECT name FROM labels WHERE role = 'inbox') AS label_name`,
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
        viaOf(c),
      ),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT id, ?2, 'created', ?3, 0, ?4, ?5, ?6 ${byUid}`,
      ).bind(body.client_uid, c.actor.email, JSON.stringify({ kind: body.kind, title }), c.now, agentOf(c), viaOf(c)),
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
  const { id, label_name } = results[0].results[0];
  const row = {
    id,
    kind: body.kind,
    open: 1,
    label_name,
    label_role: "inbox",
    label_closes: 0,
    resolution: null,
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
    reporter_via: viaOf(c),
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
  push(c, "item", row, { label: label_name });
  return json(201, issueOf(row, c, emptyLandingContext(c.dir)));
}

async function getIssue(c, rawKey) {
  requireEmptyBody(c);
  const id = itemKeyId(rawKey);
  const { DB } = c.env;
  const visible = c.manager ? "" : " AND internal = 0";
  const landing = landingStatements(c.env, [id]);
  const parts = [
    ["item", DB.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id)],
    ["comments", DB.prepare(`SELECT * FROM comments WHERE item_id = ?1${visible} ORDER BY id`).bind(id)],
    ["files", DB.prepare(`SELECT * FROM attachments WHERE item_id = ?1 AND stored_at IS NOT NULL${visible} ORDER BY id`).bind(id)],
    [
      "events",
      DB.prepare(
        `SELECT *, (SELECT name FROM codes WHERE email = events.actor_email ORDER BY id DESC LIMIT 1) AS actor_name
         FROM events WHERE item_id = ?1${visible} ORDER BY id`,
      ).bind(id),
    ],
    ...landing.map((statement, at) => [`landing${at}`, statement]),
    [
      "read",
      DB.prepare(
        `INSERT INTO reads (actor_email, item_id, read_at)
         SELECT ?1, id, ?3 FROM items WHERE id = ?2 AND (?4 OR host = ?5) AND (?6 OR ${mineClause("?1", "items")})
         ON CONFLICT (actor_email, item_id) DO UPDATE SET read_at = excluded.read_at`,
      ).bind(c.actor.email, id, c.now, c.scope.all ? 1 : 0, c.scope.host, c.manager ? 1 : 0),
    ],
    ["merged", mergedStatement(c, id)],
    ...(c.manager ? [["github", githubLinksStatement(c, id)]] : []),
  ];
  const batched = await DB.batch(parts.map(([, statement]) => statement));
  const results = Object.fromEntries(parts.map(([name], at) => [name, batched[at]]));
  const mergedRows = results.merged.results;
  const row = allowedItem(c, results.item.results[0] ?? null, mergedRows.some((m) => m.reporter_email === c.actor.email));
  const follower = isFollower(c, row);
  const [comments, files, events] = [results.comments, results.files, results.events].map((r) => r.results);
  const attachments = follower ? files.filter((a) => a.comment_id !== null) : files;
  const lc = landingContext(landing.map((_, at) => results[`landing${at}`]), c.dir);
  const byComment = new Map();
  for (const a of attachments) {
    if (a.comment_id === null) continue;
    if (!byComment.has(a.comment_id)) byComment.set(a.comment_id, []);
    byComment.get(a.comment_id).push(a.id);
  }
  const names = new Map([[c.actor.email, c.actor.name], [row.reporter_email, row.reporter_name]]);
  for (const cm of comments) names.set(cm.author_email, cm.author_name);
  const assigned = c.manager ? events.filter((ev) => ev.kind === "assignee").map((ev) => parseJson(ev.detail_json, {})) : [];
  const orphan = c.manager && row.assignee && !row.assignee_username ? [row.assignee] : [];
  const handles = await peopleOf(DB, assigned.flatMap((d) => [d.from, d.to]).concat(orphan).filter(Boolean).map((email) => ({ email })), c.now);
  if (orphan.length > 0) row.assignee_username = handles.get(row.assignee) ?? null;
  const issue = {
    ...issueOf({ ...row, unread: 0 }, c, lc),
    github: c.manager ? githubLinks(results.github) : [],
    merged: mergedOf(mergedRows, c),
  };
  if (follower) Object.assign(issue, { body: "", context: {}, marks: [] });
  return json(200, {
    issue,
    comments: comments.map((cm) => commentOf(cm, c, byComment.get(cm.id) || [])),
    attachments: attachments.map(attachmentOf),
    events: events.map((ev) => eventOf(ev, c, names, handles)),
  });
}

function mergedStatement(c, id) {
  return c.env.DB.prepare(
    "SELECT id, kind, title, host, reporter_email, reporter_name, reporter_agent, reporter_via FROM items WHERE duplicate_of = ?1 ORDER BY id",
  ).bind(id);
}

function mergedOf(rows, c) {
  return rows
    .filter((r) => c.manager || r.reporter_email === c.actor.email)
    .map((r) => ({
      key: keyOf(r.kind, r.id),
      title: r.title,
      host: r.host,
      reporter: {
        email: r.reporter_email,
        name: r.reporter_name,
        agent: Boolean(r.reporter_agent),
        via: r.reporter_agent ? (r.reporter_via ?? null) : null,
      },
    }));
}

async function postMerge(c) {
  requireManager(c);
  const body = await readJson(c, MAX_JSON_BYTES);
  const into = parseKey(body.into);
  if (into === null) fail(400, "into must name an item");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_MERGE_ITEMS) {
    fail(400, `items must list 1 to ${MAX_MERGE_ITEMS} items`);
  }
  const named = new Map();
  for (const raw of body.items) {
    const id = parseKey(raw);
    if (id === null) fail(400, `${String(raw).slice(0, 40)} is not an item key`);
    if (id === into) fail(400, "an item cannot merge into itself");
    named.set(id, String(raw));
  }
  const { DB } = c.env;
  const { results } = await DB.prepare(`${ITEM_SELECT} WHERE i.id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify([into, ...named.keys()]))
    .all();
  const byId = new Map(results.map((r) => [r.id, r]));
  const target = byId.get(into);
  if (!target || !inScope(c, target)) fail(404, `no such item ${String(body.into).slice(0, 40)}`);
  const targetKey = keyOf(target.kind, target.id);
  if (target.duplicate_of !== null) {
    fail(409, `${targetKey} is merged into ${keyOf(target.duplicate_kind, target.duplicate_of)}; merge into that one`);
  }
  const sources = [...named].map(([id, raw]) => {
    const row = byId.get(id);
    if (!row || !inScope(c, row)) fail(404, `no such item ${raw.slice(0, 40)}`);
    return row;
  });
  const folded = (r) => r.duplicate_of === into && !r.open && r.resolution === "duplicate";
  const moving = sources.filter((r) => !folded(r));
  for (const row of moving) refuseAgentClose(c, row, { closes: 1 });
  const actor = c.actor.email;
  const statements = [];
  for (const row of moving) {
    const key = keyOf(row.kind, row.id);
    statements.push(
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT id, ?2, 'merge', json_object('into', ?3), 0, ?4, ?5, ?6 FROM items WHERE duplicate_of = ?1`,
      ).bind(row.id, actor, targetKey, c.now, agentOf(c), viaOf(c)),
      DB.prepare("UPDATE items SET duplicate_of = ?2, updated_at = ?3 WHERE duplicate_of = ?1").bind(row.id, into, c.now),
      DB.prepare("UPDATE items SET duplicate_of = ?2 WHERE id = ?1").bind(row.id, into),
      eventStatement(c, row.id, actor, "merge", { into: targetKey }),
      eventStatement(c, into, actor, "merge", { item: key }),
    );
  }
  if (statements.length > 0) {
    statements.push(
      DB.prepare("UPDATE items SET updated_at = ?2, activity_at = ?2, public_activity_at = ?2 WHERE id = ?1").bind(into, c.now),
      readStatement(c, into),
    );
    await DB.batch(statements);
  }
  for (const row of moving) {
    await closeItem(c, { ...row, duplicate_of: into }, "duplicate", { duplicateOf: into, mergedInto: targetKey });
  }
  if (moving.length > 0) push(c, "change", target, { what: ["merged"] });
  return json(200, {
    into: targetKey,
    merged: moving.map((r) => keyOf(r.kind, r.id)),
    unchanged: sources.filter(folded).map((r) => keyOf(r.kind, r.id)),
  });
}

async function patchIssue(c, rawKey) {
  const body = await readJson(c, MAX_JSON_BYTES);
  refuseGone(body);
  const row = await loadItem(c, rawKey);
  if (Object.prototype.hasOwnProperty.call(body, "project")) return patchProject(c, row, body);
  const reporter = row.reporter_email === c.actor.email;
  const fresh = Boolean(row.open) && row.label_role === "inbox";
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const next = { kind: row.kind, assignee: row.assignee, title: row.title, body: row.body };
  if (has("title")) {
    if (!c.manager && !(reporter && fresh)) fail(403, "the title can no longer be changed");
    next.title = validTitle(body.title);
    if (next.title === null) fail(400, `title must be 1 to ${MAX_TITLE_CHARS} characters`);
  }
  if (has("body")) {
    if (!c.manager && !(reporter && fresh)) fail(403, "only a manager, or the reporter while the item is new, may change the details");
    const text = clean(body.body);
    if (!isChars(text, 0, MAX_BODY_CHARS)) fail(400, `body must be at most ${MAX_BODY_CHARS} characters`);
    next.body = text;
  }
  if (has("kind")) {
    requireManager(c);
    if (!KIND_PREFIXES[body.kind]) fail(400, "kind is not known");
    next.kind = body.kind;
  }
  if (has("assignee")) {
    requireManager(c);
    next.assignee = await assigneeEmail(c, row, body.assignee);
  }
  let duplicateOf = row.duplicate_of;
  if (has("duplicate_of")) {
    requireManager(c);
    if (body.duplicate_of === null) {
      if (row.resolution === "duplicate" && !has("resolution")) fail(400, "a duplicate needs duplicate_of");
      duplicateOf = null;
    } else {
      const target = parseKey(body.duplicate_of);
      if (target === null || target === row.id) fail(400, "duplicate_of must name another item");
      const exists = await c.env.DB.prepare("SELECT id, host, origin_env FROM items WHERE id = ?1").bind(target).first();
      if (!exists || !inScope(c, exists)) fail(400, "duplicate_of names no item");
      duplicateOf = target;
    }
  }
  let wanted;
  let role = null;
  if (has("status")) {
    const legacy = statusOf(body.status, body.resolution ?? undefined);
    if (!legacy) fail(400, "status is not known; set the label with POST /move");
    if (legacy.role === "done") wanted = legacy.resolution;
    else {
      role = legacy.role;
      if (!row.open) wanted = null;
    }
  } else if (has("resolution")) wanted = body.resolution;
  else if (has("duplicate_of") && duplicateOf !== null) wanted = "duplicate";
  if (wanted === "fixed" && has("duplicate_of") && duplicateOf !== null && !has("resolution")) wanted = "duplicate";
  if (wanted !== undefined && wanted !== null && !RESOLUTIONS.includes(wanted)) fail(400, "resolution must be fixed, abandoned, duplicate or null");
  if (wanted === "duplicate" && duplicateOf === null) fail(400, "a duplicate needs duplicate_of");
  const reopening = wanted === null && !row.open;
  const closing = wanted !== undefined && wanted !== null && (row.open || wanted !== row.resolution || duplicateOf !== row.duplicate_of);
  if (reopening && !c.manager && !(reporter && row.resolution === "fixed" && (role ?? "inbox") === "inbox")) fail(403, "this change is not allowed");
  if (closing && !c.manager && !(reporter && wanted === "abandoned" && row.open)) fail(403, "this change is not allowed");
  if (closing) refuseAgentClose(c, row, { closes: 1 });

  const statements = [];
  const actor = c.actor.email;
  if (next.kind !== row.kind) statements.push(eventStatement(c, row.id, actor, "kind", { from: row.kind, to: next.kind }));
  if (next.assignee !== row.assignee) {
    statements.push(eventStatement(c, row.id, actor, "assignee", { from: row.assignee, to: next.assignee }));
  }
  if (next.title !== row.title) statements.push(eventStatement(c, row.id, actor, "title", { from: row.title, to: next.title }));
  if (next.body !== row.body) statements.push(eventStatement(c, row.id, actor, "body", { from: row.body, to: next.body }));
  if (statements.length > 0) {
    statements.unshift(
      c.env.DB.prepare(
        `UPDATE items SET kind = ?2, assignee = ?3, title = ?4, body = ?5, updated_at = ?6, activity_at = ?6, search_text = ?7
         WHERE id = ?1`,
      ).bind(row.id, next.kind, next.assignee, next.title, next.body, c.now, searchText(next.title, next.body)),
    );
    statements.push(readStatement(c, row.id));
    await c.env.DB.batch(statements);
    push(c, "change", { ...row, kind: next.kind, title: next.title }, {
      what: ["kind", "assignee", "title", "body"].filter((f) => next[f] !== (row[f] ?? null)),
    });
  }
  const current = { ...row, ...next };
  if (closing) await closeItem(c, current, wanted, { duplicateOf });
  else if (reopening) await reopenItem(c, current, role ?? "inbox");
  else if (role !== null && role !== row.label_role) {
    requireManager(c);
    await reopenItem(c, current, role);
  }
  return issueResponse(c, row.id, 200);
}

async function postComment(c, rawKey) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const row = await loadItem(c, rawKey);
  if (!isUid(body.client_uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const { DB } = c.env;
  const [existing, used] = await firstRows(DB, [
    DB.prepare("SELECT * FROM comments WHERE client_uid = ?1").bind(body.client_uid),
    usageQuery(c, "comments"),
  ]);
  if (existing) {
    if (existing.author_email !== c.actor.email || existing.item_id !== row.id) fail(409, "client_uid is already used");
    return json(200, commentOf(existing, c, await commentAttachmentIds(c, row.id, existing.id)));
  }
  const text = clean(body.body);
  if (typeof text !== "string" || text.trim().length === 0 || !isChars(text, 0, MAX_BODY_CHARS)) {
    fail(400, `body must be 1 to ${MAX_BODY_CHARS} characters`);
  }
  const internal = body.internal === true;
  if (body.internal !== undefined && typeof body.internal !== "boolean") fail(400, "internal must be a boolean");
  if (internal) requireManager(c);
  checkUsage(c, "comments", 1, used);
  let results;
  try {
    results = await DB.batch([
      DB.prepare(
        `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal,
           origin_env, created_at, author_agent, author_via)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         RETURNING *`,
      ).bind(
        row.id,
        body.client_uid,
        c.actor.email,
        c.actor.name,
        c.manager ? 1 : 0,
        text,
        internal ? 1 : 0,
        actionEnv(c, row),
        c.now,
        agentOf(c),
        viaOf(c),
      ),
      DB.prepare(
        `UPDATE items SET comment_count = comment_count + 1,
           public_comment_count = public_comment_count + ?2,
           activity_at = ?3, updated_at = ?3,
           public_activity_at = CASE WHEN ?2 THEN ?3 ELSE public_activity_at END
         WHERE id = ?1`,
      ).bind(row.id, internal ? 0 : 1, c.now),
      DB.prepare(
        `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
         SELECT ?1, ?2, 'comment', json_object('comment_id', id, 'internal', json(?3)), ?4, ?5, ?7, ?8
         FROM comments WHERE client_uid = ?6`,
      ).bind(row.id, c.actor.email, internal ? "true" : "false", internal ? 1 : 0, c.now, body.client_uid, agentOf(c), viaOf(c)),
      readStatement(c, row.id),
      usageStatement(c, "comments", 1),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await DB.prepare("SELECT * FROM comments WHERE client_uid = ?1").bind(body.client_uid).first();
    if (!raced || raced.author_email !== c.actor.email || raced.item_id !== row.id) fail(409, "client_uid is already used");
    return json(200, commentOf(raced, c, await commentAttachmentIds(c, row.id, raced.id)));
  }
  const inserted = results[0].results[0];
  push(c, "comment", row, { internal });
  if (!c.manager) {
    sendMail(c, row, MANAGERS_TOKEN, { template: "comment_to_managers", body: text, ref: `comment-${inserted.id}` });
  } else if (!internal) {
    sendMail(c, row, REPORTERS_TOKEN, { template: "comment_to_reporter", body: text, ref: `comment-${inserted.id}` });
  }
  return json(201, commentOf(inserted, c));
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

function typeMessage(role, type) {
  const shown = type || "a file with no type";
  if (role === "file") return `P99 takes images, PDFs, text, CSV, JSON, zip and office files, not ${shown}`;
  return `a ${role} must be a WebP, PNG or JPEG image, not ${shown}`;
}

async function storeReserved(c, reserved, made, length) {
  try {
    return await streamToBucket(c, reserved.r2_key, length, reserved.type, reserved.name, reserved.mark);
  } catch (error) {
    if (made) {
      await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?1 AND stored_at IS NULL").bind(reserved.id).run().catch(() => {});
    }
    throw error;
  }
}

async function putAttachment(c, rawKey, rawUid) {
  const row = await loadItem(c, rawKey);
  if (isFollower(c, row) && !c.url.searchParams.get("comment")) fail(404, "no such item");
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
  const params = c.url.searchParams;
  const commentParam = params.get("comment");
  const [found, comment, used] = await firstRows(DB, [
    byUid,
    commentParam
      ? DB.prepare("SELECT id, internal, author_email FROM comments WHERE id = ?1 AND item_id = ?2").bind(
          Number(commentParam) || 0,
          row.id,
        )
      : null,
    usageQuery(c, "bytes"),
  ]);
  let reserved = found;
  let made = false;
  if (reserved) {
    reserved = await settled(reserved);
    if (reserved instanceof Response) return reserved;
  }
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
  if (BLOCKED_NAMES.test(name)) fail(400, "the file's name must not end in an executable or web page extension");
  const type = (c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (role === "file" ? !FILE_SIGNATURES[type] : !IMAGE_TYPES.has(type)) {
    fail(400, typeMessage(role, type));
  }
  let commentId = null;
  let internal = false;
  if (commentParam) {
    if (!comment || (comment.internal && !c.manager) || (!c.manager && comment.author_email !== c.actor.email)) {
      fail(404, "no such comment on this item");
    }
    commentId = comment.id;
    internal = Boolean(comment.internal);
  }
  const declared = c.request.headers.get("content-length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) fail(400, "Content-Length is required");
  const length = Number(declared);
  if (length > MAX_FILE_BYTES) fail(413, "a file may be at most 20 MB");
  if (length === 0 || !c.request.body) fail(400, "the file is empty");
  if (row.attachment_count >= MAX_FILES_PER_ITEM) fail(409, `an item holds at most ${MAX_FILES_PER_ITEM} files`);
  checkUsage(c, "bytes", length, used);
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
    made = Boolean(reserved);
    if (!reserved) {
      const raced = await settled(await byUid.first());
      if (raced instanceof Response) return raced;
      reserved = raced;
    }
  }
  if (reserved.bytes !== length) fail(400, "Content-Length differs from the first attempt with this client_uid");
  const sha256 = await storeReserved(c, reserved, made, length);
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
      `INSERT INTO events (item_id, actor_email, kind, detail_json, internal, at, actor_agent, actor_via)
       SELECT ?3, ?4, 'attachment', ?5, ?6, ?7, ?8, ?9 WHERE ${mine}`,
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
      viaOf(c),
    ),
    DB.prepare(
      `INSERT INTO usage (actor_email, day, bytes) SELECT ?3, ?4, ?5 WHERE ${mine}
       ON CONFLICT (actor_email, day) DO UPDATE SET bytes = bytes + excluded.bytes`,
    ).bind(reserved.id, token, c.actor.email, today(c.now), length),
    readStatement(c, row.id),
  ]);
  if (results[0].meta.changes === 1) push(c, "attachment", row, { internal: Boolean(reserved.internal) });
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
    `SELECT a.*, i.reporter_email, i.host,
       EXISTS (SELECT 1 FROM items d WHERE d.duplicate_of = i.id AND d.reporter_email = ?2) AS follows
     FROM attachments a JOIN items i ON i.id = a.item_id
     WHERE a.id = ?1 AND a.stored_at IS NOT NULL`,
  )
    .bind(Number(rawId), c.actor.email)
    .first();
  if (!row || !inScope(c, row)) fail(404, "no such file");
  const seen = row.reporter_email === c.actor.email || (row.follows && row.comment_id !== null);
  if (!c.manager && (!seen || row.internal)) fail(404, "no such file");
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
  const [put] = await DB.batch([
    DB.prepare(
      `INSERT INTO hosts (host, env, config_json, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (host) DO UPDATE SET env = excluded.env, config_json = excluded.config_json
       RETURNING host, env, config_json, created_at`,
    ).bind(host, body.env, JSON.stringify(config), c.now),
  ]);
  const row = put.results[0];
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
  const uid = body.client_uid ?? null;
  if (uid !== null && !isUid(uid)) fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const { DB } = c.env;
  const minted = async () => {
    const row = await DB.prepare("SELECT * FROM codes WHERE client_uid = ?1").bind(uid).first();
    if (row && row.created_by !== c.actor.email) fail(409, "client_uid is already used");
    return row && json(200, { code: codeOf(row) });
  };
  if (uid !== null) {
    const done = await minted();
    if (done) return done;
  }
  const name = clean(body.name);
  if (!isText(name, 1, 200) || name.trim().length === 0) fail(400, "name must be 1 to 200 characters");
  if (!isEmail(body.email)) fail(400, "email must be an e-mail address");
  if (!Array.isArray(body.hosts) || body.hosts.length === 0 || body.hosts.length > MAX_CODE_HOSTS) {
    fail(400, `hosts must list 1 to ${MAX_CODE_HOSTS} hosts`);
  }
  const hosts = [...new Set(body.hosts.map((h) => String(h).toLowerCase()))];
  for (const host of hosts) if (!c.dir.hosts.has(host)) fail(400, `${host} is not a listed host`);
  const manager = body.manager ?? false;
  if (typeof manager !== "boolean") fail(400, "manager must be a boolean");
  const wantsTotp = body.totp ?? false;
  if (typeof wantsTotp !== "boolean") fail(400, "totp must be a boolean");
  const wantsMail = body.mail ?? false;
  if (typeof wantsMail !== "boolean") fail(400, "mail must be a boolean");
  const totp = wantsTotp ? await newTotp(c.env) : null;
  const secret = newSecret();
  const hash = await codeHash(c.env, secret);
  const sealed = await sealCode(c.env, secret);
  let row;
  try {
    row = await DB.prepare(
      `INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by, client_uid, totp_secret, sealed_code)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       RETURNING *`,
    )
      .bind(hash, secret.slice(-4), name.trim(), body.email.toLowerCase(), JSON.stringify(hosts), manager ? 1 : 0, c.now, c.actor.email, uid, totp && totp.sealed, sealed)
      .first();
  } catch (error) {
    if (uid === null || !isUniqueViolation(error)) throw error;
    const raced = await minted();
    if (!raced) throw error;
    return raced;
  }
  codeCache.delete(hash);
  await peopleOf(DB, [row], c.now);
  const mail = wantsMail ? await mailLink(c, row, secret, false) : null;
  return json(201, {
    code: codeOf(row),
    secret,
    links: hosts.map((host) => accessLink(host, secret)),
    ...(totp ? { totp_key: totp.key } : {}),
    ...(mail ? { mail } : {}),
  });
}

async function renamePerson(c) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const from = typeof body.from === "string" ? body.from.trim().toLowerCase() : "";
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!isEmail(from) || !isEmail(to)) fail(400, "from and to must be e-mail addresses");
  if (from === to) fail(400, "from and to are the same e-mail");
  const { DB } = c.env;
  const run = (sql) => DB.prepare(sql).bind(from, to);
  const results = await DB.batch([
    run("UPDATE items SET reporter_email = ?2 WHERE reporter_email = ?1"),
    run("UPDATE items SET assignee = ?2 WHERE assignee = ?1"),
    run("UPDATE comments SET author_email = ?2 WHERE author_email = ?1"),
    run("UPDATE events SET actor_email = ?2 WHERE actor_email = ?1"),
    run("UPDATE attachments SET actor_email = ?2 WHERE actor_email = ?1"),
    run("UPDATE codes SET email = ?2 WHERE email = ?1"),
    run("UPDATE codes SET created_by = ?2 WHERE created_by = ?1"),
    run("UPDATE OR IGNORE reads SET actor_email = ?2 WHERE actor_email = ?1"),
    run("DELETE FROM reads WHERE actor_email = ?1 AND ?2 = ?2"),
    run("UPDATE OR IGNORE usage SET actor_email = ?2 WHERE actor_email = ?1"),
    run("DELETE FROM usage WHERE actor_email = ?1 AND ?2 = ?2"),
    run("UPDATE OR IGNORE people SET email = ?2 WHERE email = ?1"),
    run("DELETE FROM people WHERE email = ?1 AND ?2 = ?2"),
  ]);
  codeCache.clear();
  const n = (i) => (results[i].meta && results[i].meta.changes) || 0;
  return json(200, { from, to, items: n(0), assigned: n(1), comments: n(2), events: n(3), attachments: n(4), codes: n(5) });
}

async function postCodeTotp(c, rawId) {
  requireEmptyBody(c);
  const totp = await newTotp(c.env);
  const { DB } = c.env;
  const [updated] = await DB.batch([
    DB.prepare("UPDATE codes SET totp_secret = ?2, totp_step = 0, totp_fails = 0 WHERE id = ?1 AND revoked_at IS NULL RETURNING *").bind(
      Number(rawId),
      totp.sealed,
    ),
    DB.prepare("DELETE FROM code_devices WHERE code_id = ?1").bind(Number(rawId)),
    DB.prepare("DELETE FROM app_sessions WHERE code_id = ?1").bind(Number(rawId)),
  ]);
  const row = updated.results[0];
  codeCache.clear();
  deviceCache.clear();
  if (!row) fail(404, "no such code, or it is revoked");
  return json(200, { code: codeOf(row), totp_key: totp.key });
}

async function postVerify(c) {
  const body = await readJson(c, MAX_JSON_BYTES);
  const typed = typeof body.totp === "string" ? body.totp.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(typed)) fail(400, "the code is 6 digits");
  const { DB } = c.env;
  const row = await DB.prepare("SELECT totp_secret, totp_step, totp_fails FROM codes WHERE id = ?1").bind(c.code.id).first();
  if (!row || !row.totp_secret) fail(400, "this code has no authenticator to check");
  if (row.totp_fails >= TOTP_MAX_FAILS) fail(403, "too many wrong codes; ask for your authenticator to be set up again");
  const key = await crypto.subtle.importKey("raw", await openTotp(c.env, row.totp_secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const now = Math.floor(Date.parse(c.now) / 1000 / TOTP_STEP_SECONDS);
  let matched = null;
  for (const step of [now - 1, now, now + 1]) {
    if (step > row.totp_step && sameText(await totpAt(key, step), typed)) matched = step;
  }
  if (matched === null) {
    await DB.prepare("UPDATE codes SET totp_fails = totp_fails + 1 WHERE id = ?1").bind(c.code.id).run();
    const left = TOTP_MAX_FAILS - row.totp_fails - 1;
    if (left <= 0) fail(403, "too many wrong codes; ask for your authenticator to be set up again");
    fail(400, "that code doesn't match; check your device's clock and try the next one");
  }
  const device = hex(crypto.getRandomValues(new Uint8Array(16)));
  const [claimed] = await DB.batch([
    DB.prepare("UPDATE codes SET totp_step = ?2, totp_fails = 0 WHERE id = ?1 AND totp_step < ?2").bind(c.code.id, matched),
    DB.prepare(
      "INSERT INTO code_devices (code_id, token_hash, created_at) SELECT ?1, ?2, ?3 WHERE changes() > 0",
    ).bind(c.code.id, await codeHash(c.env, "device:" + device), c.now),
  ]);
  if (!claimed.meta || claimed.meta.changes !== 1) fail(400, "that code was just used; wait for the next one");
  return json(201, { device });
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
  await codesRevoked(c.env);
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

const IMPORT_TYPES = ["item", "comment", "attachment", "event", "landing", "read", "manager"];

function importHost(c) {
  if (c.keyId !== "p99") fail(403, "only the account's key imports");
  const name = c.url.searchParams.get("host");
  const host = name ? c.dir.hosts.get(name.toLowerCase()) : null;
  if (!host) fail(400, "host must name a listed host");
  return host;
}

function importStamp(value, what) {
  const ms = typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) fail(400, `${what} must be a date and time`);
  return new Date(ms).toISOString();
}

function optionalStamp(value, what) {
  return value === undefined || value === null ? null : importStamp(value, what);
}

function importRef(value, what = "item") {
  const id = typeof value === "string" || typeof value === "number" ? parseKey(value) : null;
  if (id === null) fail(400, `${what} must be a key such as BUG-3`);
  return id;
}

function importUid(value) {
  if (!isUid(value)) fail(400, "uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  return value;
}

function importEmail(value, what) {
  if (!isEmail(value)) fail(400, `${what} must be an e-mail address`);
  return value.trim().toLowerCase();
}

function importFlag(value, what) {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") fail(400, `${what} must be a boolean`);
  return value;
}

function importVia(value, agent, what) {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, `${what} must be a string`);
  return agent ? actorVia(value) : null;
}

function importPerson(value, what) {
  if (!isObject(value)) fail(400, `${what} must be an object with an email`);
  const email = importEmail(value.email, `${what}.email`);
  const name = value.name ?? "";
  if (!isText(name, 0, 200)) fail(400, `${what}.name must be at most 200 characters`);
  const agent = importFlag(value.agent, `${what}.agent`);
  return {
    email,
    name: name.trim() || email,
    agent,
    via: importVia(value.via, agent, `${what}.via`),
    manager: importFlag(value.manager, `${what}.manager`),
  };
}

function importPage(page, host) {
  if (page === undefined || page === null) return { url: `https://${host}/`, path: "/", title: "" };
  if (!isObject(page)) fail(400, "page must be an object");
  let path = page.path;
  if (path === undefined || path === null) {
    try {
      path = page.url ? new URL(page.url).pathname : "/";
    } catch {
      path = "/";
    }
  }
  const valid = validPage({ url: page.url ?? `https://${host}${path}`, path, title: page.title ?? "" });
  if (!valid) fail(400, "page must have an http(s) url, a path starting with / and a title of at most 300 characters");
  return valid;
}

function importItem(r, host) {
  const match = typeof r.key === "string" ? /^([A-Za-z]{1,10})-(\d{1,15})$/.exec(r.key.trim()) : null;
  const id = match ? Number(match[2]) : 0;
  if (!match || !Number.isSafeInteger(id) || id < 1) fail(400, "key must be a key such as BUG-3");
  if (!KIND_PREFIXES[r.kind]) fail(400, "kind must be bug, feature, improvement, question or task");
  if (KIND_PREFIXES[r.kind] !== match[1].toUpperCase()) fail(400, `a ${r.kind} is keyed ${KIND_PREFIXES[r.kind]}-<number>`);
  const asked = statusOf(r.status ?? "inbox", r.resolution ?? null);
  if (!asked) fail(400, "status is not known");
  const role = asked.role;
  const resolution = role === "done" ? (asked.resolution ?? (r.duplicate_of ? "duplicate" : "fixed")) : null;
  const title = validTitle(r.title);
  if (title === null) fail(400, `title must be 1 to ${MAX_TITLE_CHARS} characters`);
  const body = clean(r.body ?? "");
  if (!isChars(body, 0, MAX_BODY_CHARS)) fail(400, `body must be at most ${MAX_BODY_CHARS} characters`);
  const env = r.env ?? host.env;
  if (!isEnvName(env)) fail(400, "env must name an environment");
  const context = r.context ?? {};
  if (!isObject(context)) fail(400, "context must be an object");
  const contextJson = JSON.stringify(context);
  if (utf8Bytes(contextJson) > MAX_CONTEXT_BYTES) fail(413, "context is larger than 64 KB");
  const marks = validMarks(r.marks);
  if (marks === null) fail(400, `marks must be at most ${MAX_MARKS} marks with rect, viewport and elements`);
  const createdAt = importStamp(r.created_at, "created_at");
  const updatedAt = optionalStamp(r.updated_at, "updated_at") ?? createdAt;
  const open = role !== "done";
  return {
    type: "item",
    ref: keyOf(r.kind, id),
    id,
    kind: r.kind,
    role,
    resolution,
    open,
    title,
    body,
    reporter: importPerson(r.reporter, "reporter"),
    assignee: r.assignee === undefined || r.assignee === null ? null : importEmail(r.assignee, "assignee"),
    env,
    page: importPage(r.page, host.host),
    contextJson,
    marksJson: JSON.stringify(marks),
    createdAt,
    updatedAt,
    closedAt: open ? null : (optionalStamp(r.closed_at, "closed_at") ?? updatedAt),
    duplicateOf: r.duplicate_of === undefined || r.duplicate_of === null ? null : importRef(r.duplicate_of, "duplicate_of"),
  };
}

function importRecord(r, host) {
  if (!isObject(r) || !IMPORT_TYPES.includes(r.type)) fail(400, `type must be one of ${IMPORT_TYPES.join(", ")}`);
  if (r.type === "item") return importItem(r, host);
  if (r.type === "manager") {
    const email = importEmail(r.email, "email");
    return { type: "manager", ref: email, email };
  }
  const item = importRef(r.item);
  if (r.type === "comment") {
    const uid = importUid(r.uid);
    const body = clean(r.body);
    if (typeof body !== "string" || body.trim().length === 0 || !isChars(body, 0, MAX_BODY_CHARS)) {
      fail(400, `body must be 1 to ${MAX_BODY_CHARS} characters`);
    }
    return {
      type: "comment",
      ref: uid,
      item,
      uid,
      author: importPerson(r.author, "author"),
      body,
      internal: importFlag(r.internal, "internal"),
      createdAt: importStamp(r.created_at, "created_at"),
    };
  }
  if (r.type === "attachment") {
    const uid = importUid(r.uid);
    const comment = r.comment === undefined || r.comment === null ? null : importUid(r.comment);
    return { type: "attachment", ref: uid, item, uid, comment };
  }
  if (r.type === "event") {
    if (typeof r.kind !== "string" || !/^[a-z][a-z_]{0,39}$/.test(r.kind)) {
      fail(400, "kind must be 1 to 40 lowercase letters or underscores");
    }
    const actor = r.actor ?? null;
    if (actor !== null && !isObject(actor)) fail(400, "actor must be an object or null");
    const email = actor && actor.email !== undefined && actor.email !== null ? importEmail(actor.email, "actor.email") : null;
    const detail = r.detail ?? {};
    if (!isObject(detail)) fail(400, "detail must be an object");
    const detailJson = JSON.stringify(detail);
    if (utf8Bytes(detailJson) > MAX_CONTEXT_BYTES) fail(413, "detail is larger than 64 KB");
    const at = importStamp(r.at, "at");
    return {
      type: "event",
      ref: `${item} ${r.kind} ${at}`,
      item,
      email,
      agent: actor ? importFlag(actor.agent, "actor.agent") : false,
      via: actor ? importVia(actor.via, importFlag(actor.agent, "actor.agent"), "actor.via") : null,
      kind: r.kind,
      detailJson,
      internal: importFlag(r.internal, "internal"),
      at,
    };
  }
  if (r.type === "landing") {
    if (!isEnvName(r.env)) fail(400, "env must name an environment");
    if (!isText(r.sha, 7, 64) || !/^[0-9a-fA-F]+$/.test(r.sha)) fail(400, "sha must be a hex commit id");
    return { type: "landing", ref: `${item} ${r.env}`, item, env: r.env, sha: r.sha.toLowerCase(), at: importStamp(r.at, "at") };
  }
  const email = importEmail(r.email, "email");
  return { type: "read", ref: `${item} ${email}`, item, email, at: importStamp(r.at, "at") };
}

function recountStatement(DB, ids) {
  const stored = "a.item_id = items.id AND a.stored_at IS NOT NULL";
  return DB.prepare(
    `UPDATE items SET
       comment_count = (SELECT count(*) FROM comments c WHERE c.item_id = items.id),
       public_comment_count = (SELECT count(*) FROM comments c WHERE c.item_id = items.id AND c.internal = 0),
       attachment_count = (SELECT count(*) FROM attachments a WHERE ${stored}),
       public_attachment_count = (SELECT count(*) FROM attachments a WHERE ${stored} AND a.internal = 0),
       activity_at = max(activity_at,
         COALESCE((SELECT max(created_at) FROM comments c WHERE c.item_id = items.id), ''),
         COALESCE((SELECT max(created_at) FROM attachments a WHERE ${stored}), '')),
       public_activity_at = max(public_activity_at,
         COALESCE((SELECT max(created_at) FROM comments c WHERE c.item_id = items.id AND c.internal = 0), ''),
         COALESCE((SELECT max(created_at) FROM attachments a WHERE ${stored} AND a.internal = 0), ''))
     WHERE id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify([...new Set(ids)]));
}

function importLookups(DB, records) {
  const of = (type) => records.filter((r) => r.type === type);
  const ids = records.flatMap((r) => (r.type === "item" ? [r.id, r.duplicateOf ?? r.id] : r.item ? [r.item] : []));
  const commentUids = [...of("comment").map((r) => r.uid), ...of("attachment").flatMap((r) => (r.comment ? [r.comment] : []))];
  const list = (values) => JSON.stringify([...new Set(values)]);
  const tuples = (type, fields) => JSON.stringify(of(type).map((r) => fields.map((f) => r[f])));
  const at = (i) => `json_extract(j.value, '$[${i}]')`;
  return DB.batch([
    DB.prepare("SELECT id, title, host FROM items WHERE id IN (SELECT value FROM json_each(?1))").bind(list(ids)),
    DB.prepare("SELECT client_uid, item_id FROM comments WHERE client_uid IN (SELECT value FROM json_each(?1))").bind(list(commentUids)),
    DB.prepare("SELECT client_uid, item_id, stored_at FROM attachments WHERE client_uid IN (SELECT value FROM json_each(?1))").bind(
      list(of("attachment").map((r) => r.uid)),
    ),
    DB.prepare(
      `SELECT DISTINCT e.item_id, e.kind, e.at FROM events e JOIN json_each(?1) j
       ON e.item_id = ${at(0)} AND e.kind = ${at(1)} AND e.at = ${at(2)}`,
    ).bind(tuples("event", ["item", "kind", "at"])),
    DB.prepare(`SELECT l.item_id, l.env FROM landings l JOIN json_each(?1) j ON l.item_id = ${at(0)} AND l.env = ${at(1)}`).bind(
      tuples("landing", ["item", "env"]),
    ),
    DB.prepare(`SELECT r.item_id, r.actor_email FROM reads r JOIN json_each(?1) j ON r.item_id = ${at(0)} AND r.actor_email = ${at(1)}`).bind(
      tuples("read", ["item", "email"]),
    ),
    DB.prepare(
      `SELECT DISTINCT lower(email) AS email FROM codes
       WHERE manager = 1 AND revoked_at IS NULL AND lower(email) IN (SELECT value FROM json_each(?1))`,
    ).bind(list(of("manager").map((r) => r.email))),
  ]);
}

function importItemStatement(DB, r, host) {
  return DB.prepare(
    `INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
       reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json,
       search_text, activity_at, public_activity_at, created_at, updated_at, closed_at, resolution, reporter_via)
     VALUES (?1, ?2, ?3, (SELECT id FROM labels WHERE role = ?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
       (SELECT id FROM items WHERE id = ?18), ?19, ?20, ?21, ?22, ?22, ?23, ?22, ?24, ?25, ?26)`,
  ).bind(
    r.id,
    `import-${r.id}`,
    r.kind,
    r.role,
    r.open ? 1 : 0,
    r.title,
    r.body,
    r.env,
    host,
    r.page.url,
    r.page.path,
    r.page.title,
    r.reporter.email,
    r.reporter.name,
    JSON.stringify({ email: r.reporter.email, name: r.reporter.name, agent: r.reporter.agent }),
    r.reporter.agent ? 1 : 0,
    r.assignee,
    r.duplicateOf,
    r.contextJson,
    r.marksJson,
    searchText(r.title, r.body),
    r.updatedAt,
    r.createdAt,
    r.closedAt,
    r.resolution,
    r.reporter.via,
  );
}


function importCommentStatement(DB, r) {
  return DB.prepare(
    `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env,
       created_at, author_agent, author_via)
     SELECT id, ?2, ?3, ?4, ?5, ?6, ?7, origin_env, ?8, ?9, ?10 FROM items WHERE id = ?1`,
  ).bind(r.item, r.uid, r.author.email, r.author.name, r.author.manager ? 1 : 0, r.body, r.internal ? 1 : 0, r.createdAt, r.author.agent ? 1 : 0, r.author.via);
}

function importRowStatement(DB, r) {
  if (r.type === "event") {
    return DB.prepare(
      "INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at, actor_via) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    ).bind(r.item, r.email, r.agent ? 1 : 0, r.kind, r.detailJson, r.internal ? 1 : 0, r.at, r.via);
  }
  if (r.type === "landing") {
    return DB.prepare("INSERT INTO landings (item_id, env, sha, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING").bind(
      r.item,
      r.env,
      r.sha,
      r.at,
    );
  }
  return DB.prepare("INSERT INTO reads (actor_email, item_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING").bind(
    r.email,
    r.item,
    r.at,
  );
}

function naturalKey(r) {
  if (r.type === "event") return `event ${r.item} ${r.kind} ${r.at}`;
  if (r.type === "landing") return `landing ${r.item} ${r.env}`;
  return `read ${r.item} ${r.email}`;
}

async function postImport(c) {
  const hostRow = importHost(c);
  const host = hostRow.host;
  const dry = c.url.searchParams.get("dry_run") === "1";
  const raw = await readJsonValue(c, MAX_IMPORT_BYTES);
  if (!Array.isArray(raw) || raw.length > MAX_IMPORT_RECORDS) {
    fail(400, `the body must be an array of at most ${MAX_IMPORT_RECORDS} records`);
  }
  const records = raw.map((r, i) => {
    try {
      return importRecord(r, hostRow);
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
      fail(error.status, `record ${i + 1}${isObject(r) && typeof r.type === "string" ? ` (${r.type})` : ""}: ${error.message}`);
    }
  });
  const { DB } = c.env;
  const [items, comments, attachments, events, landings, reads, codes] = (await importLookups(DB, records)).map((r) => r.results);
  const known = new Map(items.map((r) => [r.id, { title: r.title, host: r.host }]));
  const commentItems = new Map(comments.map((r) => [r.client_uid, r.item_id]));
  const files = new Map(attachments.map((r) => [r.client_uid, r]));
  const seen = new Set([
    ...events.map((r) => `event ${r.item_id} ${r.kind} ${r.at}`),
    ...landings.map((r) => `landing ${r.item_id} ${r.env}`),
    ...reads.map((r) => `read ${r.item_id} ${r.actor_email}`),
  ]);
  const managers = new Set([...codes.map((r) => r.email), ...managersOf(c.env)]);
  const counts = Object.fromEntries(IMPORT_TYPES.map((t) => [t, { new: 0, existing: 0, conflicts: [] }]));
  const upload = [];
  const missing = [];
  const touched = [];
  const statements = [];
  const conflict = (r, reason) => counts[r.type].conflicts.push({ ref: r.ref, reason });
  const itemReady = (r) => {
    const target = known.get(r.item);
    if (!target) {
      if (!dry) conflict(r, `no item ${r.item} on ${host}`);
      return dry;
    }
    if (target.host !== host) {
      conflict(r, `item ${r.item} belongs to ${target.host}`);
      return false;
    }
    return true;
  };
  for (const r of records) {
    const tally = counts[r.type];
    if (r.type === "item") {
      const found = known.get(r.id);
      if (found && found.title === r.title) tally.existing += 1;
      else if (found) conflict(r, `${r.ref} already exists with the title "${found.title}"`);
      else {
        known.set(r.id, { title: r.title, host });
        tally.new += 1;
        statements.push(importItemStatement(DB, r, host));
      }
    } else if (r.type === "manager") {
      if (managers.has(r.email)) tally.existing += 1;
      else {
        managers.add(r.email);
        missing.push(r.email);
        tally.new += 1;
      }
    } else if (!itemReady(r)) {
      continue;
    } else if (r.type === "comment") {
      const owner = commentItems.get(r.uid);
      if (owner === r.item) tally.existing += 1;
      else if (owner !== undefined) conflict(r, `uid ${r.uid} is a comment on item ${owner}`);
      else {
        commentItems.set(r.uid, r.item);
        tally.new += 1;
        touched.push(r.item);
        statements.push(importCommentStatement(DB, r));
      }
    } else if (r.type === "attachment") {
      const found = files.get(r.uid);
      const onComment = r.comment ? commentItems.get(r.comment) : r.item;
      if (found && found.item_id !== r.item) conflict(r, `uid ${r.uid} is a file of item ${found.item_id}`);
      else if (onComment !== undefined && onComment !== r.item) conflict(r, `comment ${r.comment} is on item ${onComment}`);
      else if (onComment === undefined && !dry) conflict(r, `no comment ${r.comment}`);
      else if (found && found.stored_at) tally.existing += 1;
      else {
        tally.new += 1;
        upload.push(r.uid);
      }
    } else if (seen.has(naturalKey(r))) {
      tally.existing += 1;
    } else {
      seen.add(naturalKey(r));
      tally.new += 1;
      statements.push(importRowStatement(DB, r));
    }
  }
  if (!dry && statements.length > 0) {
    if (touched.length > 0) statements.push(recountStatement(DB, touched));
    await DB.batch(statements);
    await peopleOf(DB, records.filter((r) => r.type === "item" && r.assignee).map((r) => ({ email: r.assignee })), c.now);
    push(c, "import", null, { host, items: counts.item.new, comments: counts.comment.new });
  }
  return json(200, { dry_run: dry, counts, upload, managers: missing });
}

async function finishImport(c) {
  const host = importHost(c).host;
  const body = await readJson(c, MAX_IMPORT_BYTES);
  const keys = body.items ?? [];
  const pairs = body.duplicates ?? [];
  if (!Array.isArray(keys) || keys.length > MAX_FINISH_ITEMS) fail(400, `items must list at most ${MAX_FINISH_ITEMS} keys`);
  if (!Array.isArray(pairs) || pairs.length > MAX_FINISH_ITEMS) fail(400, `duplicates must list at most ${MAX_FINISH_ITEMS} pairs`);
  const ids = keys.map((k) => importRef(k));
  const links = pairs.map((p) => {
    if (!isObject(p)) fail(400, "a duplicate is {item, duplicate_of}");
    return [importRef(p.item), importRef(p.duplicate_of, "duplicate_of")];
  });
  const { DB } = c.env;
  const { results } = await DB.prepare("SELECT id, host, duplicate_of FROM items WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify([...new Set([...ids, ...links.flat()])]))
    .all();
  const rows = new Map(results.map((r) => [r.id, r]));
  const conflicts = [];
  const linked = [];
  for (const [item, target] of links) {
    const row = rows.get(item);
    if (!row || row.host !== host) conflicts.push({ ref: String(item), reason: `no item ${item} on ${host}` });
    else if (!rows.has(target)) conflicts.push({ ref: String(item), reason: `duplicate_of names no item ${target}` });
    else if (row.duplicate_of === null) linked.push([item, target]);
  }
  const mine = ids.filter((id) => rows.has(id) && rows.get(id).host === host);
  const statements = linked.map(([item, target]) =>
    DB.prepare("UPDATE items SET duplicate_of = ?2 WHERE id = ?1 AND duplicate_of IS NULL").bind(item, target),
  );
  if (mine.length > 0) statements.push(recountStatement(DB, mine));
  if (statements.length > 0) await DB.batch(statements);
  return json(200, { recounted: mine.length, duplicates: { linked: linked.length, conflicts } });
}

async function putImportAttachment(c, rawUid) {
  const host = importHost(c).host;
  const params = c.url.searchParams;
  const settle = async (status, found) => {
    if (c.request.body) await c.request.body.cancel().catch(() => {});
    if (status === 409) fail(409, "uid is already a file of another item");
    return json(200, attachmentOf(found));
  };
  const uid = decodeURIComponentSafe(rawUid);
  if (!isUid(uid)) fail(400, "uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const itemId = parseKey(params.get("item") || "");
  if (itemId === null) fail(400, "item must be a key such as BUG-3");
  const { DB } = c.env;
  const row = await DB.prepare("SELECT id, host, marks_json, reporter_email, origin_env FROM items WHERE id = ?1").bind(itemId).first();
  if (!row || row.host !== host) fail(404, "no such item");
  const byUid = DB.prepare("SELECT * FROM attachments WHERE client_uid = ?1").bind(uid);
  let reserved = await byUid.first();
  let made = false;
  if (reserved && reserved.item_id !== row.id) return settle(409);
  if (reserved && reserved.stored_at) return settle(200, reserved);
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
  if (BLOCKED_NAMES.test(name)) fail(400, "the file's name must not end in an executable or web page extension");
  const type = (c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (role === "file" ? !FILE_SIGNATURES[type] : !IMAGE_TYPES.has(type)) {
    fail(400, typeMessage(role, type));
  }
  let commentId = null;
  let actor = row.reporter_email;
  let internal = ["1", "true"].includes(params.get("internal") || "");
  const commentUid = params.get("comment");
  if (commentUid) {
    const comment = await DB.prepare("SELECT id, internal, author_email FROM comments WHERE client_uid = ?1 AND item_id = ?2")
      .bind(commentUid, row.id)
      .first();
    if (!comment) fail(404, "no such comment on this item");
    commentId = comment.id;
    actor = comment.author_email;
    internal = internal || Boolean(comment.internal);
  }
  const createdAt = params.get("created_at") ? importStamp(params.get("created_at"), "created_at") : c.now;
  const declared = c.request.headers.get("content-length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) fail(400, "Content-Length is required");
  const length = Number(declared);
  if (length > MAX_FILE_BYTES) fail(413, "a file may be at most 20 MB");
  if (length === 0 || !c.request.body) fail(400, "the file is empty");
  const stored = await DB.prepare("SELECT count(*) AS n FROM attachments WHERE item_id = ?1 AND stored_at IS NOT NULL")
    .bind(row.id)
    .first();
  if (stored.n >= MAX_FILES_PER_ITEM) fail(409, `an item holds at most ${MAX_FILES_PER_ITEM} files`);
  if (!reserved) {
    reserved = await DB.prepare(
      `INSERT INTO attachments (item_id, client_uid, comment_id, internal, role, name, type, bytes, sha256, r2_key,
         actor_email, origin_env, created_at, mark)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT (client_uid) DO NOTHING
       RETURNING *`,
    )
      .bind(row.id, uid, commentId, internal ? 1 : 0, role, name, type, length, c.bodyHash, `issues/${row.id}/${uid}`, actor, row.origin_env, createdAt, mark)
      .first();
    made = Boolean(reserved);
    if (!reserved) reserved = await byUid.first();
    if (!reserved || reserved.item_id !== row.id) return settle(409);
    if (reserved.stored_at) return settle(200, reserved);
  }
  if (reserved.bytes !== length) fail(400, "Content-Length differs from the first attempt with this uid");
  const sha256 = await storeReserved(c, reserved, made, length);
  await DB.batch([
    DB.prepare("UPDATE attachments SET stored_at = ?2, stored_token = ?3, sha256 = ?4 WHERE id = ?1 AND stored_at IS NULL").bind(
      reserved.id,
      c.now,
      crypto.randomUUID(),
      sha256,
    ),
    recountStatement(DB, [row.id]),
  ]);
  return json(201, attachmentOf({ ...reserved, sha256 }));
}

bindLabels({ fail, requireManager });

const ITEM_ROUTES = [
  ["GET", /^\/issues$/, listIssues],
  ["POST", /^\/issues$/, createIssue],
  ["GET", /^\/issues\/([^/]+)$/, getIssue],
  ["PATCH", /^\/issues\/([^/]+)$/, patchIssue],
  ["DELETE", /^\/issues\/([^/]+)$/, deleteIssue],
  ["POST", /^\/issues\/([^/]+)\/comments$/, postComment],
  ["PUT", /^\/issues\/([^/]+)\/attachments\/([^/]+)$/, putAttachment],
  ["GET", /^\/files\/(\d{1,15})$/, getFile],
  ["POST", /^\/merge$/, postMerge],
];

const CARD_ROUTES = [...CARD_READS, ...CARD_WRITES];

const BROWSER_ROUTES = [
  ["GET", /^\/me$/, getMe],
  ["POST", /^\/verify$/, postVerify],
  ...ITEM_ROUTES,
  ...BOARD_ROUTES,
  ...CARD_ROUTES,
  ["POST", /^\/stream-ticket$/, postStreamTicket],
  ...peopleRoutes(),
];

const HOOK_KIT = {
  fail,
  json,
  readJson,
  requireEmptyBody,
  requireManager,
  decodeURIComponentSafe,
  isHostName,
  isLocal,
  parseKey,
  keyOf,
  pageLink,
  maxJson: MAX_JSON_BYTES,
};

const SIGNED_ROUTES = [
  ["POST", /^\/builds$/, postBuilds, { actor: false }],
  ["GET", /^\/counts$/, getCounts, { listed: true }],
  ["GET", /^\/stream$/, openStream, { listed: true }],
  ...ITEM_ROUTES.map(([method, pattern, handler]) => [method, pattern, handler, { listed: handler === listIssues }]),
  ...BOARD_ROUTES.map(([method, pattern, handler]) => [method, pattern, handler, { listed: true }]),
  ...CARD_ROUTES.map(([method, pattern, handler]) => [method, pattern, handler, { listed: true }]),
  ["GET", /^\/hosts$/, listHosts, {}],
  ["PUT", /^\/hosts\/([^/]+)$/, putHost, {}],
  ["DELETE", /^\/hosts\/([^/]+)$/, deleteHost, {}],
  ["GET", /^\/envs$/, listEnvs, {}],
  ["PUT", /^\/envs\/([^/]+)$/, putEnv, {}],
  ["GET", /^\/codes$/, listCodes, {}],
  ["POST", /^\/codes$/, postCode, {}],
  ["POST", /^\/codes\/(\d{1,15})\/revoke$/, revokeCode, {}],
  ["POST", /^\/codes\/(\d{1,15})\/totp$/, postCodeTotp, {}],
  ["POST", /^\/codes\/(\d{1,15})\/relink$/, relinkCode, {}],
  ["POST", /^\/people\/rename$/, renamePerson, {}],
  ...signedPeopleRoutes(),
  ["GET", /^\/admin\/backup-status$/, backupStatus, {}],
  ["POST", /^\/import$/, postImport, {}],
  ["POST", /^\/import\/finish$/, finishImport, {}],
  ["PUT", /^\/import\/attachments\/([^/]+)$/, putImportAttachment, {}],
  ...hookRoutes(HOOK_KIT),
  ["GET", /^\/github$/, listGithub, {}],
  ["PUT", /^\/github\/([^/]+)$/, putGithub, {}],
  ["DELETE", /^\/github\/([^/]+)$/, deleteGithub, {}],
  ["POST", /^\/issues\/([^/]+)\/github$/, openGithubIssue, {}],
];

useKit({
  MAX_JSON_BYTES,
  encoder,
  cardSide,
  clean,
  eventStatement,
  fail,
  hex,
  hubOf,
  isObject,
  isText,
  isUniqueViolation,
  json,
  keyOf,
  loadDirectory,
  parseKey,
  readJson,
  refuseAgentClose,
  requireEmptyBody,
  requireManager,
  sendMail,
  sha256Hex,
  REPORTERS_TOKEN,
});

useCardKit({
  ITEM_SELECT,
  MAX_BODY_CHARS,
  MAX_JSON_BYTES,
  MAX_TITLE_CHARS,
  KIND_PREFIXES,
  clean,
  eventStatement,
  fail,
  firstRows,
  isText,
  isUid,
  isUniqueViolation,
  issueResponse,
  json,
  keyOf,
  loadItem,
  parseKey,
  postComment,
  push,
  query,
  readJson,
  readStatement,
  requireEmptyBody,
  requireManager,
  runHandler,
  searchText,
  summaryOf,
  validTitle,
});

useGithubKit({
  encoder,
  eventStatement,
  fail,
  hexBytes,
  isObject,
  isUniqueViolation,
  json,
  keyOf,
  loadDirectory,
  loadItem,
  pageLink,
  parseJson,
  push,
  readBody,
  readJson,
  requireEmptyBody,
  runHandler,
  sha256Hex,
});

usePeopleKit({ fail, json, managersOf, isUniqueViolation, readJson, requireEmptyBody, requireManager, maxJson: MAX_JSON_BYTES });

useDeleteKit({ fail, json, keyOf, loadItem, push, requireEmptyBody, requireManager });

useLinkKit({
  codeHash,
  codeOf,
  fail,
  forgetCodes: () => codeCache.clear(),
  codesRevoked,
  isEmail,
  isUid,
  json,
  maxJson: MAX_JSON_BYTES,
  newSecret,
  newTotp,
  parseJson,
  readJson,
  sealCode,
});

useAppKit({
  Failure,
  browserRun,
  codeHash,
  encoder,
  errorResponse,
  fail,
  isEmail,
  json,
  loadDirectory,
  managersOf,
  mineClause,
  openTotp,
  parseJson,
  readJson,
  sealTotp,
  staticFiles: STATIC_FILES,
  ticketStream,
  totpAt,
  totpMaxFails: TOTP_MAX_FAILS,
  totpStepSeconds: TOTP_STEP_SECONDS,
});

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
  if (c.pushes.length > 0) c.ctx.waitUntil(flushPushes(c));
  if (c.hooked && c.hooked.length > 0) c.ctx.waitUntil(flushHooks(c, HOOK_KIT));
  return response;
}

async function browserRequest(request, env, ctx, url, path) {
  const dir = await loadDirectory(env);
  const hostRow = dir.hosts.get(url.hostname);
  if (!hostRow) fail(404, "no such host");
  const now = new Date().toISOString();
  const code = await authoriseCode(env, ctx, request, request.headers.get("x-p99-code"), hostRow.host, now);
  return browserRun(request, env, ctx, url, path, dir, hostRow, code, now);
}

function browserRun(request, env, ctx, url, path, dir, hostRow, code, now) {
  const found = findRoute(BROWSER_ROUTES, request.method, path);
  if (!found) fail(404, "no such route");
  if (!code.trusted && found.route[2] !== postVerify) fail(428, "enter the 6-digit code from your authenticator app");
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
    code,
    actor: { email: code.email.toLowerCase(), name: code.name, agent: false, via: null },
    manager: Boolean(code.manager) || managersOf(env).includes(code.email.toLowerCase()),
    scope: { all: false, host: hostRow.host },
    hostRow,
    actionEnv: hostRow.env,
    now,
    outbox: [],
    pushes: [],
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
    keyId: signed.keyId,
    actor,
    manager: Boolean(actor),
    scope: { all, host: all ? null : host },
    hostRow: null,
    actionEnv: null,
    now: new Date().toISOString(),
    outbox: [],
    pushes: [],
  };
  return runHandler(c, found.route[2], found.args);
}

async function serveFeed(request, env, ctx, url) {
  const dir = await loadDirectory(env);
  const host = dir.hosts.get(url.hostname);
  if (!host || !host.config.feed) fail(404, "no such file");
  const format = feedFormat(url);
  if (!format) fail(400, "format must be atom or json");
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheKey = new Request(`https://${host.host}/_p99/feed?format=${format}`);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return hit;
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.kind, i.title, MIN(l.at) AS at FROM landings l
     JOIN items i ON i.id = l.item_id
     LEFT JOIN envs e ON e.name = l.env
     WHERE i.host = ?1 AND COALESCE(e.kind, 'release') = 'release'
     GROUP BY i.id ORDER BY at DESC, i.id DESC LIMIT ?2`,
  )
    .bind(host.host, FEED_LIMIT)
    .all();
  const entries = results.map((r) => ({ key: keyOf(r.kind, r.id), kind: r.kind, title: r.title, at: r.at }));
  const response = feedResponse(host.host, entries, host.created_at, format);
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/_p99/health") return health(env);
  if (request.method === "POST" && path === "/_p99/v1/github") return githubDelivery(request, env, ctx, url);
  if (path.startsWith("/_p99/v1/")) return signedRequest(request, env, ctx, url, path.slice("/_p99/v1".length));
  if (isApp(env, url)) return appRequest(request, env, ctx, url);
  if (path === "/_p99/api/stream") return ticketStream(request, env, url);
  if (request.method === "GET" && path === "/_p99/feed") return serveFeed(request, env, ctx, url);
  if (path.startsWith("/_p99/api/")) return browserRequest(request, env, ctx, url, path.slice("/_p99/api".length));
  if (path === "/_p99/open" || path === "/_p99/mail") return mailPage(request, env, url, await loadDirectory(env), keyOf);
  if (path.startsWith("/_p99/")) return serveStatic(request, env, url);
  fail(404, "no such route");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      if (error instanceof Failure) return errorResponse(error.status, error.message, error.code);
      console.error(error && error.stack ? error.stack : String(error));
      return errorResponse(500, "internal error");
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backupStep(env));
    ctx.waitUntil(sweepDeletions(env));
  },
};

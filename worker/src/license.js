const STATES = ["free", "studio", "agency", "owner", "ff"];
const HIDES_LINK = ["agency", "owner"];
const PUBLIC_KEY = "jeSuvgBw+ExXNw32a/dbweivyLRLNGyE67aSb8BBfdg=";
const PREFIX = "PITO1";
const MAX_LEN = 16 * 1024;
const VERSION = 2;
const TIERS = ["studio", "agency"];
const SETTING = "licence";
const INVISIBLE = "­᠎​‌‍⁠﻿";
const EDGE = new RegExp(`^[>\\s${INVISIBLE}]+|[>\\s${INVISIBLE}]+$`, "gu");
const GAPS = new RegExp(`[\\s${INVISIBLE}]`, "gu");

export const REFUSALS = {
  shape: "that is not a PITO MD licence key",
  signature: "that key's signature does not verify against the PITO MD licence key",
  payload: "that key's contents are not a licence this version reads",
  version: "that key's format is not one this version reads",
  app: "that key is for another app, not P99",
  kind: "that key is not a timed P99 licence",
  tier: "that key's tier is not Studio or Agency",
};
export const PERSON_LICENSES = "only an Owner, as a person, sets the licence";

let K = null;

export function useLicenceKit(kit) {
  K = kit;
}

export function licenseState(env) {
  const word = env && typeof env.LICENSE_STATE === "string" ? env.LICENSE_STATE : "";
  return STATES.includes(word) ? word : "free";
}

export function bindingLicence(env) {
  return { state: licenseState(env), link: env && env.LICENSE_LINK === "hideable" ? "hideable" : "shown" };
}

export function linkShown(licence, config) {
  return !(licence && licence.link === "hideable" && config && config.link === false);
}

export function licensed(licence) {
  return Boolean(licence) && licence.state !== "free";
}

function softBreaks(pasted) {
  if (!pasted.includes("=")) return pasted;
  const b = new TextEncoder().encode(pasted);
  const hex = (x) => (x >= 48 && x <= 57) || (x >= 65 && x <= 70) || (x >= 97 && x <= 102);
  const out = [];
  let i = 0;
  while (i < b.length) {
    if (b[i] !== 61) {
      out.push(b[i]);
      i += 1;
      continue;
    }
    let blank = 0;
    while (i + 1 + blank < b.length && (b[i + 1 + blank] === 32 || b[i + 1 + blank] === 9)) blank += 1;
    const after = i + 1 + blank;
    if (b[after] === 13 && b[after + 1] === 10) i = after + 2;
    else if (b[after] === 10) i = after + 1;
    else if (after >= b.length) i = after;
    else if (blank === 0 && after + 1 < b.length && hex(b[after]) && hex(b[after + 1])) {
      out.push(parseInt(String.fromCharCode(b[after], b[after + 1]), 16));
      i += 3;
    } else {
      out.push(61);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(out));
}

function unglue(text) {
  const marks = [];
  for (const word of ["BEGIN ", "END "]) {
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) marks.push(at);
  }
  marks.sort((a, b) => a - b);
  let out = "";
  let last = 0;
  for (const at of marks) {
    if (at < last) continue;
    const lead = text.slice(0, at).replace(/[ \t]+$/, "");
    const start = lead.replace(/-+$/, "").length;
    if (start === lead.length || start < last) continue;
    const found = text.slice(at).search(/[-\r\n]/);
    const label = found < 0 ? text.length : at + found;
    const tail = text.slice(label);
    const stop = label + (tail.length - tail.replace(/^-+/, "").length);
    out += `${text.slice(last, start)}\n${text.slice(start, stop)}\n`;
    last = stop;
  }
  return last === 0 ? text : out + text.slice(last);
}

function armour(line) {
  if (!line.startsWith("-")) return null;
  const label = line.replace(/^[-\s]+|[-\s]+$/g, "");
  if (label.startsWith("BEGIN ")) return { begin: label.slice(6) };
  if (label.startsWith("END ")) return { end: label.slice(4) };
  return null;
}

function words(text) {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

export function normalize(pasted) {
  const text = unglue(softBreaks(pasted));
  let begin = null;
  let end = null;
  let before = "";
  let body = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(EDGE, "");
    const mark = armour(line);
    if (mark && mark.begin !== undefined && begin === null) begin = mark.begin;
    else if (mark && mark.end !== undefined) {
      end = mark.end;
      if (begin !== null) break;
    } else if (mark) continue;
    else if (begin !== null) body += line;
    else if (end === null) before += line;
  }
  if (begin !== null && end !== null && words(begin) !== words(end)) return "";
  return (begin !== null ? body : before).replace(GAPS, "");
}

function standardBytes(text) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function urlBytes(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  return standardBytes(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
}

export function civilDay(date) {
  const m = typeof date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const at = new Date(Date.UTC(2000, month - 1, day));
  at.setUTCFullYear(year);
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return Math.round(at.getTime() / 86400000);
}

async function signedPayload(publicKey, key) {
  if (typeof key !== "string" || key.length > MAX_LEN) return { refusal: "shape" };
  const parts = normalize(key).split(".");
  if (parts.length !== 3 || parts[0].toUpperCase() !== PREFIX) return { refusal: "shape" };
  const pub = standardBytes(publicKey.trim());
  const signature = urlBytes(parts[2]);
  if (!pub || pub.length !== 32 || !signature || signature.length !== 64) return { refusal: "signature" };
  let ok = false;
  try {
    const imported = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "Ed25519" }, imported, signature, new TextEncoder().encode(`${PREFIX}.${parts[1]}`));
  } catch {
    ok = false;
  }
  if (!ok) return { refusal: "signature" };
  const payload = urlBytes(parts[1]);
  if (!payload) return { refusal: "payload" };
  return { payload, key: parts.join(".") };
}

export async function verifyKey(publicKey, key) {
  const signed = await signedPayload(publicKey, key);
  if (signed.refusal) return signed;
  let claims;
  try {
    claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(signed.payload));
  } catch {
    return { refusal: "payload" };
  }
  if (!claims || typeof claims !== "object" || !Number.isInteger(claims.v) || claims.v < 0) return { refusal: "payload" };
  if (claims.v !== VERSION) return { refusal: "version" };
  if (typeof claims.app !== "string" || typeof claims.tier !== "string") return { refusal: "payload" };
  if (claims.app !== "p99") return { refusal: "app" };
  if (claims.type !== "timed" || civilDay(claims.paid_through) === null) return { refusal: "kind" };
  if (!TIERS.includes(claims.tier)) return { refusal: "tier" };
  return { claims, key: signed.key };
}

export function covers(claims, built) {
  const through = civilDay(claims.paid_through);
  const day = civilDay(built);
  if (claims.type !== "timed" || through === null || day === null) return false;
  const grace = Number.isInteger(claims.grace_days) && claims.grace_days >= 0 ? claims.grace_days : 0;
  return day <= through + grace;
}

export function stateOf(claims, built) {
  if (!covers(claims, built)) return "free";
  if (claims.group === "owner") return "owner";
  if (claims.group === "friends-family") return "ff";
  return claims.tier === "studio" ? "studio" : claims.tier === "agency" ? "agency" : "free";
}

export function linkOf(state) {
  return HIDES_LINK.includes(state) ? "hideable" : "shown";
}

function publicKeyOf(env) {
  const test = typeof env.KEY_TEST === "string" && env.KEY_TEST.length > 0 ? env.LICENSE_TEST_KEY : null;
  return typeof test === "string" && test.length > 0 ? test : PUBLIC_KEY;
}

export function buildDay(env, now) {
  return civilDay(env.BUILD_DATE) !== null ? env.BUILD_DATE : now.slice(0, 10);
}

export async function licenceOf(env, stored, now) {
  if (typeof stored !== "string" || stored.length === 0) return bindingLicence(env);
  const read = await verifyKey(publicKeyOf(env), stored);
  if (!read.claims) return bindingLicence(env);
  const state = stateOf(read.claims, buildDay(env, now));
  return { state, link: linkOf(state) };
}

export function settingStatement(DB) {
  return DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(SETTING);
}

function refuseAgent(c) {
  if (!c.manager || !c.actor || c.actor.agent) K.fail(403, PERSON_LICENSES);
}

async function putLicence(c) {
  refuseAgent(c);
  const body = await K.readJson(c, K.maxJson);
  if (typeof body.key !== "string" || body.key.trim().length === 0) K.fail(400, "key must be the licence key's text");
  const read = await verifyKey(publicKeyOf(c.env), body.key);
  if (!read.claims) K.fail(400, REFUSALS[read.refusal]);
  const built = buildDay(c.env, c.now);
  if (!covers(read.claims, built)) {
    K.fail(400, `that key covers builds up to ${read.claims.paid_through} plus ${read.claims.grace_days ?? 0} days' grace, and this Worker is dated ${built}`);
  }
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(SETTING, read.key, c.now)
    .run();
  K.forgetDirectory();
  const state = stateOf(read.claims, built);
  return K.json(200, {
    licence: { state, link: linkOf(state) },
    tier: read.claims.group === "owner" || read.claims.group === "friends-family" ? "agency" : read.claims.tier,
    studio: typeof read.claims.studio === "string" ? read.claims.studio : null,
    paid_through: read.claims.paid_through,
  });
}

async function deleteLicence(c) {
  refuseAgent(c);
  K.requireEmptyBody(c);
  const { meta } = await c.env.DB.prepare("DELETE FROM settings WHERE key = ?1").bind(SETTING).run();
  K.forgetDirectory();
  return K.json(200, { licence: bindingLicence(c.env), removed: Boolean(meta && meta.changes) });
}

export const LICENCE_ROUTES = [
  ["PUT", /^\/licence$/, putLicence],
  ["DELETE", /^\/licence$/, deleteLicence],
];

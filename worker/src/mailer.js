import { grantOf, reachOf, reachesHost } from "./grants.js";
import { escapeHtml, palette } from "./mail.js";

const encoder = new TextEncoder();
const RESEND_API = "https://api.resend.com";
const LOCAL_API = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
const CODE_KEY = "p99:code";
const MAX_FORM_BYTES = 4096;
const derivedKeys = new Map();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexBytes(text) {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) throw new Error("not hex");
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function base64Url(bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]{1,700}$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derived(env, salt, algorithm, usages) {
  const pepper = env.CODE_PEPPER;
  if (typeof pepper !== "string" || pepper.length === 0) throw new Error("the Worker has no CODE_PEPPER secret");
  const hit = derivedKeys.get(salt);
  if (hit && hit.pepper === pepper) return hit.key;
  const base = await crypto.subtle.importKey("raw", encoder.encode(pepper), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(salt), info: new Uint8Array(0) },
    base,
    algorithm,
    false,
    usages,
  );
  derivedKeys.set(salt, { pepper, key });
  return key;
}

function codeCipher(env) {
  return derived(env, "p99 code", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);
}

function optOutKey(env) {
  return derived(env, "p99 mail opt-out", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign", "verify"]);
}

export async function sealCode(env, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await codeCipher(env), encoder.encode(secret));
  return hex(iv) + "." + hex(sealed);
}

export async function openCode(env, sealed) {
  try {
    const [iv, body] = String(sealed).split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexBytes(iv) }, await codeCipher(env), hexBytes(body));
    const secret = new TextDecoder().decode(plain);
    return /^[0-9a-z]{12}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

function optOutMessage(itemId, email) {
  return encoder.encode(`p99 mail opt-out\n${itemId}\n${email}`);
}

export async function optOutToken(env, itemId, email) {
  const mac = await crypto.subtle.sign("HMAC", await optOutKey(env), optOutMessage(itemId, email));
  return `${itemId}.${base64Url(encoder.encode(email))}.${base64Url(mac)}`;
}

export async function readOptOut(env, token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || !/^[1-9]\d{0,14}$/.test(parts[0])) return null;
  const emailBytes = fromBase64Url(parts[1]);
  const mac = fromBase64Url(parts[2]);
  if (!emailBytes || !mac || mac.length !== 32) return null;
  let email;
  try {
    email = new TextDecoder("utf-8", { fatal: true }).decode(emailBytes);
  } catch {
    return null;
  }
  const itemId = Number(parts[0]);
  const valid = await crypto.subtle.verify("HMAC", await optOutKey(env), mac, optOutMessage(itemId, email));
  return valid ? { itemId, email } : null;
}

const PROVIDERS = {
  resend: {
    batch: 100,
    ready: (env) => typeof env.RESEND_API_KEY === "string" && env.RESEND_API_KEY.length > 0,
    async send(env, from, messages, idempotency) {
      const base = LOCAL_API.test(env.RESEND_API_URL || "") ? env.RESEND_API_URL : RESEND_API;
      const response = await fetch(`${base}/emails/batch`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json; charset=utf-8",
          "idempotency-key": idempotency,
        },
        body: JSON.stringify(
          messages.map((m) => ({
            from,
            to: [m.to],
            subject: m.subject,
            text: m.text,
            html: m.html,
            ...(m.replyTo ? { reply_to: m.replyTo } : {}),
            ...(m.headers ? { headers: m.headers } : {}),
          })),
        ),
      });
      return { ok: response.ok, status: response.status };
    },
  },
};

export function mailSettings(env, row) {
  if (row) {
    const provider = PROVIDERS[row.provider];
    return provider && row.sender && provider.ready(env) ? { provider: row.provider, from: row.sender } : null;
  }
  return PROVIDERS.resend.ready(env) && env.MAIL_FROM ? { provider: "resend", from: env.MAIL_FROM } : null;
}

export function mailer(env, settings) {
  const provider = settings && PROVIDERS[settings.provider];
  if (!provider) return null;
  return {
    batch: provider.batch,
    send: (messages, idempotency) => provider.send(env, settings.from, messages, idempotency),
  };
}

export function openLink(host, path, key, code) {
  const to = encodeURIComponent(path || "/");
  return `https://${host}/_p99/open?to=${to}&item=${encodeURIComponent(key)}#${code}`;
}

export function optOutLink(host, token) {
  return `https://${host}/_p99/mail?t=${token}`;
}

const OPEN_SCRIPT = `let c=location.hash.slice(1),k=${JSON.stringify(CODE_KEY)},t=document.querySelector("meta[name=p99-to]").content;try{/^\\w{12}$/.test(c)&&!localStorage[k]?.startsWith(c)&&(localStorage[k]=c)}catch{}location.replace(t)`;
let openScriptHash = null;

async function scriptHash() {
  if (!openScriptHash) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(OPEN_SCRIPT));
    openScriptHash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  }
  return openScriptHash;
}

function page(status, title, body, theme, scriptPolicy = "'none'", head = "") {
  const c = palette(theme);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>${head}<style>body{margin:0;padding:48px 16px;background:#ffffff;color:${c.ink};font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 16px;color:${c.muted}}button,a.b{display:inline-block;padding:8px 14px;border:0;border-radius:6px;background:${c.accent};color:${c["on-accent"]};font:600 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptPolicy}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

function notFound(theme) {
  return page(404, "P99", "<h1>This link isn't valid</h1><p>It may be cut short or meant for another site.</p>", theme);
}

function safePath(value) {
  return typeof value === "string" && value.length <= 512 && /^\/(?![\/\\])[^\s\\#]*$/.test(value);
}

async function openPage(request, url, theme) {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(theme);
  const to = url.searchParams.get("to") || "/";
  const item = url.searchParams.get("item");
  if (!safePath(to) || (item !== null && !/^[A-Za-z]{1,10}-\d{1,15}$/.test(item))) return notFound(theme);
  const target = item ? `${to}#p99=${item}` : to;
  const head = `<meta name="p99-to" content="${escapeHtml(target)}"><script>${OPEN_SCRIPT}</script>`;
  const body = `<h1>Opening…</h1><p><a class="b" href="${escapeHtml(target)}">Open${item ? ` ${escapeHtml(item)}` : ""}</a></p>`;
  return page(200, "P99", body, theme, `'sha256-${await scriptHash()}'`, head);
}

async function formOf(request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared > MAX_FORM_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return null;
  return new URLSearchParams(text);
}

async function optOutPage(request, env, url, host, keyOf) {
  const theme = host.config.theme;
  if (request.method !== "GET" && request.method !== "POST") return notFound(theme);
  const claim = await readOptOut(env, url.searchParams.get("t"));
  if (!claim) return notFound(theme);
  const item = await env.DB.prepare("SELECT id, kind, title, host FROM items WHERE id = ?1").bind(claim.itemId).first();
  if (!item || item.host !== host.host) return notFound(theme);
  let off = true;
  if (request.method === "POST") {
    const form = await formOf(request);
    if (!form) return notFound(theme);
    off = form.get("undo") !== "1";
  }
  const now = new Date().toISOString();
  await (off
    ? env.DB.prepare("INSERT OR IGNORE INTO mail_optouts (item_id, email, at) VALUES (?1, ?2, ?3)").bind(item.id, claim.email, now)
    : env.DB.prepare("DELETE FROM mail_optouts WHERE item_id = ?1 AND email = ?2").bind(item.id, claim.email)
  ).run();
  const key = escapeHtml(keyOf(item.kind, item.id));
  const title = escapeHtml(item.title);
  const body = off
    ? `<h1>No more mail about ${key}</h1><p>${escapeHtml(claim.email)} won't get mail about ${key}, “${title}”, any more. Other items still mail you as before.</p><form method="post"><input type="hidden" name="undo" value="1"><button>Undo</button></form>`
    : `<h1>Mail about ${key} is back on</h1><p>${escapeHtml(claim.email)} will get mail about ${key}, “${title}”, again.</p><form method="post"><button>Stop it again</button></form>`;
  return page(200, `P99: ${keyOf(item.kind, item.id)}`, body, theme);
}

export async function mailPage(request, env, url, dir, keyOf) {
  const host = dir.hosts.get(url.hostname);
  if (!host) return notFound(null);
  if (url.pathname === "/_p99/open") return openPage(request, url, host.config.theme);
  return optOutPage(request, env, url, host, keyOf);
}

export async function optedOut(DB, mails) {
  const pairs = [...new Set(mails.map((m) => JSON.stringify([m.item_id, m.to])))].map((p) => JSON.parse(p));
  if (pairs.length === 0) return new Set();
  const { results } = await DB.prepare(
    `SELECT o.item_id, o.email FROM mail_optouts o
     JOIN json_each(?1) j ON o.item_id = json_extract(j.value, '$[0]') AND o.email = json_extract(j.value, '$[1]')`,
  )
    .bind(JSON.stringify(pairs))
    .all();
  return new Set(results.map((r) => `${r.item_id} ${r.email}`));
}

export async function reporterCodes(env, wanted, dir) {
  const emails = [...new Set(wanted.map((m) => m.to))];
  const found = new Map();
  if (emails.length === 0) return found;
  const { results } = await env.DB.prepare(
    `SELECT email, hosts_json, grant_json, sealed_code FROM codes
     WHERE revoked_at IS NULL AND sealed_code IS NOT NULL AND email IN (SELECT value FROM json_each(?1))
     ORDER BY id DESC`,
  )
    .bind(JSON.stringify(emails))
    .all();
  for (const m of wanted) {
    const slot = `${m.to} ${m.host}`;
    if (found.has(slot)) continue;
    let code = null;
    for (const row of results) {
      if (row.email !== m.to || !reachesHost(reachOf(grantOf(row, dir), dir), dir, m.host)) continue;
      code = await openCode(env, row.sealed_code);
      if (code) break;
    }
    found.set(slot, code);
  }
  return found;
}

import appScript from "./web/app.js";
import appStyle from "./web/app.css";
import { ipKey } from "./tries.js";

let K = null;

export function useKit(kit) {
  K = kit;
}

const COOKIE = "__Host-p99";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const TRY_SLOT_MS = 15 * 60 * 1000;
const TRY_LIMITS = { mail: 5, ip: 30 };
const DENIED = "that e-mail and code don't match";
const SIGNED_OUT = "sign in again";
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
};
const JS_TYPE = "text/javascript; charset=utf-8";
const OWN_FILES = {
  "/_p99/app.js": { source: appScript, type: JS_TYPE },
  "/_p99/app.css": { source: appStyle, type: "text/css; charset=utf-8" },
};
const SHARED_FILES = ["/_p99/panel.js", "/_p99/board.js", "/_p99/avatar.js", "/_p99/p99.css", "/_p99/art/concrete.svg", "/_p99/art/concrete-dark.svg"];

export function appHost(env) {
  const host = typeof env.APP_HOST === "string" ? env.APP_HOST.trim().toLowerCase() : "";
  return host || null;
}

export function isApp(env, url) {
  const host = appHost(env);
  return host !== null && url.hostname === host;
}

export function sameText(a, b) {
  const x = K.encoder.encode(String(a));
  const y = K.encoder.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function secured(response) {
  if (response.status === 101) return response;
  const out = new Response(response.body, response);
  const own = response.headers.has("content-security-policy");
  for (const [name, value] of Object.entries(HEADERS)) if (!own || name !== "content-security-policy") out.headers.set(name, value);
  return out;
}

export async function appRequest(request, env, ctx, url) {
  let response;
  try {
    response = await route(request, env, ctx, url);
  } catch (error) {
    if (!(error instanceof K.Failure)) throw error;
    response = K.errorResponse(error.status, error.message, error.code);
  }
  return secured(response);
}

async function route(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === "/_p99/api/stream") return stream(request, env, url);
  if (path.startsWith("/_p99/api/")) return api(request, env, ctx, url, path.slice("/_p99/api".length));
  if (method === "POST" && path === "/_p99/app/signin") return signIn(request, env, url);
  if (method === "POST" && path === "/_p99/app/signout") return signOut(request, env, url);
  if (method === "GET" && path === "/_p99/app/spaces") return spaces(request, env, url);
  if (method !== "GET" && method !== "HEAD") K.fail(404, "no such route");
  if (path === "/") return page(request, env, method);
  return files(request, env, url, method);
}

function page(request, env, method) {
  const v = env.VERSION || "dev";
  const known = cookieToken(request) !== null;
  const body = known ? '<div class="app-wait" aria-busy="true"></div>' : signInMarkup();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>P99</title>
<link rel="stylesheet" href="/_p99/app.css?v=${v}">
<script type="module" src="/_p99/app.js?v=${v}"></script>
</head>
<body>
<main id="app" class="app" data-screen="${known ? "spaces" : "signin"}">${body}</main>
</body>
</html>
`;
  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function signInMarkup() {
  return `<form class="app-card app-signin" id="signin" method="post" action="/_p99/app/signin" novalidate>
<h1 class="app-brand"><b class="app-logo">P99</b><span>Sign in</span></h1>
<p class="app-note">Use the e-mail your P99 link was sent to and the 6-digit code your authenticator app shows for P99.</p>
<label class="app-field"><span>E-mail</span><input name="email" type="email" autocomplete="username" inputmode="email" required></label>
<label class="app-field"><span>Code</span><input name="totp" autocomplete="one-time-code" inputmode="numeric" maxlength="7" pattern="[0-9 ]*" required></label>
<p class="app-error" role="alert" hidden></p>
<button class="app-primary" type="submit">Sign in</button>
</form>`;
}

function files(request, env, url, method) {
  const path = url.pathname;
  const own = OWN_FILES[path];
  const file = own || (SHARED_FILES.includes(path) ? K.staticFiles[path] : null);
  if (!file) K.fail(404, "no such file");
  const v = env.VERSION || "dev";
  const source = path === "/_p99/app.css" ? tokens() + file.source : file.source;
  const text = source.split("__P99_VERSION__").join(v);
  return new Response(method === "HEAD" ? null : text, {
    status: 200,
    headers: {
      "content-type": file.type,
      "cache-control": url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
    },
  });
}

function tokens() {
  const css = K.staticFiles["/_p99/p99.css"].source;
  return css.slice(0, css.indexOf("[hidden]")).split(":host").join(":root");
}

function guard(request, url) {
  if (request.headers.get("x-p99-app") !== "1") K.fail(403, "this request needs the X-P99-App header");
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.headers.get("origin") !== url.origin) K.fail(403, "this request must come from the P99 page");
}

function cookieToken(request) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== COOKIE) continue;
    const token = part.slice(at + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  return null;
}

function cookie(token, maxAge) {
  return `${COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function tokenHash(env, token) {
  return K.codeHash(env, "session:" + token);
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function liveCodes(request, env, now) {
  const token = cookieToken(request);
  if (!token) return null;
  const { results } = await env.DB.prepare(
    `SELECT k.* FROM codes k
      WHERE k.revoked_at IS NULL AND k.email = (
        SELECT o.email FROM app_sessions s JOIN codes o ON o.id = s.code_id AND o.revoked_at IS NULL
         WHERE s.token_hash = ?1 AND s.expires_at > ?2)
      ORDER BY k.manager DESC, k.id DESC`,
  )
    .bind(await tokenHash(env, token), now)
    .all();
  if (results.length === 0) return null;
  return results.map((row) => ({ ...row, hosts: K.parseJson(row.hosts_json, []), trusted: true }));
}

async function signedIn(request, env, url, now) {
  guard(request, url);
  const codes = await liveCodes(request, env, now);
  if (!codes) K.fail(401, SIGNED_OUT);
  return codes;
}

async function api(request, env, ctx, url, path) {
  const now = new Date().toISOString();
  const codes = await signedIn(request, env, url, now);
  if (path === "/verify") K.fail(404, "no such route");
  const dir = await K.loadDirectory(env);
  const host = (url.searchParams.get("host") || "").toLowerCase();
  const hostRow = dir.hosts.get(host);
  const code = hostRow ? codes.find((c) => c.hosts.includes(host)) : null;
  if (!code) K.fail(404, "no such space");
  if (env.RATE) {
    const outcome = await env.RATE.limit({ key: `code:${code.id}` });
    if (!outcome.success) K.fail(429, "too many requests with this code; try again in a minute");
  }
  return K.browserRun(request, env, ctx, url, path, dir, hostRow, code, now);
}

async function stream(request, env, url) {
  const dir = await K.loadDirectory(env);
  const host = (url.searchParams.get("host") || "").toLowerCase();
  if (!dir.hosts.has(host)) K.fail(404, "no such space");
  const target = new URL(url);
  target.hostname = host;
  return K.ticketStream(request, env, target);
}

function counted(DB, key, slot) {
  return DB.prepare(
    `INSERT INTO app_tries (key, slot, n) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET n = CASE WHEN slot = excluded.slot THEN n + 1 ELSE 1 END, slot = excluded.slot
     RETURNING n`,
  ).bind(key, slot);
}

let dummy = null;

async function dummySecret(env) {
  if (!dummy || dummy.pepper !== env.CODE_PEPPER) {
    dummy = { pepper: env.CODE_PEPPER, sealed: await K.sealTotp(env, crypto.getRandomValues(new Uint8Array(20))) };
  }
  return dummy.sealed;
}

async function signIn(request, env, url) {
  guard(request, url);
  const body = await K.readJson({ request, signed: false }, 4096);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const typed = typeof body.totp === "string" ? body.totp.replace(/\s/g, "") : "";
  if (!K.isEmail(email) || !/^\d{6}$/.test(typed)) K.fail(400, "enter your e-mail and the 6-digit code");
  const { DB } = env;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const slot = Math.floor(nowMs / TRY_SLOT_MS);
  const ip = ipKey(request.headers.get("cf-connecting-ip") || "?");
  const [byMail, byIp] = await DB.batch([
    counted(DB, "mail:" + (await K.codeHash(env, "try-mail:" + email)), slot),
    counted(DB, "ip:" + (await K.codeHash(env, "try-ip:" + ip)), slot),
    DB.prepare("DELETE FROM app_tries WHERE slot < ?1").bind(slot - 1),
  ]);
  if (byMail.results[0].n > TRY_LIMITS.mail || byIp.results[0].n > TRY_LIMITS.ip) {
    K.fail(429, "too many tries; wait a few minutes and try again");
  }
  const { results } = await DB.prepare(
    "SELECT id, totp_secret, totp_step, totp_fails FROM codes WHERE email = ?1 AND revoked_at IS NULL AND totp_secret IS NOT NULL ORDER BY id",
  )
    .bind(email)
    .all();
  const rows = results.length > 0 ? results : [{ id: 0, totp_secret: await dummySecret(env), totp_step: 0, totp_fails: 0 }];
  const step = Math.floor(nowMs / 1000 / K.totpStepSeconds);
  let hit = null;
  for (const row of rows) {
    const key = await crypto.subtle.importKey("raw", await K.openTotp(env, row.totp_secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    for (const at of [step - 1, step, step + 1]) {
      const same = sameText(await K.totpAt(key, at), typed);
      if (same && !hit && row.id && at > row.totp_step && row.totp_fails < K.totpMaxFails) hit = { row, at };
    }
  }
  if (!hit) {
    await DB.prepare("UPDATE codes SET totp_fails = totp_fails + 1 WHERE email = ?1 AND revoked_at IS NULL AND totp_secret IS NOT NULL")
      .bind(email)
      .run();
    K.fail(401, DENIED);
  }
  const token = newToken();
  const hash = await tokenHash(env, token);
  const old = cookieToken(request);
  const [claimed] = await DB.batch([
    DB.prepare("UPDATE codes SET totp_step = ?2, totp_fails = 0 WHERE id = ?1 AND totp_step < ?2 AND revoked_at IS NULL").bind(hit.row.id, hit.at),
    DB.prepare("INSERT INTO app_sessions (token_hash, code_id, created_at, expires_at) SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0").bind(
      hash,
      hit.row.id,
      now,
      new Date(nowMs + SESSION_MS).toISOString(),
    ),
    DB.prepare(
      "DELETE FROM app_sessions WHERE (token_hash = ?1 OR expires_at <= ?2) AND EXISTS (SELECT 1 FROM app_sessions WHERE token_hash = ?3)",
    ).bind(old ? await tokenHash(env, old) : "", now, hash),
  ]);
  if (!claimed.meta || claimed.meta.changes !== 1) K.fail(401, DENIED);
  return K.json(200, { ok: true }, { "set-cookie": cookie(token, SESSION_MS / 1000) });
}

async function signOut(request, env, url) {
  guard(request, url);
  const token = cookieToken(request);
  if (token) await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?1").bind(await tokenHash(env, token)).run();
  return K.json(200, { ok: true }, { "set-cookie": cookie("", 0) });
}

async function spaces(request, env, url) {
  const codes = await signedIn(request, env, url, new Date().toISOString());
  const dir = await K.loadDirectory(env);
  const email = codes[0].email.toLowerCase();
  const managers = K.managersOf(env);
  const seen = new Map();
  for (const code of codes) {
    for (const host of code.hosts) {
      if (seen.has(host) || !dir.hosts.has(host)) continue;
      seen.set(host, Boolean(code.manager) || managers.includes(email));
    }
  }
  const hosts = [...seen.keys()].sort();
  const { DB } = env;
  const counts =
    hosts.length > 0
      ? await DB.batch(
          hosts.map((host) =>
            seen.get(host)
              ? DB.prepare("SELECT count(*) AS n FROM items WHERE host = ?1 AND open = 1").bind(host)
              : DB.prepare(`SELECT count(*) AS n FROM items i WHERE i.host = ?1 AND i.open = 1 AND ${K.mineClause("?2")}`).bind(host, email),
          ),
        )
      : [];
  return K.json(200, {
    name: codes[0].name,
    spaces: hosts.map((host, i) => ({ host, open: counts[i].results[0].n, manager: seen.get(host) })),
  });
}

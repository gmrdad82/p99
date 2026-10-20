const SERVICES = ["slack", "discord"];
const EVENTS = ["new", "comment", "status", "shipped"];
const HOOK_TTL_MS = 30 * 1000;
const SEND_TIMEOUT_MS = 5000;
const MAX_LINES = 10;
const MAX_URL_CHARS = 512;
const SLACK_HOST = "hooks.slack.com";
const SLACK_PATH = /^\/services\/[A-Za-z0-9]{1,64}\/[A-Za-z0-9]{1,64}\/[A-Za-z0-9]{1,128}$/;
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);
const DISCORD_PATH = /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{1,25}\/[A-Za-z0-9_-]{1,128}$/;
const TEST_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const STATUS_NAMES = { inbox: "Inbox", doing: "Doing", review: "Review", done: "Done" };
const KIND_NAMES = { bug: "Bug", feature: "Feature", improvement: "Improvement", question: "Question", task: "Task" };
const encoder = new TextEncoder();

export function hookTarget(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_CHARS) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host === SLACK_HOST && SLACK_PATH.test(url.pathname)) return { service: "slack", url: `https://${host}${url.pathname}` };
  if (DISCORD_HOSTS.has(host) && DISCORD_PATH.test(url.pathname)) {
    return { service: "discord", url: `https://${host}${url.pathname}` };
  }
  return null;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(text) {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let cipher = null;

async function hookCipher(env) {
  if (!cipher || cipher.pepper !== env.CODE_PEPPER) {
    const base = await crypto.subtle.importKey("raw", encoder.encode(env.CODE_PEPPER), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: encoder.encode("p99 hooks"), info: new Uint8Array(0) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    cipher = { pepper: env.CODE_PEPPER, key };
  }
  return cipher.key;
}

async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await hookCipher(env), encoder.encode(text));
  return hex(iv) + "." + hex(sealed);
}

async function unseal(env, text) {
  const [iv, sealed] = text.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(iv) }, await hookCipher(env), unhex(sealed));
  return new TextDecoder().decode(plain);
}

let cache = null;

function forgetHooks() {
  cache = null;
}

async function loadHooks(env) {
  if (cache && Date.now() - cache.at < HOOK_TTL_MS) return cache.rows;
  const { results } = await env.DB.prepare("SELECT host, service, url_sealed, events_json FROM hooks").all();
  cache = {
    at: Date.now(),
    rows: results.map((r) => ({ host: r.host, service: r.service, sealed: r.url_sealed, events: parseEvents(r.events_json) })),
  };
  return cache.rows;
}

function parseEvents(text) {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((e) => EVENTS.includes(e)) : [];
  } catch {
    return [];
  }
}

function hookOf(row) {
  return {
    host: row.host,
    service: row.service,
    hint: row.hint,
    events: parseEvents(row.events_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_status: row.last_status ?? null,
    last_at: row.last_at ?? null,
  };
}

function validEvents(value, fail) {
  if (!Array.isArray(value) || value.length === 0 || value.length > EVENTS.length * 2) {
    fail(400, `events must list one or more of ${EVENTS.join(", ")}`);
  }
  for (const e of value) if (!EVENTS.includes(e)) fail(400, `events must list one or more of ${EVENTS.join(", ")}`);
  return EVENTS.filter((e) => value.includes(e));
}

function hostArg(kit, rawHost) {
  const host = kit.decodeURIComponentSafe(rawHost).toLowerCase();
  if (!kit.isHostName(host)) kit.fail(400, "host must be a host name");
  return host;
}

function requirePepper(env, fail) {
  if (typeof env.CODE_PEPPER !== "string" || env.CODE_PEPPER.length === 0) {
    fail(500, "the Worker has no CODE_PEPPER secret; run p99 deploy");
  }
}

export function hookRoutes(kit) {
  const { fail, json } = kit;

  async function listHooks(c) {
    kit.requireEmptyBody(c);
    kit.requireManager(c);
    const host = c.scope.all ? null : c.scope.host;
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM hooks WHERE ?1 IS NULL OR host = ?1 ORDER BY host, service",
    )
      .bind(host)
      .all();
    return json(200, { hooks: results.map(hookOf) });
  }

  async function putHook(c, rawHost) {
    const body = await kit.readJson(c, kit.maxJson);
    const host = hostArg(kit, rawHost);
    if (!c.dir.hosts.has(host)) fail(404, "no such host");
    const target = hookTarget(body.url);
    if (!target) {
      fail(400, "url must be a Slack incoming webhook (https://hooks.slack.com/services/…) or a Discord webhook (https://discord.com/api/webhooks/…)");
    }
    if (body.service !== undefined && body.service !== null && body.service !== target.service) {
      fail(400, `that url is a ${target.service} webhook, not a ${body.service} one`);
    }
    const keep = body.events === undefined || body.events === null;
    const events = keep ? EVENTS : validEvents(body.events, fail);
    requirePepper(c.env, fail);
    const row = await c.env.DB.prepare(
      `INSERT INTO hooks (host, service, url_sealed, hint, events_json, created_at, created_by, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6)
       ON CONFLICT (host, service) DO UPDATE SET url_sealed = excluded.url_sealed, hint = excluded.hint,
         events_json = CASE WHEN ?8 THEN hooks.events_json ELSE excluded.events_json END,
         updated_at = excluded.updated_at, last_status = NULL, last_at = NULL
       RETURNING *`,
    )
      .bind(
        host,
        target.service,
        await seal(c.env, target.url),
        target.url.slice(-4),
        JSON.stringify(events),
        c.now,
        c.actor ? c.actor.email : null,
        keep ? 1 : 0,
      )
      .first();
    forgetHooks();
    return json(200, hookOf(row));
  }

  async function deleteHook(c, rawHost) {
    kit.requireEmptyBody(c);
    const host = hostArg(kit, rawHost);
    const service = c.url.searchParams.get("service");
    if (service !== null && !SERVICES.includes(service)) fail(400, `service must be ${SERVICES.join(" or ")}`);
    const { meta } = await c.env.DB.prepare("DELETE FROM hooks WHERE host = ?1 AND (?2 IS NULL OR service = ?2)")
      .bind(host, service)
      .run();
    forgetHooks();
    if (!meta.changes) fail(404, "no such hook");
    return new Response(null, { status: 204 });
  }

  async function testHook(c, rawHost) {
    kit.requireEmptyBody(c);
    const host = hostArg(kit, rawHost);
    requirePepper(c.env, fail);
    const { results } = await c.env.DB.prepare("SELECT * FROM hooks WHERE host = ?1 ORDER BY service").bind(host).all();
    if (results.length === 0) fail(404, "no hooks on this host");
    const accent = accentOf(c.dir, host);
    const by = c.actor ? actorName({ name: c.actor.name, agent: c.actor.agent }) : "P99";
    const sent = await Promise.all(
      results.map(async (row) => {
        const hook = { host, service: row.service, sealed: row.url_sealed };
        const status = await post(c, kit, hook, testMessage(row.service, host, by, accent));
        return { service: row.service, hint: row.hint, ok: status === "ok", status };
      }),
    );
    await record(c, sent.map((s) => ({ host, service: s.service, status: s.status })));
    return json(200, { results: sent });
  }

  return [
    ["GET", /^\/hooks$/, listHooks, {}],
    ["PUT", /^\/hooks\/([^/]+)$/, putHook, {}],
    ["DELETE", /^\/hooks\/([^/]+)$/, deleteHook, {}],
    ["POST", /^\/hooks\/([^/]+)\/test$/, testHook, {}],
  ];
}

export function noteHook(c, event) {
  (c.hooked ??= []).push(event);
}

export function noteLanded(c, ids, env, version) {
  if (ids.length > 0) noteHook(c, { type: "landed", ids, env, version: version ?? null, by: null });
}

function actorName(by) {
  if (!by || typeof by.name !== "string" || by.name.length === 0) return "P99";
  const name = by.name.includes("@") ? by.name.slice(0, by.name.indexOf("@")) : by.name;
  return by.agent ? `${name}*` : name;
}

function accentOf(dir, host) {
  const known = dir.hosts.get(host);
  const raw = known && known.config && known.config.theme ? known.config.theme.accent : null;
  if (typeof raw !== "string") return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  return parseInt(digits, 16);
}

async function statusNames(env) {
  const names = { ...STATUS_NAMES };
  const { results } = await env.DB.prepare("SELECT key, name FROM statuses").all();
  for (const r of results) if (r.key in names && r.name) names[r.key] = r.name;
  return names;
}

function statusName(names, row) {
  const name = names[row.status] ?? String(row.status);
  return row.status === "done" && row.resolution && row.resolution !== "fixed" ? `${name} (${row.resolution})` : name;
}

function headline(entry, row, names) {
  const by = actorName(entry.by);
  if (entry.event === "new") return `New, by ${by}`;
  if (entry.event === "comment") return `Comment by ${by}`;
  if (entry.event === "status") return `Moved to ${statusName(names, row)} by ${by}`;
  return `Shipped to ${entry.env}${entry.version ? ` ${entry.version}` : ""}`;
}

function slackEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function discordEscape(text) {
  return String(text).replace(/([\\*_~`|>#[\]()<@-])/g, "\\$1");
}

function slackMessage(lines, more, host) {
  const blocks = [];
  for (const l of lines) {
    const key = l.link ? `<${l.link.replace(/\|/g, "%7C")}|${l.key}>` : l.key;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${key}*  ${slackEscape(l.title)}` } });
    blocks.push({ type: "context", elements: [{ type: "plain_text", text: l.meta, emoji: false }] });
  }
  if (more > 0) blocks.push({ type: "context", elements: [{ type: "plain_text", text: `and ${more} more on ${host}`, emoji: false }] });
  const text = lines.map((l) => `${l.key} ${l.title}: ${l.meta}`).join("\n") + (more > 0 ? `\nand ${more} more` : "");
  return { text: slackEscape(text), blocks, unfurl_links: false, unfurl_media: false };
}

function discordMessage(lines, more, host, accent) {
  const count = lines.length + more;
  const content = count === 1 ? `${lines[0].key} on ${host}` : `${count} updates on ${host}`;
  const embeds = lines.map((l) => {
    const embed = { title: `${l.key} ${discordEscape(l.title)}`.slice(0, 256), description: discordEscape(l.meta) };
    if (l.link) embed.url = l.link;
    if (accent !== null) embed.color = accent;
    return embed;
  });
  return { content: discordEscape(content), embeds, allowed_mentions: { parse: [] } };
}

function testMessage(service, host, by, accent) {
  const line = `P99 test message for ${host}, sent by ${by}`;
  if (service === "slack") {
    return { text: slackEscape(line), blocks: [{ type: "section", text: { type: "plain_text", text: line, emoji: false } }] };
  }
  const embed = { title: "P99", description: discordEscape(line) };
  if (accent !== null) embed.color = accent;
  return { content: discordEscape(line), embeds: [embed], allowed_mentions: { parse: [] } };
}

function testOrigin(c, kit) {
  const origin = c.env.HOOKS_TEST_ORIGIN;
  return typeof origin === "string" && TEST_ORIGIN.test(origin) && kit.isLocal(c.url) ? origin : null;
}

async function post(c, kit, hook, payload) {
  let response;
  try {
    const url = await unseal(c.env, hook.sealed);
    const origin = testOrigin(c, kit);
    const target = origin ? `${origin}/${hook.service}${new URL(url).pathname}` : url;
    response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const status = error && error.name === "TimeoutError" ? "timeout" : "error";
    console.error(`the ${hook.service} hook of ${hook.host} failed: ${status}`);
    return status;
  }
  try {
    await response.body?.cancel();
  } catch {}
  if (response.status >= 200 && response.status < 300) return "ok";
  console.error(`the ${hook.service} hook of ${hook.host} answered ${response.status}`);
  return String(response.status);
}

async function record(c, outcomes) {
  if (outcomes.length === 0) return;
  await c.env.DB.prepare(
    `UPDATE hooks SET last_status = json_extract(value, '$.status'), last_at = ?2
     FROM json_each(?1) WHERE hooks.host = json_extract(value, '$.host') AND hooks.service = json_extract(value, '$.service')`,
  )
    .bind(JSON.stringify(outcomes), c.now)
    .run();
}

export async function flushHooks(c, kit) {
  const noted = c.hooked.splice(0);
  try {
    const hooks = await loadHooks(c.env);
    if (hooks.length === 0) return;
    const wants = (host, event) => hooks.some((h) => h.host === host && h.events.includes(event));
    const entries = [];
    const seen = new Set();
    const add = (event, id, e, extra = {}) => {
      if (id === null) return;
      const mark = `${event} ${id}`;
      if (seen.has(mark)) return;
      seen.add(mark);
      entries.push({ event, id, by: e.by ?? null, ...extra });
    };
    for (const e of noted) {
      if (e.type === "landed") {
        if (hooks.some((h) => h.events.includes("shipped"))) for (const id of e.ids) add("shipped", id, e, { env: e.env, version: e.version });
        continue;
      }
      let event = null;
      if (e.type === "item") event = "new";
      else if (e.type === "comment" && !e.internal) event = "comment";
      else if (e.type === "move" && e.from !== e.to) event = "status";
      if (event && wants(e.host ?? null, event)) add(event, kit.parseKey(e.key), e);
    }
    if (entries.length === 0) return;
    const [items, names] = await Promise.all([
      c.env.DB.prepare("SELECT id, kind, title, status, resolution, host, page_path FROM items WHERE id IN (SELECT value FROM json_each(?1))")
        .bind(JSON.stringify([...new Set(entries.map((x) => x.id))]))
        .all(),
      statusNames(c.env),
    ]);
    const rows = new Map(items.results.map((r) => [r.id, r]));
    const sends = [];
    for (const hook of hooks) {
      const mine = entries.filter((x) => {
        const row = rows.get(x.id);
        return row && row.host === hook.host && hook.events.includes(x.event);
      });
      if (mine.length === 0) continue;
      const lines = mine.slice(0, MAX_LINES).map((x) => {
        const row = rows.get(x.id);
        const kind = KIND_NAMES[row.kind] ?? row.kind;
        return {
          key: kit.keyOf(row.kind, row.id),
          title: row.title,
          link: kit.pageLink(row),
          meta: `${headline(x, row, names)} · ${kind} · ${statusName(names, row)}`,
        };
      });
      const more = mine.length - lines.length;
      const payload =
        hook.service === "slack"
          ? slackMessage(lines, more, hook.host)
          : discordMessage(lines, more, hook.host, accentOf(c.dir, hook.host));
      sends.push(post(c, kit, hook, payload).then((status) => ({ host: hook.host, service: hook.service, status })));
    }
    await record(c, await Promise.all(sends));
  } catch (error) {
    console.error(`hooks flush failed: ${error.message}`);
  }
}

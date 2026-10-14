import { createServer } from "node:http";

const port = Number(process.env.P99_MOCK_PORT || 8799);
const prefix = "/client/v4";
const pace = Number(process.env.P99_MOCK_PACE ?? 1);
const life = Number(process.env.P99_MOCK_LIFE || 120) * 1000;
const idle = 20_000;
let quiet = null;

const stamp = (days = 0) => new Date(Date.UTC(2026, 9, 14, 9, 30) - days * 86_400_000).toISOString();

const accounts = [
  { id: "3f9c2a7d41e84b6a9d0c5e1f72a8b4c6", name: "Ada Lovelace's Account" },
  { id: "8b21e6f04c9d4a73b5e2d18c6f0a9e37", name: "Example Shop" },
];
const ada = accounts[0].id;

const state = {
  zones: [
    { id: "6d2f8a14c7e94b30a1f5d9e82c47b6a0", name: "example.com", account: ada },
    { id: "c41a9e7b2d6f4805b3e1a07d95c2f864", name: "shop.example.com", account: accounts[1].id },
  ],
  routes: { "6d2f8a14c7e94b30a1f5d9e82c47b6a0": [], c41a9e7b2d6f4805b3e1a07d95c2f864: [] },
  scripts: {
    [ada]: {
      redirects: {
        created_on: stamp(240),
        modified_on: stamp(31),
        bindings: [
          { type: "ratelimit", name: "LIMIT", namespace_id: "1001", simple: { limit: 60, period: 60 } },
          { type: "plain_text", name: "TARGET", text: "https://example.com" },
        ],
        secrets: [],
        schedules: [],
      },
    },
    [accounts[1].id]: {},
  },
  databases: { [ada]: [], [accounts[1].id]: [] },
  migrations: {},
  buckets: { [ada]: [{ name: "site-assets", creation_date: stamp(400) }], [accounts[1].id]: [] },
  pages: {
    [ada]: [
      {
        id: "e7c1d05a-92b4-4f3e-8a6d-1c0b5f2e9d74",
        name: "example-site",
        subdomain: "example-site.pages.dev",
        domains: ["example-site.pages.dev", "example.com"],
        production_branch: "main",
        created_on: stamp(400),
      },
    ],
    [accounts[1].id]: [],
  },
};

let counter = 0;
const hex = (n) => {
  counter += 1;
  let out = "";
  let seed = 0x9e3779b9 ^ counter;
  while (out.length < n) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out += (seed >>> 8).toString(16).padStart(6, "0");
  }
  return out.slice(0, n);
};
const uuid = () => {
  const h = hex(32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
};

const ok = (result, extra = {}) => [200, { success: true, errors: [], messages: [], result, ...extra }];
const fail = (status, code, message) => [status, { success: false, errors: [{ code, message }], messages: [], result: null }];
const paged = (items, url) => {
  const page = Number(url.searchParams.get("page") || 1);
  const per = Number(url.searchParams.get("per_page") || 20);
  const slice = items.slice((page - 1) * per, page * per);
  return ok(slice, {
    result_info: { page, per_page: per, count: slice.length, total_count: items.length, total_pages: Math.max(1, Math.ceil(items.length / per)) },
  });
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms * pace));

function metadataOf(body, type) {
  const boundary = /boundary=([^;]+)/.exec(type || "")?.[1];
  if (!boundary) return null;
  for (const part of body.toString("latin1").split(`--${boundary}`)) {
    if (!/name="metadata"/.test(part)) continue;
    const json = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
    return JSON.parse(Buffer.from(json, "latin1").toString("utf8"));
  }
  return null;
}

function d1(account, id, body) {
  const db = state.databases[account]?.find((d) => d.uuid === id);
  if (!db) return fail(404, 7404, "The database could not be found.");
  const sql = String(body.sql || "");
  const applied = (state.migrations[id] ||= []);
  let results = [];
  if (/^SELECT name FROM d1_migrations/i.test(sql)) {
    results = applied.map((name) => ({ name }));
  } else {
    for (const m of sql.matchAll(/INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\)/g)) applied.push(m[1]);
    const tables = sql.match(/CREATE TABLE/gi)?.length || 0;
    db.num_tables += tables;
    db.file_size += 4096 * tables;
  }
  const changes = /^\s*(INSERT|UPDATE)/i.test(sql) ? 1 : 0;
  return ok([
    {
      results,
      success: true,
      meta: { served_by: "v3-prod", duration: 0.21, changes, last_row_id: changes, changed_db: changes > 0, size_after: db.file_size, rows_read: results.length, rows_written: changes },
    },
  ]);
}

async function answer(req, url, body) {
  const path = url.pathname;
  const health = /^\/([a-z0-9.-]+)\/_p99\/health$/.exec(path);
  if (health) {
    const script = state.scripts[ada]?.p99;
    const version = script?.bindings.find((b) => b.name === "VERSION")?.text;
    if (!version) return [404, { error: "not found" }];
    return [200, { ok: true, version, host: health[1] }];
  }
  if (!path.startsWith(prefix)) return fail(404, 7003, "No route for that URI");
  if (!/^Bearer \S{20,}$/.test(req.headers.authorization || "")) return fail(400, 6003, "Invalid request headers");
  const p = path.slice(prefix.length);
  const m = (re) => re.exec(p);
  let g;

  if (p === "/user/tokens/verify") return delay(500).then(() => ok({ id: "a6f0e2c94b1d47e8b35c0d9f21e7a4b8", status: "active" }, { messages: [{ code: 10000, message: "This API Token is valid and active", type: null }] }));
  if (p === "/accounts") return paged(accounts.map((a) => ({ ...a, type: "standard", settings: { enforce_twofactor: false }, created_on: stamp(900) })), url);
  if ((g = m(/^\/accounts\/(\w+)\/tokens\/verify$/))) return ok({ id: "a6f0e2c94b1d47e8b35c0d9f21e7a4b8", status: "active" });
  if (p === "/zones") {
    const zones = state.zones.filter((z) => z.account === url.searchParams.get("account.id"));
    return paged(zones.map((z) => ({ id: z.id, name: z.name, status: "active", paused: false, type: "full", name_servers: ["ada.ns.cloudflare.com", "kai.ns.cloudflare.com"], account: { id: z.account } })), url);
  }
  if ((g = m(/^\/zones\/(\w+)\/workers\/routes$/))) {
    const routes = state.routes[g[1]];
    if (!routes) return fail(404, 1001, "Invalid zone identifier");
    if (req.method === "POST") {
      const route = { id: hex(32), pattern: body.pattern, script: body.script };
      routes.push(route);
      await delay(350);
      return ok(route);
    }
    return ok(routes);
  }
  const acct = m(/^\/accounts\/(\w+)(\/.*)$/);
  if (!acct || !accounts.some((a) => a.id === acct[1])) return fail(403, 9109, "Unauthorized to access requested resource");
  const [, account, rest] = acct;
  const scripts = state.scripts[account];

  if (rest === "/workers/scripts") return ok(Object.entries(scripts).map(([id, s]) => ({ id, created_on: s.created_on, modified_on: s.modified_on, handlers: ["fetch"], usage_model: "standard" })));
  if ((g = /^\/workers\/scripts\/([\w-]+)$/.exec(rest)) && req.method === "PUT") {
    const meta = metadataOf(body, req.headers["content-type"]);
    if (!meta?.main_module) return fail(400, 10021, "Uncaught Error: No such module");
    const old = scripts[g[1]];
    const kept = (old?.bindings || []).filter((b) => (meta.keep_bindings || []).includes(b.type));
    scripts[g[1]] = {
      created_on: old?.created_on || stamp(),
      modified_on: stamp(),
      bindings: [...meta.bindings, ...kept],
      secrets: old?.secrets || [],
      schedules: old?.schedules || [],
      compatibility_date: meta.compatibility_date,
    };
    await delay(900);
    return ok({ id: g[1], etag: hex(64), handlers: ["fetch", "scheduled"], modified_on: stamp(), created_on: scripts[g[1]].created_on, usage_model: "standard", compatibility_date: meta.compatibility_date, has_modules: true });
  }
  if ((g = /^\/workers\/scripts\/([\w-]+)\/(settings|secrets|schedules)$/.exec(rest))) {
    const script = scripts[g[1]];
    if (!script) return fail(404, 10007, "This Worker does not exist on your account.");
    if (g[2] === "settings") return ok({ bindings: script.bindings.map((b) => (b.type === "secret_text" ? { type: b.type, name: b.name } : b)), compatibility_date: script.compatibility_date || "2026-01-15", compatibility_flags: [], placement: {}, tags: [], usage_model: "standard" });
    if (g[2] === "schedules") {
      script.schedules = (Array.isArray(body) ? body : []).map((s) => ({ cron: s.cron, created_on: stamp(), modified_on: stamp() }));
      return ok({ schedules: script.schedules });
    }
    if (req.method === "PUT") {
      script.secrets = script.secrets.filter((n) => n !== body.name).concat(body.name);
      script.bindings = script.bindings.filter((b) => b.name !== body.name).concat({ type: "secret_text", name: body.name });
      return ok({ name: body.name, type: "secret_text" });
    }
    return ok(script.secrets.map((name) => ({ name, type: "secret_text" })));
  }
  if (rest === "/d1/database") {
    const list = state.databases[account];
    if (req.method === "POST") {
      if (list.some((d) => d.name === body.name)) return fail(400, 7502, "A database with that name already exists");
      const db = { uuid: uuid(), name: body.name, version: "production", created_at: stamp(), num_tables: 0, file_size: 12288 };
      list.push(db);
      await delay(500);
      return ok({ uuid: db.uuid, name: db.name, created_at: db.created_at, version: db.version });
    }
    return paged(list, url);
  }
  if ((g = /^\/d1\/database\/([\w-]+)\/query$/.exec(rest))) return d1(account, g[1], body);
  if (rest === "/r2/buckets") {
    const list = state.buckets[account];
    if (req.method === "POST") {
      if (list.some((b) => b.name === body.name)) return fail(409, 10004, "The bucket you tried to create already exists, and you own it.");
      const bucket = { name: body.name, creation_date: stamp(), location: "WEUR" };
      list.push(bucket);
      await delay(350);
      return ok(bucket);
    }
    return ok({ buckets: list });
  }
  if (rest === "/workers/domains") return ok([]);
  if (rest === "/pages/projects") return ok(state.pages[account]);
  return fail(404, 7003, `No route for that URI`);
}

const server = createServer((req, res) => {
  clearTimeout(quiet);
  quiet = setTimeout(() => process.exit(0), idle);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let body = raw;
    if ((req.headers["content-type"] || "").includes("json") && raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        body = {};
      }
    }
    let status, payload;
    try {
      [status, payload] = await answer(req, url, body);
    } catch (error) {
      [status, payload] = fail(500, 10013, String(error));
    }
    if (process.env.P99_MOCK_LOG) console.log(req.method, url.pathname + url.search, status);
    res.writeHead(status, { "content-type": "application/json", "cf-ray": `${hex(16)}-AMS` });
    res.end(JSON.stringify(payload));
  });
});

server.listen(port, "127.0.0.1");
setTimeout(() => process.exit(0), life).unref();

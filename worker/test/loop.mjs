import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { extname, join, normalize, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { LICENCE_TEST_KEY, licenceKey } from "./spaces.mjs";

export const SHOP = "shop.example.com";
export const BLOG = "blog.example.com";
export const APP = "p99.example.com";
const SPACE = { slug: "example", name: "Example" };
const PROJECTS = [
  { name: "Shop", hosts: [SHOP] },
  { name: "Blog", hosts: [BLOG] },
  { name: "Ops", hosts: [] },
];
const PEOPLE = {
  ada: { email: "ada@example.com", name: "Ada Lovelace", agent: false },
  grace: { email: "grace@example.com", name: "Grace Hopper", agent: false },
  mary: { email: "mary@example.com", name: "Mary Jackson", agent: false },
  agent: { email: "ada@example.com", name: "Ada Lovelace", agent: true },
};
const FOLDERS = [
  ["worker", "test", "us"],
  ["render", "web", "us"],
  ["loop", "us"],
];
const RESEND_KEY = "test-resend";
const GITHUB_TOKEN = "ghp-loop-token";
const GITHUB_HOOK = "github-loop-hook";
const P99_LIMIT_MS = 60000;
const MAIL_SEED = "INSERT INTO mail (id, provider, sender, updated_at) VALUES (1, 'resend', 'P99 <p99@example.com>', '2026-10-20T00:00:00Z');";
export const LOCKED_CSP = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const LOCKED = new Set(["locked.html"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

const tagOf = (host, sha256) => sha256(Buffer.from(host)).slice(0, 16).toUpperCase();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
    await wait(100);
  }
};
const addressOf = (to) => (/<([^>]+)>/.exec(String(to))?.[1] ?? String(to)).trim().toLowerCase();

function parsed(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function linksIn(...texts) {
  const found = [];
  for (const text of texts) {
    for (const match of String(text ?? "").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
      const link = match[0].replace(/&amp;/g, "&").replace(/[.,;:]+$/, "");
      if (!found.includes(link)) found.push(link);
    }
  }
  return found;
}

function outside() {
  const seen = { mail: [], hooks: [], github: [] };
  const answers = { mail: 200, hooks: 200, github: new Map() };
  const counters = { issue: 0, hook: 0, mail: 0 };
  const github = (asked) => {
    const named = answers.github.get(`${asked.method} ${asked.path.split("?")[0]}`);
    if (named) return typeof named === "function" ? named(asked) : named;
    const repo = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(asked.path.split("?")[0]);
    if (!repo) return { status: 404, body: { message: "Not Found" } };
    const [, name, rest = ""] = repo;
    if (asked.method === "GET" && rest === "") return { status: 200, body: { full_name: name, permissions: { admin: true, push: true } } };
    if (asked.method === "GET" && rest === "/hooks") return { status: 200, body: [] };
    if (asked.method === "POST" && rest === "/hooks") return { status: 201, body: { id: ++counters.hook } };
    if (asked.method === "PATCH" && /^\/hooks\/\d+$/.test(rest)) return { status: 200, body: { id: Number(rest.slice(7)) } };
    if (asked.method === "DELETE" && /^\/hooks\/\d+$/.test(rest)) return { status: 204 };
    if (asked.method === "POST" && rest === "/issues") {
      const number = ++counters.issue;
      return { status: 201, body: { number, html_url: `https://github.com/${name}/issues/${number}` } };
    }
    if (asked.method === "GET" && /^\/pulls\/\d+\/commits$/.test(rest)) return { status: 200, body: [] };
    return { status: 404, body: { message: "Not Found" } };
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = parsed(Buffer.concat(chunks).toString("utf8"));
      const path = req.url;
      const reply = (status, answer) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(answer === undefined ? "" : JSON.stringify(answer));
      };
      if (path === "/emails/batch" || path === "/emails") {
        if (req.headers.authorization !== `Bearer ${RESEND_KEY}`) return reply(401, { message: "the fake Resend wants its key" });
        if (answers.mail !== 200) return reply(answers.mail, { message: "the fake Resend was told to fail" });
        const messages = path === "/emails" ? [body] : Array.isArray(body) ? body : [];
        const ids = messages.map((message) => {
          seen.mail.push(message);
          return { id: `mail-${++counters.mail}` };
        });
        return reply(200, path === "/emails" ? ids[0] : { data: ids });
      }
      const service = /^\/(slack|discord)(\/.*)$/.exec(path);
      if (service) {
        seen.hooks.push({ service: service[1], path: service[2], body });
        res.writeHead(answers.hooks);
        return res.end();
      }
      if (path.startsWith("/github/")) {
        const asked = { method: req.method, path: path.slice("/github".length), auth: req.headers.authorization, body };
        seen.github.push(asked);
        const answer = github(asked);
        if (answer === "drop") return req.socket.destroy();
        return reply(answer.status, answer.body);
      }
      if (path.startsWith("/cloudflare/")) {
        return reply(503, { success: false, errors: [{ code: 10000, message: "the story loop has no Cloudflare" }], messages: [], result: null });
      }
      reply(404, { message: "nothing fakes this here" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, answers, origin: `http://127.0.0.1:${server.address().port}` })));
}

function selfSigned(dir) {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, "app.key");
  const cert = join(dir, "app.crt");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", `/CN=${APP}`], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(`openssl could not make the app host's test certificate: ${made.error?.message ?? made.stderr}`);
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function site(repo, workerPort, tls) {
  const files = join(repo, "render", "web", "site");
  const routeOf = (req) => {
    const pinned = /^\/@([a-z0-9.-]+)(\/.*)?$/i.exec(req.url);
    if (pinned) return { host: pinned[1].toLowerCase(), path: pinned[2] || "/" };
    return { host: String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase(), path: req.url };
  };
  const page = (res, path) => {
    const wanted = normalize(new URL(path, "http://site").pathname).replace(/^\/+/, "");
    const full = join(files, wanted);
    const name = full.startsWith(files) && wanted && existsSync(full) && statSync(full).isFile() ? full : join(files, "checkout.html");
    const headers = { "content-type": TYPES[extname(name)] || "application/octet-stream", "cache-control": "no-cache" };
    if (LOCKED.has(wanted)) headers["content-security-policy"] = LOCKED_CSP;
    res.writeHead(200, headers);
    res.end(readFileSync(name));
  };
  const handle = (secure) => (req, res) => {
    const { host, path } = routeOf(req);
    if (host !== APP && !path.startsWith("/_p99/")) return page(res, path);
    const headers = { ...req.headers, host };
    if (secure && headers.origin === `https://${host}`) headers.origin = `http://${host}`;
    const up = request({ host: "127.0.0.1", port: workerPort, method: req.method, path, headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("the story Worker did not answer");
    });
    req.pipe(up);
  };
  const upgrade = (secure) => (req, socket, head) => {
    const { host, path } = routeOf(req);
    const up = connect(workerPort, "127.0.0.1", () => {
      const lines = [`${req.method} ${path} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        const value = req.rawHeaders[i + 1];
        lines.push(`${req.rawHeaders[i]}: ${name === "host" ? host : secure && name === "origin" && value === `https://${host}` ? `http://${host}` : value}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  };
  const plain = createServer(handle(false));
  plain.on("upgrade", upgrade(false));
  const secure = createTlsServer(tls, handle(true));
  secure.on("upgrade", upgrade(true));
  const listening = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return Promise.all([listening(plain), listening(secure)]).then(([port, tlsPort]) => ({
    port,
    tlsPort,
    close: () => {
      for (const server of [plain, secure]) {
        server.close();
        server.closeAllConnections();
      }
    },
  }));
}

function binaryOf(repo) {
  if (process.env.P99_BIN) return process.env.P99_BIN;
  const built = ["release", "debug"]
    .map((profile) => join(repo, "target", profile, "p99"))
    .filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (built.length === 0) throw new Error("no p99 binary to drive; run cargo build first or set P99_BIN");
  return built[0];
}

function scratchHome(dir, workerBase, keys) {
  rmSync(dir, { recursive: true, force: true });
  for (const sub of ["xdg", "run", "data", "cache"]) mkdirSync(join(dir, sub), { recursive: true });
  const config = join(dir, "config.toml");
  const quoted = (list) => `[${list.map((h) => `"${h}"`).join(", ")}]`;
  writeFileSync(
    config,
    [
      `default_space = "${SPACE.slug}"`,
      "[me]",
      `name = "${PEOPLE.ada.name}"`,
      `email = "${PEOPLE.ada.email}"`,
      `[spaces.${SPACE.slug}]`,
      `name = "${SPACE.name}"`,
      'account_id = "local"',
      'token = ""',
      `url = "${workerBase}/_p99"`,
      `app = "${APP}"`,
      `[spaces.${SPACE.slug}.projects]`,
      ...PROJECTS.map((p) => `${p.name} = ${quoted(p.hosts)}`),
      ...PROJECTS.flatMap((p) => p.hosts.flatMap((h) => [`[hosts."${h}"]`, `space = "${SPACE.slug}"`])),
      "",
    ].join("\n"),
  );
  chmodSync(config, 0o600);
  return { config, key: keys.p99 };
}

async function chromiumOf(repo) {
  const require = createRequire(join(repo, "render", "web", "package.json"));
  let folder;
  try {
    folder = join(require.resolve("playwright/package.json"), "..");
  } catch {
    throw new Error("kit.page needs Playwright: run npm ci in render/web");
  }
  const loaded = await import(pathToFileURL(join(folder, "index.mjs")).href);
  return loaded.chromium ?? loaded.default.chromium;
}

function openShadow() {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attach.call(this, { ...init, mode: "open" });
  };
}

function totpAt(key, at) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of String(key).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

export function storyModules(repo) {
  const found = [];
  for (const parts of FOLDERS) {
    const dir = join(repo, ...parts);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) if (name.endsWith(".mjs")) found.push(join(dir, name));
  }
  return found;
}

export async function loopStories(h) {
  const repo = join(h.root, "..");
  const modules = storyModules(repo);
  if (modules.length === 0) return;
  const state = join(h.work, "loop-state");
  const scratch = join(h.work, "loop");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  const fakes = await outside();
  const workerBase = `http://127.0.0.1:${h.port}`;
  const vars = Object.entries(h.keys).map(([id, secret]) => `KEY_${id.toUpperCase()}:${secret}`);
  vars.push(
    "CODE_PEPPER:loop-pepper",
    "LOOP_TEST:1",
    `SPACE:${SPACE.slug}`,
    `SPACE_NAME:${SPACE.name}`,
    `APP_HOST:${APP}`,
    `LICENSE_TEST_KEY:${LICENCE_TEST_KEY}`,
    `HOOKS_TEST_ORIGIN:${fakes.origin}`,
    `RESEND_API_KEY:${RESEND_KEY}`,
    `RESEND_API_URL:${fakes.origin}`,
    `GITHUB_API:${fakes.origin}/github`,
  );
  for (const host of PROJECTS.flatMap((p) => p.hosts)) {
    vars.push(`GITHUB_TOKEN_${tagOf(host, h.sha256)}:${GITHUB_TOKEN}`, `GITHUB_HOOK_${tagOf(host, h.sha256)}:${GITHUB_HOOK}`);
  }
  let dev = null;
  let front = null;
  let browser = null;
  const running = new Set();
  const stopAll = () => {
    for (const child of running) child.kill("SIGKILL");
    dev?.stop();
  };
  process.on("exit", stopAll);
  try {
    h.wranglerSync(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
    const seedFile = join(h.work, "loop-seed.sql");
    writeFileSync(seedFile, MAIL_SEED);
    h.wranglerSync(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", seedFile]);
    dev = await h.startDev(h.port, vars, "test-dev-loop.log", { persist: state });
  } catch (error) {
    await h.check("[loop] the story Worker starts on a fresh space", () => {
      throw error;
    });
    process.off("exit", stopAll);
    await dev?.stop();
    fakes.server.close();
    return;
  }
  h.setBase(workerBase);
  front = await site(repo, h.port, selfSigned(join(h.work, "loop-tls")));
  const sitePort = front.port;
  const home = scratchHome(scratch, workerBase, h.keys);
  const clockAt = async (body) => {
    const response = await fetch(`${workerBase}/_p99/test/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const answer = await response.json();
    if (response.status !== 200) throw new Error(`the Worker clock refused ${JSON.stringify(body)}: ${answer.message}`);
    clock.shift = answer.shift;
    return answer.now;
  };
  const clock = {
    shift: 0,
    set: (iso) => clockAt({ at: new Date(iso).toISOString() }),
    advance: (ms) => clockAt({ advance: ms }),
    reset: () => clockAt({ real: true }),
    now: () => Date.now() + clock.shift,
  };
  await h.check("[loop] the test clock answers 404 on a site's host, even with LOOP_TEST", async () => {
    const asked = await fetch(`http://127.0.0.1:${sitePort}/@${SHOP}/_p99/test/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ advance: 86400000 }) });
    if (asked.status !== 404) {
      await clock.reset();
      throw new Error(`a site's host moved the clock: ${asked.status}`);
    }
  });
  const p99Env = (extra = {}) => {
    const env = {
      PATH: process.env.PATH,
      HOME: scratch,
      XDG_CONFIG_HOME: join(scratch, "xdg"),
      XDG_RUNTIME_DIR: join(scratch, "run"),
      XDG_DATA_HOME: join(scratch, "data"),
      XDG_CACHE_HOME: join(scratch, "cache"),
      P99_CONFIG: home.config,
      P99_KEY: home.key,
      P99_KEY_SPACE: SPACE.slug,
      P99_HOST_URL: `http://127.0.0.1:${sitePort}/@{host}`,
      P99_CLOUDFLARE_API: `${fakes.origin}/cloudflare`,
      P99_GITHUB_API: `${fakes.origin}/github`,
      P99_RESEND_API: fakes.origin,
      P99_BROWSER: join(scratch, "no-browser-in-tests"),
      NO_COLOR: "1",
      LANG: "C.UTF-8",
    };
    for (const [name, value] of Object.entries(extra)) {
      if (value === null || value === undefined) delete env[name];
      else env[name] = String(value);
    }
    return env;
  };
  const launch = (args, env, input) => {
    const child = spawn(binaryOf(repo), args, { cwd: scratch, env: p99Env(env), stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    running.add(child);
    child.on("error", () => running.delete(child));
    child.once("close", () => running.delete(child));
    if (input !== undefined) child.stdin.end(input);
    return child;
  };
  const p99 = (args, { env, input } = {}) =>
    new Promise((resolve, reject) => {
      const child = launch(args, env, input);
      const out = { stdout: "", stderr: "" };
      child.stdout.on("data", (chunk) => (out.stdout += chunk));
      child.stderr.on("data", (chunk) => (out.stderr += chunk));
      const timer = setTimeout(() => child.kill("SIGKILL"), P99_LIMIT_MS);
      child.on("error", reject);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ code: code ?? (signal ? -1 : null), stdout: out.stdout, stderr: out.stderr });
      });
    });
  const tui = async (keys, { size = "120x34", env, ansi = false } = {}) => {
    const args = ["tui", "--dump", size];
    if (keys) args.push("--keys", keys);
    if (ansi) args.push("--ansi");
    const out = await p99(args, { env });
    if (out.code !== 0) throw new Error(`p99 ${args.join(" ")} exited ${out.code}: ${out.stderr}`);
    return out.stdout;
  };
  const watch = async ({ host, args = [], env } = {}) => {
    const child = launch(["watch", "--json", ...(host ? ["--host", host] : []), ...args], env);
    const queue = [];
    const waiters = [];
    const out = { stdout: "", stderr: "", rest: "", code: null };
    const deliver = (event) => (waiters.length > 0 ? waiters.shift()(event) : queue.push(event));
    child.stdout.on("data", (chunk) => {
      out.stdout += chunk;
      out.rest += chunk;
      let at;
      while ((at = out.rest.indexOf("\n")) >= 0) {
        const line = out.rest.slice(0, at).trim();
        out.rest = out.rest.slice(at + 1);
        if (line) deliver(parsed(line));
      }
    });
    child.stderr.on("data", (chunk) => (out.stderr += chunk));
    const exited = new Promise((resolve) =>
      child.once("close", (code, signal) => {
        out.code = code ?? (signal ? -1 : null);
        resolve();
      }),
    );
    for (let i = 0; i < 200 && out.code === null && !/connected/.test(out.stderr); i++) await wait(100);
    return {
      next: (timeoutMs = 10000) =>
        queue.length > 0
          ? Promise.resolve(queue.shift())
          : new Promise((resolve) => {
              const waiter = (event) => {
                clearTimeout(timer);
                resolve(event);
              };
              const timer = setTimeout(() => {
                waiters.splice(waiters.indexOf(waiter), 1);
                resolve(null);
              }, timeoutMs);
              waiters.push(waiter);
            }),
      stderr: () => out.stderr,
      stop: async () => {
        if (out.code === null) child.kill("SIGTERM");
        await exited;
        return { code: out.code, stdout: out.stdout, stderr: out.stderr };
      },
    };
  };
  const browserOf = async () => {
    if (browser) return browser;
    const chromium = await chromiumOf(repo);
    const hosts = [SHOP, BLOG, APP, "example.com"];
    const executablePath = process.env.P99_CHROMIUM || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    browser = await chromium.launch({
      executablePath,
      env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
      args: [
        `--host-resolver-rules=MAP ${APP} 127.0.0.1:${front.tlsPort}, MAP example.com 127.0.0.1:${sitePort}, MAP *.example.com 127.0.0.1:${sitePort}`,
        `--unsafely-treat-insecure-origin-as-secure=${[...hosts, "*.example.com"].map((host) => `http://${host}`).join(",")}`,
        "--hide-scrollbars",
      ],
    });
    return browser;
  };
  const browseOn = (method, path, code, body, host = SHOP) =>
    new Promise((resolve, reject) => {
      const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const headers = { host };
      if (code !== undefined) headers["x-p99-code"] = code;
      if (bytes) Object.assign(headers, { "content-type": "application/json", "content-length": bytes.length });
      const req = request({ host: "127.0.0.1", port: h.port, method, path: `/_p99/api${path}`, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const json = String(res.headers["content-type"] || "").startsWith("application/json") ? JSON.parse(text) : null;
          resolve({ status: res.statusCode, json, text, headers: res.headers });
        });
      });
      req.on("error", reject);
      req.end(bytes ?? undefined);
    });
  const must = async (what, answer, ...ok) => {
    const got = await answer;
    if (!ok.includes(got.status)) throw new Error(`${what}: ${got.status} ${JSON.stringify(got.json)}`);
    return got.json;
  };
  const seed = async () => {
    const ada = PEOPLE.ada;
    await must("the dev env", h.call("PUT", "/_p99/v1/envs/dev", { actor: ada, body: { kind: "development", position: 0 } }), 200);
    await must("the production env", h.call("PUT", "/_p99/v1/envs/production", { actor: ada, body: { kind: "release", position: 1, notify: true } }), 200);
    for (const project of PROJECTS) await must(`the ${project.name} project`, h.call("POST", "/_p99/v1/projects", { actor: ada, body: { name: project.name } }), 201, 409);
    for (const project of PROJECTS) {
      for (const host of project.hosts) {
        await must(`the host ${host}`, h.call("PUT", `/_p99/v1/hosts/${host}`, { actor: ada, body: { env: "production", project: project.name, config: {} } }), 200);
      }
    }
  };
  const kitFor = () => {
    const marks = { mail: fakes.seen.mail.length, hooks: fakes.seen.hooks.length, github: fakes.seen.github.length };
    const pages = [];
    const watches = [];
    const kit = {
      check: h.check,
      red: h.red,
      call: h.call,
      listen: h.listen,
      issueBody: h.issueBody,
      until,
      base: workerBase,
      origin: (host = SHOP) => `http://127.0.0.1:${sitePort}/@${host}`,
      people: PEOPLE,
      licenceKey,
      browse: browseOn,
      mint: async (name, email, reach = [SHOP], owner = false) => {
        const scope = Array.isArray(reach) ? { hosts: reach } : { grant: reach };
        return must(`minting ${email}`, h.call("POST", "/_p99/v1/codes", { actor: PEOPLE.ada, body: { name, email, ...scope, role: owner ? "owner" : "user", mail: false } }), 201);
      },
      file: (host = SHOP, overrides = {}, { actor = PEOPLE.ada } = {}) =>
        must(`filing on ${host}`, h.call("POST", `/_p99/v1/issues?host=${host}`, { actor, body: h.issueBody(overrides) }), 201),
      totp: (key, at = clock.now()) => totpAt(key, at),
      p99,
      tui,
      watch: async (options) => {
        const handle = await watch(options);
        watches.push(handle);
        return handle;
      },
      page: async (options = {}) => {
        const context = await (await browserOf()).newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", ignoreHTTPSErrors: true, ...options });
        await context.addInitScript(openShadow);
        pages.push(context);
        return context.newPage();
      },
      siteUrl: (host = SHOP, path = "/") => `http://${host}${path.startsWith("/") ? path : `/${path}`}`,
      appUrl: (path = "/") => `https://${APP}${path.startsWith("/") ? path : `/${path}`}`,
      mail: {
        inbox: (email) =>
          fakes.seen.mail
            .slice(marks.mail)
            .filter((m) => [m.to].flat().some((to) => addressOf(to) === String(email).toLowerCase()))
            .map((m) => ({ ...m, to: [m.to].flat(), links: linksIn(m.text, m.html) })),
        answer: (status) => {
          fakes.answers.mail = status;
        },
      },
      hooks: {
        posts: () => fakes.seen.hooks.slice(marks.hooks),
        answer: (status) => {
          fakes.answers.hooks = status;
        },
      },
      github: {
        issues: () => fakes.seen.github.slice(marks.github),
        answer: (route, reply) => fakes.answers.github.set(route, reply),
        hookSecret: GITHUB_HOOK,
      },
      clock: { set: clock.set, advance: clock.advance, reset: clock.reset, now: clock.now },
      space: { ...SPACE, app: APP, projects: PROJECTS.map((p) => ({ name: p.name, hosts: [...p.hosts] })) },
      close: async () => {
        for (const handle of watches) await handle.stop();
        for (const context of pages) await context.close().catch(() => {});
        fakes.answers.mail = 200;
        fakes.answers.hooks = 200;
        fakes.answers.github.clear();
        if (clock.shift !== 0) await clock.reset();
      },
    };
    return kit;
  };
  try {
    for (const file of modules) {
      const name = relative(repo, file);
      let story;
      try {
        await seed();
        story = await import(pathToFileURL(file).href);
        if (typeof story.default !== "function") throw new Error("it exports no default async (kit) => …");
      } catch (error) {
        await h.check(`[loop] ${name} loads on the seeded space`, () => {
          throw error;
        });
        continue;
      }
      const kit = kitFor();
      try {
        await story.default(kit);
      } catch (error) {
        await h.check(`[loop] ${name} runs to its end`, () => {
          throw error;
        });
      } finally {
        await kit.close();
      }
    }
  } finally {
    process.off("exit", stopAll);
    await browser?.close().catch(() => {});
    for (const child of running) child.kill("SIGKILL");
    front.close();
    fakes.server.close();
    fakes.server.closeAllConnections();
    await dev.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
export const adaBot = { email: "ada@example.com", name: "Ada Lovelace", agent: true, via: "writer" };
export const SLACK = "https://hooks.slack.com/services/T0001/B0002/aaaabbbbccccWXYZ";
export const GITHUB_REPO = "acme/shop";

export const tag = () => randomUUID().slice(0, 8);

export function places(kit) {
  const project = (name) => kit.space.projects.find((p) => p.name === name);
  const shop = project("Shop");
  const blog = project("Blog");
  assert.ok(shop && blog && shop.hosts.length > 0 && blog.hosts.length > 0, "the seeded space has Shop and Blog, each on a host");
  return { shop: shop.hosts[0], blog: blog.hosts[0], shopProject: "Shop", blogProject: "Blog", opsProject: "Ops" };
}

export async function reporter(kit, host, name, mark = tag()) {
  const first = name.split(" ")[0].toLowerCase();
  const email = `${first}.${mark}@example.com`;
  const minted = await kit.mint(name, email, [host]);
  assert.ok(minted.secret, "the code was minted");
  return { name, email, secret: minted.secret, host };
}

export async function fileAs(kit, who, title, extra = {}) {
  const filed = await kit.browse("POST", "/issues", who.secret, kit.issueBody({ title, ...extra }), who.host);
  assert.equal(filed.status, 201, JSON.stringify(filed.json));
  return filed.json;
}

export async function reply(kit, key, host, text, actor = ada, extra = {}) {
  const made = await kit.call("POST", `/_p99/v1/issues/${key}/comments?host=${host}`, {
    actor,
    body: { client_uid: randomUUID(), body: text, ...extra },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
}

export async function thread(kit, key, host) {
  const got = await kit.call("GET", `/_p99/v1/issues/${key}?host=${host}`, { actor: ada });
  assert.equal(got.status, 200, JSON.stringify(got.json));
  return got.json;
}

export const move = (kit, host, body, actor = ada) => kit.call("POST", `/_p99/v1/move?host=${host}`, { actor, body });

export async function releaseEnv(kit, name = "production", notify = true) {
  const set = await kit.call("PUT", `/_p99/v1/envs/${name}`, { body: { kind: "release", position: 1, notify } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
}

export async function ship(kit, keys, { env = "production", version = "v9.9.9", sha = createHash("sha1").update(randomUUID()).digest("hex") } = {}) {
  const built = await kit.call("POST", "/_p99/v1/builds", {
    body: {
      env,
      sha,
      branch: "main",
      version,
      dirty: false,
      items: [].concat(keys).map((id) => ({ id, rel: "fixes", sha, subject: "Fix it" })),
    },
  });
  assert.equal(built.status, 204, JSON.stringify(built.json));
}

export async function mailsFor(kit, email, subjectStart) {
  return (await kit.mail.inbox(email)).filter((m) => m.subject.startsWith(subjectStart));
}

export async function hook(kit, host, url = SLACK, events) {
  const put = await kit.call("PUT", `/_p99/v1/hooks/${host}`, { body: { url, ...(events ? { events } : {}) } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  return put.json;
}

export async function posts(kit, key) {
  return (await kit.hooks.posts()).filter((p) => JSON.stringify(p).includes(key));
}

export async function deliverGithub(kit, host, event, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const response = await fetch(`${kit.origin(host)}/_p99/v1/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": randomUUID(),
      "x-hub-signature-256": `sha256=${createHmac("sha256", kit.github.hookSecret).update(bytes).digest("hex")}`,
    },
    body: bytes,
  });
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, json };
}

export async function ticketHeard(kit, host, code, heard) {
  const ticket = await kit.browse("POST", "/stream-ticket", code, undefined, host);
  assert.equal(ticket.status, 201, JSON.stringify(ticket.json));
  const url = `${kit.origin(host).replace(/^http/, "ws")}/_p99/api/stream?t=${ticket.json.ticket}`;
  const socket = new WebSocket(url);
  socket.addEventListener("message", (message) => heard.push(JSON.parse(message.data)));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("the stream did not open")));
  });
  return socket;
}

export const uniqueTitle = (what) => `${what} ${tag()}`;

export async function setFeed(kit, host, on) {
  const listed = await kit.call("GET", "/_p99/v1/hosts");
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  const entry = listed.json.hosts.find((h) => h.host === host);
  assert.ok(entry, `${host} is a host of this space`);
  const config = { ...(entry.config ?? {}) };
  if (on) config.feed = true;
  else delete config.feed;
  const put = await kit.call("PUT", `/_p99/v1/hosts/${host}`, { body: { env: entry.env, project: entry.project, config } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
}

export const feedOf = (kit, host, query = "") => fetch(`${kit.origin(host)}/_p99/feed${query}`);

export function gitRepo(messages) {
  const base = fileURLToPath(new URL("../../.wrangler/us-repos/", import.meta.url));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "r-"));
  const git = (...args) => {
    const run = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Ada Lovelace", "-c", "user.email=ada@example.com", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    assert.equal(run.status, 0, run.stderr);
  };
  git("init", "-q", "-b", "main");
  messages.forEach((message, n) => {
    writeFileSync(join(dir, `change-${n}.txt`), message);
    git("add", `change-${n}.txt`);
    git("commit", "-q", "-m", message);
  });
  const head = () => {
    const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  return { dir, head, env: { GIT_DIR: join(dir, ".git"), GIT_WORK_TREE: dir }, drop: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function environments(kit) {
  const dev = await kit.call("PUT", "/_p99/v1/envs/dev", { body: { kind: "development", position: 0 } });
  assert.equal(dev.status, 200, JSON.stringify(dev.json));
  await releaseEnv(kit, "production", true);
}

export function jsonOut(run) {
  assert.equal(run.code, 0, `exit ${run.code}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

export async function hear(watcher, wanted, ms = 20000) {
  const seen = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const event = await watcher.next(Math.max(1000, deadline - Date.now()));
    if (!event) break;
    seen.push(event);
    if (wanted(event)) return { event, seen };
  }
  throw new Error(`the watch never heard the event: ${JSON.stringify(seen)}`);
}

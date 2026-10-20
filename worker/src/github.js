import { moveItem } from "./boards.js";

const GITHUB_API = "https://api.github.com";
const PREFIXES = new Set(["BUG", "FEAT", "IMP", "Q", "TASK"]);
const TRAILER = /\b(fixes|refs)\s*:/gi;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const DELIVERY = /^[A-Za-z0-9-]{1,64}$/;
const MAX_DELIVERY_BYTES = 2 * 1024 * 1024;
const DELIVERY_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_MS = 60 * 1000;
const COMMIT_PAGES = 3;
const GITHUB_ACTOR = { email: null, name: "GitHub", agent: false };

let K = null;

export function useKit(kit) {
  K = kit;
}

export function trailerIds(text) {
  const found = { fixes: new Set(), refs: new Set() };
  for (const line of String(text ?? "").split("\n")) {
    const marks = [...line.matchAll(TRAILER)];
    marks.forEach((mark, at) => {
      const end = at + 1 < marks.length ? marks[at + 1].index : line.length;
      for (const id of keyIds(line.slice(mark.index + mark[0].length, end))) found[mark[1].toLowerCase()].add(id);
    });
  }
  for (const id of found.fixes) found.refs.delete(id);
  return found;
}

function keyIds(value) {
  const ids = [];
  for (const raw of value.split(/[\s,]+/)) {
    const token = raw.trim().replace(/[.;)]+$/, "");
    const dash = token.indexOf("-");
    if (dash < 0) continue;
    const prefix = token.slice(0, dash);
    const number = token.slice(dash + 1);
    if (!PREFIXES.has(prefix) || !/^\d{1,15}$/.test(number)) continue;
    const id = Number(number);
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

async function secretNames(host) {
  const tag = (await K.sha256Hex(K.encoder.encode(host))).slice(0, 16).toUpperCase();
  return { token: `GITHUB_TOKEN_${tag}`, hook: `GITHUB_HOOK_${tag}` };
}

function present(value) {
  return typeof value === "string" && value.length > 0;
}

function sameRepo(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function webUrl(value) {
  return typeof value === "string" && /^https:\/\/[^\s]+$/.test(value) ? value : null;
}

async function callGithub(env, token, method, path, body) {
  const base = (present(env.GITHUB_API) ? env.GITHUB_API : GITHUB_API).replace(/\/+$/, "");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "p99",
    "x-github-api-version": "2022-11-28",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { ok: response.ok, status: response.status, data: K.parseJson(text, null) };
}

function said(answer) {
  const message = answer.data && typeof answer.data.message === "string" ? `: ${answer.data.message}` : "";
  return `GitHub answered ${answer.status}${message}`;
}

function entryOf(row, names, env) {
  return {
    host: row.host,
    repo: row.repo,
    hook_id: row.hook_id,
    webhook: `https://${row.host}/_p99/v1/github`,
    token: present(env[names.token]),
    secret: present(env[names.hook]),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function linkOf(row) {
  return { kind: row.kind, rel: row.rel, repo: row.repo, number: row.number, url: row.url, at: row.at };
}

export function githubLinksStatement(c, itemId) {
  return c.env.DB.prepare(
    "SELECT kind, rel, repo, number, url, at FROM github_links WHERE item_id = ?1 AND number IS NOT NULL ORDER BY id",
  ).bind(itemId);
}

export function githubLinks(result) {
  return (result ? result.results : []).map(linkOf);
}

function hostIn(c, rawHost) {
  const host = String(rawHost).toLowerCase();
  if (!c.dir.hosts.has(host) || (!c.scope.all && c.scope.host !== host)) K.fail(404, "no such host");
  return host;
}

export async function listGithub(c) {
  K.requireEmptyBody(c);
  const rows = (await c.env.DB.prepare("SELECT * FROM github ORDER BY host").all()).results;
  const hosts = [];
  for (const row of rows) {
    if (!c.scope.all && row.host !== c.scope.host) continue;
    hosts.push(entryOf(row, await secretNames(row.host), c.env));
  }
  return K.json(200, { hosts });
}

export async function putGithub(c, rawHost) {
  const host = hostIn(c, rawHost);
  const body = await K.readJson(c, 4096);
  if (typeof body.repo !== "string" || !REPO.test(body.repo)) K.fail(400, "repo must be owner/name");
  const hookId = body.hook_id ?? null;
  if (hookId !== null && !(Number.isSafeInteger(hookId) && hookId > 0)) K.fail(400, "hook_id must be a positive number or null");
  const row = await c.env.DB.prepare(
    `INSERT INTO github (host, repo, hook_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (host) DO UPDATE SET repo = excluded.repo, hook_id = excluded.hook_id, updated_at = excluded.updated_at
     RETURNING *`,
  )
    .bind(host, body.repo, hookId, c.now)
    .first();
  return K.json(200, entryOf(row, await secretNames(host), c.env));
}

export async function deleteGithub(c, rawHost) {
  K.requireEmptyBody(c);
  const host = hostIn(c, rawHost);
  const row = await c.env.DB.prepare("SELECT * FROM github WHERE host = ?1").bind(host).first();
  if (!row) K.fail(404, "GitHub is not set for this host");
  const names = await secretNames(host);
  let hookRemoved = false;
  if (row.hook_id !== null && present(c.env[names.token])) {
    try {
      const answer = await callGithub(c.env, c.env[names.token], "DELETE", `/repos/${row.repo}/hooks/${row.hook_id}`);
      hookRemoved = answer.ok || answer.status === 404;
    } catch (error) {
      console.error(`GitHub hook removal failed: ${error.message}`);
    }
  }
  await c.env.DB.prepare("DELETE FROM github WHERE host = ?1").bind(host).run();
  return K.json(200, { host, repo: row.repo, hook_id: row.hook_id, hook_removed: hookRemoved, secrets: [names.token, names.hook] });
}

export async function openGithubIssue(c, rawKey) {
  K.requireEmptyBody(c);
  const row = await K.loadItem(c, rawKey);
  const key = K.keyOf(row.kind, row.id);
  const { DB } = c.env;
  const existing = await DB.prepare("SELECT * FROM github_links WHERE item_id = ?1 AND rel = 'opened'").bind(row.id).first();
  if (existing && existing.number !== null) return K.json(200, { key, existing: true, ...linkOf(existing) });
  if (existing) {
    if (Date.parse(c.now) - Date.parse(existing.at) < CLAIM_MS) K.fail(409, "the issue is being opened; try again in a minute");
    await DB.prepare("DELETE FROM github_links WHERE id = ?1 AND number IS NULL").bind(existing.id).run();
  }
  const setup = await DB.prepare("SELECT * FROM github WHERE host = ?1").bind(row.host).first();
  if (!setup) K.fail(409, `GitHub is not set for ${row.host}; run p99 github set ${row.host}`);
  const token = c.env[(await secretNames(row.host)).token];
  if (!present(token)) K.fail(409, `the Worker has no GitHub token for ${row.host}; run p99 github set ${row.host}`);
  let claim;
  try {
    claim = await DB.prepare(
      `INSERT INTO github_links (item_id, kind, rel, repo, number, url, at) VALUES (?1, 'issue', 'opened', ?2, NULL, NULL, ?3) RETURNING id`,
    )
      .bind(row.id, setup.repo, c.now)
      .first();
  } catch (error) {
    if (K.isUniqueViolation(error)) K.fail(409, "the issue is being opened; try again in a minute");
    throw error;
  }
  const link = K.pageLink(row);
  const body = [`P99 item ${key}${link ? `: ${link}` : ""}`, "", `A pull request that carries \`Fixes: ${key}\` marks it fixed in P99 when it merges.`].join("\n");
  let answer;
  try {
    answer = await callGithub(c.env, token, "POST", `/repos/${setup.repo}/issues`, { title: row.title, body });
  } catch (error) {
    answer = { ok: false, status: 502, data: { message: error.message } };
  }
  const number = answer.data && Number.isSafeInteger(answer.data.number) ? answer.data.number : null;
  const url = answer.data ? webUrl(answer.data.html_url) : null;
  if (!answer.ok || number === null || url === null) {
    await DB.prepare("DELETE FROM github_links WHERE id = ?1").bind(claim.id).run();
    K.fail(502, said(answer));
  }
  await DB.batch([
    DB.prepare("UPDATE github_links SET number = ?2, url = ?3 WHERE id = ?1").bind(claim.id, number, url),
    K.eventStatement(c, row.id, c.actor.email, "github", { action: "opened", kind: "issue", repo: setup.repo, number, url }, true),
  ]);
  K.push(c, "github", row, { url });
  return K.json(201, { key, existing: false, kind: "issue", rel: "opened", repo: setup.repo, number, url, at: c.now });
}

async function verifyDelivery(request, secret, bytes) {
  const header = /^sha256=([0-9a-f]{64})$/.exec(request.headers.get("x-hub-signature-256") || "");
  if (!header) K.fail(401, "missing or malformed X-Hub-Signature-256");
  const key = await crypto.subtle.importKey("raw", K.encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, K.hexBytes(header[1]), bytes))) K.fail(401, "the signature does not verify");
}

export async function githubDelivery(request, env, ctx, url) {
  const dir = await K.loadDirectory(env);
  const hostRow = dir.hosts.get(url.hostname);
  if (!hostRow) K.fail(404, "no such host");
  const secret = env[(await secretNames(hostRow.host)).hook];
  if (!present(secret)) K.fail(404, "GitHub is not set for this host");
  const bytes = await K.readBody(request, MAX_DELIVERY_BYTES);
  await verifyDelivery(request, secret, bytes);
  const c = {
    request,
    env,
    ctx,
    url,
    dir,
    browser: false,
    signed: false,
    bodyHash: null,
    actor: GITHUB_ACTOR,
    manager: true,
    scope: { all: false, host: hostRow.host },
    hostRow,
    actionEnv: null,
    now: new Date().toISOString(),
    outbox: [],
    pushes: [],
  };
  return K.runHandler(c, deliver, [bytes]);
}

function quiet() {
  return new Response(null, { status: 204 });
}

async function deliver(c, bytes) {
  const event = c.request.headers.get("x-github-event") || "";
  if (event !== "pull_request" && event !== "issues") return quiet();
  const delivery = c.request.headers.get("x-github-delivery") || "";
  if (!DELIVERY.test(delivery)) K.fail(400, "missing or malformed X-GitHub-Delivery");
  const payload = K.parseJson(new TextDecoder().decode(bytes), null);
  if (!K.isObject(payload)) K.fail(400, "the body must be a JSON object");
  const { DB } = c.env;
  const setup = await DB.prepare("SELECT * FROM github WHERE host = ?1").bind(c.scope.host).first();
  if (!setup || !K.isObject(payload.repository) || !sameRepo(payload.repository.full_name, setup.repo)) return quiet();
  const cutoff = new Date(Date.parse(c.now) - DELIVERY_RETAIN_MS).toISOString();
  const fresh = await DB.batch([
    DB.prepare("DELETE FROM github_deliveries WHERE at < ?1").bind(cutoff),
    DB.prepare("INSERT INTO github_deliveries (id, host, at) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING").bind(
      delivery,
      c.scope.host,
      c.now,
    ),
  ]);
  if (fresh[1].meta.changes === 0) return quiet();
  try {
    return event === "pull_request" ? await onPull(c, setup, payload) : await onIssue(c, setup, payload);
  } catch (error) {
    await DB.prepare("DELETE FROM github_deliveries WHERE id = ?1").bind(delivery).run();
    throw error;
  }
}

async function itemsIn(c, ids) {
  if (ids.length === 0) return [];
  return (
    await c.env.DB.prepare("SELECT * FROM items WHERE id IN (SELECT value FROM json_each(?1)) AND host = ?2 ORDER BY id")
      .bind(JSON.stringify(ids), c.scope.host)
      .all()
  ).results;
}

async function commitMessages(c, setup, number) {
  const token = c.env[(await secretNames(c.scope.host)).token];
  if (!present(token)) return [];
  const messages = [];
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    let answer;
    try {
      answer = await callGithub(c.env, token, "GET", `/repos/${setup.repo}/pulls/${number}/commits?per_page=100&page=${page}`);
    } catch (error) {
      console.error(`GitHub commits of #${number}: ${error.message}`);
      break;
    }
    if (!answer.ok || !Array.isArray(answer.data)) {
      console.error(`GitHub commits of #${number}: ${said(answer)}`);
      break;
    }
    for (const commit of answer.data) {
      if (K.isObject(commit) && K.isObject(commit.commit) && typeof commit.commit.message === "string") messages.push(commit.commit.message);
    }
    if (answer.data.length < 100) break;
  }
  return messages;
}

async function fixAll(c, rows) {
  const changed = [];
  for (const row of rows.filter((r) => r.open)) changed.push(...(await moveItem(c, row, { to: "done", resolution: "fixed" })).changed);
  return changed;
}

async function onPull(c, setup, payload) {
  const pr = payload.pull_request;
  if (!K.isObject(pr) || !Number.isSafeInteger(pr.number)) return quiet();
  const merged = payload.action === "closed" && pr.merged === true;
  if (!merged && !["opened", "edited", "reopened"].includes(payload.action)) return quiet();
  const texts = [pr.title, pr.body];
  if (merged) texts.push(...(await commitMessages(c, setup, pr.number)));
  const { fixes, refs } = trailerIds(texts.filter((t) => typeof t === "string").join("\n"));
  const rows = await itemsIn(c, [...fixes, ...refs]);
  if (rows.length === 0) return quiet();
  const linked = await linkPull(c, setup, pr, rows, fixes);
  const changed = merged ? await fixAll(c, rows.filter((row) => fixes.has(row.id))) : [];
  return K.json(200, { linked, changed });
}

async function linkPull(c, setup, pr, rows, fixes) {
  const { DB } = c.env;
  const url = webUrl(pr.html_url);
  const known = new Map(
    (
      await DB.prepare("SELECT item_id, rel FROM github_links WHERE kind = 'pull' AND repo = ?1 AND number = ?2")
        .bind(setup.repo, pr.number)
        .all()
    ).results.map((r) => [r.item_id, r.rel]),
  );
  const statements = [];
  const linked = [];
  for (const row of rows) {
    const rel = fixes.has(row.id) ? "fixes" : "refs";
    if (known.get(row.id) === rel) continue;
    statements.push(
      DB.prepare(
        `INSERT INTO github_links (item_id, kind, rel, repo, number, url, at) VALUES (?1, 'pull', ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (item_id, repo, number) WHERE kind = 'pull' DO UPDATE SET rel = excluded.rel, url = excluded.url`,
      ).bind(row.id, rel, setup.repo, pr.number, url, c.now),
    );
    if (!known.has(row.id)) {
      statements.push(
        K.eventStatement(c, row.id, null, "github", { action: "linked", kind: "pull", rel, repo: setup.repo, number: pr.number, url }, true),
      );
      K.push(c, "github", row, { url });
    }
    linked.push(K.keyOf(row.kind, row.id));
  }
  if (statements.length > 0) await DB.batch(statements);
  return linked;
}

async function onIssue(c, setup, payload) {
  const issue = payload.issue;
  if (payload.action !== "closed" || !K.isObject(issue) || !Number.isSafeInteger(issue.number)) return quiet();
  if (K.isObject(issue.pull_request) || issue.state_reason === "not_planned") return quiet();
  const ids = (
    await c.env.DB.prepare("SELECT item_id FROM github_links WHERE repo = ?1 AND kind = 'issue' AND number = ?2 AND rel = 'opened'")
      .bind(setup.repo, issue.number)
      .all()
  ).results.map((r) => r.item_id);
  const rows = await itemsIn(c, ids);
  if (rows.length === 0) return quiet();
  return K.json(200, { linked: [], changed: await fixAll(c, rows) });
}

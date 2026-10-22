import { createServer } from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

export const GITHUB_TOKEN = "ghp-test-token";
const REPO = "acme/shop";
const HOOK_SECRET = "github-hook-secret";
const tagOf = (host) => createHash("sha256").update(host).digest("hex").slice(0, 16).toUpperCase();

const gh = { seen: [], answers: new Map(), held: null, arrived: null };

export function githubVars(host, port) {
  return [`GITHUB_API:http://127.0.0.1:${port}`, `GITHUB_TOKEN_${tagOf(host)}:${GITHUB_TOKEN}`];
}

export function githubStub() {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const asked = {
        method: request.method,
        path: request.url,
        auth: request.headers.authorization,
        agent: request.headers["user-agent"],
        version: request.headers["x-github-api-version"],
        body: text ? JSON.parse(text) : null,
      };
      gh.seen.push(asked);
      const answer = gh.answers.get(`${request.method} ${request.url.split("?")[0]}`) ?? defaultAnswer(asked);
      const send = () => {
        const reply = typeof answer === "function" ? answer(asked) : answer;
        if (reply === "drop") return request.socket.destroy();
        response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body === undefined ? "" : JSON.stringify(reply.body));
      };
      if (gh.held) {
        const release = gh.held;
        gh.held = null;
        release(send);
      } else send();
      gh.arrived?.();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function defaultAnswer(asked) {
  if (asked.method === "POST" && asked.path === `/repos/${REPO}/issues`) {
    return { status: 201, body: { number: 7, html_url: `https://github.com/${REPO}/issues/7` } };
  }
  if (asked.method === "DELETE" && asked.path.startsWith(`/repos/${REPO}/hooks/`)) return { status: 204 };
  if (asked.method === "GET" && asked.path.includes("/commits")) return { status: 200, body: [] };
  return { status: 404, body: { message: "Not Found" } };
}

function reset() {
  gh.seen.length = 0;
  gh.answers.clear();
  gh.held = null;
  gh.arrived = null;
}

export async function githubChecks({ base, call, check, issueBody, here, there }) {
  assert.equal(there, "localhost", "the GitHub token and deliver() are set on localhost");
  const port = new URL(base).port;
  const names = (host) => [`GITHUB_TOKEN_${tagOf(host)}`, `GITHUB_HOOK_${tagOf(host)}`];
  const link = (host, body = { repo: REPO }) => call("PUT", `/_p99/v1/github/${host}`, { body });
  const unlink = (host) => call("DELETE", `/_p99/v1/github/${host}`);
  const fileOn = async (host, title = "The total does not update") =>
    (await call("POST", `/_p99/v1/issues?host=${host}`, { body: issueBody({ title }) })).json;
  const open = (key) => call("POST", `/_p99/v1/issues/${key}/github`);
  const threadOf = async (key, host) => (await call("GET", `/_p99/v1/issues/${key}?host=${host}`)).json.issue;
  const deliver = async (payload, event = "pull_request") => {
    const bytes = Buffer.from(JSON.stringify(payload));
    const response = await fetch(`http://localhost:${port}/_p99/v1/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": randomUUID(),
        "x-hub-signature-256": `sha256=${createHmac("sha256", HOOK_SECRET).update(bytes).digest("hex")}`,
      },
      body: bytes,
    });
    return { status: response.status, json: response.status === 204 ? null : await response.json() };
  };
  const merged = (number, body) => ({
    action: "closed",
    repository: { full_name: REPO },
    pull_request: { number, merged: true, title: "Tidy the cart", body, html_url: `https://github.com/${REPO}/pull/${number}` },
  });

  await check("linking a repository answers its webhook and secrets, and the list shows every linked host", async () => {
    reset();
    const linked = await link(there, { repo: REPO, hook_id: 77 });
    assert.equal(linked.status, 200, JSON.stringify(linked.json));
    assert.equal(linked.json.host, there);
    assert.equal(linked.json.repo, REPO);
    assert.equal(linked.json.hook_id, 77);
    assert.equal(linked.json.webhook, `https://${there}/_p99/v1/github`);
    assert.equal(linked.json.token, true);
    assert.equal(linked.json.secret, true);
    assert.equal((await link(here)).status, 200);
    const listed = await call("GET", "/_p99/v1/github");
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const hosts = listed.json.hosts.map((h) => h.host);
    assert.deepEqual(hosts, [...hosts].sort());
    const far = listed.json.hosts.find((h) => h.host === there);
    assert.deepEqual(
      { repo: far.repo, hook_id: far.hook_id, token: far.token, secret: far.secret },
      { repo: REPO, hook_id: 77, token: true, secret: true },
    );
    const near = listed.json.hosts.find((h) => h.host === here);
    assert.deepEqual({ hook_id: near.hook_id, token: near.token, secret: near.secret }, { hook_id: null, token: false, secret: true });
    const moved = await link(there, { repo: "acme/shop-two", hook_id: null });
    assert.equal(moved.json.repo, "acme/shop-two");
    assert.equal(moved.json.hook_id, null);
    assert.equal(moved.json.created_at, linked.json.created_at);
    assert.equal(gh.seen.length, 0, "linking never calls GitHub");
  });

  await check("linking refuses a repository that isn't owner/name, a bad hook id and a host that isn't there", async () => {
    for (const repo of ["acme", "/shop", "acme/", "-acme/shop", "acme/shop/extra", "acme/sh op", 7]) {
      const refused = await link(there, { repo });
      assert.equal(refused.status, 400, String(repo));
      assert.equal(refused.json.message, "repo must be owner/name");
    }
    for (const hook_id of [0, -1, 1.5, "77", true]) {
      const refused = await link(there, { repo: REPO, hook_id });
      assert.equal(refused.status, 400, String(hook_id));
      assert.equal(refused.json.message, "hook_id must be a positive number or null");
    }
    const nowhere = await link("nowhere.example.com");
    assert.equal(nowhere.status, 404);
    assert.equal(nowhere.json.message, "no such host");
    assert.equal((await unlink("nowhere.example.com")).status, 404);
  });

  await check("opening a GitHub issue from an item files it once in the linked repository and links it on the item", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there, "The cart forgets the gift note");
    const opened = await open(item.key);
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    const { at, ...rest } = opened.json;
    assert.deepEqual(rest, { key: item.key, existing: false, kind: "issue", rel: "opened", repo: REPO, number: 7, url: `https://github.com/${REPO}/issues/7` });
    assert.ok(Number.isFinite(Date.parse(at)), String(at));
    assert.equal(gh.seen.length, 1);
    const asked = gh.seen[0];
    assert.equal(asked.method, "POST");
    assert.equal(asked.path, `/repos/${REPO}/issues`);
    assert.equal(asked.auth, `Bearer ${GITHUB_TOKEN}`);
    assert.equal(asked.agent, "p99");
    assert.equal(asked.version, "2022-11-28");
    assert.equal(asked.body.title, "The cart forgets the gift note");
    assert.ok(asked.body.body.startsWith(`P99 item ${item.key}`), asked.body.body);
    assert.ok(asked.body.body.includes(`\`Fixes: ${item.key}\``), asked.body.body);
    const again = await open(item.key);
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.existing, true);
    assert.equal(again.json.number, 7);
    assert.equal(again.json.url, `https://github.com/${REPO}/issues/7`);
    assert.equal(gh.seen.length, 1, "the second open asked GitHub again");
    const thread = await threadOf(item.key, there);
    assert.deepEqual(
      thread.github.map((g) => [g.kind, g.rel, g.repo, g.number, g.url]),
      [["issue", "opened", REPO, 7, `https://github.com/${REPO}/issues/7`]],
    );
  });

  await check("an issue GitHub refuses or answers badly is reported, and the item can be opened again once GitHub answers", async () => {
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there);
    const path = `POST /repos/${REPO}/issues`;
    const cases = [
      [{ status: 422, body: { message: "Validation Failed" } }, "GitHub answered 422: Validation Failed"],
      [{ status: 201, body: { number: 8 } }, "GitHub answered 201"],
      [{ status: 201, body: { number: 8, html_url: "http://github.com/acme/shop/issues/8" } }, "GitHub answered 201"],
      [{ status: 201, body: { number: "8", html_url: "https://github.com/acme/shop/issues/8" } }, "GitHub answered 201"],
      [{ status: 500 }, "GitHub answered 500"],
    ];
    for (const [answer, said] of cases) {
      reset();
      gh.answers.set(path, answer);
      const failed = await open(item.key);
      assert.equal(failed.status, 502, JSON.stringify(answer));
      assert.equal(failed.json.message, said);
    }
    reset();
    gh.answers.set(path, "drop");
    const dropped = await open(item.key);
    assert.equal(dropped.status, 502);
    assert.match(dropped.json.message, /^GitHub answered 502: /);
    assert.deepEqual((await threadOf(item.key, there)).github, []);
    reset();
    const opened = await open(item.key);
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.equal(opened.json.existing, false);
  });

  await check("an issue being opened refuses a second open until GitHub answers the first", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there);
    const parked = new Promise((resolve) => (gh.held = resolve));
    const arrived = new Promise((resolve) => (gh.arrived = resolve));
    const first = open(item.key);
    await arrived;
    const second = await open(item.key);
    assert.equal(second.status, 409, JSON.stringify(second.json));
    assert.equal(second.json.message, "the issue is being opened; try again in a minute");
    const send = await parked;
    send();
    const done = await first;
    assert.equal(done.status, 201, JSON.stringify(done.json));
    assert.equal(gh.seen.length, 1);
  });

  await check("opening an issue needs the host linked and the Worker holding its token", async () => {
    reset();
    assert.equal((await link(here)).status, 200);
    const near = await fileOn(here);
    const tokenless = await open(near.key);
    assert.equal(tokenless.status, 409);
    assert.equal(tokenless.json.message, `the Worker has no GitHub token for ${here}; run p99 github set ${here}`);
    assert.equal((await unlink(here)).status, 200);
    const unlinked = await open(near.key);
    assert.equal(unlinked.status, 409);
    assert.equal(unlinked.json.message, `GitHub is not set for ${here}; run p99 github set ${here}`);
    assert.equal((await open("BUG-999999")).status, 404);
    assert.equal(gh.seen.length, 0);
  });

  await check("a merged pull request reads its commits page by page from GitHub and a Fixes trailer there marks the item", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there);
    const filler = Array.from({ length: 100 }, (_, i) => ({ commit: { message: `Step ${i + 1}` } }));
    gh.answers.set(`GET /repos/${REPO}/pulls/61/commits`, (asked) =>
      asked.path.endsWith("page=1")
        ? { status: 200, body: filler }
        : { status: 200, body: [{ commit: { message: `Keep the note\n\nFixes: ${item.key}` } }, { sha: "no commit" }, { commit: { message: 7 } }] },
    );
    const fixed = await deliver(merged(61, "No trailer here."));
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    assert.deepEqual(fixed.json.changed, [item.key]);
    assert.deepEqual(
      gh.seen.map((s) => s.path),
      [`/repos/${REPO}/pulls/61/commits?per_page=100&page=1`, `/repos/${REPO}/pulls/61/commits?per_page=100&page=2`],
    );
    assert.equal(gh.seen[0].auth, `Bearer ${GITHUB_TOKEN}`);
    assert.ok((await threadOf(item.key, there)).closed_at);
  });

  await check("a merged pull request reads at most three full pages of commits and never asks for a fourth", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there);
    const filler = Array.from({ length: 100 }, (_, i) => ({ commit: { message: `Step ${i + 1}` } }));
    gh.answers.set(`GET /repos/${REPO}/pulls/64/commits`, (asked) =>
      asked.path.endsWith("page=4") ? { status: 200, body: [{ commit: { message: `Fixes: ${item.key}` } }] } : { status: 200, body: filler },
    );
    const capped = await deliver(merged(64, "No trailer here."));
    assert.equal(capped.status, 204, JSON.stringify(capped.json));
    assert.deepEqual(
      gh.seen.map((s) => s.path),
      [1, 2, 3].map((page) => `/repos/${REPO}/pulls/64/commits?per_page=100&page=${page}`),
    );
    assert.equal((await threadOf(item.key, there)).closed_at, null);
  });

  await check("commits GitHub won't give leave the pull request's own words to decide", async () => {
    assert.equal((await link(there)).status, 200);
    for (const answer of [{ status: 500, body: { message: "boom" } }, { status: 200, body: { not: "a list" } }, "drop"]) {
      reset();
      const item = await fileOn(there);
      gh.answers.set(`GET /repos/${REPO}/pulls/62/commits`, answer);
      const quiet = await deliver(merged(62, `Refs: ${item.key}`));
      assert.equal(quiet.status, 200, JSON.stringify(quiet.json));
      assert.deepEqual(quiet.json.changed, []);
      assert.deepEqual(quiet.json.linked, [item.key]);
      assert.equal(gh.seen.length, 1, JSON.stringify(answer));
      assert.equal((await threadOf(item.key, there)).closed_at, null);
    }
  });

  await check("closing the GitHub issue P99 opened marks its item fixed once; any other close or issue leaves it open", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    const item = await fileOn(there, "The receipt shows the old address");
    gh.answers.set(`POST /repos/${REPO}/issues`, { status: 201, body: { number: 91, html_url: `https://github.com/${REPO}/issues/91` } });
    assert.equal((await open(item.key)).status, 201);
    const closed = (number, more = {}) => ({ action: "closed", repository: { full_name: REPO }, issue: { number, state_reason: "completed", ...more } });
    for (const payload of [
      closed(91, { state_reason: "not_planned" }),
      closed(91, { pull_request: { url: "https://example.com/pull/91" } }),
      { ...closed(91), action: "edited" },
      closed(92),
      { ...closed(91), issue: { number: "91" } },
      { ...closed(91), repository: { full_name: "acme/elsewhere" } },
    ]) {
      const quiet = await deliver(payload, "issues");
      assert.equal(quiet.status, 204, JSON.stringify(payload));
      assert.equal((await threadOf(item.key, there)).closed_at, null, JSON.stringify(payload));
    }
    const fixed = await deliver(closed(91, { state_reason: null }), "issues");
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    assert.deepEqual(fixed.json, { linked: [], changed: [item.key] });
    const thread = await threadOf(item.key, there);
    assert.ok(thread.closed_at);
    const again = await deliver(closed(91), "issues");
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual(again.json, { linked: [], changed: [] });
    assert.equal((await threadOf(item.key, there)).closed_at, thread.closed_at);
    assert.equal((await deliver(closed(91), "push")).status, 204);
  });

  await check("unlinking removes the webhook with the host's token when it can and names the secrets to delete", async () => {
    const cases = [
      [{ status: 204 }, true],
      [{ status: 404, body: { message: "Not Found" } }, true],
      [{ status: 500, body: { message: "boom" } }, false],
      ["drop", false],
    ];
    for (const [answer, removed] of cases) {
      reset();
      assert.equal((await link(there, { repo: REPO, hook_id: 78 })).status, 200);
      gh.answers.set(`DELETE /repos/${REPO}/hooks/78`, answer);
      const gone = await unlink(there);
      assert.equal(gone.status, 200, JSON.stringify(gone.json));
      assert.deepEqual(gone.json, { host: there, repo: REPO, hook_id: 78, hook_removed: removed, secrets: names(there) });
      assert.equal(gh.seen.length, 1);
      assert.equal(gh.seen[0].auth, `Bearer ${GITHUB_TOKEN}`);
    }
    reset();
    assert.equal((await link(there)).status, 200);
    const hookless = await unlink(there);
    assert.equal(hookless.json.hook_removed, false);
    assert.equal(hookless.json.hook_id, null);
    assert.equal((await link(here, { repo: REPO, hook_id: 79 })).status, 200);
    const tokenless = await unlink(here);
    assert.equal(tokenless.json.hook_removed, false);
    assert.deepEqual(tokenless.json.secrets, names(here));
    assert.equal(gh.seen.length, 0, "a host without a hook or a token never calls GitHub");
    const twice = await unlink(there);
    assert.equal(twice.status, 404);
    assert.equal(twice.json.message, "GitHub is not set for this host");
    const listed = (await call("GET", "/_p99/v1/github")).json.hosts.map((h) => h.host);
    assert.equal(listed.includes(there), false);
    assert.equal(listed.includes(here), false);
  });

  await check("a call scoped to one host lists, links and unlinks only that host's repository", async () => {
    reset();
    assert.equal((await link(there)).status, 200);
    assert.equal((await link(here)).status, 200);
    const scoped = await call("GET", `/_p99/v1/github?host=${here}`);
    assert.equal(scoped.status, 200, JSON.stringify(scoped.json));
    assert.deepEqual(scoped.json.hosts.map((h) => h.host), [here]);
    const elsewhere = await call("PUT", `/_p99/v1/github/${there}?host=${here}`, { body: { repo: "acme/other" } });
    assert.equal(elsewhere.status, 404);
    assert.equal(elsewhere.json.message, "no such host");
    const kept = await call("DELETE", `/_p99/v1/github/${there}?host=${here}`);
    assert.equal(kept.status, 404);
    assert.equal(kept.json.message, "no such host");
    const all = (await call("GET", "/_p99/v1/github?host=*")).json.hosts;
    assert.equal(all.find((h) => h.host === there).repo, REPO);
    const own = await call("DELETE", `/_p99/v1/github/${here}?host=${here}`);
    assert.equal(own.status, 200, JSON.stringify(own.json));
    assert.equal(own.json.host, here);
    assert.equal((await unlink(there)).status, 200);
    const left = (await call("GET", "/_p99/v1/github")).json.hosts.map((h) => h.host);
    assert.equal(left.includes(here) || left.includes(there), false);
    assert.equal(gh.seen.length, 0);
  });
}

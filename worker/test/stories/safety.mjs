import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { APP_HOST } from "../app.mjs";
import { coverWorker } from "../inspect.mjs";

const GRACE = { email: "grace@example.com", name: "Grace Hopper", agent: true };
const NEAR = "127.0.0.1";
const FAR = "localhost";
const SCHEDULED = "/__scheduled?cron=*%2F15+*+*+*+*";
const LEFT_OUT = ["app_sessions", "app_tries", "backup_runs", "github_deliveries", "usage"];
const OLD_RUNS = ["2025-01-06", "2025-01-13", "2025-01-20", "2025-01-27", "2025-02-03", "2025-02-10", "2025-02-17", "2025-02-24"];
const BACKUP_STEP_PAGES = 6;
const BACKUP_STEP_BYTES = 512 * 1024;
const BIG = "replace(hex(zeroblob(30000)), '0', 'x')";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const harness = (message) => Object.assign(new Error(message), { harness: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function send(port, host, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const sent = { host: `${host}:${port}`, ...headers };
    if (bytes) sent["content-length"] = bytes.length;
    const req = request({ host: "127.0.0.1", port, path, method, headers: sent }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString("utf8");
        let json = null;
        if ((res.headers["content-type"] || "").startsWith("application/json")) {
          try {
            json = JSON.parse(text);
          } catch {}
        }
        resolve({ status: res.statusCode, headers: res.headers, raw, text, json });
      });
    });
    req.on("error", reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}

function signedSender(port, secret) {
  return (method, path, { actor = GRACE, body, raw, type, headers = {} } = {}) => {
    const bytes = raw ?? (body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)));
    const hash = sha256(bytes);
    const actorText = actor ? Buffer.from(JSON.stringify(actor)).toString("base64url") : "";
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`v1\n${ts}\n${method}\n${path}\n${actorText}\n${hash}`).digest("hex");
    const sent = { "x-p99-key-id": "p99", "x-p99-auth": `v1 ts=${ts},sig=${sig}`, "x-content-sha256": hash, ...headers };
    if (actorText) sent["x-p99-actor"] = actorText;
    if (bytes.length > 0) sent["content-type"] = type ?? "application/json";
    return send(port, NEAR, method, path, { headers: sent, body: bytes.length > 0 ? bytes : undefined });
  };
}

function panelSender(port) {
  return (host, method, path, code, body, headers = {}) => {
    const sent = { ...headers };
    if (code !== undefined) sent["x-p99-code"] = code;
    if (body !== undefined) sent["content-type"] = "application/json";
    return send(port, host, method, `/_p99/api${path}`, { headers: sent, body });
  };
}

function fileSender(port) {
  return (host, key, code, name, text, comment) =>
    send(port, host, "PUT", `/_p99/api/issues/${key}/attachments/${randomUUID()}?name=${name}&role=file${comment ? `&comment=${comment}` : ""}`, {
      headers: { "x-p99-code": code, "content-type": "text/plain" },
      body: Buffer.from(text),
    });
}

function totpOf(key, offset = 0) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of key) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function until(what, fn, ms = 10000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
    await pause(50);
  }
}

function socketOf(url, heard, headers) {
  const socket = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
  const state = {
    socket,
    get closed() {
      return socket.readyState >= WebSocket.CLOSING;
    },
  };
  socket.addEventListener("message", (message) => heard.push(JSON.parse(message.data)));
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(state));
    socket.addEventListener("error", () => resolve(null));
  });
}

function signedSocket(port, secret, path, heard) {
  const ts = Math.floor(Date.now() / 1000);
  const actor = Buffer.from(JSON.stringify(GRACE)).toString("base64url");
  const hash = sha256(Buffer.alloc(0));
  const sig = createHmac("sha256", secret).update(`v1\n${ts}\nGET\n${path}\n${actor}\n${hash}`).digest("hex");
  return socketOf(`ws://127.0.0.1:${port}${path}`, heard, {
    "x-p99-key-id": "p99",
    "x-p99-actor": actor,
    "x-content-sha256": hash,
    "x-p99-auth": `v1 ts=${ts},sig=${sig}`,
  });
}

const leaks = (answers, marker) => answers.filter((a) => a.text.includes(marker)).map((a) => a.text);

export async function safetyStories({ base, call, browse, mint, check, red, issueBody, here, there, keys, root, wrangler, work }) {
  const port = Number(new URL(base).port);
  const signed = signedSender(port, keys.p99);
  const panel = panelSender(port);
  const attach = fileSender(port);
  const later = [];
  const person = async (name, email, hosts, owner = false) => {
    const minted = await call("POST", "/_p99/v1/codes", { body: { name, email, hosts, role: owner ? "owner" : "user", totp: true, mail: false } });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    return minted.json;
  };
  const page = (method, path, { token, body } = {}) => {
    const headers = { "x-p99-app": "1", origin: `http://${APP_HOST}:${port}` };
    if (token) headers.cookie = `__Host-p99=${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return send(port, APP_HOST, method, path, { headers, body });
  };
  const signIn = async (email, key) => {
    const answer = await page("POST", "/_p99/app/signin", { body: { email, totp: totpOf(key) } });
    assert.equal(answer.status, 200, answer.text);
    return /__Host-p99=([A-Za-z0-9_-]{43});/.exec(answer.headers["set-cookie"][0])[1];
  };

  const marker = `Zanzibar${randomUUID().slice(0, 8)}`;
  const far = await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title: `${marker} far away`, body: `${marker} body` }) });
  assert.equal(far.status, 201, JSON.stringify(far.json));
  const farKey = far.json.key;
  const farNote = await call("POST", `/_p99/v1/issues/${farKey}/comments?host=${there}`, {
    body: { client_uid: randomUUID(), body: `${marker} internal note`, internal: true },
  });
  assert.equal(farNote.status, 201, JSON.stringify(farNote.json));
  const farFile = await call("PUT", `/_p99/v1/issues/${farKey}/attachments/${randomUUID()}?host=${there}&name=far.txt`, {
    raw: Buffer.from(`${marker} file\n`),
    type: "text/plain",
  });
  assert.equal(farFile.status, 201, JSON.stringify(farFile.json));
  const farSecret = await call(
    "PUT",
    `/_p99/v1/issues/${farKey}/attachments/${randomUUID()}?host=${there}&comment=${farNote.json.id}&name=far-secret.txt`,
    { raw: Buffer.from(`${marker} secret\n`), type: "text/plain" },
  );
  assert.equal(farSecret.status, 201, JSON.stringify(farSecret.json));
  await mint("Hedy Lamarr", "hedy.safety@example.com", [there]);
  const nearBoss = await mint("Barbara Liskov", "barbara.safety@example.com", [here], true);
  const nearKey = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Near and plain" }) })).json.key;

  await check("[safety] a reporter's code for one site reads, finds and touches nothing of another site, not even their own item there", async () => {
    const adaNear = await mint("Ada Lovelace", "ada.safety@example.com", [here]);
    const adaFar = await mint("Ada Lovelace", "ada.safety@example.com", [there]);
    const own = await panel(there, "POST", "/issues", adaFar.secret, issueBody({ title: `${marker} mine, far away` }));
    assert.equal(own.status, 201, own.text);
    const ownKey = own.json.key;
    const answers = [];
    const refused = async (status, answer) => {
      answers.push(answer);
      assert.equal(answer.status, status, answer.text);
    };
    await refused(404, await panel(here, "GET", `/issues/${ownKey}`, adaNear.secret));
    await refused(404, await panel(here, "GET", `/issues/${farKey}`, adaNear.secret));
    await refused(404, await panel(here, "GET", `/files/${farFile.json.id}`, adaNear.secret));
    await refused(404, await panel(here, "POST", `/issues/${ownKey}/comments`, adaNear.secret, { client_uid: randomUUID(), body: "Still broken." }));
    await refused(404, await attach(here, ownKey, adaNear.secret, "steps.txt", "steps\n"));
    await refused(404, await panel(here, "PATCH", `/issues/${ownKey}`, adaNear.secret, { resolution: "abandoned" }));
    for (const path of [`/issues?scope=mine&q=${marker}`, "/issues?scope=mine", "/issues?scope=page&path=%2Forders"]) {
      const listed = await panel(here, "GET", path, adaNear.secret);
      answers.push(listed);
      assert.equal(listed.status, 200, listed.text);
      assert.equal(listed.json.issues.some((i) => [ownKey, farKey].includes(i.key)), false, path);
    }
    for (const path of ["/me", `/issues/${ownKey}`, `/files/${farFile.json.id}`, "/issues?scope=mine"]) {
      await refused(401, await panel(there, "GET", path, adaNear.secret));
    }
    assert.deepEqual(leaks(answers, marker), []);
    const still = (await call("GET", `/_p99/v1/issues/${ownKey}?host=${there}`)).json;
    assert.deepEqual([still.issue.closed_at, still.comments.length, still.attachments.length], [null, 0, 0]);
  });

  await check("[safety] a manager of one site lists, searches, opens, changes, merges, deletes and downloads nothing of another site", async () => {
    const answers = [];
    const as = async (method, path, body) => {
      const answer = await panel(here, method, path, nearBoss.secret, body);
      answers.push(answer);
      return answer;
    };
    for (const path of [`/issues?scope=all&q=${marker}`, `/issues?scope=all&q=${farKey}`, `/issues?scope=all&host=${there}&q=${marker}`, "/issues?scope=all&limit=100"]) {
      const listed = await as("GET", path);
      assert.equal(listed.status, 200, listed.text);
      assert.equal(listed.json.issues.some((i) => i.key === farKey || i.host !== here), false, path);
    }
    for (const [method, path, body] of [
      ["GET", `/issues/${farKey}`],
      ["PATCH", `/issues/${farKey}`, { title: "Taken over" }],
      ["POST", `/issues/${farKey}/comments`, { client_uid: randomUUID(), body: "Seen from afar.", internal: true }],
      ["GET", `/files/${farFile.json.id}`],
      ["GET", `/files/${farSecret.json.id}`],
      ["POST", "/merge", { items: [farKey], into: nearKey }],
      ["POST", "/merge", { items: [nearKey], into: farKey }],
      ["DELETE", `/issues/${farKey}`],
    ]) {
      assert.equal((await as(method, path, body)).status, 404, `${method} ${path}`);
    }
    const put = await attach(here, farKey, nearBoss.secret, "taken.txt", "taken\n");
    answers.push(put);
    assert.equal(put.status, 404, put.text);
    const people = await as("GET", "/people");
    assert.equal(people.status, 200, people.text);
    const nearPeople = (await call("GET", `/_p99/v1/people?host=${here}`)).json.people.map((p) => p.username);
    const farOnly = (await call("GET", `/_p99/v1/people?host=${there}`)).json.people.map((p) => p.username).filter((u) => !nearPeople.includes(u));
    assert.ok(farOnly.length > 0, "someone holds a code only for the far site");
    assert.equal(people.json.people.some((p) => farOnly.includes(p.username)), false, JSON.stringify(people.json));
    assert.deepEqual(leaks(answers, marker), []);
    const kept = (await call("GET", `/_p99/v1/issues/${farKey}?host=${there}`)).json;
    assert.equal(kept.issue.title, `${marker} far away`);
    assert.deepEqual([kept.issue.duplicate_of, kept.issue.closed_at, kept.comments.length, kept.attachments.length], [null, null, 1, 2]);
    assert.equal((await call("GET", `/_p99/v1/issues/${nearKey}?host=${here}`)).json.issue.duplicate_of, null);
  });

  await check("[safety] a one-site manager's live board and a host-scoped signed stream hear nothing of another site", async () => {
    const heard = [];
    const heardSigned = [];
    const ticket = await panel(here, "POST", "/stream-ticket", nearBoss.secret);
    assert.equal(ticket.status, 201, ticket.text);
    const board = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${ticket.json.ticket}`, heard);
    const watch = await signedSocket(port, keys.p99, `/_p99/v1/stream?host=${here}`, heardSigned);
    assert.ok(board && watch, "both streams open");
    const farTitle = `${marker} heard far away`;
    const loud = (await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title: farTitle }) })).json.key;
    assert.equal((await call("POST", `/_p99/v1/issues/${loud}/comments?host=${there}`, { body: { client_uid: randomUUID(), body: "Far reply." } })).status, 201);
    assert.equal((await call("POST", `/_p99/v1/move?host=${there}`, { body: { key: loud, from: "New", to: "in-progress" } })).status, 200);
    for (const title of ["Beacon one", "Beacon two"]) {
      const beacon = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title }) })).json.key;
      await until(`${title} on both streams`, () => [heard, heardSigned].every((list) => list.some((e) => e.key === beacon)));
    }
    board.socket.close();
    watch.socket.close();
    for (const list of [heard, heardSigned]) {
      assert.equal(list.some((e) => e.host === there || e.key === loud || JSON.stringify(e).includes(marker)), false, JSON.stringify(list));
    }
  });

  await check("[safety] Access's headers and identity never stand in for P99's signature or a code, and the browser needs no service token", async () => {
    const access = {
      "cf-access-client-id": "0123456789abcdef.access",
      "cf-access-client-secret": "not-a-p99-secret",
      "cf-access-jwt-assertion": "header.payload.signature",
      "cf-access-authenticated-user-email": "grace@example.com",
    };
    const actor = Buffer.from(JSON.stringify(GRACE)).toString("base64url");
    for (const path of ["/_p99/v1/hosts", "/_p99/v1/codes", "/_p99/v1/admin/backup-status", `/_p99/v1/issues?scope=all&host=${here}`]) {
      const bare = await send(port, here, "GET", path, { headers: access });
      assert.equal(bare.status, 401, `${path}: ${bare.text}`);
      const posing = await send(port, here, "GET", path, { headers: { ...access, "x-p99-key-id": "p99", "x-p99-actor": actor } });
      assert.equal(posing.status, 401, `${path}: ${posing.text}`);
    }
    assert.equal((await panel(here, "GET", "/me?path=%2F", undefined, undefined, access)).status, 401);
    const reporter = await mint("Grace Hopper", "grace.reporter@example.com", [here]);
    assert.equal((await panel(here, "GET", "/issues?scope=all", reporter.secret, undefined, access)).status, 403);
    assert.equal((await panel(here, "GET", "/me?path=%2F", reporter.secret)).status, 200);
    const through = await signed("GET", `/_p99/v1/issues?scope=all&host=${here}&limit=1`, { headers: access });
    assert.equal(through.status, 200, through.text);
    assert.equal((await page("GET", "/_p99/app/spaces")).status, 401);
    assert.equal((await send(port, APP_HOST, "GET", "/_p99/app/spaces", { headers: { ...access, "x-p99-app": "1" } })).status, 401);
  });

  await check("[safety] a relinked code stops at once on every route while the new one opens the same items, and a revoked code can't come back", async () => {
    const joan = await mint("Joan Clarke", "joan.safety@example.com", [here]);
    const filed = await panel(here, "POST", "/issues", joan.secret, issueBody({ title: "Before the relink" }));
    assert.equal(filed.status, 201, filed.text);
    const relinked = await call("POST", `/_p99/v1/codes/${joan.code.id}/relink`, { body: {} });
    assert.equal(relinked.status, 201, JSON.stringify(relinked.json));
    assert.ok(relinked.json.revoked.revoked_at);
    const fresh = relinked.json.secret;
    assert.notEqual(fresh, joan.secret);
    for (const [method, path, body] of [
      ["GET", "/me"],
      ["GET", "/issues?scope=mine"],
      ["GET", `/issues/${filed.json.key}`],
      ["POST", "/issues", issueBody({ title: "After the relink" })],
      ["POST", `/issues/${filed.json.key}/comments`, { client_uid: randomUUID(), body: "Old link." }],
    ]) {
      assert.equal((await panel(here, method, path, joan.secret, body)).status, 401, `${method} ${path}`);
    }
    assert.equal((await attach(here, filed.json.key, joan.secret, "late.txt", "late\n")).status, 401);
    const me = await panel(here, "GET", "/me", fresh);
    assert.equal(me.status, 200, me.text);
    assert.equal((await panel(here, "GET", `/issues/${filed.json.key}`, fresh)).status, 200);
    assert.ok((await panel(here, "GET", "/issues?scope=mine", fresh)).json.issues.some((i) => i.key === filed.json.key));
    assert.equal((await call("POST", `/_p99/v1/codes/${joan.code.id}/relink`, { body: {} })).status, 404);
    const again = await call("POST", `/_p99/v1/codes/${joan.code.id}/revoke`);
    assert.equal(again.status, 200);
    assert.equal(again.json.revoked_at, relinked.json.revoked.revoked_at);
    assert.equal((await call("POST", `/_p99/v1/codes/${relinked.json.code.id}/revoke`)).status, 200);
    assert.equal((await panel(here, "GET", "/me", fresh)).status, 401);
    assert.equal((await call("POST", `/_p99/v1/codes/${relinked.json.code.id}/relink`, { body: {} })).status, 404);
  });

  await check("[safety] a relinked code with an authenticator asks every browser for a fresh 6-digit code; the old browser's trust is gone", async () => {
    const radia = await person("Radia Perlman", "radia.safety@example.com", [here]);
    const verified = await panel(here, "POST", "/verify", radia.secret, { totp: totpOf(radia.totp_key) });
    assert.equal(verified.status, 201, verified.text);
    const device = verified.json.device;
    assert.equal((await panel(here, "GET", "/me", `${radia.secret}.${device}`)).status, 200);
    const relinked = await call("POST", `/_p99/v1/codes/${radia.code.id}/relink`, { body: {} });
    assert.equal(relinked.status, 201, JSON.stringify(relinked.json));
    assert.equal(relinked.json.totp, "carried");
    const fresh = relinked.json.secret;
    assert.equal((await panel(here, "GET", "/me", `${radia.secret}.${device}`)).status, 401);
    assert.equal((await panel(here, "GET", "/me", `${fresh}.${device}`)).status, 428);
    assert.equal((await panel(here, "GET", "/me", fresh)).status, 428);
    const again = await panel(here, "POST", "/verify", fresh, { totp: totpOf(radia.totp_key, 1) });
    assert.equal(again.status, 201, again.text);
    assert.equal((await panel(here, "GET", "/me", `${fresh}.${again.json.device}`)).status, 200);
  });

  await check("[safety] a session on the P99 page loses a site the moment that site's code is revoked, and keeps the rest", async () => {
    const near = await person("Frances Allen", "frances.safety@example.com", [here]);
    const farCode = await mint("Frances Allen", "frances.safety@example.com", [there]);
    const token = await signIn("frances.safety@example.com", near.totp_key);
    const spaces = async () => (await page("GET", "/_p99/app/spaces", { token })).json.spaces.map((s) => s.host);
    assert.deepEqual(await spaces(), [here, there].sort());
    assert.equal((await page("GET", `/_p99/api/me?host=${there}&path=%2F`, { token })).status, 200);
    assert.equal((await call("POST", `/_p99/v1/codes/${farCode.code.id}/revoke`)).status, 200);
    assert.deepEqual(await spaces(), [here]);
    assert.equal((await page("GET", `/_p99/api/me?host=${there}&path=%2F`, { token })).status, 404);
    assert.equal((await page("GET", `/_p99/api/issues?scope=mine&host=${there}`, { token })).status, 404);
    assert.equal((await page("GET", `/_p99/api/me?host=${here}&path=%2F`, { token })).status, 200);
  });

  await check("[safety] a one-site manager's session on the P99 page opens nothing of another site, even through its own site", async () => {
    const edith = await person("Edith Clarke", "edith.safety@example.com", [here], true);
    const token = await signIn("edith.safety@example.com", edith.totp_key);
    const answers = [];
    const as = async (method, path) => {
      const answer = await page(method, path, { token });
      answers.push(answer);
      return answer;
    };
    assert.equal((await as("GET", `/_p99/api/issues/${farKey}?host=${here}`)).status, 404);
    assert.equal((await as("GET", `/_p99/api/issues/${farKey}?host=${there}`)).status, 404);
    assert.equal((await as("GET", `/_p99/api/files/${farFile.json.id}?host=${here}`)).status, 404);
    assert.equal((await as("GET", `/_p99/api/files/${farSecret.json.id}?host=${here}`)).status, 404);
    assert.equal((await as("GET", `/_p99/api/issues?scope=all&host=${there}`)).status, 404);
    assert.equal((await as("POST", `/_p99/api/stream-ticket?host=${there}`)).status, 404);
    const listed = await as("GET", `/_p99/api/issues?scope=all&host=${here}&q=${marker}`);
    assert.equal(listed.status, 200, listed.text);
    assert.deepEqual(listed.json.issues, []);
    assert.deepEqual(leaks(answers, marker), []);
  });

  await backupStories({ check, issueBody, keys, root, wrangler, work, later });

  await check("[safety] a stream ticket handed out before its code was revoked opens nothing", async () => {
    const boss = await mint("Karen Spärck Jones", "karen.safety@example.com", [here], true);
    const kept = await mint("Mary Jackson", "mary.ticket.safety@example.com", [here], true);
    const [ticket, control] = await Promise.all([panel(here, "POST", "/stream-ticket", boss.secret), panel(here, "POST", "/stream-ticket", kept.secret)]);
    assert.equal(ticket.status, 201, ticket.text);
    assert.equal(control.status, 201, control.text);
    assert.equal((await call("POST", `/_p99/v1/codes/${boss.code.id}/revoke`)).status, 200);
    const opened = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${ticket.json.ticket}`, []);
    const reference = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${control.json.ticket}`, []);
    if (opened) opened.socket.close();
    if (reference) reference.socket.close();
    if (!reference) throw harness("the run outlived the ticket's TTL: an unrevoked manager's ticket fetched at the same moment no longer opens");
    assert.equal(opened, null, "a revoked manager's ticket still opened the live board");
    const again = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${ticket.json.ticket}`, []);
    if (again) again.socket.close();
    assert.equal(again, null, "a refused ticket opened on a second try");
    const fresh = await panel(here, "POST", "/stream-ticket", boss.secret);
    assert.equal(fresh.status, 401, "a revoked manager was handed a new stream ticket");
  });

  await check("[safety] an open live board stops hearing the moment its code is revoked, and only that board", async () => {
    const boss = await mint("Annie Easley", "annie.safety@example.com", [here], true);
    const peer = await mint("Dorothy Vaughan", "dorothy.safety@example.com", [here], true);
    const heard = [];
    const kept = [];
    const control = [];
    const board = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${(await panel(here, "POST", "/stream-ticket", boss.secret)).json.ticket}`, heard);
    const other = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${(await panel(here, "POST", "/stream-ticket", peer.secret)).json.ticket}`, kept);
    const watch = await signedSocket(port, keys.p99, `/_p99/v1/stream?host=${here}`, control);
    assert.ok(board && other && watch, "the three streams open");
    const before = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Filed before the revoke" }) })).json.key;
    await until("the board hears the item filed before the revoke", () => heard.some((e) => e.key === before));
    assert.equal((await call("POST", `/_p99/v1/codes/${boss.code.id}/revoke`)).status, 200);
    await until("the revoked board closes", () => board.closed, 10000);
    const after = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Filed after the revoke" }) })).json.key;
    await until("the control stream hears the item", () => control.some((e) => e.key === after));
    await until("the other manager's board hears the item", () => kept.some((e) => e.key === after));
    assert.equal(other.closed, false, "a revoke closed another manager's board");
    board.socket.close();
    other.socket.close();
    watch.socket.close();
    assert.equal(heard.some((e) => e.key === after), false, "a revoked manager's open board heard an item filed after the revoke");
  });

  await check("[safety] a relink closes the old code's open board and its unused ticket, and the new code's board hears", async () => {
    const boss = await mint("Katherine Johnson", "katherine.safety@example.com", [here], true);
    const heard = [];
    const board = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${(await panel(here, "POST", "/stream-ticket", boss.secret)).json.ticket}`, heard);
    const spare = await panel(here, "POST", "/stream-ticket", boss.secret);
    assert.ok(board, "the board opens");
    assert.equal(spare.status, 201, spare.text);
    const relinked = await call("POST", `/_p99/v1/codes/${boss.code.id}/relink`, { body: {} });
    assert.equal(relinked.status, 201, relinked.text);
    await until("the old code's board closes", () => board.closed, 10000);
    const stale = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${spare.json.ticket}`, []);
    if (stale) stale.socket.close();
    assert.equal(stale, null, "the old code's unused ticket opened after the relink");
    const now = [];
    const fresh = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${(await panel(here, "POST", "/stream-ticket", relinked.json.secret)).json.ticket}`, now);
    assert.ok(fresh, "the new code's board opens");
    const after = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Filed after the relink" }) })).json.key;
    await until("the new code's board hears the item", () => now.some((e) => e.key === after));
    fresh.socket.close();
    assert.equal(heard.some((e) => e.key === after), false, "the old code's board heard an item filed after the relink");
  });

  for (const [name, bug, fn] of later) await (bug ? red(name, bug, fn) : check(name, fn));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function wranglerRun(wrangler, root, args) {
  const result = spawnSync(wrangler, args, { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

let covers = 0;

async function startWorker({ wrangler, root, persist, port, inspector, vars, log }) {
  const out = openSync(log, "w");
  const child = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      String(inspector),
      "--persist-to",
      persist,
      "--test-scheduled",
      "--show-interactive-dev-session=false",
      "--var",
      ...vars,
    ],
    { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", out, out], detached: true },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {}
  };
  let cover = null;
  const stop = async () => {
    if (cover) {
      const taking = cover;
      cover = null;
      await taking.save(join(process.env.P99_COVERAGE, `worker-backup-${port}-${++covers}.json`)).catch((error) => {
        console.error(`coverage: ${error.message}`);
        process.exitCode = 1;
      });
    }
    signal("SIGTERM");
    const late = setTimeout(() => signal("SIGKILL"), 10000);
    await exited;
    clearTimeout(late);
  };
  try {
    if (process.env.P99_COVERAGE) cover = await coverWorker(inspector, join(root, ".wrangler", "tmp"));
    await until(
      "the backup Worker's health",
      async () => {
        if (child.exitCode !== null) throw new Error(`wrangler dev exited; see ${log}`);
        try {
          return (await send(port, NEAR, "GET", "/_p99/health")).status === 200;
        } catch {
          return false;
        }
      },
      60000,
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

function d1File(persist) {
  const dir = join(persist, "v3", "d1", "miniflare-D1DatabaseObject");
  const name = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  assert.ok(name, `no D1 database under ${dir}`);
  return join(dir, name);
}

function readDb(persist, fn) {
  const db = new DatabaseSync(d1File(persist), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function schemaTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function dump(db, tables) {
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
}

function bucket(persist, prefix) {
  const dir = join(persist, "v3", "r2", "miniflare-R2BucketObject");
  const found = new Map();
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")) {
    const db = new DatabaseSync(join(dir, name), { readOnly: true });
    try {
      for (const r of db.prepare("SELECT key, blob_id FROM _mf_objects WHERE substr(key, 1, ?1) = ?2").all(prefix.length, prefix)) {
        found.set(r.key, r.blob_id);
      }
    } finally {
      db.close();
    }
  }
  return found;
}

async function unlessBusy(fn) {
  try {
    return await fn();
  } catch (error) {
    if (/database is locked|SQLITE_BUSY/.test(String(error?.message)) || error?.code === "ENOENT") return null;
    throw error;
  }
}

function pageTexts(persist, date) {
  return [...bucket(persist, `backups/${date}/`).values()].map((blob) => {
    const text = readFileSync(join(persist, "v3", "r2", "p99", "blobs", blob), "utf8");
    return { exported_at: JSON.parse(text).exported_at, length: text.length };
  });
}

function stepEnded(from, row, written) {
  const rows = JSON.parse(row.rows_json || "{}");
  const empty = (counts) => Object.values(counts).filter((n) => n === 0).length;
  const pages = row.pages - from.pages;
  if (pages + (row.table_index - from.table_index) - (empty(rows) - empty(from.rows)) >= BACKUP_STEP_PAGES) return true;
  return written.length === pages && written.reduce((n, p) => n + p.length, 0) >= BACKUP_STEP_BYTES;
}

function backupPages(persist, date) {
  const prefix = `backups/${date}/`;
  return [...bucket(persist, prefix)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, blob]) => ({ key, ...JSON.parse(readFileSync(join(persist, "v3", "r2", "p99", "blobs", blob), "utf8")) }));
}

function restore(persist, pages) {
  const db = new DatabaseSync(d1File(persist));
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    for (const table of new Set(pages.map((p) => p.table))) db.exec(`DELETE FROM "${table}"`);
    for (const p of pages) {
      for (const { _rowid, ...row } of p.rows) {
        if (p.table === "sqlite_sequence") db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(row.name);
        const names = Object.keys(row);
        db.prepare(`INSERT INTO "${p.table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
          ...names.map((n) => row[n]),
        );
      }
    }
    const dangling = db.prepare("PRAGMA foreign_key_check").all().map((r) => ({ ...r }));
    db.exec("COMMIT");
    return dangling;
  } finally {
    db.close();
  }
}

async function backupStories({ check, issueBody, keys, root, wrangler, work, later }) {
  const own = join(work, "stories-safety");
  rmSync(own, { recursive: true, force: true });
  mkdirSync(own, { recursive: true });
  const persist = join(own, "state");
  const port = await freePort();
  const inspector = await freePort();
  const vars = [`KEY_P99:${keys.p99}`, "CODE_PEPPER:test-pepper", "LICENSE_STATE:owner"];
  const signed = signedSender(port, keys.p99);
  const panel = panelSender(port);
  const attach = fileSender(port);
  const start = (log) => startWorker({ wrangler, root, persist, port, inspector, vars, log: join(own, log) });
  const status = async () => {
    const answer = await signed("GET", "/_p99/v1/admin/backup-status");
    assert.equal(answer.status, 200, answer.text);
    return answer.json;
  };
  const runRow = (where, ...args) =>
    readDb(persist, (db) =>
      db.prepare(`SELECT date, started_at, finished_at, table_index, pages, rows_json FROM backup_runs WHERE ${where} ORDER BY date DESC LIMIT 1`).get(...args),
    );
  const tick = async () => {
    const open = runRow("finished_at IS NULL");
    const newest = readDb(persist, (db) => db.prepare("SELECT max(started_at) AS s FROM backup_runs").get().s) || "";
    const from = open ? { table_index: open.table_index, pages: open.pages, rows: JSON.parse(open.rows_json || "{}") } : { table_index: 0, pages: 0, rows: {} };
    const since = open ? pageTexts(persist, open.date).reduce((m, p) => (p.exported_at > m ? p.exported_at : m), "") : "";
    const ran = await send(port, NEAR, "GET", SCHEDULED);
    assert.equal(ran.status, 200, ran.text);
    let seen = null;
    let same = 0;
    return until(
      "the backup step to end",
      () => unlessBusy(async () => {
        const row = open ? runRow("date = ?1 AND started_at = ?2", open.date, open.started_at) : runRow("started_at > ?1", newest);
        if (!row || !(row.finished_at !== null || stepEnded(from, row, pageTexts(persist, row.date).filter((p) => p.exported_at >= row.started_at && p.exported_at > since)))) {
          seen = null;
          same = 0;
          return null;
        }
        const now = JSON.stringify(await status());
        same = now === seen ? same + 1 : 0;
        seen = now;
        return same >= 2 ? JSON.parse(now) : null;
      }),
      30000,
    );
  };
  const runBackup = async (during) => {
    const ticks = [];
    let now = await tick();
    ticks.push(now);
    const date = now.running ? now.running.date : now.last.date;
    while (now.running) {
      if (during) await during(now);
      assert.ok(ticks.length < 80, "the backup never finished");
      now = await tick();
      ticks.push(now);
    }
    assert.equal(now.last.date, date);
    return { date, ticks, last: now.last };
  };

  wranglerRun(wrangler, root, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persist]);
  const seed = join(own, "seed.sql");
  writeFileSync(
    seed,
    [
      `INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title, reporter_email,
        reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at, created_at, updated_at)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40)
        SELECT 'bulk-' || i, 'bug', (SELECT id FROM labels WHERE role = 'inbox'), 1, 'Bulk ' || i, ${BIG}, 'production', '${NEAR}',
        'https://${NEAR}/bulk', '/bulk', 'Bulk', 'bulk@example.com', 'Bulk Reporter',
        '{"email":"bulk@example.com","name":"Bulk Reporter","agent":false}', '{}', '[]', 'bulk ' || i,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM n;`,
      `INSERT INTO comments (item_id, client_uid, author_email, author_name, author_manager, body, internal, origin_env, created_at)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
        SELECT (SELECT id FROM items WHERE client_uid = 'bulk-1'), 'bulk-comment-' || i, 'bulk@example.com', 'Bulk Reporter', 0, ${BIG}, 0,
        'production', '2026-01-02T00:00:00.000Z' FROM n;`,
      "UPDATE items SET comment_count = 30, public_comment_count = 30 WHERE client_uid = 'bulk-1';",
      ...OLD_RUNS.map((d) => `INSERT INTO backup_runs (date, started_at, finished_at, table_index, pages) VALUES ('${d}', '${d}T03:00:00.000Z', '${d}T03:30:00.000Z', 25, 25);`),
    ].join("\n"),
  );
  wranglerRun(wrangler, root, ["d1", "execute", "DB", "--local", "--persist-to", persist, "--file", seed]);
  for (const date of OLD_RUNS.slice(0, 2)) {
    const file = join(own, `old-${date}.json`);
    writeFileSync(file, JSON.stringify({ exported_at: `${date}T03:00:00.000Z`, table: "items", page: 1, rows: [] }));
    wranglerRun(wrangler, root, ["r2", "object", "put", `p99/backups/${date}/items-0001.json`, "--file", file, "--local", "--persist-to", persist]);
  }

  let worker = await start("worker-a.log");
  try {
    assert.equal((await signed("PUT", "/_p99/v1/envs/production", { body: { kind: "release", position: 0 } })).status, 200);
    for (const host of [NEAR, FAR]) {
      assert.equal((await signed("POST", "/_p99/v1/projects", { body: { name: host } })).status, 201);
      const put = await signed("PUT", `/_p99/v1/hosts/${host}`, { body: { env: "production", config: {}, project: host } });
      assert.equal(put.status, 200, put.text);
    }
    const code = async (name, email, hosts, extra = {}) => {
      const minted = await signed("POST", "/_p99/v1/codes", { body: { name, email, hosts, role: "user", mail: false, ...extra } });
      assert.equal(minted.status, 201, minted.text);
      return minted.json;
    };
    const ada = await code("Ada Lovelace", "ada@example.com", [NEAR]);
    const radia = await code("Radia Perlman", "radia@example.com", [NEAR, FAR], { totp: true });
    const filed = await panel(NEAR, "POST", "/issues", ada.secret, issueBody({ title: "The café total is wrong", body: "Crème brûlée costs 12,50 € on the menu." }));
    assert.equal(filed.status, 201, filed.text);
    const key = filed.json.key;
    assert.equal((await attach(NEAR, key, ada.secret, "steps.txt", "1. open the menu\n")).status, 201);
    const reply = await panel(NEAR, "POST", `/issues/${key}/comments`, ada.secret, { client_uid: randomUUID(), body: "Still wrong today." });
    assert.equal(reply.status, 201, reply.text);
    const note = await signed("POST", `/_p99/v1/issues/${key}/comments?host=${NEAR}`, {
      body: { client_uid: randomUUID(), body: "Internal: the price table is stale.", internal: true },
    });
    assert.equal(note.status, 201, note.text);
    const trace = await signed("PUT", `/_p99/v1/issues/${key}/attachments/${randomUUID()}?host=${NEAR}&comment=${note.json.id}&name=trace.txt`, {
      raw: Buffer.from("price: 13.00\n"),
      type: "text/plain",
    });
    assert.equal(trace.status, 201, trace.text);
    assert.equal((await signed("GET", `/_p99/v1/board?host=${NEAR}`)).status, 200);
    const moved = await signed("POST", `/_p99/v1/move?host=${NEAR}`, { body: { key, from: "New", to: "landed" } });
    assert.equal(moved.status, 200, moved.text);
    assert.equal((await signed("POST", `/_p99/v1/issues?host=${FAR}`, { body: issueBody({ title: "Far side" }) })).status, 201);
    const doomed = await signed("POST", `/_p99/v1/issues?host=${NEAR}`, { body: issueBody({ title: "The newest, deleted before the backup" }) });
    assert.equal(doomed.status, 201, doomed.text);
    assert.equal((await signed("DELETE", `/_p99/v1/issues/${doomed.json.key}?host=${NEAR}`)).status, 200);
    const view = async () => {
      const thread = (await signed("GET", `/_p99/v1/issues/${key}?host=${NEAR}`)).json;
      const files = [];
      for (const a of thread.attachments) files.push((await signed("GET", `/_p99/v1/files/${a.id}?host=${NEAR}`)).raw.toString("utf8"));
      const one = (await signed("GET", `/_p99/v1/board?host=${NEAR}`)).json;
      const boards = [one.board.lanes, one.cards.filter((cd) => cd.key === key).map((cd) => [cd.status, cd.label, cd.order])];
      const codes = (await signed("GET", "/_p99/v1/codes")).json;
      return {
        issue: [thread.issue.key, thread.issue.title, thread.issue.body, thread.issue.label, thread.issue.stage, thread.issue.host],
        comments: thread.comments.map((cm) => [cm.id, cm.body, cm.internal]),
        attachments: thread.attachments.map((a) => [a.id, a.name, a.sha256]),
        events: thread.events.map((e) => e.kind),
        files,
        boards,
        codes,
      };
    };
    const before = await view();
    assert.equal(before.files.length, 2);

    const first = await runBackup();
    const pages = backupPages(persist, first.date);
    await until("the ninth run's prune", () => readDb(persist, (db) => db.prepare("SELECT count(*) AS n FROM backup_runs").get().n === OLD_RUNS.length));
    await worker.stop();
    worker = null;
    const { tables, snapshot, runs, hashes } = readDb(persist, (db) => {
      const tables = schemaTables(db);
      return {
        tables,
        snapshot: dump(db, [...tables, "sqlite_sequence"]),
        runs: db.prepare("SELECT date FROM backup_runs ORDER BY date").all().map((r) => r.date),
        hashes: db.prepare("SELECT hash FROM codes").all().map((r) => r.hash),
      };
    });
    const backedUp = [...new Set(pages.map((p) => p.table))].sort();

    await check("[safety] the weekly backup runs in steps, each picking up where the last stopped, and its pages hold every row once", async () => {
      assert.ok(first.ticks.length >= 3, `${first.ticks.length} ticks`);
      for (const t of first.ticks.slice(0, -1)) {
        assert.equal(t.running.date, first.date);
        assert.equal(t.last.date, OLD_RUNS[OLD_RUNS.length - 1]);
      }
      const counts = first.ticks.slice(0, -1).map((t) => t.running.pages);
      assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
      assert.equal(new Set(counts).size, counts.length, "every step writes");
      assert.ok(first.last.finished_at >= first.last.started_at);
      assert.equal(pages.length, first.last.pages);
      for (const table of backedUp) {
        const mine = pages.filter((p) => p.table === table);
        assert.deepEqual(mine.map((p) => p.page), mine.map((_, i) => i + 1), table);
        assert.deepEqual(mine.map((p) => p.key), mine.map((p) => `backups/${first.date}/${table}-${String(p.page).padStart(4, "0")}.json`));
        const rows = mine.flatMap((p) => p.rows);
        assert.equal(rows.length, snapshot[table].length, table);
        assert.equal(first.last.rows[table], rows.length, table);
        assert.equal(new Set(rows.map((r) => r._rowid)).size, rows.length, `${table} holds a row twice`);
      }
      assert.ok(pages.filter((p) => p.table === "items").length > 6, "the items span several steps");
    });

    await check("[safety] every table that holds customer data is in the backup; only sign-in tries, sessions, usage and bookkeeping stay out", async () => {
      assert.deepEqual(tables.filter((t) => !backedUp.includes(t)), [...LEFT_OUT].sort());
      for (const table of ["items", "comments", "attachments", "events", "codes", "hosts", "boards", "labels", "people", "hooks"]) {
        assert.ok(backedUp.includes(table), table);
      }
    });

    await check("[safety] the backups keep eight weeks: the ninth run removes the oldest run and its files, and keeps the rest", async () => {
      assert.deepEqual(runs, [...OLD_RUNS.slice(1), first.date]);
      assert.equal(bucket(persist, `backups/${OLD_RUNS[0]}/`).size, 0);
      assert.equal(bucket(persist, `backups/${OLD_RUNS[1]}/`).size, 1);
    });

    rmSync(join(persist, "v3", "d1"), { recursive: true, force: true });
    wranglerRun(wrangler, root, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persist]);
    const dangling = restore(persist, pages);

    await check("[safety] a backup restores into a wiped D1 row for row, with no row pointing at one it lacks", async () => {
      assert.deepEqual(dangling, []);
      const restored = readDb(persist, (db) => dump(db, backedUp));
      for (const table of backedUp) assert.deepEqual(restored[table], snapshot[table], table);
      readDb(persist, (db) => assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r })), [{ integrity_check: "ok" }]));
    });

    worker = await start("worker-b.log");

    await check("[safety] the restored Worker serves the same items, files, boards and codes, and a code with an authenticator still verifies", async () => {
      assert.deepEqual(await view(), before);
      const me = await panel(NEAR, "GET", "/me?path=%2F", ada.secret);
      assert.equal(me.status, 200, me.text);
      const mine = await panel(NEAR, "GET", `/issues/${key}`, ada.secret);
      assert.equal(mine.status, 200, mine.text);
      assert.equal(mine.json.issue.title, "The café total is wrong");
      assert.equal(mine.json.comments.some((cm) => cm.internal), false);
      assert.equal(mine.json.attachments.length, 1);
      assert.equal((await panel(NEAR, "GET", "/me", radia.secret)).status, 428);
      const verified = await panel(NEAR, "POST", "/verify", radia.secret, { totp: totpOf(radia.totp_key) });
      assert.equal(verified.status, 201, verified.text);
      assert.equal((await panel(FAR, "GET", "/me", `${radia.secret}.${verified.json.device}`)).status, 200);
      assert.deepEqual(await status(), { last: null, running: null });
    });

    await check("[safety] a backup in the bucket is never reachable from the web, and its status is for the account's managers only", async () => {
      const answers = [];
      for (const path of [
        `/_p99/backups/${first.date}/codes-0001.json`,
        `/backups/${first.date}/codes-0001.json`,
        `/_p99/api/files/..%2F..%2Fbackups%2F${first.date}%2Fcodes-0001.json`,
        "/_p99/api/admin/backup-status",
        "/_p99/v1/admin/backup-status",
      ]) {
        const answer = await send(port, NEAR, "GET", path, { headers: { "x-p99-code": ada.secret } });
        answers.push(answer);
        assert.ok([401, 404].includes(answer.status), `${path}: ${answer.status}`);
      }
      const agentless = await signed("GET", "/_p99/v1/admin/backup-status", { actor: null });
      answers.push(agentless);
      assert.equal(agentless.status, 401, agentless.text);
      for (const answer of answers) for (const hash of hashes) assert.equal(answer.text.includes(hash), false);
    });

    const after = await signed("POST", `/_p99/v1/issues?host=${NEAR}`, { body: issueBody({ title: "The first item after the restore" }) });
    assert.equal(after.status, 201, after.text);
    const bulk = snapshot.items.filter((r) => r.client_uid.startsWith("bulk-")).map((r) => r.id).slice(-4);
    for (const id of bulk) assert.equal((await signed("DELETE", `/_p99/v1/issues/BUG-${id}?host=${NEAR}`)).status, 200);
    let busy = null;
    const second = await runBackup(async (now) => {
      if (busy || now.running.rows.comments === undefined || now.running.rows.events !== undefined) return;
      const late = await signed("POST", `/_p99/v1/issues?host=${NEAR}`, { body: issueBody({ title: "Filed while the backup runs" }) });
      assert.equal(late.status, 201, late.text);
      busy = late.json;
    });
    const folder = backupPages(persist, second.date);
    await worker.stop();
    worker = null;
    const stale = folder.filter((p) => p.exported_at < second.last.started_at).map((p) => p.key);
    const fresh = folder.filter((p) => p.exported_at >= second.last.started_at);
    const torn = restore(persist, fresh);

    later.push([
      "[safety] after a restore, a deleted item's key is never handed out again",
      null,
      async () => {
        assert.ok(after.json.id > doomed.json.id, `${after.json.key} reuses the deleted ${doomed.json.key}`);
        const kept = pages.filter((p) => p.table === "sqlite_sequence").flatMap((p) => p.rows);
        assert.equal(kept.find((r) => r.name === "items")?.seq, doomed.json.id);
      },
    ]);
    later.push([
      "[safety] a second run on the same date leaves no page of the first behind for a restore to mix in",
      null,
      async () => {
        if (second.date !== first.date) throw harness(`the two runs fell on ${first.date} and ${second.date}: the story crossed 00:00 UTC and proves nothing`);
        assert.deepEqual(stale, []);
        assert.equal(folder.length, second.last.pages);
      },
    ]);
    later.push([
      "[safety] a backup taken while reporters keep filing restores with no row pointing at one it lacks",
      null,
      async () => {
        assert.ok(busy, "no step ended between the comments and the events");
        assert.deepEqual(torn, []);
        const rowsOf = (table) => fresh.filter((p) => p.table === table).flatMap((p) => p.rows);
        assert.equal(rowsOf("items").some((r) => r.id === busy.id), false, `${busy.key} was filed after the cut`);
        assert.equal(rowsOf("events").some((r) => r.item_id === busy.id), false);
        assert.ok(rowsOf("sqlite_sequence").find((r) => r.name === "items").seq >= busy.id, "the next key stays past the one filed during the run");
      },
    ]);
  } finally {
    if (worker) await worker.stop();
  }
}

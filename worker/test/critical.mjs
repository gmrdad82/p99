import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { totpOf } from "./app.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const MARK = { rect: { x: 10, y: 20, w: 100, h: 40 }, viewport: { w: 1280, h: 800, scroll_x: 0, scroll_y: 0, dpr: 1 } };
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };

export function stateFiles(state, kind) {
  const dir = join(state, "v3", kind, kind === "d1" ? "miniflare-D1DatabaseObject" : "miniflare-R2BucketObject");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite").map((f) => join(dir, f)) : [];
}

function readEach(files, sql, ...args) {
  const found = [];
  for (const file of files) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      found.push(...db.prepare(sql).all(...args).map((r) => ({ ...r })));
    } finally {
      db.close();
    }
  }
  return found;
}

export function storedUpload(state, uid) {
  const d1 = stateFiles(state, "d1");
  assert.equal(d1.length, 1, `expected one D1 database under ${state}`);
  return {
    rows: readEach(d1, "SELECT id, stored_at FROM attachments WHERE client_uid = ?1", uid),
    objects: readEach(stateFiles(state, "r2"), "SELECT key FROM _mf_objects WHERE key LIKE ?1", `%/${uid}`).map((r) => r.key),
  };
}

export async function criticalChecks({ base, call, browse, mint, check, issueBody, here, sha256, keys, sign, actorHeader, state }) {
  const signedFetch = (method, path, { bytes = Buffer.alloc(0), hash = sha256(bytes), ts = Math.floor(Date.now() / 1000), actor, headers = {} } = {}) => {
    const actorText = actor === undefined ? actorHeader({ email: "grace@example.com", name: "Grace Hopper", agent: true }) : actor;
    const all = {
      "x-p99-key-id": "p99",
      "x-p99-auth": sign({ secret: keys.p99, ts, method, path, actor: actorText, hash }),
      "x-content-sha256": hash,
      ...(actorText ? { "x-p99-actor": actorText } : {}),
      ...(bytes.length > 0 ? { "content-type": "application/json" } : {}),
      ...headers,
    };
    for (const [name, value] of Object.entries(all)) if (value === null) delete all[name];
    return fetch(base + path, { method, headers: all, body: bytes.length > 0 ? bytes : undefined });
  };
  const refusal = async (answer, status, message) => {
    assert.equal(answer.status, status);
    const body = answer instanceof Response ? await answer.json() : answer.json;
    assert.ok(body, `status ${answer.status} carries no JSON`);
    assert.equal(typeof body.error, "string");
    if (message) assert.match(body.message, message);
  };

  await check("a signed request is refused when its auth, hash, clock, actor, path or method is off, and passes when all hold", async () => {
    const path = "/_p99/v1/hosts";
    assert.equal((await signedFetch("GET", path)).status, 200);
    await refusal(await signedFetch("GET", path, { headers: { "x-p99-auth": null } }), 401, /X-P99-Auth/);
    await refusal(await signedFetch("GET", path, { headers: { "x-p99-auth": "v1 ts=1,sig=nothex" } }), 401, /X-P99-Auth/);
    await refusal(await signedFetch("GET", path, { hash: "ABC" }), 401, /X-Content-SHA256/);
    await refusal(await signedFetch("GET", path, { ts: Math.floor(Date.now() / 1000) + 120 }), 401, /clock/);
    await refusal(await signedFetch("GET", path, { ts: Math.floor(Date.now() / 1000) - 120 }), 401, /clock/);
    await refusal(await signedFetch("GET", path, { actor: Buffer.from("not json").toString("base64url") }), 400, /X-P99-Actor/);
    await refusal(await signedFetch("GET", path, { actor: actorHeader({ email: "not an e-mail", name: "Ada" }) }), 400, /X-P99-Actor/);
    await refusal(await signedFetch("GET", path, { actor: "" }), 401, /X-P99-Actor is required/);
    const ts = Math.floor(Date.now() / 1000);
    const elsewhere = await signedFetch("GET", `${path}?x=1`, {
      ts,
      headers: { "x-p99-auth": sign({ secret: keys.p99, ts, method: "GET", path, actor: actorHeader(ADA), hash: sha256(Buffer.alloc(0)) }) },
      actor: actorHeader(ADA),
    });
    await refusal(elsewhere, 401, /does not verify/);
    const moved = await fetch(base + path, {
      method: "DELETE",
      headers: {
        "x-p99-key-id": "p99",
        "x-p99-actor": actorHeader(ADA),
        "x-content-sha256": sha256(Buffer.alloc(0)),
        "x-p99-auth": sign({ secret: keys.p99, ts, method: "GET", path, actor: actorHeader(ADA), hash: sha256(Buffer.alloc(0)) }),
      },
    });
    await refusal(moved, 401, /does not verify/);
  });

  await check("a signed JSON body that differs from its X-Content-SHA256 is refused and files nothing", async () => {
    const title = `Swapped body ${randomUUID().slice(0, 8)}`;
    const sent = Buffer.from(JSON.stringify(issueBody({ title })));
    const claimed = Buffer.from(JSON.stringify(issueBody({ title: "What was signed" })));
    await refusal(await signedFetch("POST", `/_p99/v1/issues?host=${here}`, { bytes: sent, hash: sha256(claimed) }), 401, /does not match/);
    const listed = await call("GET", `/_p99/v1/issues?host=${here}&q=${encodeURIComponent(title)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.issues.some((i) => i.title === title), false);
  });

  await check("a signed body that isn't JSON, or isn't UTF-8, is refused as such and files nothing", async () => {
    const title = `Not JSON ${randomUUID().slice(0, 8)}`;
    const [before, after] = JSON.stringify(issueBody({ title: `${title} XFFX` })).split("XFFX");
    const latin = Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]);
    for (const bytes of [Buffer.from(`{"title":"${title}",`), latin]) {
      await refusal(await signedFetch("POST", `/_p99/v1/issues?host=${here}`, { bytes }), 400, /not valid JSON/);
    }
    const listed = await call("GET", `/_p99/v1/issues?host=${here}&q=${encodeURIComponent(title)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.issues.some((i) => i.title === title), false);
  });

  let key = "BUG-00000000";
  await check("an item with one mark is filed for the upload checks", async () => {
    const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Uploads land once", marks: [MARK] }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    key = filed.json.key;
  });
  const put = (uid, query, bytes, type) =>
    call("PUT", `/_p99/v1/issues/${key}/attachments/${encodeURIComponent(uid)}?host=${here}&${query}`, { raw: bytes, type });

  await check("an upload stores its bytes once, a retry with the same uid answers the same file, and the file reads back byte for byte", async () => {
    const uid = randomUUID();
    const bytes = Buffer.from("order 42: total stays at 0\n");
    const first = await put(uid, "name=trace.txt", bytes, "text/plain");
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.name, "trace.txt");
    assert.equal(first.json.bytes, bytes.length);
    assert.equal(first.json.sha256, sha256(bytes));
    assert.equal(first.json.role, "file");
    const again = await put(uid, "name=trace.txt", bytes, "text/plain");
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.id, first.json.id);
    const file = await call("GET", `/_p99/v1/files/${first.json.id}?host=${here}`);
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.response.arrayBuffer()), bytes);
    const item = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(item.json.attachments.filter((a) => a.client_uid === uid).length, 1);
  });

  await check("a region upload needs one of the item's marks, and only a region carries one", async () => {
    const region = await put(randomUUID(), "role=region&mark=0&name=region.png", PNG, "image/png");
    assert.equal(region.status, 201, JSON.stringify(region.json));
    assert.equal(region.json.mark, 0);
    assert.equal(region.json.role, "region");
    await refusal((await put(randomUUID(), "role=region&mark=1&name=region.png", PNG, "image/png")), 400, /mark/);
    await refusal((await put(randomUUID(), "role=region&name=region.png", PNG, "image/png")), 400, /mark/);
    await refusal((await put(randomUUID(), "mark=0&name=note.txt", Buffer.from("hi"), "text/plain")), 400, /only a region/);
    await refusal((await put(randomUUID(), "role=avatar&name=a.png", PNG, "image/png")), 400, /role/);
  });

  await check("an upload is refused for a reused uid, a bad uid, name or type, content that lies about its type, or no item", async () => {
    const uid = randomUUID();
    assert.equal((await put(uid, "name=one.txt", Buffer.from("one\n"), "text/plain")).status, 201);
    await refusal((await put(uid, "name=one.txt", Buffer.from("two\n"), "text/plain")), 409, /client_uid/);
    await refusal((await put(uid, "name=one.txt", Buffer.from("three\n"), "text/plain")), 409, /client_uid/);
    await refusal((await put("bad uid!", "name=a.txt", Buffer.from("a"), "text/plain")), 400, /client_uid/);
    await refusal((await put(randomUUID(), `name=${encodeURIComponent("a/b.txt")}`, Buffer.from("a"), "text/plain")), 400, /name/);
    await refusal((await put(randomUUID(), "name=", Buffer.from("a"), "text/plain")), 400, /name/);
    await refusal((await put(randomUUID(), "name=page.html", Buffer.from("a"), "text/plain")), 400, /extension/);
    await refusal((await put(randomUUID(), "name=run.bin", Buffer.from("MZ"), "application/x-msdownload")), 400, /not application\/x-msdownload/);
    await refusal((await put(randomUUID(), "role=screenshot&name=shot.txt", Buffer.from("a"), "text/plain")), 400, /WebP, PNG or JPEG/);
    await refusal((await put(randomUUID(), "name=report.pdf", Buffer.from("not a pdf at all"), "application/pdf")), 400, /does not look like/);
    await refusal((await put(randomUUID(), "name=note.txt", Buffer.from("<script>alert(1)</script>"), "text/plain")), 400, /does not look like/);
    const missing = await call("PUT", `/_p99/v1/issues/BUG-99999999/attachments/${randomUUID()}?host=${here}&name=a.txt`, {
      raw: Buffer.from("a"),
      type: "text/plain",
    });
    assert.equal(missing.status, 404);
    const item = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(item.json.attachments.filter((a) => a.client_uid === uid).length, 1);
    const stored = storedUpload(state, uid);
    assert.equal(stored.rows.length, 1);
    assert.ok(stored.rows[0].stored_at);
    assert.equal(stored.objects.length, 1);
  });

  await check("an upload whose bytes differ from its signed X-Content-SHA256 is refused and leaves no file", async () => {
    const uid = randomUUID();
    const bytes = Buffer.from("what was sent\n");
    const response = await signedFetch("PUT", `/_p99/v1/issues/${key}/attachments/${uid}?host=${here}&name=swap.txt`, {
      bytes,
      hash: sha256(Buffer.from("what was signed\n")),
      headers: { "content-type": "text/plain" },
    });
    await refusal(response, 400, /X-Content-SHA256/);
    const item = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(item.json.attachments.some((a) => a.client_uid === uid), false);
    assert.deepEqual(storedUpload(state, uid), { rows: [], objects: [] });
    const retried = await signedFetch("PUT", `/_p99/v1/issues/${key}/attachments/${uid}?host=${here}&name=swap.txt`, {
      bytes,
      headers: { "content-type": "text/plain" },
    });
    assert.equal(retried.status, 201, await retried.clone().text());
    const stored = storedUpload(state, uid);
    assert.equal(stored.rows.length, 1);
    assert.ok(stored.rows[0].stored_at);
    assert.equal(stored.objects.length, 1);
  });

  await check("a browser upload is refused without a code, and a reporter attaches only to their own item", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const grace = await mint("Grace Hopper", "grace@example.com", [here]);
    const own = await browse("POST", "/issues", ada.secret, issueBody({ title: "Ada's own" }));
    assert.equal(own.status, 201, JSON.stringify(own.json));
    const send = (code, itemKey) =>
      fetch(`${base}/_p99/api/issues/${itemKey}/attachments/${randomUUID()}?name=note.txt`, {
        method: "PUT",
        headers: { ...(code ? { "x-p99-code": code } : {}), "content-type": "text/plain" },
        body: "seen on the orders page\n",
      });
    assert.equal((await send(ada.secret, own.json.key)).status, 201);
    assert.equal((await send(undefined, own.json.key)).status, 401);
    assert.equal((await send(grace.secret, own.json.key)).status, 404);
  });

  await check("a code needs a name, an e-mail, listed hosts and boolean flags, and its client_uid replays without the secret", async () => {
    const bad = [
      { name: "", email: "ada@example.com", hosts: [here] },
      { name: "Ada Lovelace", email: "ada", hosts: [here] },
      { name: "Ada Lovelace", email: "ada@example.com", hosts: [] },
      { name: "Ada Lovelace", email: "ada@example.com", hosts: ["unlisted.example.com"] },
      { name: "Ada Lovelace", email: "ada@example.com", hosts: [here], manager: "yes" },
      { name: "Ada Lovelace", email: "ada@example.com", hosts: [here], totp: 1 },
      { name: "Ada Lovelace", email: "ada@example.com", hosts: [here], client_uid: "bad uid!" },
    ];
    for (const body of bad) assert.equal((await call("POST", "/_p99/v1/codes", { body })).status, 400, JSON.stringify(body));
    const uid = randomUUID();
    const body = { name: "Ada Lovelace", email: "Ada@Example.com", hosts: [here, here.toUpperCase()], client_uid: uid };
    const first = await call("POST", "/_p99/v1/codes", { body });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.match(first.json.secret, /^[0-9a-z]{12}$/);
    assert.equal(first.json.code.email, "ada@example.com");
    assert.deepEqual(first.json.code.hosts, [here]);
    assert.equal(first.json.code.hint, first.json.secret.slice(-4));
    const replay = await call("POST", "/_p99/v1/codes", { body });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.code.id, first.json.code.id);
    assert.equal(replay.json.secret, undefined);
    const changed = await call("POST", "/_p99/v1/codes", { body: { name: "Grace Hopper", email: "grace@example.com", hosts: ["unlisted.example.com"], manager: true, client_uid: uid } });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(changed.json.code.id, first.json.code.id);
    assert.equal(changed.json.code.name, "Ada Lovelace");
    assert.equal(changed.json.code.email, "ada@example.com");
    assert.deepEqual(changed.json.code.hosts, [here]);
    assert.equal(changed.json.secret, undefined);
    assert.equal((await call("POST", "/_p99/v1/codes", { body, actor: ADA })).status, 409);
    const listed = await call("GET", `/_p99/v1/codes?host=${here}`);
    const row = listed.json.codes.find((cd) => cd.id === first.json.code.id);
    assert.ok(row);
    assert.equal(JSON.stringify(listed.json).includes(first.json.secret), false);
    for (const field of ["hash", "secret", "totp_secret", "sealed_code"]) assert.equal(field in row, false, field);
  });

  await check("revoking is final and repeatable, and a revoked or unknown code gets no authenticator", async () => {
    const minted = await mint("Grace Hopper", "grace@example.com", [here]);
    const first = await call("POST", `/_p99/v1/codes/${minted.code.id}/revoke`);
    assert.equal(first.status, 200);
    const again = await call("POST", `/_p99/v1/codes/${minted.code.id}/revoke`);
    assert.equal(again.status, 200);
    assert.equal(again.json.revoked_at, first.json.revoked_at);
    assert.equal((await call("POST", "/_p99/v1/codes/99999999/revoke")).status, 404);
    assert.equal((await call("POST", `/_p99/v1/codes/${minted.code.id}/totp`)).status, 404);
    assert.equal((await call("POST", "/_p99/v1/codes/99999999/totp")).status, 404);
    assert.equal((await browse("GET", "/me", minted.secret)).status, 401);
  });

  await check("verify takes only 6 digits, and only from a code with an authenticator", async () => {
    const plain = await mint("Ada Lovelace", "ada@example.com", [here]);
    await refusal((await browse("POST", "/verify", plain.secret, { totp: "123456" })), 400, /no authenticator/);
    const guarded = await mint("Ada Lovelace", "ada@example.com", [here]);
    assert.equal((await call("POST", `/_p99/v1/codes/${guarded.code.id}/totp`)).status, 200);
    for (const totp of ["12345", "1234567", "abcdef", 123456]) {
      await refusal((await browse("POST", "/verify", guarded.secret, { totp })), 400, /6 digits/);
    }
    assert.equal((await browse("GET", "/me", guarded.secret)).status, 428);
  });

  await check("verify locks after 10 wrong codes, and then refuses even the right one", async () => {
    const locked = await mint("Grace Hopper", "grace@example.com", [here]);
    const set = await call("POST", `/_p99/v1/codes/${locked.code.id}/totp`);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    const near = new Set([-1, 0, 1].map((offset) => totpOf(set.json.totp_key, offset)));
    const wrong = ["000000", "111111", "222222", "333333"].find((code) => !near.has(code));
    for (let i = 1; i < 10; i++) await refusal((await browse("POST", "/verify", locked.secret, { totp: wrong })), 400, /doesn't match/);
    await refusal((await browse("POST", "/verify", locked.secret, { totp: wrong })), 403, /too many wrong codes/);
    await refusal((await browse("POST", "/verify", locked.secret, { totp: totpOf(set.json.totp_key) })), 403, /too many wrong codes/);
    assert.equal((await browse("GET", "/me", locked.secret)).status, 428);
  });
  await check("a JSON body streamed without a length is cut off at its limit and refused, and the Worker keeps answering", async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const chunks = 5;
    const path = `/_p99/v1/issues?host=${here}`;
    const hash = sha256(Buffer.alloc(chunk.length * chunks, 0x20));
    const actor = actorHeader(ADA);
    const ts = Math.floor(Date.now() / 1000);
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent++ < chunks) controller.enqueue(new Uint8Array(chunk));
        else controller.close();
      },
    });
    const answer = await fetch(base + path, {
      method: "POST",
      duplex: "half",
      body,
      headers: {
        "content-type": "application/json",
        "x-p99-key-id": "p99",
        "x-p99-actor": actor,
        "x-content-sha256": hash,
        "x-p99-auth": sign({ secret: keys.p99, ts, method: "POST", path, actor, hash }),
      },
    });
    await refusal(answer, 413, /larger than 262144 bytes/);
    assert.equal((await signedFetch("GET", "/_p99/v1/hosts")).status, 200);
  });

  await check("renaming a person moves their items and comments to the new e-mail, and refuses a bad or unchanged address", async () => {
    const tag = randomUUID().slice(0, 8);
    const from = `byron-${tag}@example.com`;
    const to = `lovelace-${tag}@example.com`;
    const before = { email: from, name: "Ada Lovelace", agent: false };
    const title = `Renamed reporter ${tag}`;
    const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { actor: before, body: issueBody({ title }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const said = await call("POST", `/_p99/v1/issues/${filed.json.key}/comments?host=${here}`, { actor: before, body: { client_uid: randomUUID(), body: "Still broken in Firefox." } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    await refusal(await call("POST", "/_p99/v1/people/rename", { body: { from: "not an e-mail", to } }), 400, /e-mail addresses/);
    await refusal(await call("POST", "/_p99/v1/people/rename", { body: { from, to: 42 } }), 400, /e-mail addresses/);
    await refusal(await call("POST", "/_p99/v1/people/rename", { body: { from, to: ` ${from.toUpperCase()}` } }), 400, /the same e-mail/);
    const moved = await call("POST", "/_p99/v1/people/rename", { body: { from: ` ${from.toUpperCase()} `, to } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.deepEqual({ from: moved.json.from, to: moved.json.to, items: moved.json.items, comments: moved.json.comments, assigned: moved.json.assigned }, { from, to, items: 1, comments: 1, assigned: 0 });
    const d1 = stateFiles(state, "d1");
    assert.deepEqual(readEach(d1, "SELECT reporter_email FROM items WHERE title = ?1", title), [{ reporter_email: to }]);
    assert.deepEqual(readEach(d1, "SELECT count(*) AS n FROM comments WHERE author_email = ?1", from), [{ n: 0 }]);
    assert.deepEqual(readEach(d1, "SELECT count(*) AS n FROM comments WHERE author_email = ?1", to), [{ n: 1 }]);
    const again = await call("POST", "/_p99/v1/people/rename", { body: { from, to } });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual([again.json.items, again.json.comments], [0, 0]);
  });
}

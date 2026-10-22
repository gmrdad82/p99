import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const MARK = { rect: { x: 10, y: 20, w: 100, h: 40 }, viewport: { w: 1280, h: 800, scroll_x: 0, scroll_y: 0, dpr: 1 } };
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };

export async function criticalChecks({ base, call, browse, mint, check, issueBody, here, sha256, keys, sign, actorHeader }) {
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
    const title = `Swapped body ${randomUUID()}`;
    const sent = Buffer.from(JSON.stringify(issueBody({ title })));
    const claimed = Buffer.from(JSON.stringify(issueBody({ title: "What was signed" })));
    await refusal(await signedFetch("POST", `/_p99/v1/issues?host=${here}`, { bytes: sent, hash: sha256(claimed) }), 401, /does not match/);
    const listed = await call("GET", `/_p99/v1/issues?host=${here}&q=${encodeURIComponent(title)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.issues.some((i) => i.title === title), false);
  });

  const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Uploads land once", marks: [MARK] }) });
  assert.equal(filed.status, 201, JSON.stringify(filed.json));
  const key = filed.json.key;
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
}

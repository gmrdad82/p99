import { request } from "node:http";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { cspChecks, getter } from "./csp.mjs";

export const APP_HOST = "app.localhost";

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

function off(code) {
  return code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
}

function median(list) {
  return [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
}

export async function appChecks({ base, call, browse, mint, check, issueBody, here, there, keys }) {
  const port = Number(new URL(base).port);
  const origin = `http://${APP_HOST}:${port}`;
  const app = (method, path, { body, token, headers = {}, page = true } = {}) =>
    new Promise((resolve, reject) => {
      const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const sent = { host: `${APP_HOST}:${port}`, ...headers };
      if (page) Object.assign(sent, { "x-p99-app": "1", origin, ...headers });
      if (token) sent.cookie = `__Host-p99=${token}`;
      if (bytes) Object.assign(sent, { "content-type": "application/json", "content-length": bytes.length });
      const started = performance.now();
      const req = request({ host: "127.0.0.1", port, path, method, headers: sent }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json, ms: performance.now() - started });
        });
      });
      req.on("error", reject);
      if (bytes) req.write(bytes);
      req.end();
    });
  const signIn = (email, totp, token) => app("POST", "/_p99/app/signin", { body: { email, totp }, token });
  const tokenOf = (r) => /__Host-p99=([A-Za-z0-9_-]{43});/.exec((r.headers["set-cookie"] || [])[0] || "")?.[1];
  const person = async (name, email, hosts, manager = false) => {
    const minted = await call("POST", "/_p99/v1/codes", { body: { name, email, hosts, manager, totp: true } });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    return minted.json;
  };

  await check("the P99 page answers only on its own address, under a strict CSP", async () => {
    const page = await app("GET", "/", { page: false });
    assert.equal(page.status, 200, page.text);
    assert.match(page.headers["content-type"], /^text\/html/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.match(page.text, /id="signin"/);
    const script = await app("GET", "/_p99/app.js?v=dev", { page: false });
    assert.equal(script.status, 200);
    assert.match(script.headers["cache-control"], /immutable/);
    assert.equal((await app("GET", "/_p99/app.css?v=dev", { page: false })).status, 200);
    assert.equal((await app("GET", "/_p99/panel.js?v=dev", { page: false })).status, 200);
    assert.equal((await app("GET", "/_p99/p99.js", { page: false })).status, 404);
    assert.equal((await fetch(`${base}/_p99/app.js?v=dev`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
  });

  await cspChecks({ check, get: getter(`${APP_HOST}:${port}`, port) });

  await check("the CLI's signed routes still answer on the page's address, and only signed", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const actor = Buffer.from(JSON.stringify({ email: "grace@example.com", name: "Grace Hopper" })).toString("base64url");
    const hash = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
    const sig = createHmac("sha256", keys.p99).update(`v1\n${ts}\nGET\n/_p99/v1/hosts\n${actor}\n${hash}`).digest("hex");
    const signed = await app("GET", "/_p99/v1/hosts", {
      page: false,
      headers: { "x-p99-key-id": "p99", "x-p99-actor": actor, "x-content-sha256": hash, "x-p99-auth": `v1 ts=${ts},sig=${sig}` },
    });
    assert.equal(signed.status, 200, signed.text);
    assert.equal((await app("GET", "/_p99/v1/hosts", { page: false })).status, 401);
  });

  const annie = await person("Annie Easley", "annie.page@example.com", [here]);
  const mae = await person("Mae Jemison", "mae.page@example.com", [here]);
  const plain = await mint("Mary Jackson", "mary.page@example.com", [here]);

  await check("an unknown e-mail, a code without an authenticator and a wrong code get the same answer in similar time", async () => {
    const right = totpOf(mae.totp_key);
    const tries = { unknown: [], plain: [], wrong: [] };
    for (let i = 0; i < 3; i++) {
      tries.unknown.push(await signIn("nobody@example.com", right));
      tries.plain.push(await signIn("mary.page@example.com", right));
      tries.wrong.push(await signIn("mae.page@example.com", off(right)));
    }
    const all = Object.values(tries).flat();
    for (const r of all) {
      assert.equal(r.status, 401, r.text);
      assert.equal(r.text, all[0].text);
      assert.equal(r.headers["set-cookie"], undefined);
    }
    const times = Object.fromEntries(Object.entries(tries).map(([k, v]) => [k, median(v.map((r) => r.ms))]));
    assert.ok(Math.max(...Object.values(times)) - Math.min(...Object.values(times)) < 150, JSON.stringify(times));
    assert.ok(plain.secret);
  });

  let annieToken;
  await check("a session is an HttpOnly, Secure, SameSite=Strict cookie for 30 days, rotated on sign-in and gone on sign-out", async () => {
    const first = await signIn("Annie.Page@Example.com", totpOf(annie.totp_key));
    assert.equal(first.status, 200, first.text);
    const cookie = first.headers["set-cookie"][0];
    assert.match(cookie, /^__Host-p99=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    const one = tokenOf(first);
    const spaces = await app("GET", "/_p99/app/spaces", { token: one });
    assert.equal(spaces.status, 200, spaces.text);
    assert.deepEqual(spaces.json.spaces.map((s) => s.host), [here]);
    assert.equal(spaces.json.spaces[0].manager, false);
    assert.equal(typeof spaces.json.spaces[0].open, "number");
    const second = await signIn("annie.page@example.com", totpOf(annie.totp_key, 1), one);
    assert.equal(second.status, 200, second.text);
    const two = tokenOf(second);
    assert.notEqual(two, one);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: one })).status, 401);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: two })).status, 200);
    const out = await app("POST", "/_p99/app/signout", { token: two });
    assert.equal(out.status, 200);
    assert.match(out.headers["set-cookie"][0], /^__Host-p99=; Max-Age=0;/);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: two })).status, 401);
  });

  await check("a code's 30-second step signs in once; the same digits again are refused", async () => {
    const replay = await signIn("annie.page@example.com", totpOf(annie.totp_key, 1));
    assert.equal(replay.status, 401, replay.text);
  });

  await check("without the X-P99-App header or from another origin, the page's requests are refused", async () => {
    const katherine = await person("Katherine Johnson", "katherine.page@example.com", [here]);
    const code = totpOf(katherine.totp_key);
    const bare = await app("POST", "/_p99/app/signin", { body: { email: "katherine.page@example.com", totp: code }, page: false, headers: { origin } });
    assert.equal(bare.status, 403);
    const crossed = await app("POST", "/_p99/app/signin", { body: { email: "katherine.page@example.com", totp: code }, headers: { origin: "https://evil.example" } });
    assert.equal(crossed.status, 403);
    const ok = await signIn("katherine.page@example.com", code);
    assert.equal(ok.status, 200, ok.text);
    const token = tokenOf(ok);
    assert.equal((await app("GET", "/_p99/app/spaces", { token, page: false })).status, 403);
    const filed = await app("POST", `/_p99/api/issues?host=${here}`, { token, body: issueBody(), headers: { origin: "https://evil.example" } });
    assert.equal(filed.status, 403);
    annieToken = token;
  });

  await check("a session reaches the panel's routes only for its own hosts, with its code's role", async () => {
    const token = annieToken;
    const me = await app("GET", `/_p99/api/me?host=${here}&path=%2F`, { token });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.email, "katherine.page@example.com");
    assert.equal(me.json.manager, false);
    assert.equal((await app("GET", `/_p99/api/me?host=${there}`, { token })).status, 404);
    assert.equal((await app("GET", `/_p99/api/me`, { token })).status, 404);
    assert.equal((await app("GET", `/_p99/api/issues?scope=all&host=${here}`, { token })).status, 403);
    const filed = await app("POST", `/_p99/api/issues?host=${here}`, { token, body: issueBody() });
    assert.equal(filed.status, 201, filed.text);
    assert.equal(filed.json.host, here);
    const mine = await app("GET", `/_p99/api/issues/${filed.json.key}?host=${here}`, { token });
    assert.equal(mine.status, 200);
    const boss = await person("Dorothy Vaughan", "dorothy.page@example.com", [here, there], true);
    const signed = await signIn("dorothy.page@example.com", totpOf(boss.totp_key));
    assert.equal(signed.status, 200, signed.text);
    const bossToken = tokenOf(signed);
    const all = await app("GET", `/_p99/api/issues?scope=all&host=${there}`, { token: bossToken });
    assert.equal(all.status, 200, all.text);
    const listed = await app("GET", "/_p99/app/spaces", { token: bossToken });
    assert.deepEqual(listed.json.spaces.map((s) => [s.host, s.manager]), [[here, true], [there, true]].sort());
    assert.equal(JSON.stringify(listed.json).includes(boss.secret), false);
    assert.equal((await app("GET", `/_p99/api/issues/${filed.json.key}?host=${here}`, { token: bossToken })).status, 200);
  });

  await check("a session dies the moment its code is revoked or relinked", async () => {
    const ella = await person("Ella Baker", "ella.page@example.com", [here]);
    const opal = await person("Opal Tometi", "opal.page@example.com", [here]);
    const a = tokenOf(await signIn("ella.page@example.com", totpOf(ella.totp_key)));
    const b = tokenOf(await signIn("opal.page@example.com", totpOf(opal.totp_key)));
    assert.equal((await app("GET", "/_p99/app/spaces", { token: a })).status, 200);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: b })).status, 200);
    assert.equal((await call("POST", `/_p99/v1/codes/${ella.code.id}/revoke`)).status, 200);
    assert.equal((await call("POST", `/_p99/v1/codes/${opal.code.id}/relink`, { body: {} })).status, 201);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: a })).status, 401);
    assert.equal((await app("GET", "/_p99/app/spaces", { token: b })).status, 401);
    assert.equal((await app("GET", `/_p99/api/me?host=${here}`, { token: b })).status, 401);
  });

  await check("after ten wrong codes the authenticator is locked for sign-in too", async () => {
    const rosa = await person("Rosa Parks", "rosa.page@example.com", [here]);
    for (let i = 0; i < 10; i++) await browse("POST", "/verify", rosa.secret, { totp: "000000" === totpOf(rosa.totp_key) ? "111111" : "000000" });
    const locked = await signIn("rosa.page@example.com", totpOf(rosa.totp_key));
    assert.equal(locked.status, 401, locked.text);
  });

  await check("sign-in tries are limited per e-mail and per address", async () => {
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push((await signIn("limited@example.com", "123456")).status);
    assert.deepEqual(answers, [401, 401, 401, 401, 401, 429]);
    let n = 0;
    let status = 401;
    while (status !== 429 && n < 40) status = (await signIn(`fresh${n++}@example.com`, "123456")).status;
    assert.equal(status, 429);
    assert.ok(n <= 31, String(n));
  });
}

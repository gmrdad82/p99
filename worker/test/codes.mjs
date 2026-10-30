import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

export async function codeChecks({ call, browse, mint, check, issueBody, here, there, state, wrangler, root }) {
  const d1 = (command) => {
    const run = spawnSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", command], {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`d1 ${command} failed:\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(run.stdout)[0].results;
  };
  const rows = (table, id) => d1(`SELECT count(*) AS n FROM ${table} WHERE ${table === "codes" ? "id" : "code_id"} = ${id}`)[0].n;
  const seedRows = (id) =>
    d1(
      `INSERT INTO code_devices (code_id, token_hash, created_at) VALUES (${id}, 'dev-${id}-a', '2026-10-01T00:00:00Z'), (${id}, 'dev-${id}-b', '2026-10-01T00:00:00Z');
       INSERT INTO app_sessions (token_hash, code_id, created_at, expires_at) VALUES ('app-${id}', ${id}, '2026-10-01T00:00:00Z', '2099-01-01T00:00:00Z');`,
    );
  const listed = async () => (await call("GET", "/_p99/v1/codes")).json.codes.map((c) => c.id);
  const remove = (id, options) => call("DELETE", `/_p99/v1/codes/${id}`, options);
  const revoke = (id) => call("POST", `/_p99/v1/codes/${id}/revoke`);

  await check("an Owner deletes a revoked code for good, with its devices and app sessions", async () => {
    const gone = await mint("Grace Hopper", "grace.gone@example.com", [here]);
    const kept = await mint("Grace Hopper", "grace.kept@example.com", [here]);
    seedRows(gone.code.id);
    seedRows(kept.code.id);
    assert.equal((await revoke(gone.code.id)).status, 200);
    assert.equal((await revoke(kept.code.id)).status, 200);
    const done = await remove(gone.code.id);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual(done.json, { id: gone.code.id, deleted: true });
    assert.equal(rows("codes", gone.code.id), 0);
    assert.equal(rows("code_devices", gone.code.id), 0);
    assert.equal(rows("app_sessions", gone.code.id), 0);
    assert.equal(rows("codes", kept.code.id), 1);
    assert.equal(rows("code_devices", kept.code.id), 2);
    assert.equal(rows("app_sessions", kept.code.id), 1);
    const ids = await listed();
    assert.ok(!ids.includes(gone.code.id), ids.join(","));
    assert.ok(ids.includes(kept.code.id), ids.join(","));
  });

  await check("an active code is refused with revoke it first and keeps every row", async () => {
    const live = await mint("Ada Lovelace", "ada.live@example.com", [here]);
    seedRows(live.code.id);
    const refused = await remove(live.code.id);
    assert.equal(refused.status, 409, JSON.stringify(refused.json));
    assert.match(JSON.stringify(refused.json), /revoke it first/);
    assert.equal(rows("codes", live.code.id), 1);
    assert.equal(rows("code_devices", live.code.id), 2);
    assert.equal(rows("app_sessions", live.code.id), 1);
    assert.equal((await browse("GET", "/me", live.secret)).status, 200);
    assert.ok((await listed()).includes(live.code.id));
  });

  await check("an unknown code is 404, and a second delete of the same code is 404 too", async () => {
    const missing = await remove(999999);
    assert.equal(missing.status, 404);
    assert.match(JSON.stringify(missing.json), /no such code/);
    const twice = await mint("Grace Hopper", "grace.twice@example.com", [here]);
    await revoke(twice.code.id);
    assert.equal((await remove(twice.code.id)).status, 200);
    assert.equal((await remove(twice.code.id)).status, 404);
    assert.equal((await revoke(twice.code.id)).status, 404);
  });

  await check("a deleted code can't sign in, and its e-mail can be invited again", async () => {
    const minted = await mint("Ada Lovelace", "ada.back@example.com", [here]);
    assert.equal((await browse("GET", "/me", minted.secret)).status, 200);
    await revoke(minted.code.id);
    assert.equal((await browse("GET", "/me", minted.secret)).status, 401);
    assert.equal(rows("codes", minted.code.id), 1);
    assert.equal((await remove(minted.code.id)).status, 200);
    assert.equal(rows("codes", minted.code.id), 0);
    assert.equal((await browse("GET", "/me", minted.secret)).status, 401);
    const again = await mint("Ada Lovelace", "ada.back@example.com", [here]);
    assert.notEqual(again.code.id, minted.code.id);
    assert.equal((await browse("GET", "/me", again.secret)).status, 200);
  });

  await check("a delete takes no body, and a code in the browser can't delete codes", async () => {
    const owner = await mint("Ada Lovelace", "ada.owner@example.com", [here], true);
    const target = await mint("Grace Hopper", "grace.target@example.com", [here]);
    await revoke(target.code.id);
    const bodied = await remove(target.code.id, { body: { force: true } });
    assert.deepEqual([bodied.status, bodied.json.message], [401, "the body does not match X-Content-SHA256"]);
    const fromBrowser = await browse("DELETE", `/codes/${target.code.id}`, owner.secret);
    assert.equal(fromBrowser.status, 404);
    assert.equal(rows("codes", target.code.id), 1);
    assert.equal((await remove(target.code.id)).status, 200);
  });

  await check("a code carries role, with manager beside it for the loader, and POST /codes takes role alone", async () => {
    const make = (body) => call("POST", "/_p99/v1/codes", { body: { name: "Grace Hopper", email: `g.${randomUUID().slice(0, 8)}@example.com`, hosts: [here], mail: false, ...body } });
    for (const [body, role] of [[{ role: "owner" }, "owner"], [{ role: "user" }, "user"], [{}, "user"], [{ role: null }, "user"]]) {
      const made = await make(body);
      assert.equal(made.status, 201, `${JSON.stringify(body)} ${JSON.stringify(made.json)}`);
      assert.equal(made.json.code.role, role, JSON.stringify(body));
      assert.equal(made.json.code.manager, role === "owner", JSON.stringify(made.json.code));
    }
    for (const body of [{ role: "guest" }, { role: "Owner" }, { role: "manager" }, { role: 1 }, { manager: true }, { manager: false }, { role: "owner", manager: true }]) {
      const refused = await make(body);
      assert.equal(refused.status, 400, `${JSON.stringify(body)} ${JSON.stringify(refused.json)}`);
    }
    for (const code of (await call("GET", "/_p99/v1/codes")).json.codes) {
      assert.ok(["owner", "user"].includes(code.role), JSON.stringify(code));
      assert.equal(code.manager, code.role === "owner", JSON.stringify(code));
    }
  });

  await check("/me carries role with manager beside it for the loader; /people and a comment's author carry role alone", async () => {
    const owner = await mint("Ada Lovelace", "ada.roles@example.com", [here, there], true);
    const user = await mint("Grace Hopper", "grace.roles@example.com", [here]);
    const mine = await browse("GET", "/me", owner.secret);
    assert.equal(mine.json.role, "owner");
    assert.equal(mine.json.manager, true);
    const theirs = await browse("GET", "/me", user.secret);
    assert.equal(theirs.json.role, "user");
    assert.equal(theirs.json.manager, false);
    const people = (await browse("GET", "/people", owner.secret)).json.people;
    assert.ok(people.length > 0);
    for (const p of people) assert.deepEqual(Object.keys(p).sort(), ["avatar", "role", "username"]);
    const filed = await browse("POST", "/issues", user.secret, issueBody({ title: "Role words on a comment" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    assert.equal((await browse("POST", `/issues/${key}/comments`, user.secret, { client_uid: randomUUID(), body: "Still broken." })).status, 201);
    assert.equal((await browse("POST", `/issues/${key}/comments`, owner.secret, { client_uid: randomUUID(), body: "Looking." })).status, 201);
    const thread = (await browse("GET", `/issues/${key}`, owner.secret)).json;
    assert.deepEqual(thread.comments.map((c) => [c.body, c.author.role, "manager" in c.author]), [
      ["Still broken.", "user", false],
      ["Looking.", "owner", false],
    ]);
  });

  await check("an Owner-only answer names Owners, never a manager", async () => {
    const user = await mint("Grace Hopper", "grace.words@example.com", [here]);
    const refused = await browse("GET", "/people", user.secret);
    assert.equal(refused.status, 403);
    assert.match(JSON.stringify(refused.json), /Owner/);
    assert.doesNotMatch(JSON.stringify(refused.json), /manager/);
  });
}

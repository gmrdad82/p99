import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pageSender, socketOf, stepCode } from "../us-codes-kit.mjs";

export default async function (kit) {
  const { check, call, browse, until, people } = kit;
  const port = Number(new URL(kit.base).port);
  const { app, tokenOf, signIn } = pageSender(port, kit.space.app);

  await check("us-relink-001 a relink closes the old codes board and page session and keeps the authenticator", async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `grace.relink.${tag}@example.com`;
    const made = await call("POST", "/_p99/v1/codes", {
      actor: people.ada,
      body: { name: "Grace Hopper", email, grant: { projects: ["Shop"] }, role: "owner", totp: true, mail: false },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const key = made.json.totp_key;

    const signed = await signIn(email, stepCode(kit, key, -1));
    assert.equal(signed.status, 200, signed.text);
    const token = tokenOf(signed);
    assert.equal((await app("GET", "/_p99/app/spaces", { token })).status, 200);

    const verified = await browse("POST", "/verify", made.json.secret, { totp: stepCode(kit, key) });
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    const device = verified.json.device;
    const old = `${made.json.secret}.${device}`;
    const filed = await browse("POST", "/issues", old, kit.issueBody({ title: `Filed before the relink ${tag}` }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const itemKey = filed.json.key;

    const ticket = await browse("POST", "/stream-ticket", old);
    assert.equal(ticket.status, 201, JSON.stringify(ticket.json));
    const board = await socketOf(`ws://127.0.0.1:${port}/_p99/api/stream?t=${ticket.json.ticket}`, []);
    assert.ok(board, "the board opens");

    const relinked = await call("POST", `/_p99/v1/codes/${made.json.code.id}/relink`, { actor: people.ada, body: {} });
    assert.equal(relinked.status, 201, JSON.stringify(relinked.json));
    assert.equal(relinked.json.revoked.id, made.json.code.id);
    assert.ok(relinked.json.revoked.revoked_at);
    assert.equal(relinked.json.totp, "carried");
    assert.equal(relinked.json.totp_key, undefined);
    assert.deepEqual(relinked.json.code.grant, { projects: ["Shop"] });
    assert.equal(relinked.json.code.role, "owner");
    const fresh = relinked.json.secret;
    assert.notEqual(fresh, made.json.secret);

    for (const [method, path, body] of [
      ["GET", "/me?path=%2F"],
      ["GET", "/issues?scope=mine"],
      ["GET", `/issues/${itemKey}`],
      ["POST", "/issues", kit.issueBody({ title: `Filed after the relink ${tag}` })],
      ["POST", `/issues/${itemKey}/comments`, { client_uid: randomUUID(), body: "Old link." }],
      ["POST", "/stream-ticket"],
    ]) {
      assert.equal((await browse(method, path, old, body)).status, 401, `${method} ${path}`);
      assert.equal((await browse(method, path, made.json.secret, body)).status, 401, `${method} ${path} without the device`);
    }
    await until("the old board to close", () => board.closed);
    assert.equal((await app("GET", "/_p99/app/spaces", { token })).status, 401, "the old code's page session closed");

    assert.equal((await browse("GET", "/me?path=%2F", fresh)).status, 428, "the new link asks for a code");
    assert.equal((await browse("GET", "/me?path=%2F", `${fresh}.${device}`)).status, 428, "the old browser's trust is gone");
    const again = await browse("POST", "/verify", fresh, { totp: stepCode(kit, key, 1) });
    assert.equal(again.status, 201, JSON.stringify(again.json));
    const mine = await browse("GET", "/issues?scope=mine", `${fresh}.${again.json.device}`);
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.ok(mine.json.issues.some((i) => i.key === itemKey), "the new code lists the same items");
    assert.equal((await call("POST", `/_p99/v1/codes/${made.json.code.id}/relink`, { actor: people.ada, body: {} })).status, 404);
  });
}

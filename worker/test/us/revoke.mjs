import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pageSender, socketOf, stepCode } from "../us-codes-kit.mjs";

export default async function (kit) {
  const { check, call, browse, until, people } = kit;
  const ada = people.ada;
  const port = Number(new URL(kit.base).port);
  const { app, tokenOf, signIn } = pageSender(port, kit.space.app);
  const shopHost = kit.space.projects.find((p) => p.name === "Shop").hosts[0];
  const blogHost = kit.space.projects.find((p) => p.name === "Blog").hosts[0];

  await check("us-revoke-001 a revoked code stops at once everywhere it was open", async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `grace.revoke.${tag}@example.com`;
    const mint = async (body) => {
      const made = await call("POST", "/_p99/v1/codes", { actor: ada, body: { name: "Grace Hopper", email, mail: false, ...body } });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      return made.json;
    };
    const first = await mint({ grant: { projects: ["Shop"] }, role: "owner", totp: true });
    const second = await mint({ grant: { projects: ["Blog"] }, role: "user" });

    const signed = await signIn(email, stepCode(kit, first.totp_key, -1));
    assert.equal(signed.status, 200, signed.text);
    const token = tokenOf(signed);
    const spaces = async () => (await app("GET", "/_p99/app/spaces", { token })).json?.spaces?.map((s) => s.host);
    assert.deepEqual(await spaces(), [shopHost, blogHost].sort());

    const verified = await browse("POST", "/verify", first.secret, { totp: stepCode(kit, first.totp_key) });
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    const open = `${first.secret}.${verified.json.device}`;
    const ticket = await browse("POST", "/stream-ticket", open);
    assert.equal(ticket.status, 201, JSON.stringify(ticket.json));
    const board = await socketOf(`${kit.origin().replace(/^http/, "ws")}/_p99/api/stream?t=${ticket.json.ticket}`, []);
    assert.ok(board, "the board opens");
    const filed = await browse("POST", "/issues", open, kit.issueBody({ title: `Filed before the revoke ${tag}` }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));

    assert.equal((await call("POST", `/_p99/v1/codes/${second.code.id}/revoke`, { actor: ada })).status, 200);
    assert.deepEqual(await spaces(), [shopHost], "the session loses only the revoked code's site");
    assert.equal((await app("GET", `/_p99/api/me?host=${blogHost}&path=%2F`, { token })).status, 404);
    assert.equal((await app("GET", `/_p99/api/me?host=${shopHost}&path=%2F`, { token })).status, 200);
    assert.equal(board.closed, false, "the other code's revoke left the board open");

    const revoked = await call("POST", `/_p99/v1/codes/${first.code.id}/revoke`, { actor: ada });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.ok(revoked.json.revoked_at);
    await until("the revoked board to close", () => board.closed);
    assert.equal((await app("GET", "/_p99/app/spaces", { token })).status, 401);
    for (const [method, path, body] of [
      ["GET", "/me?path=%2F"],
      ["GET", "/issues?scope=mine"],
      ["GET", `/issues/${filed.json.key}`],
      ["POST", "/issues", kit.issueBody({ title: `Filed after the revoke ${tag}` })],
      ["POST", "/stream-ticket"],
    ]) {
      assert.equal((await browse(method, path, open, body)).status, 401, `${method} ${path}`);
    }
    assert.equal((await call("POST", `/_p99/v1/codes/${first.code.id}/totp`, { actor: ada })).status, 404, "a revoked code gets no authenticator");
    assert.equal((await call("POST", `/_p99/v1/codes/${first.code.id}/relink`, { actor: ada, body: {} })).status, 404, "a revoked code cannot come back");
  });
}

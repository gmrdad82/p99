import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inviteJson, invitesJson } from "../../worker/test/us-codes-kit.mjs";

export default async function (kit) {
  const { check, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const host = shop.hosts[0];
  const address = () => `grace.${randomUUID().slice(0, 8)}@example.com`;
  const row = async (id) => (await invitesJson(kit)).codes.find((c) => c.id === id);
  const lineOf = (text, mark) => text.split("\n").find((l) => l.includes(mark));

  await check("us-revoke-001 the codes list names each codes role grant state and last use", async () => {
    const graceEmail = address();
    const maryEmail = address();
    const grace = await inviteJson(kit, "Grace Hopper", graceEmail, ["--project", shop.name]);
    const mary = await inviteJson(kit, "Mary Jackson", maryEmail, ["--owner", "--space"]);

    const human = (await kit.p99(["invites"])).stdout;
    const graceLine = lineOf(human, `<${graceEmail}>`);
    const maryLine = lineOf(human, `<${maryEmail}>`);
    assert.match(graceLine, new RegExp(`^\\s*${grace.code.id}  active  Grace Hopper <.+>  User  \\.\\.\\.${grace.code.hint}  .+  grant: projects: ${shop.name}  last used: never$`));
    assert.match(maryLine, new RegExp(`^\\s*${mary.code.id}  active  Mary Jackson <.+>  Owner  \\.\\.\\.${mary.code.hint}  .+  grant: the whole space  last used: never$`));

    const screen = await kit.tui("tab tab");
    const graceRow = lineOf(screen, `…${grace.code.hint}`);
    const maryRow = lineOf(screen, `…${mary.code.hint}`);
    assert.ok(graceRow && maryRow, screen);
    assert.match(graceRow, /Grace Hopper/);
    assert.match(graceRow, new RegExp(shop.name));
    assert.match(graceRow, /User/);
    assert.match(graceRow, /active/);
    assert.match(maryRow, /Whole space/);
    assert.match(maryRow, /Owner/);

    assert.equal((await kit.browse("GET", "/me?path=%2F", grace.secret, undefined, host)).status, 200);
    await kit.until("Grace's first use", async () => (await row(grace.code.id)).last_used_at);
    assert.doesNotMatch(lineOf((await kit.p99(["invites"])).stdout, `<${graceEmail}>`), /last used: never/);

    const revoked = await kit.p99(["revoke", String(grace.code.id)]);
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.equal(revoked.stdout, `revoked code ${grace.code.id} of Grace Hopper <${graceEmail}>\n`);
    assert.match(lineOf((await kit.p99(["invites"])).stdout, `<${graceEmail}>`), /^\s*\d+  revoked  Grace Hopper/);
    assert.match(lineOf(await kit.tui("tab tab"), `…${grace.code.hint}`), /revoked/);
    assert.match(lineOf((await kit.p99(["invites"])).stdout, `<${maryEmail}>`), /^\s*\d+  active  Mary Jackson/);
  });

  await check("us-revoke-001 a revoked code is deleted from the codes tab the same way", async () => {
    const email = address();
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name]);
    const id = made.code.id;
    const revoked = await kit.p99(["revoke", String(id)]);
    assert.equal(revoked.code, 0, revoked.stderr);

    const wrong = await kit.tui(`tab tab / ${email} enter d zzzz enter`);
    assert.ok(wrong.length > 0);
    assert.ok(await row(id), "four wrong characters keep the code");

    await kit.tui(`tab tab / ${email} enter d ${made.code.hint} enter`);
    assert.equal(await row(id), undefined, "the four characters typed back delete it");
    const worker = await kit.call("GET", "/_p99/v1/codes", { actor: ada });
    assert.equal(worker.json.codes.some((c) => c.id === id), false);
    assert.equal((await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host)).status, 401);
    const again = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name]);
    assert.notEqual(again.code.id, id, "the e-mail can be invited again");
  });

  await check("us-revoke-001 an active code is refused with revoke it first", async () => {
    const made = await inviteJson(kit, "Grace Hopper", address(), ["--project", shop.name]);
    const id = made.code.id;
    const refused = await kit.p99(["invites", "delete", String(id), "--yes"]);
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, "");
    assert.ok(refused.stderr.endsWith(`p99: code ${id} is active: revoke it first, p99 revoke ${id}\n`), refused.stderr);
    const direct = await kit.call("DELETE", `/_p99/v1/codes/${id}`, { actor: ada });
    assert.equal(direct.status, 409, JSON.stringify(direct.json));
    assert.match(direct.json.message, /revoke it first/);
    const kept = await row(id);
    assert.ok(kept, "the row stays");
    assert.equal(kept.revoked_at, null);
    assert.equal((await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host)).status, 200, "the code still works");
  });
}

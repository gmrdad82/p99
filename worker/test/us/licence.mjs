import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const ADAS_AGENT = { ...ADA, agent: true };
const PERSON_ONLY = "only an Owner, as a person, sets the licence";

async function code(kit, name, local, role) {
  const email = `${local}.${randomUUID().slice(0, 8)}@example.com`;
  const made = await kit.mint(name, email, { space: true }, role === "owner");
  assert.equal(typeof made.secret, "string");
  return made;
}

async function licenceOf(kit, secret) {
  const me = await kit.browse("GET", "/me", secret);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  return { license: me.json.license, licence: me.json.licence };
}

export default async function (kit) {
  await kit.check("us-licence-001 a lapsed key is refused for this build and says what it covers", async () => {
    const owner = await code(kit, "Ada Lovelace", "ada.lapsed", "owner");
    const before = await licenceOf(kit, owner.secret);
    const lapsed = await kit.browse("PUT", "/licence", owner.secret, {
      key: kit.licenceKey({ tier: "agency", paid_through: "2020-01-01" }),
    });
    assert.equal(lapsed.status, 400, JSON.stringify(lapsed.json));
    assert.match(lapsed.json.message, /covers builds up to 2020-01-01/);
    assert.match(lapsed.json.message, /this Worker is dated \d{4}-\d{2}-\d{2}/);
    assert.deepEqual(await licenceOf(kit, owner.secret), before);
  });

  await kit.check("us-licence-001 only an owner person sets or removes the licence", async () => {
    const owner = await code(kit, "Ada Lovelace", "ada.licence", "owner");
    const user = await code(kit, "Grace Hopper", "grace.licence", "user");
    const key = kit.licenceKey({ tier: "studio", paid_through: "2099-12-31" });
    const before = await licenceOf(kit, owner.secret);

    const agentPut = await kit.call("PUT", "/_p99/v1/licence", { actor: ADAS_AGENT, body: { key } });
    assert.equal(agentPut.status, 403, JSON.stringify(agentPut.json));
    assert.equal(agentPut.json.message, PERSON_ONLY);
    const agentDelete = await kit.call("DELETE", "/_p99/v1/licence", { actor: ADAS_AGENT });
    assert.equal(agentDelete.status, 403, JSON.stringify(agentDelete.json));
    assert.equal(agentDelete.json.message, PERSON_ONLY);

    const userPut = await kit.browse("PUT", "/licence", user.secret, { key });
    assert.equal(userPut.status, 403, JSON.stringify(userPut.json));
    assert.equal(userPut.json.message, PERSON_ONLY);
    const userDelete = await kit.browse("DELETE", "/licence", user.secret);
    assert.equal(userDelete.status, 403, JSON.stringify(userDelete.json));
    assert.equal(userDelete.json.message, PERSON_ONLY);

    assert.deepEqual(await licenceOf(kit, owner.secret), before);
    assert.deepEqual(await licenceOf(kit, user.secret), before);
  });
}

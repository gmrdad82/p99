import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export default async function (kit) {
  const { check, call, browse } = kit;
  const host = kit.space.projects[0].hosts[0];
  const tag = randomUUID().slice(0, 6);
  const ada = { email: `ada.replies.${tag}@example.com`, name: "Ada Lovelace", agent: false };
  const agent = { ...ada, agent: true, via: "pci·splicer·writer" };
  const grace = { email: `grace.replies.${tag}@example.com`, name: "Grace Hopper", agent: false };

  await check("us-follow-001 only another persons reply raises the blue count and reading the item clears it", async () => {
    const code = (await kit.mint(ada.name, ada.email, [host], true)).secret;
    const counts = async () => {
      const me = await browse("GET", `/me?path=${encodeURIComponent(`/replies/${tag}`)}`, code, undefined, host);
      assert.equal(me.status, 200, JSON.stringify(me.json));
      return me.json.counts;
    };
    const made = await call("POST", `/_p99/v1/cards?host=${host}`, { actor: ada, body: { client_uid: randomUUID(), project: kit.space.projects[0].name, title: `The export clip stutters ${tag}`, host } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const key = made.json.card.key;
    assert.equal((await counts()).replies, 0, "nothing to answer yet");

    const moved = await call("POST", `/_p99/v1/cards/${key}/status`, { actor: agent, body: { status: "in-progress" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const said = async (actor, body) => {
      const r = await call("POST", `/_p99/v1/issues/${key}/comments`, { actor, body: { client_uid: randomUUID(), body } });
      assert.equal(r.status, 201, JSON.stringify(r.json));
    };
    await said(agent, "Picked it up; the clip is re-encoding.");
    await said(ada, "Note to self: check the 4K export too.");
    assert.equal((await counts()).replies, 0, "her agent's move, her agent's comment and her own comment raise nothing");

    await said(grace, "Same here on the 1440p export.");
    assert.equal((await counts()).replies, 1, "another person's reply raises the count");

    const read = await browse("GET", `/issues/${key}`, code, undefined, host);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal((await counts()).replies, 0, "reading the item clears it");
  });
}

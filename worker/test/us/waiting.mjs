import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const grace = { email: "grace@example.com", name: "Grace Hopper", agent: true, via: "pci·splicer·writer" };

export default async function (kit) {
  const { check, call } = kit;
  const host = kit.space.projects[0].hosts[0];
  const tag = randomUUID().slice(0, 6);
  const project = `Waiting ${tag}`;

  const file = async (title) => {
    const made = await call("POST", `/_p99/v1/cards?host=${host}`, { actor: ada, body: { client_uid: randomUUID(), project, title, host } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.card.key;
  };
  const status = async (key, word, actor = ada, extra = {}) => {
    const moved = await call("POST", `/_p99/v1/cards/${key}/status`, { actor, body: { status: word, ...extra } });
    assert.equal(moved.status, 200, `${word}: ${JSON.stringify(moved.json)}`);
    return moved.json;
  };
  const lane = async (word) => {
    const got = await call("GET", `/_p99/v1/cards?project=${encodeURIComponent(project)}&status=${word}&limit=500`, { actor: ada });
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return got.json.cards.map((card) => card.key);
  };

  await check("us-waiting-001 adas comment sends the card back to the lane it came from", async () => {
    const older = await file(`Already in progress ${tag}`);
    await status(older, "in-progress");
    const key = await file(`Back to work ${tag}`);
    await status(key, "in-progress");
    await status(key, "needs-you", grace, { note: "Look at the export clip.", client_uid: randomUUID() });
    assert.deepEqual(await lane("needs-you"), [key]);
    assert.deepEqual(await lane("in-progress"), [older]);

    const said = await call("POST", `/_p99/v1/cards/${key}/comments`, { actor: ada, body: { client_uid: randomUUID(), body: "Clip looks right." } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    assert.equal(said.json.comment.body, "Clip looks right.");

    const card = await call("GET", `/_p99/v1/cards/${key}`, { actor: ada });
    assert.equal(card.json.card.status, "in-progress");
    assert.equal(card.json.card.label, "In progress");
    assert.deepEqual(await lane("in-progress"), [key, older]);
    assert.deepEqual(await lane("needs-you"), []);
    const thread = await call("GET", `/_p99/v1/issues/${key}`, { actor: ada });
    const moves = thread.json.events.filter((event) => event.kind === "label");
    assert.deepEqual(moves.at(-1).detail, { from: "Needs you", to: "In progress" });
    assert.equal(moves.at(-1).actor, "ada@example.com");
    assert.equal(moves.at(-1).agent, false);

    const waiting = await call("GET", `/_p99/v1/cards/waiting?host=${host}`, { actor: ada });
    assert.equal(waiting.status, 200, JSON.stringify(waiting.json));
    assert.ok(!waiting.json.cards.some((c) => c.key === key), "the answered card no longer waits");
  });
}

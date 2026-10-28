import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const adaBot = { email: "ada@example.com", name: "Ada Lovelace", agent: true, via: "pci" };

export async function spaceStories({ call, browse, check, issueBody, here, sent }) {
  const hosts = (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts;
  const shop = hosts.find((h) => h.host === here).project;

  await check("story spaces: Ada invites Grace to one project, Grace sees its board and nothing else, a park shuts her out with no mail, the space opens everything", async () => {
    const agentCard = await call("POST", "/_p99/v1/cards", { actor: adaBot, body: { client_uid: randomUUID(), project: shop, title: "The checkout needs a retry" } });
    assert.equal(agentCard.status, 201, JSON.stringify(agentCard.json));
    assert.equal(agentCard.json.card.host, null);
    const elsewhere = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project: "Story Elsewhere", title: "Somewhere Grace never looks" } });
    assert.equal(elsewhere.status, 201, JSON.stringify(elsewhere.json));

    const invite = await call("POST", "/_p99/v1/codes", { actor: ada, body: { name: "Grace Hopper", email: "grace.story@example.com", role: "owner", grant: { projects: [shop] } } });
    assert.equal(invite.status, 201, JSON.stringify(invite.json));
    assert.equal(invite.json.mail, "sent");
    assert.deepEqual(invite.json.links, [`https://${here}/#p99=${invite.json.secret}`]);
    const grace = invite.json.secret;

    const reported = await browse("POST", "/issues", grace, issueBody({ title: "Filed on the shop" }));
    assert.equal(reported.status, 201, JSON.stringify(reported.json));
    const space = (await browse("GET", "/space", grace)).json;
    assert.deepEqual(space.projects.map((p) => p.name), [shop]);
    const board = (await browse("GET", "/board", grace)).json.cards.map((cd) => cd.key);
    assert.ok(board.includes(agentCard.json.card.key) && board.includes(reported.json.key));
    assert.equal(board.includes(elsewhere.json.card.key), false);
    assert.equal((await browse("GET", `/cards/${elsewhere.json.card.key}`, grace)).status, 404);

    const quiet = sent.length;
    const parked = await call("PATCH", `/_p99/v1/codes/${invite.json.code.id}`, { actor: ada, body: { grant: { projects: [] } } });
    assert.equal(parked.status, 200, JSON.stringify(parked.json));
    assert.equal((await browse("GET", "/board", grace)).status, 403);
    assert.equal((await browse("GET", "/space", grace)).status, 403);

    const opened = await call("PATCH", `/_p99/v1/codes/${invite.json.code.id}`, { actor: ada, body: { grant: { space: true } } });
    assert.deepEqual(opened.json.code.grant, { space: true });
    const everything = (await browse("GET", "/board", grace)).json.cards.map((cd) => cd.key);
    assert.ok(everything.includes(elsewhere.json.card.key));
    assert.ok((await browse("GET", "/space", grace)).json.projects.some((p) => p.name === "Story Elsewhere"));
    assert.equal(sent.length, quiet, "parking or opening a grant mailed someone");
  });
}

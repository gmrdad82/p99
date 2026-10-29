import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pageSender, projectNamed, stepCode } from "../us-codes-kit.mjs";

export default async function (kit) {
  const { check, call, browse } = kit;
  const ada = kit.people.ada;
  const port = Number(new URL(kit.base).port);
  const { app, tokenOf, signIn } = pageSender(port, kit.space.app);
  const shop = projectNamed(kit, "Shop").hosts[0];
  const ops = projectNamed(kit, "Ops");
  assert.ok(ops && ops.hosts.length === 0, "the seeded space has Ops, a project with no host");

  const mint = async (tag, role, projects, totp = false) => {
    const email = `grace.board.${tag}.${randomUUID().slice(0, 6)}@example.com`;
    const made = await call("POST", "/_p99/v1/codes", { actor: ada, body: { name: "Grace Hopper", email, grant: { projects }, role, totp, mail: false } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return { ...made.json, email };
  };
  const cardBody = (title) => ({ client_uid: randomUUID(), project: "Ops", kind: "task", title, body: "Rotate the backup key." });

  await check("us-board-002 an owner files a card with no host from the p99 page", async () => {
    const tag = randomUUID().slice(0, 8);
    const grace = await mint("page", "owner", ["Shop", "Ops"], true);
    const signed = await signIn(grace.email, stepCode(kit, grace.totp_key));
    assert.equal(signed.status, 200, signed.text);
    const token = tokenOf(signed);
    const body = cardBody(`Rotate the key ${tag}`);
    const filed = await app("POST", "/_p99/api/cards", { token, body });
    assert.equal(filed.status, 201, filed.text);
    const card = filed.json.card;
    assert.deepEqual([card.project, card.host, card.status, card.kind, card.title], ["Ops", null, "new", "task", body.title]);
    assert.equal(card.reporter.name, "Grace Hopper");
    assert.equal(card.reporter.agent, false);
    const again = await app("POST", "/_p99/api/cards", { token, body });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.card.key, card.key, "the same client_uid files the card once");
    const board = await app("GET", "/_p99/api/board", { token });
    assert.equal(board.status, 200, board.text);
    const shown = board.json.cards.find((c) => c.key === card.key);
    assert.ok(shown, "the card shows on the board");
    assert.equal(shown.host ?? null, null);
    const thread = await call("GET", `/_p99/v1/issues/${card.key}`, { actor: ada });
    assert.equal(thread.status, 200, JSON.stringify(thread.json));
    assert.deepEqual([thread.json.issue.host, thread.json.issue.page.path], [null, ""]);
  });

  await check("us-board-002 a card from a sites panel into a project without that site has no host", async () => {
    const tag = randomUUID().slice(0, 8);
    const grace = await mint("panel", "owner", ["Shop", "Ops"]);
    const away = await browse("POST", "/cards", grace.secret, cardBody(`Renew the certificate ${tag}`), shop);
    assert.equal(away.status, 201, JSON.stringify(away.json));
    assert.deepEqual([away.json.card.project, away.json.card.host], ["Ops", null]);
    const home = await browse("POST", "/cards", grace.secret, { ...cardBody(`Check the cart ${tag}`), project: "Shop" }, shop);
    assert.equal(home.status, 201, JSON.stringify(home.json));
    assert.deepEqual([home.json.card.project, home.json.card.host], ["Shop", shop]);
  });

  await check("us-board-002 a user or an owner outside the project files no card there", async () => {
    const tag = randomUUID().slice(0, 8);
    const before = await call("GET", "/_p99/v1/cards?project=Ops&limit=500", { actor: ada });
    assert.equal(before.status, 200, JSON.stringify(before.json));
    const user = await mint("user", "user", ["Shop", "Ops"]);
    const asUser = await browse("POST", "/cards", user.secret, cardBody(`A user's card ${tag}`), shop);
    assert.equal(asUser.status, 403, JSON.stringify(asUser.json));
    const outside = await mint("outside", "owner", ["Shop"]);
    const asOutsider = await browse("POST", "/cards", outside.secret, cardBody(`An outsider's card ${tag}`), shop);
    assert.deepEqual([asOutsider.status, asOutsider.json.message], [404, "no project is called Ops"]);
    const after = await call("GET", "/_p99/v1/cards?project=Ops&limit=500", { actor: ada });
    assert.deepEqual(
      after.json.cards.map((c) => c.key),
      before.json.cards.map((c) => c.key),
      "nothing was filed in Ops",
    );
  });
}

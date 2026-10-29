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
    const intoShop = await app("POST", "/_p99/api/cards?host=*", { token, body: { ...cardBody(`Audit the cart ${tag}`), project: "Shop" } });
    assert.equal(intoShop.status, 201, intoShop.text);
    assert.deepEqual([intoShop.json.card.project, intoShop.json.card.host], ["Shop", null], "a card from the page names no host, even in a project with a site");
  });

  await check("us-board-002 an owner edits and merges a card with no host from the p99 page", async () => {
    const tag = randomUUID().slice(0, 8);
    const grace = await mint("edit", "owner", ["Ops"], true);
    const token = tokenOf(await signIn(grace.email, stepCode(kit, grace.totp_key)));
    const file = async (title) => {
      const made = await app("POST", "/_p99/api/cards", { token, body: cardBody(title) });
      assert.equal(made.status, 201, made.text);
      return made.json.card.key;
    };
    const target = await file(`Rotate the key ${tag}`);
    const twin = await file(`Rotate the key again ${tag}`);
    const edited = await app("PATCH", `/_p99/api/issues/${target}`, { token, body: { title: `Rotate the backup key ${tag}`, body: "Every 90 days." } });
    assert.equal(edited.status, 200, edited.text);
    const read = await call("GET", `/_p99/v1/issues/${target}`, { actor: ada });
    assert.deepEqual([read.json.issue.title, read.json.issue.body], [`Rotate the backup key ${tag}`, "Every 90 days."]);
    const merged = await app("POST", "/_p99/api/merge", { token, body: { items: [twin], into: target } });
    assert.equal(merged.status, 200, merged.text);
    assert.deepEqual(merged.json.merged, [twin]);
    const folded = (await call("GET", `/_p99/v1/issues/${twin}`, { actor: ada })).json.issue;
    assert.deepEqual([folded.resolution, folded.duplicate_of], ["duplicate", target]);
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

  await check("us-board-002 a card filed with a host and a page is on that page", async () => {
    const tag = randomUUID().slice(0, 8);
    const page = { url: `https://${shop}/cart?coupon=SPRING#total`, path: "/cart?coupon=SPRING#total", title: "Cart" };
    const made = await call("POST", "/_p99/v1/cards", { actor: ada, body: { ...cardBody(`The total is off ${tag}`), project: "Shop", host: shop, page } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.card.project, made.json.card.host], ["Shop", shop]);
    const stored = await call("GET", `/_p99/v1/issues/${made.json.card.key}`, { actor: ada });
    assert.deepEqual(stored.json.issue.page, { url: `https://${shop}/cart`, path: "/cart", title: "Cart" });
    const bare = await call("POST", "/_p99/v1/cards", { actor: ada, body: { ...cardBody(`No page at all ${tag}`), project: "Shop", host: shop, page: { url: "", path: "", title: "" } } });
    assert.equal(bare.status, 201, JSON.stringify(bare.json));
    const none = await call("GET", `/_p99/v1/issues/${bare.json.card.key}`, { actor: ada });
    assert.deepEqual([none.json.issue.page.url, none.json.issue.page.path], [`https://${shop}/`, ""]);
  });

  await check("us-board-002 a page without a host or a malformed page is refused and nothing is filed", async () => {
    const tag = randomUUID().slice(0, 8);
    const before = await call("GET", "/_p99/v1/cards?limit=500&status=new", { actor: ada });
    const page = { url: "https://example.com/cart", path: "/cart", title: "Cart" };
    const hostless = await call("POST", "/_p99/v1/cards", { actor: ada, body: { ...cardBody(`Hostless with a page ${tag}`), page } });
    assert.deepEqual([hostless.status, hostless.json.message], [400, "a page needs a host; name the card's host or leave the page out"]);
    for (const bad of [{ ...page, path: "cart" }, { ...page, path: "//evil.example.com/" }, { ...page, url: "ftp://example.com/" }, { ...page, path: "/a b" }, "/cart"]) {
      const refused = await call("POST", "/_p99/v1/cards", { actor: ada, body: { ...cardBody(`Malformed page ${tag}`), project: "Shop", host: shop, page: bad } });
      assert.deepEqual([refused.status, refused.json.message], [400, "page must have an http(s) url, a path starting with / and a title"], JSON.stringify(bad));
    }
    const grace = await mint("pageless", "owner", ["Shop", "Ops"]);
    const fromPanel = await browse("POST", "/cards", grace.secret, { ...cardBody(`Ops with a page ${tag}`), page }, shop);
    assert.deepEqual([fromPanel.status, fromPanel.json.message], [400, "a page needs a host; name the card's host or leave the page out"]);
    const after = await call("GET", "/_p99/v1/cards?limit=500&status=new", { actor: ada });
    assert.equal(after.json.cards.filter((c) => c.title.endsWith(tag)).length, 0);
    assert.ok(before.status === 200 && after.status === 200);
  });
}

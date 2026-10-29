import assert from "node:assert/strict";
import { fileAs, mailsFor, move, places, releaseEnv, reply, reporter, ship, tag, uniqueTitle } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);

  await kit.check("us-mail-001 opting out stops mail for that item only", async () => {
    const grace = await reporter(kit, shop, "Grace Hopper");
    const first = await fileAs(kit, grace, uniqueTitle("The total is off"));
    const second = await fileAs(kit, grace, uniqueTitle("The cart is empty"));
    await reply(kit, first.key, shop, "Looking into it.");
    const [heard] = await kit.until("the first reply's mail", async () => {
      const got = await mailsFor(kit, grace.email, `[${first.key}]`);
      return got.length === 1 && got;
    });
    const link = /https?:\/\/\S*\/_p99\/mail\?t=(\S+)/.exec(heard.text);
    assert.ok(link, heard.text);
    const off = await fetch(`${kit.origin(shop)}/_p99/mail?t=${link[1]}`);
    assert.equal(off.status, 200);
    const page = await off.text();
    assert.match(page, /No more mail about/);
    assert.match(page, /Other cards still mail you as before\./);
    await reply(kit, first.key, shop, "Still looking.");
    await reply(kit, second.key, shop, "Fixed on our side.");
    await kit.until("the other item's mail", async () => (await mailsFor(kit, grace.email, `[${second.key}]`)).length === 1);
    assert.equal((await mailsFor(kit, grace.email, `[${first.key}]`)).length, 1);
  });

  await kit.check("us-mail-001 closing reopening and a shipped fix mail her and other moves do not", async () => {
    await releaseEnv(kit, "production", true);
    const grace = await reporter(kit, shop, "Grace Hopper");
    const filed = await fileAs(kit, grace, uniqueTitle("The receipt is blank"));
    const key = filed.key;
    assert.equal((await move(kit, shop, { key, from: "New", to: "planned" })).status, 200);
    assert.equal((await move(kit, shop, { key, from: "Planned", to: "in-progress" })).status, 200);
    assert.equal((await move(kit, shop, { key, from: "In progress", to: "landed" })).status, 200);
    const closed = await move(kit, shop, { key, from: "Landed", to: "Done" });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    await kit.until("the closing mail", async () => (await mailsFor(kit, grace.email, `[${key}] Fixed:`)).length === 1);
    assert.equal((await mailsFor(kit, grace.email, `[${key}]`)).length, 1, "the quiet moves mailed no one");
    const reopened = await move(kit, shop, { key, from: "Done", to: "planned" });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
    await kit.until("the reopening mail", async () => (await mailsFor(kit, grace.email, `[${key}] Received:`)).length === 1);
    await ship(kit, key, { version: `v${tag()}` });
    const [landed] = await kit.until("the shipped mail", async () => {
      const got = await mailsFor(kit, grace.email, `[${key}] Fixed and shipped to production`);
      return got.length === 1 && got;
    });
    assert.match(landed.text, /production/);
    assert.equal((await mailsFor(kit, grace.email, `[${key}]`)).length, 3);
  });

  await kit.check("us-mail-001 a new item mails only the owners who reach its project", async () => {
    const mark = tag();
    const maryEmail = `mary.${mark}@example.com`;
    const adaEmail = `ada.${mark}@example.com`;
    const mary = await kit.mint("Mary Jackson", maryEmail, [shop], true);
    assert.ok(mary.secret, "Mary holds a code for Shop alone");
    const wide = await kit.call("POST", "/_p99/v1/codes", {
      body: { name: "Ada Lovelace", email: adaEmail, grant: { space: true }, role: "owner", mail: false },
    });
    assert.equal(wide.status, 201, JSON.stringify(wide.json));
    const grace = await reporter(kit, shop, "Grace Hopper", mark);
    const onShop = await fileAs(kit, grace, uniqueTitle("Checkout hangs"));
    const onBlog = await fileAs(kit, { ...grace, host: blog, secret: (await kit.mint("Grace Hopper", grace.email, [blog])).secret }, uniqueTitle("Feed is empty"));
    assert.equal(onShop.host, shop);
    assert.equal(onBlog.host, blog);
    await kit.until("Ada's two mails", async () => (await mailsFor(kit, adaEmail, "[")).length >= 2);
    await kit.until("Mary's mail", async () => (await mailsFor(kit, maryEmail, `[${onShop.key}]`)).length === 1);
    assert.equal((await mailsFor(kit, adaEmail, `[${onBlog.key}]`)).length, 1);
    assert.equal((await mailsFor(kit, maryEmail, `[${onBlog.key}]`)).length, 0);
    const seen = await kit.browse("GET", `/issues/${onBlog.key}`, mary.secret, undefined, shop);
    assert.ok([403, 404].includes(seen.status), "Mary cannot read the Blog report either");
  });
}

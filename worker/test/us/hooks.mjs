import assert from "node:assert/strict";
import { SLACK, fileAs, hook, places, posts, reply, reporter, until, uniqueTitle } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);
  const drop = (host) => kit.call("DELETE", `/_p99/v1/hooks/${host}`);

  await kit.check("us-hooks-001 an internal note never posts to the channel", async () => {
    await hook(kit, shop);
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const filed = await fileAs(kit, grace, uniqueTitle("The cart forgets a gift note"));
      await until("the new-item post", async () => (await posts(kit, filed.key)).length === 1);
      const note = await reply(kit, filed.key, shop, "Internal: check the cart service.", undefined, { internal: true });
      assert.ok(note.id, "the note is saved");
      await reply(kit, filed.key, shop, "We are on it.");
      await until("the comment post", async () => JSON.stringify(await posts(kit, filed.key)).includes("Comment by Ada Lovelace"));
      const sent = await posts(kit, filed.key);
      assert.equal(sent.length, 2, JSON.stringify(sent));
      assert.equal(JSON.stringify(sent).includes("check the cart service"), false);
    } finally {
      await drop(shop);
    }
  });

  await kit.check("us-hooks-001 a failing hook never fails a write", async () => {
    await hook(kit, shop);
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const filed = await fileAs(kit, grace, uniqueTitle("The hook is down"));
      await until("the post that failed", async () => (await posts(kit, filed.key)).length === 1);
      const last = await until("the hook's last answer", async () => {
        const listed = await kit.call("GET", `/_p99/v1/hooks?host=${shop}`);
        return listed.json.hooks[0]?.last_status ? listed.json.hooks[0] : null;
      });
      assert.notEqual(last.last_status, "ok", "the kit's hook stub must answer with an error");
      assert.equal((await kit.call("GET", `/_p99/v1/issues/${filed.key}?host=${shop}`)).status, 200);
    } finally {
      await drop(shop);
    }
  });

  await kit.check("us-hooks-001 an item posts only to the hooks of its own host", async () => {
    const blogUrl = "https://hooks.slack.com/services/T0002/B0003/zzzzyyyyxxxxQQQQ";
    await hook(kit, shop, SLACK);
    await hook(kit, blog, blogUrl);
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const mary = await reporter(kit, blog, "Mary Jackson");
      const onShop = await fileAs(kit, grace, uniqueTitle("Shop total is off"));
      const onBlog = await fileAs(kit, mary, uniqueTitle("Blog feed is empty"));
      const shopPosts = await until("Shop's post", async () => {
        const got = await posts(kit, onShop.key);
        return got.length === 1 && got;
      });
      const blogPosts = await until("Blog's post", async () => {
        const got = await posts(kit, onBlog.key);
        return got.length === 1 && got;
      });
      assert.ok(JSON.stringify(shopPosts).includes("aaaabbbbccccWXYZ"), "Shop's item went to Shop's channel");
      assert.equal(JSON.stringify(shopPosts).includes("zzzzyyyyxxxxQQQQ"), false);
      assert.ok(JSON.stringify(blogPosts).includes("zzzzyyyyxxxxQQQQ"), "Blog's item went to Blog's channel");
      assert.equal(JSON.stringify(blogPosts).includes("aaaabbbbccccWXYZ"), false);
    } finally {
      await drop(shop);
      await drop(blog);
    }
  });
}

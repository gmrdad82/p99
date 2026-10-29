import assert from "node:assert/strict";
import { feedOf, fileAs, places, releaseEnv, reporter, setFeed, ship, tag, uniqueTitle } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);

  await kit.check("us-feed-001 a feed lists only the fixes of its own host", async () => {
    await releaseEnv(kit, "production", false);
    const ada = await reporter(kit, shop, "Ada Lovelace");
    const grace = await reporter(kit, blog, "Grace Hopper");
    const onShop = await fileAs(kit, ada, uniqueTitle("Shop total is off"));
    const onBlog = await fileAs(kit, grace, uniqueTitle("Blog feed is empty"));
    await ship(kit, [onShop.key, onBlog.key], { version: `v${tag()}` });
    await setFeed(kit, shop, true);
    try {
      const atom = await feedOf(kit, shop);
      assert.equal(atom.status, 200);
      const text = await atom.text();
      assert.ok(text.includes(onShop.key), text);
      assert.equal(text.includes(onBlog.key), false, "Blog's fix is not in Shop's feed");
      const json = await (await feedOf(kit, shop, "?format=json")).json();
      assert.ok(json.items.some((i) => i.id === onShop.key));
      assert.equal(json.items.some((i) => i.id === onBlog.key), false);
      assert.equal((await feedOf(kit, blog)).status, 404, "Blog has no feed until Ada turns it on");
    } finally {
      await setFeed(kit, shop, false);
    }
  });
}

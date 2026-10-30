import assert from "node:assert/strict";
import { fileAs, places, reporter, tag, thread, uniqueTitle } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);

  await kit.check("us-merge-001 a merge from a project out of reach is refused", async () => {
    const mark = tag();
    const mary = await kit.mint("Mary Jackson", `mary.${mark}@example.com`, [shop], true);
    const grace = await reporter(kit, shop, "Grace Hopper", mark);
    const lin = await reporter(kit, blog, "Lin Chen", mark);
    const onShop = await fileAs(kit, grace, uniqueTitle("Checkout freezes"));
    const onBlog = await fileAs(kit, lin, uniqueTitle("The feed hangs"));
    const intoShop = await kit.browse("POST", "/merge", mary.secret, { items: [onBlog.key], into: onShop.key }, shop);
    assert.equal(intoShop.status, 404, JSON.stringify(intoShop.json));
    const fromShop = await kit.browse("POST", "/merge", mary.secret, { items: [onShop.key], into: onBlog.key }, shop);
    assert.equal(fromShop.status, 404, JSON.stringify(fromShop.json));
    assert.equal((await thread(kit, onBlog.key, blog)).issue.duplicate_of, null);
    assert.equal((await thread(kit, onShop.key, shop)).issue.duplicate_of, null);
  });
}

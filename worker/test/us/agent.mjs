import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ada, adaBot, fileAs, places, reporter, thread, ticketHeard, uniqueTitle, tag } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog, shopProject } = places(kit);

  await kit.check("us-agent-001 an agent cannot close a card as done", async () => {
    const made = await kit.call("POST", "/_p99/v1/cards", {
      actor: ada,
      body: { client_uid: randomUUID(), project: shopProject, title: uniqueTitle("Export keeps every audio track"), host: shop },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const key = made.json.card.key;
    const closing = await kit.call("POST", `/_p99/v1/cards/${key}/status`, { actor: adaBot, body: { status: "done" } });
    assert.equal(closing.status, 403, JSON.stringify(closing.json));
    assert.equal(closing.json.message, "only a person closes a card");
    const patched = await kit.call("PATCH", `/_p99/v1/issues/${key}`, { actor: adaBot, body: { status: "done" } });
    assert.equal(patched.status, 403, JSON.stringify(patched.json));
    const stored = (await thread(kit, key, shop)).issue;
    assert.equal(stored.closed_at, null);
    assert.equal(stored.resolution, null);
  });

  await kit.check("us-agent-002 a one projects owner stream hears nothing of another project", async () => {
    const mark = tag();
    const mary = await kit.mint("Mary Jackson", `mary.${mark}@example.com`, [shop], true);
    const grace = await reporter(kit, shop, "Grace Hopper", mark);
    const lin = await reporter(kit, blog, "Lin Chen", mark);
    const heard = [];
    const socket = await ticketHeard(kit, shop, mary.secret, heard);
    try {
      const onBlog = await fileAs(kit, lin, uniqueTitle("The feed hangs"));
      const onShop = await fileAs(kit, grace, uniqueTitle("Checkout freezes"));
      await kit.until("Shop's event", async () => heard.some((e) => e.key === onShop.key));
      assert.ok(heard.some((e) => e.key === onShop.key && e.type === "item"));
      assert.equal(heard.some((e) => e.key === onBlog.key), false, JSON.stringify(heard));
      assert.equal(heard.some((e) => e.host === blog), false);
    } finally {
      socket.close();
    }
  });
}

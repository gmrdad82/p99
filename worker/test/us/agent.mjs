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

  await kit.check("us-agent-001 an agent links moves and answers a card filed on a site", async () => {
    const grace = await reporter(kit, shop, "Grace Hopper");
    const filed = await fileAs(kit, grace, uniqueTitle("The basket forgets its coupon"));
    const key = filed.key;
    const linked = await kit.call("POST", `/_p99/v1/cards/${key}/links`, { actor: adaBot, body: { ref: "pci#4410", note: "the coupon fix" } });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.deepEqual([linked.json.key, linked.json.link.ref, linked.json.link.by.agent], [key, "pci#4410", true]);
    const asked = await kit.call("POST", `/_p99/v1/cards/${key}/status`, {
      actor: adaBot,
      body: { status: "needs-you", note: "Which coupon was it?", client_uid: randomUUID() },
    });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.card.status, asked.json.card.project, asked.json.card.host], ["needs-you", shopProject, shop]);
    const said = await kit.call("POST", `/_p99/v1/cards/${key}/comments`, { actor: adaBot, body: { client_uid: randomUUID(), body: "Found it in the log." } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    const read = await kit.call("GET", `/_p99/v1/cards/${key}`, { actor: ada });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.deepEqual(read.json.card.links.map((l) => l.ref), ["pci#4410"]);
    const stored = await thread(kit, key, shop);
    assert.deepEqual(stored.comments.map((c) => c.body), ["Which coupon was it?", "Found it in the log."]);
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

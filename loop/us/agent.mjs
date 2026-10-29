import assert from "node:assert/strict";
import { fileAs, hear, jsonOut, places, reporter, tag, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog, shopProject } = places(kit);
  const robot = (...args) => kit.p99(["--agent=writer", ...args]);
  const newCard = async (title) => jsonOut(await robot("card", "new", "--project", shopProject, "--title", uniqueTitle(title), "--json")).card.key;

  await kit.check("us-agent-001 an agent closes a card as abandoned or duplicate and its history shows the robot", async () => {
    const dropped = await newCard("Dropped by an agent");
    const folded = await newCard("Folded into another card");
    const story = await newCard("The story card");
    const abandon = await robot("status", dropped, "abandoned");
    assert.equal(abandon.code, 0, abandon.stderr);
    const duplicate = await robot("status", folded, "duplicate", "--duplicate-of", story);
    assert.equal(duplicate.code, 0, duplicate.stderr);
    for (const key of [dropped, folded]) {
      const shown = await kit.p99(["show", key]);
      assert.equal(shown.code, 0, shown.stderr);
      const events = shown.stdout.slice(shown.stdout.indexOf("events"));
      assert.ok(events.includes("🤖") && events.includes("(writer)"), events);
    }
    assert.match((await kit.p99(["show", dropped])).stdout, /dropped/i);
    assert.ok((await kit.p99(["show", folded])).stdout.includes(`merged into ${story}`));
  });

  await kit.check("us-agent-001 an agent sets needs you and the card tops the lane", async () => {
    const older = await newCard("Waiting on a spec");
    const newer = await newCard("Waiting on a key");
    const note = `Needs the export spec ${tag()}`;
    const first = jsonOut(await robot("card", "status", older, "needs-you", "--note", "Older note", "--json"));
    assert.equal(first.card.status, "needs-you");
    const second = jsonOut(await robot("card", "status", newer, "needs-you", "--note", note, "--json"));
    assert.equal(second.comment.body, note);
    assert.equal(second.comment.author.agent, true);
    const lane = jsonOut(await kit.p99(["cards", "--status", "needs-you", "--project", shopProject, "--json"]));
    const keys = lane.cards.map((c) => c.key);
    assert.ok(keys.indexOf(newer) >= 0 && keys.indexOf(newer) < keys.indexOf(older), JSON.stringify(keys));
    const thread = jsonOut(await kit.p99(["card", "show", newer, "--json"]));
    assert.ok(thread.comments.some((c) => c.body === note && c.author.agent === true));
  });

  await kit.check("us-agent-002 graces report reaches a running watch json as one line", async () => {
    const all = await kit.watch();
    const onShop = await kit.watch({ host: shop });
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const title = uniqueTitle("Pay stays grey");
      const page = await kit.page();
      await page.goto(`${kit.siteUrl(shop, "/")}#p99=${grace.secret}`);
      await page.locator("p99-root >> .w .f").click();
      const panel = "p99-root >> .p99-panel.is-open";
      await page.locator(`${panel} .p99-new input[name=title]`).fill(title);
      await page.locator(`${panel} .p99-new .p99-actions button[type=submit]`).click();
      await page.locator(`${panel} [data-view=item]`).waitFor({ timeout: 30000 });

      const { event } = await hear(all, (e) => e.type === "item" && e.title === title);
      assert.equal(event.host, shop);
      assert.equal(event.by.name, "Grace Hopper");
      assert.equal(event.by.agent, false);
      const heardOnShop = await hear(onShop, (e) => e.key === event.key);
      assert.equal(heardOnShop.event.host, shop);

      const comment = await robot("comment", event.key, "On it.", "--host", shop);
      assert.equal(comment.code, 0, comment.stderr);
      const said = await hear(all, (e) => e.type === "comment" && e.key === event.key);
      assert.equal(said.event.by.agent, true);
      assert.equal(said.event.by.via, "writer");

      const elsewhere = await reporter(kit, blog, "Lin Chen");
      const onBlog = await fileAs(kit, elsewhere, uniqueTitle("The feed hangs"));
      const later = await fileAs(kit, grace, uniqueTitle("Shop again"));
      const heardAll = await hear(all, (e) => e.key === onBlog.key);
      assert.equal(heardAll.event.host, blog);
      const scoped = await hear(onShop, (e) => e.key === later.key);
      assert.equal(scoped.seen.some((e) => e.key === onBlog.key || e.host === blog), false, JSON.stringify(scoped.seen));
    } finally {
      await all.stop();
      await onShop.stop();
    }
  });

  await kit.red("us-agent-002 each watch event names its project and space", "watch events carry no project or space name yet", async () => {
    const watching = await kit.watch();
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const filed = await fileAs(kit, grace, uniqueTitle("Named on the wire"));
      const { event } = await hear(watching, (e) => e.key === filed.key);
      assert.equal(event.project, shopProject);
      assert.equal(event.space, kit.space.slug);
    } finally {
      await watching.stop();
    }
  });
}

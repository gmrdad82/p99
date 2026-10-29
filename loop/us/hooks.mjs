import assert from "node:assert/strict";
import { SLACK, environments, fileAs, jsonOut, places, posts, reply, reporter, move, ship, tag, until, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);

  await kit.check("us-hooks-001 a new item a comment a move and a shipped fix post to the channel", async () => {
    await environments(kit);
    const set = await kit.p99(["hooks", "set", shop, "--slack", SLACK]);
    assert.equal(set.code, 0, set.stderr);
    assert.equal(set.stdout.includes("T0001/B0002"), false, "the webhook URL is never answered back");
    try {
      const grace = await reporter(kit, shop, "Grace Hopper");
      const filed = await fileAs(kit, grace, uniqueTitle("The total does not update"));
      const key = filed.key;
      await until("the new-item post", async () => (await posts(kit, key)).length === 1);
      await reply(kit, key, shop, "We are on it.");
      await until("the comment post", async () => (await posts(kit, key)).length === 2);
      assert.equal((await move(kit, shop, { key, from: "New", to: "planned" })).status, 200);
      assert.equal((await move(kit, shop, { key, from: "Planned", to: "Done" })).status, 200);
      await until("the move post", async () => (await posts(kit, key)).length === 3);
      await ship(kit, key, { version: `v${tag()}` });
      await until("the shipped post", async () => (await posts(kit, key)).length === 4);
      const said = (await posts(kit, key)).map((p) => JSON.stringify(p));
      assert.ok(said[0].includes("New, by Grace Hopper"), said[0]);
      assert.equal(said[0].includes("🤖"), false);
      assert.equal(said[0].includes(grace.email), false);
      assert.ok(said[1].includes("Comment by Ada Lovelace"), said[1]);
      assert.ok(said[2].includes("Moved to Done"), said[2]);
      assert.ok(said[3].includes("Shipped to production"), said[3]);

      const robot = await kit.p99(["--agent=writer", "file", shop, "--kind", "bug", "--title", uniqueTitle("Filed by an agent"), "--json"]);
      const agentKey = jsonOut(robot).issue.key;
      await until("the agent's post", async () => (await posts(kit, agentKey)).length === 1);
      assert.ok(JSON.stringify(await posts(kit, agentKey)).includes("🤖"));
    } finally {
      await kit.p99(["hooks", "remove", shop]);
    }
  });

  await kit.check("us-hooks-001 a url that is not slack or discord is refused", async () => {
    const refused = await kit.p99(["hooks", "set", blog, "--slack", "https://example.com/services/T1/B1/abc"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^p99: /);
    const wrong = await kit.p99(["hooks", "set", blog, "--slack", "https://discord.com/api/webhooks/1/abcdef"]);
    assert.equal(wrong.code, 1);
    assert.ok(wrong.stderr.includes("discord"), wrong.stderr);
    const listed = jsonOut(await kit.p99(["hooks", "--host", blog, "--json"]));
    assert.deepEqual(listed.hooks, []);
  });
}

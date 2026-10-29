import assert from "node:assert/strict";
import { browseOn, environments, fileAs, mailsFor, move, places, reply, reporter, ship, tag, until, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { shop } = places(kit);

  await kit.check("us-merge-001 merged reporters follow the target and hear its fix by mail", async () => {
    await environments(kit);
    const ann = await reporter(kit, shop, "Ann Smith");
    const lin = await reporter(kit, shop, "Lin Chen");
    const target = await fileAs(kit, ann, uniqueTitle("Checkout freezes"), { body: "Ann's private steps" });
    const source = await fileAs(kit, lin, uniqueTitle("Checkout hangs"));
    const merged = await kit.p99(["merge", source.key, "--into", target.key, "--host", shop]);
    assert.equal(merged.code, 0, merged.stderr);
    assert.equal(merged.stdout, `${source.key} merged into ${target.key}\n`);
    const again = await kit.p99(["merge", source.key, "--into", target.key, "--host", shop]);
    assert.equal(again.code, 0, again.stderr);
    assert.ok(again.stdout.includes(`${source.key} already in ${target.key}`), again.stdout);

    await reply(kit, target.key, shop, "Internal: the payment provider times out.", undefined, { internal: true });
    await reply(kit, target.key, shop, "Fixed on our side soon.");
    const seen = await browseOn(kit, shop, "GET", `/issues/${target.key}`, lin.secret);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    assert.equal(seen.json.comments.some((c) => c.internal || c.body.includes("payment provider")), false);
    assert.ok(seen.json.comments.some((c) => c.body === "Fixed on our side soon."));
    assert.equal(seen.json.issue.body, "", "Lin never reads Ann's private steps");

    await until("Lin's reply mail", async () => (await mailsFor(kit, lin.email, `[${target.key}] New reply`)).length === 1);
    assert.equal((await move(kit, shop, { key: target.key, from: "New", to: "Done" })).status, 200);
    await until("Lin's closing mail", async () => (await mailsFor(kit, lin.email, `[${target.key}] Fixed:`)).length === 1);
    await ship(kit, target.key, { version: `v${tag()}` });
    await until("Lin's landing mail", async () => (await mailsFor(kit, lin.email, `[${target.key}] Fixed and shipped`)).length === 1);
    assert.equal((await mailsFor(kit, lin.email, `[${target.key}]`)).length, 3);
  });
}

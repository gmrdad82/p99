import assert from "node:assert/strict";
import { environments, feedOf, fileAs, gitRepo, places, reporter, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { blog } = places(kit);

  await kit.check("us-feed-001 an announced fix shows in the feed with no private field", async () => {
    await environments(kit);
    const lin = await reporter(kit, blog, "Lin Chen");
    const title = uniqueTitle("The feed hangs");
    const filed = await fileAs(kit, lin, title, { body: "Lin's private steps: open the secret page" });
    const repo = gitRepo([`Fix the feed\n\nFixes: ${filed.key}`]);
    try {
      const on = await kit.p99(["feed", "on", blog]);
      assert.equal(on.code, 0, on.stderr);
      assert.ok(on.stdout.includes(`${blog}'s feed is on`), on.stdout);
      const announced = await kit.p99(["announce", "--env", "production", "--branch", "main", "--version", "v2.0.0"], { env: repo.env });
      assert.equal(announced.code, 0, announced.stderr);
      const atom = await feedOf(kit, blog);
      assert.equal(atom.status, 200);
      assert.match(atom.headers.get("content-type"), /^application\/atom\+xml/);
      const text = await atom.text();
      assert.ok(text.includes(filed.key) && text.includes(title), text);
      const jf = await feedOf(kit, blog, "?format=json");
      assert.equal(jf.status, 200);
      const body = await jf.json();
      const item = body.items.find((i) => i.id === filed.key);
      assert.ok(item, JSON.stringify(body));
      assert.deepEqual(Object.keys(item).sort(), ["content_text", "date_published", "id", "tags", "title"]);
      const sha = repo.head();
      assert.match(sha, /^[0-9a-f]{40}$/, "the fix's commit SHA was found");
      const short = sha.slice(0, 7);
      for (const raw of [text, JSON.stringify(body)]) {
        for (const secret of [lin.email, lin.name, "private steps", "secret page", "/orders", sha, short]) {
          assert.equal(raw.includes(secret), false, secret);
        }
      }
    } finally {
      repo.drop();
      await kit.p99(["feed", "off", blog]);
    }
  });

  await kit.check("us-feed-001 a feed turned off answers 404", async () => {
    const on = await kit.p99(["feed", "on", blog]);
    assert.equal(on.code, 0, on.stderr);
    assert.equal((await feedOf(kit, blog)).status, 200);
    const off = await kit.p99(["feed", "off", blog]);
    assert.equal(off.code, 0, off.stderr);
    assert.ok(off.stdout.includes(`${blog}'s feed is off`), off.stdout);
    assert.equal((await feedOf(kit, blog)).status, 404);
    assert.equal((await feedOf(kit, blog, "?format=json")).status, 404);
  });
}

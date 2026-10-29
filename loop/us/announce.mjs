import assert from "node:assert/strict";
import { browseOn, environments, fileAs, gitRepo, places, reporter, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { shop } = places(kit);

  await kit.check("us-announce-001 a fixes trailer marks the item landed on dev then in production", async () => {
    await environments(kit);
    const grace = await reporter(kit, shop, "Grace Hopper");
    const filed = await fileAs(kit, grace, uniqueTitle("The receipt is blank"));
    const key = filed.key;
    const repo = gitRepo([`Fix the receipt\n\nFixes: ${key}`]);
    try {
      const landed = async () => {
        const shown = await kit.p99(["show", key, "--host", shop]);
        assert.equal(shown.code, 0, shown.stderr);
        return shown.stdout;
      };
      assert.equal((await landed()).includes("landed in"), false, "nothing has landed yet");
      const dev = await kit.p99(["announce", "--env", "dev", "--branch", "main", "--version", "v-dev"], { env: repo.env });
      assert.equal(dev.code, 0, dev.stderr);
      assert.match(dev.stdout, /announced [0-9a-f]{8} main v-dev to dev: 1 items \(1 fixes\)/);
      let shown = await landed();
      assert.match(shown, /landed in dev \(development\)/);
      assert.equal(shown.includes("landed in production"), false);
      const production = await kit.p99(["announce", "--env", "production", "--branch", "main", "--version", "v1.0.0"], { env: repo.env });
      assert.equal(production.code, 0, production.stderr);
      shown = await landed();
      assert.ok(shown.indexOf("landed in dev") >= 0 && shown.indexOf("landed in production") > shown.indexOf("landed in dev"), shown);
      const mine = await browseOn(kit, shop, "GET", `/issues/${key}`, grace.secret);
      const names = mine.json.issue.landing.envs.map((e) => e.env);
      assert.ok(names.includes("dev") && names.includes("production") && names.indexOf("dev") < names.indexOf("production"), JSON.stringify(names));
    } finally {
      repo.drop();
    }
  });

  await kit.check("us-announce-001 a missing host or environment is refused by name", async () => {
    await environments(kit);
    const grace = await reporter(kit, shop, "Grace Hopper");
    const filed = await fileAs(kit, grace, uniqueTitle("The cart forgets a note"));
    const key = filed.key;
    const repo = gitRepo([`Fix the cart\n\nFixes: ${key}`]);
    try {
      const bare = await kit.p99(["announce"], { env: repo.env });
      assert.equal(bare.code, 1);
      assert.ok(bare.stderr.includes("name a host or an environment with --env"), bare.stderr);
      const gone = await kit.p99(["announce", "gone.example.com"], { env: repo.env });
      assert.equal(gone.code, 1);
      assert.ok(gone.stderr.includes("no host is called gone.example.com"), gone.stderr);
      const nowhere = await kit.p99(["announce", "--env", "nowhere", "--branch", "main", "--version", "v0"], { env: repo.env });
      assert.equal(nowhere.code, 1);
      assert.ok(nowhere.stderr.includes("no environment is called nowhere"), nowhere.stderr);
      const shown = await kit.p99(["show", key, "--host", shop]);
      assert.equal(shown.stdout.includes("landed in"), false, "nothing was marked");
    } finally {
      repo.drop();
    }
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { aWrongCode, stepCode } from "../us-codes-kit.mjs";

export default async function (kit) {
  const { check, call, browse, people } = kit;

  await check("us-verify-001 a wrong or used code is refused and nothing opens", async () => {
    const tag = randomUUID().slice(0, 8);
    const made = await call("POST", "/_p99/v1/codes", {
      actor: people.ada,
      body: { name: "Grace Hopper", email: `grace.verify.${tag}@example.com`, grant: { projects: ["Shop"] }, role: "user", totp: true, mail: false },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const { secret, totp_key: key } = made.json;
    assert.match(key, /^[A-Z2-7]{16,}$/);

    assert.equal((await browse("GET", "/me?path=%2F", secret)).status, 428, "a forwarded link alone opens nothing");
    assert.equal((await browse("POST", "/issues", secret, kit.issueBody({ title: `Filed before the code ${tag}` }))).status, 428);

    for (const typed of [aWrongCode(kit, key), "12345", "abcdef", ""]) {
      const refused = await browse("POST", "/verify", secret, { totp: typed });
      assert.equal(refused.status, 400, `${typed}: ${JSON.stringify(refused.json)}`);
    }
    assert.equal((await browse("GET", "/me?path=%2F", secret)).status, 428, "wrong codes opened nothing");

    const right = stepCode(kit, key);
    const accepted = await browse("POST", "/verify", secret, { totp: right });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
    const device = accepted.json.device;
    assert.match(device, /^[0-9a-f]{32}$/);

    const used = await browse("POST", "/verify", secret, { totp: right });
    assert.equal(used.status, 400, "the same code twice");
    const older = await browse("POST", "/verify", secret, { totp: stepCode(kit, key, -1) });
    assert.equal(older.status, 400, "a code from a step already passed");

    assert.equal((await browse("GET", "/me?path=%2F", secret)).status, 428, "the link without the browser's device stays shut");
    assert.equal((await browse("GET", "/me?path=%2F", `${secret}.${"0".repeat(32)}`)).status, 428, "a made-up device stays shut");
    assert.equal((await browse("GET", "/me?path=%2F", `${secret}.${device}`)).status, 200);
    const filed = await browse("POST", "/issues", `${secret}.${device}`, kit.issueBody({ title: `Filed after the code ${tag}` }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
  });
}

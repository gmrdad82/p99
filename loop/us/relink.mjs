import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FORM, GONE, VERIFY, buttonsOf, compact, inviteJson, secretOf, shows, visit } from "../../worker/test/us-codes-kit.mjs";
import { noMailTo } from "../../worker/test/us-support/quiet.mjs";

const NOW = "2026-10-29T10:00:00.000Z";

export default async function (kit) {
  const { check, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const host = shop.hosts[0];

  await check("us-relink-001 a relink mails the new link and the old one stops at once", async () => {
    await kit.clock.set(NOW);
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name, "--totp"]);
    const verified = await kit.browse("POST", "/verify", made.secret, { totp: kit.totp(made.totp_key) }, host);
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    const device = verified.json.device;
    const filed = await kit.browse("POST", "/issues", `${made.secret}.${device}`, kit.issueBody({ title: `Before the relink ${email}` }), host);
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    try {
      const run = await kit.p99(["relink", email]);
      assert.equal(run.code, 0, run.stderr);
      assert.match(run.stdout, new RegExp(`^code \\d+ replaces code ${made.code.id}, which no longer works$`, "m"));
      assert.ok(run.stdout.includes(`mailed the link to ${email}`), run.stdout);
      assert.ok(run.stdout.includes("the authenticator carries over"), run.stdout);
      assert.doesNotMatch(run.stdout, /secret:|#p99=/);

      const mail = await kit.until("the relink mail", () => {
        const got = kit.mail.inbox(email);
        return got.length === 1 && got[0];
      });
      assert.match(mail.subject, /^Your new P99 link/);
      assert.equal(mail.reply_to, ada.email);
      const button = buttonsOf(mail.html).find(([h]) => h === host);
      const fresh = secretOf(button[1]);
      assert.ok(fresh && fresh !== made.secret);

      const stale = await visit(kit, host, made.secret);
      assert.ok(await shows(stale, GONE), "the old link gets one line");
      assert.match(await stale.locator(GONE).textContent(), /isn't valid here/);
      assert.equal((await kit.browse("GET", "/me?path=%2F", `${made.secret}.${device}`, undefined, host)).status, 401);
      assert.equal((await kit.browse("GET", "/me?path=%2F", `${fresh}.${device}`, undefined, host)).status, 428, "the old browser's trust is gone");

      await kit.clock.advance(30000);
      const page = await visit(kit, host, fresh);
      assert.ok(await shows(page, VERIFY), "the new link asks the browser for a fresh 6-digit code");
      await page.locator(VERIFY).fill(kit.totp(made.totp_key));
      await page.locator(VERIFY).press("Enter");
      assert.ok(await shows(page, FORM));
      const kept = await page.evaluate(() => localStorage.getItem("p99:code"));
      const mine = await kit.browse("GET", "/issues?scope=mine", kept, undefined, host);
      assert.equal(mine.status, 200, JSON.stringify(mine.json));
      assert.ok(mine.json.issues.some((i) => i.key === filed.json.key), "the same items");
    } finally {
      await kit.call("DELETE", `/_p99/v1/issues/${filed.json.key}?host=${host}`, { actor: ada });
    }
  });

  await check("us-relink-001 relink self prints adas own link and mails nothing", async () => {
    const codes = (await kit.call("GET", "/_p99/v1/codes", { actor: ada })).json.codes;
    for (const code of codes.filter((c) => c.email === ada.email && !c.revoked_at)) {
      assert.equal((await kit.call("POST", `/_p99/v1/codes/${code.id}/revoke`, { actor: ada })).status, 200);
    }
    const mine = await kit.mint(ada.name, ada.email, { space: true }, true);
    const nobody = noMailTo(kit, ada.email);
    const run = await kit.p99(["relink", "--self"]);
    assert.equal(run.code, 0, run.stderr);
    const printed = /^secret: (\S+)$/m.exec(run.stdout)?.[1];
    assert.ok(printed, run.stdout);
    const secret = compact(printed);
    const links = [...run.stdout.matchAll(/^link:\s+(\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(links, kit.space.projects.flatMap((p) => p.hosts).sort().map((h) => `https://${h}/#p99=${secret}`));
    assert.ok(run.stdout.includes("this is your own link"), run.stdout);
    assert.match(run.stdout, /this is the only time the secret is shown\n$/);
    assert.equal(run.stderr.includes(secret), false);
    await nobody("nothing was mailed");
    assert.equal((await kit.browse("GET", "/me?path=%2F", mine.secret, undefined, host)).status, 401, "the old code stopped");
    assert.equal((await kit.browse("GET", "/me?path=%2F", secret, undefined, host)).status, 200);
  });

  await check("us-relink-001 a changed email moves every item to the new one", async () => {
    const tag = randomUUID().slice(0, 8);
    const from = `grace.${tag}@example.com`;
    const to = `grace.hopper.${tag}@example.com`;
    const made = await kit.mint("Grace Hopper", from, { projects: [shop.name] });
    const filed = await kit.browse("POST", "/issues", made.secret, kit.issueBody({ title: `Filed as the old address ${tag}` }), host);
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const run = await kit.p99(["people", "rename", from, to]);
    assert.equal(run.code, 0, run.stderr);
    const lines = run.stdout.trimEnd().split("\n");
    assert.match(lines[0], new RegExp(`^moved ${from} to ${to}: 1 items, \\d+ assigned, \\d+ comments, \\d+ events, \\d+ attachments, 1 codes$`));
    assert.equal(lines[1], "set the same e-mail in your config's [me] so new work lands there too");
    const read = await kit.call("GET", `/_p99/v1/issues/${filed.json.key}?host=${host}`, { actor: ada });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(read.json.reporter.email, to);
    const me = await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host);
    assert.equal(me.json.email, to);
    const mine = await kit.browse("GET", "/issues?scope=mine", made.secret, undefined, host);
    assert.ok(mine.json.issues.some((i) => i.key === filed.json.key));
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FORM, GONE, PLUS, VERIFY, compact, inviteJson, invitesJson, shows, visit } from "../../worker/test/us-codes-kit.mjs";

const NOW = "2026-10-29T10:00:00.000Z";

export default async function (kit) {
  const { check } = kit;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const host = shop.hosts[0];

  await check("us-verify-001 the printed key gives codes the worker accepts", async () => {
    for (const [at, six] of [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ]) {
      assert.equal(kit.totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", at * 1000), six, `RFC 6238 at ${at}`);
    }
    await kit.clock.set(NOW);
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const run = await kit.p99(["invite", "--project", shop.name, "--name", "Grace Hopper", "--email", email, "--no-mail", "--totp"]);
    assert.equal(run.code, 0, run.stderr);
    const key = /^key:\s+([A-Z2-7]+)/m.exec(run.stdout)?.[1];
    const link = /^totp:\s+(otpauth:\/\/\S+)$/m.exec(run.stdout)?.[1];
    assert.ok(key && link, run.stdout);
    const url = new URL(link);
    assert.equal(url.protocol, "otpauth:");
    assert.equal(url.host, "totp");
    assert.ok(decodeURIComponent(url.pathname).includes(email));
    assert.deepEqual(
      ["secret", "algorithm", "digits", "period", "issuer"].map((name) => url.searchParams.get(name)),
      [key, "SHA1", "6", "30", "P99"],
    );
    const secret = compact(/^secret: (\S+)$/m.exec(run.stdout)[1]);

    const asked = await kit.browse("GET", "/me?path=%2F", secret, undefined, host);
    assert.equal(asked.status, 428, "nothing opens before the code");
    const accepted = await kit.browse("POST", "/verify", secret, { totp: kit.totp(key) }, host);
    assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
    const opened = await kit.browse("GET", "/me?path=%2F", `${secret}.${accepted.json.device}`, undefined, host);
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const next = await kit.browse("POST", "/verify", secret, { totp: kit.totp(key, kit.clock.now() + 30000) }, host);
    assert.equal(next.status, 201, "the next step's code is accepted too");
  });

  await check("us-verify-001 the first visit opens the six digit step by itself and trusts the browser", async () => {
    await kit.clock.set(NOW);
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name, "--totp"]);
    const page = await visit(kit, host, made.secret);
    assert.ok(await shows(page, VERIFY), "the 6-digit step comes up without a tap");
    assert.equal(await page.locator("p99-root >> .p99-panel.is-open .p99-new").count(), 0, "no report form before the code");
    await page.locator(VERIFY).fill(kit.totp(made.totp_key, kit.clock.now()));
    await page.locator(VERIFY).press("Enter");
    assert.ok(await shows(page, FORM), "once the code is right the report form opens");
    const kept = await page.evaluate(() => localStorage.getItem("p99:code"));
    assert.match(kept, new RegExp(`^${made.secret}\\.[0-9a-f]{32}$`), "the browser keeps its device with the code");

    await page.reload();
    assert.ok(await shows(page, PLUS));
    await page.locator(PLUS).click();
    assert.ok(await shows(page, FORM), "the next visit goes straight to the report form");
    assert.equal(await page.locator("p99-root >> .p99-verify").count(), 0, "the browser is not asked again");
  });

  await check("us-verify-001 invites totp adds an authenticator to a code someone holds", async () => {
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name]);
    const id = made.code.id;
    assert.ok(await shows(await visit(kit, host, made.secret), PLUS), "without an authenticator the link opens the +");
    assert.equal((await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host)).status, 200);

    const run = await kit.p99(["invites", "totp", String(id)]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout, `code ${id} of Grace Hopper <${email}> now asks for an authenticator code\nmailed the authenticator setup to ${email}\n`);
    const setup = await kit.until("the authenticator mail", () => {
      const got = kit.mail.inbox(email);
      return got.length === 1 && got[0];
    });
    assert.equal(setup.subject, "Set up your authenticator for P99");
    assert.match(setup.text, /^Grace, your P99 link now asks for a 6-digit code from an authenticator app/);
    assert.ok(setup.html.includes(`src="cid:${setup.attachments[0].content_id}"`));
    assert.equal(setup.text.includes(made.secret), false, "the setup mail carries no link");
    const key = /type this key: ([A-Z2-7 ]+)$/m.exec(setup.text)?.[1].replace(/ /g, "");
    assert.ok(key, setup.text);
    assert.match(setup.text, /otpauth:\/\/totp\/.+algorithm=SHA1&digits=6&period=30$/m);
    assert.equal(run.stdout.includes(key), false, "the terminal never shows the mailed key");

    const listed = await invitesJson(kit);
    assert.equal(listed.codes.find((c) => c.id === id).totp, true);
    assert.equal(listed.text.includes(key), false, "the key is shown once");
    assert.equal((await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host)).status, 428, "the same link now asks for 6 digits");

    const page = await visit(kit, host, made.secret);
    assert.ok(await shows(page, VERIFY), "a browser opening the link is asked for its code");
    await page.locator(VERIFY).fill(kit.totp(key, kit.clock.now()));
    await page.locator(VERIFY).press("Enter");
    assert.ok(await shows(page, FORM));
    assert.equal(await page.locator(GONE).count(), 0);
  });
}

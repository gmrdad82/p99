import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GONE, PLUS, buttonsOf, compact, inviteJson, invitesJson, secretOf, shows, visit } from "../../worker/test/us-codes-kit.mjs";

export default async function (kit) {
  const { check, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const blog = kit.space.projects.find((p) => p.name === "Blog");
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await check("us-invite-001 the invite mails grace a button per site of her project that opens the plus", async () => {
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const run = await kit.p99(["invite", "--project", shop.name, "--name", "Grace Hopper", "--email", email]);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`mailed the link to ${escaped(email)} \\(projects: ${shop.name}\\)`));
    assert.doesNotMatch(run.stdout, /secret:|#p99=/);
    const mail = await kit.until("the invite mail", () => {
      const got = kit.mail.inbox(email);
      return got.length === 1 && got[0];
    });
    assert.equal(mail.reply_to, ada.email, "replies go to Ada");
    const buttons = buttonsOf(mail.html);
    assert.deepEqual(buttons.map(([host]) => host), [...shop.hosts].sort(), "one button per host of the project");
    for (const [host, link] of buttons) {
      assert.ok(mail.text.includes(link), `${host}: the plain link is in the text part`);
      assert.match(link, new RegExp(`^https://${escaped(host)}/#p99=[0-9a-z]{12}$`));
    }
    assert.equal(new Set(buttons.map(([, link]) => secretOf(link))).size, 1, "every button carries the same code");
    const secret = secretOf(buttons[0][1]);

    const page = await visit(kit, shop.hosts[0], secret);
    assert.ok(await shows(page, PLUS), "the + shows on the site");
    assert.equal(new URL(page.url()).hash, "", "the code left the address bar");
    assert.equal(await page.locator(GONE).count(), 0);
  });

  await check("us-invite-001 without mail the terminal prints the link once", async () => {
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const run = await kit.p99(["invite", "--project", blog.name, "--name", "Grace Hopper", "--email", email, "--no-mail"]);
    assert.equal(run.code, 0, run.stderr);
    const printed = /^secret: (\S+)$/m.exec(run.stdout)?.[1];
    assert.ok(printed, run.stdout);
    const secret = compact(printed);
    const links = [...run.stdout.matchAll(/^link:\s+(\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(links, blog.hosts.map((host) => `https://${host}/#p99=${secret}`));
    assert.match(run.stdout, /this is the only time the secret is shown\n$/);
    assert.deepEqual(kit.mail.inbox(email), [], "nobody was mailed");

    const listed = await invitesJson(kit);
    const row = listed.codes.find((c) => c.email === email);
    assert.ok(row, "the code is listed");
    assert.equal(row.hint, secret.slice(-4));
    assert.deepEqual(row.grant, { projects: [blog.name] });
    const worker = await kit.call("GET", "/_p99/v1/codes", { actor: ada });
    for (const text of [listed.text, JSON.stringify(worker.json), (await kit.p99(["invites"])).stdout]) {
      assert.equal(text.includes(secret), false, "a later answer carried the secret");
      assert.equal(text.includes(printed), false);
    }
    assert.equal((await kit.browse("GET", "/me?path=%2F", secret, undefined, blog.hosts[0])).status, 200, "the printed code works");
  });

  await check("us-invite-003 invites set changes what a code reaches and mails nobody", async () => {
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name]);
    const id = made.code.id;
    assert.ok(await shows(await visit(kit, shop.hosts[0], made.secret), PLUS), "the + shows on Shop's site first");

    const set = await kit.p99(["invites", "set", String(id), "--project", blog.name]);
    assert.equal(set.code, 0, set.stderr);
    assert.equal(set.stdout, `code ${id} of Grace Hopper <${email}> now grants projects: ${blog.name}; no one was mailed\n`);
    assert.deepEqual(kit.mail.inbox(email), []);
    const row = (await invitesJson(kit)).codes.find((c) => c.id === id);
    assert.deepEqual(row.grant, { projects: [blog.name] });
    assert.equal(row.revoked_at, null);

    const closed = await visit(kit, shop.hosts[0], made.secret);
    assert.ok(await shows(closed, GONE), "Shop's site now says the link is no longer valid");
    assert.match(await closed.locator(GONE).textContent(), /isn't valid here/);
    const opened = await visit(kit, blog.hosts[0], made.secret);
    assert.ok(await shows(opened, PLUS), "the same link opens Blog's site");
  });

  await check("us-invite-003 a parked code opens nothing and is not revoked and nobody is mailed", async () => {
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const made = await inviteJson(kit, "Grace Hopper", email, ["--project", shop.name]);
    const id = made.code.id;
    const host = shop.hosts[0];

    const parked = await kit.p99(["invites", "set", String(id), "--park"]);
    assert.equal(parked.code, 0, parked.stderr);
    assert.equal(parked.stdout, `code ${id} of Grace Hopper <${email}> is parked: it opens nothing and is not revoked; no one was mailed\n`);
    assert.deepEqual(kit.mail.inbox(email), []);
    const row = (await invitesJson(kit)).codes.find((c) => c.id === id);
    assert.deepEqual(row.grant, { projects: [] });
    assert.equal(row.revoked_at, null);

    const refused = await kit.browse("GET", "/me?path=%2F", made.secret, undefined, host);
    assert.equal(refused.status, 403);
    assert.match(refused.json.message, /parked/);
    const page = await visit(kit, host, made.secret);
    assert.ok(await shows(page, GONE), "the link gets one line");
    assert.equal(await page.locator(PLUS).isVisible(), false);

    const screen = await kit.tui("tab tab");
    const line = screen.split("\n").find((l) => l.includes(`…${made.code.hint}`));
    assert.ok(line, screen);
    assert.match(line, /parked/);

    const reopened = await kit.p99(["invites", "set", String(id), "--space"]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, `code ${id} of Grace Hopper <${email}> now grants the whole space; no one was mailed\n`);
    assert.deepEqual(kit.mail.inbox(email), []);
    assert.ok(await shows(await visit(kit, host, made.secret), PLUS), "the same link opens again");
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { GONE, PLUS, buttonsOf, compact, inviteJson, invitesJson, secretOf, shows, visit } from "../../worker/test/us-codes-kit.mjs";
import { noMailTo } from "../../worker/test/us-support/quiet.mjs";

export default async function (kit) {
  const { check, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const blog = kit.space.projects.find((p) => p.name === "Blog");
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const NOW = "2026-10-29T10:00:00.000Z";

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
    const nobody = noMailTo(kit, email);
    const run = await kit.p99(["invite", "--project", blog.name, "--name", "Grace Hopper", "--email", email, "--no-mail"]);
    assert.equal(run.code, 0, run.stderr);
    const printed = /^secret: (\S+)$/m.exec(run.stdout)?.[1];
    assert.ok(printed, run.stdout);
    const secret = compact(printed);
    const links = [...run.stdout.matchAll(/^link:\s+(\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(links, blog.hosts.map((host) => `https://${host}/#p99=${secret}`));
    assert.match(run.stdout, /this is the only time the secret is shown\n$/);
    await nobody("nobody was mailed");

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

    const nobody = noMailTo(kit, email);
    const set = await kit.p99(["invites", "set", String(id), "--project", blog.name]);
    assert.equal(set.code, 0, set.stderr);
    assert.equal(set.stdout, `code ${id} of Grace Hopper <${email}> now grants projects: ${blog.name}; no one was mailed\n`);
    await nobody("invites set mailed her");
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

    const parkedQuietly = noMailTo(kit, email);
    const parked = await kit.p99(["invites", "set", String(id), "--park"]);
    assert.equal(parked.code, 0, parked.stderr);
    assert.equal(parked.stdout, `code ${id} of Grace Hopper <${email}> is parked: it opens nothing and is not revoked; no one was mailed\n`);
    await parkedQuietly("parking mailed her");
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

    const reopenedQuietly = noMailTo(kit, email);
    const reopened = await kit.p99(["invites", "set", String(id), "--space"]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, `code ${id} of Grace Hopper <${email}> now grants the whole space; no one was mailed\n`);
    await reopenedQuietly("reopening mailed her");
    assert.ok(await shows(await visit(kit, host, made.secret), PLUS), "the same link opens again");
  });

  await check("us-invite-001 with an authenticator the invite sends the link and the setup in two mails", async () => {
    await kit.clock.set(NOW);
    const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
    const run = await kit.p99(["invite", "--project", shop.name, "--name", "Grace Hopper", "--email", email, "--totp"]);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`^mailed the link to ${escaped(email)} \\(projects: ${shop.name}\\)$`, "m"));
    assert.match(run.stdout, new RegExp(`^mailed the authenticator setup to ${escaped(email)} in a second mail$`, "m"));
    assert.doesNotMatch(run.stdout + run.stderr, /secret:|#p99=|key:|otpauth|[A-Z2-7]{32}/);

    const [link, setup] = await kit.until("the two mails", () => {
      const got = kit.mail.inbox(email);
      return got.length === 2 && got;
    });
    assert.equal(link.subject, `Your P99 access for ${kit.space.name}`);
    assert.equal(setup.subject, "Set up your authenticator for P99");
    assert.equal(link.reply_to, ada.email);
    assert.equal(link.attachments, undefined, "the link mail carries no picture");
    assert.match(link.text, /^1\. First, set up your authenticator: a second mail from P99, sent separately, has the code to scan\.$/m);
    assert.match(link.text, /as a User of Example\./);
    assert.doesNotMatch(link.text + link.html, /otpauth|[A-Z2-7]{4} [A-Z2-7]{4} [A-Z2-7]{4}/);
    const buttons = buttonsOf(link.html);
    assert.deepEqual(buttons.map(([host]) => host), shop.hosts);
    const secret = secretOf(buttons[0][1]);
    assert.ok(secret);
    for (const part of [setup.text, setup.html]) {
      assert.equal(part.includes(secret), false, "the setup mail carries no link");
      assert.equal(/#p99=|https?:\/\//.test(part), false);
    }

    assert.equal(setup.attachments.length, 1);
    const [qr] = setup.attachments;
    assert.equal(qr.content_type, "image/png");
    assert.ok(qr.content_id);
    assert.ok(setup.html.includes(`src="cid:${qr.content_id}"`), "the HTML shows the attached QR code");
    const png = Buffer.from(qr.content, "base64");
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.toString("latin1", 12, 16), "IHDR");
    const side = png.readUInt32BE(16);
    const idat = png.indexOf("IDAT", 0, "latin1");
    assert.equal(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, (Math.ceil(side / 8) + 1) * side);

    const key = /type this key: ([A-Z2-7 ]+)$/m.exec(setup.text)?.[1].replace(/ /g, "");
    assert.ok(key, setup.text);
    const uri = new URL(/^On your phone, this link adds it in one tap: (otpauth:\/\/\S+)$/m.exec(setup.text)[1]);
    assert.deepEqual(
      ["secret", "issuer", "algorithm", "digits", "period"].map((name) => uri.searchParams.get(name)),
      [key, "P99", "SHA1", "6", "30"],
    );
    assert.equal(decodeURIComponent(uri.pathname), `/P99:${email}`);
    assert.ok(setup.text.includes(`"P99: ${email}"`));

    assert.equal((await kit.browse("GET", "/me?path=%2F", secret, undefined, shop.hosts[0])).status, 428, "the link alone opens nothing");
    const verified = await kit.browse("POST", "/verify", secret, { totp: kit.totp(key) }, shop.hosts[0]);
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    const opened = await kit.browse("GET", "/me?path=%2F", `${secret}.${verified.json.device}`, undefined, shop.hosts[0]);
    assert.equal(opened.status, 200, "the 6-digit code from the mailed key trusts the browser");
  });

  await check("us-invite-001 the link mail leads with the busiest site and tells an owner of the board and the page", async () => {
    await kit.clock.set("2031-03-01T10:00:00.000Z");
    const filed = [];
    try {
      for (const [host, title] of [[shop.hosts[0], "Busy shop 1"], [shop.hosts[0], "Busy shop 2"], [blog.hosts[0], "Quiet blog"]]) {
        filed.push([(await kit.file(host, { title })).key, host]);
      }
      await kit.clock.advance(60000);
      const email = `grace.${randomUUID().slice(0, 8)}@example.com`;
      const run = await kit.p99(["invite", "--space", kit.space.slug, "--owner", "--totp", "--name", "Grace Hopper", "--email", email]);
      assert.equal(run.code, 0, run.stderr);
      const [link] = await kit.until("the two mails", () => {
        const got = kit.mail.inbox(email);
        return got.length === 2 && got;
      });
      const hosts = buttonsOf(link.html).map(([host]) => host);
      assert.deepEqual(hosts.slice(0, 2), [shop.hosts[0], blog.hosts[0]], "the busiest site leads, though blog sorts first");
      const textOrder = [...link.text.matchAll(/^Open P99 on (\S+): /gm)].map((m) => m[1]);
      assert.deepEqual(textOrder, hosts);
      assert.match(link.text, /as an Owner of Example\./);
      assert.ok(link.text.includes("As an Owner you also get the board, where every card and item of Example moves through its lanes."));
      assert.ok(link.text.includes(`You can also open the board from anywhere at https://${kit.space.app}/: sign in with ${email} and the 6-digit code your authenticator shows.`));
      assert.ok(link.text.includes("The link is personal: don't forward it."));
    } finally {
      for (const [key, host] of filed) await kit.call("DELETE", `/_p99/v1/issues/${key}?host=${host}`, { actor: ada });
    }
  });
}

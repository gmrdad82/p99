import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const DAY = 24 * 60 * 60 * 1000;

export default async function (kit) {
  await kit.check("us-harness-000 the loop kit reaches the binary the worker the browser the mail and the clock", async () => {
    const tag = randomUUID().slice(0, 8);
    const ada = kit.people.ada;
    const [shop, blog, ops] = ["Shop", "Blog", "Ops"].map((name) => kit.space.projects.find((p) => p.name === name));
    const host = shop.hosts[0];
    assert.equal(blog.hosts.length, 1);
    assert.notEqual(blog.hosts[0], host);
    assert.deepEqual(ops.hosts, []);

    const listed = await kit.p99(["projects", "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    const view = JSON.parse(listed.stdout);
    assert.deepEqual(view.space, { slug: kit.space.slug, name: kit.space.name });
    assert.deepEqual(
      view.projects.map((p) => [p.name, p.hosts]).sort(),
      kit.space.projects.map((p) => [p.name, p.hosts]).sort(),
    );

    const watch = await kit.watch();
    const invited = await kit.p99(["invite", "--name", "Grace Hopper", "--email", "grace@example.com", "--project", shop.name]);
    assert.equal(invited.code, 0, invited.stderr);
    const mail = await kit.until("Grace's invite", () => kit.mail.inbox("grace@example.com").at(-1));
    const link = mail.links.find((l) => l.startsWith(`https://${host}/#p99=`));
    assert.ok(link, JSON.stringify(mail.links));
    const code = link.slice(link.indexOf("#p99=") + "#p99=".length);

    const page = await kit.page();
    await page.goto(kit.siteUrl(host, `/#p99=${code}`));
    await page.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });

    const slack = await kit.call("PUT", `/_p99/v1/hooks/${host}`, {
      actor: ada,
      body: { service: "slack", url: "https://hooks.slack.com/services/T0001/B0002/loopkitaaaabbbb", events: ["new"] },
    });
    assert.equal(slack.status, 200, JSON.stringify(slack.json));
    const linked = await kit.call("PUT", `/_p99/v1/github/${host}`, { actor: ada, body: { repo: "acme/shop" } });
    assert.equal(linked.status, 200, JSON.stringify(linked.json));

    await kit.clock.set("2030-01-01T09:00:00.000Z");
    const filed = await kit.browse("POST", "/issues", code, kit.issueBody({ title: `Loop ${tag}` }), host);
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    assert.ok(filed.json.created_at.startsWith("2030-01-01"), filed.json.created_at);

    let heard = await watch.next(10000);
    while (heard && heard.key !== key) heard = await watch.next(10000);
    assert.equal(heard?.key, key, watch.stderr());

    const post = await kit.until("the Slack post", () => kit.hooks.posts().find((p) => JSON.stringify(p.body).includes(key)));
    assert.equal(post.service, "slack");

    const opened = await kit.call("POST", `/_p99/v1/issues/${key}/github`, { actor: ada });
    assert.ok([200, 201].includes(opened.status), JSON.stringify(opened.json));
    assert.ok(kit.github.issues().some((asked) => asked.method === "POST" && asked.path === "/repos/acme/shop/issues" && asked.body.title === `Loop ${tag}`));

    await kit.clock.advance(DAY);
    const later = await kit.file(host, { title: `Loop ${tag} later` });
    assert.ok(later.created_at.startsWith("2030-01-02"), later.created_at);
    assert.ok(new Date(kit.clock.now()).toISOString().startsWith("2030-01-02"));

    const screen = await kit.tui("");
    assert.ok(screen.includes(`Loop ${tag}`), screen);
  });
}

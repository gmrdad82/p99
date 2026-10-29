import assert from "node:assert/strict";
import { browseOn, fileAs, openShadow, places, reporter, until, uniqueTitle } from "../../worker/test/us-support/delivery.mjs";

export default async function (kit) {
  const { shop } = places(kit);

  await kit.check("us-mail-001 adas reply mails grace a link that opens her thread", async () => {
    const grace = await reporter(kit, shop, "Grace Hopper");
    const title = uniqueTitle("The total does not update");
    const filed = await fileAs(kit, grace, title, { page: { url: `https://${shop}/`, path: "/", title: "Home" } });
    const key = filed.key;
    const asked = await kit.call("GET", "/_p99/v1/hosts");
    const accent = (asked.json.hosts.find((h) => h.host === shop)?.config?.theme?.accent ?? "#3b7dd8").toLowerCase();

    const person = await kit.p99(["comment", key, "We are on it.", "--host", shop]);
    assert.equal(person.code, 0, person.stderr);
    const [mail] = await until("Ada's reply by mail", async () => {
      const got = (await kit.mail.inbox(grace.email)).filter((m) => m.subject.startsWith(`[${key}] New reply`));
      return got.length === 1 && got;
    });
    assert.ok(mail.text.includes("We are on it."), mail.text);
    assert.ok(mail.html.toLowerCase().includes(accent), "the mail wears the site's accent colour");
    assert.equal(mail.text.includes("🤖"), false);

    const link = mail.links.find((l) => l.includes("/_p99/open"));
    assert.ok(link, JSON.stringify(mail.links));
    const parsed = new URL(link);
    assert.ok(parsed.hash.length > 1, "the link carries Grace's code");
    const page = await kit.page();
    await page.addInitScript(openShadow);
    await page.goto(`${await kit.siteUrl(shop, parsed.pathname + parsed.search)}${parsed.hash}`);
    const opened = page.locator("p99-root >> .p99-panel.is-open [data-view=item]");
    await opened.waitFor({ timeout: 20000 });
    assert.ok((await opened.innerText()).includes(title), "the link opens Grace's own thread");
    const mine = await browseOn(kit, shop, "GET", `/issues/${key}`, grace.secret);
    assert.equal(mine.status, 200);

    const robot = await kit.p99(["--agent=writer", "comment", key, "Checking the cart service.", "--host", shop]);
    assert.equal(robot.code, 0, robot.stderr);
    const [agentMail] = await until("the agent's reply by mail", async () => {
      const got = (await kit.mail.inbox(grace.email)).filter((m) => m.subject.startsWith(`[${key}] New reply`) && m.text.includes("Checking the cart service."));
      return got.length === 1 && got;
    });
    assert.ok(agentMail.text.includes("🤖"), agentMail.text);
  });
}

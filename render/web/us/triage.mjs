import assert from "node:assert/strict";
import { cast, closePage, openPanel, people, report, tag, threadOf } from "../../../loop/triage-lib.mjs";

const IN = (sel) => `p99-root >> .p99-panel.is-open [data-view=item] ${sel}`;

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-triage-003 an owner edits the title and details in the panel", async () => {
    const t = tag();
    const { ada } = await people(kit);
    const filed = await report(kit, where.shop, `Pay stays grey ${t}`, { body: "It never turns on." });
    const page = await kit.page();
    try {
      await openPanel(page, `${kit.siteUrl(where.shop, "/checkout")}#p99=${ada}`);
      await page.evaluate((k) => window.P99.open(k), filed.key);
      await page.locator(IN(".p99-edit")).waitFor({ timeout: 20000 });
      assert.equal(await page.locator(IN(".p99-edit h3")).textContent(), "Edit the title and details");
      const title = `Pay stays grey after the card is accepted ${t}`;
      await page.locator(IN(".p99-edit input[name=title]")).fill(title);
      await page.locator(IN(".p99-edit textarea[name=body]")).fill("It never turns on, on Firefox and Chrome alike.");
      const sent = page.waitForRequest((r) => r.method() === "PATCH" && new URL(r.url()).pathname === `/_p99/api/issues/${filed.key}`);
      await page.locator(IN(".p99-edit button[type=submit]")).click();
      assert.deepEqual(JSON.parse((await sent).postData()), { title, body: "It never turns on, on Firefox and Chrome alike." });
      await page.waitForFunction((t) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] #p99-title")?.textContent === t, title, { timeout: 20000 });
      const stored = await threadOf(kit, filed.key);
      assert.equal(stored.issue.title, title);
      assert.equal(stored.issue.body, "It never turns on, on Firefox and Chrome alike.");
      assert.ok(stored.events.some((e) => e.kind === "title"), `the history keeps the title change (${stored.events.map((e) => e.kind)})`);
      const history = await page.locator(IN(".p99-thread")).textContent();
      assert.ok(history.includes("changed the title"), history);
    } finally {
      await closePage(page);
    }
  });
}

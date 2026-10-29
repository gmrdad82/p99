import assert from "node:assert/strict";
import { cast, closePage, openPanel, people, report, tag, threadOf } from "../../../loop/triage-lib.mjs";

const IN = (sel) => `p99-root >> .p99-panel.is-open [data-view=item] ${sel}`;

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-merge-001 an owners duplicate pick in the panel merges the card into the other", async () => {
    const t = tag();
    const { ada } = await people(kit);
    const into = await report(kit, where.shop, `The total stays at zero ${t}`);
    const twin = await report(kit, where.shop, `Total shows 0 ${t}`);
    const page = await kit.page();
    try {
      await openPanel(page, `${kit.siteUrl(where.shop, "/checkout")}#p99=${ada}`);
      await page.evaluate((k) => window.P99.open(k), twin.key);
      const pick = IN(".p99-manage .p99-picker:nth-of-type(2) [role=combobox]");
      await page.locator(pick).waitFor({ timeout: 20000 });
      await page.locator(pick).click();
      await page.keyboard.type(into.key, { delay: 20 });
      await page.locator(IN(`.p99-manage [role=option]:has-text("${into.key}")`)).waitFor({ timeout: 20000 });
      await page.keyboard.press("Enter");
      const merged = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/_p99/api/merge");
      await page.locator(IN(".p99-manage > button[type=submit]")).click();
      assert.deepEqual(JSON.parse((await merged).postData()), { into: into.key, items: [twin.key] });
      await page.waitForFunction((k) => (document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] .p99-meta")?.textContent || "").includes(`merged into ${k}`), into.key, { timeout: 20000 });
      const gone = await threadOf(kit, twin.key);
      assert.equal(gone.issue.duplicate_of, into.key);
      assert.equal(gone.issue.resolution, "duplicate");
      const kept = await threadOf(kit, into.key);
      assert.ok(kept.events.some((e) => e.kind === "merge" && e.detail && e.detail.item === twin.key), `the target's history names the merged card (${JSON.stringify(kept.events.map((e) => [e.kind, e.detail]))})`);
    } finally {
      await closePage(page);
    }
  });
}

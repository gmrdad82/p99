import assert from "node:assert/strict";
import { ADA, cast, closePage, people, report, tag } from "../../../loop/triage-lib.mjs";

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);
  const base = kit.siteUrl(where.shop, "/checkout");
  const inPanel = (selector) => `p99-root >> .p99-panel.is-open ${selector}`;

  const open = async (page, code, key) => {
    await page.goto(`${base}#p99=${code}`);
    await page.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .f"), null, { timeout: 20000 });
    await page.goto(`${base}#p99=${key}`);
  };

  await check("us-delete-001 the panels delete works once the key matches", async () => {
    const t = tag();
    const { ada, grace } = await people(kit);
    const doomed = await report(kit, where.shop, `Delete from the panel ${t}`);
    const kept = await report(kit, where.shop, `Keep from the panel ${t}`);

    const owner = await kit.page();
    try {
      await open(owner, ada, doomed.key);
      await owner.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-delete"), null, { timeout: 20000 });
      const button = owner.locator(inPanel(".p99-danger"));
      assert.equal(await button.isDisabled(), true, "the button waits for the key");
      await owner.locator(inPanel(".p99-delete input")).pressSequentially(`${doomed.key.slice(0, -1)}${doomed.key.endsWith("9") ? "8" : "9"}`);
      assert.equal(await button.isDisabled(), true, "a wrong key keeps it disabled");
      await owner.locator(inPanel(".p99-delete input")).fill(doomed.key.toLowerCase());
      assert.equal(await button.isDisabled(), false, "the key matches without its case");
      assert.equal((await kit.call("GET", `/_p99/v1/issues/${doomed.key}?host=${where.shop}`, { actor: ADA })).status, 200);
      await button.focus();
      await owner.keyboard.press("Enter");
      await kit.until("the item to go", async () => (await kit.call("GET", `/_p99/v1/issues/${doomed.key}?host=${where.shop}`, { actor: ADA })).status === 404);
    } finally {
      await closePage(owner);
    }

    const visitor = await kit.page();
    try {
      await open(visitor, grace, kept.key);
      await visitor.waitForFunction((title) => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open")?.textContent.includes(title), `Keep from the panel ${t}`, { timeout: 20000 });
      const found = await visitor.evaluate(() => {
        const panel = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open");
        return { delete: !!panel.querySelector(".p99-delete"), manage: !!panel.querySelector(".p99-manage") };
      });
      assert.deepEqual(found, { delete: false, manage: false }, "a User has no delete");
    } finally {
      await closePage(visitor);
    }
    assert.equal((await kit.call("GET", `/_p99/v1/issues/${kept.key}?host=${where.shop}`, { actor: ADA })).status, 200);
  });
}

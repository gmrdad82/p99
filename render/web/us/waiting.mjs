import assert from "node:assert/strict";
import { card, cast, closePage, ok, people, tag } from "../../../loop/triage-lib.mjs";

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-waiting-001 the panels dots button shows the waiting count", async () => {
    const t = tag();
    const { ada } = await people(kit);
    const waiting = async () => (await kit.browse("GET", "/me?path=%2Fcheckout", ada)).json.counts.needs_you;
    const replies = async () => (await kit.browse("GET", "/me?path=%2Fcheckout", ada)).json.counts.replies || 0;
    const before = await waiting();
    assert.equal(typeof before, "number", "an Owner's /me carries the Needs you count");

    const made = await card(kit, "Shop", `Look at the clip ${t}`);
    await ok(kit, ["card", "status", made.key, "needs-you", "--note", `Please look ${t}`, "--agent"]);
    const now = await kit.until("the Worker to count the waiting card", async () => {
      const n = await waiting();
      return n === before + 1 ? n + (await replies()) : null;
    });

    const page = await kit.page();
    try {
      await page.goto(`${kit.siteUrl(where.shop, "/checkout")}#p99=${ada}`);
      await page.waitForFunction(
        (n) => {
          const dots = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f) .n");
          return !!dots && dots.textContent === String(n) && dots.classList.contains("u");
        },
        now,
        { timeout: 20000 },
      );
    } finally {
      await closePage(page);
    }
  });
}

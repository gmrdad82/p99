import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { card, cast, closePage, ok, people, tag } from "../../../loop/triage-lib.mjs";
import { GRACE, cardIn, clear, place, signed } from "../us-lib/lanes.mjs";

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

  await check("us-waiting-001 landed and stuck cards never raise the blue count", async () => {
    const t = tag();
    const at = "waits.example.com";
    const owner = await place(kit, "Waits", at);
    const keys = [];
    try {
      keys.push(await cardIn(kit, "Waits", at, `Please look ${t}`, { status: "needs-you" }));
      keys.push(await cardIn(kit, "Waits", at, `Shipped, check it ${t}`, { status: "landed" }));
      keys.push(await cardIn(kit, "Waits", at, `Blocked on the vendor ${t}`, { status: "stuck" }));
      const replied = await cardIn(kit, "Waits", at, `Asked Grace ${t}`);
      keys.push(replied);
      await signed(kit, "POST", `/cards/${replied}/comments`, { client_uid: randomUUID(), body: `Answered ${t}` }, GRACE);
      const counts = (await kit.browse("GET", "/me?path=%2Fcheckout", owner, undefined, at)).json.counts;
      assert.deepEqual({ needs_you: counts.needs_you, replies: counts.replies, waiting: counts.waiting }, { needs_you: 1, replies: 1, waiting: 3 }, JSON.stringify(counts));

      const page = await kit.page();
      try {
        await page.goto(`${kit.siteUrl(at, "/checkout")}#p99=${owner}`);
        await page.waitForFunction(() => {
          const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
          return b && !b.hidden;
        }, null, { timeout: 20000 });
        const blue = await page.evaluate(() => {
          const b = document.querySelector("p99-root").shadowRoot.querySelector(".w .b:not(.f)");
          return { text: b.querySelector(".n.u").textContent, label: b.ariaLabel };
        });
        assert.deepEqual(blue, { text: "2", label: "Your cards: 2 waiting, 0 on this page" }, "Needs you plus the reply, never the Landed or Stuck card");
      } finally {
        await closePage(page);
      }
    } finally {
      await clear(kit, at, keys);
    }
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { card, cast, closePage, ok, people, tag } from "../../../loop/triage-lib.mjs";
import { GRACE, cardIn, clear, ownerOn, signed } from "../us-lib/lanes.mjs";

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

  await check("us-waiting-001 the dots blue count on a site ignores landed and stuck cards", async () => {
    const t = tag();
    const at = where.blog;
    const owner = await ownerOn(kit, at);
    const countsNow = async () => (await kit.browse("GET", "/me?path=%2Fcheckout", owner, undefined, at)).json.counts;
    const before = await countsNow();
    const keys = [];
    try {
      keys.push(await cardIn(kit, "Blog", at, `Please look ${t}`, { status: "needs-you" }));
      keys.push(await cardIn(kit, "Blog", at, `Shipped, check it ${t}`, { status: "landed" }));
      keys.push(await cardIn(kit, "Blog", at, `Blocked on the vendor ${t}`, { status: "stuck" }));
      const replied = await cardIn(kit, "Blog", at, `Asked Grace ${t}`);
      keys.push(replied);
      await signed(kit, "POST", `/cards/${replied}/comments`, { client_uid: randomUUID(), body: `Answered ${t}` }, GRACE);
      const after = await countsNow();
      assert.deepEqual(
        { needs_you: after.needs_you - before.needs_you, replies: after.replies - before.replies, waiting: after.waiting - before.waiting },
        { needs_you: 1, replies: 1, waiting: 3 },
        JSON.stringify({ before, after }),
      );
      const blue = after.needs_you + after.replies;

      const page = await kit.page();
      try {
        await page.goto(`${kit.siteUrl(at, "/checkout")}#p99=${owner}`);
        await page.waitForFunction(() => {
          const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
          return b && !b.hidden;
        }, null, { timeout: 20000 });
        const shown = await page.evaluate(() => {
          const b = document.querySelector("p99-root").shadowRoot.querySelector(".w .b:not(.f)");
          return { text: b.querySelector(".n.u").textContent, waiting: Number(/^Your cards: (\d+) waiting/.exec(b.ariaLabel)?.[1]) };
        });
        assert.deepEqual(shown, { text: blue > 99 ? "99+" : String(blue), waiting: blue }, `Needs you plus replies, never the Landed or Stuck cards ${JSON.stringify(after)}`);
      } finally {
        await closePage(page);
      }
    } finally {
      await clear(kit, keys);
    }
  });
}

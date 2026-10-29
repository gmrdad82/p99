import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FORM, GONE, PLUS, shows } from "../../../worker/test/us-codes-kit.mjs";

const CLOCK = Date.UTC(2026, 0, 5, 9);
const PHONE = { width: 411, height: 833 };
const OPEN = "p99-root >> .p99-panel.is-open";

export default async function (kit) {
  const { check, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const blog = kit.space.projects.find((p) => p.name === "Blog");
  const host = shop.hosts[0];
  const email = () => `grace.${randomUUID().slice(0, 8)}@example.com`;
  const minted = async (reach = shop.hosts) => kit.mint("Grace Hopper", email(), reach);
  const stored = (page) => page.evaluate(() => localStorage.getItem("p99:code"));
  const plusBox = (page) =>
    page.evaluate(() => {
      const root = document.querySelector("p99-root");
      const button = root?.shadowRoot?.querySelector(".w .f");
      if (!button || button.hidden) return null;
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { w: box.width, top: hit === root, onScreen: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
    });

  await check("us-join-001 the link opens the plus and leaves the address bar", async () => {
    const { secret } = await minted();
    const page = await kit.page();
    await page.setViewportSize(PHONE);
    await page.goto(`${kit.siteUrl(host, "/")}#p99=${secret}`);
    assert.ok(await shows(page, PLUS), "the + shows");
    assert.equal(new URL(page.url()).hash, "", "the address bar no longer holds the code");
    assert.equal(await stored(page), secret, "the site keeps the code");
    const box = await plusBox(page);
    assert.ok(box && box.onScreen && box.top && box.w >= 44, JSON.stringify(box));
    await page.locator(PLUS).click();
    assert.ok(await shows(page, FORM), "a tap opens the report form");
    const width = await page.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open").getBoundingClientRect().width);
    assert.ok(width > 300 && width <= PHONE.width, String(width));
  });

  await check("us-join-001 a link mangled by an app or a page script still signs in", async () => {
    const { secret } = await minted();
    const rewritten = await kit.page();
    await rewritten.addInitScript(() => history.replaceState(null, "", `${location.pathname}#top`));
    await rewritten.goto(`${kit.siteUrl(host, "/")}#p99=${secret}`);
    assert.ok(await shows(rewritten, PLUS), "a page script that rewrites the hash first");
    assert.equal(await stored(rewritten), secret);
    assert.equal((await rewritten.evaluate(() => location.href)).includes(secret), false);

    const upper = await minted();
    const shouted = await kit.page();
    await shouted.goto(`${kit.siteUrl(host, "/")}#P99=${upper.secret.toUpperCase()}.`);
    assert.ok(await shows(shouted, PLUS), "a link an app upper-cased and ended with a full stop");
    assert.equal(await stored(shouted), upper.secret.toUpperCase());
    assert.equal(await shouted.locator(GONE).count(), 0);
  });

  await check("us-join-001 a refused code shows one line and is forgotten", async () => {
    const revoked = await minted();
    assert.equal((await kit.call("POST", `/_p99/v1/codes/${revoked.code.id}/revoke`, { actor: ada })).status, 200);
    const parked = await minted();
    assert.equal((await kit.call("PATCH", `/_p99/v1/codes/${parked.code.id}`, { actor: ada, body: { grant: { projects: [] } } })).status, 200);
    const elsewhere = await minted(blog.hosts);
    for (const [why, secret] of [
      ["an unknown code", "zzzzzzzzzzzz"],
      ["a revoked code", revoked.secret],
      ["a parked code", parked.secret],
      ["a code for another project", elsewhere.secret],
    ]) {
      const page = await kit.page();
      await page.goto(`${kit.siteUrl(host, "/")}#p99=${secret}`);
      assert.ok(await shows(page, GONE), `${why}: one line shows`);
      assert.match(await page.locator(GONE).textContent(), /isn't valid here/, why);
      assert.equal(await page.locator(`${OPEN} .p99-new`).count(), 0, `${why}: no form opens`);
      assert.equal(await page.locator(PLUS).isVisible(), false, `${why}: the + is hidden`);
      assert.equal(await stored(page), null, `${why}: the site forgets the code`);
      await page.locator(`${GONE} button`).click();
      await kit.until(`${why}: the × removes P99 from the page`, () => page.evaluate(() => !document.querySelector("p99-root")));
    }
  });

  await check("us-join-001 a busy p99 says so waits and signs in without asking again", async () => {
    const { secret } = await minted();
    const page = await kit.page();
    let asked = 0;
    await page.route(
      (url) => url.pathname === "/_p99/api/me",
      (route) => {
        asked += 1;
        if (asked === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
        return route.fallback();
      },
    );
    await page.clock.install({ time: CLOCK });
    await page.clock.pauseAt(CLOCK + 1000);
    await page.goto(`${kit.siteUrl(host, "/")}#p99=${secret}`);
    const line = page.locator(`${OPEN} [data-view=busy] .p99-busy-line`, { hasText: "P99 is busy, trying again in 1s" });
    await line.waitFor({ timeout: 20000 });
    assert.equal(await page.locator(`${OPEN} .p99-new`).count(), 0, "no report form while busy");
    assert.equal(await page.locator(`${OPEN} [data-view=busy] h2`).textContent(), "Signing you in");
    await page.clock.runFor(1000);
    await kit.until("the panel to close signed in", () => page.evaluate(() => !document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open")));
    assert.equal(asked, 2, "/me was asked twice, the loader's and one retry");
    assert.equal(await stored(page), secret, "the code is kept, never asked for again");
    assert.ok(await page.locator(PLUS).isVisible(), "the + is there to report");
  });
}

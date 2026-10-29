import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const SAVED = "Saved. The badge shows the licence now.";
const WAIT = { timeout: 20000 };

async function code(kit, body) {
  const made = await kit.call("POST", "/_p99/v1/codes", { actor: ADA, body: { grant: { space: true }, mail: false, ...body } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
}

async function signIn(kit, page, email, key) {
  await page.goto(kit.appUrl("/"));
  await page.locator("#signin input[name=email]").waitFor(WAIT);
  await page.fill("#signin input[name=email]", email);
  await page.fill("#signin input[name=totp]", kit.totp(key));
  await page.click("#signin button[type=submit]");
  await page.waitForFunction(
    () => {
      const screen = document.getElementById("app")?.dataset.screen;
      return Boolean(screen) && screen !== "signin" && !document.querySelector("#app .app-wait");
    },
    null,
    WAIT,
  );
}

export default async function (kit) {
  await kit.check("us-licence-001 a studio key pasted on profile shows studio on the page and in the panel at once", async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `ada.page.${tag}@example.com`;
    const owner = await code(kit, { name: "Ada Lovelace", email, role: "owner", totp: true });
    assert.equal(typeof owner.totp_key, "string");
    const visitor = await code(kit, { name: "Grace Hopper", email: `grace.page.${tag}@example.com`, role: "user" });
    const host = kit.space.projects.find((p) => p.hosts.length > 0).hosts[0];
    const before = (await kit.browse("GET", "/me", owner.secret)).json.license;
    const pages = [];
    const panelOf = async () => {
      const site = await kit.page();
      pages.push(site);
      await site.goto(`${kit.siteUrl(host, "/")}#p99=${visitor.secret}`);
      await site.locator("p99-root >> .w .f").waitFor(WAIT);
      await site.locator("p99-root >> .w .f").click();
      await site.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-badge"), null, WAIT);
      return site.evaluate(() => {
        const root = document.querySelector("p99-root").shadowRoot;
        return {
          badge: root.querySelector(".p99-panel.is-open .p99-badge").getAttribute("src"),
          lockup: Boolean(root.querySelector(".p99-panel.is-open .p99-lockup")),
          by: Boolean(root.querySelector(".p99-panel.is-open .p99-by")),
        };
      });
    };
    const profile = async () => {
      const page = await kit.page();
      pages.push(page);
      await signIn(kit, page, email, owner.totp_key);
      await page.evaluate(() => (location.hash = "#profile"));
      await page.waitForFunction(() => document.getElementById("app").dataset.screen === "profile" && !document.querySelector("#app .app-wait"), null, WAIT);
      return page;
    };
    let removed = false;
    try {
      const earlier = await panelOf();
      assert.doesNotMatch(earlier.badge, /\/_p99\/badges\/studio\.svg/, "no studio badge before the key");
      assert.equal(earlier.lockup, true, "before the key the panel shows the small P99 logo");
      assert.equal(earlier.by, true, "before the key the panel shows the by PITO.MD link");

      const page = await profile();
      await page.fill(".app-licence textarea[name=licence]", kit.licenceKey({ tier: "studio", paid_through: "2099-12-31" }));
      await page.click(".app-licence button[type=submit]");
      await page.waitForFunction((w) => document.querySelector(".app-licence .app-status")?.textContent === w, SAVED, WAIT);
      assert.match(await page.getAttribute(".app-bar .app-badge", "src"), /\/_p99\/badges\/studio\.svg/);
      assert.equal(await page.inputValue(".app-licence textarea[name=licence]"), "");
      const me = (await kit.browse("GET", "/me", owner.secret)).json;
      assert.equal(me.license, "studio");
      assert.equal(me.licensed, true);
      assert.equal(me.licence.stored, true);

      const licensed = await panelOf();
      assert.match(licensed.badge, /\/_p99\/badges\/studio\.svg/);
      assert.equal(licensed.lockup, false, "the panel no longer shows the small P99 logo");
      assert.equal(licensed.by, false, "the panel no longer shows the by PITO.MD link");

      const gone = await kit.browse("DELETE", "/licence", owner.secret);
      assert.equal(gone.status, 200, JSON.stringify(gone.json));
      removed = true;
      assert.equal((await kit.browse("GET", "/me", owner.secret)).json.license, before, "removing the key puts the earlier licence back");
      const after = await panelOf();
      assert.doesNotMatch(after.badge, /\/_p99\/badges\/studio\.svg/, "the panel badge is no longer studio");
      assert.equal(after.lockup, true, "the small P99 logo is back");
      assert.equal(after.by, true, "the by PITO.MD link is back");
      const again = await profile();
      assert.doesNotMatch((await again.getAttribute(".app-bar .app-badge", "src")) || "", /\/_p99\/badges\/studio\.svg/, "the page badge is no longer studio");
    } finally {
      for (const page of pages) await page.close().catch(() => {});
      if (!removed) await kit.browse("DELETE", "/licence", owner.secret).catch(() => {});
    }
    assert.equal((await kit.browse("GET", "/me", owner.secret)).json.license, before);
  });
}

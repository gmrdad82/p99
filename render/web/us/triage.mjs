import assert from "node:assert/strict";
import { card, cast, closePage, openBoard, openPanel, people, report, tag, threadOf } from "../../../loop/triage-lib.mjs";

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

  await check("us-triage-003 an owner links a card from the board and sees it in the thread", async () => {
    const t = tag();
    const { ada } = await people(kit);
    const made = await card(kit, "Shop", `Link me ${t}`);
    const pull = `https://github.com/example/shop/pull/${t}`;
    const page = await kit.page();
    const links = () =>
      page.evaluate(() => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open [data-view=item] .p99-link-list li"), (li) => {
        const a = li.querySelector("a");
        return { ref: (a || li.querySelector("code")).textContent, href: a ? a.getAttribute("href") : null };
      }));
    const add = async (ref) => {
      await page.locator(IN(".p99-links input[name=ref]")).fill(ref);
      await page.locator(IN(".p99-links button[type=submit]")).click();
      await page.waitForFunction((r) => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open [data-view=item] .p99-link-list li")).some((li) => li.textContent.includes(r)), ref, { timeout: 20000 });
    };
    try {
      await openPanel(page, `${kit.siteUrl(where.shop, "/checkout")}#p99=${ada}`);
      await openBoard(page);
      await page.waitForFunction((k) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${k}"]`), made.key, { timeout: 20000 });
      await page.evaluate((k) => document.querySelector("p99-root").shadowRoot.querySelector(`.p99-card[data-id="${k}"]`).click(), made.key);
      await page.locator(IN(".p99-links input[name=ref]")).waitFor({ timeout: 20000 });
      assert.equal(await page.locator(IN(".p99-links h3")).textContent(), "Links");
      assert.deepEqual(await links(), [], "a fresh card lists no links");
      await add(pull);
      await add(`pci#${t}`);
      assert.deepEqual(await links(), [{ ref: `pci#${t}`, href: null }, { ref: pull, href: pull }], "newest first, a URL as a link");
      const stored = await threadOf(kit, made.key);
      assert.deepEqual(stored.events.filter((e) => e.kind === "link").map((e) => e.detail.ref), [pull, `pci#${t}`]);
      const history = await page.locator(IN(".p99-thread")).textContent();
      assert.ok(history.includes(`linked ${pull}`), history);
      await page.locator(IN(".p99-links input[name=ref]")).evaluate((input) => { input.value = "x".repeat(201); });
      await page.locator(IN(".p99-links button[type=submit]")).click();
      await page.waitForFunction(() => /\S/.test(document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] .p99-links .p99-status-line")?.textContent.replace("Sending…", "") || ""), null, { timeout: 20000 });
      const said = await page.locator(IN(".p99-links .p99-status-line")).textContent();
      assert.match(said, /200 characters/, "the Worker's words show in the status line");
      assert.equal(await page.locator(IN("#p99-title")).textContent(), `Link me ${t}`, "the thread stays open");
      assert.equal((await threadOf(kit, made.key)).events.filter((e) => e.kind === "link").length, 2, "nothing more is stored");
    } finally {
      await closePage(page);
    }
  });
}

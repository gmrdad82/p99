import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ADA, GRACE, RUN, S, closing, codeFor, hostOf, issueBody, listButton, openShadow, signed, tag, until } from "../us-lib/report.mjs";

const WORD = `crème${RUN}`;
const searchOf = (q) => (url) => url.pathname === "/_p99/api/issues" && url.searchParams.get("q") === q;

const state = (p) =>
  p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const view = r.querySelector(".p99-panel.is-open [data-view=list]");
    const res = view && view.querySelector(".p99-results");
    if (!res) return null;
    const input = r.querySelector(".p99-filters input[name=q]");
    const pick = view.querySelector(".p99-pick");
    return {
      waiting: !!res.querySelector(".p99-rows-wait") || res.hasAttribute("aria-busy"),
      busy: r.querySelector(".p99-filters").classList.contains("is-busy"),
      rows: Array.from(res.querySelectorAll(".p99-item-title"), (b) => b.textContent),
      keys: Array.from(res.querySelectorAll(".p99-key"), (k) => k.textContent),
      empty: res.querySelector(".p99-empty")?.textContent || null,
      error: res.querySelector(".p99-error")?.textContent || null,
      retry: !!res.querySelector(".p99-failed .p99-retry"),
      field: input === r.activeElement,
      value: input && input.value,
      pick: !!pick,
      view: pick ? pick.querySelector("select[name=view]").value : null,
    };
  });

const settled = (p, ready = () => true) => until("the list to settle", async () => {
  const s = await state(p);
  return s && !s.waiting && ready(s) ? s : null;
});

async function search(p, q, enter = true) {
  await p.locator(S(".p99-filters input[name=q]")).focus();
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type(q, { delay: 20 });
  if (enter) await p.keyboard.press("Enter");
}

async function openList(kit, host, code, { clock = false, scope = "all" } = {}) {
  const p = await kit.page();
  await p.addInitScript(openShadow);
  if (clock) await p.clock.install();
  await p.goto(`${kit.siteUrl(host, "/checkout")}#p99=${code}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
    return b && !b.hidden;
  }, null, { timeout: 20000 });
  await listButton(p).click();
  await p.locator(S("[data-view=list] .p99-results")).waitFor({ timeout: 20000 });
  if (scope) await p.locator(S(`.p99-tabs a[data-scope=${scope}]`)).click();
  await settled(p);
  return p;
}

export default async function (kit) {
  const shop = hostOf(kit, "Shop");
  const blog = hostOf(kit, "Blog");
  const fileOn = async (host, title) => (await signed(kit, "POST", `/issues?host=${host}`, issueBody("/checkout", { title }))).json.key;
  let seeded = null;
  const seed = () =>
    (seeded ??= (async () => {
      const owner = await codeFor(kit, shop, ADA, true);
      await fileOn(shop, `The ${WORD} total stays at zero`);
      await fileOn(shop, `Tax line missing on the ${WORD} order`);
      await fileOn(shop, tag("The cart badge shows 0 after a refresh"));
      return owner;
    })());

  await kit.check("us-find-001 a typed search ends in its results with the field kept and focused", async () => {
    const p = await openList(kit, shop, await seed());
    await closing(p, async () => {
      await search(p, `CREME${RUN.toUpperCase()}`, false);
      const s = await settled(p, (x) => x.rows.length === 2);
      assert.equal(s.rows.length, 2, JSON.stringify(s));
      assert.ok(s.rows.every((t) => t.includes(WORD)), `accents and case don't matter (${s.rows.join(" | ")})`);
      assert.ok(!s.busy, "the panel is not left on its loading screen");
      assert.ok(s.field, "the field keeps the focus");
      assert.equal(s.value, `CREME${RUN.toUpperCase()}`, "the field keeps what was typed");
    });
  });

  await kit.check("us-find-001 a search with no match ends in its empty line", async () => {
    const p = await openList(kit, shop, await seed());
    await closing(p, async () => {
      const q = `zebra${RUN}`;
      await search(p, q);
      const s = await settled(p, (x) => x.empty !== null);
      assert.equal(s.rows.length, 0);
      assert.equal(s.empty, `No issues match “${q}”.`);
      assert.ok(s.field && s.value === q, "the field stays, with the words");
    });
  });

  await kit.check("us-find-001 a search that never answers ends in retry", async () => {
    const p = await openList(kit, shop, await seed(), { clock: true });
    await closing(p, async () => {
      const q = `stall${RUN}`;
      await p.route(searchOf(q), () => {});
      await search(p, q);
      const waiting = await until("the search to start", async () => (await state(p))?.waiting);
      assert.ok(waiting, "the search is waiting");
      await p.clock.fastForward(20000);
      const s = await settled(p, (x) => x.error !== null);
      assert.equal(s.error, "Couldn't load; try again.");
      assert.ok(s.retry, "Retry shows");
      assert.ok(!s.busy, "the loading screen is gone");
    });
  });

  await kit.check("us-find-001 an owners panel opens narrowed to this hosts project", async () => {
    const minted = await signed(kit, "POST", "/codes", { name: ADA.name, email: ADA.email, grant: { space: true }, role: "owner", mail: false });
    const everywhere = minted.json.secret;
    const here = await fileOn(shop, tag("Shop: the receipt never arrives"));
    const card = (await signed(kit, "POST", "/cards", { client_uid: randomUUID(), project: "Shop", title: tag("Shop: move the receipts to their own page") })).json.card.key;
    const away = await fileOn(blog, tag("Blog: the feed shows a draft"));

    const p = await openList(kit, shop, everywhere, { scope: null });
    await closing(p, async () => {
      let s = await state(p);
      assert.ok(s.pick, "an Owner sees the project pick");
      assert.equal(s.view, "project", "the panel opens on This project");
      await p.locator(S(".p99-tabs a[data-scope=all]")).click();
      await settled(p);
      await search(p, RUN);
      s = await settled(p, (x) => x.keys.includes(here));
      assert.ok(s.keys.includes(here), `Everyone lists this host's item (${s.keys})`);
      assert.ok(s.keys.includes(card), `and the project's card without a host (${s.keys})`);
      assert.ok(!s.keys.includes(away), `never another project's item (${s.keys})`);
    });

    const visitor = await codeFor(kit, shop, GRACE);
    const filed = await kit.call("POST", `/_p99/v1/issues?host=${shop}`, { actor: GRACE, body: issueBody("/checkout", { title: tag("Grace's own report") }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const q = await openList(kit, shop, visitor, { scope: null });
    await closing(q, async () => {
      const s = await state(q);
      assert.equal(s.pick, false, "a visitor's panel has no project pick");
    });
  });
}

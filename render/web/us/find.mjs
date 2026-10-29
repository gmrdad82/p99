import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ADA, GRACE, RUN, S, closing, codeFor, hostOf, issueBody, listButton, signed, tag } from "../us-lib/report.mjs";

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

const settled = (kit, p, ready = () => true) => kit.until("the list to settle", async () => {
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
  if (clock) await p.clock.install();
  await p.goto(`${kit.siteUrl(host, "/checkout")}#p99=${code}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
    return b && !b.hidden;
  }, null, { timeout: 20000 });
  await listButton(p).click();
  await p.locator(S("[data-view=list] .p99-results")).waitFor({ timeout: 20000 });
  if (scope) await p.locator(S(`.p99-tabs a[data-scope=${scope}]`)).click();
  await settled(kit, p);
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
      const s = await settled(kit, p, (x) => x.rows.length === 2);
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
      const s = await settled(kit, p, (x) => x.empty !== null);
      assert.equal(s.rows.length, 0);
      assert.equal(s.empty, `No cards match “${q}”.`);
      assert.ok(s.field && s.value === q, "the field stays, with the words");
    });
  });

  await kit.check("us-find-001 a search that never answers ends in retry", async () => {
    const p = await openList(kit, shop, await seed(), { clock: true });
    await closing(p, async () => {
      const q = `stall${RUN}`;
      await p.route(searchOf(q), () => {});
      await search(p, q);
      const waiting = await kit.until("the search to start", async () => (await state(p))?.waiting);
      assert.ok(waiting, "the search is waiting");
      await p.clock.fastForward(20000);
      const s = await settled(kit, p, (x) => x.error !== null);
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
      await settled(kit, p);
      await search(p, RUN);
      s = await settled(kit, p, (x) => x.keys.includes(here));
      assert.ok(s.keys.includes(here), `All lists this host's item (${s.keys})`);
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

  const pagePath = `/checkout/${RUN}`;
  const emptyPath = `/checkout/${RUN}/none`;
  let pageSeeded = null;
  const seedPage = () =>
    (pageSeeded ??= (async () => {
      const elsewhere = [await fileOn(shop, tag("Elsewhere: the menu overlaps the logo")), await fileOn(shop, tag("Elsewhere: the footer link is dead"))];
      const here = [];
      for (const title of ["Pay stays grey", "The coupon field drops a digit", "Shipping shows twice"]) {
        here.push((await signed(kit, "POST", `/issues?host=${shop}`, issueBody(pagePath, { title: tag(title) }))).json.key);
      }
      const done = (await signed(kit, "POST", `/issues?host=${shop}`, issueBody(pagePath, { title: tag("Already fixed on this page") }))).json.key;
      await signed(kit, "PATCH", `/issues/${done}`, { status: "done" });
      const owner = await codeFor(kit, shop, ADA, true);
      return { here, elsewhere, done, owner };
    })());
  const dots = (p) =>
    p.evaluate(() => {
      const q = document.querySelector("p99-root").shadowRoot.querySelector(".w .b:not(.f)");
      const blue = q.querySelector(".n.u");
      const page = q.querySelector(".n.v");
      return { blue: blue.textContent, page: page.textContent, back: getComputedStyle(page).backgroundColor, scale: getComputedStyle(page).scale, label: q.ariaLabel };
    });
  const groups = (p) =>
    p.evaluate(() => {
      const res = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list] .p99-results");
      const keysOf = (ol) => (ol ? Array.from(ol.querySelectorAll(":scope > li .p99-key"), (k) => k.textContent) : []);
      const box = res.querySelector(".p99-groups");
      if (!box) return { grouped: false, keys: keysOf(res.querySelector(".p99-items")), heads: [], here: [] };
      const lists = box.querySelectorAll(":scope > ol");
      const heads = Array.from(box.querySelectorAll(":scope > h3"), (h) => (h.hidden ? null : h.textContent));
      const marked = Array.from(lists[0].querySelectorAll(":scope > li"), (li) => ({ here: li.hasAttribute("data-here"), pill: li.querySelector(".p99-here")?.textContent || null, bar: getComputedStyle(li).boxShadow }));
      const restMarked = Array.from(lists[1].querySelectorAll(":scope > li")).some((li) => li.hasAttribute("data-here") || li.querySelector(".p99-here"));
      return { grouped: true, first: box.firstElementChild.tagName, heads, here: keysOf(lists[0]), rest: keysOf(lists[1]), marked, restMarked };
    });
  const openOn = async (path, code) => {
    const p = await kit.page();
    await p.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await p.goto(`${kit.siteUrl(shop, path)}#p99=${code}`);
    await p.waitForFunction(() => {
      const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
      return b && !b.hidden;
    }, null, { timeout: 20000 });
    return p;
  };
  const shots = process.env.P99_SHOTS;
  const snapDots = async (p, name) => {
    const at = await p.evaluate(() => {
      const b = document.querySelector("p99-root").shadowRoot.querySelector(".w").getBoundingClientRect();
      return { x: b.x - 16, y: b.y - 16, width: b.width + 32, height: b.height + 32 };
    });
    await p.screenshot({ path: `${shots}/${name}`, clip: at });
  };

  await kit.check("us-find-001 this pages open items are counted at the dots top left and listed first", async () => {
    const { here, elsewhere, done, owner } = await seedPage();
    const me = (await kit.browse("GET", `/me?path=${encodeURIComponent(pagePath)}`, owner, undefined, shop)).json;
    assert.equal(me.counts.page_open, 3, `the Worker counts the page's three open items (${JSON.stringify(me.counts)})`);
    const p = await openOn(pagePath, owner);
    await closing(p, async () => {
      const d = await kit.until("the page count", async () => {
        const x = await dots(p);
        return x.page === "3" ? x : null;
      });
      assert.equal(d.back, "rgb(163, 38, 106)", "this page's count is red-purple");
      const blue = me.counts.waiting || me.counts.replies;
      assert.equal(d.blue, blue > 99 ? "99+" : blue ? String(blue) : "", "the blue count is only what waits or the replies, never the page's items");
      assert.equal(d.label, `Your cards: ${blue} waiting, 3 on this page`);
      if (shots) await snapDots(p, "us-dots-light.png");
      await listButton(p).click();
      const g = await kit.until("the grouped list", async () => {
        const s = await state(p);
        if (!s || s.waiting) return null;
        const x = await groups(p);
        return x.grouped && x.here.length === 3 ? x : null;
      });
      assert.equal(g.first, "H3", "the list starts with its heading");
      assert.equal(g.heads[0], "On this page 3");
      assert.equal(g.heads[1], "Everything else");
      assert.deepEqual([...g.here].sort(), [...here].sort(), `On this page holds exactly the page's open items (${g.here})`);
      assert.ok(!g.here.includes(done), "a closed item on the page stays out of it");
      assert.ok(g.marked.every((m) => m.here && m.pill === "This page" && /163, 38, 106/.test(m.bar)), `each is marked in red-purple (${JSON.stringify(g.marked)})`);
      assert.ok(elsewhere.every((k) => g.rest.includes(k)), `the rest follow under Everything else (${g.rest.slice(0, 8)})`);
      assert.ok(!g.restMarked, "nothing below is marked as this page's");
      if (shots) {
        await p.locator("p99-root >> .p99-panel.is-open").screenshot({ path: `${shots}/us-list-light.png` });
        await p.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        await p.locator("p99-root >> .p99-panel.is-open").screenshot({ path: `${shots}/us-list-dark.png` });
        await p.locator(S(".p99-groups > h3:nth-of-type(2)")).evaluate((e) => e.scrollIntoView({ block: "center" }));
        await p.locator("p99-root >> .p99-panel.is-open").screenshot({ path: `${shots}/us-list-rest-dark.png` });
        await p.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await p.locator("p99-root >> .p99-panel.is-open").screenshot({ path: `${shots}/us-list-rest-light.png` });
      }
      await p.locator(S(".p99-filters select[name=kind]")).selectOption("question");
      const narrowed = await kit.until("the narrowed list", async () => {
        const s = await state(p);
        return s && !s.waiting ? groups(p) : null;
      });
      assert.equal(narrowed.here.length, 0, `the filters apply to this page's group too (${JSON.stringify(narrowed)})`);
      assert.ok(narrowed.heads.every((h) => h === null), "with nothing of this page left, no heading shows");
    });
    if (shots) {
      const q = await openOn(pagePath, owner);
      await closing(q, async () => {
        await q.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        await kit.until("the page count", async () => ((await dots(q)).page === "3" ? true : null));
        await snapDots(q, "us-dots-dark.png");
      });
    }
  });

  await kit.check("us-find-001 a page with no open items has no top left count and lists as before", async () => {
    const { here, owner } = await seedPage();
    const p = await openOn(emptyPath, owner);
    await closing(p, async () => {
      const d = await dots(p);
      assert.equal(d.page, "", "no count at the top left");
      assert.equal(d.scale, "0", "the empty count is scaled away");
      await listButton(p).click();
      const g = await kit.until("the list", async () => {
        const s = await state(p);
        return s && !s.waiting && s.rows.length ? groups(p) : null;
      });
      assert.equal(g.grouped, false, `no groups and no headings (${JSON.stringify(g)})`);
      assert.ok(here.some((k) => g.keys.includes(k)), "the other page's items list as before");
    });
  });

  const LANES = ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"];
  const statusOptions = (p) =>
    p.waitForFunction(
      (n) => {
        const s = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-filters select[name=status]");
        return s && s.options.length >= n ? Array.from(s.options, (o) => [o.value, o.textContent]) : null;
      },
      3 + LANES.length,
      { timeout: 20000 },
    ).then((h) => h.jsonValue());

  await kit.check("us-find-001 an owners status filter lists the seven lanes and keeps the one picked", async () => {
    const owner = await seed();
    const planned = await fileOn(shop, tag("Planned: wrap the gift in paper"));
    const fresh = await fileOn(shop, tag("New: the voucher box is too narrow"));
    const moved = await kit.call("POST", "/_p99/v1/move", { actor: ADA, body: { key: planned, from: "New", to: "Planned" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const p = await openList(kit, shop, owner);
    await closing(p, async () => {
      const options = await statusOptions(p);
      assert.deepEqual(options.map(([, text]) => text), ["Open", "Closed", "Any", ...LANES], `the Owner's Status lists the lanes (${JSON.stringify(options)})`);
      const asked = p.waitForRequest((r) => { const u = new URL(r.url()); return u.pathname === "/_p99/api/issues" && u.searchParams.get("label") === "Planned"; });
      await p.locator(S(".p99-filters select[name=status]")).selectOption("lane:Planned");
      const u = new URL((await asked).url());
      assert.equal(u.searchParams.get("status"), "any");
      const s = await settled(kit, p, (x) => x.keys.includes(planned));
      assert.ok(s.keys.includes(planned), `the Planned card lists (${s.keys})`);
      assert.ok(!s.keys.includes(fresh), `a New card does not (${s.keys})`);
      assert.equal(await p.locator(S(".p99-filters select[name=status]")).inputValue(), "lane:Planned", "the pick stays");
    });
  });

  await kit.check("us-find-001 the projects view takes the kind lane and search filters", async () => {
    const owner = await seed();
    const word = `velvet${RUN}`;
    const idea = (await signed(kit, "POST", `/issues?host=${shop}`, issueBody("/checkout", { title: tag(`Offer ${word} gift boxes`), kind: "feature" }))).json.key;
    const bug = await fileOn(shop, tag(`The ${word} swatch is the wrong colour`));
    const p = await openList(kit, shop, owner, { scope: null });
    await closing(p, async () => {
      await p.locator(S(".p99-pick select[name=view]")).selectOption("projects");
      await p.locator(S(".p99-projects input[name=project][value=Shop]")).check();
      await settled(kit, p);
      assert.equal(await p.locator(S(".p99-filters")).isVisible(), true, "the filters show on Projects");
      const asked = p.waitForRequest((r) => { const u = new URL(r.url()); return u.pathname === "/_p99/api/issues" && u.searchParams.get("q") === word; });
      await search(p, word);
      const u = new URL((await asked).url());
      assert.deepEqual([u.searchParams.get("scope"), u.searchParams.getAll("project")], ["all", ["Shop"]]);
      let s = await settled(kit, p, (x) => x.keys.includes(idea) && x.keys.includes(bug));
      assert.deepEqual([...s.keys].sort(), [idea, bug].sort(), `the search keeps the Shop cards with the word (${s.keys})`);
      await p.locator(S(".p99-filters select[name=kind]")).selectOption("feature");
      s = await settled(kit, p, (x) => !x.keys.includes(bug));
      assert.deepEqual(s.keys, [idea], `the kind keeps the idea (${s.keys})`);
      await statusOptions(p);
      await p.locator(S(".p99-filters select[name=status]")).selectOption("lane:Done");
      s = await settled(kit, p, (x) => !x.keys.includes(idea));
      assert.equal(s.empty, `No cards match “${word}”.`, `no done idea matches (${s.keys})`);
    });
  });
}

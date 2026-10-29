import assert from "node:assert/strict";
import { ADA, S, SEND, closing, codeFor, hostOf, listButton, openForm, signed, tag, thread, threadShown, titled, visit, write } from "../../render/web/us-lib/report.mjs";

async function p99(kit, args) {
  const out = await kit.p99(args);
  assert.equal(out.code, 0, `p99 ${args.join(" ")}\nstdout: ${out.stdout}\nstderr: ${out.stderr}`);
  return out;
}

const keyOf = (out) => {
  const made = JSON.parse(out.stdout);
  return (made.card ?? made.issue ?? made).key;
};

const groups = (p) =>
  p.evaluate(() => {
    const res = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list] .p99-results");
    if (!res || res.querySelector(".p99-rows-wait") || res.hasAttribute("aria-busy")) return null;
    const keysOf = (ol) => (ol ? Array.from(ol.querySelectorAll(":scope > li .p99-key"), (k) => k.textContent) : []);
    const box = res.querySelector(".p99-groups");
    if (!box) return { grouped: false, here: [], rest: keysOf(res.querySelector(".p99-items")) };
    const lists = box.querySelectorAll(":scope > ol");
    return { grouped: true, here: keysOf(lists[0]), rest: keysOf(lists[1]) };
  });

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-find-001 items filed without a page never count on the home page", async () => {
    const owner = await codeFor(kit, shop, ADA, true);
    const counts = async (path) => {
      const me = await kit.browse("GET", `/me?path=${encodeURIComponent(path)}`, owner, undefined, shop);
      assert.equal(me.status, 200, JSON.stringify(me.json));
      return me.json.counts.page_open;
    };
    const onPage = async (path) =>
      (await signed(kit, "GET", `/issues?host=${shop}&scope=page&status=open&limit=100&path=${encodeURIComponent(path)}`)).json.issues.map((i) => i.key);
    const homeBefore = await counts("/");
    const checkoutBefore = await counts("/checkout");

    const card = keyOf(await p99(kit, ["card", "new", "--project", "Shop", "--host", shop, "--title", tag("Move the receipts to their own page"), "--json"]));
    const bare = keyOf(await p99(kit, ["file", shop, "--kind", "bug", "--title", tag("The receipts export is slow"), "--json"]));
    const placed = keyOf(await p99(kit, ["file", shop, "--kind", "bug", "--title", tag("Pay stays grey on checkout"), "--page", "/checkout", "--json"]));

    const filed = (await thread(kit, bare)).issue;
    assert.equal(filed.page.path, "", "p99 file without --page stores no page");
    assert.equal(filed.page.url, `https://${shop}/`);
    assert.equal((await thread(kit, card)).issue.page.path, "", "a card stores no page");
    assert.equal((await thread(kit, placed)).issue.page.path, "/checkout");
    const shown = (await p99(kit, ["show", bare, "--host", shop])).stdout;
    assert.ok(!shown.includes("page:"), `p99 show names no page for it:\n${shown}`);
    assert.ok((await p99(kit, ["show", placed, "--host", shop])).stdout.includes(`page: https://${shop}/checkout`));

    const reported = tag("The logo overlaps the menu on the home page");
    const { p } = await visit(kit, shop, { code: owner, path: "/" });
    let panel;
    await closing(p, async () => {
      await openForm(p);
      await write(p, reported);
      await p.locator(SEND).click();
      await threadShown(p);
      [panel] = await titled(kit, reported);
      assert.ok(panel, "the panel report on / is filed");
      assert.equal(panel.page.path, "/");
    });

    assert.equal(await counts("/"), homeBefore + 1, "only the panel report counts on /");
    assert.equal(await counts("/checkout"), checkoutBefore + 1, "p99 file --page /checkout counts on /checkout");
    const home = await onPage("/");
    assert.ok(home.includes(panel.key), `the panel report is on / (${home})`);
    assert.ok(!home.includes(card) && !home.includes(bare), `the card and the bare p99 file are not on / (${home})`);
    assert.ok((await onPage("/checkout")).includes(placed), "p99 file --page /checkout is on /checkout");

    const q = (await visit(kit, shop, { code: owner, path: "/" })).p;
    await closing(q, async () => {
      await kit.until("the page count", async () =>
        q.evaluate(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f) .n.v")?.textContent || null),
      );
      await listButton(q).click();
      await q.locator(S("[data-view=list] .p99-results")).waitFor({ timeout: 20000 });
      await q.locator(S(".p99-tabs a[data-scope=all]")).click();
      const g = await kit.until("the grouped list", async () => {
        const x = await groups(q);
        return x && x.grouped && x.here.includes(panel.key) ? x : null;
      });
      assert.ok(!g.here.includes(card), `the card is not On this page (${g.here})`);
      assert.ok(!g.here.includes(bare), `the bare p99 file is not On this page (${g.here})`);
      assert.ok(!g.here.includes(placed), `the /checkout item is not On this page on / (${g.here})`);
    });
  });
}

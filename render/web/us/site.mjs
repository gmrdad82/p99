import assert from "node:assert/strict";
import {
  GRACE,
  S,
  SEND,
  apart,
  brokenImages,
  closing,
  codeFor,
  fileBytes,
  guardedOwner,
  hostOf,
  lockedVisit,
  openForm,
  passCode,
  plus,
  previewSrc,
  readImage,
  rectOf,
  shotReady,
  tag,
  thread,
  threadShown,
  titled,
  violations,
  viewportWidth,
  write,
} from "../us-lib/report.mjs";

function watchPolicy() {
  window.__p99Violations = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__p99Violations.push(`${e.violatedDirective} ${e.blockedURI}`));
}

const roots = (p) => p.evaluate(() => document.querySelectorAll("p99-root").length);
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-site-001 the one tag shows the plus under a strict csp and keeps it across page swaps", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const p = await kit.page();
    await closing(p, async () => {
      await p.addInitScript(watchPolicy);
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e && e.message)));
      const page = await p.goto(`${kit.siteUrl(shop, "/strict.html")}#p99=${code}`);
      assert.equal(page.status(), 200, "the strict sample page is served");
      const policy = await p.evaluate(() => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content || "");
      assert.ok(/script-src 'self'/.test(policy) && !/unsafe-inline|unsafe-eval/.test(policy), policy);
      await plus(p).waitFor({ timeout: 20000 });
      await openForm(p);
      assert.deepEqual(await p.evaluate(() => window.__p99Violations), [], "nothing P99 does breaks the policy");

      await p.evaluate(() => {
        const fresh = document.createElement("body");
        fresh.innerHTML = "<main><h1>Order 1042</h1><p>Shipped.</p></main>";
        document.body.replaceWith(fresh);
      });
      await plus(p).waitFor({ timeout: 10000 });
      await frames(p);
      assert.equal(await roots(p), 1, "a body swap keeps exactly one +");

      await p.evaluate(() => {
        history.pushState({}, "", "/orders/1043");
        document.querySelector("main").innerHTML = "<h1>Order 1043</h1><p>Packed.</p>";
      });
      await frames(p);
      await p.evaluate(() => {
        history.back();
        document.querySelector("main").innerHTML = "<h1>Order 1042</h1><p>Shipped.</p>";
      });
      await frames(p);
      await plus(p).waitFor({ timeout: 10000 });
      assert.equal(await roots(p), 1, "a history move keeps exactly one +");
      assert.deepEqual(await p.evaluate(() => window.__p99Violations), [], "still no policy violation");
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-site-001 under a self only header policy the screenshot previews masked and files with no violation", async () => {
    const owner = await guardedOwner(kit, shop);
    const { p, errors, blocked } = await lockedVisit(kit, shop, owner.code);
    await closing(p, async () => {
      await passCode(kit, p, owner.key);
      await shotReady(p);
      const width = await viewportWidth(p);
      const card = await rectOf(p, ".card-number");
      const heading = await rectOf(p, "main h1");
      const preview = await p.evaluate(({ card, heading, width }) => {
        const c = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-shot[data-role=screenshot] canvas");
        const k = c.width / width;
        const g = c.getContext("2d");
        const mean = (r) => {
          const d = g.getImageData(Math.round(r.x * k) + 2, Math.round(r.y * k) + 2, Math.max(1, Math.round(r.w * k) - 4), Math.max(1, Math.round(r.h * k) - 4)).data;
          const sum = [0, 0, 0];
          let lo = 255, hi = 0;
          for (let i = 0; i < d.length; i += 4) {
            for (let j = 0; j < 3; j++) sum[j] += d[i + j];
            lo = Math.min(lo, d[i]);
            hi = Math.max(hi, d[i]);
          }
          return { mean: sum.map((v) => Math.round(v / (d.length / 4))), spread: hi - lo };
        };
        return { w: c.width, h: c.height, role: c.getAttribute("role"), label: c.getAttribute("aria-label"), card: mean(card), heading: mean(heading) };
      }, { card, heading, width });
      assert.ok(preview.w > 100 && preview.h > 50, JSON.stringify(preview));
      assert.equal(preview.role, "img");
      assert.equal(preview.label, "Preview");
      assert.ok(apart(preview.card.mean, [59, 125, 216]) < 40, `the masked card number is covered: ${JSON.stringify(preview.card)}`);
      assert.ok(preview.heading.spread > 60, `the heading's text shows in the preview: ${JSON.stringify(preview.heading)}`);

      const title = tag("Order 1043 shows the wrong total");
      await write(p, title);
      await p.locator(SEND).click();
      await threadShown(p);
      const [item] = await titled(kit, title);
      assert.ok(item, "the report is filed");
      const shot = (await thread(kit, item.key)).attachments.find((a) => a.role === "screenshot");
      assert.ok(shot && shot.bytes > 1000, `the screenshot went with it: ${JSON.stringify(shot)}`);
      await p.waitForFunction(() => {
        const c = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] .p99-shot[data-role=screenshot] canvas");
        return c && c.width > 1;
      }, null, { timeout: 20000 });

      const blank = await kit.page();
      await closing(blank, async () => {
        const src = `data:${shot.type};base64,${(await fileBytes(kit, shot.id)).toString("base64")}`;
        const sent = await readImage(blank, { src, width, rects: [card, heading] });
        assert.ok(apart(sent.means[0], [59, 125, 216]) < 40, `the filed screenshot covers the card number: ${JSON.stringify(sent.means)}`);
        assert.ok(sent.spreads[1] > 60, `the filed screenshot shows the heading: ${JSON.stringify(sent.spreads)}`);
      });
      assert.deepEqual(await brokenImages(p), [], "no broken image in the panel or the board");
      assert.deepEqual(await violations(p), [], "nothing P99 does breaks the policy");
      assert.deepEqual(blocked, []);
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-site-001 under a self only header policy the reporter can show the masked areas with no violation", async () => {
    const owner = await guardedOwner(kit, shop);
    const { p, errors, blocked } = await lockedVisit(kit, shop, owner.code);
    await closing(p, async () => {
      await passCode(kit, p, owner.key);
      await shotReady(p);
      const width = await viewportWidth(p);
      const rects = [await rectOf(p, ".card-number")];
      const hide = p.locator(S(".p99-new input[name=mask]"));
      const blank = await kit.page();
      const read = async () => readImage(blank, { src: await previewSrc(p, ".p99-shot[data-role=screenshot] canvas"), width, rects });
      assert.ok((await hide.isVisible()) && (await hide.isChecked()), "the host's masks are hidden by default");
      const masked = await read();
      assert.ok(apart(masked.means[0], [59, 125, 216]) < 40, `the card line is covered: ${JSON.stringify(masked)}`);
      await hide.uncheck();
      await p.waitForFunction(() => {
        const f = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new");
        return f && !f.querySelector(".p99-shot-wait") && f.querySelector(".p99-shot[data-role=screenshot] canvas") && !f.querySelector("input[name=mask]").disabled;
      }, null, { timeout: 30000 });
      const shown = await read();
      assert.ok(shown.spreads[0] > 60 && apart(shown.means[0], [59, 125, 216]) >= 40, `the card line's text shows: ${JSON.stringify(shown)}`);
      await hide.check();
      const again = await read();
      assert.ok(apart(again.means[0], [59, 125, 216]) < 40, `the card line is covered again: ${JSON.stringify(again)}`);
      await blank.close();
      assert.deepEqual(await violations(p), [], "nothing P99 does breaks the policy");
      assert.deepEqual(blocked, []);
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-site-001 a visitor without a code gets no plus and the loader reads nothing", async () => {
    const p = await kit.page();
    await closing(p, async () => {
      const asked = [];
      p.on("request", (r) => {
        const path = new URL(r.url()).pathname;
        if (path.startsWith("/_p99/")) asked.push(path);
      });
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e && e.message)));
      await p.goto(kit.siteUrl(shop, "/checkout"));
      await p.waitForLoadState("load");
      await frames(p);
      await frames(p);
      assert.equal(await roots(p), 0, "no + is drawn");
      assert.deepEqual(asked, ["/_p99/p99.js"], "only the tag itself is fetched: no panel, no API call");
      const stored = await p.evaluate(() => {
        const keys = [];
        for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) keys.push(store.key(i));
        return keys.filter((k) => k.startsWith("p99"));
      });
      assert.deepEqual(stored, [], "nothing is stored");
      assert.equal(await p.evaluate(() => typeof window.P99), "object", "the one global is there for a later code link");
      assert.deepEqual(errors, []);
    });
  });
}

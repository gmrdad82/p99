import assert from "node:assert/strict";
import { GRACE, closing, codeFor, hostOf, openForm, plus } from "../us-lib/report.mjs";

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

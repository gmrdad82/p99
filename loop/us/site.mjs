import assert from "node:assert/strict";
import { CONTRAST, GRACE, closing, codeFor, hostOf, openForm, signed, visit } from "../../render/web/us-lib/report.mjs";

const THEME = { accent: "#1d2b6b", raised: "#ffffff", base: "#fafafa", ink: "#111111" };

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-site-001 the plus stays readable in dark mode on an accent theme", async () => {
    const themed = Object.entries(THEME).flatMap(([k, v]) => ["--theme", `${k}=${v}`]);
    const cleared = Object.keys(THEME).flatMap((k) => ["--theme", `${k}=`]);
    try {
      const set = await kit.p99(["hosts", "set", shop, ...themed]);
      assert.equal(set.code, 0, set.stderr);
      const pushed = (await signed(kit, "GET", "/hosts")).json.hosts.find((h) => h.host === shop);
      assert.equal(pushed.config.theme.accent, THEME.accent, "the theme reached the Worker");
      const code = await codeFor(kit, shop, GRACE);
      for (const scheme of ["dark", "light"]) {
        const { p } = await visit(kit, shop, { code, scheme });
        await closing(p, async () => {
          await openForm(p);
          const look = await p.evaluate((src) => {
            const contrast = eval(src);
            const r = document.querySelector("p99-root").shadowRoot;
            const plus = getComputedStyle(r.querySelector(".w .f"));
            const panel = getComputedStyle(r.querySelector(".p99-panel.is-open"));
            const title = getComputedStyle(r.querySelector(".p99-panel.is-open h2"));
            return { plus: contrast(plus.color, plus.backgroundColor), title: contrast(title.color, panel.backgroundColor), raised: plus.backgroundColor };
          }, CONTRAST);
          if (scheme === "dark") {
            assert.ok(look.plus >= 3, `dark: the + at 3:1 or better (${JSON.stringify(look)})`);
            assert.ok(look.title >= 4.5, `dark: the panel's title at 4.5:1 or better (${JSON.stringify(look)})`);
          } else {
            assert.equal(look.raised, "rgb(255, 255, 255)", "light: the site's raised colour stays on the +");
          }
        });
      }
    } finally {
      await kit.p99(["hosts", "set", shop, ...cleared]);
    }
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  GRACE,
  NO_SHOT,
  SEND,
  apart,
  asData,
  closing,
  codeFor,
  fileBytes,
  hostOf,
  inPage,
  openForm,
  previewSrc,
  readImage,
  rectOf,
  shotReady,
  signed,
  tag,
  thread,
  threadShown,
  titled,
  viewportWidth,
  visit,
  write,
} from "../../render/web/us-lib/report.mjs";

const COLOURS = { magenta: [255, 0, 255], green: [0, 255, 0], cyan: [0, 255, 255], orange: [255, 165, 0] };

async function p99(kit, args) {
  const out = await kit.p99(args);
  assert.equal(out.code, 0, `p99 ${args.join(" ")}: ${out.stderr}`);
  return out;
}

async function workerConfig(kit, host) {
  const found = (await signed(kit, "GET", "/hosts")).json.hosts.find((h) => h.host === host);
  assert.ok(found, `the Worker has no host ${host}`);
  return found.config || {};
}

function plant(p) {
  return p.evaluate(() => {
    const box = (css, attrs = {}) => {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;z-index:2147480000;${css}`;
      for (const k in attrs) d.setAttribute(k, attrs[k]);
      return d;
    };
    const masked = box("left:24px;top:120px;width:120px;height:120px;background:#ff00ff;color:#00ff00;font:700 20px system-ui", { class: "us-private" });
    masked.textContent = "Ada's customer";
    const child = document.createElement("div");
    child.id = "us-private-child";
    child.style.cssText = "position:absolute;left:30px;top:50px;width:60px;height:60px;background:#00ff00";
    masked.append(child);
    const second = box("left:168px;top:120px;width:120px;height:120px;background:#00ffff", { id: "us-private-two" });
    const control = box("left:312px;top:120px;width:120px;height:120px;background:linear-gradient(#ffa500 0 50%, #ffffff 50% 100%)", { id: "us-control" });
    document.body.append(masked, second, control);
  });
}

function hidden(read, what) {
  const [masked, child, second, control] = read.spreads;
  assert.ok(masked >= 0 && masked <= 30, `${what}: the masked area is one solid block (${JSON.stringify(read)})`);
  assert.ok(child >= 0 && child <= 30, `${what}: the child inside it is too (${JSON.stringify(read)})`);
  assert.ok(second >= 0 && second <= 30, `${what}: the second selector's area is too (${JSON.stringify(read)})`);
  assert.ok(control > 80, `${what}: the unmasked area still shows, so the read can fail (${JSON.stringify(read)})`);
  const [maskedMean, childMean, secondMean, controlMean] = read.means;
  assert.ok(apart(maskedMean, childMean) <= 12 && apart(maskedMean, secondMean) <= 12, `${what}: the masked areas and the child are painted one colour (${JSON.stringify(read.means)})`);
  assert.ok(apart(maskedMean, controlMean) > 12, `${what}: the control is not that colour (${JSON.stringify(read.means)})`);
  assert.equal(read.counts.magenta, 0, `${what}: no magenta from the masked area`);
  assert.equal(read.counts.green, 0, `${what}: no green from its child`);
  assert.equal(read.counts.cyan, 0, `${what}: no cyan from the second area`);
  assert.ok(read.counts.orange > 500, `${what}: the control's orange shows (${read.counts.orange})`);
}

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-report-002 a hosts mask selectors and their children never reach the image", async () => {
    try {
      await p99(kit, ["hosts", "set", shop, "--mask", ".us-private", "--mask", "#us-private-two"]);
      assert.deepEqual((await workerConfig(kit, shop)).mask, [".us-private", "#us-private-two"]);
      const code = await codeFor(kit, shop, GRACE);
      const { p } = await visit(kit, shop, { code });
      await closing(p, async () => {
        await plant(p);
        const width = await viewportWidth(p);
        const rects = [];
        for (const q of [".us-private", "#us-private-child", "#us-private-two", "#us-control"]) rects.push(await rectOf(p, q));
        await openForm(p);
        await shotReady(p);
        hidden(await readImage(p, { src: await previewSrc(p, ".p99-shot[data-role=screenshot] canvas"), width, rects, colours: COLOURS }), "the preview");
        const title = tag("Private areas stay private");
        await write(p, title);
        await p.locator(SEND).click();
        await threadShown(p);
        const [item] = await titled(kit, title);
        assert.ok(item, "the report is filed");
        const shot = (await thread(kit, item.key)).attachments.find((a) => a.role === "screenshot");
        assert.ok(shot, "it carries a screenshot");
        hidden(await readImage(p, { src: asData(await fileBytes(kit, shot.id), shot.type), width, rects, colours: COLOURS }), "the stored screenshot");
      });
      await p99(kit, ["hosts", "set", shop, "--mask", "none"]);
      assert.deepEqual((await workerConfig(kit, shop)).mask ?? [], [], "--mask none clears the list");
    } finally {
      await kit.p99(["hosts", "set", shop, "--mask", "none"]);
    }
  });

  await kit.check("us-report-002 capture off files the text report with no screenshot and says so", async () => {
    try {
      await p99(kit, ["hosts", "set", shop, "--capture", "off"]);
      assert.equal((await workerConfig(kit, shop)).capture, "off");
      const code = await codeFor(kit, shop, GRACE);
      const { p } = await visit(kit, shop, { code });
      await closing(p, async () => {
        const puts = [];
        p.on("request", (r) => r.method() === "PUT" && /\/attachments\//.test(new URL(r.url()).pathname) && puts.push(r.url()));
        await openForm(p);
        const form = await p.evaluate(() => {
          const f = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new");
          return { capture: !!f.querySelector(".p99-capture"), mark: !!f.querySelector(".p99-mark-start"), note: f.querySelector(".p99-no-shot")?.textContent ?? null };
        });
        assert.deepEqual(form, { capture: false, mark: false, note: NO_SHOT });
        const title = tag("Filed with capture off");
        await write(p, title, "The total stays at zero.");
        await p.locator(SEND).click();
        await threadShown(p);
        const [item] = await titled(kit, title);
        assert.ok(item, "the text report is filed");
        const t = await thread(kit, item.key);
        assert.equal(t.issue.body, "The total stays at zero.");
        assert.deepEqual(t.attachments, [], "no image is stored");
        assert.deepEqual(puts, [], "no image is sent");
        const forced = await inPage(p, "PUT", `/issues/${item.key}/attachments/${randomUUID()}?role=screenshot&name=shot.png`, code, "not an image", "image/png");
        assert.equal(forced.status, 403, `a screenshot sent straight to the Worker is refused (${forced.text})`);
        assert.equal((await thread(kit, item.key)).attachments.length, 0);
      });
    } finally {
      await kit.p99(["hosts", "set", shop, "--capture", "on"]);
    }
  });

  await kit.check("us-report-002 a mask selector that does not parse is refused and the old masks stay", async () => {
    try {
      await p99(kit, ["hosts", "set", shop, "--mask", ".us-kept"]);
      const bad = "::not a selector(";
      const out = await kit.p99(["hosts", "set", shop, "--mask", bad]);
      assert.notEqual(out.code, 0, "a broken selector fails");
      assert.ok(out.stderr.includes(`${bad} is not a CSS selector`), `the refusal names it: ${out.stderr}`);
      assert.deepEqual((await workerConfig(kit, shop)).mask, [".us-kept"], "the Worker keeps the old masks");
      const listed = JSON.parse((await p99(kit, ["hosts", "--json"])).stdout).hosts.find((h) => h.host === shop);
      assert.deepEqual(listed.config.mask, [".us-kept"], "the config keeps the old masks");
      assert.equal(listed.masks, 1);
    } finally {
      await kit.p99(["hosts", "set", shop, "--mask", "none"]);
    }
  });
}

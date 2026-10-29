import assert from "node:assert/strict";
import { S, VERIFY_INPUT, brokenImages, closing, guardedOwner, hostOf, listButton, lockedVisit, passCode, plus, signed, violations } from "../us-lib/report.mjs";

const FORM = S(".p99-new input[name=title]");
const asked = (p) => p.locator(VERIFY_INPUT).count();
const live = (p) =>
  p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board.is-open .p99-live")?.dataset.state === "live", null, { timeout: 20000 });

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-verify-001 the code is asked once and every later open the list the board and a reload trust the browser", async () => {
    const owner = await guardedOwner(kit, shop);
    const filed = await kit.file(shop, { title: "The receipt mail never arrives" });
    await signed(kit, "PATCH", `/issues/${filed.key}`, { assignee: "me" });
    const codes = [];
    const { p, errors, blocked } = await lockedVisit(kit, shop, owner.code);
    p.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/_p99/api/")) codes.push(`${u.pathname} ${(r.headers()["x-p99-code"] || "").includes(".") ? "trusted" : "bare"}`);
    });
    await closing(p, async () => {
      await passCode(kit, p, owner.key);
      await p.locator(FORM).waitFor({ timeout: 20000 });
      await listButton(p).waitFor({ state: "visible", timeout: 20000 });
      codes.length = 0;

      await p.keyboard.press("Escape");
      await plus(p).click();
      await p.locator(FORM).waitFor({ timeout: 20000 });
      assert.equal(await asked(p), 0, "a second + goes straight to the form");

      await p.keyboard.press("Escape");
      await listButton(p).click();
      await p.locator(S("[data-view=list]")).waitFor({ timeout: 20000 });
      assert.equal(await asked(p), 0, "the list opens without the 6 digits");

      await p.evaluate((key) => window.P99.open(key), filed.key);
      await p.locator(S("[data-view=item] .p99-disc svg")).waitFor({ timeout: 20000 });

      await p.locator("p99-root .p99-board-open").click();
      await live(p);
      await p.locator(`p99-root .p99-card[data-id="${filed.key}"] .p99-who svg`).waitFor({ timeout: 20000 });
      assert.equal(await asked(p), 0, "the board loads and goes live without the 6 digits");
      assert.deepEqual(await brokenImages(p), [], "the board's faces draw under the policy");

      await p.reload();
      await listButton(p).waitFor({ state: "visible", timeout: 20000 });
      await plus(p).click();
      await p.locator(FORM).waitFor({ timeout: 20000 });
      assert.equal(await asked(p), 0, "a reload keeps the browser trusted");

      assert.deepEqual(codes.filter((c) => c.endsWith("bare")), [], "after the 6 digits no call goes out without the browser's device");
      assert.deepEqual(await brokenImages(p), [], "no broken image in the panel or the board");
      assert.deepEqual(await violations(p), [], "nothing P99 does breaks the policy");
      assert.deepEqual(blocked, []);
      assert.deepEqual(errors, []);
    });
  });
}

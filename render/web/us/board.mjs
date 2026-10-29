import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ADA, LANE_WORDS, MARY, card, cast, closePage, openBoard, openPanel, people, report, shown, tag } from "../../../loop/triage-lib.mjs";

const BUDGET = 1000 / 120;
const LONG = 80;

function instrument() {
  self.__frames = [];
  self.__bench = false;
  let began = 0;
  const probe = document.createElement("i");
  probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none";
  const watch = new ResizeObserver(() => {
    if (!began) return;
    self.__frames.push(performance.now() - began);
    began = 0;
  });
  addEventListener("DOMContentLoaded", () => document.documentElement.append(probe));
  addEventListener(
    "pointermove",
    () => {
      if (!self.__bench || began) return;
      began = performance.now();
      requestAnimationFrame(() => {
        watch.unobserve(probe);
        watch.observe(probe);
      });
    },
    true,
  );
}

const inLane = (page, word, key) =>
  page.waitForFunction(
    ([lane, id]) => !!document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-word=${lane}] .p99-card[data-id="${id}"]`),
    [word, key],
    { timeout: 15000 },
  );

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);
  const site = (code) => `${kit.siteUrl(where.shop, "/checkout")}#p99=${code}`;

  await check("us-board-001 an owners board button opens the one board and marys move shows there", async () => {
    const t = tag();
    const { ada, grace } = await people(kit);
    const mine = await card(kit, "Shop", `Board me ${t}`);
    const page = await kit.page();
    try {
      await openPanel(page, site(ada));
      await openBoard(page);
      const first = await shown(page);
      assert.deepEqual(first.lanes, LANE_WORDS);
      assert.ok(first.byLane.new.includes(mine.key), JSON.stringify(first.byLane));

      const moved = await kit.call("POST", "/_p99/v1/move", { actor: MARY, body: { key: mine.key, from: "New", to: "planned" } });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      await inLane(page, "planned", mine.key);

      await page.locator(`p99-root .p99-card[data-id="${mine.key}"]`).focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await inLane(page, "in-progress", mine.key);
      const stored = await kit.call("GET", `/_p99/v1/cards/${mine.key}`, { actor: ADA });
      assert.equal(stored.json.card.status, "in-progress", JSON.stringify(stored.json));
    } finally {
      await closePage(page);
    }

    await report(kit, where.shop, `Grace's own report ${t}`);
    const visitor = await kit.page();
    try {
      await openPanel(visitor, site(grace));
      const board = await visitor.evaluate(() => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-open"));
      assert.equal(board, false, "a User has no Board button");
    } finally {
      await closePage(visitor);
    }
  });

  await check("us-board-001 a board that fails to load says so and retry paints it", async () => {
    const { ada } = await people(kit);
    const page = await kit.page();
    let fail = true;
    try {
      await page.route(
        (url) => url.pathname === "/_p99/api/board",
        (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the database is busy" }) }) : route.continue()),
      );
      await openPanel(page, site(ada));
      await openBoard(page);
      const state = await page.evaluate(() => {
        const r = document.querySelector("p99-root").shadowRoot;
        return { text: r.querySelector(".p99-board-state p")?.textContent, retry: !!r.querySelector(".p99-board-state button"), role: r.querySelector(".p99-board-state")?.getAttribute("role") };
      });
      assert.deepEqual(state, { text: "the database is busy", retry: true, role: "alert" });
      fail = false;
      await page.locator("p99-root .p99-board-state button").click();
      await page.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col[data-label]").length === 7, null, { timeout: 15000 });
    } finally {
      await closePage(page);
    }
  });

  await check("us-board-001 a drag in a lane of eighty cards stays smooth and drops in place", async () => {
    const t = tag();
    const { ada } = await people(kit);
    for (let from = 0; from < LONG; from += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, at) =>
          kit.call("POST", `/_p99/v1/cards?host=${where.shop}`, { actor: ADA, body: { client_uid: randomUUID(), project: "Shop", title: `Long lane ${t} ${from + at}`, host: where.shop } }),
        ),
      );
      for (const made of batch) assert.equal(made.status, 201, JSON.stringify(made.json));
    }
    const page = await kit.page();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(instrument);
      await openPanel(page, site(ada));
      await openBoard(page);
      await page.waitForFunction(
        (n) => {
          const r = document.querySelector("p99-root").shadowRoot;
          const still = r.getAnimations().every((a) => a.playState !== "running" || a.effect.getTiming().iterations === Infinity);
          return still && r.querySelectorAll(".p99-col[data-word=new] .p99-card").length >= n;
        },
        LONG - 10,
        { timeout: 30000 },
      );

      const start = await page.evaluate(() => {
        const r = document.querySelector("p99-root").shadowRoot;
        for (const list of r.querySelectorAll(".p99-cards")) list.scrollTop = 0;
        const grabbed = r.querySelector(".p99-col[data-word=new]").querySelectorAll(".p99-card")[2];
        const at = grabbed.getBoundingClientRect();
        const box = (word) => {
          const b = r.querySelector(`.p99-col[data-word=${word}] .p99-cards`).getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        };
        return { key: grabbed.dataset.id, x: at.left + at.width / 2, y: at.top + 20, from: box("new"), to: box("planned") };
      });
      const stops = [
        [start.from.left + (start.from.right - start.from.left) / 2, start.from.bottom - 40],
        [start.from.left + (start.from.right - start.from.left) / 2, start.from.top + 60],
        [(start.to.left + start.to.right) / 2, (start.to.top + start.to.bottom) / 2],
      ];
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.evaluate(() => {
        self.__frames.length = 0;
        self.__bench = true;
      });
      let [x, y] = [start.x, start.y];
      for (const [toX, toY] of stops) {
        const steps = 60;
        for (let step = 1; step <= steps; step++) {
          await page.mouse.move(x + ((toX - x) * step) / steps, y + ((toY - y) * step) / steps);
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
        }
        [x, y] = [toX, toY];
      }
      const frames = await page.evaluate(() => {
        self.__bench = false;
        return self.__frames.splice(0);
      });
      await page.mouse.up();

      assert.ok(frames.length >= 60, `only ${frames.length} frames were measured`);
      const sorted = [...frames].sort((a, b) => a - b);
      const p99 = sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)];
      assert.ok(p99 <= BUDGET, `the drag's p99 frame took ${p99.toFixed(2)} ms, over ${BUDGET.toFixed(2)} ms`);

      await inLane(page, "planned", start.key);
      const stored = await kit.call("GET", `/_p99/v1/cards/${start.key}`, { actor: ADA });
      assert.equal(stored.json.card.status, "planned", JSON.stringify(stored.json));
    } finally {
      await closePage(page);
    }
  });
}

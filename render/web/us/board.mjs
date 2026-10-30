import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ADA, LANE_WORDS, MARY, card, cast, closePage, openBoard, openPanel, people, report, shown, tag } from "../../../loop/triage-lib.mjs";
import { bars, barsBrowser, cardIn, clear, hostBars, many, pageTheme, place, popupBoard, settled, themeOf } from "../us-lib/lanes.mjs";

const LONG_FRAME = 50;
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
      await visitor.waitForFunction((title) => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open")?.textContent.includes(title), `Grace's own report ${t}`, { timeout: 20000 });
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
      const target = await page.evaluate(() => {
        const r = document.querySelector("p99-root").shadowRoot;
        const held = r.querySelector(".p99-col[data-word=planned] .p99-card.is-placeholder");
        return held ? { before: held.previousElementSibling?.dataset.id ?? null, after: held.nextElementSibling?.dataset.id ?? null } : null;
      });
      await page.mouse.up();

      assert.ok(frames.length >= 60, `only ${frames.length} frames were measured`);
      const long = frames.filter((ms) => ms > LONG_FRAME).length;
      assert.ok(long <= Math.floor(frames.length / 100), `${long} of ${frames.length} drag frames took over ${LONG_FRAME} ms`);

      assert.ok(target, "the held card sat in the Planned lane when it was dropped");
      await inLane(page, "planned", start.key);
      const cardOf = async (key) => (await kit.call("GET", `/_p99/v1/cards/${key}`, { actor: ADA })).json.card;
      await kit.until("the server to hold the card in Planned", async () => (await cardOf(start.key)).status === "planned");
      const placed = await page.evaluate((key) => {
        const r = document.querySelector("p99-root").shadowRoot;
        const dropped = r.querySelector(`.p99-col[data-word=planned] .p99-card[data-id="${key}"]`);
        return {
          before: dropped.previousElementSibling?.dataset.id ?? null,
          after: dropped.nextElementSibling?.dataset.id ?? null,
          inNew: !!r.querySelector(`.p99-col[data-word=new] .p99-card[data-id="${key}"]`),
        };
      }, start.key);
      assert.deepEqual({ before: placed.before, after: placed.after }, target, "the card stays between the neighbours it was dropped between");
      assert.equal(placed.inNew, false, "the card left the New lane");
      const board = await kit.call("GET", "/_p99/v1/board?project=Shop&status=planned", { actor: ADA });
      assert.equal(board.status, 200, JSON.stringify(board.json));
      const orderOf = (key) => board.json.cards.find((c) => c.key === key)?.order;
      const own = orderOf(start.key);
      assert.ok(typeof own === "string" && own.length > 0, String(own));
      if (target.before) assert.ok(orderOf(target.before) < own, "the server orders it after the card above");
      if (target.after) assert.ok(own < orderOf(target.after), "the server orders it before the card below");
    } finally {
      await closePage(page);
    }
  });

  const PLAIN = Buffer.from("steps: open the cart, pay, wait\n");
  const cardForm = (root) => `${root} >> .p99-panel.is-open .p99-new[data-view=card]`;
  const projectsOffered = (page, host) =>
    page.waitForFunction(
      (sel) => {
        const r = document.querySelector(sel)?.shadowRoot;
        const s = r && r.querySelector(".p99-panel.is-open .p99-new[data-view=card] select[name=project]");
        return s && s.options.length ? { names: Array.from(s.options, (o) => o.value), chosen: s.value } : null;
      },
      host,
      { timeout: 20000 },
    ).then((h) => h.jsonValue());
  const shape = (page, host) =>
    page.evaluate((sel) => {
      const f = document.querySelector(sel).shadowRoot.querySelector(".p99-panel.is-open .p99-new[data-view=card]");
      return {
        title: f.querySelector("#p99-title").textContent,
        capture: !!f.querySelector(".p99-capture, .p99-no-shot"),
        privacy: !!f.querySelector(".p99-privacy"),
        kinds: Array.from(f.querySelectorAll("input[name=kind]"), (k) => k.value),
        files: !!f.querySelector("input[name=files]"),
      };
    }, host);

  await check("us-board-002 an owner files a card from the pages board into a chosen project with a file", async () => {
    const t = tag();
    const mail = `ada.cards.${t}@example.com`;
    const made = await kit.call("POST", "/_p99/v1/codes", { actor: ADA, body: { name: "Ada Lovelace", email: mail, grant: { space: true }, role: "owner", totp: true, mail: false } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const page = await kit.page({ viewport: { width: 1280, height: 860 }, extraHTTPHeaders: { "cf-connecting-ip": "198.51.100.231" } });
    try {
      await page.goto(kit.appUrl("/"));
      await page.fill("#signin input[name=email]", mail);
      await page.fill("#signin input[name=totp]", kit.totp(made.json.totp_key));
      await page.click("#signin button[type=submit]");
      await page.waitForFunction(() => document.querySelector("p99-root.app-board")?.shadowRoot?.querySelector(".p99-board.is-page.is-open .p99-col[data-label]"), null, { timeout: 20000 });
      const narrowed = page.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/board");
      await page.click(`.app-project[data-name="${where.ops}"]`);
      await narrowed;
      const button = page.locator("p99-root.app-board .p99-board-new");
      assert.equal((await button.textContent()).replace("+", "").trim(), "New card");
      await button.click();
      await page.locator(cardForm("p99-root.app-sheet")).waitFor({ timeout: 20000 });
      const offered = await projectsOffered(page, "p99-root.app-sheet");
      assert.ok(["Shop", "Blog", where.ops].every((n) => offered.names.includes(n)), `every project is offered (${offered.names})`);
      assert.equal(offered.chosen, where.ops, "the board's project is picked");
      assert.deepEqual(await shape(page, "p99-root.app-sheet"), { title: "New card", capture: false, privacy: false, kinds: ["bug", "feature", "improvement", "question", "task"], files: true });
      const title = `Rotate the backup keys ${t}`;
      await page.locator(`${cardForm("p99-root.app-sheet")} input[name=kind][value=task]`).check();
      await page.locator(`${cardForm("p99-root.app-sheet")} input[name=title]`).fill(title);
      await page.locator(`${cardForm("p99-root.app-sheet")} textarea[name=body]`).fill("Every quarter, before the audit.");
      await page.locator(`${cardForm("p99-root.app-sheet")} input[name=files]`).setInputFiles({ name: "steps.txt", mimeType: "text/plain", buffer: PLAIN });
      const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/_p99/api/cards");
      await page.locator(`${cardForm("p99-root.app-sheet")} .p99-actions button[type=submit]`).click();
      const sent = JSON.parse((await posted).postData());
      assert.deepEqual({ project: sent.project, kind: sent.kind, title: sent.title, page: sent.page }, { project: where.ops, kind: "task", title, page: undefined });
      await page.waitForFunction((t) => document.querySelector("p99-root.app-sheet")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=item] #p99-title")?.textContent === t, title, { timeout: 20000 });
      const listed = await kit.call("GET", `/_p99/v1/cards?project=${where.ops}`, { actor: ADA });
      const filed = listed.json.cards.find((c) => c.title === title);
      assert.ok(filed, `the card is in ${where.ops} (${JSON.stringify(listed.json.cards.map((c) => c.title))})`);
      assert.equal(filed.status, "new");
      const shown = await kit.call("GET", `/_p99/v1/issues/${filed.key}`, { actor: ADA });
      const i = shown.json.issue;
      assert.equal(i.kind, "task");
      assert.equal(i.body, "Every quarter, before the audit.");
      assert.ok(!i.page || !i.page.path, `the card has no page (${JSON.stringify(i.page)})`);
      assert.equal(i.host ?? null, null, `a card filed on the P99 page has no host, as p99 card new --project gives (${i.host})`);
      const files = shown.json.attachments.filter((a) => a.role === "file");
      assert.deepEqual(files.map((a) => a.name), ["steps.txt"]);
      const bytes = await kit.call("GET", `/_p99/v1/files/${files[0].id}`, { actor: ADA });
      assert.equal(Buffer.compare(Buffer.from(await bytes.response.arrayBuffer()), PLAIN), 0, "the file reads back byte for byte");
    } finally {
      await closePage(page);
    }
  });

  await check("us-board-002 the sites board files a new card into the sites project with no page", async () => {
    const t = tag();
    const { ada } = await people(kit);
    const page = await kit.page();
    try {
      await openPanel(page, site(ada));
      await openBoard(page);
      await page.locator("p99-root .p99-board-new").click();
      await page.locator(cardForm("p99-root")).waitFor({ timeout: 20000 });
      const offered = await projectsOffered(page, "p99-root");
      assert.deepEqual(offered, { names: ["Shop"], chosen: "Shop" }, "the site's own project is the one offered");
      const title = `Move the receipts to their own page ${t}`;
      await page.locator(`${cardForm("p99-root")} input[name=title]`).fill(title);
      await page.locator(`${cardForm("p99-root")} .p99-actions button[type=submit]`).click();
      await page.waitForFunction((t) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] #p99-title")?.textContent === t, title, { timeout: 20000 });
      const listed = await kit.call("GET", "/_p99/v1/cards?project=Shop", { actor: ADA });
      const filed = listed.json.cards.find((c) => c.title === title);
      assert.ok(filed, "the card is in Shop");
      await inLane(page, "new", filed.key);
      const i = (await kit.call("GET", `/_p99/v1/issues/${filed.key}`, { actor: ADA })).json.issue;
      assert.equal(i.kind, "bug");
      assert.ok(!i.page || !i.page.path, `the card has no page (${JSON.stringify(i.page)})`);
    } finally {
      await closePage(page);
    }
  });

  const LANES_AT = "lanes.example.com";
  const LANES_IN = "Lanes";
  let laid = null;
  const lanes = () =>
    (laid ??= (async () => {
      const code = await place(kit, LANES_IN, LANES_AT);
      const t = tag();
      const planned = await many(16, (n) => cardIn(kit, LANES_IN, LANES_AT, `Planned lane card ${n + 1} ${t}`, { status: "planned" }));
      const mine = await cardIn(kit, LANES_IN, LANES_AT, `Swap the hero photo ${t}`, { status: "in-progress", assignee: "me" });
      const shipped = await many(2, (n) => cardIn(kit, LANES_IN, LANES_AT, `Shipped ${n + 1} ${t}`, { status: "done" }));
      return { code, mine, total: 19, done: 2, keys: [...planned, mine, ...shipped] };
    })());
  const lanesUrl = (path, code) => `${kit.siteUrl(LANES_AT, path)}#p99=${code}`;
  const scrolled = (p) => p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft);
  const laneAt = (p, word) =>
    p.evaluate((w) => {
      const l = document.querySelector("p99-root").shadowRoot.querySelector(`.p99-col[data-word=${w}] .p99-cards`);
      const r = l.getBoundingClientRect();
      return { at: [r.x + r.width / 2, r.y + r.height / 2], fits: l.scrollHeight <= l.clientHeight, top: l.scrollTop };
    }, word);

  await check("us-board-001 every board bar is thin and arrowless on any site", async () => {
    const { code, total } = await lanes();
    const t = tag();
    const made = await kit.call("POST", "/_p99/v1/codes", { actor: ADA, body: { name: ADA.name, email: `ada.lanes.${t}@example.com`, grant: { projects: [LANES_IN] }, role: "owner", totp: true, mail: false } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const real = await barsBrowser(kit);
    try {
      for (const scheme of ["light", "dark"]) {
        const context = await real.open({ colorScheme: scheme });
        await hostBars(context, LANES_AT);
        const p = await context.newPage();
        await popupBoard(p, lanesUrl("/locked.html", code), total);
        const policy = await p.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
        assert.match(policy || "", /default-src 'self'/, "the page sends a strict Content-Security-Policy");
        const host = await p.evaluate(() => getComputedStyle(document.body).scrollbarColor);
        assert.notEqual(host, "auto", "the strict page colours every scrollbar");
        const b = await bars(p);
        assert.ok(b.wide && b.cols > 0 && b.cols <= 8, `${scheme}: the pop-up board's lanes bar is P99's thin bar (${JSON.stringify(b)})`);
        assert.ok(b.lanes.length > 0 && b.lanes.every((w) => w > 0 && w <= 8), `${scheme}: a full lane's bar is at most 8px (${JSON.stringify(b)})`);
        assert.ok(b.colours.every((c) => c === "auto") && b.widths.every((w) => w === "auto"), `${scheme}: the site's scrollbar colour never reaches the board, so the arrowless WebKit bars draw (${JSON.stringify(b)})`);
        await context.close();
      }
      const context = await real.open({ viewport: { width: 1024, height: 768 }, extraHTTPHeaders: { "cf-connecting-ip": "198.51.100.147" } });
      const p = await context.newPage();
      await p.goto(kit.appUrl("/"));
      await p.fill("#signin input[name=email]", `ada.lanes.${t}@example.com`);
      await p.fill("#signin input[name=totp]", kit.totp(made.json.totp_key));
      await p.click("#signin button[type=submit]");
      await p.waitForFunction((n) => (document.querySelector("p99-root.app-board")?.shadowRoot?.querySelectorAll(".p99-board.is-page.is-open .p99-cols .p99-card").length ?? 0) >= n, total, { timeout: 20000 });
      await settled(p, "p99-root.app-board");
      const b = await bars(p, "p99-root.app-board");
      assert.ok(b.wide && b.cols > 0 && b.cols <= 8, `the P99 page's lanes bar is thin (${JSON.stringify(b)})`);
      assert.ok(b.lanes.length > 0 && b.lanes.every((w) => w > 0 && w <= 8), `the P99 page's full lane bar is at most 8px (${JSON.stringify(b)})`);
      await context.close();
    } finally {
      await real.close();
    }
  });

  await check("us-board-001 both wheels move the lanes sideways", async () => {
    const { code, total } = await lanes();
    const p = await kit.page({ viewport: { width: 1024, height: 768 } });
    try {
      await popupBoard(p, lanesUrl("/checkout", code), total);
      const empty = await laneAt(p, "new");
      assert.ok(empty.fits, "the New lane is empty");
      assert.equal(await scrolled(p), 0);
      await p.mouse.move(...empty.at);
      await p.mouse.wheel(0, 300);
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft > 0, null, { timeout: 5000 }).catch(() => assert.fail("the vertical wheel over an empty lane moves the lanes sideways"));
      await p.evaluate(() => {
        document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft = 0;
      });
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft === 0);
      const full = await laneAt(p, "planned");
      assert.ok(!full.fits && full.top === 0, "the Planned lane overflows");
      await p.mouse.move(...full.at);
      await p.mouse.wheel(0, 300);
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-col[data-word=planned] .p99-cards").scrollTop > 0, null, { timeout: 5000 }).catch(() => assert.fail("the vertical wheel over a full lane scrolls its cards"));
      assert.equal(await scrolled(p), 0, "the vertical wheel over a full lane scrolls its cards and leaves the lanes where they are");
      await p.mouse.wheel(60, 0);
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-cols").scrollLeft > 0, null, { timeout: 5000 }).catch(() => assert.fail("the sideways wheel over a full lane moves the lanes"));
    } finally {
      await closePage(p);
    }
  });

  await check("us-board-001 a narrow window scrolls the lanes inside the board", async () => {
    const { code, total } = await lanes();
    for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 600 }]) {
      const p = await kit.page({ viewport });
      try {
        await popupBoard(p, lanesUrl("/checkout", code), total);
        const fit = await p.evaluate(() => {
          const r = document.querySelector("p99-root").shadowRoot;
          const b = r.querySelector(".p99-board").getBoundingClientRect();
          const c = r.querySelector(".p99-cols");
          const before = c.scrollLeft;
          c.scrollLeft = c.scrollWidth;
          const after = c.scrollLeft;
          scrollTo(400, 0);
          return {
            page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
            pageX: scrollX,
            inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
            wide: c.scrollWidth > c.clientWidth,
            moved: after > before,
          };
        });
        assert.deepEqual(fit, { page: true, pageX: 0, inside: true, wide: true, moved: true }, `${viewport.width}x${viewport.height}`);
      } finally {
        await closePage(p);
      }
    }
  });

  await check("us-board-001 a dark mode board on a light page keeps one theme", async () => {
    const { code, total } = await lanes();
    for (const [page, scheme] of [["light", "light"], ["light", "dark"], ["dark", "dark"], ["dark", "light"]]) {
      const p = await kit.page({ colorScheme: scheme });
      try {
        await pageTheme(p.context(), page);
        await popupBoard(p, lanesUrl("/checkout", code), total);
        assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).colorScheme), page, "the page keeps its own theme");
        await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 20000 });
        for (const bare of [false, true]) {
          const at = `a ${page} page in a ${scheme} browser${bare ? ", the texture not loaded" : ""}`;
          const seen = await themeOf(p, "p99-root", bare);
          assert.ok(seen.title >= 4.5 && seen.live >= 4.5, `${at}: the title and LIVE read at 4.5:1 or more ${JSON.stringify(seen)}`);
          assert.ok(seen.ground === scheme && seen.cards === scheme, `${at}: the ground and the cards are both ${scheme} ${JSON.stringify(seen)}`);
        }
      } finally {
        await closePage(p);
      }
    }
  });

  await check("us-board-001 a web card names its project and assignee and the header counts done", async () => {
    const { code, mine, total, done } = await lanes();
    const p = await kit.page();
    try {
      await popupBoard(p, lanesUrl("/checkout", code), total);
      const head = await p.evaluate((key) => {
        const r = document.querySelector("p99-root").shadowRoot;
        const roll = r.querySelector(".p99-roll");
        const feet = Array.from(r.querySelectorAll(".p99-cols .p99-card"), (e) => {
          const foot = e.querySelector(".p99-card-foot");
          const who = e.querySelector(".p99-who");
          const project = e.querySelector(".p99-card-project");
          return {
            key: e.dataset.id,
            foot: !!foot,
            last: !foot || e.lastElementChild === foot,
            who: who ? who.parentElement === foot && who.title : null,
            project: project ? project.parentElement === foot && project.textContent : null,
            top: e.querySelector(".p99-card-top").children.length,
            right: !who || !project || who.getBoundingClientRect().left > project.getBoundingClientRect().right,
          };
        });
        return {
          text: roll.textContent,
          hidden: roll.hidden,
          title: roll.title,
          done: r.querySelectorAll(".p99-col[data-closes] .p99-card").length,
          total: r.querySelectorAll(".p99-cols .p99-card").length,
          mine: feet.find((f) => f.key === key),
          feet,
        };
      }, mine);
      assert.deepEqual({ done: head.done, total: head.total }, { done, total });
      assert.deepEqual({ text: head.text, hidden: head.hidden, title: head.title }, { text: `${done}/${total}`, hidden: false, title: `${done} of ${total} done` });
      assert.ok(head.mine && head.mine.project === LANES_IN && typeof head.mine.who === "string" && head.mine.who.length > 0, `the assigned card names its project and its assignee in its foot ${JSON.stringify(head.mine)}`);
      assert.ok(head.mine.right && head.mine.last && head.mine.top === 1, `the face sits right of the project on the card's last row ${JSON.stringify(head.mine)}`);
      assert.ok(head.feet.every((f) => f.foot && f.last && f.project === LANES_IN && f.top === 1 && f.right), `every card names its project on its last row ${JSON.stringify(head.feet.filter((f) => !(f.foot && f.last && f.project === LANES_IN && f.top === 1 && f.right)))}`);
    } finally {
      await closePage(p);
    }
  });

  if (laid) await clear(kit, LANES_AT, (await laid.catch(() => ({ keys: [] }))).keys);
}

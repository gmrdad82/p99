process.env.P99_BOARD_PORT ||= "8833";
const { HOST, ELSEWHERE, HOME, LANES, USER_CODE, launch, oneBoard, openShadow, stub } = await import("./board.mjs");

const ORIGIN = `http://${HOST}`;
const VIEW = { width: 1440, height: 900 };
let failed = 0;
let passed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} story board: ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (ok) passed++;
  else failed++;
}

async function story(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, e && e.message ? e.message.split("\n")[0] : String(e));
  }
}

const R = (p, fn, arg) => p.evaluate(fn, arg);

async function page(browser, code, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  await ctx.addInitScript(openShadow);
  if (opts.pick) await ctx.addInitScript((v) => localStorage.setItem("p99:pick", v), JSON.stringify(opts.pick));
  const p = await ctx.newPage();
  const errors = [];
  const asked = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/_p99/api/")) asked.push({ method: r.method(), path: u.pathname.slice(9), query: new URLSearchParams(u.search), body: r.postData() ? JSON.parse(r.postData()) : null });
  });
  if (opts.route) await opts.route(p);
  await p.goto(`${ORIGIN}/checkout#p99=${code}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
    return b && !b.hidden;
  }, null, { timeout: 15000 });
  await p.locator("p99-root .w .b:not(.f)").click();
  await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 15000 });
  return { ctx, p, errors, asked };
}

async function openBoard(p) {
  await p.locator("p99-root .p99-board-open").click();
  await p.waitForFunction(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    return r.querySelector(".p99-board.is-open") && (r.querySelector(".p99-col[data-label]") || r.querySelector(".p99-board-state"));
  }, null, { timeout: 15000 });
  await p.waitForTimeout(150);
}

const shown = (p) => R(p, () => {
  const r = document.querySelector("p99-root").shadowRoot;
  return {
    lanes: Array.from(r.querySelectorAll(".p99-col[data-label]"), (c) => c.dataset.word),
    cards: Array.from(r.querySelectorAll(".p99-board .p99-card"), (c) => c.dataset.id),
    byLane: Object.fromEntries(Array.from(r.querySelectorAll(".p99-col[data-label]"), (c) => [c.dataset.word, Array.from(c.querySelectorAll(".p99-card"), (e) => e.dataset.id)])),
    note: r.querySelector(".p99-board-filter")?.hidden === false ? r.querySelector(".p99-board-filter").textContent : null,
    title: r.querySelector("#p99-board-title")?.textContent,
  };
});
const boardAsks = (asked) => asked.filter((a) => a.method === "GET" && a.path === "/board");
const keys = (q) => oneBoard(new URLSearchParams(q)).cards.map((c) => c.key);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

const back = await stub();
const browser = await launch();
try {
  await story("an Owner's Board button opens the board narrowed to this host's project: seven lanes, plain items and cards together, no picker and no filter line", async () => {
    const { ctx, p, asked, errors } = await page(browser, back.code);
    await openBoard(p);
    const s = await shown(p);
    const asks = boardAsks(asked);
    check(`the board reads /board for ${HOST}'s project, ${HOME}, under the default, This project (${asks.map((a) => String(a.query))})`, asks.length === 1 && String(asks[0].query) === `project=${HOME}`);
    check(`the panel asked /space once to learn the host's project (${asked.filter((a) => a.path === "/space").length})`, asked.filter((a) => a.path === "/space").length === 1);
    check(`its lanes are the seven words in order (${s.lanes})`, s.lanes.join() === LANES.map((l) => l.word).join());
    check(`it shows every item in ${HOME}, plain or card, and none from ${ELSEWHERE} (${s.cards.length})`, sameSet(s.cards, keys(`project=${HOME}`)) && !s.cards.includes("BUG-31"));
    check(`its title is Board and no filter line shows (${s.title}, ${s.note})`, s.title === "Board" && s.note === null);
    const extra = await R(p, () => {
      const r = document.querySelector("p99-root").shadowRoot;
      return { picker: !!r.querySelector(".p99-pick-board, .p99-menu"), project: r.querySelector('.p99-card[data-id="FEAT-9"] .p99-card-project')?.textContent ?? null, plain: !!r.querySelector('.p99-card[data-id="BUG-14"] .p99-card-project') };
    });
    check(`no board picker exists, a card shows its project and a plain item none (${JSON.stringify(extra)})`, !extra.picker && extra.project === "Splicer" && !extra.plain);
    check(`no /boards read and no page error (${errors})`, !asked.some((a) => a.path.startsWith("/boards")) && errors.length === 0);
    await ctx.close();
  });

  const views = [
    { name: "This project", pick: { view: "project", projects: [], source: "" }, query: `project=${HOME}`, note: null },
    { name: "a stored Only this website from an older panel", pick: { view: "site", projects: [], source: "" }, query: `project=${HOME}`, note: null },
    { name: "a stored All from an older panel", pick: { view: "all", projects: [], source: "" }, query: `project=${HOME}`, note: null },
    { name: "Projects with Manfred picked", pick: { view: "projects", projects: ["Manfred"], source: "" }, query: "project=Manfred", note: "showing Manfred", cardsOnly: true },
    { name: "Projects with none picked", pick: { view: "projects", projects: [], source: "" }, query: "", note: "showing Projects", cardsOnly: true },
    { name: "Needs you", pick: { view: "needs", projects: [], source: "" }, query: "status=needs-you&status=stuck&status=landed", note: "showing Needs you", cardsOnly: true, plain: ["BUG-9", "Q-4"] },
    { name: "Landed, waiting for your check", pick: { view: "landed", projects: [], source: "" }, query: "status=landed", note: "showing Landed, waiting for your check", cardsOnly: true, plain: ["BUG-9", "Q-4"] },
    { name: "Agents", pick: { view: "project", projects: [], source: "agent" }, query: `project=${HOME}&source=agent`, note: "showing Agents" },
    { name: "Projects and People", pick: { view: "projects", projects: ["Splicer", "Manfred"], source: "human" }, query: "project=Splicer&project=Manfred&source=human", note: "showing Splicer, Manfred · People", cardsOnly: true },
  ];
  for (const v of views) {
    await story(`under ${v.name} the board asks /board with that filter and shows only what it keeps`, async () => {
      const { ctx, p, asked } = await page(browser, back.code, { pick: v.pick });
      await openBoard(p);
      const s = await shown(p);
      const asks = boardAsks(asked);
      const sent = asks.length ? String(asks[0].query) : null;
      check(`${v.name}: the query is ${v.query || "empty"} (${sent})`, sent === new URLSearchParams(v.query).toString());
      const want = oneBoard(new URLSearchParams(v.query)).cards.filter((c) => !v.cardsOnly || c.project).map((c) => c.key);
      check(`${v.name}: the board shows ${want.length} cards (${s.cards.length})`, sameSet(s.cards, want));
      for (const k of v.plain || []) {
        check(`${v.name}: the seed has plain ${k} in that filter, so the next check can fail`, keys(v.query).includes(k));
        check(`${v.name}: plain ${k} stays off the board, as it stays off the list`, !s.cards.includes(k));
      }
      check(`${v.name}: the lanes stay seven whatever the filter (${s.lanes.length})`, s.lanes.length === LANES.length);
      check(`${v.name}: the head says "${v.note}" (${s.note})`, s.note === v.note);
      await ctx.close();
    });
  }

  await story("This project on a host's page never shows another project's host's card", async () => {
    const { ctx, p } = await page(browser, back.code, { pick: { view: "project", projects: [], source: "" } });
    await openBoard(p);
    const s = await shown(p);
    check(`BUG-31 of ${ELSEWHERE} stays off (${s.cards.includes("BUG-31")})`, !s.cards.includes("BUG-31") && s.cards.length > 0);
    await ctx.close();
  });

  await story("the panel's filter lists This project first, then Projects, Needs you and Landed, and opens on This project", async () => {
    const { ctx, p } = await page(browser, back.code);
    const options = await R(p, () => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-pick select[name=view] option"), (o) => [o.value, o.textContent]));
    const chosen = await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-pick select[name=view]").value);
    check(`the views in order (${JSON.stringify(options)})`, JSON.stringify(options) === JSON.stringify([["project", "This project"], ["projects", "Projects"], ["needs", "Needs you"], ["landed", "Landed, waiting for your check"]]));
    check(`with nothing stored it opens on This project (${chosen})`, chosen === "project");
    await ctx.close();
  });

  await story("an Owner's list under This project asks for the host's project", async () => {
    const { ctx, p, asked } = await page(browser, back.code);
    await p.locator("p99-root .p99-panel.is-open .p99-tabs a[data-scope=all]").click();
    await p.waitForTimeout(300);
    const lists = asked.filter((a) => a.method === "GET" && a.path === "/issues");
    const last = lists.at(-1);
    check(`the list names ${HOME} (${last && String(last.query)})`, !!last && last.query.get("scope") === "all" && last.query.getAll("project").join() === HOME);
    await ctx.close();
  });

  await story("a Worker without /space falls back to this host for This project", async () => {
    const { ctx, p, asked } = await page(browser, back.code, { route: (p) => p.route((u) => u.pathname === "/_p99/api/space", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "no such route" }) })) });
    await openBoard(p);
    const sent = String(boardAsks(asked).at(-1)?.query ?? "");
    check(`the board asks host=${HOST} (${sent})`, sent === `host=${HOST}`);
    await ctx.close();
  });

  await story("changing the filter in the panel changes what the next board shows", async () => {
    const { ctx, p, asked } = await page(browser, back.code);
    await p.locator("p99-root .p99-panel.is-open .p99-pick select[name=view]").selectOption("needs");
    await p.waitForTimeout(200);
    await openBoard(p);
    const s = await shown(p);
    const sent = String(boardAsks(asked).at(-1)?.query ?? "");
    check(`picking Needs you then Board asks the three waiting lanes (${sent})`, sent === "status=needs-you&status=stuck&status=landed");
    check(`and only the Stuck lane has a card, BUG-31, the one card waiting (${JSON.stringify(s.byLane)})`, Object.entries(s.byLane).every(([w, c]) => (w === "stuck") === c.length > 0) && s.byLane.stuck.join() === "BUG-31");
    await ctx.close();
  });

  await story("a User has no Board button and no filter, and never asks for /board", async () => {
    const { ctx, p, asked } = await page(browser, USER_CODE);
    const s = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { board: !!r.querySelector(".p99-board-open"), pick: !!r.querySelector(".p99-pick") }; });
    check(`no Board, no filter (${JSON.stringify(s)})`, !s.board && !s.pick);
    check(`no /board asked (${boardAsks(asked).length})`, boardAsks(asked).length === 0);
    await ctx.close();
  });

  await story("a /board that fails says so with Retry, and Retry paints the board", async () => {
    let fail = true;
    const { ctx, p } = await page(browser, back.code, { route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => (fail ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the database is busy" }) }) : r.continue())) });
    await openBoard(p);
    const state = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { text: r.querySelector(".p99-board-state p")?.textContent, retry: !!r.querySelector(".p99-board-state button"), role: r.querySelector(".p99-board-state")?.getAttribute("role") }; });
    check(`the failure is named with a Retry, as an alert (${JSON.stringify(state)})`, state.text === "the database is busy" && state.retry && state.role === "alert");
    fail = false;
    await p.locator("p99-root .p99-board-state button").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col[data-label]").length === 7, null, { timeout: 10000 });
    check("Retry paints the seven lanes", true);
    await ctx.close();
  });

  await story("a Worker without /board is named, not a blank overlay", async () => {
    const { ctx, p } = await page(browser, back.code, { route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "no such route" }) })) });
    await openBoard(p);
    const text = await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-state p")?.textContent);
    check(`the overlay says "no such route" (${text})`, text === "no such route");
    await ctx.close();
  });

  await story("a first /board read that never answers says the board couldn't load, and Retry paints the lanes", async () => {
    let fail = true;
    const { ctx, p, errors } = await page(browser, back.code, { route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => (fail ? r.abort("connectionrefused") : r.continue())) });
    await openBoard(p);
    const state = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { text: r.querySelector(".p99-board-state p")?.textContent, retry: !!r.querySelector(".p99-board-state button"), lanes: r.querySelectorAll(".p99-col[data-label]").length }; });
    check(`a read with no status names the load as failed, with Retry (${JSON.stringify(state)}; ${errors})`, state.text === "Couldn't load the board." && state.retry && state.lanes === 0 && errors.length === 0);
    fail = false;
    await p.locator("p99-root .p99-board-state button").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-col[data-label]").length === 7, null, { timeout: 10000 });
    const after = await shown(p);
    check(`Retry paints the seven lanes and their cards (${after.lanes.length}, ${after.cards.length})`, after.lanes.length === 7 && sameSet(after.cards, keys(`host=${HOST}`)));
    await ctx.close();
  });

  await story("a live reread that fails after the board shows keeps the seven lanes and notes the Worker's words", async () => {
    let n = 0;
    const { ctx, p, errors } = await page(browser, back.code, { pick: { view: "landed", projects: [], source: "" }, route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => (n++ === 0 ? r.continue() : r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the database is busy" }) }))) });
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    await back.other({ key: "Q-4", from: "Landed", to: "stuck" });
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-note"), null, { timeout: 10000 }).catch(() => {});
    const s = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { lanes: r.querySelectorAll(".p99-col[data-label]").length, note: r.querySelector(".p99-board-note")?.textContent ?? null, blank: !!r.querySelector(".p99-board-state") }; });
    check(`the lanes stay, no blank state, and the note says the Worker's words (${n} reads, ${JSON.stringify(s)}; ${errors})`, n >= 2 && s.lanes === 7 && !s.blank && s.note === "the database is busy" && errors.length === 0);
    await back.other({ key: "Q-4", from: "Stuck", to: "landed" });
    await ctx.close();
  });

  await story("a /board answer without lanes says the board couldn't load, with Retry, and throws nothing", async () => {
    const { ctx, p, errors } = await page(browser, back.code, { route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ board: {}, cards: null }) })) });
    await openBoard(p);
    const s = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { lanes: r.querySelectorAll(".p99-col[data-label]").length, text: r.querySelector(".p99-board-state p")?.textContent, retry: !!r.querySelector(".p99-board-state button") }; });
    check(`no lanes, the load named as failed with Retry, no page error (${JSON.stringify(s)}; ${errors})`, s.lanes === 0 && s.text === "Couldn't load the board." && s.retry && errors.length === 0);
    await ctx.close();
  });

  await story("the keyboard moves a card by lane word: no board in the move, from its lane's name", async () => {
    const { ctx, p, asked } = await page(browser, back.code);
    await openBoard(p);
    await p.locator('p99-root .p99-card[data-id="FEAT-9"]').focus();
    await p.keyboard.press("Space");
    for (let i = 0; i < 3; i++) await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(400);
    const move = asked.filter((a) => a.method === "POST" && a.path === "/move").at(-1)?.body;
    check(`the move is {key, from: "New", to: "needs-you"} and nothing about a board (${JSON.stringify(move)})`, move && move.key === "FEAT-9" && move.from === "New" && move.to === "needs-you" && !("board" in move));
    const s = await shown(p);
    check(`FEAT-9 sits in Needs you (${s.byLane["needs-you"].includes("FEAT-9")})`, s.byLane["needs-you"].includes("FEAT-9"));
    await ctx.close();
  });

  await story("under a filter, another Owner's move reloads the board, so a card leaving the filter goes and one entering it comes", async () => {
    const { ctx, p, asked } = await page(browser, back.code, { pick: { view: "landed", projects: [], source: "" } });
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    const before = boardAsks(asked).length;
    await back.other({ key: "TASK-3", from: "In progress", to: "landed" });
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector('.p99-col[data-word=landed] .p99-card[data-id="TASK-3"]'), null, { timeout: 10000 });
    check(`TASK-3 came in through a reload with the same filter (${boardAsks(asked).length - before} more, ${String(boardAsks(asked).at(-1).query)})`, boardAsks(asked).length > before && String(boardAsks(asked).at(-1).query) === "status=landed");
    await back.other({ key: "TASK-3", from: "Landed", to: "stuck" });
    await p.waitForFunction(() => !document.querySelector("p99-root").shadowRoot.querySelector('.p99-card[data-id="TASK-3"]'), null, { timeout: 10000 });
    check("TASK-3 left when it moved out of Landed", true);
    await ctx.close();
  });

  await story("an empty lane keeps its drop target: under Agents the keyboard drops TASK-3 into a lane that had nothing", async () => {
    const { ctx, p, asked } = await page(browser, back.code, { pick: { view: "project", projects: [], source: "agent" } });
    await openBoard(p);
    const s = await shown(p);
    const from = s.lanes.findIndex((w) => s.byLane[w].includes("TASK-3"));
    const to = from > 0 ? from - 1 : from + 1;
    const word = s.lanes[to];
    const target = await R(p, (w) => { const r = document.querySelector(`p99-root`).shadowRoot.querySelector(`.p99-col[data-word="${w}"] .p99-cards`); const b = r && r.getBoundingClientRect(); return b ? { w: b.width, h: b.height, scale: getComputedStyle(r).scale, n: r.children.length } : null; }, word);
    check(`the empty ${word} lane's list has a box and no scale (${JSON.stringify(target)})`, from >= 0 && target && target.n === 0 && target.w > 0 && target.h > 0 && target.scale !== "0");
    await p.locator('p99-root .p99-card[data-id="TASK-3"]').focus();
    await p.keyboard.press("Space");
    await p.keyboard.press(to < from ? "ArrowLeft" : "ArrowRight");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(400);
    const move = asked.filter((a) => a.method === "POST" && a.path === "/move").at(-1)?.body;
    const after = await shown(p);
    check(`the move goes to ${word} and TASK-3 sits there (${JSON.stringify(move)}; ${after.byLane[word]})`, move && move.key === "TASK-3" && move.to === word && after.byLane[word].includes("TASK-3"));
    await ctx.close();
  });

  await story("a live label event that names the lane by its word moves the card there, never off the board", async () => {
    const { ctx, p } = await page(browser, back.code);
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    await back.other({ key: "IMP-6", from: "New", to: "planned" }, true);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector('.p99-col[data-word=planned] .p99-card[data-id="IMP-6"]'), null, { timeout: 10000 }).catch(() => {});
    const s = await shown(p);
    const label = await R(p, () => document.querySelector("p99-root").shadowRoot.querySelector('.p99-card[data-id="IMP-6"]')?.dataset.label ?? null);
    check(`IMP-6 sits in Planned and carries the lane's name (${s.byLane.planned.includes("IMP-6")}, ${label})`, s.byLane.planned.includes("IMP-6") && label === "Planned");
    await ctx.close();
  });

  await story("a reload that answers without lanes keeps the painted board and says it couldn't load", async () => {
    let n = 0;
    const { ctx, p, errors } = await page(browser, back.code, { pick: { view: "landed", projects: [], source: "" }, route: (p) => p.route((u) => u.pathname === "/_p99/api/board", (r) => (n++ === 0 ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ board: {}, cards: null }) }))) });
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    await back.other({ key: "Q-4", from: "Landed", to: "stuck" });
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board-note"), null, { timeout: 10000 }).catch(() => {});
    const s = await R(p, () => { const r = document.querySelector("p99-root").shadowRoot; return { lanes: r.querySelectorAll(".p99-col[data-label]").length, note: r.querySelector(".p99-board-note")?.textContent ?? null }; });
    check(`the seven lanes stay and the note says so (${n} reads, ${JSON.stringify(s)}; ${errors})`, n >= 2 && s.lanes === 7 && s.note === "Couldn't load the board." && errors.length === 0);
    await back.other({ key: "Q-4", from: "Stuck", to: "landed" });
    await ctx.close();
  });

  await story(`under This project, the default, a live move on ${ELSEWHERE} never brings its card in`, async () => {
    const { ctx, p, asked } = await page(browser, back.code);
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    await back.other({ key: "BUG-31", from: "Stuck", to: "landed" });
    await p.waitForTimeout(600);
    const s = await shown(p);
    const sent = String(boardAsks(asked).at(-1)?.query ?? "");
    check(`any reload keeps project=${HOME} and BUG-31 stays off (${sent}, ${s.cards.includes("BUG-31")})`, sent === `project=${HOME}` && !s.cards.includes("BUG-31"));
    await back.other({ key: "BUG-31", from: "Landed", to: "stuck" });
    await ctx.close();
  });

  await story(`under Projects a live move on ${ELSEWHERE} moves that host's card too, since Projects shows every host`, async () => {
    const { ctx, p } = await page(browser, back.code, { pick: { view: "projects", projects: [], source: "" } });
    await openBoard(p);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-live")?.dataset.state === "live", null, { timeout: 10000 });
    const before = await shown(p);
    await back.other({ key: "BUG-31", from: "Stuck", to: "landed" });
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector('.p99-col[data-word=landed] .p99-card[data-id="BUG-31"]'), null, { timeout: 10000 }).catch(() => {});
    const after = await shown(p);
    check(`BUG-31 went from Stuck to Landed live (${before.byLane.stuck.includes("BUG-31")} → ${after.byLane.landed.includes("BUG-31")})`, before.byLane.stuck.includes("BUG-31") && after.byLane.landed.includes("BUG-31"));
    await ctx.close();
  });
} finally {
  await browser.close();
  back.close();
}
console.log(`stories-board: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

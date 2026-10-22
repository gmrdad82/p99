import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const work = resolve(repo, process.env.P99_WORK || "tmp/web-filter");
const stills = resolve(repo, process.env.P99_STILLS || "tmp/renders");
const PORT = Number(process.env.P99_PROXY_PORT || 8933);
const HOST = "shop.example.com";
const PAGE = `http://${HOST}/checkout`;
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const ROBOT = "🤖";

mkdirSync(stills, { recursive: true });
const serve = spawn(process.execPath, [join(here, "serve.mjs")], {
  env: { ...process.env, P99_WORK: work, P99_PROXY_PORT: String(PORT), P99_WORKER_PORT: String(PORT + 1) },
  stdio: ["ignore", "inherit", "inherit"],
});
let failed = 0;
const done = (code) => {
  serve.kill("SIGTERM");
  process.exit(code);
};

async function api(method, pq, body, actor = ADA) {
  const key = readFileSync(join(work, "key"), "utf8").trim();
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const who = Buffer.from(JSON.stringify(actor)).toString("base64url");
  const sha = createHash("sha256").update(raw).digest("hex");
  const ts = Math.floor(Date.now() / 1000);
  const path = "/_p99/v1" + pq;
  const sig = createHmac("sha256", key).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
  const headers = { "X-P99-Key-Id": "p99", "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}`, "X-P99-Actor": who };
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: body == null ? undefined : raw });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const must = async (...a) => {
  const r = await api(...a);
  if (r.status >= 300) throw new Error(`${a[0]} ${a[1]}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

function check(name, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

const file = (title, actor) =>
  must("POST", `/issues?host=${HOST}`, { client_uid: randomUUID(), kind: "bug", title, body: "", page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" }, context: {}, marks: [] }, actor);

const person = (name, agent, via) => ({ name, username: name.toLowerCase().replace(" ", "."), agent, via: agent ? via : null });
const card = (key, project, status, label, host, by) => ({
  key, kind: "feature", project, status, label, lane: status === "done" ? null : 1, title: `${project}: ${key}`, host,
  reporter: person("Ada Lovelace", false), created_at: "2026-10-22T08:00:00.000Z", changed_at: "2026-10-22T09:00:00.000Z",
  changed_by: by, comments: 0, links: [],
});
const CARDS = [
  card("FEAT-901", "Splicer", "landed", "Landed", HOST, person("Ada Lovelace", true, "pci")),
  card("FEAT-902", "Manfred", "stuck", "Stuck", "elsewhere.example.com", person("Grace Hopper", false)),
  card("FEAT-903", "Splicer", "new", "New", HOST, person("Ada Lovelace", false)),
];
const PROJECTS = [{ name: "Manfred", open: 1, done: 0 }, { name: "Splicer", open: 2, done: 0 }];

function cardsAnswer(url) {
  const q = url.searchParams;
  const projects = q.getAll("project").map((p) => p.toLowerCase());
  const statuses = q.getAll("status");
  const source = q.get("source");
  const host = q.get("host");
  return CARDS.filter((c) => (!projects.length || projects.includes(c.project.toLowerCase()))
    && (!statuses.length || statuses.includes(c.status))
    && (!host || c.host === host)
    && (!source || (source === "agent") === c.changed_by.agent));
}

const S = (sel) => `p99-root >> .p99-panel.is-open ${sel}`;

const state = (p) =>
  p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const view = r.querySelector(".p99-panel.is-open [data-view=list]");
    if (!view) return null;
    const res = view.querySelector(".p99-results");
    const pick = view.querySelector(".p99-pick");
    return {
      waiting: !!res.querySelector(".p99-rows-wait") || res.hasAttribute("aria-busy"),
      pick: !!pick,
      view: pick ? pick.querySelector("select[name=view]").value : null,
      source: pick ? (pick.querySelector("input[name=source]:checked") || {}).value ?? null : null,
      projects: pick ? Array.from(pick.querySelectorAll("input[name=project]"), (x) => [x.value, x.checked]) : [],
      projectsShown: pick ? !pick.querySelector(".p99-projects").hidden : false,
      tabs: !view.querySelector(".p99-tabs").hidden,
      filters: !view.querySelector(".p99-filters").hidden,
      keys: Array.from(res.querySelectorAll(".p99-key"), (k) => k.textContent),
      robots: Array.from(res.querySelectorAll(".p99-ai"), (k) => k.textContent),
      lanes: Array.from(res.querySelectorAll(".p99-card-row"), (li) => li.dataset.lane),
      away: Array.from(res.querySelectorAll(".p99-card-row a[target=_blank]"), (a) => a.getAttribute("href")),
      here: Array.from(res.querySelectorAll(".p99-card-row a:not([target])"), (a) => a.getAttribute("href")),
      more: !!res.parentNode.querySelector(".p99-more:not([hidden])"),
      empty: res.querySelector(".p99-empty")?.textContent || null,
    };
  });
const settled = async (p, ready = () => true, ms = 8000) => {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < ms) {
    s = await state(p);
    if (s && !s.waiting && ready(s)) return s;
    await sleep(100);
  }
  return s;
};
const choose = (p, view) => p.locator(S(".p99-pick select[name=view]")).selectOption(view);
const source = (p, v) => p.locator(S(`.p99-pick input[name=source][value="${v}"]`)).check({ force: true });

try {
  for (let i = 0; ; i++) {
    const r = await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false }).catch((e) => ({ status: 0, e }));
    if (r.status === 200 || r.status === 201) break;
    if (i > 120) throw new Error("the local Worker did not come up");
    await sleep(500);
  }
  await must("PUT", `/hosts/${HOST}`, { env: "production", config: {} });
  const boss = (await must("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], manager: true })).secret;
  const visitor = (await must("POST", "/codes", { name: GRACE.name, email: GRACE.email, hosts: [HOST], manager: false })).secret;
  const byAgent = (await file("An agent filed this", { ...ADA, agent: true, via: "pci" })).key;
  const byPerson = (await file("A person filed this", GRACE)).key;

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
  const asked = [];
  let paged = false;
  const open = async (ctx, code) => {
    const p = await ctx.newPage();
    await p.route((url) => url.pathname === "/_p99/api/cards", (r) => {
      const url = new URL(r.request().url());
      asked.push(url.pathname + url.search);
      const all = cardsAnswer(url);
      const cursor = url.searchParams.get("cursor");
      const body = !paged ? { cards: all, next_cursor: null } : cursor === "page-2" ? { cards: all.slice(1), next_cursor: null } : { cards: all.slice(0, 1), next_cursor: all.length > 1 ? "page-2" : null };
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await p.route((url) => url.pathname === "/_p99/api/projects", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: PROJECTS }) }));
    await p.route((url) => url.pathname === "/_p99/api/issues" && url.searchParams.has("source"), (r) => {
      const url = new URL(r.request().url());
      asked.push(url.pathname + url.search);
      r.fallback();
    });
    await p.goto(`${PAGE}#p99=${code}`);
    await p.waitForFunction(() => {
      const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
      return b && !b.hidden;
    }, null, { timeout: 15000 });
    await p.locator("p99-root >> .w .b:not(.f)").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list] .p99-results"), null, { timeout: 15000 });
    return p;
  };

  {
    const ctx = await browser.newContext({ ...DESK, colorScheme: "light" });
    await ctx.addInitScript(openShadow);
    let p = await open(ctx, boss);
    let s = await settled(p);
    check(`a manager's list shows the filter, All and Everyone by default, with today's tabs and filters (${JSON.stringify(s)})`, s.pick && s.view === "all" && s.source === "" && s.tabs && s.filters && !s.projectsShown);
    check(`All lists today's items, the agent's with ${ROBOT} and never an asterisk (${s.robots.join(",")})`, s.keys.includes(byAgent) && s.keys.includes(byPerson) && s.robots.length >= 1 && s.robots.every((r) => r === ROBOT));

    asked.length = 0;
    await source(p, "agent");
    s = await settled(p, (s) => s.source === "agent");
    check(`Agents on All asks /issues with source=agent (${asked.join(" ")})`, asked.some((a) => a.startsWith("/_p99/api/issues?") && a.includes("source=agent")));

    asked.length = 0;
    await source(p, "");
    await choose(p, "site");
    s = await settled(p, (s) => s.view === "site" && s.keys.length > 0);
    check(`Only this website asks /cards for this host and hides the item tabs and filters (${asked.join(" ")}; ${s.keys})`, asked.some((a) => a.includes(`host=${HOST}`)) && !s.tabs && !s.filters && s.keys.join() === "FEAT-901,FEAT-903");
    const sent = asked.filter((a) => a.startsWith("/_p99/api/cards?")).map((a) => new URLSearchParams(a.split("?")[1]).getAll("host"));
    check(`Only this website sends one host, this page's hostname (${JSON.stringify(sent)})`, sent.length > 0 && sent.every((h) => h.length === 1 && h[0] === HOST));
    check(`this website's cards open in the panel, not on a new tab (${s.here}; ${s.away})`, s.away.length === 0 && s.here.join() === "#p99=FEAT-901,#p99=FEAT-903");
    await p.locator(S('.p99-card-row a[href="#p99=FEAT-903"]')).click();
    const inPanel = await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item]"), null, { timeout: 8000 }).then(() => true, () => false);
    check(`clicking this website's card opens it in place, in the same page (${inPanel}, ${ctx.pages().length} page)`, inPanel && ctx.pages().length === 1);

    paged = true;
    asked.length = 0;
    await p.close();
    p = await open(ctx, boss);
    s = await settled(p, (s) => s.view === "site" && s.keys.length > 0);
    check(`a long card list stops at a page and offers more (${s.keys}; more ${s.more})`, s.keys.join() === "FEAT-901" && s.more);
    await p.locator(S(".p99-more")).click();
    s = await settled(p, (s) => s.keys.length === 2);
    check(`more reads the next page with the cursor (${s.keys}; ${asked.join(" ")})`, s.keys.join() === "FEAT-901,FEAT-903" && asked.some((a) => a.includes("cursor=page-2")));
    paged = false;

    asked.length = 0;
    await choose(p, "landed");
    s = await settled(p, (s) => s.view === "landed" && s.keys.length > 0);
    check(`Landed, waiting for your check, lists the landed lane across projects (${asked.join(" ")}; ${s.keys})`, asked.some((a) => a.includes("status=landed")) && s.keys.join() === "FEAT-901" && s.lanes.join() === "landed");

    await choose(p, "projects");
    s = await settled(p, (s) => s.view === "projects" && s.projects.length === 2);
    check(`Projects shows every project in use to pick from (${JSON.stringify(s.projects)})`, s.projectsShown && s.projects.map(([n]) => n).join() === "Manfred,Splicer");
    asked.length = 0;
    await p.locator(S('.p99-pick input[name=project][value="Manfred"]')).check({ force: true });
    s = await settled(p, (s) => s.keys.join() === "FEAT-902");
    check(`picking Manfred lists its cards, another host's card opening on its own site (${s.keys}; ${s.away})`, asked.some((a) => a.includes("project=Manfred")) && s.keys.join() === "FEAT-902" && s.away[0] === "https://elsewhere.example.com/#p99=FEAT-902");
    await p.locator(S('.p99-pick input[name=project][value="Splicer"]')).check({ force: true });
    s = await settled(p, (s) => s.keys.length === 3);
    check(`two projects list both (${s.keys})`, s.keys.length === 3);

    await source(p, "human");
    s = await settled(p, (s) => s.source === "human" && s.keys.length === 2);
    check(`People keeps the cards whose last change was a person's (${s.keys})`, s.keys.join() === "FEAT-902,FEAT-903" && s.robots.length === 0);
    await source(p, "agent");
    s = await settled(p, (s) => s.source === "agent" && s.keys.length === 1);
    check(`Agents keeps the agent's card, shown with ${ROBOT} (${s.keys}; ${s.robots})`, s.keys.join() === "FEAT-901" && s.robots.join() === ROBOT);

    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("p99:pick")));
    check(`the choice is kept in this browser (${JSON.stringify(stored)})`, stored.view === "projects" && stored.source === "agent" && stored.projects.join() === "Manfred,Splicer");

    await p.close();
    p = await open(ctx, boss);
    s = await settled(p, (s) => s.projects.length === 2 && s.keys.length > 0);
    check(`a reload comes back to the same view, projects and source (${JSON.stringify(s)})`, s.view === "projects" && s.source === "agent" && s.projects.every(([, on]) => on) && s.keys.join() === "FEAT-901");
    await p.screenshot({ path: join(stills, "filter-projects-1440-light.png") });

    await choose(p, "all");
    await source(p, "agent");
    await settled(p, (s) => s.view === "all" && s.source === "agent");
    const boardAsked = [];
    await p.route((url) => url.pathname === "/_p99/api/issues" && url.searchParams.get("source") === "agent" && url.searchParams.get("status") === "any", (r) => {
      boardAsked.push(new URL(r.request().url()).searchParams.get("limit"));
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ issues: [{ key: byAgent }], next_cursor: null }) });
    });
    await p.locator(S(".p99-board-open")).click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board.is-open .p99-col[data-label]"), null, { timeout: 15000 });
    await sleep(400);
    const board = await p.evaluate(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      return {
        cards: Array.from(r.querySelectorAll(".p99-board .p99-card"), (c) => c.dataset.id),
        note: r.querySelector(".p99-board-filter")?.hidden === false ? r.querySelector(".p99-board-filter").textContent : null,
      };
    });
    check(`the board overlay shows only what the filter keeps, and says so (${JSON.stringify(board)})`, board.cards.join() === byAgent && board.note === "showing Agents");
    check(`the board overlay reads the kept items at the widest page, 100 (${boardAsked})`, boardAsked.length > 0 && boardAsked.every((l) => l === "100"));

    await p.evaluate(() => localStorage.setItem("p99:pick", JSON.stringify({ view: "landed", projects: [], source: "" })));
    await p.close();
    p = await open(ctx, boss);
    await settled(p, (s) => s.view === "landed");
    await p.locator(S(".p99-board-open")).click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-board.is-open .p99-col[data-label]"), null, { timeout: 15000 });
    await sleep(400);
    const landed = await p.evaluate(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      return {
        cards: Array.from(r.querySelectorAll(".p99-board .p99-card"), (c) => c.dataset.id),
        note: r.querySelector(".p99-board-filter")?.hidden === false ? r.querySelector(".p99-board-filter").textContent : null,
      };
    });
    check(`under Landed the board overlay keeps only landed cards and says so (${JSON.stringify(landed)})`, landed.cards.every((k) => k === "FEAT-901") && !landed.cards.includes(byAgent) && !landed.cards.includes(byPerson) && /Landed/i.test(landed.note || ""));

    await p.evaluate(() => localStorage.setItem("p99:pick", "{not json"));
    await p.close();
    p = await open(ctx, boss);
    s = await settled(p);
    check(`a broken stored choice falls back to All and Everyone (${s.view}, ${s.source})`, s.view === "all" && s.source === "");
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ ...DESK, colorScheme: "light" });
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    const p = await open(ctx, boss);
    const s = await settled(p);
    check(`with storage blocked the filter still draws at All (${s && s.view})`, s && s.pick && s.view === "all");
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ ...DESK, colorScheme: "light" });
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript(() => localStorage.setItem("p99:pick", JSON.stringify({ view: "landed", projects: [], source: "agent" })));
    asked.length = 0;
    const p = await open(ctx, visitor);
    const s = await settled(p);
    check(`a visitor's panel has no filter and never asks for cards or a source, whatever is stored (${JSON.stringify(s)}; ${asked.join(" ")})`, !s.pick && s.tabs && s.filters && asked.length === 0);
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `filter-check: ${failed} failed` : "filter-check: all passed");
done(failed ? 1 : 0);

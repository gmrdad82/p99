import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const work = resolve(resolve(here, "../.."), process.env.P99_WORK || "tmp/stories-widget");
const PORT = Number(process.env.P99_PROXY_PORT || 9111);
const HOST = "shop.example.com";
const UNSET = "unset.example.com";
const EVIL = "evil.example.com";
const PAGE = `http://${HOST}/checkout`;
const RUN = randomUUID().slice(0, 8);
const MAX_FILE = 20 * 1024 * 1024;
const FAILED = "Couldn't send; try again.";
const NOTE = Buffer.from("order 1042: card accepted, Pay disabled\n");
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };

mkdirSync(work, { recursive: true });
const serve = spawn(process.execPath, [join(here, "serve.mjs")], {
  env: { ...process.env, P99_WORK: work, P99_PROXY_PORT: String(PORT), P99_WORKER_PORT: String(PORT + 1) },
  stdio: ["ignore", "inherit", "inherit"],
});
let failed = 0;
let passed = 0;
let reds = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} story widget: ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (ok) passed++;
  else failed++;
}

function red(name, bug, ok) {
  if (ok) {
    console.log(`FAIL story widget: ${name} (a red that passed: ${bug})`);
    failed++;
    return;
  }
  console.log(`TODO story widget: ${name} # red until fixed: ${bug}`);
  reds++;
}

async function story(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, e && e.message ? e.message.split("\n")[0] : String(e));
  }
}

async function api(method, pq, body) {
  const key = readFileSync(join(work, "key"), "utf8").trim();
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const who = Buffer.from(JSON.stringify(ADA)).toString("base64url");
  const sha = createHash("sha256").update(raw).digest("hex");
  const ts = Math.floor(Date.now() / 1000);
  const path = "/_p99/v1" + pq;
  const sig = createHmac("sha256", key).update(`v1\n${ts}\n${method}\n${path}\n${who}\n${sha}`).digest("hex");
  const headers = { "X-P99-Key-Id": "p99", "X-Content-SHA256": sha, "X-P99-Auth": `v1 ts=${ts},sig=${sig}`, "X-P99-Actor": who };
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: body == null ? undefined : raw });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, json: type.startsWith("application/json") ? await res.json() : null, bytes: type.startsWith("application/json") ? null : Buffer.from(await res.arrayBuffer()) };
}

async function must(method, pq, body) {
  const r = await api(method, pq, body);
  if (r.status < 200 || r.status > 299) throw new Error(`${method} ${pq}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json ?? r.bytes;
}

function site(method, path, code, body) {
  return new Promise((resolve, reject) => {
    const bytes = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = { host: HOST, "x-p99-code": code };
    if (bytes) Object.assign(headers, { "content-type": "application/json", "content-length": bytes.length });
    const req = request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

async function until(what, fn, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function gate() {
  let open;
  const opened = new Promise((r) => (open = r));
  return { opened, open };
}

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function blockStorage() {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  }
}

function refuseWrites() {
  for (const name of ["localStorage", "sessionStorage"]) {
    const real = window[name];
    const full = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    const store = new Proxy(real, {
      get(t, k) {
        if (k === "setItem") return full;
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
      set: full,
      deleteProperty: () => true,
    });
    Object.defineProperty(window, name, { configurable: true, get: () => store });
  }
}

function watchFetch() {
  const real = window.fetch;
  window.__p99Fetched = [];
  window.fetch = function (u, ...rest) {
    window.__p99Fetched.push(new URL(String(u instanceof Request ? u.url : u), location.href).pathname);
    return real.call(this, u, ...rest);
  };
}

function hideable() {
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  window.__p99Hide = (h) => {
    hidden = h;
    document.dispatchEvent(new Event("visibilitychange"));
  };
}

const CLOCK = Date.UTC(2026, 0, 5, 9);
const S = (sel) => `p99-root >> .p99-panel.is-open ${sel}`;
const TITLE = S(".p99-new input[name=title]");
const SEND = S(".p99-new .p99-actions button[type=submit]");
const RETRY = S(".p99-new .p99-status-line .p99-retry");
const tag = (title) => `${title} [${RUN}]`;
const isPost = (url, method) => method === "POST" && new URL(url).pathname === "/_p99/api/issues";
const isPut = (url, method) => method === "PUT" && /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(new URL(url).pathname);
const isItemGet = (url, method) => method === "GET" && /^\/_p99\/api\/issues\/[^/]+$/.test(new URL(url).pathname);

const statusLine = (p) => p.evaluate(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-new .p99-status-line")?.textContent || "");
const waitStatus = (p, re, ms = 20000) =>
  p
    .waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-new .p99-status-line")?.textContent || ""), re.source, { timeout: ms })
    .catch(async () => {
      throw new Error(`the status line never matched ${re}: "${await statusLine(p)}"`);
    });
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const thread = (p) => p.locator(S("[data-view=item]")).waitFor({ timeout: 20000 });
const panelOpen = (p) => p.evaluate(() => Boolean(document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open")));

async function found(title) {
  const list = await must("GET", `/issues?scope=all&host=${HOST}&q=${RUN}`);
  return list.issues.filter((i) => i.title === title);
}

function uidsOf(p) {
  const uids = [];
  p.on("request", (r) => {
    if (isPost(r.url(), r.method())) uids.push(JSON.parse(r.postData() || "{}").client_uid);
  });
  return uids;
}

try {
  await until("the local Worker", async () => (await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false }).catch(() => ({ status: 0 }))).status === 200, 90000);
  await must("POST", "/projects", { name: "Shop" });
  await must("PUT", `/hosts/${HOST}`, { env: "production", project: "Shop", config: {} });
  const mint = async (name, email) => (await must("POST", "/codes", { name, email, hosts: [HOST], role: "user" })).secret;
  const code = await mint(ADA.name, ADA.email);
  const chromiumPath = process.env.P99_CHROMIUM || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}, MAP ${UNSET} 127.0.0.1:${PORT}, MAP ${EVIL} 127.0.0.1:${PORT}`,
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST},http://${UNSET},http://${EVIL}`,
      "--hide-scrollbars",
    ],
  });
  const visit = async ({ as = code, init = [], url } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    for (const s of init) await ctx.addInitScript(s);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    await p.goto(url || `${PAGE}#p99=${as}`);
    if (!url) await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    return { ctx, p, errors };
  };
  const openForm = async (p) => {
    await p.locator("p99-root >> .w .f").click();
    await p.locator(TITLE).waitFor({ timeout: 20000 });
  };
  const shotReady = (p) => p.locator(S(".p99-shot[data-role=screenshot] canvas")).waitFor({ timeout: 30000 });
  const write = async (p, title, body = "") => {
    await p.locator(TITLE).fill(title);
    if (body) await p.locator(S(".p99-new textarea[name=body]")).fill(body);
  };

  await story("a visitor's report arrives with its screenshot, the area they marked and their file, and opens as its thread", async () => {
    const { ctx, p, errors } = await visit();
    await openForm(p);
    await shotReady(p);
    const title = tag("Pay stays grey after the card is accepted");
    await write(p, title, "Card accepted, but Pay never turns on.");
    await p.locator(S(".p99-mark-start")).click();
    await p.locator("p99-root >> .p99-mark-layer").waitFor({ timeout: 10000 });
    const box = await p.locator("#payment").boundingBox();
    const x1 = Math.max(4, box.x + 8);
    const y1 = Math.max(4, box.y + 8);
    await p.mouse.move(x1, y1);
    await p.mouse.down();
    await p.mouse.move(Math.min(x1 + 240, 1270), Math.min(y1 + 160, 790), { steps: 8 });
    await p.mouse.up();
    await p.locator("p99-root >> .p99-mark-done").click();
    await p.locator(S(".p99-regions .p99-region canvas")).waitFor({ timeout: 30000 });
    await p.locator(S(".p99-new input[name=files]")).setInputFiles({ name: "order.txt", mimeType: "text/plain", buffer: NOTE });
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    check("the report is filed once, under its own title", (await found(title)).length === 1);
    const t = await must("GET", `/issues/${item.key}?host=${HOST}`);
    const roles = t.attachments.map((a) => a.role).sort().join(",");
    check(`it carries the screenshot, the marked area and the file (${roles})`, roles === "file,region,screenshot");
    check("the marked area points at its mark, and the mark names what was under it", t.attachments.find((a) => a.role === "region")?.mark === 0 && t.issue.marks.length === 1 && t.issue.marks[0].elements.length > 0);
    const shot = t.attachments.find((a) => a.role === "screenshot");
    check(`the screenshot is a real image (${shot?.type})`, ["image/webp", "image/jpeg"].includes(shot?.type) && shot.bytes > 1000);
    const file = t.attachments.find((a) => a.role === "file");
    const back = await must("GET", `/files/${file.id}?host=${HOST}`);
    check("the file reads back byte for byte", Buffer.compare(back, NOTE) === 0);
    check("the page address keeps no query or hash", t.issue.page.url === `https://${HOST}/checkout`);
    check(`no script error on the page (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("on a slow network the send shows it is working, extra clicks and Enter send nothing more, and one item arrives", async () => {
    const { ctx, p } = await visit();
    const posting = gate();
    const uploading = gate();
    const loading = gate();
    const posts = [];
    const puts = [];
    await p.route((u) => u.pathname.startsWith("/_p99/api/issues"), async (route) => {
      const r = route.request();
      if (isPost(r.url(), r.method())) {
        posts.push(JSON.parse(r.postData()).client_uid);
        await posting.opened;
      } else if (isPut(r.url(), r.method())) {
        puts.push(r.url());
        await uploading.opened;
      } else if (isItemGet(r.url(), r.method())) {
        await loading.opened;
      }
      await route.fallback();
    });
    await openForm(p);
    await shotReady(p);
    const title = tag("Slow network, one item");
    await write(p, title);
    await p.locator(SEND).click();
    await until("the held send", () => posts.length === 1);
    await waitStatus(p, /Sending/);
    check("while the send is held the button is disabled", await p.locator(SEND).isDisabled());
    await p.locator(TITLE).press("Enter");
    await p.locator(S("form.p99-new")).evaluate((f) => {
      f.requestSubmit();
      f.requestSubmit();
    });
    await frames(p);
    check(`Enter and two more submits send nothing more (${posts.length} sends)`, posts.length === 1);
    posting.open();
    await until("the held screenshot upload", () => puts.length >= 1);
    await waitStatus(p, /Uploading/);
    check("while a file uploads the visitor sees its progress", /Uploading/.test(await statusLine(p)));
    uploading.open();
    const slow = await p
      .locator(S(".p99-slow .p99-retry"))
      .waitFor({ timeout: 15000 })
      .then(() => true, () => false);
    check("a thread slow to load says so and offers Retry", slow);
    loading.open();
    await thread(p);
    check(`every send carried one id (${new Set(posts).size})`, new Set(posts).size === 1);
    const items = await found(title);
    check(`one item arrived (${items.length})`, items.length === 1);
    if (items[0]) {
      const t = await must("GET", `/issues/${items[0].key}?host=${HOST}`);
      check("with its screenshot", t.attachments.some((a) => a.role === "screenshot"));
    }
    await ctx.close();
  });

  await story("a visitor who goes offline mid-send is told so, keeps their words, and Retry later files the same item once", async () => {
    const { ctx, p } = await visit();
    const uids = uidsOf(p);
    await openForm(p);
    await shotReady(p);
    const title = tag("Sent from the train");
    await write(p, title, "The tunnel cut the signal.");
    await ctx.setOffline(true);
    await p.locator(SEND).click();
    await waitStatus(p, /offline/);
    check("the status line says the visitor is offline", /offline/i.test(await statusLine(p)));
    check("it offers Retry", await p.locator(RETRY).isVisible());
    check("the title is kept", (await p.locator(TITLE).inputValue()) === title);
    check("nothing reached the Worker", (await found(title)).length === 0);
    await ctx.setOffline(false);
    await p.locator(RETRY).click();
    await thread(p);
    check(`one item arrived (${(await found(title)).length})`, (await found(title)).length === 1);
    check(`every attempt carried one id (${new Set(uids).size} ids over ${uids.length} sends)`, uids.length >= 1 && new Set(uids).size === 1);
    await ctx.close();
  });

  await story("a send whose answer is lost on the way back files once, says so in P99's words, and Retry opens that same item", async () => {
    const { ctx, p } = await visit();
    let losing = true;
    const answers = [];
    const uids = [];
    await p.route((u) => u.pathname === "/_p99/api/issues", async (route) => {
      const r = route.request();
      if (r.method() !== "POST") return route.fallback();
      uids.push(JSON.parse(r.postData()).client_uid);
      if (!losing) return route.fallback();
      const answer = await route.fetch({ url: r.url().replace(`http://${HOST}`, `http://127.0.0.1:${PORT}`), headers: { ...r.headers(), host: HOST } });
      answers.push({ status: answer.status(), key: (await answer.json()).key });
      await route.abort("connectionreset");
    });
    await openForm(p);
    await shotReady(p);
    const title = tag("The answer got lost");
    await write(p, title);
    await p.locator(SEND).click();
    await p.locator(RETRY).waitFor({ timeout: 20000 });
    const said = (await statusLine(p)).replace(/\s*Retry$/, "");
    check(`the visitor reads P99's own words, not the browser's ("${said}")`, said === FAILED);
    check(`the send was tried again before giving up (${uids.length} sends)`, uids.length === 4);
    check(`the Worker stored it once and answered the repeats with the same item (${answers.map((a) => a.status).join(",")})`, answers[0]?.status === 201 && answers.slice(1).every((a) => a.status === 200 && a.key === answers[0].key));
    losing = false;
    await p.locator(RETRY).click();
    await thread(p);
    const items = await found(title);
    check(`one item exists (${items.length})`, items.length === 1);
    check("the thread shown is the item stored the first time", items[0]?.key === answers[0]?.key && (await p.locator(S("[data-view=item]")).textContent()).includes(answers[0]?.key));
    check(`every attempt carried one id (${new Set(uids).size})`, new Set(uids).size === 1);
    await ctx.close();
  });

  await story("a visitor at the daily limit sees why, keeps their words, and nothing is filed", async () => {
    const hedy = await mint("Hedy Lamarr", "hedy@example.com");
    for (let i = 0; i < 30; i++) {
      const status = await site("POST", "/_p99/api/issues", hedy, {
        client_uid: randomUUID(),
        kind: "bug",
        title: `Earlier today ${i}`,
        body: "",
        page: { url: PAGE, path: "/checkout", title: "Checkout" },
        context: {},
        marks: [],
      });
      if (status !== 201) throw new Error(`filing the day's item ${i} answered ${status}`);
    }
    const { ctx, p } = await visit({ as: hedy });
    const uids = uidsOf(p);
    await openForm(p);
    const title = tag("One more today");
    await write(p, title);
    const started = Date.now();
    await p.locator(SEND).click();
    await waitStatus(p, /today's limit of 30 items/);
    const took = Date.now() - started;
    check("the status line names the limit", /today's limit of 30 items/.test(await statusLine(p)));
    check("the title is kept", (await p.locator(TITLE).inputValue()) === title);
    check("Send works again", !(await p.locator(SEND).isDisabled()));
    check("no Retry is offered for a limit that holds all day", !(await p.locator(RETRY).isVisible()));
    check("nothing is filed", (await found(title)).length === 0);
    check(`it is told at once, not after hidden retries (${uids.length} sends, ${took} ms)`, uids.length === 1);
    await ctx.close();
  });

  const busyCode = await mint("Grace Hopper", "grace.busy@example.com");
  const busyVisit = async (statuses) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript(hideable);
    await ctx.addInitScript(watchFetch);
    const seen = [];
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => {
      const status = statuses[seen.length];
      seen.push(typeof status === "object" ? 200 : status || 200);
      if (!status) return route.fallback();
      if (status === "hang") return;
      if (typeof status === "object") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) });
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
    });
    const p = await ctx.newPage();
    const errors = [];
    const panels = [];
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    p.on("requestfinished", (r) => new URL(r.url()).pathname === "/_p99/panel.js" && panels.push(r.url()));
    await p.clock.install({ time: CLOCK });
    await p.clock.pauseAt(CLOCK + 1000);
    await p.goto(`${PAGE}#p99=${busyCode}`);
    return { ctx, p, seen, errors, panels };
  };
  const busyLine = (p, s) => p.locator(S(`[data-view=busy] .p99-busy-line`), { hasText: `P99 is busy, trying again in ${s}s` }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  const signedIn = (p) =>
    until("the panel to close signed in", () => p.evaluate(() => !document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open")), 20000).then(() => true, () => false);
  const kept = (p) => p.evaluate(() => localStorage["p99:code"] || "");
  const heard = (p) => p.evaluate(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-busy-heard")?.textContent || "");
  const busyShown = (p) => p.locator(S("[data-view=busy]")).count();
  const cached = (p) => p.evaluate(() => { try { return Boolean(JSON.parse(sessionStorage["p99:code"])[1].counts); } catch { return false; } });
  const fetched = (p) => p.evaluate(() => window.__p99Fetched.slice());
  const settle = (p, url) =>
    p.evaluate(async (u) => {
      await import(u);
      for (let i = 0; i < 3; i++) await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
    }, url);
  const styled = (list) => list.some((u) => u === "/_p99/p99.css");

  for (const status of [429, 503]) {
    await story(`a visitor whose code link meets a ${status} from a busy P99 is told so, waits, and is signed in without asking again`, async () => {
      const { ctx, p, seen, errors } = await busyVisit([status]);
      check(`a ${status} opens the panel signing them in, saying P99 is busy`, await busyLine(p, 1));
      check("the panel shows no report form", (await p.locator(S(".p99-new")).count()) === 0);
      check("its title says it is signing them in", (await p.locator(S("[data-view=busy] h2")).textContent()) === "Signing you in");
      await p.clock.runFor(1000);
      check(`the retry after 1 s signs them in and the panel closes (${seen.join(",")})`, await signedIn(p));
      check(`/me was asked twice, the loader's and one retry (${seen.join(",")})`, seen.length === 2 && seen[1] === 200);
      check("the code is kept, never asked for again", (await kept(p)) === busyCode);
      check("the bar has their counts from the retry", await cached(p));
      check("the + is there to report", await p.locator("p99-root >> .w .f").isVisible());
      check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
      await ctx.close();
    });
  }

  await story("a run of failures backs off 1, 2, 4, 8 then every 30 seconds, counting down, and signs in the moment /me answers", async () => {
    const { ctx, p, seen, errors } = await busyVisit([503, 429, 500, 502, 503, 429]);
    check("the first wait is 1 s", await busyLine(p, 1));
    await p.clock.runFor(1000);
    check("after one failed retry the wait is 2 s", await busyLine(p, 2));
    await p.clock.runFor(1000);
    check("and it counts down to 1 s", await busyLine(p, 1));
    await p.clock.runFor(1000);
    check("then 4 s", await busyLine(p, 4));
    check(`a screen reader hears the new wait once (${await heard(p)})`, (await heard(p)) === "P99 is busy, trying again in 4s");
    await p.clock.runFor(1000);
    check(`and not every tick of the countdown (${await heard(p)})`, (await busyLine(p, 3)) && (await heard(p)) === "P99 is busy, trying again in 4s");
    await p.clock.runFor(3000);
    check("then 8 s", await busyLine(p, 8));
    await p.clock.runFor(8000);
    check("then 30 s", await busyLine(p, 30));
    check(`five asks so far (${seen.length})`, seen.length === 5);
    await p.clock.runFor(29000);
    check(`nothing is asked before the 30 s are up (${seen.length})`, seen.length === 5 && (await busyLine(p, 1)));
    await p.clock.runFor(1000);
    check("after another failure it waits 30 s again", await busyLine(p, 30));
    check("the panel never shows a report form", (await p.locator(S(".p99-new")).count()) === 0);
    await p.clock.runFor(30000);
    check(`the seventh ask answers and they are signed in (${seen.join(",")})`, (await signedIn(p)) && seen.length === 7);
    check("the code is kept", (await kept(p)) === busyCode);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a visitor who switches away while P99 is busy is not retried until they come back", async () => {
    const { ctx, p, seen } = await busyVisit([429]);
    check("the panel says P99 is busy", await busyLine(p, 1));
    await p.evaluate(() => window.__p99Hide(true));
    await p.clock.runFor(120000);
    check(`a hidden tab asks nothing more (${seen.length})`, seen.length === 1);
    check("the line still waits", await busyLine(p, 1));
    await p.evaluate(() => window.__p99Hide(false));
    check(`back on the tab, the retry runs and signs them in (${seen.join(",")})`, (await signedIn(p)) && seen.length === 2);
    check("the code is kept", (await kept(p)) === busyCode);
    await ctx.close();
  });

  await story("a visitor who switches away mid-countdown finds it paused at the same second and counting on when they come back", async () => {
    const { ctx, p, seen } = await busyVisit([503, 503, 503, 503]);
    check("the first wait is 1 s", await busyLine(p, 1));
    await p.clock.runFor(1000);
    check("then 2 s", await busyLine(p, 2));
    await p.clock.runFor(2000);
    check("then 4 s", await busyLine(p, 4));
    await p.clock.runFor(4000);
    check(`after three failures the wait is 8 s (${seen.length})`, (await busyLine(p, 8)) && seen.length === 4);
    await p.evaluate(() => window.__p99Hide(true));
    await p.clock.runFor(60000);
    check(`a hidden tab asks nothing in a minute (${seen.length})`, seen.length === 4);
    check("the line still says 8 s", await busyLine(p, 8));
    await p.evaluate(() => window.__p99Hide(false));
    check("back on the tab it counts on from 7 s", await busyLine(p, 7));
    await p.clock.runFor(6000);
    check(`nothing is asked before the rest of the wait (${seen.length})`, seen.length === 4);
    await p.clock.runFor(1000);
    check(`then the retry signs them in (${seen.join(",")})`, (await signedIn(p)) && seen.length === 5);
    await ctx.close();
  });

  await story("a visitor who shuts the panel while P99 is busy stops the retries, sees no form, and the + still reports", async () => {
    const { ctx, p, seen, errors } = await busyVisit([503, 503]);
    check("the panel says P99 is busy", await busyLine(p, 1));
    await p.clock.runFor(1000);
    check(`one retry failed and the wait is 2 s (${seen.length})`, (await busyLine(p, 2)) && seen.length === 2);
    await p.keyboard.press("Escape");
    await until("the panel to shut", async () => !(await panelOpen(p)));
    await p.clock.runFor(120000);
    check(`no more asks once it is shut (${seen.length})`, seen.length === 2);
    check("no report form opened on its own", !(await panelOpen(p)) && (await p.locator(S(".p99-new")).count()) === 0);
    await openForm(p);
    check("the + opens an ordinary report form", (await busyShown(p)) === 0 && (await p.locator(TITLE).isVisible()));
    check(`the + asks /me once more and signs them in (${seen.join(",")})`, seen.length === 3 && seen[2] === 200);
    check("the bar has their counts from that ask", await cached(p));
    check("the code is kept", (await kept(p)) === busyCode);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a visitor who already opened + when the code link's /me comes back 503 keeps the form they are writing", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    let release;
    const held = new Promise((r) => (release = r));
    let first = true;
    await ctx.route((u) => u.pathname === "/_p99/api/me", async (route) => {
      if (!first) return route.fallback();
      first = false;
      await held;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
    });
    const p = await ctx.newPage();
    await p.goto(`${PAGE}#p99=${busyCode}`);
    await openForm(p);
    await p.locator(TITLE).fill("Half a sentence");
    release();
    await until("the held /me to answer", () => p.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/_p99/api/me")).length >= 2));
    await frames(p);
    check("no busy view replaces the form", (await busyShown(p)) === 0);
    check("the title they typed is still there", (await p.locator(TITLE).inputValue()) === "Half a sentence");
    await ctx.close();
  });

  await story("a retry that never answers is given up after 10 seconds and tried again, so the countdown never sticks", async () => {
    const { ctx, p, seen, errors } = await busyVisit([503, "hang"]);
    check("the panel says P99 is busy", await busyLine(p, 1));
    await p.clock.runFor(1000);
    await until("the retry that hangs", () => seen.length >= 2);
    await p.clock.runFor(9999);
    check(`the hung retry is still waited for just short of 10 s (${seen.length})`, seen.length === 2 && (await panelOpen(p)) && (await busyShown(p)) === 1);
    await p.clock.runFor(1);
    check("at 10 s it is given up and the next wait is 2 s", await busyLine(p, 2));
    await p.clock.runFor(2000);
    check(`the next retry signs them in (${seen.join(",")})`, (await signedIn(p)) && seen.length === 3);
    check("the code is kept", (await kept(p)) === busyCode);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a retry that asks for the authenticator code confirms it and signs them in, never opening a report form", async () => {
    const counts = { mine_unread: 0, mine_open: 0, page_open: 0 };
    const { ctx, p, seen, errors } = await busyVisit([503, 428, { counts }]);
    let device = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/verify", (route) => {
      device++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ device: "d1" }) });
    });
    check("the panel says P99 is busy", await busyLine(p, 1));
    await p.clock.runFor(1000);
    const asked = await p.locator(S("[data-view=verify] input[name=totp]")).waitFor({ timeout: 20000 }).then(() => true, () => false);
    check("the 428 asks for the authenticator code", asked);
    check("no report form is behind it", (await p.locator(S(".p99-new")).count()) === 0);
    await p.locator(S("[data-view=verify] input[name=totp]")).fill("123456");
    await p.locator(S("[data-view=verify] button[type=submit]")).click();
    const closed = await signedIn(p);
    check(`a good code signs them in and the panel closes (${seen.join(",")})`, closed && device === 1 && seen.length >= 3 && seen[2] === 200);
    check("no report form opened on the way", (await p.locator(S(".p99-new")).count()) === 0);
    check("the code is kept, now with this browser remembered", (await kept(p)) === `${busyCode.split(".")[0]}.d1`);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a visitor who clicks + just before the code link's 503 arrives gets the report form, not the busy view", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    const first = gate();
    const second = gate();
    let asks = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/me", async (route) => {
      const n = ++asks;
      if (n === 1) {
        await first.opened;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
      }
      if (n === 2) await second.opened;
      return route.fallback();
    });
    const p = await ctx.newPage();
    await p.goto(`${PAGE}#p99=${busyCode}`);
    await p.locator("p99-root >> .w .f").click();
    await until("the + to ask /me", () => asks >= 2);
    const busyAnswer = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/me" && r.status() === 503);
    first.open();
    await busyAnswer;
    await frames(p);
    second.open();
    await p.locator(TITLE).waitFor({ timeout: 20000 });
    await frames(p);
    check("the report form they asked for is open", await p.locator(TITLE).isVisible());
    check("no busy view replaced it", (await busyShown(p)) === 0);
    await ctx.close();
  });

  await story("a returning visitor with no code link meets a 503 in silence: no panel, no form, and the + still reports", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript((c) => { try { localStorage["p99:code"] = c; } catch {} }, busyCode);
    let asks = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => {
      asks++;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
    });
    const p = await ctx.newPage();
    const panels = [];
    p.on("request", (r) => new URL(r.url()).pathname === "/_p99/panel.js" && panels.push(r.url()));
    await p.goto(PAGE);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the loader's /me", () => asks >= 1);
    await until("the loader to read the 503", () => p.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/_p99/api/me"))));
    await frames(p);
    await frames(p);
    check("no panel opens", !(await panelOpen(p)));
    check(`the panel isn't even loaded for it (${panels.length})`, panels.length === 0);
    check(`it asks once and does not retry on its own (${asks})`, asks === 1);
    await openForm(p);
    check("the + opens an ordinary report form", (await busyShown(p)) === 0);
    await ctx.close();
  });

  await story("a code link whose /me answers an unexpected 404 opens no empty report form", async () => {
    const { ctx, p, seen, panels } = await busyVisit([404]);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the loader's /me", () => seen.length >= 1);
    await until("the panel module the 404 loads", () => panels.length >= 1);
    await settle(p, panels[0]);
    const asked = await fetched(p);
    check("the panel stays shut", !(await panelOpen(p)));
    check("no report form opened on its own", (await p.locator(S(".p99-new")).count()) === 0);
    check(`the panel asks /me nothing more and loads no styles (${asked.join(",")})`, seen.length === 1 && asked.filter((u) => u === "/_p99/api/me").length === 1 && !styled(asked));
    await p.evaluate(() => window.P99.open());
    check("the + still opens an ordinary report form after it", await p.locator(TITLE).waitFor({ timeout: 20000 }).then(() => true, () => false));
    await ctx.close();
  });

  await story("a visitor signed in from a code link who moves to another page while P99 is busy sees no panel and no form", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    await ctx.addInitScript(watchFetch);
    let asks = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => {
      if (++asks === 1) return route.fallback();
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy", message: "busy" }) });
    });
    const p = await ctx.newPage();
    const errors = [];
    const panels = [];
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    p.on("requestfinished", (r) => new URL(r.url()).pathname === "/_p99/panel.js" && panels.push(r.url()));
    await p.goto(`${PAGE}#p99=${busyCode}`);
    await until("the code link's /me to sign them in", () => cached(p));
    const busyAnswer = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/me" && r.status() === 503);
    await p.evaluate(() => {
      history.pushState(history.state, "", "/checkout/paid");
      document.body.append(document.createElement("div"));
    });
    await busyAnswer;
    await until("the panel module the 503 is handed to", () => panels.length >= 1);
    await settle(p, panels[0]);
    const asked = await fetched(p);
    check(`the new page asked /me and met the 503 (${asks})`, asks === 2);
    check("no panel opens", !(await panelOpen(p)));
    check("no busy view and no report form", (await busyShown(p)) === 0 && (await p.locator(S(".p99-new")).count()) === 0);
    check(`the panel asks nothing and loads no styles for it (${asked.join(",")})`, asked.filter((u) => u === "/_p99/api/me").length === 2 && !styled(asked));
    check("the code is kept", (await kept(p)) === busyCode);
    check("the + is there to report", await p.locator("p99-root >> .w .f").isVisible());
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a retry that meets an unexpected 404 says what went wrong and opens no report form", async () => {
    const { ctx, p, seen, errors } = await busyVisit([503, 404]);
    check("the panel says P99 is busy", await busyLine(p, 1));
    await p.clock.runFor(1000);
    const failed = await p.locator(S(".p99-failed .p99-error")).waitFor({ timeout: 20000 }).then(() => true, () => false);
    check(`the panel says the retry failed (${seen.join(",")})`, failed && seen.length === 2);
    check("the busy line is gone", (await busyShown(p)) === 0);
    check("no report form opened", (await p.locator(S(".p99-new")).count()) === 0);
    await p.clock.runFor(120000);
    check(`nothing more is asked (${seen.length})`, seen.length === 2);
    check("the code is kept", (await kept(p)) === busyCode);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a visitor who goes offline while P99 is busy is told they are offline, and signed in when back", async () => {
    const { ctx, p } = await busyVisit([503]);
    check("the panel says P99 is busy", await busyLine(p, 1));
    await ctx.setOffline(true);
    await p.clock.runFor(1000);
    const offline = await p.locator(S(".p99-busy-line"), { hasText: "You're offline" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
    check("the line says they are offline, not that P99 is busy", offline);
    check("the panel shows no report form", (await p.locator(S(".p99-new")).count()) === 0);
    await ctx.setOffline(false);
    await p.clock.runFor(2000);
    check("back online, the retry signs them in", await signedIn(p));
    check("the code is kept", (await kept(p)) === busyCode);
    await ctx.close();
  });

  for (const [why, statuses] of [["a 401 straight away", [401]], ["a 403 straight away", [403]], ["a 401 on the retry", [429, 401]], ["a 403 on the retry", [429, 403]]]) {
    await story(`a code refused with ${why} still says the link is no longer valid, and no form opens`, async () => {
      const { ctx, p } = await busyVisit(statuses);
      if (statuses.length > 1) {
        check("the panel first says P99 is busy", await busyLine(p, 1));
        await p.clock.runFor(1000);
      }
      const gone = await p.locator("p99-root >> .p99-gone").waitFor({ timeout: 20000 }).then(() => true, () => false);
      check("the line by the button says the link isn't valid", gone && /isn't valid here/.test(await p.locator("p99-root >> .p99-gone").textContent()));
      check("the panel is shut with no report form", !(await panelOpen(p)) && (await p.locator(S(".p99-new")).count()) === 0);
      check("the site forgets the code", (await kept(p)) === "");
      await ctx.close();
    });
  }

  for (const status of [401, 403]) {
    await story(`a visitor who shuts the busy panel and presses + when P99 comes back with a ${status} is told the link isn't valid, with no form`, async () => {
      const { ctx, p, seen, errors, panels } = await busyVisit([503, status]);
      check("the panel says P99 is busy", await busyLine(p, 1));
      await p.keyboard.press("Escape");
      await until("the panel to shut", async () => !(await panelOpen(p)));
      await p.locator("p99-root >> .w .f").click();
      const gone = await p.locator("p99-root >> .p99-gone").waitFor({ timeout: 20000 }).then(() => true, () => false);
      await settle(p, panels[0]);
      check(`the + asked /me once more and met the ${status} (${seen.join(",")})`, seen.length === 2 && seen[1] === status);
      check("the line by the button says the link isn't valid", gone && /isn't valid here/.test(await p.locator("p99-root >> .p99-gone").textContent()));
      check("the panel is shut with no report form", !(await panelOpen(p)) && (await p.locator(S(".p99-new")).count()) === 0);
      check("the site forgets the code", (await kept(p)) === "");
      check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
      await ctx.close();
    });
  }

  await story("a file over 20 MB is refused in the form by name, and the report still sends with the rest", async () => {
    const { ctx, p } = await visit();
    await openForm(p);
    await shotReady(p);
    const title = tag("Too big to attach");
    await write(p, title);
    const big = Buffer.alloc(MAX_FILE + 1, 0x41);
    await p.locator(S(".p99-new input[name=files]")).setInputFiles([
      { name: "export.txt", mimeType: "text/plain", buffer: big },
      { name: "order.txt", mimeType: "text/plain", buffer: NOTE },
    ]);
    await waitStatus(p, /over 20 MB/);
    check("the status line names the file that is too big", /export\.txt/.test(await statusLine(p)));
    const listed = await p.locator(S(".p99-new .p99-file-list li span")).allTextContents();
    check(`only the file that fits is listed (${listed.join(",")})`, listed.join(",") === "order.txt");
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    const t = item ? await must("GET", `/issues/${item.key}?host=${HOST}`) : { attachments: [] };
    const files = t.attachments.filter((a) => a.role === "file").map((a) => a.name);
    check(`the item holds the file that fits and not the big one (${files.join(",")})`, files.join(",") === "order.txt");
    await ctx.close();
  });

  for (const [how, init] of [
    ["blocks cookies and site storage", blockStorage],
    ["reads storage but refuses every write", refuseWrites],
  ]) {
    await story(`a visitor whose browser ${how} can still report from their link`, async () => {
      const { ctx, p, errors } = await visit({ init: [init] });
      check(`${how}: the + shows`, await p.locator("p99-root >> .w .f").isVisible());
      await openForm(p);
      await shotReady(p);
      const title = tag(`Reported with storage that ${how}`);
      await write(p, title);
      await p.locator(SEND).click();
      await thread(p);
      const items = await found(title);
      check(`${how}: one item arrived (${items.length})`, items.length === 1);
      if (items[0]) {
        const t = await must("GET", `/issues/${items[0].key}?host=${HOST}`);
        check(`${how}: with its screenshot`, t.attachments.some((a) => a.role === "screenshot"));
        const own = (t.issue.context.errors || []).filter((m) => /insecure|quota/i.test(m));
        check(`${how}: the report doesn't blame the site for P99's own storage error (${own.join(" | ")})`, own.length === 0);
      }
      check(`${how}: the code left the address bar`, !(await p.evaluate(() => location.href)).includes(code));
      check(`${how}: no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
      await ctx.close();
    });
  }

  await story("a site not set up for P99 shows no widget and throws nothing into its page", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    const loader = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/p99.js", { timeout: 20000 });
    await p.goto(`http://${UNSET}/checkout#p99=${code}`, { waitUntil: "load" });
    const answer = await loader;
    await frames(p);
    check(`the loader answers 404 (${answer.status()})`, answer.status() === 404);
    check("no widget is on the page", (await p.locator("p99-root").count()) === 0);
    check(`the page throws nothing (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("another site's page can't file or read through a visitor's browser, even holding a code", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(`http://${EVIL}/checkout`, { waitUntil: "load" });
    const title = tag("Filed from another site");
    const body = JSON.stringify({ client_uid: randomUUID(), kind: "bug", title, body: "", page: { url: PAGE, path: "/checkout", title: "Checkout" }, context: {}, marks: [] });
    const r = await p.evaluate(
      async ({ target, code, body }) => {
        const out = {};
        try {
          out.post = (await fetch(`${target}/_p99/api/issues`, { method: "POST", headers: { "X-P99-Code": code, "Content-Type": "application/json" }, body })).status;
        } catch {
          out.post = "blocked";
        }
        try {
          out.read = (await fetch(`${target}/_p99/api/me`, { headers: { "X-P99-Code": code } })).status;
        } catch {
          out.read = "blocked";
        }
        try {
          await fetch(`${target}/_p99/api/issues`, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body });
          out.simple = "sent";
        } catch {
          out.simple = "blocked";
        }
        return out;
      },
      { target: `http://${HOST}`, code, body },
    );
    check(`a fetch carrying the code is blocked by the browser (${r.post})`, r.post === "blocked");
    check(`reading the visitor's details is blocked (${r.read})`, r.read === "blocked");
    check("nothing is filed", (await found(title)).length === 0);
    await ctx.close();
  });

  await story("a visitor's title of 200 emoji is filed whole, and a longer title or body is refused in the form, never sent cut", async () => {
    const { ctx, p, errors } = await visit();
    const posts = [];
    p.on("request", (r) => {
      if (isPost(r.url(), r.method())) posts.push(r.url());
    });
    const head = `[${RUN}] `;
    const typed = async (title) => {
      await openForm(p);
      await shotReady(p);
      await p.locator(TITLE).click();
      await p.keyboard.insertText(title);
      return p.locator(TITLE).inputValue();
    };
    const whole = `${head}${"🚀".repeat(200 - [...head].length)}`;
    check("200 characters of emoji fit in the title field", (await typed(whole)) === whole);
    await p.locator(SEND).click();
    await thread(p);
    const filed = (await must("GET", `/issues?scope=all&host=${HOST}&q=${RUN}`)).issues.map((i) => i.title);
    check(`the 200-emoji title arrives whole (${filed.length})`, filed.includes(whole));
    await p.locator(S(".p99-x")).click();
    await until("the panel to close", async () => !(await panelOpen(p)));
    const sent = posts.length;
    const long = `${head}${"🎉".repeat(194)}`;
    check("the field takes more than 200 characters of emoji", (await typed(long)) === long);
    await p.locator(SEND).click();
    await waitStatus(p, /over 200 characters/);
    check(`the status says the title is over 200 characters ("${await statusLine(p)}")`, /over 200 characters/.test(await statusLine(p)));
    check(`nothing is sent (${posts.length - sent} sends)`, posts.length === sent);
    check("the title keeps every character typed", (await p.locator(TITLE).inputValue()) === long);
    check("the title field has the focus", await p.locator(TITLE).evaluate((n) => n.getRootNode().activeElement === n));
    const ascii = `${head}${"t".repeat(201 - head.length)}`;
    await p.locator(TITLE).fill(ascii);
    await p.locator(SEND).click();
    check(`a 201-letter title is refused too (${posts.length - sent} sends)`, /over 200 characters/.test(await statusLine(p)) && posts.length === sent);
    const BODY = S(".p99-new textarea[name=body]");
    await p.locator(TITLE).fill(tag("A long body"));
    const body = "b".repeat(20001);
    await p.locator(BODY).fill(body);
    await p.locator(SEND).click();
    await waitStatus(p, /over 20,000 characters/);
    check(`a 20,001-letter body is refused in the form (${posts.length - sent} sends)`, posts.length === sent);
    check("the body keeps every character typed", (await p.locator(BODY).inputValue()) === body);
    check("the body field has the focus", await p.locator(BODY).evaluate((n) => n.getRootNode().activeElement === n));
    check(`no script error on the page (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("closing the panel while a report uploads and starting another keeps the new draft", async () => {
    const { ctx, p } = await visit();
    const uploading = gate();
    let held = 0;
    const gets = [];
    await p.route((u) => /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(u.pathname), async (route) => {
      held++;
      await uploading.opened;
      await route.fallback();
    });
    p.on("request", (r) => {
      if (isItemGet(r.url(), r.method())) gets.push(r.url());
    });
    await openForm(p);
    await shotReady(p);
    const first = tag("The first report, still uploading");
    await write(p, first);
    await p.locator(SEND).click();
    await until("the held upload", () => held >= 1);
    await p.locator(S(".p99-x")).click();
    await until("the panel to close", async () => !(await panelOpen(p)));
    await openForm(p);
    const second = tag("A second report typed meanwhile");
    await write(p, second, "Half written.");
    const refresh = p.waitForRequest((r) => new URL(r.url()).pathname === "/_p99/api/me", { timeout: 20000 });
    uploading.open();
    await refresh;
    await frames(p);
    const still = await p.locator(TITLE).count() === 1 && (await p.locator(TITLE).inputValue()) === second;
    check(`the second draft is still on screen with its title (${gets.length} thread loads)`, still);
    check("no thread was loaded over it", gets.length === 0);
    check("the first report arrived whole", (await found(first)).length === 1);
    await ctx.close();
  });

  await story("closing the panel while a report uploads leaves it shut when the upload finishes", async () => {
    const { ctx, p } = await visit();
    const uploading = gate();
    let held = 0;
    const gets = [];
    await p.route((u) => /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(u.pathname), async (route) => {
      held++;
      await uploading.opened;
      await route.fallback();
    });
    p.on("request", (r) => {
      if (isItemGet(r.url(), r.method())) gets.push(r.url());
    });
    await openForm(p);
    await shotReady(p);
    const title = tag("Sent, then the panel closed");
    await write(p, title);
    await p.locator(SEND).click();
    await until("the held upload", () => held >= 1);
    await p.locator(S(".p99-x")).click();
    await until("the panel to close", async () => !(await panelOpen(p)));
    const refresh = p.waitForRequest((r) => new URL(r.url()).pathname === "/_p99/api/me", { timeout: 20000 });
    uploading.open();
    await refresh;
    await frames(p);
    check("the panel stays shut", !(await panelOpen(p)));
    check(`no thread was loaded (${gets.length})`, gets.length === 0);
    check("the report arrived", (await found(title)).length === 1);
    await ctx.close();
  });

  await story("switching to Your cards while a report uploads keeps the list when the upload finishes", async () => {
    const { ctx, p } = await visit();
    const uploading = gate();
    let held = 0;
    const gets = [];
    await p.route((u) => /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(u.pathname), async (route) => {
      held++;
      await uploading.opened;
      await route.fallback();
    });
    p.on("request", (r) => {
      if (isItemGet(r.url(), r.method())) gets.push(r.url());
    });
    await openForm(p);
    await shotReady(p);
    const title = tag("Sent, then Your cards opened");
    await write(p, title);
    await p.locator(SEND).click();
    await until("the held upload", () => held >= 1);
    await p.locator("p99-root >> .w .b:not(.f)").dispatchEvent("click");
    await p.locator(S("[data-view=list]")).waitFor({ timeout: 20000 });
    const refresh = p.waitForRequest((r) => new URL(r.url()).pathname === "/_p99/api/me", { timeout: 20000 });
    uploading.open();
    await refresh;
    await frames(p);
    check("the panel stays open", await panelOpen(p));
    check("the list stays on screen", await p.locator(S("[data-view=list]")).isVisible());
    check("no thread opened over it", !(await p.locator(S("[data-view=item]")).isVisible()));
    check(`no thread was loaded (${gets.length})`, gets.length === 0);
    check("the report arrived", (await found(title)).length === 1);
    await ctx.close();
  });

  for (const [why, status, body] of [
    ["the per-minute limit", 429, { error: "rate_limited", message: "too many requests with this code; try again in a minute" }],
    ["a server hiccup", 503, { error: "internal", message: "something went wrong" }],
  ]) {
    await story(`a send slowed once by ${why} is retried quietly and files one item`, async () => {
      const { ctx, p } = await visit();
      const uids = [];
      let refused = 0;
      await p.route((u) => u.pathname === "/_p99/api/issues", async (route) => {
        const r = route.request();
        if (r.method() !== "POST") return route.fallback();
        uids.push(JSON.parse(r.postData()).client_uid);
        if (refused++) return route.fallback();
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      });
      await openForm(p);
      await shotReady(p);
      const title = tag(`Slowed by ${why}`);
      await write(p, title);
      await p.locator(SEND).click();
      await thread(p);
      check(`${why}: sent twice with one id (${uids.length} sends, ${new Set(uids).size} ids)`, uids.length === 2 && new Set(uids).size === 1);
      check(`${why}: one item arrived (${(await found(title)).length})`, (await found(title)).length === 1);
      await ctx.close();
    });
  }

  await story("a screenshot refused by the daily file limit is named at once, not retried, and the item stays filed", async () => {
    const { ctx, p } = await visit();
    const puts = [];
    await p.route((u) => /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(u.pathname), async (route) => {
      puts.push(route.request().url());
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", message: "today's limit of 100 MB of files is reached" }) });
    });
    await openForm(p);
    await shotReady(p);
    const title = tag("Over the day's files");
    await write(p, title);
    await p.locator(SEND).click();
    await waitStatus(p, /didn't upload/);
    check(`each upload was tried once (${puts.length})`, puts.length >= 1 && new Set(puts).size === puts.length);
    check("the status names the screenshot", /screen\.(webp|jpg|png)/.test(await statusLine(p)));
    check(`the status names the daily file limit ("${await statusLine(p)}")`, /today's limit of 100 MB of files/.test(await statusLine(p)));
    check("the visitor isn't told to try again against a limit that holds all day", !/try again/i.test(await statusLine(p)));
    check("no Retry is offered for a limit that holds all day", !(await p.locator(RETRY).isVisible()));
    check("the item is filed", (await found(title)).length === 1);
    await ctx.close();
  });

  const COMMENT = S("[data-view=item] .p99-comment-form");
  const commentLine = (p) => p.locator(`${COMMENT} .p99-status-line`).textContent();
  const threadFor = async (title, as) => {
    const { ctx, p } = await visit({ as });
    await openForm(p);
    await shotReady(p);
    await write(p, title);
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    if (!item) throw new Error(`the item "${title}" was never filed`);
    const posts = [];
    p.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === `/_p99/api/issues/${item.key}/comments`) posts.push(JSON.parse(r.postData() || "{}").client_uid);
    });
    return { ctx, p, item, posts };
  };
  const stored = async (item, body) => (await must("GET", `/issues/${item.key}?host=${HOST}`)).comments.filter((c) => c.body === body);

  await story("a comment of 20,000 letters is stored whole, and one of 20,001 is refused in the form, never sent cut", async () => {
    const { ctx, p, item, posts } = await threadFor(tag("A thread with a long comment"));
    const field = p.locator(`${COMMENT} textarea[name=body]`);
    const over = `${tag("Over")} ${"c".repeat(20001)}`.slice(0, 20001);
    await field.fill(over);
    await p.locator(`${COMMENT} button[type=submit]`).click();
    await p.waitForFunction(() => /over 20,000 characters/.test(document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=item] .p99-comment-form .p99-status-line")?.textContent || ""), null, { timeout: 20000 });
    check(`the comment is refused before it is sent (${posts.length} sends)`, posts.length === 0);
    check("the comment keeps every character typed", (await field.inputValue()) === over);
    check("nothing is stored", (await stored(item, over)).length === 0);
    const whole = over.slice(0, 20000);
    await field.fill(whole);
    await p.locator(`${COMMENT} button[type=submit]`).click();
    await p.locator(S(".p99-comment .p99-body")).first().waitFor({ timeout: 20000 });
    check(`the 20,000-letter comment is stored whole (${posts.length} sends)`, posts.length === 1 && (await stored(item, whole)).length === 1);
    await ctx.close();
  });

  await story("an Owner's comment is marked and set off; a role on the author wins over manager, and manager stands in when no role is sent", async () => {
    const { ctx, p, item } = await threadFor(tag("A thread with Owners' comments"));
    const at = "2026-01-05T09:00:00.000Z";
    const said = (n, author) => ({ id: `c-${n}`, body: `${tag("said")} ${n}`, created_at: at, internal: false, attachments: [], author });
    const extra = [
      said("owner", { name: "Grace Hopper", email: "grace@example.com", role: "owner" }),
      said("manager", { name: "Lin Okafor", email: "lin@example.com", manager: true }),
      said("user", { name: "Alan Turing", email: "alan@example.com", role: "user", manager: true }),
      said("plain", { name: "Alan Turing", email: "alan@example.com" }),
    ];
    await p.route((u) => u.pathname === `/_p99/api/issues/${item.key}`, async (route) => {
      const r = route.request();
      if (r.method() !== "GET") return route.fallback();
      const res = await route.fetch({ url: r.url().replace(`http://${HOST}`, `http://127.0.0.1:${PORT}`), headers: { ...r.headers(), host: HOST } });
      const j = await res.json();
      j.comments = (j.comments || []).concat(extra);
      await route.fulfill({ response: res, json: j });
    });
    await p.evaluate((k) => window.P99.open(k), item.key);
    await p.locator(S(".p99-comment .p99-body"), { hasText: `${tag("said")} plain` }).first().waitFor({ timeout: 20000 });
    const marks = await p.evaluate((t) => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open .p99-comment"))
      .filter((li) => li.textContent.includes(t))
      .map((li) => ({ who: li.querySelector(".p99-body").textContent.split(" ").pop(), owner: li.hasAttribute("data-owner"), margin: parseFloat(getComputedStyle(li).marginRight) })), tag("said"));
    const by = Object.fromEntries(marks.map((m) => [m.who, m]));
    check(`role owner and manager-without-role are marked, role user and a plain author are not (${JSON.stringify(marks)})`, by.owner?.owner && by.manager?.owner && by.user && !by.user.owner && by.plain && !by.plain.owner);
    check(`an Owner's comment sits off the right edge, a User's does not (${by.owner?.margin}, ${by.plain?.margin})`, by.owner?.margin > 0 && by.owner.margin > (by.plain?.margin ?? 0));
    await ctx.close();
  });

  await story("a comment at the daily limit is told at once, keeps its words, and offers no Retry", async () => {
    const { ctx, p, item, posts } = await threadFor(tag("A thread at the day's comments"));
    await p.route((u) => u.pathname === `/_p99/api/issues/${item.key}/comments`, (route) =>
      route.request().method() !== "POST"
        ? route.fallback()
        : route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", message: "today's limit of 200 comments is reached" }) }),
    );
    const body = tag("One comment too many");
    await p.locator(`${COMMENT} textarea[name=body]`).fill(body);
    await p.locator(`${COMMENT} button[type=submit]`).click();
    await p.waitForFunction(() => /today's limit of 200 comments/.test(document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=item] .p99-comment-form .p99-status-line")?.textContent || ""), null, { timeout: 20000 });
    check("the comment's status line names the limit", /today's limit of 200 comments/.test(await commentLine(p)));
    check(`it is told at once, not after hidden retries (${posts.length} sends)`, posts.length === 1);
    check("no Retry is offered for a limit that holds all day", !(await p.locator(`${COMMENT} .p99-retry`).isVisible()));
    check("the comment's words are kept", (await p.locator(`${COMMENT} textarea[name=body]`).inputValue()) === body);
    check("Send works again", !(await p.locator(`${COMMENT} button[type=submit]`).isDisabled()));
    check("nothing is stored", (await stored(item, body)).length === 0);
    await ctx.close();
  });

  await story("a comment slowed once by the per-minute limit is retried quietly and stored once", async () => {
    const { ctx, p, item, posts } = await threadFor(tag("A thread slowed by the per-minute limit"), await mint("Grace Hopper", "grace.slowed@example.com"));
    let refused = 0;
    await p.route((u) => u.pathname === `/_p99/api/issues/${item.key}/comments`, async (route) => {
      if (route.request().method() !== "POST" || refused++) return route.fallback();
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", message: "too many requests with this code; try again in a minute" }) });
    });
    const body = tag("Slowed, then sent");
    await p.locator(`${COMMENT} textarea[name=body]`).fill(body);
    await p.locator(`${COMMENT} button[type=submit]`).click();
    await p.locator(S(".p99-comment .p99-body"), { hasText: body }).first().waitFor({ timeout: 20000 });
    check(`sent twice with one id (${posts.length} sends, ${new Set(posts).size} ids)`, posts.length === 2 && new Set(posts).size === 1);
    check(`one comment is stored (${(await stored(item, body)).length})`, (await stored(item, body)).length === 1);
    check("no Retry was left on screen", !(await p.locator(`${COMMENT} .p99-retry`).isVisible()));
    await ctx.close();
  });

  await story("a lost connection to P99 on arrival never shows up in the site's page errors", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    let dropped = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => (dropped++ ? route.fallback() : route.abort("connectionreset")));
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    await p.goto(`${PAGE}#p99=${code}`);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the dropped /me", () => dropped >= 1);
    await openForm(p);
    await shotReady(p);
    const title = tag("Filed after a dropped /me");
    await write(p, title);
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    const t = item ? await must("GET", `/issues/${item.key}?host=${HOST}`) : { issue: { context: {} } };
    const own = (t.issue.context.errors || []).filter((m) => /fetch|network/i.test(m));
    check(`the report carries no error of P99's own (${own.join(" | ")})`, item && own.length === 0);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a panel that fails to load on hover never shows up in the site's page errors, and the click loads it", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    let aborted = 0;
    await ctx.route((u) => u.pathname === "/_p99/panel.js", (route) => (aborted++ ? route.fallback() : route.abort("connectionreset")));
    const p = await ctx.newPage();
    const errors = [];
    let failedImports = 0;
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    p.on("requestfailed", (r) => {
      if (new URL(r.url()).pathname === "/_p99/panel.js") failedImports++;
    });
    await p.goto(`${PAGE}#p99=${code}`);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await p.locator("p99-root >> .w .f").hover();
    await until("the aborted panel import", () => aborted >= 1 && failedImports >= 1);
    await frames(p);
    await frames(p);
    await openForm(p);
    await shotReady(p);
    const title = tag("Filed after a panel that failed on hover");
    await write(p, title);
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    const t = item ? await must("GET", `/issues/${item.key}?host=${HOST}`) : { issue: { context: {} } };
    const own = (t.issue.context.errors || []).filter((m) => /panel\.js|imported module|_p99/i.test(m));
    check(`the report carries no error of P99's own (${own.join(" | ")})`, item && own.length === 0);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  const meWith = (counts, manager) => ({ name: ADA.name, email: ADA.email, username: "ada", manager, role: manager ? "owner" : "user", host: HOST, env: "production", version: "dev", counts, theme: {}, strings: {}, link: true, license: "free" });
  const dotPage = async (answers, motion = "no-preference", scheme = "light") => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: motion, colorScheme: scheme });
    await ctx.addInitScript(openShadow);
    let n = 0;
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answers[Math.min(n++, answers.length - 1)]) }));
    const p = await ctx.newPage();
    await p.goto(`${PAGE}#p99=${code}`);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the first /me", () => n >= 1);
    await frames(p);
    return { ctx, p, asked: () => n };
  };
  const dot = (p) => p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const q = r.querySelector(".w .b:not(.f)");
    const n = q && q.querySelector(".n:not(.v)");
    const v = q && q.querySelector(".n.v");
    const cs = n && getComputedStyle(n);
    return {
      menu: !!q && !q.hidden,
      text: n ? n.textContent : null,
      page: v ? v.textContent : null,
      label: q ? q.ariaLabel : null,
      title: q ? q.title : null,
      scale: cs ? cs.scale : null,
      easing: cs ? cs.transitionTimingFunction : null,
      duration: cs ? cs.transitionDuration : null,
      onPlus: !!r.querySelector(".w .f .n"),
    };
  });
  const owner = (needs, replies, page, waiting = needs) => meWith({ mine_open: 1, mine_unread: replies + 40, replies, page_open: page, waiting, needs_you: needs }, true);
  const visitor = (replies, page, open = 1) => meWith({ mine_open: open, mine_unread: replies + 40, replies, page_open: page, waiting: null, needs_you: null }, false);
  const words = (blue, page) => `Your cards: ${blue} waiting, ${page} on this page`;

  for (const [name, me, want] of [
    ["an Owner sees the cards in Needs you plus the replies waiting for them at the top right in the accent, and this page's open items at the top left, never on the +", owner(3, 2, 7), { menu: true, text: "5", page: "7", label: words(5, 7), onPlus: false }],
    ["an Owner's Landed and Stuck cards never count at the top right, only Needs you and replies", owner(1, 2, 9, 55), { menu: true, text: "3", page: "9", label: words(3, 9), onPlus: false }],
    ["an Owner with nothing waiting sees the replies waiting for them, never their own moves", owner(0, 4, 5), { menu: true, text: "4", page: "5", label: words(4, 5), onPlus: false }],
    ["an Owner with nothing waiting and no reply sees only this page's open items, at the top left", owner(0, 0, 5), { menu: true, text: "", page: "5", label: words(0, 5), onPlus: false }],
    ["an Owner with nothing at all keeps the ⋯ button and no count", owner(0, 0, 0), { menu: true, text: "", page: "", label: words(0, 0), onPlus: false }],
    ["more than 99 waiting shows 99+", owner(120, 0, 0), { menu: true, text: "99+", page: "", label: words(120, 0), onPlus: false }],
    ["120 open items on this page show 99+ at the top left", owner(0, 0, 120), { menu: true, text: "", page: "99+", label: words(0, 120), onPlus: false }],
    ["a visitor's replies show at the top right and this page's open items at the top left", visitor(2, 6), { menu: true, text: "2", page: "6", label: words(2, 6), onPlus: false }],
    ["a visitor with no reply sees only this page's open items", visitor(0, 6), { menu: true, text: "", page: "6", label: words(0, 6), onPlus: false }],
    ["a visitor's waiting stays null, so nothing new shows when they have nothing", visitor(0, 0, 0), { menu: false, text: "", page: "", label: words(0, 0), onPlus: false }],
  ]) {
    await story(`the dot: ${name}`, async () => {
      const { ctx, p } = await dotPage([me]);
      const d = await dot(p);
      const got = { menu: d.menu, text: d.text, page: d.page, label: d.label, onPlus: d.onPlus };
      check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want) && d.title === want.label);
      if (d.menu) check(`the dot is ${want.text ? "full size" : "scaled to nothing"} when it ${want.text ? "counts" : "has nothing"} (${d.scale})`, want.text ? d.scale === "none" || d.scale === "1" : d.scale === "0");
      await ctx.close();
    });
  }

  const badges = (p) => p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const q = r.querySelector(".w .b:not(.f)");
    const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (c) => {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = "#000";
      paint.fillStyle = c;
      paint.fillRect(0, 0, 1, 1);
      return Array.from(paint.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const box = q.getBoundingClientRect();
    const one = (e) => {
      const cs = getComputedStyle(e);
      const at = e.getBoundingClientRect();
      const back = rgb(cs.backgroundColor);
      const ink = rgb(cs.color);
      return { text: e.textContent, back, ink, contrast: Math.round(ratio(back, ink) * 100) / 100, left: at.left < box.left, right: at.right > box.right, top: at.top < box.top };
    };
    return { blue: one(q.querySelector(".n:not(.v)")), page: one(q.querySelector(".n.v")) };
  });

  for (const [scheme, purple] of [["light", [163, 38, 106]], ["dark", [192, 57, 126]]]) {
    await story(`the dot: in ${scheme} mode both counts read at 4.5:1 or better, the page's in red-purple at the top left and the accent's at the top right`, async () => {
      const { ctx, p } = await dotPage([owner(3, 0, 5)], "reduce", scheme);
      const b = await badges(p);
      check(`${scheme}: the blue count sits at the top right with white text at ${b.blue.contrast}:1 (${JSON.stringify(b.blue)})`, b.blue.text === "3" && b.blue.right && b.blue.top && !b.blue.left && b.blue.contrast >= 4.5 && b.blue.ink.join() === "255,255,255");
      check(`${scheme}: this page's count sits at the top left in ${purple.join(",")} with white text at ${b.page.contrast}:1 (${JSON.stringify(b.page)})`, b.page.text === "5" && b.page.left && b.page.top && !b.page.right && b.page.back.join() === purple.join() && b.page.contrast >= 4.5 && b.page.ink.join() === "255,255,255");
      const shot = process.env.P99_SHOTS;
      if (shot) {
        mkdirSync(shot, { recursive: true });
        const at = await p.evaluate(() => {
          const b = document.querySelector("p99-root").shadowRoot.querySelector(".w").getBoundingClientRect();
          return { x: b.x - 16, y: b.y - 16, width: b.width + 32, height: b.height + 32 };
        });
        await p.screenshot({ path: join(shot, `dots-${scheme}.png`), clip: at });
      }
      await ctx.close();
    });
  }

  await story("the dot grows in eased, never linear, when something starts waiting after a page change", async () => {
    const { ctx, p, asked } = await dotPage([owner(0, 0, 0), owner(2, 0, 0)]);
    const before = await dot(p);
    check(`no dot at first (${JSON.stringify(before)})`, before.menu && before.text === "" && before.scale === "0");
    check(`its transition is eased over 0.3s (${before.easing}, ${before.duration})`, before.easing !== "linear" && !/linear/.test(before.easing) && before.duration === "0.3s");
    await p.evaluate(() => {
      history.pushState(null, "", "/checkout/review");
      document.body.append(document.createElement("i"));
    });
    await until("the second /me", () => asked() >= 2);
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".w .n")?.textContent === "2");
    const growing = await p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".w .n").getAnimations().map((a) => ({ property: a.transitionProperty, easing: a.effect.getTiming().easing, state: a.playState })));
    const scale = growing.find((a) => a.property === "scale");
    check(`the 2 grows in through a scale transition that eases (${JSON.stringify(growing)})`, !!scale && scale.easing !== "linear");
    await until("the transition's end", async () => (await dot(p)).scale !== "0" && (await p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".w .n").getAnimations().length)) === 0, 3000);
    const after = await dot(p);
    check(`then it sits at full size (${JSON.stringify(after)})`, after.text === "2" && (after.scale === "none" || after.scale === "1"));
    await ctx.close();
  });

  await story("under reduced motion the dot never fades, from the first paint and with the panel loaded, and keeps its ease otherwise", async () => {
    for (const [motion, want] of [["reduce", "0s"], ["no-preference", "0.3s"]]) {
      const { ctx, p } = await dotPage([owner(2, 0, 0)], motion);
      const first = await dot(p);
      const loaded = await p.evaluate(() => performance.getEntriesByType("resource").some((r) => new URL(r.name).pathname === "/_p99/panel.js"));
      check(`${motion}: before any click the panel isn't loaded and the dot's transition lasts ${want} (${first.duration}, ${loaded})`, first.text === "2" && first.duration === want && !loaded);
      if (motion === "reduce") {
        const moving = await p.evaluate(() => document.querySelector("p99-root").shadowRoot.querySelector(".w .n").getAnimations().length);
        check(`reduce: the dot's first count shows without a running transition (${moving})`, moving === 0);
      }
      await p.locator("p99-root >> .w .b:not(.f)").click();
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 20000 });
      const d = await dot(p);
      check(`${motion}: the dot's transition lasts ${want} with the panel loaded (${d.duration})`, d.text === "2" && d.duration === want);
      await ctx.close();
    }
  });

  for (const [name, me, board] of [
    ["a Worker that sends no role: manager stands in, so a manager is an Owner", (() => { const m = owner(0, 0, 1); delete m.role; return m; })(), true],
    ["a Worker that sends no role: a non-manager is a User", (() => { const m = visitor(0, 1); delete m.role; return m; })(), false],
    ["a role of user wins over a manager flag", { ...owner(0, 0, 1), role: "user" }, false],
    ["a role of owner wins over a missing manager flag", { ...visitor(0, 1), role: "owner", manager: false }, true],
  ]) {
    await story(`roles: ${name}`, async () => {
      const { ctx, p } = await dotPage([me]);
      await p.locator("p99-root >> .w .b:not(.f)").click();
      await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 20000 });
      const got = await p.evaluate(() => { const r = document.querySelector("p99-root").shadowRoot; return { board: !!r.querySelector(".p99-board-open"), pick: !!r.querySelector(".p99-panel.is-open .p99-pick") }; });
      check(`${name}: Board ${board ? "and the filter show" : "and the filter stay off"} (${JSON.stringify(got)})`, got.board === board && got.pick === board);
      await ctx.close();
    });
  }

  await story("the dot's empty rule shrinks only the dot: the panel's fields, checkboxes and images keep their size", async () => {
    const { ctx, p } = await dotPage([owner(0, 0, 0)]);
    await p.locator("p99-root >> .w .f").click();
    await p.locator(TITLE).waitFor({ timeout: 20000 });
    await frames(p);
    const boxes = await p.evaluate(() => {
      const panel = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open");
      const all = Array.from(panel.querySelectorAll("input:not([type=hidden]), textarea, img, canvas"));
      const box = (e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), type: e.type || "", scale: getComputedStyle(e).scale, w: r.width, h: r.height }; };
      return {
        scaled: all.filter((e) => getComputedStyle(e).scale === "0").map(box),
        title: box(panel.querySelector(".p99-new input[name=title]")),
        body: box(panel.querySelector(".p99-new textarea[name=body]")),
        check: panel.querySelector(".p99-new input[type=checkbox]") ? box(panel.querySelector(".p99-new input[type=checkbox]")) : null,
        lockup: panel.querySelector("img.p99-lockup") ? box(panel.querySelector("img.p99-lockup")) : null,
      };
    });
    const sized = (b) => !!b && b.scale !== "0" && b.w > 0 && b.h > 0;
    check(`no input, textarea or image in the panel is scaled to nothing (${JSON.stringify(boxes.scaled)})`, boxes.scaled.length === 0);
    check(`the title, the description, a checkbox and the lockup each keep a box (${JSON.stringify(boxes)})`, sized(boxes.title) && sized(boxes.body) && sized(boxes.check) && sized(boxes.lockup));
    await ctx.close();
  });

  const mePage = async (me, scheme = "light") => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", colorScheme: scheme });
    await ctx.addInitScript(openShadow);
    const seen = [];
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
    const p = await ctx.newPage();
    p.on("request", (r) => seen.push({ method: r.method(), path: new URL(r.url()).pathname, type: r.headers()["content-type"] || "" }));
    await p.goto(`${PAGE}#p99=${code}`);
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    return { ctx, p, seen };
  };
  const openList = async (p) => {
    await p.locator("p99-root >> .w .b:not(.f)").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 20000 });
  };
  const CONTRAST = `(() => {
    const rgb = (c) => {
      const m = /^rgba?\\(([^)]+)\\)/.exec(c);
      if (m) return m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
      const s = /^color\\(srgb ([^)]+)\\)/.exec(c);
      return s ? s[1].split(/[ /]+/).slice(0, 3).map((v) => Number(v) * 255) : null;
    };
    const lum = (c) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    return (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  })()`;

  await story("licensed: true hides the panel's P99 lockup and its by PITO.MD link; without it both show", async () => {
    for (const [licensed, want] of [[true, false], [false, true]]) {
      const { ctx, p } = await mePage({ ...owner(0, 0, 0), licensed });
      await openList(p);
      const got = await p.evaluate(() => { const r = document.querySelector("p99-root").shadowRoot; return { lockup: !!r.querySelector(".p99-panel .p99-lockup"), by: !!r.querySelector(".p99-panel .p99-by") }; });
      check(`licensed ${licensed}: lockup and link ${want ? "show" : "hide"} (${JSON.stringify(got)})`, got.lockup === want && got.by === want);
      await ctx.close();
    }
  });

  await story("the panel's wordmark sits at about half the head's width, with the badge scaled to match", async () => {
    const { ctx, p } = await mePage(owner(0, 0, 0));
    await openList(p);
    const s = await p.evaluate(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      const brand = r.querySelector(".p99-brand").getBoundingClientRect();
      const lockup = r.querySelector(".p99-lockup").getBoundingClientRect();
      const badge = r.querySelector(".p99-badge").getBoundingClientRect();
      return { brand: brand.width, lockup: lockup.width, tall: lockup.height, badge: badge.height - 13 };
    });
    check(`the lockup is at most 220px and about half the brand (${JSON.stringify(s)})`, s.lockup <= 220 && s.lockup <= s.brand * 0.55 + 1 && s.tall <= 40 && s.badge <= 33);
    await ctx.close();
  });

  await story("every close button and the Board button share one round shape", async () => {
    const { ctx, p } = await mePage(owner(0, 0, 0));
    await openList(p);
    const shapes = await p.evaluate(() => {
      const r = document.querySelector("p99-root").shadowRoot;
      const shape = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return { h: Math.round(b.height), radius: parseFloat(cs.borderTopLeftRadius) >= b.height / 2, border: cs.borderTopWidth, style: cs.borderTopStyle, bg: cs.backgroundColor }; };
      return { x: shape(r.querySelector(".p99-panel .p99-x")), board: shape(r.querySelector(".p99-panel .p99-board-open")), square: Math.round(r.querySelector(".p99-panel .p99-x").getBoundingClientRect().width) };
    });
    check(`the close button and Board match in height, roundness and border (${JSON.stringify(shapes)})`, shapes.x.h === 40 && shapes.square === 40 && JSON.stringify(shapes.x) === JSON.stringify(shapes.board));
    await ctx.close();
  });

  for (const scheme of ["light", "dark"]) {
    await story(`${scheme}: the panel's scrolling areas have thin themed scrollbars and no script scroller`, async () => {
      const { ctx, p } = await mePage(owner(0, 0, 0), scheme);
      await openList(p);
      const s = await p.evaluate(() => {
        const r = document.querySelector("p99-root").shadowRoot;
        const cs = getComputedStyle(r.querySelector(".p99-scroll"));
        return { width: cs.scrollbarWidth, color: cs.scrollbarColor, overflow: cs.overflowY, scrollers: r.querySelectorAll("[data-scrollbar], .simplebar-content").length };
      });
      check(`${scheme}: thin, coloured, native (${JSON.stringify(s)})`, s.width === "thin" && s.color !== "auto" && s.overflow === "auto" && s.scrollers === 0);
      await ctx.close();
    });
  }

  const loaderPage = async ({ scheme = "light", stored, hash = "", route } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", colorScheme: scheme });
    await ctx.addInitScript(openShadow);
    if (stored) await ctx.addInitScript((c) => { try { localStorage["p99:code"] = c; } catch {} }, stored);
    if (route) await ctx.route((u) => u.pathname === "/_p99/api/me", route);
    const p = await ctx.newPage();
    const panels = [];
    const errors = [];
    p.on("request", (r) => new URL(r.url()).pathname === "/_p99/panel.js" && panels.push(r.url()));
    p.on("pageerror", (e) => errors.push(String(e && e.message)));
    await p.goto(PAGE + hash);
    return { ctx, p, panels, errors };
  };
  const rootState = (p) => p.evaluate(() => ({ root: !!document.querySelector("p99-root"), hash: location.hash, code: (() => { try { return localStorage["p99:code"] || ""; } catch { return ""; } })() }));

  await story("the loader fetches the panel only when the visitor reaches for the +, not on page load", async () => {
    const { ctx, p, panels, errors } = await loaderPage({ hash: `#p99=${code}` });
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the bar's counts", () => p.evaluate(() => Boolean(sessionStorage["p99:code"])));
    await frames(p);
    await frames(p);
    check(`panel.js is not requested while the page sits (${panels.length})`, panels.length === 0);
    await p.locator("p99-root >> .w .f").hover();
    await until("panel.js on hover", () => panels.length >= 1);
    check(`one hover loads it once (${panels.length})`, panels.length === 1);
    await openForm(p);
    check(`a click after the hover loads nothing more (${panels.length})`, panels.length === 1);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a stored code the Worker refuses opens the panel on that refusal and loads the module once", async () => {
    const refuse = (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized", message: "that code is not valid" }) });
    const { ctx, p, panels, errors } = await loaderPage({ stored: "p99-revoked-0000", route: refuse });
    await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    await until("the panel the refusal loads", () => panels.length >= 1);
    await frames(p);
    check(`the module is requested once (${panels.length})`, panels.length === 1);
    check(`no script error escaped the widget (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a page with no code link and no stored code shows nothing and loads nothing", async () => {
    const { ctx, p, panels, errors } = await loaderPage();
    await frames(p);
    await frames(p);
    const state = await rootState(p);
    check(`no widget is added (${JSON.stringify(state)})`, state.root === false);
    check(`nothing is loaded (${panels.length})`, panels.length === 0);
    check(`no script error escaped the page (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  });

  await story("a code link is taken out of the address bar and kept, and an empty #p99= is ignored", async () => {
    const good = await loaderPage({ hash: `#p99=${code}` });
    await good.p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
    const kept = await rootState(good.p);
    check(`the hash leaves the address (${kept.hash})`, kept.hash === "");
    check("the code is kept for the next visit", kept.code === code);
    await good.ctx.close();
    const noise = await loaderPage({ hash: "#p99=" });
    await frames(noise.p);
    const state = await rootState(noise.p);
    check(`an empty #p99= adds no widget (${JSON.stringify(state)})`, state.root === false && state.code === "");
    await noise.ctx.close();
  });

  for (const scheme of ["light", "dark"]) {
    await story(`in ${scheme} mode the + takes the ${scheme} colours of the page's colour scheme`, async () => {
      const { ctx, p } = await loaderPage({ scheme, hash: `#p99=${code}` });
      await p.locator("p99-root >> .w .f").waitFor({ timeout: 20000 });
      const look = await p.evaluate(() => {
        const s = getComputedStyle(document.querySelector("p99-root").shadowRoot.querySelector(".w .b"));
        return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor };
      });
      const want = scheme === "dark" ? { bg: "rgb(42, 59, 80)", color: "rgb(233, 240, 247)", border: "rgb(15, 24, 37)" } : { bg: "rgb(238, 243, 248)", color: "rgb(12, 26, 43)", border: "rgb(79, 107, 140)" };
      check(`the + is drawn in ${scheme} colours (${JSON.stringify(look)})`, look.bg === want.bg && look.color === want.color && look.border === want.border);
      await ctx.close();
    });
  }

  await story("on a site themed only for light, dark mode keeps the + and the panel legible, and light mode keeps the site's colours", async () => {
    const theme = { accent: "#1d2b6b", raised: "#ffffff", base: "#fafafa", ink: "#111111" };
    for (const scheme of ["dark", "light"]) {
      const { ctx, p } = await mePage({ ...owner(0, 0, 0), theme }, scheme);
      await openList(p);
      const s = await p.evaluate((src) => {
        const contrast = eval(src);
        const r = document.querySelector("p99-root").shadowRoot;
        const plus = getComputedStyle(r.querySelector(".w .f"));
        const more = getComputedStyle(r.querySelector(".w .b:not(.f)"));
        const panel = getComputedStyle(r.querySelector(".p99-panel"));
        const title = getComputedStyle(r.querySelector(".p99-view h2"));
        return { plus: contrast(plus.color, plus.backgroundColor), more: contrast(more.color, more.backgroundColor), title: contrast(title.color, panel.backgroundColor), raised: plus.backgroundColor };
      }, CONTRAST);
      if (scheme === "dark") check(`dark: the + at 3:1 or better, the ⋯ and the panel's title at 4.5:1 or better (${JSON.stringify(s)})`, s.plus >= 3 && s.more >= 4.5 && s.title >= 4.5);
      else check(`light: the site's own raised colour stays on the buttons (${s.raised})`, s.raised === "rgb(255, 255, 255)");
      await ctx.close();
    }
  });

  const SCAN = `(async (src) => {
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const near = (i, [r, gg, b]) => Math.hypot(d[i] - r, d[i + 1] - gg, d[i + 2] - b) < 80;
    const n = { red: 0, green: 0, magenta: 0, yellow: 0, cyan: 0, orange: 0, fill: 0 };
    for (let i = 0; i < d.length; i += 4) {
      if (near(i, [255, 0, 0])) n.red++;
      if (near(i, [0, 255, 0])) n.green++;
      if (near(i, [255, 0, 255])) n.magenta++;
      if (near(i, [255, 255, 0])) n.yellow++;
      if (near(i, [0, 255, 255])) n.cyan++;
      if (near(i, [255, 165, 0])) n.orange++;
      if (near(i, [59, 125, 216])) n.fill++;
    }
    return n;
  })`;
  const plant = (p) => p.evaluate(() => {
    const box = (css, attrs = {}) => { const d = document.createElement("div"); d.style.cssText = css; for (const k in attrs) d.setAttribute(k, attrs[k]); return d; };
    const wrap = box("position:absolute;left:24px;top:96px;z-index:5;display:flex;gap:24px;padding:24px;background:#ffffff");
    const marked = box("width:120px;height:120px;background:#ff0000;color:#ff0000", { "data-p99-redact": "" });
    marked.textContent = "secret";
    const outer = box("position:relative;width:120px;height:120px;background:#ffffff", { "data-p99-redact": "" });
    const inner = box("position:absolute;left:30px;top:30px;width:160px;height:160px;background:#00ff00");
    inner.append(box("width:40px;height:40px;background:#ff00ff", { "data-p99-redact": "" }));
    outer.append(inner);
    const masked = box("width:120px;height:120px;background:#ff00ff", { class: "p99-story-mask" });
    masked.append(box("width:60px;height:60px;background:#00ff00"));
    const control = box("width:120px;height:120px;background:#ffa500");
    const hosted = box("width:120px;height:120px");
    const shadow = hosted.attachShadow({ mode: "open" });
    shadow.append(box("width:120px;height:56px;background:#ffff00", { "data-p99-redact": "" }), box("width:120px;height:56px;margin-top:8px;background:#00ffff", { class: "p99-story-mask" }));
    wrap.append(marked, outer, masked, control, hosted);
    document.body.append(wrap);
  });
  const PRIVATE = (n) => n.red === 0 && n.green === 0 && n.magenta === 0 && n.yellow === 0 && n.cyan === 0;
  const scan = (p, src) => p.evaluate(`${SCAN}(${JSON.stringify(src)})`);
  const imageOf = (p, sel) => p.evaluate((q) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open " + q).toDataURL(), sel);
  const asData = (sent) => `data:${sent.type || "image/webp"};base64,${sent.body.toString("base64")}`;
  const catching = async (p) => {
    const sent = {};
    await p.route((u) => /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(u.pathname), (route) => {
      const r = route.request();
      const role = new URL(r.url()).searchParams.get("role");
      if (role) sent[role] = { type: r.headers()["content-type"], body: r.postDataBuffer() };
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return sent;
  };
  const privateMe = { ...visitor(0, 0, 0), mask: [".p99-story-mask"], capture: "on" };

  await story("a marked area, its nested children, a selector-matched area and the same inside an open shadow root never show in the screenshot, in the preview or in what is sent", async () => {
    const { ctx, p } = await mePage(privateMe);
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    await shotReady(p);
    const preview = await scan(p, await imageOf(p, ".p99-shot[data-role=screenshot] canvas"));
    check(`the control box shows, so the scan can fail (${JSON.stringify(preview)})`, preview.orange > 1000);
    check(`the preview has no red, green, magenta, yellow or cyan from the private boxes, and the theme's block covers them (${JSON.stringify(preview)})`, PRIVATE(preview) && preview.fill > 3000);
    await write(p, tag("Private areas stay private"));
    await p.locator(SEND).click();
    await until("the screenshot upload", () => sent.screenshot, 30000);
    const upload = await scan(p, asData(sent.screenshot));
    check(`the uploaded screenshot holds none of them either (${JSON.stringify(upload)})`, upload.orange > 1000 && PRIVATE(upload) && upload.fill > 3000);
    await ctx.close();
  });

  await story("the whole-page capture keeps the same areas private, in its preview and in what is sent", async () => {
    const { ctx, p } = await mePage(privateMe);
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    await shotReady(p);
    await p.locator(S(".p99-new input[name=attach][value=page]")).check();
    await p.locator(S(".p99-shot[data-role=page] canvas")).waitFor({ timeout: 30000 });
    const preview = await scan(p, await imageOf(p, ".p99-shot[data-role=page] canvas"));
    check(`the page preview shows the control and none of the private colours (${JSON.stringify(preview)})`, preview.orange > 300 && PRIVATE(preview) && preview.fill > 1500);
    await write(p, tag("Whole page stays private"));
    await p.locator(SEND).click();
    await until("the page upload", () => sent.page, 30000);
    const upload = await scan(p, asData(sent.page));
    check(`the uploaded page holds none of them (${JSON.stringify(upload)})`, upload.orange > 1000 && PRIVATE(upload) && upload.fill > 3000);
    await ctx.close();
  });

  await story("a region marked over the private areas keeps them private, in its preview and in what is sent", async () => {
    const { ctx, p } = await mePage(privateMe);
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    await shotReady(p);
    await write(p, tag("Marked region stays private"));
    await p.locator(S(".p99-mark-start")).click();
    await p.locator("p99-root >> .p99-mark-layer").waitFor({ timeout: 10000 });
    await p.mouse.move(40, 110);
    await p.mouse.down();
    await p.mouse.move(740, 270, { steps: 8 });
    await p.mouse.up();
    await p.locator("p99-root >> .p99-mark-done").click();
    await p.locator(S(".p99-regions .p99-region canvas")).waitFor({ timeout: 30000 });
    const preview = await scan(p, await imageOf(p, ".p99-regions .p99-region canvas"));
    check(`the region preview shows the control and none of the private colours (${JSON.stringify(preview)})`, preview.orange > 100 && PRIVATE(preview) && preview.fill > 300);
    await p.locator(SEND).click();
    await until("the region upload", () => sent.region, 30000);
    const upload = await scan(p, asData(sent.region));
    check(`the uploaded region holds none of them (${JSON.stringify(upload)})`, upload.orange > 1000 && PRIVATE(upload) && upload.fill > 1500);
    await ctx.close();
  });

  const HIDE = S(".p99-new input[name=mask]");
  const SHOWN = (n) => n.red > 300 && n.magenta > 300 && n.yellow > 100 && n.cyan > 100;
  const retaken = (p) => p.waitForFunction(() => {
    const f = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new");
    return f && !f.querySelector(".p99-shot-wait") && f.querySelector(".p99-shot[data-role=screenshot] canvas") && !f.querySelector("input[name=mask]").disabled;
  }, null, { timeout: 30000 });

  await story("unchecking Hide this site's private areas shows them in the screen, the whole page and the marked area, in the previews and in what is sent", async () => {
    const { ctx, p } = await mePage(privateMe);
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    await shotReady(p);
    await write(p, tag("Private areas shown on purpose"));
    await p.locator(S(".p99-mark-start")).click();
    await p.locator("p99-root >> .p99-mark-layer").waitFor({ timeout: 10000 });
    await p.mouse.move(40, 110);
    await p.mouse.down();
    await p.mouse.move(740, 270, { steps: 8 });
    await p.mouse.up();
    await p.locator("p99-root >> .p99-mark-done").click();
    await p.locator(S(".p99-regions .p99-region canvas")).waitFor({ timeout: 30000 });
    await p.locator(S(".p99-new input[name=attach][value=page]")).check();
    await p.locator(S(".p99-shot[data-role=page] canvas")).waitFor({ timeout: 30000 });
    check("the hide checkbox is shown and checked", (await p.locator(HIDE).isVisible()) && (await p.locator(HIDE).isChecked()));
    await p.locator(HIDE).uncheck();
    await retaken(p);
    await p.locator(S(".p99-shot[data-role=page] canvas")).waitFor({ timeout: 30000 });
    await p.locator(S(".p99-regions .p99-region canvas")).waitFor({ timeout: 30000 });
    const screen = await scan(p, await imageOf(p, ".p99-shot[data-role=screenshot] canvas"));
    const page = await scan(p, await imageOf(p, ".p99-shot[data-role=page] canvas"));
    const region = await scan(p, await imageOf(p, ".p99-regions .p99-region canvas"));
    check(`the screen, page and region previews show the private colours (${JSON.stringify({ screen, page, region })})`, SHOWN(screen) && page.red > 100 && page.magenta > 100 && SHOWN(region));
    await p.locator(SEND).click();
    await until("the three uploads", () => sent.screenshot && sent.page && sent.region, 30000);
    const up = { screen: await scan(p, asData(sent.screenshot)), page: await scan(p, asData(sent.page)), region: await scan(p, asData(sent.region)) };
    check(`what is sent shows them too (${JSON.stringify(up)})`, SHOWN(up.screen) && SHOWN(up.page) && SHOWN(up.region));
    await ctx.close();
  });

  await story("checking Hide this site's private areas again hides them in every preview and in what is sent", async () => {
    const { ctx, p } = await mePage(privateMe);
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    await shotReady(p);
    await p.locator(HIDE).uncheck();
    await retaken(p);
    await p.locator(S(".p99-new input[name=attach][value=page]")).check();
    await p.locator(S(".p99-shot[data-role=page] canvas")).waitFor({ timeout: 30000 });
    await p.locator(HIDE).check();
    await retaken(p);
    await p.locator(S(".p99-shot[data-role=page] canvas")).waitFor({ timeout: 30000 });
    const screen = await scan(p, await imageOf(p, ".p99-shot[data-role=screenshot] canvas"));
    const page = await scan(p, await imageOf(p, ".p99-shot[data-role=page] canvas"));
    check(`both previews are private again (${JSON.stringify({ screen, page })})`, PRIVATE(screen) && screen.fill > 3000 && PRIVATE(page) && page.orange > 300);
    await write(p, tag("Private areas hidden again"));
    await p.locator(SEND).click();
    await until("the uploads", () => sent.screenshot && sent.page, 30000);
    const up = { screen: await scan(p, asData(sent.screenshot)), page: await scan(p, asData(sent.page)) };
    check(`what is sent holds none of them (${JSON.stringify(up)})`, PRIVATE(up.screen) && PRIVATE(up.page) && up.screen.fill > 3000);
    await ctx.close();
  });

  await story("a host whose masks match nothing here, on a page with nothing marked, offers no hide checkbox", async () => {
    const { ctx, p } = await mePage({ ...privateMe, mask: [".nothing-matches-this"] });
    await p.evaluate(() => document.querySelectorAll("[data-p99-redact]").forEach((n) => n.removeAttribute("data-p99-redact")));
    await openForm(p);
    await shotReady(p);
    const note = await p.locator(S(".p99-new .p99-privacy")).textContent();
    check(`no hide checkbox, and the note keeps its wording (${note})`, !(await p.locator(HIDE).isVisible()) && note.endsWith("Passwords and the fields this site marks as private are blanked."));
    await ctx.close();
  });

  for (const scheme of ["light", "dark"]) {
    await story(`${scheme}: each capture checkbox sits on one row with its label, the box first`, async () => {
      const { ctx, p } = await mePage(privateMe, scheme);
      await plant(p);
      await openForm(p);
      await shotReady(p);
      await p.locator(HIDE).waitFor({ state: "visible", timeout: 10000 });
      const rows = await p.evaluate(() => Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open .p99-shots-pick > .p99-pick")).map((d) => {
        const box = d.querySelector("input").getBoundingClientRect();
        const text = d.querySelector("label span").getBoundingClientRect();
        return { role: d.dataset.role, dy: Math.abs((box.top + box.bottom) / 2 - (text.top + text.bottom) / 2), gap: text.left - box.right };
      }));
      check(`the hide checkbox and the three attach checkboxes each read [box] Label on one row (${JSON.stringify(rows)})`, rows.map((r) => r.role).join() === "mask,screenshot,page,region" && rows.every((r) => r.dy <= 2 && r.gap > 0 && r.gap < 24));
      await ctx.close();
    });
  }

  await story("a mask selector this browser can't read means no screenshot at all, and the form says why", async () => {
    const { ctx, p } = await mePage({ ...privateMe, mask: [".p99-story-mask", "::not a selector("] });
    await plant(p);
    const sent = await catching(p);
    await openForm(p);
    const caption = await p.locator(S(".p99-shot[data-role=screenshot] .p99-shot-error")).textContent({ timeout: 30000 });
    check(`the screenshot slot names the private-area rules as the reason (${caption})`, /can't read the areas this site keeps private/.test(caption || ""));
    const shown = await p.locator(S(".p99-shot[data-role=screenshot] canvas")).count();
    check("no screenshot image is drawn", shown === 0);
    await p.locator(S(".p99-mark-start")).click();
    await p.waitForFunction(() => /can't read the areas this site keeps private/.test(document.querySelector("p99-root").shadowRoot.querySelector(".p99-new .p99-status-line")?.textContent || ""), null, { timeout: 10000 });
    check("marking an area does not start either", (await p.locator("p99-root >> .p99-mark-layer").count()) === 0);
    await write(p, tag("No screenshot when a mask can't be read"));
    await p.locator(SEND).click();
    await thread(p);
    check("the report still files, with no image sent", Object.keys(sent).length === 0);
    await ctx.close();
  });

  await story("with capture off the form says no screenshot goes, and the report files with no image", async () => {
    const { ctx, p, seen } = await mePage({ ...visitor(0, 0, 0), capture: "off" });
    await openForm(p);
    const form = await p.evaluate(() => { const f = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new"); return { capture: !!f.querySelector(".p99-capture"), mark: !!f.querySelector(".p99-mark-start"), note: f.querySelector(".p99-no-shot")?.textContent ?? null }; });
    check(`no capture section and a plain note (${JSON.stringify(form)})`, !form.capture && !form.mark && form.note === "This site doesn't send screenshots, so your card goes without one.");
    const title = tag("Filed with capture off");
    await write(p, title);
    await p.locator(SEND).click();
    await thread(p);
    const [item] = await found(title);
    const t = item ? await must("GET", `/issues/${item.key}?host=${HOST}`) : null;
    const puts = seen.filter((r) => r.method === "PUT" && /\/attachments\//.test(r.path));
    check(`one item, no attachment sent or stored (${puts.length} sent, ${t && (t.attachments || []).length} stored)`, !!t && puts.length === 0 && (t.attachments || []).length === 0);
    await ctx.close();
  });

  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `stories-widget: ${failed} failed, ${passed} passed, ${reds} known red` : `stories-widget: all ${passed} passed, ${reds} known red`);
serve.kill("SIGTERM");
process.exit(failed ? 1 : 0);

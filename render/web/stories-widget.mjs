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
  await must("PUT", `/hosts/${HOST}`, { env: "production", config: {} });
  const mint = async (name, email) => (await must("POST", "/codes", { name, email, hosts: [HOST], manager: false })).secret;
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
  const shotReady = (p) => p.locator(S(".p99-shot[data-role=screenshot] img")).waitFor({ timeout: 30000 });
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
    await p.locator(S(".p99-regions .p99-region img")).waitFor({ timeout: 30000 });
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
    red(`the visitor reads P99's own words, not the browser's ("${said}")`, "a network failure shows the browser's own wording, not P99's", said === FAILED);
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
    red(`it is told at once, not after hidden retries (${uids.length} sends, ${took} ms)`, "a daily-limit 429 is retried as if it were transient", uids.length === 1);
    await ctx.close();
  });

  await story("a visitor slowed by the per-minute limit on arrival isn't dropped into a report form they didn't ask for", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await ctx.addInitScript(openShadow);
    await ctx.route((u) => u.pathname === "/_p99/api/me", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", message: "too many requests with this code; try again in a minute" }) }),
    );
    const p = await ctx.newPage();
    const panels = [];
    p.on("request", (r) => {
      if (new URL(r.url()).pathname === "/_p99/panel.js") panels.push(r.url());
    });
    const me = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/me", { timeout: 20000 });
    await p.goto(`${PAGE}#p99=${code}`);
    await me;
    await frames(p);
    let form = false;
    if (panels.length) {
      form = await p
        .locator(S(".p99-new"))
        .waitFor({ timeout: 15000 })
        .then(() => true, () => false);
    }
    red(`no report form opens by itself (${panels.length ? "the panel loaded" : "the panel stayed shut"}${form ? " and showed the report form" : ""})`, "a 429 from /me right after a code link opens an empty report form unasked", !form);
    check("the + is still there to report when they choose", await p.locator("p99-root >> .w .f").isVisible());
    await ctx.close();
  });

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
        red(`${how}: the report doesn't blame the site for P99's own storage error (${own.join(" | ")})`, "the loader's own sessionStorage error lands in the report's page errors", own.length === 0);
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

  await story("a visitor's title of 200 emoji is filed whole, and a longer one is cut at 200 characters without breaking an emoji", async () => {
    const { ctx, p, errors } = await visit();
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
    const long = `${head}${"🎉".repeat(194)}`;
    check("the field takes more than 200 characters of emoji", (await typed(long)) === long);
    await p.locator(SEND).click();
    await thread(p);
    const cut = `${head}${"🎉".repeat(200 - [...head].length)}`;
    const titles = (await must("GET", `/issues?scope=all&host=${HOST}&q=${RUN}`)).issues.map((i) => i.title);
    check("the longer title is cut to 200 characters, every emoji whole", titles.includes(cut) && titles.every((t) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t)));
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
    red(`the second draft is still on screen with its title (${gets.length} thread loads)`, "an upload finishing after the panel closed opens its thread over the new draft", still);
    check("the first report arrived whole", (await found(first)).length === 1);
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

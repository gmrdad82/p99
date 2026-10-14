import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const work = join(resolve(here, "../.."), "tmp", "web");
const PORT = Number(process.env.P99_PROXY_PORT || 8829);
const HOST = "shop.example.com";
const PAGE = `http://${HOST}/checkout`;
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };

const serve = spawn(process.execPath, [join(here, "serve.mjs")], {
  env: { ...process.env, P99_PROXY_PORT: String(PORT), P99_WORKER_PORT: String(PORT + 1) },
  stdio: ["ignore", "inherit", "inherit"],
});
let failed = 0;
const done = (code) => {
  serve.kill("SIGTERM");
  process.exit(code);
};

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
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pq}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

try {
  for (let i = 0; ; i++) {
    try {
      await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false });
      break;
    } catch (e) {
      if (i > 120) throw e;
      await sleep(500);
    }
  }
  await api("PUT", `/hosts/${HOST}`, { env: "production", config: { off: ["/off/**"], above: "#totop" } });
  const issue = await api("POST", `/issues?host=${HOST}`, {
    client_uid: "00000000-0000-4000-8000-000000000001",
    kind: "bug",
    title: "The cart total doesn't update",
    body: "",
    page: { url: `https://${HOST}/cart`, path: "/cart", title: "Cart" },
    context: {},
    marks: [],
  });
  const { secret } = await api("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], manager: true });

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((c) => localStorage.setItem("p99:code", c), secret);
  await ctx.addInitScript(() => {
    const s = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return s.call(this, { ...init, mode: "open" });
    };
  });
  const p = await ctx.newPage();
  await p.goto(PAGE);
  await p.waitForFunction(() => document.querySelector("p99-root"));
  await p.evaluate(() => (window.__root = document.querySelector("p99-root")));
  const state = () =>
    p.evaluate(() => {
      const r = window.__root;
      const w = r.shadowRoot.querySelector(".w");
      return { shown: r.isConnected && r.parentNode === document.body && !!w.querySelector(".f"), same: document.querySelector("p99-root") === r, lift: w.style.translate };
    });
  const settle = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));

  let s = await state();
  check("the ? is drawn on load", s.shown && s.same);

  await p.evaluate(() => {
    document.body.innerHTML = "<main><h1>Swapped</h1></main>";
  });
  await settle();
  s = await state();
  check("body.innerHTML replaced: the same root is back", s.shown && s.same);

  await p.evaluate(() => {
    const b = document.createElement("body");
    b.innerHTML = "<main><h1>New body</h1></main>";
    document.documentElement.replaceChild(b, document.body);
  });
  await settle();
  s = await state();
  check("body replaced: the same root is back", s.shown && s.same);

  await p.evaluate(() => {
    history.pushState(null, "", "/off/done");
    document.body.innerHTML = "<main><h1>Off</h1></main>";
  });
  await settle();
  s = await state();
  check("pushState to an off path: the ? is gone", !s.shown);
  check("pushState to an off path: no root in the page", await p.evaluate(() => !document.querySelector("p99-root")));

  await p.evaluate(() => {
    history.pushState(null, "", "/checkout");
    document.body.innerHTML = "<main><h1>Back</h1></main>";
  });
  await settle();
  s = await state();
  check("back on an on path: the same root is back", s.shown && s.same);

  await p.evaluate(() => history.back());
  await settle();
  await p.evaluate(() => (document.body.innerHTML = "<main><h1>Off again</h1></main>"));
  await settle();
  check("history.back to the off path: no root in the page", await p.evaluate(() => location.pathname === "/off/done" && !document.querySelector("p99-root")));
  await p.evaluate(() => history.forward());
  await settle();
  await p.evaluate(() => (document.body.innerHTML = "<main><h1>Forward</h1></main>"));
  await settle();
  s = await state();
  check("history.forward to the on path: the same root is back", s.shown && s.same);

  await p.evaluate(() => {
    document.body.innerHTML = '<main><h1>With a hidden bar</h1></main><div id="totop" style="position:fixed;right:16px;bottom:16px;width:40px;height:40px;visibility:hidden;opacity:0"></div>';
  });
  await settle();
  s = await state();
  check(`a hidden above element is ignored (${s.lift || "none"})`, !s.lift || s.lift === "0px" || s.lift === "0px 0px");
  await p.evaluate(() => {
    const t = document.getElementById("totop");
    t.style.visibility = "visible";
    t.style.opacity = "1";
    dispatchEvent(new Event("scroll"));
  });
  await settle();
  s = await state();
  check(`a shown above element lifts the button (${s.lift})`, s.lift === "0px -56px");
  await p.evaluate(() => {
    document.body.innerHTML = '<main><h1>Swapped bar</h1></main><div id="totop" style="position:fixed;right:16px;bottom:16px;width:40px;height:100px"></div>';
  });
  await settle();
  s = await state();
  check(`a swapped-in above element moves the button without a scroll (${s.lift})`, s.lift === "0px -116px");

  await p.evaluate((k) => {
    document.body.innerHTML = "<main><h1>Before the link</h1></main>";
    location.hash = "#p99=" + k;
  }, issue.key);
  await p.waitForFunction(() => {
    const panel = window.__root.shadowRoot.querySelector(".p99-panel");
    return panel && !panel.hidden;
  }, null, { timeout: 10000 }).catch(() => {});
  check("#p99=KEY after a swap opens in the attached root", await p.evaluate(() => {
    const panel = window.__root.shadowRoot.querySelector(".p99-panel");
    return window.__root.isConnected && !!panel && !panel.hidden;
  }));

  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `swap-check: ${failed} failed` : "swap-check: all passed");
done(failed ? 1 : 0);

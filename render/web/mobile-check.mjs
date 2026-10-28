import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const work = resolve(resolve(here, "../.."), process.env.P99_WORK || "tmp/web");
const PORT = Number(process.env.P99_PROXY_PORT || 8839);
const HOST = "shop.example.com";
const PAGE = `http://${HOST}/checkout`;
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const PHONE = {
  viewport: { width: 411, height: 833 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};

const serve = spawn(process.execPath, [join(here, "serve.mjs")], {
  env: { ...process.env, P99_WORK: work, P99_PROXY_PORT: String(PORT), P99_WORKER_PORT: String(PORT + 1) },
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

function openShadow() {
  const s = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return s.call(this, { ...init, mode: "open" });
  };
}

function rewriteHash() {
  history.replaceState(null, "", location.pathname + "#top");
}

const plus = (p) =>
  p.evaluate(() => {
    const r = document.querySelector("p99-root");
    const b = r?.shadowRoot?.querySelector(".w .f");
    if (!b || b.hidden) return null;
    const box = b.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { x: box.x, y: box.y, w: box.width, h: box.height, top: hit === r, onScreen: innerWidth <= 411 && box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
  });
const panel = (p, sel) =>
  p.waitForFunction((s) => {
    const n = document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open");
    return n && n.querySelector(s) && n.getBoundingClientRect().width <= innerWidth ? n.getBoundingClientRect().width : 0;
  }, sel, { timeout: 10000 }).then((h) => h.jsonValue(), () => 0);

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
  await api("POST", "/projects", { name: "Shop" });
  await api("PUT", `/hosts/${HOST}`, { env: "production", project: "Shop", config: { above: "#totop" } });
  const plain = (await api("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], role: "user" })).secret;
  const guarded = (await api("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], role: "user", totp: true })).secret;

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`],
  });
  const phone = async (...scripts) => {
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(openShadow);
    for (const s of scripts) await ctx.addInitScript(s);
    return { ctx, p: await ctx.newPage() };
  };
  const stored = (p) => p.evaluate(() => localStorage.getItem("p99:code"));

  {
    const { ctx, p } = await phone(rewriteHash);
    await p.goto(`${PAGE}#p99=${plain}`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .f"), null, { timeout: 10000 }).catch(() => {});
    check("a page script that rewrites the hash first: the code still reaches localStorage", (await stored(p)) === plain);
    check("the invite code is gone from the address bar", !(await p.evaluate(() => location.href)).includes(plain));
    const b = await plus(p);
    check(`at 411x833 the + is on screen and on top (${JSON.stringify(b)})`, !!b && b.onScreen && b.top && b.w >= 44);
    await p.tap("p99-root >> .w .f");
    const w = await panel(p, ".p99-new input[name=title]");
    check(`a tap opens the panel at phone width (${w}px)`, w > 300 && w <= 411);
    await ctx.close();
  }

  {
    const { ctx, p } = await phone();
    await p.goto(`${PAGE}#P99=${plain.toUpperCase()}.`);
    await p.waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .f"), null, { timeout: 10000 }).catch(() => {});
    check("a link an app upper-cased and ended with a full stop still activates", !!(await plus(p)) && (await stored(p)) === plain.toUpperCase());
    await ctx.close();
  }

  {
    const { ctx, p } = await phone();
    await p.goto(`${PAGE}#p99=${guarded}`);
    check("a code with an authenticator brings up the 6-digit step without a tap", (await panel(p, ".p99-verify input[name=totp]")) > 0);
    await ctx.close();
  }

  for (const bad of ["zzzzzzzzzzzz", "abc"]) {
    const { ctx, p } = await phone();
    await p.goto(`${PAGE}#p99=${bad}`);
    const line = await p
      .waitForFunction(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-gone")?.textContent, null, { timeout: 10000 })
      .then((h) => h.jsonValue(), () => "");
    check(`an unknown or malformed code (${bad.length} chars) shows one line: "${line.replace("×", "")}"`, /isn't valid/.test(line));
    check("  and hides the + while it shows", !(await plus(p)));
    check("  and forgets the code at once", (await stored(p)) === null);
    await p.tap("p99-root >> .p99-gone button");
    await p.waitForTimeout(100);
    check("  and its × removes P99 from the page", await p.evaluate(() => !document.querySelector("p99-root")));
    await ctx.close();
  }

  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `mobile-check: ${failed} failed` : "mobile-check: all passed");
done(failed ? 1 : 0);

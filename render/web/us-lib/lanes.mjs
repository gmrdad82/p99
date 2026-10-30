import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { forced, openShadow } from "../board.mjs";

export { themeOf } from "../board.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHECKOUT = join(here, "..", "site", "checkout.html");
const STRICT_CSS = join(here, "..", "site", "strict.css");
const HOST_BARS = "\n* { scrollbar-width: thin; scrollbar-color: #8a8f98 transparent; }\n*::-webkit-scrollbar { width: 6px; height: 6px; }\n";

export const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
export const GRACE = { email: "grace@example.com", name: "Grace Hopper", agent: false };

export async function signed(kit, method, path, body, actor = ADA) {
  let r = await kit.call(method, `/_p99/v1${path}`, { actor, body });
  for (let again = 0; again < 3 && r.status >= 500; again++) r = await kit.call(method, `/_p99/v1${path}`, { actor, body });
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

export async function ownerOn(kit, host, email = ADA.email) {
  return (await kit.mint(ADA.name, email, [host], true)).secret;
}

export async function clear(kit, keys) {
  for (const path of keys.map((key) => `/issues/${key}`)) {
    let r = await kit.call("DELETE", `/_p99/v1${path}`, { actor: ADA });
    for (let again = 0; again < 3 && r.status >= 500; again++) r = await kit.call("DELETE", `/_p99/v1${path}`, { actor: ADA });
    assert.ok(r.status < 300 || r.status === 404, `DELETE ${path}: ${r.status} ${JSON.stringify(r.json)}`);
  }
}

export async function cardIn(kit, project, host, title, { status = "new", path = null, assignee = null } = {}) {
  const page = path ? { url: `https://${host}${path}`, path, title: path } : undefined;
  const made = await signed(kit, "POST", `/cards?host=${host}`, { client_uid: randomUUID(), project, title, host, ...(page ? { page } : {}) });
  const key = (made.card ?? made).key;
  if (status !== "new") await signed(kit, "POST", `/cards/${key}/status`, { status });
  if (assignee) await signed(kit, "PATCH", `/issues/${key}`, { assignee });
  return key;
}

export async function many(n, make) {
  const keys = [];
  for (let at = 0; at < n; at++) keys.push(await make(at));
  return keys;
}

export async function popupBoard(page, url, least = 1) {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
      return b && !b.hidden;
    },
    null,
    { timeout: 20000 },
  );
  await page.locator("p99-root .w .b:not(.f)").click();
  await page.locator("p99-root .p99-board-open").click();
  await page.waitForFunction(
    (n) => {
      const r = document.querySelector("p99-root").shadowRoot;
      return r.querySelector(".p99-board.is-open") && r.querySelectorAll(".p99-cols .p99-card").length >= n;
    },
    least,
    { timeout: 20000 },
  );
  await settled(page);
}

export const settled = (page, host = "p99-root") =>
  page.waitForFunction(
    (h) => {
      const r = document.querySelector(h).shadowRoot;
      return r.getAnimations().every((a) => a.playState !== "running" || a.effect.getTiming().iterations === Infinity);
    },
    host,
    { timeout: 20000 },
  );

export async function hostBars(context, host) {
  const css = readFileSync(STRICT_CSS, "utf8") + HOST_BARS;
  await context.route((u) => u.hostname === host && u.pathname === "/strict.css", (route) => route.fulfill({ status: 200, contentType: "text/css", body: css }));
}

export async function pageTheme(context, scheme) {
  const css = /<style>([\s\S]*?)<\/style>/.exec(forced(readFileSync(CHECKOUT, "utf8"), scheme))[1];
  await context.addInitScript((text) => {
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelector("style").textContent = text;
    });
  }, css);
}

export async function barsBrowser(kit) {
  const site = new URL(kit.origin()).port;
  const app = new URL(kit.appUrl("/")).hostname;
  const executablePath = process.env.P99_CHROMIUM || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath,
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP *.example.com 127.0.0.1:${site}`, "--unsafely-treat-insecure-origin-as-secure=http://*.example.com"],
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, reducedMotion: "reduce", ...options });
    await context.addInitScript(openShadow);
    await context.route(
      (u) => u.protocol === "https:" && u.hostname === app,
      async (route) => {
        try {
          const asked = route.request();
          const u = new URL(asked.url());
          const headers = { ...(await asked.allHeaders()) };
          if (headers.origin) headers.origin = `http://${app}`;
          const answer = await route.fetch({ url: `http://127.0.0.1:${site}/@${app}${u.pathname}${u.search}`, headers, maxRedirects: 0 });
          await route.fulfill({ response: answer });
        } catch {
          await route.abort().catch(() => {});
        }
      },
    );
    return context;
  };
  return { open, close: () => browser.close() };
}

export const bars = (page, host = "p99-root") =>
  page.evaluate((h) => {
    const r = document.querySelector(h).shadowRoot;
    const cols = r.querySelector(".p99-cols");
    const lists = Array.from(r.querySelectorAll(".p99-cards")).filter((l) => l.scrollHeight > l.clientHeight);
    return {
      wide: cols.scrollWidth > cols.clientWidth,
      cols: cols.offsetHeight - cols.clientHeight,
      lanes: lists.map((l) => l.offsetWidth - l.clientWidth),
      colours: [cols, ...lists].map((e) => getComputedStyle(e).scrollbarColor),
      widths: [cols, ...lists].map((e) => getComputedStyle(e).scrollbarWidth),
    };
  }, host);

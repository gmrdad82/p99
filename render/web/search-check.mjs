import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const work = resolve(repo, process.env.P99_WORK || "tmp/web-search");
const stills = resolve(repo, process.env.P99_STILLS || "tmp/renders");
const PORT = Number(process.env.P99_PROXY_PORT || 8923);
const HOST = "shop.example.com";
const PAGE = `http://${HOST}/checkout`;
const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
const UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const phone = (width) => ({ viewport: { width, height: 833 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const SIZES = [["411", phone(411)], ["1440", DESK]];

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

const file = (kind, title) =>
  must("POST", `/issues?host=${HOST}`, { client_uid: randomUUID(), kind, title, body: "", page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" }, context: {}, marks: [] }, GRACE);

const S = (sel) => `p99-root >> .p99-panel.is-open ${sel}`;
const searchOf = (q) => (url) => url.pathname === "/_p99/api/issues" && url.searchParams.get("q") === q;

const state = (p) =>
  p.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    const res = r.querySelector(".p99-panel.is-open [data-view=list] .p99-results");
    if (!res) return null;
    const input = r.querySelector(".p99-filters input[name=q]");
    return {
      waiting: !!res.querySelector(".p99-rows-wait") || res.hasAttribute("aria-busy"),
      busy: r.querySelector(".p99-filters").classList.contains("is-busy"),
      rows: Array.from(res.querySelectorAll(".p99-item-title"), (b) => b.textContent),
      empty: res.querySelector(".p99-empty")?.textContent || null,
      error: res.querySelector(".p99-error")?.textContent || null,
      retry: !!res.querySelector(".p99-failed .p99-retry"),
      slow: !!res.querySelector(".p99-slow .p99-retry"),
      field: input === r.activeElement,
      tagged: input && input.dataset.check === "kept",
      value: input && input.value,
    };
  });
const settled = async (p, ms = 8000, ready = () => true) => {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < ms) {
    s = await state(p);
    if (s && !s.waiting && ready(s)) return s;
    await sleep(100);
  }
  return s;
};
const tag = (p) => p.evaluate(() => { document.querySelector("p99-root").shadowRoot.querySelector(".p99-filters input[name=q]").dataset.check = "kept"; });
const search = async (p, q, enter = true) => {
  await p.locator(S(".p99-filters input[name=q]")).focus();
  await p.keyboard.press("ControlOrMeta+a");
  if (q) await p.keyboard.type(q, { delay: 40 });
  else await p.keyboard.press("Backspace");
  if (enter) await p.keyboard.press("Enter");
};

try {
  for (let i = 0; ; i++) {
    const r = await api("PUT", "/envs/production", { kind: "release", position: 1, notify: false }).catch((e) => ({ status: 0, e }));
    if (r.status === 200 || r.status === 201) break;
    if (i > 120) throw new Error("the local Worker did not come up");
    await sleep(500);
  }
  await must("POST", "/projects", { name: "Shop" });
  await must("PUT", `/hosts/${HOST}`, { env: "production", project: "Shop", config: {} });
  const code = (await must("POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [HOST], role: "owner" })).secret;
  await file("bug", "The cart total doesn't update after removing a bag");
  await file("feature", "Let returning customers reorder from a receipt");
  await file("question", "Do you ship to Canada?");
  await file("bug", "The cart badge shows 0 after a refresh");
  await file("improvement", "Make the checkout button easier to reach on a phone");

  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR },
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}`, "--hide-scrollbars", "--font-render-hinting=none"],
  });
  const open = async (opts, scheme = "light", clock = false) => {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme });
    await ctx.addInitScript(openShadow);
    const p = await ctx.newPage();
    if (clock) await p.clock.install();
    await p.goto(`${PAGE}#p99=${code}`);
    await p.waitForFunction(() => {
      const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
      return b && !b.hidden;
    }, null, { timeout: 15000 });
    await p.locator("p99-root >> .w .b:not(.f)").click();
    await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list] .p99-items"), null, { timeout: 15000 });
    await p.waitForTimeout(300);
    return { ctx, p };
  };

  {
    const { ctx, p } = await open(DESK);
    await tag(p);
    await search(p, "cart", false);
    let s = await settled(p, 8000, (s) => s.rows.length !== 5);
    check(`a typed search ends in its results, the field kept and focused (${JSON.stringify(s)})`, !s.waiting && !s.busy && s.rows.length === 2 && s.rows.every((t) => /cart/i.test(t)) && s.field && s.tagged);

    await search(p, "zebra");
    s = await settled(p);
    check(`a search with no match ends in its empty line (${s.empty})`, !s.waiting && s.rows.length === 0 && s.empty === "No issues match “zebra”." && s.field && s.tagged);

    await p.route(searchOf("bad"), (r) => r.fulfill({ status: 400, contentType: "application/json", body: '{"message":"status must be open, closed, any or a status key; label= keeps one label"}' }));
    await search(p, "bad");
    s = await settled(p);
    check(`a 400 ends in the Worker's message and Retry (${s.error})`, !s.waiting && !s.busy && /status must be/.test(s.error || "") && s.retry && s.field);

    const down = searchOf("down");
    await p.route(down, (r) => r.abort("failed"));
    await search(p, "down");
    s = await settled(p);
    check(`a network failure ends in an error line and Retry (${s.error})`, !s.waiting && !s.busy && s.error === "Couldn't load; try again." && s.retry);
    await p.unroute(down);
    await p.locator(S(".p99-results .p99-failed .p99-retry")).click();
    s = await settled(p);
    check(`Retry runs the same search again, ends, and leaves focus in the field (${s.empty})`, !s.waiting && s.empty === "No issues match “down”." && s.field);

    await p.route(searchOf("throws"), (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"issues":[null]}' }));
    await search(p, "throws");
    s = await settled(p);
    check(`a reply the panel can't draw ends in an error line, not the skeleton (${s.error})`, !s.waiting && !!s.error && s.retry);

    const cart = searchOf("cart");
    await p.route(cart, async (r) => {
      await sleep(1500);
      try { await r.fallback(); } catch (x) {}
    });
    await search(p, "cart");
    await p.waitForTimeout(500);
    await search(p, "canada");
    await p.waitForTimeout(2500);
    s = await settled(p);
    check(`a newer search wins over an older, slower one (${s.rows.join(" | ")})`, s.rows.length === 1 && /Canada/.test(s.rows[0]) && s.value === "canada");
    await p.unroute(cart);

    const slow = searchOf("slow");
    await p.route(slow, async (r) => {
      await sleep(6000);
      try { await r.fallback(); } catch (x) {}
    });
    await search(p, "slow");
    const t0 = Date.now();
    do {
      await sleep(100);
      s = await state(p);
    } while (!(s && s.slow) && Date.now() - t0 < 5800);
    check(`past 4 s the wait says it's taking longer and offers Retry (${JSON.stringify(s)})`, s.waiting && s.busy && s.slow);
    await p.unroute(slow);
    await p.locator(S(".p99-results .p99-slow .p99-retry")).click();
    s = await settled(p);
    check(`  and its Retry ends the search, focus in the field (${s.empty})`, !s.waiting && s.empty === "No issues match “slow”." && s.field);

    await search(p, "");
    s = await settled(p);
    check(`clearing the search shows every open item again (${s.rows.length})`, !s.waiting && s.rows.length === 5);

    await p.route((url) => /^\/_p99\/api\/issues\/[^/]+$/.test(url.pathname), (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"issue":null}' }));
    await p.locator(S(".p99-results .p99-item a")).first().click();
    const gone = await p.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-failed .p99-retry"), null, { timeout: 8000 }).then(() => true, () => false);
    const left = await p.evaluate(() => !!document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-skeleton"));
    check(`an item reply without its issue ends in an error and Retry, not the skeleton`, gone && !left);
    await ctx.close();
  }

  {
    const { ctx, p } = await open(DESK, "light", true);
    await p.route(searchOf("stall"), () => {});
    await search(p, "stall");
    await p.waitForTimeout(600);
    let s = await state(p);
    const waited = s && s.waiting;
    await p.clock.fastForward(20000);
    s = await settled(p);
    check(`a request that never answers ends at 20 s in the error line and Retry (${s && s.error})`, waited && !s.waiting && !s.busy && s.error === "Couldn't load; try again." && s.retry);
    await ctx.close();
  }

  {
    const { ctx, p } = await open(DESK, "light");
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.route(searchOf("cart"), async (r) => {
      await sleep(2000);
      try { await r.fallback(); } catch (x) {}
    });
    await search(p, "cart");
    await p.waitForTimeout(600);
    const moving = await p.evaluate(() => document.querySelector("p99-root").shadowRoot.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.matches?.(".p99-shimmer, .p99-spin")).length);
    check(`with reduced motion neither the shimmer nor the spinner moves (${moving} running)`, moving === 0);
    await ctx.close();
  }

  const shoot = async (p, name) => {
    await p.screenshot({ path: join(stills, name) });
    console.log(`still ${join(stills, name)}`);
  };
  for (const scheme of ["light", "dark"]) {
    for (const [size, opts] of SIZES) {
      const { ctx, p } = await open(opts, scheme);
      await p.route(searchOf("cart"), async (r) => {
        await sleep(3000);
        try { await r.fallback(); } catch (x) {}
      });
      await search(p, "cart");
      await p.waitForTimeout(700);
      const mid = await p.evaluate(() => {
        const list = document.querySelector("p99-root").shadowRoot.getAnimations().filter((a) => a.effect?.target?.matches?.(".p99-shimmer, .p99-spin"));
        for (const a of list) { a.pause(); a.currentTime = 560; }
        return list.length;
      });
      await shoot(p, `search-wait-${size}-${scheme}.png`);
      check(`still search-wait-${size}-${scheme}.png caught the shimmer and the spinner mid-way (${mid} animations)`, mid >= 5);
      await p.evaluate(() => { for (const a of document.querySelector("p99-root").shadowRoot.getAnimations()) a.play(); });
      let s = await settled(p);
      await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur?.());
      await shoot(p, `search-results-${size}-${scheme}.png`);
      check(`  results at ${size} ${scheme}`, s.rows.length === 2);
      await search(p, "zebra");
      s = await settled(p);
      await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur?.());
      await shoot(p, `search-empty-${size}-${scheme}.png`);
      check(`  no match at ${size} ${scheme}`, !!s.empty);
      await p.route(searchOf("checkout"), (r) => r.abort("failed"));
      await search(p, "checkout");
      s = await settled(p);
      await p.evaluate(() => document.querySelector("p99-root").shadowRoot.activeElement?.blur?.());
      await shoot(p, `search-error-${size}-${scheme}.png`);
      check(`  error and Retry at ${size} ${scheme}`, !!s.error && s.retry);
      await ctx.close();
    }
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `search-check: ${failed} failed` : "search-check: all passed");
done(failed ? 1 : 0);

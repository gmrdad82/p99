import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
export const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
export const RUN = randomUUID().slice(0, 8);
export const tag = (title) => `${title} [${RUN}]`;

export const S = (sel) => `p99-root >> .p99-panel.is-open ${sel}`;
export const TITLE = S(".p99-new input[name=title]");
export const SEND = S(".p99-new .p99-actions button[type=submit]");
export const RETRY = S(".p99-new .p99-status-line .p99-retry");
export const FAILED = "Couldn't send; try again.";
export const NO_SHOT = "This site doesn't send screenshots, so your report goes without one.";

export function projectOf(kit, name) {
  const found = kit.space.projects.find((p) => p.name === name);
  assert.ok(found, `the seeded space has no project ${name}: ${JSON.stringify(kit.space)}`);
  return found;
}

export function hostOf(kit, name) {
  const host = projectOf(kit, name).hosts[0];
  assert.ok(host, `the project ${name} has no host`);
  return host;
}

export async function signed(kit, method, path, body) {
  const r = await kit.call(method, `/_p99/v1${path}`, { actor: ADA, body });
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${JSON.stringify(r.json)}`);
  return r;
}

export async function codeFor(kit, host, person, owner = false) {
  const minted = await kit.mint(person.name, person.email, [host], owner);
  assert.ok(minted.secret, `no code was minted for ${person.email}`);
  return minted.secret;
}

export async function titled(kit, title, query = "") {
  const r = await signed(kit, "GET", `/issues?scope=all&status=any&q=${encodeURIComponent(title)}${query}`);
  return (r.json.issues || []).filter((i) => i.title === title);
}

export async function thread(kit, key) {
  return (await signed(kit, "GET", `/issues/${key}`)).json;
}

export async function fileBytes(kit, id) {
  const r = await signed(kit, "GET", `/files/${id}`);
  return Buffer.from(await r.response.arrayBuffer());
}

export async function visit(kit, host, { code, path = "/checkout", init = [], scheme = "light" } = {}) {
  const p = await kit.page();
  for (const script of init) await p.addInitScript(script);
  await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e && e.message)));
  await p.goto(kit.siteUrl(host, path) + (code ? `#p99=${code}` : ""));
  if (code) await plus(p).waitFor({ timeout: 20000 });
  return { p, errors };
}

export const plus = (p) => p.locator("p99-root >> .w .f");
export const listButton = (p) => p.locator("p99-root >> .w .b:not(.f)");

export async function openForm(p) {
  await plus(p).click();
  await p.locator(TITLE).waitFor({ timeout: 20000 });
}

export const shotReady = (p) => p.locator(S(".p99-shot[data-role=screenshot] canvas")).waitFor({ timeout: 30000 });
export const threadShown = (p) => p.locator(S("[data-view=item]")).waitFor({ timeout: 20000 });

export async function write(p, title, body = "") {
  await p.locator(TITLE).fill(title);
  if (body) await p.locator(S(".p99-new textarea[name=body]")).fill(body);
}

export const statusLine = (p) =>
  p.evaluate(() => document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-new .p99-status-line")?.textContent || "");

export async function waitStatus(p, re, ms = 20000) {
  await p
    .waitForFunction(
      (src) => new RegExp(src, "i").test(document.querySelector("p99-root")?.shadowRoot?.querySelector(".p99-panel.is-open .p99-new .p99-status-line")?.textContent || ""),
      re.source,
      { timeout: ms },
    )
    .catch(async () => {
      throw new Error(`the status line never matched ${re}: "${await statusLine(p)}"`);
    });
}

export function gate() {
  let open;
  const opened = new Promise((r) => (open = r));
  return { opened, open };
}

export function issueBody(path, overrides = {}) {
  return {
    client_uid: randomUUID(),
    kind: "bug",
    title: tag("Filed from the page"),
    body: "",
    page: { url: `https://example.com${path}`, path, title: "Checkout" },
    context: {},
    marks: [],
    ...overrides,
  };
}

export function inPage(p, method, path, code, body, type) {
  return p.evaluate(
    async ({ method, path, code, body, type }) => {
      const headers = { "x-p99-code": code };
      let payload;
      if (typeof body === "string") {
        headers["content-type"] = type || "application/octet-stream";
        payload = body;
      } else if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const r = await fetch(`/_p99/api${path}`, { method, headers, body: payload, credentials: "same-origin" });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json, text };
    },
    { method, path, code, body, type },
  );
}

export const asData = (bytes, type) => `data:${type || "image/webp"};base64,${Buffer.from(bytes).toString("base64")}`;

export const READ = `(async ({ src, width, rects, colours }) => {
  const bmp = await createImageBitmap(await (await fetch(src)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const scale = bmp.width / width;
  const spread = (r) => {
    const x0 = Math.max(0, Math.floor((r.x + 8) * scale)), y0 = Math.max(0, Math.floor((r.y + 8) * scale));
    const x1 = Math.min(bmp.width, Math.ceil((r.x + r.w - 8) * scale)), y1 = Math.min(bmp.height, Math.ceil((r.y + r.h - 8) * scale));
    if (x1 <= x0 || y1 <= y0) return -1;
    const lo = [255, 255, 255], hi = [0, 0, 0], sum = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * bmp.width + x) * 4;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], d[i + k]); hi[k] = Math.max(hi[k], d[i + k]); sum[k] += d[i + k]; }
    }
    const n = (x1 - x0) * (y1 - y0);
    means.push(sum.map((v) => Math.round(v / n)));
    return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  };
  const means = [];
  const counts = {};
  for (const [name, rgb] of Object.entries(colours || {})) counts[name] = 0;
  for (let i = 0; i < d.length; i += 4) {
    for (const [name, [r, gg, b]] of Object.entries(colours || {})) if (Math.hypot(d[i] - r, d[i + 1] - gg, d[i + 2] - b) < 80) counts[name]++;
  }
  return { width: bmp.width, height: bmp.height, spreads: (rects || []).map(spread), means, counts };
})`;

export const readImage = (p, args) => p.evaluate(`${READ}(${JSON.stringify(args)})`);

export const viewportWidth = (p) => p.evaluate(() => document.documentElement.clientWidth || innerWidth);

export const rectOf = (p, selector) =>
  p.evaluate((q) => {
    const b = document.querySelector(q).getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, selector);

export const previewSrc = (p, sel) => p.evaluate((q) => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open " + q).toDataURL(), sel);

export const CONTRAST = `(() => {
  const rgb = (c) => {
    const m = /^rgba?\\(([^)]+)\\)/.exec(c);
    if (m) return m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
    const s = /^color\\(srgb ([^)]+)\\)/.exec(c);
    return s ? s[1].split(/[ /]+/).slice(0, 3).map((v) => Number(v) * 255) : null;
  };
  const lum = (c) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  return (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
})()`;

export async function closing(p, fn) {
  try {
    return await fn();
  } finally {
    await p.close().catch(() => {});
  }
}

export const apart = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const LOCKED_MASKS = Array.from({ length: 14 }, (_, i) => `.private-${i + 1}`).concat([".card-number"]);
export const VERIFY_INPUT = S("[data-view=verify] input[name=totp]");

export function watchPolicy() {
  window.__p99Violations = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__p99Violations.push(`${e.violatedDirective} ${e.blockedURI}`));
}

export const violations = (p) => p.evaluate(() => window.__p99Violations);

export async function guardedOwner(kit, host) {
  const put = await kit.call("PUT", `/_p99/v1/hosts/${host}`, { actor: ADA, body: { env: "production", project: "Shop", config: { mask: LOCKED_MASKS } } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const minted = await signed(kit, "POST", "/codes", { name: ADA.name, email: ADA.email, hosts: [host], role: "owner", totp: true, mail: false });
  assert.ok(minted.json.secret && minted.json.totp_key, "an Owner code with an authenticator");
  return { code: minted.json.secret, key: minted.json.totp_key };
}

export async function lockedVisit(kit, host, code) {
  const p = await kit.page();
  await p.addInitScript(watchPolicy);
  const errors = [];
  const blocked = [];
  p.on("pageerror", (e) => errors.push(String(e && e.message)));
  p.on("console", (m) => /Content Security Policy/i.test(m.text()) && blocked.push(m.text().slice(0, 300)));
  const page = await p.goto(`${kit.siteUrl(host, "/locked.html")}${code ? `#p99=${code}` : ""}`);
  assert.equal(page.headers()["content-security-policy"], "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  await plus(p).waitFor({ timeout: 20000 });
  return { p, errors, blocked };
}

export async function passCode(kit, p, key) {
  await p.locator(VERIFY_INPUT).waitFor({ timeout: 20000 });
  await p.locator(VERIFY_INPUT).fill(kit.totp(key));
  await p.locator(VERIFY_INPUT).press("Enter");
}

export const brokenImages = (p) =>
  p.evaluate(() =>
    Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll("img"))
      .filter((i) => !i.complete || !i.naturalWidth)
      .map((i) => `${i.className || i.alt || "img"} ${String(i.src).slice(0, 60)}`),
  );

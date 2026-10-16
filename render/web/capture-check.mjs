import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const { values: args } = parseArgs({
  options: {
    panel: { type: "string", default: join(repo, "worker", "src", "web", "panel.js") },
    out: { type: "string", default: join(repo, "tmp", "capture-check") },
    label: { type: "string", default: "now" },
    cap: { type: "string", default: "30000" },
  },
});
const CAP = Number(args.cap);
const SLOW_IMAGE_MS = 3000;
const VIEW = { width: 1280, height: 800 };

const vendor = readFileSync(join(repo, "worker", "src", "web", "vendor", "modern-screenshot-4.7.0.js"), "utf8");
const shot = readFileSync(join(repo, "worker", "src", "web", "shot.js"), "utf8");
const capture = `const ms = (() => {\nvar exports = {}, module = {};\n${vendor}\nreturn exports;\n})();\n${shot}`;
const panel = readFileSync(args.panel, "utf8") +
  "\nexport function __check() { root = document.createElement(\"div\"); document.body.append(root); o = { host: null, root, ring: [] }; return capture; }\n";
const page = readFileSync(join(here, "capture", "page.html"));

const hues = [24, 200, 140, 330, 50, 260, 0, 170, 90, 300, 220, 10, 120, 280];
const poster = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hues[n % hues.length]} 55% 45%)"/><stop offset="1" stop-color="hsl(${(hues[n % hues.length] + 40) % 360} 60% 25%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="200" font-family="sans-serif" font-size="72" fill="#fff" text-anchor="middle">poster ${n}</text></svg>`;

const log = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  log.push(path);
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "max-age=60", "access-control-allow-origin": "*" });
    res.end(body);
  };
  if (path === "/") return send(200, "text/html; charset=utf-8", page);
  if (path === "/_p99/capture.js") return send(200, "text/javascript", capture);
  if (path === "/_p99/panel.js") return send(200, "text/javascript", panel);
  let m = /^\/media\/poster-(\d+)\.svg$/.exec(path);
  if (m) return send(200, "image/svg+xml", poster(Number(m[1])));
  m = /^\/slow\/shot-(\d+)\.svg$/.exec(path);
  if (m) return setTimeout(() => send(200, "image/svg+xml", poster(Number(m[1]))), SLOW_IMAGE_MS);
  send(404, "text/plain", "not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

mkdirSync(args.out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.P99_CHROMIUM || "/usr/bin/chromium", env: { ...process.env, TMPDIR: process.env.XDG_RUNTIME_DIR || process.env.TMPDIR }, args: [`--host-resolver-rules=MAP media.example.com 127.0.0.1`, "--hide-scrollbars", "--font-render-hinting=none"] });
const results = {};
for (const full of [false, true]) {
  const name = full ? "page" : "screen";
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  if (process.env.P99_DEBUG) p.on("console", (m) => console.log(name, m.text()));
  await p.goto(ORIGIN + "/", { waitUntil: "load" });
  await p.waitForTimeout(300);
  if (!full) await p.screenshot({ path: join(args.out, `${args.label}-live.png`) });
  const from = log.length;
  const r = await p.evaluate(async ({ full, cap }) => {
    const mod = await import("/_p99/panel.js");
    const run = mod.__check();
    const t = performance.now();
    try {
      const s = await Promise.race([run(full), new Promise((_, no) => setTimeout(() => no(new Error("still running after " + cap + " ms")), cap))]);
      return { ms: Math.round(performance.now() - t), w: s.canvas.width, h: s.canvas.height, png: s.canvas.toDataURL("image/png") };
    } catch (e) {
      return { ms: Math.round(performance.now() - t), error: String(e && e.message) };
    }
  }, { full, cap: CAP });
  const requests = log.slice(from);
  results[name] = { ms: r.ms, size: r.w ? `${r.w}x${r.h}` : null, error: r.error || null, fragmentGets: requests.filter((x) => /%23|#/.test(x)).length, videoGets: requests.filter((x) => x.endsWith(".mp4")).length };
  if (r.png) writeFileSync(join(args.out, `${args.label}-${name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
  await ctx.close();
}
await browser.close();
server.close();
console.log(JSON.stringify({ label: args.label, ...results }, null, 2));

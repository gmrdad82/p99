import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, request } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const worker = join(repo, "worker");
const work = join(repo, "tmp", "web");
const site = join(here, "site");
const PORT = Number(process.env.P99_PROXY_PORT || 8799);
const UPSTREAM = Number(process.env.P99_WORKER_PORT || 8790);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const PAGES = { "/": "checkout.html", "/checkout": "checkout.html" };

mkdirSync(work, { recursive: true });
const state = join(work, "state");
rmSync(state, { recursive: true, force: true });
const key = randomBytes(32).toString("hex");
writeFileSync(join(work, "key"), key, { mode: 0o600 });

const wrangler = join(worker, "node_modules", ".bin", "wrangler");
if (!existsSync(wrangler)) {
  console.error("serve: run npm ci in worker/ first");
  process.exit(1);
}
const migrated = spawnSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { cwd: worker, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1" } });
if (migrated.status !== 0) process.exit(1);

const dev = spawn(wrangler, ["dev", "--ip", "127.0.0.1", "--port", String(UPSTREAM), "--persist-to", state, "--var", `KEY_P99:${key}`, "--var", "CODE_PEPPER:local-recording", "--show-interactive-dev-session=false", "--log-level", "warn"], {
  cwd: worker,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, CI: "1" },
});
const stop = () => {
  dev.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
dev.on("exit", (code) => {
  console.error(`serve: wrangler exited with ${code}`);
  process.exit(1);
});

function file(res, path) {
  const name = PAGES[path] || normalize(path).replace(/^\/+/, "");
  const full = join(site, name);
  if (!full.startsWith(site) || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(full));
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/_p99/")) return file(res, url.pathname);
  const up = request({ host: "127.0.0.1", port: UPSTREAM, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("the Worker is not up yet");
  });
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => console.log(`serve: http://127.0.0.1:${PORT}/ -> worker on ${UPSTREAM}`));

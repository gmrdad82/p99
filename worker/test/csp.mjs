import { spawn } from "node:child_process";
import { request } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const POLICY = (hash) =>
  `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-${hash}'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;

export async function cspChecks({ check, get }) {
  await check("the app page's CSP allows exactly its one inline critical style, by the sha256 of the block as served", async () => {
    const pages = [await get("/"), await get("/", "__Host-p99=" + "a".repeat(43))];
    const hashes = new Set();
    for (const page of pages) {
      assert.equal(page.status, 200, page.text);
      assert.equal((page.text.match(/<style\b/g) || []).length, 1, "one inline style block");
      const block = /<style>([\s\S]*?)<\/style>/.exec(page.text);
      assert.ok(block && block[1].length > 0, "the inline style has no attributes and is not empty");
      assert.ok(!block[1].includes("\r"), "the block is LF only, as the browser hashes it");
      const hash = createHash("sha256").update(block[1], "utf8").digest("base64");
      assert.equal(page.headers["content-security-policy"], POLICY(hash));
      assert.ok(!/unsafe-/.test(page.headers["content-security-policy"]));
      assert.ok(!/\sstyle=/.test(page.text), "no style attributes");
      for (const tag of page.text.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\ssrc="\/_p99\/app\.js\?v=[^"]+"/);
      assert.match(page.text, /<link rel="stylesheet" id="app-css" href="\/_p99\/app\.css\?v=[^"]+" media="print">/);
      hashes.add(hash);
    }
    assert.equal(hashes.size, 1, "signed in and signed out share one block");
    const css = await get("/_p99/app.css?v=dev");
    assert.equal(css.status, 200);
    assert.equal(css.headers["content-security-policy"], pages[0].headers["content-security-policy"]);
  });
}

export function getter(host, port) {
  return (path, cookie) =>
    new Promise((resolve, reject) => {
      const headers = { host };
      if (cookie) headers.cookie = cookie;
      const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end();
    });
}

async function alone() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const port = Number(process.env.P99_TEST_PORT || 8791);
  const state = join(root, ".wrangler", "csp-state");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  const log = openSync(join(root, ".wrangler", "csp-dev.log"), "w");
  const child = spawn(
    join(root, "node_modules", ".bin", "wrangler"),
    ["dev", "--local", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", state, "--show-interactive-dev-session=false", "--var", "APP_HOST:app.localhost", "CODE_PEPPER:test-pepper"],
    { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", log, log], detached: true },
  );
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  process.on("exit", stop);
  const get = getter(`app.localhost:${port}`, port);
  try {
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error("wrangler dev exited; see .wrangler/csp-dev.log");
      try {
        if ((await get("/")).status === 200) break;
      } catch {}
      if (i >= 300) throw new Error("wrangler dev did not answer in 60 s");
      await new Promise((r) => setTimeout(r, 200));
    }
    await cspChecks({ check: async (name, fn) => (await fn(), console.log(`ok - ${name}`)), get });
  } finally {
    stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  alone().catch((error) => {
    console.error(`not ok - ${error.message}`);
    process.exitCode = 1;
  });
}

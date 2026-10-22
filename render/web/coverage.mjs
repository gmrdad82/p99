import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lineStarts, mergeLines, offsetCounts, plainLines, rows, table } from "../../worker/test/coverage-lines.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const worker = join(repo, "worker");
const web = join(worker, "src", "web");

export const CHECKS = ["capture-check.mjs", "manage-check.mjs", "mobile-check.mjs", "search-check.mjs", "swap-check.mjs", "stories-widget.mjs"];
export const SHOWN = ["p99.js", "panel.js", "board.js", "shot.js", "avatar.js"];
const SERVED = new Set([...SHOWN, "app.js"]);
const CAPTURE_TAIL = "\nreturn exports;\n})();\n";

export function ownScripts(entries) {
  return entries.filter((entry) => {
    try {
      const path = new URL(entry.url).pathname;
      return path.startsWith("/_p99/") && path.endsWith(".js");
    } catch {
      return false;
    }
  });
}

export function cover(type, out) {
  const covered = new Set();
  const take = async (page) => {
    if (!covered.delete(page)) return;
    const entries = ownScripts(await page.coverage.stopJSCoverage().catch(() => []));
    if (entries.length > 0) out(entries);
  };
  const wrapContext = (ctx) => {
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...args) => {
      const page = await newPage(...args);
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      covered.add(page);
      const close = page.close.bind(page);
      page.close = async (...rest) => {
        await take(page);
        return close(...rest);
      };
      return page;
    };
    const close = ctx.close.bind(ctx);
    ctx.close = async (...args) => {
      for (const page of ctx.pages()) await take(page);
      return close(...args);
    };
    return ctx;
  };
  const launch = type.launch.bind(type);
  type.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...rest) => wrapContext(await newContext(...rest));
    const close = browser.close.bind(browser);
    browser.close = async (...rest) => {
      for (const page of [...covered]) await take(page);
      return close(...rest);
    };
    return browser;
  };
  return type;
}

export function servedParts(url, source) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return [];
  }
  if (!path.startsWith("/_p99/")) return [];
  const name = path.slice("/_p99/".length);
  if (name === "capture.js") {
    const at = source.lastIndexOf(CAPTURE_TAIL);
    if (at < 0) return [];
    return [{ name: "shot.js", from: lineStarts(source.slice(0, at + CAPTURE_TAIL.length)).length - 1 }];
  }
  return SERVED.has(name) ? [{ name, from: 0 }] : [];
}

export function fold(dir, readText = (name) => readFileSync(join(web, name), "utf8")) {
  const files = new Map();
  const sizes = new Map();
  const size = (name) => {
    if (!sizes.has(name)) {
      const text = readText(name);
      sizes.set(name, lineStarts(text).length - (text.endsWith("\n") ? 1 : 0));
    }
    return sizes.get(name);
  };
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!file.endsWith(".json")) continue;
    for (const entry of JSON.parse(readFileSync(join(dir, file), "utf8"))) {
      const parts = servedParts(entry.url, entry.source);
      if (parts.length === 0) continue;
      const counts = offsetCounts(entry.source, entry.functions);
      for (const { name, from } of parts) mergeLines(files, join(web, name), plainLines(entry.source, counts, from, from + size(name)));
    }
  }
  return files;
}

export function report(dir) {
  const universe = SHOWN.map((name) => ({ name: `src/web/${name}`, text: readFileSync(join(web, name), "utf8") }));
  return table(rows(fold(dir), worker, universe));
}

function runCheck(check, dir) {
  const hook = pathToFileURL(join(here, "coverage-hook.mjs")).href;
  const child = spawn(process.execPath, ["--import", hook, join(here, check)], {
    cwd: here,
    stdio: "inherit",
    env: { ...process.env, P99_BROWSER_COVERAGE: dir },
  });
  return new Promise((done) => child.once("exit", (status, signal) => done(signal ? 1 : status)));
}

async function main() {
  const picked = process.argv.slice(2);
  const unknown = picked.filter((name) => !CHECKS.includes(name));
  if (unknown.length > 0) {
    console.error(`coverage: no such check: ${unknown.join(", ")}; the checks are ${CHECKS.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const dir = join(repo, "tmp", "browser-coverage");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const failed = [];
  for (const check of picked.length > 0 ? picked : CHECKS) {
    console.log(`coverage: ${check}`);
    if ((await runCheck(check, dir)) !== 0) failed.push(check);
  }
  const text = report(dir);
  writeFileSync(join(dir, "table.md"), text + "\n");
  console.log(`\nBrowser line coverage (worker/src/web, from the browser checks):\n\n${text}`);
  if (failed.length > 0) {
    console.error(`coverage: ${failed.join(", ")} failed; their pages count as far as they ran`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

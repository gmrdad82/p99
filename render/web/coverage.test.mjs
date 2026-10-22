import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOWN, cover, dumpCount, fold, ownScripts, problems, report, servedParts } from "./coverage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const web = join(repo, "worker", "src", "web");
const whole = (source, ...inner) => [{ functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }, ...inner] }];

function scratch() {
  mkdirSync(join(repo, "tmp"), { recursive: true });
  return mkdtempSync(join(repo, "tmp", "browser-coverage-test-"));
}

test("a served P99 script maps to its file under worker/src/web, whatever its origin or version query", () => {
  assert.deepEqual(servedParts("http://127.0.0.1:8790/_p99/panel.js?v=dev", ""), [{ name: "panel.js", from: 0 }]);
  assert.deepEqual(servedParts("http://shop.example.com/_p99/p99.js", ""), [{ name: "p99.js", from: 0 }]);
  assert.deepEqual(servedParts("http://shop.example.com/_p99/board.js?v=1.9.3", ""), [{ name: "board.js", from: 0 }]);
  assert.deepEqual(servedParts("http://shop.example.com/_p99/p99.css", ""), []);
  assert.deepEqual(servedParts("http://shop.example.com/panel.js", ""), []);
  assert.deepEqual(servedParts("http://shop.example.com/_p99/vendor/panel.js", ""), []);
  assert.deepEqual(servedParts("not a url", ""), []);
});

test("capture.js counts only its shot.js tail, from the line after the vendored library", () => {
  const served = "const ms = (() => {\nvar exports = {}, module = {};\nlib();\nreturn exports;\n})();\nexport function capture() {}\n";
  assert.deepEqual(servedParts("http://x.example.com/_p99/capture.js?v=dev", served), [{ name: "shot.js", from: 5 }]);
  assert.deepEqual(servedParts("http://x.example.com/_p99/capture.js", "lib();"), []);
});

test("only P99's own scripts are kept from a page's coverage", () => {
  const kept = ownScripts([
    { url: "http://x.example.com/_p99/panel.js?v=dev" },
    { url: "http://x.example.com/app.js" },
    { url: "http://x.example.com/_p99/p99.css" },
    { url: "" },
  ]);
  assert.deepEqual(kept.map((e) => e.url), ["http://x.example.com/_p99/panel.js?v=dev"]);
});

test("folding counts a file's lines once across pages, and drops lines a check appended past the file's end", () => {
  const dir = scratch();
  try {
    const texts = { "panel.js": "a();\nb();\nc();\n", "shot.js": "s();\nt();\n" };
    const panelSeen = `${texts["panel.js"]}export function __check() {}\n`;
    const bAt = panelSeen.indexOf("b();");
    const one = { url: "http://127.0.0.1:1/_p99/panel.js", source: panelSeen, functions: whole(panelSeen, { startOffset: bAt, endOffset: bAt + 4, count: 0 }) };
    const two = { url: "http://127.0.0.1:2/_p99/panel.js?v=dev", source: texts["panel.js"], functions: whole(texts["panel.js"]) };
    const capture = `const ms = (() => {\nlib();\nreturn exports;\n})();\n${texts["shot.js"]}`;
    const tAt = capture.indexOf("t();");
    const three = { url: "http://127.0.0.1:1/_p99/capture.js", source: capture, functions: whole(capture, { startOffset: tAt, endOffset: tAt + 4, count: 0 }) };
    writeFileSync(join(dir, "1-0.json"), JSON.stringify([one, three]));
    const files = fold(dir, (name) => texts[name]);
    assert.deepEqual([...files.get(join(web, "panel.js"))], [
      [1, true],
      [2, false],
      [3, true],
    ]);
    assert.deepEqual([...files.get(join(web, "shot.js"))], [
      [1, true],
      [2, false],
    ]);
    writeFileSync(join(dir, "1-1.json"), JSON.stringify([two]));
    assert.equal(fold(dir, (name) => texts[name]).get(join(web, "panel.js")).get(2), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the browser table lists the loader, panel, board, shot, avatar and app even when no check loaded them", () => {
  const dir = scratch();
  rmSync(dir, { recursive: true, force: true });
  const shown = report(dir);
  for (const name of SHOWN) assert.match(shown, new RegExp(`^\\| src/web/${name.replace(".", "\\.")} \\| 0\\.00% \\| \\d+ \\|$`, "m"));
  assert.match(shown, /^\| \*\*total\*\* \| \*\*0\.00%\*\* \|/m);
});

test("the hook covers every page a check opens and hands over its coverage once, however the page ends", async () => {
  const log = [];
  const fakePage = (n) => {
    const page = {
      started: null,
      closed: false,
      coverage: {
        startJSCoverage: async (opts) => {
          page.started = opts;
        },
        stopJSCoverage: async () => {
          log.push(`stop ${n}`);
          return [{ url: `http://x.example.com/_p99/panel.js?n=${n}`, source: "", functions: [] }, { url: "http://x.example.com/site.js" }];
        },
      },
      close: async () => {
        page.closed = true;
      },
    };
    return page;
  };
  let made = 0;
  const contexts = [];
  const type = {
    launch: async () => ({
      newContext: async () => {
        const pages = [];
        const ctx = {
          newPage: async () => {
            const page = fakePage(made++);
            pages.push(page);
            return page;
          },
          pages: () => pages,
          close: async () => log.push("ctx closed"),
        };
        contexts.push(ctx);
        return ctx;
      },
      close: async () => log.push("browser closed"),
    }),
  };
  const handed = [];
  cover(type, (entries) => handed.push(entries.map((e) => e.url)));
  const browser = await type.launch();
  const ctx = await browser.newContext();
  const first = await ctx.newPage();
  const second = await ctx.newPage();
  assert.deepEqual(first.started, { resetOnNavigation: false });
  await first.close();
  assert.equal(first.closed, true);
  await ctx.close();
  const other = await browser.newContext();
  await other.newPage();
  await browser.close();
  assert.deepEqual(log, ["stop 0", "stop 1", "ctx closed", "stop 2", "browser closed"]);
  assert.deepEqual(handed, [["http://x.example.com/_p99/panel.js?n=0"], ["http://x.example.com/_p99/panel.js?n=1"], ["http://x.example.com/_p99/panel.js?n=2"]]);
  assert.equal(second.closed, false);
});

test("a page whose coverage can't be read hands over nothing and still closes", async () => {
  const handed = [];
  const page = {
    coverage: { startJSCoverage: async () => {}, stopJSCoverage: async () => Promise.reject(new Error("target closed")) },
    close: async () => {
      page.closed = true;
    },
  };
  const type = { launch: async () => ({ newContext: async () => ({ newPage: async () => page, pages: () => [page], close: async () => {} }), close: async () => {} }) };
  cover(type, (entries) => handed.push(entries));
  const ctx = await (await type.launch()).newContext();
  await (await ctx.newPage()).close();
  assert.equal(page.closed, true);
  assert.deepEqual(handed, []);
});

test("a check that took no coverage, or a pass where no web line ran, fails with one line each", () => {
  const ran = new Map([[join(web, "p99.js"), new Map([[1, true], [2, false]])]]);
  const idle = new Map([[join(web, "p99.js"), new Map([[1, false]])]]);
  assert.deepEqual(problems([{ check: "capture-check.mjs", dumps: 2 }], ran), []);
  assert.deepEqual(problems([{ check: "capture-check.mjs", dumps: 2 }, { check: "search-check.mjs", dumps: 0 }], ran), [
    "coverage: search-check.mjs took no coverage of a P99 script",
  ]);
  assert.deepEqual(problems([{ check: "swap-check.mjs", dumps: 1 }], idle), ["coverage: no line of worker/src/web ran in any check"]);
  assert.equal(problems([], new Map()).length, 1);
});

test("the dump count reads only JSON files, and a missing folder counts none", () => {
  const dir = scratch();
  try {
    assert.equal(dumpCount(dir), 0);
    writeFileSync(join(dir, "1-0.json"), "[]");
    writeFileSync(join(dir, "table.md"), "");
    assert.equal(dumpCount(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(dumpCount(dir), 0);
});

test("app.js counts in the browser table, so its row shows whichever checks ran", () => {
  assert.ok(SHOWN.includes("app.js"));
  assert.deepEqual(servedParts("http://app.localhost:8790/_p99/app.js", ""), [{ name: "app.js", from: 0 }]);
});

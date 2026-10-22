import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMappings, lineStarts, mappedLines, mergeLines, offsetCounts, plainLines, rows, sourceMapOf, table } from "./coverage-lines.mjs";
import { collect, ownsFile, report, workerFiles } from "./coverage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fn = (...ranges) => ({ functionName: "", isBlockCoverage: true, ranges: ranges.map(([startOffset, endOffset, count]) => ({ startOffset, endOffset, count })) });

function scratch() {
  mkdirSync(join(root, ".wrangler"), { recursive: true });
  return mkdtempSync(join(root, ".wrangler", "coverage-test-"));
}

test("VLQ mappings decode to absolute columns, sources and lines, with relative fields carried across lines", () => {
  assert.deepEqual(decodeMappings("AAAA;AACA,EAAE"), [[[0, 0, 0, 0]], [[0, 0, 1, 0], [2, 0, 1, 2]]]);
  assert.deepEqual(decodeMappings("gBAAA"), [[[16, 0, 0, 0]]]);
  assert.deepEqual(decodeMappings("D"), [[[-1]]]);
  assert.deepEqual(decodeMappings(";;"), [[], [], []]);
  assert.deepEqual(decodeMappings("AACA;AADA"), [[[0, 0, 1, 0]], [[0, 0, 0, 0]]]);
});

test("broken VLQ is an error, never a silent zero", () => {
  assert.throws(() => decodeMappings("A!AA"), /bad base64 VLQ digit/);
  assert.throws(() => decodeMappings("g"), /mid-digit/);
});

test("the innermost range decides an offset's count", () => {
  const counts = offsetCounts("abcdefghij", [fn([0, 10, 1], [2, 5, 0], [3, 4, 7])]);
  assert.deepEqual([...counts.slice(0, 10)], [1, 1, 0, 7, 0, 1, 1, 1, 1, 1]);
});

test("a loaded script's top level counts as run even when the counter started late, and only then", () => {
  const late = offsetCounts("abcdef", [fn([0, 6, 0]), fn([2, 4, 0])], { loaded: true });
  assert.equal(late[0], 1);
  assert.equal(late[2], 0);
  const cold = offsetCounts("abcdef", [fn([0, 6, 0]), fn([2, 4, 0])]);
  assert.equal(cold[0], 0);
  const warm = offsetCounts("abcdef", [fn([0, 6, 0]), fn([2, 4, 3])]);
  assert.equal(warm[0], 1);
  assert.equal(warm[3], 3);
  const inner = offsetCounts("abcdef", [fn([1, 6, 0])], { loaded: true });
  assert.equal(inner[1], 0);
});

test("plain lines skip blank lines and read each line at its first non-space character", () => {
  const source = "a();\n\n  b();\n\t\nc();";
  const at = source.indexOf("b");
  const counts = offsetCounts(source, [fn([0, source.length, 1], [at, at + 4, 0])]);
  assert.deepEqual([...plainLines(source, counts)], [
    [1, true],
    [3, false],
    [5, true],
  ]);
  assert.deepEqual(lineStarts("x\ny\n"), [0, 2, 4]);
});

test("plain lines can number a slice of a served file from its own first line", () => {
  const source = "vendor();\nvendor();\nown();\nmore();";
  const counts = offsetCounts(source, [fn([0, source.length, 1])]);
  assert.deepEqual([...plainLines(source, counts, 2)], [
    [1, true],
    [2, true],
  ]);
  assert.deepEqual([...plainLines(source, counts, 1, 2)], [[1, true]]);
});

test("mapped lines land on the original file and line, and a line is covered when any of its segments ran", () => {
  const source = "one();two();\nthree();";
  const counts = offsetCounts(source, [fn([0, source.length, 1], [13, 21, 0])]);
  const map = { version: 3, sources: ["../src/a.js", "pkg:skip"], mappings: "AAAA,MAAM;AACA,MCAA" };
  const files = mappedLines(source, counts, map, "/r/tmp");
  assert.deepEqual([...files.keys()], [resolve("/r/src/a.js")]);
  assert.deepEqual([...files.get(resolve("/r/src/a.js"))], [
    [1, true],
    [2, false],
  ]);
});

test("a segment past the generated text or without a source maps nothing", () => {
  const files = mappedLines("x();", new Float64Array(5).fill(1), { sources: ["a.js"], mappings: "AAAA;AACA;AACA" }, "/r");
  assert.deepEqual([...files.get(resolve("/r/a.js"))], [[1, true]]);
  assert.equal(mappedLines("x();", new Float64Array(5), { sources: ["a.js"], mappings: "A" }, "/r").size, 0);
});

test("merging keeps a line covered once any run covered it", () => {
  const files = new Map();
  mergeLines(files, "a.js", new Map([[1, false], [2, true]]));
  mergeLines(files, "a.js", new Map([[1, true], [2, false], [3, false]]));
  assert.deepEqual([...files.get("a.js")], [
    [1, true],
    [2, true],
    [3, false],
  ]);
});

test("a source map is read inline, from beside the script, by name under the search folder, or not at all", () => {
  const map = { version: 3, sources: ["a.js"], mappings: "AAAA" };
  const inline = `x();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
  assert.deepEqual(sourceMapOf({ url: "worker.js", source: inline }, null).map, map);
  const dir = scratch();
  try {
    const nested = join(dir, "dev-1");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "bundle.js.map"), JSON.stringify(map));
    const beside = sourceMapOf({ url: pathToFileURL(join(nested, "bundle.js")).href, source: "x();\n//# sourceMappingURL=bundle.js.map" }, null);
    assert.equal(beside.dir, nested);
    const named = sourceMapOf({ url: "bundle.js", sourceMapURL: "bundle.js.map", source: "x();" }, dir);
    assert.equal(named.dir, nested);
    assert.equal(sourceMapOf({ url: "bundle.js", sourceMapURL: "gone.js.map", source: "" }, dir), null);
    assert.equal(sourceMapOf({ url: "bundle.js", source: "x();" }, dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the table lists every file once, sorted, with unloaded files at 0% and a line-weighted total", () => {
  const files = new Map([[join("/r", "src", "b.js"), new Map([[1, true], [2, false], [3, true], [4, true]])]]);
  const list = rows(files, "/r", [{ name: "src/a.js", text: "a();\n\nb();" }, { name: "src/b.js", text: "ignored" }]);
  assert.deepEqual(list, [
    { file: "src/a.js", covered: 0, lines: 2, pct: 0 },
    { file: "src/b.js", covered: 3, lines: 4, pct: 75 },
  ]);
  assert.equal(
    table(list),
    ["| File | Lines covered | Lines |", "|---|---|---|", "| src/a.js | 0.00% | 2 |", "| src/b.js | 75.00% | 4 |", "| **total** | **50.00%** | 6 |"].join("\n"),
  );
  assert.match(table([]), /\*\*0\.00%\*\* \| 0 \|$/);
});

test("the Worker report owns worker/src's modules, never the browser files under web/ or anything outside", () => {
  assert.equal(ownsFile(join(root, "src", "worker.js")), true);
  assert.equal(ownsFile(join(root, "src", "web", "panel.js")), false);
  assert.equal(ownsFile(join(root, "test", "run.mjs")), false);
  assert.equal(ownsFile(join(root, "src", "worker.css")), false);
  const files = workerFiles();
  assert.ok(files.includes(join(root, "src", "worker.js")));
  assert.equal(files.some((f) => f.includes(`${join("src", "web")}`)), false);
});

test("a run's workerd and node dumps fold into one row per worker/src file", () => {
  const dir = scratch();
  try {
    const tries = join(root, "src", "tries.js");
    const text = readFileSync(tries, "utf8");
    const guard = text.indexOf("if (!ip");
    const body = text.indexOf("const [head");
    const generated = `${text}\nexport const panel = "x";\n`;
    const map = {
      version: 3,
      sources: ["../../src/tries.js", "../../src/web/panel.js", "../../../elsewhere.js"],
      mappings: "AAAA;AACA;;;;;;;AAAA,ECAA,ACAA",
    };
    writeFileSync(
      join(dir, "worker-1.json"),
      JSON.stringify({
        kind: "workerd",
        loaded: true,
        scripts: [{ url: "bundle.js", source: generated, functions: [fn([0, generated.length, 0]), fn([guard, generated.length - 30, 0])], map, mapDir: join(root, ".wrangler", "tmp") }],
      }),
    );
    mkdirSync(join(dir, "node"));
    writeFileSync(
      join(dir, "node", "coverage-1.json"),
      JSON.stringify({
        result: [
          { url: pathToFileURL(tries).href, functions: [fn([0, text.length, 1], [body, text.length, 0])] },
          { url: "node:fs", functions: [fn([0, 10, 1])] },
          { url: pathToFileURL(join(root, "test", "run.mjs")).href, functions: [fn([0, 10, 1])] },
        ],
      }),
    );
    const files = collect(dir, { searchDir: dir });
    assert.deepEqual([...files.keys()], [tries]);
    const lines = files.get(tries);
    assert.equal(lines.get(1), true);
    assert.equal(lines.get(2), true);
    assert.equal(lines.get(3), false);
    const shown = report(dir);
    assert.match(shown, /^\| src\/tries\.js \| \d+\.\d\d% \| 8 \|$/m);
    assert.match(shown, /^\| src\/worker\.js \| 0\.00% \| \d+ \|$/m);
    assert.equal(shown.includes("web/"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty or missing dump folder reports every file at 0%", () => {
  const dir = scratch();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(collect(dir).size, 0);
  const shown = report(dir);
  for (const file of workerFiles()) assert.match(shown, new RegExp(`\\| src/${file.split(/[\\/]/).pop().replace(".", "\\.")} \\| 0\\.00% \\|`));
});

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mappedLines, mergeLines, offsetCounts, plainLines, rows, sourceMapOf, table } from "./coverage-lines.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const web = join(src, "web") + sep;

export function workerFiles(dir = src) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join(dir, entry.name))
    .sort();
}

export function ownsFile(file) {
  return file.startsWith(src + sep) && !file.startsWith(web) && file.endsWith(".js");
}

export function collect(dir, { searchDir = join(root, ".wrangler") } = {}) {
  const files = new Map();
  const add = (file, lines) => {
    if (ownsFile(file)) mergeLines(files, file, lines);
  };
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith(".json")) continue;
    const dump = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const script of dump.scripts || []) {
      const counts = offsetCounts(script.source, script.functions, { loaded: dump.loaded });
      const found = script.map ? { map: script.map, dir: script.mapDir } : sourceMapOf(script, searchDir);
      if (found) {
        for (const [file, lines] of mappedLines(script.source, counts, found.map, found.dir)) add(file, lines);
      } else if (script.url.startsWith("file:")) {
        add(fileURLToPath(script.url), plainLines(script.source, counts));
      }
    }
  }
  const node = join(dir, "node");
  for (const name of existsSync(node) ? readdirSync(node).sort() : []) {
    if (!name.endsWith(".json")) continue;
    const dump = JSON.parse(readFileSync(join(node, name), "utf8"));
    for (const entry of dump.result || []) {
      if (!entry.url.startsWith("file:")) continue;
      const file = fileURLToPath(entry.url);
      if (!ownsFile(file) || !existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      add(file, plainLines(source, offsetCounts(source, entry.functions)));
    }
  }
  return files;
}

export function report(dir) {
  const universe = workerFiles().map((file) => ({ name: `src/${file.slice(src.length + 1)}`, text: readFileSync(file, "utf8") }));
  return table(rows(collect(dir), root, universe));
}

async function main() {
  const dir = join(root, ".wrangler", "coverage");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "node"), { recursive: true });
  const child = spawn(process.execPath, [join(root, "test", "run.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, P99_COVERAGE: dir, NODE_V8_COVERAGE: join(dir, "node") },
  });
  const code = await new Promise((resolve) => child.once("exit", (status, signal) => resolve(signal ? 1 : status)));
  const text = report(dir);
  writeFileSync(join(dir, "table.md"), text + "\n");
  console.log(`\nWorker line coverage (worker/src, from the worker suite):\n\n${text}`);
  process.exitCode = code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

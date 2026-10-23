import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { v8Flags } from "./inspect.mjs";
import { keepLines, lcov, mappedLines, mergeLines, offsetCounts, plainLines, rows, sourceMapOf, table } from "./coverage-lines.mjs";

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

export function collect(dir, { searchDir = join(root, ".wrangler", "tmp") } = {}) {
  const files = new Map();
  const mapped = new Set();
  const add = (file, lines) => {
    if (ownsFile(file)) mergeLines(files, file, lines);
  };
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith(".json")) continue;
    const dump = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const script of dump.scripts || []) {
      const counts = offsetCounts(script.source, script.functions, { loaded: dump.loaded });
      if (script.startup) offsetCounts(script.source, script.startup).forEach((n, i) => (counts[i] = Math.max(counts[i], n)));
      const found = script.map ? { map: script.map, dir: script.mapDir } : sourceMapOf(script, searchDir);
      if (found) {
        for (const [file, lines] of mappedLines(script.source, counts, found.map, found.dir)) {
          mapped.add(file);
          add(file, lines);
        }
      } else if (script.url.startsWith("file:")) {
        add(fileURLToPath(script.url), plainLines(script.source, counts));
      } else if (script.sourceMapURL || /[#@]\s*sourceMappingURL=/.test(script.source || "")) {
        throw new Error(`coverage: no source map for ${script.url} in ${name}`);
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
      const lines = plainLines(source, offsetCounts(source, entry.functions));
      add(file, mapped.has(file) ? keepLines(lines, files.get(file)) : lines);
    }
  }
  return files;
}

export function problems(dir, files) {
  const dumps = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("worker-") && name.endsWith(".json")) : [];
  if (dumps.length === 0) return ["coverage: no Worker dump was saved; the inspector never answered or its save failed"];
  const main = files.get(join(src, "worker.js"));
  if (!main || ![...main.values()].some(Boolean)) return ["coverage: worker.js maps no covered line; the bundle's source map is not the Worker's"];
  return [];
}

export function report(dir, files = collect(dir)) {
  const universe = workerFiles().map((file) => ({ name: `src/${file.slice(src.length + 1)}`, text: readFileSync(file, "utf8") }));
  return table(rows(files, root, universe));
}

export function unitTests(dir = join(root, "test")) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join(dir, name));
}

function runNode(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env });
  return new Promise((resolve) => child.once("exit", (status, signal) => resolve(signal ? 1 : status)));
}

async function main() {
  const dir = join(root, ".wrangler", "coverage");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "node"), { recursive: true });
  const env = { ...process.env, P99_COVERAGE: dir, NODE_V8_COVERAGE: join(dir, "node"), MINIFLARE_WORKERD_V8_FLAGS: v8Flags(process.env) };
  const units = await runNode(["--test", ...unitTests()], env);
  const code = await runNode([join(root, "test", "run.mjs")], env);
  let files;
  try {
    files = collect(dir);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const text = report(dir, files);
  writeFileSync(join(dir, "table.md"), text + "\n");
  writeFileSync(join(dir, "lcov.info"), lcov(files));
  console.log(`\nWorker line coverage (worker/src, from the worker suite):\n\n${text}`);
  const found = problems(dir, files);
  for (const line of found) console.error(line);
  process.exitCode = found.length > 0 ? 1 : units || code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

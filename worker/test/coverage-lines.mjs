import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...B64].map((ch, i) => [ch, i]));

export function decodeMappings(mappings) {
  const lines = [];
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  for (const text of mappings.split(";")) {
    const line = [];
    let genCol = 0;
    for (const part of text.split(",")) {
      if (part === "") continue;
      const fields = [];
      let value = 0;
      let shift = 0;
      for (const ch of part) {
        const digit = DIGIT.get(ch);
        if (digit === undefined) throw new Error(`bad base64 VLQ digit ${JSON.stringify(ch)}`);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
      if (shift !== 0) throw new Error("a VLQ value ends mid-digit");
      genCol += fields[0];
      if (fields.length >= 4) {
        src += fields[1];
        origLine += fields[2];
        origCol += fields[3];
        line.push([genCol, src, origLine, origCol]);
      } else {
        line.push([genCol]);
      }
    }
    lines.push(line);
  }
  return lines;
}

export function offsetCounts(source, functions, { loaded = false } = {}) {
  const ranges = functions.flatMap((f) => f.ranges);
  const any = ranges.some((r) => r.count > 0);
  const counts = new Float64Array(source.length + 1);
  const sorted = ranges
    .map((r) => {
      const whole = r.startOffset === 0 && r.endOffset >= source.length;
      return { ...r, count: whole && (loaded || any) ? Math.max(r.count, 1) : r.count };
    })
    .sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
  for (const r of sorted) counts.fill(r.count, Math.max(0, r.startOffset), Math.min(source.length, r.endOffset));
  return counts;
}

export function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function plainLines(source, counts, from = 0, to = Infinity) {
  const hits = new Map();
  const starts = lineStarts(source);
  for (let n = from; n < Math.min(starts.length, to); n++) {
    const end = n + 1 < starts.length ? starts[n + 1] : source.length;
    let at = starts[n];
    while (at < end && /\s/.test(source[at])) at++;
    if (at >= end) continue;
    hits.set(n - from + 1, counts[at] > 0);
  }
  return hits;
}

export function mappedLines(source, counts, map, mapDir) {
  const files = new Map();
  const starts = lineStarts(source);
  const names = (map.sources || []).map((s) => resolveSource(s, map.sourceRoot || "", mapDir));
  decodeMappings(map.mappings).forEach((segments, g) => {
    if (g >= starts.length) return;
    for (const seg of segments) {
      if (seg.length < 4) continue;
      const file = names[seg[1]];
      if (!file) continue;
      const at = starts[g] + seg[0];
      if (!files.has(file)) files.set(file, new Map());
      const lines = files.get(file);
      const hit = counts[Math.min(at, source.length)] > 0;
      lines.set(seg[2] + 1, (lines.get(seg[2] + 1) || false) || hit);
    }
  });
  return files;
}

function resolveSource(name, root, mapDir) {
  if (name.startsWith("file://")) return fileURLToPath(name);
  if (/^[a-z]+:/i.test(name)) return null;
  const joined = root ? join(root, name) : name;
  return isAbsolute(joined) ? joined : resolve(mapDir || ".", joined);
}

export function mergeLines(into, file, lines) {
  if (!into.has(file)) into.set(file, new Map());
  const target = into.get(file);
  for (const [line, hit] of lines) target.set(line, (target.get(line) || false) || hit);
  return into;
}

export function keepLines(lines, known) {
  return new Map([...lines].filter(([line]) => known && known.has(line)));
}

export function sourceMapOf(script, searchDir) {
  const ref = script.sourceMapURL || /\/[/*][#@]\s*sourceMappingURL=(\S+?)\s*(?:\*\/)?\s*$/.exec(script.source || "")?.[1];
  if (!ref) return null;
  if (ref.startsWith("data:")) {
    const comma = ref.indexOf(",");
    const body = ref.slice(comma + 1);
    const text = /;base64/i.test(ref.slice(0, comma)) ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
    return { map: JSON.parse(text), dir: script.url?.startsWith("file:") ? dirname(fileURLToPath(script.url)) : searchDir };
  }
  const candidates = [];
  if (script.url?.startsWith("file:")) {
    const beside = new URL(ref, script.url);
    if (beside.protocol === "file:") candidates.push(fileURLToPath(beside));
  }
  if (isAbsolute(ref)) candidates.push(ref);
  const found = candidates.find((p) => existsSync(p)) || (searchDir ? newestNamed(searchDir, ref.split(/[\\/]/).pop()) : null);
  return found ? { map: JSON.parse(readFileSync(found, "utf8")), dir: dirname(found) } : null;
}

function newestNamed(dir, name) {
  let best = null;
  const walk = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === name) {
        const mtime = statSync(path).mtimeMs;
        if (!best || mtime > best.mtime) best = { path, mtime };
      }
    }
  };
  walk(dir);
  return best && best.path;
}

export function sourceLines(text) {
  return plainLines(text, new Float64Array(text.length + 1));
}

export function rows(files, root, universe = []) {
  const all = new Map();
  for (const [file, lines] of files) {
    const name = relative(root, file).split(sep).join("/");
    all.set(name, lines);
  }
  for (const { name, text } of universe) if (!all.has(name)) all.set(name, sourceLines(text));
  return [...all.entries()]
    .map(([name, lines]) => {
      const total = lines.size;
      let covered = 0;
      for (const hit of lines.values()) if (hit) covered++;
      return { file: name, covered, lines: total, pct: total === 0 ? 0 : (100 * covered) / total };
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function lcov(files) {
  return [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, lines]) => [`SF:${file}`, ...[...lines].sort(([a], [b]) => a - b).map(([line, hit]) => `DA:${line},${hit ? 1 : 0}`), "end_of_record"].join("\n"))
    .join("\n") + "\n";
}

export function table(list) {
  const covered = list.reduce((n, r) => n + r.covered, 0);
  const lines = list.reduce((n, r) => n + r.lines, 0);
  const pct = (n) => `${n.toFixed(2)}%`;
  return [
    "| File | Lines covered | Lines |",
    "|---|---|---|",
    ...list.map((r) => `| ${r.file} | ${pct(r.pct)} | ${r.lines} |`),
    `| **total** | **${pct(lines === 0 ? 0 : (100 * covered) / lines)}** | ${lines} |`,
  ].join("\n");
}

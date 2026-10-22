import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { cover } from "./coverage.mjs";

const dir = process.env.P99_BROWSER_COVERAGE;
let written = 0;

if (dir) {
  mkdirSync(dir, { recursive: true });
  cover(chromium, (entries) => {
    writeFileSync(join(dir, `${process.pid}-${written++}.json`), JSON.stringify(entries.map(({ url, source, functions }) => ({ url, source, functions }))));
  });
}

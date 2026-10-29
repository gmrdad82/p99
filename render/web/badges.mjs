import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = join(repo, "assets", "badges");
const sheets = join(repo, "tmp", "renders");
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const SIZE = 11;
const TRACK = 0.08;
const PAD = 9;
const FACE_H = 22;
const RADIUS = 4;
const LIGHT = 0.14;
const DARK = 0.9;
const HALO_X = 5;
const HALO_TOP = 3;
const HEIGHT = 35;

export const BADGES = [
  { state: "free", word: "Free", face: "#b4c2d1", ink: "#13202f" },
  { state: "studio", word: "Studio", face: "#2c66b8", ink: "#ffffff" },
  { state: "agency", word: "Agency", face: "#1d4785", ink: "#ffffff" },
  { state: "ff", word: "F&F", face: "#b8264d", ink: "#ffffff" },
];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const css = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const shade = (c, k) => css(hex(c).map((v) => v * k));

const tint = (c, k) => css(hex(c).map((v) => v + (255 - v) * k));

export function edge(face) {
  return shade(face, 0.72);
}

function svg(b, textWidth) {
  const w = Math.ceil(textWidth + PAD * 2);
  const full = w + HALO_X * 2;
  const label = b.word.toUpperCase().replace(/&/g, "&amp;");
  const word = b.word.replace(/&/g, "&amp;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${full}" height="${HEIGHT}" viewBox="${-HALO_X} ${-HALO_TOP} ${full} ${HEIGHT}">
<title>P99 ${word}</title>
<defs><filter id="sh" x="-20%" y="-30%" width="140%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#0c1a2b" flood-opacity="0.38"/></filter><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tint(b.face, LIGHT)}"/><stop offset="1" stop-color="${shade(b.face, DARK)}"/></linearGradient></defs>
<g filter="url(#sh)">
<rect x="0.5" y="1.5" width="${w - 1}" height="${FACE_H - 1}" rx="${RADIUS - 0.5}" fill="url(#g)" stroke="${edge(b.face)}"/>
<rect x="1.5" y="2.5" width="${w - 3}" height="1" rx="0.5" fill="#ffffff" fill-opacity="0.28"/>
<text class="word" x="${w / 2}" y="${1 + FACE_H / 2}" dy="0.36em" text-anchor="middle" textLength="${textWidth.toFixed(2)}" lengthAdjust="spacing" fill="${b.ink}" font-family='${FONT}' font-size="${SIZE}" font-weight="700">${label}</text>
</g>
</svg>
`;
}

function luminance([r, g, b]) {
  const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--font-render-hinting=none"] });
mkdirSync(out, { recursive: true });
mkdirSync(sheets, { recursive: true });
const report = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent("<!doctype html><canvas></canvas>");
  const files = {};
  for (const b of BADGES) {
    const label = b.word.toUpperCase();
    const width = await p.evaluate(({ word, font }) => {
      const c = document.querySelector("canvas").getContext("2d");
      c.font = font;
      return c.measureText(word).width;
    }, { word: label, font: `700 ${SIZE}px ${FONT}` });
    const text = svg(b, width + SIZE * TRACK * (label.length - 1));
    files[b.state] = text;
    writeFileSync(join(out, `${b.state}.svg`), text);
    report.push({ state: b.state, face: b.face, edge: edge(b.face), ink: b.ink, contrast: +contrast(hex(b.face), hex(b.ink)).toFixed(2) });
  }
  for (const scale of [1, 2]) {
    const c = await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: scale });
    const page = await c.newPage();
    for (const b of BADGES) {
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${files[b.state]}`);
      const el = await page.$("svg");
      await el.screenshot({ path: join(out, `${b.state}${scale === 2 ? "@2x" : ""}.png`), omitBackground: true });
    }
    await c.close();
  }
  for (const scheme of ["light", "dark"]) {
    const c = await browser.newContext({ viewport: { width: 760, height: 240 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await c.newPage();
    const ground = scheme === "light" ? "#c9d6e3" : "#1f2c3c";
    const label = scheme === "light" ? "#3d4f63" : "#a8bbd0";
    const row = (k) => BADGES.map((b) => `<figure><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[b.state])}" style="height:${k * HEIGHT}px"><figcaption>${b.state}</figcaption></figure>`).join("");
    await page.setContent(`<!doctype html><style>body{margin:0;padding:28px 32px;background:${ground};font:600 12px ${FONT};color:${label}}div{display:flex;gap:22px;align-items:flex-end;margin-bottom:22px}figure{margin:0;display:grid;justify-items:start;gap:6px}</style><div>${row(1)}</div><div>${row(2)}</div>`);
    await page.screenshot({ path: join(sheets, `badges-${scheme}.png`), fullPage: true });
    await c.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));

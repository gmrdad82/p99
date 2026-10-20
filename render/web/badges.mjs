import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = join(repo, "assets", "badges");
const sheets = join(repo, "tmp", "renders");
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const SIZE = 14;
const PAD = 11;
const FACE_H = 26;
const SLAB = 4;
const BLEED = { left: 5, top: 4, right: 16, bottom: 17 };

export const BADGES = [
  { state: "free", word: "Free", face: "#b4c2d1", ink: "#13202f" },
  { state: "studio", word: "Studio", face: "#2c66b8", ink: "#ffffff" },
  { state: "agency", word: "Agency", face: "#1d4785", ink: "#ffffff" },
  { state: "owner", word: "Owner", face: "#e0a32a", ink: "#241500" },
  { state: "ff", word: "F&F", face: "#196d43", ink: "#ffffff" },
];

export const FF_CANDIDATES = [
  { id: "a", name: "warm rose", face: "#b8264d", ink: "#ffffff" },
  { id: "b", name: "coral-red", face: "#b83530", ink: "#ffffff" },
  { id: "c", name: "soft pink-red", face: "#f08497", ink: "#3a0614" },
];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const css = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const shade = (c, k) => css(hex(c).map((v) => v * k));

export function slabs(face) {
  return [shade(face, 0.76), shade(face, 0.55)];
}

function svg(b, textWidth) {
  const w = Math.ceil(textWidth + PAD * 2);
  const [near, far] = slabs(b.face);
  const W = w + BLEED.left + BLEED.right;
  const H = FACE_H + BLEED.top + BLEED.bottom;
  const x = BLEED.left;
  const y = BLEED.top;
  const slab = [1, 2, 3].map((d) => `<rect x="${x + d}" y="${y + d}" width="${w}" height="${FACE_H}" rx="2" fill="${near}"/>`).join("");
  const word = b.word.replace(/&/g, "&amp;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>P99 ${word}</title>
<defs>
<filter id="drop" x="-20%" y="-30%" width="160%" height="200%"><feDropShadow dx="3" dy="4" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.28"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="22" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.3 0.18"/></filter>
<linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<clipPath id="face"><rect x="${x}" y="${y}" width="${w}" height="${FACE_H}" rx="2"/></clipPath>
</defs>
<g filter="url(#drop)">
<rect x="${x + 4}" y="${y + 4}" width="${w}" height="${FACE_H}" rx="2" fill="${far}"/>${slab}
<rect x="${x}" y="${y}" width="${w}" height="${FACE_H}" rx="2" fill="${b.face}"/>
</g>
<g clip-path="url(#face)">
<rect x="${x}" y="${y}" width="${w}" height="${FACE_H}" filter="url(#grain)"/>
<rect x="${x}" y="${y}" width="${w}" height="${FACE_H}" fill="url(#gloss)"/>
<path d="M${x + 0.5} ${y + FACE_H}V${y + 0.5}H${x + w}" fill="none" stroke="#ffffff" stroke-opacity="0.45"/>
<path d="M${x + 1} ${y + FACE_H - 1}H${x + w - 1}V${y + 1}" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="2"/>
</g>
<text class="word" x="${x + w / 2}" y="${y + FACE_H / 2}" dy="0.35em" text-anchor="middle" textLength="${textWidth.toFixed(2)}" lengthAdjust="spacingAndGlyphs" fill="${b.ink}" font-family='${FONT}' font-size="${SIZE}" font-style="italic" font-weight="800" letter-spacing="0.01em">${word}</text>
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

async function draw(browser, list) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent("<!doctype html><canvas></canvas>");
  const files = {};
  for (const b of list) {
    const width = await p.evaluate(({ word, font }) => {
      const c = document.querySelector("canvas").getContext("2d");
      c.font = font;
      return c.measureText(word).width;
    }, { word: b.word, font: `italic 800 ${SIZE}px ${FONT}` });
    files[b.state] = svg(b, width + SIZE * 0.01 * (b.word.length - 1));
  }
  await ctx.close();
  return files;
}

async function measure(page, b) {
  const faces = await page.evaluate(() => {
    const word = document.querySelector(".word");
    const r = word.getBBox();
    const box = { x: r.x, y: r.y, width: r.width, height: r.height };
    word.setAttribute("fill-opacity", "0");
    return { box, src: new XMLSerializer().serializeToString(document.querySelector("svg")) };
  });
  const px = await page.evaluate(async ({ box, src }) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
    await img.decode();
    const k = 2;
    const cv = document.createElement("canvas");
    cv.width = img.width * k;
    cv.height = img.height * k;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0, cv.width, cv.height);
    const d = g.getImageData(Math.floor(box.x * k), Math.floor(box.y * k), Math.ceil(box.width * k), Math.ceil(box.height * k)).data;
    const list = [];
    for (let i = 0; i < d.length; i += 4) list.push([d[i], d[i + 1], d[i + 2]]);
    return list;
  }, faces);
  const ink = hex(b.ink);
  const ratios = px.map((c) => contrast(c, ink)).sort((a, z) => a - z);
  return { state: b.state, face: b.face, ink: b.ink, slab: slabs(b.face), flat: +contrast(hex(b.face), ink).toFixed(2), worst: +ratios[0].toFixed(2), p5: +ratios[Math.floor(ratios.length * 0.05)].toFixed(2), median: +ratios[Math.floor(ratios.length / 2)].toFixed(2) };
}

async function shoot(browser, list, files, write) {
  const report = [];
  for (const scale of [1, 2]) {
    const c = await browser.newContext({ viewport: { width: 400, height: 200 }, deviceScaleFactor: scale });
    const page = await c.newPage();
    for (const b of list) {
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${files[b.state]}`);
      const el = await page.$("svg");
      if (write) await el.screenshot({ path: join(out, `${b.state}${scale === 2 ? "@2x" : ""}.png`), omitBackground: true });
      if (scale === 2) report.push(await measure(page, b));
    }
    await c.close();
  }
  return report;
}

async function sheet(browser, list, files, scheme, path, captions = {}) {
  const c = await browser.newContext({ viewport: { width: 760, height: 240 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await c.newPage();
  const ground = scheme === "light" ? "#c9d6e3" : "#1f2c3c";
  const label = scheme === "light" ? "#3d4f63" : "#a8bbd0";
  const row = (k, cap) => list.map((b) => `<figure><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[b.state])}" style="height:${k * (FACE_H + BLEED.top + BLEED.bottom)}px"><figcaption>${b.state}${cap && captions[b.state] ? `<small>${captions[b.state]}</small>` : ""}</figcaption></figure>`).join("");
  await page.setContent(`<!doctype html><style>body{margin:0;padding:28px 32px;background:${ground};font:600 12px ${FONT};color:${label};width:max-content}div{display:flex;gap:22px;align-items:flex-start;margin-bottom:22px}figure{margin:0;display:grid;justify-items:start;align-content:end;gap:6px}figcaption{display:grid;gap:2px}small{font:500 11px ${FONT};white-space:nowrap}</style><div>${row(1)}</div><div>${row(2, true)}</div>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path, fullPage: true });
  await c.close();
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--font-render-hinting=none"] });
mkdirSync(sheets, { recursive: true });
const report = [];
try {
  if (process.argv[2] === "candidates") {
    for (const f of FF_CANDIDATES) {
      const list = BADGES.map((b) => (b.state === "ff" ? { ...b, face: f.face, ink: f.ink } : b));
      const files = await draw(browser, list);
      const ff = (await shoot(browser, list.filter((b) => b.state === "ff"), files, false))[0];
      report.push({ id: f.id, name: f.name, ...ff });
      const captions = { ff: `${f.name} ${f.face} / ${f.ink} · ${ff.flat}:1 (worst ${ff.worst}:1)` };
      for (const scheme of ["light", "dark"]) await sheet(browser, list, files, scheme, join(sheets, `ff-candidate-${f.id}-${scheme}.png`), captions);
    }
  } else {
    mkdirSync(out, { recursive: true });
    const files = await draw(browser, BADGES);
    for (const b of BADGES) writeFileSync(join(out, `${b.state}.svg`), files[b.state]);
    report.push(...(await shoot(browser, BADGES, files, true)));
    for (const scheme of ["light", "dark"]) await sheet(browser, BADGES, files, scheme, join(sheets, `badges-${scheme}.png`));
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));

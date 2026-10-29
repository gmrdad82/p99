import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
export const GRACE = { email: "grace@example.com", name: "Grace Hopper", agent: false };
export const MARY = { email: "mary@example.com", name: "Mary Jackson", agent: false };

export const LANE_WORDS = ["new", "planned", "in-progress", "needs-you", "stuck", "landed", "done"];
export const LANE_NAMES = ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"];

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export const tag = () => randomUUID().slice(0, 6);

export function scratch(name) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", ".wrangler", "us-triage", `${name}-${tag()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cast(kit) {
  const named = (name) => kit.space.projects.find((p) => p.name === name);
  const shop = named("Shop");
  const blog = named("Blog");
  return { shop: shop.hosts[0], blog: blog.hosts[0], shopHosts: shop.hosts, blogHosts: blog.hosts, ops: "Ops" };
}

const crowds = new WeakMap();

export async function people(kit) {
  if (!crowds.has(kit)) {
    const where = cast(kit);
    const mints = await Promise.all([
      kit.mint("Ada Lovelace", "ada@example.com", where.shopHosts, true),
      kit.mint("Mary Jackson", "mary@example.com", where.shopHosts, true),
      kit.mint("Grace Hopper", "grace@example.com", where.shopHosts, false),
    ]);
    crowds.set(kit, { ada: mints[0].secret, mary: mints[1].secret, grace: mints[2].secret });
  }
  return crowds.get(kit);
}

export async function report(kit, host, title, extra = {}) {
  const made = await kit.call("POST", `/_p99/v1/issues?host=${host}`, { actor: GRACE, body: kit.issueBody({ title, ...extra }) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
}

export async function threadOf(kit, key, host) {
  const got = await kit.call("GET", `/_p99/v1/issues/${key}${host ? `?host=${host}` : ""}`, { actor: ADA });
  assert.equal(got.status, 200, JSON.stringify(got.json));
  return got.json;
}

export async function ok(kit, args, options) {
  const out = await kit.p99(args, options);
  assert.equal(out.code, 0, `p99 ${args.join(" ")}\nstdout: ${out.stdout}\nstderr: ${out.stderr}`);
  return out;
}

export async function card(kit, project, title, extra = []) {
  const out = await ok(kit, ["card", "new", "--project", project, "--title", title, "--json", ...extra]);
  const made = JSON.parse(out.stdout);
  return made.card ?? made;
}

export async function mailTo(kit, email, includes) {
  return kit.until(`a mail to ${email} holding ${includes}`, async () => {
    const mails = await kit.mail.inbox(email);
    return mails.find((m) => `${m.subject ?? ""}\n${m.text ?? ""}\n${m.html ?? ""}`.includes(includes));
  });
}

export async function mailed(kit, email, includes) {
  const mails = await kit.mail.inbox(email);
  return mails.some((m) => `${m.subject ?? ""}\n${m.text ?? ""}\n${m.html ?? ""}`.includes(includes));
}

export function hasKey(screen, key) {
  return screen.split("\n").some((line) => {
    let at = line.indexOf(key);
    while (at >= 0) {
      const next = line[at + key.length];
      if (next === undefined || !/[0-9]/.test(next)) return true;
      at = line.indexOf(key, at + 1);
    }
    return false;
  });
}

export function header(screen) {
  return screen.split("\n").find((line) => line.includes(" P99 ")) ?? "";
}

export function waitingCount(screen) {
  const found = /(\d+) waiting/.exec(header(screen));
  return found ? Number(found[1]) : 0;
}

export function pickerOptions(screen, title) {
  const lines = screen.split("\n").map((line) => Array.from(line));
  const top = lines.findIndex((chars) => chars.join("").includes(`╭ ${title} `));
  if (top < 0) return null;
  const left = lines[top].indexOf("╭");
  const right = lines[top].lastIndexOf("╮");
  const options = [];
  for (let at = top + 1; at < lines.length; at++) {
    if (lines[at].join("").includes("╰")) break;
    const inner = lines[at].slice(left + 1, right).join("").replace(/^[▌\s]+/, "").trim();
    if (inner !== "") options.push(inner);
  }
  return options;
}

export function picking(letter, at, ...after) {
  return [letter, ...Array(at).fill("down"), "enter", ...after].join(" ");
}

export function laneRule(screen) {
  const lines = screen.split("\n");
  const at = lines.findIndex((line) => /─{4,}\s+─{4,}/.test(line) && !line.includes("╭"));
  return at < 0 ? [] : lines[at].trim().split(/\s+/);
}

export async function openPanel(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      const b = document.querySelector("p99-root")?.shadowRoot?.querySelector(".w .b:not(.f)");
      return b && !b.hidden;
    },
    null,
    { timeout: 20000 },
  );
  await page.locator("p99-root .w .b:not(.f)").click();
  await page.waitForFunction(() => document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 20000 });
}

export async function openBoard(page) {
  await page.locator("p99-root .p99-board-open").click();
  await page.waitForFunction(
    () => {
      const r = document.querySelector("p99-root").shadowRoot;
      return r.querySelector(".p99-board.is-open") && (r.querySelector(".p99-col[data-label]") || r.querySelector(".p99-board-state"));
    },
    null,
    { timeout: 20000 },
  );
}

export const shown = (page) =>
  page.evaluate(() => {
    const r = document.querySelector("p99-root").shadowRoot;
    return {
      lanes: Array.from(r.querySelectorAll(".p99-col[data-label]"), (c) => c.dataset.word),
      byLane: Object.fromEntries(Array.from(r.querySelectorAll(".p99-col[data-label]"), (c) => [c.dataset.word, Array.from(c.querySelectorAll(".p99-card"), (e) => e.dataset.id)])),
    };
  });

export async function closePage(page) {
  try {
    await page.context().close();
  } catch {}
}

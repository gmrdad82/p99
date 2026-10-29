const V = "__P99_VERSION__";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 30;
const THUMB = 640;
const MAX_MARKS = 10;
const SLOW_MS = 4000;
const GIVE_UP_MS = 20000;
const BUSY_S = [1, 2, 4, 8];
const BUSY_EVERY_S = 30;
const BUSY_GIVE_UP_MS = 10000;
const DISCORD = "https://discord.gg/XsNcn3kYzn";
const PITOMD = "https://pitomd.com";
const BADGES = { free: "Free", studio: "Studio", agency: "Agency", ff: "F&F" };
const KINDS = ["bug", "feature", "improvement", "question", "task"];
const STATUSES = ["inbox", "doing", "review", "done"];
const ROBOT = "🤖";
const PICK_KEY = "p99:pick";
const VIEWS = ["project", "projects", "needs", "landed"];
const CARD_VIEWS = ["projects", "needs", "landed"];
const WAITING = ["needs-you", "stuck", "landed"];
const LANE_NAMES = ["new", "planned", "in progress", "needs you", "stuck", "landed", "done"];
const SOURCES = ["", "human", "agent"];
const MAX_PICKED = 50;
const LEGACY = { received: "inbox", fixed: "done:fixed", dropped: "done:abandoned", new: "inbox", confirmed: "doing", in_progress: "doing", waiting: "review", resolved: "done:fixed", abandoned: "done:abandoned", duplicate: "done:duplicate" };
const OOXML = "application/vnd.openxmlformats-officedocument.";
const ODF = "application/vnd.oasis.opendocument.";
const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
  txt: "text/plain", log: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip",
  docx: OOXML + "wordprocessingml.document", xlsx: OOXML + "spreadsheetml.sheet", pptx: OOXML + "presentationml.presentation",
  odt: ODF + "text", ods: ODF + "spreadsheet", odp: ODF + "presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint"
};
const ACCEPTED = new Set(Object.values(TYPES).concat(["text/x-log", "application/x-zip-compressed"]));
const WORDS = {
  board: "Board",
  close: "Close",
  loading: "Loading…",
  gone: "This P99 link isn't valid here. Ask for a new one.",
  signing_in: "Signing you in",
  busy: "P99 is busy, trying again in {n}s",
  verify_title: "Confirm it's you",
  verify_help: "Enter the 6-digit code your authenticator app shows for P99. This browser is remembered after that.",
  verify_label: "Code",
  verify_send: "Confirm",
  failed: "Couldn't send; try again.",
  load_failed: "Couldn't load; try again.",
  slow: "This is taking longer than usual.",
  offline: "You're offline; try again when you're back.",
  retry: "Retry",
  remove: "Remove",
  preview: "Preview",
  kind_bug: "Bug",
  kind_feature: "Idea",
  kind_improvement: "Improvement",
  kind_question: "Question",
  kind_task: "Task",
  status_inbox: "Received",
  status_doing: "In progress",
  status_review: "In review",
  status_fixed: "Fixed",
  status_abandoned: "Dropped",
  status_duplicate: "Duplicate",
  only_branch: "The fix is written but isn't in a build yet.",
  list_title: "Cards",
  view_label: "Show",
  view_project: "This project",
  view_projects: "Projects",
  view_needs: "Needs you",
  view_landed: "Landed, waiting for your check",
  source_label: "Last change by",
  source_all: "Everyone",
  source_human: "People",
  source_agent: "Agents",
  projects_none: "No projects yet.",
  cards_empty: "No cards here.",
  needs_empty: "Nothing needs you.",
  agent: "Agent",
  tab_page: "This page",
  tab_mine: "Mine",
  tab_all: "All",
  group_here: "On this page",
  group_rest: "Everything else",
  filter_status: "Status",
  filter_kind: "Kind",
  filter_search: "Search",
  filter_search_hint: "Key, title or text",
  filter_open: "Open",
  filter_closed: "Closed",
  filter_any: "Any",
  filter_every_kind: "Any kind",
  list_empty: "Nothing here.",
  list_empty_filtered: "Nothing matches these filters.",
  list_no_match: "No cards match “{q}”.",
  unread_mark: "New for you",
  comments: { one: "1 comment", other: "{count} comments" },
  more: "More",
  new_title: "What happened?",
  new_card: "New card",
  new_project: "Project",
  project_needed: "Pick a project.",
  new_kind: "Kind",
  new_title_label: "Title",
  new_title_hint: "In a few words, what's wrong or what you need",
  new_body_label: "Details",
  new_body_hint: "What you did, what you expected and what you saw",
  new_capture: "Screen capture",
  new_mark: "Mark an area",
  attach_screen: "Attach the screen",
  attach_page: "Attach the whole page",
  attach_regions: "Attach the marked areas",
  mask_areas: "Hide this site's private areas",
  new_files: "Files",
  new_files_hint: "Add files: pick them, drop them here or paste them",
  no_capture: "This site doesn't send screenshots, so your card goes without one.",
  new_privacy_text: "The page's address, your browser, your screen and the page's last script errors go with it, so we see what happened.",
  new_privacy: "The capture, the page's address, your browser, your screen and the page's last script errors go with it, so we see what you saw. Passwords and the fields this site marks as private are blanked.",
  new_privacy_shown: "The capture, the page's address, your browser, your screen and the page's last script errors go with it, so we see what you saw. Passwords are blanked; you chose to show this site's private areas.",
  send: "Send",
  cancel: "Cancel",
  back: "Back to the list",
  filed_by: "Filed by {who}, {when}",
  updated: "changed {when}",
  assigned_to: "assigned to {who}",
  duplicate_of: "merged into {n}",
  github_issue: "GitHub issue #{n}",
  github_pull: "GitHub pull request #{n}",
  show_marks: "Show on the page",
  shot_screenshot: "Screen",
  shot_page: "Whole page",
  shot_region: "Area {n}",
  internal: "internal note",
  comment_label: "Reply",
  comment_hint: "Write a comment",
  comment_files: "Files",
  comment_send: "Send reply",
  internal_note: "Internal note (only Owners see it)",
  manage: "Manage",
  assignee: "Assignee",
  nobody: "Unassigned",
  duplicate_label: "Duplicate of",
  duplicate_hint: "Key or words",
  not_duplicate: "Not a duplicate",
  no_match: "Nothing matches",
  save: "Save",
  saved: "Saved.",
  abandon: "Drop it",
  reopen: "Reopen",
  edit: "Edit what you wrote",
  edit_any: "Edit the title and details",
  delete: "Delete {key}",
  delete_warn: "Its comments, files and history go with it, and this can't be undone.",
  delete_type: "Type {key} to confirm",
  delete_go: "Hold to delete {key}",
  delete_hold: "Keep holding until the button fills.",
  event_system: "P99",
  event_created: "opened the card",
  event_status: "changed the status: {from} → {to}",
  event_kind: "changed the kind: {from} → {to}",
  event_assignee: "assigned it to {to}",
  event_unassigned: "left it unassigned",
  event_title: "changed the title: {to}",
  event_body: "changed the details",
  event_landed: "the fix reached {env}",
  event_merge: "merged {item} into this",
  event_mail: "e-mail sent to {to}",
  event_mail_failed: "the e-mail to {to} didn't go out",
  event_labels: "changed the labels: {list}",
  event_link: "linked {ref}",
  links: "Links",
  link_label: "Link",
  link_hint: "A request, commit, tag or URL",
  link_add: "Add",
  move_to: "Move to",
  move_drop: "Drop (close without fixing)",
  moved: "this card moved; refreshed",
  event_label: "moved it: {from} → {to}",
  capturing: "Capturing the screen…",
  capturing_page: "Capturing the whole page…",
  capture_failed: "The capture failed; you can send without it.",
  capture_slow: "The page took too long to capture; you can send without it.",
  capture_mask: "This browser can't read the areas this site keeps private, so no screenshot was taken; you can send without one.",
  capture_unknown: "This site's capture settings didn't load, so no screenshot was taken; you can send without one.",
  capture_blocked: "This site's security settings block the screenshot, so your card goes without one.",
  marking: "Drag a box over the area. Esc stops.",
  mark_hint: "Drag a box over the area; you can mark several.",
  mark_n: "Area {n}",
  mark_done: "Done",
  mark_cancel: "Cancel",
  too_many_marks: "You can mark up to 10 areas.",
  too_big: "“{name}” is over 20 MB.",
  too_many_files: "A card holds up to 30 files.",
  file_type: "P99 takes images, PDFs, text, CSV, JSON, zip and office files.",
  title_needed: "Add a title.",
  too_long: "That's over {n} characters; shorten it to send.",
  sending: "Sending…",
  uploading: "Uploading {name}… {pct}%",
  upload_failed: "“{name}” didn't upload; try again.",
  upload_refused: "“{name}” didn't upload: {why}.",
  filed: "Sent as {key}. Replies show up here.",
  sent_partial: "{key} was sent, but some files didn't upload; you can add them again from the card."
};

let o = null;
let me = null;
const S = { open: false, view: null, key: null, list: null, draft: null, marking: null, outlines: null, assets: null, files: new Map(), seq: 0 };
let root, panel, scroller, scrim;

const phone = matchMedia("(max-width: 599px)");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const dark = matchMedia("(prefers-color-scheme: dark)");

export function open(opts) {
  const v = opts.view;
  if (typeof v === "number" && v && v !== 401 && v !== 403 && v !== 428 && (!busyView(v) || S.open || opts.me || me)) return Promise.resolve();
  if (opts.space && opts.root !== root) {
    S.assets = null;
    S.list = null;
    S.open = false;
    S.view = null;
    me = null;
  }
  o = opts;
  o.host = o.root.host;
  o.bar = o.root.firstChild;
  if (opts.me) me = opts.me;
  if (v === 401 || v === 403) return Promise.resolve(gone());
  const ready = ensure();
  if (opts.view === "list" && S.open && S.view === "list" && !opts.space) return close();
  return ready.then(() => {
    show();
    const go = () => {
      if (busyView(v)) { if (!S.view) busy(); }
      else if (opts.key) item(opts.key);
      else if (opts.view === "list") list(S.list || defaultList());
      else if (opts.view === "card") cardFlow();
      else fileFlow();
    };
    if (S.verify) verify(go);
    else go();
  }).catch((e) => { if (opts.space) throw e; });
}

export function shut() {
  if (S.open) close(true);
}

function say(key, args, n) {
  const words = (me && me.strings) || {};
  let v = key in words ? words[key] : WORDS[key];
  if (v && typeof v === "object") v = n === 1 ? v.one : v.other;
  if (typeof v !== "string") return key;
  return v.replace(/\{([a-z0-9_]+)\}/g, (m, k) => (args && k in args ? String(args[k]) : m));
}

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
  }
  add(e, kids);
  return e;
}
function add(e, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(e, k);
    else e.append(k);
  }
}
function clear(e) { while (e.firstChild) e.firstChild.remove(); }
function enc(s) { return encodeURIComponent(s); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const x = Array.from(b, (n) => (n + 256).toString(16).slice(1)).join("");
  return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
}
function size(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return Math.round(b / 1024) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
function when(t) {
  if (!t) return "";
  const n = Date.parse(t);
  if (!isFinite(n)) return String(t);
  return new Date(n).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function stamp(t) {
  const n = Date.parse(t);
  return isFinite(n) ? n : 0;
}
function fileType(f, name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return (m && TYPES[m[1].toLowerCase()]) || (ACCEPTED.has(f.type) ? f.type : "");
}
function nameOf(p) {
  if (!p) return say("event_system");
  return typeof p === "string" ? p : p.name || p.email || say("event_system");
}
function isAgent(p, agent) {
  return agent === true || (Boolean(p) && typeof p === "object" && p.agent === true);
}
function viaOf(p, via) {
  const v = typeof via === "string" ? via : p && typeof p === "object" && typeof p.via === "string" ? p.via : "";
  return v.trim();
}
function who(p, agent) {
  if (!isAgent(p, agent)) return nameOf(p);
  const label = viaOf(p);
  return nameOf(p) + " " + ROBOT + (label ? " (" + label + ")" : "");
}
function person(p, agent, via) {
  if (!isAgent(p, agent)) return [nameOf(p)];
  const label = viaOf(p, via);
  return [nameOf(p), " ", h("span", { class: "p99-ai", title: label ? say("agent") + " · " + label : say("agent"), text: ROBOT }), label ? h("small", { class: "p99-via", text: label }) : null];
}

function api(path) {
  return "/_p99/api" + path + (o.space ? (path.includes("?") ? "&" : "?") + "host=" + enc(o.space) : "");
}
function auth() {
  return o.space ? { "X-P99-App": "1" } : { "X-P99-Code": o.code };
}
function call(method, path, body, type, signal) {
  const headers = Object.assign(auth(), { Accept: "application/json" });
  if (body != null) headers["Content-Type"] = type || "application/json";
  return fetch(api(path), { method, headers, body, credentials: "same-origin", signal }).then((r) =>
    r.text().then((t) => {
      let data = null;
      try { data = t ? JSON.parse(t) : null; } catch (x) {}
      if (r.status === 401) {
        close(true);
        gone();
      }
      if (r.status === 428 && !S.verify) {
        S.verify = true;
        if (scroller) verify(fileFlow);
      }
      if (!r.ok) {
        const e = new Error((data && data.message) || say("failed"));
        e.status = r.status;
        throw e;
      }
      return data;
    })
  );
}
function retrying(fn) {
  let attempt = 0;
  const go = () =>
    fn().catch((e) => {
      if (!transient(e) || attempt >= 3) throw e;
      attempt++;
      return wait(600 * Math.pow(2, attempt - 1)).then(go);
    });
  return go();
}
function daily(e) { return !!e && e.status === 429 && /^today's limit\b/.test(e.message || ""); }
function transient(e) { return !e || !e.status || e.status >= 500 || e.status === 408 || (e.status === 429 && !daily(e)); }
function problem(e) { return !navigator.onLine ? say("offline") : (e && e.status && e.message) || say("failed"); }
function loadProblem(e) { return e && e.status ? problem(e) : navigator.onLine ? say("load_failed") : say("offline"); }

function blobOf(id) {
  if (!S.files.has(id)) {
    const p = fetch(api("/files/" + enc(id)), { headers: auth() }).then((r) => {
      if (!r.ok) throw new Error(say("failed"));
      return r.blob();
    });
    p.catch(() => S.files.delete(id));
    S.files.set(id, p);
  }
  return S.files.get(id);
}
function picture(label) { return h("canvas", { role: "img", "aria-label": label, width: 1, height: 1 }); }
function thumb(a) {
  const c = picture(a.name || say("preview"));
  blobOf(a.id).then((b) => createImageBitmap(b)).then((bmp) => {
    const k = Math.min(1, THUMB / bmp.width);
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
  }, () => {});
  return c;
}
function download(a) {
  return (e) => {
    e.preventDefault();
    blobOf(a.id).then((b) => {
      const u = URL.createObjectURL(b);
      const link = h("a", { href: u, download: a.name || "file" });
      root.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }, () => {});
  };
}

function ensure() {
  if (S.assets) return me || o.space || busyView(o.view) ? S.assets : S.assets.then(reask);
  root = o.root;
  const css = fetch("/_p99/p99.css?v=" + V).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const self = me || busyView(o.view) ? Promise.resolve(me) : call("GET", "/me?path=" + enc(location.pathname)).catch(() => null);
  S.assets = Promise.all([css, self]).then(([text, m]) => {
    if (m) me = m;
    const base = new CSSStyleSheet();
    base.replaceSync(text);
    const tint = new CSSStyleSheet();
    S.tint = tint;
    try { tint.replaceSync(theme(me && me.theme)); } catch (x) {}
    chrome();
    root.adoptedStyleSheets = root.adoptedStyleSheets.concat([base, tint]);
    legible();
  });
  S.assets.catch(() => { S.assets = null; });
  return S.assets;
}
function reask() {
  if (me) return me;
  return call("GET", "/me?path=" + enc(location.pathname), null, null, AbortSignal.timeout(BUSY_GIVE_UP_MS)).then(adopt, (e) => {
    if (!e || (e.status !== 401 && e.status !== 403)) return;
    if (e.status === 403) {
      close(true);
      gone();
    }
    throw e;
  });
}
function paint(k, v) {
  return k !== "accent" && /^\s*(#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color(-mix)?\()/i.test(String(v));
}
function theme(t) {
  if (!t || typeof t !== "object") return "";
  const rules = (obj, keep) => {
    let out = "";
    for (const k in obj) {
      const v = obj[k];
      if (typeof v !== "string" && typeof v !== "number") continue;
      if (!/^[a-z0-9-]{1,40}$/.test(k) || /[;{}<>\\]/.test(String(v))) continue;
      if (keep && !keep(k, v)) continue;
      out += "--p99-" + k + ":" + v + ";";
    }
    return out;
  };
  let css = ":host{" + rules(t, (k, v) => !paint(k, v)) + "}";
  const light = rules(t, paint);
  if (light) css += "@media not all and (prefers-color-scheme: dark){:host{" + light + "}}";
  if (t.dark && typeof t.dark === "object") css += "@media (prefers-color-scheme: dark){:host{" + rules(t.dark) + "}}";
  return css;
}

function chrome() {
  scrim = h("div", { class: "p99-scrim", hidden: true, onclick: () => close() });
  scroller = h("div", { class: "p99-scroll" });
  const x = h("button", { type: "button", class: "p99-x", "aria-label": say("close"), title: say("close"), onclick: () => close() }, h("span", { "aria-hidden": "true", text: "×" }));
  const grip = h("div", { class: "p99-grip", "aria-hidden": "true" });
  const head = h("div", { class: "p99-head" }, grip, brand(), boardOpen(), x);
  panel = h("div", { class: "p99-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "p99-title", tabindex: "-1", hidden: true }, head, scroller, foot());
  root.append(scrim, panel);
  swipe(head);
  root.addEventListener("keydown", keys);
  phone.addEventListener("change", () => { if (S.open) scrim.hidden = !phone.matches; });
  dark.addEventListener("change", legible);
}
function brand() {
  const plain = !o.space && !!me && me.licensed === true;
  const by = plain || (me && me.link === false) ? null : h("a", { class: "p99-by", href: PITOMD, target: "_blank", rel: "noopener noreferrer", text: "by PITO.MD" });
  const lockup = plain ? null : h("img", { class: "p99-lockup", src: "/_p99/art/lockup-dark.svg?v=" + V, alt: "P99, issue and feedback reporter", width: 1371, height: 243 });
  const state = me && Object.hasOwn(BADGES, me.license) ? me.license : "free";
  const badge = me ? h("img", { class: "p99-badge", src: "/_p99/badges/" + state + ".svg?v=" + V, alt: BADGES[state] + " licence", height: 35 }) : null;
  const tags = badge || by ? h("div", { class: "p99-tags" }, badge, by) : null;
  return h("div", { class: "p99-brand" }, lockup, o.space ? h("span", { class: "p99-logo-name", text: o.title || o.space }) : null, tags);
}
function boardOpen() {
  return owner() ? h("button", { type: "button", class: "p99-board-open", text: say("board"), onclick: openBoard, onpointerenter: boardModule, onfocus: boardModule }) : null;
}
function foot() {
  return owner() ? h("p", { class: "p99-foot" }, "P99: got questions or doubts? ", h("a", { href: DISCORD, target: "_blank", rel: "noopener noreferrer", text: "Ping me on Discord" }), ".") : null;
}
function rehead() {
  panel.querySelector(".p99-brand").replaceWith(brand());
  const board = boardOpen();
  if (board && !panel.querySelector(".p99-board-open")) panel.querySelector(".p99-x").before(board);
  const f = foot();
  if (f && !panel.querySelector(".p99-foot")) panel.append(f);
}
function boardModule() {
  if (!S.board) S.board = import("/_p99/board.js?v=" + V).catch((e) => { S.board = null; throw e; });
  return S.board;
}
function openBoard() {
  if (o.space) return close();
  close(true);
  const resume = o.closed ? () => open(Object.assign({}, o, { view: "list", key: null })) : null;
  const p = picked();
  Promise.all([boardModule(), home()]).then(([m]) => m.open({ root, call, me, h, blob, host: o.space, query: () => boardQuery(picked()), keep: carded(p) ? (c) => !!c.project : null, pickWord: pickWord(), closed: resume, item: (key, from) => open(Object.assign({}, o, { view: "item", key, from })), add: (from) => open(Object.assign({}, o, { view: "card", key: null, from })) }), () => {});
}
function home() {
  if (o.space) return Promise.resolve(null);
  if (!S.home) {
    const said = me && typeof me.project === "string" && me.project ? Promise.resolve(me.project) : call("GET", "/space").then((r) => {
      const at = siteHost().toLowerCase();
      const p = ((r && r.projects) || []).find((x) => x && Array.isArray(x.hosts) && x.hosts.some((n) => String(n).toLowerCase() === at));
      return p && typeof p.name === "string" ? p.name : null;
    });
    S.home = said.then((n) => (S.homeName = n), () => (S.homeName = null));
  }
  return S.home;
}
function blob(path) {
  return fetch(api(path), { headers: auth(), credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : null));
}
function pickWord() {
  const p = picked();
  const words = [];
  if (p.view !== "project") words.push(p.view === "projects" && p.projects.length ? p.projects.join(", ") : say("view_" + p.view));
  if (p.source) words.push(say("source_" + p.source));
  return words.join(" · ");
}
function keys(e) {
  if (e.key === "Escape") {
    if (S.marking) return;
    if (S.outlines) {
      clearOutlines();
      e.preventDefault();
      return;
    }
    if (S.open) {
      e.preventDefault();
      close();
    }
    return;
  }
  if (e.key !== "Tab" || !S.open) return;
  const list = Array.from(panel.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter((n) => n.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1], at = root.activeElement;
  if (e.shiftKey && at === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}
function swipe(grip) {
  let from = null, dy = 0, t0 = 0;
  grip.addEventListener("pointerdown", (e) => {
    if (!phone.matches || e.target.closest("button, a")) return;
    from = e.clientY;
    dy = 0;
    t0 = performance.now();
    grip.setPointerCapture(e.pointerId);
    panel.classList.add("is-dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (from === null) return;
    dy = Math.max(0, e.clientY - from);
    panel.style.transform = "translateY(" + dy + "px)";
  });
  const end = () => {
    if (from === null) return;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    from = null;
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    if (dy > 90 || (fast && dy > 30)) close();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}
function gone() {
  if (o.gone) return o.gone();
  try { delete localStorage["p99:code"]; } catch (x) {}
  const bar = o.bar;
  if (!bar || bar.querySelector(".p99-gone")) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(".p99-gone{display:flex;align-items:center;gap:4px;max-width:min(340px,calc(100vw - 32px));margin:0;padding:6px 4px 6px 12px;border-radius:12px;background:#0c1a2b;color:#fff;font:500 13px/1.35 system-ui;box-shadow:0 4px 14px #0005;animation:p99-gone .3s cubic-bezier(.2,.7,.2,1)}.p99-gone button{all:unset;flex:none;cursor:pointer;width:38px;height:38px;border:1px solid #fff6;border-radius:50%;text-align:center;font:500 22px/38px system-ui}.p99-gone button:focus-visible{outline:2px solid #fff}@keyframes p99-gone{from{opacity:0;transform:translateY(8px)}}@media (prefers-reduced-motion:reduce){.p99-gone{animation:none}}");
  o.root.adoptedStyleSheets = o.root.adoptedStyleSheets.concat([sheet]);
  for (const b of bar.querySelectorAll("button")) b.hidden = true;
  bar.append(h("p", { class: "p99-gone", role: "alert" }, h("span", { text: say("gone") }), h("button", { type: "button", "aria-label": say("close"), title: say("close"), text: "×", onclick: () => o.forget() })));
}
function show() {
  if (S.open) return;
  S.open = true;
  panel.hidden = false;
  scrim.hidden = !phone.matches;
  void panel.offsetWidth;
  panel.classList.add("is-open");
  scrim.classList.add("is-open");
}
function close(quiet) {
  if (!S.open) return;
  if (S.marking) S.marking.finish(false);
  S.open = false;
  panel.classList.remove("is-open");
  scrim.classList.remove("is-open");
  const done = () => {
    if (S.open) return;
    panel.hidden = true;
    scrim.hidden = true;
    clear(scroller);
    S.view = null;
  };
  if (still.matches) done();
  else setTimeout(done, 300);
  if (S.draft) S.draft.dispose();
  S.draft = null;
  if (/^#p99=/.test(location.hash)) history.replaceState(history.state, "", location.pathname + location.search);
  const back = (o.from && o.from.isConnected && o.from) || (o.bar && o.bar.querySelector("button"));
  if (back && panel.contains(root.activeElement)) back.focus();
  if (!quiet && o.closed) o.closed();
}
function skeleton() {
  const box = h("div", { class: "p99-skeleton", "aria-busy": "true" }, h("h2", { class: "p99-sr", id: "p99-title", text: say("loading") }));
  for (let i = 0; i < 5; i++) box.append(h("div", { class: "p99-shimmer" }));
  return box;
}
function rowsSkeleton() {
  const box = h("div", { class: "p99-skeleton p99-rows-wait" }, h("p", { class: "p99-sr", text: say("loading") }));
  for (let i = 0; i < 4; i++) box.append(h("div", { class: "p99-shimmer" }));
  return box;
}
function asking() {
  if (S.ask) S.ask.abort();
  return (S.ask = new AbortController());
}
function patience(seq, box, ask, retry) {
  const slow = setTimeout(() => {
    if (seq !== S.seq || !box.isConnected) return;
    box.append(h("p", { class: "p99-slow", role: "status" }, h("span", { text: say("slow") }), " ", h("button", { type: "button", class: "p99-retry", text: say("retry"), onclick: retry })));
  }, SLOW_MS);
  const cap = setTimeout(() => ask.abort(), GIVE_UP_MS);
  return () => {
    clearTimeout(slow);
    clearTimeout(cap);
    if (S.ask === ask) S.ask = null;
  };
}
function verify(next) {
  const input = h("input", { name: "totp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", required: true, "aria-describedby": "p99-verify-help" });
  const note = h("p", { class: "p99-error", role: "alert", hidden: true });
  const send = h("button", { type: "submit", text: say("verify_send") });
  const form = h("form", { class: "p99-view p99-verify", "data-view": "verify", novalidate: true },
    h("h2", { id: "p99-title", text: say("verify_title") }),
    h("p", { id: "p99-verify-help", class: "p99-note", text: say("verify_help") }),
    h("label", { class: "p99-field" }, h("span", { text: say("verify_label") }), input),
    note,
    h("div", { class: "p99-actions" }, h("button", { type: "button", text: say("cancel"), onclick: () => close() }), send));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send.disabled = true;
    note.hidden = true;
    call("POST", "/verify", JSON.stringify({ totp: input.value }))
      .then((d) => {
        o.code = o.code.split(".")[0] + "." + d.device;
        try { localStorage.setItem("p99:code", o.code); } catch (x) {}
        S.verify = false;
        return call("GET", "/me?path=" + enc(location.pathname)).then(adopt, () => { if (o.refresh) o.refresh(0, o.code); });
      })
      .then(() => { if (!S.verify) next(); })
      .catch((err) => {
        note.textContent = problem(err);
        note.hidden = false;
        send.disabled = false;
        input.select();
      });
  });
  mount(form, input);
}
function busyView(v) { return v === 429 || (typeof v === "number" && v >= 500); }
function busyDelay(n) { return n < BUSY_S.length ? BUSY_S[n] : BUSY_EVERY_S; }
function busy() {
  let n = 0;
  let left = busyDelay(0);
  const line = h("p", { class: "p99-status-line p99-busy-line", "aria-hidden": "true" });
  const heard = h("p", { class: "p99-sr p99-busy-heard", role: "status", "aria-live": "polite" });
  const title = h("h2", { id: "p99-title", text: say("signing_in") });
  const view = h("section", { class: "p99-view p99-busy", "data-view": "busy", "aria-busy": "true" }, title, line, heard);
  const live = () => view.isConnected && S.open;
  const word = () => (navigator.onLine ? say("busy", { n: left }) : say("offline"));
  const draw = () => { line.textContent = word(); };
  const tell = () => { heard.textContent = word(); };
  const wake = () => {
    if (document.visibilityState === "hidden") return;
    document.removeEventListener("visibilitychange", wake);
    if (live()) step();
  };
  const step = () => {
    if (!live()) return;
    if (document.visibilityState === "hidden") {
      document.addEventListener("visibilitychange", wake);
      return;
    }
    if (left > 0) {
      draw();
      left--;
      setTimeout(step, 1000);
      return;
    }
    attempt();
  };
  const attempt = () =>
    call("GET", "/me?path=" + enc(location.pathname), null, null, AbortSignal.timeout(BUSY_GIVE_UP_MS)).then((m) => live() && signedIn(m), (e) => {
      if (e && e.status === 428) {
        if (S.open && S.verify) verify(() => (me ? signedIn(me) : busy()));
        return;
      }
      if (!live()) return;
      if (e && e.status === 403) {
        close(true);
        gone();
        return;
      }
      if (e && e.status && !busyView(e.status)) {
        failure(e);
        return;
      }
      n++;
      left = busyDelay(n);
      tell();
      step();
    });
  mount(view, title);
  tell();
  step();
}
function signedIn(m) {
  adopt(m);
  close(true);
}
function adopt(m) {
  me = m;
  try { S.tint.replaceSync(theme(m && m.theme)); } catch (x) {}
  rehead();
  if (o.space) return;
  try { sessionStorage.setItem("p99:code", JSON.stringify([o.code + location.pathname + ((Date.now() / 6e4) | 0), m])); } catch (x) {}
  if (o.refresh) o.refresh(1, o.code);
}
function mount(view, focus) {
  if (S.verify && !view.classList.contains("p99-verify")) return;
  clear(scroller);
  scroller.append(view);
  scroller.scrollTop = 0;
  if (!focus) return;
  if (!/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(focus.tagName) && !focus.hasAttribute("tabindex")) focus.setAttribute("tabindex", "-1");
  try { focus.focus({ preventScroll: true }); } catch (x) { focus.focus(); }
}
function failure(e, retry) {
  const p = h("p", { class: "p99-error", role: "alert", id: "p99-title", text: loadProblem(e) });
  mount(h("section", { class: "p99-view p99-failed" }, S.view === "item" ? back() : null, p, retry && e.status !== 404 ? h("button", { type: "button", class: "p99-retry", text: say("retry"), onclick: retry }) : null), p);
}
function statusLine() { return h("p", { class: "p99-status-line", role: "status", "aria-live": "polite" }); }
function status(form, text, retry) {
  const line = form && form.querySelector(".p99-status-line");
  if (!line) return;
  line.textContent = text || "";
  if (retry) line.append(" ", h("button", { type: "button", class: "p99-retry", text: say("retry"), onclick: retry }));
}
function pill(cls, data, value, label) { return h("span", { class: cls, [data]: value, text: label }); }
function choiceOf(s, r) {
  const c = LEGACY[s] || s || "";
  return c === "done" ? "done:" + (r || "fixed") : c;
}
function statusWord(s, r) {
  const [key, res] = choiceOf(s, r).split(":");
  const named = owner() && Array.isArray(me.statuses) ? me.statuses.find((x) => x.key === key) : null;
  if (!named) return say("status_" + (res || key));
  return res && res !== "fixed" ? named.name + " · " + say("status_" + res) : named.name;
}
function stateOf(x) { return choiceOf(x.stage || x.status, x.resolution); }
function statusPill(x) {
  const c = stateOf(x);
  const res = c.split(":")[1];
  const named = x.label && owner() ? x.label + (res && res !== "fixed" ? " · " + say("status_" + res) : "") : null;
  return pill("p99-status", "data-status", c.replace(":", "-"), named || statusWord(c));
}
function kindPill(k) { return pill("p99-kind", "data-kind", k, say("kind_" + k)); }
function landing(l) {
  if (!l) return null;
  const envs = Array.isArray(l.envs) ? l.envs : [];
  return [
    envs.length
      ? h("ol", { class: "p99-landing" }, envs.map((s) =>
          h("li", { "data-stage": s.kind || null, "data-landed": !!s.at }, h("span", { class: "p99-stage", text: s.env }), s.at ? h("small", { text: s.version || when(s.at) }) : null)
        ))
      : null,
    l.branch ? h("p", { class: "p99-branch", text: say("only_branch") }) : null
  ];
}
function pieces(text) {
  const out = [];
  String(text || "").split("\n").forEach((line, i) => {
    if (i) out.push(h("br"));
    let last = 0;
    line.replace(/https?:\/\/[^\s<>"']+/g, (m, at) => {
      if (at > last) out.push(line.slice(last, at));
      out.push(h("a", { href: m, rel: "noopener noreferrer", target: "_blank", text: m }));
      last = at + m.length;
      return m;
    });
    if (last < line.length) out.push(line.slice(last));
  });
  return out;
}

function defaultList() {
  if (owner()) return { scope: "all", status: "open", kind: "", q: "" };
  return { scope: "mine", status: "open", kind: "", q: "" };
}
function pickOf(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const names = Array.isArray(p.projects) ? p.projects.filter((n) => typeof n === "string" && n.length > 0 && n.length <= 40) : [];
  return {
    view: VIEWS.includes(p.view) ? p.view : "project",
    projects: names.slice(0, MAX_PICKED),
    source: SOURCES.includes(p.source) ? p.source : ""
  };
}
function picked() {
  if (!owner()) return pickOf(null);
  if (!S.pick) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PICK_KEY) || "null"); } catch (x) {}
    S.pick = pickOf(raw);
  }
  return S.pick;
}
function keepPick(p) {
  S.pick = pickOf(p);
  try { localStorage.setItem(PICK_KEY, JSON.stringify(S.pick)); } catch (x) {}
  return S.pick;
}
function owner() { return !!me && (me.role ? me.role === "owner" : !!me.manager); }
function ownerSaid(p) { return !!p && (p.role ? p.role === "owner" : !!p.manager); }
function siteHost() { return o.space || location.hostname; }
function carded(p) { return CARD_VIEWS.includes(p.view); }
function boardQuery(p) {
  const q = new URLSearchParams();
  if (p.view === "project" && S.homeName) q.append("project", S.homeName);
  else if (p.view === "project" && !o.space) q.set("host", siteHost());
  if (p.view === "projects") p.projects.forEach((n) => q.append("project", n));
  if (p.view === "needs") WAITING.forEach((w) => q.append("status", w));
  if (p.view === "landed") q.set("status", "landed");
  if (p.source) q.set("source", p.source);
  return String(q);
}
function bySource(p) { return (c) => !p.source || !!(c.changed_by && c.changed_by.agent) === (p.source === "agent"); }
function cardQuery(p, cursor) {
  if (p.view === "needs") return "/cards/waiting";
  const q = new URLSearchParams();
  if (p.view === "projects") p.projects.forEach((n) => q.append("project", n));
  if (p.view === "landed") q.set("status", "landed");
  if (p.source) q.set("source", p.source);
  if (cursor) q.set("cursor", cursor);
  return "/cards?" + q;
}
function pickBar() {
  if (!owner()) return null;
  const p = picked();
  const view = h("select", { name: "view" }, VIEWS.map((v) => h("option", { value: v, selected: p.view === v, text: say("view_" + v) })));
  const projects = h("fieldset", { class: "p99-projects", hidden: p.view !== "projects" }, h("legend", { text: say("view_projects") }));
  const sources = h("fieldset", { class: "p99-sources" }, h("legend", { text: say("source_label") }), SOURCES.map((v) =>
    h("label", null, h("input", { type: "radio", name: "source", value: v, checked: p.source === v }), h("span", { text: say("source_" + (v || "all")) }))));
  const bar = h("form", { class: "p99-pick", onsubmit: (e) => e.preventDefault() }, h("label", { class: "p99-view-pick" }, h("span", { text: say("view_label") }), view), projects, sources);
  const apply = () => {
    const ready = projects.dataset.ready === "1";
    const names = ready ? Array.from(projects.querySelectorAll("input[name=project]:checked")).map((x) => x.value) : picked().projects;
    const checked = bar.querySelector("input[name=source]:checked");
    const next = keepPick({ view: view.value, projects: names, source: checked ? checked.value : "" });
    projects.hidden = next.view !== "projects";
    if (!projects.hidden) fillProjects(projects, next);
    list(S.list || defaultList());
  };
  bar.addEventListener("change", apply);
  if (!projects.hidden) fillProjects(projects, p);
  return bar;
}
function fillProjects(box, p) {
  if (box.dataset.asked) return;
  box.dataset.asked = "1";
  call("GET", "/projects").then((res) => {
    const names = ((res && res.projects) || []).map((x) => x && x.name).filter((n) => typeof n === "string");
    const chosen = new Set(p.projects.map((n) => n.toLowerCase()));
    box.append(...(names.length
      ? names.map((n) => h("label", null, h("input", { type: "checkbox", name: "project", value: n, checked: chosen.has(n.toLowerCase()) }), h("span", { text: n })))
      : [h("p", { class: "p99-empty", text: say("projects_none") })]));
    box.dataset.ready = "1";
  }).catch(() => { delete box.dataset.asked; });
}
function listQuery(f, cursor) {
  const p = picked();
  const scope = p.view === "projects" ? "all" : f.scope;
  const lane = /^lane:/.test(f.status || "") ? f.status.slice(5) : "";
  const q = new URLSearchParams({ scope, status: lane ? "any" : f.status || "open" });
  if (lane) q.set("label", lane);
  if (p.source) q.set("source", p.source);
  if (p.view === "project" && S.homeName && scope === "all") q.append("project", S.homeName);
  if (p.view === "projects") p.projects.forEach((n) => q.append("project", n));
  if (scope === "page") q.set("path", location.pathname);
  if (f.kind) q.set("kind", f.kind);
  if (f.q) q.set("q", f.q);
  if (cursor) q.set("cursor", cursor);
  return "/issues?" + q;
}
function list(f) {
  const seq = ++S.seq;
  const ask = asking();
  const shown = S.view === "list" && scroller.querySelector(".p99-view[data-view=list]");
  S.view = "list";
  S.list = f;
  const view = shown || listView(f);
  const results = view.querySelector(".p99-results");
  const form = view.querySelector(".p99-filters");
  const p = picked();
  const cards = carded(p) && !(p.view === "projects" && (f.kind || f.q || (f.status && f.status !== "open")));
  form.hidden = carded(p) && p.view !== "projects";
  view.querySelector(".p99-tabs").hidden = carded(p);
  for (const a of view.querySelectorAll(".p99-tabs a")) {
    if (a.dataset.scope === f.scope) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  results.replaceChildren(rowsSkeleton());
  results.setAttribute("aria-busy", "true");
  form.classList.add("is-busy");
  if (!shown) mount(view, view.querySelector("#p99-title"));
  const again = () => { list(S.list || f); form.elements.q.focus(); };
  const done = patience(seq, results, ask, again);
  const settle = (...kids) => {
    done();
    results.removeAttribute("aria-busy");
    form.classList.remove("is-busy");
    results.replaceChildren(...kids);
  };
  const page = (cursor, signal) => call("GET", cards ? cardQuery(p, cursor) : listQuery(f, cursor), null, null, signal).then((res) => ({
    rows: ((res && (cards ? res.cards : res.issues)) || []).filter(p.view === "needs" ? bySource(p) : () => true),
    next: res && res.next_cursor
  }));
  const ready = !cards && p.view === "project" && owner() ? home() : Promise.resolve();
  ready.then(() => Promise.all([page(null, ask.signal), hereKeys(f, ask.signal)])).then(([{ rows, next }, keys]) => {
    if (seq !== S.seq) return;
    const shown = grouped(keys, cards ? cardRow : row);
    shown.add(rows);
    const empty = cards ? say(p.view === "needs" ? "needs_empty" : "cards_empty") : f.q ? say("list_no_match", { q: f.q }) : say(f.kind || (f.status && f.status !== "open") || p.source ? "list_empty_filtered" : "list_empty");
    settle(rows.length ? shown.box : h("p", { class: "p99-empty", text: empty }));
    more(results, shown.add, page, next);
  }).catch((e) => {
    if (seq !== S.seq) return;
    settle(h("div", { class: "p99-failed" },
      h("p", { class: "p99-error", role: "alert", text: loadProblem(e) }),
      h("button", { type: "button", class: "p99-retry", text: say("retry"), onclick: again })));
  });
}
function listView(f) {
  const title = h("h2", { id: "p99-title", text: say("list_title") });
  const tabs = (o.space ? [] : ["page"]).concat(["mine"], owner() ? ["all"] : []);
  const nav = h("nav", { class: "p99-tabs", "aria-label": say("list_title") }, tabs.map((t) =>
    h("a", { href: "#", "data-scope": t, text: say("tab_" + t), onclick: (e) => { e.preventDefault(); list(Object.assign({}, S.list || f, { scope: t })); } })
  ));
  return h("section", { class: "p99-view", "data-view": "list" }, title, pickBar(), nav, filters(f), h("div", { class: "p99-results" }));
}
function hereKeys(f, signal) {
  const c = (me && me.counts) || {};
  if (o.space || !(c.page_open > 0) || f.status === "closed") return Promise.resolve(null);
  const q = new URLSearchParams({ scope: "page", status: "open", path: location.pathname, limit: "100" });
  return call("GET", "/issues?" + q, null, null, signal).then((res) => {
    const keys = new Set(((res && res.issues) || []).map((x) => x.key));
    return keys.size ? keys : null;
  }, () => null);
}
function grouped(keys, draw) {
  const rest = h("ol", { class: "p99-items" });
  if (!keys) return { box: rest, add: (rows) => rest.append(...rows.map((x) => draw(x, false))) };
  const here = h("ol", { class: "p99-items p99-here-items" });
  const count = h("span", { class: "p99-group-count" });
  const hereHead = h("h3", { class: "p99-group p99-group-here" }, h("span", { text: say("group_here") }), " ", count);
  const restHead = h("h3", { class: "p99-group", text: say("group_rest") });
  const box = h("div", { class: "p99-groups" }, hereHead, here, restHead, rest);
  const add = (rows) => {
    for (const x of rows) {
      const at = keys.has(x.key);
      (at ? here : rest).append(draw(x, at));
    }
    const n = here.children.length;
    count.textContent = String(n);
    hereHead.hidden = here.hidden = n === 0;
    restHead.hidden = n === 0 || rest.children.length === 0;
  };
  return { box, add };
}
function more(box, add, page, cursor) {
  if (!cursor) return;
  const b = h("button", { type: "button", class: "p99-more", text: say("more") });
  b.addEventListener("click", () => {
    b.disabled = true;
    page(cursor).then(({ rows, next }) => {
      b.remove();
      add(rows);
      more(box, add, page, next);
    }).catch(() => { b.disabled = false; });
  });
  box.append(b);
}
function lanes() {
  const at = (l) => { const n = LANE_NAMES.indexOf(l.name.toLowerCase()); return n < 0 ? LANE_NAMES.length : n; };
  return call("GET", "/labels").then((r) => ((r && r.labels) || []).filter((l) => l && typeof l.name === "string").sort((a, b) => at(a) - at(b)));
}
function filters(f) {
  const now = f.status || "open";
  const status = h("select", { name: "status" },
    [["open", say("filter_open")], ["closed", say("filter_closed")], ["any", say("filter_any")]].concat(owner() ? [] : STATUSES.filter((s) => s !== "done").map((s) => [s, statusWord(s)]))
      .map(([v, l]) => h("option", { value: v, selected: now === v, text: l })));
  if (owner()) lanes().then((list) => status.append(...list.map((l) => h("option", { value: "lane:" + l.name, selected: now === "lane:" + l.name, text: l.name }))), () => {});
  const kind = h("select", { name: "kind" }, [["", say("filter_every_kind")]].concat(KINDS.map((k) => [k, say("kind_" + k)])).map(([v, l]) => h("option", { value: v, selected: f.kind === v, text: l })));
  const q = h("input", { type: "search", name: "q", value: f.q || "", placeholder: say("filter_search_hint"), autocomplete: "off", maxlength: "400" });
  let timer = 0;
  const apply = () => {
    clearTimeout(timer);
    if (S.view !== "list" || !form.isConnected) return;
    const next = Object.assign({}, S.list || f, { status: status.value, kind: kind.value, q: q.value.trim() });
    const now = S.list || {};
    const same = ["scope", "status", "kind", "q"].every((k) => (next[k] || "") === (now[k] || ""));
    if (same && !form.parentNode.querySelector(".p99-failed")) return;
    list(next);
  };
  status.addEventListener("change", apply);
  kind.addEventListener("change", apply);
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 260); });
  const form = h("form", { class: "p99-filters", role: "search", onsubmit: (e) => { e.preventDefault(); apply(); } },
    h("label", null, h("span", { text: say("filter_status") }), status),
    h("label", null, h("span", { text: say("filter_kind") }), kind),
    h("label", { class: "p99-search" }, h("span", { text: say("filter_search") }), q, h("i", { class: "p99-spin", "aria-hidden": "true" })));
  return form;
}
function hereMark(at) { return at ? h("span", { class: "p99-here", text: say("tab_page") }) : null; }
function row(r, at) {
  const meta = r.page && r.page.path ? [h("span", { class: "p99-path", text: r.page.path }), " · "] : [];
  if (owner() && r.reporter) meta.push(h("span", { class: "p99-reporter" }, person(r.reporter, false, "")), " · ");
  meta.push(h("time", { text: when(r.created_at) }));
  if (r.comments > 0) meta.push(" · ", h("span", { class: "p99-comments", text: say("comments", { count: r.comments }, r.comments) }));
  return h("li", { class: "p99-item", "data-status": stateOf(r), "data-kind": r.kind, "data-unread": !!r.unread, "data-here": !!at },
    h("a", { href: "#p99=" + r.key, onclick: (e) => { e.preventDefault(); item(r.key); } },
      h("span", { class: "p99-key", text: r.key }),
      h("b", { class: "p99-item-title", text: r.title }),
      r.unread ? h("span", { class: "p99-unread", text: say("unread_mark") }) : null,
      statusPill(r),
      kindPill(r.kind),
      hereMark(at),
      h("small", { class: "p99-meta" }, meta)),
    landing(r.landing));
}

function cardRow(c, at) {
  const meta = [h("span", { class: "p99-project", text: c.project || "" })];
  if (c.host) meta.push(" · ", h("span", { class: "p99-host", text: c.host }));
  if (c.changed_by) meta.push(" · ", h("span", { class: "p99-reporter" }, person(c.changed_by, false, "")));
  meta.push(" · ", h("time", { text: when(c.changed_at || c.created_at) }));
  if (c.comments > 0) meta.push(" · ", h("span", { class: "p99-comments", text: say("comments", { count: c.comments }, c.comments) }));
  const here = !c.host || o.space === "*" || c.host === siteHost();
  const go = here
    ? { href: "#p99=" + c.key, onclick: (e) => { e.preventDefault(); item(c.key); } }
    : { href: "https://" + c.host + "/#p99=" + c.key, target: "_blank", rel: "noopener noreferrer" };
  return h("li", { class: "p99-item p99-card-row", "data-lane": c.status, "data-kind": c.kind, "data-here": !!at },
    h("a", go,
      h("span", { class: "p99-key", text: c.key }),
      h("b", { class: "p99-item-title", text: c.title }),
      pill("p99-status", "data-lane", c.status, c.label || c.status),
      kindPill(c.kind),
      hereMark(at),
      h("small", { class: "p99-meta" }, meta)));
}

function item(key) {
  S.view = "item";
  S.key = key;
  clearOutlines();
  const seq = ++S.seq;
  const ask = asking();
  const box = skeleton();
  mount(box);
  const done = patience(seq, box, ask, () => item(key));
  return call("GET", "/issues/" + enc(key), null, null, ask.signal).then((t) => {
    if (seq !== S.seq) return;
    done();
    if (!S.open) return;
    if (!t || !t.issue) throw new Error();
    const view = thread(t);
    mount(view, view.querySelector("#p99-title"));
    o.refresh && o.refresh();
  }).catch((e) => {
    if (seq !== S.seq) return;
    done();
    failure(e, () => item(key));
  });
}
function back() {
  return h("a", { class: "p99-back", href: "#", text: say("back"), onclick: (e) => {
    e.preventDefault();
    if (/^#p99=/.test(location.hash)) history.replaceState(history.state, "", location.pathname + location.search);
    list(S.list || defaultList());
  } });
}
function thread(t) {
  const i = t.issue;
  const manager = owner();
  const mine = !!(me && i.reporter && i.reporter.email && me.email && i.reporter.email.toLowerCase() === me.email.toLowerCase());
  const files = t.attachments || [];
  const byId = new Map(files.map((a) => [a.id, a]));
  const meta = [say("filed_by", { who: who(i.reporter), when: when(i.created_at) }), " · ", say("updated", { when: when(i.updated_at) })];
  if (manager && i.reporter && i.reporter.email) meta.push(" · ", h("span", { text: i.reporter.email }));
  if (manager && i.env) meta.push(" · ", h("span", { text: i.env }));
  if (i.assignee) meta.push(" · ", h("span", { class: "p99-person" }, disc(i.assignee, 16), say("assigned_to", { who: handle(i.assignee) })));
  if (i.duplicate_of) meta.push(" · ", h("a", { href: "#p99=" + enc(i.duplicate_of), text: say("duplicate_of", { n: i.duplicate_of }), onclick: (e) => { e.preventDefault(); item(i.duplicate_of); } }));
  const page = i.page || {};
  const dest = pageUrl(page.path, i.host);
  const here = !!dest && !o.space && dest.pathname === location.pathname;
  const marks = Array.isArray(i.marks) ? i.marks : [];
  const pageLink = dest ? h("p", { class: "p99-page" }, h("a", { href: (o.space ? dest.origin : "") + dest.pathname + "#p99=" + enc(i.key), target: o.space ? "_blank" : null, rel: o.space ? "noopener noreferrer" : null, text: page.title || dest.pathname, onclick: (e) => {
    if (o.space || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (here) { if (marks.length) showMarks(marks); return; }
    location.href = dest.pathname + "#p99=" + enc(i.key);
  } })) : null;
  const shots = files.filter((a) => !a.comment_id && a.role !== "file");
  const loose = files.filter((a) => !a.comment_id && a.role === "file");
  const view = h("article", { class: "p99-view", "data-view": "item", "data-status": stateOf(i), "data-kind": i.kind },
    h("header", { class: "p99-item-head" },
      back(),
      h("p", { class: "p99-labels" }, h("span", { class: "p99-key", text: i.key }), " ", kindPill(i.kind), " ", statusPill(i)),
      h("h2", { id: "p99-title", text: i.title }),
      h("p", { class: "p99-meta" }, meta),
      pageLink),
    landing(i.landing),
    i.commits && i.commits.length ? h("ul", { class: "p99-commits" }, i.commits.map((c) => h("li", { "data-fixes": c.rel === "fixes" }, h("code", { text: String(c.sha || "").slice(0, 7) }), " ", c.subject || ""))) : null,
    manager && i.github && i.github.length ? h("ul", { class: "p99-commits" }, i.github.filter((g) => /^https:\/\//.test(g.url || "")).map((g) => h("li", { "data-fixes": g.rel !== "refs" }, h("a", { href: g.url, target: "_blank", rel: "noopener noreferrer", text: say(g.kind === "pull" ? "github_pull" : "github_issue", { n: g.number }) })))) : null,
    marks.length && here ? h("button", { type: "button", onclick: () => showMarks(marks), text: say("show_marks") }) : null,
    i.body ? h("div", { class: "p99-body" }, pieces(i.body)) : null,
    shots.length ? h("div", { class: "p99-shots" }, shots.map((a) =>
      h("figure", { class: "p99-shot", "data-role": a.role }, h("a", { href: "#", onclick: download(a) }, thumb(a)), h("figcaption", { text: say("shot_" + a.role, { n: (a.mark || 0) + 1 }) }))
    )) : null,
    loose.length ? fileList(loose) : null,
    h("ol", { class: "p99-thread" }, entries(t, byId, mine)),
    commentForm(i, manager));
  if (manager) view.append(manageForm(i), linkBox(i, t), editForm(i, "edit_any"), deleteBox(i));
  else if (mine) {
    const acts = h("div", { class: "p99-reporter-actions" });
    const wrap = h("div", { class: "p99-reporter" }, acts, statusLine());
    const state = stateOf(i);
    if (!state.startsWith("done")) acts.append(h("button", { type: "button", text: say("abandon"), onclick: (e) => patch(i.key, { status: "done", resolution: "abandoned" }, wrap, e.currentTarget) }));
    if (state === "done:fixed") acts.append(h("button", { type: "button", text: say("reopen"), onclick: (e) => patch(i.key, { status: "inbox" }, wrap, e.currentTarget) }));
    if (acts.firstChild) view.append(wrap);
    if (state === "inbox") view.append(editForm(i));
  }
  return view;
}
function fileList(list) {
  return h("ul", { class: "p99-files" }, list.map((a) => h("li", null,
    /^image\//.test(a.type || "") ? h("a", { href: "#", onclick: download(a) }, thumb(a)) : null,
    h("a", { href: "#", onclick: download(a), text: a.name || "file" }), " ", h("small", { text: size(a.bytes || 0) }))));
}
function pageUrl(path, host) {
  if (typeof path !== "string" || !/^\/(?![\/\\])/.test(path) || /[\\\s\u0000-\u001f\u007f]/.test(path)) return null;
  try {
    const on = o.space === "*" ? host : o.space;
    if (o.space && !on) return null;
    const site = on ? "https://" + on : location.origin;
    const u = new URL(path, site);
    return u.origin === site ? u : null;
  } catch (x) { return null; }
}
function eventText(ev) {
  const obj = ev.detail && typeof ev.detail === "object" ? ev.detail : {};
  const label = (k, v) => (v ? say(k + "_" + v) : "");
  if (ev.kind === "status") return say("event_status", { from: obj.from ? statusWord(obj.from, obj.from_resolution) : "", to: obj.to ? statusWord(obj.to, obj.resolution) : "" });
  if (ev.kind === "label") return say("event_label", { from: obj.from || "", to: obj.to || "" });
  if (ev.kind === "kind") return say("event_kind", { from: label("kind", obj.from), to: label("kind", obj.to) });
  if (ev.kind === "assignee") return obj.to ? say("event_assignee", { to: handle(obj.to) }) : say("event_unassigned");
  if (ev.kind === "labels") return say("event_labels", { list: (obj.added || []).map((n) => "+" + n).concat((obj.removed || []).map((n) => "−" + n)).join(" ") });
  if (ev.kind === "mail") return say(obj.ok === false ? "event_mail_failed" : "event_mail", { to: obj.to || "" });
  if (ev.kind === "link") return say("event_link", { ref: obj.ref || "" });
  if (ev.kind === "landed") return say("event_landed", { env: obj.env || obj.to || "" });
  if (ev.kind === "merge") return obj.into ? say("duplicate_of", { n: obj.into }) : say("event_merge", { item: obj.item || "" });
  if (("event_" + ev.kind) in WORDS) return say("event_" + ev.kind, { to: obj.to == null ? "" : obj.to, env: obj.env || "" });
  return null;
}
function entries(t, byId, mine) {
  const out = [];
  (t.comments || []).forEach((c) => out.push({ at: stamp(c.created_at), c }));
  (t.events || []).forEach((ev) => { if (ev.kind !== "comment") out.push({ at: stamp(ev.at), ev }); });
  out.sort((a, b) => a.at - b.at);
  return out.map((x) => {
    if (x.c) {
      const c = x.c;
      const self = !!(me && c.author && c.author.email && me.email && c.author.email.toLowerCase() === me.email.toLowerCase());
      const files = (c.attachments || []).map((id) => byId.get(id)).filter(Boolean);
      return h("li", { class: "p99-comment", "data-internal": !!c.internal, "data-mine": self, "data-owner": ownerSaid(c.author) },
        h("p", { class: "p99-meta" }, h("b", null, person(c.author)), " · ", h("time", { text: when(c.created_at) }), c.internal ? [" · ", h("span", { class: "p99-internal", text: say("internal") })] : null),
        c.body ? h("div", { class: "p99-body" }, pieces(c.body)) : null,
        files.length ? fileList(files) : null);
    }
    const text = eventText(x.ev);
    if (!text) return null;
    return h("li", { class: "p99-event", "data-event-kind": x.ev.kind }, h("small", null, h("b", null, person(x.ev.actor_name || x.ev.actor, x.ev.agent, x.ev.via)), " ", text, " · ", h("time", { text: when(x.ev.at) })));
  });
}
function pendingFiles(form, files) {
  form.p99Files = form.p99Files || [];
  Array.from(files || []).forEach((f) => {
    if (!fileType(f, f.name)) return status(form, say("file_type"));
    if (f.size > MAX_FILE) return status(form, say("too_big", { name: f.name }));
    if (form.p99Files.length >= MAX_FILES) return status(form, say("too_many_files"));
    if (form.p99Files.some((x) => x.file === f)) return;
    form.p99Files.push({ file: f, uid: uid() });
  });
  const ul = form.querySelector(".p99-file-list");
  clear(ul);
  form.p99Files.forEach((f, i) => ul.append(h("li", null, h("span", { text: f.file.name || "file" }), h("small", { text: size(f.file.size) }),
    h("button", { type: "button", class: "p99-remove", text: say("remove"), onclick: () => { form.p99Files.splice(i, 1); pendingFiles(form, []); } }))));
}
function commentForm(i, manager) {
  const input = h("input", { type: "file", name: "files", multiple: true });
  const form = h("form", { class: "p99-comment-form", novalidate: true },
    h("label", { class: "p99-field" }, h("span", { text: say("comment_label") }), h("textarea", { name: "body", maxlength: "40000", rows: "3", placeholder: say("comment_hint") })),
    h("label", { class: "p99-field" }, h("span", { text: say("comment_files") }), input),
    h("ul", { class: "p99-file-list" }),
    manager ? h("label", { class: "p99-check" }, h("input", { type: "checkbox", name: "internal" }), " ", say("internal_note")) : null,
    statusLine(),
    h("button", { type: "submit", text: say("comment_send") }));
  input.addEventListener("change", () => { pendingFiles(form, input.files); input.value = ""; });
  form.addEventListener("dragover", (e) => e.preventDefault());
  form.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer) pendingFiles(form, e.dataTransfer.files); });
  form.addEventListener("paste", (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); pendingFiles(form, files); }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitComment(form, i.key); });
  return form;
}
function submitComment(form, key) {
  if (form.p99Busy) return;
  const body = form.elements.body.value.trim();
  const files = form.p99Files || [];
  if (!body && !files.length) return form.elements.body.focus();
  if (over(body, 20000)) return refuse(form, form.elements.body, 20000);
  form.p99Busy = true;
  form.p99Uid = form.p99Uid || uid();
  const send = form.querySelector("button[type=submit]");
  send.disabled = true;
  status(form, say("sending"));
  const internal = form.elements.internal ? form.elements.internal.checked : false;
  const made = form.p99Comment ? Promise.resolve(form.p99Comment) : retrying(() =>
    call("POST", "/issues/" + enc(key) + "/comments", JSON.stringify({ client_uid: form.p99Uid, body, internal })));
  made.then((res) => {
    form.p99Comment = res;
    const items = files.map((f) => ({ uid: f.uid, role: "file", name: f.file.name || "file", blob: f.file, comment: res.id, done: f.done, dead: f.dead, err: f.err, ref: f }));
    return uploadAll(key, items, form).then((failed) => {
      items.forEach((it) => { it.ref.done = it.done; it.ref.dead = it.dead; it.ref.err = it.err; });
      form.p99Busy = false;
      if (failed.length) {
        send.disabled = false;
        status(form, refused(failed).trim() || say("upload_failed", { name: failed[0].name }), failed.some((x) => !x.dead) ? () => submitComment(form, key) : null);
        return;
      }
      return item(key);
    });
  }).catch((e) => {
    form.p99Busy = false;
    send.disabled = false;
    status(form, problem(e), transient(e) ? () => submitComment(form, key) : null);
  });
}
function options(list, word, current) {
  return list.map((v) => h("option", { value: v, selected: v === current, text: word(v) }));
}
let seqId = 0;
function combo(o) {
  const id = "p99-c" + ++seqId;
  const input = h("input", { id, role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list", "aria-controls": id + "l", autocomplete: "off", spellcheck: "false", placeholder: o.hint, value: o.text, maxlength: o.max });
  const lb = h("ul", { class: "p99-listbox", role: "listbox", id: id + "l", "aria-label": o.label, hidden: true });
  let opts = [], at = -1, ask = 0, typed = false;
  const mark = (k) => {
    at = k;
    Array.from(lb.children).forEach((li, j) => li.setAttribute("aria-selected", String(j === k)));
    const li = k >= 0 && lb.children[k];
    if (li) { input.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
  };
  const show = (on) => { lb.hidden = !on; input.setAttribute("aria-expanded", String(on)); if (!on) mark(-1); };
  const fill = () => {
    const n = ++ask;
    const q = typed ? input.value.trim() : "";
    const note = (text) => {
      if (n !== ask || root.activeElement !== input) return;
      opts = [];
      clear(lb);
      lb.append(h("li", { role: "option", "aria-disabled": "true", class: "p99-none", text }));
      show(true);
      mark(-1);
    };
    const slow = setTimeout(() => note(say("loading")), 150);
    Promise.resolve(o.find(q)).then((list) => {
      clearTimeout(slow);
      if (n !== ask || root.activeElement !== input) return;
      opts = list;
      clear(lb);
      list.forEach((x, j) => lb.append(h("li", { id: id + "-" + j, role: "option", "aria-selected": "false", class: x.make ? "is-new" : null }, x.el || h("span", { text: x.text }), x.sub ? h("small", { text: x.sub }) : null)));
      if (!list.length) lb.append(h("li", { role: "option", "aria-disabled": "true", class: "p99-none", text: say("no_match") }));
      show(true);
      mark(q && list.length ? 0 : -1);
    }, (e) => {
      clearTimeout(slow);
      note(loadProblem(e));
    });
  };
  const pick = (k) => {
    const x = opts[k];
    if (!x) return;
    o.pick(x, input);
    typed = false;
    if (o.keep) fill(); else show(false);
  };
  input.addEventListener("focus", () => { typed = false; if (!o.keep) input.select(); fill(); });
  input.addEventListener("click", () => { if (lb.hidden) fill(); });
  input.addEventListener("input", () => { typed = true; fill(); });
  input.addEventListener("blur", () => { ask++; show(false); if (o.reset) o.reset(input); });
  input.addEventListener("keydown", (e) => {
    const k = e.key, len = opts.length;
    if (e.isComposing) return;
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (lb.hidden) return fill();
      if (len) mark(k === "ArrowDown" ? (at + 1) % len : (at <= 0 ? len : at) - 1);
    } else if (k === "Enter") {
      if (!lb.hidden && at >= 0) { e.preventDefault(); pick(at); } else if (o.keep && input.value.trim()) e.preventDefault();
    } else if (k === "Escape" && !lb.hidden) {
      e.preventDefault();
      e.stopPropagation();
      show(false);
    } else if (k === "Backspace" && !input.value && o.back) o.back();
  });
  lb.addEventListener("mousedown", (e) => e.preventDefault());
  lb.addEventListener("click", (e) => {
    const li = e.target.closest("[role=option]");
    if (li && li.getAttribute("aria-disabled") !== "true") pick(Array.prototype.indexOf.call(lb.children, li));
  });
  return { input, box: h("span", { class: "p99-combo" }, input, lb) };
}
const has = (q, ...words) => words.some((w) => String(w || "").toLowerCase().includes(q.toLowerCase()));
function pickOne(label, name, now, find) {
  const keep = h("input", { name, value: now.value, hidden: true });
  const c = combo({
    label,
    hint: now.hint,
    text: now.text,
    find,
    pick: (x, input) => { Object.assign(now, x); keep.value = x.value; input.value = x.text; },
    reset: (input) => { input.value = now.text; },
  });
  return h("div", { class: "p99-picker" }, h("label", { for: c.input.id, text: label }), c.box, keep);
}
function disc(p, size) {
  const person = typeof p === "string" ? { username: p } : p || {};
  const box = h("span", { class: "p99-disc", "aria-hidden": "true" });
  box.style.width = box.style.height = size + "px";
  if (!S.avatar) {
    S.avatar = import("/_p99/avatar.js?v=" + V);
    S.avatar.catch(() => { S.avatar = null; });
  }
  S.avatar.then((m) => {
    box.replaceChildren(m.avatarNode(person.username, size));
    return m.face(person, blob, size).then((c) => { if (c) box.replaceChildren(c); });
  }).catch(() => {});
  return box;
}
function handle(p) {
  return p && p.username ? "@" + p.username : "";
}
function assigneePick(i) {
  const none = { value: "", text: say("nobody") };
  const of = (p) => ({ value: p.username, text: handle(p), el: h("span", { class: "p99-person" }, disc(p, 20), handle(p)) });
  const now = i.assignee && i.assignee.username ? { value: i.assignee.username, text: handle(i.assignee) } : { ...none };
  let people = null;
  const load = () => people || (people = call("GET", "/people").then((r) => {
    const list = ((r && r.people) || []).filter((p) => p.username).map(of);
    if (now.value && !list.some((p) => p.value === now.value)) list.push(of(i.assignee));
    return list;
  }, () => (people = null, [])));
  return pickOne(say("assignee"), "assignee", now, (q) => load().then((list) => (q ? [] : [none]).concat(list.filter((p) => has(q.replace(/^@/, ""), p.text)))));
}
function duplicatePick(i) {
  const skip = new Set([i.key].concat((i.merged || []).map((m) => m.key)));
  const none = { value: "", text: say("not_duplicate") };
  const find = (q) => new Promise((ok) => setTimeout(ok, q ? 150 : 0))
    .then(() => call("GET", "/issues?scope=all&status=any&limit=20" + (q ? "&q=" + enc(q) : "")))
    .then((r) => (q || !i.duplicate_of ? [] : [none]).concat(((r && r.issues) || [])
      .filter((x) => !skip.has(x.key) && !x.duplicate_of)
      .map((x) => ({ value: x.key, text: x.key + " " + x.title, el: h("span", null, h("b", { text: x.key }), " ", x.title) }))));
  return pickOne(say("duplicate_label"), "duplicate_of", { value: i.duplicate_of || "", text: i.duplicate_of || "", hint: say("duplicate_hint") }, find);
}
function manageForm(i) {
  const form = h("form", { class: "p99-manage", novalidate: true },
    h("h3", { text: say("manage") }),
    moveTo(i),
    h("label", null, h("span", { text: say("filter_kind") }), h("select", { name: "kind" }, options(KINDS, (k) => say("kind_" + k), i.kind))),
    assigneePick(i),
    duplicatePick(i),
    statusLine(),
    h("button", { type: "submit", text: say("save") }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = changed(form);
    if ("duplicate_of" in data) data.duplicate_of = data.duplicate_of || null;
    if ("assignee" in data && !data.assignee) data.assignee = null;
    const into = data.duplicate_of;
    if (into) delete data.duplicate_of;
    const to = form.querySelector(".p99-move-to select");
    const drop = to.selectedOptions[0] && to.selectedOptions[0].dataset.drop;
    const move = drop || to.value !== i.label;
    if (!move && !into) return patch(i.key, data, form);
    if (form.p99Busy) return;
    form.p99Busy = true;
    status(form, say("sending"));
    const moved = move ? call("POST", "/move", JSON.stringify(drop ? { key: i.key, from: i.label, to: drop, resolution: "abandoned" } : { key: i.key, from: i.label, to: to.value })) : Promise.resolve();
    moved.then(() => (into ? call("POST", "/merge", JSON.stringify({ into, items: [i.key] })) : null)).then(() => {
      form.p99Busy = false;
      return Object.keys(data).length ? patch(i.key, data, form) : item(i.key);
    }, (e) => {
      form.p99Busy = false;
      if (e.status !== 409) return status(form, problem(e));
      item(i.key).then(() => status(scroller.querySelector(".p99-manage"), e.message || say("moved")));
    });
  });
  return form;
}
function moveTo(i) {
  const now = h("option", { value: i.label, selected: true, text: i.label });
  const sel = h("select", null, now);
  lanes().then((labels) => {
    const seen = new Set([i.label.toLowerCase()]);
    const more = [];
    let shut = null;
    for (const l of labels) {
      if (!shut && l.closes) shut = l.name;
      if (seen.has(l.name.toLowerCase())) continue;
      seen.add(l.name.toLowerCase());
      more.push(h("option", { value: l.name, text: l.name }));
    }
    if (shut && i.resolution !== "abandoned") more.push(h("option", { value: "", "data-drop": shut, text: say("move_drop") }));
    sel.append(...more);
  }, () => {});
  return h("label", { class: "p99-move-to" }, h("span", { text: say("move_to") }), sel);
}
function deleteBox(i) {
  const id = "p99-d" + ++seqId;
  const input = h("input", { id, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: i.key });
  const btn = h("button", { type: "button", class: "p99-danger", disabled: true, "aria-describedby": id + "w" }, h("span", { text: say("delete_go", { key: i.key }) }));
  const box = h("section", { class: "p99-delete", "aria-labelledby": id + "t" },
    h("h3", { id: id + "t", text: say("delete", { key: i.key }) }),
    h("p", { id: id + "w", text: say("delete_warn", { key: i.key }) }),
    h("label", { class: "p99-field", for: id }, h("span", { text: say("delete_type", { key: i.key }) })),
    input,
    btn,
    statusLine());
  const ok = () => input.value.trim().toUpperCase() === i.key.toUpperCase();
  let held = 0;
  const go = () => {
    if (box.p99Busy || !ok()) return;
    box.p99Busy = true;
    btn.disabled = true;
    btn.toggleAttribute("data-busy", true);
    status(box, say("sending"));
    call("DELETE", "/issues/" + enc(i.key)).then(() => {
      if (/^#p99=/i.test(location.hash)) history.replaceState(history.state, "", location.pathname + location.search);
      o.refresh && o.refresh();
      list(S.list || defaultList());
    }, (e) => {
      box.p99Busy = false;
      btn.disabled = !ok();
      btn.removeAttribute("data-busy");
      status(box, problem(e));
    });
  };
  const stop = () => {
    if (!held) return;
    clearTimeout(held);
    held = 0;
    btn.classList.remove("is-holding");
    if (!box.p99Busy) status(box, say("delete_hold"));
  };
  input.addEventListener("input", () => { btn.disabled = box.p99Busy || !ok(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  btn.addEventListener("pointerdown", (e) => {
    if (e.button || !ok() || box.p99Busy) return;
    btn.classList.add("is-holding");
    held = setTimeout(() => { held = 0; btn.classList.remove("is-holding"); go(); }, 1200);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((n) => btn.addEventListener(n, stop));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => { if (!e.detail) go(); });
  return box;
}
function linkBox(i, t) {
  const links = (t.events || []).filter((ev) => ev.kind === "link" && ev.detail && typeof ev.detail.ref === "string").reverse();
  const input = h("input", { name: "ref", maxlength: "200", autocomplete: "off", spellcheck: "false", placeholder: say("link_hint"), required: true });
  const form = h("form", { class: "p99-links", novalidate: true },
    h("h3", { text: say("links") }),
    links.length ? h("ul", { class: "p99-link-list" }, links.map((ev) => h("li", null,
      /^https?:\/\/\S+$/.test(ev.detail.ref) ? h("a", { href: ev.detail.ref, target: "_blank", rel: "noopener noreferrer", text: ev.detail.ref }) : h("code", { text: ev.detail.ref }),
      ev.detail.note ? [" · ", ev.detail.note] : null,
      h("small", null, " · ", person(ev.actor_name || ev.actor, ev.agent, ev.via), " · ", h("time", { text: when(ev.at) }))))) : null,
    h("div", { class: "p99-link-add" }, h("label", { class: "p99-field" }, h("span", { text: say("link_label") }), input), h("button", { type: "submit", text: say("link_add") })),
    statusLine());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = input.value.trim();
    if (!ref) return input.focus();
    if (form.p99Busy) return;
    form.p99Busy = true;
    const send = form.querySelector("button[type=submit]");
    send.disabled = true;
    status(form, say("sending"));
    call("POST", "/cards/" + enc(i.key) + "/links", JSON.stringify({ ref, note: null })).then(() => item(i.key), (e) => {
      form.p99Busy = false;
      send.disabled = false;
      status(form, problem(e));
    });
  });
  return form;
}
function editForm(i, word) {
  const form = h("form", { class: "p99-edit", novalidate: true },
    h("h3", { text: say(word || "edit") }),
    h("label", { class: "p99-field" }, h("span", { text: say("new_title_label") }), h("input", { name: "title", maxlength: "400", value: i.title, required: true })),
    h("label", { class: "p99-field" }, h("span", { text: say("new_body_label") }), h("textarea", { name: "body", maxlength: "40000", rows: "4", text: i.body || "" })),
    statusLine(),
    h("button", { type: "submit", text: say("save") }));
  form.addEventListener("submit", (e) => { e.preventDefault(); patch(i.key, changed(form), form); });
  return form;
}
function changed(form) {
  const out = {};
  Array.from(form.elements).forEach((f) => {
    if (!f.name || f.type === "submit" || f.type === "button" || f.type === "file") return;
    if (f.tagName === "SELECT") {
      const init = Array.from(f.options).find((x) => x.defaultSelected);
      if (f.value !== (init ? init.value : f.options[0] ? f.options[0].value : "")) out[f.name] = f.value;
    } else if (f.type === "checkbox") {
      if (f.checked !== f.defaultChecked) out[f.name] = f.checked;
    } else if (f.value !== f.defaultValue) out[f.name] = f.value.trim();
  });
  return out;
}
function patch(key, data, form, btn) {
  if (!Object.keys(data).length) return status(form, say("saved"));
  if (form.p99Busy) return;
  form.p99Busy = true;
  const send = btn || form.querySelector("button[type=submit]");
  if (send) send.disabled = true;
  status(form, say("sending"));
  return retrying(() => call("PATCH", "/issues/" + enc(key), JSON.stringify(data))).then((res) => {
    form.p99Busy = false;
    return item((res && res.key) || key);
  }, (e) => {
    form.p99Busy = false;
    if (send) send.disabled = false;
    status(form, problem(e));
  });
}

function put(key, it, form) {
  let q = "?name=" + enc(it.name.slice(0, 200)) + "&role=" + it.role;
  if (it.mark != null) q += "&mark=" + it.mark;
  if (it.comment != null) q += "&comment=" + enc(it.comment);
  const once = () => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", api("/issues/" + enc(key) + "/attachments/" + enc(it.uid) + q));
    const head = auth();
    for (const k in head) x.setRequestHeader(k, head[k]);
    x.setRequestHeader("Content-Type", fileType(it.blob, it.name) || "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable) status(form, say("uploading", { name: it.name, pct: Math.round((e.loaded / e.total) * 100) })); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let m = null;
      try { m = JSON.parse(x.responseText).message; } catch (z) {}
      const e = new Error(m || say("upload_failed", { name: it.name }));
      e.status = x.status;
      reject(e);
    };
    x.onerror = () => reject(new Error(say("upload_failed", { name: it.name })));
    x.send(it.blob);
  });
  return retrying(once);
}
function uploadAll(key, items, form) {
  const failed = [];
  return items.reduce((p, it) => p.then(() => {
    if (it.done || it.dead) return;
    status(form, say("uploading", { name: it.name, pct: 0 }));
    return put(key, it, form).then(() => { it.done = true; }, (e) => {
      if (!transient(e)) { it.dead = true; it.err = e; }
      failed.push(it);
    });
  }), Promise.resolve()).then(() => failed);
}
function refused(failed) {
  return failed.filter((x) => x.dead).map((x) => " " + refusal(x)).join("");
}
function refusal(x) {
  return daily(x.err) ? say("upload_refused", { name: x.name, why: x.err.message.replace(/\.$/, "") }) : say("upload_failed", { name: x.name });
}

function here() {
  return { origin: location.origin, path: location.pathname, title: document.title.slice(0, 300) };
}
function over(s, n) { return s.length > n && Array.from(s).length > n; }
function refuse(form, field, n) {
  status(form, say("too_long", { n: n.toLocaleString("en") }));
  field.focus();
}
function bytes(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
function lib() {
  if (!S.lib) {
    S.lib = import("/_p99/capture.js?v=" + V);
    S.lib.catch(() => { S.lib = null; });
  }
  return S.lib;
}
function shotsOff() { return !!me && (me.capture === "off" || me.capture === false); }
function shield() {
  o.mask = me && Array.isArray(me.mask) ? me.mask : [];
  o.fill = solid(accent());
  return o;
}
function solid(color) {
  const probe = h("i", { hidden: true });
  probe.style.color = color;
  if (!probe.style.color || !panel) return "#3b7dd8";
  panel.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return /^rgb/.test(c) ? c : "#3b7dd8";
}
function settled() {
  if (me) return Promise.resolve(me);
  return call("GET", "/me?path=" + enc(location.pathname)).then((m) => (m ? (me = m) : null), () => null);
}
function capture(full, shown) {
  const since = Date.now();
  return settled().then((m) => {
    if (!m) throw Object.assign(new Error("capture settings missing"), { why: "capture_unknown" });
    if (shotsOff()) throw new Error("capture off");
    return lib().then((l) => l.capture(shield(), full, since, shown));
  });
}
function why(e) {
  return e && e.slow ? "capture_slow" : e && e.why ? e.why : "capture_failed";
}
function encode(canvas, q) {
  return new Promise((r) => canvas.toBlob(r, "image/webp", q)).then((b) => (b && b.type === "image/webp" ? b : new Promise((r) => canvas.toBlob(r, "image/jpeg", q))));
}
function release(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
function preview(canvas, max) {
  const c = picture(say("preview"));
  c.width = Math.min(max || THUMB, canvas.width);
  c.height = Math.max(1, Math.round(canvas.height * (c.width / canvas.width)));
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}
function accent() {
  return (panel && getComputedStyle(panel).getPropertyValue("--p99-accent").trim()) || "#3b7dd8";
}
function legible() {
  o.host.style.removeProperty("--p99-on-accent");
  const t = me && me.theme;
  if (t && typeof t === "object" && ("on-accent" in t || (t.dark && typeof t.dark === "object" && "on-accent" in t.dark))) return;
  const probe = h("i", { hidden: true });
  probe.style.color = accent();
  if (!probe.style.color) return;
  panel.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  if (!c.startsWith("rgb")) return;
  const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
    const x = (v * 0.8) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  if (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.2) o.host.style.setProperty("--p99-on-accent", "#0c1a2b");
}
function drawMarks(shot, marks, page) {
  const c = document.createElement("canvas");
  c.width = shot.canvas.width;
  c.height = shot.canvas.height;
  const g = c.getContext("2d");
  g.drawImage(shot.canvas, 0, 0);
  const color = accent();
  const k = shot.scale;
  g.lineWidth = Math.max(2, 3 * k);
  g.font = "700 " + Math.round(14 * k) + "px system-ui, sans-serif";
  marks.forEach((m, i) => {
    const v = m.mark.viewport;
    if (!page && (v.scroll_x !== shot.sx || v.scroll_y !== shot.sy || v.w !== shot.vw)) return;
    const ox = page ? v.scroll_x : 0, oy = page ? v.scroll_y : 0;
    const x = (m.mark.rect.x + ox) * k, y = (m.mark.rect.y + oy) * k, w = m.mark.rect.w * k, hh = m.mark.rect.h * k;
    g.strokeStyle = color;
    g.strokeRect(x, y, w, hh);
    const label = String(i + 1), pad = 4 * k, tw = g.measureText(label).width + pad * 2, th = 18 * k;
    g.fillStyle = color;
    g.fillRect(x, Math.max(0, y - th), tw, th);
    g.fillStyle = "#fff";
    g.fillText(label, x + pad, Math.max(0, y - th) + th - 5 * k);
  });
  return c;
}
function marked(d, page) {
  const shot = page ? d.page : d.shot;
  const key = shot.id + ":" + d.marks.map((m) => { const r = m.mark.rect; return r.x + "," + r.y + "," + r.w + "," + r.h; }).join(";");
  const slot = page ? "pagePreview" : "shotPreview";
  if (!d[slot] || d[slot].key !== key) {
    const full = drawMarks(shot, d.marks, page);
    if (d[slot]) release(d[slot].view);
    d[slot] = { key, view: preview(full, page ? 320 : THUMB) };
    release(full);
  }
  return d[slot].view;
}
function crop(shot, rect, ox, oy) {
  const k = shot.scale;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect.w * k));
  c.height = Math.max(1, Math.round(rect.h * k));
  c.getContext("2d").drawImage(shot.canvas, Math.round((rect.x + (ox || 0)) * k), Math.round((rect.y + (oy || 0)) * k), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}
function letGo(set) {
  if (!set) return;
  if (set.shot) release(set.shot.canvas);
  if (set.page) release(set.page.canvas);
  set.crops.forEach(release);
}
function sameView(a, b) { return a === b || (!!a && !!b && a.sx === b.sx && a.sy === b.sy && a.vw === b.vw); }
function showAreas(form, d, shown) {
  const now = { shown: d.shown, shot: d.shot, page: d.page, crops: new Map(d.marks.map((m) => [m, m.crop])) };
  const back = d.held;
  const pb = box(form, "page");
  d.held = now;
  d.shown = shown;
  if (back && back.shown === shown && sameView(back.shot, now.shot) && (!pb.checked || back.page) && d.marks.every((m) => !now.crops.get(m) || back.crops.get(m))) {
    d.shot = back.shot;
    d.page = back.page;
    d.marks.forEach((m) => { m.crop = back.crops.get(m) || null; });
    paintShot(form);
    paintMarks(form);
    return;
  }
  letGo(back);
  d.shot = d.page = null;
  d.marks.forEach((m) => { m.crop = null; });
  d.retaking = true;
  const at = { sx: Math.round(scrollX), sy: Math.round(scrollY), vw: document.documentElement.clientWidth || innerWidth };
  const seen = (m, s) => { const v = m.mark.viewport; return sameView(s, { sx: v.scroll_x, sy: v.scroll_y, vw: v.w }); };
  const needPage = pb.checked || d.marks.some((m) => now.crops.get(m) && !seen(m, at));
  const work = capture(false, shown).catch(() => null).then((s) => Promise.resolve(needPage && s ? capture(true, shown).catch(() => null) : null).then((p) => [s, p]));
  const done = work.then(([s, p]) => {
    d.retaking = false;
    d.pageReady = null;
    if (S.draft !== d || d.held !== now) return letGo({ shot: s, page: p, crops: new Map() });
    if (!s || (needPage && !p)) {
      letGo({ shot: s, page: p, crops: new Map() });
      d.held = null;
      d.shown = now.shown;
      d.shot = now.shot;
      d.page = now.page;
      d.marks.forEach((m) => { m.crop = now.crops.get(m) || null; });
      status(form, say("capture_failed"));
    } else {
      d.shot = s;
      d.page = p;
      d.marks.forEach((m) => {
        if (!now.crops.get(m)) return;
        const v = m.mark.viewport;
        m.crop = seen(m, s) ? crop(s, m.mark.rect) : crop(p, m.mark.rect, v.scroll_x, v.scroll_y);
      });
    }
    paintShot(form);
    paintMarks(form);
  });
  d.shotReady = done;
  d.pageReady = needPage ? done : null;
  paintShot(form);
  paintMarks(form);
}

function newDraft(off) {
  const d = { at: here(), uid: uid(), shot: null, shotErr: false, page: null, pageReady: null, marks: [], files: [], key: null, uploads: null, started: !!off, off: !!off, hides: false, shown: false, held: null, retaking: false };
  d.dispose = () => {
    letGo(d.held);
    d.held = null;
    if (d.shot) release(d.shot.canvas);
    if (d.page) release(d.page.canvas);
    d.marks.forEach((m) => release(m.crop));
    if (d.shotPreview) release(d.shotPreview.view);
    if (d.pagePreview) release(d.pagePreview.view);
    d.shot = d.page = d.shotPreview = d.pagePreview = null;
    d.marks = [];
  };
  d.shotReady = off ? Promise.resolve(null) : new Promise((resolve) => {
    d.startShot = () => {
      if (d.started) return;
      d.started = true;
      capture(false, false).then((s) => { d.shot = s; d.hides = s.hid > 0; resolve(s); }, (e) => { d.shotErr = why(e); resolve(null); });
    };
  });
  return d;
}
function cardFlow() {
  if (!owner()) return list(S.list || defaultList());
  const form = S.view === "card" && scroller.querySelector(".p99-new");
  if (form) return form.elements.title.focus();
  clearOutlines();
  if (S.draft) S.draft.dispose();
  const d = (S.draft = newDraft(true));
  d.card = true;
  S.view = "card";
  S.seq++;
  const f = newForm(d);
  mount(f, f.elements.title);
}
function projectPick(form) {
  const sel = h("select", { name: "project", required: true });
  Promise.all([home(), call("GET", "/projects")]).then(([at, r]) => {
    const want = o.project || at || "";
    const names = ((r && r.projects) || []).map((x) => x && x.name).filter((n) => typeof n === "string" && (o.space || !at || n === at));
    sel.append(...names.map((n) => h("option", { value: n, selected: n === want, text: n })));
    if (!names.length) status(form, say("projects_none"));
  }, (e) => status(form, loadProblem(e)));
  return h("label", { class: "p99-field" }, h("span", { text: say("new_project") }), sel);
}
function fileFlow() {
  const form = S.view === "new" && scroller.querySelector(".p99-new");
  if (form) return form.elements.title.focus();
  clearOutlines();
  if (S.draft) S.draft.dispose();
  const d = (S.draft = newDraft(shotsOff()));
  S.view = "new";
  S.seq++;
  const f = newForm(d);
  mount(f, f.elements.title);
  if (!d.off) requestAnimationFrame(() => setTimeout(d.startShot, 0));
}
function newForm(d) {
  const kinds = KINDS.filter((k) => k !== "task" || owner());
  const card = !!d.card;
  const pick = (role, checked, disabled, label, fig, name) => h("div", { class: "p99-pick", "data-role": role, hidden: !!name },
    h("label", null, h("input", { type: "checkbox", name: name || "attach", value: role, checked, disabled }), " ", h("span", { text: label })), fig);
  const input = h("input", { type: "file", name: "files", multiple: true });
  const drop = h("div", { class: "p99-drop" }, h("label", null, h("span", { text: say("new_files_hint") }), input));
  const form = h("form", { class: "p99-view p99-new", "data-view": card ? "card" : "new", novalidate: true },
    h("h2", { id: "p99-title", text: say(card ? "new_card" : "new_title") }),
    h("fieldset", { class: "p99-kinds" }, h("legend", { text: say("new_kind") }), kinds.map((k, i) =>
      h("label", null, h("input", { type: "radio", name: "kind", value: k, checked: i === 0 }), " ", h("span", { text: say("kind_" + k) })))),
    h("label", { class: "p99-field" }, h("span", { text: say("new_title_label") }), h("input", { name: "title", maxlength: "400", required: true, autocomplete: "off", placeholder: say("new_title_hint") })),
    h("label", { class: "p99-field" }, h("span", { text: say("new_body_label") }), h("textarea", { name: "body", maxlength: "40000", rows: "5", placeholder: say("new_body_hint") })),
    card ? null : d.off ? h("p", { class: "p99-note p99-no-shot", role: "note", text: say("no_capture") }) : h("section", { class: "p99-capture", "aria-label": say("new_capture") },
      h("fieldset", { class: "p99-shots-pick" }, h("legend", { text: say("new_capture") }),
        pick("mask", true, false, say("mask_areas"), null, "mask"),
        pick("screenshot", true, false, say("attach_screen"), h("figure", { class: "p99-shot", "data-role": "screenshot" })),
        pick("page", false, false, say("attach_page"), h("figure", { class: "p99-shot", "data-role": "page" })),
        pick("region", false, true, say("attach_regions"), h("div", { class: "p99-regions", "data-role": "region" }))),
      h("div", { class: "p99-capture-actions" }, h("button", { type: "button", class: "p99-mark-start", text: say("new_mark"), onclick: () => startMarking(form) })),
      h("ol", { class: "p99-marks" })),
    h("section", { class: "p99-attach", "aria-label": say("new_files") }, drop, h("ul", { class: "p99-file-list" })),
    card ? null : h("p", { class: "p99-note p99-privacy", text: say(d.off ? "new_privacy_text" : "new_privacy") }),
    statusLine(),
    h("div", { class: "p99-actions" }, h("button", { type: "button", text: say("cancel"), onclick: () => close() }), h("button", { type: "submit", text: say("send") })));
  if (card) form.querySelector(".p99-kinds").before(projectPick(form));
  input.addEventListener("change", () => { addFiles(form, input.files); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); if (e.dataTransfer) addFiles(form, e.dataTransfer.files); });
  form.addEventListener("paste", (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); addFiles(form, files); }
  });
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "mask") return showAreas(form, d, !t.checked);
    if (t.name !== "attach") return;
    if (t.value === "page" && t.checked && !d.page && !d.pageReady) {
      if (planned(d, form) > MAX_FILES) { t.checked = false; return status(form, say("too_many_files")); }
      d.pageReady = Promise.resolve(d.shotReady).then(() => capture(true, d.shown)).then((s) => { d.page = s; }, (e) => { status(form, say(why(e))); t.checked = false; }).then(() => {
        d.pageReady = null;
        if (S.draft === d) paintShot(form);
      });
    }
    paintShot(form);
    if (t.value === "region") paintMarks(form);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitNew(form); });
  if (!d.off) {
    paintShot(form, d);
    d.shotReady.then(() => { if (S.draft === d) paintShot(form); });
  }
  return form;
}
function box(form, role) { return form.querySelector("input[name=attach][value=" + role + "]"); }
function figure(form, role) { return form.querySelector(".p99-shot[data-role=" + role + "], .p99-regions[data-role=" + role + "]"); }
function paintShot(form, draft) {
  const d = draft || S.draft;
  if (!d || d.off || !figure(form, "screenshot")) return;
  const fig = figure(form, "screenshot"), cb = box(form, "screenshot");
  clear(fig);
  if (d.shot) fig.append(marked(d, false));
  else if (d.shotErr) fig.append(h("figcaption", { class: "p99-shot-error", text: say(d.shotErr) }));
  else fig.append(h("div", { class: "p99-shimmer p99-shot-wait" }), h("figcaption", { text: say("capturing") }));
  fig.hidden = !cb.checked;
  if (d.shotErr && !d.shot) {
    cb.checked = false;
    cb.disabled = true;
  } else if (d.shot && cb.disabled) {
    cb.disabled = false;
    cb.checked = true;
    fig.hidden = false;
  }
  const pf = figure(form, "page"), pb = box(form, "page");
  clear(pf);
  if (d.page) pf.append(marked(d, true));
  else if (d.pageReady) pf.append(h("div", { class: "p99-shimmer p99-shot-wait" }), h("figcaption", { text: say("capturing_page") }));
  pf.hidden = !pb.checked;
  const mb = form.querySelector("input[name=mask]");
  mb.closest(".p99-pick").hidden = !d.hides;
  mb.disabled = d.retaking || !!d.pageReady;
  mb.checked = !d.shown;
  form.querySelector(".p99-privacy").textContent = say(d.shown ? "new_privacy_shown" : "new_privacy");
}
function paintMarks(form) {
  const d = S.draft;
  const ol = form.querySelector(".p99-marks");
  const regions = figure(form, "region");
  const rb = box(form, "region");
  if (rb.disabled && d.marks.length) rb.checked = true;
  rb.disabled = !d.marks.length;
  if (!d.marks.length) rb.checked = false;
  clear(ol);
  clear(regions);
  regions.hidden = !rb.checked;
  d.marks.forEach((m, i) => {
    if (m.crop) regions.append(h("figure", { class: "p99-region" }, preview(m.crop, 240), h("figcaption", { text: say("mark_n", { n: i + 1 }) })));
    const names = m.mark.elements.slice(0, 2).map((x) => x.label || x.text).filter(Boolean).join(" · ");
    ol.append(h("li", { class: "p99-mark" }, h("span", { text: say("mark_n", { n: i + 1 }) }), names ? h("small", { text: names.slice(0, 80) }) : null,
      h("button", { type: "button", class: "p99-remove", text: say("remove"), onclick: () => {
        const gone = d.marks.splice(i, 1)[0];
        if (gone) release(gone.crop);
        paintMarks(form);
        paintShot(form);
      } })));
  });
}
function planned(d, form) {
  const on = (role) => { const b = box(form, role); return !!b && b.checked; };
  let n = d.files.length;
  if (on("screenshot") && d.shot) n++;
  if (on("page") && d.page) n++;
  if (on("region")) n += d.marks.filter((m) => m.crop).length;
  return n;
}
function addFiles(form, files) {
  const d = S.draft;
  if (!d) return;
  Array.from(files || []).forEach((f) => {
    if (!fileType(f, f.name)) return status(form, say("file_type"));
    if (f.size > MAX_FILE) return status(form, say("too_big", { name: f.name }));
    if (planned(d, form) >= MAX_FILES) return status(form, say("too_many_files"));
    d.files.push({ file: f, uid: uid() });
  });
  paintFiles(form);
}
function paintFiles(form) {
  const d = S.draft;
  const ul = form.querySelector(".p99-file-list");
  clear(ul);
  d.files.forEach((f, i) => ul.append(h("li", null, h("span", { text: f.file.name || "file" }), h("small", { text: size(f.file.size) }),
    h("button", { type: "button", class: "p99-remove", text: say("remove"), onclick: () => { d.files.splice(i, 1); paintFiles(form); } }))));
}

function startMarking(form) {
  const d = S.draft;
  if (!d || S.marking || d.retaking) return;
  if (d.marks.length >= MAX_MARKS) return status(form, say("too_many_marks"));
  Promise.all([lib(), settled()]).then(([m, known]) => {
    if (S.draft !== d || S.marking || !S.open) return;
    if (!known) return status(form, say("capture_unknown"));
    if (shotsOff()) return;
    if (!m.readable(shield())) return status(form, say("capture_mask"));
    marking(form, d, m);
  }, () => status(form, say("capture_failed")));
}
function marking(form, d, lib) {
  const layer = h("div", { class: "p99-mark-layer" });
  const hint = h("p", { text: say("mark_hint") });
  const ok = h("button", { type: "button", class: "p99-mark-done", text: say("mark_done") });
  const no = h("button", { type: "button", class: "p99-mark-cancel", text: say("mark_cancel") });
  const bar = h("div", { class: "p99-mark-bar", role: "dialog", "aria-label": say("marking") }, hint, no, ok);
  root.append(layer, bar);
  panel.classList.add("is-marking");
  scrim.classList.add("is-marking");
  if (o.bar) o.bar.style.visibility = "hidden";
  const fresh = [];
  let rect = null, from = null;
  const view = { w: document.documentElement.clientWidth || innerWidth, h: innerHeight, scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY), dpr: devicePixelRatio || 1 };
  const span = (a, b) => ({ x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)) });
  const place = (n, q) => {
    n.style.transform = "translate(" + q.x + "px," + q.y + "px)";
    n.style.width = q.w + "px";
    n.style.height = q.h + "px";
  };
  layer.addEventListener("pointerdown", (e) => {
    if (d.marks.length + fresh.length >= MAX_MARKS) {
      hint.textContent = say("too_many_marks");
      return;
    }
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    from = { x: e.clientX, y: e.clientY };
    rect = h("div", { class: "p99-mark-box" });
    layer.append(rect);
    place(rect, span(from, from));
  });
  layer.addEventListener("pointermove", (e) => { if (from) place(rect, span(from, { x: e.clientX, y: e.clientY })); });
  const up = (e, cancel) => {
    if (!from) return;
    const q = span(from, { x: e.clientX, y: e.clientY });
    from = null;
    if (cancel || q.w < 12 || q.h < 12) {
      rect.remove();
      return;
    }
    layer.style.pointerEvents = "none";
    bar.style.pointerEvents = "none";
    const elements = lib.elementsAt(shield(), q);
    layer.style.pointerEvents = "";
    bar.style.pointerEvents = "";
    rect.setAttribute("data-n", String(d.marks.length + fresh.length + 1));
    fresh.push({ mark: { rect: q, viewport: view, elements }, crop: null });
  };
  layer.addEventListener("pointerup", (e) => up(e, false));
  layer.addEventListener("pointercancel", (e) => up(e, true));
  const stop = (e) => e.preventDefault();
  layer.addEventListener("wheel", stop, { passive: false });
  layer.addEventListener("touchmove", stop, { passive: false });
  const esc = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  document.addEventListener("keydown", esc, true);
  const api = {};
  const finish = (keep) => {
    if (S.marking !== api) return;
    S.marking = null;
    document.removeEventListener("keydown", esc, true);
    layer.remove();
    bar.remove();
    panel.classList.remove("is-marking");
    scrim.classList.remove("is-marking");
    if (o.bar) o.bar.style.visibility = "";
    if (keep && fresh.length) {
      status(form, say("capturing"));
      const same = d.shot && d.shot.sx === view.scroll_x && d.shot.sy === view.scroll_y && d.shot.vw === view.w;
      const ready = same ? Promise.resolve(d.shot) : capture(false, d.shown).then((s) => {
        if (d.shot) release(d.shot.canvas);
        letGo(d.held);
        d.held = null;
        d.shot = s;
        d.shotErr = false;
        return s;
      }, () => d.shot);
      ready.then((shot) => {
        fresh.forEach((m) => {
          if (shot && shot.sx === view.scroll_x && shot.sy === view.scroll_y) m.crop = crop(shot, m.mark.rect);
          d.marks.push(m);
        });
        if (S.draft !== d) return;
        status(form, "");
        paintMarks(form);
        paintShot(form);
      });
    }
    const again = form.querySelector(".p99-mark-start");
    if (again && again.isConnected) again.focus();
  };
  api.finish = finish;
  ok.addEventListener("click", () => finish(true));
  no.addEventListener("click", () => finish(false));
  S.marking = api;
  ok.focus();
}

function showMarks(marks) {
  clearOutlines();
  const layer = h("div", { class: "p99-outlines" });
  root.append(layer);
  const boxes = [];
  let first = null;
  marks.forEach((m, i) => {
    let found = null, own = null;
    (m.elements || []).some((x) => {
      try { found = x.selector ? document.querySelector(x.selector) : null; } catch (e) { found = null; }
      if (found) own = x;
      return !!found;
    });
    boxes.push({ i, node: found, own, mark: m });
    if (!first) first = found;
  });
  if (first) first.scrollIntoView({ block: "center", behavior: "auto" });
  else if (marks[0] && marks[0].viewport) scrollTo(marks[0].viewport.scroll_x || 0, marks[0].viewport.scroll_y || 0);
  const color = accent();
  boxes.forEach((b) => {
    let q = null;
    if (b.node) {
      const r = b.node.getBoundingClientRect();
      const m = b.mark, own = b.own;
      q = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      if (own && own.box && m.rect) q = { x: r.left + scrollX + (m.rect.x - own.box.x), y: r.top + scrollY + (m.rect.y - own.box.y), w: m.rect.w, h: m.rect.h };
    } else if (b.mark.rect && b.mark.viewport) {
      q = { x: b.mark.rect.x + (b.mark.viewport.scroll_x || 0), y: b.mark.rect.y + (b.mark.viewport.scroll_y || 0), w: b.mark.rect.w, h: b.mark.rect.h };
    }
    if (!q) return;
    const n = h("div", { class: "p99-outline", "data-n": String(b.i + 1) });
    n.style.transform = "translate(" + Math.round(q.x) + "px," + Math.round(q.y) + "px)";
    n.style.width = Math.round(q.w) + "px";
    n.style.height = Math.round(q.h) + "px";
    n.style.borderColor = color;
    layer.append(n);
  });
  const follow = () => { layer.style.transform = "translate(" + -scrollX + "px," + -scrollY + "px)"; };
  follow();
  addEventListener("scroll", follow, { passive: true });
  S.outlines = { layer, follow };
  if (phone.matches) close();
  setTimeout(() => document.addEventListener("pointerdown", clearOutlines, { once: true, capture: true }), 0);
}
function clearOutlines() {
  if (!S.outlines) return;
  S.outlines.layer.remove();
  removeEventListener("scroll", S.outlines.follow);
  S.outlines = null;
}

function submitNew(form) {
  const d = S.draft;
  if (!d || d.busy) return;
  const title = form.elements.title.value.trim();
  if (!title) {
    status(form, say("title_needed"));
    form.elements.title.focus();
    return;
  }
  if (over(title, 200)) return refuse(form, form.elements.title, 200);
  if (over(form.elements.body.value, 20000)) return refuse(form, form.elements.body, 20000);
  const project = d.card ? form.elements.project.value : "";
  if (d.card && !project) return status(form, say("project_needed"));
  const send = form.querySelector("button[type=submit]");
  d.busy = true;
  send.disabled = true;
  status(form, say("sending"));
  const kind = form.querySelector("input[name=kind]:checked");
  const filed = d.key
    ? Promise.resolve({ key: d.key })
    : d.card
    ? retrying(() => call("POST", "/cards", JSON.stringify({ client_uid: d.uid, project, kind: kind ? kind.value : "bug", title, body: form.elements.body.value }))).then((res) => ({ key: res.card.key }))
    : lib().then((m) => m.context(o, d.at), () => ({ url: d.at.origin + d.at.path, user_agent: navigator.userAgent, p99: V })).then((context) => {
        const body = fit({
          client_uid: d.uid,
          kind: kind ? kind.value : "bug",
          title,
          body: form.elements.body.value,
          page: { url: d.at.origin + d.at.path, path: d.at.path.slice(0, 512), title: d.at.title },
          context,
          marks: JSON.parse(JSON.stringify(d.marks.map((m) => m.mark)))
        });
        return retrying(() => call("POST", "/issues", JSON.stringify(body)));
      });
  filed.then((res) => {
    d.key = res.key;
    status(form, say("filed", { key: res.key }));
    return (d.uploads ? Promise.resolve(d.uploads) : Promise.all([d.shotReady, d.pageReady]).then(() => attachments(form, d)).then((items) => (d.uploads = items)))
      .then((items) => uploadAll(res.key, items, form))
      .then((failed) => {
        d.busy = false;
        o.refresh && o.refresh();
        if (failed.length) {
          send.disabled = false;
          status(form, say("sent_partial", { key: res.key }) + refused(failed), failed.some((x) => !x.dead) ? () => submitNew(form) : null);
          return;
        }
        d.dispose();
        if (S.draft !== d) return;
        S.draft = null;
        if (S.view === "new" || S.view === "card") item(res.key);
      });
  }).catch((e) => {
    d.busy = false;
    send.disabled = false;
    status(form, problem(e), transient(e) ? () => submitNew(form) : null);
  });
}
function ext(b) { return b.type === "image/webp" ? "webp" : b.type === "image/png" ? "png" : "jpg"; }
function attachments(form, d) {
  const items = [];
  const jobs = [];
  const on = (role) => { const b = box(form, role); return b && b.checked && !b.disabled; };
  if (on("screenshot") && d.shot) {
    const c = drawMarks(d.shot, d.marks, false);
    jobs.push(encode(c, 0.85).then((b) => { release(c); if (b) items.push({ uid: d.shotUid || (d.shotUid = uid()), role: "screenshot", name: "screen." + ext(b), blob: b, order: 0 }); }));
  }
  if (on("page") && d.page) {
    const c = drawMarks(d.page, d.marks, true);
    jobs.push(encode(c, 0.8).then((b) => { release(c); if (b) items.push({ uid: d.pageUid || (d.pageUid = uid()), role: "page", name: "page." + ext(b), blob: b, order: 1 }); }));
  }
  if (on("region")) {
    d.marks.forEach((m, i) => {
      if (!m.crop) return;
      jobs.push(encode(m.crop, 0.9).then((b) => { if (b) items.push({ uid: m.uid || (m.uid = uid()), role: "region", mark: i, name: "region-" + (i + 1) + "." + ext(b), blob: b, order: 2 + i }); }));
    });
  }
  return Promise.all(jobs).then(() => {
    items.sort((a, b) => a.order - b.order);
    d.files.forEach((f) => items.push({ uid: f.uid, role: "file", name: f.file.name || "file", blob: f.file }));
    return items;
  });
}
function fit(it) {
  const room = 250000;
  const each = (f) => it.marks.forEach((m) => m.elements.forEach(f));
  [200, 100, 50, 20, 0].some((cap) => { if (bytes(it) <= room) return true; each((x) => { x.text = x.text.slice(0, cap); }); });
  [100, 0].some((cap) => { if (bytes(it) <= room) return true; each((x) => { x.label = x.label.slice(0, cap); }); });
  [300, 120].some((cap) => { if (bytes(it) <= room) return true; each((x) => { x.selector = x.selector.slice(0, cap); }); });
  [8, 3, 0].some((keep) => { if (bytes(it) <= room) return true; it.marks.forEach((m) => { m.elements = m.elements.slice(0, keep); }); });
  return it;
}

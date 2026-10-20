const V = "__P99_VERSION__";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_MARKS = 10;
const DISCORD = "https://discord.gg/XsNcn3kYzn";
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const KINDS = ["bug", "feature", "improvement", "question", "task"];
const STATUSES = ["inbox", "doing", "review", "done"];
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
  brand: "Feedback",
  board: "Board",
  close: "Close",
  loading: "Loading…",
  gone: "This P99 link isn't valid here. Ask for a new one.",
  verify_title: "Confirm it's you",
  verify_help: "Enter the 6-digit code your authenticator app shows for P99. This browser is remembered after that.",
  verify_label: "Code",
  verify_send: "Confirm",
  failed: "Couldn't send; try again.",
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
  list_title: "Items",
  tab_page: "This page",
  tab_mine: "Mine",
  tab_all: "All",
  filter_status: "Status",
  filter_kind: "Kind",
  filter_search: "Search",
  filter_search_hint: "Key, title or text",
  filter_open: "Open",
  filter_closed: "Closed",
  filter_any: "Any",
  filter_every_kind: "Any kind",
  list_empty: "Nothing here.",
  unread_mark: "New for you",
  comments: { one: "1 comment", other: "{count} comments" },
  more: "More",
  new_title: "What happened?",
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
  new_files: "Files",
  new_files_hint: "Add files: pick them, drop them here or paste them",
  new_privacy: "The capture, the page's address, your browser, your screen and the page's last script errors go with it, so we see what you saw. Passwords and the fields this site marks as private are blanked.",
  send: "Send",
  cancel: "Cancel",
  back: "Back to the list",
  filed_by: "Sent by {who}, {when}",
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
  internal_note: "Internal note (the reporter doesn't see it)",
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
  delete: "Delete {key}",
  delete_warn: "Its comments, files and history go with it, and this can't be undone.",
  delete_type: "Type {key} to confirm",
  delete_go: "Hold to delete {key}",
  delete_hold: "Keep holding until the button fills.",
  event_system: "P99",
  event_created: "opened the item",
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
  move_to: "Move to",
  move_drop: "Drop (close without fixing)",
  moved: "this card moved; refreshed",
  event_label: "moved it: {from} → {to}",
  capturing: "Capturing the screen…",
  capturing_page: "Capturing the whole page…",
  capture_failed: "The capture failed; you can send without it.",
  capture_slow: "The page took too long to capture; you can send without it.",
  marking: "Drag a box over the area. Esc stops.",
  mark_hint: "Drag a box over the area; you can mark several.",
  mark_n: "Area {n}",
  mark_done: "Done",
  mark_cancel: "Cancel",
  too_many_marks: "You can mark up to 10 areas.",
  too_big: "“{name}” is over 20 MB.",
  too_many_files: "An item holds up to 30 files.",
  file_type: "P99 takes images, PDFs, text, CSV, JSON, zip and office files.",
  title_needed: "Add a title.",
  sending: "Sending…",
  uploading: "Uploading {name}… {pct}%",
  upload_failed: "“{name}” didn't upload; try again.",
  filed: "Sent as {key}. Replies show up here.",
  sent_partial: "{key} was sent, but some files didn't upload; you can add them again from the item."
};

let o = null;
let me = null;
const S = { open: false, view: null, key: null, list: null, draft: null, marking: null, outlines: null, assets: null, files: new Map(), seq: 0 };
let root, panel, scroller, scrim;

const phone = matchMedia("(max-width: 599px)");
const still = matchMedia("(prefers-reduced-motion: reduce)");

export function open(opts) {
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
  if (opts.view === 401) return Promise.resolve(gone());
  const ready = ensure();
  if (opts.view === "list" && S.open && S.view === "list" && !opts.space) return close();
  return ready.then(() => {
    show();
    const go = () => {
      if (opts.key) item(opts.key);
      else if (opts.view === "list") list(S.list || defaultList());
      else fileFlow();
    };
    if (S.verify) verify(go);
    else go();
  }).catch(() => {});
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
function who(p, agent) {
  return nameOf(p) + (isAgent(p, agent) ? "*" : "");
}
function person(p, agent) {
  return [nameOf(p), isAgent(p, agent) ? h("span", { class: "p99-ai", title: "AI", text: "*" }) : null];
}

function api(path) {
  return "/_p99/api" + path + (o.space ? (path.includes("?") ? "&" : "?") + "host=" + enc(o.space) : "");
}
function auth() {
  return o.space ? { "X-P99-App": "1" } : { "X-P99-Code": o.code };
}
function call(method, path, body, type) {
  const headers = Object.assign(auth(), { Accept: "application/json" });
  if (body != null) headers["Content-Type"] = type || "application/json";
  return fetch(api(path), { method, headers, body, credentials: "same-origin" }).then((r) =>
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
      const transient = !e.status || e.status >= 500 || e.status === 429 || e.status === 408;
      if (!transient || attempt >= 3) throw e;
      attempt++;
      return wait(600 * Math.pow(2, attempt - 1)).then(go);
    });
  return go();
}
function problem(e) { return navigator.onLine ? (e && e.message) || say("failed") : say("offline"); }

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
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
function thumb(a) {
  const img = h("img", { alt: a.name || say("preview"), src: BLANK });
  blobOf(a.id).then(dataUrl).then((u) => { img.src = u; }, () => {});
  return img;
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
  if (S.assets) return S.assets;
  root = o.root;
  const css = fetch("/_p99/p99.css?v=" + V).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const self = me ? Promise.resolve(me) : call("GET", "/me?path=" + enc(location.pathname)).catch(() => null);
  S.assets = Promise.all([css, self]).then(([text, m]) => {
    if (m) me = m;
    const base = new CSSStyleSheet();
    base.replaceSync(text);
    const tint = new CSSStyleSheet();
    S.tint = tint;
    try { tint.replaceSync(theme(me && me.theme)); } catch (x) {}
    chrome();
    root.adoptedStyleSheets = root.adoptedStyleSheets.concat([base, tint]);
  });
  S.assets.catch(() => { S.assets = null; });
  return S.assets;
}
function theme(t) {
  if (!t || typeof t !== "object") return "";
  const rules = (obj) => {
    let out = "";
    for (const k in obj) {
      const v = obj[k];
      if (typeof v !== "string" && typeof v !== "number") continue;
      if (!/^[a-z0-9-]{1,40}$/.test(k) || /[;{}<>\\]/.test(String(v))) continue;
      out += "--p99-" + k + ":" + v + ";";
    }
    return out;
  };
  let css = ":host{" + rules(t) + "}";
  if (t.dark && typeof t.dark === "object") css += "@media (prefers-color-scheme: dark){:host{" + rules(t.dark) + "}}";
  return css;
}

function chrome() {
  scrim = h("div", { class: "p99-scrim", hidden: true, onclick: () => close() });
  scroller = h("div", { class: "p99-scroll" });
  const x = h("button", { type: "button", class: "p99-x", "aria-label": say("close"), title: say("close"), onclick: () => close() }, h("span", { "aria-hidden": "true", text: "×" }));
  const grip = h("div", { class: "p99-grip", "aria-hidden": "true" });
  const board = me && me.manager ? h("button", { type: "button", class: "p99-board-open", text: say("board"), onclick: openBoard, onpointerenter: boardModule, onfocus: boardModule }) : null;
  const head = h("div", { class: "p99-head" }, grip, h("div", { class: "p99-brand" }, h("b", { class: "p99-logo", text: "P99" }), h("span", { class: "p99-logo-name", text: o.space || say("brand") })), board, x);
  const foot = me && me.manager ? h("p", { class: "p99-foot" }, "P99: got questions or doubts? ", h("a", { href: DISCORD, target: "_blank", rel: "noopener noreferrer", text: "Ping me on Discord" }), ".") : null;
  panel = h("div", { class: "p99-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "p99-title", tabindex: "-1", hidden: true }, head, scroller, foot);
  root.append(scrim, panel);
  swipe(head);
  root.addEventListener("keydown", keys);
  phone.addEventListener("change", () => { if (S.open) scrim.hidden = !phone.matches; });
}
function boardModule() {
  if (!S.board) S.board = import("/_p99/board.js?v=" + V).catch((e) => { S.board = null; throw e; });
  return S.board;
}
function openBoard() {
  close(true);
  const resume = o.closed ? () => open(Object.assign({}, o, { view: "list", key: null })) : null;
  boardModule().then((m) => m.open({ root, call, me, h, host: o.space, closed: resume, item: (key, from) => open(Object.assign({}, o, { view: "item", key, from })) }), () => {});
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
    if (!phone.matches || e.target.closest("button")) return;
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
  sheet.replaceSync(".p99-gone{display:flex;align-items:center;gap:4px;max-width:min(340px,calc(100vw - 32px));margin:0;padding:6px 4px 6px 12px;border-radius:12px;background:#0c1a2b;color:#fff;font:500 13px/1.35 system-ui;box-shadow:0 4px 14px #0005;animation:p99-gone .3s cubic-bezier(.2,.7,.2,1)}.p99-gone button{all:unset;flex:none;cursor:pointer;width:32px;height:32px;border-radius:50%;text-align:center;font:700 18px/32px system-ui}.p99-gone button:focus-visible{outline:2px solid #fff}@keyframes p99-gone{from{opacity:0;transform:translateY(8px)}}@media (prefers-reduced-motion:reduce){.p99-gone{animation:none}}");
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
        return call("GET", "/me?path=" + enc(location.pathname)).then((m) => {
          me = m;
          try { S.tint.replaceSync(theme(m && m.theme)); } catch (x) {}
        }, () => {});
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
function mount(view, focus) {
  if (S.verify && !view.classList.contains("p99-verify")) return;
  clear(scroller);
  scroller.append(view);
  scroller.scrollTop = 0;
  if (!focus) return;
  if (!/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(focus.tagName) && !focus.hasAttribute("tabindex")) focus.setAttribute("tabindex", "-1");
  try { focus.focus({ preventScroll: true }); } catch (x) { focus.focus(); }
}
function failure(e) {
  const p = h("p", { class: "p99-error", role: "alert", id: "p99-title", text: problem(e) });
  mount(h("section", { class: "p99-view" }, p), p);
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
  const named = me && me.manager && Array.isArray(me.statuses) ? me.statuses.find((x) => x.key === key) : null;
  if (!named) return say("status_" + (res || key));
  return res && res !== "fixed" ? named.name + " · " + say("status_" + res) : named.name;
}
function stateOf(x) { return choiceOf(x.stage || x.status, x.resolution); }
function statusPill(x) {
  const c = stateOf(x);
  const res = c.split(":")[1];
  const named = x.label && me && me.manager ? x.label + (res && res !== "fixed" ? " · " + say("status_" + res) : "") : null;
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
  const c = (me && me.counts) || {};
  if (c.page_open > 0 && !o.space) return { scope: "page", status: "open", kind: "", q: "" };
  if (me && me.manager) return { scope: "all", status: "open", kind: "", q: "" };
  return { scope: "mine", status: "open", kind: "", q: "" };
}
function listQuery(f, cursor) {
  const q = new URLSearchParams({ scope: f.scope, status: f.status || "open" });
  if (f.scope === "page") q.set("path", location.pathname);
  if (f.kind) q.set("kind", f.kind);
  if (f.q) q.set("q", f.q);
  if (cursor) q.set("cursor", cursor);
  return "/issues?" + q;
}
function list(f) {
  S.view = "list";
  S.list = f;
  const seq = ++S.seq;
  mount(skeleton());
  call("GET", listQuery(f)).then((res) => {
    if (seq !== S.seq || !S.open) return;
    const title = h("h2", { id: "p99-title", text: say("list_title") });
    const tabs = (o.space ? [] : ["page"]).concat(["mine"], me && me.manager ? ["all"] : []);
    const nav = h("nav", { class: "p99-tabs", "aria-label": say("list_title") }, tabs.map((t) =>
      h("a", { href: "#", "aria-current": t === f.scope ? "page" : null, text: say("tab_" + t), onclick: (e) => { e.preventDefault(); list(Object.assign({}, f, { scope: t })); } })
    ));
    const items = h("ol", { class: "p99-items" });
    const view = h("section", { class: "p99-view", "data-view": "list" }, title, nav, filters(f));
    const rows = (res && res.issues) || [];
    if (!rows.length) view.append(h("p", { class: "p99-empty", text: say("list_empty") }));
    else view.append(items);
    rows.forEach((r) => items.append(row(r)));
    more(view, items, f, res && res.next_cursor);
    mount(view, title);
  }, (e) => { if (seq === S.seq) failure(e); });
}
function more(view, items, f, cursor) {
  if (!cursor) return;
  const b = h("button", { type: "button", class: "p99-more", text: say("more") });
  b.addEventListener("click", () => {
    b.disabled = true;
    call("GET", listQuery(f, cursor)).then((res) => {
      b.remove();
      ((res && res.issues) || []).forEach((r) => items.append(row(r)));
      more(view, items, f, res && res.next_cursor);
    }, () => { b.disabled = false; });
  });
  view.append(b);
}
function filters(f) {
  const status = h("select", { name: "status" },
    [["open", say("filter_open")], ["closed", say("filter_closed")], ["any", say("filter_any")]].concat(STATUSES.filter((s) => s !== "done").map((s) => [s, statusWord(s)]))
      .map(([v, l]) => h("option", { value: v, selected: (f.status || "open") === v, text: l })));
  const kind = h("select", { name: "kind" }, [["", say("filter_every_kind")]].concat(KINDS.map((k) => [k, say("kind_" + k)])).map(([v, l]) => h("option", { value: v, selected: f.kind === v, text: l })));
  const q = h("input", { type: "search", name: "q", value: f.q || "", placeholder: say("filter_search_hint"), autocomplete: "off" });
  const apply = () => list(Object.assign({}, f, { status: status.value, kind: kind.value, q: q.value.trim() }));
  status.addEventListener("change", apply);
  kind.addEventListener("change", apply);
  let timer = 0;
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 260); });
  return h("form", { class: "p99-filters", role: "search", onsubmit: (e) => { e.preventDefault(); apply(); } },
    h("label", null, h("span", { text: say("filter_status") }), status),
    h("label", null, h("span", { text: say("filter_kind") }), kind),
    h("label", null, h("span", { text: say("filter_search") }), q));
}
function row(r) {
  const meta = [h("span", { class: "p99-path", text: (r.page && r.page.path) || "" })];
  if (me && me.manager && r.reporter) meta.push(" · ", h("span", { class: "p99-reporter" }, person(r.reporter)));
  meta.push(" · ", h("time", { text: when(r.created_at) }));
  if (r.comments > 0) meta.push(" · ", h("span", { class: "p99-comments", text: say("comments", { count: r.comments }, r.comments) }));
  return h("li", { class: "p99-item", "data-status": stateOf(r), "data-kind": r.kind, "data-unread": !!r.unread },
    h("a", { href: "#p99=" + r.key, onclick: (e) => { e.preventDefault(); item(r.key); } },
      h("span", { class: "p99-key", text: r.key }),
      h("b", { class: "p99-item-title", text: r.title }),
      r.unread ? h("span", { class: "p99-unread", text: say("unread_mark") }) : null,
      statusPill(r),
      kindPill(r.kind),
      h("small", { class: "p99-meta" }, meta)),
    landing(r.landing));
}

function item(key) {
  S.view = "item";
  S.key = key;
  clearOutlines();
  const seq = ++S.seq;
  mount(skeleton());
  return call("GET", "/issues/" + enc(key)).then((t) => {
    if (seq !== S.seq || !S.open || !t || !t.issue) return;
    const view = thread(t);
    mount(view, view.querySelector("#p99-title"));
    o.refresh && o.refresh();
  }, (e) => { if (seq === S.seq) failure(e); });
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
  const manager = !!(me && me.manager);
  const mine = !!(me && i.reporter && i.reporter.email && me.email && i.reporter.email.toLowerCase() === me.email.toLowerCase());
  const files = t.attachments || [];
  const byId = new Map(files.map((a) => [a.id, a]));
  const meta = [say("filed_by", { who: who(i.reporter), when: when(i.created_at) }), " · ", say("updated", { when: when(i.updated_at) })];
  if (manager && i.reporter && i.reporter.email) meta.push(" · ", h("span", { text: i.reporter.email }));
  if (manager && i.env) meta.push(" · ", h("span", { text: i.env }));
  if (i.assignee) meta.push(" · ", h("span", { class: "p99-person" }, disc(i.assignee.username, 16), say("assigned_to", { who: handle(i.assignee) })));
  if (i.duplicate_of) meta.push(" · ", h("a", { href: "#p99=" + enc(i.duplicate_of), text: say("duplicate_of", { n: i.duplicate_of }), onclick: (e) => { e.preventDefault(); item(i.duplicate_of); } }));
  const page = i.page || {};
  const dest = pageUrl(page.path);
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
  if (manager) view.append(manageForm(i), deleteBox(i));
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
function pageUrl(path) {
  if (typeof path !== "string" || !/^\/(?![\/\\])/.test(path) || /[\\\s\u0000-\u001f\u007f]/.test(path)) return null;
  try {
    const site = o.space ? "https://" + o.space : location.origin;
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
      return h("li", { class: "p99-comment", "data-internal": !!c.internal, "data-mine": self, "data-manager": !!(c.author && c.author.manager) },
        h("p", { class: "p99-meta" }, h("b", null, person(c.author)), " · ", h("time", { text: when(c.created_at) }), c.internal ? [" · ", h("span", { class: "p99-internal", text: say("internal") })] : null),
        c.body ? h("div", { class: "p99-body" }, pieces(c.body)) : null,
        files.length ? fileList(files) : null);
    }
    const text = eventText(x.ev);
    if (!text) return null;
    return h("li", { class: "p99-event", "data-event-kind": x.ev.kind }, h("small", null, h("b", null, person(x.ev.actor_name || x.ev.actor, x.ev.agent)), " ", text, " · ", h("time", { text: when(x.ev.at) })));
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
    h("label", { class: "p99-field" }, h("span", { text: say("comment_label") }), h("textarea", { name: "body", maxlength: "20000", rows: "3", placeholder: say("comment_hint") })),
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
  form.p99Busy = true;
  form.p99Uid = form.p99Uid || uid();
  const send = form.querySelector("button[type=submit]");
  send.disabled = true;
  status(form, say("sending"));
  const internal = form.elements.internal ? form.elements.internal.checked : false;
  const made = form.p99Comment ? Promise.resolve(form.p99Comment) : retrying(() =>
    call("POST", "/issues/" + enc(key) + "/comments", JSON.stringify({ client_uid: form.p99Uid, body: body.slice(0, 20000), internal })));
  made.then((res) => {
    form.p99Comment = res;
    const items = files.map((f) => ({ uid: f.uid, role: "file", name: f.file.name || "file", blob: f.file, comment: res.id, done: f.done, dead: f.dead, ref: f }));
    return uploadAll(key, items, form).then((failed) => {
      items.forEach((it) => { it.ref.done = it.done; it.ref.dead = it.dead; });
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
    status(form, problem(e), !e.status || e.status >= 500 ? () => submitComment(form, key) : null);
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
    Promise.resolve(o.find(q)).then((list) => {
      if (n !== ask || root.activeElement !== input) return;
      opts = list;
      clear(lb);
      list.forEach((x, j) => lb.append(h("li", { id: id + "-" + j, role: "option", "aria-selected": "false", class: x.make ? "is-new" : null }, x.el || h("span", { text: x.text }), x.sub ? h("small", { text: x.sub }) : null)));
      if (!list.length) lb.append(h("li", { role: "option", "aria-disabled": "true", class: "p99-none", text: say("no_match") }));
      show(true);
      mark(q && list.length ? 0 : -1);
    }, () => {});
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
function disc(username, size) {
  const img = h("img", { class: "p99-disc", alt: "", width: size, height: size, src: BLANK });
  if (!S.avatar) {
    S.avatar = import("/_p99/avatar.js?v=" + V);
    S.avatar.catch(() => { S.avatar = null; });
  }
  S.avatar.then((m) => { img.src = m.avatarSrc(username, size); }, () => {});
  return img;
}
function handle(p) {
  return p && p.username ? "@" + p.username : "";
}
function assigneePick(i) {
  const none = { value: "", text: say("nobody") };
  const of = (p) => ({ value: p.username, text: handle(p), el: h("span", { class: "p99-person" }, disc(p.username, 20), handle(p)) });
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
    const to = form.querySelector(".p99-move-to select");
    const drop = to.selectedOptions[0] && to.selectedOptions[0].dataset.drop;
    if (!drop && to.value === i.label) return patch(i.key, data, form);
    if (form.p99Busy) return;
    form.p99Busy = true;
    status(form, say("sending"));
    call("POST", "/move", JSON.stringify(drop ? { key: i.key, from: i.label, to: drop, resolution: "abandoned" } : { key: i.key, from: i.label, to: to.value })).then(() => {
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
  call("GET", "/boards").then((r) => {
    const seen = new Set([i.label.toLowerCase()]);
    const more = [];
    let shut = null;
    for (const b of (r && r.boards) || []) if (b.mine) for (const c of b.columns || []) {
      if (!shut && c.closes) shut = c.label;
      if (seen.has(c.label.toLowerCase())) continue;
      seen.add(c.label.toLowerCase());
      more.push(h("option", { value: c.label, text: c.label }));
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
function editForm(i) {
  const form = h("form", { class: "p99-edit", novalidate: true },
    h("h3", { text: say("edit") }),
    h("label", { class: "p99-field" }, h("span", { text: say("new_title_label") }), h("input", { name: "title", maxlength: "200", value: i.title, required: true })),
    h("label", { class: "p99-field" }, h("span", { text: say("new_body_label") }), h("textarea", { name: "body", maxlength: "20000", rows: "4", text: i.body || "" })),
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
      if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) it.dead = true;
      failed.push(it);
    });
  }), Promise.resolve()).then(() => failed);
}
function refused(failed) {
  return failed.filter((x) => x.dead).map((x) => " " + say("upload_failed", { name: x.name })).join("");
}

function here() {
  return { origin: location.origin, path: location.pathname, title: document.title.slice(0, 300) };
}
function bytes(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
function lib() {
  if (!S.lib) {
    S.lib = import("/_p99/capture.js?v=" + V);
    S.lib.catch(() => { S.lib = null; });
  }
  return S.lib;
}
function capture(full) {
  const since = Date.now();
  return lib().then((m) => m.capture(o, full, since));
}
function encode(canvas, q) {
  return new Promise((r) => canvas.toBlob(r, "image/webp", q)).then((b) => (b && b.type === "image/webp" ? b : new Promise((r) => canvas.toBlob(r, "image/jpeg", q))));
}
function release(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
function image(src) { return h("img", { src, alt: say("preview") }); }
function preview(canvas, max) {
  const w = Math.min(max || 640, canvas.width);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  const src = c.toDataURL("image/jpeg", 0.8);
  release(c);
  return image(src);
}
function accent() {
  return (panel && getComputedStyle(panel).getPropertyValue("--p99-accent").trim()) || "#3b7dd8";
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
    d[slot] = { key, src: preview(full, page ? 320 : 640).src };
    release(full);
  }
  return image(d[slot].src);
}
function crop(shot, rect) {
  const k = shot.scale;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect.w * k));
  c.height = Math.max(1, Math.round(rect.h * k));
  c.getContext("2d").drawImage(shot.canvas, Math.round(rect.x * k), Math.round(rect.y * k), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function newDraft() {
  const d = { at: here(), uid: uid(), shot: null, shotErr: false, page: null, pageReady: null, marks: [], files: [], key: null, uploads: null, started: false };
  d.dispose = () => {
    if (d.shot) release(d.shot.canvas);
    if (d.page) release(d.page.canvas);
    d.marks.forEach((m) => release(m.crop));
    d.shot = d.page = null;
    d.marks = [];
  };
  d.shotReady = new Promise((resolve) => {
    d.startShot = () => {
      if (d.started) return;
      d.started = true;
      capture(false).then((s) => { d.shot = s; resolve(s); }, (e) => { d.shotErr = e && e.slow ? "capture_slow" : "capture_failed"; resolve(null); });
    };
  });
  return d;
}
function fileFlow() {
  const form = S.view === "new" && scroller.querySelector(".p99-new");
  if (form) return form.elements.title.focus();
  clearOutlines();
  if (S.draft) S.draft.dispose();
  const d = (S.draft = newDraft());
  S.view = "new";
  S.seq++;
  const f = newForm(d);
  mount(f, f.elements.title);
  requestAnimationFrame(() => setTimeout(d.startShot, 0));
}
function newForm(d) {
  const kinds = KINDS.filter((k) => k !== "task" || (me && me.manager));
  const pick = (role, checked, disabled, label, fig) => h("div", { class: "p99-pick", "data-role": role },
    h("label", null, h("input", { type: "checkbox", name: "attach", value: role, checked, disabled }), " ", h("span", { text: label })), fig);
  const input = h("input", { type: "file", name: "files", multiple: true });
  const drop = h("div", { class: "p99-drop" }, h("label", null, h("span", { text: say("new_files_hint") }), input));
  const form = h("form", { class: "p99-view p99-new", "data-view": "new", novalidate: true },
    h("h2", { id: "p99-title", text: say("new_title") }),
    h("fieldset", { class: "p99-kinds" }, h("legend", { text: say("new_kind") }), kinds.map((k, i) =>
      h("label", null, h("input", { type: "radio", name: "kind", value: k, checked: i === 0 }), " ", h("span", { text: say("kind_" + k) })))),
    h("label", { class: "p99-field" }, h("span", { text: say("new_title_label") }), h("input", { name: "title", maxlength: "200", required: true, autocomplete: "off", placeholder: say("new_title_hint") })),
    h("label", { class: "p99-field" }, h("span", { text: say("new_body_label") }), h("textarea", { name: "body", maxlength: "20000", rows: "5", placeholder: say("new_body_hint") })),
    h("section", { class: "p99-capture", "aria-label": say("new_capture") },
      h("fieldset", { class: "p99-shots-pick" }, h("legend", { text: say("new_capture") }),
        pick("screenshot", true, false, say("attach_screen"), h("figure", { class: "p99-shot", "data-role": "screenshot" })),
        pick("page", false, false, say("attach_page"), h("figure", { class: "p99-shot", "data-role": "page" })),
        pick("region", false, true, say("attach_regions"), h("div", { class: "p99-regions", "data-role": "region" }))),
      h("div", { class: "p99-capture-actions" }, h("button", { type: "button", class: "p99-mark-start", text: say("new_mark"), onclick: () => startMarking(form) })),
      h("ol", { class: "p99-marks" })),
    h("section", { class: "p99-attach", "aria-label": say("new_files") }, drop, h("ul", { class: "p99-file-list" })),
    h("p", { class: "p99-note", text: say("new_privacy") }),
    statusLine(),
    h("div", { class: "p99-actions" }, h("button", { type: "button", text: say("cancel"), onclick: () => close() }), h("button", { type: "submit", text: say("send") })));
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
    if (t.name !== "attach") return;
    if (t.value === "page" && t.checked && !d.page && !d.pageReady) {
      if (planned(d, form) > MAX_FILES) { t.checked = false; return status(form, say("too_many_files")); }
      d.pageReady = capture(true).then((s) => { d.page = s; }, (e) => { status(form, say(e && e.slow ? "capture_slow" : "capture_failed")); t.checked = false; }).then(() => {
        d.pageReady = null;
        if (S.draft === d) paintShot(form);
      });
    }
    paintShot(form);
    if (t.value === "region") paintMarks(form);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitNew(form); });
  paintShot(form, d);
  d.shotReady.then(() => { if (S.draft === d) paintShot(form); });
  return form;
}
function box(form, role) { return form.querySelector("input[name=attach][value=" + role + "]"); }
function figure(form, role) { return form.querySelector(".p99-shot[data-role=" + role + "], .p99-regions[data-role=" + role + "]"); }
function paintShot(form, draft) {
  const d = draft || S.draft;
  if (!d) return;
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
  let n = d.files.length;
  if (box(form, "screenshot").checked && d.shot) n++;
  if (box(form, "page").checked && d.page) n++;
  if (box(form, "region").checked) n += d.marks.filter((m) => m.crop).length;
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
  if (!d || S.marking) return;
  if (d.marks.length >= MAX_MARKS) return status(form, say("too_many_marks"));
  lib().then((m) => { if (S.draft === d && !S.marking && S.open) marking(form, d, m); }, () => status(form, say("capture_failed")));
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
    const elements = lib.elementsAt(o, q);
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
      const ready = same ? Promise.resolve(d.shot) : capture(false).then((s) => {
        if (d.shot) release(d.shot.canvas);
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
  const send = form.querySelector("button[type=submit]");
  d.busy = true;
  send.disabled = true;
  status(form, say("sending"));
  const kind = form.querySelector("input[name=kind]:checked");
  const filed = d.key
    ? Promise.resolve({ key: d.key })
    : lib().then((m) => m.context(o, d.at), () => ({ url: d.at.origin + d.at.path, user_agent: navigator.userAgent, p99: V })).then((context) => {
        const body = fit({
          client_uid: d.uid,
          kind: kind ? kind.value : "bug",
          title: title.slice(0, 200),
          body: form.elements.body.value.slice(0, 20000),
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
        if (S.draft === d) S.draft = null;
        item(res.key);
      });
  }).catch((e) => {
    d.busy = false;
    send.disabled = false;
    status(form, problem(e), !e.status || e.status >= 500 ? () => submitNew(form) : null);
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

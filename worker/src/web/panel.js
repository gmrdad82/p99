const V = "__P99_VERSION__";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_MARKS = 10;
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const CAPTURE_DEADLINE = 10000;
const MEDIA_TIMEOUT = 8000;
const VIDEO_STYLE = ["position", "top", "right", "bottom", "left", "z-index", "float", "margin", "transform", "transform-origin", "border", "border-radius", "opacity", "filter", "clip-path", "vertical-align", "object-fit", "object-position", "grid-area", "flex", "align-self", "justify-self", "order"];
const PACKED_STYLE = ["background-image", "border-image-source", "-webkit-border-image", "-webkit-mask-image", "mask-image", "list-style-image"];
const KINDS = ["bug", "feature", "improvement", "question", "task"];
const STATUSES = ["new", "confirmed", "in_progress", "waiting", "resolved", "abandoned", "duplicate"];
const OPEN = ["new", "confirmed", "in_progress", "waiting"];
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
  close: "Close",
  loading: "Loading…",
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
  status_new: "New",
  status_confirmed: "Confirmed",
  status_in_progress: "In progress",
  status_waiting: "Waiting for you",
  status_waiting_manager: "Waiting on the reporter",
  status_resolved: "Resolved",
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
  duplicate_of: "duplicate of {n}",
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
  assignee: "Assignee (e-mail)",
  duplicate_label: "Duplicate of",
  duplicate_hint: "for example BUG-12",
  save: "Save",
  saved: "Saved.",
  abandon: "Drop it",
  reopen: "Reopen",
  edit: "Edit what you wrote",
  event_system: "P99",
  event_created: "opened the item",
  event_status: "changed the status: {from} → {to}",
  event_kind: "changed the kind: {from} → {to}",
  event_assignee: "assigned it to {to}",
  event_unassigned: "left it unassigned",
  event_title: "changed the title: {to}",
  event_body: "changed the details",
  event_landed: "the fix reached {env}",
  event_mail: "e-mail sent to {to}",
  event_mail_failed: "the e-mail to {to} didn't go out",
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
  o = opts;
  o.host = o.root.host;
  o.bar = o.root.firstChild;
  if (opts.me) me = opts.me;
  const ready = ensure();
  if (opts.view === "list" && S.open && S.view === "list") return close();
  return ready.then(() => {
    show();
    if (opts.view === "item" && opts.key) item(opts.key);
    else if (opts.view === "list") list(S.list || defaultList());
    else fileFlow();
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

function call(method, path, body, type) {
  const headers = { "X-P99-Code": o.code, Accept: "application/json" };
  if (body != null) headers["Content-Type"] = type || "application/json";
  return fetch("/_p99/api" + path, { method, headers, body, credentials: "same-origin" }).then((r) =>
    r.text().then((t) => {
      let data = null;
      try { data = t ? JSON.parse(t) : null; } catch (x) {}
      if (r.status === 401) {
        close();
        o.forget();
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
    const p = fetch("/_p99/api/files/" + enc(id), { headers: { "X-P99-Code": o.code } }).then((r) => {
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
  const head = h("div", { class: "p99-head" }, grip, h("div", { class: "p99-brand" }, h("b", { class: "p99-logo", text: "P99" }), h("span", { class: "p99-logo-name", text: say("brand") })), x);
  panel = h("div", { class: "p99-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "p99-title", tabindex: "-1", hidden: true }, head, scroller);
  root.append(scrim, panel);
  swipe(head);
  root.addEventListener("keydown", keys);
  phone.addEventListener("change", () => { if (S.open) scrim.hidden = !phone.matches; });
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
function show() {
  if (S.open) return;
  S.open = true;
  panel.hidden = false;
  scrim.hidden = !phone.matches;
  void panel.offsetWidth;
  panel.classList.add("is-open");
  scrim.classList.add("is-open");
}
function close() {
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
  const back = o.bar && o.bar.querySelector("button");
  if (back && panel.contains(root.activeElement)) back.focus();
}
function skeleton() {
  const box = h("div", { class: "p99-skeleton", "aria-busy": "true" }, h("h2", { class: "p99-sr", id: "p99-title", text: say("loading") }));
  for (let i = 0; i < 5; i++) box.append(h("div", { class: "p99-shimmer" }));
  return box;
}
function mount(view, focus) {
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
function statusWord(s) { return say(me && me.manager && s === "waiting" ? "status_waiting_manager" : "status_" + s); }
function statusPill(s) { return pill("p99-status", "data-status", s, statusWord(s)); }
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
  if (c.page_open > 0) return { scope: "page", status: "open", kind: "", q: "" };
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
    const tabs = ["page", "mine"].concat(me && me.manager ? ["all"] : []);
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
    [["open", say("filter_open")], ["closed", say("filter_closed")], ["any", say("filter_any")]].concat(STATUSES.map((s) => [s, statusWord(s)]))
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
  return h("li", { class: "p99-item", "data-status": r.status, "data-kind": r.kind, "data-unread": !!r.unread },
    h("a", { href: "#p99=" + r.key, onclick: (e) => { e.preventDefault(); item(r.key); } },
      h("span", { class: "p99-key", text: r.key }),
      h("b", { class: "p99-item-title", text: r.title }),
      r.unread ? h("span", { class: "p99-unread", text: say("unread_mark") }) : null,
      statusPill(r.status),
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
  if (i.assignee) meta.push(" · ", say("assigned_to", { who: i.assignee }));
  if (i.duplicate_of) meta.push(" · ", say("duplicate_of", { n: i.duplicate_of }));
  const page = i.page || {};
  const dest = pageUrl(page.path);
  const here = !!dest && dest.pathname === location.pathname;
  const marks = Array.isArray(i.marks) ? i.marks : [];
  const pageLink = dest ? h("p", { class: "p99-page" }, h("a", { href: dest.pathname + "#p99=" + enc(i.key), text: page.title || dest.pathname, onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (here) { if (marks.length) showMarks(marks); return; }
    location.href = dest.pathname + "#p99=" + enc(i.key);
  } })) : null;
  const shots = files.filter((a) => !a.comment_id && a.role !== "file");
  const loose = files.filter((a) => !a.comment_id && a.role === "file");
  const view = h("article", { class: "p99-view", "data-view": "item", "data-status": i.status, "data-kind": i.kind },
    h("header", { class: "p99-item-head" },
      back(),
      h("p", { class: "p99-labels" }, h("span", { class: "p99-key", text: i.key }), " ", kindPill(i.kind), " ", statusPill(i.status)),
      h("h2", { id: "p99-title", text: i.title }),
      h("p", { class: "p99-meta" }, meta),
      pageLink),
    landing(i.landing),
    i.commits && i.commits.length ? h("ul", { class: "p99-commits" }, i.commits.map((c) => h("li", { "data-fixes": c.rel === "fixes" }, h("code", { text: String(c.sha || "").slice(0, 7) }), " ", c.subject || ""))) : null,
    marks.length && here ? h("button", { type: "button", onclick: () => showMarks(marks), text: say("show_marks") }) : null,
    i.body ? h("div", { class: "p99-body" }, pieces(i.body)) : null,
    shots.length ? h("div", { class: "p99-shots" }, shots.map((a) =>
      h("figure", { class: "p99-shot", "data-role": a.role }, h("a", { href: "#", onclick: download(a) }, thumb(a)), h("figcaption", { text: say("shot_" + a.role, { n: (a.mark || 0) + 1 }) }))
    )) : null,
    loose.length ? fileList(loose) : null,
    h("ol", { class: "p99-thread" }, entries(t, byId, mine)),
    commentForm(i, manager));
  if (manager) view.append(manageForm(i));
  else if (mine) {
    const acts = h("div", { class: "p99-reporter-actions" });
    const wrap = h("div", { class: "p99-reporter" }, acts, statusLine());
    if (OPEN.includes(i.status)) acts.append(h("button", { type: "button", text: say("abandon"), onclick: (e) => patch(i.key, { status: "abandoned" }, wrap, e.currentTarget) }));
    if (i.status === "resolved") acts.append(h("button", { type: "button", text: say("reopen"), onclick: (e) => patch(i.key, { status: "new" }, wrap, e.currentTarget) }));
    if (acts.firstChild) view.append(wrap);
    if (i.status === "new") view.append(editForm(i));
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
    const u = new URL(path, location.origin);
    return u.origin === location.origin ? u : null;
  } catch (x) { return null; }
}
function eventText(ev) {
  const obj = ev.detail && typeof ev.detail === "object" ? ev.detail : {};
  const label = (k, v) => (v ? say(k + "_" + v) : "");
  if (ev.kind === "status") return say("event_status", { from: obj.from ? statusWord(obj.from) : "", to: obj.to ? statusWord(obj.to) : "" });
  if (ev.kind === "kind") return say("event_kind", { from: label("kind", obj.from), to: label("kind", obj.to) });
  if (ev.kind === "assignee") return obj.to ? say("event_assignee", { to: obj.to }) : say("event_unassigned");
  if (ev.kind === "mail") return say(obj.ok === false ? "event_mail_failed" : "event_mail", { to: obj.to || "" });
  if (ev.kind === "landed") return say("event_landed", { env: obj.env || obj.to || "" });
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
    return h("li", { class: "p99-event", "data-event-kind": x.ev.kind }, h("small", null, h("b", null, person(x.ev.actor, x.ev.agent)), " ", text, " · ", h("time", { text: when(x.ev.at) })));
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
function manageForm(i) {
  const form = h("form", { class: "p99-manage", novalidate: true },
    h("h3", { text: say("manage") }),
    h("label", null, h("span", { text: say("filter_status") }), h("select", { name: "status" }, options(STATUSES, statusWord, i.status))),
    h("label", null, h("span", { text: say("filter_kind") }), h("select", { name: "kind" }, options(KINDS, (k) => say("kind_" + k), i.kind))),
    h("label", null, h("span", { text: say("assignee") }), h("input", { type: "email", name: "assignee", value: i.assignee || "", autocomplete: "off" })),
    h("label", null, h("span", { text: say("duplicate_label") }), h("input", { name: "duplicate_of", value: i.duplicate_of || "", placeholder: say("duplicate_hint"), autocomplete: "off" })),
    statusLine(),
    h("button", { type: "submit", text: say("save") }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = changed(form);
    if (data.duplicate_of === "") delete data.duplicate_of;
    if ("assignee" in data && !data.assignee) data.assignee = null;
    patch(i.key, data, form);
  });
  return form;
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
    x.open("PUT", "/_p99/api/issues/" + enc(key) + "/attachments/" + enc(it.uid) + q);
    x.setRequestHeader("X-P99-Code", o.code);
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
function contextNow(at) {
  const ua = navigator.userAgent;
  const uad = navigator.userAgentData;
  const media = (q) => matchMedia(q).matches;
  const high = uad && uad.getHighEntropyValues
    ? uad.getHighEntropyValues(["architecture", "bitness", "model", "platformVersion", "fullVersionList", "formFactors"]).catch(() => null)
    : Promise.resolve(null);
  return high.then((hi) => {
    const browser = uad
      ? { brands: (hi && hi.fullVersionList) || uad.brands, mobile: uad.mobile, platform: uad.platform, platform_version: hi ? hi.platformVersion : null, model: hi ? hi.model || null : null, architecture: hi ? hi.architecture : null, bitness: hi ? hi.bitness : null, form_factors: hi ? hi.formFactors || null : null }
      : null;
    const vv = window.visualViewport;
    const conn = navigator.connection || {};
    const nav = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    const ctx = {
      at: new Date().toISOString(),
      url: at.origin + at.path,
      route: { path: at.path, title: at.title },
      user_agent: ua,
      browser,
      viewport: { w: document.documentElement.clientWidth || innerWidth, h: innerHeight, scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY), zoom: vv ? vv.scale : 1, page_h: document.documentElement.scrollHeight },
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio || 1, orientation: screen.orientation ? screen.orientation.type : null },
      prefs: { color_scheme: media("(prefers-color-scheme: dark)") ? "dark" : "light", reduced_motion: media("(prefers-reduced-motion: reduce)"), pointer: media("(pointer: coarse)") ? "coarse" : "fine", standalone: media("(display-mode: standalone)") },
      locale: { language: navigator.language, languages: (navigator.languages || []).slice(0, 5), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      connection: { online: navigator.onLine, type: conn.effectiveType || null, downlink: conn.downlink || null, rtt: conn.rtt || null, save_data: !!conn.saveData },
      device: { cores: navigator.hardwareConcurrency || null, memory: navigator.deviceMemory || null, touch_points: navigator.maxTouchPoints || 0 },
      timing: nav ? { ttfb: Math.round(nav.responseStart), dom_ready: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) } : null,
      p99: V,
      errors: (o.ring || []).map((m) => m.replace(/[?#]\S*/g, "").slice(0, 300))
    };
    while (bytes(ctx) > 60000 && ctx.errors.length) ctx.errors.shift();
    return ctx;
  });
}

function sameOrigin(u) {
  try {
    const x = new URL(u, location.href);
    return (x.protocol === "http:" || x.protocol === "https:") && x.origin === location.origin;
  } catch (e) {
    return false;
  }
}
function fontCss() {
  if (S.fonts) return S.fonts;
  const used = {};
  if (document.fonts && document.fonts.forEach) {
    document.fonts.forEach((f) => { if (f.status === "loaded") used[f.family.replace(/["']/g, "") + "|" + f.weight + "|" + f.style] = true; });
  }
  const rules = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    let list;
    try { list = sheet.cssRules; } catch (x) { return; }
    Array.from(list || []).forEach((r) => { if (r.type === 5) rules.push(r); });
  });
  S.fonts = Promise.all(rules.map((r) => {
    const st = r.style;
    const key = st.getPropertyValue("font-family").replace(/["']/g, "").trim() + "|" + (st.getPropertyValue("font-weight") || "400") + "|" + (st.getPropertyValue("font-style") || "normal");
    const m = /url\(["']?([^"')]+)["']?\)/.exec(r.cssText);
    if (!used[key] || !m) return "";
    if (/^data:/.test(m[1])) return r.cssText;
    const base = (r.parentStyleSheet && r.parentStyleSheet.href) || location.href;
    let url;
    try { url = new URL(m[1], base).href; } catch (x) { return ""; }
    if (!sameOrigin(url)) return "";
    return fetch(url, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("font"))))
      .then(dataUrl)
      .then((d) => r.cssText.replace(m[0], 'url("' + d + '")'))
      .catch(() => "");
  })).then((parts) => parts.filter(Boolean).join("\n"));
  return S.fonts;
}
function opaque(color) {
  const m = /^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/.exec(color.replace(/\s+/g, ""));
  if (m) return "rgb(" + m[1] + "," + m[2] + "," + m[3] + ")";
  if (/\/\s*[\d.]+%?\s*\)$/.test(color)) return color.replace(/\/\s*[\d.]+%?\s*\)$/, ")");
  return null;
}
function probe() {
  const box = document.createElement("div");
  [["all", "initial"], ["position", "fixed"], ["left", "-99999px"], ["top", "0"], ["width", "0"], ["height", "0"], ["overflow", "hidden"], ["contain", "strict"]].forEach(([k, v]) => box.style.setProperty(k, v));
  const body = document.createElement("div");
  box.attachShadow({ mode: "closed" }).append(body);
  root.append(box);
  return {
    contentWindow: {
      document: { body, createElement: (t) => document.createElement(t), createElementNS: (n, t) => document.createElementNS(n, t) },
      getComputedStyle: (e, p) => getComputedStyle(e, p)
    },
    remove: () => box.remove()
  };
}
function ignored(n) {
  return n.nodeType === 1 && (n === o.host || n.hasAttribute("data-p99-ignore") || n.nodeName === "NOSCRIPT");
}
function capture(full) {
  const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
  const sx = Math.round(scrollX), sy = Math.round(scrollY);
  const fixes = [];
  const touched = [];
  const mark = (n, attr, v) => { n.setAttribute(attr, v); touched.push([n, attr]); };
  if (!full) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (ignored(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const found = [];
    const sticky = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const cs = getComputedStyle(n);
      if (cs.backdropFilter && cs.backdropFilter !== "none") {
        const bg = opaque(cs.backgroundColor);
        if (bg) found.push({ node: n, fix: { bg } });
      }
      if (cs.position === "sticky") sticky.push({ node: n, live: null, rest: null, was: "" });
    }
    sticky.forEach((x) => { x.live = x.node.getBoundingClientRect(); });
    sticky.forEach((x) => { x.was = x.node.style.position; x.node.style.position = "static"; });
    sticky.forEach((x) => { x.rest = x.node.getBoundingClientRect(); });
    sticky.forEach((x) => { x.node.style.position = x.was; });
    sticky.forEach((x) => {
      const dx = Math.round(x.live.left - x.rest.left), dy = Math.round(x.live.top - x.rest.top);
      if (!dx && !dy) return;
      let have = found.find((f) => f.node === x.node);
      if (!have) found.push((have = { node: x.node, fix: {} }));
      have.fix.dx = dx;
      have.fix.dy = dy;
    });
    found.forEach((f) => { mark(f.node, "data-p99-fix", String(fixes.length)); fixes.push(f); });
  }
  const hidden = [];
  document.querySelectorAll("[data-p99-redact]").forEach((n) => {
    if (n.closest("[data-p99-ignore]")) return;
    const b = n.getBoundingClientRect();
    mark(n, "data-p99-hide", String(hidden.length));
    hidden.push({ w: Math.round(b.width), h: Math.round(b.height) });
  });
  const blanks = [];
  document.querySelectorAll("img").forEach((n) => {
    if (n.complete && n.naturalWidth) return;
    if (n.closest("[data-p99-ignore]")) return;
    mark(n, "data-p99-blank", String(blanks.length));
    blanks.push({ w: n.offsetWidth, h: n.offsetHeight });
  });
  const skip = new Set();
  const slots = [];
  document.querySelectorAll("video").forEach((v) => {
    if (v.closest("[data-p99-ignore]") || !v.parentElement) return;
    skip.add(v);
    const cs = getComputedStyle(v);
    const style = {};
    VIDEO_STYLE.forEach((k) => { style[k] = cs.getPropertyValue(k); });
    style.display = cs.display === "inline" ? "inline-block" : cs.display;
    slots.push({ v, parent: v.parentElement, w: v.offsetWidth, h: v.offsetHeight, style, poster: v.poster && sameOrigin(v.poster) ? v.poster : null, fill: v.poster ? "#111" : "transparent" });
  });
  const groups = new Map();
  slots.forEach((s) => {
    let at = 0;
    for (let n = s.v.previousElementSibling; n; n = n.previousElementSibling) {
      if (!skip.has(n) && !ignored(n) && n.nodeName !== "SCRIPT" && n.nodeName !== "STYLE") at++;
    }
    s.at = at;
    if (!groups.has(s.parent)) groups.set(s.parent, []);
    groups.get(s.parent).push(s);
  });
  let g = 0;
  groups.forEach((list, p) => { mark(p, "data-p99-vp", String(g)); list.g = g++; });
  const groupList = Array.from(groups.values());
  const W = vw, H = full ? Math.max(document.documentElement.scrollHeight, vh) : vh;
  const scale = full ? Math.min(1, 16000 / H, 1920 / W, Math.sqrt(16000000 / (W * H))) : Math.min(devicePixelRatio || 1, 2, 1920 / W);
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  const cleanup = () => touched.forEach(([n, a]) => n.removeAttribute(a));
  let sandbox = null, ms = null, ctx = null, timer = 0;
  const done = () => {
    clearTimeout(timer);
    cleanup();
    if (ctx && ms) try { ms.destroyContext(ctx); } catch (x) {}
    if (sandbox) sandbox.remove();
    ctx = sandbox = null;
  };
  const late = new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error("capture took too long"), { slow: true })), CAPTURE_DEADLINE); });
  const work = import("/_p99/capture.js?v=" + V)
    .then((mod) => Promise.all([mod.default || mod, fontCss()]))
    .then(([lib, fonts]) => {
      ms = lib;
      sandbox = probe();
      return ms.createContext(document.documentElement, {
        width: W,
        height: H,
        scale,
        timeout: 1,
        font: fonts ? { cssText: fonts } : false,
        drawImageInterval: 20,
        sandbox,
        workerUrl: null,
        fetch: { placeholderImage: BLANK, bypassingCache: false },
        fetchFn: (url) => (fragment(url) ? BLANK : sameOrigin(url) ? false : BLANK),
        features: { restoreScrollPosition: true, fixSvgXmlDecode: safari },
        filter: (node) => !ignored(node) && !skip.has(node),
        onCloneNode: (clone) => dress(clone, { full, sx, sy, hidden, fixes, groupList, blanks })
      });
    })
    .then((c) => {
      ctx = c;
      ctx.timeout = MEDIA_TIMEOUT;
      return ms.domToCanvas(ctx);
    });
  return Promise.race([work, late]).then((canvas) => {
    done();
    S.shots = (S.shots || 0) + 1;
    return { id: S.shots, canvas, sx, sy, vw, vh, scale: canvas.width / W };
  }, (e) => {
    done();
    throw e;
  });
}
function fragment(url) {
  try {
    const x = new URL(url, location.href);
    return !!x.hash && x.href.slice(0, x.href.length - x.hash.length) === location.href.split("#")[0];
  } catch (e) {
    return false;
  }
}
function packSvg(value) {
  return value.replace(/url\("data:image\/svg\+xml([^,"]*),((?:[^"\\]|\\.)*)"\)/gi, (all, meta, body) => {
    if (/;base64/i.test(meta)) return all;
    try {
      const text = decodeURIComponent(body.replace(/\\(.)/g, "$1").replace(/%(?![0-9a-f]{2})/gi, "%25"));
      return 'url("data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text))) + '")';
    } catch (e) {
      return all;
    }
  });
}
function dress(clone, c) {
  const body = clone.querySelector && clone.querySelector("body");
  if (body) {
    body.style.transform = "";
    if (!c.full) {
      body.style.position = "relative";
      body.style.top = -c.sy + "px";
      body.style.left = -c.sx + "px";
    }
  }
  if (!clone.querySelectorAll) return;
  [clone].concat(Array.from(clone.querySelectorAll("*"))).forEach((n) => {
    if (!n.style) return;
    PACKED_STYLE.forEach((k) => {
      const v = n.style.getPropertyValue(k);
      if (v && v.indexOf("data:image/svg+xml") >= 0) {
        const p = packSvg(v);
        if (p !== v) n.style.setProperty(k, p, n.style.getPropertyPriority(k));
      }
    });
  });
  clone.querySelectorAll("[data-p99-blank]").forEach((n) => {
    const box = c.blanks[Number(n.getAttribute("data-p99-blank"))];
    n.removeAttribute("data-p99-blank");
    n.removeAttribute("srcset");
    n.removeAttribute("loading");
    n.src = BLANK;
    if (n.parentNode && n.parentNode.nodeName === "PICTURE") n.parentNode.querySelectorAll("source").forEach((x) => x.remove());
    if (box && box.w && box.h) {
      n.style.width = box.w + "px";
      n.style.height = box.h + "px";
    }
    n.style.background = "#e4e1dc";
  });
  clone.querySelectorAll("input[type=password], [data-p99-hide] input, [data-p99-hide] textarea").forEach((n) => {
    n.removeAttribute("value");
    n.value = "";
    n.textContent = "";
  });
  clone.querySelectorAll("[data-p99-hide]").forEach((n) => {
    const box = c.hidden[Number(n.getAttribute("data-p99-hide"))];
    n.removeAttribute("data-p99-hide");
    while (n.firstChild) n.removeChild(n.firstChild);
    ["value", "src", "srcset", "href", "xlink:href", "placeholder", "poster"].forEach((a) => n.removeAttribute(a));
    if (box) {
      n.style.width = box.w + "px";
      n.style.height = box.h + "px";
    }
    n.style.background = "#8c8780";
    n.style.backgroundImage = "none";
    n.style.color = "transparent";
    n.style.boxShadow = "none";
  });
  clone.querySelectorAll("[data-p99-fix]").forEach((n) => {
    const f = c.fixes[Number(n.getAttribute("data-p99-fix"))];
    n.removeAttribute("data-p99-fix");
    if (!f) return;
    if (f.fix.bg) n.style.backgroundColor = f.fix.bg;
    if (f.fix.dy !== undefined) {
      n.style.position = "relative";
      n.style.top = f.fix.dy + "px";
      n.style.left = f.fix.dx + "px";
      n.style.bottom = "auto";
      n.style.right = "auto";
    }
  });
  clone.querySelectorAll("[data-p99-vp]").forEach((n) => {
    const list = c.groupList[Number(n.getAttribute("data-p99-vp"))];
    n.removeAttribute("data-p99-vp");
    if (!list) return;
    list.slice().sort((a, b) => a.at - b.at).forEach((s, i) => {
      const ph = s.poster ? document.createElement("img") : document.createElement("div");
      if (s.poster) ph.src = s.poster;
      else ph.style.background = s.fill;
      Object.keys(s.style).forEach((k) => ph.style.setProperty(k, s.style[k]));
      ph.style.boxSizing = "border-box";
      ph.style.width = s.w + "px";
      ph.style.height = s.h + "px";
      n.insertBefore(ph, n.children[s.at + i] || null);
    });
  });
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

function selectorOf(node) {
  const parts = [];
  for (let n = node; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
    if (n.id && !/\d{3,}/.test(n.id) && document.querySelectorAll("#" + CSS.escape(n.id)).length === 1) {
      parts.unshift("#" + CSS.escape(n.id));
      break;
    }
    let part = n.localName;
    const hook = ["data-testid", "data-field", "name"].find((a) => n.hasAttribute(a));
    if (hook) part += "[" + hook + '="' + CSS.escape(n.getAttribute(hook)) + '"]';
    else {
      const classes = Array.from(n.classList).filter((c) => !/^(active|open|selected|busy|on|loading|htmx|is-|has-)/.test(c)).slice(0, 2);
      if (classes.length) part += "." + classes.map(CSS.escape).join(".");
      if (n.parentElement) {
        const same = Array.from(n.parentElement.children).filter((s) => s.localName === n.localName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      }
    }
    parts.unshift(part);
    try { if (document.querySelectorAll(parts.join(" > ")).length === 1) break; } catch (x) {}
  }
  return parts.join(" > ").slice(0, 1000);
}
const SECRET = "[data-p99-redact], input, textarea, select, script, style, template, noscript, [contenteditable]";
function labelOf(n) {
  if (n.closest("[data-p99-redact]")) return "";
  let v = n.getAttribute("aria-label") || n.getAttribute("title") || "";
  if (!v && n.matches("input, textarea, select")) v = n.getAttribute("placeholder") || n.getAttribute("name") || "";
  if (!v && n.labels && n.labels[0] && !n.labels[0].closest("[data-p99-redact]")) v = n.labels[0].textContent;
  return v.replace(/\s+/g, " ").trim().slice(0, 300);
}
function textOf(n) {
  if (n.matches(SECRET) || n.closest("[data-p99-redact]")) return "";
  let src = n;
  if (n.querySelector(SECRET)) {
    src = n.cloneNode(true);
    src.querySelectorAll(SECRET).forEach((x) => x.remove());
  }
  const parts = [];
  const walk = document.createTreeWalker(src, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) parts.push(t.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}
function depth(n) {
  let d = 0;
  for (let p = n; p; p = p.parentElement) d++;
  return d;
}
function elementsUnder(r) {
  const seen = [];
  const step = Math.max(12, Math.ceil(Math.max(r.w, r.h) / 24));
  for (let y = r.y; y <= r.y + r.h; y += step) {
    for (let x = r.x; x <= r.x + r.w; x += step) {
      for (const n of document.elementsFromPoint(x, y)) {
        if (n === document.documentElement || n === document.body || n === o.host || seen.includes(n)) continue;
        if (n.closest("[data-p99-ignore], [data-p99-redact], input[type=password]")) continue;
        seen.push(n);
      }
    }
  }
  const rows = seen.map((n) => {
    const b = n.getBoundingClientRect();
    const area = Math.max(0, b.width) * Math.max(0, b.height);
    const w = Math.min(b.right, r.x + r.w) - Math.max(b.left, r.x);
    const hh = Math.min(b.bottom, r.y + r.h) - Math.max(b.top, r.y);
    const shared = w > 0 && hh > 0 ? w * hh : 0;
    return { n, b, inside: area ? shared / area : 0, covers: r.w * r.h ? shared / (r.w * r.h) : 0, holds: b.left <= r.x && b.top <= r.y && b.right >= r.x + r.w && b.bottom >= r.y + r.h, d: depth(n) };
  });
  const container = rows.filter((x) => x.holds).sort((a, b) => b.d - a.d)[0];
  const inner = rows.filter((x) => x !== container && (x.inside >= 0.5 || x.covers >= 0.25)).sort((a, b) => b.d - a.d).slice(0, 19);
  return (container ? [container] : []).concat(inner).map((x) => ({
    selector: selectorOf(x.n),
    label: labelOf(x.n),
    text: textOf(x.n),
    box: { x: Math.round(x.b.x), y: Math.round(x.b.y), w: Math.round(x.b.width), h: Math.round(x.b.height) }
  }));
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
    const elements = elementsUnder(q);
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
    : contextNow(d.at).then((context) => {
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

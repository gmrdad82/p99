import { avatarSrc } from "/_p99/avatar.js?v=__P99_VERSION__";

const ARRIVE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const TRAVEL = "cubic-bezier(0.4, 0, 0.2, 1)";
const WORDS = {
  board: "Board",
  filtered: "showing {what}",
  close_board: "Close the board",
  live: "Live",
  connecting: "Connecting…",
  offline_live: "Not live",
  empty_column: "No cards",
  board_card: "Board",
  drag_help: "Space lifts a card, the arrows move it, Space or Enter drops it, Escape puts it back.",
  lifted: "Lifted {card}.",
  over: "{card}: {column}, {pos} of {count}.",
  dropped: "Dropped {card} in {column}.",
  cancelled: "Put {card} back.",
  moved: "this card moved; refreshed",
  move_failed: "Couldn't move {card}; it's back where it was.",
  loading: "Loading the board…",
  load_failed: "Couldn't load the board.",
  retry: "Retry",
};
const CSS = `
.p99-board-scrim{position:fixed;inset:0;z-index:2147483000;background:color-mix(in srgb,var(--p99-edge) 55%,transparent);opacity:0;transition:opacity var(--p99-motion-panel) var(--p99-ease-exit)}
.p99-board-scrim.is-open{opacity:1;transition-timing-function:var(--p99-ease-enter)}
.p99-board{position:fixed;inset:20px;z-index:2147483001;display:flex;flex-direction:column;overflow:hidden;border-radius:var(--p99-radius-lg);background-color:var(--p99-base);color:var(--p99-ink);box-shadow:var(--p99-shadow-overlay);font:400 var(--p99-text-md)/var(--p99-leading-normal) var(--p99-font-text);text-align:left;opacity:0;transform:translateY(16px) scale(.985);transition:transform var(--p99-motion-panel) var(--p99-ease-exit),opacity var(--p99-motion-panel) var(--p99-ease-exit);outline:none;isolation:isolate}
.p99-board.is-open{opacity:1;transform:none;transition-timing-function:var(--p99-ease-enter)}
.p99-board *,.p99-board *::before,.p99-board *::after,.p99-ghost,.p99-ghost *{box-sizing:border-box}
.p99-board::before{content:"";position:absolute;inset:-72px;z-index:-1;background-color:var(--p99-glow);background-image:linear-gradient(135deg,rgba(255,255,255,.22),rgba(255,255,255,.06) 28%,transparent 52%),var(--p99-art);background-size:100% 100%,400px 400px;background-blend-mode:normal,multiply;pointer-events:none}
.p99-board::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 4px 0 var(--p99-edge),inset 0 5px 0 rgba(255,255,255,.18),inset 0 -2px 0 rgba(0,0,0,.18);pointer-events:none}
.p99-board-head{display:flex;align-items:center;gap:var(--p99-space-lg);flex:none;min-height:64px;padding:var(--p99-space-md) var(--p99-space-md) var(--p99-space-xs) var(--p99-space-xl)}
.p99-board .p99-logo{flex:none;min-width:43.2px;height:36px;font-size:24px}
.p99-board-name{position:relative;display:flex;flex-direction:column;align-items:flex-start;min-width:0;flex:0 1 auto}
.p99-board-name h2{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--p99-weight-bold) var(--p99-text-xl)/var(--p99-leading-tight) var(--p99-font-display)}
.p99-board-filter{margin:0;color:var(--p99-muted);font-size:var(--p99-text-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p99-live{flex:none;display:inline-flex;align-items:center;gap:var(--p99-space-sm);margin-left:auto;color:var(--p99-muted);font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-text);letter-spacing:var(--p99-tracking-caps);text-transform:uppercase;white-space:nowrap}
.p99-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--p99-rule)}
.p99-live[data-state=live]::before{background:var(--p99-status-validated);box-shadow:0 0 0 3px color-mix(in srgb,var(--p99-status-validated) 22%,transparent)}
.p99-live[data-state=connecting]::before{background:var(--p99-status-warning);animation:p99-pulse 1.4s var(--p99-ease-in-out) infinite}
.p99-board .p99-x{flex:none;display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:var(--p99-radius-full);background:transparent;color:var(--p99-muted);font:var(--p99-weight-medium) var(--p99-text-xl)/1 var(--p99-font-text);cursor:pointer;transition:background var(--p99-motion-hover-out) var(--p99-ease-in-out),color var(--p99-motion-hover-out) var(--p99-ease-in-out)}
@media (hover:hover){.p99-board .p99-x:hover{background:color-mix(in srgb,var(--p99-ink) 8%,transparent);color:var(--p99-ink);transition-duration:var(--p99-motion-hover-in);transition-timing-function:var(--p99-ease-enter)}}
.p99-board .p99-x:focus-visible,.p99-board-state button:focus-visible{outline:2px solid var(--p99-focus);outline-offset:2px}
.p99-cols{--n:7;flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--n),minmax(172px,1fr));gap:var(--p99-space-lg);padding:var(--p99-space-md) var(--p99-space-xl) var(--p99-space-xl);overflow-x:auto}
.p99-col{--p99-tone:var(--p99-status-in-review);display:flex;flex-direction:column;min-height:0;contain:layout paint;border-radius:var(--p99-radius-md);background:color-mix(in srgb,var(--p99-ink) 6%,transparent);box-shadow:inset 0 2px 4px rgba(12,26,43,.22),inset 0 -1px 0 rgba(255,255,255,.25);transition:background var(--p99-motion-base) var(--p99-ease-in-out),box-shadow var(--p99-motion-base) var(--p99-ease-in-out)}
.p99-col[data-word=new]{--p99-tone:var(--p99-accent-ink)}
.p99-col[data-word=in-progress],.p99-col[data-word=stuck]{--p99-tone:var(--p99-status-warning)}
.p99-col[data-word=needs-you]{--p99-tone:var(--p99-accent)}
.p99-col[data-closes]{--p99-tone:var(--p99-status-validated)}
.p99-col-head{display:flex;align-items:center;gap:var(--p99-space-sm);padding:var(--p99-space-md) var(--p99-space-md) var(--p99-space-sm);border-top:3px solid var(--p99-tone);border-radius:var(--p99-radius-md) var(--p99-radius-md) 0 0}
.p99-col-head h3{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-text);letter-spacing:var(--p99-tracking-caps);text-transform:uppercase}
.p99-count{padding:0 var(--p99-space-sm);border-radius:var(--p99-radius-full);background:var(--p99-raised);color:var(--p99-ink);font:var(--p99-weight-bold) var(--p99-text-xs)/1.6 var(--p99-font-text)}
.p99-col.is-target{background:color-mix(in srgb,var(--p99-accent) 10%,color-mix(in srgb,var(--p99-ink) 6%,transparent));box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--p99-accent) 55%,transparent),inset 0 2px 4px rgba(12,26,43,.22)}
.p99-cards{position:relative;flex:1;min-height:48px;margin:0;padding:var(--p99-space-xs) var(--p99-space-md) var(--p99-space-md);list-style:none;display:flex;flex-direction:column;gap:var(--p99-space-sm);overflow-y:auto;overscroll-behavior:contain}
.p99-cards:empty::after{content:attr(data-empty);padding:var(--p99-space-lg) 0;color:var(--p99-muted);font-size:var(--p99-text-sm);text-align:center}
.p99-card{position:relative;contain:layout paint;display:grid;gap:var(--p99-space-sm);padding:var(--p99-space-md);border:1px solid var(--p99-control);border-radius:var(--p99-radius-md);background:var(--p99-raised);color:var(--p99-ink);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 1px 2px rgba(12,26,43,.18);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:manipulation;transition:border-color var(--p99-motion-hover-out) var(--p99-ease-in-out),box-shadow var(--p99-motion-hover-out) var(--p99-ease-in-out),scale var(--p99-motion-base) var(--p99-ease-enter)}
.p99-board[data-mine=false] .p99-card{cursor:pointer;user-select:auto;-webkit-user-select:auto}
@media (hover:hover){.p99-card:hover{border-color:var(--p99-ink);transition-duration:var(--p99-motion-hover-in);transition-timing-function:var(--p99-ease-enter)}}
.p99-card:focus-visible{outline:2px solid var(--p99-focus);outline-offset:2px}
.p99-card-top{display:flex;align-items:center;gap:var(--p99-space-sm);min-width:0}
.p99-card .p99-key{font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-mono);letter-spacing:.02em;color:var(--p99-muted)}
.p99-card-title{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-weight:var(--p99-weight-medium);font-size:var(--p99-text-sm);line-height:var(--p99-leading-snug)}
.p99-card-top .p99-who{margin-left:auto}
.p99-card-project{justify-self:start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--p99-muted);font:var(--p99-weight-medium) var(--p99-text-xs) var(--p99-font-text)}
.p99-who{flex:none;display:inline-grid;place-items:center;width:24px;height:24px;overflow:hidden;border-radius:50%;background:color-mix(in srgb,var(--p99-accent) 22%,var(--p99-raised));border:1px solid color-mix(in srgb,var(--p99-accent) 50%,var(--p99-rule));color:var(--p99-ink);font:var(--p99-weight-bold) var(--p99-text-xs)/1 var(--p99-font-text)}
.p99-who img{display:block;width:100%;height:100%;object-fit:cover}
.p99-who:has(img){border-color:var(--p99-rule);background:var(--p99-raised)}
.p99-card.is-placeholder{border:2px dashed;border-color:color-mix(in srgb,var(--p99-accent) 70%,var(--p99-rule));background:color-mix(in srgb,var(--p99-accent) 8%,transparent);box-shadow:none}
.p99-card.is-placeholder>*{visibility:hidden}
.p99-card.is-lifted{scale:1.03;z-index:1;border-color:var(--p99-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--p99-accent) 45%,transparent),0 10px 24px rgba(12,26,43,.3)}
.p99-ghost{position:fixed;left:0;top:0;z-index:2147483003;margin:0;pointer-events:none;cursor:grabbing;font:400 var(--p99-text-md)/var(--p99-leading-normal) var(--p99-font-text);text-align:left;box-shadow:0 16px 32px rgba(12,26,43,.34),0 2px 6px rgba(12,26,43,.2);will-change:translate}
.p99-board-state{grid-column:1/-1;align-self:center;justify-self:center;display:grid;justify-items:center;gap:var(--p99-space-md);max-width:420px;padding:var(--p99-space-xl);color:var(--p99-ink);text-align:center;animation:p99-fade var(--p99-motion-base) var(--p99-ease-enter) both}
.p99-board-state p{margin:0}
.p99-board-state button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 var(--p99-space-lg);border:1px solid var(--p99-control);border-radius:var(--p99-radius-sm);background:var(--p99-raised);color:var(--p99-ink);font:var(--p99-weight-medium) var(--p99-text-sm) var(--p99-font-text);cursor:pointer;transition:border-color var(--p99-motion-hover-out) var(--p99-ease-in-out)}
@media (hover:hover){.p99-board-state button:hover{border-color:var(--p99-ink);transition-duration:var(--p99-motion-hover-in);transition-timing-function:var(--p99-ease-enter)}}
.p99-col-wait{--p99-tone:var(--p99-rule)}
.p99-col-wait .p99-col-head .p99-shimmer{width:45%;height:12px}
.p99-col-wait .p99-cards .p99-shimmer{flex:none;height:72px;border-radius:var(--p99-radius-md)}
.p99-board-note{position:absolute;left:50%;bottom:var(--p99-space-lg);translate:-50% 0;max-width:min(560px,90%);padding:var(--p99-space-sm) var(--p99-space-lg);border-radius:var(--p99-radius-sm);background:var(--p99-ink);color:var(--p99-base);font-size:var(--p99-text-sm);animation:p99-fade var(--p99-motion-base) var(--p99-ease-enter) both}
.p99-board .p99-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (max-width:599px){.p99-board{inset:0;border-radius:0}.p99-board-head{gap:var(--p99-space-sm);padding-left:var(--p99-space-lg)}.p99-cols{grid-template-columns:repeat(var(--n),minmax(78vw,1fr));scroll-snap-type:x mandatory;padding:var(--p99-space-sm) var(--p99-space-lg) var(--p99-space-lg)}.p99-col{scroll-snap-align:center}.p99-board .p99-logo{display:none}.p99-live{font-size:0;gap:0}}
@media (prefers-reduced-motion:reduce){.p99-board{transform:none;transition-duration:var(--p99-motion-fast)}.p99-card,.p99-col{transition:none}.p99-board-state{animation:none}.p99-live[data-state=connecting]::before{animation:none}}
`;

const still = matchMedia("(prefers-reduced-motion: reduce)");
const B = { open: false, root: null, ctx: null, el: null, scrim: null, cols: null, title: null, filter: null, live: null, say: null, note: null, data: null, seq: 0, quiet: 0, stale: false, drag: null, ws: null, tries: 0, timer: 0, reload: 0, focus: null };

export function open(ctx) {
  if (B.el && B.root !== ctx.root) {
    hang();
    B.el = null;
    B.open = false;
    B.data = null;
  }
  B.ctx = ctx;
  if (!B.el) build(ctx.root);
  if (!B.open) show();
  return load();
}

export function close() {
  if (!B.open) return;
  if (B.drag) { if (B.drag.keys) undo(); else abort(); }
  B.open = false;
  hang();
  B.el.classList.remove("is-open");
  B.scrim.classList.remove("is-open");
  const done = () => {
    if (B.open) return;
    B.el.hidden = B.scrim.hidden = true;
  };
  if (still.matches) done();
  else setTimeout(done, 300);
  const back = B.focus && B.focus.isConnected ? B.focus : null;
  B.focus = null;
  if (back) back.focus();
  if (B.ctx.closed) B.ctx.closed();
}

function t(key, args) {
  const words = (B.ctx.me && B.ctx.me.strings) || {};
  const v = key in words ? words[key] : WORDS[key];
  if (typeof v !== "string") return key;
  return v.replace(/\{([a-z]+)\}/g, (m, k) => (args && k in args ? String(args[k]) : m));
}

function h(tag, attrs, ...kids) { return B.ctx.h(tag, attrs, ...kids); }

function build(root) {
  B.root = root;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = root.adoptedStyleSheets.concat([sheet]);
  B.scrim = h("div", { class: "p99-board-scrim", hidden: true, onclick: () => close() });
  B.title = h("h2", { id: "p99-board-title", text: t("board") });
  B.filter = h("p", { class: "p99-board-filter", hidden: true });
  B.live = h("span", { class: "p99-live", "data-state": "off", text: t("offline_live") });
  B.cols = h("div", { class: "p99-cols" });
  B.say = h("p", { class: "p99-sr", role: "status", "aria-live": "assertive" });
  const x = h("button", { type: "button", class: "p99-x", "aria-label": t("close_board"), title: t("close_board"), onclick: () => close() }, h("span", { "aria-hidden": "true", text: "×" }));
  B.el = h("div", { class: "p99-board", role: "dialog", "aria-modal": "true", "aria-labelledby": "p99-board-title", tabindex: "-1", hidden: true },
    h("header", { class: "p99-board-head" }, h("b", { class: "p99-logo", text: "P99" }), h("div", { class: "p99-board-name" }, B.title, B.filter), B.live, x),
    B.cols,
    h("p", { class: "p99-sr", id: "p99-drag-help", text: t("drag_help") }),
    B.say);
  root.append(B.scrim, B.el);
  root.addEventListener("keydown", keys);
  B.el.addEventListener("pointerdown", press);
  B.el.addEventListener("click", tap);
  B.el.addEventListener("touchmove", (e) => { if (B.drag && B.drag.up) e.preventDefault(); }, { passive: false });
}

function show() {
  B.open = true;
  B.focus = B.root.activeElement;
  B.el.hidden = B.scrim.hidden = false;
  void B.el.offsetWidth;
  B.el.classList.add("is-open");
  B.scrim.classList.add("is-open");
  B.el.focus({ preventScroll: true });
  listen();
}

function path() {
  const q = typeof B.ctx.query === "function" ? B.ctx.query() : "";
  return "/board" + (q ? "?" + q : "");
}

function load() {
  const seq = ++B.seq;
  if (!B.data) waiting();
  return B.ctx.call("GET", path()).then((d) => {
    if (seq !== B.seq || !B.open) return;
    if (!d || !d.board || !Array.isArray(d.board.lanes)) {
      if (!B.data) blank(t("load_failed"), () => load());
      return;
    }
    B.data = { board: d.board, cards: Array.isArray(d.cards) ? d.cards : [] };
    if (B.drag && !B.drag.keys) soon();
    else paint();
  }).catch((e) => {
    if (e && e.status === 401) return close();
    if (seq !== B.seq) return;
    if (B.data) {
      if (!B.cols.querySelector(".p99-col[data-label]")) paint();
      note((e && e.message) || t("load_failed"));
    } else blank((e && e.status && e.message) || t("load_failed"), () => load());
  });
}

function waiting() {
  delete B.cols.dataset.board;
  B.cols.setAttribute("aria-busy", "true");
  B.cols.style.setProperty("--n", "3");
  B.cols.replaceChildren(h("p", { class: "p99-sr", text: t("loading") }), ...[3, 1, 2].map((n) => h("div", { class: "p99-col p99-col-wait", "aria-hidden": "true" },
    h("div", { class: "p99-col-head" }, h("div", { class: "p99-shimmer" })),
    h("div", { class: "p99-cards" }, Array.from({ length: n }, () => h("div", { class: "p99-shimmer" }))))));
}

function blank(text, retry) {
  delete B.cols.dataset.board;
  B.cols.removeAttribute("aria-busy");
  B.cols.style.setProperty("--n", "1");
  B.cols.replaceChildren(h("div", { class: "p99-board-state", role: retry ? "alert" : "status" }, h("p", { text }), retry ? h("button", { type: "button", text: t("retry"), onclick: retry }) : null));
}

function columns() { return (B.data && B.data.board.lanes) || []; }
function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function mine() {
  const me = B.ctx && B.ctx.me;
  return !!me && (me.role ? me.role === "owner" : !!me.manager);
}
function filtered() { return !!(B.ctx && B.ctx.pickWord); }

function paint() {
  const d = B.data;
  paintHead();
  const list = columns();
  const kids = B.cols.children;
  const keep = B.cols.dataset.board === "one" && kids.length === list.length && list.every((c, i) => same(kids[i].dataset.label, c.label) && kids[i].dataset.word === c.word);
  const old = keep ? new Map(cards().map((e) => [e.dataset.id, e])) : new Map();
  const at = B.root.activeElement;
  const fill = () => {
    B.cols.removeAttribute("aria-busy");
    if (!keep) {
      B.cols.replaceChildren(...list.map((c) => h("section", { class: "p99-col", "data-label": c.label, "data-word": c.word, "data-closes": c.closes ? "" : null },
        h("header", { class: "p99-col-head" }, h("h3"), h("span", { class: "p99-count", text: "0" })),
        h("ol", { class: "p99-cards", "data-empty": t("empty_column") }))));
      B.cols.dataset.board = "one";
      B.cols.style.setProperty("--n", String(list.length || 1));
    }
    list.forEach((c, i) => {
      const col = kids[i];
      col.toggleAttribute("data-closes", !!c.closes);
      col.setAttribute("aria-label", c.label);
      col.querySelector("h3").textContent = c.label;
      col.querySelector(".p99-cards").replaceChildren(...d.cards.filter((x) => same(x.label, c.label)).filter(shown).map((x) => reuse(old.get(x.key), card(x))));
    });
  };
  if (keep) flip(fill, TRAVEL, 260);
  else fill();
  if (at && at !== B.root.activeElement && at.isConnected) at.focus({ preventScroll: true });
  counts();
}

function shown(x) { return typeof B.ctx.keep !== "function" || !!B.ctx.keep(x); }

function reuse(e, n) {
  if (!e) return n;
  e.replaceChildren(...n.childNodes);
  for (const a of ["aria-label", "aria-describedby", "data-order", "data-label"]) {
    if (n.hasAttribute(a)) e.setAttribute(a, n.getAttribute(a));
    else e.removeAttribute(a);
  }
  return e;
}

function person(p) { return typeof p === "string" ? { username: p } : p; }
function handle(p) { return p && p.username ? "@" + p.username : ""; }

function paintHead() {
  B.el.dataset.mine = String(mine());
  B.title.textContent = t("board");
  const word = typeof B.ctx.pickWord === "string" ? B.ctx.pickWord : "";
  B.filter.hidden = !word;
  B.filter.textContent = word ? t("filtered", { what: word }) : "";
}

function src(u) { return typeof u === "string" && (/^\/(?![\/\\])/.test(u) || /^https:\/\//.test(u)) ? u : null; }

function face(p) {
  const name = (p && p.username) || "";
  return [h("img", { src: src(p && p.avatar) || avatarSrc(name, 28), alt: "", width: 28, height: 28, draggable: "false" })];
}

function who(p) {
  if (!p || !p.username) return null;
  return h("span", { class: "p99-who", title: handle(p) }, ...face(p));
}

function card(c) {
  const e = h("li", { class: "p99-card", "data-id": c.key, "data-kind": c.kind, tabindex: "0", "aria-roledescription": t("board_card") });
  if (mine()) e.setAttribute("aria-describedby", "p99-drag-help");
  e.dataset.order = String(c.order == null ? "" : c.order);
  e.dataset.label = c.label;
  const a = person(c.assignee);
  e.append(h("div", { class: "p99-card-top" }, h("span", { class: "p99-key", text: c.key }), who(a)), h("b", { class: "p99-card-title", text: c.title }), c.project ? h("span", { class: "p99-card-project", text: c.project }) : null);
  e.setAttribute("aria-label", c.key + ", " + c.title + (c.project ? ", " + c.project : "") + (a && a.username ? ", " + handle(a) : ""));
  return e;
}

function counts() {
  for (const col of B.cols.querySelectorAll(".p99-col[data-label]")) col.querySelector(".p99-count").textContent = col.querySelectorAll(".p99-card").length;
}

function cards() { return Array.from(B.cols.querySelectorAll(".p99-card")); }
function columnOf(e) { return e.closest(".p99-col"); }
function column(name) { return Array.from(B.cols.children).find((c) => same(c.dataset.label, name)) || null; }
function find(id) { return cards().find((e) => e.dataset.id === id) || null; }
function label(e) { return e.getAttribute("aria-label") || e.dataset.id; }

function flip(change, easing, ms, scope) {
  const list = scope || cards();
  const from = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  for (const e of list) for (const a of e.getAnimations()) if (a.id === "p99-flip") a.cancel();
  change();
  if (still.matches) return;
  for (const e of scope || cards()) {
    const a = from.get(e);
    if (!a) {
      e.animate([{ opacity: 0, scale: "0.96" }, { opacity: 1, scale: "1" }], { duration: ms || 220, easing: ARRIVE }).id = "p99-flip";
      continue;
    }
    const b = e.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: ms || 220, easing: easing || TRAVEL }).id = "p99-flip";
  }
}

function kin(a, b) { return Array.from(a.children).concat(b && b !== a ? Array.from(b.children) : []); }

function slot(list, y, skip) {
  for (const e of list.children) {
    if (e === skip) continue;
    const r = e.getBoundingClientRect();
    if (y < r.top + r.height / 2) return e;
  }
  return null;
}

function press(e) {
  const c = e.button === 0 && !B.drag && mine() && e.target.closest(".p99-card");
  if (!c || e.target.closest("a, button")) return;
  const d = { card: c, id: c.dataset.id, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, pointer: e.pointerId, touch: e.pointerType === "touch", up: false, ghost: null, home: [c.parentNode, c.nextSibling], timer: 0, raf: 0, m: null, over: null, queue: [] };
  B.drag = d;
  if (d.touch) d.timer = setTimeout(() => lift(d.x, d.y), 220);
  B.el.addEventListener("pointermove", move);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", abort, true);
}

function lift(x, y) {
  const d = B.drag;
  if (!d || d.up) return;
  d.up = true;
  d.focus = B.root.activeElement === d.card;
  if (d.focus) B.el.focus({ preventScroll: true });
  const r = d.card.getBoundingClientRect();
  d.dx = x - r.left;
  d.dy = y - r.top;
  try { B.el.setPointerCapture(d.pointer); } catch (err) {}
  const g = d.card.cloneNode(true);
  g.classList.add("p99-ghost");
  g.removeAttribute("tabindex");
  g.removeAttribute("id");
  g.setAttribute("aria-hidden", "true");
  g.style.width = r.width + "px";
  g.style.height = r.height + "px";
  g.style.translate = r.left + "px " + r.top + "px";
  B.root.append(g);
  d.ghost = g;
  d.card.classList.add("is-placeholder");
  measure(d);
  B.cols.addEventListener("scroll", scrolled, true);
  window.addEventListener("resize", resized);
  if (!still.matches) g.animate([{ scale: "1", rotate: "0deg" }, { scale: "1.04", rotate: "-1.5deg" }], { duration: 160, easing: ARRIVE, fill: "forwards" });
  announce("lifted", d.card);
  if (navigator.vibrate && d.touch) navigator.vibrate(8);
}

function measure(d) {
  const st = getComputedStyle(d.card.parentNode);
  const pad = parseFloat(st.paddingTop) || 0, padb = parseFloat(st.paddingBottom) || 0;
  d.gap = parseFloat(st.rowGap) || 0;
  d.s = d.card.offsetHeight + d.gap;
  d.sl = B.cols.scrollLeft;
  d.view = B.cols.getBoundingClientRect();
  d.ct = 0;
  d.m = new Map();
  for (const col of B.cols.children) {
    const list = col.querySelector(".p99-cards");
    if (!list) continue;
    const c = col.getBoundingClientRect(), r = list.getBoundingClientRect();
    const rows = [];
    let k = -1;
    for (const e of list.children) {
      if (e === d.card) { k = rows.length; continue; }
      rows.push({ e, y: e.offsetTop - (k >= 0 ? d.s : 0), h: e.offsetHeight, t: 0 });
    }
    d.m.set(list, { list, col, count: col.querySelector(".p99-count"), left: c.left + d.sl, right: c.right + d.sl, top: c.top, bottom: c.bottom, ltop: r.top, lbottom: r.bottom, pad, padb, scroll: list.scrollTop, rows });
    if (k >= 0) { d.list = list; d.k = d.j = k; }
  }
}

function move(e) {
  const d = B.drag;
  if (!d || e.pointerId !== d.pointer) return;
  if (!d.up) {
    const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (d.touch) { if (far > 8) abort(); return; }
    if (far < 5) return;
  }
  d.px = e.clientX;
  d.py = e.clientY;
  frame(d);
}

function frame(d) {
  if (!d.raf) d.raf = requestAnimationFrame(() => tick(d));
}

function tick(d) {
  d.raf = 0;
  if (B.drag !== d) return;
  if (!d.up) lift(d.x, d.y);
  if (!d.m) measure(d);
  d.ghost.style.translate = (d.px - d.dx) + "px " + (d.py - d.dy) + "px";
  const rolling = roll(d);
  hover(d);
  if (rolling) frame(d);
}

function top(d, m, j) {
  const r = m.rows, n = r.length;
  return j < n ? r[j].y : n ? r[n - 1].y + r[n - 1].h + d.gap : m.pad;
}

function pick(d, m, y, at) {
  const r = m.rows;
  for (let i = 0; i < r.length; i++) if (y < r[i].y + (i >= at ? d.s : 0) + r[i].h / 2) return i;
  return r.length;
}

function hover(d) {
  const x = d.px + d.sl, v = d.view;
  let m = null;
  if (d.px >= v.left && d.px <= v.right && d.py >= v.top && d.py <= v.bottom) {
    for (const o of d.m.values()) if (x >= o.left && x <= o.right && d.py >= o.top && d.py <= o.bottom) { m = o; break; }
  }
  const col = m && m.col;
  if (col !== d.over) {
    if (d.over) d.over.classList.remove("is-target");
    if (col) col.classList.add("is-target");
    d.over = col;
  }
  if (!m) return;
  const y = d.py - m.ltop + m.scroll;
  if (m.list !== d.list) return cross(d, m, pick(d, m, y, m.rows.length));
  const j = pick(d, m, y, d.j);
  if (j !== d.j) place(d, m, j);
}

function nudge(e, was, now, dx) {
  e.style.translate = now ? "0 " + now + "px" : "";
  if (still.matches || (was === now && !dx)) return;
  e.animate([{ translate: (dx || 0) + "px " + (was - now) + "px" }, { translate: "0 0" }], { duration: 200, easing: TRAVEL, composite: "add" }).id = "p99-shift";
}

function place(d, m, j) {
  const s = d.s, k = d.k;
  m.rows.forEach((o, i) => {
    const t = (i >= j ? s : 0) - (i >= k ? s : 0);
    if (t !== o.t) { nudge(o.e, o.t, t); o.t = t; }
  });
  const was = d.ct;
  d.j = j;
  d.ct = top(d, m, j) - top(d, m, k);
  nudge(d.card, was, d.ct);
}

function cross(d, m, j) {
  const o = d.m.get(d.list), s = d.s;
  const dy = o.ltop - o.scroll + top(d, o, d.j) - (m.ltop - m.scroll + top(d, m, j));
  o.rows.forEach((r, i) => {
    const was = i >= d.j ? s : 0;
    if (was || r.t) nudge(r.e, was, 0);
    r.t = 0;
  });
  m.rows.forEach((r, i) => { if (i >= j) nudge(r.e, -s, 0); });
  m.list.insertBefore(d.card, j < m.rows.length ? m.rows[j].e : null);
  nudge(d.card, dy, 0, o.left - m.left);
  o.count.textContent = o.rows.length;
  m.count.textContent = m.rows.length + 1;
  d.list = m.list;
  d.k = d.j = j;
  d.ct = 0;
}

function settle(d) {
  if (!d.m) return;
  const m = d.m.get(d.list);
  if (d.j !== d.k) d.list.insertBefore(d.card, d.j < m.rows.length ? m.rows[d.j].e : null);
  for (const r of m.rows) if (r.t) { r.e.style.translate = ""; r.t = 0; }
  d.card.style.translate = "";
  d.k = d.j;
  d.ct = 0;
}

function roll(d) {
  let on = false;
  for (const m of d.m.values()) {
    if (d.px < m.left - d.sl || d.px > m.right - d.sl) continue;
    const v = d.py < m.ltop + 48 ? d.py - m.ltop - 48 : d.py > m.lbottom - 48 ? d.py - m.lbottom + 48 : 0;
    const max = Math.max(0, top(d, m, m.rows.length) - d.gap + (m.list === d.list ? d.s : 0) + m.padb - (m.lbottom - m.ltop));
    const to = Math.max(0, Math.min(max, m.scroll + v / 4));
    if (!v || to === m.scroll) continue;
    m.scroll = to;
    m.list.scrollTop = to;
    on = true;
  }
  return on;
}

function scrolled(e) {
  const d = B.drag;
  if (!d || !d.m) return;
  if (e.target === B.cols) d.sl = B.cols.scrollLeft;
  else {
    const m = d.m.get(e.target);
    if (!m) return;
    m.scroll = e.target.scrollTop;
  }
  frame(d);
}

function resized() {
  const d = B.drag;
  if (!d || !d.m) return;
  settle(d);
  d.m = null;
  frame(d);
}

function unbind(d) {
  B.el.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", release, true);
  window.removeEventListener("pointercancel", abort, true);
  B.cols.removeEventListener("scroll", scrolled, true);
  window.removeEventListener("resize", resized);
  if (d.raf) cancelAnimationFrame(d.raf);
  d.raf = 0;
}

function release(e) {
  const d = B.drag;
  if (!d || e.pointerId !== d.pointer) return;
  clearTimeout(d.timer);
  if (d.raf) { cancelAnimationFrame(d.raf); tick(d); }
  unbind(d);
  if (!d.up) { B.drag = null; later(); return; }
  B.quiet = Date.now();
  settle(d);
  land(d, () => commit(d));
}

function abort(e) {
  const d = B.drag;
  if (!d || (e && e.pointerId !== d.pointer)) return;
  clearTimeout(d.timer);
  unbind(d);
  if (!d.up) { B.drag = null; later(); return; }
  cancel();
}

function land(d, then) {
  if (d.over) d.over.classList.remove("is-target");
  d.over = null;
  const g = d.ghost;
  const finish = () => {
    if (g) g.remove();
    d.card.classList.remove("is-placeholder", "is-lifted");
    if (B.drag === d) B.drag = null;
    if (d.focus && d.card.isConnected) d.card.focus({ preventScroll: true });
    replay(d);
    then();
  };
  if (!g || still.matches) return finish();
  const r = d.card.getBoundingClientRect();
  const a = g.animate([{ translate: g.style.translate }, { translate: r.left + "px " + r.top + "px", scale: "1", rotate: "0deg" }], { duration: 180, easing: ARRIVE, fill: "forwards", composite: "replace" });
  a.onfinish = a.oncancel = finish;
}

function replay(d) {
  const q = d.queue;
  d.queue = [];
  for (const ev of q) {
    if (ev.key !== d.id) event(ev);
    else B.stale = true;
  }
}

function cancel() {
  const d = B.drag;
  if (!d) return;
  settle(d);
  const [list, next] = d.home;
  flip(() => list.insertBefore(d.card, next && next.parentNode === list ? next : null), TRAVEL, 220, kin(list, d.card.parentNode));
  counts();
  land(d, () => { announce("cancelled", d.card); later(); });
}

function commit(d) {
  const [list, next] = d.home;
  const e = d.card;
  if (e.parentNode === list && e.nextSibling === next) return later();
  const from = columnOf(list).dataset.label;
  const to = columnOf(e).dataset.label;
  const body = { key: e.dataset.id, from, to: columnOf(e).dataset.word };
  const prev = e.previousElementSibling, nxt = e.nextElementSibling;
  if (nxt) body.before = nxt.dataset.id;
  else if (prev) body.after = prev.dataset.id;
  announce("dropped", e, { column: to });
  e.dataset.label = to;
  B.ctx.call("POST", "/move", JSON.stringify(body)).then((r) => {
    const c = r && r.card;
    if (c && c.order != null) e.dataset.order = String(c.order);
    later();
  }, (err) => {
    if (err && err.status === 401) return close();
    if (err && err.status === 409) {
      note(err.message || t("moved"));
      return refresh();
    }
    later();
    e.dataset.label = from;
    flip(() => list.insertBefore(e, next && next.parentNode === list ? next : null), TRAVEL, 260);
    counts();
    note(t("move_failed", { card: e.dataset.id }) + (err && err.status && err.message ? " " + err.message : ""));
  });
}

function tap(e) {
  const c = e.target.closest(".p99-card");
  if (!c || B.drag || Date.now() - B.quiet < 300 || e.target.closest("a, button")) return;
  enter(c);
}

function enter(c) {
  if (B.ctx.item) B.ctx.item(c.dataset.id, c);
}

function keys(e) {
  if (!B.open || e.defaultPrevented) return;
  const d = B.drag;
  if (e.key === "Tab") {
    if (d && d.keys) { e.preventDefault(); drop(); return; }
    trap(e);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (d) { if (d.keys) undo(); else abort(); }
    else close();
    return;
  }
  const c = e.target.closest && e.target.closest(".p99-card");
  if (d && d.keys) {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); drop(); return; }
    const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    shift(step[0], step[1]);
    return;
  }
  if (!c || d) return;
  if (e.key === " " && mine()) { e.preventDefault(); grab(c); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enter(c); }
  else if (/^Arrow/.test(e.key)) { e.preventDefault(); walk(c, e.key); }
}

function trap(e) {
  const at = B.root.activeElement;
  if (at && !B.el.contains(at)) return;
  const list = Array.from(B.el.querySelectorAll("button:not(:disabled), [tabindex='0']")).filter((n) => n.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && (at === first || at === B.el)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
}

function walk(c, key) {
  const col = columnOf(c);
  const sib = key === "ArrowUp" ? c.previousElementSibling : key === "ArrowDown" ? c.nextElementSibling : null;
  if (sib) return sib.focus();
  if (key !== "ArrowLeft" && key !== "ArrowRight") return;
  let other = key === "ArrowLeft" ? col.previousElementSibling : col.nextElementSibling;
  while (other && !other.querySelector(".p99-card")) other = key === "ArrowLeft" ? other.previousElementSibling : other.nextElementSibling;
  if (other) nearest(other.querySelector(".p99-cards"), c.getBoundingClientRect().top).focus();
}

function nearest(list, y) {
  let best = null, gap = Infinity;
  for (const e of list.children) {
    const g = Math.abs(e.getBoundingClientRect().top - y);
    if (g < gap) { gap = g; best = e; }
  }
  return best;
}

function grab(c) {
  B.drag = { card: c, id: c.dataset.id, keys: true, up: true, home: [c.parentNode, c.nextSibling] };
  c.classList.add("is-lifted");
  announce("lifted", c);
}

function shift(dx, dy) {
  const c = B.drag.card;
  const list = c.parentNode;
  if (dy) {
    const to = dy < 0 ? c.previousElementSibling : c.nextElementSibling;
    if (!to) return;
    flip(() => list.insertBefore(c, dy < 0 ? to : to.nextSibling), TRAVEL, 200, Array.from(list.children));
  } else {
    const col = dx < 0 ? columnOf(c).previousElementSibling : columnOf(c).nextElementSibling;
    if (!col) return;
    const into = col.querySelector(".p99-cards");
    const y = c.getBoundingClientRect().top;
    flip(() => into.insertBefore(c, slot(into, y + 1, c)), TRAVEL, 220, kin(list, into));
    counts();
  }
  c.focus({ preventScroll: true });
  c.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still.matches ? "auto" : "smooth" });
  const all = Array.from(c.parentNode.children);
  announce("over", c, { column: columnOf(c).dataset.label, pos: all.indexOf(c) + 1, count: all.length });
}

function drop() {
  const d = B.drag;
  d.card.classList.remove("is-lifted");
  B.drag = null;
  d.card.focus({ preventScroll: true });
  commit(d);
}

function undo() {
  const d = B.drag;
  const [list, next] = d.home;
  d.card.classList.remove("is-lifted");
  flip(() => list.insertBefore(d.card, next && next.parentNode === list ? next : null), TRAVEL, 220, kin(list, d.card.parentNode));
  counts();
  B.drag = null;
  d.card.focus({ preventScroll: true });
  announce("cancelled", d.card);
  later();
}

function announce(key, e, args) {
  B.say.textContent = t(key, Object.assign({ card: label(e) }, args));
}

function note(text) {
  if (B.note) B.note.remove();
  if (!text) return;
  const n = h("p", { class: "p99-board-note", role: "alert", text });
  B.note = n;
  B.el.append(n);
  setTimeout(() => { if (B.note === n) { n.remove(); B.note = null; } }, 5000);
}

function state(s) {
  B.live.dataset.state = s;
  B.live.textContent = t(s === "live" ? "live" : s === "connecting" ? "connecting" : "offline_live");
}

function listen() {
  if (B.ws || !B.open) return;
  state("connecting");
  B.ctx.call("POST", "/stream-ticket").then((r) => {
    const ticket = r && (r.ticket || r.t);
    if (!B.open || !ticket) throw new Error("no ticket");
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/_p99/api/stream?t=" + encodeURIComponent(ticket) + (B.ctx.host ? "&host=" + encodeURIComponent(B.ctx.host) : ""));
    B.ws = ws;
    ws.onopen = () => { B.tries = 0; state("live"); };
    ws.onmessage = (m) => { try { event(JSON.parse(m.data)); } catch (x) {} };
    ws.onclose = () => { if (B.ws === ws) { B.ws = null; again(); } };
  }).catch(() => again());
}

function again() {
  if (!B.open) return;
  state("off");
  clearTimeout(B.timer);
  const wait = Math.min(30000, 1000 * Math.pow(2, B.tries++)) * (0.75 + Math.random() * 0.5);
  B.timer = setTimeout(listen, wait);
}

function hang() {
  clearTimeout(B.timer);
  clearTimeout(B.reload);
  const ws = B.ws;
  B.ws = null;
  B.tries = 0;
  if (ws) ws.close(1000);
  state("off");
}

function refresh() {
  B.stale = false;
  clearTimeout(B.reload);
  return load();
}

function soon() {
  B.stale = true;
  clearTimeout(B.reload);
  B.reload = setTimeout(() => {
    if (!B.open || B.drag) return;
    refresh();
  }, 250);
}

function later() {
  if (B.stale) soon();
}

function event(ev) {
  if (!ev || !B.data) return;
  if (ev.host && ev.host !== (B.ctx.host || location.hostname)) return;
  if (B.drag && B.drag.up && !B.drag.keys) return void B.drag.queue.push(ev);
  if (ev.type === "label") return filtered() ? soon() : relabel(ev.key, ev.to);
  if (ev.type === "order") return ev.rebalanced ? soon() : reorder(ev.key, ev.order);
  if (ev.type === "delete") return gone(ev.key);
  soon();
}

function gone(id) {
  const e = find(id);
  if (!e) return;
  if (B.drag && B.drag.id === id) return soon();
  flip(() => e.remove(), TRAVEL, 200);
  counts();
}

function slotFor(list, e, order) {
  for (const o of list.children) if (o !== e && o.dataset.order > order) return o;
  return null;
}

function relabel(id, to) {
  if (B.drag && B.drag.id === id) return soon();
  const e = find(id);
  const col = column(to);
  if (!e) return col ? soon() : undefined;
  if (!col) return gone(id);
  e.dataset.label = to;
  const list = col.querySelector(".p99-cards");
  if (e.parentNode === list) return;
  flip(() => list.insertBefore(e, slotFor(list, e, e.dataset.order)), TRAVEL, 260);
  counts();
}

function reorder(id, order) {
  if (B.drag && B.drag.id === id) return soon();
  const e = find(id);
  if (!e) return;
  e.dataset.order = String(order);
  const list = e.parentNode;
  const before = slotFor(list, e, e.dataset.order);
  if (e.nextSibling === before) return;
  flip(() => list.insertBefore(e, before), TRAVEL, 260);
}

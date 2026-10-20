import { avatarSrc } from "/_p99/avatar.js?v=__P99_VERSION__";

const ARRIVE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const TRAVEL = "cubic-bezier(0.4, 0, 0.2, 1)";
const KEYS = ["inbox", "doing", "review", "done"];
const WORDS = {
  board: "Board",
  boards: "Boards",
  close_board: "Close the board",
  live: "Live",
  connecting: "Connecting…",
  offline_live: "Not live",
  empty_column: "Nothing here",
  board_card: "Board",
  rollup: "{done} of {total} done",
  resolution_abandoned: "Dropped",
  resolution_duplicate: "Duplicate",
  unassigned: "Unassigned",
  drag_help: "Space lifts a card, the arrows move it, Space or Enter drops it, Escape puts it back.",
  lifted: "Lifted {card}.",
  over: "{card}: {column}, {pos} of {count}.",
  dropped: "Dropped {card} in {column}.",
  cancelled: "Put {card} back.",
  move_failed: "Couldn't move {card}; it's back where it was.",
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
.p99-board .p99-logo{min-width:43px;height:36px;font-size:24px}
.p99-crumbs{display:flex;align-items:baseline;gap:var(--p99-space-sm);min-width:0;margin:0;padding:0;list-style:none}
.p99-crumbs li{display:flex;align-items:baseline;gap:var(--p99-space-sm);min-width:0;white-space:nowrap}
.p99-crumbs li+li::before{content:"›";color:var(--p99-muted)}
.p99-crumbs a{color:var(--p99-muted);font-size:var(--p99-text-sm);text-decoration:none}
.p99-crumbs a:hover{color:var(--p99-ink)}
.p99-crumbs h2{margin:0;overflow:hidden;text-overflow:ellipsis;font:var(--p99-weight-bold) var(--p99-text-xl)/var(--p99-leading-tight) var(--p99-font-display)}
.p99-board-head .p99-roll{margin-left:var(--p99-space-xs)}
.p99-live{display:inline-flex;align-items:center;gap:6px;margin-left:auto;color:var(--p99-muted);font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-text);letter-spacing:var(--p99-tracking-caps);text-transform:uppercase}
.p99-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--p99-rule)}
.p99-live[data-state=live]::before{background:var(--p99-status-validated);box-shadow:0 0 0 3px color-mix(in srgb,var(--p99-status-validated) 22%,transparent)}
.p99-live[data-state=connecting]::before{background:var(--p99-status-warning);animation:p99-pulse 1.4s var(--p99-ease-in-out) infinite}
.p99-board .p99-x{display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:var(--p99-radius-full);background:transparent;color:var(--p99-muted);font:var(--p99-weight-medium) 25.6px/1 var(--p99-font-text);cursor:pointer}
.p99-board .p99-x:hover{background:color-mix(in srgb,var(--p99-ink) 8%,transparent);color:var(--p99-ink)}
.p99-cols{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:var(--p99-space-lg);padding:var(--p99-space-md) var(--p99-space-xl) var(--p99-space-xl);overflow-x:auto}
.p99-col{display:flex;flex-direction:column;min-height:0;border-radius:var(--p99-radius-md);background:color-mix(in srgb,var(--p99-ink) 7%,transparent);box-shadow:inset 0 2px 4px rgba(12,26,43,.22),inset 0 -1px 0 rgba(255,255,255,.25)}
.p99-col-head{display:flex;align-items:center;gap:var(--p99-space-sm);padding:var(--p99-space-md) var(--p99-space-md) var(--p99-space-sm);border-top:3px solid var(--p99-tone);border-radius:var(--p99-radius-md) var(--p99-radius-md) 0 0}
.p99-col-head h3{margin:0;font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-text);letter-spacing:var(--p99-tracking-caps);text-transform:uppercase}
.p99-count{padding:0 var(--p99-space-sm);border-radius:var(--p99-radius-full);background:color-mix(in srgb,var(--p99-ink) 10%,transparent);color:var(--p99-muted);font:var(--p99-weight-bold) var(--p99-text-xs)/1.6 var(--p99-font-text)}
.p99-col[data-status=inbox]{--p99-tone:var(--p99-accent-ink)}
.p99-col[data-status=doing]{--p99-tone:var(--p99-status-in-review)}
.p99-col[data-status=review]{--p99-tone:var(--p99-status-warning)}
.p99-col[data-status=done]{--p99-tone:var(--p99-status-validated)}
.p99-col.is-target{background:color-mix(in srgb,var(--p99-accent) 10%,color-mix(in srgb,var(--p99-ink) 7%,transparent));box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--p99-accent) 55%,transparent),inset 0 2px 4px rgba(12,26,43,.22)}
.p99-cards{flex:1;min-height:48px;margin:0;padding:var(--p99-space-xs) var(--p99-space-md) var(--p99-space-md);list-style:none;display:flex;flex-direction:column;gap:var(--p99-space-sm);overflow-y:auto;overscroll-behavior:contain}
.p99-cards:empty::after{content:attr(data-empty);padding:var(--p99-space-lg) 0;color:var(--p99-muted);font-size:var(--p99-text-sm);text-align:center}
.p99-card{position:relative;display:grid;gap:6px;padding:var(--p99-space-md);border:1px solid var(--p99-rule);border-radius:var(--p99-radius-md);background:var(--p99-raised);color:var(--p99-ink);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 1px 2px rgba(12,26,43,.18);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:manipulation;transition:border-color var(--p99-motion-hover-out) var(--p99-ease-in-out),box-shadow var(--p99-motion-hover-out) var(--p99-ease-in-out),scale var(--p99-motion-base) var(--p99-ease-enter)}
.p99-card:hover{border-color:var(--p99-muted)}
.p99-card:focus-visible{outline:2px solid var(--p99-focus);outline-offset:2px}
.p99-card-top{display:flex;align-items:center;gap:var(--p99-space-sm);min-width:0}
.p99-card .p99-key{font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-mono);letter-spacing:.02em;color:var(--p99-muted)}
.p99-card-title{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-weight:var(--p99-weight-medium);font-size:var(--p99-text-sm);line-height:1.4}
.p99-card-foot{display:flex;align-items:center;gap:var(--p99-space-xs);flex-wrap:wrap;min-height:22px}
.p99-res{padding:0 var(--p99-space-sm);border-radius:var(--p99-radius-full);background:color-mix(in srgb,var(--p99-ink) 10%,transparent);color:var(--p99-muted);font:var(--p99-weight-medium) 11px/1.7 var(--p99-font-text)}
.p99-who{flex:none;width:24px;height:24px;margin-left:auto;border-radius:50%}
.p99-tags{display:inline-flex;flex-wrap:wrap;gap:var(--p99-space-xs)}
.p99-tag{display:inline-flex;align-items:center;gap:5px;padding:0 var(--p99-space-sm);border:1px solid color-mix(in srgb,var(--p99-tag) 55%,var(--p99-raised));border-radius:var(--p99-radius-full);background:color-mix(in srgb,var(--p99-tag) 16%,var(--p99-raised));color:var(--p99-ink);font:var(--p99-weight-medium) 11px/1.7 var(--p99-font-text)}
.p99-tag::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--p99-tag)}
.p99-card[data-type=board]{margin:0 6px 6px 0;border-color:color-mix(in srgb,var(--p99-accent) 50%,var(--p99-rule));background:color-mix(in srgb,var(--p99-accent) 9%,var(--p99-raised));box-shadow:inset 4px 0 0 var(--p99-accent),inset 0 1px 0 rgba(255,255,255,.5),3px 3px 0 -1px var(--p99-raised),3px 3px 0 0 color-mix(in srgb,var(--p99-accent) 40%,var(--p99-rule)),6px 6px 0 -1px var(--p99-raised),6px 6px 0 0 color-mix(in srgb,var(--p99-accent) 25%,var(--p99-rule))}
.p99-card[data-type=board] .p99-card-title{font-size:var(--p99-text-md);font-weight:var(--p99-weight-bold)}
.p99-sub-mark{display:inline-flex;align-items:center;gap:5px;color:var(--p99-accent-ink);font:var(--p99-weight-bold) 11px var(--p99-font-text);letter-spacing:var(--p99-tracking-caps);text-transform:uppercase}
.p99-sub-mark::before{content:"";width:10px;height:10px;border-radius:2px;background:linear-gradient(90deg,currentColor 0 3px,transparent 3px 4px,currentColor 4px 6px,transparent 6px 7px,currentColor 7px)}
.p99-roll{display:inline-flex;align-items:center;gap:var(--p99-space-sm);font:var(--p99-weight-bold) var(--p99-text-xs) var(--p99-font-mono);color:var(--p99-muted)}
.p99-bar{position:relative;width:72px;height:6px;overflow:hidden;border-radius:var(--p99-radius-full);background:color-mix(in srgb,var(--p99-ink) 14%,transparent)}
.p99-bar i{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:var(--p99-status-validated)}
.p99-card.is-placeholder{border:2px dashed;border-color:color-mix(in srgb,var(--p99-accent) 70%,var(--p99-rule));background:color-mix(in srgb,var(--p99-accent) 8%,transparent);box-shadow:none}
.p99-card.is-placeholder>*{visibility:hidden}
.p99-card.is-lifted{scale:1.03;z-index:1;border-color:var(--p99-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--p99-accent) 45%,transparent),0 10px 24px rgba(12,26,43,.3)}
.p99-ghost{position:fixed;left:0;top:0;z-index:2147483003;margin:0;pointer-events:none;cursor:grabbing;font:400 var(--p99-text-md)/var(--p99-leading-normal) var(--p99-font-text);text-align:left;box-shadow:0 16px 32px rgba(12,26,43,.34),0 2px 6px rgba(12,26,43,.2);will-change:translate}
.p99-board-note{position:absolute;left:50%;bottom:var(--p99-space-lg);translate:-50% 0;max-width:min(560px,90%);padding:var(--p99-space-sm) var(--p99-space-lg);border-radius:var(--p99-radius-sm);background:var(--p99-ink);color:var(--p99-base);font-size:var(--p99-text-sm);animation:p99-fade var(--p99-motion-base) var(--p99-ease-enter) both}
.p99-board .p99-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (max-width:599px){.p99-board{inset:0;border-radius:0}.p99-cols{grid-template-columns:repeat(4,minmax(78vw,1fr));scroll-snap-type:x mandatory;padding:var(--p99-space-sm) var(--p99-space-lg) var(--p99-space-lg)}.p99-col{scroll-snap-align:center}.p99-board-head{padding-left:var(--p99-space-lg)}.p99-board .p99-logo{display:none}}
@media (prefers-reduced-motion:reduce){.p99-board{transform:none;transition-duration:var(--p99-motion-fast)}.p99-card{transition:none}.p99-live[data-state=connecting]::before{animation:none}}
`;

const still = matchMedia("(prefers-reduced-motion: reduce)");
const B = { open: false, root: null, ctx: null, el: null, scrim: null, cols: null, crumbs: null, roll: null, live: null, say: null, note: null, slug: null, data: null, boards: null, seq: 0, quiet: 0, stale: false, drag: null, ws: null, tries: 0, timer: 0, reload: 0, focus: null };

export function open(ctx) {
  if (B.el && B.root !== ctx.root) {
    hang();
    B.el = null;
    B.open = false;
    B.boards = null;
    B.slug = null;
    B.data = null;
  }
  B.ctx = ctx;
  if (!B.el) build(ctx.root);
  if (!B.open) show();
  return load(ctx.slug || B.slug || remembered());
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
  B.crumbs = h("ol", { class: "p99-crumbs" });
  B.roll = h("span", { class: "p99-roll" });
  B.live = h("span", { class: "p99-live", "data-state": "off", text: t("offline_live") });
  B.cols = h("div", { class: "p99-cols" });
  B.say = h("p", { class: "p99-sr", role: "status", "aria-live": "assertive" });
  const x = h("button", { type: "button", class: "p99-x", "aria-label": t("close_board"), title: t("close_board"), onclick: () => close() }, h("span", { "aria-hidden": "true", text: "×" }));
  B.el = h("div", { class: "p99-board", role: "dialog", "aria-modal": "true", "aria-labelledby": "p99-board-title", tabindex: "-1", hidden: true },
    h("header", { class: "p99-board-head" }, h("b", { class: "p99-logo", text: "P99" }), h("nav", { "aria-label": t("boards") }, B.crumbs), B.roll, B.live, x),
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

function remembered() {
  try { return sessionStorage.getItem("p99:board"); } catch (x) { return null; }
}

function homeOf(boards) {
  const host = B.ctx.host || location.hostname;
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const roots = boards.filter((b) => !b.parent);
  const pick = boards.find((b) => b.home && b.host === host) || boards.find((b) => b.slug === slug) || roots.find((b) => b.host === host) || roots[0] || boards[0];
  return pick && pick.slug;
}

function load(slug) {
  const seq = ++B.seq;
  const all = B.boards ? Promise.resolve(B.boards) : B.ctx.call("GET", "/boards").then((r) => (B.boards = (r && r.boards) || []));
  return all.then((boards) => {
    const want = slug && boards.some((b) => b.slug === slug) ? slug : homeOf(boards);
    if (!want) return null;
    return B.ctx.call("GET", "/boards/" + encodeURIComponent(want)).then((d) => {
      if (seq !== B.seq || !B.open || !d) return;
      B.slug = want;
      try { sessionStorage.setItem("p99:board", want); } catch (x) {}
      B.data = d;
      paint();
    });
  }).catch((e) => {
    if (e && e.status === 401) return close();
    if (seq === B.seq) note(e && e.message);
  });
}

function statuses() {
  const list = (B.data && B.data.statuses) || KEYS.map((key, i) => ({ key, name: key, position: i }));
  return list.slice().sort((a, b) => a.position - b.position);
}

function nameOf(status) {
  const s = statuses().find((x) => x.key === status);
  return s ? s.name : status;
}

function paint() {
  const d = B.data;
  paintHead(d.board);
  const list = statuses();
  const same = B.cols.dataset.board === B.slug && B.cols.children.length === list.length && list.every((s, i) => B.cols.children[i].dataset.status === s.key);
  const old = same ? new Map(cards().map((e) => [e.dataset.id, e])) : new Map();
  const at = B.root.activeElement;
  const fill = () => {
    if (!same) {
      B.cols.replaceChildren(...list.map((s) => h("section", { class: "p99-col", "data-status": s.key },
        h("header", { class: "p99-col-head" }, h("h3"), h("span", { class: "p99-count", text: "0" })),
        h("ol", { class: "p99-cards", "data-empty": t("empty_column") }))));
      B.cols.dataset.board = B.slug;
    }
    list.forEach((s, i) => {
      const col = B.cols.children[i];
      col.setAttribute("aria-label", s.name);
      col.querySelector("h3").textContent = s.name;
      col.querySelector(".p99-cards").replaceChildren(...d.cards.filter((c) => c.status === s.key).map((c) => reuse(old.get(c.type === "board" ? "board:" + c.slug : c.key), card(c))));
    });
  };
  if (same) flip(fill, TRAVEL, 260);
  else fill();
  if (at && at !== B.root.activeElement && at.isConnected) at.focus({ preventScroll: true });
  counts();
}

function reuse(e, n) {
  if (!e) return n;
  e.replaceChildren(...n.childNodes);
  for (const a of ["aria-label", "data-pos", "data-type"]) e.setAttribute(a, n.getAttribute(a));
  return e;
}

function paintHead(b) {
  const chain = [];
  const by = new Map((B.boards || []).map((x) => [x.slug, x]));
  for (let p = b.parent; p && by.has(p) && chain.length < 16; p = by.get(p).parent) chain.unshift(by.get(p));
  B.crumbs.replaceChildren(
    ...chain.map((x) => h("li", null, h("a", { href: "#", text: x.name, onclick: (e) => { e.preventDefault(); load(x.slug); } }))),
    h("li", null, h("h2", { id: "p99-board-title", text: b.name })));
  B.roll.replaceChildren(...rollup(b.rollup));
}

function rollup(r) {
  if (!r || !r.total) return [];
  const bar = h("span", { class: "p99-bar", role: "img", "aria-label": t("rollup", r) }, h("i"));
  bar.firstChild.style.width = Math.round((100 * r.done) / r.total) + "%";
  return [h("span", { text: r.done + "/" + r.total }), bar];
}

function card(c) {
  const id = c.type === "board" ? "board:" + c.slug : c.key;
  const e = h("li", { class: "p99-card", "data-type": c.type, "data-id": id, tabindex: "0", "aria-roledescription": t("board_card"), "aria-describedby": "p99-drag-help" });
  e.dataset.pos = String(c.position);
  if (c.type === "board") {
    e.append(
      h("div", { class: "p99-card-top" }, h("span", { class: "p99-sub-mark", text: t("board_card") })),
      h("b", { class: "p99-card-title", text: c.name }),
      h("div", { class: "p99-roll" }, rollup(c.rollup)));
    e.setAttribute("aria-label", c.name);
    return e;
  }
  const chips = (c.labels || []).filter((l) => /^#[0-9a-f]{6}$/i.test(l.color || "")).map((l) => {
    const chip = h("span", { class: "p99-tag", text: l.name });
    chip.style.setProperty("--p99-tag", l.color);
    return chip;
  });
  const res = c.status === "done" && c.resolution && c.resolution !== "fixed" ? h("span", { class: "p99-res", text: t("resolution_" + c.resolution) }) : null;
  const who = c.assignee && c.assignee.username ? h("img", { class: "p99-who", src: avatarSrc(c.assignee.username, 24), alt: "@" + c.assignee.username, title: "@" + c.assignee.username, width: 24, height: 24 }) : null;
  e.append(h("div", { class: "p99-card-top" }, h("span", { class: "p99-key", text: c.key })), h("b", { class: "p99-card-title", text: c.title }));
  if (chips.length || res || who) e.append(h("div", { class: "p99-card-foot" }, res, chips.length ? h("span", { class: "p99-tags" }, chips) : null, who));
  e.setAttribute("aria-label", c.key + ", " + c.title);
  return e;
}

function counts() {
  for (const col of B.cols.children) col.querySelector(".p99-count").textContent = col.querySelectorAll(".p99-card").length;
}

function cards() { return Array.from(B.cols.querySelectorAll(".p99-card")); }
function columnOf(e) { return e.closest(".p99-col"); }
function find(id) { return cards().find((e) => e.dataset.id === id) || null; }
function label(e) { return e.getAttribute("aria-label") || e.dataset.id; }

function flip(change, easing, ms) {
  const list = cards();
  const from = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  for (const e of list) for (const a of e.getAnimations()) if (a.id === "p99-flip") a.cancel();
  change();
  if (still.matches) return;
  for (const e of cards()) {
    const a = from.get(e);
    if (!a) continue;
    const b = e.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: ms || 220, easing: easing || TRAVEL }).id = "p99-flip";
  }
}

function slot(list, y, skip) {
  for (const e of list.children) {
    if (e === skip) continue;
    const r = e.getBoundingClientRect();
    if (y < r.top + r.height / 2) return e;
  }
  return null;
}

function press(e) {
  const c = e.button === 0 && !B.drag && e.target.closest(".p99-card");
  if (!c || e.target.closest("a, button")) return;
  const d = { card: c, id: c.dataset.id, x: e.clientX, y: e.clientY, pointer: e.pointerId, touch: e.pointerType === "touch", up: false, ghost: null, home: [c.parentNode, c.nextSibling], timer: 0 };
  B.drag = d;
  if (d.touch) d.timer = setTimeout(() => lift(d.x, d.y), 220);
  B.el.addEventListener("pointermove", move);
  B.el.addEventListener("pointerup", release);
  B.el.addEventListener("pointercancel", abort);
}

function lift(x, y) {
  const d = B.drag;
  if (!d || d.up) return;
  d.up = true;
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
  if (!still.matches) g.animate([{ scale: "1", rotate: "0deg" }, { scale: "1.04", rotate: "-1.5deg" }], { duration: 160, easing: ARRIVE, fill: "forwards" });
  announce("lifted", d.card);
  if (navigator.vibrate && d.touch) navigator.vibrate(8);
}

function move(e) {
  const d = B.drag;
  if (!d || e.pointerId !== d.pointer) return;
  if (!d.up) {
    const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (d.touch) { if (far > 8) abort(); return; }
    if (far < 5) return;
    lift(d.x, d.y);
  }
  d.px = e.clientX;
  d.py = e.clientY;
  d.ghost.style.translate = (e.clientX - d.dx) + "px " + (e.clientY - d.dy) + "px";
  hover(e.clientX, e.clientY);
  scrolling();
}

function hover(x, y) {
  const d = B.drag;
  const hit = B.root.elementFromPoint(x, y);
  const col = hit && hit.closest && hit.closest(".p99-col");
  for (const c of B.cols.children) c.classList.toggle("is-target", c === col);
  if (!col || !B.cols.contains(col)) return;
  const list = col.querySelector(".p99-cards");
  const before = slot(list, y, d.card);
  if (d.card.parentNode === list && (before === d.card.nextSibling || before === d.card)) return;
  flip(() => list.insertBefore(d.card, before), TRAVEL, 200);
  counts();
}

function scrolling() {
  const d = B.drag;
  if (!d || d.scroll) return;
  const step = () => {
    d.scroll = 0;
    if (B.drag !== d || !d.up) return;
    let moved = false;
    for (const list of B.cols.querySelectorAll(".p99-cards")) {
      const r = list.getBoundingClientRect();
      if (d.px < r.left || d.px > r.right) continue;
      const v = d.py < r.top + 48 ? -(r.top + 48 - d.py) : d.py > r.bottom - 48 ? d.py - (r.bottom - 48) : 0;
      if (v) { list.scrollTop += v / 4; moved = true; }
    }
    if (moved) { hover(d.px, d.py); d.scroll = requestAnimationFrame(step); }
  };
  d.scroll = requestAnimationFrame(step);
}

function unbind() {
  B.el.removeEventListener("pointermove", move);
  B.el.removeEventListener("pointerup", release);
  B.el.removeEventListener("pointercancel", abort);
}

function release(e) {
  const d = B.drag;
  if (!d || e.pointerId !== d.pointer) return;
  clearTimeout(d.timer);
  unbind();
  if (!d.up) { B.drag = null; return; }
  B.quiet = Date.now();
  land(d, () => commit(d));
}

function abort() {
  const d = B.drag;
  if (!d) return;
  clearTimeout(d.timer);
  unbind();
  if (!d.up) { B.drag = null; return; }
  cancel();
}

function land(d, then) {
  if (d.scroll) cancelAnimationFrame(d.scroll);
  for (const c of B.cols.children) c.classList.remove("is-target");
  const g = d.ghost;
  const finish = () => {
    if (g) g.remove();
    d.card.classList.remove("is-placeholder", "is-lifted");
    if (B.drag === d) B.drag = null;
    then();
  };
  if (!g || still.matches) return finish();
  const r = d.card.getBoundingClientRect();
  const a = g.animate([{ translate: g.style.translate }, { translate: r.left + "px " + r.top + "px", scale: "1", rotate: "0deg" }], { duration: 180, easing: ARRIVE, fill: "forwards", composite: "replace" });
  a.onfinish = a.oncancel = finish;
}

function cancel() {
  const d = B.drag;
  if (!d) return;
  const [list, next] = d.home;
  flip(() => list.insertBefore(d.card, next && next.parentNode === list ? next : null), TRAVEL, 220);
  counts();
  land(d, () => { announce("cancelled", d.card); later(); });
}

function placeOf(e) {
  const prev = e.previousElementSibling, next = e.nextElementSibling;
  const body = { target: e.dataset.id, to: columnOf(e).dataset.status };
  if (next) body.before = next.dataset.id;
  else if (prev) body.after = prev.dataset.id;
  return body;
}

function commit(d) {
  const [list, next] = d.home;
  const e = d.card;
  if (e.parentNode === list && e.nextSibling === next) return later();
  const from = columnOf(list).dataset.status;
  const body = placeOf(e);
  announce("dropped", e, { column: nameOf(body.to) });
  B.ctx.call("POST", "/move", JSON.stringify(body)).then((r) => {
    if (r && r.moved && r.moved.position != null) e.dataset.pos = String(r.moved.position);
    if (e.dataset.type === "board" || (r && r.changed && r.changed.length > 1) || (from === "done") !== (body.to === "done")) soon();
    else later();
  }, (err) => {
    if (err && err.status === 401) return close();
    later();
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
  const id = c.dataset.id;
  if (id.startsWith("board:")) return load(id.slice(6));
  if (B.ctx.item) B.ctx.item(id, c);
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
  if (e.key === " ") { e.preventDefault(); grab(c); }
  else if (e.key === "Enter") { e.preventDefault(); enter(c); }
  else if (/^Arrow/.test(e.key)) { e.preventDefault(); walk(c, e.key); }
}

function trap(e) {
  const at = B.root.activeElement;
  if (at && !B.el.contains(at)) return;
  const list = Array.from(B.el.querySelectorAll("a[href], button, [tabindex='0']")).filter((n) => n.offsetParent !== null);
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
    flip(() => list.insertBefore(c, dy < 0 ? to : to.nextSibling), TRAVEL, 200);
  } else {
    const col = dx < 0 ? columnOf(c).previousElementSibling : columnOf(c).nextElementSibling;
    if (!col) return;
    const into = col.querySelector(".p99-cards");
    const y = c.getBoundingClientRect().top;
    flip(() => into.insertBefore(c, slot(into, y + 1, c)), TRAVEL, 220);
    counts();
  }
  c.focus({ preventScroll: true });
  c.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still.matches ? "auto" : "smooth" });
  const all = Array.from(c.parentNode.children);
  announce("over", c, { column: nameOf(columnOf(c).dataset.status), pos: all.indexOf(c) + 1, count: all.length });
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
  flip(() => list.insertBefore(d.card, next && next.parentNode === list ? next : null), TRAVEL, 220);
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

function soon() {
  B.stale = true;
  clearTimeout(B.reload);
  B.reload = setTimeout(() => {
    if (!B.open) return;
    if (B.drag) return;
    B.stale = false;
    B.boards = null;
    load(B.slug);
  }, 250);
}

function later() {
  if (B.stale) soon();
}

function within(slug) {
  if (!B.boards) return true;
  const by = new Map(B.boards.map((b) => [b.slug, b]));
  for (let b = by.get(slug), n = 0; b && n < 64; b = by.get(b.parent), n++) if (b.slug === B.slug) return true;
  return false;
}

function event(ev) {
  if (!ev || !B.data) return;
  if (ev.type === "move") return place(ev.key, ev.board, ev.from, ev.to, ev.position);
  if (ev.type === "board.move") return place("board:" + ev.board, ev.parent, ev.from, ev.to, ev.position);
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

function place(id, board, from, to, pos) {
  if (B.drag && B.drag.id === id) return soon();
  const e = find(id);
  if ((from === "done") !== (to === "done") && within(board)) soon();
  if (board !== B.slug) {
    if (e) {
      flip(() => e.remove(), TRAVEL, 200);
      counts();
      soon();
    } else if (within(board)) soon();
    return;
  }
  const col = B.cols.querySelector(`.p99-col[data-status="${to}"]`);
  if (!e || !col) return soon();
  const list = col.querySelector(".p99-cards");
  e.dataset.pos = String(pos);
  let before = null;
  for (const o of list.children) if (o !== e && Number(o.dataset.pos) > pos) { before = o; break; }
  if (e.parentNode === list && e.nextSibling === before) return;
  flip(() => list.insertBefore(e, before), TRAVEL, 260);
  counts();
}

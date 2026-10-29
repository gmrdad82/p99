const V = "__P99_VERSION__";
const WORDS = {
  failed: "Something went wrong; try again.",
  offline: "You're offline; try again when you're back.",
  denied: "That e-mail and code don't match. Check the e-mail, wait for the next code and try again.",
  limited: "Too many tries. Wait a few minutes, then try again.",
  needs: "Enter your e-mail and the 6-digit code.",
  signing: "Signing in…",
  sign_in: "Sign in",
  loading: "Loading…",
  retry: "Try again",
  none: "Nothing in this space is open to you yet. Ask the person who invited you for a P99 link.",
  home: "The space's board",
  projects: "Projects",
  all_projects: "All projects",
  no_hosts: "No sites",
  open_one: "1 open",
  open_many: "{n} open",
  profile: "Profile",
  back: "Board",
  username: "Username",
  username_help: "3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit. People see it as @username.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  taken: "That username is taken; try another.",
  bad_name: "Use 3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit.",
  picture: "Picture",
  pick_picture: "Pick a picture",
  remove_picture: "Remove the picture",
  picture_help: "PNG, JPEG or WebP. It's cropped square and sent at 256 × 256.",
  picture_bad: "That file isn't a picture P99 can read; pick a PNG, JPEG or WebP.",
  picture_big: "That picture is over 256 KB even at 256 × 256; pick another.",
  picture_saved: "Your picture is saved.",
  picture_removed: "Your picture is gone; the pattern is back.",
  licence: "Licence key",
  licence_help: "Paste the key from your PITO MD receipt. The badge changes as soon as it's saved.",
  licence_save: "Save the key",
  licence_remove: "Remove the key",
  licence_saved: "Saved. The badge shows the licence now.",
  licence_removed: "Removed. This space is on Free.",
  licence_removed_binding: "Removed. This space still has {plan} from its own setup.",
  licence_none: "There was no key saved here. This space is on {plan}.",
  licence_empty: "Paste a licence key first.",
  sign_out: "Sign out",
};
const BADGES = { free: "Free", studio: "Studio", agency: "Agency", ff: "F&F" };
const PICTURE = 256;
const PICTURE_BYTES = 256 * 1024;
const PICK_KEY = "p99:page-project";
const SHEET = `:host{--p99-accent:#3b7dd8;color-scheme:light dark}`;
const BOARD = `:host{--p99-accent:#3b7dd8;color-scheme:light dark;display:flex;flex-direction:column;min-height:0}`;
const FULL = `:host{--p99-accent:#3b7dd8;color-scheme:light dark}
:host(.app-full) .p99-panel{top:var(--app-top,var(--app-bar,64px));left:0;right:0;bottom:0;width:auto;max-height:none;border-radius:0;box-shadow:none;--p99-slide:0px;transform:translateY(12px)}
:host(.app-full) .p99-panel.is-open{transform:none}
:host(.app-full) .p99-panel::after{box-shadow:none}
:host(.app-full) .p99-scrim,:host(.app-full) .p99-grip,:host(.app-full) .p99-head{display:none}
:host(.app-full) .p99-scroll{padding-left:max(var(--p99-space-lg),calc((100% - 832px)/2));padding-right:max(var(--p99-space-lg),calc((100% - 832px)/2))}
:host(.app-full) .p99-foot{padding-left:max(var(--p99-space-lg),calc((100% - 832px)/2))}
@media (prefers-reduced-motion:reduce){:host(.app-full) .p99-panel{transform:none}}`;

const root = document.getElementById("app");
const S = { spaces: null, me: null, space: null, panel: null, panelTries: 0, avatar: null, boardMod: null, css: null, seq: 0, badged: false, head: null, board: null, ctx: null, full: null, fullHost: null, sheet: null, pick: null, legacy: null, via: null, reach: new Set() };
const link = document.getElementById("app-css");
const styled = new Promise((done) => {
  if (!link) return done();
  const ready = () => {
    link.media = "all";
    done();
  };
  if (link.sheet) return ready();
  link.addEventListener("load", ready, { once: true });
  link.addEventListener("error", done, { once: true });
});

function say(key, args) {
  const v = WORDS[key] || key;
  return v.replace(/\{([a-z]+)\}/g, (m, k) => (args && k in args ? String(args[k]) : m));
}

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
}

function call(method, path, body, type) {
  const headers = { "X-P99-App": "1", Accept: "application/json" };
  let sent = body;
  if (body !== undefined && body !== null) {
    if (type) headers["Content-Type"] = type;
    else {
      headers["Content-Type"] = "application/json";
      if (typeof body !== "string") sent = JSON.stringify(body);
    }
  }
  return fetch(path, { method, headers, body: sent == null ? undefined : sent, credentials: "same-origin" }).then((r) =>
    r.text().then((t) => {
      let data = null;
      try { data = t ? JSON.parse(t) : null; } catch (x) {}
      if (!r.ok) {
        const e = new Error((data && data.message) || say("failed"));
        e.status = r.status;
        throw e;
      }
      return data;
    }),
  );
}

function hosts() {
  const d = S.spaces || {};
  const list = Array.isArray(d.hosts) ? d.hosts : Array.isArray(d.spaces) ? d.spaces : [];
  return list.map((x) => (typeof x === "string" ? x : x && x.host)).filter((x) => typeof x === "string" && x);
}

function entries() {
  const d = S.spaces || {};
  const list = Array.isArray(d.spaces) ? d.spaces : [];
  return list.filter((x) => x && typeof x.host === "string" && x.host).map((x) => ({ host: x.host, project: typeof x.project === "string" ? x.project : "" }));
}

function firstHost() {
  return S.via || hosts()[0] || null;
}

function reachable() {
  const d = S.spaces || {};
  return !!firstHost() || (Array.isArray(d.projects) && d.projects.length > 0);
}

function hostFor(project) {
  if (!project) return firstHost();
  const own = entries().filter((x) => x.project === project).map((x) => x.host);
  return own.includes(S.via) ? S.via : own[0] || null;
}

function boardHost() {
  const p = picked();
  return S.reach.has(null) ? null : p ? hostFor(p) : firstHost();
}

function listHost(project) {
  return project ? hostFor(project) || firstHost() : S.reach.has(null) ? "*" : firstHost();
}

function at(path, host) {
  const on = host === undefined ? firstHost() : host;
  return "/_p99/api" + path + (on ? (path.includes("?") ? "&" : "?") + "host=" + encodeURIComponent(on) : "");
}

function api(method, path, body, type) {
  return call(method, at(path), body, type);
}

function boardCall(method, path, body) {
  return call(method, at(path, boardHost()), body).catch((e) => {
    signedOut(e);
    throw e;
  });
}

function blob(path) {
  return fetch(at(path), { headers: { "X-P99-App": "1" }, credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : null));
}

function problem(e) {
  if (!navigator.onLine) return say("offline");
  if (e && e.status === 401) return say("denied");
  if (e && e.status === 429) return say("limited");
  if (e && e.status === 400) return say("needs");
  return say("failed");
}

function owner() {
  const m = S.me;
  return !!m && (m.role ? m.role === "owner" : !!m.manager);
}

function licence() {
  const l = S.me && S.me.licence;
  const s = l && typeof l === "object" ? l.state : S.spaces && S.spaces.license;
  return Object.hasOwn(BADGES, s) ? s : "free";
}

function spaceName() {
  const of = (x) => (x && typeof x === "object" && typeof x.name === "string" ? x.name : "");
  return of(S.space && S.space.space) || of(S.me && S.me.space) || of(S.spaces && S.spaces.space) || "";
}

function projects() {
  const list = S.space && Array.isArray(S.space.projects) ? S.space.projects : [];
  return list.filter((p) => p && typeof p.name === "string");
}

function avatarModule() {
  if (!S.avatar) S.avatar = import("/_p99/avatar.js?v=" + V).catch(() => null);
  return S.avatar;
}

function disc(person, size) {
  const p = person || {};
  const name = typeof p.username === "string" ? p.username : "";
  const letter = (p.name || name || spaceName() || "?").slice(0, 1).toUpperCase();
  const fallback = h("span", { class: "app-disc app-disc-letter", "aria-hidden": "true", text: letter });
  if (!name) return fallback;
  const img = h("img", { class: "app-disc", alt: "", width: size, height: size });
  avatarModule().then((m) => {
    if (!m || typeof m.avatarSrc !== "function") return null;
    img.src = m.avatarSrc(name, size);
    fallback.replaceWith(img);
    return typeof m.picture === "function" ? m.picture(p, blob) : null;
  }).then((u) => { if (u) img.src = u; }, () => {});
  return fallback;
}

function badge() {
  if (!S.spaces && !S.me) return null;
  const state = licence();
  const pill = h("img", { class: S.badged ? "app-badge" : "app-badge app-badge-in", src: "/_p99/badges/" + state + ".svg?v=" + V, alt: BADGES[state] + " licence", height: 24 });
  S.badged = true;
  return pill;
}

function head() {
  if (!S.head) {
    S.head = h("header", { class: "app-bar" },
      h("div", { class: "app-bar-in" },
        h("a", { class: "app-mark", href: "#", title: say("home"), "aria-label": say("home"), onclick: (e) => {
          if (location.hash && location.hash !== "#") return;
          e.preventDefault();
          route();
        } },
          h("img", { class: "app-lockup", src: "/_p99/art/lockup-dark.svg?v=" + V, alt: "P99", width: 1371, height: 243 })),
        h("span", { class: "app-pill" }),
        h("div", { class: "app-bar-who" }, h("span", { class: "app-space-name" }),
          h("a", { class: "app-me", href: "#profile", title: say("profile"), "aria-label": say("profile") }))));
  }
  repaintHead();
  return S.head;
}

function repaintHead() {
  if (!S.head) return;
  S.head.querySelector(".app-space-name").textContent = spaceName();
  const pill = S.head.querySelector(".app-pill");
  const want = licence();
  const now = pill.firstChild;
  if (!now || now.dataset.state !== want) {
    const b = badge();
    if (b) b.dataset.state = want;
    pill.replaceChildren(...(b ? [b] : []));
  }
  const me = S.head.querySelector(".app-me");
  const who = (S.me && S.me.username) || "";
  if (me.dataset.who !== who || !me.firstChild) {
    me.dataset.who = who;
    me.replaceChildren(disc(S.me, 36));
  }
}

function mount(screen, view, focus) {
  if (root.dataset.screen !== screen || root.querySelector(".app-wait")) view.classList.add("app-in");
  root.dataset.screen = screen;
  root.replaceChildren(head(), view);
  if (focus) focus.focus({ preventScroll: true });
}

function waiting(screen) {
  mount(screen || "wait", h("div", { class: "app-wait", role: "status", "aria-busy": "true", "aria-label": say("loading") }));
}

function failed(e) {
  if (signedOut(e)) return;
  const seq = S.seq;
  styled.then(() => {
    if (seq !== S.seq) return;
    const again = h("button", { type: "button", text: say("retry"), onclick: route });
    mount("problem", h("div", { class: "app-screen" }, h("section", { class: "app-card app-problem" },
      h("p", { class: "app-error", role: "alert", text: problem(e) }),
      h("div", { class: "app-actions" }, again))), again);
  });
}

function signedOut(e) {
  if (e && e.status === 401) {
    forgetAll();
    signIn();
    return true;
  }
  return false;
}

function forgetAll() {
  S.via = null;
  S.reach = new Set();
  S.spaces = null;
  S.me = null;
  S.space = null;
}

function signIn(note) {
  leave();
  let form = document.getElementById("signin");
  if (!form) {
    form = h("form", { class: "app-card app-signin", id: "signin", method: "post", action: "/_p99/app/signin", novalidate: true },
      h("h1", { class: "app-brand" }, h("b", { class: "app-logo", text: "P99" }), h("span", { text: "Sign in" })),
      h("p", { class: "app-note", text: "Use the e-mail your P99 link was sent to and the 6-digit code your authenticator app shows for P99." }),
      h("label", { class: "app-field" }, h("span", { text: "E-mail" }), h("input", { name: "email", type: "email", autocomplete: "username", inputmode: "email", required: true })),
      h("label", { class: "app-field" }, h("span", { text: "Code" }), h("input", { name: "totp", autocomplete: "one-time-code", inputmode: "numeric", maxlength: "7", pattern: "[0-9 ]*", required: true })),
      h("p", { class: "app-error", role: "alert", hidden: true }),
      h("button", { class: "app-primary", type: "submit", text: say("sign_in") }));
    form.classList.add("app-in");
    root.replaceChildren(form);
  }
  root.dataset.screen = "signin";
  const email = form.elements.email;
  const totp = form.elements.totp;
  const error = form.querySelector(".app-error");
  const send = form.querySelector("button[type=submit]");
  if (note) {
    error.textContent = note;
    error.hidden = false;
  }
  (email.value ? totp : email).focus({ preventScroll: true });
  form.onsubmit = (e) => {
    e.preventDefault();
    error.hidden = true;
    totp.removeAttribute("aria-invalid");
    send.disabled = true;
    send.textContent = say("signing");
    call("POST", "/_p99/app/signin", { email: email.value.trim(), totp: totp.value.replace(/\s/g, "") })
      .then(() => {
        forgetAll();
        route();
      })
      .catch((err) => {
        error.textContent = problem(err);
        error.hidden = false;
        send.disabled = false;
        send.textContent = say("sign_in");
        totp.setAttribute("aria-invalid", "true");
        totp.value = "";
        totp.focus();
      });
  };
}

function probes() {
  const seen = new Set();
  const out = [];
  for (const x of entries()) {
    if (seen.has(x.project)) continue;
    seen.add(x.project);
    out.push(x.host);
  }
  const first = hosts()[0];
  return (out.length ? out : first ? [first] : []).concat([null]);
}

function widest(rows) {
  let best = null;
  for (const r of rows) if (r.space && (!best || r.projects.length > best.projects.length)) best = r;
  return best;
}

function merged(rows) {
  const names = new Set();
  const projects = [];
  let space = null;
  for (const r of rows) {
    if (!r.space) continue;
    space = space || r.space.space || null;
    for (const p of r.projects) {
      if (!p || typeof p.name !== "string" || names.has(p.name)) continue;
      names.add(p.name);
      projects.push(p);
    }
  }
  return { space, projects };
}

function reachFrom() {
  const one = (host) => call("GET", at("/space", host)).then((space) => ({ host, space: space || {}, projects: Array.isArray(space && space.projects) ? space.projects : [] }), (e) => {
    if (e && e.status === 401) throw e;
    return { host, space: null, projects: [] };
  });
  return Promise.all(probes().map(one)).then((rows) => {
    S.reach = new Set(rows.filter((r) => r.space).map((r) => r.host));
    const best = widest(rows.filter((r) => r.host));
    S.via = best ? best.host : null;
    return merged(rows);
  });
}

function ready() {
  const spaces = S.spaces ? Promise.resolve(S.spaces) : call("GET", "/_p99/app/spaces").then((d) => (S.spaces = d || {}));
  return Promise.all([spaces, styled]).then(() => {
    if (!reachable()) return;
    const space = S.space ? Promise.resolve(S.space) : reachFrom().then((x) => (S.space = x));
    const early = hosts()[0] || null;
    const first = S.me ? Promise.resolve(S.me) : call("GET", at("/me", early)).then((m) => m || {});
    const me = Promise.all([first, space]).then(([m]) => {
      if (S.me) return S.me;
      if (firstHost() === early) return (S.me = m);
      return call("GET", at("/me", firstHost())).then((x) => (S.me = x || {}));
    });
    return Promise.all([me, space]);
  });
}

function boardModule() {
  if (!S.boardMod) S.boardMod = import("/_p99/board.js?v=" + V).catch((e) => { S.boardMod = null; throw e; });
  return S.boardMod;
}

function panelModule() {
  if (!S.panel) S.panel = import("/_p99/panel.js?v=" + V + (S.panelTries ? "&try=" + S.panelTries : "")).catch((e) => { S.panel = null; S.panelTries++; throw e; });
  return S.panel;
}

function sheets() {
  if (!S.css) {
    S.css = fetch("/_p99/p99.css?v=" + V).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  }
  return S.css.then((text) => {
    const base = new CSSStyleSheet();
    base.replaceSync(text);
    const own = new CSSStyleSheet();
    own.replaceSync(BOARD);
    return [base, own];
  });
}

function leaveBoard() {
  if (!S.board) return;
  S.board = null;
  boardModule().then((m) => m.close(), () => {});
}

function closeFull() {
  if (!S.full) return;
  S.full.remove();
  S.full = null;
}

function closeSheet() {
  if (!S.sheet || !S.sheet.open) return;
  S.sheet.open = false;
  panelModule().then((m) => { if (typeof m.shut === "function") m.shut(); }, () => {});
}

function leave() {
  leaveBoard();
  closeFull();
  closeSheet();
}

function picked() {
  if (S.pick === null) {
    let v = "";
    try { v = localStorage.getItem(PICK_KEY) || ""; } catch (x) {}
    S.pick = v;
  }
  if (S.pick && !projects().some((p) => p.name === S.pick)) S.pick = "";
  return S.pick;
}

function keepPick(name) {
  S.pick = name;
  try { localStorage.setItem(PICK_KEY, name); } catch (x) {}
}

function strip() {
  const now = picked();
  const chip = (name, label, sites, open) => h("button", { type: "button", class: "app-project", "data-name": name, "aria-pressed": String(now === name), onclick: () => narrow(name) },
    h("b", { class: "app-project-name", text: label }),
    open == null ? null : h("span", { class: "app-count", "data-open": String(open > 0), text: open === 1 ? say("open_one") : say("open_many", { n: open }) }),
    sites ? h("small", { class: "app-hosts", text: sites.length ? sites.join(" · ") : say("no_hosts") }) : null);
  return h("nav", { class: "app-projects", "aria-label": say("projects") },
    chip("", say("all_projects"), null, null),
    projects().map((p) => chip(p.name, p.name, Array.isArray(p.hosts) ? p.hosts.filter((x) => typeof x === "string") : [], typeof p.open === "number" ? p.open : null)));
}

function narrow(name) {
  if (picked() === name) return;
  keepPick(name);
  for (const b of root.querySelectorAll(".app-project")) b.setAttribute("aria-pressed", String(b.dataset.name === name));
  if (root.dataset.screen === "items" && S.full) {
    const next = listHost(name);
    if (next && next !== S.fullHost) {
      closeFull();
      root.dataset.screen = "";
      items(next);
    }
    return;
  }
  if (S.ctx) {
    S.ctx.via = hostFor(name) || firstHost();
    boardModule().then((m) => m.open(S.ctx), () => {});
  }
}

function query() {
  const p = picked();
  return p ? "project=" + encodeURIComponent(p) : "";
}

function board() {
  closeFull();
  const seq = ++S.seq;
  if (root.dataset.screen === "board" && S.board && S.board.isConnected) {
    closeSheet();
    return;
  }
  if (!S.me && !root.querySelector(".app-wait")) waiting("board");
  ready().then(() => {
    if (seq !== S.seq) return;
    if (S.legacy) {
      const host = S.legacy;
      S.legacy = null;
      const p = projects().find((x) => Array.isArray(x.hosts) && x.hosts.some((n) => String(n).toLowerCase() === host));
      if (p) keepPick(p.name);
    }
    const host = firstHost();
    if (!reachable() || (!host && !owner())) return mount("board", h("div", { class: "app-screen" }, h("p", { class: "app-empty", text: say("none") })));
    if (!owner()) return items(listHost(picked()) || host);
    drawBoard();
  }, (e) => { if (seq === S.seq) failed(e); });
}

function drawBoard() {
  const el = h("p99-root", { class: "app-board" });
  const shadow = el.attachShadow({ mode: "closed" });
  S.board = el;
  mount("board", h("div", { class: "app-screen app-wide" }, strip(), el));
  S.ctx = { root: shadow, call: boardCall, me: S.me, h, blob, host: null, via: hostFor(picked()) || firstHost(), stay: true, query, pickWord: "", item: (key, from) => openItem(key, from) };
  Promise.all([boardModule(), sheets()]).then(([m, list]) => {
    if (S.board !== el) return;
    shadow.adoptedStyleSheets = list;
    return m.open(S.ctx);
  }).catch((e) => {
    if (S.board !== el) return;
    S.board = null;
    failed(e);
  });
}

function openItem(key, from) {
  const host = (from && from.dataset && from.dataset.host) || (S.reach.has(null) ? "*" : hostFor((from && from.dataset && from.dataset.project) || picked()) || firstHost());
  if (!host) return;
  if (!S.sheet) {
    const el = h("p99-root", { class: "app-sheet" });
    const shadow = el.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SHEET);
    shadow.adoptedStyleSheets = [sheet];
    document.body.append(el);
    S.sheet = { el, shadow, open: false };
  }
  const s = S.sheet;
  s.open = true;
  panelModule().then((m) => m.open({
    root: s.shadow,
    space: host,
    title: spaceName(),
    code: null,
    view: "item",
    key,
    from,
    ring: [],
    forget: () => {},
    closed: () => { s.open = false; },
    gone: () => {
      s.open = false;
      forgetAll();
      signIn();
    },
  })).catch((e) => {
    s.open = false;
    failed(e);
  });
}

function items(host) {
  if (root.dataset.screen === "items" && S.full) return;
  const nav = projects().length > 1 ? strip() : null;
  if (nav) mount("items", h("div", { class: "app-screen app-under" }, nav));
  else waiting("items");
  const el = h("p99-root", { class: "app-full" });
  if (nav) el.style.setProperty("--app-top", Math.ceil(nav.getBoundingClientRect().bottom + 8) + "px");
  S.fullHost = host;
  const shadow = el.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(FULL);
  shadow.adoptedStyleSheets = [sheet];
  document.body.append(el);
  S.full = el;
  panelModule().then((m) =>
    m.open({
      root: shadow,
      space: host,
      title: spaceName(),
      code: null,
      view: "list",
      ring: [],
      forget: () => {},
      closed: () => {
        if (S.full !== el) return;
        closeFull();
        root.dataset.screen = "";
        items(host);
      },
      gone: () => {
        forgetAll();
        signIn();
      },
    }).then(() => { if (S.full === el && !nav) mount("items", h("div", { class: "app-screen app-under" })); }),
  ).catch((e) => {
    if (S.full !== el) return;
    closeFull();
    failed(e);
  });
}

function square(file) {
  if (typeof createImageBitmap !== "function") return Promise.reject(new Error("picture"));
  return createImageBitmap(file).then((bmp) => {
    const side = Math.min(bmp.width, bmp.height);
    if (!side) throw new Error("picture");
    const c = document.createElement("canvas");
    c.width = c.height = PICTURE;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PICTURE, PICTURE);
    if (bmp.close) bmp.close();
    const as = (type, q) => new Promise((r) => c.toBlob(r, type, q));
    return as("image/webp", 0.86).then((b) => (b && b.type === "image/webp" ? b : as("image/jpeg", 0.86))).then((b) => {
      c.width = c.height = 0;
      if (!b) throw new Error("picture");
      return b;
    });
  });
}

function profile() {
  leave();
  const seq = ++S.seq;
  if (!S.me && !root.querySelector(".app-wait")) waiting("profile");
  ready().then(() => {
    if (seq !== S.seq) return;
    const m = S.me;
    if (!m || !reachable()) {
      history.replaceState(null, "", "/");
      return board();
    }
    const input = h("input", { name: "username", value: m.username || "", autocomplete: "username", autocapitalize: "none", spellcheck: "false", minlength: "3", maxlength: "30", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{1,28}[A-Za-z0-9]", required: true, "aria-describedby": "app-username-help" });
    const face = h("div", { class: "app-face" }, disc(m, 96));
    const line = h("p", { class: "app-status", role: "status", "aria-live": "polite" });
    const save = h("button", { class: "app-primary", type: "submit", text: say("save") });
    const tell = (text, bad) => {
      line.textContent = text;
      line.dataset.tone = bad ? "error" : "";
      if (bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };
    input.addEventListener("input", () => {
      const typed = input.value.trim().toLowerCase();
      face.replaceChildren(disc(typed === (S.me.username || "") ? S.me : { username: typed, name: S.me.name, avatar: null }, 96));
    });
    const form = h("form", { class: "app-card app-profile", novalidate: true },
      h("a", { class: "app-back", href: "#", text: say("back") }),
      h("h1", { tabindex: "-1", text: say("profile") }),
      face,
      h("p", { class: "app-who" }, h("b", { text: m.name || "" }), h("span", { text: m.email || "" })),
      pictureBox(face),
      h("label", { class: "app-field" }, h("span", { text: say("username") }), h("span", { class: "app-at" }, h("i", { "aria-hidden": "true", text: "@" }), input)),
      h("p", { id: "app-username-help", class: "app-note", text: say("username_help") }),
      line,
      h("div", { class: "app-actions" }, h("button", { type: "button", class: "app-quiet", text: say("sign_out"), onclick: signOut }), save));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(name)) {
        tell(say("bad_name"), true);
        return;
      }
      save.disabled = true;
      save.textContent = say("saving");
      tell("", false);
      api("PATCH", "/me", { username: name }).then((r) => {
        S.me = Object.assign({}, S.me, r && typeof r === "object" ? r : {}, { username: (r && r.username) || name });
        input.value = S.me.username;
        tell(say("saved"), false);
        repaintHead();
      }, (err) => {
        if (signedOut(err)) return;
        tell(err.status === 409 ? say("taken") : err.status === 400 ? say("bad_name") : problem(err), true);
      }).then(() => {
        save.disabled = false;
        save.textContent = say("save");
      });
    });
    const view = h("div", { class: "app-screen app-narrow" }, form, owner() ? licenceBox() : null);
    mount("profile", view, form.querySelector("h1"));
  }, (e) => { if (seq === S.seq) failed(e); });
}

function pictureBox(face) {
  const file = h("input", { type: "file", name: "picture", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const note = h("p", { class: "app-status", role: "status", "aria-live": "polite" });
  const pick = h("button", { type: "button", class: "app-pick", text: say("pick_picture"), onclick: () => file.click() });
  const drop = h("button", { type: "button", class: "app-quiet app-unpick", text: say("remove_picture"), hidden: !(S.me && S.me.avatar) });
  const tell = (text, bad) => {
    note.textContent = text;
    note.dataset.tone = bad ? "error" : "";
  };
  const busy = (on) => { pick.disabled = drop.disabled = on; };
  const fresh = (avatar) => {
    const old = S.me;
    S.me = Object.assign({}, S.me, { avatar });
    return avatarModule().then((m) => {
      if (m && typeof m.forget === "function") { m.forget(old); m.forget(S.me); }
      face.replaceChildren(disc(S.me, 96));
      const me = S.head && S.head.querySelector(".app-me");
      if (me) me.replaceChildren(disc(S.me, 36));
      drop.hidden = !avatar;
    });
  };
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (!f) return;
    busy(true);
    tell(say("saving"), false);
    square(f).then((b) => {
      if (b.size > PICTURE_BYTES) {
        const e = new Error(say("picture_big"));
        e.big = true;
        throw e;
      }
      return api("PUT", "/me/avatar", b, b.type).catch((e) => {
        if (signedOut(e)) throw Object.assign(new Error(""), { quiet: true });
        throw e;
      });
    }).then((r) => {
      const url = r && typeof r.avatar === "string" ? r.avatar : r && typeof r.url === "string" ? r.url : undefined;
      return fresh(url === undefined ? "/avatars/" + encodeURIComponent(S.me.username || "") + "?t=" + Date.now() : url);
    }).then(() => tell(say("picture_saved"), false), (e) => {
      if (e && e.quiet) return;
      tell(e && e.big ? e.message : e && e.status ? problem(e) : say("picture_bad"), true);
    }).then(() => busy(false));
  });
  drop.addEventListener("click", () => {
    busy(true);
    api("DELETE", "/me/avatar").then(() => fresh(null)).then(() => tell(say("picture_removed"), false), (e) => {
      if (!signedOut(e)) tell(problem(e), true);
    }).then(() => busy(false));
  });
  return h("div", { class: "app-picture" },
    h("span", { class: "app-label", text: say("picture") }),
    h("div", { class: "app-picture-row" }, pick, drop, file),
    h("p", { class: "app-note", text: say("picture_help") }),
    note);
}

function licenceBox() {
  const key = h("textarea", { name: "licence", rows: "3", spellcheck: "false", autocomplete: "off", autocapitalize: "none", "aria-describedby": "app-licence-help" });
  const note = h("p", { class: "app-status", role: "status", "aria-live": "polite" });
  const save = h("button", { class: "app-primary", type: "submit", text: say("licence_save") });
  const keeps = () => {
    const l = S.me && S.me.licence;
    if (l && typeof l.stored === "boolean") return l.stored;
    return licence() !== "free";
  };
  const drop = h("button", { type: "button", class: "app-quiet", text: say("licence_remove"), hidden: !keeps() });
  const tell = (text, bad) => {
    note.textContent = text;
    note.dataset.tone = bad ? "error" : "";
    if (bad) key.setAttribute("aria-invalid", "true");
    else key.removeAttribute("aria-invalid");
  };
  const take = (r, fallback, stored) => {
    const l = r && typeof r === "object" ? (r.licence && typeof r.licence === "object" ? r.licence : typeof r.state === "string" ? { state: r.state, link: r.link } : null) : null;
    S.me = Object.assign({}, S.me, { licence: Object.assign({}, l || { state: fallback }, { stored }) });
    S.badged = false;
    repaintHead();
    drop.hidden = !keeps();
  };
  const busy = (on) => { save.disabled = drop.disabled = on; };
  const form = h("form", { class: "app-card app-licence", novalidate: true },
    h("label", { class: "app-field" }, h("span", { text: say("licence") }), key),
    h("p", { id: "app-licence-help", class: "app-note", text: say("licence_help") }),
    note,
    h("div", { class: "app-actions" }, drop, save));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = key.value.trim();
    if (!text) return tell(say("licence_empty"), true);
    busy(true);
    tell(say("saving"), false);
    api("PUT", "/licence", { key: text }).then((r) => {
      take(r, licence(), true);
      key.value = "";
      tell(say("licence_saved"), false);
    }, (err) => {
      if (signedOut(err)) return;
      tell(err.status === 400 || err.status === 422 ? err.message : problem(err), true);
    }).then(() => busy(false));
  });
  drop.addEventListener("click", () => {
    busy(true);
    api("DELETE", "/licence").then((r) => {
      take(r, "free", false);
      const plan = BADGES[licence()];
      const gone = r && r.removed === false ? "licence_none" : licence() === "free" ? "licence_removed" : "licence_removed_binding";
      tell(say(gone, { plan }), false);
    }, (err) => {
      if (!signedOut(err)) tell(problem(err), true);
    }).then(() => busy(false));
  });
  return form;
}

function signOut() {
  call("POST", "/_p99/app/signout").catch(() => null).then(() => {
    forgetAll();
    history.replaceState(null, "", "/");
    signIn();
  });
}

function route() {
  const hash = location.hash;
  const old = /^#space=(.+)$/.exec(hash);
  if (old) {
    S.legacy = decodeURIComponent(old[1]).toLowerCase();
    history.replaceState(null, "", "/");
    leaveBoard();
    return board();
  }
  if (hash === "#profile") return profile();
  return board();
}

addEventListener("hashchange", () => { if (root.dataset.screen !== "signin") route(); });
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || root.dataset.screen !== "profile") return;
  e.preventDefault();
  location.hash = "";
});
if (root.dataset.screen === "signin") signIn();
else route();

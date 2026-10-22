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
  spaces: "Your spaces",
  spaces_help: "Each space is a site you can see P99 on. Open one to read its items and threads.",
  none: "No spaces yet. Ask the person who invited you for a P99 link.",
  open_one: "1 open",
  open_many: "{n} open",
  manager: "Owner",
  profile: "Profile",
  back: "Spaces",
  username: "Username",
  username_help: "3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit. People see it as @username.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  taken: "That username is taken; try another.",
  bad_name: "Use 3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit.",
  sign_out: "Sign out",
};
const BADGES = { free: "Free", studio: "Studio", agency: "Agency", owner: "Owner", ff: "F&F" };
const FULL = `:host{--p99-accent:#3b7dd8;color-scheme:light dark}
:host(.app-full) .p99-panel{top:0;left:0;right:0;bottom:0;width:auto;max-height:none;border-radius:0;box-shadow:none;--p99-slide:0px;transform:translateY(12px)}
:host(.app-full) .p99-panel.is-open{transform:none}
:host(.app-full) .p99-panel::after{box-shadow:inset 0 4px 0 var(--p99-edge),inset 0 5px 0 rgba(255,255,255,.18)}
:host(.app-full) .p99-scrim,:host(.app-full) .p99-grip{display:none}
:host(.app-full) .p99-head{cursor:auto;touch-action:auto;padding:var(--p99-space-md) max(var(--p99-space-sm),calc((100% - 880px)/2)) 0 max(var(--p99-space-lg),calc((100% - 880px)/2 + var(--p99-space-lg)))}
:host(.app-full) .p99-scroll{padding-left:max(var(--p99-space-lg),calc((100% - 832px)/2));padding-right:max(var(--p99-space-lg),calc((100% - 832px)/2))}
:host(.app-full) .p99-foot{padding-left:max(var(--p99-space-lg),calc((100% - 832px)/2))}
@media (prefers-reduced-motion:reduce){:host(.app-full) .p99-panel{transform:none}}`;

const root = document.getElementById("app");
const S = { spaces: null, me: null, space: null, panel: null, avatar: null, seq: 0, badged: false };
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
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

function call(method, path, body) {
  const headers = { "X-P99-App": "1", Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" }).then((r) =>
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

function problem(e) {
  if (!navigator.onLine) return say("offline");
  if (e && e.status === 401) return say("denied");
  if (e && e.status === 429) return say("limited");
  if (e && e.status === 400) return say("needs");
  return say("failed");
}

function mount(screen, view, focus) {
  if (root.dataset.screen !== screen || root.querySelector(".app-wait")) view.classList.add("app-in");
  root.dataset.screen = screen;
  root.replaceChildren(view);
  if (focus) focus.focus({ preventScroll: true });
}

function waiting(title) {
  mount("wait", h("div", { class: "app-screen" }, bar(title), h("div", { class: "app-wait", role: "status", "aria-busy": "true", "aria-label": say("loading") })));
}

function failed(e) {
  if (signedOut(e)) return;
  const seq = S.seq;
  styled.then(() => {
    if (seq !== S.seq) return;
    const again = h("button", { type: "button", text: say("retry"), onclick: route });
    mount("problem", h("div", { class: "app-screen" }, bar(""), h("section", { class: "app-card app-problem" },
      h("p", { class: "app-error", role: "alert", text: problem(e) }),
      h("div", { class: "app-actions" }, again))), again);
  });
}

function avatarModule() {
  if (!S.avatar) S.avatar = import("/_p99/avatar.js?v=" + V).catch(() => null);
  return S.avatar;
}

function disc(username, size) {
  const img = h("img", { class: "app-disc", alt: "", width: size, height: size });
  const letter = username || (S.spaces && S.spaces.name) || "?";
  const fallback = h("span", { class: "app-disc app-disc-letter", "aria-hidden": "true", text: letter.slice(0, 1).toUpperCase() });
  avatarModule().then((m) => {
    if (!m || typeof m.avatarSrc !== "function" || !username) return;
    img.src = m.avatarSrc(username, size);
    fallback.replaceWith(img);
  });
  return fallback;
}

function signIn(note) {
  closeSpace();
  let form = document.getElementById("signin");
  if (!form) {
    form = h("form", { class: "app-card app-signin", id: "signin", method: "post", action: "/_p99/app/signin", novalidate: true },
      h("h1", { class: "app-brand" }, h("b", { class: "app-logo", text: "P99" }), h("span", { text: "Sign in" })),
      h("p", { class: "app-note", text: "Use the e-mail your P99 link was sent to and the 6-digit code your authenticator app shows for P99." }),
      h("label", { class: "app-field" }, h("span", { text: "E-mail" }), h("input", { name: "email", type: "email", autocomplete: "username", inputmode: "email", required: true })),
      h("label", { class: "app-field" }, h("span", { text: "Code" }), h("input", { name: "totp", autocomplete: "one-time-code", inputmode: "numeric", maxlength: "7", pattern: "[0-9 ]*", required: true })),
      h("p", { class: "app-error", role: "alert", hidden: true }),
      h("button", { class: "app-primary", type: "submit", text: say("sign_in") }));
    mount("signin", form);
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
        S.spaces = null;
        if (location.hash) route();
        else spaces();
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

function loadSpaces() {
  return Promise.all([call("GET", "/_p99/app/spaces"), styled]).then(([d]) => (S.spaces = d));
}

function signedOut(e) {
  if (e && e.status === 401) {
    S.spaces = null;
    signIn();
    return true;
  }
  return false;
}

function badge() {
  if (!S.spaces) return null;
  const state = Object.hasOwn(BADGES, S.spaces.license) ? S.spaces.license : "free";
  const pill = h("img", { class: S.badged ? "app-badge" : "app-badge app-badge-in", src: "/_p99/badges/" + state + ".svg?v=" + V, alt: BADGES[state] + " licence", height: 47 });
  S.badged = true;
  return pill;
}

function bar(title) {
  const who = S.spaces ? S.spaces.name : "";
  return h("header", { class: "app-bar" },
    h("a", { class: "app-brand", href: "#" }, h("b", { class: "app-logo", text: "P99" }), badge(), h("span", { text: title })),
    h("a", { class: "app-me", href: "#profile", title: say("profile"), "aria-label": say("profile") }, S.me ? disc(S.me.username, 36) : h("span", { class: "app-disc app-disc-letter", "aria-hidden": "true", text: who.slice(0, 1).toUpperCase() })));
}

function spaces() {
  closeSpace();
  const seq = ++S.seq;
  const draw = (d) => {
    const list = h("ul", { class: "app-spaces" }, d.spaces.map((s) =>
      h("li", null, h("a", { class: "app-space", href: "#space=" + encodeURIComponent(s.host) },
        h("b", { class: "app-host", text: s.host }),
        s.manager ? h("small", { class: "app-role", text: say("manager") }) : null,
        h("span", { class: "app-count", "data-open": s.open > 0, text: s.open === 1 ? say("open_one") : say("open_many", { n: s.open }) })))));
    const title = h("h1", { tabindex: "-1", text: say("spaces") });
    const view = h("div", { class: "app-screen" }, bar(""),
      h("section", { class: "app-card app-list" }, h("div", { class: "app-head" }, title, h("p", { class: "app-note", text: say("spaces_help") })),
        d.spaces.length ? list : h("p", { class: "app-empty", text: say("none") })));
    mount("spaces", view, root.dataset.screen === "spaces" ? null : title);
  };
  if (S.spaces) draw(S.spaces);
  else if (!root.querySelector(".app-wait")) waiting("");
  loadSpaces().then((d) => {
    if (seq !== S.seq) return;
    draw(d);
    whoAmI();
  }, (e) => { if (seq === S.seq) failed(e); });
}

function whoAmI(strict) {
  const first = S.spaces && S.spaces.spaces[0];
  if (!first || S.me) return Promise.resolve(S.me);
  return call("GET", "/_p99/api/me?host=" + encodeURIComponent(first.host)).then((m) => {
    S.me = m;
    const me = root.querySelector(".app-me");
    if (me) me.replaceChildren(disc(m.username, 36));
    return m;
  }, (e) => {
    if (strict) throw e;
    return null;
  });
}

function profile() {
  closeSpace();
  const seq = ++S.seq;
  if ((!S.spaces || !S.me) && !root.querySelector(".app-wait")) waiting(say("profile"));
  const ready = S.spaces ? Promise.resolve(S.spaces) : loadSpaces();
  ready.then(() => whoAmI(true)).then((m) => {
    if (seq !== S.seq) return;
    if (!m) {
      history.replaceState(null, "", "/");
      return spaces();
    }
    const first = S.spaces.spaces[0];
    const input = h("input", { name: "username", value: m.username || "", autocomplete: "username", autocapitalize: "none", spellcheck: "false", minlength: "3", maxlength: "30", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{1,28}[A-Za-z0-9]", required: true, "aria-describedby": "app-username-help" });
    const face = h("div", { class: "app-face" }, disc(m.username, 96));
    const line = h("p", { class: "app-status", role: "status", "aria-live": "polite" });
    const save = h("button", { class: "app-primary", type: "submit", text: say("save") });
    const tell = (text, bad) => {
      line.textContent = text;
      line.dataset.tone = bad ? "error" : "";
      if (bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };
    input.addEventListener("input", () => face.replaceChildren(disc(input.value.trim().toLowerCase(), 96)));
    const form = h("form", { class: "app-card app-profile", novalidate: true },
      h("h1", { tabindex: "-1", text: say("profile") }),
      face,
      h("p", { class: "app-who" }, h("b", { text: m.name || "" }), h("span", { text: m.email || "" })),
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
      call("PATCH", "/_p99/api/me?host=" + encodeURIComponent(first.host), { username: name }).then((r) => {
        S.me = Object.assign({}, S.me, r && typeof r === "object" ? r : {}, { username: (r && r.username) || name });
        input.value = S.me.username;
        tell(say("saved"), false);
      }, (err) => {
        if (signedOut(err)) return;
        tell(err.status === 409 ? say("taken") : err.status === 400 ? say("bad_name") : problem(err), true);
      }).then(() => {
        save.disabled = false;
        save.textContent = say("save");
      });
    });
    mount("profile", h("div", { class: "app-screen" }, bar(say("profile")), form), form.querySelector("h1"));
  }, (e) => { if (seq === S.seq) failed(e); });
}

function signOut() {
  call("POST", "/_p99/app/signout").catch(() => null).then(() => {
    S.spaces = null;
    S.me = null;
    history.replaceState(null, "", "/");
    signIn();
  });
}

function panelModule() {
  if (!S.panel) S.panel = import("/_p99/panel.js?v=" + V).catch((e) => { S.panel = null; throw e; });
  return S.panel;
}

function closeSpace() {
  if (!S.space) return;
  S.space.remove();
  S.space = null;
}

function space(host) {
  closeSpace();
  ++S.seq;
  root.dataset.screen = "space";
  root.replaceChildren(h("div", { class: "app-wait", role: "status", "aria-busy": "true", "aria-label": say("loading") }));
  const el = h("p99-root", { class: "app-full" });
  const shadow = el.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(FULL);
  shadow.adoptedStyleSheets = [sheet];
  document.body.append(el);
  S.space = el;
  panelModule().then((m) =>
    m.open({
      root: shadow,
      space: host,
      code: null,
      view: "list",
      ring: [],
      forget: () => {},
      closed: () => {
        if (shadow.querySelector(".p99-board.is-open")) return;
        if (S.space === el) location.hash = "";
      },
      gone: () => {
        S.spaces = null;
        signIn();
      },
    }).then(() => { if (S.space === el) root.replaceChildren(); }),
  ).catch((e) => {
    if (S.space !== el) return;
    closeSpace();
    failed(e);
  });
}

function route() {
  const hash = location.hash;
  const at = /^#space=(.+)$/.exec(hash);
  if (at) return space(decodeURIComponent(at[1]).toLowerCase());
  if (hash === "#profile") return profile();
  return spaces();
}

addEventListener("hashchange", () => { if (root.dataset.screen !== "signin") route(); });
if (root.dataset.screen === "signin") signIn();
else route();

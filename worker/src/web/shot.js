const V = "__P99_VERSION__";
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const CAPTURE_DEADLINE = 10000;
const MEDIA_TIMEOUT = 8000;
const VIDEO_STYLE = ["position", "top", "right", "bottom", "left", "z-index", "float", "margin", "transform", "transform-origin", "border", "border-radius", "opacity", "filter", "clip-path", "vertical-align", "object-fit", "object-position", "grid-area", "flex", "align-self", "justify-self", "order"];
const CONTROL = /[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;
const WAY = "p99:shot";
const PACKED_STYLE = ["background-image", "border-image-source", "-webkit-border-image", "-webkit-mask-image", "mask-image", "list-style-image"];

let env = null, fonts = null, shots = 0, framed = null, blocked = false;

export function capture(e, full, since) {
  env = e;
  if (!masks().whole) return Promise.reject(Object.assign(new Error("a mask selector can't be read here"), { why: "capture_mask" }));
  return shoot(full, CAPTURE_DEADLINE - (Date.now() - (since || Date.now())));
}
export function readable(e) {
  env = e;
  return masks().whole;
}
export function elementsAt(e, r) {
  env = e;
  return elementsUnder(r);
}
export function context(e, at) {
  env = e;
  return contextNow(at);
}
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
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
      errors: (env.ring || []).map((m) => m.replace(/[?#]\S*/g, "").slice(0, 300))
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
  if (fonts) return fonts;
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
  fonts = Promise.all(rules.map((r) => {
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
  return fonts;
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
  env.root.append(box);
  return {
    contentWindow: {
      document: { body, createElement: (t) => document.createElement(t), createElementNS: (n, t) => document.createElementNS(n, t) },
      getComputedStyle: (e, p) => getComputedStyle(e, p)
    },
    remove: () => box.remove()
  };
}
let masked = null;
function masks() {
  const list = Array.isArray(env && env.mask) ? env.mask : [];
  if (masked && masked.list === list) return masked;
  const ok = list.filter((m) => {
    if (typeof m !== "string" || !m.trim()) return false;
    try { document.querySelector(m); return true; } catch (x) { return false; }
  });
  masked = { list, ok, whole: ok.length === list.length };
  return masked;
}
function secret() {
  return ["[data-p99-redact]"].concat(masks().ok).join(", ");
}
function everywhere(scope, selector, out) {
  scope.querySelectorAll(selector).forEach((n) => out.push(n));
  scope.querySelectorAll("*").forEach((n) => {
    if (n.shadowRoot && n !== env.host) everywhere(n.shadowRoot, selector, out);
  });
  return out;
}
function fillOf() {
  const c = env && typeof env.fill === "string" && env.fill.trim() ? env.fill.trim() : "#3b7dd8";
  return CSS.supports("color", c) ? c : "#3b7dd8";
}
function cover(canvas, boxes, full, sx, sy) {
  if (!boxes.length) return;
  const g = canvas.getContext("2d");
  const k = canvas.width / (document.documentElement.clientWidth || innerWidth);
  g.save();
  g.fillStyle = fillOf();
  boxes.forEach((b) => {
    const x = (b.x + (full ? sx : 0)) * k, y = (b.y + (full ? sy : 0)) * k;
    g.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, Math.ceil(b.w * k) + 2, Math.ceil(b.h * k) + 2);
  });
  g.restore();
}
function ignored(n) {
  return n.nodeType === 1 && (n === env.host || n.hasAttribute("data-p99-ignore") || n.nodeName === "NOSCRIPT");
}
function shoot(full, deadline) {
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
  const boxes = [];
  const fill = fillOf();
  everywhere(document, hush(), []).forEach((n) => {
    if (n.closest("[data-p99-ignore]") || n === env.host) return;
    const b = n.getBoundingClientRect();
    mark(n, "data-p99-hide", String(hidden.length));
    hidden.push({ w: Math.round(b.width), h: Math.round(b.height) });
    if (b.width > 0 && b.height > 0) boxes.push({ x: b.left, y: b.top, w: b.width, h: b.height });
  });
  const blanks = [];
  const shown = [];
  document.querySelectorAll("img").forEach((n) => {
    if (n.closest("[data-p99-ignore]")) return;
    if (n.complete && n.naturalWidth) {
      if (n.currentSrc) {
        mark(n, "data-p99-src", String(shown.length));
        shown.push(n.currentSrc);
      }
      return;
    }
    mark(n, "data-p99-blank", String(blanks.length));
    blanks.push({ w: n.offsetWidth, h: n.offsetHeight });
  });
  const skip = new Set();
  const slots = [];
  document.querySelectorAll("video, canvas").forEach((v) => {
    if (v.closest("[data-p99-ignore]") || !v.parentElement) return;
    skip.add(v);
    const cs = getComputedStyle(v);
    const style = {};
    VIDEO_STYLE.forEach((k) => { style[k] = cs.getPropertyValue(k); });
    style.display = cs.display === "inline" ? "inline-block" : cs.display;
    const poster = v.nodeName === "CANVAS" ? drawing(v) : v.poster && sameOrigin(v.poster) ? v.poster : null;
    slots.push({ v, parent: v.parentElement, w: v.offsetWidth, h: v.offsetHeight, style, poster, fill: v.poster ? "#111" : "transparent" });
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
  let sandbox = null, ctx = null, timer = 0;
  const done = () => {
    clearTimeout(timer);
    cleanup();
    if (ctx) try { ms.destroyContext(ctx); } catch (x) {}
    if (sandbox) sandbox.remove();
    ctx = sandbox = null;
  };
  const late = new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error("capture took too long"), { slow: true })), Math.max(0, deadline)); });
  const inert = document.implementation.createHTMLDocument("");
  if (way() === "frame") frameDoc().catch(() => {});
  const work = fontCss()
    .then((css) => {
      sandbox = probe();
      return ms.createContext(document.documentElement, {
        width: W,
        height: H,
        scale,
        timeout: 1,
        font: css ? { cssText: css } : false,
        drawImageInterval: 20,
        sandbox,
        workerUrl: null,
        fetch: { placeholderImage: BLANK, bypassingCache: false },
        fetchFn: (url) => (fragment(url) ? BLANK : sameOrigin(url) ? false : BLANK),
        features: { restoreScrollPosition: true, fixSvgXmlDecode: safari },
        filter: (node) => !ignored(node) && !skip.has(node),
        onCloneNode: (clone) => dress(inert.adoptNode(clone), { full, sx, sy, hidden, fixes, groupList, blanks, shown, fill })
      });
    })
    .then((c) => {
      ctx = c;
      ctx.timeout = MEDIA_TIMEOUT;
      return ms.domToForeignObjectSvg(ctx);
    })
    .then((svg) => paint(svg, Math.floor(W * scale), Math.floor(H * scale), safari ? ctx.drawImageCount : 0));
  return Promise.race([work, late]).then((canvas) => {
    done();
    cover(canvas, boxes, full, sx, sy);
    shots++;
    return { id: shots, canvas, sx, sy, vw, vh, scale: canvas.width / W };
  }, (e) => {
    done();
    throw e;
  });
}
function drawing(c) {
  try {
    const u = c.toDataURL();
    return u.length > 6 ? u : null;
  } catch (x) {
    return null;
  }
}
function way() {
  try {
    const w = localStorage.getItem(WAY);
    if (w === "page" || w === "frame") return w;
  } catch (x) {}
  return framesBarred() ? "page" : "frame";
}
function framesBarred() {
  return Array.from(document.querySelectorAll("meta[http-equiv]")).some((m) => {
    if (m.httpEquiv.toLowerCase() !== "content-security-policy") return false;
    const rules = {};
    m.content.split(";").forEach((r) => {
      const [name, ...list] = r.trim().toLowerCase().split(/\s+/);
      if (name && !(name in rules)) rules[name] = list;
    });
    const list = rules["frame-src"] || rules["child-src"] || rules["default-src"];
    return !!list && !list.includes("'self'") && !list.includes("*");
  });
}
function frameDoc() {
  const f = framed && framed.el;
  if (f && f.isConnected && framed.doc && f.contentDocument === framed.doc) return Promise.resolve(framed.doc);
  if (f && f.isConnected && !framed.doc) return framed.ready;
  if (f) f.remove();
  const el = document.createElement("iframe");
  el.hidden = true;
  el.tabIndex = -1;
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("sandbox", "allow-same-origin");
  const at = "/_p99/frame.html?v=" + V;
  const ready = new Promise((ok, no) => {
    el.addEventListener("load", () => {
      let doc = null;
      try { doc = el.contentDocument; } catch (x) {}
      if (doc && doc.location && doc.location.pathname === "/_p99/frame.html") {
        if (framed && framed.el === el) framed.doc = doc;
        ok(doc);
      } else no(new Error("the capture frame didn't load"));
    }, { once: true });
  });
  framed = { el, ready, doc: null };
  ready.catch(() => { if (framed && framed.el === el) { el.remove(); framed = null; } });
  el.src = at;
  env.root.append(el);
  return ready;
}
function load(doc, url) {
  const img = doc.createElement("img");
  img.decoding = "sync";
  img.src = url;
  return img.decode().then(() => img);
}
function via(w, url) {
  return w === "frame" ? frameDoc().then((doc) => load(doc, url)) : load(document, url);
}
function keep(w) {
  try { localStorage.setItem(WAY, w); } catch (x) {}
}
function decode(url) {
  const first = way(), other = first === "frame" ? "page" : "frame";
  blocked = false;
  const heard = (e) => { if (/^data|\/_p99\/frame\.html/.test(e.blockedURI || "")) blocked = true; };
  document.addEventListener("securitypolicyviolation", heard);
  const done = () => document.removeEventListener("securitypolicyviolation", heard);
  return via(first, url)
    .catch(() => via(other, url).then((img) => { keep(other); return img; }))
    .then((img) => { done(); return img; }, () => new Promise((r) => setTimeout(r, 0)).then(() => {
      done();
      throw Object.assign(new Error("the screenshot couldn't be drawn"), { why: blocked ? "capture_blocked" : "capture_failed" });
    }));
}
function paint(svg, w, h, redraws) {
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg).replace(CONTROL, ""));
  return decode(url).then((img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    const draw = () => { g.clearRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); };
    draw();
    const again = (i) => (i >= redraws ? c : new Promise((r) => setTimeout(r, i + 20)).then(() => { draw(); return again(i + 1); }));
    return again(0);
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
  clone.querySelectorAll("[data-p99-src]").forEach((n) => {
    const src = c.shown[Number(n.getAttribute("data-p99-src"))];
    n.removeAttribute("data-p99-src");
    if (!src) return;
    n.removeAttribute("srcset");
    n.removeAttribute("sizes");
    n.removeAttribute("loading");
    n.src = src;
    if (n.parentNode && n.parentNode.nodeName === "PICTURE") n.parentNode.querySelectorAll("source").forEach((x) => x.remove());
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
  clone.querySelectorAll("input[type=password], [data-p99-hide] input, [data-p99-hide] textarea, [data-p99-redact] input, [data-p99-redact] textarea").forEach((n) => {
    n.removeAttribute("value");
    n.value = "";
    n.textContent = "";
  });
  clone.querySelectorAll("[data-p99-hide], [data-p99-redact]").forEach((n) => {
    const i = n.getAttribute("data-p99-hide");
    const box = i === null ? null : c.hidden[Number(i)];
    n.removeAttribute("data-p99-hide");
    while (n.firstChild) n.removeChild(n.firstChild);
    ["value", "src", "srcset", "href", "xlink:href", "placeholder", "poster"].forEach((a) => n.removeAttribute(a));
    if (box) {
      n.style.width = box.w + "px";
      n.style.height = box.h + "px";
    }
    n.style.background = c.fill;
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
      const ph = clone.ownerDocument.createElement(s.poster ? "img" : "div");
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
function hush() {
  return secret() + ", input[type=password]";
}
function labelOf(n) {
  if (n.closest(hush())) return "";
  let v = n.getAttribute("aria-label") || n.getAttribute("title") || "";
  if (!v && n.matches("input, textarea, select")) v = n.getAttribute("placeholder") || n.getAttribute("name") || "";
  if (!v && n.labels && n.labels[0] && !n.labels[0].closest(hush())) v = n.labels[0].textContent;
  return v.replace(/\s+/g, " ").trim().slice(0, 300);
}
function textOf(n) {
  const quiet = SECRET + ", " + secret();
  if (n.matches(quiet) || n.closest(hush())) return "";
  const parts = [];
  const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const up = t.parentElement && t.parentElement.closest(quiet);
    if (up && n.contains(up)) continue;
    parts.push(t.nodeValue);
  }
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
        if (n === document.documentElement || n === document.body || n === env.host || seen.includes(n)) continue;
        if (n.closest("[data-p99-ignore], " + hush())) continue;
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

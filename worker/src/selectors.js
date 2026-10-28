export const MAX_MASKS = 50;
export const MAX_MASK_CHARS = 200;

const LISTS = new Set(["not", "is", "where", "matches", "any", "-webkit-any", "-moz-any"]);
const NTH = new Set(["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type", "nth-col", "nth-last-col"]);
const NAME_START = /[A-Za-z_\u0080-￿]/;
const NAME = /[A-Za-z0-9_\u0080-￿-]/;
const NTH_FORM = /^(?:odd|even|[+-]?\d+|[+-]?\d*n(?:\s*[+-]\s*\d+)?)$/i;

function parser(text) {
  let at = 0;
  const peek = (n = 0) => text[at + n];
  const done = () => at >= text.length;
  const space = () => {
    const from = at;
    while (!done() && /\s/.test(peek())) at += 1;
    return at > from;
  };
  const escape = () => {
    if (peek() !== "\\" || at + 1 >= text.length || peek(1) === "\n") return false;
    at += 1;
    if (/[0-9a-f]/i.test(peek())) {
      let n = 0;
      while (n < 6 && /[0-9a-f]/i.test(peek() ?? "")) {
        at += 1;
        n += 1;
      }
      if (/\s/.test(peek() ?? "")) at += 1;
    } else at += 1;
    return true;
  };
  const nameChar = () => {
    if (!done() && NAME.test(peek())) {
      at += 1;
      return true;
    }
    return escape();
  };
  const ident = () => {
    const from = at;
    if (peek() === "-") {
      at += 1;
      if (peek() === "-") at += 1;
      else if (!(NAME_START.test(peek() ?? "") ? (at += 1) : escape())) {
        at = from;
        return null;
      }
    } else if (NAME_START.test(peek() ?? "")) at += 1;
    else if (!escape()) return null;
    while (nameChar());
    return text.slice(from, at);
  };
  const name = () => {
    const from = at;
    while (nameChar());
    return at > from;
  };
  const string = () => {
    const quote = peek();
    if (quote !== '"' && quote !== "'") return false;
    at += 1;
    while (!done() && peek() !== quote) {
      if (peek() === "\n") return false;
      if (peek() === "\\") at += 2;
      else at += 1;
    }
    if (done()) return false;
    at += 1;
    return true;
  };
  const attribute = () => {
    at += 1;
    space();
    if (peek() === "*" && peek(1) === "|") at += 2;
    if (!ident()) return false;
    if (peek() === "|" && peek(1) !== "=") {
      at += 1;
      if (!ident()) return false;
    }
    space();
    if (peek() === "]") {
      at += 1;
      return true;
    }
    if (peek() === "=") at += 1;
    else if ("~|^$*".includes(peek() ?? "x") && peek(1) === "=") at += 2;
    else return false;
    space();
    if (!string() && !ident()) return false;
    space();
    if (/[iIsS]/.test(peek() ?? "") && !NAME.test(peek(1) ?? "")) {
      at += 1;
      space();
    }
    if (peek() !== "]") return false;
    at += 1;
    return true;
  };
  const balanced = () => {
    let depth = 0;
    while (!done()) {
      const ch = peek();
      if ("{};".includes(ch)) return false;
      if (ch === '"' || ch === "'") {
        if (!string()) return false;
        continue;
      }
      if (ch === "\\") {
        if (!escape()) return false;
        continue;
      }
      if (ch === "(") depth += 1;
      if (ch === ")") {
        if (depth === 0) return true;
        depth -= 1;
      }
      at += 1;
    }
    return false;
  };
  const nth = () => {
    const from = at;
    while (!done() && peek() !== ")" && !/\s(?=of\s)/i.test(text.slice(at, at + 4))) at += 1;
    if (!NTH_FORM.test(text.slice(from, at).trim())) return false;
    space();
    if (/^of\s/i.test(text.slice(at, at + 3))) {
      at += 2;
      space();
      return list(false);
    }
    return true;
  };
  const pseudo = () => {
    at += 1;
    const element = peek() === ":";
    if (element) at += 1;
    const word = ident();
    if (!word) return false;
    if (peek() !== "(") return true;
    at += 1;
    space();
    const lower = word.toLowerCase();
    const ok = element && lower !== "slotted" ? balanced() : LISTS.has(lower) || lower === "slotted" ? list(false) : lower === "has" ? list(true) : NTH.has(lower) ? nth() : balanced();
    if (!ok) return false;
    space();
    if (peek() !== ")") return false;
    at += 1;
    return true;
  };
  const compound = () => {
    let parts = 0;
    if (peek() === "*") {
      at += 1;
      parts += 1;
    } else if (ident()) parts += 1;
    if (peek() === "|" && peek(1) !== "=") {
      at += 1;
      if (peek() === "*") at += 1;
      else if (!ident()) return false;
    }
    for (;;) {
      const ch = peek();
      if (ch === "#") {
        at += 1;
        if (!name()) return false;
      } else if (ch === ".") {
        at += 1;
        if (!ident()) return false;
      } else if (ch === "[") {
        if (!attribute()) return false;
      } else if (ch === ":") {
        if (!pseudo()) return false;
      } else break;
      parts += 1;
    }
    return parts > 0;
  };
  const complex = (relative) => {
    space();
    if (relative && ">+~".includes(peek() ?? "x")) {
      at += 1;
      space();
    }
    if (!compound()) return false;
    for (;;) {
      const spaced = space();
      const ch = peek();
      if (done() || ch === "," || ch === ")") return true;
      if (">+~".includes(ch)) {
        at += 1;
        space();
      } else if (!spaced) return false;
      if (!compound()) return false;
    }
  };
  const list = (relative) => {
    if (!complex(relative)) return false;
    space();
    while (peek() === ",") {
      at += 1;
      if (!complex(relative)) return false;
      space();
    }
    return true;
  };
  return {
    whole() {
      return list(false) && done();
    },
  };
}

export function isSelectorList(text) {
  if (typeof text !== "string" || text.trim().length === 0 || /[{};<]/.test(text)) return false;
  try {
    return parser(text.trim()).whole();
  } catch {
    return false;
  }
}

export function maskRefusal(value) {
  if (!Array.isArray(value)) return "mask must be a list of CSS selectors";
  if (value.length > MAX_MASKS) return `mask holds at most ${MAX_MASKS} selectors`;
  for (const selector of value) {
    if (typeof selector !== "string" || selector.trim().length === 0) return "a mask selector is a CSS selector";
    if ([...selector].length > MAX_MASK_CHARS) return `a mask selector has at most ${MAX_MASK_CHARS} characters`;
    if (!isSelectorList(selector)) return `${selector.slice(0, 60)} is not a CSS selector`;
  }
  return null;
}

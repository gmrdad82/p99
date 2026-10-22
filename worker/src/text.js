export function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function chars(text) {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

export function isChars(value, min, max) {
  if (typeof value !== "string" || value.length > max * 2) return false;
  const n = chars(value);
  return n >= min && n <= max;
}

export function sameFolded(a, b) {
  return typeof a === "string" && typeof b === "string" && fold(a) === fold(b);
}

export function sameCase(a, b) {
  return typeof a === "string" && typeof b === "string" && asciiLower(a) === asciiLower(b);
}

export function namedBy(list, asked, nameOf) {
  const exact = list.filter((x) => sameCase(nameOf(x), asked));
  return exact.length > 0 ? exact : list.filter((x) => sameFolded(nameOf(x), asked));
}

function asciiLower(text) {
  return text.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

export function searchMatch(column, text, bind) {
  return `instr(${column}, ${bind(fold(text))}) > 0`;
}

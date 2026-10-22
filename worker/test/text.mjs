import assert from "node:assert/strict";
import { chars, fold, isChars, sameFolded, searchMatch } from "../src/text.js";

export async function textChecks({ check }) {
  await check("text: fold drops accents and case, Turkish dotted capitals and diaeresis included", async () => {
    assert.equal(fold("Crème Brûlée"), "creme brulee");
    assert.equal(fold("DOİNG"), "doing");
    assert.equal(fold("revïew"), "review");
    assert.equal(fold("ÉVALUÉ"), fold("évalué"));
    assert.equal(fold("שָׁלוֹם"), "שלום");
    assert.equal(fold(null), "");
    assert.equal(fold(undefined), "");
    assert.equal(fold("🚀"), "🚀");
  });

  await check("text: chars counts code points, so an emoji or an astral letter is one", async () => {
    assert.equal(chars(""), 0);
    assert.equal(chars("abc"), 3);
    assert.equal(chars("🚀"), 1);
    assert.equal(chars("🚀".repeat(200)), 200);
    assert.equal(chars("𝒜é"), 2);
    assert.equal(chars("\uD800x"), 2);
  });

  await check("text: isChars holds the exact edges in characters, not UTF-16 units", async () => {
    assert.equal(isChars("🚀".repeat(200), 1, 200), true);
    assert.equal(isChars("🚀".repeat(201), 1, 200), false);
    assert.equal(isChars("a".repeat(200), 1, 200), true);
    assert.equal(isChars("a".repeat(201), 1, 200), false);
    assert.equal(isChars(`${"🚀".repeat(199)}a`, 1, 200), true);
    assert.equal(isChars(`${"🚀".repeat(200)}a`, 1, 200), false);
    assert.equal(isChars("", 1, 200), false);
    assert.equal(isChars("", 0, 200), true);
    assert.equal(isChars("ab", 3, 10), false);
    assert.equal(isChars("x".repeat(100000), 0, 20000), false);
    assert.equal(isChars(200, 0, 200), false);
    assert.equal(isChars(null, 0, 200), false);
    assert.equal(isChars(["a"], 0, 200), false);
  });

  await check("text: sameFolded matches names whatever their case and accents, and only strings", async () => {
    assert.equal(sameFolded("Doing", "DOİNG"), true);
    assert.equal(sameFolded("Review", "revïew"), true);
    assert.equal(sameFolded("Évalué", "evalue"), true);
    assert.equal(sameFolded("Évalué", "évaluée"), false);
    assert.equal(sameFolded("Doing", null), false);
    assert.equal(sameFolded(undefined, undefined), false);
  });

  await check("text: searchMatch binds the folded query whole, so any length and % _ \\ stay literal", async () => {
    const bound = [];
    const bind = (v) => {
      bound.push(v);
      return `?${bound.length + 1}`;
    };
    const long = "Crème 100% snake_case back\\slash ".repeat(6).trim();
    assert.equal(searchMatch("i.search_text", long, bind), "instr(i.search_text, ?2) > 0");
    assert.deepEqual(bound, [fold(long)]);
    assert.ok(!bound[0].includes("crème"));
    assert.ok(bound[0].includes("100% snake_case back\\slash"));
    assert.ok(!/LIKE|ESCAPE/.test(searchMatch("c", "x", bind)));
  });
}

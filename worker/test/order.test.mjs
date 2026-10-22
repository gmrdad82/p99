import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyBetween, generateNKeysBetween } from "../src/order.js";

const between = [
  [null, null, "a0"],
  [null, "a0", "Zz"],
  [null, "Zz", "Zy"],
  ["a0", null, "a1"],
  ["a1", null, "a2"],
  ["a0", "a1", "a0V"],
  ["a1", "a2", "a1V"],
  ["a0V", "a1", "a0l"],
  ["Zz", "a0", "ZzV"],
  ["Zz", "a1", "a0"],
  [null, "Y00", "Xzzz"],
  ["bzz", null, "c000"],
  ["a0", "a0V", "a0G"],
  ["a0", "a0G", "a08"],
  ["b125", "b129", "b127"],
  ["a0", "a1V", "a1"],
  ["Zz", "a01", "a0"],
  [null, "a0V", "a0"],
  [null, "b999", "b99"],
  [null, "A000000000000000000000000001", "A000000000000000000000000000V"],
  ["zzzzzzzzzzzzzzzzzzzzzzzzzzy", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzz"],
  ["zzzzzzzzzzzzzzzzzzzzzzzzzzz", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"],
];

const refused = [
  [null, "A00000000000000000000000000", /invalid order key: A00000000000000000000000000/],
  ["a00", null, /invalid order key: a00/],
  ["a00", "a1", /invalid order key: a00/],
  ["0", "1", /invalid order key head: 0/],
  ["a1", "a0", /a1 >= a0/],
  ["a1", "a1", /a1 >= a1/],
  ["b1", null, /invalid order key: b1/],
];

test("a key between two others matches the upstream fractional-indexing vectors, and sorts strictly between them", () => {
  for (const [a, b, want] of between) {
    const key = generateKeyBetween(a, b);
    assert.equal(key, want, `${a} .. ${b}`);
    if (a !== null) assert.ok(a < key, `${a} < ${key}`);
    if (b !== null) assert.ok(key < b, `${key} < ${b}`);
  }
});

test("a malformed, trailing-zero, out-of-order or equal pair is refused rather than given a key", () => {
  for (const [a, b, message] of refused) assert.throws(() => generateKeyBetween(a, b), message, `${a} .. ${b}`);
});

test("n keys spread evenly before, after and between, each strictly between its neighbours", () => {
  assert.deepEqual(generateNKeysBetween(null, null, 5), ["a0", "a1", "a2", "a3", "a4"]);
  assert.deepEqual(generateNKeysBetween("a4", null, 10), ["a5", "a6", "a7", "a8", "a9", "aA", "aB", "aC", "aD", "aE"]);
  assert.deepEqual(generateNKeysBetween(null, "a0", 5), ["Zv", "Zw", "Zx", "Zy", "Zz"]);
  assert.deepEqual(
    generateNKeysBetween("a0", "a2", 20),
    ["a04", "a08", "a0G", "a0K", "a0O", "a0V", "a0Z", "a0d", "a0l", "a0t", "a1", "a14", "a18", "a1G", "a1O", "a1V", "a1Z", "a1d", "a1l", "a1t"],
  );
  assert.deepEqual(generateNKeysBetween("a0", "a1", 0), []);
  assert.deepEqual(generateNKeysBetween("a0", "a1", 1), ["a0V"]);
  for (const [a, b, n] of [[null, null, 40], ["a0", "a1", 33], [null, "Zz", 7], ["Zz", null, 70]]) {
    const keys = generateNKeysBetween(a, b, n);
    assert.equal(keys.length, n);
    const all = [a, ...keys, b].filter((k) => k !== null);
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1] < all[i], `${all[i - 1]} < ${all[i]}`);
  }
});

test("a card dropped again and again into the same gap always gets a key that sorts between, longer each time", () => {
  let low = "a0";
  const high = "a1";
  let last = 0;
  for (let i = 0; i < 50; i++) {
    const key = generateKeyBetween(low, high);
    assert.ok(low < key && key < high, `${low} < ${key} < ${high}`);
    assert.ok(key.length >= last);
    last = key.length;
    low = key;
  }
  assert.ok(last > 2);
});

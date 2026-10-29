import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { crc32 as zlibCrc, inflateSync } from "node:zlib";
import { crc32, qrEncode, qrPng } from "../src/qr.js";

const P99_ROWS = [
  "111111100001101111111",
  "100000100110101000001",
  "101110101001101011101",
  "101110101101001011101",
  "101110101000101011101",
  "100000101011001000001",
  "111111101010101111111",
  "000000001110000000000",
  "101111100011001111100",
  "000101000101111000011",
  "011010101000101101100",
  "110100001111111000100",
  "100111110000100101000",
  "000000001110100100010",
  "111111100011010011110",
  "100000101000000110111",
  "101110101001010010100",
  "101110101111111001000",
  "101110101100101100000",
  "100000100111111001000",
  "111111101000100100110"
];

const NAYUKI = [
  ["P99", 1, 2, "f67c6d8e7a8bc68de7f7683696809198b5c50670ed765fbff59efb054eef882f"],
  ["Hello, world!", 1, 2, "9ec093e9c8e6ca1bb4c4a28edde04d1b1c96221e49a45ee3e26f278397d05d72"],
  ["otpauth://totp/P99:grace@example.com?secret=JBSWY3DPEHPK3PXP&issuer=P99&algorithm=SHA1&digits=6&period=30", 6, 4, "8dc0e875a6dd9fc8b4de2166eef5923aab2aee5d4e9d609dfc9aa27d3bebcdec"],
  ["otpauth://totp/P99:grace.hopper@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=P99&algorithm=SHA1&digits=6&period=30", 8, 2, "aecc6e04a4597e820be780c7bf75a98ac0005e645ebbbcc5d9e4e8c051601a96"],
  ["Ada Lovelace ".repeat(30), 15, 2, "a4789169d8b3c9689166fa4a0910706f12d310664c381eebc86ca079b32263d0"],
];

const bytes = (text) => new TextEncoder().encode(text);

test("the encoder draws P99 module for module as Nayuki's library does", () => {
  const code = qrEncode(bytes("P99"));
  assert.equal(code.size, 21);
  const rows = [];
  for (let y = 0; y < 21; y++) rows.push([...code.dark.subarray(y * 21, y * 21 + 21)].join(""));
  assert.deepEqual(rows, P99_ROWS);
});

test("each version, mask and module matches Nayuki's own output at level M, from one block to many and from 8-bit to 16-bit lengths", () => {
  for (const [text, version, mask, sha] of NAYUKI) {
    const code = qrEncode(bytes(text));
    assert.equal(code.version, version, text);
    assert.equal(code.mask, mask, text);
    assert.equal(code.size, version * 4 + 17);
    assert.equal(createHash("sha256").update([...code.dark].join("")).digest("hex"), sha, text);
  }
});

test("a text too long for version 40 is refused", () => {
  assert.throws(() => qrEncode(new Uint8Array(2332)), /too long/);
  assert.equal(qrEncode(new Uint8Array(2331)).version, 40);
});

test("the CRC is the PNG one", () => {
  for (const text of ["", "IEND", "123456789", "Ada Lovelace ".repeat(40)]) assert.equal(crc32(bytes(text)), zlibCrc(bytes(text)));
  assert.equal(crc32(bytes("123456789")), 0xcbf43926);
});

function chunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    out.push({ type, body, crc: view.getUint32(at + 8 + length), check: zlibCrc(png.subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  return out;
}

test("the PNG is a valid 1-bit greyscale image whose pixels are the modules, scaled, with a quiet zone", async () => {
  const text = NAYUKI[2][0];
  const { png, side, modules } = await qrPng(text, 8, 4);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = chunks(png);
  assert.deepEqual(parts.map((p) => p.type), ["IHDR", "IDAT", "IEND"]);
  for (const p of parts) assert.equal(p.crc, p.check, `${p.type} CRC`);
  const head = new DataView(parts[0].body.buffer, parts[0].body.byteOffset, 13);
  assert.equal(modules, 41);
  assert.equal(side, (41 + 8) * 8);
  assert.deepEqual([head.getUint32(0), head.getUint32(4), ...parts[0].body.subarray(8)], [side, side, 1, 0, 0, 0, 0]);
  const raw = inflateSync(parts[1].body);
  const stride = Math.ceil(side / 8) + 1;
  assert.equal(raw.length, stride * side);
  const code = qrEncode(bytes(text));
  for (let y = 0; y < side; y++) {
    assert.equal(raw[y * stride], 0, "no filter");
    for (let x = 0; x < side; x++) {
      const dark = ((raw[y * stride + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
      const mx = Math.floor(x / 8) - 4;
      const my = Math.floor(y / 8) - 4;
      const want = mx >= 0 && my >= 0 && mx < 41 && my < 41 && code.dark[my * 41 + mx] === 1;
      if (dark !== want) assert.fail(`pixel ${x},${y}`);
    }
  }
  assert.ok(png.length < 2048, `${png.length} bytes`);
});

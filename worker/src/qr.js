const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_M = 0;

function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver) {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

function remainder(data, div) {
  const out = new Array(div.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < div.length; i++) out[i] ^= gfMul(div[i], factor);
  }
  return out;
}

function codewords(bytes, ver) {
  const capacity = dataCodewords(ver) * 8;
  const bits = [];
  const put = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = new Array(capacity / 8).fill(0);
  bits.forEach((b, i) => (data[i >>> 3] |= b << (7 - (i & 7))));
  const blocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = divisor(eccLen);
  const all = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += dat.length;
    const ecc = remainder(dat, div);
    if (i < short) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= short) out.push(block[i]);
    });
  }
  return out;
}

function alignments(ver, size) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fixed = new Uint8Array(this.size * this.size);
  }

  get(x, y) {
    return this.dark[y * this.size + x];
  }

  set(x, y, on) {
    this.dark[y * this.size + x] = on ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }

  patterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const at = alignments(this.ver, s);
    const n = at.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.set(at[i] + dx, at[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    this.format(0);
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const on = ((bits >>> i) & 1) === 1;
        const a = s - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, on);
        this.set(b, a, on);
      }
    }
  }

  format(mask) {
    const data = (FORMAT_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }

  place(data) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? s - 1 - vert : vert;
          if (!this.fixed[y * s + x] && i < data.length * 8) {
            this.dark[y * s + x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  mask(m) {
    const hit = MASKS[m];
    const s = this.size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!this.fixed[y * s + x] && hit(x, y)) this.dark[y * s + x] ^= 1;
      }
    }
  }

  penalty() {
    const s = this.size;
    let score = 0;
    const line = (at) => {
      let colour = 0;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const push = (length) => {
        if (history[0] === 0) length += s;
        history.pop();
        history.unshift(length);
      };
      const finders = () => {
        const n = history[1];
        const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
        return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
      };
      for (let i = 0; i < s; i++) {
        if (at(i) === colour) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          push(run);
          if (!colour) score += finders() * 40;
          colour = at(i);
          run = 1;
        }
      }
      if (colour) {
        push(run);
        run = 0;
      }
      push(run + s);
      score += finders() * 40;
    };
    for (let y = 0; y < s; y++) line((x) => this.get(x, y));
    for (let x = 0; x < s; x++) line((y) => this.get(x, y));
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const c = this.get(x, y);
        if (c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) score += 3;
      }
    }
    let dark = 0;
    for (const d of this.dark) dark += d;
    const total = s * s;
    return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }
}

export function qrEncode(bytes) {
  let ver = 1;
  while (ver <= 40 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > 40) throw new RangeError("too long for a QR code");
  const grid = new Grid(ver);
  grid.patterns();
  grid.place(codewords(bytes, ver));
  let best = 0;
  let least = Infinity;
  for (let m = 0; m < 8; m++) {
    grid.mask(m);
    grid.format(m);
    const score = grid.penalty();
    if (score < least) {
      best = m;
      least = score;
    }
    grid.mask(m);
  }
  grid.mask(best);
  grid.format(best);
  return { version: ver, mask: best, size: grid.size, dark: grid.dark };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function qrPng(text, scale = 8, border = 4) {
  const code = qrEncode(new TextEncoder().encode(text));
  const side = (code.size + border * 2) * scale;
  const stride = Math.ceil(side / 8) + 1;
  const raw = new Uint8Array(stride * side).fill(0xff);
  for (let y = 0; y < side; y++) {
    raw[y * stride] = 0;
    const my = Math.floor(y / scale) - border;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - border;
      if (mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.dark[my * code.size + mx]) {
        raw[y * stride + 1 + (x >>> 3)] &= ~(0x80 >>> (x & 7));
      }
    }
  }
  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  head.set([1, 0, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return { png, side, modules: code.size };
}

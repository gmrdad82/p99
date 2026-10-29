const Real = globalThis.Date;
let shift = 0;

class Shifted extends Real {
  constructor(...args) {
    if (args.length === 0) super(Real.now() + shift);
    else super(...args);
  }

  static now() {
    return Real.now() + shift;
  }
}

export function realNow() {
  return Real.now();
}

export function shiftClock(ms) {
  shift = ms;
  globalThis.Date = ms === 0 ? Real : Shifted;
}

export async function askedShift(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  if (body.real === true) return 0;
  if (typeof body.at === "string") {
    const at = Real.parse(body.at);
    return Number.isFinite(at) ? at - Real.now() : null;
  }
  if (Number.isSafeInteger(body.advance) && body.advance >= 0) return shift + body.advance;
  return null;
}

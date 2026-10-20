const SIZE = 80;
const COLORS = ["#3b7dd8", "#1f5aa8", "#8db8f0", "#e8a33d", "#d9603b"];
const BACK = "M32.414 59.35L50.376 70.5H72.5v-71H33.728L26.5 13.381l19.057 27.08L32.414 59.35z";
const FRONT = "M22.216 24L0 46.75l14.108 38.129L78 86l-3.081-59.276-22.378 4.005 12.972 20.186-23.35 27.395L22.215 24z";

function hashOf(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function digit(n, place) {
  return Math.floor((n / Math.pow(10, place)) % 10);
}

function unit(n, range, place) {
  const value = n % range;
  return place && digit(n, place) % 2 === 0 ? -value : value;
}

function shapes(name) {
  const n = hashOf(name);
  return [0, 1, 2].map((t) => ({
    color: COLORS[(n + t) % COLORS.length],
    x: unit(n * (t + 1), SIZE / 10, 1),
    y: unit(n * (t + 1), SIZE / 10, 2),
    scale: 1.2 + unit(n * (t + 1), SIZE / 20) / 10,
    rotate: unit(n * (t + 1), 360, 1),
  }));
}

export function avatar(username, size = 24) {
  const name = String(username || "");
  const s = shapes(name);
  const id = "p99a" + hashOf(name).toString(36);
  const place = (p) => `translate(${p.x} ${p.y}) rotate(${p.rotate} ${SIZE / 2} ${SIZE / 2}) scale(${s[2].scale})`;
  return (
    `<svg viewBox="0 0 ${SIZE} ${SIZE}" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 2}" fill="#FFFFFF"/></mask>` +
    `<g mask="url(#${id})"><rect width="${SIZE}" height="${SIZE}" fill="${s[0].color}"/>` +
    `<path filter="url(#${id}f)" d="${BACK}" fill="${s[1].color}" transform="${place(s[1])}"/>` +
    `<path filter="url(#${id}f)" style="mix-blend-mode:overlay" d="${FRONT}" fill="${s[2].color}" transform="${place(s[2])}"/></g>` +
    `<defs><filter id="${id}f" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/>` +
    `<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="7" result="effect1_foregroundBlur"/></filter></defs></svg>`
  );
}

export function avatarSrc(username, size = 24) {
  return "data:image/svg+xml," + encodeURIComponent(avatar(username, size));
}

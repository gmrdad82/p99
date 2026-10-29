import { createHmac } from "node:crypto";
import { request } from "node:http";

export function base32Bytes(key) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of key.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpAtSeconds(key, seconds, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const mac = createHmac("sha1", base32Bytes(key)).update(counter).digest();
  const number = mac.readUInt32BE(mac[19] & 15) & 0x7fffffff;
  return String(number % 10 ** digits).padStart(digits, "0");
}

export function buttonsOf(html) {
  return [...html.matchAll(/<a href="([^"]+)"[^>]*>Open P99 on ([^<]+)<\/a>/g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);
}

export function secretOf(link) {
  return /#p99=([0-9a-z]{12})/i.exec(link)?.[1].toLowerCase() ?? null;
}

export function send(port, host, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const sent = { host: `${host}:${port}`, ...headers };
    if (bytes) sent["content-length"] = bytes.length;
    const req = request({ host: "127.0.0.1", port, path, method, headers: sent }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        if ((res.headers["content-type"] || "").startsWith("application/json")) {
          try {
            json = JSON.parse(text);
          } catch {}
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}

export function pageSender(port, appHost) {
  const origin = `http://${appHost}:${port}`;
  const app = (method, path, { body, token } = {}) => {
    const headers = { "x-p99-app": "1", origin };
    if (token) headers.cookie = `__Host-p99=${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return send(port, appHost, method, path, { headers, body });
  };
  const tokenOf = (answer) => /__Host-p99=([A-Za-z0-9_-]{43});/.exec((answer.headers["set-cookie"] || [])[0] || "")?.[1];
  const signIn = (email, totp) => app("POST", "/_p99/app/signin", { body: { email, totp } });
  return { app, tokenOf, signIn };
}

export function socketOf(url, heard) {
  const socket = new WebSocket(url);
  const state = {
    socket,
    closeCode: null,
    get closed() {
      return socket.readyState >= WebSocket.CLOSING;
    },
  };
  socket.addEventListener("message", (message) => heard.push(JSON.parse(message.data)));
  socket.addEventListener("close", (event) => {
    state.closeCode = event.code;
  });
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(state));
    socket.addEventListener("error", () => resolve(null));
  });
}

export function aWrongCode(kit, key) {
  const valid = new Set([-1, 0, 1].map((o) => kit.totp(key, kit.clock.now() + o * 30000)));
  let wrong = 0;
  while (valid.has(String(wrong).padStart(6, "0"))) wrong += 1;
  return String(wrong).padStart(6, "0");
}

export const stepCode = (kit, key, offset = 0) => kit.totp(key, kit.clock.now() + offset * 30000);

export function projectNamed(kit, name) {
  return kit.space.projects.find((p) => p.name === name);
}

export const PLUS = "p99-root >> .w .f";
export const GONE = "p99-root >> .p99-gone";
export const VERIFY = "p99-root >> .p99-panel.is-open .p99-verify input[name=totp]";
export const FORM = "p99-root >> .p99-panel.is-open .p99-new input[name=title]";

export async function inviteJson(kit, name, email, args = []) {
  const run = await kit.p99(["invite", "--name", name, "--email", email, "--no-mail", "--json", ...args]);
  if (run.code !== 0) throw new Error(`p99 invite exited ${run.code}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

export async function visit(kit, host, secret) {
  const page = await kit.page();
  await page.goto(`${kit.siteUrl(host, "/")}#p99=${secret}`);
  return page;
}

export const shows = (page, selector, ms = 20000) =>
  page.locator(selector).waitFor({ timeout: ms }).then(
    () => true,
    () => false,
  );

export async function invitesJson(kit) {
  const run = await kit.p99(["invites", "--json"]);
  if (run.code !== 0) throw new Error(`p99 invites exited ${run.code}: ${run.stderr}`);
  return { text: run.stdout, codes: JSON.parse(run.stdout).codes };
}

export function compact(secret) {
  return String(secret).replace(/-/g, "");
}

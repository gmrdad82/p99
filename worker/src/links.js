import { escapeHtml, palette } from "./mail.js";
import { mailer, mailSettings } from "./mailer.js";
import { grantOf, hostsOf } from "./grants.js";
import { qrPng } from "./qr.js";

let K = null;

export function useKit(kit) {
  K = kit;
}

export function accessLink(host, secret) {
  return `https://${host}/#p99=${secret}`;
}

function listed(hosts) {
  if (hosts.length <= 1) return hosts.join("");
  return `${hosts.slice(0, -1).join(", ")} and ${hosts[hosts.length - 1]}`;
}

const FONT = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5";
const P = "margin:0 0 16px";
export const QR_ID = "p99-authenticator";

function frame(c, parts) {
  return [
    `<div style="${FONT};color:${c.ink};background:#ffffff;max-width:560px;padding:16px">`,
    ...parts,
    `<p style="margin:0;padding-top:12px;border-top:1px solid ${c.rule};font-size:13px;color:${c.muted}">— P99</p>`,
    "</div>",
  ].join("");
}

function step(n, inner) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-collapse:collapse"><tr><td style="vertical-align:top;width:28px;font-weight:600">${n}.</td><td style="vertical-align:top">${inner}</td></tr></table>`;
}

function numbered(steps) {
  return {
    text: steps.map((s, i) => `${i + 1}. ${s.text}`),
    html: steps.map((s, i) => step(i + 1, s.html ?? `<p style="margin:0">${escapeHtml(s.text)}</p>`)),
  };
}

export function composeLinkMail({ name, hosts, secret, totp, totpMail, renewed, theme, owner, space, app, email }) {
  const c = palette(theme);
  const first = name.split(/\s+/)[0] || name;
  const role = owner ? "an Owner" : "a User";
  const of = space ? ` of ${space}` : "";
  const subject = renewed ? `Your new P99 link for ${space || listed(hosts)}` : `Your P99 access for ${space || listed(hosts)}`;
  const reach = `you can now file bugs and ideas on ${listed(hosts)} with P99, as ${role}${of}.`;
  const lead = renewed ? `${first}, here is your new P99 link: the old one no longer works. ${reach[0].toUpperCase()}${reach.slice(1)}` : `${first}, ${reach}`;
  const steps = [];
  if (totpMail) steps.push({ text: "First, set up your authenticator: a second mail from P99, sent separately, has the code to scan." });
  const open = "Open your link once in each browser you use:";
  const button = (host) =>
    `<p style="margin:12px 0 0"><a href="${escapeHtml(accessLink(host, secret))}" style="display:inline-block;padding:14px 20px;min-width:200px;border-radius:8px;background:${c.accent};color:${c["on-accent"]};font-size:16px;font-weight:600;line-height:20px;text-align:center;text-decoration:none">Open P99 on ${escapeHtml(host)}</a></p>`;
  steps.push({
    text: [open, ...hosts.map((host) => `Open P99 on ${host}: ${accessLink(host, secret)}`)].join("\n"),
    html: `<p style="margin:0">${escapeHtml(open)}</p>${hosts.map(button).join("")}`,
  });
  if (totp) steps.push({ text: "The first time, P99 asks for the 6-digit code your authenticator shows. After that the browser is remembered." });
  const plus =
    "On the site, the + in the corner opens P99: describe the bug or idea; a screenshot of the page goes with it, with the site's private areas hidden unless you choose to show them. The ⋯ next to it lists your cards and their replies.";
  const board = owner ? ` As an Owner you also get the board, where every card${of} moves through its lanes.` : "";
  steps.push({ text: plus + board });
  if (owner && app && totp) {
    const page = `https://${app}/`;
    const words = `You can also open the board from anywhere at ${page}: sign in with ${email} and the 6-digit code your authenticator shows.`;
    steps.push({
      text: words,
      html: `<p style="margin:0">You can also open the board from anywhere at <a href="${escapeHtml(page)}" style="color:${c.accent}">${escapeHtml(page)}</a>: sign in with ${escapeHtml(email)} and the 6-digit code your authenticator shows.</p>`,
    });
  }
  const guard = "The link is personal: don't forward it.";
  const list = numbered(steps);
  const text = [lead, ...list.text, guard, "— P99"];
  const html = frame(c, [`<p style="${P}">${escapeHtml(lead)}</p>`, ...list.html, `<p style="${P}">${escapeHtml(guard)}</p>`]);
  return { subject, text: text.join("\n\n") + "\n", html };
}

export function otpauthLink(email, key) {
  const label = [...new TextEncoder().encode(email)]
    .map((b) => (/[A-Za-z0-9._~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`))
    .join("")
    .replace(/%40/g, "@");
  return `otpauth://totp/P99:${label}?secret=${key}&issuer=P99&algorithm=SHA1&digits=6&period=30`;
}

export function grouped(key) {
  return key.replace(/(.{4})(?=.)/g, "$1 ");
}

export function composeTotpMail({ name, email, key, kind, theme, qrSide }) {
  const c = palette(theme);
  const first = name.split(/\s+/)[0] || name;
  const link = otpauthLink(email, key);
  const subject = "Set up your authenticator for P99";
  const lead =
    kind === "added"
      ? `${first}, your P99 link now asks for a 6-digit code from an authenticator app, the first time each browser opens it. Set it up once:`
      : `${first}, this is the second mail from P99, sent apart from your ${kind === "relink" ? "new " : ""}link. It sets up the 6-digit code P99 asks for the first time each browser opens your link.`;
  const replace = kind === "invite" ? null : "If your authenticator already has P99 for this e-mail, replace it with this one: the old one no longer works.";
  const apps = "If you have no authenticator app yet, install one: Google Authenticator, Microsoft Authenticator, your password manager or your phone's built-in passwords app all work.";
  const add = "In the app, add an account: scan the QR code below, or type the key.";
  const shows = `The account appears as "P99: ${email}". It shows a 6-digit code that changes every 30 seconds.`;
  const enter = "When P99 asks, enter the code it shows at that moment.";
  const mono = "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;letter-spacing:1px";
  const half = Math.round(qrSide / 2);
  const steps = numbered([
    { text: apps },
    {
      text: `In the app, add an account and type this key: ${grouped(key)}\nOn your phone, this link adds it in one tap: ${link}`,
      html: [
        `<p style="margin:0">${escapeHtml(add)}</p>`,
        `<p style="margin:12px 0 0"><img src="cid:${QR_ID}" width="${half}" height="${half}" alt="QR code for your authenticator app" style="display:block;width:${half}px;height:${half}px;border:0"></p>`,
        `<p style="margin:12px 0 0">Key: <span style="${mono}">${escapeHtml(grouped(key))}</span></p>`,
        `<p style="margin:8px 0 0">Reading this on your phone? <a href="${escapeHtml(link)}" style="color:${c.accent};font-weight:600">Add P99 to your authenticator</a></p>`,
      ].join(""),
    },
    { text: shows },
    { text: enter },
  ]);
  const done = "Nothing else to do: no P99 account, no password.";
  const text = [lead, ...(replace ? [replace] : []), ...steps.text, done, "— P99"];
  const html = frame(c, [
    `<p style="${P}">${escapeHtml(lead)}</p>`,
    ...(replace ? [`<p style="${P}">${escapeHtml(replace)}</p>`] : []),
    ...steps.html,
    `<p style="${P}">${escapeHtml(done)}</p>`,
  ]);
  return { subject, text: text.join("\n\n") + "\n", html };
}

export function spaceName(env) {
  return typeof env.SPACE_NAME === "string" && env.SPACE_NAME.trim().length > 0 ? env.SPACE_NAME.trim() : null;
}

function appOf(env) {
  const host = typeof env.APP_HOST === "string" ? env.APP_HOST.trim().toLowerCase() : "";
  return host || null;
}

export async function busiest(c, hosts) {
  if (hosts.length < 2) return hosts;
  const since = new Date(Date.parse(c.now) - 30 * 86400000).toISOString();
  const { results } = await c.env.DB.prepare(
    `SELECT host, count(*) AS n FROM items
     WHERE host IN (SELECT value FROM json_each(?1)) AND (created_at >= ?2 OR updated_at >= ?2 OR activity_at >= ?2)
     GROUP BY host`,
  )
    .bind(JSON.stringify(hosts), since)
    .all();
  const n = new Map(results.map((r) => [r.host, r.n]));
  return [...hosts].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0));
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function postman(c, row) {
  const settings = mailSettings(c.env, c.dir.mail);
  const provider = mailer(c.env, settings);
  if (!provider) return { skip: "off" };
  const to = String(row.email).toLowerCase();
  if (to.endsWith(".invalid")) return { skip: "skipped" };
  const replyTo = c.actor && K.isEmail(c.actor.email) && !c.actor.email.endsWith(".invalid") ? c.actor.email : null;
  return { provider, to, extra: replyTo ? { replyTo } : {} };
}

async function deliver(provider, message, idempotency, what, id) {
  try {
    const outcome = await provider.send([message], idempotency);
    if (outcome.ok) return "sent";
    console.error(`the ${what} mail for code ${id} failed with ${outcome.status}`);
  } catch (error) {
    console.error(`the ${what} mail for code ${id} failed: ${error.message}`);
  }
  return "failed";
}

export async function mailTotp(c, row, key, kind) {
  const post = postman(c, row);
  if (post.skip) return post.skip;
  const hosts = hostsOf(grantOf(row, c.dir), c.dir);
  const theme = hosts.length > 0 ? c.dir.hosts.get(hosts[0])?.config.theme : null;
  const { png, side } = await qrPng(otpauthLink(row.email, key));
  const message = {
    to: post.to,
    ...composeTotpMail({ name: row.name, email: row.email, key, kind, theme, qrSide: side }),
    attachments: [{ filename: `${QR_ID}.png`, content: base64(png), content_type: "image/png", content_id: QR_ID }],
    ...post.extra,
  };
  const nonce = String(row.totp_secret || "").slice(0, 24);
  return deliver(post.provider, message, `p99-totp-${row.id}-${nonce}`, "authenticator", row.id);
}

export async function mailLink(c, row, secret, { renewed = false, totpKey = null } = {}) {
  const post = postman(c, row);
  if (post.skip) return { mail: post.skip };
  const hosts = await busiest(c, hostsOf(grantOf(row, c.dir), c.dir));
  if (hosts.length === 0) return { mail: "skipped" };
  const theme = c.dir.hosts.get(hosts[0])?.config.theme;
  const message = {
    to: post.to,
    ...composeLinkMail({
      name: row.name,
      email: post.to,
      hosts,
      secret,
      totp: Boolean(row.totp_secret),
      totpMail: Boolean(totpKey),
      renewed,
      theme,
      owner: Boolean(row.manager),
      space: spaceName(c.env),
      app: appOf(c.env),
    }),
    ...post.extra,
  };
  const mail = await deliver(post.provider, message, `p99-link-${row.id}`, "link", row.id);
  if (!totpKey || mail !== "sent") return { mail };
  return { mail, totp_mail: await mailTotp(c, row, totpKey, renewed ? "relink" : "invite") };
}

export async function relinkCode(c, rawId) {
  const body = await K.readJson(c, K.maxJson);
  const id = Number(rawId);
  const uid = body.client_uid ?? null;
  if (uid !== null && !K.isUid(uid)) K.fail(400, "client_uid must be 1 to 64 letters, digits, dots, dashes or underscores");
  const newTotp = body.new_totp ?? false;
  if (typeof newTotp !== "boolean") K.fail(400, "new_totp must be a boolean");
  const wantsMail = body.mail ?? false;
  if (typeof wantsMail !== "boolean") K.fail(400, "mail must be a boolean");
  const { DB } = c.env;
  if (uid !== null) {
    const row = await DB.prepare("SELECT * FROM codes WHERE client_uid = ?1").bind(uid).first();
    if (row && row.created_by !== c.actor.email) K.fail(409, "client_uid is already used");
    if (row) return K.json(200, { code: K.codeOf(row, c.dir) });
  }
  const secret = K.newSecret();
  const hash = await K.codeHash(c.env, secret);
  const sealed = await K.sealCode(c.env, secret);
  const totp = newTotp ? await K.newTotp(c.env) : null;
  const [, inserted, , old] = await DB.batch([
    DB.prepare("UPDATE codes SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL").bind(id, c.now),
    DB.prepare(
      `INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by, client_uid, totp_secret, totp_step, totp_fails, sealed_code, grant_json)
       SELECT ?2, ?3, name, email, hosts_json, manager, ?4, ?5, ?6, COALESCE(?7, totp_secret), CASE WHEN ?7 IS NULL THEN totp_step ELSE 0 END, 0, ?8, grant_json
       FROM codes WHERE id = ?1 AND changes() > 0
       RETURNING *`,
    ).bind(id, hash, secret.slice(-4), c.now, c.actor.email, uid, totp && totp.sealed, sealed),
    DB.prepare("DELETE FROM code_devices WHERE code_id = ?1 AND EXISTS (SELECT 1 FROM codes WHERE id = ?1 AND revoked_at IS NOT NULL)").bind(id),
    DB.prepare("SELECT * FROM codes WHERE id = ?1").bind(id),
  ]);
  K.forgetCodes();
  const row = inserted.results[0];
  if (!row) K.fail(404, "no such code, or it is revoked");
  await K.codesRevoked(c.env);
  const hosts = hostsOf(grantOf(row, c.dir), c.dir);
  const sent = wantsMail ? await mailLink(c, row, secret, { renewed: true, totpKey: totp && totp.key }) : null;
  return K.json(201, {
    code: K.codeOf(row, c.dir),
    secret,
    links: hosts.map((host) => accessLink(host, secret)),
    ...(totp ? { totp_key: totp.key } : {}),
    ...(row.totp_secret ? { totp: totp ? "new" : "carried" } : {}),
    ...(sent ? sent : {}),
    revoked: K.codeOf(old.results[0], c.dir),
  });
}

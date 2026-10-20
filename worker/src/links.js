import { escapeHtml, palette } from "./mail.js";
import { mailer, mailSettings } from "./mailer.js";

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

export function composeLinkMail({ name, hosts, secret, totp, renewed, theme }) {
  const c = palette(theme);
  const first = name.split(/\s+/)[0] || name;
  const plural = hosts.length > 1;
  const subject = renewed ? `Your new P99 link${plural ? "s" : ""}` : `Your P99 link${plural ? "s" : ""} for ${listed(hosts)}`;
  const lead = renewed
    ? `${first}, here is your new P99 link${plural ? "s" : ""} for ${listed(hosts)}. The old one no longer works.`
    : `${first}, here is your P99 link${plural ? "s" : ""} for ${listed(hosts)}.`;
  const how = "Open it once in the browser you use: the site keeps it, and a small + on its pages opens P99.";
  const guard = totp
    ? "The first time each browser opens it, P99 asks for the 6-digit code from your authenticator app."
    : "The link is personal: keep it to yourself.";
  const text = [
    lead,
    how,
    hosts.map((host) => `Open P99 on ${host}: ${accessLink(host, secret)}`).join("\n"),
    guard,
    "— P99",
  ];
  const p = "margin:0 0 16px";
  const button = (host) =>
    `<p style="${p}"><a href="${escapeHtml(accessLink(host, secret))}" style="display:inline-block;padding:14px 20px;min-width:200px;border-radius:8px;background:${c.accent};color:${c["on-accent"]};font-size:16px;font-weight:600;line-height:20px;text-align:center;text-decoration:none">Open P99 on ${escapeHtml(host)}</a></p>`;
  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:${c.ink};background:#ffffff;max-width:560px;padding:16px">`,
    `<p style="${p}">${escapeHtml(lead)}</p>`,
    `<p style="${p}">${escapeHtml(how)}</p>`,
    ...hosts.map(button),
    `<p style="${p}">${escapeHtml(guard)}</p>`,
    `<p style="margin:0;padding-top:12px;border-top:1px solid ${c.rule};font-size:13px;color:${c.muted}">— P99</p>`,
    "</div>",
  ].join("");
  return { subject, text: text.join("\n\n") + "\n", html };
}

export async function mailLink(c, row, secret, renewed) {
  const settings = mailSettings(c.env, c.dir.mail);
  const provider = mailer(c.env, settings);
  if (!provider) return "off";
  const to = String(row.email).toLowerCase();
  if (to.endsWith(".invalid")) return "skipped";
  const hosts = K.parseJson(row.hosts_json, []);
  const theme = c.dir.hosts.get(hosts[0])?.config.theme;
  const replyTo = c.actor && K.isEmail(c.actor.email) && !c.actor.email.endsWith(".invalid") ? c.actor.email : null;
  const message = {
    to,
    ...composeLinkMail({ name: row.name, hosts, secret, totp: Boolean(row.totp_secret), renewed, theme }),
    ...(replyTo ? { replyTo } : {}),
  };
  try {
    const outcome = await provider.send([message], `p99-link-${row.id}`);
    if (outcome.ok) return "sent";
    console.error(`the link mail for code ${row.id} failed with ${outcome.status}`);
  } catch (error) {
    console.error(`the link mail for code ${row.id} failed: ${error.message}`);
  }
  return "failed";
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
    if (row) return K.json(200, { code: K.codeOf(row) });
  }
  const secret = K.newSecret();
  const hash = await K.codeHash(c.env, secret);
  const sealed = await K.sealCode(c.env, secret);
  const totp = newTotp ? await K.newTotp(c.env) : null;
  const [, inserted, , old] = await DB.batch([
    DB.prepare("UPDATE codes SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL").bind(id, c.now),
    DB.prepare(
      `INSERT INTO codes (hash, hint, name, email, hosts_json, manager, created_at, created_by, client_uid, totp_secret, totp_step, totp_fails, sealed_code)
       SELECT ?2, ?3, name, email, hosts_json, manager, ?4, ?5, ?6, COALESCE(?7, totp_secret), CASE WHEN ?7 IS NULL THEN totp_step ELSE 0 END, 0, ?8
       FROM codes WHERE id = ?1 AND changes() > 0
       RETURNING *`,
    ).bind(id, hash, secret.slice(-4), c.now, c.actor.email, uid, totp && totp.sealed, sealed),
    DB.prepare("DELETE FROM code_devices WHERE code_id = ?1 AND EXISTS (SELECT 1 FROM codes WHERE id = ?1 AND revoked_at IS NOT NULL)").bind(id),
    DB.prepare("SELECT * FROM codes WHERE id = ?1").bind(id),
  ]);
  K.forgetCodes();
  const row = inserted.results[0];
  if (!row) K.fail(404, "no such code, or it is revoked");
  const hosts = K.parseJson(row.hosts_json, []);
  const mail = wantsMail ? await mailLink(c, row, secret, true) : null;
  return K.json(201, {
    code: K.codeOf(row),
    secret,
    links: hosts.map((host) => accessLink(host, secret)),
    ...(totp ? { totp_key: totp.key } : {}),
    ...(row.totp_secret ? { totp: totp ? "new" : "carried" } : {}),
    ...(mail ? { mail } : {}),
    revoked: K.codeOf(old.results[0]),
  });
}

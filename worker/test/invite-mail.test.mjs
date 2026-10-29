import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { QR_ID, busiest, composeLinkMail, composeTotpMail, grouped, mailLink, mailTotp, otpauthLink, useKit } from "../src/links.js";

const NOW = "2026-10-29T10:00:00.000Z";
const KEY = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SECRET = "abcdefghjkmn";
const SHOP = "shop.example.com";
const BLOG = "blog.example.com";
const GRACE = "grace@example.com";

useKit({ isEmail: (value) => typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) });

const link = (over = {}) =>
  composeLinkMail({
    name: "Grace Hopper",
    email: GRACE,
    hosts: [SHOP, BLOG],
    secret: SECRET,
    totp: true,
    totpMail: true,
    renewed: false,
    theme: null,
    owner: false,
    space: "Example",
    app: "p99.example.com",
    ...over,
  });

const totpMail = (over = {}) => composeTotpMail({ name: "Grace Hopper", email: GRACE, key: KEY, kind: "invite", theme: null, qrSide: 456, ...over });

function buttons(html) {
  return [...html.matchAll(/<a href="([^"]+)"[^>]*>Open P99 on ([^<]+)<\/a>/g)].map((m) => m[2]);
}

test("the link mail names the space, the role and the hosts, and numbers its steps", () => {
  const mail = link();
  assert.equal(mail.subject, "Your P99 access for Example");
  assert.equal(
    mail.text,
    [
      "Grace, you can now file bugs and ideas on shop.example.com and blog.example.com with P99, as a User of Example.",
      "1. First, set up your authenticator: a second mail from P99, sent separately, has the code to scan.",
      `2. Open your link once in each browser you use:\nOpen P99 on ${SHOP}: https://${SHOP}/#p99=${SECRET}\nOpen P99 on ${BLOG}: https://${BLOG}/#p99=${SECRET}`,
      "3. The first time, P99 asks for the 6-digit code your authenticator shows. After that the browser is remembered.",
      "4. On the site, the + in the corner opens P99: describe the bug or idea; a screenshot of the page goes with it, with the site's private areas hidden unless you choose to show them. The ⋯ next to it lists your cards and their replies.",
      "The link is personal: don't forward it.",
      "— P99",
    ].join("\n\n") + "\n",
  );
  assert.deepEqual(buttons(mail.html), [SHOP, BLOG]);
  for (const n of [1, 2, 3, 4]) assert.ok(mail.html.includes(`>${n}.</td>`), `step ${n}`);
  assert.equal(mail.html.includes(">5.</td>"), false);
  assert.ok(mail.html.includes("as a User of Example."));
  assert.equal(/board/.test(mail.text), false, "a User hears nothing of the board");
});

test("an Owner hears of the board and, with an authenticator and a P99 page, of signing in there", () => {
  const mail = link({ owner: true });
  assert.ok(mail.text.startsWith("Grace, you can now file bugs and ideas on shop.example.com and blog.example.com with P99, as an Owner of Example.\n"));
  assert.ok(mail.text.includes("As an Owner you also get the board, where every card of Example moves through its lanes."));
  assert.ok(
    mail.text.includes(
      `5. You can also open the board from anywhere at https://p99.example.com/: sign in with ${GRACE} and the 6-digit code your authenticator shows.`,
    ),
  );
  assert.ok(mail.html.includes('<a href="https://p99.example.com/"'));
  assert.equal(link({ owner: true, app: null }).text.includes("p99.example.com"), false, "no page, no page step");
  assert.equal(link({ owner: true, totp: false, totpMail: false }).text.includes("sign in"), false, "the page signs in with the authenticator alone");
  assert.equal(link({ app: "p99.example.com" }).text.includes("p99.example.com"), false, "a User gets no page step");
});

test("without an authenticator the steps are the link and the +, and without a space name the hosts name it", () => {
  const mail = link({ totp: false, totpMail: false, space: null, hosts: [SHOP] });
  assert.equal(mail.subject, `Your P99 access for ${SHOP}`);
  assert.ok(mail.text.startsWith(`Grace, you can now file bugs and ideas on ${SHOP} with P99, as a User.\n`));
  assert.ok(mail.text.includes("\n1. Open your link once"));
  assert.ok(mail.text.includes("\n2. On the site"));
  assert.equal(/authenticator|6-digit/.test(mail.text + mail.html), false);
});

test("a new link says the old one stopped, and a carried authenticator skips the setup step", () => {
  const mail = link({ renewed: true, totpMail: false, owner: true });
  assert.equal(mail.subject, "Your new P99 link for Example");
  assert.ok(mail.text.startsWith("Grace, here is your new P99 link: the old one no longer works. You can now file bugs and ideas on"));
  assert.equal(mail.text.includes("second mail"), false);
  assert.ok(mail.text.includes("\n2. The first time, P99 asks for the 6-digit code"));
});

test("the link mail carries no authenticator key, and the authenticator mail carries no link", () => {
  const first = link({ owner: true });
  const second = totpMail();
  for (const part of [first.text, first.html]) {
    assert.equal(part.includes(KEY), false);
    assert.equal(part.includes(grouped(KEY)), false);
    assert.equal(part.includes("otpauth"), false);
  }
  for (const part of [second.text, second.html]) {
    assert.equal(part.includes(SECRET), false);
    assert.equal(part.includes("#p99="), false);
    assert.equal(/https?:\/\//.test(part), false, "no web link at all");
  }
  const secrets = [...`${second.text}${second.html}`.matchAll(/[A-Z2-7]{16,}/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(secrets)], [KEY], "the key is the only secret in it");
});

test("the authenticator mail walks through the app, the QR code, the key in fours, the tap link and the code", () => {
  const mail = totpMail();
  const uri = `otpauth://totp/P99:${GRACE}?secret=${KEY}&issuer=P99&algorithm=SHA1&digits=6&period=30`;
  assert.equal(mail.subject, "Set up your authenticator for P99");
  assert.equal(
    mail.text,
    [
      "Grace, this is the second mail from P99, sent apart from your link. It sets up the 6-digit code P99 asks for the first time each browser opens your link.",
      "1. If you have no authenticator app yet, install one: Google Authenticator, Microsoft Authenticator, your password manager or your phone's built-in passwords app all work.",
      `2. In the app, add an account and type this key: JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP\nOn your phone, this link adds it in one tap: ${uri}`,
      `3. The account appears as "P99: ${GRACE}". It shows a 6-digit code that changes every 30 seconds.`,
      "4. When P99 asks, enter the code it shows at that moment.",
      "Nothing else to do: no P99 account, no password.",
      "— P99",
    ].join("\n\n") + "\n",
  );
  assert.ok(mail.html.includes(`<img src="cid:${QR_ID}" width="228" height="228"`));
  assert.ok(mail.html.includes(`href="${uri.replace(/&/g, "&amp;")}"`));
  assert.ok(mail.html.includes("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP"));
  assert.equal(/data:|<svg/i.test(mail.html), false, "nothing Gmail strips");
});

test("an authenticator added later, or replaced with a new link, says to replace the old account", () => {
  const added = totpMail({ kind: "added" });
  assert.ok(added.text.startsWith("Grace, your P99 link now asks for a 6-digit code from an authenticator app, the first time each browser opens it. Set it up once:\n"));
  assert.ok(added.text.includes("If your authenticator already has P99 for this e-mail, replace it with this one: the old one no longer works."));
  const relinked = totpMail({ kind: "relink" });
  assert.ok(relinked.text.startsWith("Grace, this is the second mail from P99, sent apart from your new link."));
  assert.ok(relinked.text.includes("replace it with this one"));
  assert.equal(totpMail().text.includes("replace it"), false);
});

test("the otpauth link encodes the e-mail as the CLI does", () => {
  assert.equal(otpauthLink("grace+p99@example.com", "AB"), "otpauth://totp/P99:grace%2Bp99@example.com?secret=AB&issuer=P99&algorithm=SHA1&digits=6&period=30");
  assert.equal(grouped("ABCDEFGHIJ"), "ABCD EFGH IJ");
});

function d1(db) {
  return {
    prepare(sql) {
      let binds = [];
      const statement = {
        bind(...values) {
          binds = values;
          return statement;
        },
        async all() {
          return { results: db.prepare(sql.replace(/\?(\d+)/g, (_, n) => `?${n}`)).all(...binds) };
        },
      };
      return statement;
    },
  };
}

function items(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, host TEXT, created_at TEXT, updated_at TEXT, activity_at TEXT)");
  const put = db.prepare("INSERT INTO items (host, created_at, updated_at, activity_at) VALUES (?, ?, ?, ?)");
  for (const [host, created, updated = created, activity = updated] of rows) put.run(host, created, updated, activity);
  return d1(db);
}

test("the busiest host leads: most items filed or changed in the last 30 days, ties in today's order", async () => {
  const old = "2026-09-01T00:00:00.000Z";
  const recent = "2026-10-20T00:00:00.000Z";
  const c = (rows) => ({ now: NOW, env: { DB: items(rows) } });
  const hosts = ["a.example.com", BLOG, SHOP];
  assert.deepEqual(await busiest(c([]), hosts), hosts);
  assert.deepEqual(await busiest(c([[SHOP, recent], [SHOP, recent], [BLOG, recent]]), hosts), [SHOP, BLOG, "a.example.com"]);
  assert.deepEqual(
    await busiest(c([[BLOG, old], [BLOG, old], [BLOG, old], [SHOP, recent]]), hosts),
    [SHOP, "a.example.com", BLOG],
    "older work does not count",
  );
  assert.deepEqual(await busiest(c([[BLOG, old, recent], [SHOP, old, old, recent], [SHOP, old, old, recent]]), hosts), [SHOP, BLOG, "a.example.com"], "a change or a reply counts");
  assert.deepEqual(await busiest(c([[SHOP, recent], [BLOG, recent]]), hosts), [BLOG, SHOP, "a.example.com"], "a tie keeps today's order");
  assert.deepEqual(await busiest(c([["elsewhere.example.com", recent]]), [SHOP]), [SHOP]);
});

function context(rows, over = {}) {
  return {
    now: NOW,
    actor: { email: "ada@example.com", name: "Ada Lovelace" },
    env: { DB: items(rows), RESEND_API_KEY: "test", RESEND_API_URL: "http://127.0.0.1:9", SPACE_NAME: "Example", APP_HOST: "p99.example.com", ...over },
    dir: {
      mail: { provider: "resend", sender: "P99 <p99@example.com>" },
      hosts: new Map([
        [BLOG, { host: BLOG, project_id: 1, config: {} }],
        [SHOP, { host: SHOP, project_id: 1, config: {} }],
      ]),
      projects: new Map([[1, { id: 1, name: "Shop" }]]),
    },
  };
}

async function posted(fn, status = 200) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response("{}", { status });
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

function totpAt(key, at) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of key) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac("sha1", Buffer.from(out)).update(counter).digest();
  return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test("an invite with an authenticator sends two messages: the link in a batch, then the setup alone with its QR code inline", async () => {
  const row = { id: 7, name: "Grace Hopper", email: GRACE, manager: 1, totp_secret: "sealed-iv-for-the-test.x", grant_json: '{"space":true}' };
  const busy = "2026-10-28T00:00:00.000Z";
  const { result, calls } = await posted(() => mailLink(context([[SHOP, busy]]), row, SECRET, { totpKey: KEY }));
  assert.deepEqual(result, { mail: "sent", totp_mail: "sent" });
  assert.deepEqual(calls.map((c) => c.url), ["http://127.0.0.1:9/emails/batch", "http://127.0.0.1:9/emails"]);
  const [first] = calls[0].body;
  assert.equal(first.subject, "Your P99 access for Example");
  assert.deepEqual(buttons(first.html), [SHOP, BLOG], "the busiest site leads");
  assert.equal(first.reply_to, "ada@example.com");
  assert.equal(first.attachments, undefined);
  assert.ok(first.text.includes("as an Owner of Example"));
  assert.equal(calls[0].headers["idempotency-key"], "p99-link-7");
  const second = calls[1].body;
  assert.deepEqual(second.to, [GRACE]);
  assert.equal(second.subject, "Set up your authenticator for P99");
  assert.equal(second.text.includes(SECRET), false);
  assert.equal(second.attachments.length, 1);
  const [qr] = second.attachments;
  assert.deepEqual([qr.filename, qr.content_type, qr.content_id], [`${QR_ID}.png`, "image/png", QR_ID]);
  assert.ok(second.html.includes(`src="cid:${qr.content_id}"`));
  assert.deepEqual([...Buffer.from(qr.content, "base64").subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(calls[1].headers["idempotency-key"], "p99-totp-7-sealed-iv-for-the-test.x");
  const typed = /type this key: ([A-Z2-7 ]+)\n/.exec(second.text)[1].replace(/ /g, "");
  assert.equal(totpAt(typed, Date.parse(NOW)), totpAt(KEY, Date.parse(NOW)));
});

test("no authenticator mail goes when the link mail did not, and none at all without a key", async () => {
  const row = { id: 8, name: "Grace Hopper", email: GRACE, manager: 0, totp_secret: "x", grant_json: '{"space":true}' };
  const failed = await posted(() => mailLink(context([]), row, SECRET, { totpKey: KEY }), 500);
  assert.deepEqual(failed.result, { mail: "failed" });
  assert.equal(failed.calls.length, 1);
  const plain = await posted(() => mailLink(context([]), { ...row, totp_secret: null }, SECRET));
  assert.deepEqual(plain.result, { mail: "sent" });
  assert.equal(plain.calls.length, 1);
  const off = await posted(() => mailLink({ ...context([]), env: { DB: items([]) } }, row, SECRET, { totpKey: KEY }));
  assert.deepEqual(off.result, { mail: "off" });
  assert.equal(off.calls.length, 0);
  const invalid = await posted(() => mailTotp(context([]), { ...row, email: "grace@example.invalid" }, KEY, "added"));
  assert.equal(invalid.result, "skipped");
  assert.equal(invalid.calls.length, 0);
});

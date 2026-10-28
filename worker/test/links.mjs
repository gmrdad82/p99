import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

function totpOf(key, offset = 0) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of key) {
    value = (value << 5) | abc.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

function binary(root) {
  if (process.env.P99_BIN) return process.env.P99_BIN;
  const built = ["release", "debug"]
    .map((profile) => join(root, "..", "target", profile, "p99"))
    .filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (built.length === 0) throw new Error("no p99 binary to drive; run cargo build first or set P99_BIN");
  return built[0];
}

function buttons(html) {
  return [...html.matchAll(/<a href="([^"]+)"[^>]*>Open P99 on ([^<]+)<\/a>/g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);
}

export async function linkChecks({ base, call, browse, check, here, there, sent, keys, root, work }) {
  const until = async (what, fn) => {
    for (let i = 0; i < 100; i++) {
      const value = await fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`gave up waiting for ${what}`);
  };
  const mailTo = (email) => sent.filter((m) => m.to[0] === email);

  await check("an invite mails one button per host with the plain links, reply-to the inviter, by default and never when told not to", async () => {
    const quiet = await call("POST", "/_p99/v1/codes", { body: { name: "Dorothy Vaughan", email: "dorothy@example.com", hosts: [here], mail: false } });
    assert.equal(quiet.status, 201);
    assert.equal(quiet.json.mail, undefined);
    const minted = await call("POST", "/_p99/v1/codes", {
      body: { name: "Katherine Johnson", email: "katherine@example.com", hosts: [here, there] },
    });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    assert.equal(minted.json.mail, "sent");
    const [mail] = await until("the invite mail", () => mailTo("katherine@example.com").length === 1 && mailTo("katherine@example.com"));
    assert.deepEqual(
      buttons(mail.html),
      [here, there].map((host) => [host, `https://${host}/#p99=${minted.json.secret}`]),
    );
    for (const host of [here, there]) assert.ok(mail.text.includes(`https://${host}/#p99=${minted.json.secret}`), mail.text);
    assert.equal(mail.reply_to, "grace@example.com");
    assert.equal(mailTo("dorothy@example.com").length, 0);
  });

  await check("a relink revokes the old code in the same request, the old code gets 401, the new one works and the authenticator carries over", async () => {
    const minted = await call("POST", "/_p99/v1/codes", { body: { name: "Annie Easley", email: "annie@example.com", hosts: [here], totp: true, mail: false } });
    assert.equal(minted.status, 201);
    const used = totpOf(minted.json.totp_key);
    assert.equal((await browse("POST", "/verify", minted.json.secret, { totp: used })).status, 201);
    const relinked = await call("POST", `/_p99/v1/codes/${minted.json.code.id}/relink`, { body: { client_uid: randomUUID() } });
    assert.equal(relinked.status, 201, JSON.stringify(relinked.json));
    assert.equal(relinked.json.revoked.id, minted.json.code.id);
    assert.ok(relinked.json.revoked.revoked_at);
    assert.equal(relinked.json.totp, "carried");
    assert.equal(relinked.json.totp_key, undefined);
    assert.equal(relinked.json.code.email, "annie@example.com");
    assert.deepEqual(relinked.json.code.hosts, [here]);
    assert.notEqual(relinked.json.secret, minted.json.secret);
    assert.equal((await browse("GET", "/me", minted.json.secret)).status, 401);
    const fresh = relinked.json.secret;
    assert.equal((await browse("GET", "/me", fresh)).status, 428);
    assert.equal((await browse("POST", "/verify", fresh, { totp: used })).status, 400);
    const next = await browse("POST", "/verify", fresh, { totp: totpOf(minted.json.totp_key, 1) });
    assert.equal(next.status, 201, JSON.stringify(next.json));
    assert.equal((await browse("GET", "/me", `${fresh}.${next.json.device}`)).status, 200);
    assert.equal((await call("POST", `/_p99/v1/codes/${minted.json.code.id}/relink`, { body: {} })).status, 404);
    const renewed = await call("POST", `/_p99/v1/codes/${relinked.json.code.id}/relink`, { body: { new_totp: true, mail: true } });
    assert.equal(renewed.status, 201);
    assert.equal(renewed.json.totp, "new");
    assert.notEqual(renewed.json.totp_key, minted.json.totp_key);
    assert.equal(renewed.json.mail, "sent");
    const [mail] = await until("the relink mail", () => mailTo("annie@example.com").length === 1 && mailTo("annie@example.com"));
    assert.deepEqual(buttons(mail.html), [[here, `https://${here}/#p99=${renewed.json.secret}`]]);
    assert.equal(mail.text.includes(renewed.json.totp_key), false);
    assert.equal(mail.html.includes(renewed.json.totp_key), false);
  });

  await check("the CLI's relink puts a person's new code only in their mail, and the owner's only on the command's stdout", async () => {
    const dir = join(work, "links");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "home"), { recursive: true });
    const fakeOp = join(dir, "bin", "op");
    writeFileSync(fakeOp, '#!/bin/sh\n[ "$1" = read ] || exit 9\nprintf %s "$FAKE_OP_VALUE"\n');
    chmodSync(fakeOp, 0o755);
    const config = join(dir, "config.toml");
    const write = (code) => {
      writeFileSync(
        config,
        [
          'default_account = "local"',
          "[me]",
          'name = "Mary Jackson"',
          'email = "mary@example.com"',
          "[accounts.local]",
          'account_id = "local"',
          'token = ""',
          `key = "${keys.p99}"`,
          `url = "${base}/_p99"`,
          ...(code ? [`code = "${code}"`] : []),
          `[hosts."${here}"]`,
          'account = "local"',
          `[hosts."${there}"]`,
          'account = "local"',
          "",
        ].join("\n"),
      );
      chmodSync(config, 0o600);
    };
    write(null);
    const p99 = binary(root);
    const run = (args, extra = {}) =>
      new Promise((resolve, reject) => {
        const child = spawn(p99, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            HOME: join(dir, "home"),
            XDG_CONFIG_HOME: join(dir, "home"),
            XDG_RUNTIME_DIR: join(dir, "home"),
            P99_CONFIG: config,
            NO_COLOR: "1",
            ...extra,
          },
        });
        const out = { stdout: "", stderr: "" };
        child.stdout.on("data", (chunk) => (out.stdout += chunk));
        child.stderr.on("data", (chunk) => (out.stderr += chunk));
        const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
        child.on("error", reject);
        child.on("close", (status) => {
          clearTimeout(timer);
          if (status !== 0) reject(new Error(`p99 ${args.join(" ")} exited ${status}: ${out.stderr}`));
          else resolve(out);
        });
      });
    const person = await call("POST", "/_p99/v1/codes", { body: { name: "Christine Darden", email: "christine@example.com", hosts: [here], mail: false } });
    const mary = await call("POST", "/_p99/v1/codes", { body: { name: "Mary Jackson", email: "mary@example.com", hosts: [here, there], mail: false } });
    assert.equal(person.status, 201);
    assert.equal(mary.status, 201);

    const other = await run(["relink", "christine@example.com"]);
    const [mail] = await until("christine's new link", () => mailTo("christine@example.com").length === 1 && mailTo("christine@example.com"));
    const code = /#p99=([0-9a-z]{12})/.exec(mail.text)[1];
    assert.equal(mail.reply_to, "mary@example.com");
    assert.match(other.stdout, /mailed the link/);
    assert.equal(other.stdout.includes(code), false);
    assert.equal(other.stderr.includes(code), false);
    assert.equal((await browse("GET", "/me", person.json.secret)).status, 401);
    assert.equal((await browse("GET", "/me", code)).status, 200);

    const before = sent.length;
    const own = await run(["relink", "--self"]);
    const links = own.stdout.match(/https:\/\/\S+#p99=[0-9a-z]{12}/g);
    assert.equal(links.length, 2, own.stdout);
    const mine = /#p99=([0-9a-z]{12})/.exec(links[0])[1];
    assert.deepEqual(links, [here, there].map((host) => `https://${host}/#p99=${mine}`));
    assert.equal(own.stderr.includes(mine), false);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent.length, before);
    assert.equal((await browse("GET", "/me", mary.json.secret)).status, 401);

    const kept = [readFileSync(config, "utf8"), readFileSync(join(work, "test-dev.log"), "utf8")];
    for (const text of kept) for (const c of [code, mine]) assert.equal(text.includes(c), false);

    write("op://Vault/Item/field");
    const read = await run(["link", there, "--print"], { FAKE_OP_VALUE: mine });
    assert.equal(read.stdout, `https://${there}/#p99=${mine}\n`);
    write(mine.toUpperCase().replace(/(.{4})(?!$)/g, "$1-"));
    assert.equal((await run(["link", here, "--print"])).stdout, `https://${here}/#p99=${mine}\n`);
    rmSync(dir, { recursive: true, force: true });
  });
}

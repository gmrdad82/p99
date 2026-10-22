import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import assert from "node:assert/strict";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const MAX_FILE = 20 * 1024 * 1024;
const MAX_BYTES_A_DAY = 100 * 1024 * 1024;
const MARK = {
  rect: { x: 40, y: 60, w: 200, h: 120 },
  viewport: { w: 1280, h: 800, scroll_x: 0, scroll_y: 0, dpr: 1 },
  elements: [{ selector: "#payment button", label: "Pay", text: "Pay", box: { x: 50, y: 70, w: 100, h: 40 } }],
};

export async function widgetStories({ base, browse, mint, check, issueBody, here, there, call, state, wrangler, root }) {
  const port = Number(new URL(base).port);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const d1 = (command) => {
    const run = spawnSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", command], {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`d1 ${command} failed:\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(run.stdout)[0].results;
  };
  const one = (command) => d1(command)[0]?.n ?? null;
  const seedUsage = (email, field, value) =>
    d1(
      `INSERT INTO usage (actor_email, day, ${field}) VALUES ('${email}', date('now'), ${value}), ('${email}', date('now', '+1 day'), ${value})
       ON CONFLICT (actor_email, day) DO UPDATE SET ${field} = excluded.${field}`,
    );
  const used = (email, field) => one(`SELECT coalesce(max(${field}), 0) AS n FROM usage WHERE actor_email = '${email}'`);
  const raw = (method, path, { host, headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const sent = { ...headers };
      if (host) sent.host = `${host}:${port}`;
      if (body) sent["content-length"] = body.length;
      let answered = false;
      const req = request({ host: "127.0.0.1", port, path, method, headers: sent }, (res) => {
        answered = true;
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on("error", (error) => {
        if (!answered) reject(error);
      });
      req.end(body);
    });
  const attach = async (code, key, { uid = randomUUID(), role = "file", name = "notes.txt", type = "text/plain", mark, comment, body }) => {
    const params = new URLSearchParams({ name, role });
    if (mark !== undefined) params.set("mark", String(mark));
    if (comment !== undefined) params.set("comment", String(comment));
    const response = await fetch(`${base}/_p99/api/issues/${key}/attachments/${uid}?${params}`, {
      method: "PUT",
      headers: { "x-p99-code": code, "content-type": type },
      body,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, uid };
  };
  const thread = async (code, key) => {
    const seen = await browse("GET", `/issues/${key}`, code);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    return seen.json;
  };
  const rows = (table, where) => one(`SELECT count(*) AS n FROM ${table} WHERE ${where}`);

  const mary = await mint("Mary Somerville", "mary@example.com", [here]);

  await check("story widget: a visitor's report with its screenshot, a marked area and a file arrives whole, and the reporter gets back the exact bytes they sent", async () => {
    const filed = await browse("POST", "/issues", mary.secret, issueBody({ title: "Pay stays grey after the card is accepted", marks: [MARK] }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    const note = Buffer.from("order 1042: card accepted, Pay disabled\n");
    const shot = await attach(mary.secret, key, { role: "screenshot", name: "screen.webp", type: "image/webp", body: WEBP });
    const area = await attach(mary.secret, key, { role: "region", mark: 0, name: "region-1.png", type: "image/png", body: PNG });
    const file = await attach(mary.secret, key, { name: "order.txt", body: note });
    for (const put of [shot, area, file]) assert.equal(put.status, 201, JSON.stringify(put.json));
    assert.equal(file.json.sha256, sha(note));
    const seen = await thread(mary.secret, key);
    assert.equal(seen.issue.attachments, 3);
    assert.deepEqual(seen.attachments.map((a) => a.role).sort(), ["file", "region", "screenshot"]);
    assert.equal(seen.attachments.find((a) => a.role === "region").mark, 0);
    assert.equal(seen.issue.marks.length, 1);
    assert.equal(seen.issue.marks[0].elements[0].label, "Pay");
    const back = await fetch(`${base}/_p99/api/files/${file.json.id}`, { headers: { "x-p99-code": mary.secret } });
    assert.equal(back.status, 200);
    assert.deepEqual(Buffer.from(await back.arrayBuffer()), note);
    assert.equal(back.headers.get("x-content-sha256"), sha(note));
    assert.match(back.headers.get("content-disposition"), /^attachment;/);
    const image = await fetch(`${base}/_p99/api/files/${shot.json.id}`, { headers: { "x-p99-code": mary.secret } });
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), WEBP);
    const managed = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(managed.json.attachments.length, 3);
  });

  await check("story widget: a screenshot that isn't an image, a file named to run, a region with no area or an empty file is refused and leaves nothing behind", async () => {
    const filed = await browse("POST", "/issues", mary.secret, issueBody({ title: "Refused files leave no trace", marks: [MARK] }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const refused = [
      { role: "screenshot", name: "screen.svg", type: "image/svg+xml", body: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
      { role: "screenshot", name: "screen.png", type: "image/png", body: html },
      { role: "page", name: "page.gif", type: "image/gif", body: Buffer.from("GIF89a....") },
      { name: "invoice.pdf.html", type: "text/plain", body: Buffer.from("hello") },
      { name: "setup.exe ", type: "application/zip", body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) },
      { name: "trace.zip", type: "application/zip", body: html },
      { name: "../../etc/passwd", type: "text/plain", body: Buffer.from("root") },
      { role: "region", name: "region.png", type: "image/png", body: PNG },
      { role: "region", mark: 1, name: "region.png", type: "image/png", body: PNG },
      { role: "screenshot", mark: 0, name: "screen.png", type: "image/png", body: PNG },
      { role: "video", name: "clip.webm", type: "video/webm", body: Buffer.from("webm") },
    ];
    for (const put of refused) {
      const answer = await attach(mary.secret, key, put);
      assert.equal(answer.status, 400, `${put.name}: ${JSON.stringify(answer.json)}`);
    }
    const empty = await attach(mary.secret, key, { name: "empty.txt", body: Buffer.alloc(0) });
    assert.equal(empty.status, 400, JSON.stringify(empty.json));
    const seen = await thread(mary.secret, key);
    assert.equal(seen.issue.attachments, 0);
    assert.equal(seen.attachments.length, 0);
    assert.equal(rows("attachments", `item_id = ${filed.json.id}`), 0);
  });

  await check("story widget: a file over 20 MB is refused before it is stored and costs the reporter none of their daily room", async () => {
    const filed = await browse("POST", "/issues", mary.secret, issueBody({ title: "The export is too big to attach" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    const before = used("mary@example.com", "bytes");
    const big = Buffer.alloc(MAX_FILE + 1, 0x41);
    const answer = await raw("PUT", `/_p99/api/issues/${key}/attachments/${randomUUID()}?name=export.txt&role=file`, {
      headers: { "x-p99-code": mary.secret, "content-type": "text/plain" },
      body: big,
    });
    assert.equal(answer.status, 413, answer.text);
    assert.equal(answer.json.error, "too_large");
    assert.match(answer.json.message, /20 MB/);
    assert.equal(rows("attachments", `item_id = ${filed.json.id}`), 0);
    assert.equal(used("mary@example.com", "bytes"), before);
    const fits = await attach(mary.secret, key, { name: "export.txt", body: Buffer.from("first 100 rows\n") });
    assert.equal(fits.status, 201, JSON.stringify(fits.json));
  });

  await check("story widget: a report too large to take is refused with why, and nothing is filed or counted", async () => {
    const title = `Oversized report ${randomUUID()}`;
    const before = used("mary@example.com", "issues");
    const huge = await browse("POST", "/issues", mary.secret, issueBody({ title, body: "x".repeat(300 * 1024) }));
    assert.equal(huge.status, 413, JSON.stringify(huge.json));
    const context = await browse("POST", "/issues", mary.secret, issueBody({ title, context: { log: "y".repeat(70 * 1024) } }));
    assert.equal(context.status, 413, JSON.stringify(context.json));
    assert.match(context.json.message, /64 KB/);
    const words = await browse("POST", "/issues", mary.secret, issueBody({ title, body: "z".repeat(20001) }));
    assert.equal(words.status, 400, JSON.stringify(words.json));
    const marks = await browse("POST", "/issues", mary.secret, issueBody({ title, marks: Array(11).fill(MARK) }));
    assert.equal(marks.status, 400, JSON.stringify(marks.json));
    assert.equal(rows("items", `title = '${title}'`), 0);
    assert.equal(used("mary@example.com", "issues"), before);
  });

  await check("story widget: a reporter at a daily limit is told which one, while a retry of what they already sent still answers", async () => {
    const hedy = await mint("Hedy Lamarr", "hedy@example.com", [here]);
    seedUsage("hedy@example.com", "issues", 29);
    const last = issueBody({ title: "The last report of the day" });
    const filed = await browse("POST", "/issues", hedy.secret, last);
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const again = await browse("POST", "/issues", hedy.secret, last);
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.key, filed.json.key);
    const over = await browse("POST", "/issues", hedy.secret, issueBody({ title: "One too many" }));
    assert.equal(over.status, 429, JSON.stringify(over.json));
    assert.equal(over.json.error, "rate_limited");
    assert.match(over.json.message, /^today's limit of 30 items/);
    assert.equal(rows("items", "reporter_email = 'hedy@example.com'"), 1);
    assert.equal(used("hedy@example.com", "issues"), 30);

    seedUsage("hedy@example.com", "bytes", MAX_BYTES_A_DAY - 8);
    const bigger = await attach(hedy.secret, filed.json.key, { name: "sixteen.txt", body: Buffer.from("sixteen bytes!!\n") });
    assert.equal(bigger.status, 429, JSON.stringify(bigger.json));
    assert.match(bigger.json.message, /^today's limit of 100 MB of files/);
    const exact = await attach(hedy.secret, filed.json.key, { name: "eight.txt", body: Buffer.from("8 bytes\n") });
    assert.equal(exact.status, 201, JSON.stringify(exact.json));
    assert.equal(used("hedy@example.com", "bytes"), MAX_BYTES_A_DAY);
    assert.equal(rows("attachments", `item_id = ${filed.json.id}`), 1);
  });

  await check("story widget: a burst from one code is slowed with a 429 that says to wait a minute, and other reporters keep working", async () => {
    const katherine = await mint("Katherine Johnson", "katherine@example.com", [here]);
    let slowed = null;
    for (let i = 0; i < 300 && !slowed; i++) {
      const me = await browse("GET", "/me", katherine.secret);
      if (me.status === 429) slowed = me;
      else assert.equal(me.status, 200, JSON.stringify(me.json));
    }
    assert.ok(slowed, "300 requests in a burst were never slowed");
    assert.equal(slowed.json.error, "rate_limited");
    assert.match(slowed.json.message, /minute/);
    assert.doesNotMatch(slowed.json.message, /^today's limit/);
    assert.equal((await browse("GET", "/me", mary.secret)).status, 200);
  });

  await check("story widget: a double-clicked send files one item, counts once, and another reporter reusing its id never reaches it", async () => {
    const annie = await mint("Annie Easley", "annie@example.com", [here]);
    const body = issueBody({ title: "Clicked Send twice" });
    const both = await Promise.all([browse("POST", "/issues", annie.secret, body), browse("POST", "/issues", annie.secret, body)]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 201], JSON.stringify(both.map((r) => r.json)));
    assert.equal(both[0].json.key, both[1].json.key);
    assert.equal(rows("items", `client_uid = '${body.client_uid}'`), 1);
    assert.equal(used("annie@example.com", "issues"), 1);
    const key = both[0].json.key;

    const stranger = await mint("Dorothy Vaughan", "dorothy@example.com", [here]);
    const stolen = await browse("POST", "/issues", stranger.secret, { ...body, title: "Someone else's id" });
    assert.equal(stolen.status, 409, JSON.stringify(stolen.json));
    assert.equal(JSON.stringify(stolen.json).includes("Clicked Send twice"), false);
    assert.equal(JSON.stringify(stolen.json).includes(key), false);

    const comment = { client_uid: randomUUID(), body: "Pressed Send again while it spun." };
    const twice = await Promise.all([browse("POST", `/issues/${key}/comments`, annie.secret, comment), browse("POST", `/issues/${key}/comments`, annie.secret, comment)]);
    assert.deepEqual(twice.map((r) => r.status).sort(), [200, 201], JSON.stringify(twice.map((r) => r.json)));
    assert.equal(twice[0].json.id, twice[1].json.id);
    assert.equal((await browse("POST", `/issues/${key}/comments`, stranger.secret, comment)).status, 404);

    const uid = randomUUID();
    const note = Buffer.from("uploaded twice at once\n");
    const puts = await Promise.all([attach(annie.secret, key, { uid, body: note }), attach(annie.secret, key, { uid, body: note })]);
    assert.deepEqual(puts.map((r) => r.status).sort(), [200, 201], JSON.stringify(puts.map((r) => r.json)));
    assert.equal(puts[0].json.id, puts[1].json.id);
    const seen = await thread(annie.secret, key);
    assert.equal(seen.comments.length, 1);
    assert.equal(seen.issue.attachments, 1);
    assert.equal(seen.attachments.length, 1);
    assert.equal(used("annie@example.com", "bytes"), note.length);
    assert.equal((await attach(stranger.secret, key, { uid, body: note })).status, 404);
  });

  await check("story widget: an answer lost on the way back loses nothing: the retried item, comment and file come back as the ones already stored", async () => {
    const body = issueBody({ title: "The answer was lost on the train" });
    const first = await browse("POST", "/issues", mary.secret, body);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const retried = await browse("POST", "/issues", mary.secret, body);
    assert.equal(retried.status, 200, JSON.stringify(retried.json));
    assert.deepEqual([retried.json.key, retried.json.created_at], [first.json.key, first.json.created_at]);
    const key = first.json.key;
    const comment = { client_uid: randomUUID(), body: "It happens in the tunnel." };
    const said = await browse("POST", `/issues/${key}/comments`, mary.secret, comment);
    const resaid = await browse("POST", `/issues/${key}/comments`, mary.secret, comment);
    assert.deepEqual([said.status, resaid.status, resaid.json.id], [201, 200, said.json.id]);
    const uid = randomUUID();
    const note = Buffer.from("signal: none\n");
    const put = await attach(mary.secret, key, { uid, body: note });
    const reput = await attach(mary.secret, key, { uid, body: note });
    assert.deepEqual([put.status, reput.status, reput.json.id], [201, 200, put.json.id]);
    const seen = await thread(mary.secret, key);
    assert.equal(seen.comments.length, 1);
    assert.equal(seen.attachments.length, 1);
    assert.equal(rows("items", `client_uid = '${body.client_uid}'`), 1);
  });

  await check("story widget: an upload cut off mid-way stores nothing, and its retry stores the whole file", async () => {
    const filed = await browse("POST", "/issues", mary.secret, issueBody({ title: "The upload dropped half way" }));
    const key = filed.json.key;
    const uid = randomUUID();
    const whole = Buffer.alloc(256 * 1024, 0x61);
    await new Promise((resolve) => {
      const req = request({
        host: "127.0.0.1",
        port,
        path: `/_p99/api/issues/${key}/attachments/${uid}?name=log.txt&role=file`,
        method: "PUT",
        headers: { "x-p99-code": mary.secret, "content-type": "text/plain", "content-length": whole.length },
      });
      req.on("error", resolve);
      req.on("response", (res) => {
        res.resume();
        resolve();
      });
      req.write(whole.subarray(0, 64 * 1024), () => {
        req.destroy();
        resolve();
      });
    });
    assert.equal(rows("attachments", `client_uid = '${uid}' AND stored_at IS NOT NULL`), 0);
    const retried = await attach(mary.secret, key, { uid, name: "log.txt", body: whole });
    assert.equal(retried.status, 201, JSON.stringify(retried.json));
    const back = await fetch(`${base}/_p99/api/files/${retried.json.id}`, { headers: { "x-p99-code": mary.secret } });
    assert.equal(back.status, 200);
    assert.equal(sha(Buffer.from(await back.arrayBuffer())), sha(whole));
    assert.equal((await thread(mary.secret, key)).issue.attachments, 1);
    assert.equal(rows("attachments", `client_uid = '${uid}' AND stored_at IS NOT NULL`), 1);
  });

  await check("story widget: a site not set up for P99 gets no loader, no panel and no filing, even with a valid code", async () => {
    const host = "unlisted.example";
    const headers = { "x-p99-code": mary.secret, "content-type": "application/json" };
    for (const path of ["/_p99/p99.js", "/_p99/panel.js?v=dev", "/_p99/capture.js?v=dev", "/_p99/p99.css?v=dev"]) {
      assert.equal((await raw("GET", path, { host })).status, 404, path);
    }
    assert.equal((await raw("GET", "/_p99/api/me", { host, headers })).status, 404);
    const filed = await raw("POST", "/_p99/api/issues", { host, headers, body: Buffer.from(JSON.stringify(issueBody({ title: "Filed on a site P99 doesn't know" }))) });
    assert.equal(filed.status, 404, filed.text);
    assert.equal(rows("items", "host = 'unlisted.example'"), 0);
    const crossed = await raw("POST", "/_p99/api/issues", { host: there, headers, body: Buffer.from(JSON.stringify(issueBody({ title: "Crossed to another host" }))) });
    assert.equal(crossed.status, 401, crossed.text);
    assert.equal(rows("items", "title = 'Crossed to another host'"), 0);
  });

  await check("story widget: another site's page can't file through a visitor's browser: no CORS grant, no code, nothing filed", async () => {
    const origin = "https://evil.example";
    const preflight = await raw("OPTIONS", "/_p99/api/issues", {
      host: here,
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-p99-code" },
    });
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
    assert.equal(preflight.headers["access-control-allow-headers"], undefined);
    assert.ok(preflight.status >= 400, String(preflight.status));
    const title = "Filed by a form on another site";
    const simple = await raw("POST", "/_p99/api/issues", {
      host: here,
      headers: { origin, "content-type": "text/plain" },
      body: Buffer.from(JSON.stringify(issueBody({ title }))),
    });
    assert.equal(simple.status, 401, simple.text);
    assert.equal(simple.headers["access-control-allow-origin"], undefined);
    const withCode = await raw("GET", "/_p99/api/me", { host: here, headers: { origin, "x-p99-code": mary.secret } });
    assert.equal(withCode.headers["access-control-allow-origin"], undefined);
    assert.equal(withCode.headers["access-control-allow-credentials"], undefined);
    assert.equal(rows("items", `title = '${title}'`), 0);
    const spoofed = await browse("POST", "/issues", mary.secret, issueBody({ page: { url: "https://evil.example/login?next=1", path: "/orders", title: "Orders" } }));
    assert.equal(spoofed.status, 201, JSON.stringify(spoofed.json));
    assert.equal(spoofed.json.page.url, `https://${here}/orders`);
  });

  await check("story widget: a host taken off P99 stops its widget at once: loader, panel and filing all answer 404, and its items stay", async () => {
    const host = "retired.example";
    assert.equal((await call("PUT", `/_p99/v1/hosts/${host}`, { body: { env: "production", config: {} } })).status, 200);
    const code = await mint("Mary Somerville", "mary@example.com", [host]);
    const headers = { "x-p99-code": code.secret, "content-type": "application/json" };
    assert.equal((await raw("GET", "/_p99/p99.js", { host })).status, 200);
    const filed = await raw("POST", "/_p99/api/issues", { host, headers, body: Buffer.from(JSON.stringify(issueBody({ title: "Filed before the site left" }))) });
    assert.equal(filed.status, 201, filed.text);
    assert.equal((await call("DELETE", `/_p99/v1/hosts/${host}`)).status, 204);
    assert.equal((await raw("GET", "/_p99/p99.js", { host })).status, 404);
    assert.equal((await raw("GET", "/_p99/panel.js?v=dev", { host })).status, 404);
    const late = await raw("POST", "/_p99/api/issues", { host, headers, body: Buffer.from(JSON.stringify(issueBody({ title: "Filed after the site left" }))) });
    assert.equal(late.status, 404, late.text);
    assert.equal(rows("items", "title = 'Filed after the site left'"), 0);
    assert.equal((await call("GET", `/_p99/v1/issues/${filed.json.key}?host=*`)).status, 200);
  });
}

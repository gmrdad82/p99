import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

export async function mergeFeedChecks({ base, call, browse, mint, check, issueBody, here, there, placement }) {
  const lin = await mint("Lin Chen", "lin@example.com", [here]);
  const ann = await mint("Ann Smith", "ann@example.com", [here]);
  const target = await browse("POST", "/issues", ann.secret, issueBody({ title: "Checkout freezes", body: "Ann's private steps" }));
  const source = await browse("POST", "/issues", lin.secret, issueBody({ title: "Checkout hangs" }));
  assert.equal(target.status, 201, JSON.stringify(target.json));
  assert.equal(source.status, 201, JSON.stringify(source.json));
  const elsewhere = await call("POST", `/_p99/v1/issues?host=${there}`, { body: issueBody({ title: "Elsewhere" }) });
  assert.equal(elsewhere.status, 201, JSON.stringify(elsewhere.json));

  await check("a merge across hosts a manager can't see is refused", async () => {
    const across = await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [elsewhere.json.key], into: target.json.key } });
    assert.equal(across.status, 404, JSON.stringify(across.json));
    const into = await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [source.json.key], into: elsewhere.json.key } });
    assert.equal(into.status, 404, JSON.stringify(into.json));
    assert.equal((await browse("POST", "/merge", lin.secret, { items: [source.json.key], into: target.json.key })).status, 403);
    assert.equal((await call("GET", `/_p99/v1/issues/${elsewhere.json.key}?host=${there}`)).json.issue.duplicate_of, null);
  });

  await check("a merged reporter follows the target's public thread and never sees its internal notes", async () => {
    const merged = await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [source.json.key], into: target.json.key } });
    assert.equal(merged.status, 200, JSON.stringify(merged.json));
    assert.deepEqual(merged.json.merged, [source.json.key]);
    const note = await call("POST", `/_p99/v1/issues/${target.json.key}/comments?host=${here}`, {
      body: { client_uid: randomUUID(), body: "Internal: the payment provider times out.", internal: true },
    });
    assert.equal(note.status, 201);
    const reply = await call("POST", `/_p99/v1/issues/${target.json.key}/comments?host=${here}`, {
      body: { client_uid: randomUUID(), body: "Fixed on our side." },
    });
    assert.equal(reply.status, 201);
    const seen = await browse("GET", `/issues/${target.json.key}`, lin.secret);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    assert.equal(seen.json.comments.some((cm) => cm.internal || cm.id === note.json.id), false);
    assert.ok(seen.json.comments.some((cm) => cm.id === reply.json.id));
    assert.equal(seen.json.events.some((ev) => ev.kind === "comment" && ev.detail.internal), false);
    assert.equal(seen.json.issue.reporter.email, null);
    assert.equal(seen.json.issue.body, "");
    assert.deepEqual(seen.json.issue.merged.map((m) => m.key), [source.json.key]);
    const mine = await browse("GET", "/issues?scope=mine&status=any", lin.secret);
    assert.ok(mine.json.issues.some((i) => i.key === target.json.key));
    const own = await browse("GET", `/issues/${source.json.key}`, lin.secret);
    assert.equal(own.json.issue.duplicate_of, target.json.key);
    assert.equal(own.json.issue.status, "done");
    assert.equal(own.json.issue.resolution, "duplicate");
    assert.ok(own.json.events.some((ev) => ev.kind === "merge" && ev.detail.into === target.json.key));
    const again = await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [source.json.key], into: target.json.key } });
    assert.deepEqual(again.json.unchanged, [source.json.key]);
    assert.equal(
      (await browse("PATCH", `/issues/${target.json.key}`, lin.secret, { status: "done", resolution: "abandoned" })).status,
      403,
    );
    const shown = await call("GET", `/_p99/v1/issues/${target.json.key}?host=${here}`);
    assert.deepEqual(shown.json.issue.merged.map((m) => m.key), [source.json.key]);
    assert.ok(shown.json.events.some((ev) => ev.kind === "merge"));
  });

  await check("the fixed feed is 404 when off and never carries private fields", async () => {
    const feed = (q = "") => fetch(`${base}/_p99/feed${q}`);
    assert.equal((await feed()).status, 404);
    const built = await call("POST", "/_p99/v1/builds", {
      body: {
        env: "production",
        sha: "abcdef0123456",
        branch: "main",
        version: "v9.9.9",
        dirty: false,
        items: [{ id: target.json.key, rel: "fixes", sha: "abcdef0123456", subject: "Fix the checkout" }],
      },
    });
    assert.equal(built.status, 204, JSON.stringify(built.json));
    const on = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: "production", config: { ...placement, feed: true } } });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    const atom = await feed();
    assert.equal(atom.status, 200);
    assert.match(atom.headers.get("content-type"), /^application\/atom\+xml/);
    assert.match(atom.headers.get("cache-control"), /max-age=\d+/);
    const text = await atom.text();
    assert.ok(text.includes(target.json.key));
    const jf = await feed("?format=json");
    assert.equal(jf.status, 200);
    const body = await jf.json();
    assert.equal(body.version, "https://jsonfeed.org/version/1.1");
    assert.ok(body.items.some((i) => i.id === target.json.key), JSON.stringify(body));
    for (const i of body.items) assert.deepEqual(Object.keys(i).sort(), ["content_text", "date_published", "id", "tags", "title"]);
    for (const raw of [text, JSON.stringify(body)]) {
      for (const secret of ["ann@example.com", "Ann Smith", "Ann's private steps", "Fixed on our side", "payment provider", "abcdef0", "/orders"]) {
        assert.equal(raw.includes(secret), false, secret);
      }
    }
    const off = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: "production", config: placement } });
    assert.equal(off.status, 200);
    assert.equal((await feed()).status, 404);
    assert.equal((await feed("?format=json")).status, 404);
  });
}

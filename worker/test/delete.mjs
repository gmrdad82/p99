import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

export async function deleteChecks({ base, call, browse, mint, check, issueBody, here, state, wrangler, root }) {
  const d1 = (command) => {
    const run = spawnSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", command], {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`d1 ${command} failed:\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(run.stdout)[0].results;
  };
  const bucket = join(state, "v3", "r2", "miniflare-R2BucketObject");
  const objects = (id) => {
    const keys = [];
    for (const name of readdirSync(bucket).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")) {
      const db = new DatabaseSync(join(bucket, name), { readOnly: true });
      for (const r of db.prepare("SELECT key FROM _mf_objects WHERE key LIKE ?").all(`issues/${id}/%`)) keys.push(r.key);
      db.close();
    }
    return keys.sort();
  };
  const put = (key, code, name, comment) =>
    fetch(`${base}/_p99/api/issues/${key}/attachments/${randomUUID()}?name=${name}&role=file${comment ? `&comment=${comment}` : ""}`, {
      method: "PUT",
      headers: { "x-p99-code": code, "content-type": "text/plain" },
      body: `${name} for ${key}\n`,
    });
  const ina = await mint("Ina Weber", "ina@example.com", [here]);
  const boss = await mint("Bo Lund", "bo@example.com", [here], true);
  const number = (key) => Number(key.split("-")[1]);

  const filed = await browse("POST", "/issues", ina.secret, issueBody({ title: "Delete me with my files" }));
  assert.equal(filed.status, 201, JSON.stringify(filed.json));
  const key = filed.json.key;
  const id = number(key);
  assert.equal((await put(key, ina.secret, "steps.txt")).status, 201);
  const reply = await browse("POST", `/issues/${key}/comments`, ina.secret, { client_uid: randomUUID(), body: "One more thing." });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  assert.equal((await put(key, ina.secret, "more.txt", reply.json.id)).status, 201);
  const note = await call("POST", `/_p99/v1/issues/${key}/comments?host=${here}`, {
    body: { client_uid: randomUUID(), body: "Internal: a trace.", internal: true },
  });
  assert.equal(note.status, 201);
  const trace = await call("PUT", `/_p99/v1/issues/${key}/attachments/${randomUUID()}?host=${here}&comment=${note.json.id}&name=trace.txt`, {
    raw: Buffer.from("trace\n"),
    type: "text/plain",
  });
  assert.equal(trace.status, 201, JSON.stringify(trace.json));
  d1(`INSERT INTO labels (name, color, created_at) VALUES ('doomed', '#57ab5a', '2026-01-01'); INSERT INTO item_labels (item_id, label_id) SELECT ${id}, id FROM labels WHERE name = 'doomed';`);
  const follower = await browse("POST", "/issues", ina.secret, issueBody({ title: "Same thing again" }));
  assert.equal(follower.status, 201);
  const merged = await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [follower.json.key], into: key } });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));

  await check("a reporter gets no delete: 403, and the item stays whole", async () => {
    const refused = await browse("DELETE", `/issues/${key}`, ina.secret);
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal((await browse("DELETE", "/issues/BUG-999999", ina.secret)).status, 403);
    assert.equal((await browse("GET", `/issues/${key}`, ina.secret)).status, 200);
    assert.equal(objects(id).length, 3);
  });

  await check("a delete that fails part-way leaves the item whole: one D1 batch is one transaction", async () => {
    d1(`CREATE TABLE test_pin (item_id INTEGER NOT NULL REFERENCES items (id)); INSERT INTO test_pin VALUES (${id});`);
    try {
      const failed = await call("DELETE", `/_p99/v1/issues/${key}?host=${here}`);
      assert.equal(failed.status, 500, JSON.stringify(failed.json));
    } finally {
      d1("DROP TABLE test_pin;");
    }
    const kept = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(kept.status, 200);
    assert.equal(kept.json.comments.length, 2);
    assert.equal(kept.json.attachments.length, 3);
    assert.equal(d1(`SELECT count(*) AS n FROM item_labels WHERE item_id = ${id}`)[0].n, 1);
    assert.equal(kept.json.issue.merged.length, 1);
    assert.equal((await call("GET", `/_p99/v1/issues/${follower.json.key}?host=${here}`)).json.issue.duplicate_of, key);
    assert.equal(d1(`SELECT count(*) AS n FROM deletions WHERE item_id = ${id}`)[0].n, 0);
    assert.equal(objects(id).length, 3);
  });

  await check("a manager's delete removes the item, its rows and every file in R2, and unlinks what was merged into it", async () => {
    const gone = await browse("DELETE", `/issues/${key}`, boss.secret);
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.deepEqual(gone.json, { key, comments: 2, files: 3, retrying: 0, unlinked: [follower.json.key] });
    assert.deepEqual(objects(id), []);
    const tables = ["items WHERE id", "comments WHERE item_id", "attachments WHERE item_id", "events WHERE item_id", "reads WHERE item_id", "item_labels WHERE item_id", "deletions WHERE item_id"];
    const left = d1(`SELECT ${tables.map((t) => `(SELECT count(*) FROM ${t} = ${id})`).join(" + ")} AS n`);
    assert.equal(left[0].n, 0);
    assert.equal((await call("GET", `/_p99/v1/issues/${key}?host=${here}`)).status, 404);
    assert.equal((await browse("GET", `/issues/${key}`, ina.secret)).status, 404);
    assert.equal((await call("DELETE", `/_p99/v1/issues/${key}?host=${here}`)).status, 404);
    const freed = await call("GET", `/_p99/v1/issues/${follower.json.key}?host=${here}`);
    assert.equal(freed.status, 200);
    assert.equal(freed.json.issue.duplicate_of, null);
    assert.equal(freed.json.issue.stage, "received");
    assert.equal(freed.json.issue.resolution, null);
  });

  await check("a deleted key is never handed out again", async () => {
    const last = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "The newest" }) });
    assert.equal(last.status, 201);
    assert.equal((await call("DELETE", `/_p99/v1/issues/${last.json.key}?host=${here}`)).status, 200);
    const next = await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "After it" }) });
    assert.equal(next.status, 201);
    assert.ok(number(next.json.key) > number(last.json.key), `${next.json.key} after ${last.json.key}`);
  });
}

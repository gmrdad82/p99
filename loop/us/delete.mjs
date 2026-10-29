import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADA, PNG, cast, ok, people, report, scratch, tag } from "../triage-lib.mjs";

const number = (key) => Number(key.split("-")[1]);

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-delete-001 the item and every file go and its key is never handed out again", async () => {
    const t = tag();
    await people(kit);
    const dir = scratch("delete");
    const notes = join(dir, `notes-${t}.txt`);
    const cart = join(dir, `cart-${t}.png`);
    writeFileSync(notes, "line one\n");
    writeFileSync(cart, PNG);

    const filed = await ok(kit, ["file", where.shop, "--kind", "bug", "--title", `Delete me ${t}`, "--body", "Filed by mistake.", "--attach", notes, "--attach", cart]);
    const key = /^(BUG-\d+) filed on/m.exec(filed.stdout)?.[1];
    assert.ok(key, filed.stdout);
    await ok(kit, ["comment", key, `Seen ${t}`]);

    const before = await kit.call("GET", `/_p99/v1/issues/${key}?host=${where.shop}`, { actor: ADA });
    assert.equal(before.status, 200, JSON.stringify(before.json));
    assert.equal(before.json.attachments.length, 2, JSON.stringify(before.json.attachments));
    const files = before.json.attachments.map((a) => a.id);
    for (const id of files) assert.equal((await kit.call("GET", `/_p99/v1/files/${id}?host=${where.shop}`, { actor: ADA })).status, 200);

    const gone = await ok(kit, ["delete", key, "--yes", "--host", where.shop]);
    assert.ok(gone.stdout.includes(`${key} deleted with 1 comment and 2 files`), gone.stdout);

    const after = await kit.call("GET", `/_p99/v1/issues/${key}?host=${where.shop}`, { actor: ADA });
    assert.equal(after.status, 404, JSON.stringify(after.json));
    for (const id of files) assert.equal((await kit.call("GET", `/_p99/v1/files/${id}?host=${where.shop}`, { actor: ADA })).status, 404, `file ${id} is still served`);
    const listed = await ok(kit, ["list", "--status", "any", "-q", t]);
    assert.ok(!listed.stdout.includes(key), listed.stdout);

    const next = await report(kit, where.shop, `Filed after ${t}`);
    assert.ok(number(next.key) > number(key), `${next.key} reuses a number at or below the deleted ${key}`);
  });
}

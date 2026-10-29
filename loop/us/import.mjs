import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ADA, PNG, cast, ok, report, scratch, tag } from "../triage-lib.mjs";

const grace = { email: "grace@example.com", name: "Grace Hopper", agent: false };
const AT = "2025-03-01T10:00:00Z";

const item = (key, title, extra = {}) => ({ type: "item", key, kind: "bug", title, body: "", status: "inbox", reporter: grace, created_at: AT, ...extra });
const comment = (key, uid, body) => ({ type: "comment", item: key, uid, author: grace, body, created_at: "2025-03-02T09:00:00Z" });
const receipt = (key, uid, on) => ({
  type: "attachment",
  item: key,
  uid,
  comment: on,
  role: "file",
  mark: null,
  name: null,
  content_type: "image/png",
  file: "files/receipt.png",
  internal: false,
  created_at: "2025-03-02T09:00:00Z",
});
const row = (kind, fresh, existing, conflicts) => `  ${kind.padEnd(11)} ${String(fresh).padStart(8)} ${String(existing).padStart(9)} ${String(conflicts).padStart(10)}`;

function bundle(dir, lines, files = {}) {
  mkdirSync(join(dir, "files"), { recursive: true });
  writeFileSync(join(dir, "bundle.jsonl"), `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`);
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
}

let last = 7000;
const numbers = () => {
  last += 10;
  return last + Math.floor(Math.random() * 5);
};

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);
  const run = (dir, extra = []) => kit.p99(["import", dir, "--host", where.shop, ...extra]);
  const readable = async (key) => kit.call("GET", `/_p99/v1/issues/${key}?host=${where.shop}`, { actor: ADA });

  await check("us-import-001 an import keeps keys text and files and new items number above them", async () => {
    const t = tag();
    const base = numbers();
    const [old, recent] = [`BUG-${base}`, `BUG-${base + 1}`];
    const dir = scratch("import");
    bundle(
      dir,
      [
        item(old, "The café menu shows the wrong price", { body: "The crème brûlée costs 12,50 € on the menu and 13 € at checkout.", status: "resolved", closed_at: "2025-03-04T08:00:00Z" }),
        item(recent, `Menu typo ${t}`),
        comment(recent, `c-${t}`, `Confirmed, the menu reads an old price list ${t}.`),
        receipt(recent, `f-${t}`, `c-${t}`),
      ],
      { "files/receipt.png": PNG },
    );

    const out = await run(dir);
    assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
    for (const line of [row("item", 2, 0, 0), row("comment", 1, 0, 0), row("attachment", 1, 0, 0), "  files uploaded: 1"]) {
      assert.ok(out.stdout.split("\n").includes(line), `${line}\n${out.stdout}`);
    }

    const kept = await ok(kit, ["show", old]);
    assert.ok(kept.stdout.includes("The café menu shows the wrong price") && kept.stdout.includes("The crème brûlée costs 12,50 €"), kept.stdout);
    const thread = await readable(recent);
    assert.equal(thread.status, 200, JSON.stringify(thread.json));
    assert.equal(thread.json.issue.key, recent);
    assert.ok(thread.json.comments.some((c) => c.body === `Confirmed, the menu reads an old price list ${t}.`));
    assert.equal(thread.json.attachments.length, 1);
    assert.equal(thread.json.attachments[0].bytes, PNG.length);
    const file = await kit.call("GET", `/_p99/v1/files/${thread.json.attachments[0].id}?host=${where.shop}`, { actor: ADA });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.response.arrayBuffer()), PNG);

    const next = await report(kit, where.shop, `Filed after the import ${t}`);
    assert.ok(Number(next.key.split("-")[1]) > base + 1, `${next.key} numbers above the imported ${recent}`);
  });

  await check("us-import-001 a dry run uploads nothing", async () => {
    const t = tag();
    const base = numbers();
    const key = `BUG-${base}`;
    const dir = scratch("import-dry");
    bundle(dir, [item(key, `Dry run ${t}`), comment(key, `c-${t}`, "Seen."), receipt(key, `f-${t}`, `c-${t}`)], { "files/receipt.png": PNG });

    const out = await run(dir, ["--dry-run"]);
    assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
    assert.ok(out.stdout.includes("nothing written (dry run)"), out.stdout);
    assert.ok(!out.stdout.includes("files uploaded"), out.stdout);
    assert.equal((await readable(key)).status, 404, "the dry run wrote an item");
  });

  await check("us-import-001 a resumed import sends only what is missing", async () => {
    const t = tag();
    const base = numbers();
    const key = `BUG-${base}`;
    const dir = scratch("import-resume");
    const lines = [item(key, `Resume ${t}`), comment(key, `c-${t}`, "Seen.")];

    bundle(dir, lines);
    const first = await run(dir);
    assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
    assert.ok(first.stdout.split("\n").includes(row("item", 1, 0, 0)), first.stdout);

    bundle(dir, [...lines, receipt(key, `f-${t}`, `c-${t}`)], { "files/receipt.png": PNG });
    const second = await run(dir);
    assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
    const shown = second.stdout.split("\n");
    for (const line of [row("item", 0, 1, 0), row("comment", 0, 1, 0), row("attachment", 1, 0, 0), "  files uploaded: 1"]) {
      assert.ok(shown.includes(line), `${line}\n${second.stdout}`);
    }

    const third = await run(dir);
    assert.equal(third.code, 0, `${third.stdout}\n${third.stderr}`);
    const again = third.stdout.split("\n");
    assert.ok(again.includes(row("attachment", 0, 1, 0)) && again.includes("  files uploaded: 0"), third.stdout);
    assert.equal((await readable(key)).json.attachments.length, 1, "the file landed once");
  });

  await check("us-import-001 a malformed bundle is refused whole and nothing is sent", async () => {
    const t = tag();
    const base = numbers();
    const key = `BUG-${base}`;
    const dir = scratch("import-bad");
    bundle(dir, [item(key, `Fine ${t}`), "{not json", item(key, `Again ${t}`)]);

    const out = await run(dir);
    assert.equal(out.code, 1, `${out.stdout}\n${out.stderr}`);
    assert.equal(out.stdout, "");
    assert.ok(/has 2 problems; nothing was sent/.test(out.stderr), out.stderr);
    assert.ok(out.stderr.includes("line 2: not JSON: "), out.stderr);
    assert.ok(out.stderr.includes(`line 3: item: number ${base} is already taken on line 1`), out.stderr);
    assert.equal((await readable(key)).status, 404, "the first item was sent although the bundle was bad");
  });
}

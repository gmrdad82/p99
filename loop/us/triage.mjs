import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADA,
  LANE_NAMES,
  card,
  cast,
  hasKey,
  header,
  laneRule,
  mailTo,
  mailed,
  ok,
  people,
  pickerOptions,
  picking,
  report,
  scratch,
  tag,
  threadOf,
  waitingCount,
} from "../triage-lib.mjs";

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-triage-001 p99 list and show print the open items and a whole thread", async () => {
    const t = tag();
    const first = await report(kit, where.shop, `Cart total ${t} first`);
    const second = await report(kit, where.blog, `Cart total ${t} second`);

    const listed = await ok(kit, ["list", "-q", t]);
    const rows = listed.stdout.split("\n").filter((line) => line.includes(t));
    assert.equal(rows.length, 2, listed.stdout);
    assert.ok(rows[0].includes(second.key) && rows[0].includes(where.blog), `the newest comes first:\n${listed.stdout}`);
    assert.ok(rows[1].includes(first.key) && rows[1].includes(where.shop), listed.stdout);

    const comment = await ok(kit, ["comment", first.key, `Looking ${t}`]);
    assert.ok(comment.stdout.includes(`commented on ${first.key}`), comment.stdout);
    const shown = await ok(kit, ["show", first.key]);
    const at = (text) => shown.stdout.indexOf(text);
    for (const text of [first.key, `Cart total ${t} first`, "reported by Grace Hopper", "Open an order and change its quantity.", `Looking ${t}`]) {
      assert.ok(at(text) >= 0, `${text} is missing from:\n${shown.stdout}`);
    }
    assert.ok(at(`Cart total ${t} first`) < at("Open an order") && at("Open an order") < at(`Looking ${t}`), shown.stdout);
  });

  await check("us-triage-002 adas reply in the tui reaches graces panel and her mail", async () => {
    const t = tag();
    const { grace } = await people(kit);
    const filed = await report(kit, where.shop, `Cart total ${t}`);
    const reply = `Thanks${t}`;

    const screen = await kit.tui(`/ ${t} enter enter r ${reply} enter`);
    assert.ok(screen.includes(`Replied on ${filed.key}`), screen);

    const panel = await kit.browse("GET", `/issues/${filed.key}`, grace);
    assert.equal(panel.status, 200, JSON.stringify(panel.json));
    const said = panel.json.comments.find((c) => c.body === reply);
    assert.ok(said, "Grace's panel shows the reply");
    assert.equal(said.internal, false);
    assert.equal(said.author.name, "Ada Lovelace");

    const mail = await mailTo(kit, "grace@example.com", reply);
    assert.ok(`${mail.subject ?? ""}${mail.text ?? ""}${mail.html ?? ""}`.includes(reply));
  });

  await check("us-triage-002 an internal note reaches mary and never grace", async () => {
    const t = tag();
    const { mary, grace } = await people(kit);
    const filed = await report(kit, where.shop, `Cart total ${t}`);
    const note = `Note${t}`;
    const answer = `Public${t}`;

    const screen = await kit.tui(`/ ${t} enter enter i r ${note} enter`);
    assert.ok(screen.includes(`Internal note added on ${filed.key}`), screen);

    const owners = await kit.browse("GET", `/issues/${filed.key}`, mary);
    assert.equal(owners.status, 200, JSON.stringify(owners.json));
    const kept = owners.json.comments.find((c) => c.body === note);
    assert.ok(kept, "Mary reads the note");
    assert.equal(kept.internal, true);

    const panel = await kit.browse("GET", `/issues/${filed.key}`, grace);
    assert.equal(panel.status, 200, JSON.stringify(panel.json));
    assert.ok(!panel.json.comments.some((c) => c.body === note), "Grace's panel never carries the note");

    await ok(kit, ["comment", filed.key, answer]);
    await mailTo(kit, "grace@example.com", answer);
    assert.equal(await mailed(kit, "grace@example.com", note), false, "the note was mailed to Grace");
  });

  await check("us-triage-002 p99 comment reads stdin and ties its files to the comment", async () => {
    const t = tag();
    const filed = await report(kit, where.shop, `Cart total ${t}`);
    const log = join(scratch("comment"), `trace-${t}.log`);
    writeFileSync(log, "boom");

    const out = await ok(kit, ["comment", filed.key, "-", "--internal", "--attach", log, "--host", where.shop], { input: `Seen it twice ${t}.\n` });
    assert.ok(out.stdout.includes(`commented on ${filed.key}`), out.stdout);

    const thread = await threadOf(kit, filed.key, where.shop);
    const said = thread.comments.find((c) => c.body.startsWith(`Seen it twice ${t}`));
    assert.ok(said, JSON.stringify(thread.comments));
    assert.equal(said.internal, true);
    assert.equal(thread.attachments.length, 1, JSON.stringify(thread.attachments));
    assert.equal(thread.attachments[0].comment_id, said.id);
    assert.equal(thread.attachments[0].name, `trace-${t}.log`);
    assert.deepEqual(said.attachments, [thread.attachments[0].id]);
  });

  await check("us-triage-003 a move from the thread says where the item went and grace sees it", async () => {
    const t = tag();
    const { grace } = await people(kit);
    const filed = await report(kit, where.shop, `Move me ${t}`);

    const screen = await kit.tui(`/ ${t} enter enter m down down enter`);
    assert.ok(screen.includes(`${filed.key} moved to In progress`), screen);

    const thread = await threadOf(kit, filed.key);
    assert.equal(thread.issue.label, "In progress");
    const moves = thread.events.filter((e) => e.kind === "label");
    assert.equal(moves.at(-1).detail.to, "In progress");
    assert.equal(moves.at(-1).actor, ADA.email);

    const panel = await kit.browse("GET", `/issues/${filed.key}`, grace);
    assert.equal(panel.status, 200, JSON.stringify(panel.json));
    assert.equal(panel.json.issue.stage, "in_progress");
  });

  await check("us-triage-003 ada assigns by username and a stranger is refused", async () => {
    const t = tag();
    await people(kit);
    const filed = await report(kit, where.shop, `Assign me ${t}`);
    const assignee = async () => (await threadOf(kit, filed.key)).issue.assignee?.username ?? null;

    await ok(kit, ["assign", filed.key, "me"]);
    const mine = await assignee();
    assert.ok(mine, "Ada is assigned");

    const members = await kit.call("GET", `/_p99/v1/people?host=${where.shop}`, { actor: ADA });
    const mary = members.json.people.find((p) => p.username.startsWith("mary"))?.username;
    assert.ok(mary, JSON.stringify(members.json));
    await ok(kit, ["assign", filed.key, `@${mary}`]);
    assert.equal(await assignee(), mary);

    const stranger = await kit.p99(["assign", filed.key, "@nobody.nowhere"]);
    assert.equal(stranger.code, 1, stranger.stdout);
    assert.ok(stranger.stderr.includes("is not a member"), stranger.stderr);
    assert.equal(await assignee(), mary, "a refused assignment changes nothing");

    await ok(kit, ["assign", filed.key, "--none"]);
    assert.equal(await assignee(), null);
    const screen = await kit.tui(`/ ${t} enter enter a down enter`);
    assert.ok(screen.includes("assigned to @"), screen);
    assert.equal(await assignee(), mine);
  });

  await check("us-triage-003 a closed item reopens through a label", async () => {
    const t = tag();
    const dropped = await report(kit, where.shop, `Drop me ${t}`);
    const repeated = await report(kit, where.shop, `Repeat me ${t}`);
    const stage = async (key) => (await threadOf(kit, key)).issue;

    await ok(kit, ["status", dropped.key, "abandoned"]);
    let issue = await stage(dropped.key);
    assert.equal(issue.resolution, "abandoned");
    assert.equal(issue.stage, "dropped");
    const closed = await ok(kit, ["list", "--status", "closed", "-q", t]);
    assert.ok(closed.stdout.includes(dropped.key), closed.stdout);
    await ok(kit, ["status", dropped.key, "New"]);
    issue = await stage(dropped.key);
    assert.ok(!issue.resolution, JSON.stringify(issue));
    assert.equal(issue.stage, "received");
    const open = await ok(kit, ["list", "-q", t]);
    assert.ok(open.stdout.includes(dropped.key), open.stdout);

    await ok(kit, ["status", repeated.key, "duplicate", "--duplicate-of", dropped.key]);
    issue = await stage(repeated.key);
    assert.equal(issue.stage, "duplicate");
    assert.equal(issue.duplicate_of, dropped.key);
    await ok(kit, ["status", repeated.key, "New"]);
    issue = await stage(repeated.key);
    assert.ok(!issue.resolution, JSON.stringify(issue));
  });

  await check("us-triage-003 an edit and an assignment at once both stick", async () => {
    const t = tag();
    await people(kit);
    const filed = await report(kit, where.shop, `Race me ${t}`);
    const title = `Raced ${t}`;

    const [edit, assign] = await Promise.all([kit.p99(["edit", filed.key, "--title", title]), kit.p99(["assign", filed.key, "me"])]);
    assert.equal(edit.code, 0, edit.stderr);
    assert.equal(assign.code, 0, assign.stderr);
    const issue = (await threadOf(kit, filed.key)).issue;
    assert.equal(issue.title, title);
    assert.ok(issue.assignee?.username, "the assignment stuck");
  });

  await check("us-triage-004 p narrows the inbox to the chosen projects and esc clears it", async () => {
    const t = tag();
    const shopItem = await report(kit, where.shop, `Cart total ${t}`);
    const blogItem = await report(kit, where.blog, `Post draft ${t}`);
    const opsCard = await card(kit, where.ops, `Ops note ${t}`);

    const everything = await kit.tui("");
    for (const item of [shopItem, blogItem, opsCard]) assert.ok(hasKey(everything, item.key), `${item.key} is missing:\n${everything}`);

    const options = pickerOptions(await kit.tui("p"), "Projects");
    assert.ok(options, "p opens the project picker");
    assert.equal(options[0], "All projects");
    for (const name of ["Shop", "Blog", "Ops"]) assert.ok(options.includes(name), `${name} is missing from ${options}`);

    const shop = await kit.tui(picking("p", options.indexOf("Shop")));
    assert.ok(hasKey(shop, shopItem.key), shop);
    assert.ok(!hasKey(shop, blogItem.key) && !hasKey(shop, opsCard.key), shop);
    assert.ok(shop.includes("in Shop"), `the status line names the filter:\n${shop}`);

    const two = await kit.tui(`${picking("p", options.indexOf("Blog"))} ${picking("p", options.indexOf("Ops"))}`);
    assert.ok(hasKey(two, blogItem.key) && hasKey(two, opsCard.key) && !hasKey(two, shopItem.key), two);

    const cleared = await kit.tui(`${picking("p", options.indexOf("Shop"))} esc`);
    for (const item of [shopItem, blogItem, opsCard]) assert.ok(hasKey(cleared, item.key), `${item.key} is missing after esc:\n${cleared}`);
    assert.ok(!cleared.includes("in Shop"), cleared);
  });

  await check("us-triage-004 the inbox search status and host filters each really filter", async () => {
    const t = tag();
    const u = tag();
    const a = await report(kit, where.shop, `Cart total ${t}`);
    const b = await report(kit, where.blog, `Post draft ${t}`);
    const c = await report(kit, where.shop, `Crème brûlée ${t}`);
    const d = await report(kit, where.blog, `Post second ${t}`);
    const other = await report(kit, where.shop, `Unrelated ${u}`);

    const searched = await kit.tui(`/ ${t}`);
    for (const item of [a, b, c, d]) assert.ok(hasKey(searched, item.key), `${item.key} is missing:\n${searched}`);
    assert.ok(!hasKey(searched, other.key), `the search kept an item that does not match:\n${searched}`);
    assert.ok(searched.includes("4 of"), searched);

    const accents = await kit.tui("/ creme");
    assert.ok(hasKey(accents, c.key), accents);
    assert.ok(!hasKey(accents, a.key) && !hasKey(accents, other.key), accents);

    await ok(kit, ["status", b.key, "abandoned"]);
    const open = await kit.tui(`/ ${t}`);
    assert.ok(hasKey(open, a.key) && !hasKey(open, b.key), open);
    const closed = await kit.tui(`s / ${t}`);
    assert.ok(hasKey(closed, b.key) && !hasKey(closed, a.key), closed);

    const hosts = pickerOptions(await kit.tui("h"), "Host");
    assert.ok(hosts, "h opens the host picker");
    assert.equal(hosts[0], "All hosts");
    assert.ok(hosts.includes(where.blog) && hosts.includes(where.shop), `${hosts}`);
    const onBlog = await kit.tui(picking("h", hosts.indexOf(where.blog)));
    assert.ok(hasKey(onBlog, d.key), onBlog);
    assert.ok(!hasKey(onBlog, a.key) && !hasKey(onBlog, c.key) && !hasKey(onBlog, other.key), onBlog);
  });

  await check("us-triage-004 the board shows seven lanes at 80 and 120 columns and p narrows it", async () => {
    const t = tag();
    const shopItem = await card(kit, "Shop", `Cart total ${t}`);
    const blogItem = await card(kit, "Blog", `Post draft ${t}`);

    for (const size of ["80x24", "120x34"]) {
      const board = await kit.tui("tab", { size });
      assert.equal(laneRule(board).length, 7, `${size}:\n${board}`);
    }
    const wide = await kit.tui("tab", { size: "120x34" });
    const lanes = wide.split("\n").find((line) => line.includes("Planned"));
    assert.ok(lanes, wide);
    let from = 0;
    for (const name of LANE_NAMES) {
      const at = lanes.indexOf(name, from);
      assert.ok(at >= 0, `${name} is missing or out of order in ${lanes}`);
      from = at + name.length;
    }
    assert.ok(hasKey(wide, shopItem.key) && hasKey(wide, blogItem.key), wide);

    const options = pickerOptions(await kit.tui("tab p", { size: "120x34" }), "Projects");
    assert.ok(options && options.includes("Shop"), `${options}`);
    const narrowed = await kit.tui(`tab ${picking("p", options.indexOf("Shop"))}`, { size: "120x34" });
    assert.equal(laneRule(narrowed).length, 7, narrowed);
    assert.ok(hasKey(narrowed, shopItem.key) && !hasKey(narrowed, blogItem.key), narrowed);
    assert.ok(narrowed.includes("in Shop"), narrowed);
  });

  await check("us-triage-004 the codes list and the needs you list filter too", async () => {
    const t = tag();
    await kit.mint("Grace Hopper", "grace@example.com", where.shopHosts, false);
    await kit.mint("Mary Jackson", "mary@example.com", where.shopHosts, true);
    const codes = await kit.tui("tab tab");
    assert.ok(codes.includes("grace@example.com") && codes.includes("mary@example.com"), codes);
    const mary = await kit.tui("tab tab / mary");
    assert.ok(mary.includes("mary@example.com") && !mary.includes("grace@example.com"), mary);
    const counted = /(\d+) of (\d+) codes/.exec(mary);
    assert.ok(counted && Number(counted[1]) < Number(counted[2]), mary);

    const waiting = await card(kit, `Wait ${t}`, `Look at the clip ${t}`);
    const elsewhere = await card(kit, "Shop", `Look at the cart ${t}`);
    for (const key of [waiting.key, elsewhere.key]) await ok(kit, ["card", "status", key, "needs-you", "--note", `Please look ${t}`, "--agent"]);

    const list = await kit.tui("w");
    assert.ok(list.includes("Needs you ·"), list);
    assert.ok(hasKey(list, waiting.key) && hasKey(list, elsewhere.key), list);

    const options = pickerOptions(await kit.tui("p"), "Projects");
    assert.ok(options && options.includes(`Wait ${t}`), `${options}`);
    const narrowed = await kit.tui(`${picking("p", options.indexOf(`Wait ${t}`))} w`);
    assert.ok(hasKey(narrowed, waiting.key) && !hasKey(narrowed, elsewhere.key), narrowed);
    assert.equal(waitingCount(narrowed), 1, header(narrowed));
  });
}

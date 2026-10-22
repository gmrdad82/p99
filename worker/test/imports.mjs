import assert from "node:assert/strict";

const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const GRACE = { email: "grace@example.com", name: "Grace Hopper", agent: false, manager: true };
const AT = "2025-05-01T10:00:00Z";

function item(key, overrides = {}) {
  return {
    type: "item",
    key,
    kind: "bug",
    title: `Import checks: ${key}`,
    body: "",
    status: "inbox",
    duplicate_of: null,
    reporter: ADA,
    assignee: null,
    env: null,
    page: null,
    context: {},
    marks: [],
    created_at: AT,
    updated_at: null,
    closed_at: null,
    ...overrides,
  };
}

const comment = (key, uid, overrides = {}) => ({
  type: "comment",
  item: key,
  uid,
  author: GRACE,
  body: "Seen on the café page.",
  internal: false,
  created_at: AT,
  ...overrides,
});

const event = (overrides = {}) => ({
  type: "event",
  item: "BUG-9801",
  actor: { email: GRACE.email, agent: false },
  kind: "status",
  detail: { from: "inbox", to: "doing" },
  internal: false,
  at: AT,
  ...overrides,
});

export async function importChecks({ call, check, here, there }) {
  const post = (records, { host = here, dry = true, keyId } = {}) =>
    call("POST", `/_p99/v1/import?host=${host}&dry_run=${dry ? 1 : 0}`, { body: records, keyId });
  const finish = (body, host = here) => call("POST", `/_p99/v1/import/finish?host=${host}`, { body });
  const put = (uid, params, { raw = Buffer.from("receipt: 12,50 €\n"), type = "text/plain", host = here } = {}) =>
    call("PUT", `/_p99/v1/import/attachments/${uid}?host=${host}&${new URLSearchParams(params)}`, { raw, type });
  const refused = async (records, status, message) => {
    const said = await post(records);
    assert.equal(said.status, status, `${JSON.stringify(records).slice(0, 200)} -> ${JSON.stringify(said.json)}`);
    assert.equal(said.json.message, message);
  };

  await check("import: every rejected event shape answers 400 or 413 with its record number and one plain reason", async () => {
    const base = item("BUG-9801");
    const shapes = [
      [event({ item: undefined }), 400, "record 2 (event): item must be a key such as BUG-3"],
      [event({ item: "BUG-x" }), 400, "record 2 (event): item must be a key such as BUG-3"],
      [event({ item: { key: "BUG-9801" } }), 400, "record 2 (event): item must be a key such as BUG-3"],
      [event({ kind: undefined }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: 7 }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: "Status" }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: "_status" }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: "status-change" }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: "s".repeat(41) }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ kind: "" }), 400, "record 2 (event): kind must be 1 to 40 lowercase letters or underscores"],
      [event({ actor: "grace@example.com" }), 400, "record 2 (event): actor must be an object or null"],
      [event({ actor: 7 }), 400, "record 2 (event): actor must be an object or null"],
      [event({ actor: { email: "grace" } }), 400, "record 2 (event): actor.email must be an e-mail address"],
      [event({ actor: { email: 7 } }), 400, "record 2 (event): actor.email must be an e-mail address"],
      [event({ actor: { email: GRACE.email, agent: "yes" } }), 400, "record 2 (event): actor.agent must be a boolean"],
      [event({ actor: { email: GRACE.email, agent: true, via: 42 } }), 400, "record 2 (event): actor.via must be a string"],
      [event({ detail: "moved" }), 400, "record 2 (event): detail must be an object"],
      [event({ detail: 3 }), 400, "record 2 (event): detail must be an object"],
      [event({ detail: { note: "x".repeat(64 * 1024) } }), 413, "record 2 (event): detail is larger than 64 KB"],
      [event({ internal: "no" }), 400, "record 2 (event): internal must be a boolean"],
      [event({ at: undefined }), 400, "record 2 (event): at must be a date and time"],
      [event({ at: "yesterday" }), 400, "record 2 (event): at must be a date and time"],
      [event({ at: 1746093600000 }), 400, "record 2 (event): at must be a date and time"],
      [event({ at: `2025-05-01T10:00:00Z${" ".repeat(60)}` }), 400, "record 2 (event): at must be a date and time"],
    ];
    for (const [shape, status, message] of shapes) await refused([base, shape], status, message);
    const fine = await post([base, event(), event({ actor: null, kind: "landed", detail: undefined }), event({ actor: { agent: true, via: "pci" }, kind: "label" })]);
    assert.equal(fine.status, 200, JSON.stringify(fine.json));
    assert.deepEqual(fine.json.counts.event, { new: 3, existing: 0, conflicts: [] });
  });

  await check("import: an event lands once; the same item, kind and time is counted existing, and its actor, label and detail are kept", async () => {
    const records = [
      item("BUG-9802"),
      event({ item: "BUG-9802", actor: { email: "GRACE@Example.com", agent: true, via: "pci" }, kind: "label", detail: { label: "Café" } }),
      event({ item: "BUG-9802", actor: null, kind: "status", at: "2025-05-01T11:00:00+01:00" }),
    ];
    const first = await post(records, { dry: false });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual(first.json.counts.event, { new: 2, existing: 0, conflicts: [] });
    const again = await post(records, { dry: false });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual(again.json.counts.event, { new: 0, existing: 2, conflicts: [] });
    assert.deepEqual(again.json.counts.item, { new: 0, existing: 1, conflicts: [] });
    const thread = await call("GET", `/_p99/v1/issues/BUG-9802?host=${here}`);
    assert.equal(thread.status, 200, JSON.stringify(thread.json));
    const label = thread.json.events.find((e) => e.kind === "label");
    assert.ok(label, JSON.stringify(thread.json.events));
    assert.deepEqual([label.agent, label.via], [true, "pci"]);
    const status = thread.json.events.filter((e) => e.kind === "status" && e.at.startsWith("2025-05-01T10:00:00"));
    assert.equal(status.length, 1, JSON.stringify(thread.json.events));
  });

  await check("import: every other record type refuses its bad shapes with its record number", async () => {
    const base = item("BUG-9803");
    const shapes = [
      [null, 400, "record 2: type must be one of item, comment, attachment, event, landing, read, manager"],
      [["item"], 400, "record 2: type must be one of item, comment, attachment, event, landing, read, manager"],
      ["item", 400, "record 2: type must be one of item, comment, attachment, event, landing, read, manager"],
      [{ type: "ticket" }, 400, "record 2 (ticket): type must be one of item, comment, attachment, event, landing, read, manager"],
      [{ type: "manager", email: "grace" }, 400, "record 2 (manager): email must be an e-mail address"],
      [comment("BUG-9803", "bad uid"), 400, "record 2 (comment): uid must be 1 to 64 letters, digits, dots, dashes or underscores"],
      [comment("BUG-9803", "u".repeat(65)), 400, "record 2 (comment): uid must be 1 to 64 letters, digits, dots, dashes or underscores"],
      [comment("BUG-9803", "c-1", { body: "   " }), 400, "record 2 (comment): body must be 1 to 20000 characters"],
      [comment("BUG-9803", "c-1", { body: 7 }), 400, "record 2 (comment): body must be 1 to 20000 characters"],
      [comment("BUG-9803", "c-1", { author: undefined }), 400, "record 2 (comment): author must be an object with an email"],
      [comment("BUG-9803", "c-1", { author: { name: "Grace Hopper" } }), 400, "record 2 (comment): author.email must be an e-mail address"],
      [comment("BUG-9803", "c-1", { author: { ...GRACE, name: "n".repeat(201) } }), 400, "record 2 (comment): author.name must be at most 200 characters"],
      [comment("BUG-9803", "c-1", { author: { ...GRACE, manager: "yes" } }), 400, "record 2 (comment): author.manager must be a boolean"],
      [comment("BUG-9803", "c-1", { internal: 1 }), 400, "record 2 (comment): internal must be a boolean"],
      [comment("BUG-9803", "c-1", { created_at: "soon" }), 400, "record 2 (comment): created_at must be a date and time"],
      [{ type: "attachment", item: "BUG-9803", uid: "a 1" }, 400, "record 2 (attachment): uid must be 1 to 64 letters, digits, dots, dashes or underscores"],
      [{ type: "attachment", item: "BUG-9803", uid: "a-1", comment: "c 1" }, 400, "record 2 (attachment): uid must be 1 to 64 letters, digits, dots, dashes or underscores"],
      [{ type: "attachment", item: 7.5, uid: "a-1" }, 400, "record 2 (attachment): item must be a key such as BUG-3"],
      [{ type: "landing", item: "BUG-9803", env: "Prod!", sha: "0123abc", at: AT }, 400, "record 2 (landing): env must name an environment"],
      [{ type: "landing", item: "BUG-9803", env: "production", sha: "0123", at: AT }, 400, "record 2 (landing): sha must be a hex commit id"],
      [{ type: "landing", item: "BUG-9803", env: "production", sha: "0123abz", at: AT }, 400, "record 2 (landing): sha must be a hex commit id"],
      [{ type: "landing", item: "BUG-9803", env: "production", sha: "0123abc" }, 400, "record 2 (landing): at must be a date and time"],
      [{ type: "read", item: "BUG-9803", email: "ada", at: AT }, 400, "record 2 (read): email must be an e-mail address"],
      [{ type: "read", item: "BUG-9803", email: ADA.email }, 400, "record 2 (read): at must be a date and time"],
    ];
    for (const [shape, status, message] of shapes) await refused([base, shape], status, message);
  });

  await check("import: every rejected item shape answers with its record number and one plain reason", async () => {
    const shapes = [
      [{ key: "BUG" }, 400, "record 1 (item): key must be a key such as BUG-3"],
      [{ key: "BUG-0" }, 400, "record 1 (item): key must be a key such as BUG-3"],
      [{ key: 9804 }, 400, "record 1 (item): key must be a key such as BUG-3"],
      [{ kind: "epic" }, 400, "record 1 (item): kind must be bug, feature, improvement, question or task"],
      [{ kind: "task" }, 400, "record 1 (item): a task is keyed TASK-<number>"],
      [{ status: "triaged" }, 400, "record 1 (item): status is not known"],
      [{ title: "  " }, 400, "record 1 (item): title must be 1 to 200 characters"],
      [{ env: "Prod!" }, 400, "record 1 (item): env must name an environment"],
      [{ context: [] }, 400, "record 1 (item): context must be an object"],
      [{ context: { big: "x".repeat(64 * 1024) } }, 413, "record 1 (item): context is larger than 64 KB"],
      [{ marks: [{ rect: {} }] }, 400, "record 1 (item): marks must be at most 10 marks with rect, viewport and elements"],
      [{ created_at: undefined }, 400, "record 1 (item): created_at must be a date and time"],
      [{ updated_at: "later" }, 400, "record 1 (item): updated_at must be a date and time"],
      [{ status: "done", closed_at: "never" }, 400, "record 1 (item): closed_at must be a date and time"],
      [{ reporter: "ada@example.com" }, 400, "record 1 (item): reporter must be an object with an email"],
      [{ reporter: { ...ADA, agent: "no" } }, 400, "record 1 (item): reporter.agent must be a boolean"],
      [{ assignee: "grace" }, 400, "record 1 (item): assignee must be an e-mail address"],
      [{ duplicate_of: "BUG-x" }, 400, "record 1 (item): duplicate_of must be a key such as BUG-3"],
      [{ page: "https://example.com/" }, 400, "record 1 (item): page must be an object"],
      [{ page: { url: "ftp://example.com/", path: "/", title: "" } }, 400, "record 1 (item): page must have an http(s) url, a path starting with / and a title of at most 300 characters"],
    ];
    for (const [overrides, status, message] of shapes) {
      const said = await post([item("BUG-9804", overrides)]);
      assert.equal(said.status, status, `${JSON.stringify(overrides).slice(0, 120)} -> ${JSON.stringify(said.json)}`);
      assert.equal(said.json.message, message);
    }
    const ok = await post([item("BUG-9804", { page: { url: "https://example.com/menu?x=1" } })]);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  });

  await check("import: the route refuses a missing or unlisted host, another key, a body that is not an array and more than 500 records", async () => {
    const records = [item("BUG-9805")];
    for (const path of ["/_p99/v1/import", "/_p99/v1/import?host=nowhere.example", "/_p99/v1/import/finish?host=nowhere.example"]) {
      const said = await call("POST", path, { body: records });
      assert.equal(said.status, 400, `${path} -> ${JSON.stringify(said.json)}`);
      assert.equal(said.json.message, "host must name a listed host");
    }
    for (const path of [`/_p99/v1/import?host=${here}`, `/_p99/v1/import/finish?host=${here}`]) {
      const said = await call("POST", path, { body: records, keyId: "test" });
      assert.equal(said.status, 403, JSON.stringify(said.json));
      assert.equal(said.json.message, "only the account's key imports");
    }
    const put403 = await call("PUT", `/_p99/v1/import/attachments/imp-a-0?host=${here}&item=BUG-9805`, { raw: Buffer.from("x"), type: "text/plain", keyId: "test" });
    assert.equal(put403.status, 403, JSON.stringify(put403.json));
    for (const body of [{ records }, "item", 7, null]) {
      const said = await post(body);
      assert.equal(said.status, 400, JSON.stringify(said.json));
      assert.equal(said.json.message, "the body must be an array of at most 500 records");
    }
    const many = await post(Array.from({ length: 501 }, () => ({ type: "manager", email: "grace@example.com" })));
    assert.equal(many.status, 400, JSON.stringify(many.json));
    assert.equal(many.json.message, "the body must be an array of at most 500 records");
    const broken = await call("POST", `/_p99/v1/import?host=${here}&dry_run=1`, { raw: Buffer.from("[{"), type: "application/json" });
    assert.equal(broken.status, 400, JSON.stringify(broken.json));
    const empty = await post([]);
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    assert.deepEqual(empty.json.upload, []);
    assert.equal((await call("GET", `/_p99/v1/issues/BUG-9805?host=${here}`)).status, 404);
  });

  await check("import: a record that points across hosts or at a taken uid is a conflict, and nothing of it is written", async () => {
    const far = await post([item("BUG-9806"), comment("BUG-9806", "imp-far-c")], { host: there, dry: false });
    assert.equal(far.status, 200, JSON.stringify(far.json));
    const near = await post([item("BUG-9807"), comment("BUG-9807", "imp-near-c")], { dry: false });
    assert.equal(near.status, 200, JSON.stringify(near.json));
    const records = [
      comment("BUG-9806", "imp-cross-c"),
      { type: "read", item: "BUG-9806", email: ADA.email, at: AT },
      comment("BUG-9807", "imp-far-c"),
      { type: "attachment", item: "BUG-9807", uid: "imp-cross-a", comment: "imp-far-c" },
      { type: "attachment", item: "BUG-9807", uid: "imp-lost-a", comment: "imp-no-such-c" },
      comment("BUG-9899", "imp-orphan-c"),
      { type: "landing", item: "BUG-9899", env: "production", sha: "0123abc", at: AT },
    ];
    const said = await post(records, { dry: false });
    assert.equal(said.status, 200, JSON.stringify(said.json));
    const reasons = (type) => said.json.counts[type].conflicts.map((c) => `${c.ref}: ${c.reason}`);
    assert.deepEqual(reasons("comment"), [
      `imp-cross-c: item 9806 belongs to ${there}`,
      "imp-far-c: uid imp-far-c is a comment on item 9806",
      `imp-orphan-c: no item 9899 on ${here}`,
    ]);
    assert.deepEqual(reasons("read"), [`9806 ${ADA.email}: item 9806 belongs to ${there}`]);
    assert.deepEqual(reasons("attachment"), ["imp-cross-a: comment imp-far-c is on item 9806", "imp-lost-a: no comment imp-no-such-c"]);
    assert.deepEqual(reasons("landing"), [`9899 production: no item 9899 on ${here}`]);
    assert.deepEqual(said.json.upload, []);
    const dry = await post([comment("BUG-9899", "imp-orphan-c"), { type: "attachment", item: "BUG-9899", uid: "imp-orphan-a", comment: "imp-orphan-c" }]);
    assert.deepEqual([dry.json.counts.comment.new, dry.json.counts.attachment.new, dry.json.counts.comment.conflicts.length], [1, 1, 0]);
    assert.deepEqual(dry.json.upload, ["imp-orphan-a"]);
    const thread = await call("GET", `/_p99/v1/issues/BUG-9807?host=${here}`);
    assert.equal(thread.json.comments.length, 1, JSON.stringify(thread.json.comments));
    const renamed = await post([item("BUG-9807", { title: "Another title" })], { dry: false });
    assert.deepEqual(renamed.json.counts.item.conflicts, [{ ref: "BUG-9807", reason: 'BUG-9807 already exists with the title "Import checks: BUG-9807"' }]);
  });

  await check("import: a manager already holding a code is counted existing, one without is listed once", async () => {
    const minted = await call("POST", "/_p99/v1/codes", { body: { name: "Mary Somerville", email: "mary@example.com", hosts: [here], manager: true } });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    const said = await post([
      { type: "manager", email: "Mary@Example.com" },
      { type: "manager", email: "emmy@example.com" },
      { type: "manager", email: "EMMY@example.com" },
    ]);
    assert.equal(said.status, 200, JSON.stringify(said.json));
    assert.deepEqual(said.json.counts.manager, { new: 1, existing: 2, conflicts: [] });
    assert.deepEqual(said.json.managers, ["emmy@example.com"]);
  });

  await check("import finish: bad lists and keys are refused; missing items and targets are conflicts; a link is made once", async () => {
    const bad = [
      [{ items: "BUG-9808" }, "items must list at most 5000 keys"],
      [{ items: Array.from({ length: 5001 }, (_, i) => `BUG-${i + 1}`) }, "items must list at most 5000 keys"],
      [{ items: ["BUG-x"] }, "item must be a key such as BUG-3"],
      [{ items: [], duplicates: {} }, "duplicates must list at most 5000 pairs"],
      [{ items: [], duplicates: ["BUG-9808"] }, "a duplicate is {item, duplicate_of}"],
      [{ items: [], duplicates: [{ item: "x", duplicate_of: "BUG-9808" }] }, "item must be a key such as BUG-3"],
      [{ items: [], duplicates: [{ item: "BUG-9808", duplicate_of: null }] }, "duplicate_of must be a key such as BUG-3"],
    ];
    for (const [body, message] of bad) {
      const said = await finish(body);
      assert.equal(said.status, 400, `${JSON.stringify(body).slice(0, 80)} -> ${JSON.stringify(said.json)}`);
      assert.equal(said.json.message, message);
    }
    const none = await finish({});
    assert.equal(none.status, 200, JSON.stringify(none.json));
    assert.deepEqual(none.json, { recounted: 0, duplicates: { linked: 0, conflicts: [] } });
    const made = await post([item("BUG-9809", { status: "done", resolution: "duplicate", duplicate_of: "BUG-9808" }), item("BUG-9808"), comment("BUG-9808", "imp-fin-c")], { dry: false });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const body = {
      items: ["BUG-9808", "BUG-9809", "BUG-9806", "BUG-9898"],
      duplicates: [
        { item: "BUG-9809", duplicate_of: "BUG-9808" },
        { item: "BUG-9898", duplicate_of: "BUG-9808" },
        { item: "BUG-9806", duplicate_of: "BUG-9808" },
        { item: "BUG-9808", duplicate_of: "BUG-9897" },
      ],
    };
    const first = await finish(body);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.recounted, 2);
    assert.equal(first.json.duplicates.linked, 1);
    assert.deepEqual(first.json.duplicates.conflicts, [
      { ref: "9898", reason: `no item 9898 on ${here}` },
      { ref: "9806", reason: `no item 9806 on ${here}` },
      { ref: "9808", reason: "duplicate_of names no item 9897" },
    ]);
    const again = await finish({ items: [], duplicates: [{ item: "BUG-9809", duplicate_of: "BUG-9808" }] });
    assert.deepEqual(again.json, { recounted: 0, duplicates: { linked: 0, conflicts: [] } });
    const thread = await call("GET", `/_p99/v1/issues/BUG-9808?host=${here}`);
    assert.equal(thread.json.issue.comments, 1, JSON.stringify(thread.json.issue));
  });

  await check("import attachment: every bad uid, item, role, mark, name, type, comment, time and size is refused before a byte is kept", async () => {
    const made = await post([item("BUG-9810"), comment("BUG-9810", "imp-att-c"), item("BUG-9811")], { dry: false });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const ok = { item: "BUG-9810", role: "file", name: "receipt.txt" };
    const cases = [
      ["bad%20uid", ok, {}, 400, "uid must be 1 to 64 letters, digits, dots, dashes or underscores"],
      ["imp-a-1", { ...ok, item: "receipt" }, {}, 400, "item must be a key such as BUG-3"],
      ["imp-a-1", { ...ok, item: "BUG-9896" }, {}, 404, "no such item"],
      ["imp-a-1", ok, { host: there }, 404, "no such item"],
      ["imp-a-1", { ...ok, role: "photo" }, {}, 400, "role must be screenshot, page, region or file"],
      ["imp-a-1", { ...ok, role: "region", mark: "0" }, { type: "image/png" }, 400, "a region needs mark, the index of one of the item's marks"],
      ["imp-a-1", { ...ok, role: "region" }, { type: "image/png" }, 400, "a region needs mark, the index of one of the item's marks"],
      ["imp-a-1", { ...ok, mark: "0" }, {}, 400, "only a region carries a mark"],
      ["imp-a-1", { item: "BUG-9810" }, {}, 400, "name must be 1 to 200 characters, no slashes"],
      ["imp-a-1", { ...ok, name: "../receipt.txt" }, {}, 400, "name must be 1 to 200 characters, no slashes"],
      ["imp-a-1", { ...ok, name: "receipt.html" }, {}, 400, "the file's name must not end in an executable or web page extension"],
      ["imp-a-1", { ...ok, comment: "imp-no-such-c" }, {}, 404, "no such comment on this item"],
      ["imp-a-1", { ...ok, created_at: "soon" }, {}, 400, "created_at must be a date and time"],
    ];
    for (const [uid, params, options, status, message] of cases) {
      const said = await put(uid, params, options);
      assert.equal(said.status, status, `${uid} ${JSON.stringify(params)} -> ${JSON.stringify(said.json)}`);
      assert.equal(said.json.message, message);
    }
    const wrongType = await put("imp-a-1", ok, { type: "application/x-unknown" });
    assert.equal(wrongType.status, 400, JSON.stringify(wrongType.json));
    const notImage = await put("imp-a-1", { ...ok, role: "screenshot" });
    assert.equal(notImage.status, 400, JSON.stringify(notImage.json));
    const thread = await call("GET", `/_p99/v1/issues/BUG-9810?host=${here}`);
    assert.deepEqual(thread.json.attachments, []);
  });

  await check("import attachment: a stored uid answers 200 again with the same file, another item's uid is a 409, and the file is counted on its item", async () => {
    const said = await post([comment("BUG-9810", "imp-att-note", { internal: true })], { dry: false });
    assert.equal(said.status, 200, JSON.stringify(said.json));
    const stored = await put("imp-a-2", { item: "BUG-9810", comment: "imp-att-note", name: "café.txt", created_at: "2025-05-02T08:00:00Z" });
    assert.equal(stored.status, 201, JSON.stringify(stored.json));
    const again = await put("imp-a-2", { item: "BUG-9810", comment: "imp-att-note", name: "café.txt" });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.id, stored.json.id);
    const taken = await put("imp-a-2", { item: "BUG-9811", name: "café.txt" });
    assert.equal(taken.status, 409, JSON.stringify(taken.json));
    assert.equal(taken.json.message, "uid is already a file of another item");
    const listed = await post([{ type: "attachment", item: "BUG-9811", uid: "imp-a-2" }, { type: "attachment", item: "BUG-9810", uid: "imp-a-2", comment: "imp-att-note" }], { dry: false });
    assert.deepEqual(listed.json.counts.attachment, { new: 0, existing: 1, conflicts: [{ ref: "imp-a-2", reason: "uid imp-a-2 is a file of item 9810" }] });
    const thread = await call("GET", `/_p99/v1/issues/BUG-9810?host=${here}`);
    assert.equal(thread.json.attachments.length, 1, JSON.stringify(thread.json.attachments));
    assert.equal(thread.json.attachments[0].name, "café.txt");
    assert.equal(thread.json.issue.attachments, 1);
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ROBOT, MAX_VIA_CHARS } from "../src/cards.js";
import { actorName } from "../src/hooks.js";
import { actorWord } from "../src/deletes.js";

const LABEL = "pci·splicer·writer";
const GRACE = { email: "grace@example.com", name: "Grace Hopper" };
const agent = (via) => ({ ...GRACE, agent: true, ...(via === undefined ? {} : { via }) });
const person = (via) => ({ ...GRACE, agent: false, ...(via === undefined ? {} : { via }) });

async function until(what, ok) {
  for (let i = 0; i < 50; i++) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`waited for ${what}`);
}

export async function markChecks({ call, browse, mint, check, issueBody, here, sent = [], listen = null, hookHits = null }) {
  const file = async (actor, title) => {
    const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { actor, body: issueBody({ title }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    return filed.json;
  };
  const thread = async (key) => {
    const read = await call("GET", `/_p99/v1/issues/${key}?host=${here}`);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    return read.json;
  };
  const comment = async (key, actor, text = "Looked into it.") => {
    const said = await call("POST", `/_p99/v1/issues/${key}/comments?host=${here}`, { actor, body: { client_uid: randomUUID(), body: text } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    return said.json;
  };

  await check("an agent's label is kept on the item, its comment and their events, and comes back on each", async () => {
    const filed = await file(agent(LABEL), "Marks: the agent's label rides along");
    assert.deepEqual([filed.reporter.agent, filed.reporter.via], [true, LABEL]);
    const said = await comment(filed.key, agent(LABEL));
    assert.deepEqual([said.author.agent, said.author.via], [true, LABEL]);
    const t = await thread(filed.key);
    assert.equal(t.issue.reporter.via, LABEL);
    assert.equal(t.comments[0].author.via, LABEL);
    const kinds = t.events.filter((e) => e.kind === "created" || e.kind === "comment");
    assert.deepEqual(kinds.map((e) => e.kind), ["created", "comment"]);
    for (const e of kinds) assert.deepEqual([e.agent, e.via], [true, LABEL], e.kind);
    const listed = await call("GET", `/_p99/v1/issues?host=${here}&scope=all&status=any&q=${encodeURIComponent("label rides along")}`);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const row = listed.json.issues.find((i) => i.key === filed.key);
    assert.ok(row, "the item is listed");
    assert.deepEqual([row.reporter.agent, row.reporter.via], [true, LABEL]);
  });

  await check("a person's own action carries no label, even when one is sent with agent false", async () => {
    const filed = await file(person("pci"), "Marks: a person files with a stray label");
    assert.deepEqual([filed.reporter.agent, filed.reporter.via], [false, null]);
    const said = await comment(filed.key, person("pci"));
    assert.deepEqual([said.author.agent, said.author.via], [false, null]);
    const t = await thread(filed.key);
    assert.ok(t.events.length >= 2);
    for (const e of t.events) assert.deepEqual([e.agent, e.via], [false, null], e.kind);
  });

  await check("an agent with no label, or an empty one, is marked with a null label", async () => {
    for (const via of [undefined, null, "", "   "]) {
      const filed = await file(agent(via), `Marks: an unlabelled agent ${JSON.stringify(via)}`);
      assert.deepEqual([filed.reporter.agent, filed.reporter.via], [true, null], JSON.stringify(via));
      const t = await thread(filed.key);
      assert.deepEqual([t.events[0].agent, t.events[0].via], [true, null]);
    }
  });

  await check(`a label longer than ${MAX_VIA_CHARS} characters is cut at ${MAX_VIA_CHARS}, and one of exactly ${MAX_VIA_CHARS} is kept whole`, async () => {
    const long = "x".repeat(MAX_VIA_CHARS - 1) + "yz" + "w".repeat(20);
    const cut = await file(agent(long), "Marks: a long label");
    assert.equal(cut.reporter.via, "x".repeat(MAX_VIA_CHARS - 1) + "y");
    assert.equal([...cut.reporter.via].length, MAX_VIA_CHARS);
    const robots = ROBOT.repeat(MAX_VIA_CHARS + 5);
    const wide = await file(agent(robots), "Marks: a label of robots");
    assert.equal([...wide.reporter.via].length, MAX_VIA_CHARS, "cut by characters, never mid-character");
    const exact = "e".repeat(MAX_VIA_CHARS);
    assert.equal((await file(agent(exact), "Marks: an exact label")).reporter.via, exact);
    const padded = await file(agent(`  ${LABEL}  `), "Marks: a padded label");
    assert.equal(padded.reporter.via, LABEL);
  });

  await check("a label that is not a string is refused with 400 and files nothing", async () => {
    for (const via of [42, true, ["pci"], { name: "pci" }]) {
      const title = `Marks: refused label ${JSON.stringify(via)}`;
      const refused = await call("POST", `/_p99/v1/issues?host=${here}`, { actor: agent(via), body: issueBody({ title }) });
      assert.equal(refused.status, 400, JSON.stringify(via));
      const listed = await call("GET", `/_p99/v1/issues?host=${here}&scope=all&status=any&q=${encodeURIComponent(title)}`, { actor: person() });
      assert.equal(listed.json.issues.length, 0, JSON.stringify(via));
    }
  });

  await check("an agent's close keeps its label on the label and status events of a plain item", async () => {
    const filed = await file(person(), "Marks: an agent closes a plain item");
    const closed = await call("PATCH", `/_p99/v1/issues/${filed.key}?host=${here}`, { actor: agent(LABEL), body: { resolution: "abandoned" } });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    const t = await thread(filed.key);
    const moved = t.events.filter((e) => e.kind === "label" || e.kind === "status");
    assert.ok(moved.length >= 1, JSON.stringify(t.events));
    for (const e of moved) assert.deepEqual([e.agent, e.via], [true, LABEL], e.kind);
    const created = t.events.find((e) => e.kind === "created");
    assert.deepEqual([created.agent, created.via], [false, null]);
  });

  await check("the browser never carries a label: a code's comment is a person's", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const filed = await browse("POST", "/issues", ada.secret, issueBody({ title: "Marks: filed in the browser" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.deepEqual([filed.json.reporter.agent, filed.json.reporter.via], [false, null]);
    const t = await thread(filed.json.key);
    assert.deepEqual([t.events[0].agent, t.events[0].via], [false, null]);
  });

  await check(`an agent's reply mails the reporter as the person's name with ${ROBOT}, never an asterisk`, async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const filed = await browse("POST", "/issues", ada.secret, issueBody({ title: "Marks: mail me the agent's reply" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    await comment(key, agent(LABEL), "The agent answers.");
    const mails = () => sent.filter((m) => m.to[0] === "ada@example.com" && m.subject.startsWith(`[${key}]`));
    await until("the reply mail", () => mails().length === 1);
    const mail = mails()[0];
    assert.ok(mail.text.includes(`Grace Hopper ${ROBOT} replied on ${key}`), mail.text);
    assert.equal(mail.text.includes("Hopper*"), false);
    assert.ok(mail.html.includes(ROBOT));
  });

  await check(`Slack and Discord lines name an agent with ${ROBOT}, a person plainly, and nobody as P99`, async () => {
    assert.equal(actorName({ name: "Grace Hopper", agent: true }), `Grace Hopper ${ROBOT}`);
    assert.equal(actorName({ name: "Grace Hopper", agent: true, via: LABEL }), `Grace Hopper ${ROBOT}`);
    assert.equal(actorName({ name: "Grace Hopper", agent: false }), "Grace Hopper");
    assert.equal(actorName({ name: "grace@example.com", agent: true }), `grace ${ROBOT}`);
    assert.equal(actorName(null), "P99");
    assert.equal(actorName({ name: "", agent: true }), "P99");
    for (const by of [{ name: "Grace Hopper", agent: true }, { name: "Grace Hopper", agent: false }]) assert.equal(actorName(by).includes("*"), false);
  });

  await check(`the delete log line names an agent with ${ROBOT}`, async () => {
    assert.equal(actorWord({ actor: { name: "Grace Hopper", agent: true, via: LABEL } }), `Grace Hopper ${ROBOT}`);
    assert.equal(actorWord({ actor: { name: "Grace Hopper", agent: false } }), "Grace Hopper");
    assert.equal(actorWord({ actor: null }), "P99");
  });

  await check("an agent's merge keeps its label on the merge events of both items", async () => {
    const into = await file(person(), "Marks: merge target");
    const from = await file(person(), "Marks: merge source");
    const merged = await call("POST", `/_p99/v1/merge?host=${here}`, { actor: agent(LABEL), body: { items: [from.key], into: into.key } });
    assert.equal(merged.status, 200, JSON.stringify(merged.json));
    for (const key of [into.key, from.key]) {
      const merges = (await thread(key)).events.filter((e) => e.kind === "merge");
      assert.equal(merges.length, 1, key);
      assert.deepEqual([merges[0].agent, merges[0].via], [true, LABEL], key);
    }
  });

  await check("an agent's delete keeps its label on the status event of each duplicate it reopens", async () => {
    const into = await file(person(), "Marks: deleted target");
    const from = await file(person(), "Marks: duplicate to reopen");
    assert.equal((await call("POST", `/_p99/v1/merge?host=${here}`, { body: { items: [from.key], into: into.key } })).status, 200);
    const gone = await call("DELETE", `/_p99/v1/issues/${into.key}?host=${here}`, { actor: agent(LABEL) });
    assert.ok(gone.status === 200 || gone.status === 204, JSON.stringify(gone.json));
    const reopened = (await thread(from.key)).events.filter((e) => e.kind === "status" && e.detail && e.detail.deleted === into.key);
    assert.equal(reopened.length, 1, JSON.stringify((await thread(from.key)).events));
    assert.deepEqual([reopened[0].agent, reopened[0].via], [true, LABEL]);
  });

  await check("an agent's file keeps its label on the attachment event", async () => {
    const filed = await file(person(), "Marks: an agent attaches a file");
    const put = await call("PUT", `/_p99/v1/issues/${filed.key}/attachments/${randomUUID()}?host=${here}&name=trace.txt`, {
      actor: agent(LABEL),
      raw: Buffer.from("trace\n"),
      type: "text/plain",
    });
    assert.equal(put.status, 201, JSON.stringify(put.json));
    const attached = (await thread(filed.key)).events.filter((e) => e.kind === "attachment");
    assert.equal(attached.length, 1);
    assert.deepEqual([attached[0].agent, attached[0].via], [true, LABEL]);
  });

  await check("the mail event of an agent's reply carries the agent's label", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const filed = await browse("POST", "/issues", ada.secret, issueBody({ title: "Marks: the mail event is labelled" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const said = await comment(filed.json.key, agent(LABEL), "The agent answers, and mail goes out.");
    let mails = [];
    await until("the mail event", async () => (mails = (await thread(filed.json.key)).events.filter((e) => e.kind === "mail" && e.at >= said.created_at)).length > 0);
    for (const e of mails) assert.deepEqual([e.agent, e.via], [true, LABEL]);
  });

  await check("an imported agent keeps its label on the item, the comment and the event; a person's stray label is dropped; a non-string is refused", async () => {
    const stamp = "2025-04-01T10:00:00Z";
    const records = [
      {
        type: "item", key: "BUG-9701", kind: "bug", title: "Marks: imported by an agent", body: "", status: "inbox", duplicate_of: null,
        reporter: { email: GRACE.email, name: GRACE.name, agent: true, via: LABEL }, assignee: null, env: null, page: null,
        context: {}, marks: [], created_at: stamp, updated_at: stamp, closed_at: null,
      },
      { type: "comment", item: "BUG-9701", uid: "marks-import-agent", author: { ...GRACE, agent: true, via: LABEL, manager: true }, body: "An agent's note.", internal: false, created_at: stamp },
      { type: "comment", item: "BUG-9701", uid: "marks-import-person", author: { ...GRACE, agent: false, via: "pci", manager: true }, body: "A person's note.", internal: false, created_at: "2025-04-01T11:00:00Z" },
      { type: "event", item: "BUG-9701", actor: { email: GRACE.email, agent: true, via: LABEL }, kind: "label", detail: {}, internal: false, at: "2025-04-01T12:00:00Z" },
    ];
    const done = await call("POST", `/_p99/v1/import?host=${here}&dry_run=0`, { body: records });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal((await call("POST", `/_p99/v1/import/finish?host=${here}`, { body: { items: ["BUG-9701"], duplicates: [] } })).status, 200);
    const t = await thread("BUG-9701");
    assert.deepEqual([t.issue.reporter.agent, t.issue.reporter.via], [true, LABEL]);
    const by = Object.fromEntries(t.comments.map((c) => [c.body, c.author]));
    assert.deepEqual([by["An agent's note."].agent, by["An agent's note."].via], [true, LABEL]);
    assert.deepEqual([by["A person's note."].agent, by["A person's note."].via], [false, null]);
    const imported = t.events.find((e) => e.at === "2025-04-01T12:00:00Z" || e.at === "2025-04-01T12:00:00.000Z");
    assert.ok(imported, JSON.stringify(t.events));
    assert.deepEqual([imported.agent, imported.via], [true, LABEL]);
    for (const via of [42, ["pci"]]) {
      const bad = [{ ...records[0], key: "BUG-9702", reporter: { ...records[0].reporter, via } }];
      assert.equal((await call("POST", `/_p99/v1/import?host=${here}&dry_run=1`, { body: bad })).status, 400, JSON.stringify(via));
    }
  });

  if (listen) {
    await check("the live stream names an agent's change with its label in by.via, a person's with none", async () => {
      const heard = [];
      const stream = await listen(`/_p99/v1/stream?host=${here}`, heard);
      try {
        const byAgent = await file(agent(LABEL), "Marks: heard live from an agent");
        const byPerson = await file(person("pci"), "Marks: heard live from a person");
        await until("both live events", () => heard.some((e) => e.key === byAgent.key) && heard.some((e) => e.key === byPerson.key));
        const a = heard.find((e) => e.key === byAgent.key);
        const p = heard.find((e) => e.key === byPerson.key);
        assert.deepEqual([a.by.agent, a.by.via], [true, LABEL]);
        assert.deepEqual([p.by.agent, p.by.via], [false, null]);
      } finally {
        stream.close();
      }
    });
  }

  if (hookHits) {
    await check(`a posted Slack hook names an agent with ${ROBOT} and never an asterisk`, async () => {
      const slack = `https://hooks.slack.com/services/T0001/B0002/${randomUUID().replaceAll("-", "")}`;
      assert.equal((await call("PUT", `/_p99/v1/hooks/${here}`, { body: { service: "slack", url: slack, events: ["new"] } })).status, 200);
      try {
        hookHits.length = 0;
        const filed = await file(agent(LABEL), "Marks: the hook sees the robot");
        await until("the hook post", () => hookHits.some((h) => JSON.stringify(h.body).includes(filed.key)));
        const said = JSON.stringify(hookHits.find((h) => JSON.stringify(h.body).includes(filed.key)).body);
        assert.ok(said.includes(`Grace Hopper ${ROBOT}`), said);
        assert.equal(said.includes("Hopper*"), false);
      } finally {
        await call("DELETE", `/_p99/v1/hooks/${here}?service=slack`);
      }
    });
  }
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ROBOT, MAX_VIA_CHARS } from "../src/cards.js";
import { actorName } from "../src/hooks.js";
import { actorWord } from "../src/deletes.js";
import { composeMail } from "../src/mail.js";

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

export async function markChecks({ call, browse, mint, check, issueBody, here, sent = [] }) {
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
    const listed = await call("GET", `/_p99/v1/issues?host=${here}&scope=all&status=any&q=${encodeURIComponent("agent's label rides")}`);
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

  await check(`a mail's subject and lead carry the actor's name as given, ${ROBOT} included, in text and HTML`, async () => {
    const m = composeMail({ template: "comment_to_managers", key: "BUG-7", title: "Totals", body: "Fixed.", actorName: `Grace Hopper ${ROBOT}`, link: null, optOut: null, theme: null });
    assert.equal(m.subject, `[BUG-7] New comment from Grace Hopper ${ROBOT}`);
    assert.ok(m.text.startsWith(`Grace Hopper ${ROBOT} wrote on BUG-7`));
    assert.ok(m.html.includes(`Grace Hopper ${ROBOT} wrote on BUG-7`));
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LANES, LANE_NAMES, PERSON_UNCARDS, WAITING_LANES, refuseAgentUncard, useKit } from "../src/cards.js";
import { useKit as useBoardsKit } from "../src/boards.js";
import { backLane, leaveNeedsYou } from "../src/needs-you.js";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const graceBot = { email: "grace@example.com", name: "Grace Hopper", agent: true, via: "pci·splicer·writer" };
const CARD_FIELDS = ["changed_at", "changed_by", "comments", "created_at", "host", "key", "kind", "label", "lane", "links", "project", "reporter", "status", "title"];
const idOf = (key) => Number(key.split("-")[1]);

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const refused = (status, message) => (error) => error instanceof Refused && error.status === status && error.message === message;

async function unitChecks(check) {
  useKit({
    clean: (value) => value,
    fail: (status, message) => {
      throw new Refused(status, message);
    },
  });
  const lanes = LANE_NAMES.map((name, at) => ({ id: at + 1, name }));

  await check("the waiting lanes are needs-you, stuck and landed, and needs-you sits fourth", async () => {
    assert.deepEqual(WAITING_LANES, ["needs-you", "stuck", "landed"]);
    assert.equal(LANES.indexOf("needs-you"), 3);
    assert.equal(LANE_NAMES[3], "Needs you");
  });

  await check("the way back out of needs-you is the lane named by the last move, never needs-you or the closing lane", async () => {
    assert.equal(backLane(lanes, "Planned").id, 2);
    assert.equal(backLane(lanes, "New").id, 1);
    assert.equal(backLane(lanes, "Stuck").id, 5);
    assert.equal(backLane(lanes, "Landed").id, 6);
    assert.equal(backLane(lanes, "planned").id, 2, "a lane's name matches folded when nothing matches exactly");
    for (const name of ["Needs you", "needs you", "Done", "Gone", "", null, undefined, 7]) {
      assert.equal(backLane(lanes, name).id, 3, `${String(name)} falls back to In progress`);
    }
  });

  await check("an exact name wins over a folded one, and two folded matches fall back", async () => {
    const twins = [{ id: 1, name: "New" }, { id: 2, name: "Queue" }, { id: 3, name: "In progress" }, { id: 4, name: "Needs you" }, { id: 5, name: "QUEUE" }, { id: 6, name: "Landed" }, { id: 7, name: "Done" }];
    assert.equal(backLane(twins, "QUEUE").id, 5);
    assert.equal(backLane(twins, "Queue").id, 2);
    assert.equal(backLane(twins, "queue").id, 3);
    assert.equal(backLane([], "New"), null);
  });

  await check("only an agent taking a card's project away is refused", async () => {
    const card = { project: "Splicer" };
    const item = { project: null };
    assert.throws(() => refuseAgentUncard({ actor: graceBot }, card, { project: null }), refused(403, PERSON_UNCARDS));
    assert.throws(() => refuseAgentUncard({ actor: { ...graceBot, via: null } }, card, { project: null }), refused(403, PERSON_UNCARDS));
    assert.doesNotThrow(() => refuseAgentUncard({ actor: ada }, card, { project: null }));
    assert.doesNotThrow(() => refuseAgentUncard({ actor: graceBot }, card, { project: "Paper" }));
    assert.doesNotThrow(() => refuseAgentUncard({ actor: graceBot }, item, { project: null }));
    assert.doesNotThrow(() => refuseAgentUncard({ actor: graceBot }, card, {}));
    assert.doesNotThrow(() => refuseAgentUncard({ actor: null }, card, { project: null }));
    assert.equal(PERSON_UNCARDS, "only a person turns a card back into an item");
  });
}

function fakeDb(at, from) {
  const seen = { prepared: [], batches: 0 };
  const lanes = LANE_NAMES.map((name, i) => ({ board: 9, id: i + 1, name, role: i === 0 ? "inbox" : i === 6 ? "done" : null, closes: i === 6 ? 1 : 0 }));
  const statement = (sql) => {
    const made = { sql, binds: [], bind: (...binds) => ((made.binds = binds), made), first: async () => (at === null ? null : { at }), all: async () => ({ results: [] }) };
    seen.prepared.push(made);
    return made;
  };
  const DB = {
    prepare: statement,
    batch: async () => {
      seen.batches++;
      return [{ results: lanes }, { results: from === null ? [] : [{ name: from }] }];
    },
  };
  return { DB, seen };
}

async function leaveChecks(check) {
  const pushed = [];
  const kit = {
    clean: (value) => value,
    fail: (status, message) => {
      throw new Refused(status, message);
    },
    refuseAgentClose: () => {},
    keyOf: (kind, id) => `T-${id}`,
    push: (c, type, row, detail) => pushed.push({ type, key: `T-${row.id}`, ...detail }),
  };
  useKit(kit);
  useBoardsKit(kit);
  const row = { id: 42, kind: "task", project: "Splicer", open: 1, label_id: 4, label_name: "Needs you", label_role: null, host: "example.com", title: "Look", client_uid: "u-42" };
  const context = (db, actor = ada, manager = true) => ({ manager, actor, now: "2026-10-22T09:00:00.000Z", env: { DB: db.DB, HUB: {} }, pushes: [] });

  await check("a card outside Needs you costs one lane query and no move", async () => {
    const db = fakeDb(1, "Planned");
    const left = await leaveNeedsYou(context(db), { ...row, label_id: 2, label_name: "Planned" });
    assert.deepEqual(left.statements, []);
    assert.equal(db.seen.prepared.length, 1);
    assert.match(db.seen.prepared[0].sql, /b\.cards = 1/);
    assert.deepEqual(db.seen.prepared[0].binds, [2]);
    assert.equal(db.seen.batches, 0);
    const none = fakeDb(null, "Planned");
    assert.deepEqual((await leaveNeedsYou(context(none), row)).statements, []);
    assert.equal(none.seen.batches, 0);
  });

  await check("an agent, a User, a plain item or a closed card never reads the board", async () => {
    for (const [actor, manager, item] of [[graceBot, true, row], [ada, false, row], [ada, true, { ...row, project: null }], [ada, true, { ...row, open: 0 }], [null, true, row]]) {
      const db = fakeDb(3, "Planned");
      assert.deepEqual((await leaveNeedsYou(context(db, actor, manager), item)).statements, []);
      assert.equal(db.seen.prepared.length, 0);
    }
  });

  await check("a move that lost its race announces nothing; a move that landed announces the lane and the place", async () => {
    pushed.length = 0;
    const db = fakeDb(3, "Planned");
    const c = context(db);
    const left = await leaveNeedsYou(c, row);
    assert.equal(left.statements.length, 3);
    assert.match(left.statements[0].sql, /^UPDATE items SET label_id/);
    assert.deepEqual(left.statements[0].binds.slice(0, 3), [42, 4, 2]);
    for (const update of [undefined, { meta: {} }, { meta: { changes: 0 } }]) left.after(update);
    assert.deepEqual(c.pushes, []);
    assert.equal(c.hooked, undefined);
    assert.deepEqual(pushed, []);
    left.after({ meta: { changes: 1 } });
    assert.deepEqual(c.pushes.map((p) => [p.type, p.key, p.from, p.to]), [["label", "T-42", "Needs you", "Planned"]]);
    assert.deepEqual(pushed.map((p) => [p.type, p.key, p.board]), [["order", "T-42", 9]]);
  });

  await check("a last move from no lane, or from needs-you, sends the card to In progress", async () => {
    for (const from of [null, "Needs you"]) {
      const left = await leaveNeedsYou(context(fakeDb(3, from)), row);
      assert.deepEqual(left.statements[0].binds.slice(0, 3), [42, 4, 3]);
    }
  });
}

export async function needsChecks({ call, browse, mint, check, issueBody, here, there, d1count }) {
  await unitChecks(check);
  await leaveChecks(check);

  const file = async (project, title, actor = ada, host = here) => {
    const made = await call("POST", `/_p99/v1/cards?host=${host}`, { actor, body: { client_uid: randomUUID(), project, title, host } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.card.key;
  };
  const status = async (key, word, actor = ada, extra = {}) => {
    const moved = await call("POST", `/_p99/v1/cards/${key}/status`, { actor, body: { status: word, ...extra } });
    assert.equal(moved.status, 200, `${word}: ${JSON.stringify(moved.json)}`);
    return moved.json;
  };
  const comment = async (key, actor = ada, extra = {}) => {
    const said = await call("POST", `/_p99/v1/cards/${key}/comments`, { actor, body: { client_uid: randomUUID(), body: "Looked at it; carry on.", ...extra } });
    assert.ok(said.status === 201 || said.status === 200, JSON.stringify(said.json));
    return said;
  };
  const card = async (key) => (await call("GET", `/_p99/v1/cards/${key}`, { actor: ada })).json.card;
  const events = async (key, kind) => (await call("GET", `/_p99/v1/issues/${key}`, { actor: ada })).json.events.filter((ev) => ev.kind === kind);
  const lane = async (project, word) =>
    (await call("GET", `/_p99/v1/cards?project=${encodeURIComponent(project)}&status=${word}&limit=500`, { actor: ada })).json.cards.map((cd) => cd.key);
  const waiting = async (host) => {
    const got = await call("GET", `/_p99/v1/cards/waiting${host ? `?host=${host}` : ""}`, { actor: ada });
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return got.json;
  };
  const counted = (key, kinds) => d1count(`SELECT count(*) AS n FROM events WHERE item_id = ${idOf(key)} AND kind IN (${kinds.map((k) => `'${k}'`).join(", ")})`);
  const mailedSince = (key, at) => d1count(`SELECT count(*) AS n FROM events WHERE item_id = ${idOf(key)} AND kind = 'mail' AND at >= '${at}'`);

  await check("an agent sets needs-you with a note: the card sits at the top of Needs you with the agent's comment", async () => {
    const key = await file("Needs Note", "Export clip to look at");
    await status(key, "in-progress");
    const set = await status(key, "needs-you", graceBot, { note: "Look at the export clip: https://example.com/clip", client_uid: randomUUID() });
    assert.equal(set.card.status, "needs-you");
    assert.equal(set.card.label, "Needs you");
    assert.equal(set.card.lane, 1);
    assert.equal(set.comment.body, "Look at the export clip: https://example.com/clip");
    assert.deepEqual(set.comment.author, { name: "Grace Hopper", username: set.comment.author.username, agent: true, via: "pci·splicer·writer" });
    assert.deepEqual((await events(key, "label")).at(-1).detail, { from: "In progress", to: "Needs you" });
    assert.deepEqual(await lane("Needs Note", "needs-you"), [key]);
  });

  await check("a person's comment sends the card back to the lane it came from, at its top, in the comment's write", async () => {
    const older = await file("Needs Back", "Already in progress");
    await status(older, "in-progress");
    const key = await file("Needs Back", "Back to work");
    await status(key, "in-progress");
    await status(key, "needs-you", graceBot);
    assert.deepEqual(await lane("Needs Back", "in-progress"), [older]);
    const stages = (await events(key, "status")).length;
    const said = await comment(key, ada, { body: "Clip looks right." });
    assert.equal(said.status, 201);
    assert.equal(said.json.key, key);
    assert.equal(said.json.comment.body, "Clip looks right.");
    const back = await card(key);
    assert.equal(back.status, "in-progress");
    assert.equal(back.label, "In progress");
    assert.equal(back.lane, 1);
    assert.deepEqual(await lane("Needs Back", "in-progress"), [key, older]);
    const moves = await events(key, "label");
    assert.deepEqual(moves.at(-1).detail, { from: "Needs you", to: "In progress" });
    assert.equal(moves.at(-1).agent, false);
    assert.equal(moves.at(-1).actor, "ada@example.com");
    assert.equal((await events(key, "status")).length, stages, "needs-you and in progress are one stage to a visitor");
    assert.equal((await events(key, "comment")).length, 1);
  });

  await check("an agent's comment leaves a card in needs-you; a person's internal note or a plain-route comment brings it back", async () => {
    const key = await file("Needs Agent", "Waits for a person");
    await status(key, "planned");
    await status(key, "needs-you", graceBot);
    const before = counted(key, ["label"]);
    assert.equal((await comment(key, graceBot, { body: "Still waiting on you." })).status, 201);
    assert.equal((await card(key)).status, "needs-you");
    assert.equal(counted(key, ["label"]), before);
    assert.equal((await comment(key, ada, { body: "Between us.", internal: true })).status, 201);
    assert.equal((await card(key)).status, "planned");
    await status(key, "needs-you", graceBot);
    const plain = await call("POST", `/_p99/v1/issues/${key}/comments`, { actor: ada, body: { client_uid: randomUUID(), body: "From the thread.", internal: false } });
    assert.equal(plain.status, 201, JSON.stringify(plain.json));
    assert.equal((await card(key)).status, "planned");
  });

  await check("a replayed comment moves nothing, and a comment on a card in any other lane moves nothing", async () => {
    const key = await file("Needs Replay", "Replayed answer");
    await status(key, "stuck");
    await status(key, "needs-you", graceBot);
    const uid = randomUUID();
    assert.equal((await comment(key, ada, { client_uid: uid, body: "Once." })).status, 201);
    assert.equal((await card(key)).status, "stuck");
    await status(key, "needs-you", graceBot);
    const replay = await comment(key, ada, { client_uid: uid, body: "Once." });
    assert.equal(replay.status, 200);
    assert.equal((await card(key)).status, "needs-you");
    await status(key, "landed");
    const moves = counted(key, ["label"]);
    assert.equal((await comment(key, ada, { body: "Checked the landing." })).status, 201);
    assert.equal((await card(key)).status, "landed");
    assert.equal(counted(key, ["label"]), moves);
  });

  await check("the way back reads the last move a person or agent made, never the fold's, and goes back to new as received", async () => {
    const key = await file("Needs Fold", "Came from new");
    await status(key, "needs-you", graceBot);
    assert.equal(
      d1count(
        `INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at, actor_via)
         VALUES (${idOf(key)}, NULL, 0, 'label', '{"from":"Stuck","to":"Needs you","migrated":true}', 1, '2026-10-22T08:00:00.000Z', NULL) RETURNING 0 AS n`,
      ),
      0,
    );
    await comment(key, ada);
    const back = await card(key);
    assert.equal(back.status, "new");
    assert.equal(back.label, "New");
    const stages = (await events(key, "status")).map((ev) => ev.detail);
    assert.deepEqual(stages.at(-1), { from: "in_progress", to: "received" });
  });

  await check("a card that came from done, or from a lane renamed since, goes back to in progress and stays open", async () => {
    const fromDone = await file("Needs Odd", "Reopened by an agent");
    await status(fromDone, "done");
    await status(fromDone, "needs-you", graceBot);
    await comment(fromDone, ada);
    const reopened = await card(fromDone);
    assert.equal(reopened.status, "in-progress");
    assert.equal((await call("GET", `/_p99/v1/issues/${fromDone}`, { actor: ada })).json.issue.closed_at, null);

    const renamed = await file("Needs Odd", "Its lane was renamed");
    await status(renamed, "planned");
    await status(renamed, "needs-you", graceBot);
    const planned = (await call("GET", "/_p99/v1/labels", { actor: ada })).json.labels.find((l) => l.name === "Planned");
    assert.ok(planned);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "Queued" } })).status, 200);
    try {
      await comment(renamed, ada);
      assert.equal((await card(renamed)).status, "in-progress");
    } finally {
      assert.equal((await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "Planned" } })).status, 200);
    }
  });

  await check("a plain item in the Needs you lane stays there when a person comments", async () => {
    const item = (await call("POST", `/_p99/v1/issues?host=${here}`, { actor: ada, body: issueBody({ title: "Plain, needs you" }) })).json.key;
    const moved = await call("POST", "/_p99/v1/move", { actor: ada, body: { key: item, from: "New", to: "needs-you" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const said = await call("POST", `/_p99/v1/issues/${item}/comments`, { actor: ada, body: { client_uid: randomUUID(), body: "A person reads it.", internal: false } });
    assert.equal(said.status, 201);
    assert.equal((await call("GET", `/_p99/v1/issues/${item}`, { actor: ada })).json.issue.label, "Needs you");
  });

  const w = {};
  for (const name of ["stuck", "landed", "needs", "fresh", "done", "planned"]) w[name] = await file("Waiting Order", `Waiting ${name}`);
  await status(w.stuck, "stuck", graceBot);
  await status(w.landed, "landed", graceBot);
  await status(w.needs, "needs-you", graceBot);
  await status(w.done, "done");
  await status(w.planned, "planned");
  assert.equal((await call("POST", `/_p99/v1/cards/${w.stuck}/links`, { actor: graceBot, body: { ref: "pci#2732" } })).status, 201);
  const far = await file("Waiting Order", "Waiting far away", ada, there);
  await status(far, "stuck", graceBot);
  const tied = [...Object.values(w), far].map(idOf).join(", ");
  assert.equal(d1count(`UPDATE events SET at = '2026-10-22T12:00:00.000Z' WHERE item_id IN (${tied}) RETURNING 0 AS n`), 0);

  await check("GET /cards/waiting lists needs-you, stuck and landed, newest change first, with the count", async () => {
    const json = await waiting();
    assert.deepEqual(Object.keys(json).sort(), ["cards", "count"]);
    assert.ok(json.cards.length <= 500);
    assert.equal(json.count, json.cards.length);
    assert.ok(json.cards.every((cd) => WAITING_LANES.includes(cd.status)), JSON.stringify(json.cards.map((cd) => cd.status)));
    assert.ok(json.cards.every((cd) => cd.project !== null));
    for (const cd of json.cards) assert.deepEqual(Object.keys(cd).sort(), CARD_FIELDS);
    const at = json.cards.map((cd) => cd.changed_at);
    assert.deepEqual(at, [...at].sort().reverse());
    const ours = json.cards.map((cd) => cd.key).filter((key) => Object.values(w).includes(key) || key === far);
    assert.deepEqual(ours, [far, w.stuck, w.needs, w.landed], "changes made in one instant come back by the order they were made");
    assert.ok(json.cards.filter((cd) => ours.includes(cd.key)).every((cd) => cd.changed_at === "2026-10-22T12:00:00.000Z"));
    assert.equal(/@/.test(JSON.stringify(json)), false);
    const stuck = json.cards.find((cd) => cd.key === w.stuck);
    assert.deepEqual(stuck.links.map((l) => l.ref), ["pci#2732"]);
    assert.equal(stuck.changed_by.agent, true);
  });

  await check("waiting follows the host scope, and leaving a waiting lane takes the card off the list and the count", async () => {
    const all = await waiting();
    const near = await waiting(here);
    assert.ok(near.cards.every((cd) => cd.host === here));
    assert.equal(near.cards.some((cd) => cd.key === far), false);
    assert.equal(near.count, all.count - all.cards.filter((cd) => cd.host !== here).length);
    assert.deepEqual((await waiting(there)).cards.filter((cd) => cd.project === "Waiting Order").map((cd) => cd.key), [far]);
    await status(w.needs, "planned");
    const after = await waiting();
    assert.equal(after.count, all.count - 1);
    assert.equal(after.cards.some((cd) => cd.key === w.needs), false);
    await comment(w.stuck, ada);
    assert.equal((await waiting()).cards.find((cd) => cd.key === w.stuck).status, "stuck", "a person's comment moves only a needs-you card");
  });

  await check("only Owners read waiting; /me carries counts.waiting for an Owner and null for a User", async () => {
    const visitor = await mint("Mary Somerville", "mary@example.com", [here]);
    assert.equal((await browse("GET", "/cards/waiting", visitor.secret)).status, 403);
    const mine = await browse("GET", "/me", visitor.secret);
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json.counts.waiting, null);
    const boss = await mint("Emmy Noether", "emmy@example.com", [here], true);
    const seen = await browse("GET", "/cards/waiting", boss.secret);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    assert.ok(seen.json.cards.every((cd) => cd.host === here));
    const me = await browse("GET", "/me", boss.secret);
    assert.equal(me.status, 200);
    assert.equal(typeof me.json.counts.waiting, "number");
    assert.equal(me.json.counts.waiting, seen.json.count);
    assert.equal(me.json.counts.waiting, (await waiting(here)).count);
  });

  await check("a project change is quiet: it never reopens, moves, mails or tells the visitor", async () => {
    const visitor = await mint("Mary Somerville", "mary@example.com", [here]);
    const filed = await browse("POST", "/issues", visitor.secret, issueBody({ title: "A visitor's report" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    assert.equal((await call("PATCH", `/_p99/v1/issues/${key}`, { actor: ada, body: { status: "done" } })).status, 200);
    const loud = ["status", "label"];
    const before = counted(key, loud);
    const since = new Date().toISOString();
    const made = await call("PATCH", `/_p99/v1/issues/${key}`, { actor: ada, body: { project: "Splicer" } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.card.status, "done");
    assert.equal(made.json.card.lane, null);
    const stored = (await call("GET", `/_p99/v1/issues/${key}`, { actor: ada })).json;
    assert.equal(stored.issue.stage, "fixed");
    assert.ok(stored.issue.closed_at);
    assert.equal(counted(key, loud), before);
    assert.equal(mailedSince(key, since), 0);
    const project = stored.events.filter((ev) => ev.kind === "project");
    assert.equal(project.length, 1);
    assert.deepEqual(project[0].detail, { from: null, to: "Splicer" });
    assert.equal(d1count(`SELECT count(*) AS n FROM events WHERE item_id = ${idOf(key)} AND kind = 'project' AND internal = 1`), 1);
    const theirs = await browse("GET", `/issues/${key}`, visitor.secret);
    assert.equal(theirs.status, 200, JSON.stringify(theirs.json));
    assert.equal((theirs.json.events ?? []).some((ev) => ev.kind === "project"), false);

    const open = (await browse("POST", "/issues", visitor.secret, issueBody({ title: "An open report" }))).json.key;
    assert.equal((await call("PATCH", `/_p99/v1/issues/${open}`, { actor: ada, body: { status: "doing" } })).status, 200);
    const openBefore = counted(open, loud);
    const openSince = new Date().toISOString();
    const carded = await call("PATCH", `/_p99/v1/issues/${open}`, { actor: graceBot, body: { project: "Splicer" } });
    assert.equal(carded.status, 200, JSON.stringify(carded.json));
    assert.equal(carded.json.card.status, "in-progress");
    assert.equal(counted(open, loud), openBefore);
    const dropped = await call("PATCH", `/_p99/v1/issues/${open}`, { actor: ada, body: { project: null } });
    assert.equal(dropped.status, 200);
    assert.equal(dropped.json.label, "In progress");
    assert.equal(counted(open, loud), openBefore);
    assert.equal(mailedSince(open, openSince), 0);
  });

  await check("a User's comment on their own card in needs-you leaves it there, with no move", async () => {
    const visitor = await mint("Mary Somerville", "mary@example.com", [here]);
    const filed = await browse("POST", "/issues", visitor.secret, issueBody({ title: "A report that became a card" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    assert.equal((await call("PATCH", `/_p99/v1/issues/${key}`, { actor: ada, body: { project: "Needs Visitor" } })).status, 200);
    await status(key, "planned");
    await status(key, "needs-you", graceBot);
    const moves = counted(key, ["label"]);
    const said = await browse("POST", `/issues/${key}/comments`, visitor.secret, { client_uid: randomUUID(), body: "Any news?" });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    assert.equal((await card(key)).status, "needs-you");
    assert.equal(counted(key, ["label"]), moves);
    assert.equal((await events(key, "comment")).length, 1);
  });

  await check("an agent's --no-project is refused with the contract's line and changes nothing", async () => {
    const key = await file("Needs Uncard", "Stays a card");
    await status(key, "landed", graceBot);
    const before = counted(key, ["project", "label", "status"]);
    const refusedPatch = await call("PATCH", `/_p99/v1/issues/${key}`, { actor: graceBot, body: { project: null } });
    assert.equal(refusedPatch.status, 403);
    assert.equal(refusedPatch.json.message, PERSON_UNCARDS);
    assert.equal(counted(key, ["project", "label", "status"]), before);
    const still = await card(key);
    assert.equal(still.project, "Needs Uncard");
    assert.equal(still.status, "landed");
  });

  await check("count is the whole number of waiting cards when more than 500 wait, and the list stops at 500", async () => {
    const source = await file("Waiting Many", "The card copied", ada);
    await status(source, "stuck", graceBot);
    const before = await waiting();
    const columns = d1count("SELECT group_concat(name, ', ') AS n FROM pragma_table_info('items') WHERE name NOT IN ('id', 'client_uid')");
    let seeded = false;
    try {
      assert.equal(
        d1count(
          `WITH RECURSIVE k(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM k WHERE x < 501)
           INSERT INTO items (client_uid, ${columns}) SELECT 'seed-waiting-' || x, ${columns} FROM items, k WHERE items.id = ${idOf(source)} RETURNING 0 AS n`,
        ),
        0,
      );
      seeded = true;
      const many = await waiting();
      assert.equal(many.count, before.count + 501);
      assert.equal(many.cards.length, 500);
      assert.ok(many.count > many.cards.length);
      const boss = await mint("Sophie Germain", "sophie@example.com", [here], true);
      const me = await browse("GET", "/me", boss.secret);
      assert.equal(me.status, 200, JSON.stringify(me.json));
      assert.ok(me.json.counts.waiting > 500, JSON.stringify(me.json.counts));
      assert.equal(me.json.counts.waiting, (await waiting(here)).count);
    } finally {
      if (seeded) d1count("DELETE FROM items WHERE client_uid LIKE 'seed-waiting-%' RETURNING 0 AS n");
    }
    assert.equal((await waiting()).count, before.count);
  });
}

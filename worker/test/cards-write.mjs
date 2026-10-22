import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LANES, LANE_NAMES, PERSON_CLOSES, PROJECT_RULE, notCard } from "../src/cards.js";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const adaBot = { email: "ada@example.com", name: "Ada Lovelace", agent: true, via: "pci" };
const graceBot = { email: "grace@example.com", name: "Grace Hopper", agent: true, via: "pci·splicer·writer" };
const STATUS_RULE = "status must be new, planned, in-progress, stuck, landed or done";
const CARDS_CLOSES = "a Cards board lane keeps its closes; done alone closes a card";
const idOf = (key) => Number(key.split("-")[1]);

export async function cardWriteChecks({ call, browse, mint, check, issueBody, here, there, d1count }) {
  const file = (body, actor = ada, scope = "") =>
    call("POST", `/_p99/v1/cards${scope}`, { actor, body: { client_uid: randomUUID(), project: "Splicer", title: "Export keeps every audio track", host: here, ...body } });
  const status = (key, word, actor = ada, extra = {}) => call("POST", `/_p99/v1/cards/${key}/status`, { actor, body: { status: word, ...extra } });
  const link = (key, body, actor = graceBot) => call("POST", `/_p99/v1/cards/${key}/links`, { actor, body });
  const comment = (key, body, actor = ada) => call("POST", `/_p99/v1/cards/${key}/comments`, { actor, body: { client_uid: randomUUID(), ...body } });
  const issue = async (key) => (await call("GET", `/_p99/v1/issues/${key}`, { actor: ada })).json;
  const boards = async (actor = ada) => (await call("GET", "/_p99/v1/boards", { actor })).json.boards;
  const cardsBoard = async (actor = ada) => (await boards(actor)).filter((b) => b.name === "Cards");
  const doneName = async () => (await call("GET", "/_p99/v1/labels", { actor: ada })).json.labels[3].name;
  const inboxName = async () => (await call("GET", "/_p99/v1/labels", { actor: ada })).json.labels[0].name;
  const laneKeys = async (boardId, label, among) =>
    (await call("GET", `/_p99/v1/boards/${boardId}`, { actor: ada })).json.cards.filter((cd) => cd.label === label && among.includes(cd.key)).map((cd) => cd.key);
  const plain = async (title) => {
    const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { actor: ada, body: issueBody({ title }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    return filed.json.key;
  };

  let first;
  let board;
  let owner;

  await check("two first cards filed at once make one Cards board with its six lanes in order; a later filer reuses it", async () => {
    const [made, raced] = await Promise.all([file({ project: "Splicer" }), file({ project: "Splicer", title: "Raced in" }, graceBot)]);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(raced.status, 201, JSON.stringify(raced.json));
    first = made.json.card;
    assert.equal(first.project, "Splicer");
    assert.equal(first.status, "new");
    assert.equal(first.label, LANE_NAMES[0]);
    assert.equal(first.kind, "feature");
    assert.match(first.key, /^FEAT-\d+$/);
    assert.equal(first.host, here);
    assert.deepEqual(first.reporter, { name: "Ada Lovelace", username: first.reporter.username, agent: false, via: null });
    assert.equal(raced.json.card.label, LANE_NAMES[0]);
    const listed = await cardsBoard();
    assert.equal(listed.length, 1);
    board = listed[0];
    assert.deepEqual(board.columns.slice(0, 5).map((col) => col.label), LANE_NAMES.slice(0, 5));
    assert.equal(board.columns.length, 6);
    assert.equal(board.columns[5].label, await doneName());
    assert.equal(board.columns[5].closes, true);
    assert.ok(board.columns.slice(0, 5).every((col) => !col.closes));
    const seen = await cardsBoard(graceBot);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, board.id);
    assert.notEqual(seen[0].mine, board.mine, "exactly one of the two filers owns the Cards board");
    owner = board.mine ? ada : graceBot;
    assert.deepEqual((await laneKeys(board.id, LANE_NAMES[0], [first.key, raced.json.card.key])).sort(), [first.key, raced.json.card.key].sort());

    const second = await file({ project: "splicer", title: "Cut on silence" }, graceBot);
    assert.equal(second.status, 201, JSON.stringify(second.json));
    assert.equal(second.json.card.project, "Splicer");
    assert.equal(second.json.card.lane, 1);
    assert.deepEqual(second.json.card.reporter, { name: "Grace Hopper", username: second.json.card.reporter.username, agent: true, via: "pci·splicer·writer" });
    const again = await cardsBoard(graceBot);
    assert.equal(again.length, 1);
    assert.equal(again[0].id, board.id);
    assert.equal((await laneKeys(board.id, LANE_NAMES[0], [first.key, raced.json.card.key, second.json.card.key]))[0], second.json.card.key);
    const stored = await issue(first.key);
    assert.deepEqual(stored.events.map((ev) => ev.kind), ["created"]);
    assert.deepEqual(stored.events[0].detail, { kind: "feature", title: "Export keeps every audio track" });
  });

  await check("POST /cards: the project rule, kinds, titles, hosts, client_uid replays and who may file", async () => {
    for (const project of ["", "   ", "x".repeat(41), 7, null]) {
      const refused = await file({ project });
      assert.equal(refused.status, 400, JSON.stringify(project));
      assert.equal(refused.json.message, PROJECT_RULE);
    }
    const longest = await file({ project: "P".repeat(40) });
    assert.equal(longest.status, 201);
    assert.equal(longest.json.card.project, "P".repeat(40));
    const stripped = await file({ project: "  Pa\u0007per‎  " });
    assert.equal(stripped.status, 201);
    assert.equal(stripped.json.card.project, "Paper");
    assert.equal((await file({ project: "PAPER" })).json.card.project, "Paper");
    const bug = await file({ kind: "bug" });
    assert.equal(bug.json.card.kind, "bug");
    assert.match(bug.json.card.key, /^BUG-\d+$/);
    for (const kind of ["epic", "toString", "constructor", "__proto__", "hasOwnProperty", 3]) {
      const refused = await file({ kind });
      assert.equal(refused.status, 400, JSON.stringify(kind));
      assert.equal(refused.json.message, "kind must be bug, feature, improvement, question or task");
    }
    assert.equal((await file({ title: "" })).status, 400);
    assert.equal((await file({ title: 5 })).status, 400);
    assert.equal((await file({ body: "x".repeat(20001) })).status, 400);
    assert.equal((await file({ host: "nope.example.com" })).status, 400);
    assert.equal((await file({ host: undefined })).status, 400);
    const scoped = await file({ host: "nope.example.com" }, ada, `?host=${here}`);
    assert.equal(scoped.status, 201, JSON.stringify(scoped.json));
    assert.equal(scoped.json.card.host, here);
    assert.equal((await file({ client_uid: "bad uid" })).status, 400);
    assert.equal((await file({ client_uid: undefined })).status, 400);

    const uid = randomUUID();
    const once = await file({ client_uid: uid, title: "Filed once" });
    assert.equal(once.status, 201);
    const twice = await file({ client_uid: uid, title: "Filed twice" });
    assert.equal(twice.status, 200);
    assert.equal(twice.json.card.key, once.json.card.key);
    assert.equal(twice.json.card.title, "Filed once");
    assert.equal((await file({ client_uid: uid }, graceBot)).status, 409);
    const plainUid = randomUUID();
    assert.equal((await call("POST", `/_p99/v1/issues?host=${here}`, { actor: ada, body: issueBody({ client_uid: plainUid }) })).status, 201);
    assert.equal((await file({ client_uid: plainUid })).status, 409);

    const visitor = await mint("Ada Lovelace", "ada@example.com", [here]);
    const body = { client_uid: randomUUID(), project: "Splicer", title: "From a visitor" };
    assert.equal((await browse("POST", "/cards", visitor.secret, body)).status, 403);
    const manager = await mint("Margaret Hamilton", "margaret@example.com", [here], true);
    const fromPanel = await browse("POST", "/cards", manager.secret, { ...body, host: "nope.example.com" });
    assert.equal(fromPanel.status, 201, JSON.stringify(fromPanel.json));
    assert.equal(fromPanel.json.card.host, here);
    assert.equal(fromPanel.json.card.reporter.via, null);
  });

  await check("every status word moves a card to its lane, at the top; a same-lane status keeps the place", async () => {
    const a = (await file({ title: "Lane walker A" })).json.card.key;
    const b = (await file({ title: "Lane walker B" })).json.card.key;
    const done = await doneName();
    assert.deepEqual(await laneKeys(board.id, LANE_NAMES[0], [a, b]), [b, a]);
    for (const [i, word] of LANES.entries()) {
      if (i === 0) continue;
      for (const key of [b, a]) {
        const moved = await status(key, word);
        assert.equal(moved.status, 200, `${word}: ${JSON.stringify(moved.json)}`);
        assert.equal(moved.json.card.status, word);
        assert.equal(moved.json.card.label, i === 5 ? done : LANE_NAMES[i]);
        assert.equal(moved.json.card.lane, word === "done" ? null : 1);
        assert.equal("comment" in moved.json, false);
      }
      const order = await laneKeys(board.id, i === 5 ? done : LANE_NAMES[i], [a, b]);
      assert.deepEqual(i === 5 ? order.sort() : order, i === 5 ? [a, b].sort() : [a, b]);
    }
    for (const key of [a, b]) assert.equal((await status(key, "stuck")).status, 200);
    assert.deepEqual(await laneKeys(board.id, "Stuck", [a, b]), [b, a]);
    const kept = await status(a, "stuck");
    assert.equal(kept.status, 200);
    assert.equal(kept.json.card.lane, 2);
    assert.deepEqual(await laneKeys(board.id, "Stuck", [a, b]), [b, a]);
    const events = (await issue(a)).events.filter((ev) => ev.kind === "label");
    assert.deepEqual(events.at(-1).detail, { from: done, to: "Stuck" });
    for (const word of ["blocked", "Done", "", 3, null]) {
      const refused = await status(a, word);
      assert.equal(refused.status, 400, JSON.stringify(word));
      assert.equal(refused.json.message, STATUS_RULE);
    }
  });

  await check("done closes a card as fixed and any other word reopens it", async () => {
    const key = (await file({ title: "Closes and reopens" })).json.card.key;
    assert.equal((await status(key, "done")).status, 200);
    let stored = await issue(key);
    assert.equal(stored.issue.stage, "fixed");
    assert.equal(stored.issue.resolution, "fixed");
    assert.ok(stored.issue.closed_at);
    const again = await status(key, "done");
    assert.equal(again.status, 200);
    assert.equal(again.json.card.lane, null);
    const reopened = await status(key, "planned");
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.card.status, "planned");
    assert.equal(d1count(`SELECT count(*) AS n FROM board_positions WHERE item_id = ${idOf(key)} AND label_id = (SELECT id FROM labels WHERE role = 'done')`), 0);
    stored = await issue(key);
    assert.equal(stored.issue.stage, "in_progress");
    assert.equal(stored.issue.resolution, null);
    assert.equal(stored.issue.closed_at, null);
    const statusEvents = stored.events.filter((ev) => ev.kind === "status").map((ev) => ev.detail.to);
    assert.deepEqual(statusEvents, ["fixed", "in_progress"]);
  });

  await check("only a person closes a card: an agent is refused on /status done, /move into the closing lane and PATCH status", async () => {
    const key = (await file({ title: "Agent tries to close" })).json.card.key;
    const done = await doneName();
    const byStatus = await status(key, "done", graceBot);
    assert.equal(byStatus.status, 403);
    assert.equal(byStatus.json.message, PERSON_CLOSES);
    const withNote = await status(key, "done", graceBot, { note: "Shipped", client_uid: randomUUID() });
    assert.equal(withNote.status, 403);
    assert.equal((await issue(key)).comments.length, 0);
    assert.equal((await status(key, "landed", graceBot)).status, 200);
    const byMove = await call("POST", "/_p99/v1/move", { actor: adaBot, body: { key, from: "Landed", to: done, board: board.id } });
    assert.equal(byMove.status, 403);
    assert.equal(byMove.json.message, PERSON_CLOSES);
    const byPatch = await call("PATCH", `/_p99/v1/issues/${key}`, { actor: graceBot, body: { status: "done" } });
    assert.equal(byPatch.status, 403);
    assert.equal(byPatch.json.message, PERSON_CLOSES);
    const before = (await issue(key)).events.length;
    for (const body of [
      { title: "Renamed by an agent", status: "done" },
      { kind: "bug", assignee: null, body: "New details", status: "done" },
      { resolution: "abandoned", title: "Abandoned by an agent" },
    ]) {
      const mixed = await call("PATCH", `/_p99/v1/issues/${key}`, { actor: graceBot, body });
      assert.equal(mixed.status, 403, JSON.stringify(body));
      assert.equal(mixed.json.message, PERSON_CLOSES);
    }
    let stored = await issue(key);
    assert.equal(stored.issue.title, "Agent tries to close");
    assert.equal(stored.issue.kind, "feature");
    assert.equal(stored.issue.body, "");
    assert.equal(stored.events.length, before);
    assert.equal(stored.issue.stage, "in_progress");
    assert.equal(stored.issue.label, "Landed");
    const personMove = await call("POST", "/_p99/v1/move", { actor: ada, body: { key, from: "Landed", to: done, board: board.id } });
    assert.equal(personMove.status, 200, JSON.stringify(personMove.json));
    assert.equal((await issue(key)).issue.stage, "fixed");
    assert.equal((await status(key, "landed", graceBot)).status, 200);
    const personPatch = await call("PATCH", `/_p99/v1/issues/${key}`, { actor: ada, body: { status: "done" } });
    assert.equal(personPatch.status, 200);
    assert.equal(personPatch.json.stage, "fixed");
    stored = await issue(key);
    assert.equal(stored.issue.resolution, "fixed");
    const redone = await status(key, "done", graceBot);
    assert.equal(redone.status, 403, "done is a person's word even on a card that is already done");
    assert.equal(redone.json.message, PERSON_CLOSES);

    const item = await plain("An agent may still close a plain item");
    const plainClose = await call("PATCH", `/_p99/v1/issues/${item}`, { actor: graceBot, body: { status: "done" } });
    assert.equal(plainClose.status, 200);
    assert.equal(plainClose.json.stage, "fixed");
  });

  await check("a status note is a comment in the same write; its client_uid replays it once", async () => {
    const key = (await file({ title: "Stuck with a reason" })).json.card.key;
    const uid = randomUUID();
    const stuck = await status(key, "stuck", graceBot, { note: "  Waiting on the codec  ", client_uid: uid });
    assert.equal(stuck.status, 200, JSON.stringify(stuck.json));
    assert.equal(stuck.json.card.status, "stuck");
    assert.equal(stuck.json.comment.body, "Waiting on the codec");
    assert.equal(stuck.json.comment.internal, false);
    assert.deepEqual(stuck.json.comment.author, { name: "Grace Hopper", username: stuck.json.comment.author.username, agent: true, via: "pci·splicer·writer" });
    assert.equal("email" in stuck.json.comment.author, false);
    const replay = await status(key, "stuck", graceBot, { note: "Waiting on the codec", client_uid: uid });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.comment.id, stuck.json.comment.id);
    let stored = await issue(key);
    assert.equal(stored.comments.length, 1);
    assert.equal(stored.issue.comments, 1);
    assert.equal(stored.events.filter((ev) => ev.kind === "comment").length, 1);
    const sameLane = await status(key, "stuck", ada, { note: "Still waiting", client_uid: randomUUID() });
    assert.equal(sameLane.status, 200);
    assert.equal(sameLane.json.comment.author.agent, false);
    assert.equal(sameLane.json.comment.author.via, null);
    stored = await issue(key);
    assert.equal(stored.comments.length, 2);
    assert.equal((await status(key, "planned", ada, { note: "No uid" })).status, 400);
    assert.equal((await status(key, "planned", ada, { note: 5, client_uid: randomUUID() })).status, 400);
    assert.equal((await status(key, "planned", ada, { note: "x".repeat(20001), client_uid: randomUUID() })).status, 400);
    const scoped = await call("POST", `/_p99/v1/cards/${key}/status?host=${there}`, { actor: ada, body: { status: "planned" } });
    assert.equal(scoped.status, 404);
    assert.equal(scoped.json.message, `no item ${key}`);
    assert.equal((await issue(key)).issue.label, "Stuck");
    const blank = await status(key, "planned", ada, { note: "   " });
    assert.equal(blank.status, 200);
    assert.equal("comment" in blank.json, false);
    const other = (await file({ title: "Another card" })).json.card.key;
    assert.equal((await status(other, "stuck", graceBot, { note: "Reused", client_uid: uid })).status, 409);
    assert.equal((await issue(other)).issue.label, LANE_NAMES[0]);
  });

  await check("a link is a link event of 1 to 200 characters with an optional note of up to 200", async () => {
    const key = (await file({ title: "Linked card" })).json.card.key;
    for (const ref of ["", "   ", "r".repeat(201), 42, undefined]) {
      const refused = await link(key, { ref });
      assert.equal(refused.status, 400, JSON.stringify(ref));
      assert.equal(refused.json.message, "a link has 1 to 200 characters");
    }
    const one = await link(key, { ref: "x" });
    assert.equal(one.status, 201, JSON.stringify(one.json));
    assert.deepEqual(one.json.link.note, null);
    const long = await link(key, { ref: "r".repeat(200), note: "n".repeat(200) });
    assert.equal(long.status, 201);
    assert.equal(long.json.link.ref, "r".repeat(200));
    assert.equal(long.json.link.note, "n".repeat(200));
    const tooLong = await link(key, { ref: "pci#1", note: "n".repeat(201) });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.json.message, "a note has at most 200 characters");
    assert.equal((await link(key, { ref: "pci#1", note: 7 })).status, 400);
    const made = await link(key, { ref: " pci#2700 ", note: "Splicer export" });
    assert.equal(made.status, 201);
    assert.equal(made.json.key, key);
    assert.equal(made.json.link.ref, "pci#2700");
    assert.equal(made.json.link.note, "Splicer export");
    assert.deepEqual(made.json.link.by, { name: "Grace Hopper", username: made.json.link.by.username, agent: true, via: "pci·splicer·writer" });
    assert.match(made.json.link.at, /^\d{4}-\d{2}-\d{2}T/);
    const byPerson = await link(key, { ref: "v1.2.0" }, ada);
    assert.equal(byPerson.json.link.by.via, null);
    const blankNote = await link(key, { ref: "pci#2701", note: "   " });
    assert.equal(blankNote.status, 201);
    assert.equal(blankNote.json.link.note, null);
    const scoped = await call("POST", `/_p99/v1/cards/${key}/links?host=${there}`, { actor: graceBot, body: { ref: "pci#9" } });
    assert.equal(scoped.status, 404);
    assert.equal(scoped.json.message, `no item ${key}`);
    const events = (await issue(key)).events.filter((ev) => ev.kind === "link");
    assert.equal(events.length, 5);
    assert.deepEqual(events[4].detail, { ref: "pci#2701", note: null });
    assert.deepEqual(events[2].detail, { ref: "pci#2700", note: "Splicer export" });
    assert.equal(events[2].agent, true);
  });

  await check("card comments follow today's comment rules and answer with a person", async () => {
    const key = (await file({ title: "Commented card" })).json.card.key;
    const uid = randomUUID();
    const made = await comment(key, { client_uid: uid, body: "First pass is in" }, graceBot);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.key, key);
    assert.equal(made.json.comment.body, "First pass is in");
    assert.equal(made.json.comment.internal, false);
    assert.equal(made.json.comment.author.agent, true);
    assert.equal("email" in made.json.comment.author, false);
    assert.deepEqual(Object.keys(made.json.comment).sort(), ["author", "body", "created_at", "id", "internal"]);
    const replay = await comment(key, { client_uid: uid, body: "First pass is in" }, graceBot);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.comment.id, made.json.comment.id);
    const internal = await comment(key, { body: "Between us", internal: true });
    assert.equal(internal.status, 201);
    assert.equal(internal.json.comment.internal, true);
    assert.equal((await comment(key, { body: "" })).status, 400);
    assert.equal((await comment(key, { body: "x", internal: "yes" })).status, 400);
    assert.equal((await comment(key, { body: "x", client_uid: "bad uid" })).status, 400);
    assert.equal((await issue(key)).comments.length, 2);
  });

  await check("a plain item is refused on status, links and comments, and an unknown key is no item", async () => {
    const item = await plain("Not a card");
    const why = notCard(item);
    for (const refused of [await status(item, "planned"), await link(item, { ref: "pci#1" }), await comment(item, { body: "Hello" })]) {
      assert.equal(refused.status, 409);
      assert.equal(refused.json.message, why);
    }
    const stored = await issue(item);
    assert.equal(stored.comments.length, 0);
    assert.equal(stored.events.some((ev) => ev.kind === "link"), false);
    for (const missing of [await status("FEAT-999999", "planned"), await link("FEAT-999999", { ref: "x" }), await comment("FEAT-999999", { body: "x" })]) {
      assert.equal(missing.status, 404);
      assert.equal(missing.json.message, "no item FEAT-999999");
    }
    assert.equal((await status("nonsense", "planned")).json.message, "no item nonsense");
    const visitor = await mint("Ada Lovelace", "ada@example.com", [here]);
    const key = (await file({ title: "Visitors can't touch" })).json.card.key;
    assert.equal((await browse("POST", `/cards/${key}/status`, visitor.secret, { status: "planned" })).status, 403);
    assert.equal((await browse("POST", `/cards/${key}/links`, visitor.secret, { ref: "x" })).status, 403);
    assert.equal((await browse("POST", `/cards/${key}/comments`, visitor.secret, { client_uid: randomUUID(), body: "x" })).status, 403);
  });

  await check("PATCH project turns an item into a card in lane new, renames it, and null sends it back to Inbox and off the Cards board", async () => {
    const item = await plain("Becomes a card");
    const patch = (body, actor = ada) => call("PATCH", `/_p99/v1/issues/${item}`, { actor, body });
    const made = await patch({ project: "  splicer " });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.card.key, item);
    assert.equal(made.json.card.project, "Splicer");
    assert.equal(made.json.card.status, "new");
    assert.equal(made.json.card.lane, 1);
    assert.deepEqual(await laneKeys(board.id, LANE_NAMES[0], [item]), [item]);
    assert.equal((await status(item, "stuck")).status, 200);
    const renamed = await patch({ project: "Paper" });
    assert.equal(renamed.json.card.project, "Paper");
    assert.equal(renamed.json.card.status, "stuck");
    const same = await patch({ project: "PAPER" });
    assert.equal(same.status, 200);
    assert.equal(same.json.card.project, "Paper");
    let events = (await issue(item)).events.filter((ev) => ev.kind === "project").map((ev) => ev.detail);
    assert.deepEqual(events, [{ from: null, to: "Splicer" }, { from: "Splicer", to: "Paper" }]);

    assert.equal(d1count(`SELECT count(*) AS n FROM board_positions WHERE item_id = ${idOf(item)} AND board_id = ${board.id}`), 1);
    assert.equal((await status(item, "done")).status, 200);
    const back = await patch({ project: null }, graceBot);
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal(back.json.key, item);
    assert.equal(back.json.label, await inboxName());
    assert.equal(back.json.stage, "received");
    assert.equal("card" in back.json, false);
    assert.equal(d1count(`SELECT count(*) AS n FROM board_positions WHERE item_id = ${idOf(item)} AND board_id = ${board.id}`), 0);
    events = (await issue(item)).events.filter((ev) => ev.kind === "project").map((ev) => ev.detail);
    assert.deepEqual(events.at(-1), { from: "Paper", to: null });
    assert.equal((await status(item, "planned")).status, 409);
    const noop = await patch({ project: null });
    assert.equal(noop.status, 200);
    assert.equal((await issue(item)).events.filter((ev) => ev.kind === "project").length, 3);
    const again = await patch({ project: "Paper" });
    assert.equal(again.json.card.status, "new");
    assert.equal(again.json.card.lane, 1);
    const umlaut = await patch({ project: "Ärger" });
    assert.equal(umlaut.json.card.project, "Ärger");
    const lower = await patch({ project: "ärger" });
    assert.equal(lower.status, 200);
    assert.equal(lower.json.card.project, "ärger", "the column folds ASCII only, so Ärger and ärger are two projects");
    events = (await issue(item)).events.filter((ev) => ev.kind === "project").map((ev) => ev.detail);
    assert.deepEqual(events.slice(-2), [{ from: "Paper", to: "Ärger" }, { from: "Ärger", to: "ärger" }]);

    for (const project of ["", "x".repeat(41), 3]) {
      const refused = await patch({ project });
      assert.equal(refused.status, 400);
      assert.equal(refused.json.message, PROJECT_RULE);
    }
    const mixed = await patch({ project: "Paper", title: "Renamed too" });
    assert.equal(mixed.status, 400);
    assert.equal((await issue(item)).issue.title, "Becomes a card");
    const visitor = await mint("Ada Lovelace", "ada@example.com", [here]);
    const own = await browse("POST", "/issues", visitor.secret, issueBody({ title: "Mine to keep" }));
    assert.equal(own.status, 201);
    assert.equal((await browse("PATCH", `/issues/${own.json.key}`, visitor.secret, { project: "Splicer" })).status, 403);
  });

  await check("the Cards board keeps its lanes and stays, and never counts against a person's boards", async () => {
    const other = owner === ada ? graceBot : ada;
    const put = await call("PUT", `/_p99/v1/boards/${board.id}`, { actor: owner, body: { columns: ["New", "Planned", "Done"] } });
    assert.equal(put.status, 409);
    assert.match(put.json.message, /Cards board keeps its six lanes/);
    const renamed = await call("PUT", `/_p99/v1/boards/${board.id}`, { actor: owner, body: { name: "Cards" } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.columns.length, 6);
    const removed = await call("DELETE", `/_p99/v1/boards/${board.id}`, { actor: owner });
    assert.equal(removed.status, 409);
    assert.equal(removed.json.message, "the Cards board stays");
    assert.equal((await call("DELETE", `/_p99/v1/boards/${board.id}`, { actor: other })).status, 403);
    assert.equal((await cardsBoard()).length, 1);

    const own = (await boards()).filter((b) => b.mine && b.name !== "Cards");
    assert.equal(own.length, 1, "Ada still keeps a personal board beside the Cards board");
    const made = [];
    for (const name of ["Second", "Third"]) {
      const posted = await call("POST", "/_p99/v1/boards", { actor: ada, body: { name, columns: [await inboxName(), "Planned", await doneName()] } });
      assert.equal(posted.status, 201, JSON.stringify(posted.json));
      made.push(posted.json.id);
    }
    assert.equal((await call("POST", "/_p99/v1/boards", { actor: ada, body: { name: "Fourth", columns: [await inboxName(), "Planned", "Stuck"] } })).status, 409);
    for (const id of made) assert.equal((await call("DELETE", `/_p99/v1/boards/${id}`, { actor: ada })).status, 204);
    const last = await call("DELETE", `/_p99/v1/boards/${own[0].id}`, { actor: ada });
    assert.equal(last.status, 409);
    assert.equal(last.json.message, "that is your last board here; it stays");
    assert.deepEqual((await cardsBoard())[0].columns.slice(0, 5).map((col) => col.label), LANE_NAMES.slice(0, 5));
  });

  await check("merging a card closes it, so only a person merges one; an agent's refused merge leaves nothing behind", async () => {
    const target = (await file({ title: "Merge target" })).json.card.key;
    const source = (await file({ title: "Merge source" })).json.card.key;
    const loose = await plain("A plain duplicate");
    const merge = (items, actor) => call("POST", "/_p99/v1/merge", { actor, body: { items, into: target } });
    const refused = await merge([loose, source], graceBot);
    assert.equal(refused.status, 403);
    assert.equal(refused.json.message, PERSON_CLOSES);
    for (const key of [source, loose, target]) {
      const stored = await issue(key);
      assert.equal(stored.issue.duplicate_of, null, key);
      assert.equal(stored.issue.closed_at, null, key);
      assert.equal(stored.events.some((ev) => ev.kind === "merge"), false, key);
    }
    const byAgent = await merge([loose], graceBot);
    assert.equal(byAgent.status, 200, JSON.stringify(byAgent.json));
    assert.deepEqual(byAgent.json.merged, [loose]);
    const byPerson = await merge([source], ada);
    assert.equal(byPerson.status, 200, JSON.stringify(byPerson.json));
    assert.deepEqual(byPerson.json.merged, [source]);
    const merged = await issue(source);
    assert.equal(merged.issue.resolution, "duplicate");
    assert.equal(merged.issue.duplicate_of, target);
    assert.ok(merged.issue.closed_at);
  });

  await check("a Cards lane's closes flag stays as it is on every board; a lane that closes by mistake still leaves done the only close", async () => {
    const inbox = await inboxName();
    const done = await doneName();
    const posts = [
      [ada, [inbox, { label: "Landed", closes: true }, done]],
      [graceBot, [inbox, { label: "Stuck", closes: true }, done]],
      [ada, [inbox, "Planned", { label: done, closes: false }]],
    ];
    for (const [actor, columns] of posts) {
      const posted = await call("POST", "/_p99/v1/boards", { actor, body: { name: "Flipper", columns } });
      assert.equal(posted.status, 409, JSON.stringify(columns));
      assert.equal(posted.json.message, CARDS_CLOSES);
    }
    assert.equal((await boards()).some((b) => b.name === "Flipper"), false);
    const own = (await boards()).find((b) => b.mine && b.name !== "Cards");
    const put = await call("PUT", `/_p99/v1/boards/${own.id}`, { actor: ada, body: { columns: [inbox, { label: "In progress", closes: true }, done] } });
    assert.equal(put.status, 409);
    assert.equal(put.json.message, CARDS_CLOSES);
    const same = await call("POST", "/_p99/v1/boards", { actor: ada, body: { name: "Same closes", columns: [inbox, { label: "Landed", closes: false }, { label: done, closes: true }] } });
    assert.equal(same.status, 201, JSON.stringify(same.json));
    assert.equal((await call("DELETE", `/_p99/v1/boards/${same.json.id}`, { actor: ada })).status, 204);
    assert.deepEqual((await cardsBoard())[0].columns.map((col) => col.closes), [false, false, false, false, false, true]);

    const key = (await file({ title: "Lands without closing" })).json.card.key;
    assert.equal(d1count("UPDATE labels SET closes = 1 WHERE name = 'Landed' RETURNING 0 AS n"), 0);
    try {
      const landed = await status(key, "landed", graceBot);
      assert.equal(landed.status, 200, JSON.stringify(landed.json));
      assert.equal(landed.json.card.status, "landed");
      const stored = await issue(key);
      assert.equal(stored.issue.closed_at, null);
      assert.equal(stored.issue.resolution, null);
    } finally {
      d1count("UPDATE labels SET closes = 0 WHERE name = 'Landed' RETURNING 0 AS n");
    }
  });
}

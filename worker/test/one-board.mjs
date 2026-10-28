import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LANES, LANE_NAMES, PERSON_CLOSES } from "../src/cards.js";
import { BOARDS_GONE } from "../src/one-board.js";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const adaBot = { email: "ada@example.com", name: "Ada Lovelace", agent: true, via: "pci·board" };
const kate = { email: "margaret@example.com", name: "Margaret Hamilton", agent: false };
const BOARD_CARD = ["assignee", "changed_at", "changed_by", "host", "key", "kind", "label", "lane", "order", "project", "status", "title"];

export async function oneBoardChecks({ call, browse, mint, check, issueBody, here, there, d1count }) {
  const board = async (query = "", actor = ada) => call("GET", `/_p99/v1/board${query}`, { actor });
  const keysIn = async (word, among, query = "") => (await board(query)).json.cards.filter((cd) => cd.status === word && among.includes(cd.key)).map((cd) => cd.key);
  const move = (body, actor = ada, scope = `?host=${here}`) => call("POST", `/_p99/v1/move${scope}`, { actor, body });
  const fileOn = async (host, title, actor = ada) => {
    const filed = await call("POST", `/_p99/v1/issues?host=${host}`, { actor, body: issueBody({ title }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    return filed.json.key;
  };
  const card = async (title, project = "Splicer") => {
    const filed = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project, title, host: here } });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    return filed.json.card.key;
  };
  const owner = await mint("Margaret Hamilton", "margaret@example.com", [here], true);
  const user = await mint("Linus Torvalds", "linus@example.com", [here]);
  const cardsBoardId = d1count("SELECT id AS n FROM boards WHERE cards = 1");

  await check("[board] GET /board answers the seven lanes in order and every item in lane order, each card in the contract's shape", async () => {
    const plain = await fileOn(here, "On the one board");
    const read = await board(`?host=${here}`);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.deepEqual(read.json.board.lanes.map((l) => l.word), LANES);
    assert.deepEqual(read.json.board.lanes.map((l) => l.closes), [false, false, false, false, false, false, true]);
    assert.equal(read.json.board.lanes.length, LANE_NAMES.length);
    const found = read.json.cards.find((cd) => cd.key === plain);
    assert.ok(found, JSON.stringify(read.json.cards.map((cd) => cd.key)));
    assert.deepEqual(Object.keys(found).sort(), BOARD_CARD);
    assert.deepEqual([found.status, found.project, found.host, found.assignee, found.lane >= 1], ["new", null, here, null, true]);
    assert.deepEqual([found.changed_by.name, found.changed_by.agent, found.changed_by.via], ["Ada Lovelace", false, null]);
    assert.match(found.changed_by.username, /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/);
    const lanes = read.json.cards.map((cd) => LANES.indexOf(cd.status));
    assert.deepEqual(lanes, [...lanes].sort((a, b) => a - b));
    for (const word of LANES.slice(0, -1)) {
      const places = read.json.cards.filter((cd) => cd.status === word).map((cd) => cd.lane);
      assert.deepEqual(places, places.map((_, i) => i + 1), word);
    }
    assert.ok(read.json.cards.filter((cd) => cd.status === "done").every((cd) => cd.lane === null));
    assert.equal(/@example\.com/.test(JSON.stringify(read.json)), false);
    const browser = await browse("GET", "/board", owner.secret);
    assert.equal(browser.status, 200, JSON.stringify(browser.json));
    assert.ok(browser.json.cards.some((cd) => cd.key === plain));
  });

  await check("[board] a User's code gets 403 on the board, the old boards, the labels and a move", async () => {
    const plain = await fileOn(here, "A User can't move this");
    for (const path of ["/board", "/boards", "/boards/1", "/labels"]) assert.equal((await browse("GET", path, user.secret)).status, 403, path);
    assert.equal((await browse("POST", "/move", user.secret, { key: plain, from: "New", to: "planned" })).status, 403);
    assert.equal((await browse("POST", "/boards", user.secret, { name: "Mine", columns: ["New", "Done"] })).status, 403);
    assert.equal((await browse("PATCH", "/labels/1", user.secret, { name: "Mine" })).status, 403);
    assert.equal((await browse("POST", "/stream-ticket", user.secret)).status, 403);
  });

  await check("[board] any Owner moves by lane word or name and reorders with before and after; a stale from is 409 and nothing changes", async () => {
    const [a, b, c] = [await fileOn(here, "Move A"), await fileOn(here, "Move B"), await fileOn(here, "Move C")];
    const byWord = await move({ key: a, from: "New", to: "in-progress" });
    assert.equal(byWord.status, 200, JSON.stringify(byWord.json));
    assert.equal(byWord.json.card.label, "In progress");
    assert.match(byWord.json.card.order, /^[0-9A-Za-z]+$/);
    const byName = await browse("POST", "/move", owner.secret, { key: b, from: "new", to: "in PROGRESS", after: a, board: 999 });
    assert.equal(byName.status, 200, JSON.stringify(byName.json));
    assert.equal((await move({ key: c, from: "New", to: "In progress", before: a }, kate)).status, 200);
    assert.deepEqual(await keysIn("in-progress", [a, b, c]), [c, a, b]);
    assert.equal((await move({ key: c, from: "in-progress", to: "in-progress", after: b })).status, 200);
    assert.deepEqual(await keysIn("in-progress", [a, b, c]), [a, b, c]);
    const stale = await move({ key: a, from: "New", to: "stuck" });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.json, { error: "moved", message: "this card moved; refreshed" });
    assert.deepEqual(await keysIn("in-progress", [a, b, c]), [a, b, c]);
    const unknown = await move({ key: a, from: "In progress", to: "Doing" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.message, `Doing is not a lane; give ${LANES.join(", ")} or a lane's name`);
    assert.equal((await move({ key: a, from: "In progress", to: "stuck", before: b })).status, 400);
    assert.equal((await move({ key: a, from: "In progress", to: "planned", before: a })).status, 400);
    assert.equal((await move({ key: a, from: "In progress", to: "planned", before: b, after: c })).status, 400);
    assert.equal((await move({ key: "BUG-999999", from: "New", to: "planned" })).status, 404);
    assert.equal((await move({ key: a, to: "planned" })).status, 400);
    assert.equal((await move({ key: a, from: "In progress", to: "planned", before: 7 })).status, 400);
    const long = await move({ key: `BUG-${"1".repeat(40)}`, from: "In progress", to: "planned" });
    assert.deepEqual([long.status, long.json.message], [400, "key must be an item key"]);
    assert.equal((await call("GET", `/_p99/v1/issues/${a}?host=${here}`, { actor: ada })).json.issue.label, "In progress");
  });

  await check("[board] Done closes as fixed or the given resolution, any other lane reopens, and an agent can't close a card", async () => {
    const plain = await fileOn(here, "Close by lane");
    const closed = await move({ key: plain, from: "New", to: "done" });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    let issue = (await call("GET", `/_p99/v1/issues/${plain}?host=${here}`, { actor: ada })).json.issue;
    assert.deepEqual([issue.label, issue.resolution], ["Done", "fixed"]);
    assert.equal((await keysIn("done", [plain])).length, 1);
    assert.equal((await board(`?host=${here}&status=done`)).json.cards.find((cd) => cd.key === plain).lane, null);
    assert.equal((await move({ key: plain, from: "Done", to: "planned" })).status, 200);
    issue = (await call("GET", `/_p99/v1/issues/${plain}?host=${here}`, { actor: ada })).json.issue;
    assert.deepEqual([issue.label, issue.resolution], ["Planned", null]);
    const dropped = await move({ key: plain, from: "Planned", to: "Done", resolution: "abandoned" });
    assert.equal(dropped.status, 200, JSON.stringify(dropped.json));
    assert.equal((await call("GET", `/_p99/v1/issues/${plain}?host=${here}`, { actor: ada })).json.issue.resolution, "abandoned");
    assert.equal((await move({ key: plain, from: "Done", to: "new", resolution: "fixed" })).status, 400);
    const robot = await fileOn(here, "An agent closes a plain item");
    assert.equal((await move({ key: robot, from: "New", to: "done" }, adaBot)).status, 200);
    const key = await card("A card for a person to close");
    const refused = await move({ key, from: "New", to: "done" }, adaBot, "");
    assert.equal(refused.status, 403);
    assert.equal(refused.json.message, PERSON_CLOSES);
    assert.equal((await move({ key, from: "New", to: "Needs you" }, adaBot, "")).status, 200);
    assert.deepEqual(await keysIn("needs-you", [key], ""), [key]);
    assert.equal((await move({ key, from: "needs-you", to: "done" }, ada, "")).status, 200);
  });

  await check("[board] plain items and cards share the lanes, and the filter's views each show the right items", async () => {
    const plain = await fileOn(here, "Plain beside a card");
    const splicer = await card("A Splicer card");
    const paper = await card("A Paper card", "Paper");
    const far = await fileOn(there, "Far away");
    assert.equal((await move({ key: paper, from: "New", to: "landed" }, ada, "")).status, 200);
    const among = [plain, splicer, paper, far];
    const keys = async (query) => (await board(query)).json.cards.map((cd) => cd.key).filter((k) => among.includes(k));
    assert.deepEqual(new Set(await keys("")), new Set(among));
    assert.deepEqual(new Set(await keys("?project=splicer")), new Set([splicer]));
    assert.deepEqual(new Set(await keys("?project=Splicer&project=Paper")), new Set([splicer, paper]));
    assert.deepEqual(new Set(await keys(`?host=${there}`)), new Set([far]));
    assert.deepEqual(new Set(await keys("?status=landed")), new Set([paper]));
    assert.deepEqual(new Set(await keys("?status=new&status=landed")), new Set(among));
    assert.deepEqual(new Set(await keys("?source=human")), new Set(among));
    assert.deepEqual(await keys("?source=agent"), []);
    assert.equal((await board("?source=robot")).status, 400);
    assert.equal((await board("?status=blocked")).status, 400);
    assert.equal((await board(`?project=${"p".repeat(41)}`)).status, 400);
    const one = (await board("?project=Splicer")).json.cards.find((cd) => cd.key === splicer);
    assert.deepEqual([one.project, one.status, one.kind], ["Splicer", "new", "feature"]);
  });

  await check("[board] an Owner whose code reaches one host sees and moves only that host's items", async () => {
    const near = await fileOn(here, "Near enough");
    const far = await fileOn(there, "Out of reach");
    const seen = (await browse("GET", "/board", owner.secret)).json.cards;
    assert.ok(seen.some((cd) => cd.key === near));
    assert.equal(seen.some((cd) => cd.key === far), false);
    assert.ok(seen.every((cd) => cd.host === here));
    assert.equal((await browse("GET", `/board?host=${there}`, owner.secret)).json.cards.length, 0);
    assert.equal((await browse("POST", "/move", owner.secret, { key: far, from: "New", to: "planned" })).status, 404);
    assert.equal((await browse("POST", "/move", owner.secret, { key: near, from: "New", to: "planned", before: far })).status, 400);
    assert.equal((await move({ key: far, from: "New", to: "planned" }, ada, `?host=${there}`)).status, 200);
    const signed = (await board(`?host=${here}`)).json.cards;
    assert.ok(signed.every((cd) => cd.host === here));
  });

  await check("[board] GET /boards and GET /boards/{id} are gone: 410, the one board lives at /board, and every old board is deleted", async () => {
    for (const path of ["/_p99/v1/boards", "/_p99/v1/boards/950", `/_p99/v1/boards/${cardsBoardId}`, "/_p99/v1/boards/nope"]) {
      const gone = await call("GET", path, { actor: ada });
      assert.equal(gone.status, 410, path);
      assert.equal(gone.json.message, BOARDS_GONE);
    }
    for (const path of ["/boards", "/boards/950"]) assert.equal((await browse("GET", path, owner.secret)).status, 410, path);
    const thread = await call("GET", "/_p99/v1/issues/BUG-953?host=*", { actor: ada });
    assert.equal(thread.json.events.some((e) => e.kind === "priority"), false);
    assert.ok(thread.json.events.some((e) => e.kind === "label" && e.detail.migrated === true && e.detail.from === "Inbox" && e.detail.to === "New"));
    const now = await board();
    assert.equal(d1count("SELECT count(*) AS n FROM boards WHERE cards = 0"), 0);
    assert.equal(d1count("SELECT count(*) AS n FROM board_columns WHERE board_id IN (950, 951)"), 0);
    assert.equal(d1count("SELECT count(*) AS n FROM board_positions WHERE board_id <> (SELECT id FROM boards WHERE cards = 1)"), 0);
    const kept = ["BUG-951", "BUG-952", "BUG-953", "BUG-954", "BUG-955", "BUG-956", "BUG-957"];
    assert.deepEqual(kept.filter((key) => now.json.cards.some((cd) => cd.key === key)), kept);
  });

  await check("[board] creating, changing or deleting a board answers 410 and changes nothing", async () => {
    const before = d1count("SELECT count(*) AS n FROM boards");
    for (const [method, path, body] of [
      ["POST", "/_p99/v1/boards", { name: "QA", columns: ["New", "QA ready", "Done"] }],
      ["PUT", "/_p99/v1/boards/950", { name: "Renamed" }],
      ["DELETE", "/_p99/v1/boards/950", undefined],
      ["PUT", `/_p99/v1/boards/${cardsBoardId}`, { columns: ["New", "Done"] }],
    ]) {
      const gone = await call(method, path, { actor: ada, body });
      assert.equal(gone.status, 410, `${method} ${path}`);
      assert.equal(gone.json.message, BOARDS_GONE);
    }
    assert.equal((await browse("POST", "/boards", owner.secret, { name: "Mine", columns: ["New", "Done"] })).status, 410);
    assert.equal(d1count("SELECT count(*) AS n FROM boards"), before);
  });

  await check("[board] /labels answers the seven lanes only; a lane renames everywhere, a deleted old label frees its name, a one-host Owner can't rename", async () => {
    const labels = (await call("GET", "/_p99/v1/labels", { actor: ada })).json.labels;
    assert.deepEqual(labels.map((l) => l.word), LANES);
    assert.deepEqual(labels.map((l) => l.closes), [false, false, false, false, false, false, true]);
    assert.ok(labels.every((l) => l.boards.length === 1 && l.boards[0].id === cardsBoardId));
    const planned = labels[1];
    const renamed = await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "Next up" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.deepEqual(renamed.json, { id: planned.id, name: "Next up", closes: false });
    assert.equal((await board()).json.board.lanes[1].label, "Next up");
    const plain = await fileOn(here, "Next up by name");
    assert.equal((await move({ key: plain, from: "New", to: "next UP" })).status, 200);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: planned.name } })).status, 200);
    const taken = await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "stuck" } });
    assert.deepEqual([taken.status, taken.json.message], [409, "a label called stuck exists"]);
    assert.equal(d1count("SELECT count(*) AS n FROM labels WHERE name = 'legacy tag'"), 0);
    const freed = await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "LEGACY tag" } });
    assert.deepEqual([freed.status, freed.json.name], [200, "LEGACY tag"]);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: planned.name } })).status, 200);
    assert.equal((await board()).json.board.lanes[1].label, planned.name);
    assert.equal((await call("PATCH", `/_p99/v1/labels/${planned.id}`, { actor: ada, body: { name: "!" } })).status, 400);
    const old = await call("PATCH", "/_p99/v1/labels/900", { actor: ada, body: { name: "Back again" } });
    assert.equal(old.status, 404);
    assert.equal(old.json.message, "no such lane");
    assert.equal((await browse("PATCH", `/labels/${planned.id}`, owner.secret, { name: "Mine" })).status, 403);
    assert.equal((await browse("GET", "/labels", owner.secret)).json.labels.length, LANES.length);
  });

  await check("[board] the label filter on the list finds the lanes, never a deleted old label", async () => {
    const plain = await fileOn(here, "Found by lane name");
    const keys = async (name) => (await call("GET", `/_p99/v1/issues?scope=all&host=${here}&label=${encodeURIComponent(name)}`, { actor: ada })).json.issues.map((i) => i.key);
    assert.ok((await keys("New")).includes(plain));
    assert.deepEqual(await keys("legacy tag"), []);
    assert.deepEqual(await keys("Building"), []);
  });
}

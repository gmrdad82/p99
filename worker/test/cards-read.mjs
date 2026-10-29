import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LANES, LANE_NAMES, MAX_VIA_CHARS, PROJECT_RULE, actorVia, laneIndex, laneWord, notCard, personOf, projectName, useKit } from "../src/cards.js";
import { cardOf, decodeCursor, emailsIn, limitOf, linkOf, scrubEmails, sinceOf } from "../src/cards-read.js";

const CARD_FIELDS = ["changed_at", "changed_by", "comments", "created_at", "host", "key", "kind", "label", "lane", "links", "project", "reporter", "status", "title"];
const PERSON_FIELDS = ["agent", "name", "username", "via"];
const SHOWN_FIELDS = ["agent", "avatar", "name", "username", "via"];

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function unitKit() {
  useKit({
    clean: (value) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "") : value),
    fail: (status, message) => {
      throw new Refused(status, message);
    },
    keyOf: (kind, id) => `${{ bug: "BUG", feature: "FEAT" }[kind] || "BUG"}-${id}`,
  });
}

const refused = (status, message) => (error) => error instanceof Refused && error.status === status && (message === undefined || error.message === message);

function cardRow(over = {}) {
  return {
    id: 41,
    kind: "feature",
    project: "Splicer",
    label_name: "Stuck",
    lane: 4,
    place: 2,
    title: "Export keeps every audio track",
    host: "shop.example.com",
    reporter_email: "ada@example.com",
    reporter_name: "Ada Lovelace",
    reporter_username: "ada",
    reporter_agent: 0,
    reporter_via: null,
    created_at: "2026-10-22T08:00:00.000Z",
    changed_at: "2026-10-22T09:12:00.000Z",
    changed_email: "ada@example.com",
    changed_name: "Ada Lovelace",
    changed_username: "ada",
    changed_agent: 1,
    changed_via: "pci·splicer·writer",
    comment_count: 4,
    ...over,
  };
}

async function unitChecks(check) {
  unitKit();

  await check("the seven status words name the lanes by position, both ways", async () => {
    assert.deepEqual(LANES, ["new", "planned", "in-progress", "needs-you", "stuck", "landed", "done"]);
    assert.deepEqual(LANE_NAMES, ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"]);
    LANES.forEach((word, at) => {
      assert.equal(laneIndex(word), at);
      assert.equal(laneWord(at), word);
    });
    for (const bad of ["blocked", "Done", "in_progress", "needs you", "Needs-you", "", undefined, null]) assert.equal(laneIndex(bad), -1);
    for (const bad of [-1, 7, 1.5, undefined]) assert.equal(laneWord(bad), null);
  });

  await check("a person is name, username, agent and via, with via only on an agent", async () => {
    assert.deepEqual(personOf("Ada Lovelace", "ada", false, "pci"), { name: "Ada Lovelace", username: "ada", agent: false, via: null });
    assert.deepEqual(personOf("Ada Lovelace", "ada", 1, "pci"), { name: "Ada Lovelace", username: "ada", agent: true, via: "pci" });
    assert.deepEqual(personOf("Ada Lovelace", "ada", true, undefined), { name: "Ada Lovelace", username: "ada", agent: true, via: null });
    assert.deepEqual(personOf(undefined, undefined, 0, null), { name: null, username: null, agent: false, via: null });
    assert.deepEqual(Object.keys(personOf("a", "b", true, "c")).sort(), PERSON_FIELDS);
  });

  await check("an agent's label is cleaned, trimmed, cut at 80 code points, and empty is none", async () => {
    assert.equal(actorVia(" pci\u0007·splicer "), "pci·splicer");
    for (const none of ["", "   ", "\u0001\u0002", 42, null, undefined, {}, ["pci"]]) assert.equal(actorVia(none), null);
    assert.equal(actorVia("x".repeat(100)), "x".repeat(MAX_VIA_CHARS));
    assert.equal(actorVia("x".repeat(80)), "x".repeat(80));
    assert.equal(actorVia("🤖".repeat(81)), "🤖".repeat(80));
  });

  await check("a project name is 1 to 40 characters after cleaning and trimming, else the contract's line", async () => {
    assert.equal(projectName("  Splicer "), "Splicer");
    assert.equal(projectName("\u0001Spl\u0007icer"), "Splicer");
    assert.equal(projectName("p".repeat(40)), "p".repeat(40));
    assert.equal(projectName("é".repeat(40)), "é".repeat(40));
    assert.equal(projectName("🎬".repeat(40)), "🎬".repeat(40));
    for (const bad of ["", "   ", "\u0001", "p".repeat(41), "🎬".repeat(41), 42, null, undefined, ["Splicer"]]) {
      assert.throws(() => projectName(bad), refused(400, PROJECT_RULE), String(bad));
    }
    assert.equal(PROJECT_RULE, "a project name has 1 to 40 characters");
  });

  await check("a plain item's refusal names it and the command that makes it a card", async () => {
    assert.equal(notCard("BUG-12"), "BUG-12 has no project of its own; give it one with p99 edit BUG-12 --project <name>");
  });

  await check("a card row becomes the contract's card: status by lane, lane null when done, persons without e-mails", async () => {
    const link = { ref: "pci#2700", note: "Splicer export", by: personOf("Ada Lovelace", "ada", true, "pci"), at: "2026-10-22T08:05:00.000Z" };
    const card = cardOf(cardRow(), [link]);
    assert.deepEqual(card, {
      key: "FEAT-41",
      kind: "feature",
      project: "Splicer",
      status: "stuck",
      label: "Stuck",
      lane: 2,
      title: "Export keeps every audio track",
      host: "shop.example.com",
      reporter: { name: "Ada Lovelace", username: "ada", agent: false, via: null },
      created_at: "2026-10-22T08:00:00.000Z",
      changed_at: "2026-10-22T09:12:00.000Z",
      changed_by: { name: "Ada Lovelace", username: "ada", agent: true, via: "pci·splicer·writer" },
      comments: 4,
      links: [link],
    });
    assert.deepEqual(Object.keys(card).sort(), CARD_FIELDS);
    assert.equal(/@/.test(JSON.stringify(card)), false);
    const needs = cardOf(cardRow({ lane: 3, place: 1, label_name: "Needs you" }));
    assert.deepEqual([needs.status, needs.label, needs.lane], ["needs-you", "Needs you", 1]);
    assert.equal(cardOf(cardRow({ lane: 5, place: 3 })).status, "landed");
    const done = cardOf(cardRow({ lane: 6, place: 7, label_name: "Shipped" }));
    assert.equal(done.status, "done");
    assert.equal(done.lane, null);
    assert.equal(done.label, "Shipped");
    assert.deepEqual(done.links, []);
    assert.equal(cardOf(cardRow({ lane: 0, place: 1 })).lane, 1);
    assert.equal(cardOf(cardRow({ reporter_agent: 0, reporter_via: "sneaky" })).reporter.via, null);
  });

  await check("a link row reads ref, note, by and at, and survives a broken detail", async () => {
    const row = { detail_json: '{"ref":"v1.2.0","note":null}', at: "2026-10-22T08:05:00.000Z", by_email: "ada@example.com", by_name: "Ada Lovelace", by_username: "ada", by_agent: 0, by_via: null };
    assert.deepEqual(linkOf(row), { ref: "v1.2.0", note: null, by: { name: "Ada Lovelace", username: "ada", agent: false, via: null }, at: row.at });
    assert.deepEqual(linkOf({ ...row, detail_json: "not json" }), { ref: null, note: null, by: { name: "Ada Lovelace", username: "ada", agent: false, via: null }, at: row.at });
    assert.deepEqual([linkOf({ ...row, detail_json: '{"ref":42,"note":["x"]}' }).ref, linkOf({ ...row, detail_json: "null" }).note], [null, null]);
    assert.deepEqual(linkOf({ ...row, by_email: null, by_name: null, by_username: null, by_agent: 0 }).by, { name: null, username: null, agent: false, via: null });
    assert.equal(/@/.test(JSON.stringify(linkOf(row))), false);
  });

  await check("an assignee's and a mail's addresses become usernames, and no other field or kind changes", async () => {
    const handles = new Map([["ada@example.com", "ada"]]);
    assert.deepEqual(scrubEmails("assignee", { from: "Ada@Example.com", to: "nobody@example.com", note: "ada@example.com" }, handles), {
      from: { username: "ada" },
      to: { username: null },
      note: "ada@example.com",
    });
    assert.deepEqual(scrubEmails("assignee", { from: null, to: "ada@example.com" }, handles), { from: null, to: { username: "ada" } });
    assert.deepEqual(scrubEmails("assignee", { to: 42 }, handles), { to: null });
    assert.deepEqual(scrubEmails("mail", { to: "ada@example.com", template: "status", ok: true }, handles), { to: { username: "ada" }, template: "status", ok: true });
    assert.deepEqual(scrubEmails("mail", { to: ["ada@example.com", "grace@example.com", 3] }, handles), { to: [{ username: "ada" }, { username: null }] });
    for (const kind of ["title", "body", "comment", "link", "label"]) {
      const detail = { from: "ada@example.com", to: "Ada <ada@example.com>", ref: "https://example.com/a@b" };
      assert.deepEqual(scrubEmails(kind, detail, handles), detail, kind);
    }
    const original = { from: "ada@example.com", to: "ada@example.com" };
    scrubEmails("assignee", original, handles);
    assert.deepEqual(original, { from: "ada@example.com", to: "ada@example.com" });
  });

  await check("only the address fields of an assignee or a mail event are looked up, lower-cased", async () => {
    assert.deepEqual([...emailsIn("assignee", { from: "Ada@Example.com", to: "grace@example.com", note: "x@example.com" })], ["ada@example.com", "grace@example.com"]);
    assert.deepEqual([...emailsIn("mail", { to: ["a@example.com", 7, ""] })], ["a@example.com"]);
    assert.deepEqual([...emailsIn("title", { from: "ada@example.com", to: "ada@example.com" })], []);
    const out = new Set(["z@example.com"]);
    assert.equal(emailsIn("mail", { to: "b@example.com" }, out), out);
    assert.deepEqual([...out], ["z@example.com", "b@example.com"]);
  });

  await check("since takes RFC 3339 only and normalises it; anything else is the Worker's line", async () => {
    assert.equal(sinceOf("2026-10-22T08:00:00Z"), "2026-10-22T08:00:00.000Z");
    assert.equal(sinceOf("2026-10-22T10:00:00.500+02:00"), "2026-10-22T08:00:00.500Z");
    assert.equal(sinceOf("2028-02-29T23:59:59-23:59"), "2028-03-01T23:58:59.000Z");
    const impossible = ["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-10-22T24:00:00Z", "2026-10-22T08:60:00Z", "2026-10-22T08:00:60Z", "2026-10-22T08:00:00+24:00", "2026-10-22T08:00:00+02:60", "2026-00-10T08:00:00Z"];
    const lowercase = ["2026-10-22t08:00:00Z", "2026-10-22T08:00:00z"];
    for (const bad of ["6h", "90m", "2d", "2026-10-22", "2026-10-22 08:00:00Z", "2026-13-40T99:00:00Z", "yesterday", "", ...impossible, ...lowercase]) {
      assert.throws(() => sinceOf(bad), refused(400, "since must be a time like 2026-10-22T08:00:00Z"), bad);
    }
  });

  await check("limit defaults to 200 and takes 1 to 500 whole numbers", async () => {
    assert.equal(limitOf(null), 200);
    assert.equal(limitOf("1"), 1);
    assert.equal(limitOf("500"), 500);
    for (const bad of ["0", "501", "-1", "1.5", "x", ""]) assert.throws(() => limitOf(bad), refused(400, "limit must be 1 to 500"), bad);
  });

  await check("a cursor is opaque but checked: anything not one of ours is refused", async () => {
    const good = Buffer.from(JSON.stringify([2, 1, "a0", -41])).toString("base64url");
    assert.deepEqual(decodeCursor(good), [2, 1, "a0", -41]);
    const bad = [[2, 1, "a0", 41], [2, 2, "a0", -41], ["2", 1, "a0", -41], [2, 1, 7, -41], [2, 1, "a0"], { lane: 2 }, [2, 1, "x".repeat(201), -41]];
    for (const value of bad) assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(value)).toString("base64url")), refused(400, "cursor is not valid"), JSON.stringify(value));
    for (const junk of ["zz", "!!!", "41"]) assert.throws(() => decodeCursor(junk), refused(400, "cursor is not valid"), junk);
  });
}

export async function cardReadChecks({ call, browse, mint, check, issueBody, here, there }) {
  await unitChecks(check);

  const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
  const robot = { email: "grace@example.com", name: "Grace Hopper", agent: true, via: "pci·reader" };
  const bare = { email: "grace@example.com", name: "Grace Hopper", agent: true };
  const at = (host) => (host ? `host=${host}` : "");
  const file = async (project, title, actor = ada, host = here) => {
    const made = await call("POST", `/_p99/v1/cards?${at(host)}`, { actor, body: { client_uid: randomUUID(), project, title, body: `About ${title}.`, kind: "feature", host } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.card;
  };
  const status = async (key, word, actor = ada) => {
    const moved = await call("POST", `/_p99/v1/cards/${key}/status`, { actor, body: { status: word, note: null, client_uid: randomUUID() } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    return moved.json.card;
  };
  const list = async (query, host, actor = ada) => {
    const sep = query && host ? "&" : "";
    const got = await call("GET", `/_p99/v1/cards?${query}${sep}${at(host)}`, { actor });
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return got.json;
  };
  const keysOf = (json) => json.cards.map((cd) => cd.key);
  const project = (name) => `project=${encodeURIComponent(name)}`;
  const projectOf = async (host) => (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts.find((h) => h.host === host).project;
  const owner = async (name, email, projects) => {
    const made = await call("POST", "/_p99/v1/codes", { actor: ada, body: { name, email, grant: projects ? { projects } : { space: true }, role: "owner", mail: false } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json;
  };

  await check("before any card on a host, its list is empty with no cursor, and projects still lists the space's projects", async () => {
    const every = LANES.map((w) => `status=${w}`).join("&");
    const got = await call("GET", `/_p99/v1/cards?${every}&host=${there}`, { actor: ada });
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.deepEqual(got.json, { cards: [], next_cursor: null });
    const projects = await call("GET", `/_p99/v1/projects?host=${there}`, { actor: ada });
    assert.equal(projects.status, 200, JSON.stringify(projects.json));
    const space = (await call("GET", "/_p99/v1/space", { actor: ada })).json.projects;
    assert.deepEqual(projects.json.projects.map((p) => p.name), space.map((p) => p.name));
    assert.ok(projects.json.projects.some((p) => p.name === space.find((s) => s.hosts.includes(there)).name));
  });

  const lanes = {};
  for (const name of ["a", "b", "c", "d", "e", "f"]) lanes[name] = (await file("Read Lanes", `Lane card ${name}`)).key;
  await status(lanes.b, "planned");
  await status(lanes.c, "in-progress");
  await status(lanes.d, "stuck");
  await status(lanes.e, "landed");
  await status(lanes.f, "done");
  lanes.g = (await file("Read Lanes", "Lane card g")).key;

  await check("cards list in lane order, the newest at the top of new, and done only when asked", async () => {
    const open = await list(project("Read Lanes"));
    assert.deepEqual(keysOf(open), [lanes.g, lanes.a, lanes.b, lanes.c, lanes.d, lanes.e]);
    assert.deepEqual(open.cards.map((cd) => cd.status), ["new", "new", "planned", "in-progress", "stuck", "landed"]);
    assert.deepEqual(open.cards.map((cd) => cd.lane), [1, 2, 1, 1, 1, 1]);
    assert.deepEqual(open.cards.map((cd) => cd.label), ["New", "New", "Planned", "In progress", "Stuck", "Landed"]);
    assert.equal(open.next_cursor, null);
    const done = await list(`${project("Read Lanes")}&status=done`);
    assert.deepEqual(keysOf(done), [lanes.f]);
    assert.equal(done.cards[0].lane, null);
    assert.equal(done.cards[0].status, "done");
    const two = await list(`${project("Read Lanes")}&status=stuck&status=new`);
    assert.deepEqual(keysOf(two), [lanes.g, lanes.a, lanes.d]);
    const all = await list(`${project("Read Lanes")}&${LANES.map((w) => `status=${w}`).join("&")}`);
    assert.deepEqual(keysOf(all), [...keysOf(open), lanes.f]);
  });

  await check("a card moved back to new goes to the top, and every card keeps the contract's shape", async () => {
    await status(lanes.c, "new");
    const open = await list(`${project("Read Lanes")}&status=new`);
    assert.deepEqual(keysOf(open), [lanes.c, lanes.g, lanes.a]);
    assert.deepEqual(open.cards.map((cd) => cd.lane), [1, 2, 3]);
    for (const cd of open.cards) {
      assert.deepEqual(Object.keys(cd).sort(), CARD_FIELDS);
      assert.deepEqual(Object.keys(cd.reporter).sort(), SHOWN_FIELDS);
      assert.deepEqual(Object.keys(cd.changed_by).sort(), SHOWN_FIELDS);
      assert.equal(cd.project, "Read Lanes");
      assert.equal(cd.host, here);
      assert.ok(cd.changed_at >= cd.created_at);
    }
    await status(lanes.c, "in-progress");
  });

  await check("a renamed lane changes the label while the status word stays", async () => {
    const labels = (await call("GET", "/_p99/v1/labels", { actor: ada })).json.labels;
    const stuck = labels.find((l) => l.name === "Stuck");
    assert.ok(stuck, JSON.stringify(labels));
    const renamed = await call("PATCH", `/_p99/v1/labels/${stuck.id}`, { actor: ada, body: { name: "Waiting on" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    try {
      const card = (await list(`${project("Read Lanes")}&status=stuck`)).cards[0];
      assert.equal(card.key, lanes.d);
      assert.equal(card.status, "stuck");
      assert.equal(card.label, "Waiting on");
      assert.equal((await call("GET", `/_p99/v1/cards/${lanes.d}`, { actor: ada })).json.card.label, "Waiting on");
    } finally {
      assert.equal((await call("PATCH", `/_p99/v1/labels/${stuck.id}`, { actor: ada, body: { name: "Stuck" } })).status, 200);
    }
  });

  const alphaHere = await file("Read Alpha", "Alpha here", bare, here);
  const alphaThere = await file("Read Alpha", "Alpha there", ada, there);
  const betaHere = await file("Read Beta", "Beta here", robot, here);

  await check("project filters repeat, match without regard to case, and refuse a bad name", async () => {
    assert.deepEqual(new Set(keysOf(await list(project("read alpha")))), new Set([alphaHere.key, alphaThere.key]));
    assert.deepEqual(new Set(keysOf(await list(`${project("READ ALPHA")}&${project(" Read Beta ")}`))), new Set([alphaHere.key, alphaThere.key, betaHere.key]));
    assert.deepEqual(keysOf(await list(project("Read Nothing"))), []);
    for (const bad of ["", "   ", "p".repeat(41)]) {
      const got = await call("GET", `/_p99/v1/cards?${project(bad)}`, { actor: ada });
      assert.equal(got.status, 400, bad);
      assert.equal(got.json.message, PROJECT_RULE);
    }
  });

  await check("the host filter and the signed scope keep one host's cards; no host sees every host's", async () => {
    const both = `${project("Read Alpha")}&${project("Read Beta")}`;
    assert.deepEqual(new Set(keysOf(await list(both))), new Set([alphaHere.key, alphaThere.key, betaHere.key]));
    assert.deepEqual(new Set(keysOf(await list(both, here))), new Set([alphaHere.key, betaHere.key]));
    assert.deepEqual(keysOf(await list(both, there)), [alphaThere.key]);
    assert.equal((await call("GET", `/_p99/v1/cards?${both}&host=nowhere.example.com`, { actor: ada })).status, 404);
  });

  await check("source keeps the cards whose last change was a person's or an agent's, and moves with the next change", async () => {
    const both = `${project("Read Alpha")}&${project("Read Beta")}`;
    assert.deepEqual(new Set(keysOf(await list(`${both}&source=agent`))), new Set([alphaHere.key, betaHere.key]));
    assert.deepEqual(keysOf(await list(`${both}&source=human`)), [alphaThere.key]);
    const said = await call("POST", `/_p99/v1/cards/${alphaHere.key}/comments`, { actor: ada, body: { client_uid: randomUUID(), body: "A person's turn.", internal: false } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    assert.deepEqual(new Set(keysOf(await list(`${both}&source=human`))), new Set([alphaHere.key, alphaThere.key]));
    assert.deepEqual(keysOf(await list(`${both}&source=agent`)), [betaHere.key]);
    const card = (await list(`${project("Read Alpha")}&source=human`, here)).cards[0];
    assert.deepEqual(card.changed_by, { name: "Ada Lovelace", username: card.changed_by.username, agent: false, via: null, avatar: null });
    assert.equal(typeof card.changed_by.username, "string");
    assert.deepEqual(card.reporter, { name: "Grace Hopper", username: card.reporter.username, agent: true, via: null, avatar: null });
    assert.equal(card.comments, 1);
    assert.equal((await call("GET", `/_p99/v1/cards?source=robot`, { actor: ada })).status, 400);
  });

  await check("since keeps the cards changed at or after it, to the millisecond, in any offset", async () => {
    const beta = (await list(project("Read Beta"))).cards[0];
    assert.equal(beta.key, betaHere.key);
    const edge = beta.changed_at;
    assert.deepEqual(keysOf(await list(`${project("Read Beta")}&since=${encodeURIComponent(edge)}`)), [beta.key]);
    const later = new Date(Date.parse(edge) + 1).toISOString();
    assert.deepEqual(keysOf(await list(`${project("Read Beta")}&since=${encodeURIComponent(later)}`)), []);
    const shifted = new Date(Date.parse(edge) + 2 * 3600 * 1000).toISOString().replace(/\.(\d{3})Z$/, ".$1+02:00");
    assert.deepEqual(keysOf(await list(`${project("Read Beta")}&since=${encodeURIComponent(shifted)}`)), [beta.key]);
    for (const bad of ["6h", "2026-10-22", "soon"]) {
      const got = await call("GET", `/_p99/v1/cards?since=${bad}`, { actor: ada });
      assert.equal(got.status, 400, bad);
    }
  });

  await check("filters combine: project, status, source, host and since together", async () => {
    const early = "2000-01-01T00:00:00Z";
    const query = `${project("Read Alpha")}&${project("Read Beta")}&status=new&source=human&since=${early}`;
    assert.deepEqual(keysOf(await list(query, here)), [alphaHere.key]);
    assert.deepEqual(keysOf(await list(query, there)), [alphaThere.key]);
    assert.deepEqual(keysOf(await list(`${query}&status=done`, there)), [alphaThere.key]);
    assert.deepEqual(keysOf(await list(query.replace("status=new", "status=stuck"), here)), []);
  });

  await check("bad list parameters are 400s with the reason", async () => {
    for (const [query, message] of [
      ["status=blocked", `status must be one of ${LANES.join(", ")}`],
      ["status=Done", `status must be one of ${LANES.join(", ")}`],
      ["source=", "source must be human or agent"],
      ["limit=0", "limit must be 1 to 500"],
      ["limit=501", "limit must be 1 to 500"],
      ["limit=ten", "limit must be 1 to 500"],
      ["cursor=zz", "cursor is not valid"],
    ]) {
      const got = await call("GET", `/_p99/v1/cards?${query}`, { actor: ada });
      assert.equal(got.status, 400, query);
      assert.equal(got.json.message, message, query);
    }
  });

  const paged = [];
  for (let n = 0; n < 7; n++) paged.push((await file("Read Pages", `Page card ${n}`, n % 2 ? robot : ada)).key);
  await status(paged[2], "planned");
  await status(paged[5], "stuck");

  await check("limit and cursor page through every card once, in order, with no gaps", async () => {
    const whole = keysOf(await list(`${project("Read Pages")}&limit=500`));
    assert.equal(whole.length, 7);
    assert.deepEqual(new Set(whole), new Set(paged));
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await list(`${project("Read Pages")}&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      assert.ok(page.cards.length <= 3);
      seen.push(...keysOf(page));
      cursor = page.next_cursor;
      pages += 1;
      if (cursor) assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    } while (cursor && pages < 10);
    assert.equal(pages, 3);
    assert.deepEqual(seen, whole);
    const exact = await list(`${project("Read Pages")}&limit=7`);
    assert.equal(exact.next_cursor, null);
    const first = await list(`${project("Read Pages")}&limit=1`);
    assert.deepEqual(keysOf(first), [whole[0]]);
    assert.ok(first.next_cursor);
    assert.deepEqual(keysOf(await list(`${project("Read Pages")}&limit=500&cursor=${first.next_cursor}`)), whole.slice(1));
  });

  await check("the default limit is 200 and the list never carries an e-mail", async () => {
    const json = await list(`${project("Read Pages")}`);
    assert.equal(json.cards.length, 7);
    assert.equal(/@/.test(JSON.stringify(json)), false);
    const viaCard = json.cards.find((cd) => cd.reporter.agent);
    assert.deepEqual(viaCard.reporter, { name: "Grace Hopper", username: viaCard.reporter.username, agent: true, via: "pci·reader", avatar: null });
    const personCard = json.cards.find((cd) => !cd.reporter.agent);
    assert.equal(personCard.reporter.via, null);
  });

  await check("a person's action carries no label even when one is sent", async () => {
    const card = await file("Read Alpha", "Person with a label", { ...ada, via: "should vanish" });
    assert.equal(card.reporter.via, null);
    assert.equal(card.reporter.agent, false);
    const listed = (await list(project("Read Alpha"))).cards.find((cd) => cd.key === card.key);
    assert.deepEqual(listed.reporter, card.reporter);
  });

  await check("card show gives the card with body, links, comments and events oldest first, persons and no e-mails", async () => {
    const card = await file("Read Show", "Shown card", robot);
    const linked = await call("POST", `/_p99/v1/cards/${card.key}/links`, { actor: robot, body: { ref: "pci#2700", note: "Splicer export" } });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    const said = await call("POST", `/_p99/v1/cards/${card.key}/comments`, { actor: ada, body: { client_uid: randomUUID(), body: "First word.", internal: true } });
    assert.equal(said.status, 201, JSON.stringify(said.json));
    const assigned = await call("PATCH", `/_p99/v1/issues/${card.key}`, { actor: ada, body: { assignee: "me" } });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
    await status(card.key, "stuck", ada);
    const shown = await call("GET", `/_p99/v1/cards/${card.key}`, { actor: ada });
    assert.equal(shown.status, 200, JSON.stringify(shown.json));
    const { json } = shown;
    assert.deepEqual(Object.keys(json).sort(), ["card", "comments", "events"]);
    assert.deepEqual(Object.keys(json.card).sort(), [...CARD_FIELDS, "body"].sort());
    assert.equal(json.card.body, "About Shown card.");
    assert.equal(json.card.status, "stuck");
    assert.equal(json.card.comments, 1);
    assert.equal(json.card.links.length, 1);
    assert.deepEqual(json.card.links[0], { ref: "pci#2700", note: "Splicer export", by: { name: "Grace Hopper", username: json.card.links[0].by.username, agent: true, via: "pci·reader", avatar: null }, at: json.card.links[0].at });
    assert.equal(json.comments.length, 1);
    assert.deepEqual(Object.keys(json.comments[0]).sort(), ["author", "body", "created_at", "id", "internal"]);
    assert.deepEqual(json.comments[0].author, { name: "Ada Lovelace", username: json.comments[0].author.username, agent: false, via: null, avatar: null });
    assert.equal(json.comments[0].internal, true);
    const kinds = json.events.map((ev) => ev.kind);
    assert.equal(kinds[0], "created");
    for (const k of ["link", "comment", "assignee", "label"]) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
    assert.ok(kinds.indexOf("link") < kinds.indexOf("comment") && kinds.indexOf("comment") < kinds.indexOf("assignee"));
    const ats = json.events.map((ev) => ev.at);
    assert.deepEqual(ats, [...ats].sort());
    for (const ev of json.events) {
      assert.deepEqual(Object.keys(ev).sort(), ["at", "by", "detail", "kind"]);
      if (ev.by) assert.deepEqual(Object.keys(ev.by).sort(), SHOWN_FIELDS);
    }
    assert.deepEqual(json.events.find((ev) => ev.kind === "link").detail, { ref: "pci#2700", note: "Splicer export" });
    const move = json.events.find((ev) => ev.kind === "assignee").detail;
    assert.deepEqual(move.to, { username: json.comments[0].author.username });
    assert.equal(/@/.test(JSON.stringify(json)), false);
    assert.equal(json.card.changed_by.agent, false);
    const byNumber = await call("GET", `/_p99/v1/cards/${card.key.split("-")[1]}`, { actor: ada });
    assert.deepEqual(byNumber.json.card, json.card);
  });

  await check("a manager with no code and no comment on a card is named on its change, link and events", async () => {
    const kat = { email: "katherine@example.com", name: "Katherine Johnson", agent: false };
    await file("Read Names Elsewhere", "Katherine filed this one", kat);
    const card = await file("Read Names", "Named by another", ada);
    const linked = await call("POST", `/_p99/v1/cards/${card.key}/links`, { actor: kat, body: { ref: "v2.0.0", note: null } });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    await status(card.key, "planned", kat);
    const listed = (await list(project("Read Names"))).cards[0];
    assert.equal(listed.key, card.key);
    assert.deepEqual(listed.changed_by, { name: "Katherine Johnson", username: listed.changed_by.username, agent: false, via: null, avatar: null });
    assert.equal(typeof listed.changed_by.username, "string");
    assert.equal(listed.links[0].by.name, "Katherine Johnson");
    assert.equal(listed.reporter.name, "Ada Lovelace");
    const shown = (await call("GET", `/_p99/v1/cards/${card.key}`, { actor: ada })).json;
    assert.equal(shown.card.changed_by.name, "Katherine Johnson");
    const hers = shown.events.filter((ev) => ev.by && ev.by.username === listed.changed_by.username);
    assert.ok(hers.some((ev) => ev.kind === "link"), JSON.stringify(shown.events));
    for (const ev of hers) assert.equal(ev.by.name, "Katherine Johnson", ev.kind);
    assert.equal(shown.events.find((ev) => ev.kind === "created").by.name, "Ada Lovelace");
  });

  await check("a manager with no trace anywhere sees their own name on the change they made", async () => {
    const dot = { email: "dorothy@example.com", name: "Dorothy Vaughan", agent: false };
    const card = await file("Read Names", "Moved by a newcomer", ada);
    await status(card.key, "stuck", dot);
    const own = (await call("GET", `/_p99/v1/cards/${card.key}`, { actor: dot })).json;
    assert.equal(own.card.changed_by.name, "Dorothy Vaughan");
    assert.equal(own.events.find((ev) => ev.kind === "label").by.name, "Dorothy Vaughan");
    assert.equal(own.card.reporter.name, "Ada Lovelace");
  });

  await check("card show refuses a plain item with the contract's line, and an unknown or hidden key with no item", async () => {
    const plain = await call("POST", `/_p99/v1/issues?host=${here}`, { actor: ada, body: issueBody({ title: "Plain, not a card" }) });
    assert.equal(plain.status, 201, JSON.stringify(plain.json));
    const notOne = await call("GET", `/_p99/v1/cards/${plain.json.key}`, { actor: ada });
    assert.equal(notOne.status, 409);
    assert.equal(notOne.json.message, notCard(plain.json.key));
    for (const [raw, shown] of [["FEAT-999999", "FEAT-999999"], ["999999", "999999"], ["not-a-key", "not-a-key"]]) {
      const missing = await call("GET", `/_p99/v1/cards/${raw}`, { actor: ada });
      assert.equal(missing.status, 404, raw);
      assert.equal(missing.json.message, `no card ${shown}`);
    }
    const hidden = await call("GET", `/_p99/v1/cards/${alphaThere.key}?host=${here}`, { actor: ada });
    assert.equal(hidden.status, 404);
    assert.equal(hidden.json.message, `no card ${alphaThere.key}`);
    assert.equal((await call("GET", `/_p99/v1/cards/${alphaThere.key}?host=${there}`, { actor: ada })).status, 200);
  });

  await check("projects lists every project the code reaches by name, with its hosts and open and done counts of all its items, one entry per spelling-blind name", async () => {
    const again = await file("READ ALPHA", "Shouted alpha");
    assert.equal(again.project, "Read Alpha");
    const { status: code, json } = await call("GET", "/_p99/v1/projects", { actor: ada });
    assert.equal(code, 200, JSON.stringify(json));
    assert.deepEqual(Object.keys(json), ["projects"]);
    const names = json.projects.map((p) => p.name);
    const plainNames = names.filter((n) => /^[\x20-\x7e]+$/.test(n)).map((n) => n.toLowerCase());
    assert.deepEqual(plainNames, [...plainNames].sort());
    assert.equal(names.filter((n) => n.toLowerCase() === "read alpha").length, 1);
    const find = (name) => json.projects.find((p) => p.name === name);
    for (const p of json.projects) assert.deepEqual(Object.keys(p).sort(), ["done", "hosts", "name", "open"]);
    assert.deepEqual(find("Read Lanes"), { name: "Read Lanes", hosts: [], open: 6, done: 1 });
    assert.deepEqual(find("Read Alpha"), { name: "Read Alpha", hosts: [], open: 4, done: 0 });
    const reports = find(await projectOf(there));
    assert.deepEqual(reports.hosts, [there]);
    const scoped = (await call("GET", `/_p99/v1/projects?host=${there}`, { actor: ada })).json.projects;
    assert.deepEqual(scoped, json.projects, "a host narrows items, never the space's projects");
    assert.equal((await call("POST", "/_p99/v1/projects", { actor: ada, body: { name: "Read Empty" } })).status, 201);
    const empty = (await call("GET", "/_p99/v1/projects", { actor: ada })).json.projects.find((p) => p.name === "Read Empty");
    assert.deepEqual(empty, { name: "Read Empty", hosts: [], open: 0, done: 0 });
  });

  await check("only managers read cards: a reporter code gets 403 on every card route and on source", async () => {
    const visitor = await mint("Mary Somerville", "mary@example.com", [here]);
    for (const path of ["/cards", `/cards/${alphaHere.key}`, "/cards?status=landed", "/issues?scope=mine&source=agent"]) {
      assert.equal((await browse("GET", path, visitor.secret)).status, 403, path);
    }
    const listed = await browse("GET", "/projects", visitor.secret);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.deepEqual(listed.json.projects.map((p) => p.name), [await projectOf(here)]);
  });

  await check("an Owner's code reads the cards of the projects it grants, whatever their host, and none of another project on its own host", async () => {
    const hostProject = await projectOf(here);
    const granted = await owner("Grace Hopper", "grace@example.com", [hostProject, "Read Alpha"]);
    const listed = await browse("GET", `/cards?${project("Read Alpha")}`, granted.secret);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.ok(keysOf(listed.json).includes(alphaHere.key) && keysOf(listed.json).includes(alphaThere.key));
    assert.equal((await browse("GET", `/cards/${alphaThere.key}`, granted.secret)).status, 200);
    const projects = (await browse("GET", "/projects", granted.secret)).json.projects;
    assert.deepEqual(projects.map((p) => p.name).sort(), [hostProject, "Read Alpha"].sort());
    const signed = (await call("GET", "/_p99/v1/projects", { actor: ada })).json.projects.find((p) => p.name === "Read Alpha");
    assert.deepEqual(projects.find((p) => p.name === "Read Alpha"), signed);
    const boss = await mint("Grace Hopper", "grace@example.com", [here], true);
    assert.deepEqual(keysOf((await browse("GET", `/cards?${project("Read Alpha")}`, boss.secret)).json), []);
    assert.equal((await browse("GET", `/cards/${alphaHere.key}`, boss.secret)).status, 404, "a card on its host in another project stays out of reach");
    assert.equal((await browse("GET", `/issues/${alphaHere.key}`, boss.secret)).status, 404);
  });

  await check("in the browser host= only routes the request; site=1 keeps this host's cards", async () => {
    const boss = await owner("Emmy Noether", "emmy@example.com");
    const every = keysOf((await browse("GET", `/cards?${project("Read Alpha")}&host=${there}`, boss.secret)).json);
    assert.ok(every.includes(alphaHere.key));
    assert.ok(every.includes(alphaThere.key));
    const site = await browse("GET", `/cards?${project("Read Alpha")}&site=1`, boss.secret);
    assert.equal(site.status, 200, JSON.stringify(site.json));
    assert.ok(site.json.cards.length > 0);
    assert.ok(site.json.cards.every((cd) => cd.host === here));
    assert.equal(keysOf(site.json).includes(alphaThere.key), false);
  });

  await check("source on /issues filters today's list by the last change's person or agent", async () => {
    const human = (await call("POST", `/_p99/v1/issues?host=${here}`, { actor: ada, body: issueBody({ title: "Filed by a person" }) })).json.key;
    const agent = (await call("POST", `/_p99/v1/issues?host=${here}`, { actor: bare, body: issueBody({ title: "Filed by an agent" }) })).json.key;
    const keys = async (source) => {
      const got = await call("GET", `/_p99/v1/issues?scope=all&host=${here}&limit=100&q=filed%20by&source=${source}`, { actor: ada });
      assert.equal(got.status, 200, JSON.stringify(got.json));
      return got.json.issues.map((i) => i.key);
    };
    assert.ok((await keys("human")).includes(human));
    assert.equal((await keys("human")).includes(agent), false);
    assert.ok((await keys("agent")).includes(agent));
    assert.equal((await keys("agent")).includes(human), false);
    const commented = await call("POST", `/_p99/v1/issues/${agent}/comments?host=${here}`, { actor: ada, body: { client_uid: randomUUID(), body: "A person answers.", internal: false } });
    assert.equal(commented.status, 201, JSON.stringify(commented.json));
    assert.ok((await keys("human")).includes(agent));
    assert.equal((await call("GET", `/_p99/v1/issues?scope=all&source=everyone`, { actor: ada })).status, 400);
  });

  await check("paging crosses from unplaced to placed cards in one lane, and one card's place matches the list", async () => {
    const owner = ada;
    const mixed = [];
    for (let n = 0; n < 3; n++) mixed.push((await file("Read Mixed", `Mixed card ${n}`, owner)).key);
    const away = await call("POST", "/_p99/v1/move", { actor: owner, body: { key: mixed[0], from: "New", to: "planned" } });
    assert.equal(away.status, 200, JSON.stringify(away.json));
    const placed = await call("POST", "/_p99/v1/move", { actor: owner, body: { key: mixed[0], from: "planned", to: "new" } });
    assert.equal(placed.status, 200, JSON.stringify(placed.json));
    assert.ok(placed.json.card.order, JSON.stringify(placed.json));
    mixed.push((await file("Read Mixed", "Mixed card 3", owner)).key);
    const loose = await call("PATCH", `/_p99/v1/issues/${mixed[3]}`, { actor: ada, body: { status: "doing" } });
    assert.equal(loose.status, 200, JSON.stringify(loose.json));
    const whole = await list(`${project("Read Mixed")}&limit=500`);
    assert.deepEqual(keysOf(whole), [mixed[0], mixed[2], mixed[1], mixed[3]]);
    assert.deepEqual(whole.cards.map((cd) => cd.status), ["new", "new", "new", "in-progress"]);
    assert.equal(whole.cards[3].label, "In progress");
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await list(`${project("Read Mixed")}&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(page.cards.length, 1);
      seen.push(...keysOf(page));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, keysOf(whole));
    const lanesSeen = whole.cards.slice(0, 3).map((cd) => cd.lane);
    assert.deepEqual(lanesSeen, [...lanesSeen].sort((a, b) => a - b));
    assert.equal(new Set(lanesSeen).size, lanesSeen.length);
    const everyLane = await list(`${LANES.map((w) => `status=${w}`).join("&")}&limit=500`);
    for (const cd of everyLane.cards) {
      const one = (await call("GET", `/_p99/v1/cards/${cd.key}`, { actor: ada })).json.card;
      assert.equal(one.lane, cd.lane, cd.key);
      assert.equal(one.status, cd.status, cd.key);
    }
  });

  await check("a card's place counts the cards its reader can see in that lane", async () => {
    await file("Read Places", "Near and older", ada, here);
    await file("Read Far", "Far away and newer", ada, there);
    const reached = [await projectOf(here), "Read Places"];
    const boss = await owner("Grace Hopper", "grace@example.com", reached);
    const near = (await browse("GET", "/cards?status=new&limit=500", boss.secret)).json.cards;
    assert.ok(near.length > 0);
    assert.ok(near.every((cd) => reached.includes(cd.project)));
    assert.deepEqual(near.map((cd) => cd.lane), near.map((_, at) => at + 1));
    const all = (await list("status=new&limit=500")).cards;
    assert.ok(all.some((cd) => cd.project === "Read Far"));
    assert.deepEqual(all.map((cd) => cd.lane), all.map((_, at) => at + 1));
    const one = (await browse("GET", `/cards/${near[0].key}`, boss.secret)).json.card;
    assert.equal(one.lane, 1);
  });
}

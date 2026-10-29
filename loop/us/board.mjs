import assert from "node:assert/strict";
import { ADA, LANE_NAMES, card, cast, ok, pickerOptions, picking, tag } from "../triage-lib.mjs";

function lanesOf(text) {
  const lanes = {};
  let current = null;
  for (const line of text.split("\n")) {
    const lane = /^(.+?) \((\d+)\)(, closes)?$/.exec(line);
    if (lane) {
      current = lane[1];
      lanes[current] = { count: Number(lane[2]), keys: [] };
    } else if (current && /^ {2}\S/.test(line)) {
      lanes[current].keys.push(line.trim().split(/\s+/)[0]);
    }
  }
  return lanes;
}

export default async function (kit) {
  const { check } = kit;
  const where = cast(kit);

  await check("us-board-001 p99 board and p99 move order cards by lane word or name", async () => {
    const t = tag();
    const project = `Order ${t}`;
    const a = await card(kit, project, `Alpha ${t}`);
    const b = await card(kit, project, `Bravo ${t}`);
    const c = await card(kit, project, `Charlie ${t}`);
    const board = async () => lanesOf((await ok(kit, ["board", "--project", project])).stdout);

    let lanes = await board();
    assert.deepEqual(Object.keys(lanes), LANE_NAMES);
    assert.equal(lanes.New.count, 3);
    assert.deepEqual(lanes.New.keys, [c.key, b.key, a.key], "the newest card tops its lane");

    await ok(kit, ["move", a.key, "--to", "planned"]);
    lanes = await board();
    assert.deepEqual(lanes.Planned.keys, [a.key]);
    assert.deepEqual(lanes.New.keys, [c.key, b.key]);

    await ok(kit, ["move", a.key, "--to", "new", "--before", c.key]);
    assert.deepEqual((await board()).New.keys, [a.key, c.key, b.key]);

    await ok(kit, ["move", b.key, "--to", "new", "--after", a.key]);
    assert.deepEqual((await board()).New.keys, [a.key, b.key, c.key]);

    await ok(kit, ["move", c.key, "--to", "In progress"]);
    lanes = await board();
    assert.deepEqual(lanes["In progress"].keys, [c.key]);
    assert.deepEqual(lanes.New.keys, [a.key, b.key]);

    const stale = await kit.call("POST", "/_p99/v1/move", { actor: ADA, body: { key: a.key, from: "Done", to: "stuck" } });
    assert.equal(stale.status, 409, JSON.stringify(stale.json));
    lanes = await board();
    assert.deepEqual(lanes.New.keys, [a.key, b.key], "a stale move changes nothing");
    assert.deepEqual(lanes.Stuck.keys, []);

    const json = JSON.parse((await ok(kit, ["board", "--project", project, "--json"])).stdout);
    assert.deepEqual(json.board.lanes.map((lane) => lane.label), LANE_NAMES);
  });

  await check("us-board-002 a card filed by project alone shows on the board with no host", async () => {
    const t = tag();
    const made = await card(kit, where.ops, `No host ${t}`);
    assert.equal(made.host ?? null, null);
    assert.equal(made.project, where.ops);
    assert.equal(made.status, "new");

    const lanes = lanesOf((await ok(kit, ["board", "--project", where.ops])).stdout);
    assert.ok(lanes.New.keys.includes(made.key), JSON.stringify(lanes.New));
    const listed = JSON.parse((await ok(kit, ["cards", "--project", where.ops, "--json"])).stdout);
    const found = listed.cards.find((c) => c.key === made.key);
    assert.ok(found, "p99 cards lists it");
    assert.equal(found.host ?? null, null);

    const shown = await ok(kit, ["show", made.key]);
    assert.ok(shown.stdout.includes(`No host ${t}`), shown.stdout);
    const read = await kit.call("GET", `/_p99/v1/cards/${made.key}`, { actor: ADA });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(read.json.card.host ?? null, null);
  });

  await check("us-board-002 a hostless card opens in the tui and moves on the board", async () => {
    const t = tag();
    const made = await card(kit, where.ops, `Still no host ${t}`);

    const opened = await kit.tui(`/ ${t} enter enter`);
    assert.ok(opened.includes(`Inbox / ${made.key}`), opened);
    assert.ok(opened.includes(`Still no host ${t}`), opened);
    assert.ok(!/host (null|undefined)/.test(opened), opened);

    const options = pickerOptions(await kit.tui("tab p"), "Projects");
    assert.ok(options && options.includes(where.ops), `${options}`);
    await kit.tui(`tab ${picking("p", options.indexOf(where.ops))} space right enter`);
    const after = await kit.call("GET", `/_p99/v1/cards/${made.key}`, { actor: ADA });
    assert.equal(after.json.card.status, "planned", JSON.stringify(after.json));
    assert.equal(after.json.card.host ?? null, null);
  });
}

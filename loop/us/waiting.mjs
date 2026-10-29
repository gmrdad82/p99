import assert from "node:assert/strict";
import { card, hasKey, header, ok, pickerOptions, picking, tag, waitingCount } from "../triage-lib.mjs";

const waits = (kit, key, t) => ok(kit, ["card", "status", key, "needs-you", "--note", `Please look ${t}`, "--agent"]);

export default async function (kit) {
  const { check } = kit;

  await check("us-waiting-001 a waiting card is counted and w opens it", async () => {
    const t = tag();
    const project = `Wait ${t}`;
    const before = waitingCount(await kit.tui(""));

    const made = await card(kit, project, `Look at the clip ${t}`);
    await waits(kit, made.key, t);
    const counted = await kit.tui("");
    assert.ok(header(counted).includes("waiting"), counted);
    assert.equal(waitingCount(counted), before + 1, header(counted));

    const list = await kit.tui("w");
    assert.ok(list.includes("Needs you ·"), list);
    assert.ok(hasKey(list, made.key), list);

    const opened = await kit.tui("w enter");
    assert.ok(opened.includes(made.key) && opened.includes(`Look at the clip ${t}`), opened);
    assert.ok(!opened.includes("Needs you ·"), opened);

    await ok(kit, ["card", "move", made.key, "--to", "in-progress"]);
    assert.equal(waitingCount(await kit.tui("")), before, "the count goes down as the card moves out");

    const options = pickerOptions(await kit.tui("p"), "Projects");
    assert.ok(options && options.includes(project), `${options}`);
    const none = await kit.tui(picking("p", options.indexOf(project)));
    assert.ok(!header(none).includes("waiting"), `the count hides at zero:\n${header(none)}`);
  });

  await check("us-waiting-001 p99 cards waiting puts the count first", async () => {
    const t = tag();
    const project = `Wait ${t}`;
    const first = await card(kit, project, `First question ${t}`);
    await waits(kit, first.key, t);
    const second = await card(kit, project, `Second question ${t}`);
    await waits(kit, second.key, t);

    const out = await ok(kit, ["cards", "--waiting"]);
    const lines = out.stdout.split("\n").filter((line) => line !== "");
    const said = /^(\d+) cards? waits? on you$/.exec(lines[0]);
    assert.ok(said, `the count comes first:\n${out.stdout}`);
    assert.ok(lines.length - 1 >= 2 && lines.length - 1 <= Number(said[1]), out.stdout);
    assert.ok(lines[1].startsWith(second.key) && lines[1].includes("needs-you"), `the newest change comes first:\n${out.stdout}`);
    assert.ok(lines[2].startsWith(first.key), out.stdout);

    const json = JSON.parse((await ok(kit, ["cards", "--waiting", "--json"])).stdout);
    assert.equal(json.count, Number(said[1]));
  });
}

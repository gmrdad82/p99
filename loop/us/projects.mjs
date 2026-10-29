import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function p99(kit, args) {
  const out = await kit.p99(args);
  assert.equal(out.code, 0, `p99 ${args.join(" ")}\nstdout: ${out.stdout}\nstderr: ${out.stderr}`);
  return out;
}

async function projects(kit) {
  const out = await p99(kit, ["projects", "--json"]);
  return JSON.parse(out.stdout).projects;
}

const named = (list, name) => list.find((p) => p.name === name);

export default async function (kit) {
  await kit.check("us-projects-001 a new project takes a host and its cards and keeps them through a rename", async () => {
    const tag = randomUUID().slice(0, 6);
    const docs = `Docs ${tag}`;
    const guides = `Guides ${tag}`;
    const home = kit.space.projects.find((p) => p.hosts.length > 0);
    const host = home.hosts[0];

    const added = await p99(kit, ["projects", "add", docs]);
    assert.ok(added.stdout.startsWith(`added the project ${docs} to `), added.stdout);
    const fresh = named(await projects(kit), docs);
    assert.ok(fresh, `${docs} is not listed`);
    assert.deepEqual(fresh.hosts, []);
    assert.equal(fresh.open, 0);

    await p99(kit, ["card", "new", "--project", docs, "--title", `Write the setup guide ${tag}`]);
    assert.equal(named(await projects(kit), docs).open, 1);

    const before = named(await projects(kit), home.name);
    try {
      const moved = await p99(kit, ["hosts", "set", host, "--project", docs]);
      assert.ok(moved.stdout.includes(`${host} is in the project ${docs} now; its cards moved with it`), moved.stdout);
      const listed = await projects(kit);
      const holding = named(listed, docs);
      assert.deepEqual(holding.hosts, [host]);
      assert.ok(holding.open >= 1, JSON.stringify(holding));
      assert.ok(!named(listed, home.name).hosts.includes(host), JSON.stringify(listed));

      const renamed = await p99(kit, ["projects", "rename", docs, guides]);
      assert.ok(renamed.stdout.includes(`renamed the project ${docs} to ${guides}`), renamed.stdout);
      const after = await projects(kit);
      assert.equal(named(after, docs), undefined);
      const kept = named(after, guides);
      assert.deepEqual(kept.hosts, [host]);
      assert.equal(kept.open, holding.open);
      assert.equal(kept.closed, holding.closed);

      const cards = await p99(kit, ["cards", "--project", guides, "--json"]);
      assert.ok(cards.stdout.includes(`Write the setup guide ${tag}`), cards.stdout);
    } finally {
      await p99(kit, ["hosts", "set", host, "--project", home.name]);
    }
    const back = named(await projects(kit), home.name);
    assert.deepEqual(back.hosts, before.hosts);
    assert.equal(back.open, before.open);
  });

  await kit.check("us-projects-001 a project name already taken is refused whatever its case", async () => {
    const [first, second] = kit.space.projects;
    const before = await projects(kit);

    const shouted = first.name.toUpperCase() === first.name ? first.name.toLowerCase() : first.name.toUpperCase();
    const add = await kit.p99(["projects", "add", shouted]);
    assert.equal(add.code, 1, add.stderr);
    assert.match(add.stderr, /^p99: a project called .+ exists/m);
    assert.equal(add.stderr.trim().split("\n").length, 1, add.stderr);
    assert.equal(add.stdout, "");

    const rename = await kit.p99(["projects", "rename", second.name, shouted]);
    assert.equal(rename.code, 1, rename.stderr);
    assert.match(rename.stderr, /^p99: a project called .+ exists/m);

    assert.deepEqual(await projects(kit), before);
  });
}

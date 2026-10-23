import assert from "node:assert/strict";

export async function peopleChecks({ call, browse, mint, check, issueBody, here, there }) {
  const pia = await mint("Pia Moss", "pia@example.com", [here]);
  const rex = await mint("Rex Holt", "Rex@Example.com", [here, there], true);
  const twin = await mint("Pia Moss", "pia.other@example.com", [here]);
  await mint("Sam Away", "sam@example.com", [there]);

  await check("the people list is managers only, this host's live members, usernames and no e-mails", async () => {
    const gone = await mint("Tom Gone", "tom@example.com", [here]);
    assert.equal((await call("POST", `/_p99/v1/codes/${gone.code.id}/revoke`)).status, 200);
    assert.equal((await browse("GET", "/people", pia.secret)).status, 403);
    const seen = await browse("GET", "/people", rex.secret);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const names = seen.json.people.map((p) => p.username);
    assert.ok(names.includes("pia.moss") && names.includes("pia.moss2") && names.includes("rex.holt"), names.join(","));
    assert.ok(!names.includes("sam.away") && !names.includes("tom.gone"), names.join(","));
    for (const p of seen.json.people) assert.deepEqual(Object.keys(p).sort(), ["manager", "role", "username"]);
    assert.equal(seen.json.people.find((p) => p.username === "rex.holt").manager, true);
    assert.equal(/@/.test(JSON.stringify(seen.json)), false);
    assert.equal((await browse("GET", "/me", twin.secret)).json.username, "pia.moss2");
  });

  await check("a username keeps to its charset and length, refuses reserved words and look-alikes, and changes only your own", async () => {
    const set = (secret, body) => browse("PATCH", "/me", secret, body);
    for (const bad of ["ab", "a".repeat(31), "-pia", "pia.", "pía", "pia moss", "ada@x", 42, null]) {
      assert.equal((await set(pia.secret, { username: bad })).status, 400, String(bad));
    }
    for (const word of ["admin", "ADM1N", "p99", "root", "support", "manager", "system", "null", "me", "everyone", "here", "channel", "r00t"]) {
      assert.equal((await set(pia.secret, { username: word })).status, 400, word);
    }
    for (const lookalike of ["pia.moss", "PIA.MOSS", "piamoss", "pia_moss", "p1a-m0ss", "pia.rnoss"]) {
      assert.equal((await set(rex.secret, { username: lookalike })).status, 409, lookalike);
    }
    assert.equal((await set(rex.secret, { username: "rex", email: "pia@example.com" })).status, 400);
    assert.equal((await browse("GET", "/me", pia.secret)).json.username, "pia.moss");
    const renamed = await set(rex.secret, { username: "@Captain.Rex" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.equal(renamed.json.username, "captain.rex");
    assert.equal((await set(rex.secret, { username: "captain.rex" })).status, 200);
    assert.equal((await browse("GET", "/me", rex.secret)).json.username, "captain.rex");
  });

  await check("an assignee is a member of the item's host by username, kept by e-mail and shown without it", async () => {
    const filed = await browse("POST", "/issues", pia.secret, issueBody());
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const key = filed.json.key;
    const assign = (who) => browse("PATCH", `/issues/${key}`, rex.secret, { assignee: who });
    assert.equal((await browse("PATCH", `/issues/${key}`, pia.secret, { assignee: "pia.moss" })).status, 403);
    assert.equal((await assign("sam.away")).status, 400);
    assert.equal((await assign("pia@example.com")).status, 400);
    assert.equal((await assign("nobody.here")).status, 400);
    const given = await assign("@pia.moss");
    assert.equal(given.status, 200, JSON.stringify(given.json));
    assert.deepEqual(given.json.assignee, { username: "pia.moss" });
    assert.deepEqual((await assign("me")).json.assignee, { username: "captain.rex" });
    assert.equal((await browse("PATCH", "/me", rex.secret, { username: "rex.holt" })).status, 200);
    const thread = await browse("GET", `/issues/${key}`, rex.secret);
    assert.deepEqual(thread.json.issue.assignee, { username: "rex.holt" });
    const moves = thread.json.events.filter((e) => e.kind === "assignee").map((e) => e.detail);
    assert.deepEqual(moves, [{ from: null, to: { username: "pia.moss" } }, { from: { username: "pia.moss" }, to: { username: "rex.holt" } }]);
    const listed = await call("GET", `/_p99/v1/issues?scope=all&host=${here}&limit=5`);
    assert.deepEqual(listed.json.issues.find((i) => i.key === key).assignee, { username: "rex.holt" });
    for (const text of [JSON.stringify(thread.json.issue.assignee), JSON.stringify(moves), JSON.stringify(listed.json.issues.map((i) => i.assignee))]) {
      assert.equal(text.includes("rex@example.com") || text.includes("pia@example.com"), false);
    }
    assert.equal((await browse("GET", `/issues/${key}`, pia.secret)).json.issue.assignee, null);
    assert.deepEqual((await assign(null)).json.assignee, null);
  });

  await check("an agent acts as its person: the same username, never one of its own", async () => {
    const filed = await browse("POST", "/issues", pia.secret, issueBody());
    const path = `/_p99/v1/issues/${filed.json.key}?host=${here}`;
    const before = (await call("GET", "/_p99/v1/people")).json.people.length;
    const asAgent = await call("PATCH", path, { body: { assignee: "me" }, actor: { email: "grace@example.com", name: "Grace Hopper", agent: true } });
    assert.equal(asAgent.status, 200, JSON.stringify(asAgent.json));
    const asPerson = await call("PATCH", path, { body: { assignee: null }, actor: { email: "grace@example.com", name: "Grace Hopper" } });
    assert.equal(asPerson.status, 200);
    const again = await call("PATCH", path, { body: { assignee: "me" }, actor: { email: "Grace@Example.com", name: "Grace Hopper" } });
    assert.deepEqual(again.json.assignee, asAgent.json.assignee);
    assert.ok(/^grace\.hopper\d*$/.test(asAgent.json.assignee.username), asAgent.json.assignee.username);
    assert.equal((await call("GET", "/_p99/v1/people")).json.people.length, before);
  });

  await check("migration 0012 gives every code and assignee a person with a de-duplicated default username", async () => {
    const people = (await call("GET", "/_p99/v1/people")).json.people.map((p) => p.username);
    for (const name of ["zoe.angstrom", "zoe.angstrom2", "admin2"]) assert.ok(people.includes(name), people.join(","));
    const legacy = await call("GET", "/_p99/v1/issues/BUG-902");
    assert.deepEqual(legacy.json.issue.assignee, { username: "old.hand" });
  });
}

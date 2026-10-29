import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export default async function (kit) {
  const { check, call, browse, people } = kit;
  const ada = people.ada;
  const shop = kit.space.projects.find((p) => p.name === "Shop");
  const blog = kit.space.projects.find((p) => p.name === "Blog");
  const shopHost = shop.hosts[0];
  const blogHost = blog.hosts[0];
  const invite = async (body) => {
    const made = await call("POST", "/_p99/v1/codes", { actor: ada, body: { role: "user", mail: false, ...body } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json;
  };
  const projectsOf = async (secret) => (await browse("GET", "/space", secret)).json.projects.map((p) => p.name);
  const codeRow = async (id) => (await call("GET", "/_p99/v1/codes", { actor: ada })).json.codes.find((c) => c.id === id);
  const card = async (project, title) => {
    const made = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project, title } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.card.key;
  };

  await check("us-invite-001 a code opens nothing on a site outside its project", async () => {
    const tag = randomUUID().slice(0, 8);
    const grace = await invite({ name: "Grace Hopper", email: `grace.${tag}@example.com`, grant: { projects: [blog.name] } });
    assert.deepEqual(grace.links, [`https://${blogHost}/#p99=${grace.secret}`], "the invite links only the sites of her project");
    assert.equal((await browse("GET", "/me?path=%2F", grace.secret, undefined, shopHost)).status, 401);
    assert.equal((await browse("GET", "/space", grace.secret, undefined, shopHost)).status, 401);
    const filed = await browse("POST", "/issues", grace.secret, kit.issueBody({ title: `Filed outside the project ${tag}` }), shopHost);
    assert.equal(filed.status, 401, JSON.stringify(filed.json));
    const found = await call("GET", `/_p99/v1/issues?host=${shopHost}&scope=all&q=${tag}`, { actor: ada });
    assert.equal(found.status, 200);
    assert.deepEqual(found.json.issues, []);
    assert.equal((await browse("GET", "/me?path=%2F", grace.secret, undefined, blogHost)).status, 200, "her own project's site opens");
    const listed = await codeRow(grace.code.id);
    assert.deepEqual(listed.grant, { projects: [blog.name] });
    assert.equal(listed.revoked_at, null);
  });

  await check("us-invite-002 a space code reaches every project including one made later", async () => {
    const tag = randomUUID().slice(0, 8);
    const later = `Invite Later ${tag}`;
    const whole = await invite({ name: "Grace Hopper", email: `grace.space.${tag}@example.com`, role: "owner", grant: { space: true } });
    assert.deepEqual(whole.code.grant, { space: true });
    const bounded = await invite({ name: "Mary Jackson", email: `mary.projects.${tag}@example.com`, role: "owner", grant: { projects: [shop.name] } });
    const before = await projectsOf(whole.secret);
    for (const project of kit.space.projects) assert.ok(before.includes(project.name), before.join(","));
    assert.equal(before.includes(later), false);
    assert.equal((await call("POST", "/_p99/v1/projects", { actor: ada, body: { name: later } })).status, 201);
    const key = await card(later, `First card ${tag}`);
    assert.ok((await projectsOf(whole.secret)).includes(later), "the new project shows to the space code at once");
    assert.ok((await browse("GET", "/board", whole.secret)).json.cards.some((c) => c.key === key));
    assert.equal((await browse("GET", `/cards/${key}`, whole.secret)).status, 200);
    assert.deepEqual((await codeRow(whole.code.id)).grant, { space: true });
    assert.deepEqual(await projectsOf(bounded.secret), [shop.name], "a project code did not grow");
    assert.equal((await browse("GET", `/cards/${key}`, bounded.secret)).status, 404);
  });

  await check("us-invite-002 a project code never reaches another projects items", async () => {
    const tag = randomUUID().slice(0, 8);
    const shopCard = await card(shop.name, `Card in the project ${tag}`);
    const opsCard = await card("Ops", `Card in a project with no site ${tag}`);
    const blogReport = await call("POST", `/_p99/v1/issues?host=${blogHost}`, { actor: ada, body: kit.issueBody({ title: `Report on the other site ${tag}` }) });
    assert.equal(blogReport.status, 201, JSON.stringify(blogReport.json));
    const grace = await invite({ name: "Grace Hopper", email: `grace.near.${tag}@example.com`, role: "owner", grant: { projects: [shop.name] } });
    const shopReport = await browse("POST", "/issues", grace.secret, kit.issueBody({ title: `Report on her own site ${tag}` }));
    assert.equal(shopReport.status, 201, JSON.stringify(shopReport.json));

    assert.deepEqual(await projectsOf(grace.secret), [shop.name]);
    assert.deepEqual((await browse("GET", "/projects", grace.secret)).json.projects.map((p) => p.name), [shop.name]);
    const board = (await browse("GET", "/board", grace.secret)).json.cards.map((c) => c.key);
    assert.ok(board.includes(shopCard), board.join(","));
    assert.equal(board.includes(opsCard), false);
    assert.equal(board.includes(blogReport.json.key), false);
    const reports = (await browse("GET", "/issues?scope=all", grace.secret)).json.issues.map((i) => i.key);
    assert.ok(reports.includes(shopReport.json.key));
    assert.equal(reports.includes(blogReport.json.key), false);
    assert.equal((await browse("GET", `/cards/${opsCard}`, grace.secret)).status, 404);
    const direct = await browse("GET", `/issues/${blogReport.json.key}`, grace.secret);
    assert.ok([403, 404].includes(direct.status), String(direct.status));
    const sneaked = await browse("POST", "/cards", grace.secret, { client_uid: randomUUID(), project: "Ops", title: `Sneaked in ${tag}` });
    assert.equal(sneaked.status, 404, JSON.stringify(sneaked.json));
  });

  await check("us-invite-003 a host added to a project reaches every code of that project at once", async () => {
    const tag = randomUUID().slice(0, 8);
    const waiting = `Invite Pending ${tag}`;
    assert.equal((await call("POST", "/_p99/v1/projects", { actor: ada, body: { name: waiting } })).status, 201);
    const emails = [`grace.pending.${tag}@example.com`, `mary.pending.${tag}@example.com`];
    const codes = [
      await invite({ name: "Grace Hopper", email: emails[0], grant: { projects: [waiting] } }),
      await invite({ name: "Mary Jackson", email: emails[1], grant: { projects: [waiting] } }),
    ];
    assert.deepEqual(codes[0].links, [], "a project with no site has no link to mail");
    const meOf = (code) => browse("GET", "/me?path=%2F", code.secret, undefined, shopHost);
    for (const code of codes) assert.equal((await meOf(code)).status, 401);
    const move = (project) => call("PATCH", `/_p99/v1/hosts/${shopHost}`, { actor: ada, body: { project } });
    try {
      const moved = await move(waiting);
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      for (const code of codes) {
        const me = await meOf(code);
        assert.equal(me.status, 200, JSON.stringify(me.json));
        assert.equal(me.json.host, shopHost);
      }
    } finally {
      assert.equal((await move(shop.name)).status, 200);
    }
    for (const code of codes) assert.equal((await meOf(code)).status, 401, "moved out, the site shuts again");
    for (const email of emails) assert.deepEqual(kit.mail.inbox(email), [], "moving a site mailed someone");
    for (const code of codes) assert.deepEqual((await codeRow(code.code.id)).grant, { projects: [waiting] });
  });

  await check("us-invite-003 an agent cannot change a grant", async () => {
    const tag = randomUUID().slice(0, 8);
    const grace = await invite({ name: "Grace Hopper", email: `grace.agent.${tag}@example.com`, grant: { projects: [shop.name] } });
    const patch = (actor, grant) => call("PATCH", `/_p99/v1/codes/${grace.code.id}`, { actor, body: { grant } });
    for (const grant of [{ space: true }, { projects: [] }, { projects: [blog.name] }]) {
      const refused = await patch(people.agent, grant);
      assert.equal(refused.status, 403, JSON.stringify(refused.json));
      assert.match(refused.json.message, /only a person changes a grant/);
    }
    assert.deepEqual((await codeRow(grace.code.id)).grant, { projects: [shop.name] });
    assert.equal((await browse("GET", "/me?path=%2F", grace.secret)).status, 200);
    const changed = await patch(ada, { projects: [blog.name] });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.deepEqual(changed.json.code.grant, { projects: [blog.name] });
    assert.equal((await browse("GET", "/me?path=%2F", grace.secret)).status, 401);
    assert.deepEqual(kit.mail.inbox(grace.code.email), []);
  });
}

import assert from "node:assert/strict";
import { GITHUB_REPO, deliverGithub, fileAs, mailsFor, places, reporter, thread, uniqueTitle } from "../us-support/delivery.mjs";

export default async function (kit) {
  const { shop, blog } = places(kit);
  const link = (host) => kit.call("PUT", `/_p99/v1/github/${host}`, { body: { repo: GITHUB_REPO } });
  let pull = 400 + Math.floor(Math.random() * 500);
  const merged = (body) => {
    const number = pull++;
    return {
      action: "closed",
      repository: { full_name: GITHUB_REPO },
      pull_request: { number, merged: true, title: "Keep the totals in step", body, html_url: `https://github.com/${GITHUB_REPO}/pull/${number}` },
    };
  };

  await kit.check("us-github-001 a merged pull request with fixes marks the item fixed and grace is told", async () => {
    assert.equal((await link(shop)).status, 200);
    assert.equal((await link(blog)).status, 200);
    const grace = await reporter(kit, shop, "Grace Hopper");
    const elsewhere = await reporter(kit, blog, "Mary Jackson");
    const mine = await fileAs(kit, grace, uniqueTitle("The total does not update"));
    const theirs = await fileAs(kit, elsewhere, uniqueTitle("The feed is empty"));
    const delivered = await deliverGithub(kit, shop, "pull_request", merged(`Keep the totals in step\n\nFixes: ${mine.key}\nFixes: ${theirs.key}`));
    assert.equal(delivered.status, 200, JSON.stringify(delivered.json));
    assert.deepEqual(delivered.json.changed, [mine.key]);
    const seen = await kit.browse("GET", `/issues/${mine.key}`, grace.secret, undefined, shop);
    assert.equal(seen.json.issue.stage, "fixed");
    const other = await thread(kit, theirs.key, blog);
    assert.equal(other.issue.closed_at, null, "Blog's item stays open");
    await kit.until("Grace's mail", async () => (await mailsFor(kit, grace.email, `[${mine.key}] Fixed`)).length === 1);
  });

  await kit.check("us-github-001 closing p99s issue marks the item fixed once and a duplicate close leaves it open", async () => {
    assert.equal((await link(shop)).status, 200);
    const grace = await reporter(kit, shop, "Grace Hopper");
    const item = await fileAs(kit, grace, uniqueTitle("The receipt shows the old address"));
    const opened = await kit.call("POST", `/_p99/v1/issues/${item.key}/github`);
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.ok(JSON.stringify(await kit.github.issues()).includes(item.key), "GitHub took the issue");
    const number = opened.json.number;
    const closed = (more = {}) => ({ action: "closed", repository: { full_name: GITHUB_REPO }, issue: { number, state_reason: "completed", ...more } });
    for (const payload of [
      closed({ state_reason: "not_planned" }),
      closed({ state_reason: "duplicate" }),
      closed({ pull_request: { url: "https://example.com/pull/1" } }),
      { ...closed(), action: "edited" },
    ]) {
      const quiet = await deliverGithub(kit, shop, "issues", payload);
      assert.equal(quiet.status, 204, JSON.stringify(payload));
      assert.equal((await thread(kit, item.key, shop)).issue.closed_at, null, JSON.stringify(payload));
    }
    const fixed = await deliverGithub(kit, shop, "issues", closed());
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    assert.ok(fixed.json.changed.includes(item.key));
    const stored = (await thread(kit, item.key, shop)).issue;
    assert.equal(stored.resolution, "fixed");
    assert.ok(stored.closed_at);
    const again = await deliverGithub(kit, shop, "issues", closed());
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.changed.includes(item.key), false);
    assert.equal((await thread(kit, item.key, shop)).issue.closed_at, stored.closed_at);
  });
}

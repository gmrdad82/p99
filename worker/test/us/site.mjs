import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ADA = { email: "ada@example.com", name: "Ada Lovelace" };

export default async function (kit) {
  await kit.check("us-site-001 a host taken off p99 stops its widget and keeps its items", async () => {
    const shop = kit.space.projects.find((p) => p.name === "Shop");
    assert.ok(shop, "the seeded space has a Shop project");
    const host = `gone-${randomUUID().slice(0, 8)}.example.com`;
    const signed = (method, path, body) => kit.call(method, `/_p99/v1${path}`, { actor: ADA, body });

    const put = await signed("PUT", `/hosts/${host}`, { env: "production", project: shop.name, config: {} });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const minted = await kit.mint("Grace Hopper", "grace@example.com", [host]);
    const code = minted.secret;
    assert.equal((await fetch(`${kit.origin(host)}/_p99/p99.js`)).status, 200, "the loader answers while the host is on P99");
    const filed = await kit.browse("POST", "/issues", code, {
      client_uid: randomUUID(),
      kind: "bug",
      title: "The receipt never arrives",
      body: "",
      page: { url: `https://${host}/orders`, path: "/orders", title: "Orders" },
      context: {},
      marks: [],
    }, host);
    assert.equal(filed.status, 201, filed.text);
    const key = filed.json.key;

    const removed = await signed("DELETE", `/hosts/${host}`);
    assert.equal(removed.status, 204);

    assert.equal((await fetch(`${kit.origin(host)}/_p99/p99.js`)).status, 404, "the loader answers 404 at once");
    assert.equal((await fetch(`${kit.origin(host)}/_p99/panel.js?v=dev`)).status, 404, "the panel answers 404");
    assert.equal((await kit.browse("GET", "/me", code, undefined, host)).status, 404, "signing in answers 404");
    const again = await kit.browse("POST", "/issues", code, {
      client_uid: randomUUID(),
      kind: "bug",
      title: "One more after the host left",
      body: "",
      page: { url: `https://${host}/orders`, path: "/orders", title: "Orders" },
      context: {},
      marks: [],
    }, host);
    assert.equal(again.status, 404, "filing answers 404");

    const kept = await signed("GET", `/issues/${key}`);
    assert.equal(kept.status, 200, "the item stays for Ada");
    assert.equal(kept.json.issue.title, "The receipt never arrives");
    assert.equal(kept.json.issue.project, shop.name, "in its project");
    const listed = await signed("GET", `/issues?scope=all&status=any&project=${encodeURIComponent(shop.name)}&q=${encodeURIComponent("The receipt never arrives")}`);
    assert.ok(listed.json.issues.some((i) => i.key === key), "the project still lists it");
  });
}

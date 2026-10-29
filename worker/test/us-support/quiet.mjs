import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function settle(kit) {
  const ada = kit.people.ada;
  const host = kit.space.projects.find((p) => p.name === "Shop").hosts[0];
  const mark = randomUUID().slice(0, 8);
  const email = `settle.${mark}@example.com`;
  const text = `The outbox settles ${mark}`;
  const minted = await kit.mint("Mary Jackson", email, [host]);
  let key = null;
  try {
    const filed = await kit.browse("POST", "/issues", minted.secret, kit.issueBody({ title: text }), host);
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    key = filed.json.key;
    const replied = await kit.call("POST", `/_p99/v1/issues/${key}/comments?host=${host}`, {
      actor: ada,
      body: { client_uid: randomUUID(), body: text },
    });
    assert.equal(replied.status, 201, JSON.stringify(replied.json));
    await kit.until(`the settling mail to ${email}`, () => kit.mail.inbox(email).some((m) => String(m.text).includes(text)));
    return key;
  } finally {
    if (key) await kit.call("DELETE", `/_p99/v1/issues/${key}?host=${host}`, { actor: ada });
    await kit.call("POST", `/_p99/v1/codes/${minted.code.id}/revoke`, { actor: ada });
  }
}

export function noMailTo(kit, emails) {
  const watched = [].concat(emails).map((email) => [email, kit.mail.inbox(email).length]);
  return async (why = "nobody was mailed") => {
    const key = await settle(kit);
    for (const [email, before] of watched) {
      const late = kit.mail.inbox(email).slice(before).filter((m) => !String(m.subject).includes(`[${key}]`));
      assert.deepEqual(late.map((m) => m.subject), [], `${why}: ${email}`);
    }
  };
}

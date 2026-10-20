import assert from "node:assert/strict";

export async function peopleChecks({ call, browse, mint, check, here, there }) {
  await check("the panel's people list is managers only, this host's live codes, names and e-mails alone", async () => {
    const pia = await mint("Pia Moss", "pia@example.com", [here]);
    const rex = await mint("Rex Holt", "Rex@Example.com", [here, there], true);
    await mint("Sam Away", "sam@example.com", [there]);
    const gone = await mint("Tom Gone", "tom@example.com", [here]);
    assert.equal((await call("POST", `/_p99/v1/codes/${gone.code.id}/revoke`)).status, 200);
    assert.equal((await browse("GET", "/people", pia.secret)).status, 403);
    const seen = await browse("GET", "/people", rex.secret);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const emails = seen.json.people.map((p) => p.email);
    assert.ok(emails.includes("pia@example.com") && emails.includes("rex@example.com"), emails.join(","));
    assert.ok(!emails.includes("sam@example.com") && !emails.includes("tom@example.com"), emails.join(","));
    for (const p of seen.json.people) assert.deepEqual(Object.keys(p).sort(), ["email", "manager", "name"]);
    assert.equal(seen.json.people.find((p) => p.email === "rex@example.com").manager, true);
    assert.equal(JSON.stringify(seen.json).includes(pia.secret), false);
  });
}

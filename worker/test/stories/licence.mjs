import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { bindingLicence, licenseState, linkShown } from "../../src/license.js";

function deployWords(root) {
  const source = readFileSync(join(root, "..", "src", "license.rs"), "utf8");
  const hides = /pub const HIDES_LINK: &\[&str\] = &\[([^\]]*)\];/.exec(source);
  assert.ok(hides, "src/license.rs has no HIDES_LINK list");
  const word = /pub fn word\(self\)[\s\S]*?\n    }\n/.exec(source);
  assert.ok(word, "src/license.rs has no State::word");
  return {
    hides: [...hides[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]),
    states: [...word[0].matchAll(/=> "([a-z]+)"/g)].map((m) => m[1]),
  };
}

export async function licenceStories({ base, call, browse, mint, check, here, placement, root }) {
  const there = here === "127.0.0.1" ? "localhost" : "127.0.0.1";
  const port = Number(new URL(base).port);
  const hostsNow = async () => (await call("GET", "/_p99/v1/hosts")).json.hosts;
  const envOf = async (host) => (await hostsNow()).find((h) => h.host === host).env;
  const meThere = (code) =>
    new Promise((resolve, reject) => {
      const headers = { host: `${there}:${port}`, "x-p99-code": code };
      const req = request({ host: "127.0.0.1", port, path: "/_p99/api/me", method: "GET", headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {}
          resolve({ status: res.statusCode, json });
        });
      });
      req.on("error", reject);
      req.end();
    });
  const restore = async () => {
    for (const host of [here, there]) {
      const put = await call("PUT", `/_p99/v1/hosts/${host}`, { body: { env: await envOf(host), config: placement } });
      assert.equal(put.status, 200, JSON.stringify(put.json));
    }
  };

  await check("story: every licence word deploy binds must reach the panel as the link that licence pays for", () => {
    const { hides, states } = deployWords(root);
    assert.deepEqual(states, ["free", "studio", "agency", "owner", "ff"]);
    assert.deepEqual(hides, ["agency", "owner"]);
    for (const state of states) {
      const binding = hides.includes(state) ? "hideable" : "shown";
      const env = { LICENSE_STATE: state, LICENSE_LINK: binding };
      assert.equal(licenseState(env), state);
      assert.equal(linkShown(bindingLicence(env), { link: false }), !hides.includes(state), state);
      assert.equal(linkShown(bindingLicence(env), {}), true, state);
      assert.equal(linkShown(bindingLicence(env), { link: true }), true, state);
    }
    for (const word of ["", "Owner", "OWNER", " owner", "owner ", "trial", "pro", "f&f", "friends-family"]) {
      assert.equal(licenseState({ LICENSE_STATE: word }), "free", JSON.stringify(word));
    }
    for (const env of [undefined, null, {}, { LICENSE_STATE: 1 }, { LICENSE_STATE: ["owner"] }]) {
      assert.equal(licenseState(env), "free", JSON.stringify(env));
    }
  });

  await check("story: an Agency or Owner Worker must hide the link only on the host that turned it off", async () => {
    const adaHere = await mint("Ada Lovelace", "ada@example.com", [here]);
    const adaThere = await mint("Ada Lovelace", "ada@example.com", [there]);
    try {
      const off = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: await envOf(here), config: { ...placement, link: false } } });
      assert.equal(off.status, 200, JSON.stringify(off.json));
      const hidden = await browse("GET", "/me", adaHere.secret);
      assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
      assert.equal(hidden.json.link, false);
      const neighbour = await meThere(adaThere.secret);
      assert.equal(neighbour.status, 200, JSON.stringify(neighbour.json));
      assert.equal(neighbour.json.host, there);
      assert.equal(neighbour.json.link, true);
      assert.equal(neighbour.json.license, hidden.json.license);
    } finally {
      await restore();
    }
  });

  await check("story: a hidden link must come back when the host's config is pushed without it", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    try {
      const env = await envOf(here);
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: false } } })).status, 200);
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, false);
      const moved = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, corner: "bottom-left" } } });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      const kept = (await hostsNow()).find((h) => h.host === here);
      assert.equal("link" in kept.config, false);
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, true);
    } finally {
      await restore();
    }
  });

  await check("story: a refused link value must leave a hidden link hidden, not shown or broken", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    try {
      const env = await envOf(here);
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: false } } })).status, 200);
      for (const bad of ["off", "false", 0, 1, [], {}]) {
        const refused = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: bad } } });
        assert.equal(refused.status, 400, JSON.stringify(bad));
      }
      const kept = (await hostsNow()).find((h) => h.host === here);
      assert.equal(kept.config.link, false);
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, false);
    } finally {
      await restore();
    }
  });

  await check("story: nobody without the account's key may hide the link, signed by another key or not signed at all", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const env = await envOf(here);
    const body = { env, config: { ...placement, link: false } };
    try {
      const unsigned = await fetch(`${base}/_p99/v1/hosts/${here}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(unsigned.status, 401);
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body, tamper: "sig" })).status, 401);
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body, keyId: "nokey" })).status, 401);
      const byCode = await fetch(`${base}/_p99/api/hosts/${here}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-p99-code": ada.secret },
        body: JSON.stringify(body),
      });
      assert.notEqual(byCode.status, 200);
      const kept = (await hostsNow()).find((h) => h.host === here);
      assert.equal("link" in kept.config, false);
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, true);
    } finally {
      await restore();
    }
  });
}

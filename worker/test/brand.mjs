import assert from "node:assert/strict";
import { linkShown } from "../src/license.js";
import { LICENSE_STATE } from "./app.mjs";

export async function brandChecks({ call, browse, mint, check, here, placement }) {
  await check("the 'by PITO.MD' link hides only when LICENSE_LINK is hideable and the host turned it off", () => {
    const off = { link: false };
    for (const binding of [undefined, "", "shown", "Hideable", "hideable ", "studio", "owner", "agency", "ff", "free", "yes", "true"]) {
      assert.equal(linkShown({ LICENSE_LINK: binding }, off), true, String(binding));
    }
    assert.equal(linkShown({}, off), true);
    assert.equal(linkShown(undefined, off), true);
    assert.equal(linkShown({ LICENSE_LINK: "hideable" }, off), false);
    for (const config of [{}, { link: true }, { link: "false" }, { link: 0 }, { link: null }, null, undefined]) {
      assert.equal(linkShown({ LICENSE_LINK: "hideable" }, config), true, JSON.stringify(config));
    }
  });

  await check("a host keeps link: false, refuses a non-boolean link, and the Worker without the binding still shows the link", async () => {
    const listed = await call("GET", "/_p99/v1/hosts");
    const env = listed.json.hosts.find((h) => h.host === here).env;
    for (const bad of ["off", 0, 1, "false", [], {}]) {
      const refused = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: bad } } });
      assert.equal(refused.status, 400, JSON.stringify(bad));
    }
    const off = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: false } } });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    try {
      const kept = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here);
      assert.equal(kept.config.link, false);
      const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
      const me = await browse("GET", "/me", ada.secret);
      assert.equal(me.status, 200, JSON.stringify(me.json));
      assert.equal(me.json.link, true);
      const on = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: true } } });
      assert.equal(on.status, 200);
      const plain = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here);
      assert.equal("link" in plain.config, false);
    } finally {
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: placement } })).status, 200);
    }
  });

  await check("/me answers the LICENSE_STATE word for the panel's badge, and every state's badge is served", async () => {
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    const me = await browse("GET", "/me", ada.secret);
    assert.equal(me.status, 200, JSON.stringify(me.json));
    assert.equal(me.json.license, LICENSE_STATE);
    for (const state of ["free", "studio", "agency", "owner", "ff"]) {
      const art = await call("GET", `/_p99/badges/${state}.svg?v=dev`);
      assert.equal(art.status, 200, state);
      assert.match(art.response.headers.get("content-type"), /^image\/svg\+xml/);
      assert.match(await art.response.text(), /^<svg /);
    }
    assert.equal((await call("GET", "/_p99/badges/trial.svg")).status, 404);
  });
}

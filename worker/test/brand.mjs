import assert from "node:assert/strict";
import { bindingLicence, linkShown } from "../src/license.js";
import { LICENSE_STATE } from "./app.mjs";

export async function brandChecks({ call, browse, mint, check, here, placement }) {
  await check("the 'by PITO.MD' link hides only when LICENSE_LINK is hideable and the host turned it off", () => {
    const off = { link: false };
    for (const binding of [undefined, "", "shown", "Hideable", "hideable ", "studio", "owner", "agency", "ff", "free", "yes", "true"]) {
      assert.equal(linkShown(bindingLicence({ LICENSE_LINK: binding }), off), true, String(binding));
    }
    assert.equal(linkShown(bindingLicence({}), off), true);
    assert.equal(linkShown(bindingLicence(undefined), off), true);
    assert.equal(linkShown(undefined, off), true);
    assert.equal(linkShown(bindingLicence({ LICENSE_LINK: "hideable" }), off), false);
    for (const config of [{}, { link: true }, { link: "false" }, { link: 0 }, { link: null }, null, undefined]) {
      assert.equal(linkShown(bindingLicence({ LICENSE_LINK: "hideable" }), config), true, JSON.stringify(config));
    }
  });

  await check("a host keeps link: false, refuses a non-boolean link, and the Worker with LICENSE_LINK=shown still shows the link", async () => {
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
    for (const state of ["free", "studio", "agency", "ff"]) {
      const art = await call("GET", `/_p99/badges/${state}.svg?v=dev`);
      assert.equal(art.status, 200, state);
      assert.match(art.response.headers.get("content-type"), /^image\/svg\+xml/);
      assert.match(await art.response.text(), /^<svg /);
    }
    assert.equal((await call("GET", "/_p99/badges/trial.svg")).status, 404);
    assert.equal((await call("GET", "/_p99/badges/owner.svg?v=dev")).status, 404);
  });

  await check("the concrete texture is served once-rendered: WebP and PNG tiles at 1x and 2x, cached for good, and the same bytes every time", async () => {
    const magic = { webp: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP", png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) };
    for (const name of ["concrete", "concrete-dark"]) {
      for (const scale of ["", "-2x"]) {
        for (const kind of ["webp", "png"]) {
          const path = `/_p99/art/${name}${scale}.${kind}?v=dev`;
          const first = await call("GET", path);
          assert.equal(first.status, 200, path);
          assert.equal(first.response.headers.get("content-type"), `image/${kind}`, path);
          assert.match(first.response.headers.get("cache-control"), /immutable/, path);
          const bytes = Buffer.from(await first.response.arrayBuffer());
          assert.ok(bytes.length > 1000 && magic[kind](bytes), path);
          const again = Buffer.from(await (await call("GET", path)).response.arrayBuffer());
          assert.ok(again.equals(bytes), path);
          assert.equal((await call("HEAD", path)).status, 200, path);
        }
      }
    }
    assert.equal((await call("GET", "/_p99/art/concrete.svg?v=dev")).status, 404);
  });
}

export async function hideableLinkChecks({ call, browse, mint, check, here, placement }) {
  await check("with LICENSE_LINK=hideable, /me hides the link for a host with link: false and shows it again with link: true", async () => {
    const env = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here).env;
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    try {
      const off = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: false } } });
      assert.equal(off.status, 200, JSON.stringify(off.json));
      const hidden = await browse("GET", "/me", ada.secret);
      assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
      assert.equal(hidden.json.link, false);
      assert.equal(hidden.json.license, LICENSE_STATE);
      const on = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: true } } });
      assert.equal(on.status, 200, JSON.stringify(on.json));
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, true);
    } finally {
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: placement } })).status, 200);
    }
  });

  await check("a deploy bound LICENSE_LINK=hideable reaches the panel: the served panel drops the link on the host that turned it off and keeps it elsewhere", async () => {
    const served = await call("GET", "/_p99/panel.js?v=dev");
    assert.equal(served.status, 200);
    const source = await served.response.text();
    assert.match(source, /\(me && me\.link === false\) \? null : h\("a", \{ class: "p99-by"/);
    const env = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here).env;
    const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
    try {
      assert.equal((await browse("GET", "/me", ada.secret)).json.link, true);
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: { ...placement, link: false } } })).status, 200);
      const hidden = await browse("GET", "/me", ada.secret);
      assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
      assert.equal(hidden.json.link, false);
      assert.equal(hidden.json.host, here);
      const shown = hidden.json.license === "owner" ? "agency" : hidden.json.license;
      assert.equal((await call("GET", `/_p99/badges/${shown}.svg?v=dev`)).status, 200);
    } finally {
      assert.equal((await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env, config: placement } })).status, 200);
    }
    assert.equal((await browse("GET", "/me", ada.secret)).json.link, true);
  });
}

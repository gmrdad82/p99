import assert from "node:assert/strict";

export async function placementChecks({ base, call, browse, mint, check, here, placement }) {
  const envOf = async () => (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here).env;
  const put = async (config) => call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: await envOf(), config } });
  const loader = async () => (await fetch(`${base}/_p99/p99.js`)).text();

  await check("a host's placement keeps its anchor, its pages without the button and its own words, and the loader and /me carry them", async () => {
    const config = {
      ...placement,
      above: "#chat-launcher",
      off: ["/checkout", "/account/*", "/admin/**"],
      strings: { title: "Tell us", send: "Send it", empty: "" },
    };
    const saved = await put(config);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    try {
      assert.deepEqual(saved.json.config, config);
      const listed = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here);
      assert.deepEqual(listed.config, config);
      const served = await loader();
      if (served.includes('"c":"top-left"')) {
        assert.ok(served.includes('"a":"#chat-launcher"'), "the anchor is in the loader");
        assert.ok(served.includes('"f":["^/checkout/?$","^/account/[^/]*/?$","^/admin/.*/?$"]'), "the off pages are patterns in the loader");
        assert.equal(served.includes("Tell us"), false, "the words wait for /me");
      }
      const ada = await mint("Ada Lovelace", "ada@example.com", [here]);
      const me = await browse("GET", "/me", ada.secret);
      assert.equal(me.status, 200, JSON.stringify(me.json));
      assert.deepEqual(me.json.strings, { title: "Tell us", send: "Send it", empty: "" });
    } finally {
      assert.equal((await put(placement)).status, 200);
    }
    const plain = await browse("GET", "/me", (await mint("Ada Lovelace", "ada@example.com", [here])).secret);
    assert.deepEqual(plain.json.strings, {});
    assert.equal((await loader()).includes('"a":'), false);
  });

  await check("an off page with regex characters is escaped, and an empty off list or null fields are dropped", async () => {
    const odd = await put({ ...placement, off: ["/a.b", "/(x)", "/c+d?"], above: null, strings: null });
    assert.equal(odd.status, 200, JSON.stringify(odd.json));
    try {
      assert.deepEqual(odd.json.config, { ...placement, off: ["/a.b", "/(x)", "/c+d?"] });
      const served = await loader();
      if (served.includes('"c":"top-left"')) assert.ok(served.includes('"f":["^/a\\\\.b/?$","^/\\\\(x\\\\)/?$","^/c\\\\+d\\\\?/?$"]'), served.slice(0, 400));
      const none = await put({ ...placement, off: [] });
      assert.equal(none.status, 200);
      assert.deepEqual(none.json.config.off, []);
      assert.equal((await loader()).includes('"f":'), false);
    } finally {
      assert.equal((await put(placement)).status, 200);
    }
  });

  await check("a placement with a bad anchor, off page or words is refused and the saved one stays", async () => {
    const tooLong = "x".repeat(301);
    const bad = {
      "an empty anchor": { above: "" },
      "an anchor past 300 characters": { above: tooLong },
      "an anchor that isn't text": { above: 12 },
      "off that isn't a list": { off: "/checkout" },
      "off past 100 pages": { off: Array.from({ length: 101 }, (_, i) => `/p${i}`) },
      "an off page without its slash": { off: ["checkout"] },
      "an empty off page": { off: [""] },
      "an off page past 300 characters": { off: [`/${tooLong}`] },
      "an off page that isn't text": { off: [7] },
      "words that aren't a map": { strings: ["Tell us"] },
      "a word with a bad name": { strings: { "two words": "x" } },
      "a word past 2,000 characters": { strings: { title: "x".repeat(2001) } },
      "a word that isn't text": { strings: { title: 1 } },
      "past 200 words": { strings: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`w${i}`, "x"])) },
      "a config past 32 KiB": { strings: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`w${i}`, "x".repeat(2000)])) },
    };
    for (const [why, fields] of Object.entries(bad)) {
      const refused = await put({ ...placement, ...fields });
      assert.equal(refused.status, 400, why);
      assert.equal(refused.json.message, "config is not valid", why);
    }
    const kept = (await call("GET", "/_p99/v1/hosts")).json.hosts.find((h) => h.host === here);
    assert.deepEqual(kept.config, placement);
  });
}

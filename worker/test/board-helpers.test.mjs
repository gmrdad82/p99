import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "board.js"), "utf8");

function lift(names, scope = {}) {
  const lines = names.map((name) => {
    const line = source.split("\n").find((l) => l.startsWith(`function ${name}(`));
    assert.ok(line, `board.js has no one-line function ${name}`);
    return line;
  });
  const keys = Object.keys(scope);
  const body = `${lines.join("\n")}\nreturn { ${names.join(", ")} };`;
  return new Function(...keys, body)(...keys.map((k) => scope[k]));
}

test("same compares ids and words without case, as text", () => {
  const { same } = lift(["same"]);
  assert.equal(same("Done", "done"), true);
  assert.equal(same(12, "12"), true);
  assert.equal(same("done", "doing"), false);
  assert.equal(same("", ""), true);
});

test("person turns a bare username into a person and leaves a person alone", () => {
  const { person } = lift(["person"]);
  assert.deepEqual(person("ada"), { username: "ada" });
  const grace = { username: "grace", avatar: "/a.png" };
  assert.equal(person(grace), grace);
  assert.equal(person(null), null);
  assert.equal(person(undefined), undefined);
});

test("handle writes @username and nothing for a person without one", () => {
  const { handle } = lift(["handle"]);
  assert.equal(handle({ username: "ada" }), "@ada");
  assert.equal(handle({ username: "" }), "");
  assert.equal(handle({}), "");
  assert.equal(handle(null), "");
  assert.equal(handle(undefined), "");
});

test("src takes a same-site path or an https address and refuses everything else", () => {
  const { src } = lift(["src"]);
  assert.equal(src("/_p99/avatar.png"), "/_p99/avatar.png");
  assert.equal(src("https://example.com/a.png"), "https://example.com/a.png");
  for (const bad of ["//evil.example.com/a.png", "/\\evil.example.com", "http://example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "a.png", "", null, undefined, 7, {}, ["/a.png"]]) {
    assert.equal(src(bad), null, JSON.stringify(bad));
  }
});

test("elsewhere is true only for an event from another host, and only once the board names its host", () => {
  const scope = (ctx, search = "") => ({ B: { ctx }, location: { hostname: "example.com" }, URLSearchParams, query: () => search });
  const named = lift(["elsewhere"], scope({ host: "example.com", query: () => "" })).elsewhere;
  assert.equal(named({ host: "example.com" }), false);
  assert.equal(named({ host: "shop.example.com" }), true);
  assert.equal(named({}), false);
  const bare = lift(["elsewhere"], scope({}, "")).elsewhere;
  assert.equal(bare({ host: "shop.example.com" }), false);
  const asked = lift(["elsewhere"], scope({}, "host=shop.example.com")).elsewhere;
  assert.equal(asked({ host: "shop.example.com" }), true);
  assert.equal(asked({ host: "example.com" }), false);
});

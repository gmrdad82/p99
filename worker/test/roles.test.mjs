import { test } from "node:test";
import assert from "node:assert/strict";
import { useKit } from "../src/cards.js";
import { MANAGER_GONE, ROLES, ROLE_WORDS, managerOf, roleOf, roleWord } from "../src/roles.js";

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

useKit({
  fail(status, message) {
    throw new Refused(status, message);
  },
});

test("a role is owner or user, and its word is Owner or User", () => {
  assert.deepEqual(ROLES, ["owner", "user"]);
  assert.deepEqual(ROLE_WORDS, { owner: "Owner", user: "User" });
  assert.equal(roleOf(true), "owner");
  assert.equal(roleOf(1), "owner");
  assert.equal(roleOf(false), "user");
  assert.equal(roleOf(0), "user");
  assert.equal(roleOf(null), "user");
  assert.equal(roleWord(true), "Owner");
  assert.equal(roleWord(0), "User");
});

test("managerOf reads role, and a missing one is a User", () => {
  assert.equal(managerOf({ role: "owner" }), true);
  assert.equal(managerOf({ role: "user" }), false);
  assert.equal(managerOf({}), false);
  assert.equal(managerOf({ role: null }), false);
});

test("managerOf refuses an unknown role word", () => {
  for (const role of ["guest", "Owner", "USER", "manager", "person", "reporter", "", 1, true]) {
    assert.throws(() => managerOf({ role }), (e) => e.status === 400 && /owner or user/.test(e.message), String(role));
  }
});

test("the old manager alias is refused, never read as a role", () => {
  for (const body of [{ manager: true }, { manager: false }, { role: "owner", manager: true }, { role: "user", manager: null }]) {
    assert.throws(() => managerOf(body), (e) => e.status === 400 && e.message === MANAGER_GONE, JSON.stringify(body));
  }
});

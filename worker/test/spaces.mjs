import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { MAX_MASKS, MAX_MASK_CHARS, isSelectorList, maskRefusal } from "../src/selectors.js";
import { PERSON_LICENSES, REFUSALS, civilDay, normalize } from "../src/license.js";
import { PERSON_GRANTS, WHOLE_SPACE } from "../src/spaces.js";
import { PARKED } from "../src/grants.js";
import { AVATAR_SIZE_RULE, AVATAR_TYPE_RULE, MAX_AVATAR_BYTES } from "../src/avatars.js";

const ada = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const adaBot = { email: "ada@example.com", name: "Ada Lovelace", agent: true, via: "pci" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");

const pair = generateKeyPairSync("ed25519");
export const LICENCE_TEST_KEY = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

export function licenceKey(claims) {
  const payload = Buffer.from(JSON.stringify({ v: 2, app: "p99", type: "timed", grace_days: 14, ...claims })).toString("base64url");
  const signed = `PITO1.${payload}`;
  return `${signed}.${sign(null, Buffer.from(signed), pair.privateKey).toString("base64url")}`;
}

export async function spaceUnitChecks(check) {
  await check("[spaces] a mask selector parses as a CSS selector list, and every limit refuses", () => {
    for (const good of [".card-number", "#pay > input[type=\"tel\"]", "[data-secret]", "div.a, span.b", "li:nth-child(2n+1 of .x)", ":not(.a, .b) .c", "a:has(> img)", "input[name^=card i]", "p::before"]) {
      assert.equal(isSelectorList(good), true, good);
    }
    for (const bad of ["", ".", "#", "div >", ">a", "a,,b", "[x=]", "a:not(", "a{}", "a;b", "div..x", "a:nth-child(foo)", "[data-x", "<b>"]) {
      assert.equal(isSelectorList(bad), false, bad);
    }
    assert.equal(maskRefusal([]), null);
    assert.equal(maskRefusal(Array(MAX_MASKS).fill(".x")), null);
    assert.match(maskRefusal(Array(MAX_MASKS + 1).fill(".x")), /at most 50/);
    assert.equal(maskRefusal(["." + "a".repeat(MAX_MASK_CHARS - 1)]), null);
    assert.match(maskRefusal(["." + "a".repeat(MAX_MASK_CHARS)]), /at most 200 characters/);
    assert.match(maskRefusal(["div >"]), /not a CSS selector/);
    assert.match(maskRefusal(".x"), /list of CSS selectors/);
    assert.match(maskRefusal([3]), /CSS selector/);
  });

  await check("[spaces] a licence key reads through armour, soft breaks and quoting, as p99 license does", () => {
    const key = licenceKey({ tier: "studio", paid_through: "2099-12-31" });
    const armoured = `> -----BEGIN PITO MD LICENCE-----\n> ${key.slice(0, 30)}=\n${key.slice(30)}\n> -----END PITO MD LICENCE-----\n`;
    assert.equal(normalize(armoured), key);
    assert.equal(normalize(` ${key}​ `), key);
    assert.equal(normalize("-----BEGIN A-----\nabc\n-----END B-----"), "");
    assert.equal(civilDay("2026-02-29"), null);
    assert.equal(civilDay("2028-02-29") - civilDay("2028-02-28"), 1);
  });
}

export async function spaceChecks({ base, call, browse, mint, check, issueBody, here, there, sent }) {
  const space = (code) => (code ? browse("GET", "/space", code) : call("GET", "/_p99/v1/space", { actor: ada }));
  const grantCode = (name, email, grant, extra = {}) =>
    call("POST", "/_p99/v1/codes", { body: { name, email, grant, role: "owner", mail: false, ...extra } });
  const hereProject = (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts.find((h) => h.host === here).project;
  const thereProject = (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts.find((h) => h.host === there).project;

  await check("[spaces] a host belongs to one project: a new host needs one, an update keeps it, and the hosts list names it", async () => {
    const hosts = (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts;
    assert.ok(hosts.every((h) => "project" in h), JSON.stringify(hosts));
    assert.ok(hereProject && thereProject && hereProject !== thereProject);
    const bare = await call("PUT", "/_p99/v1/hosts/new.example.com", { body: { env: "production", config: {} } });
    assert.equal(bare.status, 400);
    assert.match(bare.json.message, /a new host needs a project/);
    const unknown = await call("PUT", "/_p99/v1/hosts/new.example.com", { body: { env: "production", config: {}, project: "No Such Project" } });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.message, /no project is called No Such Project/);
    const kept = await call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: "production", config: {} } });
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.equal(kept.json.project, hereProject);
  });

  await check("[spaces] POST /projects makes a project, a name taken in any case is 409, and only a whole-space Owner may", async () => {
    const made = await call("POST", "/_p99/v1/projects", { actor: adaBot, body: { name: "Atlas" } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual(made.json, { project: { name: "Atlas", hosts: [], open: 0, closed: 0 } });
    const taken = await call("POST", "/_p99/v1/projects", { actor: ada, body: { name: "ATLAS" } });
    assert.equal(taken.status, 409);
    for (const name of ["", "x".repeat(41), 7]) assert.equal((await call("POST", "/_p99/v1/projects", { actor: ada, body: { name } })).status, 400);
    const limited = await grantCode("Grace Hopper", "grace.limited@example.com", { projects: [hereProject] });
    assert.equal(limited.status, 201, JSON.stringify(limited.json));
    const refused = await browse("POST", "/projects", limited.json.secret, { name: "Mine" });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.message, WHOLE_SPACE);
    const user = await mint("Mary Somerville", "mary.projects@example.com", [here]);
    assert.equal((await browse("POST", "/projects", user.secret, { name: "Mine" })).status, 403);
  });

  await check("[spaces] PUT /hosts adds a host in a project, and PATCH /hosts moves it with its items, reaching the new project's codes at once", async () => {
    assert.equal((await call("POST", "/_p99/v1/projects", { actor: ada, body: { name: "Hermes" } })).status, 201);
    const added = await call("PUT", "/_p99/v1/hosts/Atlas.Example.com", { body: { env: "production", config: {}, project: "atlas" } });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.equal(added.json.host, "atlas.example.com");
    assert.equal(added.json.project, "Atlas");
    assert.equal((await call("PUT", "/_p99/v1/hosts/atlas.example.com", { body: { env: "production", config: {} } })).status, 200);
    const filed = await call("POST", "/_p99/v1/issues?host=atlas.example.com", { actor: ada, body: issueBody({ title: "Filed on Atlas" }) });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const hermes = await grantCode("Katherine Johnson", "katherine.hermes@example.com", { projects: ["Hermes"] });
    assert.deepEqual(hermes.json.code.hosts, []);
    const moved = await call("PATCH", "/_p99/v1/hosts/atlas.example.com", { actor: adaBot, body: { project: "Hermes" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.project, "Hermes");
    assert.equal(moved.json.moved, 1);
    const codes = (await call("GET", "/_p99/v1/codes?host=atlas.example.com")).json.codes;
    assert.deepEqual(codes.find((cd) => cd.id === hermes.json.code.id).hosts, ["atlas.example.com"]);
    const projects = (await space()).json.projects;
    assert.deepEqual(projects.find((p) => p.name === "Hermes"), { name: "Hermes", hosts: ["atlas.example.com"], open: 1, closed: 0 });
    assert.deepEqual(projects.find((p) => p.name === "Atlas"), { name: "Atlas", hosts: [], open: 0, closed: 0 });
    assert.equal((await call("PATCH", "/_p99/v1/hosts/atlas.example.com", { body: { project: "Nowhere" } })).status, 400);
    assert.equal((await call("PATCH", "/_p99/v1/hosts/gone.example.com", { body: { project: "Hermes" } })).status, 404);
    assert.equal((await call("PATCH", "/_p99/v1/hosts/atlas.example.com", { body: { project: "Hermes", env: "dev" } })).status, 400);
  });

  await check("[spaces] PATCH /projects renames a project, and its cards' project follows", async () => {
    const card = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project: "Hermes", title: "Renamed with its project" } });
    assert.equal(card.status, 201, JSON.stringify(card.json));
    const renamed = await call("PATCH", "/_p99/v1/projects/hermes", { actor: ada, body: { name: "Hermes Two" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.equal(renamed.json.project.name, "Hermes Two");
    const read = await call("GET", `/_p99/v1/cards/${card.json.card.key}`, { actor: ada });
    assert.equal(read.json.card.project, "Hermes Two");
    assert.equal((await call("PATCH", "/_p99/v1/projects/Hermes%20Two", { actor: ada, body: { name: "atlas" } })).status, 409);
    assert.equal((await call("PATCH", "/_p99/v1/projects/Nowhere", { actor: ada, body: { name: "Somewhere" } })).status, 404);
    assert.equal((await call("PATCH", "/_p99/v1/projects/Atlas", { actor: ada, body: { name: "Atlas", hosts: [] } })).status, 400);
  });

  await check("[spaces] a card from the CLI or an agent names a project and needs no host", async () => {
    const card = await call("POST", "/_p99/v1/cards", { actor: adaBot, body: { client_uid: randomUUID(), project: "Atlas", title: "No host at all" } });
    assert.equal(card.status, 201, JSON.stringify(card.json));
    assert.equal(card.json.card.host, null);
    assert.equal(card.json.card.project, "Atlas");
    const listed = await call("GET", "/_p99/v1/cards?project=atlas", { actor: ada });
    assert.ok(listed.json.cards.some((cd) => cd.key === card.json.card.key));
    const board = await call("GET", "/_p99/v1/board?project=Atlas", { actor: ada });
    assert.deepEqual(board.json.cards.map((cd) => [cd.key, cd.host]), [[card.json.card.key, null]]);
  });

  await check("[spaces] a code grants the space or projects: a project grant sees only its hosts and cards, the space sees all", async () => {
    const mine = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project: hereProject, title: "Hostless, in this host's project" } });
    const other = await call("POST", "/_p99/v1/cards", { actor: ada, body: { client_uid: randomUUID(), project: thereProject, title: "Hostless, in the other project" } });
    assert.equal(mine.status, 201, JSON.stringify(mine.json));
    assert.equal(other.status, 201, JSON.stringify(other.json));
    const limited = await grantCode("Grace Hopper", "grace.grant@example.com", { projects: [hereProject] });
    assert.deepEqual(limited.json.code.grant, { projects: [hereProject] });
    assert.deepEqual(limited.json.code.hosts, [here]);
    const code = limited.json.secret;
    const reached = (await space(code)).json;
    assert.deepEqual(reached.projects.map((p) => p.name), [hereProject]);
    assert.deepEqual((await browse("GET", "/me", code)).json.projects, [hereProject]);
    assert.equal((await browse("GET", `/cards/${mine.json.card.key}`, code)).status, 200);
    assert.equal((await browse("GET", `/cards/${other.json.card.key}`, code)).status, 404);
    assert.equal((await browse("GET", `/issues/${other.json.card.key}`, code)).status, 404);
    const keys = (await browse("GET", "/board", code)).json.cards.map((cd) => cd.key);
    assert.ok(keys.includes(mine.json.card.key));
    assert.equal(keys.includes(other.json.card.key), false);
    const whole = await grantCode("Grace Hopper", "grace.space@example.com", { space: true });
    assert.deepEqual(whole.json.code.grant, { space: true });
    assert.ok(whole.json.code.hosts.includes(here) && whole.json.code.hosts.includes(there));
    const everything = (await browse("GET", "/board", whole.json.secret)).json.cards.map((cd) => cd.key);
    assert.ok(everything.includes(mine.json.card.key) && everything.includes(other.json.card.key));
    assert.ok((await space(whole.json.secret)).json.projects.length >= 3);
    const wrong = await grantCode("Grace Hopper", "grace.there@example.com", { projects: [thereProject] });
    assert.equal((await browse("GET", "/me", wrong.json.secret)).status, 401);
  });

  await check("[spaces] POST /codes maps the old hosts to their projects, refuses both or neither, and an unknown project", async () => {
    const legacy = await call("POST", "/_p99/v1/codes", { body: { name: "Ada Lovelace", email: "ada.legacy@example.com", hosts: [here], mail: false } });
    assert.equal(legacy.status, 201, JSON.stringify(legacy.json));
    assert.deepEqual(legacy.json.code.grant, { projects: [hereProject] });
    for (const body of [
      { hosts: [here], grant: { space: true } },
      {},
      { grant: { projects: ["No Such Project"] } },
      { grant: { projects: [] } },
      { grant: { space: false } },
      { grant: { space: true, projects: [] } },
      { grant: [hereProject] },
    ]) {
      const refused = await call("POST", "/_p99/v1/codes", { body: { name: "Ada Lovelace", email: "ada.bad@example.com", mail: false, ...body } });
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
  });

  await check("[spaces] an invite mails by default; PATCH /codes changes a grant, parks it, never mails, and is a person's", async () => {
    const minted = await call("POST", "/_p99/v1/codes", { body: { name: "Hedy Lamarr", email: "hedy.grant@example.com", grant: { projects: [hereProject] } } });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    assert.equal(minted.json.mail, "sent");
    const id = minted.json.code.id;
    const before = sent.length;
    const bot = await call("PATCH", `/_p99/v1/codes/${id}`, { actor: adaBot, body: { grant: { space: true } } });
    assert.equal(bot.status, 403);
    assert.equal(bot.json.message, PERSON_GRANTS);
    const parked = await call("PATCH", `/_p99/v1/codes/${id}`, { actor: ada, body: { grant: { projects: [] } } });
    assert.equal(parked.status, 200, JSON.stringify(parked.json));
    assert.deepEqual(parked.json.code.grant, { projects: [] });
    assert.deepEqual(parked.json.code.hosts, []);
    assert.equal(parked.json.code.revoked_at, null);
    const shut = await browse("GET", "/me", minted.json.secret);
    assert.equal(shut.status, 403);
    assert.equal(shut.json.message, PARKED);
    assert.equal((await browse("GET", "/issues", minted.json.secret)).status, 403);
    const opened = await call("PATCH", `/_p99/v1/codes/${id}`, { actor: ada, body: { grant: { space: true } } });
    assert.equal(opened.status, 200);
    assert.equal((await browse("GET", "/me", minted.json.secret)).status, 200);
    assert.equal((await call("PATCH", `/_p99/v1/codes/${id}`, { actor: ada, body: { grant: { space: true }, mail: true } })).status, 400);
    assert.equal((await call("PATCH", "/_p99/v1/codes/99999999", { actor: ada, body: { grant: { space: true } } })).status, 404);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent.length, before, "a grant change or a park sent mail");
  });

  await check("[spaces] /me names the space, the projects, the licence and the avatar", async () => {
    const owner = await mint("Ada Lovelace", "ada.me@example.com", [here], true);
    const me = (await browse("GET", "/me", owner.secret)).json;
    assert.ok(Object.hasOwn(me, "space") && Object.hasOwn(me.space, "slug") && Object.hasOwn(me.space, "name"));
    assert.deepEqual(me.projects, [hereProject]);
    assert.equal(me.project, hereProject);
    assert.deepEqual(Object.keys(me.licence).sort(), ["link", "state"]);
    assert.equal(me.licence.state, me.license);
    assert.equal(me.licensed, me.license !== "free");
    assert.equal(me.avatar, null);
    assert.deepEqual(me.mask, []);
    assert.equal(me.capture, "on");
  });

  await check("[spaces] the licence is an Owner person's: an agent and a User are refused, a bad key says why, a good one shows at once", async () => {
    const owner = await mint("Ada Lovelace", "ada.licence@example.com", [here], true);
    const user = await mint("Mary Somerville", "mary.licence@example.com", [here]);
    const key = licenceKey({ tier: "studio", paid_through: "2099-12-31" });
    const bot = await call("PUT", "/_p99/v1/licence", { actor: adaBot, body: { key } });
    assert.equal(bot.status, 403);
    assert.equal(bot.json.message, PERSON_LICENSES);
    assert.equal((await call("DELETE", "/_p99/v1/licence", { actor: adaBot })).status, 403);
    assert.equal((await browse("PUT", "/licence", user.secret, { key })).status, 403);
    const before = (await browse("GET", "/me", owner.secret)).json.license;
    for (const [bad, reason] of [
      ["not a key", REFUSALS.shape],
      [key.slice(0, -4) + "AAAA", REFUSALS.signature],
      [licenceKey({ tier: "studio", app: "other", paid_through: "2099-12-31" }), REFUSALS.app],
      [licenceKey({ tier: "enterprise", paid_through: "2099-12-31" }), REFUSALS.tier],
      [licenceKey({ tier: "studio", type: "perpetual", paid_through: "2099-12-31" }), REFUSALS.kind],
      [licenceKey({ tier: "studio", v: 1, paid_through: "2099-12-31" }), REFUSALS.version],
    ]) {
      const refused = await browse("PUT", "/licence", owner.secret, { key: bad });
      assert.equal(refused.status, 400, bad);
      assert.equal(refused.json.message, reason);
    }
    const lapsed = await browse("PUT", "/licence", owner.secret, { key: licenceKey({ tier: "agency", paid_through: "2020-01-01" }) });
    assert.equal(lapsed.status, 400);
    assert.match(lapsed.json.message, /covers builds up to 2020-01-01/);
    const put = await browse("PUT", "/licence", owner.secret, { key });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.deepEqual(put.json.licence, { state: "studio", link: "shown" });
    const me = (await browse("GET", "/me", owner.secret)).json;
    assert.equal(me.license, "studio");
    assert.equal(me.licensed, true);
    const agency = await call("PUT", "/_p99/v1/licence", { actor: ada, body: { key: licenceKey({ tier: "agency", paid_through: "2099-12-31" }) } });
    assert.deepEqual(agency.json.licence, { state: "agency", link: "hideable" });
    const removed = await browse("DELETE", "/licence", owner.secret);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.removed, true);
    assert.equal((await browse("GET", "/me", owner.secret)).json.license, before);
  });

  const avatarPut = (code, bytes, type) =>
    fetch(`${base}/_p99/api/me/avatar`, { method: "PUT", headers: { "x-p99-code": code, "content-type": type }, body: bytes });

  await check("[spaces] an avatar is a PNG, JPEG or WebP of at most 256 KB, served by username for a day, and goes on DELETE", async () => {
    const owner = await mint("Grace Hopper", "grace.avatar@example.com", [here], true);
    const viewer = await mint("Mary Somerville", "mary.avatar@example.com", [here]);
    const wrongType = await avatarPut(owner.secret, GIF, "image/gif");
    assert.equal(wrongType.status, 400);
    assert.equal((await wrongType.json()).message, AVATAR_TYPE_RULE);
    const lying = await avatarPut(owner.secret, JPEG, "image/png");
    assert.equal(lying.status, 400);
    const big = await avatarPut(owner.secret, Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]), "image/png");
    assert.equal(big.status, 413);
    assert.equal((await big.json()).message, AVATAR_SIZE_RULE);
    const atLimit = await avatarPut(owner.secret, Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES - PNG.length)]), "image/png");
    assert.equal(atLimit.status, 200);
    const stored = await avatarPut(owner.secret, JPEG, "image/jpeg");
    assert.equal(stored.status, 200);
    const url = (await stored.json()).avatar;
    const me = (await browse("GET", "/me", owner.secret)).json;
    assert.equal(me.avatar, url);
    assert.equal(url, `/_p99/api/avatars/${me.username}`);
    const served = await fetch(`${base}${url}`, { headers: { "x-p99-code": viewer.secret } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/jpeg");
    assert.equal(served.headers.get("cache-control"), "private, max-age=86400");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), JPEG);
    const signed = await call("GET", `/_p99/v1/avatars/${me.username}`, { actor: ada });
    assert.equal(signed.response.status, 200);
    assert.equal((await fetch(`${base}${url}`)).status, 401);
    const gone = await browse("DELETE", "/me/avatar", owner.secret);
    assert.equal(gone.status, 200);
    assert.equal((await browse("GET", "/me", owner.secret)).json.avatar, null);
    assert.equal((await fetch(`${base}${url}`, { headers: { "x-p99-code": viewer.secret } })).status, 404);
  });

  await check("[spaces] a host's mask and capture are stored, checked and pushed to the panel; capture off refuses a captured image", async () => {
    const env = (await call("GET", "/_p99/v1/hosts", { actor: ada })).json.hosts.find((h) => h.host === here);
    const put = (config) => call("PUT", `/_p99/v1/hosts/${here}`, { body: { env: env.env, config: { ...env.config, ...config } } });
    for (const [config, pattern] of [
      [{ mask: Array(MAX_MASKS + 1).fill(".x") }, /at most 50/],
      [{ mask: ["." + "a".repeat(MAX_MASK_CHARS)] }, /at most 200 characters/],
      [{ mask: ["div >"] }, /not a CSS selector/],
      [{ mask: ".card" }, /list of CSS selectors/],
      [{ capture: "maybe" }, /capture must be on or off/],
    ]) {
      const refused = await put(config);
      assert.equal(refused.status, 400, JSON.stringify(config));
      assert.match(refused.json.message, pattern);
    }
    const owner = await mint("Ada Lovelace", "ada.mask@example.com", [here], true);
    assert.equal((await put({ mask: [" .card-number ", "[data-secret]"], capture: "off" })).status, 200);
    const me = (await browse("GET", "/me", owner.secret)).json;
    assert.deepEqual(me.mask, [".card-number", "[data-secret]"]);
    assert.equal(me.capture, "off");
    const filed = await browse("POST", "/issues", owner.secret, issueBody({ title: "Filed with capture off" }));
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    const attach = (role, type, bytes) =>
      fetch(`${base}/_p99/api/issues/${filed.json.key}/attachments/${randomUUID()}?role=${role}&name=shot.png`, {
        method: "PUT",
        headers: { "x-p99-code": owner.secret, "content-type": type, "content-length": String(bytes.length) },
        body: bytes,
      });
    for (const role of ["screenshot", "page"]) {
      const refused = await attach(role, "image/png", PNG);
      assert.equal(refused.status, 403, role);
    }
    const thread = (await browse("GET", `/issues/${filed.json.key}`, owner.secret)).json;
    assert.equal(thread.attachments.length, 0);
    assert.equal((await attach("file", "text/plain", Buffer.from("a log line\n"))).status, 201);
    assert.equal((await put({ mask: null, capture: "on" })).status, 200);
    const back = (await browse("GET", "/me", owner.secret)).json;
    assert.deepEqual(back.mask, []);
    assert.equal(back.capture, "on");
    assert.equal((await attach("screenshot", "image/png", PNG)).status, 201);
  });
}

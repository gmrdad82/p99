import { roleOf } from "./roles.js";
import { codeReachSql } from "./grants.js";
import { withAvatars } from "./avatars.js";

export const RESERVED = ["admin", "p99", "root", "support", "manager", "system", "null", "me", "everyone", "here", "channel"];

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/;
const LOOKALIKES = { 0: "o", 1: "l", i: "l", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b" };
const LETTERS = { ß: "ss", æ: "ae", œ: "oe", þ: "th", đ: "d", ð: "d", ı: "i", ł: "l", ø: "o" };
const BY_EMAIL = "SELECT email, username FROM people WHERE email IN (SELECT value FROM json_each(?1))";
const USERNAME_RULE = "a username is 3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit";

let K = null;

export function useKit(kit) {
  K = kit;
}

export function skeleton(username) {
  return username
    .replace(/[._-]/g, "")
    .replace(/[01i34578]/g, (d) => LOOKALIKES[d])
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

const RESERVED_SKELETONS = new Set(RESERVED.map(skeleton));

function baseOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[ßæœþđðıłø]/g, (ch) => LETTERS[ch])
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/([._-])[._-]+/g, "$1")
    .replace(/^[._-]+/, "")
    .slice(0, 26)
    .replace(/[._-]+$/, "");
}

export function defaultUsername(name, email, taken) {
  const base = [baseOf(name), baseOf(String(email).split("@")[0])].find((b) => b.length >= 3) || "member";
  let username = base;
  for (let n = 2; taken.has(skeleton(username)); n++) username = base + n;
  taken.add(skeleton(username));
  return username;
}

export function usernameOf(raw) {
  const username = typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
  if (!USERNAME.test(username)) K.fail(400, USERNAME_RULE);
  if (RESERVED_SKELETONS.has(skeleton(username))) K.fail(400, `@${username} is reserved`);
  return username;
}

export function memberClause(email, project, managers) {
  return `(EXISTS (SELECT 1 FROM codes k WHERE lower(k.email) = ${email} AND k.revoked_at IS NULL
      AND ${codeReachSql("k", project)})
    OR ${email} IN (SELECT value FROM json_each(${managers})))`;
}

export function assigneeColumn(alias = "i") {
  return `(SELECT username FROM people WHERE email = ${alias}.assignee) AS assignee_username`;
}

export function assigneeOf(row) {
  return row.assignee ? { username: row.assignee_username ?? null } : null;
}

export async function peopleOf(DB, wanted, now) {
  const want = new Map();
  for (const p of wanted) {
    const email = String(p.email ?? "").trim().toLowerCase();
    if (email && !want.has(email)) want.set(email, p.name || "");
  }
  if (want.size === 0) return new Map();
  const read = async () => {
    const { results } = await DB.prepare(BY_EMAIL).bind(JSON.stringify([...want.keys()])).all();
    return new Map(results.map((r) => [r.email, r.username]));
  };
  let known = await read();
  for (let round = 0; round < 3 && known.size < want.size; round++) {
    const { results } = await DB.prepare("SELECT username FROM people").all();
    const taken = new Set([...RESERVED_SKELETONS, ...results.map((r) => skeleton(r.username))]);
    const missing = [...want].filter(([email]) => !known.has(email));
    await DB.batch(
      missing.map(([email, name]) =>
        DB.prepare("INSERT OR IGNORE INTO people (email, username, created_at) VALUES (?1, ?2, ?3)").bind(
          email,
          defaultUsername(name, email, taken),
          now,
        ),
      ),
    );
    known = await read();
  }
  return known;
}

export async function usernameFor(c) {
  return (await peopleOf(c.env.DB, [c.actor], c.now)).get(c.actor.email) ?? null;
}

export async function assigneeEmail(c, row, raw) {
  if (raw === null) return null;
  const asked = typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
  if (asked === "me") {
    await usernameFor(c);
    return c.actor.email;
  }
  if (!USERNAME.test(asked)) K.fail(400, "assignee must be a username, me or null");
  const found = await c.env.DB.prepare(
    `SELECT email FROM people p WHERE username = ?1 AND ${memberClause("p.email", "?2", "?3")}`,
  )
    .bind(asked, row.project_id ?? null, JSON.stringify(K.managersOf(c.env)))
    .first();
  if (!found) K.fail(400, `@${asked} is not a member of ${c.dir.projects.get(row.project_id)?.name ?? row.host ?? "this card's project"}`);
  return found.email;
}

async function listPeople(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const all = c.scope.all;
  const project = all ? null : (c.dir.hosts.get(c.scope.host)?.project_id ?? null);
  const { results } = await c.env.DB.prepare(
    `SELECT lower(email) AS email, name, MAX(manager) AS manager FROM codes
      WHERE revoked_at IS NULL AND (?2 OR ${codeReachSql("codes", "?1")})
      GROUP BY lower(email)`,
  )
    .bind(project, all ? 1 : 0)
    .all();
  const people = new Map(results.map((r) => [r.email, { email: r.email, name: r.name, manager: Boolean(r.manager) }]));
  for (const email of K.managersOf(c.env)) {
    const known = people.get(email);
    if (known) known.manager = true;
    else people.set(email, { email, name: "", manager: true });
  }
  const names = await peopleOf(c.env.DB, [...people.values()], c.now);
  const list = [...people.values()]
    .filter((p) => names.has(p.email))
    .map((p) => ({ username: names.get(p.email), role: roleOf(p.manager) }))
    .sort((a, b) => (a.username < b.username ? -1 : 1));
  return K.json(200, { people: await withAvatars(c.env.DB, list) });
}

async function patchMe(c) {
  const body = await K.readJson(c, K.maxJson);
  const other = Object.keys(body).filter((k) => k !== "username");
  if (other.length > 0) K.fail(400, `only username can change here, not ${other.join(", ")}`);
  const username = usernameOf(body.username);
  const now = await usernameFor(c);
  if (now !== username) {
    try {
      await c.env.DB.prepare("UPDATE people SET username = ?2 WHERE email = ?1").bind(c.actor.email, username).run();
    } catch (error) {
      if (!K.isUniqueViolation(error)) throw error;
      K.fail(409, `@${username} is taken, or too close to someone else's username`);
    }
  }
  return K.json(200, { username });
}

export function peopleRoutes() {
  return [
    ["GET", /^\/people$/, listPeople],
    ["PATCH", /^\/me$/, patchMe],
  ];
}

export function signedPeopleRoutes() {
  return [["GET", /^\/people$/, listPeople, { listed: true }]];
}

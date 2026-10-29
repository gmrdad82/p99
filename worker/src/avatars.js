export const MAX_AVATAR_BYTES = 256 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AVATAR_TYPE_RULE = "an avatar is a PNG, JPEG or WebP image";
export const AVATAR_SIZE_RULE = "an avatar is at most 256 KB; the page makes it 256×256";
const DAY_SECONDS = 24 * 60 * 60;

let K = null;

export function useAvatarKit(kit) {
  K = kit;
}

export function avatarVersion(key) {
  return key ? key.slice(key.lastIndexOf("/") + 1) : null;
}

export function avatarUrl(username, key) {
  return key && username ? `/_p99/api/avatars/${encodeURIComponent(username)}?v=${encodeURIComponent(avatarVersion(key))}` : null;
}

export async function withAvatars(DB, people) {
  const named = [];
  for (const p of people) {
    if (!p || typeof p !== "object") continue;
    p.avatar = null;
    if (typeof p.username === "string" && p.username.length > 0) named.push(p);
  }
  if (named.length === 0) return people;
  const { results } = await DB.prepare("SELECT username, avatar FROM people WHERE avatar IS NOT NULL AND username IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify([...new Set(named.map((p) => p.username))]))
    .all();
  const keys = new Map(results.map((r) => [r.username, r.avatar]));
  for (const p of named) p.avatar = avatarUrl(p.username, keys.get(p.username) ?? null);
  return people;
}

async function person(c) {
  const username = await K.usernameFor(c);
  const row = await c.env.DB.prepare("SELECT rowid AS id, email, username, avatar FROM people WHERE email = ?1").bind(c.actor.email).first();
  if (!row) K.fail(404, "no such person");
  return { ...row, username: row.username ?? username };
}

async function putAvatar(c) {
  const type = (c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!AVATAR_TYPES.includes(type)) {
    if (c.request.body) await c.request.body.cancel().catch(() => {});
    K.fail(400, AVATAR_TYPE_RULE);
  }
  let bytes;
  try {
    bytes = await K.readBody(c.request, MAX_AVATAR_BYTES);
  } catch (error) {
    if (error && error.status === 413) K.fail(413, AVATAR_SIZE_RULE);
    throw error;
  }
  if (c.signed && (await K.sha256Hex(bytes)) !== c.bodyHash) K.fail(401, "the body does not match X-Content-SHA256");
  if (bytes.length === 0) K.fail(400, "the image is empty");
  if (!K.looksLike(type, bytes.subarray(0, 1024))) K.fail(400, `the content does not look like ${type}`);
  const me = await person(c);
  const key = `avatars/${me.id}/${(await K.sha256Hex(bytes)).slice(0, 16)}`;
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare("UPDATE people SET avatar = ?2 WHERE email = ?1").bind(me.email, key).run();
  if (me.avatar && me.avatar !== key) await c.env.BUCKET.delete(me.avatar);
  return K.json(200, { avatar: avatarUrl(me.username, key) });
}

async function deleteAvatar(c) {
  K.requireEmptyBody(c);
  const me = await person(c);
  if (me.avatar) {
    await c.env.DB.prepare("UPDATE people SET avatar = NULL WHERE email = ?1").bind(me.email).run();
    await c.env.BUCKET.delete(me.avatar);
  }
  return K.json(200, { avatar: null, removed: Boolean(me.avatar) });
}

async function getAvatar(c, rawName) {
  K.requireEmptyBody(c);
  let name;
  try {
    name = decodeURIComponent(rawName).trim().replace(/^@/, "").toLowerCase();
  } catch {
    K.fail(404, "no such avatar");
  }
  const row = await c.env.DB.prepare("SELECT avatar FROM people WHERE username = ?1").bind(name).first();
  const object = row && row.avatar ? await c.env.BUCKET.get(row.avatar) : null;
  if (!object) K.fail(404, "no such avatar");
  const type = object.httpMetadata?.contentType;
  const current = c.url.searchParams.get("v") === avatarVersion(row.avatar);
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": AVATAR_TYPES.includes(type) ? type : "application/octet-stream",
      "cache-control": current ? `private, max-age=${DAY_SECONDS}` : "private, no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

export const AVATAR_ROUTES = [
  ["PUT", /^\/me\/avatar$/, putAvatar],
  ["DELETE", /^\/me\/avatar$/, deleteAvatar],
];

export const AVATAR_READS = [["GET", /^\/avatars\/([^/]+)$/, getAvatar]];

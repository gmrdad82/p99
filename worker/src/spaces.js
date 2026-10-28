import { K, projectName } from "./cards.js";
import { grantFromBody, hostsOf, projectNamed, reachesProject, storedGrant } from "./grants.js";

export const PERSON_GRANTS = "only a person changes a grant";
export const WHOLE_SPACE = "only a code for the whole space makes projects";

let S = null;

export function useSpaceKit(kit) {
  S = kit;
}

export function spaceOf(env) {
  const slug = typeof env.SPACE === "string" && env.SPACE.length > 0 ? env.SPACE : null;
  const name = typeof env.SPACE_NAME === "string" && env.SPACE_NAME.length > 0 ? env.SPACE_NAME : slug;
  return { slug, name };
}

function hostsIn(dir, id) {
  return [...dir.hosts.values()].filter((h) => h.project_id === id).map((h) => h.host).sort();
}

function projectJson(dir, project, counts) {
  const n = counts ? counts.get(project.id) : null;
  return { name: project.name, hosts: hostsIn(dir, project.id), open: n ? n.open : 0, closed: n ? n.closed : 0 };
}

async function projectCounts(c, ids) {
  if (ids.length === 0) return new Map();
  const mine = c.manager ? "" : ` AND ${K.mineClause("?2")}`;
  const { results } = await c.env.DB.prepare(
    `SELECT i.project_id AS id, sum(i.open) AS open, sum(1 - i.open) AS closed FROM items i
     WHERE i.project_id IN (SELECT value FROM json_each(?1))${mine} GROUP BY i.project_id`,
  )
    .bind(JSON.stringify(ids), ...(c.manager ? [] : [c.actor.email]))
    .all();
  return new Map(results.map((r) => [r.id, { open: r.open ?? 0, closed: r.closed ?? 0 }]));
}

export function reachedProjects(c) {
  return [...c.dir.projects.values()].filter((p) => reachesProject(c.reach, p.id));
}

async function getSpace(c) {
  K.requireEmptyBody(c);
  const projects = reachedProjects(c);
  const counts = await projectCounts(c, projects.map((p) => p.id));
  return K.json(200, { space: spaceOf(c.env), projects: projects.map((p) => projectJson(c.dir, p, counts)) });
}

function reached(c, raw) {
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = "";
  }
  const project = projectNamed(c.dir, name.trim());
  if (!project || !reachesProject(c.reach, project.id)) K.fail(404, `no project is called ${[...name].slice(0, 40).join("")}`);
  return project;
}

async function postProject(c) {
  K.requireManager(c);
  if (!c.reach.all) K.fail(403, WHOLE_SPACE);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const name = projectName(body.name);
  let row;
  try {
    row = await c.env.DB.prepare("INSERT INTO projects (name, created_at) VALUES (?1, ?2) RETURNING id, name, created_at").bind(name, c.now).first();
  } catch (error) {
    if (!K.isUniqueViolation(error)) throw error;
    K.fail(409, `a project called ${name} exists`);
  }
  S.forgetDirectory();
  return K.json(201, { project: { name: row.name, hosts: [], open: 0, closed: 0 } });
}

async function patchProjectName(c, raw) {
  K.requireManager(c);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const other = Object.keys(body).filter((k) => k !== "name");
  if (other.length > 0) K.fail(400, `only name changes here, not ${other.join(", ")}`);
  const project = reached(c, raw);
  const name = projectName(body.name);
  const { DB } = c.env;
  if (name !== project.name) {
    try {
      await DB.batch([
        DB.prepare("UPDATE projects SET name = ?2 WHERE id = ?1").bind(project.id, name),
        DB.prepare("UPDATE items SET project = ?2 WHERE project_id = ?1 AND project IS NOT NULL").bind(project.id, name),
      ]);
    } catch (error) {
      if (!K.isUniqueViolation(error)) throw error;
      K.fail(409, `a project called ${name} exists`);
    }
    S.forgetDirectory();
  }
  const counts = await projectCounts(c, [project.id]);
  return K.json(200, { project: projectJson(c.dir, { ...project, name }, counts) });
}

async function patchHost(c, rawHost) {
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const other = Object.keys(body).filter((k) => k !== "project");
  if (other.length > 0) K.fail(400, `only project changes here, not ${other.join(", ")}; PUT /hosts/{host} sets the rest`);
  const host = S.decodeURIComponentSafe(rawHost).toLowerCase();
  const known = c.dir.hosts.get(host);
  if (!known) K.fail(404, "no such host");
  if (typeof body.project !== "string") K.fail(400, "project must name a project");
  const project = projectNamed(c.dir, body.project.trim());
  if (!project) K.fail(400, `no project is called ${body.project.slice(0, 40)}; p99 projects add makes one`);
  const { DB } = c.env;
  const [, moved, row] = await DB.batch([
    DB.prepare("UPDATE hosts SET project_id = ?2 WHERE host = ?1").bind(host, project.id),
    DB.prepare(
      `UPDATE items SET project_id = ?2, project = CASE WHEN project IS NULL THEN NULL ELSE ?3 END
       WHERE host = ?1 AND project_id IS ?4`,
    ).bind(host, project.id, project.name, known.project_id ?? null),
    DB.prepare("SELECT host, env, config_json, created_at, project_id FROM hosts WHERE host = ?1").bind(host),
  ]);
  S.forgetDirectory();
  return K.json(200, { ...S.hostJson(row.results[0], c.dir, project), moved: moved.meta?.changes ?? 0 });
}

async function patchCode(c, rawId) {
  if (!c.actor || c.actor.agent) K.fail(403, PERSON_GRANTS);
  const body = await K.readJson(c, K.MAX_JSON_BYTES);
  const other = Object.keys(body).filter((k) => k !== "grant");
  if (other.length > 0) K.fail(400, `only grant changes here, not ${other.join(", ")}`);
  const grant = grantFromBody(body.grant, c.dir, K.fail);
  const row = await c.env.DB.prepare("UPDATE codes SET grant_json = ?2, hosts_json = ?3 WHERE id = ?1 AND revoked_at IS NULL RETURNING *")
    .bind(Number(rawId), storedGrant(grant), JSON.stringify(hostsOf(grant, c.dir)))
    .first();
  S.forgetCodes();
  if (!row) K.fail(404, "no such code, or it is revoked");
  await S.codesRevoked(c.env);
  return K.json(200, { code: S.codeOf(row, c.dir) });
}

export const SPACE_ROUTES = [["GET", /^\/space$/, getSpace]];

export const PROJECT_ROUTES = [
  ["POST", /^\/projects$/, postProject],
  ["PATCH", /^\/projects\/([^/]+)$/, patchProjectName],
];

export const SIGNED_SPACE_ROUTES = [
  ["PATCH", /^\/hosts\/([^/]+)$/, patchHost],
  ["PATCH", /^\/codes\/(\d{1,15})$/, patchCode],
];

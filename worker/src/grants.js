export const EVERYWHERE = Object.freeze({ all: true, projects: null });
export const SPACE_GRANT = Object.freeze({ space: true });
export const PARKED = "a parked code opens nothing; p99 invites set <id> --space or --project gives it a grant";

function parsed(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ids(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((id) => Number.isSafeInteger(id)))].sort((a, b) => a - b);
}

export function grantOf(row, dir) {
  const stored = parsed(row ? row.grant_json : null);
  if (stored && stored.space === true) return SPACE_GRANT;
  if (stored && Array.isArray(stored.projects)) return { projects: ids(stored.projects) };
  const hosts = parsed(row ? row.hosts_json : null);
  return { projects: ids((Array.isArray(hosts) ? hosts : []).map((h) => dir.hosts.get(h)?.project_id ?? null)) };
}

export function reachOf(grant, dir) {
  if (grant.space) return EVERYWHERE;
  const projects = grant.projects;
  return { all: false, projects, hosts: [...dir.hosts.values()].filter((h) => projects.includes(h.project_id)).map((h) => h.host).sort() };
}

export function combinedCode(admitted, dir) {
  if (admitted.length === 0) return null;
  const top = admitted.some((c) => Boolean(c.manager));
  const peers = admitted.filter((c) => Boolean(c.manager) === top);
  const whole = peers.find((c) => c.grant.space);
  if (whole) return whole;
  if (peers.length === 1) return peers[0];
  const grant = { projects: ids(peers.flatMap((c) => c.grant.projects)) };
  return { ...peers[0], grant, reach: reachOf(grant, dir), codes: peers.map((c) => c.id) };
}

export function parked(grant) {
  return !grant.space && grant.projects.length === 0;
}

export function reachesProject(reach, id) {
  return reach.all || (id !== null && id !== undefined && reach.projects.includes(id));
}

export function reachesItem(reach, row) {
  if (reach.all) return true;
  if (row.project_id !== null && row.project_id !== undefined) return reach.projects.includes(row.project_id);
  return Boolean(row.host) && (reach.hosts ?? []).includes(row.host);
}

export function reachesOwnItem(reach, row) {
  return reachesItem(reach, row) || (Boolean(row.host) && (reach.hosts ?? []).includes(row.host));
}

export function reachSql(item, projects, hosts) {
  return `(${item}.project_id IN (SELECT value FROM json_each(${projects})) OR (${item}.project_id IS NULL AND ${item}.host IN (SELECT value FROM json_each(${hosts}))))`;
}

export function reachesHost(reach, dir, host) {
  const row = dir.hosts.get(host);
  return Boolean(row) && reachesProject(reach, row.project_id);
}

export function hostsOf(grant, dir) {
  const reach = grant.space ? EVERYWHERE : { all: false, projects: grant.projects };
  return [...dir.hosts.values()].filter((h) => reachesProject(reach, h.project_id)).map((h) => h.host).sort();
}

export function projectNames(reach, dir) {
  return [...dir.projects.values()].filter((p) => reachesProject(reach, p.id)).map((p) => p.name);
}

export function grantJson(grant, dir) {
  if (grant.space) return { space: true };
  return { projects: grant.projects.map((id) => dir.projects.get(id)?.name).filter(Boolean) };
}

export function storedGrant(grant) {
  return JSON.stringify(grant.space ? { space: true } : { projects: grant.projects });
}

function nocase(text) {
  return String(text).replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

export function projectNamed(dir, name) {
  const wanted = nocase(name);
  for (const p of dir.projects.values()) if (nocase(p.name) === wanted) return p;
  return null;
}

export function grantFromBody(raw, dir, fail) {
  const rule = 'grant must be {"space":true} or {"projects":[name, …]}';
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, rule);
  const keys = Object.keys(raw);
  if (keys.length !== 1) fail(400, rule);
  if (keys[0] === "space") {
    if (raw.space !== true) fail(400, rule);
    return SPACE_GRANT;
  }
  if (keys[0] !== "projects" || !Array.isArray(raw.projects) || raw.projects.length > 200) fail(400, rule);
  const found = raw.projects.map((name) => {
    const project = typeof name === "string" ? projectNamed(dir, name.trim()) : null;
    if (!project) fail(400, `no project is called ${String(name).slice(0, 40)}; p99 projects add makes one`);
    return project.id;
  });
  return { projects: ids(found) };
}

export function grantFromHosts(hosts, dir) {
  return { projects: ids(hosts.map((h) => dir.hosts.get(h)?.project_id ?? null)) };
}

export function projectFilterSql(names, bind, alias = "i") {
  return `${alias}.project_id IN (SELECT id FROM projects WHERE name IN (SELECT value FROM json_each(${bind(JSON.stringify(names))})))`;
}

export function viewSql(v, bind, alias = "i") {
  const parts = [];
  if (!v.all && Array.isArray(v.projects)) {
    const reach = reachSql(alias, bind(JSON.stringify(v.projects)), bind(JSON.stringify(v.hosts ?? [])));
    parts.push(v.byHost ? `(${reach} OR ${alias}.host IN (SELECT value FROM json_each(${bind(JSON.stringify(v.hosts ?? []))})))` : reach);
  }
  if (v.host) parts.push(`${alias}.host = ${bind(v.host)}`);
  return parts.length > 0 ? parts.join(" AND ") : "1";
}

export function codeReachSql(code, project) {
  return `(CASE WHEN ${code}.grant_json IS NULL
      THEN EXISTS (SELECT 1 FROM json_each(${code}.hosts_json) gh JOIN hosts gx ON gx.host = gh.value WHERE gx.project_id = ${project})
      ELSE (json_extract(${code}.grant_json, '$.space') IS 1
        OR EXISTS (SELECT 1 FROM json_each(${code}.grant_json, '$.projects') gp WHERE gp.value = ${project})) END)`;
}

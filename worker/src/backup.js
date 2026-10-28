export const BACKUP_PREFIX = "backups/";
export const BACKUP_TABLES = [
  { name: "labels", size: "length(name) + 100", lane: true },
  { name: "boards", size: "length(name) + 200", lane: true },
  { name: "board_columns", size: "50", refs: { board_id: "boards", label_id: "labels" } },
  { name: "projects", size: "length(name) + 100", cut: true },
  {
    name: "items",
    size: "length(title) + length(body) + length(context_json) + length(marks_json) + length(reporter_json) + length(page_url) + 500",
    cut: true,
    forward: "duplicate_of",
    refs: { label_id: "labels" },
  },
  { name: "comments", size: "length(body) + 300", cut: true, item: true },
  { name: "attachments", size: "length(name) + 400", cut: true, item: true },
  { name: "events", size: "length(detail_json) + 200", cut: true, item: true },
  { name: "reads", size: "150", cut: true, item: true },
  { name: "builds", size: "200", cut: true },
  { name: "build_items", size: "length(subject) + 150", cut: true, item: true },
  { name: "landings", size: "150", cut: true, item: true },
  { name: "hosts", size: "length(config_json) + 200", cut: true },
  { name: "envs", size: "100", cut: true },
  { name: "codes", size: "length(hosts_json) + 500", cut: true },
  { name: "code_devices", size: "length(token_hash) + 100", cut: true },
  { name: "board_positions", size: "length(key) + 50", cut: true, item: true, refs: { board_id: "boards", label_id: "labels" } },
  { name: "hooks", size: "length(url_sealed) + length(events_json) + 200", cut: true },
  { name: "github", size: "length(repo) + 200", cut: true },
  { name: "github_links", size: "length(repo) + coalesce(length(url), 0) + 200", cut: true, item: true },
  { name: "mail", size: "length(COALESCE(sender, '')) + length(COALESCE(note, '')) + 100", cut: true },
  { name: "mail_optouts", size: "length(email) + 100", cut: true, item: true },
  { name: "people", size: "length(email) + length(username) + coalesce(length(avatar), 0) + 100", cut: true },
  { name: "settings", size: "length(value) + 100", cut: true },
  { name: "deletions", size: "length(r2_key) + 100", cut: true },
  { name: "archived", size: "50" },
  { name: "sqlite_sequence", size: "length(name) + 50" },
];
const BACKUP_PAGE_ROWS = 1000;
const BACKUP_PAGE_BYTES = 128 * 1024;
const BACKUP_STEP_PAGES = 6;
const BACKUP_STEP_BYTES = 512 * 1024;
const BACKUP_RETAIN_DATES = 8;
const BACKUP_WEEKDAY = 1;
const BACKUP_HOUR = 3;
const USAGE_RETAIN_DAYS = 7;
const BRANCH_BUILD_RETAIN_DAYS = 30;
const MARKS = `json_object(${BACKUP_TABLES.filter((t) => t.cut)
  .map((t) => `'${t.name}', (SELECT coalesce(max(rowid), 0) FROM ${t.name})`)
  .join(", ")})`;

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function backupDue(last, nowDate) {
  if (!last) return true;
  const days = (nowDate.getTime() - Date.parse(last.started_at)) / 86400000;
  if (days >= 8) return true;
  return (
    nowDate.getUTCDay() === BACKUP_WEEKDAY &&
    nowDate.getUTCHours() >= BACKUP_HOUR &&
    last.date !== nowDate.toISOString().slice(0, 10)
  );
}

export function pageKey(date, table, page) {
  return `${BACKUP_PREFIX}${date}/${table}-${String(page).padStart(4, "0")}.json`;
}

export function pageQuery(table, marks, afterRowid) {
  const binds = [afterRowid, BACKUP_PAGE_ROWS, BACKUP_PAGE_BYTES];
  let within = "rowid > ?1";
  if (table.cut) {
    binds.push(marks[table.name] ?? 0);
    within += ` AND rowid <= ?${binds.length}`;
  }
  if (table.item) {
    binds.push(marks.items ?? 0);
    within += ` AND item_id <= ?${binds.length}`;
  }
  const sql = `SELECT rowid AS _rowid, * FROM ${table.name} WHERE ${within} AND rowid <= (
     SELECT max(r) FROM (
       SELECT rowid AS r, sum(${table.size}) OVER (ORDER BY rowid ROWS UNBOUNDED PRECEDING) AS running
       FROM ${table.name} WHERE ${within} ORDER BY rowid LIMIT ?2
     ) WHERE running <= ?3 OR r = (SELECT min(rowid) FROM ${table.name} WHERE ${within})
   ) ORDER BY rowid`;
  return { sql, binds };
}

export function cutRows(table, marks, rows) {
  if (!table.forward) return rows;
  const mark = marks[table.name] ?? 0;
  return rows.map((row) => (row[table.forward] !== null && row[table.forward] > mark ? { ...row, [table.forward]: null } : row));
}

export function pullLanes(table, rows, held, snapshot) {
  const known = {};
  const live = {};
  const pulled = {};
  const dropped = [];
  const kept = [];
  for (const lane of new Set(Object.values(table.refs))) {
    known[lane] = new Set(held[lane] ?? []);
    live[lane] = new Map((snapshot[lane] ?? []).map((r) => [r.id, r]));
    pulled[lane] = [];
  }
  for (const row of rows) {
    let whole = true;
    for (const [column, lane] of Object.entries(table.refs)) {
      const id = row[column];
      if (known[lane].has(id)) continue;
      const found = live[lane].get(id);
      if (!found) {
        whole = false;
        continue;
      }
      known[lane].add(id);
      pulled[lane].push(found);
    }
    if (whole) kept.push(row);
    else dropped.push(row._rowid);
  }
  return { rows: kept, pulled, dropped };
}

export function forwardOf(table, rows, pending, page) {
  const found = new Set(rows.map((r) => r._rowid));
  const last = rows.length > 0 ? rows[rows.length - 1]._rowid : 0;
  return [
    ...pending.filter(([, target]) => !found.has(target)),
    ...rows.filter((r) => r[table.forward] !== null && r[table.forward] > last).map((r) => [r._rowid, r[table.forward], page]),
  ];
}

async function startRun(env, date, nowDate) {
  const { DB } = env;
  const now = nowDate.toISOString();
  const branchCutoff = new Date(nowDate.getTime() - BRANCH_BUILD_RETAIN_DAYS * 86400000).toISOString();
  const stale = `SELECT env, branch FROM builds WHERE branch <> 'main' AND announced_at < ?1
    AND env IN (SELECT name FROM envs WHERE kind = 'development')`;
  await DB.batch([
    DB.prepare("INSERT OR REPLACE INTO backup_runs (date, started_at) VALUES (?1, ?2)").bind(date, now),
    DB.prepare("DELETE FROM usage WHERE day < ?1").bind(
      new Date(nowDate.getTime() - USAGE_RETAIN_DAYS * 86400000).toISOString().slice(0, 10),
    ),
    DB.prepare(`DELETE FROM build_items WHERE (env, branch) IN (${stale})`).bind(branchCutoff),
    DB.prepare(`DELETE FROM builds WHERE (env, branch) IN (${stale})`).bind(branchCutoff),
    DB.prepare(`UPDATE backup_runs SET marks_json = ${MARKS}, held_json = '{}' WHERE date = ?1`).bind(date),
  ]);
  return DB.prepare("SELECT * FROM backup_runs WHERE date = ?1").bind(date).first();
}

async function sweepRun(env, run) {
  let cursor;
  do {
    const listed = await env.BUCKET.list({ prefix: `${BACKUP_PREFIX}${run.date}/`, cursor, include: ["customMetadata"] });
    const stale = listed.objects.filter((o) => o.customMetadata?.run !== run.started_at).map((o) => o.key);
    if (stale.length > 0) await env.BUCKET.delete(stale);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function putPage(env, run, now, table, page, rows) {
  const text = JSON.stringify({ run: run.started_at, exported_at: now, table, page, rows });
  await env.BUCKET.put(pageKey(run.date, table, page), text, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { run: run.started_at },
  });
  return text.length;
}

async function clearForward(env, run, now, table, held) {
  const byPage = new Map();
  for (const [id, , page] of held.forward ?? []) byPage.set(page, [...(byPage.get(page) ?? []), id]);
  for (const [page, ids] of byPage) {
    const object = await env.BUCKET.get(pageKey(run.date, table.name, page));
    if (!object) continue;
    const body = JSON.parse(await object.text());
    const rows = body.rows.map((row) => (ids.includes(row._rowid) ? { ...row, [table.forward]: null } : row));
    await putPage(env, run, now, table.name, page, rows);
  }
  held.cleared = [...(held.cleared ?? []), ...(held.forward ?? []).map(([id]) => id)];
  held.forward = [];
}

export async function backupStep(env, nowDate = new Date()) {
  const { DB } = env;
  const now = nowDate.toISOString();
  let run = await DB.prepare("SELECT * FROM backup_runs WHERE finished_at IS NULL ORDER BY date DESC LIMIT 1").first();
  if (!run) {
    const last = await DB.prepare("SELECT date, started_at FROM backup_runs ORDER BY date DESC LIMIT 1").first();
    if (!backupDue(last, nowDate)) return;
    run = await startRun(env, now.slice(0, 10), nowDate);
  } else if (run.marks_json === null || run.held_json === null) {
    run = await startRun(env, run.date, nowDate);
  }
  const rows = parseJson(run.rows_json, {});
  const marks = parseJson(run.marks_json, {});
  const held = parseJson(run.held_json, {});
  held.pages ??= {};
  let { table_index: tableIndex, after_rowid: afterRowid, page, pages } = run;
  let written = 0;
  for (let step = 0; step < BACKUP_STEP_PAGES && written < BACKUP_STEP_BYTES && tableIndex < BACKUP_TABLES.length; step++) {
    const table = BACKUP_TABLES[tableIndex];
    const { sql, binds } = pageQuery(table, marks, afterRowid);
    const read = DB.prepare(sql).bind(...binds);
    const lanes = table.refs ? [...new Set(Object.values(table.refs))] : [];
    const [{ results }, ...snapshots] =
      lanes.length > 0 ? await DB.batch([read, ...lanes.map((lane) => DB.prepare(`SELECT rowid AS _rowid, * FROM ${lane}`))]) : [await read.all()];
    let kept = cutRows(table, marks, results);
    if (table.refs) {
      const snapshot = Object.fromEntries(lanes.map((lane, i) => [lane, snapshots[i].results]));
      const pull = pullLanes(table, kept, held, snapshot);
      kept = pull.rows;
      if (pull.dropped.length > 0) {
        held.dropped ??= {};
        held.dropped[table.name] = [...(held.dropped[table.name] ?? []), ...pull.dropped];
      }
      for (const lane of lanes) {
        if (pull.pulled[lane].length === 0) continue;
        held.pages[lane] = (held.pages[lane] ?? 0) + 1;
        written += await putPage(env, run, now, lane, held.pages[lane], pull.pulled[lane]);
        pages += 1;
        held[lane] = [...(held[lane] ?? []), ...pull.pulled[lane].map((r) => r.id)];
        rows[lane] = (rows[lane] || 0) + pull.pulled[lane].length;
      }
    }
    if (results.length > 0 || page === 0) {
      page += 1;
      written += await putPage(env, run, now, table.name, page, kept);
      pages += 1;
      rows[table.name] = (rows[table.name] || 0) + kept.length;
      if (table.lane) {
        held[table.name] = [...(held[table.name] ?? []), ...kept.map((r) => r.id)];
        held.pages[table.name] = page;
      }
      if (table.forward) held.forward = forwardOf(table, kept, held.forward ?? [], page);
    }
    if (results.length === 0) {
      if (table.forward && (held.forward ?? []).length > 0) await clearForward(env, run, now, table, held);
      tableIndex += 1;
      afterRowid = 0;
      page = 0;
    } else {
      afterRowid = results[results.length - 1]._rowid;
    }
    await DB.prepare(
      `UPDATE backup_runs SET table_index = ?2, after_rowid = ?3, page = ?4, pages = ?5, rows_json = ?6, held_json = ?7
       WHERE date = ?1`,
    )
      .bind(run.date, tableIndex, afterRowid, page, pages, JSON.stringify(rows), JSON.stringify(held))
      .run();
  }
  if (tableIndex < BACKUP_TABLES.length) return;
  await sweepRun(env, run);
  await DB.prepare("UPDATE backup_runs SET finished_at = ?2 WHERE date = ?1").bind(run.date, now).run();
  await pruneBackups(env);
  const cleared = (held.cleared ?? []).length > 0 ? `; merge pointer cleared on items ${held.cleared.join(", ")}, their target deleted mid-run` : "";
  const dropped = Object.entries(held.dropped ?? {})
    .map(([name, ids]) => `; ${name} rows ${ids.join(", ")} left out, their lane gone`)
    .join("");
  console.log(`backup ${run.date} finished: ${pages} pages${cleared}${dropped}`);
}

async function pruneBackups(env) {
  const { results } = await env.DB.prepare("SELECT date FROM backup_runs ORDER BY date DESC").all();
  const doomed = results.slice(BACKUP_RETAIN_DATES).map((r) => r.date);
  for (const date of doomed) {
    let cursor;
    do {
      const listed = await env.BUCKET.list({ prefix: `${BACKUP_PREFIX}${date}/`, cursor });
      const keys = listed.objects.map((o) => o.key);
      if (keys.length > 0) await env.BUCKET.delete(keys);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    await env.DB.prepare("DELETE FROM backup_runs WHERE date = ?1").bind(date).run();
  }
}

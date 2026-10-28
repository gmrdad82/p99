PRAGMA defer_foreign_keys = true;

CREATE TABLE IF NOT EXISTS spaces_plan (kind TEXT NOT NULL, name TEXT NOT NULL, value TEXT);

DROP TABLE IF EXISTS spaces_count;
CREATE TABLE spaces_count (what TEXT PRIMARY KEY, was INTEGER NOT NULL);

INSERT INTO spaces_count (what, was) VALUES
  ('items', (SELECT count(*) FROM items)),
  ('open', (SELECT COALESCE(sum(open), 0) FROM items)),
  ('comments', (SELECT count(*) FROM comments)),
  ('events', (SELECT count(*) FROM events)),
  ('attachments', (SELECT count(*) FROM attachments)),
  ('codes', (SELECT count(*) FROM codes));

INSERT INTO spaces_count (what, was)
SELECT 'cards:' || lower(trim(project)), count(*) FROM items WHERE trim(project) <> '' GROUP BY lower(trim(project));

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

ALTER TABLE hosts ADD COLUMN project_id INTEGER REFERENCES projects (id);
ALTER TABLE items ADD COLUMN project_id INTEGER REFERENCES projects (id);
ALTER TABLE codes ADD COLUMN grant_json TEXT;
ALTER TABLE people ADD COLUMN avatar TEXT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO projects (name, created_at)
SELECT name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (
  SELECT trim(s.name) AS name, 0 AS tier, s.rowid AS n FROM spaces_plan s WHERE s.kind = 'project' AND trim(s.name) <> ''
  UNION ALL
  SELECT COALESCE((SELECT trim(s.value) FROM spaces_plan s WHERE s.kind = 'host' AND s.name = lower(h.host) AND trim(s.value) <> ''), h.host), 1, 0
  FROM hosts h
  UNION ALL
  SELECT trim(i.project), 2, min(i.id) FROM items i WHERE trim(i.project) <> '' GROUP BY lower(trim(i.project))
)
ORDER BY tier, n, name;

UPDATE hosts SET project_id = (
  SELECT p.id FROM projects p WHERE p.name = COALESCE(
    (SELECT trim(s.value) FROM spaces_plan s WHERE s.kind = 'host' AND s.name = lower(hosts.host) AND trim(s.value) <> ''),
    hosts.host)
);

UPDATE items SET project_id = COALESCE(
  (SELECT p.id FROM projects p WHERE p.name = trim(items.project)),
  (SELECT h.project_id FROM hosts h WHERE h.host = items.host),
  (SELECT p.id FROM spaces_plan s JOIN projects p ON p.name = trim(s.value) WHERE s.kind = 'host' AND s.name = lower(items.host))
);

DROP TABLE IF EXISTS spaces_items;
CREATE TABLE spaces_items AS SELECT * FROM items;
DROP TABLE IF EXISTS spaces_seq;
CREATE TABLE spaces_seq AS SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'items'), 0) AS seq;

DROP TABLE items;

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feature', 'improvement', 'question', 'task')),
  label_id INTEGER NOT NULL REFERENCES labels (id),
  open INTEGER NOT NULL CHECK (open IN (0, 1)),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  origin_env TEXT NOT NULL,
  host TEXT,
  page_url TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_json TEXT NOT NULL,
  reporter_agent INTEGER NOT NULL DEFAULT 0 CHECK (reporter_agent IN (0, 1)),
  assignee TEXT,
  duplicate_of INTEGER REFERENCES items (id),
  context_json TEXT NOT NULL,
  marks_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  comment_count INTEGER NOT NULL DEFAULT 0,
  public_comment_count INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  public_attachment_count INTEGER NOT NULL DEFAULT 0,
  activity_at TEXT NOT NULL,
  public_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  resolution TEXT CHECK (resolution IN ('fixed', 'abandoned', 'duplicate')),
  project TEXT COLLATE NOCASE,
  reporter_via TEXT,
  project_id INTEGER REFERENCES projects (id),
  CHECK (open = (resolution IS NULL))
);

INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution, project, reporter_via, project_id)
SELECT id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution, project, reporter_via, project_id
FROM spaces_items ORDER BY id;

INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, context_json, marks_json, search_text, activity_at, public_activity_at, created_at, updated_at)
SELECT s.seq, 'spaces-seq', 'task', COALESCE((SELECT min(id) FROM labels), 0), 1, '', '', '', NULL, '', '', '', '', '', '{}', '{}', '[]', '', '', '', '', ''
FROM spaces_seq s WHERE s.seq > (SELECT COALESCE(max(id), 0) FROM spaces_items);
DELETE FROM items WHERE client_uid = 'spaces-seq' AND id > (SELECT COALESCE(max(id), 0) FROM spaces_items);

DROP TABLE spaces_items;
DROP TABLE spaces_seq;

CREATE INDEX items_open ON items (open, id);
CREATE INDEX items_label ON items (label_id, host);
CREATE INDEX items_kind ON items (kind, id);
CREATE INDEX items_reporter ON items (reporter_email, id);
CREATE INDEX items_reporter_open_path ON items (reporter_email, open, page_path);
CREATE INDEX items_path ON items (page_path, open, id);
CREATE INDEX items_host ON items (host, open, id);
CREATE INDEX items_host_reporter ON items (host, reporter_email, id);
CREATE INDEX items_duplicate ON items (duplicate_of, reporter_email);
CREATE INDEX items_project ON items (project, open, id);

UPDATE codes SET grant_json = (
  SELECT CASE WHEN json_extract(s.value, '$.space') = 1 THEN '{"space":true}'
    ELSE '{"projects":' || (
      SELECT json_group_array(x.id) FROM (
        SELECT DISTINCT p.id AS id FROM json_each(s.value, '$.projects') j JOIN projects p ON p.name = j.value ORDER BY 1
      ) x
    ) || '}'
  END
  FROM spaces_plan s WHERE s.kind = 'grant' AND s.name = CAST(codes.id AS TEXT) AND json_valid(s.value)
  LIMIT 1
);

UPDATE codes SET grant_json = CASE
    WHEN NOT json_valid(hosts_json) THEN '{"projects":[]}'
    WHEN EXISTS (SELECT 1 FROM json_each(codes.hosts_json) j WHERE j.value = '*') THEN '{"space":true}'
    WHEN EXISTS (SELECT 1 FROM hosts)
      AND NOT EXISTS (SELECT 1 FROM hosts h WHERE h.host NOT IN (SELECT lower(j.value) FROM json_each(codes.hosts_json) j))
      THEN '{"space":true}'
    ELSE '{"projects":' || (
      SELECT json_group_array(x.id) FROM (
        SELECT DISTINCT h.project_id AS id FROM hosts h
        WHERE h.host IN (SELECT lower(j.value) FROM json_each(codes.hosts_json) j) ORDER BY 1
      ) x
    ) || '}'
  END
WHERE grant_json IS NULL;

UPDATE codes SET hosts_json = CASE
    WHEN json_extract(grant_json, '$.space') = 1 THEN (SELECT json_group_array(x.host) FROM (SELECT host FROM hosts ORDER BY host) x)
    ELSE (
      SELECT json_group_array(x.host) FROM (
        SELECT h.host FROM hosts h
        WHERE h.project_id IN (SELECT j.value FROM json_each(codes.grant_json, '$.projects') j) ORDER BY h.host
      ) x
    )
  END;

CREATE INDEX hosts_project ON hosts (project_id, host);
CREATE INDEX items_project_id ON items (project_id, open, id);

DROP TABLE IF EXISTS item_labels;
DROP TABLE IF EXISTS lane_keys;
DROP TABLE IF EXISTS items_hold;
DROP TABLE IF EXISTS boards_hold;

DROP TABLE IF EXISTS spaces_kept;
CREATE TABLE spaces_kept (
  items INTEGER CONSTRAINT spaces_kept_items CHECK (items >= 0),
  open INTEGER CONSTRAINT spaces_kept_open CHECK (open >= 0),
  comments INTEGER CONSTRAINT spaces_kept_comments CHECK (comments >= 0),
  events INTEGER CONSTRAINT spaces_kept_events CHECK (events >= 0),
  attachments INTEGER CONSTRAINT spaces_kept_attachments CHECK (attachments >= 0),
  codes INTEGER CONSTRAINT spaces_kept_codes CHECK (codes >= 0),
  cards INTEGER CONSTRAINT spaces_kept_cards CHECK (cards >= 0),
  hosts INTEGER CONSTRAINT spaces_kept_hosts CHECK (hosts = 0)
);

INSERT INTO spaces_kept (items, open, comments, events, attachments, codes, cards, hosts) SELECT
  (SELECT count(*) FROM items) - (SELECT was FROM spaces_count WHERE what = 'items'),
  (SELECT COALESCE(sum(open), 0) FROM items) - (SELECT was FROM spaces_count WHERE what = 'open'),
  (SELECT count(*) FROM comments) - (SELECT was FROM spaces_count WHERE what = 'comments'),
  (SELECT count(*) FROM events) - (SELECT was FROM spaces_count WHERE what = 'events'),
  (SELECT count(*) FROM attachments) - (SELECT was FROM spaces_count WHERE what = 'attachments'),
  (SELECT count(*) FROM codes) - (SELECT was FROM spaces_count WHERE what = 'codes'),
  (SELECT COALESCE(min(k.n), 0) FROM (
    SELECT (SELECT count(*) FROM items i JOIN projects p ON p.id = i.project_id WHERE 'cards:' || lower(p.name) = c.what) - c.was AS n
    FROM spaces_count c WHERE c.what LIKE 'cards:%'
  ) k),
  (SELECT count(*) FROM hosts WHERE project_id IS NULL);

DROP TABLE spaces_kept;
DROP TABLE spaces_count;
DROP TABLE spaces_plan;

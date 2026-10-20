PRAGMA defer_foreign_keys = true;

CREATE TABLE statuses (
  key TEXT PRIMARY KEY CHECK (key IN ('inbox', 'doing', 'review', 'done')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

INSERT INTO statuses (key, name, position) VALUES ('inbox', 'Inbox', 0), ('doing', 'Doing', 1), ('review', 'Review', 2), ('done', 'Done', 3);

CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host TEXT,
  parent_id INTEGER REFERENCES boards (id),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'doing', 'review', 'done')),
  position REAL NOT NULL DEFAULT 0,
  home INTEGER NOT NULL DEFAULT 0 CHECK (home IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX boards_parent ON boards (parent_id, status, position);
CREATE INDEX boards_host ON boards (host, id);
CREATE UNIQUE INDEX boards_home ON boards (host) WHERE home = 1;

INSERT INTO boards (slug, name, host, home, created_at, updated_at)
SELECT base || CASE WHEN n > 1 THEN '-' || n ELSE '' END, host, host, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT host, replace(host, '.', '-') AS base, row_number() OVER (PARTITION BY replace(host, '.', '-') ORDER BY host) AS n
  FROM (SELECT host FROM hosts UNION SELECT host FROM items)
)
ORDER BY host;

CREATE TABLE items_hold AS
SELECT id, client_uid, kind, next_status AS status, next_status <> 'done' AS open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee,
  CASE WHEN next_resolution = 'duplicate' THEN duplicate_of END AS duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, CASE WHEN next_status = 'done' THEN COALESCE(closed_at, updated_at) END AS closed_at, next_resolution AS resolution,
  (SELECT b.id FROM boards b WHERE b.host = mapped.host AND b.home = 1) AS board_id,
  1024.0 * row_number() OVER (PARTITION BY host, next_status ORDER BY id DESC) AS position
FROM (
  SELECT items.*,
    CASE status
      WHEN 'new' THEN 'inbox'
      WHEN 'confirmed' THEN 'doing'
      WHEN 'in_progress' THEN 'doing'
      WHEN 'waiting' THEN 'review'
      ELSE 'done'
    END AS next_status,
    CASE status
      WHEN 'resolved' THEN 'fixed'
      WHEN 'abandoned' THEN 'abandoned'
      WHEN 'duplicate' THEN 'duplicate'
    END AS next_resolution
  FROM items
) AS mapped;

DROP TABLE items;

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feature', 'improvement', 'question', 'task')),
  status TEXT NOT NULL CHECK (status IN ('inbox', 'doing', 'review', 'done')),
  open INTEGER NOT NULL CHECK (open IN (0, 1)),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  origin_env TEXT NOT NULL,
  host TEXT NOT NULL,
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
  board_id INTEGER NOT NULL REFERENCES boards (id),
  position REAL NOT NULL,
  CHECK ((status = 'done') = (resolution IS NOT NULL)),
  CHECK (open = (status <> 'done'))
);

INSERT INTO items (id, client_uid, kind, status, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution, board_id, position)
SELECT id, client_uid, kind, status, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution, board_id, position FROM items_hold;

DROP TABLE items_hold;

CREATE INDEX items_open ON items (open, id);
CREATE INDEX items_status ON items (status, id);
CREATE INDEX items_kind ON items (kind, id);
CREATE INDEX items_reporter ON items (reporter_email, id);
CREATE INDEX items_reporter_open_path ON items (reporter_email, open, page_path);
CREATE INDEX items_path ON items (page_path, open, id);
CREATE INDEX items_host ON items (host, open, id);
CREATE INDEX items_host_reporter ON items (host, reporter_email, id);
CREATE INDEX items_board ON items (board_id, status, position);

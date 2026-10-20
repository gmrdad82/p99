PRAGMA defer_foreign_keys = true;

ALTER TABLE labels ADD COLUMN closes INTEGER NOT NULL DEFAULT 0 CHECK (closes IN (0, 1));
ALTER TABLE labels ADD COLUMN role TEXT CHECK (role IN ('inbox', 'doing', 'review', 'done'));

INSERT INTO labels (name, color, created_at, role)
SELECT name, CASE key WHEN 'inbox' THEN '#539bf5' WHEN 'doing' THEN '#c69026' WHEN 'review' THEN '#986ee2' ELSE '#57ab5a' END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), key
FROM statuses WHERE true
ON CONFLICT (name) DO UPDATE SET role = excluded.role;

UPDATE labels SET closes = 1 WHERE role = 'done';

CREATE UNIQUE INDEX labels_role ON labels (role) WHERE role IS NOT NULL;

CREATE TABLE lane_keys AS
SELECT board_id, id AS item_id, status,
  row_number() OVER (
    PARTITION BY board_id, status
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, position, id
  ) - 1 AS n
FROM items;

CREATE TABLE items_hold AS
SELECT i.*, (SELECT l.id FROM labels l WHERE l.role = i.status) AS label_id FROM items i;

DELETE FROM events WHERE kind = 'priority';
DROP INDEX items_priority;
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
  CHECK (open = (resolution IS NULL))
);

INSERT INTO items (id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution)
SELECT id, client_uid, kind, label_id, open, title, body, origin_env, host, page_url, page_path, page_title,
  reporter_email, reporter_name, reporter_json, reporter_agent, assignee, duplicate_of, context_json, marks_json, search_text,
  comment_count, public_comment_count, attachment_count, public_attachment_count, activity_at, public_activity_at,
  created_at, updated_at, closed_at, resolution FROM items_hold;

DROP TABLE items_hold;

CREATE INDEX items_open ON items (open, id);
CREATE INDEX items_label ON items (label_id, host);
CREATE INDEX items_kind ON items (kind, id);
CREATE INDEX items_reporter ON items (reporter_email, id);
CREATE INDEX items_reporter_open_path ON items (reporter_email, open, page_path);
CREATE INDEX items_path ON items (page_path, open, id);
CREATE INDEX items_host ON items (host, open, id);
CREATE INDEX items_host_reporter ON items (host, reporter_email, id);
CREATE INDEX items_duplicate ON items (duplicate_of, reporter_email);

CREATE TABLE boards_hold AS
SELECT id, name, host, created_at, updated_at,
  (SELECT email FROM codes WHERE manager = 1 AND revoked_at IS NULL ORDER BY id LIMIT 1) AS owner
FROM boards;

DROP TABLE boards;
DROP TABLE statuses;

CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT,
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO boards (id, name, host, owner, created_at, updated_at)
SELECT id, name, host, owner, created_at, updated_at FROM boards_hold;

DROP TABLE boards_hold;

CREATE INDEX boards_owner ON boards (owner, host);
CREATE INDEX boards_host ON boards (host, id);

CREATE TABLE board_columns (
  board_id INTEGER NOT NULL REFERENCES boards (id),
  label_id INTEGER NOT NULL REFERENCES labels (id),
  position INTEGER NOT NULL,
  PRIMARY KEY (board_id, label_id)
);

CREATE INDEX board_columns_label ON board_columns (label_id, board_id);

INSERT INTO board_columns (board_id, label_id, position)
SELECT b.id, l.id, CASE l.role WHEN 'inbox' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 2 ELSE 3 END
FROM boards b CROSS JOIN labels l WHERE l.role IS NOT NULL;

CREATE TABLE board_positions (
  board_id INTEGER NOT NULL REFERENCES boards (id),
  item_id INTEGER NOT NULL REFERENCES items (id),
  label_id INTEGER NOT NULL REFERENCES labels (id),
  key TEXT NOT NULL,
  PRIMARY KEY (board_id, item_id)
);

CREATE INDEX board_positions_order ON board_positions (board_id, label_id, key);

INSERT INTO board_positions (board_id, item_id, label_id, key)
SELECT k.board_id, k.item_id, (SELECT l.id FROM labels l WHERE l.role = k.status),
  CASE WHEN k.n < 62 THEN 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n + 1, 1)
    WHEN k.n < 3844 THEN 'b' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n / 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n % 62 + 1, 1)
    ELSE 'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n / 3844 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', k.n % 62 + 1, 1)
  END
FROM lane_keys k WHERE k.board_id IN (SELECT id FROM boards);

DROP TABLE lane_keys;

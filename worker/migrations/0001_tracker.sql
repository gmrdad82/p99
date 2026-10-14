CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feature', 'improvement', 'question', 'task')),
  status TEXT NOT NULL CHECK (status IN ('new', 'confirmed', 'in_progress', 'waiting', 'resolved', 'abandoned', 'duplicate')),
  open INTEGER NOT NULL CHECK (open IN (0, 1)),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  origin_env TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_json TEXT NOT NULL,
  assignee TEXT,
  duplicate_of INTEGER REFERENCES items (id),
  context_json TEXT NOT NULL,
  marks_json TEXT NOT NULL,
  comment_count INTEGER NOT NULL DEFAULT 0,
  public_comment_count INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  public_attachment_count INTEGER NOT NULL DEFAULT 0,
  activity_at TEXT NOT NULL,
  public_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE INDEX items_open ON items (open, id);
CREATE INDEX items_status ON items (status, id);
CREATE INDEX items_kind ON items (kind, id);
CREATE INDEX items_reporter ON items (reporter_email, id);
CREATE INDEX items_reporter_open_path ON items (reporter_email, open, page_path);
CREATE INDEX items_path ON items (page_path, open, id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items (id),
  client_uid TEXT NOT NULL UNIQUE,
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_manager INTEGER NOT NULL CHECK (author_manager IN (0, 1)),
  body TEXT NOT NULL,
  internal INTEGER NOT NULL CHECK (internal IN (0, 1)),
  origin_env TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX comments_item ON comments (item_id, id);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items (id),
  client_uid TEXT NOT NULL UNIQUE,
  comment_id INTEGER REFERENCES comments (id),
  internal INTEGER NOT NULL CHECK (internal IN (0, 1)),
  role TEXT NOT NULL CHECK (role IN ('screenshot', 'page', 'region', 'file')),
  mark INTEGER CHECK ((role = 'region') = (mark IS NOT NULL)),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  origin_env TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stored_at TEXT,
  stored_token TEXT
);

CREATE INDEX attachments_item ON attachments (item_id, id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items (id),
  actor_email TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  at TEXT NOT NULL
);

CREATE INDEX events_item ON events (item_id, id);

CREATE TABLE reads (
  actor_email TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items (id),
  read_at TEXT NOT NULL,
  PRIMARY KEY (actor_email, item_id)
);

CREATE TABLE builds (
  env TEXT NOT NULL,
  branch TEXT NOT NULL,
  sha TEXT NOT NULL,
  version TEXT NOT NULL,
  dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
  announced_at TEXT NOT NULL,
  PRIMARY KEY (env, branch)
);

CREATE TABLE build_items (
  env TEXT NOT NULL,
  branch TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  rel TEXT NOT NULL CHECK (rel IN ('fixes', 'refs')),
  sha TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (env, branch, item_id, rel, sha)
);

CREATE INDEX build_items_item ON build_items (item_id);

CREATE TABLE landings (
  item_id INTEGER NOT NULL,
  env TEXT NOT NULL,
  sha TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (item_id, env)
);

CREATE TABLE usage (
  actor_email TEXT NOT NULL,
  day TEXT NOT NULL,
  issues INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_email, day)
);

CREATE TABLE backup_runs (
  date TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  table_index INTEGER NOT NULL DEFAULT 0,
  after_rowid INTEGER NOT NULL DEFAULT 0,
  page INTEGER NOT NULL DEFAULT 0,
  rows_json TEXT NOT NULL DEFAULT '{}',
  pages INTEGER NOT NULL DEFAULT 0
);

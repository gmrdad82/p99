CREATE TABLE hosts (
  host TEXT PRIMARY KEY,
  env TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX hosts_env ON hosts (env, host);

CREATE TABLE envs (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('development', 'release')),
  position INTEGER NOT NULL DEFAULT 0,
  notify INTEGER NOT NULL DEFAULT 0 CHECK (notify IN (0, 1))
);

CREATE TABLE codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  hosts_json TEXT NOT NULL,
  manager INTEGER NOT NULL DEFAULT 0 CHECK (manager IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX codes_email ON codes (email, id);

ALTER TABLE items ADD COLUMN host TEXT;
ALTER TABLE items ADD COLUMN reporter_agent TEXT;
ALTER TABLE comments ADD COLUMN author_agent TEXT;

CREATE INDEX items_host ON items (host, open, id);
CREATE INDEX items_host_reporter ON items (host, reporter_email, id);

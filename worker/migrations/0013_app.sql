CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES codes (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX app_sessions_code ON app_sessions (code_id);

CREATE TABLE app_tries (
  key TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  n INTEGER NOT NULL
);

ALTER TABLE codes ADD COLUMN totp_secret TEXT;
ALTER TABLE codes ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codes ADD COLUMN totp_fails INTEGER NOT NULL DEFAULT 0;

CREATE TABLE code_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL REFERENCES codes (id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX code_devices_code ON code_devices (code_id);

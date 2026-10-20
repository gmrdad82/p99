CREATE TABLE mail (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'off')),
  sender TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE mail_optouts (
  item_id INTEGER NOT NULL REFERENCES items (id),
  email TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (item_id, email)
);

ALTER TABLE codes ADD COLUMN sealed_code TEXT;

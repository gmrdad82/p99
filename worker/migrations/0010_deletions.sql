CREATE TABLE deletions (
  r2_key TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  due_at TEXT NOT NULL
);

CREATE INDEX deletions_due ON deletions (due_at);

CREATE TABLE github (
  host TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  hook_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE github_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items (id),
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull')),
  rel TEXT NOT NULL CHECK (rel IN ('opened', 'fixes', 'refs')),
  repo TEXT NOT NULL,
  number INTEGER,
  url TEXT,
  at TEXT NOT NULL
);

CREATE UNIQUE INDEX github_links_opened ON github_links (item_id) WHERE rel = 'opened';
CREATE UNIQUE INDEX github_links_pull ON github_links (item_id, repo, number) WHERE kind = 'pull';
CREATE INDEX github_links_number ON github_links (repo, kind, number);

CREATE TABLE github_deliveries (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX github_deliveries_at ON github_deliveries (at);

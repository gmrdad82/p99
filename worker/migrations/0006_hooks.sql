CREATE TABLE hooks (
  host TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('slack', 'discord')),
  url_sealed TEXT NOT NULL,
  hint TEXT NOT NULL,
  events_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  last_status TEXT,
  last_at TEXT,
  PRIMARY KEY (host, service)
);

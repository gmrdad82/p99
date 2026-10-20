ALTER TABLE items ADD COLUMN priority TEXT CHECK (priority IN ('urgent', 'high', 'normal', 'low'));

CREATE INDEX items_priority ON items (priority, id);

CREATE TABLE labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL CHECK (length(color) = 7 AND color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  created_at TEXT NOT NULL
);

CREATE TABLE item_labels (
  item_id INTEGER NOT NULL REFERENCES items (id),
  label_id INTEGER NOT NULL REFERENCES labels (id),
  PRIMARY KEY (item_id, label_id)
);

CREATE INDEX item_labels_label ON item_labels (label_id, item_id);

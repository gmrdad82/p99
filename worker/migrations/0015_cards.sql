ALTER TABLE items ADD COLUMN project TEXT COLLATE NOCASE;
ALTER TABLE items ADD COLUMN reporter_via TEXT;
ALTER TABLE comments ADD COLUMN author_via TEXT;
ALTER TABLE events ADD COLUMN actor_via TEXT;
ALTER TABLE boards ADD COLUMN cards INTEGER NOT NULL DEFAULT 0 CHECK (cards IN (0, 1));

CREATE INDEX items_project ON items (project, open, id);
CREATE UNIQUE INDEX boards_cards ON boards (cards) WHERE cards = 1;

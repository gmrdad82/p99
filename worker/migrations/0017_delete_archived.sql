PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS prune_lanes;
CREATE TABLE prune_lanes AS
SELECT row_number() OVER (ORDER BY bc.position) - 1 AS lane, bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1;

DROP TABLE IF EXISTS prune_map;
CREATE TABLE prune_map AS
SELECT i.id AS item_id, i.label_id AS from_id, l.name AS from_name,
  (SELECT k.label_id FROM prune_lanes k WHERE k.lane = CASE WHEN i.open = 0 THEN 6 ELSE 2 END) AS to_id
FROM items i JOIN labels l ON l.id = i.label_id
WHERE (SELECT count(*) FROM prune_lanes) = 7 AND i.label_id NOT IN (SELECT label_id FROM prune_lanes);

INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at, actor_via)
SELECT m.item_id, NULL, 0, 'label', json_object('from', m.from_name, 'to', l.name, 'migrated', json('true')), 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
FROM prune_map m JOIN labels l ON l.id = m.to_id
ORDER BY m.item_id;

DROP TABLE IF EXISTS prune_place;
CREATE TABLE prune_place AS
WITH want AS (
  SELECT i.id AS item_id, COALESCE(m.to_id, i.label_id) AS label_id, COALESCE(m.from_id, i.label_id) AS was_id
  FROM items i LEFT JOIN prune_map m ON m.item_id = i.id
  WHERE (SELECT count(*) FROM prune_lanes) = 7
    AND NOT EXISTS (SELECT 1 FROM board_positions op JOIN boards ob ON ob.id = op.board_id
      WHERE ob.cards = 1 AND op.item_id = i.id AND op.label_id = COALESCE(m.to_id, i.label_id))
    AND (m.item_id IS NOT NULL OR EXISTS (SELECT 1 FROM board_positions bp JOIN boards b ON b.id = bp.board_id
      WHERE b.cards = 0 AND bp.item_id = i.id AND bp.label_id = i.label_id))
),
seen AS (
  SELECT w.item_id, w.label_id, b.created_at AS board_at, b.id AS board_id, bp.key,
    row_number() OVER (PARTITION BY w.item_id ORDER BY bp.key IS NULL, b.created_at, b.id) AS nth
  FROM want w
  LEFT JOIN board_positions bp ON bp.item_id = w.item_id AND bp.label_id = w.was_id
    AND bp.board_id IN (SELECT id FROM boards WHERE cards = 0)
  LEFT JOIN boards b ON b.id = bp.board_id
)
SELECT s.item_id, s.label_id,
  row_number() OVER (PARTITION BY s.label_id ORDER BY s.key IS NULL, s.board_at, s.board_id, s.key, s.item_id DESC) - 1 AS n,
  (SELECT max(op.key) FROM board_positions op JOIN boards ob ON ob.id = op.board_id JOIN items x ON x.id = op.item_id AND x.label_id = op.label_id
    WHERE ob.cards = 1 AND op.label_id = s.label_id) AS last
FROM seen s WHERE s.nth = 1;

UPDATE items SET label_id = (SELECT m.to_id FROM prune_map m WHERE m.item_id = items.id)
WHERE id IN (SELECT item_id FROM prune_map);

INSERT INTO board_positions (board_id, item_id, label_id, key)
SELECT (SELECT id FROM boards WHERE cards = 1), p.item_id, p.label_id,
  COALESCE(p.last || 'V', '') ||
  CASE WHEN p.n < 62 THEN 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n + 1, 1)
    WHEN p.n < 3844 THEN 'b' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n / 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n % 62 + 1, 1)
    ELSE 'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n / 3844 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', p.n % 62 + 1, 1)
  END || CASE WHEN p.last IS NULL THEN '' ELSE 'V' END
FROM prune_place p WHERE true
ON CONFLICT (board_id, item_id) DO UPDATE SET label_id = excluded.label_id, key = excluded.key;

DELETE FROM board_positions
WHERE (SELECT count(*) FROM prune_lanes) = 7
  AND (board_id IN (SELECT id FROM boards WHERE cards = 0) OR label_id NOT IN (SELECT label_id FROM prune_lanes));

DELETE FROM board_columns
WHERE (SELECT count(*) FROM prune_lanes) = 7 AND board_id IN (SELECT id FROM boards WHERE cards = 0);

DELETE FROM boards WHERE cards = 0 AND (SELECT count(*) FROM prune_lanes) = 7;

DELETE FROM item_labels;

DELETE FROM labels
WHERE (SELECT count(*) FROM prune_lanes) = 7
  AND id NOT IN (SELECT label_id FROM prune_lanes)
  AND NOT EXISTS (SELECT 1 FROM items i WHERE i.label_id = labels.id)
  AND NOT EXISTS (SELECT 1 FROM board_columns bc WHERE bc.label_id = labels.id)
  AND NOT EXISTS (SELECT 1 FROM board_positions bp WHERE bp.label_id = labels.id);

DROP TABLE IF EXISTS archived;

DROP TABLE prune_place;
DROP TABLE prune_map;
DROP TABLE prune_lanes;

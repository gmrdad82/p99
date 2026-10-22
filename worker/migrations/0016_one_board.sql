PRAGMA defer_foreign_keys = true;

CREATE TABLE IF NOT EXISTS archived (
  kind TEXT NOT NULL CHECK (kind IN ('board', 'label', 'fold')),
  id INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

INSERT INTO boards (name, host, owner, created_at, updated_at, cards)
SELECT 'Cards', NULL, (SELECT email FROM codes WHERE manager = 1 AND revoked_at IS NULL ORDER BY id LIMIT 1),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1
WHERE NOT EXISTS (SELECT 1 FROM boards WHERE cards = 1);

INSERT INTO labels (name, color, created_at)
SELECT json_extract(j.value, '$.name'), json_extract(j.value, '$.color'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM json_each('[{"name":"New","color":"#539bf5"},{"name":"Planned","color":"#986ee2"},{"name":"In progress","color":"#c69026"},{"name":"Needs you","color":"#e0823d"},{"name":"Stuck","color":"#e5534b"},{"name":"Landed","color":"#39a5a0"}]') j
WHERE NOT EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
ON CONFLICT (name) DO NOTHING;

INSERT INTO board_columns (board_id, label_id, position)
SELECT b.id, x.label_id, x.position FROM boards b JOIN (
  SELECT l.id AS label_id, j.key AS position FROM json_each('["New","Planned","In progress","Needs you","Stuck","Landed"]') j JOIN labels l ON l.name = j.value
  UNION ALL
  SELECT l.id, 6 FROM labels l WHERE l.role = 'done'
) x
WHERE b.cards = 1 AND NOT EXISTS (SELECT 1 FROM board_columns bc WHERE bc.board_id = b.id);

INSERT INTO labels (name, color, created_at)
SELECT 'Needs you', '#e0823d', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 6
ON CONFLICT (name) DO NOTHING;

UPDATE board_columns SET position = position + 1
WHERE board_id = (SELECT id FROM boards WHERE cards = 1)
  AND position >= (SELECT bc.position FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1 ORDER BY bc.position LIMIT 1 OFFSET 3)
  AND (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 6
  AND NOT EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 AND l.name = 'Needs you');

INSERT INTO board_columns (board_id, label_id, position)
SELECT b.id, l.id, (SELECT max(bc.position) FROM board_columns bc WHERE bc.board_id = b.id AND bc.position < (
    SELECT o.position FROM board_columns o WHERE o.board_id = b.id ORDER BY o.position LIMIT 1 OFFSET 3)) + 1
FROM boards b JOIN labels l ON l.name = 'Needs you'
WHERE b.cards = 1 AND (SELECT count(*) FROM board_columns bc WHERE bc.board_id = b.id) = 6
  AND NOT EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id JOIN labels l ON l.id = bc.label_id WHERE b.cards = 1 AND l.name = 'Needs you');

DROP TABLE IF EXISTS one_lanes;
CREATE TABLE one_lanes AS
SELECT row_number() OVER (ORDER BY bc.position) - 1 AS lane, bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1;

UPDATE labels SET closes = CASE WHEN id = (SELECT label_id FROM one_lanes WHERE lane = 6) THEN 1 ELSE 0 END
WHERE id IN (SELECT label_id FROM one_lanes);

DROP TABLE IF EXISTS one_rank;
CREATE TABLE one_rank AS
SELECT b.id AS board_id,
  row_number() OVER (
    ORDER BY CASE WHEN b.cards = 0 AND b.owner IS (SELECT email FROM codes WHERE manager = 1 AND revoked_at IS NULL ORDER BY id LIMIT 1) THEN 0 ELSE 1 END,
      b.created_at, b.id
  ) AS rank
FROM boards b;

DROP TABLE IF EXISTS one_map;
CREATE TABLE one_map AS
SELECT i.id AS item_id, i.label_id AS from_id, l.name AS from_name,
  (SELECT k.label_id FROM one_lanes k WHERE k.lane = CASE
    WHEN i.open = 0 THEN 6
    WHEN l.role = 'inbox' THEN 0
    WHEN l.role = 'review' THEN 5
    WHEN l.role IS NULL AND (
      SELECT bc.position = (SELECT min(c2.position) FROM board_columns c2 WHERE c2.board_id = bc.board_id)
      FROM board_columns bc JOIN one_rank r ON r.board_id = bc.board_id
      WHERE bc.label_id = l.id ORDER BY r.rank LIMIT 1
    ) THEN 0
    ELSE 2
  END) AS to_id
FROM items i JOIN labels l ON l.id = i.label_id
WHERE NOT EXISTS (SELECT 1 FROM archived WHERE kind = 'fold')
  AND (i.label_id NOT IN (SELECT label_id FROM one_lanes)
    OR (i.open = 0) <> (i.label_id = (SELECT label_id FROM one_lanes WHERE lane = 6)));

INSERT INTO events (item_id, actor_email, actor_agent, kind, detail_json, internal, at, actor_via)
SELECT m.item_id, NULL, 0, 'label', json_object('from', m.from_name, 'to', l.name, 'migrated', json('true')), 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
FROM one_map m JOIN labels l ON l.id = m.to_id
ORDER BY m.item_id;

DROP TABLE IF EXISTS one_order;
CREATE TABLE one_order AS
WITH placed AS (
  SELECT bp.item_id, r.rank, bc.position AS col, bp.key,
    row_number() OVER (PARTITION BY bp.item_id ORDER BY r.rank, bc.position IS NULL) AS nth
  FROM board_positions bp JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id
  JOIN one_rank r ON r.board_id = bp.board_id
  LEFT JOIN board_columns bc ON bc.board_id = bp.board_id AND bc.label_id = bp.label_id
)
SELECT i.id AS item_id, COALESCE(m.to_id, i.label_id) AS label_id,
  row_number() OVER (PARTITION BY COALESCE(m.to_id, i.label_id) ORDER BY p.rank IS NULL, p.rank, p.col, p.key, i.id DESC) - 1 AS n
FROM items i LEFT JOIN one_map m ON m.item_id = i.id LEFT JOIN placed p ON p.item_id = i.id AND p.nth = 1
WHERE NOT EXISTS (SELECT 1 FROM archived WHERE kind = 'fold');

UPDATE items SET label_id = (SELECT m.to_id FROM one_map m WHERE m.item_id = items.id)
WHERE id IN (SELECT item_id FROM one_map);

INSERT INTO board_positions (board_id, item_id, label_id, key)
SELECT (SELECT id FROM boards WHERE cards = 1), o.item_id, o.label_id,
  CASE WHEN o.n < 62 THEN 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n + 1, 1)
    WHEN o.n < 3844 THEN 'b' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n / 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n % 62 + 1, 1)
    ELSE 'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n / 3844 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', o.n % 62 + 1, 1)
  END
FROM one_order o WHERE true
ON CONFLICT (board_id, item_id) DO UPDATE SET label_id = excluded.label_id, key = excluded.key;

UPDATE labels SET role = NULL WHERE role IS NOT NULL AND (SELECT count(*) FROM one_lanes) = 7;

UPDATE labels SET role = CASE id
    WHEN (SELECT label_id FROM one_lanes WHERE lane = 0) THEN 'inbox'
    WHEN (SELECT label_id FROM one_lanes WHERE lane = 2) THEN 'doing'
    WHEN (SELECT label_id FROM one_lanes WHERE lane = 5) THEN 'review'
    ELSE 'done'
  END
WHERE id IN (SELECT label_id FROM one_lanes WHERE lane IN (0, 2, 5, 6)) AND (SELECT count(*) FROM one_lanes) = 7;

INSERT OR IGNORE INTO archived (kind, id, at)
SELECT 'board', id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM boards WHERE cards = 0;

INSERT OR IGNORE INTO archived (kind, id, at)
SELECT 'label', id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM labels WHERE id NOT IN (SELECT label_id FROM one_lanes);

INSERT OR IGNORE INTO archived (kind, id, at) VALUES ('fold', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

DROP TABLE one_order;
DROP TABLE one_map;
DROP TABLE one_rank;
DROP TABLE one_lanes;

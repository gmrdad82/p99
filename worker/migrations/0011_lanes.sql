CREATE TABLE lane_slots AS
SELECT type, id, lane, status,
  row_number() OVER (PARTITION BY lane, status ORDER BY position, type DESC, id) AS slot,
  row_number() OVER (PARTITION BY lane, status, type ORDER BY position, id) AS nth
FROM (
  SELECT 'item' AS type, id, board_id AS lane, status, position FROM items WHERE status <> 'done'
  UNION ALL
  SELECT 'board' AS type, id, parent_id AS lane, status, position FROM boards WHERE parent_id IS NOT NULL AND status <> 'done'
);

CREATE TABLE lane_ranks AS
SELECT id, board_id AS lane, status,
  row_number() OVER (
    PARTITION BY board_id, status
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at, id
  ) AS nth
FROM items WHERE status <> 'done';

UPDATE items SET position = 1024.0 * s.slot
FROM lane_ranks r JOIN lane_slots s ON s.type = 'item' AND s.lane = r.lane AND s.status = r.status AND s.nth = r.nth
WHERE items.id = r.id;

UPDATE boards SET position = 1024.0 * s.slot
FROM lane_slots s
WHERE s.type = 'board' AND boards.id = s.id;

DROP TABLE lane_ranks;
DROP TABLE lane_slots;

DELETE FROM events WHERE kind = 'priority';

DROP INDEX items_priority;
ALTER TABLE items DROP COLUMN priority;

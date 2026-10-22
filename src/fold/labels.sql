SELECT l.name AS label, l.role AS role, l.closes AS closes, count(i.id) AS items, coalesce(sum(i.open), 0) AS open,
  (SELECT bc.position = (SELECT min(c2.position) FROM board_columns c2 WHERE c2.board_id = bc.board_id)
    FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = l.id
    ORDER BY CASE WHEN b.cards = 0 AND b.owner IS (SELECT email FROM codes WHERE manager = 1 ORDER BY revoked_at IS NOT NULL, id LIMIT 1) THEN 0 ELSE 1 END, b.created_at, b.id
    LIMIT 1) AS first
FROM labels l LEFT JOIN items i ON i.label_id = l.id
WHERE l.id NOT IN (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
  AND NOT (
    (l.name = 'Needs you' AND (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) <> 7)
    OR (NOT EXISTS (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
      AND (l.role = 'done' OR l.name IN ('New', 'Planned', 'In progress', 'Stuck', 'Landed'))))
GROUP BY l.id ORDER BY l.name, l.id

SELECT s.lane AS lane, count(*) AS items, sum(s.moved) AS moved FROM (
  SELECT coalesce(k.lane, CASE WHEN i.open = 0 THEN 6 ELSE 2 END) AS lane, k.lane IS NULL AS moved
  FROM items i JOIN labels l ON l.id = i.label_id
  LEFT JOIN (
    SELECT bc.label_id AS label_id,
      (SELECT count(*) FROM board_columns o JOIN boards b ON b.id = o.board_id WHERE b.cards = 1 AND o.position < bc.position) AS lane
    FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1
  ) k ON k.label_id = i.label_id
) s GROUP BY s.lane ORDER BY s.lane

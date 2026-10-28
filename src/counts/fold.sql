SELECT s.lane AS lane, count(*) AS items, sum(s.moved) AS moved FROM (
  SELECT CASE WHEN t.stay = 1 THEN t.lane WHEN t.open = 0 THEN 6 WHEN t.role IS 'inbox' THEN 0 WHEN t.role IS 'review' THEN 5 ELSE 2 END AS lane,
    1 - t.stay AS moved
  FROM (
    SELECT i.open AS open, l.role AS role, k.lane AS lane, coalesce(k.lane IS NOT NULL AND (i.open = 0) = (k.lane = 6), 0) AS stay
    FROM items i JOIN labels l ON l.id = i.label_id
    LEFT JOIN (
      SELECT x.id AS label_id, CASE
        WHEN (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 7 THEN
          CASE WHEN p.position IS NOT NULL THEN
            (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1 AND bc.position < p.position) END
        WHEN (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 6
          AND NOT EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id JOIN labels n ON n.id = bc.label_id WHERE b.cards = 1 AND n.name = 'Needs you') THEN
          CASE WHEN p.position IS NOT NULL THEN
              (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1 AND bc.position < p.position)
              + ((SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1 AND bc.position < p.position) >= 3)
            WHEN x.name = 'Needs you' THEN 3 END
        ELSE CASE x.name WHEN 'New' THEN 0 WHEN 'Planned' THEN 1 WHEN 'In progress' THEN 2 WHEN 'Needs you' THEN 3 WHEN 'Stuck' THEN 4 WHEN 'Landed' THEN 5
          ELSE CASE WHEN x.role IS 'done' THEN 6 END END
      END AS lane
      FROM labels x LEFT JOIN (SELECT bc.label_id AS label_id, bc.position AS position FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) p ON p.label_id = x.id
    ) k ON k.label_id = l.id
  ) t
) s GROUP BY s.lane ORDER BY s.lane

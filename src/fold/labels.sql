SELECT l.name AS label, l.role AS role, l.closes AS closes, count(i.id) AS items, coalesce(sum(i.open), 0) AS open
FROM labels l LEFT JOIN items i ON i.label_id = l.id
WHERE NOT CASE
    WHEN (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 7
      OR ((SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 6
        AND NOT EXISTS (SELECT 1 FROM board_columns bc JOIN boards b ON b.id = bc.board_id JOIN labels n ON n.id = bc.label_id WHERE b.cards = 1 AND n.name = 'Needs you'))
    THEN l.id IN (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
      OR (l.name = 'Needs you' AND (SELECT count(*) FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1) = 6)
    ELSE l.role IS 'done' OR l.name IN ('New', 'Planned', 'In progress', 'Needs you', 'Stuck', 'Landed')
  END
GROUP BY l.id ORDER BY l.name, l.id

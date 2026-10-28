SELECT l.name AS label, count(i.id) AS items, coalesce(sum(i.open), 0) AS open
FROM labels l LEFT JOIN items i ON i.label_id = l.id
WHERE l.id NOT IN (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
GROUP BY l.id ORDER BY l.name, l.id

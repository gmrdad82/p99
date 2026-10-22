SELECT b.id AS id, b.name AS name, b.owner AS owner, b.cards AS cards,
  (SELECT count(*) FROM board_columns bc WHERE bc.board_id = b.id) AS columns,
  (SELECT count(*) FROM items i WHERE (
    SELECT bp.board_id FROM board_positions bp JOIN boards f ON f.id = bp.board_id
    WHERE bp.item_id = i.id AND bp.label_id = i.label_id
    ORDER BY CASE WHEN f.cards = 0 AND f.owner IS (SELECT email FROM codes WHERE manager = 1 ORDER BY revoked_at IS NOT NULL, id LIMIT 1) THEN 0 ELSE 1 END, f.created_at, f.id
    LIMIT 1) = b.id) AS placed
FROM boards b
ORDER BY CASE WHEN b.cards = 0 AND b.owner IS (SELECT email FROM codes WHERE manager = 1 ORDER BY revoked_at IS NOT NULL, id LIMIT 1) THEN 0 ELSE 1 END, b.created_at, b.id

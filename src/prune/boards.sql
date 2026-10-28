SELECT b.id AS id, b.name AS name, b.owner AS owner,
  (SELECT count(*) FROM board_columns bc WHERE bc.board_id = b.id) AS columns,
  (SELECT count(*) FROM board_positions bp WHERE bp.board_id = b.id) AS places
FROM boards b WHERE b.cards = 0
ORDER BY b.created_at, b.id

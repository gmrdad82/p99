SELECT count(*) AS lanes FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1

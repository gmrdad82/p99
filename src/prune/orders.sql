SELECT count(*) AS unplaced FROM items i
WHERE i.label_id IN (SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)
  AND EXISTS (SELECT 1 FROM board_positions bp JOIN boards b ON b.id = bp.board_id WHERE b.cards = 0 AND bp.item_id = i.id AND bp.label_id = i.label_id)
  AND NOT EXISTS (SELECT 1 FROM board_positions op JOIN boards ob ON ob.id = op.board_id WHERE ob.cards = 1 AND op.item_id = i.id AND op.label_id = i.label_id)

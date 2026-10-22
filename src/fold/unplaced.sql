SELECT count(*) AS items FROM items i WHERE NOT EXISTS (SELECT 1 FROM board_positions bp WHERE bp.item_id = i.id AND bp.label_id = i.label_id)

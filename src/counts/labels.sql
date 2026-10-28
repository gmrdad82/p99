SELECT l.name AS label, count(i.id) AS items
FROM labels l JOIN items i ON i.label_id = l.id
GROUP BY l.id ORDER BY l.name, l.id

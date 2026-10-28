SELECT (SELECT count(*) FROM items) AS items, (SELECT count(*) FROM comments) AS comments,
  (SELECT count(*) FROM attachments) AS attachments, (SELECT count(*) FROM events) AS events

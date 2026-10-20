CREATE TABLE people (
  email TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX people_skeleton ON people (
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    username, '.', ''), '_', ''), '-', ''), '0', 'o'), '1', 'l'), 'i', 'l'), '3', 'e'), '4', 'a'), '5', 's'), '7', 't'), '8', 'b'), 'rn', 'm'), 'vv', 'w')
);

WITH RECURSIVE
  src (email, name, first) AS (
    SELECT lower(trim(email)), (SELECT name FROM codes n WHERE lower(trim(n.email)) = lower(trim(c.email)) ORDER BY id DESC LIMIT 1), MIN(id)
      FROM codes c GROUP BY lower(trim(email))
    UNION ALL
    SELECT lower(trim(assignee)), '', 1000000000 + MIN(id) FROM items
      WHERE assignee IS NOT NULL AND lower(trim(assignee)) NOT IN (SELECT lower(trim(email)) FROM codes)
      GROUP BY lower(trim(assignee))
  ),
  walk (email, part, rest, out) AS (
    SELECT email, 'name', lower(trim(name)), '' FROM src
    UNION ALL
    SELECT email, 'local', lower(substr(email, 1, instr(email, '@') - 1)), '' FROM src
    UNION ALL
    SELECT email, part, substr(rest, 2), out || CASE
        WHEN instr('abcdefghijklmnopqrstuvwxyz0123456789._-', substr(rest, 1, 1)) > 0 THEN substr(rest, 1, 1)
        WHEN substr(rest, 1, 1) IN (' ', char(9)) THEN '.'
        WHEN instr('àáâãäåāăąÀÁÂÃÄÅĀĂĄçćčÇĆČďđðĎĐèéêëēėęěÈÉÊËĒĖĘĚìíîïīįıÌÍÎÏĪĮłŁñńňÑŃŇòóôõöøōőÒÓÔÕÖØŌŐřŘśšşŚŠŞťŤùúûüūůűųÙÚÛÜŪŮŰŲýÿÝŸźżžŹŻŽ', substr(rest, 1, 1)) > 0
          THEN substr('aaaaaaaaaaaaaaaaaaccccccdddddeeeeeeeeeeeeeeeeiiiiiiiiiiiiillnnnnnnoooooooooooooooorrssssssttuuuuuuuuuuuuuuuuyyyyzzzzzz',
            instr('àáâãäåāăąÀÁÂÃÄÅĀĂĄçćčÇĆČďđðĎĐèéêëēėęěÈÉÊËĒĖĘĚìíîïīįıÌÍÎÏĪĮłŁñńňÑŃŇòóôõöøōőÒÓÔÕÖØŌŐřŘśšşŚŠŞťŤùúûüūůűųÙÚÛÜŪŮŰŲýÿÝŸźżžŹŻŽ', substr(rest, 1, 1)), 1)
        WHEN substr(rest, 1, 1) = 'ß' THEN 'ss'
        WHEN substr(rest, 1, 1) IN ('æ', 'Æ') THEN 'ae'
        WHEN substr(rest, 1, 1) IN ('œ', 'Œ') THEN 'oe'
        WHEN substr(rest, 1, 1) IN ('þ', 'Þ') THEN 'th'
        ELSE '' END
      FROM walk WHERE rest <> ''
  ),
  folded (email, part, base) AS (
    SELECT email, part, rtrim(substr(ltrim(
      replace(replace(replace(replace(replace(replace(out, '...', '.'), '..', '.'), '__', '_'), '--', '-'), '..', '.'), '.-', '-'),
      '._-'), 1, 26), '._-')
      FROM walk WHERE rest = ''
  ),
  based (email, first, base) AS (
    SELECT s.email, s.first, CASE
        WHEN length(n.base) >= 3 THEN n.base
        WHEN length(l.base) >= 3 THEN l.base
        ELSE 'member' END
      FROM src s JOIN folded n ON n.email = s.email AND n.part = 'name' JOIN folded l ON l.email = s.email AND l.part = 'local'
  ),
  skel (email, first, base, skeleton) AS (
    SELECT email, first, base,
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        base, '.', ''), '_', ''), '-', ''), '0', 'o'), '1', 'l'), 'i', 'l'), '3', 'e'), '4', 'a'), '5', 's'), '7', 't'), '8', 'b'), 'rn', 'm'), 'vv', 'w')
      FROM based
  ),
  ranked (email, first, username) AS (
    SELECT email, first, base || CASE
        WHEN n > 1 THEN CAST(n AS TEXT) ELSE '' END
      FROM (
        SELECT email, first, base,
          ROW_NUMBER() OVER (PARTITION BY skeleton ORDER BY first)
            + (skeleton IN ('admln', 'p99', 'root', 'support', 'manager', 'system', 'null', 'me', 'everyone', 'here', 'channel')) AS n
          FROM skel
      )
  )
INSERT OR IGNORE INTO people (email, username, created_at)
  SELECT email, username, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM ranked ORDER BY first;

INSERT OR IGNORE INTO people (email, username, created_at)
  SELECT email, 'member-' || lower(hex(randomblob(5))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM (
      SELECT lower(trim(email)) AS email FROM codes
      UNION SELECT lower(trim(assignee)) FROM items WHERE assignee IS NOT NULL
    )
    WHERE email NOT IN (SELECT email FROM people);

UPDATE items SET assignee = lower(trim(assignee)) WHERE assignee IS NOT NULL AND assignee <> lower(trim(assignee));

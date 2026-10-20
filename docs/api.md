# The P99 Worker

One Worker, one D1 database (binding `DB`), one R2 bucket (binding `BUCKET`) and one SQLite-backed Durable Object, `P99Hub` (binding `HUB`), per Cloudflare account. The Worker is mounted on every host it serves as the route `<host>/_p99/*`, so a page talks only to its own origin. It may also sit on a custom domain of its own.

The host of a request is the URL's hostname. A host must be listed in the `hosts` table to be served; an unknown host answers 404 on everything but `/_p99/health`. The signed API is the exception: it names the host itself (below), so it answers on any address the Worker is mounted on.

## Paths

| Path | What |
| --- | --- |
| `GET /_p99/health` | `{"ok":true,"version"}`, unsigned |
| `GET /_p99/p99.js` | the loader |
| `GET /_p99/panel.js`, `/_p99/p99.css`, `/_p99/capture.js`, `/_p99/art/concrete.svg`, `/_p99/art/concrete-dark.svg` | the lazy parts |
| `/_p99/api/*` | the browser API, authorised by a personal code |
| `/_p99/v1/*` | the signed API, for the CLI, the TUI and `p99 announce` |

Static files are answered from text modules bundled into the Worker (`worker/src/web/`). The loader is `Cache-Control: public, max-age=300`; every other file is fetched as `<path>?v=<version>` and answered `public, max-age=31536000, immutable`. `__P99_VERSION__` in any served file is replaced by the Worker's `VERSION` variable.

## Errors

Every error is `{"error":"<code>","message":"<English>"}` with 400 `invalid`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 413 `too_large`, 428 `totp_required`, 429 `rate_limited`, 500 `internal`. A `client_uid` seen before answers the original object with 200, never a duplicate. The message is written for the person who reads it: the panel and the CLI show it as it is.

## The browser API

Every request carries `X-P99-Code: <code>`. A code is 12 characters of Crockford base32 (`0123456789abcdefghjkmnpqrstvwxyz`); the Worker lowercases it, reads `i` and `l` as `1` and `o` as `0`, drops `-` and spaces, and looks up its keyed hash, HMAC-SHA256 under the Worker secret `CODE_PEPPER`, so the `codes` table alone gives no code away (`p99 setup` makes that secret once and `p99 deploy` keeps it). A missing, unknown or revoked code, or one not scoped to the request's host, answers 401, and the loader then forgets it; a revocation takes effect everywhere within ten seconds. Each code is limited to 120 requests a minute (the `RATE` rate-limiting binding, when the Worker has one) and to the daily limits below. Since the code travels in a header and never in a cookie, there is no CSRF surface.

A code with an authenticator (`totp`) answers 428 `totp_required` to every route but `POST /_p99/api/verify` until the browser holds a device token for it, and the header then carries both, `X-P99-Code: <code>.<device>`. The TOTP is RFC 6238 with SHA-1, 6 digits and 30-second steps; the Worker keeps its secret encrypted with AES-GCM under a key derived from `CODE_PEPPER`, accepts one step either side of now, never a step at or before the last one used, and after 10 wrong codes answers 403 until `p99 invites totp <id>` sets a new secret. Device tokens are 128 random bits, kept as keyed hashes in `code_devices`.

The actor of a browser request is the code's person: `{email, name, manager}`. A manager is a code minted with `manager`, or an e-mail in the Worker's `MANAGERS` secret (comma separated).

| Route | Who | Does |
| --- | --- | --- |
| `GET /_p99/api/me?path=` | any code | `{"name","email","manager","host","env","version","counts":{"page_open","mine_open","mine_unread","all_open"},"theme":{},"strings":{}}`; `all_open` is null for non-managers; `theme` and `strings` are the host's config; a manager's answer adds `"statuses":[{"key","name","position"}]`, the account's status names |
| `POST /_p99/api/verify` | a code with an authenticator | `{"totp":"<6 digits>"}`; 201 `{"device":"<32 hex>"}`; the panel stores `<code>.<device>` where the loader keeps the code |
| `GET /_p99/api/issues?scope=mine\|all\|page&path=&status=open\|closed\|any\|<status>&board=&kind=&q=&cursor=&limit=&priority=&label=` | any code; `all`, `board`, `priority` and `label` managers only | `{"issues":[summary],"next_cursor"}`, newest first, this host's items only, `limit` at most 100 (default 50); `board` is a board's slug and keeps the items on that board; `priority` (`urgent`, `high`, `normal`, `low` or `none`) repeats for any of several, `label` repeats for all of several |
| `POST /_p99/api/issues` | any code (`task` managers only) | `{"client_uid","kind","title","body","page","context","marks"}`; 201 issue |
| `GET /_p99/api/issues/{key}` | its reporter or a manager | a thread, `{"issue","comments","attachments","events"}`; marks it read |
| `PATCH /_p99/api/issues/{key}` | as the signed API | 200 issue |
| `POST /_p99/api/issues/{key}/comments` | its reporter or a manager (`internal` managers only) | `{"client_uid","body","internal"}`; 201 comment |
| `PUT /_p99/api/issues/{key}/attachments/{client_uid}?name=&role=&mark=&comment=` | its reporter or a manager | raw body, `Content-Length` required, `X-Content-SHA256` optional (the Worker hashes the body when it is absent); 201 attachment |
| `GET /_p99/api/files/{id}` | its reporter or a manager | the file, `Content-Disposition: attachment` |
| `GET /_p99/api/statuses`, `PUT …/statuses/{key}`, `GET /_p99/api/boards`, `POST`, `GET /_p99/api/boards/{slug}`, `PATCH`, `DELETE`, `POST /_p99/api/move` | managers | as the signed API, over this host's boards; a code that holds every listed host reaches every board, as the key does |
| `POST /_p99/api/stream-ticket` | managers | 201 `{"ticket":"<48 hex>","expires_in":60}`: a ticket for one WebSocket, used once, within 60 seconds |
| `GET /_p99/api/stream?t=<ticket>` | the ticket | a WebSocket that carries the [live events](#live-events) of the code's hosts; no `X-P99-Code`, since a browser can't set headers on a WebSocket; a used, expired or unknown ticket answers 401 |
| `GET /_p99/api/labels`, `POST /_p99/api/labels` | managers | as the signed API; the counts are this host's items |
| `POST /_p99/api/merge` | managers | as the signed API |

## The signed API

Every route under `/_p99/v1/` is signed:

| Header | Value |
| --- | --- |
| `X-P99-Key-Id` | the key id, `p99` |
| `X-P99-Actor` | base64url, no padding, of the actor JSON; absent only on `POST /_p99/v1/builds` |
| `X-Content-SHA256` | lowercase hex SHA-256 of the body (empty body: the hash of nothing) |
| `X-P99-Auth` | `v1 ts=<unix seconds>,sig=<hex>`, `sig = HMAC-SHA256(secret, "v1\n" + ts + "\n" + METHOD + "\n" + path_and_query + "\n" + X-P99-Actor + "\n" + X-Content-SHA256)`; refused when `ts` is more than 60 s away |

The secret of key id `p99` is the Worker secret `KEY_P99`, with `KEY_P99_NEXT` accepted beside it during a rotation. Key id `test` (the secret `KEY_TEST`) works only on `127.0.0.1` or `localhost`, for the Worker's own tests. There is no nonce: a captured request could be replayed within that minute, so the signed API travels over HTTPS only.

The actor is `{"email","name","agent"?}`, `agent` `true` when an agent acts as this person, left out otherwise. Items, comments and events keep it, and every view shows such an actor as the person's name with an asterisk, `Ada Lovelace*` (the panel adds the hint "AI" on the asterisk). The browser API never carries it.

**Key `p99`** is the account's own key, the one `p99 setup` makes and the CLI and TUI sign with. Its actor is always a manager, so the daily limits never apply to it. It names the host with `?host=<host>` on any route (`host=*`, or no `host`, on the list and counts reads every host), and the environment with `env` in a build's body. On the list and counts an unlisted `host` answers 404; on an item's routes `host` is a filter, so an item of another host answers 404; `POST /_p99/v1/issues` takes the query's `host` first, then the body's.

| Route | Who | Does |
| --- | --- | --- |
| `POST /_p99/v1/builds` | the key | `{"sha","branch","version","dirty","env","items":[{"id","rel","sha","subject"}]}` replaces that environment's row for that branch; an `env` that is not an environment answers 400; 204 |
| `GET /_p99/v1/counts?path=` | actor | `{"page_open","mine_open","mine_unread","all_open"}` |
| `GET /_p99/v1/stream` | actor | a WebSocket (`Upgrade: websocket`) that carries one event per change, as [Live events](#live-events) describes; with `host=<host>`, only that host's |
| `GET /_p99/v1/issues?scope=&path=&status=&kind=&q=&cursor=&limit=` | actor; `all` managers only | as the browser API; with `host=*`, every host's items |
| `POST /_p99/v1/issues` | actor | as the browser API, plus `"host"`; 201 issue |
| `GET /_p99/v1/issues/{key}`, `PATCH`, `POST …/comments`, `PUT …/attachments/{uid}`, `GET /_p99/v1/files/{id}` | as the browser API | |
| `GET /_p99/v1/labels` | managers | `{"labels":[{"name","color","items"}]}` by name, `items` the items in scope that carry it |
| `POST /_p99/v1/labels` | managers | `{"name","color"?}`; 201 label; a name taken in any case answers 409 |
| `PATCH /_p99/v1/labels/{name}` | managers, every host | `{"name"?,"color"?}`; 200 label: renames or recolours it on every item |
| `DELETE /_p99/v1/labels/{name}` | managers, every host | 200 `{"name","items"}`: removes it from the account and from every item |
| `POST /_p99/v1/merge` | actor | `{"items":[key],"into":key}`, at most 50 items; 200 `{"into","merged":[key],"unchanged":[key]}`, as [Merging duplicates](#merging-duplicates) describes |
| `GET /_p99/v1/hosts` | managers | `{"hosts":[{"host","env","config","created_at"}]}` |
| `PUT /_p99/v1/hosts/{host}` | the key | `{"env","config"}`; adds or updates a host; 200 host |
| `DELETE /_p99/v1/hosts/{host}` | the key | 204; its items stay |
| `GET /_p99/v1/envs` | managers | `{"envs":[{"name","kind","position","notify"}]}` |
| `PUT /_p99/v1/envs/{name}` | the key | `{"kind":"development"\|"release","position","notify"}`; 200 env |
| `GET /_p99/v1/codes?host=` | the key | `{"codes":[code]}`, newest first |
| `POST /_p99/v1/codes` | the key | `{"name","email","hosts":["…"],"manager","client_uid","totp"}`; 201 `{"code":code,"secret":"<12 characters>","links":["https://<host>/#p99=<secret>"]}`, plus `"totp_key":"<base32>"` when `totp` is true; the secret and the key are shown this once, and the same `client_uid` again answers 200 `{"code":code}` without them |
| `POST /_p99/v1/codes/{id}/totp` | the key | 200 `{"code":code,"totp_key":"<base32>"}`: adds an authenticator to the code, or replaces it; every browser of that code asks for a 6-digit code again |
| `POST /_p99/v1/people/rename` | the key | `{"from","to"}`; 200 `{"from","to","items","assigned","comments","events","attachments","codes"}`: moves everything filed, said, assigned or held under one e-mail to another on the whole account, in one transaction |
| `POST /_p99/v1/codes/{id}/revoke` | the key | 200 code |
| `GET /_p99/v1/hooks?host=` | managers | `{"hooks":[hook]}` |
| `PUT /_p99/v1/hooks/{host}` | the key | `{"url","service"?,"events"?}`; adds or replaces that service's hook on a listed host; 200 hook |
| `DELETE /_p99/v1/hooks/{host}?service=` | the key | removes the host's hooks, or only `slack` or `discord`; 204, or 404 when there was none |
| `POST /_p99/v1/hooks/{host}/test` | the key | posts one test message to each of the host's hooks; 200 `{"results":[{"service","hint","ok","status"}]}` |
| `GET /_p99/v1/admin/backup-status` | managers | the last and the running backup |
| `GET /_p99/v1/statuses` | actor | `{"statuses":[{"key","name","position"}]}` |
| `PUT /_p99/v1/statuses/{key}` | actor | `{"name"}`; renames a status (its key stays); 200 `{"statuses"}`; a name another status has answers 409 |
| `GET /_p99/v1/boards` | actor | `{"statuses","boards":[board]}`; with `host=<host>`, that host's boards only |
| `POST /_p99/v1/boards` | actor | `{"name","slug"?,"host"?,"parent"?,"status"?}`; 201 board, as [Boards](#boards) describes |
| `GET /_p99/v1/boards/{slug}` | actor | `{"statuses","board","cards":[card]}`, the cards in column order, then by position |
| `PATCH /_p99/v1/boards/{slug}` | actor | `{"name"}`; 200 board; the slug stays |
| `DELETE /_p99/v1/boards/{slug}` | actor | 204, only when the board holds no items and no boards, and is no host's home board (409 otherwise) |
| `POST /_p99/v1/move` | actor | `{"target":"BUG-12"\|"board:<slug>","to"?,"board"?,"before"?,"after"?,"resolution"?}`; 200 `{"moved":card,"changed":["<key>"]}`, as [Boards](#boards) describes |
| `POST /_p99/v1/import`, `PUT /_p99/v1/import/attachments/{uid}`, `POST /_p99/v1/import/finish` | the key | an import that keeps keys and numbers, as [import.md](import.md) describes |
| `GET /_p99/v1/github` | managers | `{"hosts":[{"host","repo","hook_id","webhook","token","secret","created_at","updated_at"}]}`, `token` and `secret` true when the Worker holds them |
| `PUT /_p99/v1/github/{host}` | the key | `{"repo":"owner/name","hook_id"}`; links the host to the repository; 200 as one entry of the list |
| `DELETE /_p99/v1/github/{host}` | the key | removes the link and, with the host's token, the repository's webhook; 200 `{"host","repo","hook_id","hook_removed","secrets"}` |
| `POST /_p99/v1/issues/{key}/github` | managers | opens a GitHub issue for the item (its title, a body with its key and link); 201 `{"key","existing":false,"kind","rel","repo","number","url","at"}`, or 200 with `"existing":true` when it has one |

A hook object is `{"host","service","hint","events","created_at","updated_at","last_status","last_at"}`: `service` `slack` or `discord`, `hint` the URL's last four characters, `events` from `new`, `comment`, `status` and `shipped`, `last_status` `ok`, the HTTP status, `timeout` or `error`. No route ever answers the URL.

A code object is `{"id","name","email","hosts","manager","hint","created_at","created_by","revoked_at","last_used_at"}`, `hint` the secret's last four characters.

## Live events

`GET /_p99/v1/stream` is signed like every other route, with an empty body, and upgrades to a WebSocket held by the Durable Object `P99Hub`, one per account. Every successful write sends each open socket one text message, a JSON event:

```json
{"type":"comment","key":"BUG-12","host":"shop.example.com","title":"The total does not update","by":{"name":"Ada Lovelace","agent":true},"at":"2026-10-15T09:30:00.000Z","internal":false}
```

| `type` | When | Adds |
| --- | --- | --- |
| `item` | an item is filed | |
| `comment` | a comment is added | `internal` |
| `change` | status, kind, assignee, title, body, priority or labels change | `what`, the fields that changed |
| `attachment` | a file is stored | `internal` |
| `import` | an import writes records | `items` and `comments`, the counts of new ones; `key` and `title` are null |
| `move` | an item changes column, board or place | `board` (its board's slug), `from` and `to` (status keys), `position`; a move to another board adds `from_board` |
| `board.move` | a board card changes column, parent or place | `board`, `parent`, `from`, `to`, `position`; `key` is absent; one `move` follows for each item that changed column with it, in the same message batch |
| `board` | a board is created, renamed or deleted | `action` (`created`, `renamed`, `deleted`) and `board` |
| `statuses` | a status is renamed | nothing; every socket hears it |
| `labels` | a label is made, renamed, recoloured or removed | `action` (`created`, `renamed`, `recolored`, `removed`) and `names`; `key` and `title` are null |

A board's events carry its host, `null` for an account-wide board, which only a socket for every host hears. A reader patches its board in place on `move` and `board.move` and reads it again on anything else. A status change through `PATCH` sends both `change` and `move`.

`title` is the item's title after the change and `by` the actor, `null` for a write without one. Internal comments and files are included, since only the signed API listens. A socket opened with `host=<host>` hears only that host's events; an unlisted host answers 404. The socket answers the text `ping` with `pong`, which keeps it open through idle proxies; the CLI and the TUI send one every 30 seconds and reconnect when it drops. A Worker without the `HUB` binding (one not deployed since live updates came) answers 404 `this Worker has no push yet; run p99 deploy`, and its writes skip the event. The event is sent after the response, so a write never waits on it, and a socket that is not open misses it: a client that reconnects reads the list again.

## Items

- Keys are `<PREFIX>-<id>` over one sequence per account, the prefix from the kind: `bug` BUG, `feature` FEAT, `improvement` IMP, `question` Q, `task` TASK; any prefix with the right number, or the bare number, names the same item.
- Statuses: four fixed keys, `inbox`, `doing`, `review` and `done`, in that order; the first three are open. Managers rename them per account (`PUT /statuses/{key}`, default names Inbox, Doing, Review, Done); the keys never change. A done item has a `resolution`: `fixed` (the default when a manager moves it to done), `abandoned` or `duplicate` (with `duplicate_of`); an open item's is null.
- The keys of P99 1.x are still taken wherever a status is: `new` is `inbox`, `confirmed` and `in_progress` are `doing`, `waiting` is `review`, `resolved` is done and `fixed`, `abandoned` and `duplicate` are done with that resolution. Status events written before keep their old keys in `detail`; readers map them the same way.
- Managers change `status` (with `resolution`), `kind`, `assignee`, `duplicate_of`, `title` and `body`; setting `duplicate_of` alone makes the item done and `duplicate`. The reporter changes `title` and `body` while the item is in `inbox`, sets `done` with `abandoned` on an open item, and `inbox` to reopen a `fixed` one. Every change is one event; a status event's `detail` is `{"from","to","resolution"?,"from_resolution"?}`; a `title` or `body` event keeps the old and new text as `{"from","to"}`, and neither mails anyone. A status change puts the item at the top of its new column.
- Reporters see their items' statuses in plain words: inbox "Received", doing "In progress", review "In review", and done "Fixed", "Dropped" or "Duplicate" by resolution; managers see the account's names.
- Everyone but a manager sees only what they reported, and the items theirs were merged into; internal comments and their files are for managers only.
- Managers set `priority` (`urgent`, `high`, `normal`, `low`, or null) and `labels` with `PATCH`: a list sets the item's labels to exactly those, `{"add":[…],"remove":[…]}` changes some. A label name is 1 to 32 letters, digits, spaces or `. _ : + -`, matched without case; adding a name the account doesn't have makes it, with a colour picked from the name. Labels are the account's, shared by every host: 200 per account, 20 per item. Their events are internal, and anyone but a manager reads `priority` as null and `labels` as `[]`.
- Attachments: 20 MB (20 MiB) each, 30 per item; roles `screenshot`, `page`, `region` (with `mark`), `file`; the type is the body's `Content-Type`, checked against the file's first bytes: PNG, JPEG or WebP for the images; for a `file` also GIF, PDF, `text/plain`, `text/csv`, `text/x-log`, JSON, zip, and Word, Excel, PowerPoint and OpenDocument files (`p99 file --attach` and `p99 comment --attach` pick it from the file's extension). A name ending in an executable or web page extension (`.html`, `.svg`, `.xml`, `.js`, `.exe`, `.bat`, `.sh` and the like) is refused, whatever the type.
- Limits per person and day: 30 items, 200 comments, 100 MB of files. Managers have none.
- Search (`q`) matches the title and body with accents and case folded on both sides (`cafe` finds `Café`): the Worker keeps `search_text`, the NFD form of title and body without combining marks, lowercased, and folds `q` the same way. A `q` that is a key also finds that item.

A summary is `{"id","key","kind","status","resolution","board","position","title","host","env","page":{"url","path","title"},"reporter":{"email","name","agent"},"assignee","created_at","updated_at","comments","attachments","unread","landing","priority","labels":[{"name","color"}]}`; an issue adds `"body","duplicate_of","closed_at","context","marks","commits":[{"sha","subject","rel","envs"}],"github":[{"kind","rel","repo","number","url","at"}]` (`github` empty for anyone but a manager), and a thread's issue `"merged":[{"key","title","host","reporter"}]`, the items merged into it (for anyone but a manager, only their own); a comment is `{"id","client_uid","author":{"email","name","manager","agent"},"body","internal","created_at","attachments":[id]}`; an attachment `{"id","client_uid","role","mark","name","type","bytes","sha256","comment_id","created_at"}`; an event `{"actor","actor_name","agent","kind","detail","at"}`, `actor_name` the person's name as the thread, or else the newest code for that e-mail, knows it (null for P99 itself), `agent` true when an agent acting as that person made it; `agent` is always a boolean. `board` (the slug of the item's board) and `position` show to managers only; `assignee`, the reporter's `email`, event actors' e-mails (and the `from` and `to` of an assignee event) and a comment author's `email` show to managers only: for anyone else they are null, unless they are that person's own.

## Boards

Every item sits on one board, and its column there is its status. Every host has a home board, its slug the host with dots as dashes (`pitomd-com`) and its name the host; a host's new items land on it, at the top of `inbox`. A board belongs to one host, or to none (`host` null), when it spans every host and only the key, or a code that holds every listed host, reaches it; an item sits only on a board of its own host or on an account-wide one.

A board may sit as a card in another board's column, beside items: its `parent` is that board, its `status` that column. A board inside a host's board belongs to that host. A board is `{"slug","name","host","parent","status","position","home","rollup":{"done","total"}}`, the rollup counting the items of its whole subtree. A card is `{"type":"item","key","kind","title","status","resolution","position","assignee","reporter":{"name","agent"},"priority","labels"}` or `{"type":"board","slug","name","status","position","rollup"}`. `POST /boards` makes the slug from the name when none is given (`Site v2` is `site-v2`, then `site-v2-2`), and takes `status` as a key or a name.

`POST /move` moves a card, named by its key or `board:<slug>`, and needs at least one of `to` (a status's key or its name, any case), `board` (the board it moves to; for a board card, its new parent, or null for the top), `before` or `after` (a card in the same board and column, to sit next to). Without `before` or `after`, a card that changes column or board goes to the top. Order inside a column is `position`, ascending and fractional: a card placed between two takes their midpoint, and the column is renumbered 1024 apart when a gap falls under 1e-9. An item moved to done without `resolution` is `fixed`; one moved out of done loses its resolution and `duplicate_of`. A board card moved to another column takes every board and item in its subtree to that column too, keeping their order; moved to done, their open items become `fixed`. A board can't move into itself or a board inside it. `changed` lists every item whose column or board changed; the reporter of each is mailed the change when mail is on.

`0004_boards.sql` brought the statuses and boards in: every existing item went to its host's home board in the column its old status maps to, the newest at the top.

## Merging duplicates

`p99 merge BUG-14 BUG-15 --into BUG-12` folds reports of the same thing into one item. Each merged item gets `duplicate_of` the target and moves to `done` with resolution `duplicate` (a status event and a live `move`), with a `merge` event on it (`{"into"}`) and on the target (`{"item"}`), and its reporter is mailed the status change. Items already merged into a merged item move to the target too, so a merge stays one level deep; a target that is itself merged answers 409 and names the one to use. A manager scoped to one host (`?host=`) merges that host's items only: an item on another host answers 404. Without `host`, items of several hosts merge.

Every reporter of a merged item follows the target: it shows in their "mine" list and counts, they read its thread and comment on it as any reporter does, and they are mailed its replies, status changes and landings. A follower sees the target's title, status, public comments with their files, events and landings; never its internal notes, its reporter's e-mail, text, page context, marks or capture files. Only the target's own reporter changes or drops it. `p99 show` and the TUI's thread list the items merged into an item, and the panel shows "merged into BUG-12" on each merged one.

## Environments and landings

An environment is a name with a kind. A `development` environment counts the build of branch `main`; a `release` environment counts its latest announced build, whatever the branch. `p99 announce` (or a host's own build) posts a build with the items its commits name in `Fixes:` and `Refs:` trailers; an item lands in an environment when a counted build there carries a `Fixes:` commit for it, or when an import records a landing there, and the first landing is an event. An environment with `notify` mails the reporter at an item's first landing there, when mail is set up.

`landing` is `{"branch":bool,"envs":[{"env","kind","at","sha","version"}]}` in `position` order, `branch` true when a fix sits only on a branch no counted build carries.

## The fixed feed

Off by default. `p99 feed on <host>` sets the host's `feed` and `https://<host>/_p99/feed` then serves an Atom feed (`?format=json`: a JSON Feed 1.1) of the host's items whose fix reached a `release` environment, newest first, at most 50: each entry carries the key, the kind, the title and the date of the first landing, and nothing else (no reporter, text, page, comments or commits). Anyone may read it, the response is cached at the edge for five minutes, and a host without `feed` answers 404. `p99 feed off <host>` turns it off; `p99 feed` lists each host's feed.

## Mail

Off until `p99 email set` turns it on for the account: the sender and the provider live in the database's `mail` table, and the provider's key in the Worker's secret `RESEND_API_KEY`. A Worker set up before that, with a `MAIL_FROM` binding and no `mail` row, keeps mailing from that binding until `p99 email set`, `p99 email off` or the next `p99 deploy` writes the row. Resend is the one provider; the Worker sends through one interface, a batch of `{to, subject, text, html}`.

New items and comments by non-managers go to every manager. The reporter, and every reporter of an item merged into it, is mailed about a manager's non-internal reply, a status change, and the first landing of a fix in a `notify` environment ("fixed and shipped"); a merge reads as "merged into BUG-12". A status reads as the reporter sees it: Received, In progress, In review, Fixed, Dropped or Duplicate. A manager's own new item mails nobody, and no one is mailed about their own action. Every mail has a plain-text part and a light HTML part in the host's theme colours (`accent`, `on-accent`, `ink`, `muted`, `rule`), so subjects and bodies keep their accents; an agent acting as a person reads as `Ada Lovelace*`. Sending never fails a request; each send, or skip, is an internal `mail` event with its outcome.

A manager's link is `https://<item's host><page path>#p99=<key>`, which opens the panel on that item. A reporter's link is `https://<item's host>/_p99/open?to=<page path>&item=<key>#<their code>`: a small page on the host stores the code where the loader looks for it, the way an invite link does, and moves on to the page with the item open in the panel. The code rides in the fragment, which the browser never sends. The Worker keeps an AES-GCM sealed copy of each code for this (its key derived from `CODE_PEPPER`), written when the code is minted, or for an older code the first time it is used; until then that person's link has no code. No API answer carries the sealed copy.

Every mail to a reporter ends with a link to stop mail about that item, `https://<item's host>/_p99/mail?t=<token>`, and carries it as `List-Unsubscribe` with one-click `List-Unsubscribe-Post`. The token is signed for that item and that e-mail (HMAC-SHA256 under a key derived from `CODE_PEPPER`), so it works for nothing else and needs no code. Opening it stops the mail and offers Undo; the person still gets mail about their other items.

## Chat hooks

Each host may hold one Slack and one Discord incoming webhook (the `hooks` table). A `url` is taken only when it is `https://hooks.slack.com/services/<a>/<b>/<c>` or `https://discord.com/api[/v<n>]/webhooks/<id>/<token>` (or `discordapp.com`), with no port, user, query or fragment; anything else answers 400, so a hook can reach no other address. The URL is stored sealed with AES-GCM under a key derived by HKDF from `CODE_PEPPER`, as the authenticator secrets are. `events` defaults to all four on a new hook and is kept when a later `PUT` leaves it out.

After the response, in `waitUntil`, the Worker turns the request's live events into posts: `item` is `new`; a `comment` that is not internal is `comment`; a `move` to another column is `status` (once per item, whether it came from `POST /move` or a status change); a first landing in a `release` environment is `shipped`. Each hook gets one message per request listing up to ten items, Slack as `{"text","blocks"}` and Discord as `{"content","embeds","allowed_mentions":{"parse":[]}}` with the host's `theme.accent` as the embed colour. Each item shows its key, kind, title, status name, the actor (an agent as `Name*`) and its page link (`https://<host><path>#p99=<key>`); never an e-mail address, a comment body or an attachment. A post has 5 seconds, follows no redirect, and its outcome is kept as `last_status`; a failure is logged and never fails the request.

## GitHub

`POST /_p99/v1/github` is GitHub's webhook, not signed with the account key: the host is the URL's, and the body must verify against `X-Hub-Signature-256` (HMAC-SHA256 with the host's webhook secret) or the answer is 401. A delivery id (`X-GitHub-Delivery`) is acted on once. From the host's linked repository, a `pull_request` opened, edited or reopened records the items its title and description name in `Fixes:` and `Refs:` trailers; one closed as merged also reads its commits, records them, and moves every open item named in `Fixes:` to done with the resolution fixed, with the status event, the live event and the reporter's mail. An `issues` closed (not as not planned) does the same for the item `POST /_p99/v1/issues/{key}/github` opened it for. Only items of that host are read or changed. The answer is 200 `{"linked":[key],"changed":[key]}` when something was recorded or changed, and 204 for everything else.

The host's secrets are Worker secrets named after the first 16 hex digits of the SHA-256 of the host name, uppercased: `GITHUB_TOKEN_<tag>` (the fine-grained token) and `GITHUB_HOOK_<tag>` (the webhook secret). `p99 github set` writes both. Links are kept in `github_links` and shown on an issue as `github` to managers; `github_deliveries` keeps delivery ids for 30 days.

## Backups

The cron trigger (`*/15 * * * *`) runs a weekly backup of every table into the bucket under `backups/<date>/`, in steps small enough for one invocation, keeping eight.

## Schema

`worker/migrations/` holds the schema: `0001_p99.sql`, then each change in its own numbered file. Migrations are recorded in `d1_migrations` (`id`, `name`, `applied_at`), the table wrangler keeps, so a database migrated by either stays in step.

## Host config

`PUT /_p99/v1/hosts/{host}`'s `config` is `{"theme":{…},"strings":{…},"corner","offset":{"x","y"},"above","off":[…],"feed"}`, as docs/hosts.md describes. The Worker writes the host's `corner`, `offset`, `above`, `off` and `theme.accent` into the loader it serves for that host (replacing `__P99_HOST__` with that JSON), so the button draws in place before any request; `/_p99/api/me` answers the whole config.

## Test vector

Secret `test-secret`, ts `1760400000`, `POST /_p99/v1/issues?host=example.com`.

- Actor JSON: `{"email":"ada@example.com","name":"Ada Lovelace"}`
- `X-P99-Actor`: `eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UifQ`
- Body: `{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}`
- `X-Content-SHA256`: `ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf`
- `X-P99-Auth`: `v1 ts=1760400000,sig=89b1d507574a2e8bb9c58d3ba92a29eab0f03baad0e422c4882f17c8ba33505a`

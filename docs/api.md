# The P99 Worker

One Worker, one D1 database (binding `DB`), one R2 bucket (binding `BUCKET`) and one SQLite-backed Durable Object, `P99Hub` (binding `HUB`), per Cloudflare account. The Worker is mounted on every host it serves as the route `<host>/_p99/*`, so a page talks only to its own origin. It may also sit on a custom domain of its own.

The host of a request is the URL's hostname. A host must be listed in the `hosts` table to be served; an unknown host answers 404 on everything but `/_p99/health`. The signed API is the exception: it names the host itself (below), so it answers on any address the Worker is mounted on.

## Paths

| Path | What |
| --- | --- |
| `GET /_p99/health` | `{"ok":true,"version"}`, unsigned |
| `GET /_p99/p99.js` | the loader |
| `GET /_p99/panel.js`, `/_p99/board.js`, `/_p99/avatar.js`, `/_p99/p99.css`, `/_p99/capture.js`, `/_p99/art/concrete.svg`, `/_p99/art/concrete-dark.svg` | the lazy parts |
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
| `GET /_p99/api/me?path=` | any code | `{"name","email","username","manager","host","env","version","counts":{"page_open","mine_open","mine_unread","all_open"},"theme":{},"strings":{}}`; `all_open` is null for non-managers; `theme` and `strings` are the host's config |
| `POST /_p99/api/verify` | a code with an authenticator | `{"totp":"<6 digits>"}`; 201 `{"device":"<32 hex>"}`; the panel stores `<code>.<device>` where the loader keeps the code |
| `GET /_p99/api/issues?scope=mine\|all\|page&path=&status=open\|closed\|any&kind=&q=&cursor=&limit=&label=` | any code; `all` and `label` managers only | `{"issues":[summary],"next_cursor"}`, newest first, this host's items only, `limit` at most 100 (default 50); `label` keeps the items whose label it names, and a 1.8 status key (`inbox`, `doing`, `review`, `done`) the items of that default label; `priority` and `board` answer 400 |
| `POST /_p99/api/issues` | any code (`task` managers only) | `{"client_uid","kind","title","body","page","context","marks"}`; 201 issue |
| `GET /_p99/api/issues/{key}` | its reporter or a manager | a thread, `{"issue","comments","attachments","events"}`; marks it read |
| `PATCH /_p99/api/issues/{key}` | as the signed API | 200 issue |
| `DELETE /_p99/api/issues/{key}` | managers | as the signed API; a reporter gets 403 |
| `POST /_p99/api/issues/{key}/comments` | its reporter or a manager (`internal` managers only) | `{"client_uid","body","internal"}`; 201 comment |
| `PUT /_p99/api/issues/{key}/attachments/{client_uid}?name=&role=&mark=&comment=` | its reporter or a manager | raw body, `Content-Length` required, `X-Content-SHA256` optional (the Worker hashes the body when it is absent); 201 attachment |
| `GET /_p99/api/files/{id}` | its reporter or a manager | the file, `Content-Disposition: attachment` |
| `GET /_p99/api/labels`, `PATCH …/labels/{id}`, `GET /_p99/api/boards`, `POST`, `GET /_p99/api/boards/{id}`, `PUT`, `DELETE`, `POST /_p99/api/move` | managers | as the signed API, over this host's boards; a code that holds every listed host reaches every board, as the key does |
| `POST /_p99/api/stream-ticket` | managers | 201 `{"ticket":"<48 hex>","expires_in":60}`: a ticket for one WebSocket, used once, within 60 seconds |
| `GET /_p99/api/stream?t=<ticket>` | the ticket | a WebSocket that carries the [live events](#live-events) of the code's hosts; no `X-P99-Code`, since a browser can't set headers on a WebSocket; a used, expired or unknown ticket answers 401 |
| `POST /_p99/api/merge` | managers | as the signed API |
| `GET /_p99/api/people` | managers | `{"people":[{"username","manager"}]}`: the people with a live code for this host and the e-mails in `MANAGERS`, by username; never an e-mail, a code, a hint or a host list |
| `PATCH /_p99/api/me` | any code | `{"username"}`, nothing else; 200 `{"username"}`, 409 when it is taken or too close to someone's: changes the code's own person only ([usernames](#usernames)) |

### Usernames

Every person (an e-mail with a code, an e-mail in `MANAGERS`, an assignee) has a username, unique on the account: 3 to 30 of `a-z 0-9 . _ -`, starting and ending with a letter or digit, stored lowercase. P99 makes the first one from the person's name (`Zoë Ångström` is `zoe.angstrom`, then `zoe.angstrom2`), and the person changes it with `PATCH /me`. `admin`, `p99`, `root`, `support`, `manager`, `system`, `null`, `me`, `everyone`, `here` and `channel` are reserved, and a username is refused when, with dots, dashes and underscores taken out and look-alikes folded (`0` and `o`; `1`, `i` and `l`; `3` and `e`; `4` and `a`; `5` and `s`; `7` and `t`; `8` and `b`; `rn` and `m`; `vv` and `w`), it matches someone else's or a reserved word. An item keeps its assignee by e-mail, so a new username shows everywhere at once; every answer shows the assignee as `{"username"}`, never the e-mail. An agent acts as its person, so it has the person's username. The panel and the board draw each person's disc from the username with `/_p99/avatar.js`.

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
| `GET /_p99/v1/labels` | managers | `{"labels":[{"id","name","closes","boards":[{"id","name","owner_username"}]}]}`: the labels used by an item or a board column, the four defaults first; `boards` are the boards in scope that use it as a column |
| `PATCH /_p99/v1/labels/{id}` | managers | `{"name"}`; 200 `{"id","name","closes"}`: the name changes on every board and item at once; a name taken in any case answers 409; a manager scoped to one host renames, or flips `closes` on, only a label no other host's board or item uses (403 otherwise) |
| `POST /_p99/v1/merge` | actor | `{"items":[key],"into":key}`, at most 50 items; 200 `{"into","merged":[key],"unchanged":[key]}`, as [Merging duplicates](#merging-duplicates) describes |
| `DELETE /_p99/v1/issues/{key}` | actor | deletes the item for good; 200 `{"key","comments","files","retrying","unlinked":[key]}`, as [Deleting an item](#deleting-an-item) describes |
| `GET /_p99/v1/hosts` | managers | `{"hosts":[{"host","env","config","created_at"}]}` |
| `PUT /_p99/v1/hosts/{host}` | the key | `{"env","config"}`; adds or updates a host; 200 host |
| `DELETE /_p99/v1/hosts/{host}` | the key | 204; its items stay |
| `GET /_p99/v1/envs` | managers | `{"envs":[{"name","kind","position","notify"}]}` |
| `PUT /_p99/v1/envs/{name}` | the key | `{"kind":"development"\|"release","position","notify"}`; 200 env |
| `GET /_p99/v1/codes?host=` | the key | `{"codes":[code]}`, newest first |
| `POST /_p99/v1/codes` | the key | `{"name","email","hosts":["…"],"manager","client_uid","totp","mail"}`; 201 `{"code":code,"secret":"<12 characters>","links":["https://<host>/#p99=<secret>"]}`, plus `"totp_key":"<base32>"` when `totp` is true; the secret and the key are shown this once, and the same `client_uid` again answers 200 `{"code":code}` without them. With `"mail":true` the Worker mails the person their links (one button per host, the authenticator key never in it, reply-to the signed actor) and answers `"mail":"sent"`, `"off"` (no mail set), `"failed"` or `"skipped"` (an `.invalid` address) |
| `POST /_p99/v1/codes/{id}/relink` | the key | `{"client_uid","new_totp","mail"}`, each optional; 201 the same answer as a new code, plus `"revoked":code` (the old one) and `"totp":"carried"` or `"new"` when the code has an authenticator: mints a code for the same person, hosts and role and revokes the old one in one batch, so the old code answers 401 from then on. The authenticator's sealed secret is copied to the new code with its last used step, unless `new_totp`; the old code's device tokens are dropped. 404 for an unknown or revoked code |
| `POST /_p99/v1/codes/{id}/totp` | the key | 200 `{"code":code,"totp_key":"<base32>"}`: adds an authenticator to the code, or replaces it; every browser of that code asks for a 6-digit code again |
| `GET /_p99/v1/people?host=` | the key | as the browser's `GET /people`, for one host or, with no host, every live code |
| `POST /_p99/v1/people/rename` | the key | `{"from","to"}`; 200 `{"from","to","items","assigned","comments","events","attachments","codes"}`: moves everything filed, said, assigned or held under one e-mail to another on the whole account, in one transaction |
| `POST /_p99/v1/codes/{id}/revoke` | the key | 200 code |
| `GET /_p99/v1/hooks?host=` | managers | `{"hooks":[hook]}` |
| `PUT /_p99/v1/hooks/{host}` | the key | `{"url","service"?,"events"?}`; adds or replaces that service's hook on a listed host; 200 hook |
| `DELETE /_p99/v1/hooks/{host}?service=` | the key | removes the host's hooks, or only `slack` or `discord`; 204, or 404 when there was none |
| `POST /_p99/v1/hooks/{host}/test` | the key | posts one test message to each of the host's hooks; 200 `{"results":[{"service","hint","ok","status"}]}` |
| `GET /_p99/v1/admin/backup-status` | managers | the last and the running backup |
| `GET /_p99/v1/boards` | managers | `{"boards":[board]}`: the caller's boards first, then the boards of others in scope; the first call in a scope makes the caller's board (Inbox, Doing, Review, Done), and takes over any board left without an owner |
| `POST /_p99/v1/boards` | managers | `{"name","columns":[{"label","closes"?}]}` (a column may be a plain label name); 201 board; 3 to 5 columns, 3 boards per person in a scope (409 past that) |
| `GET /_p99/v1/boards/{id}` | managers | `{"board","cards":[card]}`, the cards in column order, then by `order`; another host's board is 404 |
| `PUT /_p99/v1/boards/{id}` | its owner | `{"name"?,"columns"?}`; 200 board; anyone else 403 |
| `DELETE /_p99/v1/boards/{id}` | its owner | 204; never the owner's last board in that scope (409) |
| `POST /_p99/v1/move` | managers | `{"key","from","to","board"?,"before"?,"after"?,"resolution"?}`; 200 `{"card"}`, as [Boards](#boards) describes |
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
| `change` | kind, assignee, title or body change | `what`, the fields that changed |
| `attachment` | a file is stored | `internal` |
| `import` | an import writes records | `items` and `comments`, the counts of new ones; `key` and `title` are null |
| `label` | an item's label changes | `from` and `to` (label names); `done` (`closed` or `reopened`) and `resolution` when its done-ness changed |
| `order` | a card is placed on a board | `board` (its id), `order` (its key there); `rebalanced` when the column's keys were written afresh, which a reader takes as a reload |
| `board` | a board is created, changed or deleted | `action` (`created`, `changed`, `deleted`) and `board` (its id) |
| `labels` | a label is renamed | `action` (`renamed`) and `names`, the old and the new; every socket hears it |
| `delete` | an item is deleted | `label`, the label it had; a `label` event back to the first label follows for each closed item that was merged into it |

A board's events carry its host, `null` for an account-wide board, which only a socket for every host hears. A reader patches its board in place on `label`, `order` and `delete` and reads it again on anything else.

`title` is the item's title after the change and `by` the actor, `null` for a write without one. Internal comments and files are included, since only the signed API listens. A socket opened with `host=<host>` hears only that host's events; an unlisted host answers 404. The socket answers the text `ping` with `pong`, which keeps it open through idle proxies; the CLI and the TUI send one every 30 seconds and reconnect when it drops. A Worker without the `HUB` binding (one not deployed since live updates came) answers 404 `this Worker has no push yet; run p99 deploy`, and its writes skip the event. The event is sent after the response, so a write never waits on it, and a socket that is not open misses it: a client that reconnects reads the list again.

## Items

- Keys are `<PREFIX>-<id>` over one sequence per account, the prefix from the kind: `bug` BUG, `feature` FEAT, `improvement` IMP, `question` Q, `task` TASK; any prefix with the right number, or the bare number, names the same item.
- Labels: an item carries exactly one label, its state, and a board's columns are labels. Inbox, Doing, Review and Done are the defaults (renameable like any label); a new item gets the first, Inbox. A label marked `closes` (Done is) closes the item that carries it: it then has a `resolution`, `fixed` (the default), `abandoned` or `duplicate` (with `duplicate_of`); an open item's is null.
- The status keys of P99 1.x and 1.8 still import, and still filter a list (`status=doing` keeps the open items labelled Doing): `new` and `inbox` are Inbox, `confirmed`, `in_progress` and `doing` are Doing, `waiting` and `review` are Review, `resolved`, `abandoned` and `duplicate` are Done with that resolution. Status events written before keep their old keys in `detail`.
- Managers change `kind`, `assignee`, `duplicate_of`, `resolution`, `title` and `body` with `PATCH`, and the label with `POST /move`; `labels` and `priority` answer 400. A 1.8 `status` still works: `done` (with `resolution`) closes the item, `inbox`, `doing` or `review` gives it that default label, reopening it when closed. `resolution` closes an item (it takes the closing label of a board of the actor or the assignee that shows it, else Done) and null reopens it (it goes back to Inbox); setting `duplicate_of` alone closes it as `duplicate`. `assignee` is a username (a leading `@` is fine), `me` for the actor, or null, and the person must hold a live code for the item's host or be in `MANAGERS`; an assignee event's `from` and `to` are `{"username"}`. The reporter changes `title` and `body` while the item has its first label, sets `abandoned` on an open item, and null to reopen a `fixed` one. A label change is an internal `label` event `{"from","to"}`; a change of what the reporter sees is a `status` event `{"from","to","resolution"?}` in their words; a `title` or `body` event keeps the old and new text as `{"from","to"}`, and neither mails anyone.
- `stage` is what a reporter sees: `received` while the item has the first label, `in_progress` under any other open label, then `fixed`, `dropped` or `duplicate` once closed; the panel words them Received, In progress, Fixed, Dropped and Duplicate. `label` is the label's name for managers and null for anyone else.
- Everyone but a manager sees only what they reported, and the items theirs were merged into; internal comments and their files are for managers only.
- Attachments: 20 MB (20 MiB) each, 30 per item; roles `screenshot`, `page`, `region` (with `mark`), `file`; the type is the body's `Content-Type`, checked against the file's first bytes: PNG, JPEG or WebP for the images; for a `file` also GIF, PDF, `text/plain`, `text/csv`, `text/x-log`, JSON, zip, and Word, Excel, PowerPoint and OpenDocument files (`p99 file --attach` and `p99 comment --attach` pick it from the file's extension). A name ending in an executable or web page extension (`.html`, `.svg`, `.xml`, `.js`, `.exe`, `.bat`, `.sh` and the like) is refused, whatever the type.
- Limits per person and day: 30 items, 200 comments, 100 MB of files. Managers have none.
- Search (`q`) matches the title and body with accents and case folded on both sides (`cafe` finds `Café`): the Worker keeps `search_text`, the NFD form of title and body without combining marks, lowercased, and folds `q` the same way. A `q` that is a key also finds that item.

A summary is `{"id","key","kind","stage","label","resolution","title","host","env","page":{"url","path","title"},"reporter":{"email","name","agent"},"assignee":{"username"},"created_at","updated_at","comments","attachments","unread","landing"}`; an issue adds `"body","duplicate_of","closed_at","context","marks","commits":[{"sha","subject","rel","envs"}],"github":[{"kind","rel","repo","number","url","at"}]` (`github` empty for anyone but a manager), and a thread's issue `"merged":[{"key","title","host","reporter"}]`, the items merged into it (for anyone but a manager, only their own); a comment is `{"id","client_uid","author":{"email","name","manager","agent"},"body","internal","created_at","attachments":[id]}`; an attachment `{"id","client_uid","role","mark","name","type","bytes","sha256","comment_id","created_at"}`; an event `{"actor","actor_name","agent","kind","detail","at"}`, `actor_name` the person's name as the thread, or else the newest code for that e-mail, knows it (null for P99 itself), `agent` true when an agent acting as that person made it; `agent` is always a boolean. `assignee`, the reporter's `email`, event actors' e-mails (and the `from` and `to` of an assignee event) and a comment author's `email` show to managers only: for anyone else they are null, unless they are that person's own.

## Boards

A board belongs to one manager: a name, 3 to 5 columns, each a label, and its own order of the cards in each column, which is that owner's priority. It shows the items whose label is one of its columns, so each item shows at most once; the item moves to a column by taking that column's label. A dev's "QA ready" column can be the first column of a QA person's board: the shared label is the handoff, with no workflow to set up. A board belongs to a host, or to none (`host` null) when it was made with every host in scope; it shows that host's items, or every host's, and only someone who reaches that host sees it: another host's board is 404. Every manager who reaches it can watch any board read-only, seeing exactly the owner's cards in the owner's order; only the owner moves its cards or changes it (403). Reporters and codes without the manager role get no boards.

A board is `{"id","name","owner":{"username"},"mine","columns":[{"label","closes"}]}`. A card is `{"key","kind","title","label","assignee":{"username"}|null,"order"}`: `order` is the card's fractional key on that board, a short base-62 string that sorts as text, or null for a card the owner hasn't placed yet, which sits at the top of its column, newest first. `GET /boards/{id}` is one D1 query.

`POST /move` takes the item's key, `from` (the label the mover saw) and `to` (a label on one of the mover's own boards). The label changes to `to`; when the item's label isn't `from` any more the answer is 409 `{"error":"moved","message":"this card moved; refreshed"}` and nothing changes, so the board reloads. With `board` (one of the mover's boards that has `to` as a column), the card is also placed there: at the top, or `before` or `after` a neighbour's key in that column. Placing writes one key for the moved card, between its neighbours' keys; the column's keys are written afresh only when a key would pass 50 characters, or to place a card above cards that have no key yet. A label that closes closes the item (`resolution` picks `abandoned` or `duplicate` over `fixed`); a label that doesn't reopens a closed one, which loses its resolution and `duplicate_of`. The move is one write and one broadcast: a `label` event, and an `order` event when it was placed.

A label's `closes` flag is set with a board's columns (`{"label","closes":true}`); the items that carry it close or reopen at once, as `fixed` or open, without mail. A manager scoped to one host changes the flag, or renames, only a label no other host's board uses.

`0011_lanes.sql` brought this in, once: each status became a label (its renamed name kept, an existing label of that name reused), each item's label its status's, every board, nested ones flattened, a board with the four default columns owned by the account's oldest live manager code (or, without one, the first manager to open the boards), and each column's order the old priority (urgent, high, normal, low, then none), then the old place. Statuses, nesting, `priority` and the priority events are gone; the old labels' rows on items stay, unused.

**Changed in 1.9.0:** a summary, an issue and a card no longer carry `status`, `board`, `position`, `priority` or `labels`; they carry `stage` and `label`. `/statuses`, `POST /labels`, `DELETE /labels/{name}` and board slugs are gone; boards are named by id.

## Merging duplicates

`p99 merge BUG-14 BUG-15 --into BUG-12` folds reports of the same thing into one item. Each merged item gets `duplicate_of` the target and closes with resolution `duplicate` (a status event and a live `label`), with a `merge` event on it (`{"into"}`) and on the target (`{"item"}`), and its reporter is mailed the status change. Items already merged into a merged item move to the target too, so a merge stays one level deep; a target that is itself merged answers 409 and names the one to use. A manager scoped to one host (`?host=`) merges that host's items only: an item on another host answers 404. Without `host`, items of several hosts merge.

Every reporter of a merged item follows the target: it shows in their "mine" list and counts, they read its thread and comment on it as any reporter does, and they are mailed its replies, status changes and landings. A follower sees the target's title, status, public comments with their files, events and landings; never its internal notes, its reporter's e-mail, text, page context, marks or capture files. Only the target's own reporter changes or drops it. `p99 show` and the TUI's thread list the items merged into an item, and the panel shows "merged into BUG-12" on each merged one.

## Deleting an item

`p99 delete BUG-12` (or `DELETE /issues/{key}` on either API, managers only) removes an item for good: the item, its comments and internal notes, its events, read marks, labels, its place on its board, its GitHub links (GitHub's own issue and pull requests stay as they are), mail opt-outs, landings, and every file in the bucket, screenshots, page captures, marked areas and attachments, on the item and on its comments. There is no undo and no trace in the account but the Worker's log line, `deleted BUG-12 by Ada Lovelace*`.

The rows go in one D1 batch, which is one transaction: a failure part-way leaves the item whole. The same batch records every file's bucket key in `deletions`; the files are then removed from R2, up to 1,000 keys a call, and each key is struck off once its object is gone. A key whose removal fails stays in `deletions`, and the cron trigger retries it every 15 minutes until it goes, so no file is left behind; a file still uploading when the item went is removed once more 15 minutes later. `retrying` counts the files still waiting.

Items merged into the deleted one lose their `duplicate_of`; a closed duplicate goes back to Inbox, open (a status event on it, and a live `label`), so its report is triaged again. Keys are never handed out again: an item's number comes from SQLite's `AUTOINCREMENT`, which never reuses one. Chat hooks and GitHub get nothing, and no one is mailed. The fixed feed reads the current rows, so a deleted item drops out of it. The weekly backups in the bucket keep the item until they age out, eight weeks later.

## Environments and landings

An environment is a name with a kind. A `development` environment counts the build of branch `main`; a `release` environment counts its latest announced build, whatever the branch. `p99 announce` (or a host's own build) posts a build with the items its commits name in `Fixes:` and `Refs:` trailers; an item lands in an environment when a counted build there carries a `Fixes:` commit for it, or when an import records a landing there, and the first landing is an event. An environment with `notify` mails the reporter at an item's first landing there, when mail is set up.

`landing` is `{"branch":bool,"envs":[{"env","kind","at","sha","version"}]}` in `position` order, `branch` true when a fix sits only on a branch no counted build carries.

## The fixed feed

Off by default. `p99 feed on <host>` sets the host's `feed` and `https://<host>/_p99/feed` then serves an Atom feed (`?format=json`: a JSON Feed 1.1) of the host's items whose fix reached a `release` environment, newest first, at most 50: each entry carries the key, the kind, the title and the date of the first landing, and nothing else (no reporter, text, page, comments or commits). Anyone may read it, the response is cached at the edge for five minutes, and a host without `feed` answers 404. `p99 feed off <host>` turns it off; `p99 feed` lists each host's feed.

## Mail

Off until `p99 email set` turns it on for the account: the sender and the provider live in the database's `mail` table, and the provider's key in the Worker's secret `RESEND_API_KEY`. A Worker set up before that, with a `MAIL_FROM` binding and no `mail` row, keeps mailing from that binding until `p99 email set`, `p99 email off` or the next `p99 deploy` writes the row. Resend is the one provider; the Worker sends through one interface, a batch of `{to, subject, text, html}`.

New items and comments by non-managers go to every manager. The reporter, and every reporter of an item merged into it, is mailed about a manager's non-internal reply, the item closing or reopening, and the first landing of a fix in a `notify` environment ("fixed and shipped"); a merge reads as "merged into BUG-12". A change reads as the reporter sees it: Received, Fixed, Dropped or Duplicate. Other label changes mail no one. A manager's own new item mails nobody, and no one is mailed about their own action. Every mail has a plain-text part and a light HTML part in the host's theme colours (`accent`, `on-accent`, `ink`, `muted`, `rule`), so subjects and bodies keep their accents; an agent acting as a person reads as `Ada Lovelace*`. Sending never fails a request; each send, or skip, is an internal `mail` event with its outcome.

A manager's link is `https://<item's host><page path>#p99=<key>`, which opens the panel on that item. A reporter's link is `https://<item's host>/_p99/open?to=<page path>&item=<key>#<their code>`: a small page on the host stores the code where the loader looks for it, the way an invite link does, and moves on to the page with the item open in the panel. The code rides in the fragment, which the browser never sends. The Worker keeps an AES-GCM sealed copy of each code for this (its key derived from `CODE_PEPPER`), written when the code is minted, or for an older code the first time it is used; until then that person's link has no code. No API answer carries the sealed copy.

Every mail to a reporter ends with a link to stop mail about that item, `https://<item's host>/_p99/mail?t=<token>`, and carries it as `List-Unsubscribe` with one-click `List-Unsubscribe-Post`. The token is signed for that item and that e-mail (HMAC-SHA256 under a key derived from `CODE_PEPPER`), so it works for nothing else and needs no code. Opening it stops the mail and offers Undo; the person still gets mail about their other items.

## Chat hooks

Each host may hold one Slack and one Discord incoming webhook (the `hooks` table). A `url` is taken only when it is `https://hooks.slack.com/services/<a>/<b>/<c>` or `https://discord.com/api[/v<n>]/webhooks/<id>/<token>` (or `discordapp.com`), with no port, user, query or fragment; anything else answers 400, so a hook can reach no other address. The URL is stored sealed with AES-GCM under a key derived by HKDF from `CODE_PEPPER`, as the authenticator secrets are. `events` defaults to all four on a new hook and is kept when a later `PUT` leaves it out.

After the response, in `waitUntil`, the Worker turns the request's live events into posts: `item` is `new`; a `comment` that is not internal is `comment`; a `label` change that closes or reopens the item is `status` (other label changes post nothing); a first landing in a `release` environment is `shipped`. Each hook gets one message per request listing up to ten items, Slack as `{"text","blocks"}` and Discord as `{"content","embeds","allowed_mentions":{"parse":[]}}` with the host's `theme.accent` as the embed colour. Each item shows its key, kind, title, label, the actor (an agent as `Name*`) and its page link (`https://<host><path>#p99=<key>`); never an e-mail address, a comment body or an attachment. A post has 5 seconds, follows no redirect, and its outcome is kept as `last_status`; a failure is logged and never fails the request.

## GitHub

`POST /_p99/v1/github` is GitHub's webhook, not signed with the account key: the host is the URL's, and the body must verify against `X-Hub-Signature-256` (HMAC-SHA256 with the host's webhook secret) or the answer is 401. A delivery id (`X-GitHub-Delivery`) is acted on once. From the host's linked repository, a `pull_request` opened, edited or reopened records the items its title and description name in `Fixes:` and `Refs:` trailers; one closed as merged also reads its commits, records them, and moves every open item named in `Fixes:` to done with the resolution fixed, with the status event, the live event and the reporter's mail. An `issues` closed as completed (`state_reason` `completed`, or none) does the same for the item `POST /_p99/v1/issues/{key}/github` opened it for. Only items of that host are read or changed. The answer is 200 `{"linked":[key],"changed":[key]}` when something was recorded or changed, and 204 for everything else.

The host's secrets are Worker secrets named after the first 16 hex digits of the SHA-256 of the host name, uppercased: `GITHUB_TOKEN_<tag>` (the fine-grained token) and `GITHUB_HOOK_<tag>` (the webhook secret). `p99 github set` writes both. Links are kept in `github_links` and shown on an issue as `github` to managers; `github_deliveries` keeps delivery ids for 30 days.

## Backups

The cron trigger (`*/15 * * * *`) runs a weekly backup of every table into the bucket under `backups/<date>/`, in steps small enough for one invocation, keeping eight. A deleted item stays in the backups taken before its delete until they age out; P99 never edits a backup.

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

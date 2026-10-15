# The P99 Worker

One Worker, one D1 database (binding `DB`) and one R2 bucket (binding `BUCKET`) per Cloudflare account. The Worker is mounted on every host it serves as the route `<host>/_p99/*`, so a page talks only to its own origin. It may also sit on a custom domain of its own.

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
| `GET /_p99/api/me?path=` | any code | `{"name","email","manager","host","env","version","counts":{"page_open","mine_open","mine_unread","all_open"},"theme":{},"strings":{}}`; `all_open` is null for non-managers; `theme` and `strings` are the host's config |
| `POST /_p99/api/verify` | a code with an authenticator | `{"totp":"<6 digits>"}`; 201 `{"device":"<32 hex>"}`; the panel stores `<code>.<device>` where the loader keeps the code |
| `GET /_p99/api/issues?scope=mine\|all\|page&path=&status=open\|closed\|any\|<status>&kind=&q=&cursor=&limit=` | any code; `all` managers only | `{"issues":[summary],"next_cursor"}`, newest first, this host's items only, `limit` at most 100 (default 50) |
| `POST /_p99/api/issues` | any code (`task` managers only) | `{"client_uid","kind","title","body","page","context","marks"}`; 201 issue |
| `GET /_p99/api/issues/{key}` | its reporter or a manager | a thread, `{"issue","comments","attachments","events"}`; marks it read |
| `PATCH /_p99/api/issues/{key}` | as the signed API | 200 issue |
| `POST /_p99/api/issues/{key}/comments` | its reporter or a manager (`internal` managers only) | `{"client_uid","body","internal"}`; 201 comment |
| `PUT /_p99/api/issues/{key}/attachments/{client_uid}?name=&role=&mark=&comment=` | its reporter or a manager | raw body, `Content-Length` required, `X-Content-SHA256` optional (the Worker hashes the body when it is absent); 201 attachment |
| `GET /_p99/api/files/{id}` | its reporter or a manager | the file, `Content-Disposition: attachment` |

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
| `GET /_p99/v1/issues?scope=&path=&status=&kind=&q=&cursor=&limit=` | actor; `all` managers only | as the browser API; with `host=*`, every host's items |
| `POST /_p99/v1/issues` | actor | as the browser API, plus `"host"`; 201 issue |
| `GET /_p99/v1/issues/{key}`, `PATCH`, `POST …/comments`, `PUT …/attachments/{uid}`, `GET /_p99/v1/files/{id}` | as the browser API | |
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
| `GET /_p99/v1/admin/backup-status` | managers | the last and the running backup |
| `POST /_p99/v1/import`, `PUT /_p99/v1/import/attachments/{uid}`, `POST /_p99/v1/import/finish` | the key | an import that keeps keys and numbers, as [import.md](import.md) describes |

A code object is `{"id","name","email","hosts","manager","hint","created_at","created_by","revoked_at","last_used_at"}`, `hint` the secret's last four characters.

## Items

- Keys are `<PREFIX>-<id>` over one sequence per account, the prefix from the kind: `bug` BUG, `feature` FEAT, `improvement` IMP, `question` Q, `task` TASK; any prefix with the right number, or the bare number, names the same item.
- Statuses: `new`, `confirmed`, `in_progress`, `waiting` (on the reporter), `resolved`, `abandoned`, `duplicate` (with `duplicate_of`); the first four are open.
- Managers change `status`, `kind`, `assignee`, `duplicate_of`, `title` and `body`; the reporter changes `title` and `body` while `new`, sets `abandoned` on an open item, and `new` to reopen a resolved one. Every change is one event; a `title` or `body` event keeps the old and new text as `{"from","to"}`, and neither mails anyone.
- Everyone but a manager sees only what they reported; internal comments and their files are for managers only.
- Attachments: 20 MB (20 MiB) each, 30 per item; roles `screenshot`, `page`, `region` (with `mark`), `file`; the type is the body's `Content-Type`, checked against the file's first bytes: PNG, JPEG or WebP for the images; for a `file` also GIF, PDF, `text/plain`, `text/csv`, `text/x-log`, JSON, zip, and Word, Excel, PowerPoint and OpenDocument files (`p99 file --attach` and `p99 comment --attach` pick it from the file's extension). A name ending in an executable or web page extension (`.html`, `.svg`, `.xml`, `.js`, `.exe`, `.bat`, `.sh` and the like) is refused, whatever the type.
- Limits per person and day: 30 items, 200 comments, 100 MB of files. Managers have none.
- Search (`q`) matches the title and body with accents and case folded on both sides (`cafe` finds `Café`): the Worker keeps `search_text`, the NFD form of title and body without combining marks, lowercased, and folds `q` the same way. A `q` that is a key also finds that item.

A summary is `{"id","key","kind","status","title","host","env","page":{"url","path","title"},"reporter":{"email","name","agent"},"assignee","created_at","updated_at","comments","attachments","unread","landing"}`; an issue adds `"body","duplicate_of","closed_at","context","marks","commits":[{"sha","subject","rel","envs"}]`; a comment is `{"id","client_uid","author":{"email","name","manager","agent"},"body","internal","created_at","attachments":[id]}`; an attachment `{"id","client_uid","role","mark","name","type","bytes","sha256","comment_id","created_at"}`; an event `{"actor","agent","kind","detail","at"}`, `agent` true when an agent acting as that person made it; `agent` is always a boolean. `assignee`, event actors (and the `from` and `to` of an assignee event) and a comment author's `email` show to managers only: for anyone else they are null, unless they are that person's own.

## Environments and landings

An environment is a name with a kind. A `development` environment counts the build of branch `main`; a `release` environment counts its latest announced build, whatever the branch. `p99 announce` (or a host's own build) posts a build with the items its commits name in `Fixes:` and `Refs:` trailers; an item lands in an environment when a counted build there carries a `Fixes:` commit for it, or when an import records a landing there, and the first landing is an event. An environment with `notify` mails the reporter at an item's first landing there, when mail is set up.

`landing` is `{"branch":bool,"envs":[{"env","kind","at","sha","version"}]}` in `position` order, `branch` true when a fix sits only on a branch no counted build carries.

## Mail

Off unless the Worker has `RESEND_API_KEY` and `MAIL_FROM`. New items and comments by non-managers go to every manager; a manager's non-internal comment or status change goes to the reporter; a first landing in a `notify` environment goes to the reporter. A manager's own new item mails nobody, and no one is mailed about their own action. Mail goes to Resend as UTF-8 JSON, so subjects and bodies keep their accents; an agent acting as a person reads as `Ada Lovelace*`. Sending never fails a request; each send is an event. Links are `https://<item's host><page path>#p99=<key>`, which opens the panel on that item.

## Backups

The cron trigger (`*/15 * * * *`) runs a weekly backup of every table into the bucket under `backups/<date>/`, in steps small enough for one invocation, keeping eight.

## Schema

`worker/migrations/` holds the schema: `0001_p99.sql`, then each change in its own numbered file. Migrations are recorded in `d1_migrations` (`id`, `name`, `applied_at`), the table wrangler keeps, so a database migrated by either stays in step.

## Host config

`PUT /_p99/v1/hosts/{host}`'s `config` is `{"theme":{…},"strings":{…},"corner","offset":{"x","y"},"above","off":[…]}`, as docs/hosts.md describes. The Worker writes the host's `corner`, `offset`, `above`, `off` and `theme.accent` into the loader it serves for that host (replacing `__P99_HOST__` with that JSON), so the button draws in place before any request; `/_p99/api/me` answers the whole config.

## Test vector

Secret `test-secret`, ts `1760400000`, `POST /_p99/v1/issues?host=example.com`.

- Actor JSON: `{"email":"ada@example.com","name":"Ada Lovelace"}`
- `X-P99-Actor`: `eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UifQ`
- Body: `{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}`
- `X-Content-SHA256`: `ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf`
- `X-P99-Auth`: `v1 ts=1760400000,sig=89b1d507574a2e8bb9c58d3ba92a29eab0f03baad0e422c4882f17c8ba33505a`

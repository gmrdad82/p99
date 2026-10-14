# The P99 Worker

One Worker, one D1 database (binding `DB`) and one R2 bucket (binding `BUCKET`) per Cloudflare account. The Worker is mounted on every host it serves as the route `<host>/_p99/*`, so a page talks only to its own origin. It may also sit on a custom domain of its own, where the signed API answers at `/v1/*` (the first API version's address, kept for sites that still call it).

The host of a request is the URL's hostname. A host must be listed in the `hosts` table to be served; an unknown host answers 404 on everything but `/_p99/health`. The signed API is the exception: its key names the host (below), so it answers on any address the Worker is mounted on, the first API version's custom domain included.

## Paths

| Path | What |
| --- | --- |
| `GET /_p99/health`, `GET /health` | `{"ok":true,"version"}`, unsigned |
| `GET /_p99/p99.js` | the loader |
| `GET /_p99/panel.js`, `/_p99/p99.css`, `/_p99/capture.js`, `/_p99/art/concrete.svg`, `/_p99/art/concrete-dark.svg` | the lazy parts |
| `/_p99/api/*` | the browser API, authorised by a personal code |
| `/_p99/v1/*`, `/v1/*` | the signed API, for the CLI, the TUI and server-side hosts |

Static files are answered from text modules bundled into the Worker (`worker/src/web/`). The loader is `Cache-Control: public, max-age=300`; every other file is fetched as `<path>?v=<version>` and answered `public, max-age=31536000, immutable`. `__P99_VERSION__` in any served file is replaced by the Worker's `VERSION` variable.

## Errors

Every error is `{"error":"<code>","message":"<English>"}` with 400 `invalid`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 413 `too_large`, 429 `rate_limited`, 500 `internal`. A `client_uid` seen before answers the original object with 200, never a duplicate.

## The browser API

Every request carries `X-P99-Code: <code>`. A code is 12 characters of Crockford base32 (`0123456789abcdefghjkmnpqrstvwxyz`); the Worker lowercases it, reads `i` and `l` as `1` and `o` as `0`, drops `-` and spaces, and looks up its SHA-256. A missing, unknown or revoked code, or one not scoped to the request's host, answers 401, and the loader then forgets it. Each code is limited to 120 requests a minute (the `RATE` rate-limiting binding, when the Worker has one) and to the daily limits below. Since the code travels in a header and never in a cookie, there is no CSRF surface.

The actor of a browser request is the code's person: `{email, name, manager}`. A manager is a code minted with `manager`, or an e-mail in the Worker's `MANAGERS` secret (comma separated).

| Route | Who | Does |
| --- | --- | --- |
| `GET /_p99/api/me?path=` | any code | `{"name","email","manager","host","env","version","counts":{"page_open","mine_open","mine_unread","all_open"},"theme":{},"strings":{}}`; `all_open` is null for non-managers; `theme` and `strings` are the host's config |
| `GET /_p99/api/issues?scope=mine\|all\|page&path=&status=open\|closed\|any\|<status>&kind=&q=&cursor=&limit=` | any code; `all` managers only | `{"issues":[summary],"next_cursor"}`, newest first, this host's items only, `limit` at most 100 (default 50) |
| `POST /_p99/api/issues` | any code (`task` managers only) | `{"client_uid","kind","title","body","page","context","marks"}`; 201 issue |
| `GET /_p99/api/issues/{key}` | its reporter or a manager | a thread, `{"issue","comments","attachments","events"}`; marks it read |
| `PATCH /_p99/api/issues/{key}` | as the signed API | 200 issue |
| `POST /_p99/api/issues/{key}/comments` | its reporter or a manager (`internal` managers only) | `{"client_uid","body","internal"}`; 201 comment |
| `PUT /_p99/api/issues/{key}/attachments/{client_uid}?name=&role=&mark=&comment=` | its reporter or a manager | raw body, `Content-Length` required, `X-Content-SHA256` optional (the Worker hashes the body when it is absent); 201 attachment |
| `GET /_p99/api/files/{id}` | its reporter or a manager | the file, `Content-Disposition: attachment` |

## The signed API

Same routes under `/_p99/v1/` and `/v1/`. Every request but health is signed:

| Header | Value |
| --- | --- |
| `X-Tracker-Key-Id` | the key id, `[a-z0-9_]{1,32}` |
| `X-Tracker-Actor` | base64url, no padding, of the actor JSON; absent only on `POST /v1/builds` |
| `X-Content-SHA256` | lowercase hex SHA-256 of the body (empty body: the hash of nothing) |
| `X-Tracker-Auth` | `v1 ts=<unix seconds>,sig=<hex>`, `sig = HMAC-SHA256(secret, "v1\n" + ts + "\n" + METHOD + "\n" + path_and_query + "\n" + X-Tracker-Actor + "\n" + X-Content-SHA256)`; refused when `ts` is more than 300 s away |

The secret of key id `x` is the Worker secret `KEY_X` (uppercased), with `KEY_X_NEXT` accepted beside it during a rotation. Key id `test` works only on `127.0.0.1` or `localhost`. The header names keep the first API version's spelling so its clients keep working.

The actor is `{"email","name","rank","agent"?,"function"?,"party"?,"person"?}`, `rank` one of `everyone`, `administrator`, `super_administrator`, `agent` an optional label of at most 40 characters naming the agent that acts as this person (`claude`, say). Items and comments keep it, and every view shows it beside the person's name.

**Key `p99`** is the account's own key, the one `p99 setup` makes and the CLI and TUI sign with. Its actor is always a manager. It names the host with `?host=<host>` on any route (`host=*`, or no `host`, on the list and counts reads every host), and the environment with `env` in a build's body. On the list and counts an unlisted `host` answers 404; on an item's routes `host` is a filter, so an item of another host answers 404 while an item with no host yet still answers; `POST /v1/issues` takes the query's `host` first, then the body's. **Any other key id** is a server-side host of the first API version: its environment is the key id, and its host is the listed host whose `env` is that key id.

| Route | Who | Does |
| --- | --- | --- |
| `POST /v1/builds` | any key | `{"sha","branch","version","dirty","env"?,"items":[{"id","rel","sha","subject"}]}` replaces that environment's row for that branch; 204 |
| `GET /v1/counts?path=` | actor | `{"page_open","mine_open","mine_unread","all_open"}` |
| `GET /v1/issues?scope=&path=&status=&kind=&q=&cursor=&limit=` | actor; `all` managers only | as the browser API; with key `p99` and `host=*`, every host's items |
| `POST /v1/issues` | actor | as the browser API, plus `"host"` with key `p99`; 201 issue |
| `GET /v1/issues/{key}`, `PATCH`, `POST …/comments`, `PUT …/attachments/{uid}`, `GET /v1/files/{id}` | as the browser API | |
| `GET /v1/hosts` | managers | `{"hosts":[{"host","env","config","created_at"}]}` |
| `PUT /v1/hosts/{host}` | key `p99` | `{"env","config"}`; adds or updates a host, and gives every item with no host whose `origin_env` is that env this host; 200 host |
| `DELETE /v1/hosts/{host}` | key `p99` | 204; its items stay |
| `GET /v1/envs` | managers | `{"envs":[{"name","kind","position","notify"}]}` |
| `PUT /v1/envs/{name}` | key `p99` | `{"kind":"development"\|"release","position","notify"}`; 200 env |
| `GET /v1/codes?host=` | key `p99` | `{"codes":[code]}`, newest first |
| `POST /v1/codes` | key `p99` | `{"name","email","hosts":["…"],"manager"}`; 201 `{"code":code,"secret":"<12 characters>","links":["https://<host>/?p99=<secret>"]}`; the secret is shown this once |
| `POST /v1/codes/{id}/revoke` | key `p99` | 200 code |
| `GET /v1/admin/backup-status` | managers | the last and the running backup |

A code object is `{"id","name","email","hosts","manager","hint","created_at","created_by","revoked_at","last_used_at"}`, `hint` the secret's last four characters.

## Items

- Keys are `<PREFIX>-<id>` over one sequence per account, the prefix from the kind: `bug` BUG, `feature` FEAT, `improvement` IMP, `question` Q, `task` TASK; any prefix with the right number, or the bare number, names the same item.
- Statuses: `new`, `confirmed`, `in_progress`, `waiting` (on the reporter), `resolved`, `abandoned`, `duplicate` (with `duplicate_of`); the first four are open.
- Managers change `status`, `kind`, `assignee`, `duplicate_of` and `title`; the reporter changes `title` and `body` while `new`, sets `abandoned` on an open item, and `new` to reopen a resolved one. Every change is one event.
- Everyone but a manager sees only what they reported; internal comments and their files are for managers only.
- Attachments: 20 MiB each, 30 per item; roles `screenshot`, `page`, `region` (with `mark`), `file`; the type is checked against the file's first bytes.
- Limits per person and day: 30 items, 200 comments, 100 MiB of files.

A summary is `{"id","key","kind","status","title","host","origin_env","page":{"url","path","title"},"reporter":{"email","name","agent"},"assignee","created_at","updated_at","comments","attachments","unread","landing"}`; an issue adds `"body","duplicate_of","closed_at","context","marks","commits":[{"sha","subject","rel","envs"}]`; a comment is `{"id","client_uid","author":{"email","name","manager","agent"},"body","internal","created_at","attachments":[id]}`; an attachment `{"id","client_uid","role","mark","name","type","bytes","sha256","comment_id","created_at"}`; an event `{"actor","kind","detail","at"}`.

## Environments and landings

An environment is a name with a kind. A `development` environment counts the build of branch `main`; a `release` environment counts its latest announced build, whatever the branch. `p99 announce` (or a host's own build) posts a build with the items its commits name in `Fixes:` and `Refs:` trailers; an item lands in an environment when a counted build there carries a `Fixes:` commit for it, and the first landing is an event. An environment with `notify` mails the reporter at an item's first landing there, when mail is set up.

`landing` is `{"branch":bool,"envs":[{"env","kind","at","sha","version"}]}` in `position` order, `branch` true when a fix sits only on a branch no counted build carries. For the first API version's clients the same object also carries `development: {<env>: {at, sha}}` for each development environment and `<env>: {at, sha, version}` for each release environment.

## Mail

Off unless the Worker has `RESEND_API_KEY` and `MAIL_FROM`. New items and comments by non-managers go to every manager; a manager's non-internal comment or status change goes to the reporter; a first landing in a `notify` environment goes to the reporter. Sending never fails a request; each send is an event. Links are `https://<item's host><page path>#p99=<key>`, which opens the panel on that item.

## Backups

The cron trigger (`*/15 * * * *`) runs a weekly backup of every table into the bucket under `backups/<date>/`, in steps small enough for one invocation, keeping eight.

## Schema

`worker/migrations/0001_tracker.sql` is the first API version's schema, unchanged, so an existing database adopts P99 with its keys and numbers. `0002_p99.sql` adds `hosts`, `envs`, `codes`, `items.host`, `items.reporter_agent` and `comments.author_agent`. Migrations are recorded in `d1_migrations` (`id`, `name`, `applied_at`), the table wrangler keeps, so a database migrated by either stays in step.

## Host config

`PUT /v1/hosts/{host}`'s `config` is `{"theme":{…},"strings":{…},"corner","offset":{"x","y"},"above","off":[…]}`, as docs/hosts.md describes. The Worker writes the host's `corner`, `offset`, `above`, `off` and `theme.accent` into the loader it serves for that host (replacing `__P99_HOST__` with that JSON), so the button draws in place before any request; `/_p99/api/me` answers the whole config.

## Test vector

Secret `test-secret`, ts `1760400000`, `POST /_p99/v1/issues?host=example.com`.

- Actor JSON: `{"email":"ada@example.com","name":"Ada Lovelace","rank":"administrator","person":"ada@example.com"}`
- `X-Tracker-Actor`: `eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UiLCJyYW5rIjoiYWRtaW5pc3RyYXRvciIsInBlcnNvbiI6ImFkYUBleGFtcGxlLmNvbSJ9`
- Body: `{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}`
- `X-Content-SHA256`: `ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf`
- `X-Tracker-Auth`: `v1 ts=1760400000,sig=16d2f29dfa22138f0f5311fb84704288459905c2f4e3ac37cf5cacfaf08b2566`

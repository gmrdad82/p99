# Importing items

`p99 import` brings items from another tracker into P99 and keeps their keys: `BUG-3` stays `BUG-3`, with its comments, files, history, landings and who has read it. Text stays UTF-8 from end to end, so accents and diacritics arrive as they left.

```
p99 import ./bundle --host example.com --dry-run
p99 import ./bundle --host example.com
```

`--host` names a host P99 already serves (`p99 hosts add` first); every imported item belongs to it. `--json` prints the summary as JSON and sends the progress lines to standard error. Imports sign with the account's own key, so they run from the CLI only, and the daily limits never apply to them.

## The bundle

A bundle is a directory with a `bundle.jsonl` and the files its attachments name beside it:

```
bundle/
  bundle.jsonl
  files/receipt.png
```

`bundle.jsonl` holds one JSON object per line, `"type"` first. Blank lines are skipped. Times are ISO 8601 (`2025-03-01T10:00:00Z`); the Worker stores them in UTC.

| Type | Fields |
| --- | --- |
| `item` | `key` (`BUG-3`; the number is taken from it, the prefix must match the kind), `kind`, `title`, `body`, `status` (`inbox`, `doing`, `review` or `done`, or a P99 1.x status such as `resolved`), `resolution` (with done: `fixed`, `abandoned` or `duplicate`; `fixed` when left out), `duplicate_of` (a key or null), `reporter` `{email, name, agent}`, `assignee` (an e-mail or null; it shows as that person's username, made from the e-mail when they have none), `env` (null: the host's environment), `page` `{url, path, title}` (null: the host's front page), `context` `{}`, `marks` `[]`, `created_at`, `updated_at`, `closed_at` |
| `comment` | `item` (a key), `uid` (a stable id of your own), `author` `{email, name, agent, manager}`, `body`, `internal`, `created_at` |
| `attachment` | `item`, `uid`, `comment` (a comment's `uid`, or null), `role` (`file`, `screenshot`, `page` or `region`), `mark` (a region's mark index), `name` (null: the file's name), `content_type`, `file` (a path inside the bundle directory), `internal`, `created_at` |
| `event` | `item`, `actor` `{email, agent}` (or null for the system), `kind`, `detail` `{}`, `internal`, `at` |
| `landing` | `item`, `env`, `sha`, `at` |
| `read` | `item`, `email`, `at` |
| `manager` | `email` |

The limits are P99's own: a title of 1 to 200 characters, a body of up to 20 000, files of up to 20 MB and 30 per item, and a file's first bytes must match its `content_type` (the same types the panel takes). An item that is not open gets `closed_at` from `updated_at` when the bundle leaves it out. Imported items land on the host's home board, each at the top of its column, so the last line of a column in the bundle sits highest.

A `manager` line imports nothing. P99's managers are people with a manager code, or e-mails in the Worker's `MANAGERS` secret; the summary lists every manager in the bundle who has neither yet, with the `p99 invite --manager` line to mint one.

A `landing` records when an item first reached an environment, so P99 never announces that landing again. The item shows the environment at once.

## A complete example

`bundle/bundle.jsonl`:

```json
{"type":"item","key":"BUG-7","kind":"bug","title":"The café menu shows the wrong price","body":"The crème brûlée costs 12,50 € on the menu and 13 € at checkout.","status":"resolved","duplicate_of":null,"reporter":{"email":"ada@example.com","name":"Ada Lovelace","agent":false},"assignee":"grace@example.com","env":"production","page":{"url":"https://example.com/menu","path":"/menu","title":"Menu"},"context":{},"marks":[],"created_at":"2025-03-01T10:00:00Z","updated_at":"2025-03-04T08:00:00Z","closed_at":"2025-03-04T08:00:00Z"}
{"type":"comment","item":"BUG-7","uid":"old-comment-41","author":{"email":"grace@example.com","name":"Grace Hopper","agent":false,"manager":true},"body":"Confirmed, the menu reads an old price list.","internal":false,"created_at":"2025-03-02T09:00:00Z"}
{"type":"attachment","item":"BUG-7","uid":"old-file-12","comment":"old-comment-41","role":"file","mark":null,"name":"receipt.png","content_type":"image/png","file":"files/receipt.png","internal":false,"created_at":"2025-03-02T09:00:00Z"}
{"type":"event","item":"BUG-7","actor":{"email":"grace@example.com","agent":false},"kind":"status","detail":{"from":"confirmed","to":"resolved"},"internal":false,"at":"2025-03-04T08:00:00Z"}
{"type":"landing","item":"BUG-7","env":"production","sha":"4f1c2a9e0b7d","at":"2025-03-04T07:30:00Z"}
{"type":"read","item":"BUG-7","email":"ada@example.com","at":"2025-03-04T09:00:00Z"}
{"type":"manager","email":"grace@example.com"}
```

```
$ p99 import ./bundle --host example.com
item: 1 of 1 sent
comment: 1 of 1 sent
attachment: 1 of 1 sent
event: 1 of 1 sent
landing: 1 of 1 sent
read: 1 of 1 sent
manager: 1 of 1 sent
example.com: 7 records imported
  type             new  existing  conflicts
  item               1         0          0
  comment            1         0          0
  attachment         1         0          0
  event              1         0          0
  landing            1         0          0
  read               1         0          0
  manager            1         0          0
  files uploaded: 1
  items recounted: 1, duplicates linked: 0
these managers have no manager code yet; mint one each, or list them in MANAGERS:
  p99 invite example.com --manager --name "<name>" --email grace@example.com
```

## Checking first

Before it sends anything, `p99 import` reads the whole bundle and checks every line; it lists each problem with its line number (`line 12: comment: body must be 1 to 20000 characters`) and stops. `--dry-run` then asks the Worker what would happen, type by type, `{new, existing, conflicts}`, and writes nothing.

## Running it again

An import can stop and run again at any point, and running it twice changes nothing the second time:

- an item whose key already exists with the same title is left as it is; with another title it is a conflict, reported and never overwritten;
- comments and attachments are matched by `uid`, so keep each `uid` stable between runs; a file is uploaded only when the Worker does not hold it yet;
- events are matched by item, kind and time, landings by item and environment, reads by item and person.

The command ends with a summary (JSON with `--json`) and exits with an error when there were conflicts.

## Numbering

P99 keys every item `<PREFIX>-<number>` over one numbering for all kinds (`BUG` `FEAT` `IMP` `Q` `TASK`). An imported item keeps its number, so a bundle must not use one number twice, even across kinds. New items continue above the highest number in the account: after importing `BUG-7`, the next item filed is 8 or higher. A number already held by an item with another title is a conflict; import into a fresh account, or renumber the bundle, to avoid them.

## The routes

The CLI talks to three signed routes, which take the key `p99` only:

| Route | Does |
| --- | --- |
| `POST /_p99/v1/import?host=&dry_run=1\|0` | a JSON array of up to 500 records (the CLI sends 200); answers `{"dry_run","counts":{"<type>":{"new","existing","conflicts":[{"ref","reason"}]}},"upload":[uid],"managers":[email]}`. `attachment` records are only checked here: `upload` lists the ones whose files the Worker does not hold yet. |
| `PUT /_p99/v1/import/attachments/{uid}?host=&item=&comment=&role=&mark=&name=&internal=&created_at=` | one file as the raw body, `Content-Type` its type; `comment` is the comment's `uid`; 201 attachment, or 200 when it is already stored |
| `POST /_p99/v1/import/finish?host=` | `{"items":[key],"duplicates":[{"item","duplicate_of"}]}` links duplicates and recounts the items' comments, files and activity; answers `{"recounted","duplicates":{"linked","conflicts"}}` |

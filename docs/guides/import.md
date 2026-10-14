---
title: Import existing items
description: Move items from another tracker into P99 with p99 import, keeping their keys, comments, files and history, and run it again safely.
sidebar:
  order: 7
---

`p99 import` brings items from another tracker into P99 and keeps their keys: `BUG-3` stays `BUG-3`, with its comments, files, history, landings and who has read it. Text stays UTF-8 from end to end, so accents arrive as they left.

## 1. Add the host

Every imported item belongs to one host P99 already serves:

```sh
p99 hosts add example.com --env production
```

## 2. Write the bundle

Export the other tracker into a **bundle**: a directory with a `bundle.jsonl`, one JSON object per line, and the files its attachments name beside it.

```text
bundle/
  bundle.jsonl
  files/receipt.png
```

Each line has a `"type"`: `item`, `comment`, `attachment`, `event`, `landing`, `read` or `manager`. A minimal item with one comment:

```json
{"type":"item","key":"BUG-7","kind":"bug","title":"The café menu shows the wrong price","body":"The crème brûlée costs 12,50 € on the menu and 13 € at checkout.","status":"resolved","duplicate_of":null,"reporter":{"email":"ada@example.com","name":"Ada Lovelace","agent":false},"assignee":"grace@example.com","env":"production","page":{"url":"https://example.com/menu","path":"/menu","title":"Menu"},"context":{},"marks":[],"created_at":"2025-03-01T10:00:00Z","updated_at":"2025-03-04T08:00:00Z","closed_at":"2025-03-04T08:00:00Z"}
{"type":"comment","item":"BUG-7","uid":"old-comment-41","author":{"email":"grace@example.com","name":"Grace Hopper","agent":false,"manager":true},"body":"Confirmed, the menu reads an old price list.","internal":false,"created_at":"2025-03-02T09:00:00Z"}
```

[The bundle format](../reference/formats.md#importing-items) lists every type and field, with a complete example.

Keep these in mind while you write the exporter:

- A key's prefix must match its kind (`BUG` bug, `FEAT` feature, `IMP` improvement, `Q` question, `TASK` task), and P99 numbers all kinds in one sequence, so no two items may share a number, even across kinds.
- Give every comment and attachment a `uid` that stays the same between runs: that is how a second run knows what it already sent.
- P99's own limits apply: a title of 1 to 200 characters, a body of up to 20 000, files of up to 20 MiB and 30 per item, and each file's first bytes must match its `content_type`.

## 3. Check it

```sh
p99 import ./bundle --host example.com --dry-run
```

`p99 import` first reads the whole bundle and checks every line; a problem is listed with its line number (`line 12: comment: body must be 1 to 20000 characters`) and nothing is sent. `--dry-run` then asks the Worker what would happen, type by type, new, existing and conflicts, and writes nothing.

## 4. Import

```sh
p99 import ./bundle --host example.com
```

It sends the records in batches, uploads the files the Worker doesn't hold yet, links duplicates, recounts each item's comments and files, and ends with a summary per type. `--json` prints the summary as JSON and sends the progress lines to standard error.

Imports sign with the account's own key, so they run from the CLI only, and the daily limits never apply to them. New items filed afterwards continue above the highest number in the account: after importing `BUG-7`, the next item is 8 or higher.

## 5. Make the managers

A `manager` line imports nothing: P99's managers are people with a manager code or e-mails in the Worker's `MANAGERS` secret. The summary lists each manager in the bundle who has neither yet, with the line that mints their code:

```sh
p99 invite example.com --manager --name "Grace Hopper" --email grace@example.com
```

## Run it again

An import can stop and run again at any point, and a second run of the same bundle changes nothing:

- an item whose key already exists with the same title is left as it is; with another title it is a **conflict**, reported and never overwritten;
- comments and attachments are matched by `uid`, events by item, kind and time, landings by item and environment, reads by item and person.

The command exits with an error when there were conflicts. Import into a fresh account, or renumber the bundle, to avoid them.

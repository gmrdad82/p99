---
title: Let agents work the inbox
description: Let a coding agent read and answer items as you, marked with 🤖 everywhere it acts, using --agent or P99_AGENT and the JSON output.
sidebar:
  order: 5
---

An agent, such as a coding assistant working in your repository, uses the same `p99` commands you do and signs with the same account key. What it writes is marked: its items, comments and changes read as your name with 🤖, `Ada Lovelace 🤖`, in the TUI, the CLI, the panel on the site and in mail. So everyone can tell what you wrote from what an agent wrote for you.

## Mark an agent's commands

Any one of these marks the commands:

| How | Marks |
| --- | --- |
| `--agent` | one command |
| `--agent=<label>` | one command, with a label that says which agent (the `=` is needed) |
| `P99_AGENT=<label>` in the environment | every command of that shell or process, with the label; `1` or `true` marks with no label, `0` or `false` turns the mark off, empty is as if unset |
| `agent = true` in the config's `[me]` table | every command; `P99_AGENT=0` (or `false`) turns it off for one shell |
| `agent = true` in `[accounts.<name>.me]` | every command on that account; `P99_AGENT=0` (or `false`) turns it off for one shell |

`--agent=<label>` wins over `P99_AGENT`, and a bare `--agent` keeps `P99_AGENT`'s label. A label has up to 80 characters (longer ones are cut, control characters dropped) and shows in the thread's details, so you can tell which agent did what. Give the agent `P99_AGENT` in the environment it runs in, so it can't forget the flag:

```sh
export P99_AGENT=reviewer
p99 comment BUG-8 "Found it: the search field remounts on each keystroke."
```

```text
2026-10-12 12:00 Ada Lovelace 🤖
Found it: the search field remounts on each keystroke.
```

Only the CLI's and the TUI's signed requests carry the mark; the browser panel never does. The mark and its label are kept on every item, comment and event, and in an import. Agents can also keep a plan of work as cards: see [the cards guide](cards.md).

## Read and answer as JSON

Every command takes `--json`, which prints one JSON document on standard output and nothing else there. A typical round:

```sh
p99 list --all --json | jq -r '.issues[] | select(.unread) | .key'
p99 show BUG-11 --json
p99 comment BUG-11 "The cart reads the total once and never again after a remove." --internal --json
p99 move BUG-11 --to Doing --json
p99 assign BUG-11 me --json
p99 edit Q-4 --title "Which grind sizes does the chart cover?" --text-file q4.md --json
```

`p99 edit` changes an item's title or details (`--text`, or `--text-file` with `-` for standard input); the item's history keeps the old and new text, and no one is mailed, so a batch of edits stays quiet.

The objects are described field by field in [the API reference](../reference/formats.md#items): a summary in a list carries `key`, `kind`, `status` (with `resolution` once done), `board`, `title`, `host`, `env`, the `page`, the `reporter` (with `agent`), `unread` and `landing`; a thread adds the body, the comments, the files and the events, where `agent` is `true` on what an agent did.

## React to changes as they happen

`p99 watch --json` keeps a WebSocket open to the Worker and prints one JSON event per line on standard output for each new item, comment, change and file, until it is stopped. `--host` limits it to one host's items. It sends a keepalive every 30 seconds and reconnects by itself after a drop, saying so on standard error; changes made while it was away are not replayed, so read the list again after a reconnect.

```sh
p99 watch --host shop.example.com --json | while read -r event; do
  key=$(jq -r 'select(.type == "item") | .key' <<<"$event")
  [ -n "$key" ] && p99 show "$key" --json
done
```

```json
{"type":"item","key":"BUG-14","host":"shop.example.com","title":"The coupon field rejects lowercase codes","by":{"name":"Grace Hopper","agent":false},"at":"2026-10-15T09:30:00.000Z"}
```

Each event has `type` (`item`, `comment`, `change`, `attachment`, `import`, and for boards `label`, `order`, `board` and `labels`), `key`, `host`, `title`, `by` (`name` and `agent`) and `at`; [the API reference](../reference/formats.md#live-events) lists the rest. A Worker not deployed since live updates came answers `p99: this Worker has no push yet; run p99 deploy`, with exit code 1.

## Exit codes

- `0`: done.
- `1`: refused or failed after the command was understood; one line on standard error, `p99: <why>`, such as `p99: cart is not an item key; try BUG-12 or 12`.
- `2`: the command line could not be parsed; standard error carries clap's message and the usage line.

## Point an agent at its tools

Tell the agent what it may do in its own instructions, for example:

```text
P99 is the issue tracker. Read items with `p99 list --all --json` and `p99 show <KEY> --json`.
Answer with `p99 comment <KEY> "<text>"`, internal notes with --internal.
Set an item's label with `p99 move <KEY> --to <label>`; move it to a closing label such as Done only once its fix has landed.
Name items in commits with `Fixes: BUG-12` or `Refs: FEAT-3` trailers.
```

[Announce builds and landings](announce.md) explains the trailers: with them, each item shows when its fix reaches dev and production.

---
title: Let agents work the inbox
description: Let a coding agent read and answer items as you, marked with an asterisk everywhere it acts, using --agent or P99_AGENT and the JSON output.
sidebar:
  order: 5
---

An agent, such as a coding assistant working in your repository, uses the same `p99` commands you do and signs with the same account key. What it writes is marked: its items, comments and changes read as your name with an asterisk, `Ada Lovelace*`, in the TUI, the CLI, the panel on the site (with the hint "AI" on the asterisk) and in mail. So everyone can tell what you wrote from what an agent wrote for you.

## Mark an agent's commands

Any one of these marks the commands:

| How | Marks |
| --- | --- |
| `--agent` | one command |
| `P99_AGENT=1` in the environment (any value but empty or `0`) | every command of that shell or process |
| `agent = true` in the config's `[me]` table | every command; `P99_AGENT=0` turns it off for one shell |
| `agent = true` in `[accounts.<name>.me]` | every command on that account; `P99_AGENT=0` turns it off for one shell |

Give the agent `P99_AGENT=1` in the environment it runs in, so it can't forget the flag:

```sh
export P99_AGENT=1
p99 comment BUG-8 "Found it: the search field remounts on each keystroke."
```

```text
2026-10-12 12:00 Ada Lovelace*
Found it: the search field remounts on each keystroke.
```

Only the CLI's and the TUI's signed requests carry the mark; the browser panel never does. The mark is kept on every item, comment and event, and in an import.

## Read and answer as JSON

Every command takes `--json`, which prints one JSON document on standard output and nothing else there. A typical round:

```sh
p99 list --all --json | jq -r '.issues[] | select(.unread) | .key'
p99 show BUG-11 --json
p99 comment BUG-11 "The cart reads the total once and never again after a remove." --internal --json
p99 status BUG-11 in_progress --json
p99 assign BUG-11 me --json
```

The objects are described field by field in [the API reference](../reference/formats.md#items): a summary in a list carries `key`, `kind`, `status`, `title`, `host`, `env`, the `page`, the `reporter` (with `agent`), `unread` and `landing`; a thread adds the body, the comments, the files and the events, where `agent` is `true` on what an agent did.

## Exit codes

- `0`: done.
- `1`: refused or failed after the command was understood; one line on standard error, `p99: <why>`, such as `p99: cart is not an item key; try BUG-12 or 12`.
- `2`: the command line could not be parsed; standard error carries clap's message and the usage line.

## Point an agent at its tools

Tell the agent what it may do in its own instructions, for example:

```text
P99 is the issue tracker. Read items with `p99 list --all --json` and `p99 show <KEY> --json`.
Answer with `p99 comment <KEY> "<text>"`, internal notes with --internal.
Set statuses with `p99 status <KEY> <status>`; resolve an item only once its fix has landed.
Name items in commits with `Fixes: BUG-12` or `Refs: FEAT-3` trailers.
```

[Announce builds and landings](announce.md) explains the trailers: with them, each item shows when its fix reaches dev and production.

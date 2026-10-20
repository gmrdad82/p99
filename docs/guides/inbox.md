---
title: Work the inbox
description: Read, answer, assign and close items in p99 tui or with the CLI, and read them as JSON in scripts.
sidebar:
  order: 4
---

![A thread in p99 tui: an item with its comments, an agent's reply and where its fix has landed](../images/thread.png)

Everything people file lands in one inbox per Cloudflare account, across all its hosts. Work it in the terminal UI, or one command at a time from the CLI.

## Items

An item is a `bug`, `feature` (an idea), `improvement`, `question` or `task` (tasks are filed by managers). Its key is a prefix and a number, `BUG-12`, `FEAT-7`, `IMP-5`, `Q-10`, `TASK-6`, over one numbering per account: any prefix with the right number, or the bare number, names the same item, so `12`, `bug-12` and `BUG-12` all work.

An item carries one **label**, its state: a new one gets Inbox, and Inbox, Doing, Review and Done are the defaults, each renameable. A label can **close** an item (Done does); a closed item says how it ended: `fixed`, `abandoned` (dropped) or `duplicate` (of another item). Reporters see their own words in the panel: Received while the item has the first label, In progress under any other open one, then Fixed, Dropped or Duplicate. Every change is recorded as an event, and the reporter is mailed about replies and about the item closing or reopening when mail is on; other label changes mail no one.

## Boards

A board is one manager's: a name, 3 to 5 columns, each a label, and its own order of the cards, which is that person's priority: the top of a column matters most. It shows the items whose label is one of its columns, each once, and moving a card gives the item that column's label. Everyone gets a board, Inbox, Doing, Review, Done, the first time they open the boards, and can make up to three. Others watch it read-only and see the same cards in the same order. A shared label is a handoff: when a dev's last column, "QA ready", is the first column of a QA person's board, a card the dev moves there shows up for QA, with nothing to set up.

```sh
p99 boards
p99 board
p99 board @grace.hopper
p99 boards set QA --columns "QA ready,Testing,Done" --closes Done
p99 move BUG-12 --to Doing
p99 move BUG-12 --to Doing --after BUG-9
p99 labels
p99 labels rename "QA ready" "Ready for QA"
```

`--to` takes a label on one of your boards, in any case; with `--before` or `--after` the card is also placed in that column of your board, and without them its place on boards stays as it was. `p99 boards set` makes the board or changes its columns; `--closes` names the columns whose label closes an item. A rename changes the label on every board and item; when other people's boards use it, `p99 labels rename` asks first, naming them, and `--yes` answers for scripts.

## The TUI

```sh
p99
```

`p99` alone, in a terminal, opens the TUI, as `p99 tui` does; its flags (`--account`, `--agent`) go with `p99 tui`. Piped or in a script, a bare `p99` prints clap's short error and exits 2 instead of waiting on a screen.

The Inbox screen lists the open items of every host, newest activity first, with a dot on the unread ones and each item's label; the header counts the items shown and the unread. `tab`, or `1`, `2` and `3`, switch between the Inbox, Board and Codes screens.

| Key | In the list |
| --- | --- |
| `↑` `↓` | move |
| `enter` | open the item |
| `/` | filter by text as you type; `esc` clears it |
| `s` | show open, closed, or open and closed items, in turn |
| `h` | show every host, or pick one |
| `r` | read the list again |
| `?` | every key of the screen |
| `ctrl+c` twice | quit |

| Key | In an item |
| --- | --- |
| `r` | write a reply; `enter` sends it, `esc` drops it |
| `i` | make the next reply internal (managers only see it), or not |
| `m` | move it to a label of your boards; `Drop` closes it without fixing, `Duplicate of…` asks for the item it duplicates |
| `a` | assign it to someone, or to no one |
| `o` | open the item's page in the browser |
| `d` | delete it for good, with its comments and files: type its key back, then `enter` |
| `↑` `↓`, `space`, `g`, `G` | scroll |
| `ctrl+r` | read the item again |
| `esc` | back to the list |

An item shows its kind, label, host and environment, the page it was filed on, who reported it, its text, its comments with their files, where its fix has landed, and its events.

The Board screen opens your first board: its columns are its labels, and its cards are the items carrying them, in your order. `b` picks another board, yours first, then everyone else's by @username; on someone else's board you watch, the footer says whose, and nothing moves. A move made elsewhere slides into place as it happens. When a card moved before your drop landed, the board says "this card moved; refreshed" and reads it again.

| Key | On the board |
| --- | --- |
| `←` `→` `↑` `↓` | move between cards |
| `space` | pick up a card on your board; the arrows carry it, `enter` drops it, `esc` puts it back |
| `enter` | open the item |
| `b` | pick a board |
| `r` | read the board again |

The mouse drags cards too, on your own boards.

## The CLI

The same work, one command at a time:

```sh
p99 list example.com
p99 list --all --status any --kind bug
p99 list --mine -q checkout
p99 show BUG-12
p99 comment BUG-12 "Fixed on dev, can you check?"
p99 comment BUG-12 "The cart caches the total." --internal
p99 status BUG-12 Done
p99 status BUG-14 abandoned
p99 status BUG-13 duplicate --duplicate-of BUG-12
p99 merge BUG-14 BUG-15 --into BUG-12
p99 assign BUG-12 @grace.hopper
p99 assign BUG-12 me
p99 assign BUG-12 --none
p99 list --all --label Doing
p99 file example.com --kind task --title "Move product images to the new bucket"
p99 download 41 -o receipt.png
p99 delete BUG-16
```

`p99 status BUG-12 Done` is `p99 move BUG-12 --to Done`; `abandoned` and `duplicate` close an item that way too.

`p99 list` takes a host; without one it lists every host of the account, and `--all` every host of every account in the config. `--status` is `open` (the default), `closed` or `any`, `--label` keeps one label, and `--limit` caps the lines at 50 unless you raise it. Its lines read:

```text
*BUG-11   Inbox       shop.example.com The total does not update after removing a line  [4 comments]
 TASK-6   Doing       shop.example.com Move product images to the new bucket  -> ada@example.com
 BUG-8    Doing       dev.example.com Search box loses focus on mobile  -> ada@example.com  [3 comments]  fixed on a branch
 IMP-5    Doing       shop.example.com Show delivery dates on product pages  -> ada@example.com  landed: dev
```

Everyone is a username on the account, made from their name when they get a code (`Grace Hopper` is `@grace.hopper`); each person changes only their own ([usernames](../reference/formats.md#usernames)), and an agent acting for them shows as their name with `*`, never a username of its own. `p99 assign` takes a username, with or without the `@`, or `me`; the assignee must hold a code for the item's site or be a manager.

A `*` before the key marks it unread. `p99 show` prints the item, the commits that named it, its files with the ids `p99 download` takes, its comments (internal ones marked) and its events. `p99 delete` removes an item for good, with its comments, internal notes, history and every file, after you type its key back; `--yes` skips the question for scripts and agents, and without a terminal it is required. Items merged into it go back to Inbox, and GitHub keeps its own issue. In the panel, a manager finds **Delete** with the item's key at the bottom of an item, under Manage: type the key back, then hold the button until it fills, or press Enter. Manage picks the assignee from the people who hold a code for the site, each shown as @username with a disc drawn from it, never an e-mail; the item it duplicates from the site's items by key or words, and labels from the account's, with a new one made from what you type. The [API reference](../reference/formats.md#deleting-an-item) says what goes and when. A comment or a file body of `-` is read from standard input, and `--attach <file>` adds files to `p99 file` and `p99 comment`: images, PDFs, text, CSV, JSON, zip and office files, up to 20 MiB each.

## JSON for scripts

![p99 list --json on sample data: items across example.com and shop.example.com](../images/list-json.png)

Every command takes `--json` and then prints one JSON document on standard output: `p99 list --json` prints `{"issues":[…]}` with each item's summary, and `p99 show --json` the whole thread, `{"issue","comments","attachments","events"}`. The objects are the Worker's own, described field by field in [the API reference](../reference/formats.md#items):

```sh
p99 list --all --json | jq -r '.issues[] | select(.unread) | .key'
```

## Next

- [Let agents work the inbox](agents.md): the same commands, marked as an agent's.
- [Announce builds and landings](announce.md): show on each item where its fix is.

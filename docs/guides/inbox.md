---
title: Work your cards
description: Read, answer, assign and close cards in p99 tui or with the CLI, and read them as JSON in scripts.
sidebar:
  order: 4
---

![A thread in p99 tui: a card with its comments, an agent's reply and where its fix has landed](../images/thread.png)

Every card people file lands in its space, and you see them all, across the projects your code reaches. Work it in the terminal UI, or one command at a time from the CLI.

## Cards

A card is a `bug`, `feature` (an idea), `improvement`, `question` or `task` (tasks are filed by Owners). Its key is a prefix and a number, `BUG-12`, `FEAT-7`, `IMP-5`, `Q-10`, `TASK-6`, over one numbering per space: any prefix with the right number, or the bare number, names the same card, so `12`, `bug-12` and `BUG-12` all work.

A card carries one **label**, its state: the lanes of the space's one board, `New`, `Planned`, `In progress`, `Needs you`, `Stuck`, `Landed` and `Done`, each renameable. A new card gets New, and Done **closes** it; a closed card says how it ended: `fixed`, `abandoned` (dropped) or `duplicate` (of another card). Users see their own words in the panel: Received while the card is in New, In progress in any other open lane, then Fixed, Dropped or Duplicate. Every change is recorded as an event, and the person who filed it is mailed about replies and about the card closing or reopening when mail is on; other lane changes mail no one.

## The one board

Each space has one board. Its seven lanes are the labels above, and it shows every card an Owner may see; an Owner scoped to some hosts sees only theirs. The order within a lane is the space's one priority, the top mattering most, and every Owner moves cards between lanes and within one. Users don't see the board.

In the panel, an Owner's list starts with two choices. **Show** is Only this website (its cards, the first choice), Projects (the cards of the projects ticked below it, from every site), Needs you (the cards waiting on an Owner) or Landed, waiting for your check (cards whose fix landed, across projects). **Last change by** is Everyone, People or Agents, by who made the latest change. A card from another site opens on that site in a new tab. The board overlay keeps to the same choice and, for any but Only this website, says "showing …" while it does. The choice stays in that browser; visitors see neither.

```sh
p99 board
p99 board --project Splicer --project Paper --host example.com
p99 card move BUG-12 --to in-progress
p99 card move BUG-12 --to "In progress" --after BUG-9
p99 labels
p99 labels rename needs-you "Waiting on me"
```

`p99 board` prints each lane as `Name (count)` with its cards below, each with its project; `--project` repeats and keeps those projects' cards, and `--host` one host's cards. `--to` takes a lane's word (`new`, `planned`, `in-progress`, `needs-you`, `stuck`, `landed`, `done`) or its name, in any case; `--before` or `--after` also places the card beside another in that lane. `p99 labels` lists the seven lanes with their words, and `p99 labels rename` renames one, by its name or its word, for everyone; the word stays.

Before 1.11 each Owner had boards of their own. Deploying 1.11 folds them into the one board, after `p99 migrate --plan` shows how ([deploy](deploy.md)): each card keeps its lane or gets the one its old column maps to, with a `label` event naming the old column, and the order of the oldest Owner's boards comes first. The same deploy then deletes the old boards and the labels that aren't lanes, after carrying onto the one board any card or place only they still held; the plan names each, and nothing is archived. A Worker not deployed since answers `p99 board` with `p99: this Worker still has a board per person; run p99 deploy for the one board`.

## The TUI

```sh
p99
```

`p99` alone, in a terminal, opens the TUI, as `p99 tui` does; its flags (`--space`, `--agent`) go with `p99 tui`. Piped or in a script, a bare `p99` prints clap's short error and exits 2 instead of waiting on a screen.

The header of every screen names the space. The Cards screen lists the open cards of every host, newest activity first, with a dot on the unread ones and each card's label; the line under the tabs counts the cards shown, out of those in the host and projects chosen, and the unread. `tab`, or `1`, `2` and `3`, switch between the Cards, Board and Codes screens.

| Key | In the list |
| --- | --- |
| `↑` `↓` | move |
| `enter` | open the card |
| `/` | filter by text as you type; `esc` clears it |
| `s` | show open, closed, or open and closed cards, in turn |
| `h` | show every host, or pick one, when there is more than one |
| `p` | narrow to one project or several; the line under the tabs says `in Storefront`, and `esc` or `All projects` clears them |
| `w` | the cards waiting on you, in the projects chosen |
| `S` | with more than one space configured, show every space, then each one in turn |
| `r` | read the list again, keeping it on screen |
| `?` | every key of the screen |
| `ctrl+c` twice | quit |

| Key | In a card |
| --- | --- |
| `r` | write a reply; `enter` sends it, `esc` drops it |
| `i` | make the next reply internal (Owners only see it), or not |
| `m` | move it to a lane; `Drop` closes it without fixing, `Duplicate of…` asks for the card it duplicates |
| `a` | assign it to someone, or to no one |
| `o` | open the card's page in the browser, when it has one |
| `d` | delete it for good, with its comments and files: type its key back, then `enter` |
| `↑` `↓`, `space`, `g`, `G` | scroll |
| `ctrl+r` | read the card again |
| `esc` | back to the list |

A card shows its kind, label, host and environment, the page it was filed on (none for a card filed from the terminal or by an agent without a page), who filed it, its text, its comments with their files, where its fix has landed, and its events.

The Board screen shows the one board: its seven lanes and their cards, in the space's order. A move made elsewhere slides into place as it happens. When a card moved before your drop landed, the board says "this card moved; refreshed" and reads it again. The header counts what waits on you (Needs you, Stuck and Landed) beside the licence, none at 0, and `w` lists those cards.

| Key | On the board |
| --- | --- |
| `←` `→` `↑` `↓` | move between cards |
| `space` | pick up a card; the arrows carry it, `enter` drops it, `esc` puts it back |
| `enter` | open the card |
| `p` | narrow the board to one project or several |
| `w` | the cards waiting on you |
| `S` | with more than one space configured, show every space, then each one in turn |
| `r` | read the board again |

The mouse drags cards too.

## The CLI

The same work, one command at a time:

```sh
p99 list example.com
p99 list --all --status any --kind bug
p99 list --mine -q checkout
p99 show BUG-12
p99 card comment BUG-12 "Fixed on dev, can you check?"
p99 card comment BUG-12 "The cart caches the total." --internal
p99 card status BUG-12 done
p99 card status BUG-14 abandoned
p99 card status BUG-13 duplicate --duplicate-of BUG-12
p99 merge BUG-14 BUG-15 --into BUG-12
p99 assign BUG-12 @grace.hopper
p99 assign BUG-12 me
p99 assign BUG-12 --none
p99 list --all --label "In progress"
p99 card new --host example.com --kind task --title "Move product images to the new bucket"
p99 download 41 -o receipt.png
p99 delete BUG-16
```

`p99 card status BUG-12 done` is `p99 card move BUG-12 --to done`; `abandoned` and `duplicate` close a card that way too. `p99 card new` files a card on a site with `--host` (`--page` names the page it is about, and without it the card is on no page) or in a project with `--project`, with `--kind`, `--title`, `--body` and `--attach`. The commands before the fold, `p99 file`, `p99 comment`, `p99 status` and `p99 move`, still run for one release and print their new name.

`p99 list` takes a host and `--project <name>` (repeatable); without either it lists every host of the space, and `--all` every host of every space in the config. `--status` is `open` (the default), `closed` or `any`, `--label` keeps one label, and `--limit` caps the lines at 50 unless you raise it. Its lines read:

```text
*BUG-11   New         shop.example.com The total does not update after removing a line  [4 comments]
 TASK-6   In progress shop.example.com Move product images to the new bucket  -> ada@example.com
 BUG-8    In progress dev.example.com Search box loses focus on mobile  -> ada@example.com  [3 comments]  fixed on a branch
 IMP-5    In progress shop.example.com Show delivery dates on product pages  -> ada@example.com  landed: dev
```

Everyone is a username on the space, made from their name when they get a code (`Grace Hopper` is `@grace.hopper`); each person changes only their own ([usernames](../reference/formats.md#usernames)), and an agent acting for them shows as their name with 🤖, never a username of its own. `p99 assign` takes a username, with or without the `@`, or `me`; the assignee must hold a code for the card's site or be an Owner.

A `*` before the key marks it unread. `p99 show` prints the card, the commits that named it, its files with the ids `p99 download` takes, its comments (internal ones marked) and its events. `p99 delete` removes a card for good, with its comments, internal notes, history and every file, after you type its key back; `--yes` skips the question for scripts and agents, and without a terminal it is required. Cards merged into it reopen in New, and GitHub keeps its own issue. In the panel, an Owner finds **Delete** with the card's key at the bottom of a card, under Manage: type the key back, then hold the button until it fills, or press Enter. Manage picks the assignee from the people who hold a code for the site, each shown as @username with a disc drawn from it, never an e-mail; the card it duplicates from the site's cards by key or words, and labels from the space's, with a new one made from what you type. The [API reference](../reference/formats.md#deleting-a-card) says what goes and when. A comment or a file body of `-` is read from standard input, and `--attach <file>` adds files to `p99 card new` and `p99 card comment`: images, PDFs, text, CSV, JSON, zip and office files, up to 20 MiB each.

## JSON for scripts

![p99 list --json on sample data: cards across example.com and shop.example.com](../images/list-json.png)

Every command takes `--json` and then prints one JSON document on standard output: `p99 list --json` prints `{"issues":[…]}` with each card's summary, and `p99 show --json` the whole thread, `{"issue","comments","attachments","events"}`. The objects are the Worker's own, described field by field in [the API reference](../reference/formats.md#cards); the names `issues` and `issue` stay as they are:

```sh
p99 list --all --json | jq -r '.issues[] | select(.unread) | .key'
```

## Next

- [Let agents work your cards](agents.md): the same commands, marked as an agent's.
- [Announce builds and landings](announce.md): show on each card where its fix is.

---
title: Keep a plan as cards
description: File cards on sites and in projects, move them through the seven lanes of the one board and link them to requests and commits, from the CLI, as a person or an agent.
sidebar:
  order: 10
---

Everything people file is a card: from New card in the panel on a site, or with `p99 card new` from the terminal or an agent. You and your agents file cards on a site or in a project, move them through the seven lanes of the space's one board, and link them to what moved them: a request id, a commit, a tag or a URL. Users, the people with a code for a site, see only the cards they filed, in the panel; the board and the commands below are for Owners.

## The lanes

Each space has one board, and its lanes are the only statuses. Their words are fixed, by position:

| Word | Lane |
| --- | --- |
| `new` | 1, where a new card goes |
| `planned` | 2 |
| `in-progress` | 3 |
| `needs-you` | 4, Needs you: a person has to look |
| `stuck` | 5 |
| `landed` | 6 |
| `done` | 7, which closes the card |

`needs you`, with the space, is the same word as `needs-you`. Any other word is clap's `invalid value` error, exit 2, listing the seven.

Any Owner may rename the lanes (`p99 labels rename needs-you "Waiting on me"`); the words keep naming them by position. A card's priority is its place in its lane, one order for the whole space, which any Owner changes (`p99 card move FEAT-41 --to stuck --before FEAT-40`). Any Owner moves a card from lane to lane with `p99 card status`, `p99 card move`, or in the TUI. An agent can't close a card: `p99 card status <KEY> done` from an agent answers `p99: only a person closes a card`, and its `p99 card move` into the last lane answers `p99: only a person closes a card (403)`.

The one board shows every card; a filter narrows it (`p99 board --project Splicer`, `--host`). A close from anywhere else, such as a merge or a GitHub pull request, puts a card in the last lane, and a reopen puts it back on one of the others.

## Needs you

Anyone but a User may put a card in `needs-you`, an agent included; `--note` says what to look at in the same write:

```sh
p99 --agent=pci card status FEAT-41 needs-you --note "Look at the export clip: https://example.com/clip"
```

The card leaves Needs you by itself, back to the lane it came from, when a person (not an agent) comments on it, and whenever anyone sets its status. `p99 cards --waiting` lists what waits on a person, the cards in `needs-you`, `stuck` and `landed`, newest change first; its text output starts with the count (`3 cards wait on you`, or `nothing waits on you`). `--waiting` takes no other filter. A Worker deployed before Needs you answers `p99: this Worker has no Needs you list yet; run p99 deploy`.

## Commands

```sh
p99 card new --project Splicer --title "Export keeps every audio track" --body -
p99 card new --host shop.example.com --kind bug --title "The total does not update" --page /cart --attach receipt.png
p99 cards --project Splicer --status stuck --since 6h
p99 cards --waiting
p99 board --project Splicer
p99 card show FEAT-41
p99 card status FEAT-41 stuck --note "Waiting on the mixer"
p99 card move FEAT-41 --to in-progress --after FEAT-40
p99 card comment FEAT-41 "Found it." --internal
p99 card comment BUG-12 "Here is the log." --attach app.log
p99 card link FEAT-41 pci#2700 --note "Splicer export"
p99 projects
p99 edit BUG-12 --project Splicer
p99 edit BUG-12 --no-project
```

- `p99 cards` lists cards in lane order, every lane but `done` unless you name `--status`. `--project` and `--status` repeat. `--since` takes a time (`2026-10-22T08:00:00Z`) or an age (`90m`, `6h`, `2d`); `--source human` or `--source agent` keeps the cards whose last change was a person's or an agent's; `--limit` is 200 by default, up to 500, and `--cursor` reads on from `next_cursor`.
- `p99 card new` files the card in lane `new`, in the project `--project` names or on the site `--host` names; with both, it is in that project and shows in the panel on that site. `--page` names the page it is about; a card filed without one is on no page. `--attach` adds a file and repeats. `--kind` is `feature` when left out.
- `p99 card status` moves the card to the top of that lane; a card already there keeps its place. `--note` adds a comment in the same write.
- `p99 card move` puts the card in a lane by its word or its name (`--to`), at the top, or beside another card with `--before` or `--after`.
- `p99 card comment` answers a card; `--internal` makes it a note only Owners see, and `--attach` adds files.
- `p99 file`, `p99 comment`, `p99 status` and `p99 move` still run for one release and print their new name: `p99 card new`, `card comment`, `card status` and `card move`.
- `card new --body`, `card comment`'s text and `card status --note` take `-` to read standard input.
- A project name has 1 to 40 characters and is matched without regard to case; the first spelling used is kept.
- `p99 edit --project` files a card under a project, and `--no-project` takes that name off again, leaving the card in its site's project; the card keeps its lane either way.
- `p99 board` prints the one board: each lane as `Name (count)`, then its cards with their project. [Work the inbox](inbox.md#the-one-board) has the rest.

In text, an agent's action reads as the person's name with 🤖 (`Ada Lovelace 🤖`), with its label after `via` in `p99 card show`. Mark an agent as [the agents guide](agents.md) says.

## JSON

With `--json`, standard output carries one JSON document: `{"cards":[…],"next_cursor":…}` for `p99 cards`, `{"count":n,"cards":[…]}` for `p99 cards --waiting`, `{"board":{"lanes":[{"word","label","closes"}]},"cards":[…]}` for `p99 board`, `{"card":…,"comments":[…],"events":[…]}` for `p99 card show`, `{"card":…}` for `card new`, `card status` (with `"comment"` after `--note`) and `edit --project`, `{"key","comment"}` for `card comment`, `{"key","link"}` for `card link` and `{"projects":[{"name","open","done"}]}` for `p99 projects`. A card carries `key`, `kind`, `project`, `status` (the word), `label` (the lane's name), `lane` (its place among the cards you can see, `null` when done), `title`, `host`, `reporter` (the person who filed it), `created_at`, `changed_at`, `changed_by`, `comments` and `links`. People are `{"name","username","agent","via"}`; e-mails never appear.

## Errors

A command line P99 can't parse exits 2 with clap's message on standard error. A refusal exits 1 with one line, such as `p99: only a person closes a card` or `p99: a project name has 1 to 40 characters`. A Worker deployed before cards answers `p99: this Worker has no cards yet; run p99 deploy`.

---
title: Keep a plan as cards
description: File cards in projects, move them through six lanes and link them to requests and commits, from the CLI, as a person or an agent.
sidebar:
  order: 10
---

A card is an item with a project. You and your agents file cards with `p99 card new`, move them through the six lanes of the account's Cards board, and link them to what moved them: a request id, a commit, a tag or a URL. Only managers see cards; a site's visitors never do.

## The lanes

The Cards board is made the first time someone files a card. Its lanes have fixed status words, by position:

| Word | Lane |
| --- | --- |
| `new` | 1, where a new card goes |
| `planned` | 2 |
| `in-progress` | 3 |
| `stuck` | 4 |
| `landed` | 5 |
| `done` | 6, which closes the card |

The board's owner may rename the lanes; the words keep naming them by position. A card's priority is its place in its lane, which only the board's owner changes (`p99 move`). Any manager moves a card from lane to lane with `p99 card status`, or in the TUI thread's move picker, which offers a card the Cards lanes and a plain item the labels of your other boards. An agent can't close a card: `p99 card status <KEY> done` from an agent answers `p99: only a person closes a card`, and its `p99 move` into the last lane answers `p99: only a person closes a card (403)`.

The Cards board shows cards only, and every other board only plain items, so a site's reports and your cards never mix. A card stays on its lanes: a close from anywhere else, such as a merge or a GitHub pull request, puts it in the last lane, and a reopen puts it back on one of the others.

## Commands

```sh
p99 card new --project Splicer --title "Export keeps every audio track" --body -
p99 cards --project Splicer --status stuck --since 6h
p99 card show FEAT-41
p99 card status FEAT-41 stuck --note "Waiting on the mixer"
p99 card comment FEAT-41 "Found it." --internal
p99 card link FEAT-41 pci#2700 --note "Splicer export"
p99 projects
p99 edit BUG-12 --project Splicer
p99 edit BUG-12 --no-project
```

- `p99 cards` lists cards in lane order, every lane but `done` unless you name `--status`. `--project` and `--status` repeat. `--since` takes a time (`2026-10-22T08:00:00Z`) or an age (`90m`, `6h`, `2d`); `--source human` or `--source agent` keeps the cards whose last change was a person's or an agent's; `--limit` is 200 by default, up to 500, and `--cursor` reads on from `next_cursor`.
- `p99 card new` files the card in lane `new`; `--kind` is `feature` by default and `--host` the account's oldest host.
- `p99 card status` moves the card to the top of that lane; a card already there keeps its place. `--note` adds a comment in the same write.
- `card new --body`, `card comment`'s text and `card status --note` take `-` to read standard input.
- A project name has 1 to 40 characters and is matched without regard to case; the first spelling used is kept.
- `p99 edit --project` turns any item into a card in lane `new`, and `--no-project` turns it back into a plain item, in Inbox; on an item that is no card it says `<KEY> is not a card` and changes nothing.

In text, an agent's action reads as the person's name with 🤖 (`Ada Lovelace 🤖`), with its label after `via` in `p99 card show`. Mark an agent as [the agents guide](agents.md) says.

## JSON

With `--json`, standard output carries one JSON document: `{"cards":[…],"next_cursor":…}` for `p99 cards`, `{"card":…,"comments":[…],"events":[…]}` for `p99 card show`, `{"card":…}` for `card new`, `card status` (with `"comment"` after `--note`) and `edit --project`, `{"key","comment"}` for `card comment`, `{"key","link"}` for `card link` and `{"projects":[{"name","open","done"}]}` for `p99 projects`. A card carries `key`, `kind`, `project`, `status` (the word), `label` (the lane's name), `lane` (its place among the cards you can see, `null` when done), `title`, `host`, `reporter`, `created_at`, `changed_at`, `changed_by`, `comments` and `links`. People are `{"name","username","agent","via"}`; e-mails never appear.

## Errors

A command line P99 can't parse exits 2 with clap's message on standard error. A refusal exits 1 with one line, such as `p99: no item FEAT-99`, `p99: BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name>` or `p99: a project name has 1 to 40 characters`. A Worker deployed before cards answers `p99: this Worker has no cards yet; run p99 deploy`.

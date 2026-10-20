---
title: Link a site to GitHub
description: Open a GitHub issue for an item, and let a merged pull request or a closed issue mark the item fixed.
sidebar:
  order: 9
---

P99 links each host to one GitHub repository, and keeps the link small: `p99 github open` opens a GitHub issue for an item, and a webhook marks the item fixed when a pull request that names it merges or its issue is closed. Nothing else syncs.

## 1. Make a token

On GitHub, Settings, Developer settings, Fine-grained tokens, make a token for the repository with:

- **Issues: read and write**, to open issues;
- **Webhooks: read and write**, so P99 can add the webhook itself (without it, P99 prints the steps to add it by hand).

Keep it in 1Password or in an environment variable; P99 takes it as a reference, never as text on the command line.

## 2. Link the host

```sh
p99 github set example.com --repo acme/shop --token-ref op://vault/item/field
p99 github set example.com --repo acme/shop --token-ref env:GITHUB_TOKEN
```

```text
example.com is linked to acme/shop; the token is the Worker's secret GITHUB_TOKEN_A379A6F6EEAFB9A5
webhook 501 on acme/shop sends pull requests and issues to https://example.com/_p99/v1/github
```

It checks that the token sees the repository, puts the token and a new random webhook secret into the Worker as secrets (never into the config), and adds or updates the repository's webhook: JSON, the events Issues and Pull requests, signed with that secret. Running it again makes a new secret and updates the webhook. Each host has its own token and secret, so two hosts can point at two owners' repositories.

`p99 github show` lists the linked hosts (`--json` for scripts). `p99 github off example.com` removes the webhook, the link and both secrets; the links already on items stay.

## 3. Open an issue for an item

```sh
p99 github open BUG-12
```

```text
BUG-12: opened https://github.com/acme/shop/issues/88
```

The issue takes the item's title, and its body holds only the item's key and its link (the page with `#p99=BUG-12`, which opens the panel on that item). The reporter's e-mail, the details and internal notes stay in P99. Running it again prints the same issue.

## 4. Fix by pull request

Name the item in the pull request's title, description or commits, with the trailers `p99 announce` reads:

```text
Keep the cart total in step after a remove

Fixes: BUG-12
Refs: FEAT-7
```

- When a pull request with `Fixes: BUG-12` **merges**, P99 moves BUG-12 to Done with the resolution fixed, as a manager's move would: an event on the item, a live update, and the reporter's status mail when mail is on.
- When an issue opened with `p99 github open` is **closed** as completed, its item is marked the same way. An issue closed with the reason `not_planned` changes nothing.
- `Refs:` only records the pull request on the item.

Only items of the host the webhook belongs to are touched; a key of another host is skipped. Each delivery is checked against the `X-Hub-Signature-256` signature and counted once by its delivery id, so a redelivery from GitHub does nothing. Every other event is answered 204 and ignored.

## Where the links show

`p99 show` lists an item's GitHub issue and pull requests, the TUI shows a "GitHub" line in the thread, and the panel shows them to managers. In JSON, an issue's `github` is `[{"kind":"issue"|"pull","rel":"opened"|"fixes"|"refs","repo","number","url","at"}]`, empty for anyone but a manager.

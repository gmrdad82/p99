---
title: Announce builds and landings
description: Name items in commit trailers and run p99 announce after each deploy, so every item shows when its fix is on dev and in production.
sidebar:
  order: 6
---

P99 shows on each item where its fix has **landed**: on a branch only, on dev, in production. It learns this from your commits: you name items in their trailers, and each deploy runs `p99 announce`, which tells P99 which environment the build reached.

## 1. Name items in commits

Add a `Fixes:` or `Refs:` trailer to the commit message, in the last paragraph:

```text
Keep the cart total in step after a remove

Fixes: BUG-11
Refs: FEAT-7, IMP-5
```

- `Fixes:` says the commit fixes the item; the item **lands** in an environment when a counted build there carries the commit.
- `Refs:` links the commit to the item without fixing it; it shows in the item's commits and never lands it.

Any prefix with the right number names the item (`BUG-11`, `TASK-11`), and one trailer can name several, separated by commas or spaces. P99 reads git's own trailers, so `git commit --trailer "Fixes: BUG-11"` writes one too.

## 2. Know your environments

Every host has one environment, and every environment has a kind:

- a **`development`** environment counts the build of the branch `main` (an item fixed only on another branch shows "fixed on a branch");
- a **`release`** environment counts its latest announced build, whatever its branch.

`p99 setup` and `p99 hosts add` create the environments your hosts name: `production` is a `release`, an environment such as `dev` a `development` one. Environments are shown in the order they were created, so an item reads `landed: dev, production`.

## 3. Announce each deploy

Run `p99 announce` from the checkout you deployed, right after the deploy:

```sh
p99 announce dev.example.com
p99 announce example.com --env production --version v1.4.0
```

```text
announced 4f1c2a9e main v1.4.0 to production: 3 items (2 fixes)
```

It reads the last 500 commits (or the git range `--rev` names, such as `v1.3.0..HEAD`), collects their trailers, and posts the build: its commit, branch, version (`git describe --tags --always` unless `--version` says otherwise) and whether the checkout had uncommitted changes. The environment is the host's, or `--env`; with neither, the space's only host decides. `--branch` overrides the branch git reports, for a CI checkout on a detached head.

Announcing again replaces that environment's build for that branch, so running it twice is harmless. The first time an item lands in an environment is an event on the item, and an environment with `notify` set mails the reporter then, when mail is on.

## From CI

A CI job needs only the space's signing key and a host, not the Cloudflare token. Keep the key in the CI's secret store and write a config for the job:

```sh
umask 077
cat > "$RUNNER_TEMP/p99.toml" <<EOF
[me]
name = "Release bot"
email = "releases@example.com"

[spaces.main]
account_id = "3f9c2a7d41e84b6a9d0c5e1f72a8b4c6"
token = ""
key = "$P99_KEY"

[hosts."example.com"]
space = "main"
env = "production"
EOF
P99_CONFIG="$RUNNER_TEMP/p99.toml" p99 announce example.com --branch "$GITHUB_REF_NAME"
```

Check the whole history out (`fetch-depth: 0` in `actions/checkout`), so `git describe` and the 500 commits are there. A host behind Cloudflare Access needs the space's `url` or an Access service token too ([Put P99 on a site](site.md#6-hosts-behind-cloudflare-access)).

## A feed of fixes

`p99 feed on example.com` serves `https://example.com/_p99/feed`, an Atom feed of the items whose fix reached a release environment (`?format=json` for a JSON Feed), with each item's key, kind, title and date only. It is off until you turn it on, and `p99 feed off example.com` turns it off again ([the API reference](../reference/formats.md#the-fixed-feed)).

## Read the landings

`p99 list` ends each line with where the item has landed, `p99 show` lists its commits with the environments each reached, and the TUI shows a "Landed" line on every item. In JSON, a summary's `landing` is `{"branch", "envs": [{"env","kind","at","sha","version"}]}` ([the API reference](../reference/formats.md#environments-and-landings)).

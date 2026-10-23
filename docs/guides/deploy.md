---
title: Deploy updates
description: Upgrade the P99 Worker on each Cloudflare account with p99 deploy after installing a new p99, and see what a build carries with p99 bundle.
sidebar:
  order: 8
---

The Worker is built into the `p99` binary: each version of `p99` carries the Worker of the same version, its web files and its database migrations. So upgrading P99 is two steps: install the new binary, then deploy it to each account.

## See what this build carries

```sh
p99 bundle
```

```text
P99 0.1.0: the Worker this build uploads (main module worker.js)
  worker.js                                    108462 bytes  f42d92d3…  application/javascript+module
  mail.js                                        2600 bytes  d54d3c92…  application/javascript+module
  web/p99.js                                     3333 bytes  bb73b663…  text/plain
  web/panel.js                                  74458 bytes  ee44a630…  text/plain
  web/p99.css                                   27189 bytes  93828479…  text/plain
  web/vendor/modern-screenshot-4.7.0.js         29290 bytes  bb366658…  text/plain
  web/art/concrete.svg                           1629 bytes  16cd5994…  text/plain
  web/art/concrete-dark.svg                      1629 bytes  ec24e7ad…  text/plain
migrations
  0001_p99.sql
```

It lists every module with its size and SHA-256, and the migrations, without touching Cloudflare; `--json` prints the same as `{"version","main","modules","migrations"}`.

## Deploy

After installing a new `p99` ([Install](../install.md)):

```sh
p99 deploy
p99 deploy --account shop
```

`p99 deploy` works on one account, the default one or the one `--account` names. It:

1. applies the migrations the database hasn't had yet, in order, recording each in `d1_migrations` (the ones that change data wait for an accepted plan: [Upgrading to 1.9](#upgrading-to-19));
2. uploads the Worker with its bindings, keeping its secrets (`KEY_P99`, `MANAGERS`, the mail key) as they are, and creates its Durable Object, `P99Hub`, the first time (a Worker set up before P99 had live updates gets it on its next deploy, and `p99 watch` asks for one until then);
3. checks each host's route `<host>/_p99/*` and adds a missing one;
4. gives the P99 page its address: the route `<app>/*` when the account sets `app` in the config, or else the Worker's `workers.dev` address, which it turns on, and prints it (`p99 app` prints it later);
5. checks that every host answers the new version on `/_p99/health`.

Before its first write it reads everything it needs: the migrations already applied, the plan when one is needed, the Worker's bindings and secrets, the account's zones, each host's zone and routes, and the P99 page's address. A deploy refused on any of those (a plan not accepted, a hash that no longer matches, a token Cloudflare turns away on one of those reads, a rate-limiting namespace it can't pick, a host on no zone the token reaches, a route another Worker already holds) changes nothing: no migration, no table, no upload, no secret and no route. Cloudflare only checks a write permission on the write itself, so a token that can read but not edit the Worker, its secrets or its routes is turned away after the migrations are in, and the account keeps them. The Worker stays as it was when its upload was the write refused; when a secret or a route was refused, the new Worker is already up. Run `p99 deploy` again with a token that can write them; it needs no `--accept-plan` then, since nothing is left to accept.

It fails, naming the hosts, when a route can't be added or a host doesn't answer the new version; `--no-check` skips the health check. `--json` prints a report with the modules, the migrations applied, each route and each host's health, and `"ok"`.

Run it once for each account in the config. The loader is cached for five minutes and every other file is fetched by version, so pages pick up the new panel within five minutes of a deploy, with nothing to purge.

## Upgrading to 1.9

1.9 changes data, not only the schema: each item gets one label from its 1.8 status, nested boards become separate boards with an owner, priority becomes each column's card order, and every person gets a username. So `p99 deploy` (and `p99 setup`, when it applies migrations) doesn't apply migrations 0011 to 0013 to an account that holds 1.8 data until that account's plan is accepted.

It works the same from 1.7, in one deploy: an account on 1.7 goes straight to 1.9, with no 1.8 deploy in between. Its plan covers 0004 to 0013 together, and 0004 waits for the accepted plan too, since it changes data as well: each 1.7 status becomes a 1.9 label and the stage reporters see (new: Inbox, received; confirmed and in progress: Doing, in progress; waiting: Review, in progress; resolved: Done, fixed; abandoned: Done, dropped; duplicate: Done, duplicate), and each host gets one home board, owned by the account's first Owner code that isn't revoked, with each column's cards newest first. The other migrations in between (0005 to 0010) add tables, columns and indexes only, so they need no plan of their own: once the plan is accepted, `p99 deploy` applies them in the same run, in order. An account cut off after 0004 reads its plan the same way, as 0005 to 0010 would leave it, and a deploy there without the accepted plan writes nothing.

1. Read the plan. It only reads the database, through the same Cloudflare API calls `p99 setup` uses, and changes nothing:

   ```sh
   p99 migrate --plan
   p99 migrate --plan --account shop --json
   ```

   It shows, for that account: how each 1.8 status maps to a label (on 1.7, each 1.7 status with its label and stage) and how many open items each holds; every board, nested ones included, and who would own it (1.8 kept no board creator, so the account's first Owner code that isn't revoked; on 1.7, each host's home board), and a decision when one person would own more than 3 boards in one space (one site, or every host), the most a person may have there; how many cards change place in each column as priority becomes order; the tags beyond each item's label, which nothing reads and 0017 deletes; the members whose 1.8 status changes only Owners make from 1.9 on; label names that would collide; the usernames that get a number or fall back, and how many people rows are created (the hash covers every default username, through the people digest); the people who act through agents and the @username* they show under; the kinds with their key counts; and the hosts' settings, which carry over. It ends with the decisions needed, one line each, and the plan hash, the SHA-256 of the plan's JSON with its keys sorted.

2. Answer the decisions (mint an Owner code, rename a tag, remove a board) and read the plan again: any change to the data gives a new hash.

3. Deploy with the hash:

   ```sh
   p99 deploy --accept-plan <hash>
   ```

   Deploy works out the plan again first and refuses when the hash is missing or no longer matches the database, and refuses at once a hash that isn't the 64 characters the plan ends with. A deploy refused for its plan or its hash changes nothing on the account, not even the migrations that need no plan. A new account, or one already past every migration that changes data (0017 is the last), needs no `--accept-plan`; one on 1.7, 1.8, 1.10 or 1.11 does.

On an account past 0011 with migrations still to run before 0017, `p99 migrate --plan` also says how many old tag rows (the `item_labels` rows beyond each item's label) are still there, as tags on items, and its `--json` gives them as `old_tags` (`items`, `tags`). Nothing reads them, and 0017 deletes them. Once 0017 is the only migration left (an account on 1.11), its section of the plan (`delete_archived` in `--json`) counts them instead, with each board and label it deletes and each item it first carries onto the one board. When the Cards board doesn't have seven lanes, the plan stops with that reason and deploy deletes nothing.

0017 drops the archive table the 1.11 Worker still reads, and deploy uploads the new Worker right after the migrations. If a deploy stops between the two (a failed upload), the board list of the Worker still running answers an error until `p99 deploy` runs again.

## Upgrading to 1.11

1.11 folds each Owner's boards into the account's one board (0016), which changes data, so it waits for an accepted plan the same way: read `p99 migrate --plan`, then run `p99 deploy --accept-plan <hash>`. An account last deployed with 1.9 doesn't have 0014 and 0015 yet. They add columns and indexes only, and every board starts as not the Cards board, so the plan reads the boards as they would leave them, and the accepted deploy applies 0014, 0015, 0016 and 0017 in order. A deploy there without the accepted plan writes nothing, 0014 and 0015 included.

## Change the setup

`p99 deploy` changes only the Worker and its database. To change the token, mail, the hosts or the names of the Worker, database or bucket, run `p99 setup` again: it checks each step and does only what is missing. To change a host's button, theme or words, use `p99 hosts set` ([Put P99 on a site](site.md)).

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

1. applies the migrations the database hasn't had yet, in order, recording each in `d1_migrations`;
2. uploads the Worker with its bindings, keeping its secrets (`KEY_P99`, `MANAGERS`, the mail key) as they are, and creates its Durable Object, `P99Hub`, the first time (a Worker set up before P99 had live updates gets it on its next deploy, and `p99 watch` asks for one until then);
3. checks each host's route `<host>/_p99/*` and adds a missing one;
4. checks that every host answers the new version on `/_p99/health`.

It fails, naming the hosts, when a route can't be added or a host doesn't answer the new version; `--no-check` skips the health check. `--json` prints a report with the modules, the migrations applied, each route and each host's health, and `"ok"`.

Run it once for each account in the config. The loader is cached for five minutes and every other file is fetched by version, so pages pick up the new panel within five minutes of a deploy, with nothing to purge.

## Change the setup

`p99 deploy` changes only the Worker and its database. To change the token, mail, the hosts or the names of the Worker, database or bucket, run `p99 setup` again: it checks each step and does only what is missing. To change a host's button, theme or words, use `p99 hosts set` ([Put P99 on a site](site.md)).

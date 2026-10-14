# Changelog

All notable changes to P99 are listed here, newest first.

## v1.0.0 — 2026-10-14

The first release of P99: issue and feedback reporting for any website, on Cloudflare alone.

### Added

- A loader of 2,032 bytes gzipped, one script tag, that draws a "?" in its own Shadow DOM for the people you invite and does nothing for anyone else; it works under a strict Content-Security-Policy.
- A panel that loads on the first click: file a bug, an idea, an improvement, a question or a task with a capture of the screen, the whole page or marked regions and files, then follow the replies, the status and where the fix has landed.
- Captures that blank fields marked `data-p99-redact` and every password field, keep page addresses without their query and hash, and stay off the pages a site lists.
- Personal codes instead of accounts: `p99 invite` mints a code and a link that carries it in the fragment, so it never reaches a server log; codes are revocable and rate-limited.
- One Cloudflare Worker, D1 database and R2 bucket per account, on a `/_p99/*` route in front of each site, with weekly backups into R2.
- `p99 setup`, which explains the Cloudflare token and each permission, checks them, and creates the database, the bucket, the Worker, its keys and the routes; it is safe to run again and takes a second account beside the first. `p99 deploy` uploads a new version and keeps every secret.
- `p99 tui`, the inbox across every site and account, with each item's host, threads, replies, internal notes, status, assignee and the invited people.
- The CLI for people and agents: hosts, invite, invites, revoke, list, show, file, comment, status, assign, download, announce, import and bundle, every one with `--json`. An agent acting for you shows as your name with an asterisk.
- `p99 announce`, which reads `Fixes:` and `Refs:` commit trailers and shows on each item when its fix reached dev and production.
- `p99 import`, which brings items from another tracker with their keys, numbers, comments, files, events, landings and read states.
- Linux x86_64 and macOS Apple Silicon binaries, and a docs bundle for docs.pitomd.com, on every release.

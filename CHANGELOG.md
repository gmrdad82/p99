# Changelog

All notable changes to P99 are listed here, newest first.

## v1.1.6 — 2026-10-15

### Changed

- `p99 deploy` and `p99 setup` skip the health check of a host with no DNS record yet, with a note, instead of failing.

## v1.1.5 — 2026-10-15

### Changed

- The panel's title no longer shows a focus ring when a view opens.

## v1.1.4 — 2026-10-15

### Changed

- The button that files an item shows a "+" instead of a "?".
- The P99 logo in the panel's head keeps its own blue, white and font on every site instead of taking the host's theme colours.

## v1.1.3 — 2026-10-15

### Changed

- `p99 setup` checks a token's zone permissions only on the zones of the hosts named with `--host`, and never calls the API on any other zone of the account, so a token limited to those zones is accepted; a host whose zone the token can't see is named.

## v1.1.2 — 2026-10-15

### Added

- `p99 deploy` and `p99 hosts add` take `P99_TOKEN` from the environment over the configured token or its reference, so they run unattended without unlocking a password manager.

## v1.1.1 — 2026-10-15

### Changed

- The README's load times are the medians of five runs alternated with 1.0.6, replacing a single reading taken while the machine was busy.

## v1.1.0 — 2026-10-15

### Changed

- The Worker opens an item, files one and posts a comment with fewer database round trips: opening an item is one batch, filing one saves a trip.
- The loader stays within its 2 KB budget as browsers receive it: 2,030 bytes gzipped for a site with default placement.
- The "?" follows an `above` element at most once per animation frame while the page scrolls.
- `p99 invite` can be retried safely: the same invite never mints a second code. `p99 deploy` adds the column this needs to the codes table.

### Fixed

- Escape and bidi control characters in titles, comments and names are stripped when the Worker stores them and again before the CLI prints them, so a reporter's text can't drive a manager's terminal.
- Fields marked `data-p99-redact` are blanked in captures inside web components and same-origin frames too.
- An item's page link always points at its own site.
- Off-page patterns with regex characters such as `(` or `|` match exactly as written, and a host config whose patterns can't be matched is refused.
- Secrets in the CLI's config and setup no longer show through debug output.

## v1.0.6 — 2026-10-14

### Fixed

- Screen captures draw the image a page is actually showing inside a `<picture>` with responsive sources, instead of an empty frame.

### Changed

- The README and the docs show P99 on PITO MD's own site, pitomd.com: filing an idea on the Splicer page, the "?" kept clear of the site's back-to-top button, and the panel over light and dark sections.

## v1.0.5 — 2026-10-14

### Changed

- The architecture diagram labels the inbox p99 TUI, like p99 CLI beside it.

## v1.0.4 — 2026-10-14

### Fixed

- The "?" stays on the page on sites that swap their body as they navigate (htmx boost, Turbo, Swup, Barba), follows path changes to pages where P99 is off and back, and opens item links into the right place.
- The "?" moves above the site's own button only while that button is visible, and lands in the right place after the button's animation.
- Screen and whole-page captures finish in a fraction of a second on pages full of videos that don't preload and images that load lazily, instead of hanging.
- Sections with a textured SVG background keep their colour and texture in captures instead of turning black.
- A capture that can't finish stops after 10 seconds and says the item can be sent without it.

## v1.0.3 — 2026-10-14

### Changed

- The CLI and the TUI reach the Worker through any host of the account: the one a command names first, then production hosts, skipping one behind Cloudflare Access, and say plainly when every host is behind it.
- Each account can carry its own name and e-mail in `[accounts.<name>.me]`, so the same person acts under a different identity on another account; `p99 setup` writes it without touching the global `[me]`.
- `p99 setup` and `p99 deploy` report a host behind Cloudflare Access as expected, not as a failed health check.

## v1.0.2 — 2026-10-14

### Changed

- The panel leaves room between the P99 head and the first heading of every view.

## v1.0.1 — 2026-10-14

### Changed

- The docs bundle's front page keeps every README picture and leaves out the GitHub-only lockup, so docs.pitomd.com builds it.

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

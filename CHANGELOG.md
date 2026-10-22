# Changelog

All notable changes to P99 are listed here, newest first.

## v1.9.3 — 2026-10-22

### Fixed

- The TUI's lane header rule now runs the full width of its lane.
- The site button's "+" stays readable in dark mode on sites with an accent theme.

### Changed

- The TUI's licence badge sits at the right end of the header rule through pito-tui 1.1.0, and costs nothing per frame once it has eased in.
- `p99 migrate --plan` counts the old tag rows it would leave in place.
- The README's board and arrives clips show 1.9.2: label columns, a card carried and dropped, the board picker, a watched board, and an item arriving and opened.

## v1.9.2 — 2026-10-21

### Added

- Licence badges in P99's own flat style: Free, Studio, Agency, Owner and F&F. They show in `p99 tui`'s header, in `p99 license show`, on the P99 page and in the panel's head.
- The panel's head shows P99's lockup ("Issue & Feedback Reporter"), the site's licence badge and a small "by PITO.MD" link. An Agency or Owner key can hide the link with `p99 hosts set <host> --pitomd-link off`.
- Owner and friends-and-family keys: they read as Agency, the top tier, with their own badge.
- `p99 migrate --plan` also reads an account that is still on P99 1.7, and `p99 deploy` applies 1.7's data change only with the plan accepted.

### Changed

- A migration plan accepted with 1.9.0 or 1.9.1 must be read again with `p99 migrate --plan` before deploying; the old hash is refused, safely.

## v1.9.1 — 2026-10-21

### Fixed

- Typing in the panel's search no longer leaves it on its loading screen: every search ends in its results, a "No issues match" line, or an error with Retry. The search field keeps its text and focus while it looks.
- The panel shows it is working while it loads (a soft shimmer and a small spinner by the search field), says so when a load takes longer than a few seconds, and gives up with Retry after 20 seconds.

## v1.9.0 — 2026-10-20

### Added

- Boards are simpler: every item carries one label, its state (Inbox, Doing, Review and Done by default, each renameable), and a board is one person's set of 3 to 5 label columns in their own order. Moving a card changes the item's label, so a shared label such as "QA ready" hands work from one board to another. Others can watch any board, read-only.
- The P99 page: P99 also answers on the account's own address, so it stays reachable when a site is down. Sign in with your e-mail and the 6-digit code from your authenticator, then open each site's items and boards full-page, or set your username.
- Usernames with a generated avatar disc. Assignees are shown by username, never by e-mail.
- Access links by mail: `p99 invite` mails each person a button per site, and `p99 relink` gives someone a fresh link, revokes the old one and keeps their authenticator. `p99 link` opens your own link.
- `p99 delete <KEY>`, `d` in a thread and "Delete this item" in the panel remove an item with its comments, history and every file, behind typing the key back.
- Searchable pickers in the panel's Manage for the assignee and duplicate-of, and one "Move to" list that includes Drop.
- `p99 migrate --plan` shows, read-only, what this version's data changes would do on an account, and `p99 deploy` applies them only with `--accept-plan <hash>`.

### Changed

- Priority is the card's place in its column: the field, its filter and `p99 priority` are gone. Free-form tags are gone too; labels are the columns.
- Boards no longer nest; each 1.8 board becomes its own board.
- The panel, board, pickers and the P99 page share one spacing and type scale, with real empty, loading and error states, readable contrast in light and dark, and the same layout on phones and desktops.
- The P99 page draws its first screen in about 220 ms on a mid-range phone.
- Board loads and card moves are faster than in 1.8.

### Fixed

- A manager whose code covers one site can't change another site's items through a shared label, and sees only their own sites' label names.
- Uploaded files keep their own strict security policy on the P99 page's address.
- Sign-in tries are counted per IPv6 network, not per address.
- With reduced motion, nothing on the board animates.

## v1.8.3 — 2026-10-20

### Added

- Managers can delete an item: `p99 delete <KEY>`, `d` in a TUI thread, or "Delete this item" at the bottom of Manage in the panel, each behind typing the key back (or holding the button in the panel). Its comments, notes, events, labels, board place and every file go with it, and open boards and inboxes drop it live.

### Fixed

- A GitHub issue closed as a duplicate no longer marks its item fixed; only an issue closed as completed does.

## v1.8.2 — 2026-10-20

### Fixed

- An invite link that a page or an app changed on its way, written `#P99=`, ending in a full stop, or rewritten by a site script before P99 starts, still signs the person in.
- A link that needs the authenticator opens the 6-digit step by itself.
- A code P99 refuses (mistyped, revoked, or for another site) shows one short line by the button instead of nothing.
- The loader is smaller: 2,007 bytes gzipped.

## v1.8.1 — 2026-10-20

### Changed

- P99 says where to ask: "Got questions or doubts? Ping me on Discord" sits at the end of `p99 --help`, under the key hints in `p99 tui`, in the panel's footer for managers, and in the README and docs.
- The README links the commercial licence and shows P99 1.8.0's numbers as measured on 2026-10-20: sizes, browser times with the board, the Worker's local p50 and p99, CLI and TUI start-up, the board's frames while dragging, and the binary.

## v1.8.0 — 2026-10-20

### Added

- Boards: every item sits on one board in the column of its status, and a board can sit as a card in another board's column. Moving a board card moves everything on it, nested boards included, and each board card shows how much of it is done.
- The board in the manager's panel: drag cards with the mouse, a finger or the keyboard, open nested boards, and see moves made anywhere slide in live.
- The Board tab in `p99 tui`: drag cards with the keys or the mouse, open a board card or an item's thread, and follow moves live.
- `p99 move BUG-12 --to doing` and `p99 move board:<slug> --to done`, plus `p99 boards`, `p99 board` and `p99 statuses`, all with `--json`.
- Priority and labels on items, set by managers and used as filters in the inbox, `p99 list` and the panel.
- `p99 merge BUG-14 --into BUG-12` folds duplicates into one item; their reporters follow it and get its updates.
- Slack and Discord posts per site for new items, comments, status changes and shipped fixes: `p99 hooks set`.
- GitHub, kept small: `p99 github open BUG-12` opens a linked issue, and a merged pull request with `Fixes: BUG-12`, or the linked issue closing, marks the item fixed.
- Reporter mail on a reply, a status change and a shipped fix, in the site's colours with a plain-text part, a link that opens the item straight in the panel, and a one-click stop per item: `p99 email set`.
- An optional feed of fixed items per site, as Atom or JSON Feed: `p99 feed on <host>`.
- `p99 license set`, `show` and `remove` keep a Studio or Agency key, checked offline.

### Changed

- Statuses are one shared set, Inbox, Doing, Review and Done, each renameable; dropped and duplicate items are done with that reason, and the old status names still work in commands.
- P99 is licensed under the AGPL-3.0, with a commercial licence for closed or paid use, and outside contributions need the contributor licence agreement; versions up to 1.7.x stay MIT.
- Gates and releases run on PITO MD's own machines instead of GitHub's runners.

### Fixed

- A bare `p99 people` prints the short error, exit 2, instead of the whole help.

## v1.7.0 — 2026-10-19

### Changed

- `p99` on its own opens the inbox in the terminal, as `p99 tui` does (which still works); piped or in a script it prints the short usage error and exits 2, so nothing waits on a screen.

## v1.6.0 — 2026-10-16

### Added

- Events name the person who acted: the panel, `p99 show` and the TUI read "Ada Lovelace changed the status" where they showed an e-mail or "P99", and the API gives each event an `actor_name`. E-mails still show to managers only.

### Changed

- The panel opens lighter: its script and styles are 23.0 KB gzipped instead of 29.2 KB, and the form shows in 30.8 ms instead of 32.8 ms, because the capture and marking code now loads with the capture library just after the form appears.
- The TUI runs on pito-tui 1.0.3, with pito-list 1.0.2 under it.

## v1.5.3 — 2026-10-16

### Changed

- The TUI runs on pito-tui 1.0.2, with pito-header, pito-footer and pito-hourglass 1.0.1 and pito-list 1.0.1 under it.

## v1.5.2 — 2026-10-16

### Fixed

- The authenticator setup leads with the key to paste into a password manager or an authenticator app, and its `otpauth://` link now spells out SHA-1, 6 digits and 30 seconds, after a pasted link gave wrong codes in one password manager.
- The README gives the loader's size as served today: 2,044 bytes gzipped.

## v1.5.1 — 2026-10-15

### Changed

- `p99 watch` says on stderr when it reads the account key from the password manager, when it connects and when it reconnects, so a quiet stream reads as connected.

## v1.5.0 — 2026-10-15

### Added

- Changes arrive live: `p99 tui` reloads within about a second of a new item, comment, change or file, and the new `p99 watch` (with `--json` for agents and scripts) prints each one as it happens. A Durable Object holds the WebSocket. `p99 deploy` adds it to the account on the free plan, with the same token permissions.

## v1.4.2 — 2026-10-15

### Changed

- The panel's background shines like the P99 logo.

## v1.4.1 — 2026-10-15

### Changed

- The panel's texture drifts twice as far, about 60 pixels, on a 45-second loop, so the movement is easier to notice.

## v1.4.0 — 2026-10-15

### Added

- `p99 edit <KEY> --title … --text …` (or `--text-file`, `-` for standard input) changes an item's title or details. Managers can edit any item, and a reporter can edit their own while it is new. The item's history keeps the old and new text, an agent's edit carries its mark, and no one is mailed.

## v1.3.0 — 2026-10-15

### Added

- `p99 people rename <old> <new>` moves a person's items, assignments, comments, events, attachments and codes to a new e-mail on the whole account, in one transaction, keeping their links and authenticators.

## v1.2.1 — 2026-10-15

### Changed

- The panel's concrete texture drifts by a few pixels over a minute and a half, just enough to catch the eye, at almost no cost to the CPU or GPU; it stands still for people who ask their system for reduced motion.

## v1.2.0 — 2026-10-15

### Added

- A code can ask for a 6-digit code from an authenticator app the first time each browser uses it. `p99 invite … --totp` mints such a code, and `p99 invites totp <id>` adds an authenticator to a code someone already holds, keeping their link. The setup prints once, as an `otpauth://` link to paste into a password manager and as a setup key for authenticator apps. `p99 deploy` adds the tables this needs.

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

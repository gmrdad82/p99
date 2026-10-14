# Changelog

All notable changes to P99 are listed here, newest first.

## v1.0.0 — 2026-10-14

### Added

- The skeleton gains p99 tui, the client facade, the wire types with landings per environment, and 1Password references in their own module.
- The API docs gain the host config's placement and a signing test vector.
- The setup part's route function, for hosts add.

### Changed

- p99 begins.
- P99 takes shape.
- Waive the documented 1Password references in the public check.
- Waive the secret reference feature's lines in the public check, history included.
- Waive the first waiver file's own lines.
- The host contract.
- Format the wire types.
- Placeholder Worker modules so the binary's bundle builds before the Worker lands.
- The P99 mark, its dark version, the lockup and the icon, copied in by bin/marks.
- The marks script takes the brand masters' checkout from PITO_ASSETS.
- The p99 commands.
- p99 setup, adopt and deploy create and update an account's D1 database, R2 bucket, Worker, secrets and routes through Cloudflare's API.
- The Worker serves P99.
- p99 tui opens the inbox.
- Waive the secret reference lines in the Worker branch's history.
- Waive the secret reference lines in the TUI branch's history.
- The README for strangers, led by a clip of the inbox.
- p99 deploy --json and setup --json print one result object with progress on stderr, and p99 bundle lists the embedded build.
- The web part.
- Managers skip the daily limits, search ignores accents, mail keeps UTF-8 and agent labels, and the CLI passes Cloudflare Access.
- Waive the secret reference lines in the web branch's history.
- The TUI shows which host and environment an item is for, in the list and in the thread header.
- P99 drops adoption.
- Items carry their environment as env, the docs describe P99's own API only, and Cloudflare Access gets its setup notes.
- The config sample keeps its lines, so the documented secret reference stays where its waiver points.
- Waive the documented secret reference line in the branch's history.
- The Worker tests no longer expect item numbers to follow an older database.
- An agent acting for a person is a yes-or-no mark now, shown as the person's name with an asterisk in the panel, the TUI, the CLI and mail.
- Waive the config docs' secret reference line in an intermediate commit.
- The README's media.
- The demo's agent comment uses the agent marker.
- Waive the config docs' secret reference line in the media branch.
- The inbox clip and the thread and codes stills show each item's host and the agent marker.
- p99 import brings items from another tracker, keeping their keys, numbers, comments, files and history.
- The panel sends each file with its type, refuses types P99 doesn't take, keeps an item's page link on the site.
- The Worker refuses page paths that leave the host, files hung on someone else's comment.
- The TUI calls kinds and statuses by the panel's words (Idea, In progress, Dropped), filters without refolding every row on each keystroke.
- Attaching files from the CLI works, requests reuse one connection, deploy stops instead of dropping the rate limiter.
- Waive the config docs' secret reference line where it now sits.
- The invite link carries the code in its fragment so it never reaches a server's logs, the loader really redacts the page errors it keeps.
- Invite links carry the code in the fragment, so it never reaches a server log or a Referer.
- Waive the config docs' secret reference line in the loader branch.
- Stored codes are keyed hashes, signed requests carry only e-mail, name and the agent marker, reporters no longer see a manager's e-mail.
- The hosts guide lists what the panel sends with each item.
- Every release carries a docs bundle for docs.pitomd.com.
- The docs bundle's local-path guard no longer spells a home folder itself.
- Waive the docs bundle's first local-path guard pattern.
- The docs bundle writes every page's title, description and sidebar label as one quoted string, so a colon never breaks the site's build.
- Charts of what a page downloads and the TUI's frame times, drawn with pito-compare.
- Every CLI flag says what it does, and CI builds the docs bundle on every push.
- The README shows every feature with its picture and leads with the numbers.
- Prune the waivers that no longer match anything.

### Fixed

- The README GIF shows the web panel filing a bug on a sample shop and the item arriving in p99 tui, with light and dark stills of the panel.

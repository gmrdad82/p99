# Coverage

How much of P99's code its tests run, measured at every integration. There is no fixed threshold.

## How it's measured

- **Rust:** `cargo llvm-cov --summary-only` (through build-step). Lines and regions run by `cargo test`: the unit tests and tests/*.rs.
- **JavaScript:** V8's own block coverage, with no coverage library added. See [JavaScript](#javascript) below.

## Baseline, 2026-10-21 (P99 1.9.2 plus the merged 1.9.3 smalls, main 94cd963)

Rust: **18.9% of lines** (19.0% of regions, 21.6% of functions).

| File | Lines covered | Lines |
|---|---|---|
| src/app.rs | 83.22% | 143 |
| src/boards.rs | 15.86% | 309 |
| src/bundle.rs | 62.86% | 105 |
| src/cli.rs | 4.45% | 1102 |
| src/cli/delete.rs | 0.00% | 65 |
| src/cli/merge.rs | 0.00% | 100 |
| src/client.rs | 17.32% | 687 |
| src/cloudflare.rs | 41.64% | 538 |
| src/config.rs | 43.20% | 250 |
| src/docs.rs | 96.32% | 163 |
| src/email.rs | 0.00% | 228 |
| src/github.rs | 11.76% | 289 |
| src/hooks.rs | 0.00% | 109 |
| src/import.rs | 42.20% | 590 |
| src/license.rs | 67.01% | 485 |
| src/links.rs | 21.75% | 285 |
| src/main.rs | 38.46% | 26 |
| src/migrate.rs | 33.23% | 939 |
| src/setup.rs | 11.60% | 1431 |
| src/sign.rs | 100.00% | 29 |
| src/stream.rs | 0.00% | 179 |
| src/trailers.rs | 98.67% | 75 |
| src/tui.rs | 0.00% | 278 |
| src/tui/badge.rs | 0.00% | 108 |
| src/tui/board.rs | 0.00% | 1111 |
| src/tui/codes.rs | 0.00% | 172 |
| src/tui/deck.rs | 60.49% | 205 |
| src/tui/demo.rs | 0.00% | 359 |
| src/tui/demo/boards.rs | 0.00% | 269 |
| src/tui/inbox.rs | 0.00% | 1190 |
| src/tui/source.rs | 0.00% | 352 |
| src/vault.rs | 0.00% | 88 |
| src/wire.rs | 44.72% | 161 |

## w195 stories, 2026-10-22 (agent/stories-int, P99 1.9.2 plus the story train)

Rust: **48.3% of lines** (47.1% of regions, 51.1% of functions), up from 18.9%. The user stories in tests/stories_*.rs run the real `p99` binary against local stubs, and its coverage counts. 123 tests pass; 10 stories are known red and ignored until their bugs are fixed, so the lines only they reach aren't counted.

| File | Lines covered | Lines | Baseline |
|---|---|---|---|
| src/app.rs | 83.22% | 143 | 83.22% |
| src/boards.rs | 59.22% | 309 | 15.86% |
| src/bundle.rs | 72.38% | 105 | 62.86% |
| src/cli.rs | 33.21% | 1102 | 4.45% |
| src/cli/delete.rs | 0.00% | 65 | 0.00% |
| src/cli/merge.rs | 0.00% | 100 | 0.00% |
| src/client.rs | 60.84% | 687 | 17.32% |
| src/cloudflare.rs | 65.99% | 538 | 41.64% |
| src/config.rs | 84.40% | 250 | 43.20% |
| src/docs.rs | 96.32% | 163 | 96.32% |
| src/email.rs | 1.75% | 228 | 0.00% |
| src/github.rs | 11.76% | 289 | 11.76% |
| src/hooks.rs | 0.00% | 109 | 0.00% |
| src/import.rs | 42.20% | 590 | 42.20% |
| src/license.rs | 82.89% | 485 | 67.01% |
| src/links.rs | 21.75% | 285 | 21.75% |
| src/main.rs | 69.23% | 26 | 38.46% |
| src/migrate.rs | 34.29% | 939 | 33.23% |
| src/setup.rs | 23.69% | 1431 | 11.60% |
| src/sign.rs | 100.00% | 29 | 100.00% |
| src/stream.rs | 43.02% | 179 | 0.00% |
| src/trailers.rs | 98.67% | 75 | 98.67% |
| src/tui.rs | 30.58% | 278 | 0.00% |
| src/tui/badge.rs | 75.93% | 108 | 0.00% |
| src/tui/board.rs | 65.98% | 1111 | 0.00% |
| src/tui/codes.rs | 9.88% | 172 | 0.00% |
| src/tui/deck.rs | 90.24% | 205 | 60.49% |
| src/tui/demo.rs | 58.22% | 359 | 0.00% |
| src/tui/demo/boards.rs | 31.60% | 269 | 0.00% |
| src/tui/inbox.rs | 59.24% | 1190 | 0.00% |
| src/tui/source.rs | 75.28% | 352 | 0.00% |
| src/vault.rs | 7.95% | 88 | 0.00% |
| src/wire.rs | 81.37% | 161 | 44.72% |

What moved:
- **The TUI**, from 0%: board.rs 66%, inbox.rs 59%, source.rs 75%, badge.rs 76%, demo.rs 58% and tui.rs 31%. The triage and licence stories drive it with `--dump`/`--keys`.
- **The CLI and its client**: cli.rs from 4% to 33%, client.rs from 17% to 61%, wire.rs from 45% to 81%, stream.rs from 0% to 43%, and boards.rs from 16% to 59% (triage and safety stories).
- **Deploy and config**: config.rs from 43% to 84%, cloudflare.rs from 42% to 66% and setup.rs from 12% to 24% (deploy stories). license.rs went from 67% to 83% (licence stories).
- **Unchanged or barely moved**: cli/delete.rs, cli/merge.rs and hooks.rs at 0%; email.rs at 2%, github.rs at 12%, links.rs at 22%, import.rs at 42%, and migrate.rs at 34%. vault.rs is at 8% and tui/codes.rs at 10%.

JavaScript is still not measured. The Worker suite ran 113 checks and 8 known reds, and the browser stories ran 50 checks and 6 known reds.

## w197 TUI tests, 2026-10-22 (agent/cov-tui-i1, main 0eab3bb plus the TUI tests)

Rust: **61.4% of lines** (59.9% of regions, 64.4% of functions), up from 48.3%. Every TUI screen is driven in-process under `cargo test` with key, mouse and stream events on the sample data and pito-tui's injected clock, asserting on the drawn cells and styles; tests/tui_dump.rs runs the binary's `--dump`, `--keys` and `--bench` flags. 307 tests pass; the same 10 stories stay known red and ignored.

| File | Lines covered | Lines | w195 |
|---|---|---|---|
| src/tui.rs | 88.97% | 281 | 30.58% |
| src/tui/badge.rs | 99.34% | 305 | 75.93% |
| src/tui/board.rs | 97.85% | 1115 | 65.98% |
| src/tui/codes.rs | 97.67% | 172 | 9.88% |
| src/tui/deck.rs | 96.59% | 205 | 90.24% |
| src/tui/demo.rs | 100.00% | 359 | 58.22% |
| src/tui/demo/boards.rs | 90.71% | 269 | 31.60% |
| src/tui/inbox.rs | 97.32% | 1196 | 59.24% |
| src/tui/source.rs | 97.19% | 356 | 75.28% |

What is left in the TUI: tui.rs's real terminal run, its mouse-capture switch and the `--capture`/`--compare` error lines; source.rs's live stream thread, whose relay the tests drive directly; and demo/boards.rs's `const fn` sample rows, which the compiler evaluates, so no test run can count them.

## w197 CLI tests, 2026-10-22 (agent/cov-cli-i2, main edf87c6 plus the CLI tests)

Rust: **77.3% of lines** (76.0% of regions, 78.7% of functions) for the combined tree, up from 61.4% with the TUI tests alone; the CLI tests alone took it from 48.3% to 65.2%. tests/cli_*.rs run the real `p99` binary against an in-test HTTP stub that plays the signed Worker, Cloudflare, GitHub and Resend, with drops, 4xx, 5xx and garbled answers; `watch` runs against a local WebSocket stub, and the vault against a fake `op` on PATH. 442 tests pass; the same 10 stories stay known red and ignored.

| File | Lines covered | Lines | w195 |
|---|---|---|---|
| src/cli.rs | 88.32% | 1104 | 33.21% |
| src/cli/delete.rs | 56.92% | 65 | 0.00% |
| src/cli/merge.rs | 100.00% | 100 | 0.00% |
| src/client.rs | 87.92% | 687 | 60.84% |
| src/cloudflare.rs | 86.51% | 541 | 65.99% |
| src/config.rs | 93.08% | 318 | 84.40% |
| src/email.rs | 94.81% | 231 | 1.75% |
| src/github.rs | 99.38% | 325 | 11.76% |
| src/hooks.rs | 97.25% | 109 | 0.00% |
| src/links.rs | 84.91% | 285 | 21.75% |
| src/setup.rs | 27.18% | 1431 | 23.69% |
| src/stream.rs | 78.43% | 306 | 43.02% |
| src/vault.rs | 54.39% | 114 | 7.95% |
| src/wire.rs | 88.20% | 161 | 81.37% |

What is left in the CLI: delete's confirmation on a terminal (the tests have no TTY, so only `--yes` and the piped refusal run); setup's interactive walk; `watch`'s settle and longest-wait limits, since its reconnect tests wait out the real 1 s and 2 s backoff; and the deploy story's own runs, which clear the environment and so drop the coverage profile, slightly undercounting setup.rs and cloudflare.rs.
## w200 fixes train, 2026-10-22 (agent/fixes-i1, main 2812847 plus the story-bug fixes)

Rust: **78.8% of lines** (77.8% of regions, 80.1% of functions), up from 77.3%. 517 tests pass and none is ignored: the 10 stories that were known red now pass as plain tests. By area: the TUI (src/tui*) 96.9% of 4,413 lines, the CLI (src/cli*) 88.3% of 2,021, the rest 65.4% of 7,366.

| File | Lines covered | Lines | w197 |
|---|---|---|---|
| src/cli.rs | 89.23% | 1161 | 88.32% |
| src/boards.rs | 62.99% | 335 | 59.22% |
| src/config.rs | 96.98% | 695 | 93.08% |
| src/license.rs | 87.61% | 694 | 82.89% |
| src/wire.rs | 91.81% | 232 | 88.20% |
| src/tui/history.rs | 100.00% | 117 | new |
| src/tui/inbox.rs | 97.07% | 1196 | 97.32% |
| src/tui/source.rs | 97.44% | 390 | 97.19% |

JavaScript, for the first time in part: the worker suite now loads some Worker modules straight into node, so node's own coverage (`NODE_V8_COVERAGE`) counts them: worker/src/backup.js 94.7% of 266 lines, worker/src/text.js 100% of 32, and the ticket and hub rules of worker/src/boards.js through worker/test/tickets.mjs (18.7% of the file; the rest runs inside workerd). The worker suite passes 166 checks with none known red; the browser stories cover the loader and the panel without numbers.

## w201 setup stories, 2026-10-22 (agent/cov-setup)

tests/stories_setup.rs runs `p99 setup --yes` and `p99 deploy` through the binary against a stateful Cloudflare stub built on tests/cli/fake.rs, which drops a Worker's secrets on an upload that doesn't keep them, as Cloudflare does: a fresh account, a second run that finds everything there, a D1 database and R2 bucket adopted by name, tokens lacking the zone list, a host's zone, D1 or account permissions, a disabled token and an account-scoped one, the setup refusals named in the story, a Worker of the same name on another database, a route another Worker holds, and for deploy `--no-check`, a 502 after and on the upload, a refused token in plain text and with `--json`, and `--accept-plan` with a right, wrong and malformed hash. Its runs keep the environment, so the coverage profile counts them; tests/stories_deploy.rs now keeps `LLVM_PROFILE_FILE` through its cleared environment, so its stories (a fresh deploy, an account at 0014, no Worker yet, the 1.7 and 1.8 plans, a migration failing midway) count too. New unit tests cover setup.rs's hostname, host spec, route, binding, token status and `--yes` helpers and migrate.rs's fold, skeleton, plan words and read-only guard. Still untested in setup: the missing `--mail-from` with a Resend key, the rate-namespace refusals, and the interactive walk.

Rust: **89.0% of lines** (88.2% of regions, 88.1% of functions), up from 78.8%. 546 tests pass and none is ignored. By area: the TUI (src/tui*) 96.9% of 4,413 lines, the CLI (src/cli*) 88.3% of 2,021, the rest 84.7% of 7,685. cloudflare.rs moved with them, since the deploy stories now count.

| File | Lines covered | Lines | before |
|---|---|---|---|
| src/setup.rs | 82.55% | 1639 | 27.18% |
| src/migrate.rs | 94.40% | 1053 | 34.29% |
| src/cloudflare.rs | 97.78% | 541 | 86.51% |

## w199 cards, 2026-10-22 (agent/cards-i3, main 51d4432 plus the cards train)

Rust: **89.87% of lines** (89.11% of regions, 88.94% of functions), up from 89.0% after the setup stories. 615 tests pass under `cargo llvm-cov nextest`, none ignored.

| File | Lines covered | Lines | Last measured |
|---|---|---|---|
| src/card.rs | 99.75% | 400 | new |
| src/cli/card.rs | 98.19% | 443 | new |
| src/cli.rs | 89.46% | 1186 | 88.3% (the CLI) |
| src/client.rs | 88.18% | 702 | not listed |
| src/config.rs | 98.37% | 797 | 96.67% |
| src/import.rs | 47.22% | 612 | 42.20% |
| src/tui/deck.rs | 97.17% | 212 | 96.59% |
| src/tui/demo/boards.rs | 85.67% | 300 | 90.71% |
| src/tui/inbox.rs | 97.22% | 1225 | 97.32% |
| src/tui/source.rs | 97.45% | 392 | 97.19% |
| src/wire.rs | 93.31% | 254 | 88.20% |

src/tui/demo/boards.rs stays below its old number because its six sample cards are `const fn` rows, which the compiler evaluates, so no test run counts them. The inbox's move picker is covered on a card as well as on a plain item: a story opens the sample's done card, finds its lanes offered and none of the plain board's labels, and moves it to Landed.

JavaScript, the Worker (`cd worker && npm run coverage`, as the JavaScript section below describes): the worker suite passes 253 checks with none known red, and the unit tests pass. **94.60% of lines** of worker/src, up from 93.64% on main.

| File | Lines covered | Lines | Main |
|---|---|---|---|
| src/boards.js | 99.24% | 658 | 97.92% |
| src/cards-read.js | 98.27% | 346 | new |
| src/cards-write.js | 97.08% | 343 | new |
| src/cards.js | 100.00% | 37 | new |
| src/worker.js | 95.50% | 3159 | 94.71% |
| **total** | **94.60%** | 6887 | 93.64% |

JavaScript, the browser (`cd render/web && npm run coverage`, then the panel's filter story, render/web/filter-check.mjs, under the same coverage hook): **81.05% of lines** of worker/src/web, up from 80.1% after the sign-in retry. src/web/panel.js is at 89.32% of 1,976 lines (88.26% of 1,840 on main) and src/web/board.js at 91.32% of 887 (91.17% of 872); the loader by bytes stays at 94.93%. In that pass the widget stories passed 227 and failed 1, the hover story ("a panel that fails to load on hover…"), whose wait for the widget ran out at 20 s; a plain run of the widget stories on the same tree right after passed all 229, so that pass's figures are short only the pages that story left open.

Every card route runs in the worker suite against wrangler dev. Among the checks are the cards-write checks (the Cards board's lanes, every status word, the agent's refused close on each route, links, comments, project changes, merges, lanes that keep their `closes`, a done card moved back by its lane's label by a manager who doesn't own the board), the cards-read checks (lane order, every filter, paging, one card's place, visibility by code and host, the sides of each board) and the marks checks (`via` on items, comments, events, mail, import, Slack). In headless Chromium the panel's filter story (render/web/filter-check.mjs) passes its 23 checks and the board story against the Worker (render/web/board.mjs check --worker) its 28. The contract end to end, the release binary against wrangler dev, passes 30 of 30.

## w203 one board, 2026-10-22 (agent/board-i1, main b1d20d2 plus the one-board train)

Rust: **91.59% of lines** (90.88% of regions, 90.63% of functions), up from 89.87% after the cards. 764 tests pass under `cargo llvm-cov nextest`, none ignored.

| File | Lines covered | Lines | After the cards |
|---|---|---|---|
| src/one_board.rs | 100.00% | 371 | new |
| src/fold.rs | 98.77% | 408 | new |
| src/boards.rs | 97.98% | 198 | not listed |
| src/cli/codes.rs | 99.15% | 234 | new |
| src/cli/waiting.rs | 96.00% | 25 | new |
| src/card.rs | 99.76% | 419 | 99.75% |
| src/cli/card.rs | 98.43% | 446 | 98.19% |
| src/cli.rs | 89.67% | 1191 | 89.46% |
| src/client.rs | 91.08% | 706 | 88.18% |
| src/migrate.rs | 94.74% | 1065 | not listed |
| src/tui/board.rs | 97.76% | 1070 | not listed |
| src/tui/codes.rs | 97.49% | 279 | not listed |
| src/tui/deck.rs | 99.73% | 368 | 97.17% |
| src/tui/projects.rs | 96.82% | 157 | new |
| src/tui/waiting.rs | 92.89% | 422 | new |
| src/tui/source.rs | 97.25% | 400 | 97.45% |
| src/tui/demo/boards.rs | 85.32% | 293 | 85.67% |
| src/wire.rs | 92.71% | 329 | 93.31% |

JavaScript, the Worker: the worker suite passes 305 checks with none known red, and the 38 unit tests pass. **94.42% of lines** of worker/src, against 94.60% after the cards: the old per-person board code left boards.js (310 lines now, 658 before), and src/cards-write.js reads 92.08% of 303 (97.08% of 343).

| File | Lines covered | Lines | After the cards |
|---|---|---|---|
| src/one-board.js | 100.00% | 225 | new |
| src/needs-you.js | 100.00% | 51 | new |
| src/codes-delete.js | 100.00% | 22 | new |
| src/roles.js | 100.00% | 12 | new |
| src/boards.js | 98.06% | 310 | 99.24% |
| src/cards-read.js | 98.36% | 365 | 98.27% |
| src/cards-write.js | 92.08% | 303 | 97.08% |
| src/labels.js | 100.00% | 24 | 100.00% |
| src/worker.js | 95.68% | 3168 | 95.50% |
| **total** | **94.42%** | 6843 | 94.60% |

JavaScript, the browser (`cd render/web && npm run coverage`, then the filter story under the same hook): **81.21% of lines** of worker/src/web, up from 81.05%. src/web/board.js is at 92.80% of 792 (91.32% of 887) and src/web/panel.js at 89.48% of 1,986 (89.32% of 1,976); the loader by bytes is at 95.29% (94.93%). In that pass every check passed: capture, manage, mobile, search and swap, the widget stories 258 of 258, the board stories 62 of 62, the board against the Worker 28 of 28, and the filter story.

The one-board migration 0016 runs in the worker suite over seeded node:sqlite databases (the fold checks) and once more over a database the 1.10.0 Worker itself wrote: two Owners' boards with custom columns and a six-lane Cards board, 12 items and 3 cards. It moved 10 items (Doing to In progress, Review to Landed, a custom first column to New, a custom closing column to Done keeping its resolution, every other custom column to In progress), kept 5 in their lanes, archived the 4 old boards and 7 old labels, wrote one migrated `label` event per moved item, and a second run changed nothing. The plan's promises, end to end with the release binary against wrangler dev, pass 41 of 41: `p99 board`, the deprecated `boards`, `move --to <word|name>`, `cards --waiting`, `invites delete`, `invite --owner`, the role words, and the TUI `--dump` with seven lanes and the badge.

## Uncovered critical paths, first in line

- The one board: src/cards-write.js (92%) leaves unrun its making of the Cards board when there is none, which 0016 now always makes, and its two `client_uid` races, which only concurrent requests reach; the TUI's waiting list when its accounts fail in turn (src/tui/waiting.rs, 93%), and the demo board's sample rows (85%, `const fn` rows the compiler evaluates).
- Setup's interactive walk, its mail and rate-namespace refusals (setup.rs, 83%), and import (42%).
- Secrets: vault.rs at 54%; storing a new secret in the vault, which setup does, has no test.
- delete's terminal confirmation (cli/delete.rs, 57%) and the client's fallback to a host's own address.
## w208 coverage gaps, 2026-10-22 (agent/cov-gaps)

Tests only. The "after" column is the train's measured run (agent/cov-i2, below).

| File | Before | After | What now runs it |
|---|---|---|---|
| src/vault.rs | 54.39% of 114 | 90.35% of 114 | tests/stories_setup.rs: `p99 setup --yes --vault` stores the token and the key through a fake `op` on PATH and writes only `op://` references, a second run reads both back and stores nothing, a vault answer without its vault id, `--no-vault`, and `op` refusing, answering nothing, answering no item id or missing; tests/cli_vault.rs: a GitHub token as an `op://` reference, read, trimmed, empty, not UTF-8, refused and with `op` missing |
| src/cli/delete.rs | 56.92% of 65 | 100.00% of 65 | tests/cli_delete_tty.rs: the typed-back key at a real terminal (a pty), in lower case and padded, with `--host`, a wrong key, a bare number, a blank line, a line that isn't UTF-8, Ctrl-D, a negative comment count, `--yes` at a terminal, and an item the Worker can't find |
| src/client.rs | 88.18% of 702 | 95.22% of 857 (the new in-file tests count) | unit tests: a host asked first at its own address (`with_host`, `aimed`), the host that answered last asked first, and over loopback a host behind Access falling through to the next, a web page, a redirect, every host behind Access, a P99 error that isn't passed over, and an unreachable host |
| worker/src/github.js | 65.03% of 346 | 97.69% of 346 | worker/test/github.mjs against a stubbed GitHub API: linking and its refusals, the list, opening an issue once and again, GitHub refusing, answering badly or dropping the connection, a second open while the first is in flight, a host without its token or link, a merged pull request's commits read page by page and commits GitHub won't give, unlinking with the hook removed, gone, failing, or never asked, and a call scoped to one host |
| worker/src/worker.js (validConfig) | 32 of 48 lines | 46 of 48 lines | worker/test/placement.mjs: a host's `above`, `off` and `strings`, in the loader and `/me`, escaped off pages, dropped null fields, and fifteen refusals |
| worker/src/web/app.js | 0.00% of 350 | 79.14% of 350 | render/web/app-check.mjs, headless against `wrangler dev`: sign-in with nothing, a wrong code and a right code, the spaces list and its counts (her own items, every item for a manager), a space's panel and a panel that fails to load, the profile's username and a save that fails or is signed out, a list that fails and offline, sign-out, a revoked code, a taken username, no spaces, and a sign-in held back for too many tries |

## w208 import, 2026-10-22 (agent/cov-import)

`p99 import` and the Worker's import routes, before and after. The before column is the last measured run; the after column is the train's measured run (agent/cov-i2, below).

| Code | Before | After |
|---|---|---|
| src/import.rs | 47.22% of 612 lines | 99.65% of 1,146 lines (the new in-file tests count) |
| worker.js importRecord | 39 of 62 lines | 63 of 63 lines |
| worker.js postImport, finishImport, putImportAttachment | bad paths not run | 102 of 102, 33 of 33 and 86 of 86 lines |

What runs them now:

- tests/stories_import.rs: the p99 binary against a stub Worker that keeps what it was sent. A full bundle (every record type, a P99 1.x status, keys and text with diacritics sent as written, two files with their item, comment, role, mark, name and internal flag), a dry run that writes and uploads nothing, `--json` with the progress on standard error, Windows line ends and blank lines, an import resumed after a failed upload (only the missing file goes up the second time, nothing the third), a Worker 400 on the second batch of a type (named by its bundle line), a 403 and a 500 part way, a dropped connection mid-import and at the finish, a refused file, conflicts listed with exit 1, a malformed bundle refused whole with every problem line and nothing sent, a missing bundle.jsonl, an empty bundle and a missing `--host`.
- src/import.rs unit tests: every refused field of every record type, line numbers across blank and CRLF lines, uids per type, batches at 200 records and at 2 MB, a Worker refusal mapped back to its bundle line, and a file path that leaves the bundle.
- worker/test/imports.mjs, in the worker suite: every rejected event shape (with its record number), every other record type's bad shapes, every rejected item field, the route's host, key and body refusals, conflicts across hosts and taken uids with nothing written, managers with and without a code, finish's bad lists, its conflicts and its links, every refused attachment parameter, a stored file sent twice and a uid taken by another item.

## w208 train, 2026-10-23 (agent/cov-i2, main 25908ba plus cov-gaps and cov-import)

The before column is the last measured run, the w199 cards section above, or the JavaScript numbers below for a file that section doesn't list.

Rust: **93.14% of lines** (92.21% of regions, 91.81% of functions), up from 89.87%; 692 tests pass under `cargo llvm-cov nextest`, main's no-ffmpeg test included. The Worker: **97.11% of lines**, up from 94.60%, from 279 checks and the 32 unit tests. The browser, measured as w199 measured it (`npm run coverage`, then the panel's filter story under the same coverage hook): **87.03% of lines**, up from 81.05%, with the app page's own check in the pass. The loader by bytes is at 95.29%, up from 94.93%, and it stays 12 bytes under its 2,048-byte gzip budget.

The train's `npm run coverage` pass left the filter story out (it isn't in coverage.mjs's list), and read 85.10% of lines, with panel.js at 86.03%. The filter story then ran on the same tree under the same hook (agent/cov-i3), passed its 23 checks, and was folded into that pass's dumps: panel.js is at 89.68%, so its drop was the missing filter story. The pass ran at a load average near 20, and two checks of code this wave didn't touch failed there. The board's autoscroll under a held drag ran out of time (board.mjs:709, 30 s); the board check passed on an earlier pass of this train, with its 28 checks green and board.js at 91.32%, and ran out of time on the last two. The widget story of a panel that fails to load on hover failed at 20 s, as in the w199 pass, where it was traced to the per-minute budget of the code it shares with the other widget stories. Neither was re-run, so board.js reads 84.44% in this table: only the pages the board check closed before failing count. manage-check's duplicate picker, which timed out in the pass before, now waits for its options and passed.

| File | Before | After |
|---|---|---|
| src/vault.rs | 54.39% of 114 | 90.35% of 114 |
| src/cli/delete.rs | 56.92% of 65 | 100.00% of 65 |
| src/client.rs | 88.18% of 702 | 95.22% of 857 |
| src/import.rs | 47.22% of 612 | 99.65% of 1,146 |
| worker/src/github.js | 65.03% of 346 | 97.69% of 346 |
| worker/src/worker.js | 95.50% of 3,159 | 97.40% of 3,159 |
| worker/src/web/app.js | 0.00% of 350 | 79.14% of 350 |
| worker/src/web/panel.js | 89.32% of 1,976 | 89.68% of 1,976 |
| worker/src/web/board.js | 91.32% of 887 | 84.44% of 887 |

The client and import rows count their new `#[cfg(test)]` modules, so their line counts grew. panel.js and board.js are files of the w203 train that this wave doesn't change. Both browser rows include the filter story, as their before column does; board.js reads lower because the board check ran out of time. github.js's last gain is the closed-issue story the train added: closing the GitHub issue P99 opened marks its item fixed (closed, with the resolution `fixed`) once, and a close as not planned, a pull request's close, another action, an unknown number, a number that isn't one, another repository or another event leave it open.

Bugs the new tests found:
- **The P99 page never marked a space's open count.** app.js wrote `data-open` as a bare attribute or left it out, and app.css styles only `[data-open="true"]`, so a space with open items looked like an empty one. app.js now writes `true` or `false`.
- **Try again after a failed panel load could never load the panel.** A browser keeps a failed module import for its URL, so importing `panel.js?v=…` again fails without a new fetch. Each retry now asks with its try number (`&try=N`), which the Worker ignores. panel.js loads board.js the same way (panel.js:468), so a manager's board that once fails to load stays failed until a reload; panel.js belongs to the w203 train, so it's left for the repo session.
- **A vanished file during `p99 import` was the only upload failure without its bundle line.** It now says `line N: <path>: …` like the rest.
- Three checks were wrong, not the code: the vault story asserted one secret PUT where `github set` stores two (the token and the hook secret), the commit-page cap expected 200 where a delivery that names no item answers the quiet 204, and the import manager check used an address an earlier check had already minted as a manager.
- Three checks were timing-bound and are now deterministic: the TOTP replay check recomputed its digits, so a 30-second step boundary between checks made them new, and the manage check waited a fixed 700 ms for the duplicate search and a fixed 500 ms for the duplicate picker's first list.
- The worker suite hangs instead of failing when a check group throws outside a check: with no built `p99` binary, migrateChecks' `binary()` throws, `main` prints `not ok` and the process never exits. The full gate builds the binary first, so only a hand-run `npm run coverage` meets it.

From the reviews, for the repo session (each needs a product change outside a tests-only brief): `vault::store` reports "Broken pipe" instead of what `op` said when `op` exits before reading the template; and `p99 import`'s own checks are looser than the Worker's (marks' shape, context over 64 KB, page titles over 300, `created_at` such as `2025-13-45`, a bad `resolution` with `status: done`), so a bundle that passes the dry run can still stop part way. Two browser checks failed on code this wave doesn't touch. board.mjs:709 waits 30 s for the held drag's autoscroll and ran out on this train's last two passes, at a load average near 20. The widget's hover story failed at 20 s here and in the w199 pass. The w199 integrator traced it to the per-minute budget of the code it shares with the other widget stories: a run that packs their requests into one minute gets 12 429s. A longer wait won't fix it; giving the story its own code will, as main did for the per-minute comment story.

## Uncovered critical paths, first in line

- Boards from the CLI (boards.rs, 63%): `p99 boards`' list and run, its confirm prompt, and `p99 labels`. Its files belong to the w203 train.
- The live stream (stream.rs, 78%): the TLS handshake for a `wss://` Worker and `follow`'s reconnect after a drop.
- Setup's interactive walk, its mail and rate-namespace refusals (setup.rs, 83%), and secrets: setup's interactive vault question (`vault::available`, vault.rs:30–37, asked only without `--yes` or `--vault`).
- `p99 link`'s host choice and the browser it opens (links.rs, 85%).
- The Worker, the loader, the panel and the board (JavaScript): see [JavaScript](#javascript).

## JavaScript

Lines of worker/src run by the worker suite, and lines of the loader, panel, board, shot, avatar and app run by the browser checks. A Worker line counts when any statement or expression the source map puts on it ran at least once; a browser line counts when the V8 block holding its first non-space character ran at least once. Blank lines don't count.

The two kinds of row count lines differently. A file the Worker bundle loaded counts only the lines its source map points at (statements and expressions), so lone braces and comment lines don't count; a file that never loaded, and every browser file, counts each non-blank line. A Worker file's line count can therefore drop when it first loads, and its percentage reads a little higher than the same file would by the plain rule. A Worker file that the suite also imports into node keeps the bundle's lines: node's run marks those lines covered when it ran them, and adds none of its own.

### How it's measured

- **The Worker:** `cd worker && npm run coverage` runs the worker suite (`npm test`, its stories included) with coverage on. The Worker runs inside workerd under `wrangler dev`, so node's own coverage can't see it, and workerd keeps the inspector's `Profiler.enable` for its own CPU profiler, so V8's precise coverage can't be started through the inspector either. Instead the run starts workerd with V8's `--allow-natives-syntax` (through miniflare's `MINIFLARE_WORKERD_V8_FLAGS`), and the suite connects to wrangler's inspector port as each `wrangler dev` starts, before the first request: `%DebugCollectCoverage()` takes a function-level snapshot of what the module's load ran, `%DebugToggleBlockCoverage(true)` turns on V8's block counts, and `%DebugCollectCoverage()` takes those just before that `wrangler dev` stops, the safety stories' backup Worker included. The counts are on wrangler's bundle and are mapped back to each file of worker/src through the bundle's source map. The modules the suite also imports straight into node (backup.js, boards.js, license.js, order.js, text.js, tries.js) are read from node's own `NODE_V8_COVERAGE` too, on the lines the bundle mapped. The table prints at the end and is kept in worker/.wrangler/coverage/table.md. The run fails with one line when a Worker dump couldn't be saved, when a workerd script's source map isn't found, or when worker.js maps no covered line, so a broken run never passes with a plausible table. The source map is read from beside the bundle, or else the newest one of that name under worker/.wrangler/tmp, where wrangler writes its bundles. The browser files under worker/src/web are served as text by the Worker, so they're counted by the browser pass, not here.
- **The browser:** `cd render/web && npm run coverage` (or `node coverage.mjs [check…]`) runs the browser checks (capture, manage, mobile, search, swap), the widget stories (stories-widget), the board's checks against the real Worker (`board.mjs check --worker`) and the standalone app page's check against the real Worker (app-check) with a small preload that turns on Playwright's `page.coverage` (Chromium's own) for every page they open. Each served `/_p99/*.js` counts against its file in worker/src/web; for capture.js, only the shot.js tail after the vendored library counts. The table is kept in tmp/browser-coverage/table.md. The pass fails when a check took no coverage of a P99 script or when no line of worker/src/web ran. A check that fails keeps the coverage of the pages it closed before failing; the pages still open when it exits don't count.
- The unit tests run in the full gate: every worker/test/*.test.mjs inside `npm test`, and render/web/coverage.test.mjs right after it. `npm run coverage` runs the same worker/test/*.test.mjs under node's coverage first, then the suite.
- A Worker whose inspector closes, fails or gives no answer within 60 s while its coverage is taken, the reading of its scripts included, fails the run with one line, rather than leaving it waiting or saving a short dump. A script whose source the inspector refuses is left out.
- The loader (p99.js) is hand-minified into 30 dense lines, so nearly every line holds some code that ran and its line figure reads 100% whatever goes untested. The browser pass also reports it by bytes: each non-space byte of the file counts once when any page ran it, the bytes the Worker substitutes when it serves the loader (the host's config and the version) lined up around, and the bytes that never ran are listed in tmp/browser-coverage/table.md.
- A Worker that reloads during the run (a file under worker/ changed, package.json included) fails the run with one line: its counts start over in a new isolate, so they would read low.
- A byte of the Worker counts as run when either snapshot ran it. The load snapshot is function-level, so a function the module's top level called counts whole, and a function compiled at load counts whole when it runs again later, without its blocks.

### Numbers, 2026-10-22 (main 82ace46 plus this branch)

The Worker (worker/src), from the worker suite: 181 checks passed, none known red, and the 32 unit tests. **93.6% of lines.**

| File | Lines covered | Lines |
|---|---|---|
| src/backup.js | 98.08% | 261 |
| src/boards.js | 97.92% | 626 |
| src/deletes.js | 93.67% | 79 |
| src/feed.js | 100.00% | 73 |
| src/github.js | 65.03% | 346 |
| src/hooks.js | 90.28% | 360 |
| src/labels.js | 100.00% | 24 |
| src/license.js | 100.00% | 8 |
| src/links.js | 95.45% | 110 |
| src/mail.js | 99.22% | 128 |
| src/mailer.js | 96.88% | 256 |
| src/order.js | 91.90% | 210 |
| src/people.js | 97.35% | 151 |
| src/standalone.js | 97.31% | 297 |
| src/text.js | 100.00% | 32 |
| src/tries.js | 100.00% | 8 |
| src/worker.js | 94.71% | 3098 |
| **total** | **93.64%** | 6067 |

The browser (worker/src/web), from the browser checks, the widget stories (104 passed, 1 known red) and the board's 28 checks. **78.8% of lines.**

| File | Lines covered | Lines |
|---|---|---|
| src/web/app.js | 0.00% | 350 |
| src/web/avatar.js | 100.00% | 47 |
| src/web/board.js | 91.17% | 872 |
| src/web/p99.js | 100.00% | 30 |
| src/web/panel.js | 86.13% | 1752 |
| src/web/shot.js | 84.37% | 435 |
| **total** | **78.83%** | 3486 |

The loader by bytes: **94.23%** (3,101 of 3,291 non-space bytes run).

### Uncovered critical paths, first in line

Read from the measured run, by function.

- Codes: a code minted before codes were sealed is sealed on its first use (authoriseCode); no check runs it. The races where two identical code mints or item filings land at once (postCode, createIssue) are reachable only by concurrent requests.
- The P99 page (app.js, 79.14%): a server 500 or offline at sign-in, the server's 400 or 409 on a username, a `#space=` link to a host the person doesn't have, and the panel's signed-out and close callbacks.
- Placement: an `off` pattern whose expression won't compile (validConfig, worker.js:1272–1273).
- GitHub: a stale claim on opening an issue (openGithubIssue past CLAIM_MS, github.js:172–173) needs the Worker's clock moved; two opens racing for one claim (github.js:186–188); and a delivery whose handler throws, which forgets the delivery so GitHub's retry runs (deliver, github.js:274–276).
- Deletes: the scheduled sweep that purges the R2 files a delete couldn't drop (sweepDeletions past its empty check, deletes.js:93–95), the only cleanup for those files, and deleteIssue's branch for an R2 failure (deletes.js:69–70). Both need R2 to fail, which the local Worker never does.
- Uploads: an R2 write that fails for a reason other than a hash mismatch (streamToBucket, worker.js:2137).
- The loader (190 bytes never ran): a page with no code, where it stops once set up (`if(!c)return`); a stored code replaced by a different one; a hash change to a new code, which reloads the page; `P99.open(key)` from a page script; an unhandled rejection's reason and the ring of page errors past 20; storage that throws when the code is forgotten; a badge over 99 and its unread mark; a `/me` answer of 428 or over on a plain load; and the placement options no check sets (an offset, the left side, an anchor below the button, the link colour, an anchor selector that throws).
- Covered on this branch, by worker/test/critical.mjs: uploads' bad paths, signing's header checks, minting, revoking and verifying codes, a JSON body streamed past its limit without a length, a signed body that isn't JSON or isn't UTF-8, and renaming a person. Card order (worker/src/order.js) is checked against its upstream project's test vectors by worker/test/order.test.mjs.

### Busy sign-in, 2026-10-22 (main c095778 plus agent/signin-retry)

The browser, from the same checks with the widget stories at 229 passed and none known red: **80.1% of lines**, up from 78.8%. src/web/panel.js is at **88.26%** of 1,840 lines (86.13% of 1,752 before); the other browser files are unchanged. The loader by bytes: **94.93%** (3,124 of 3,291), since a `/me` answer of 429 or 503 is now run on a code link and on a plain load. This branch changes no file the Worker's coverage counts, so that pass wasn't re-run; the worker suite passed 181 checks.

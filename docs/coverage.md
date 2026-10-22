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

| File | Lines covered | Lines | w197 |
|---|---|---|---|
| src/setup.rs | measured at integration | | 27.18% |
| src/migrate.rs | measured at integration | | 34.29% |

## Uncovered critical paths, first in line

- Setup's interactive walk, its mail and rate-namespace refusals (setup.rs, 27% before w201; the integrator refreshes it), migrate (34%) and import (42%).
- Secrets: vault.rs at 54%; storing a new secret in the vault, which setup does, has no test.
- delete's terminal confirmation (cli/delete.rs, 57%) and the client's fallback to a host's own address.
- The Worker, the loader, the panel and the board (JavaScript): see [JavaScript](#javascript).

## JavaScript

Lines of worker/src run by the worker suite, and lines of the loader, panel, board, shot, avatar and app run by the browser checks. A Worker line counts when any statement or expression the source map puts on it ran at least once; a browser line counts when the V8 block holding its first non-space character ran at least once. Blank lines don't count.

The two kinds of row count lines differently. A file the Worker bundle loaded counts only the lines its source map points at (statements and expressions), so lone braces and comment lines don't count; a file that never loaded, and every browser file, counts each non-blank line. A Worker file's line count can therefore drop when it first loads, and its percentage reads a little higher than the same file would by the plain rule. A Worker file that the suite also imports into node keeps the bundle's lines: node's run marks those lines covered when it ran them, and adds none of its own.

### How it's measured

- **The Worker:** `cd worker && npm run coverage` runs the worker suite (`npm test`, its stories included) with coverage on. The Worker runs inside workerd under `wrangler dev`, so node's own coverage can't see it, and workerd keeps the inspector's `Profiler.enable` for its own CPU profiler, so V8's precise coverage can't be started through the inspector either. Instead the run starts workerd with V8's `--allow-natives-syntax` (through miniflare's `MINIFLARE_WORKERD_V8_FLAGS`), and the suite connects to wrangler's inspector port as each `wrangler dev` starts, before the first request: `%DebugCollectCoverage()` takes a function-level snapshot of what the module's load ran, `%DebugToggleBlockCoverage(true)` turns on V8's block counts, and `%DebugCollectCoverage()` takes those just before that `wrangler dev` stops, the safety stories' backup Worker included. The counts are on wrangler's bundle and are mapped back to each file of worker/src through the bundle's source map. The modules the suite also imports straight into node (backup.js, boards.js, license.js, order.js, text.js, tries.js) are read from node's own `NODE_V8_COVERAGE` too, on the lines the bundle mapped. The table prints at the end and is kept in worker/.wrangler/coverage/table.md. The run fails with one line when a Worker dump couldn't be saved, when a workerd script's source map isn't found, or when worker.js maps no covered line, so a broken run never passes with a plausible table. The source map is read from beside the bundle, or else the newest one of that name under worker/.wrangler/tmp, where wrangler writes its bundles. The browser files under worker/src/web are served as text by the Worker, so they're counted by the browser pass, not here.
- **The browser:** `cd render/web && npm run coverage` (or `node coverage.mjs [check…]`) runs the browser checks (capture, manage, mobile, search, swap), the widget stories (stories-widget) and the board's checks against the real Worker (`board.mjs check --worker`) with a small preload that turns on Playwright's `page.coverage` (Chromium's own) for every page they open. Each served `/_p99/*.js` counts against its file in worker/src/web; for capture.js, only the shot.js tail after the vendored library counts. The table is kept in tmp/browser-coverage/table.md. The pass fails when a check took no coverage of a P99 script or when no line of worker/src/web ran. A check that fails keeps the coverage of the pages it closed before failing; the pages still open when it exits don't count.
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
- Import: the event records' validation (importRecord, 23 of 62 lines not run), postImport's and finishImport's bad paths, and import's attachment bad paths.
- A host's placement config: the above, off and strings fields of validConfig (16 of 48 lines not run).
- GitHub: opening a GitHub issue from an item, and listing and deleting a repo's link (github.js at 65%).
- Deletes: the scheduled sweep that purges the R2 files a delete couldn't drop (sweepDeletions past its empty check, deletes.js:93–95), the only cleanup for those files, and deleteIssue's branch for an R2 failure (deletes.js:69–70). Both need R2 to fail, which the local Worker never does.
- Uploads: an R2 write that fails for a reason other than a hash mismatch (streamToBucket, worker.js:2137).
- The loader (190 bytes never ran): a page with no code, where it stops once set up (`if(!c)return`); a stored code replaced by a different one; a hash change to a new code, which reloads the page; `P99.open(key)` from a page script; an unhandled rejection's reason and the ring of page errors past 20; storage that throws when the code is forgotten; a badge over 99 and its unread mark; a `/me` answer of 428 or over on a plain load; and the placement options no check sets (an offset, the left side, an anchor below the button, the link colour, an anchor selector that throws).
- The standalone app page (worker/src/web/app.js, 0%): no browser check opens it.
- Covered on this branch, by worker/test/critical.mjs: uploads' bad paths, signing's header checks, minting, revoking and verifying codes, a JSON body streamed past its limit without a length, a signed body that isn't JSON or isn't UTF-8, and renaming a person. Card order (worker/src/order.js) is checked against its upstream project's test vectors by worker/test/order.test.mjs.

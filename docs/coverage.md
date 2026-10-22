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

## Uncovered critical paths, first in line

- The CLI commands no story runs: cli/delete.rs, cli/merge.rs, hooks.rs and email.rs (0–2%), github.rs (12%) and links.rs (22%). Setup is at 24%.
- The TUI's codes screen (tui/codes.rs, 10%) and tui.rs (31%).
- Secrets (vault.rs, 8%) and import (42%).
- The Worker, the loader, the panel and the board (JavaScript): see [JavaScript](#javascript).

## JavaScript

Lines of worker/src run by the worker suite, and lines of the loader, panel, board and shot run by the browser checks. A line counts when the V8 block holding its first statement ran at least once; blank lines don't count.

### How it's measured

- **The Worker:** `cd worker && npm run coverage` runs the worker suite (`npm test`, its stories included) with coverage on. The Worker runs inside workerd under `wrangler dev`, so node's own coverage can't see it: the suite opens wrangler's inspector port, starts V8's precise coverage once the Worker answers, and takes it just before each `wrangler dev` stops, the safety stories' backup Worker included. The counts are on wrangler's bundle and are mapped back to each file of worker/src through the bundle's source map. The node-side code the suite imports directly (license.js, tries.js) is read from node's own `NODE_V8_COVERAGE`. The table prints at the end and is kept in worker/.wrangler/coverage/table.md. The browser files under worker/src/web are served as text by the Worker, so they're counted by the browser pass, not here.
- **The browser:** `cd render/web && npm run coverage` (or `node coverage.mjs [check…]`) runs the browser checks (capture, manage, mobile, search, swap) and the widget stories (stories-widget) with a small preload that turns on Playwright's `page.coverage` (Chromium's own) for every page they open. Each served `/_p99/*.js` counts against its file in worker/src/web; for capture.js, only the shot.js tail after the vendored library counts. The table is kept in tmp/browser-coverage/table.md.
- The Worker's module top level runs before the inspector attaches, so it's counted as run; a function that ran only before the attach and never again shows as not run.

### Numbers

Today's tables come from the two commands above at each integration, pasted here per area: the Worker (worker/src) and the browser (worker/src/web).

### Uncovered critical paths, first in line

Read from the suite before the first measured run; the measured tables decide the order from here.

- Uploads' bad paths: a reused upload uid with other bytes, a bad uid, name or type, content that doesn't match its type, a region without a mark, and a body that differs from its signed hash. Covered now by worker/test/critical.mjs.
- Signing's header checks: a missing or malformed auth or body hash, a clock off by more than a minute, a bad or missing actor, a signature over another path or method, and a JSON body that differs from its hash. Covered now by worker/test/critical.mjs.
- Codes: minting's validation and its client_uid replay, a repeated or unknown revoke, an authenticator on a revoked code, and verify's 6-digit rule. Covered now by worker/test/critical.mjs.
- Import's attachment and finish paths beyond the one import story in worker/test/run.mjs.

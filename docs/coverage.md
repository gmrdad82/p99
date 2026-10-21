# Coverage

How much of P99's code its tests run, measured at every integration. There is no fixed threshold.

## How it's measured

- **Rust:** `cargo llvm-cov --summary-only` (through build-step). Lines and regions run by `cargo test`: the unit tests and tests/*.rs.
- **JavaScript:** not measured yet. The Worker runs inside workerd (wrangler dev), which node's coverage doesn't see, and the panel and board run in the browser.

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

## Uncovered critical paths, first in line

- The TUI (src/tui.rs and src/tui/*: board, inbox, codes, source, badge): 0%. It is driven only by `--dump`/`--keys` checks today, outside cargo test.
- The CLI's command bodies (src/cli.rs 4%, cli/delete.rs, cli/merge.rs, email.rs, hooks.rs: 0%) and setup and deploy (setup.rs 11%).
- The network client and wire (client.rs 17%, stream.rs 0%, wire.rs 45%).
- Secrets (vault.rs 0%) and config (43%).
- The Worker, the loader, the panel and the board (JavaScript): not measured yet; the worker suite and the browser checks exercise them heavily without numbers.

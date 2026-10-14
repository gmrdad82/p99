<p align="center"><img src="docs/images/inbox.gif" width="800" alt="A terminal running p99 tui: the inbox lists bugs, ideas and questions from two sites, a filter narrows it, a thread opens with its comments and where its fix has landed, a reply is sent and the status set to resolved, then the view switches to the other site."></p>

# P99

[![CI](https://github.com/gmrdad82/p99/actions/workflows/ci.yml/badge.svg)](https://github.com/gmrdad82/p99/actions/workflows/ci.yml) [![Version](https://img.shields.io/github/v/tag/gmrdad82/p99)](https://github.com/gmrdad82/p99/tags)

P99 is issue and feedback reporting for any website, part of [PITO MD](https://pitomd.com). The people you invite see a small "?" on your site; it opens a panel where they file a bug, an idea, an improvement, a question or a task, with a capture of the screen, marked regions and files, and follow the replies. You and your agents answer from the terminal: `p99` is a CLI with `--json` for scripts and agents, and `p99 tui` is the inbox.

Cloudflare is the whole infrastructure: one Worker, one D1 database and one R2 bucket per Cloudflare account, mounted on each site's own domain at `/_p99/*`. The page talks only to its own origin; there is no other backend, no CORS, no framework and nothing from your stack.

Works on Linux and macOS (Windows through WSL).

## What it is

- **A loader of under 2 KB gzipped**, one `<script>` tag, which draws the "?" in its own Shadow DOM for people holding a personal code and does nothing for anyone else. The panel and the screen capture load only when the "?" is pressed. It works under a strict Content-Security-Policy and adds one global, `P99`.
- **Personal codes instead of accounts.** `p99 invite` mints a 12-character code for a person and one or more sites; they open `https://<site>/?p99=<code>` once, the page keeps the code and drops it from the address bar. Codes are revocable and rate-limited. Code holders see their own items; managers see everything.
- **Privacy by default.** Addresses are recorded without query strings, page text is read only from regions the person marks, `data-p99-redact` blanks fields in every capture, and a site can switch P99 off on any page.
- **Where a fix landed.** `p99 announce` reads your commits' `Fixes: BUG-12` and `Refs: FEAT-3` trailers and tells P99 which environment a build reached, so each item shows when its fix is on dev and in production.
- **Several accounts and sites.** One config holds any number of Cloudflare accounts, each with any number of sites; the TUI switches between sites or shows them all.

## Install

Each [release](https://github.com/gmrdad82/p99/releases/latest) carries a Linux (x86_64) and a macOS (Apple Silicon) binary with a `SHA256SUMS` file. On macOS the binary is built and its tests pass on GitHub's runner.

**Linux and WSL:**

```
v=$(basename "$(curl -fsSLo /dev/null -w '%{url_effective}' https://github.com/gmrdad82/p99/releases/latest)")
mkdir -p ~/.local/bin && curl -fsSL "https://github.com/gmrdad82/p99/releases/download/$v/p99-$v-linux-x86_64.tar.gz" | tar -xz -C ~/.local/bin p99
```

**macOS:**

```
v=$(basename "$(curl -fsSLo /dev/null -w '%{url_effective}' https://github.com/gmrdad82/p99/releases/latest)")
mkdir -p ~/.local/bin && curl -fsSL "https://github.com/gmrdad82/p99/releases/download/$v/p99-$v-macos-arm64.tar.gz" | tar -xz -C ~/.local/bin p99
```

`~/.local/bin` needs to be on your `PATH`.

**From source**, with Rust 1.97 or newer:

```
cargo install --locked --git https://github.com/gmrdad82/p99 --tag vX.Y.Z p99
```

## Use

**Set up an account.** `p99 setup` walks you through it: which Cloudflare API token to create and where, with the permissions it needs and why; it checks the token, then creates the D1 database, the R2 bucket, the Worker, its key and a route for each of your sites, and ends with what exists and what to run next. It is safe to run again, and running it on a second Cloudflare account adds that account beside the first.

**Put P99 on a site** with one tag in the `<head>` of every page:

```html
<script src="/_p99/p99.js" async></script>
```

[docs/hosts.md](docs/hosts.md) covers placement, themes, Content-Security-Policy, Cloudflare Access and the pages P99 must stay off.

**Invite someone:**

```
p99 invite example.com --name "Ada Lovelace" --email ada@example.com
```

**Work the inbox:**

```
p99 tui
p99 list example.com --status open
p99 show BUG-12
p99 comment BUG-12 "Fixed on dev, can you check?"
p99 status BUG-12 resolved
p99 announce example.com --env production
```

**Bring items from another tracker**, keeping their keys and numbers, with `p99 import` ([docs/import.md](docs/import.md)).

Every command takes `--json`. An agent acting for you sets `P99_AGENT=1` (or `--agent`), and its items and comments show as your name with an asterisk, `Ada Lovelace*`.

The config lives in `~/.config/p99/config.toml` ([docs/config.md](docs/config.md)); secrets are written inline with mode 0600 or kept in your password manager as references the config names. The Worker's HTTP API is [docs/api.md](docs/api.md).

## Build and test

```
bin/gate --fast   # fmt, clippy -D warnings, the unit tests
bin/gate          # the same plus the release build
bin/budget        # the loader's size budget
cd worker && npm ci && npm test   # the Worker's tests on a local wrangler dev
```

GitHub CI runs all of them on every push, on Ubuntu and macOS.

## Contributing

Issues and pull requests are welcome on GitHub. Keep changes small, keep the loader under its budget, and run the gate before you push. By contributing you agree that your contribution is licensed under the MIT licence. Please follow the [code of conduct](CODE_OF_CONDUCT.md); report security issues privately as [SECURITY.md](SECURITY.md) says.

## Licence

MIT, © Catalin Ilinca; see [LICENSE](LICENSE). The MIT licence covers the code only: the P99 and PITO MD names and logos are © Catalin Ilinca, all rights reserved ([TRADEMARKS.md](TRADEMARKS.md)). Third-party code and its licence are listed in [NOTICE](NOTICE).

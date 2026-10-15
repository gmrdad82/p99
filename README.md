<p align="center"><img src="docs/images/flow.gif" width="800" alt="A sample coffee shop's checkout page: Grace Hopper presses the blue plus in the corner, the P99 panel opens, she picks Bug, types a title and a detail, marks the payment form (the card number shows blanked in the capture), sends it, and the item BUG-5 appears. The clip cuts to a terminal running p99 tui, where BUG-5 sits at the top of the inbox on host shop.example.com and opens."></p>

# P99

[![CI](https://github.com/gmrdad82/p99/actions/workflows/ci.yml/badge.svg)](https://github.com/gmrdad82/p99/actions/workflows/ci.yml) [![Version](https://img.shields.io/github/v/tag/gmrdad82/p99)](https://github.com/gmrdad82/p99/tags)

P99 is issue and feedback reporting for any website, part of [PITO MD](https://pitomd.com). The people you invite see a small "+" on your site; it opens a panel where they file a bug, an idea, an improvement, a question or a task, with a capture of the screen, marked regions and files, and follow the replies. You and your agents answer from the terminal: `p99` is a CLI with `--json` for scripts and agents, and `p99 tui` is the inbox.

Cloudflare is the whole infrastructure: one Worker, one D1 database and one R2 bucket per Cloudflare account, mounted on each site's own domain at `/_p99/*`. The page talks only to its own origin. There is no other backend, no CORS, no framework, no build step and nothing from your stack.

Works on Linux and macOS (Windows through WSL). The widget runs in any modern browser.

## The numbers

| | |
| --- | --- |
| What every page downloads | **2,044 bytes** gzipped: the loader as served, nothing else |
| Loader start to the "+" painted | **10.6 ms** cold, **2.6 ms** warm |
| Page navigation to the "+" painted | **26.9 ms** cold, **10.1 ms** warm |
| Click to the panel's form on screen | **31.1 ms** cold: panel and styles load only then (27.8 KB gzipped) |
| TUI frame time at 120×34 | **0.05 to 0.12 ms** average: 120 fps leaves 8.33 ms |
| Backend | **0** servers: one Cloudflare Worker, D1 and R2 per account |
| Worker runtime dependencies | **0** (wrangler only to run its tests) |
| p99 binary | **5.5 MB**, 10 direct crates, the Worker and widget embedded |

Measured on 2026-10-15 for 1.1.0: sizes with `gzip -9`, the loader as a host with no placement settings gets it; browser times in headless Chromium 152 on localhost, an AMD Ryzen 9 9950X, each the median of 5 runs of 10 page loads, alternated run by run with 1.0.6 at a load average of 4 to 9 on 32 threads, where "painted" is the first animation frame with the button (so times snap to 16.7 ms frames); TUI times with `p99 tui --demo --bench 200` on a release build.

<p align="center"><img src="docs/images/web-sizes-bars.png" width="49%" alt="Bar chart of what a page downloads, in KB gzipped: the loader 2.0 on every page; on demand, the panel 22.5, its styles 5.3 and the capture library 10.8."> <img src="docs/images/web-times-bars.png" width="49%" alt="Bar chart of how fast the widget shows, median of 5 runs of 10 in milliseconds: loader start to the button painted 10.6 cold and 2.6 warm, page navigation to the button painted 26.9 cold and 10.1 warm, click to the panel's form 31.1 cold."></p>

## On your site

**One tag, every page.** The loader is a classic script of about 2 KB that draws the "+" in its own closed Shadow DOM, only for people holding a personal code. For everyone else it reads nothing and draws nothing. It adds one element and one global, `P99`, and works under a strict Content-Security-Policy: no `'unsafe-inline'`, no `eval`, no frames, nothing from another origin.

```html
<script src="/_p99/p99.js" async></script>
```

<p align="center"><img src="docs/images/badge-light.png" width="40%" alt="The bottom-right corner of a light page: a blue plus button and a list button carrying an unread count of 1."> <img src="docs/images/badge-dark.png" width="40%" alt="The same corner on a dark page."></p>

**The panel loads on the first click.** It files bugs, ideas, improvements, questions and tasks, lists what the person sent with what's new for them, and shows each thread with its replies, files, status changes and where its fix has landed. It follows the page's light or dark scheme and takes the site's colours through CSS variables.

<p align="center"><img src="docs/images/panel-light.png" width="49%" alt="The P99 panel open over a light checkout page on item BUG-2: the report, a manager's reply, the reporter's answer, a status change to in progress and a reply from Ada Lovelace* (an agent acting for her)."> <img src="docs/images/panel-dark.png" width="49%" alt="The same panel and thread in the dark scheme."></p>

**Captures that keep secrets.** The visible screen, the whole page or regions the person marks go with the item. Fields marked `data-p99-redact` (and every password field) are blanked in every capture, the address is kept without its query string and hash, and a site can switch P99 off on any page, such as a checkout's receipt.

<p align="center"><img src="docs/images/capture.png" width="80%" alt="The new-item form with a screen capture and a marked area of the payment form; the card number field is blank in both previews."></p>

## On a real site

<p align="center"><img src="docs/images/pitomd.gif" width="800" alt="The Splicer page on pitomd.com: Grace Hopper presses the question mark, picks Idea, types &quot;The download button could say which platform it detected&quot;, marks the Download free button and sends it, and FEAT-4 appears. The clip cuts to p99 tui, where FEAT-4 sits at the top of the inbox on host dev.pitomd.com and opens."></p>

This is P99 on PITO MD's own site, [pitomd.com](https://pitomd.com), recorded on its dev server with a local P99 Worker and sample people. The site added one tag and nothing else; its host config keeps the "+" clear of the site's own back-to-top button.

<p align="center"><img src="docs/images/pitomd-corner.png" width="40%" alt="The corner of the Splicer page at the top: the P99 buttons at their usual offset."> <img src="docs/images/pitomd-corner-scrolled.png" width="40%" alt="The same corner after scrolling: the site's back-to-top button has appeared and the P99 buttons sit just above it."></p>

<p align="center"><img src="docs/images/pitomd-panel-light.png" width="49%" alt="The P99 panel over a light cream section of the Splicer page on item BUG-2: the report, a reply from Ada Lovelace, the reporter's answer, a status change and a reply from Ada Lovelace* (an agent acting for her)."> <img src="docs/images/pitomd-panel-dark.png" width="49%" alt="The same thread in the dark scheme over the page's dark oxblood pricing section."></p>

## In your terminal

**The inbox.** `p99 tui` shows every item across your sites and Cloudflare accounts, or one site at a time, with its host on every row. Open a thread to read it, reply, add an internal note, change the status or assign it.

<p align="center"><img src="docs/images/inbox.gif" width="800" alt="p99 tui: the inbox lists items from example.com, shop.example.com and dev.example.com with a host column, a filter narrows it, a thread opens with its host and environment, a reply is sent, the status set to resolved, and the view switches to one host."></p>

<p align="center"><img src="docs/images/thread.png" width="49%" alt="A thread in p99 tui: BUG-3 on host shop.example.com in production, landed in dev and production, with three comments, one of them from Ada Lovelace* (her agent), and its events."> <img src="docs/images/codes.png" width="49%" alt="The codes screen of p99 tui: each invited person, their e-mail, hosts, role, the code's last four characters, when it was last used, and whether it is active."></p>

**A CLI for people and agents.** Every command answers `--json`. An agent acting for you runs with `--agent` (or `P99_AGENT=1`), and its items, comments and changes show as your name with an asterisk, `Ada Lovelace*`, so your words and your agent's never look alike.

```
p99 list --all --status open
p99 show BUG-12
p99 comment BUG-12 "Fixed on dev, can you check?"
p99 status BUG-12 resolved
```

<p align="center"><img src="docs/images/list-json.png" width="80%" alt="A terminal running p99 list --all --status any --json on sample data, showing the first item's JSON: key, kind, status, title, host, env, page, reporter, counts and landing."></p>

**Changes arrive live.** A new item, a comment, a change of status, assignee, title or details, or a new file shows in an open `p99 tui` within about a second, without polling: the Worker tells a Durable Object, which holds one WebSocket for each open inbox and `p99 watch`. `p99 watch` prints each change as it happens, and `p99 watch --json` prints one JSON event per line, so an agent can react to new items as they come.

```
$ p99 watch --host shop.example.com
BUG-12  item  shop.example.com  Grace Hopper: The total does not update
BUG-12  comment  shop.example.com  Ada Lovelace*: The total does not update
BUG-12  change  shop.example.com  Ada Lovelace: The total does not update
```

**Where a fix landed.** `p99 announce` reads your commits' `Fixes: BUG-12` and `Refs: FEAT-3` trailers and tells P99 which environment a build reached. Each item then shows when its fix is on dev and in production, and its reporter can be told when it ships.

**Setup that explains itself.** `p99 setup` says which Cloudflare API token to create, where, and why each permission is needed. It checks the token and every permission, then creates the D1 database, the R2 bucket, the key, the Worker and a route for each site, showing its progress. It ends with what exists and the command to run next. It is safe to run again, and a second Cloudflare account goes in beside the first. `p99 deploy` uploads a new version later, keeping every secret.

<p align="center"><img src="docs/images/setup.gif" width="800" alt="p99 setup on a sample account: it explains the token and its five permissions, checks them, picks the account, creates the D1 database, applies its migration, creates the R2 bucket, the key and the Worker, adds routes for example.com and dev.example.com, checks their health and prints a summary with the next command."></p>

## How it fits together

Each Cloudflare account holds one Worker, one D1 database and one R2 bucket, and the Worker sits on a route, `<host>/_p99/*`, in front of each of your sites. A route runs before a Pages project, a tunnel or another Worker on that host, so P99 never touches the site itself. The p99 binary carries the Worker, the loader, the panel and the database migrations, and uploads that same build to every account.

<p align="center"><img src="docs/images/architecture.png" width="800" alt="Diagram: browsers on example.com and shop.example.com load /_p99/p99.js from their own origin through a route on each host; one P99 Worker uses D1 for items, comments, events, codes and hosts and R2 for attachments and weekly backups; the p99 CLI and TUI call the Worker's signed API, and p99 setup and deploy upload the embedded build through the Cloudflare API."></p>

Invites are personal codes rather than accounts. `p99 invite example.com --name "Ada Lovelace" --email ada@example.com` mints a 12-character code and a link, `https://example.com/#p99=<code>`. The code travels in the link's fragment, which browsers never send to a server, so it stays out of every log. Codes are revocable and rate-limited. Code holders see their own items; managers see everything.

**A second factor, when you want one.** `p99 invite … --totp` adds an authenticator to the code, and `p99 invites totp <id>` adds one to a code someone already holds, keeping their link. P99 prints the setup once: a key to paste as the one-time password in 1Password, Bitwarden or Apple Passwords, or as the setup key in Google Authenticator or Authy, and the same secret as an `otpauth://` link for apps that take one. Send it apart from the link. The first time a browser uses the code, the panel asks for the 6-digit code; after that the browser is remembered, and a forwarded link alone opens nothing anywhere else. The Worker keeps the secret encrypted, refuses a code already used, and locks the authenticator after 10 wrong tries. Nothing changes on the site: the prompt lives in the panel.

<p align="center"><img src="docs/images/invite-totp.png" width="80%" alt="A terminal running p99 invite shop.example.com --name 'Grace Hopper' --email grace@example.com --totp on a local Worker: it prints the code, the link, the setup key, the same secret as an otpauth:// line, a note to send them apart from the link, and that the secret is shown only this once."></p>

<p align="center"><img src="docs/images/verify-light.png" width="49%" alt="A sample shop's checkout page with the P99 panel open on Confirm it's you: a short note to enter the 6-digit code the authenticator app shows for P99, a Code field, and Cancel and Confirm buttons."> <img src="docs/images/verify-dark.png" width="49%" alt="The same prompt on the dark page."></p>

## Install and first use

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

`~/.local/bin` needs to be on your `PATH`. **From source**, with Rust 1.97 or newer: `cargo install --locked --git https://github.com/gmrdad82/p99 --tag vX.Y.Z p99`.

**First use:**

```
p99 tui --demo                      # the inbox on sample data, nothing to set up
p99 setup                           # your Cloudflare account, step by step
p99 invite example.com --name "Ada Lovelace" --email ada@example.com
```

Then add the tag to your site's `<head>` and open the link `p99 invite` printed.

## More

- [docs/hosts.md](docs/hosts.md): placement, themes, Content-Security-Policy, Cloudflare Access and the pages P99 stays off.
- [docs/config.md](docs/config.md): `~/.config/p99/config.toml`, several accounts and hosts, secrets inline (mode 0600) or as password-manager references. A script sets `P99_TOKEN` rather than passing `--token`, which would land in shell history; every command that talks to Cloudflare takes it over the configured token, so `p99 deploy` runs unattended.
- [docs/import.md](docs/import.md): bring items from another tracker with `p99 import`, keeping their keys and numbers.
- [docs/api.md](docs/api.md): the Worker's HTTP API, signing and its test vector.
- [docs/guides/](docs/guides/): one task a page, also on [docs.pitomd.com](https://docs.pitomd.com/p99/).

## Part of PITO MD

P99 is one of [PITO MD](https://pitomd.com)'s open tools. Its inbox is built on [pito-tui](https://github.com/gmrdad82/pito-tui), the shared terminal app shell. Its clips and stills are recorded with [prec](https://github.com/gmrdad82/prec) and made GIFs with [pconv](https://github.com/gmrdad82/pconv). Its charts are drawn with [pito-compare](https://github.com/gmrdad82/pito-compare).

## Build and test

```
bin/gate --fast   # fmt, clippy -D warnings, the unit tests
bin/gate          # the same plus the release build
bin/budget        # the loader's 2,048-byte gzipped budget
cd worker && npm ci && npm test   # the Worker's tests on a local wrangler dev
```

GitHub CI runs all of them on every push, on Ubuntu and macOS.

## Contributing

Issues and pull requests are welcome on GitHub. Keep changes small, keep the loader under its budget, and run the gate before you push. By contributing you agree that your contribution is licensed under the MIT licence. Please follow the [code of conduct](CODE_OF_CONDUCT.md); report security issues privately as [SECURITY.md](SECURITY.md) says.

## Licence

<img src="assets/marks/lockup.svg#gh-light-mode-only" width="320" alt="P99, issue and feedback reporter"><img src="assets/marks/lockup-dark.svg#gh-dark-mode-only" width="320" alt="P99, issue and feedback reporter">

MIT, © Catalin Ilinca; see [LICENSE](LICENSE). The MIT licence covers the code only: the P99 and PITO MD names and logos are © Catalin Ilinca, all rights reserved ([TRADEMARKS.md](TRADEMARKS.md)). Third-party code and its licence are listed in [NOTICE](NOTICE).

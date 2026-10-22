# Configuration

`p99 setup` writes `~/.config/p99/config.toml` (`$XDG_CONFIG_HOME/p99/config.toml` when that is set, or the file `P99_CONFIG` names) with mode 0600, and every command reads it.

```toml
default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "0123456789abcdef0123456789abcdef"
token = "<the Cloudflare API token, or a reference to it>"
worker = "p99"
database = "p99"
database_id = "00000000-0000-0000-0000-000000000000"
bucket = "p99"
key = "<the key setup made, or a reference to it>"
app = "p99.example.com"

[hosts."example.com"]
account = "main"
env = "production"

[hosts."dev.example.com"]
account = "main"
env = "dev"
theme = { accent = "#ffc42e" }
strings = { file = "Send" }
```

One person on two accounts, under a different e-mail on the second:

```toml
default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "0123456789abcdef0123456789abcdef"
token = "<the token, or a reference to it>"
key = "<the key, or a reference to it>"

[accounts.client]
account_id = "fedcba9876543210fedcba9876543210"
token = "<the token, or a reference to it>"
key = "<the key, or a reference to it>"

[accounts.client.me]
name = "Ada"
email = "ada@example.org"

[hosts."example.com"]
account = "main"

[hosts."example.org"]
account = "client"
```

Commands on `example.com` act as Ada Lovelace <ada@example.com>, and on `example.org` as Ada <ada@example.org>. An agent on another machine that acts as someone else sets its own `[me]`, or `agent = true` in `[accounts.<name>.me]` to mark only that account's commands.

- **Secrets** (`token`, `key`, `access_client_secret`, `code`) are written inline, or as a reference P99 reads through the 1Password CLI when it is installed (`op://vault/item/field`). An inline secret makes P99 refuse a config file anyone else can read. `P99_TOKEN` in the environment comes first for every command that talks to Cloudflare (`p99 setup`, `p99 deploy`, `p99 hosts add`), over the configured token or its reference, so an unattended run needs no password-manager unlock: `P99_TOKEN=… p99 deploy --account main`. P99 never prints it. `P99_KEY` does the same for the account's `key`: for every command that signs a request to the Worker (`p99 list`, `show`, `file`, `comment`, `status`, `move`, `cards`, `watch`, the TUI and the rest), P99 signs with it as given, over the configured key or its reference, and reads no reference, so pci or an agent drives P99 without a password-manager prompt: `P99_KEY=… p99 list`. It belongs to one account: the one `P99_KEY_ACCOUNT` names, else the default account (`default_account`, or the only account). P99 signs with it only when the command's account is that one, so pci names it: `P99_KEY=… P99_KEY_ACCOUNT=main p99 …`. Every other account signs with its own key or reference and never receives `P99_KEY`, whether `--account` names it, a host belongs to it, or a command spans accounts (`p99 list --all`, `p99 hosts`, the TUI). That is a quiet fallback, never an error; an empty `P99_KEY_ACCOUNT`, or one that names no account, means `P99_KEY` is never used. Set but empty, `P99_KEY` is refused with one line. `p99 setup` still hands the Worker the configured key. P99 never prints it, and never writes it to the config.
- **`code`**, optional in an account, is your own personal code for that account's hosts, which `p99 link` opens in the browser. P99 only reads it, inline or through its reference, and never writes it: after `p99 relink --self`, put the new code there yourself.
- **`[me]`** is who the CLI and the TUI act as, on every account that doesn't say otherwise. An agent acting as that person marks its items, comments and changes, which then read as `Ada Lovelace 🤖` in every view and in mail: `--agent` marks one command, `P99_AGENT=1` (any value but empty or `0`) the commands of a shell, and `agent = true` here every command; `P99_AGENT=0` turns the config's mark off. Only signed requests carry the mark; the browser never does.
- **An account** is one Cloudflare account with its Worker, D1 database and R2 bucket. The CLI reaches the Worker at `https://<host>/_p99` of one of the account's hosts: the host a command names first, then the hosts whose environment is `production`, then the rest. A host that answers with Cloudflare Access's login, or redirects elsewhere, is skipped for the next, and the one that answered is used from then on; the signed API names the host it means with `?host=`, so any of them serves every host. `url` replaces that list with one address. Mail is not in the config: `p99 email set` puts the key in the Worker and the sender in its database. A config that still has `resend_key` and `mail_from` from an older setup keeps working, and `p99 email set` or `p99 email off` removes them. When every host of the account sits behind Cloudflare Access, either set `url` to an address of the Worker that is not behind Access, or set `access_client_id` and `access_client_secret` to an Access service token's pair: every request of the CLI, the TUI and `p99 announce` then carries them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Set both or neither. P99's own signature still guards every request. `app` (optional) is the host of the account's P99 page, the sign-in page that works when a site is down: `p99 deploy` adds the route `<app>/*` on its zone (the host needs a proxied DNS record on Cloudflare, as any route does). It may be the same host `url` reaches. Without `app`, the page answers on the Worker's `workers.dev` address, which `p99 deploy` turns on. `p99 app` prints the address.
- **`[accounts.<name>.me]`** (`name`, `email`, `agent`, each optional) is who P99 acts as on that account, field by field over `[me]`: its commands, the TUI's view of it ("assign to me" and the people list), `p99 announce`, `p99 import`, and the manager `p99 setup` names. `p99 setup --account <name> --name … --email …` writes it when `[me]` already holds someone else, and never changes `[me]`.
- **A host** belongs to one account and has one environment; `theme` (any `--p99-*` custom property without its prefix) and `strings` (any of the panel's English words, by key) are pushed to the Worker with `p99 hosts`.

## Licence key

A commercial licence comes as a key, one per company for every installation it uses. `p99 license set <key>` stores it in this file as `license`, and `p99 license set -` reads it from stdin, the armoured block included:

```
p99 license set - < p99-studio.key
p99 license show
p99 license show --json
p99 license remove
```

P99 checks the key offline against the PITO MD licence public key compiled into the binary, and never sends it anywhere. It takes only a timed P99 key with the Studio or Agency tier; a key for another app, a lifetime key, a key whose signature does not verify, or one that does not cover this build is refused. A key covers a build dated on or before its paid-through date plus its days of grace. The build date is the binary's own, fixed when it is compiled (`SOURCE_DATE_EPOCH`, or the date of the commit it was built from), never today's date, so a build made while the key was paid stays covered after the key lapses. `p99 license show` prints the state, the tier, the company, the paid-through date and whether the key covers this build, and never the key itself. A config file holding a key is treated like one holding a secret: P99 writes it with mode 0600 and refuses one anyone else can read.

The state is one word, the same everywhere: `free` with no key, or with one that is refused or doesn't cover this build; `studio` or `agency` for a company's key; `owner` and `ff` (shown as Owner and F&F) for the owner's and friends-and-family keys, which carry Agency with no lapse. P99 has no trial. The TUI shows it as a small pill at the right end of its header, `p99 license show --json` gives it as `state`, and `p99 setup` and `p99 deploy` hand only that word to the Worker, as the plain-text binding `LICENSE_STATE`, never the key. With it goes a second binding, `LICENSE_LINK`: `hideable` for an Agency key that covers this build or an Owner key, `shown` for every other state, and the panel shows its "by PITO.MD" link unless that says `hideable` and the host's `link` is `false` ([hosts](hosts.md#host-config)). `p99 hosts set <host> --pitomd-link off` refuses with one line under any other key, and `p99 license show` says whether this key may hide it (`may_hide_link` in its `--json`). The bindings change only at a deploy, so after `p99 license set` or `remove` the Worker's badge and link follow at the next `p99 deploy`, and `--pitomd-link off` hides the link once a deploy has handed the Worker this key's verdict; both say so. `p99 tui --demo` draws the Free pill.

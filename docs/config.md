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

- **Secrets** (`token`, `key`, `resend_key`, `access_client_secret`) are written inline, or as a reference P99 reads through the 1Password CLI when it is installed (`op://vault/item/field`). An inline secret makes P99 refuse a config file anyone else can read. `P99_TOKEN` in the environment comes first for every command that talks to Cloudflare (`p99 setup`, `p99 deploy`, `p99 hosts add`), over the configured token or its reference, so an unattended run needs no password-manager unlock: `P99_TOKEN=… p99 deploy --account main`. P99 never prints it.
- **`[me]`** is who the CLI and the TUI act as, on every account that doesn't say otherwise. An agent acting as that person marks its items, comments and changes, which then read as `Ada Lovelace*` in every view and in mail: `--agent` marks one command, `P99_AGENT=1` (any value but empty or `0`) the commands of a shell, and `agent = true` here every command; `P99_AGENT=0` turns the config's mark off. Only signed requests carry the mark; the browser never does.
- **An account** is one Cloudflare account with its Worker, D1 database and R2 bucket. The CLI reaches the Worker at `https://<host>/_p99` of one of the account's hosts: the host a command names first, then the hosts whose environment is `production`, then the rest. A host that answers with Cloudflare Access's login, or redirects elsewhere, is skipped for the next, and the one that answered is used from then on; the signed API names the host it means with `?host=`, so any of them serves every host. `url` replaces that list with one address. `resend_key` and `mail_from` turn mail on. When every host of the account sits behind Cloudflare Access, either set `url` to an address of the Worker that is not behind Access, or set `access_client_id` and `access_client_secret` to an Access service token's pair: every request of the CLI, the TUI and `p99 announce` then carries them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Set both or neither. P99's own signature still guards every request.
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

P99 checks the key offline against the PITO MD licence public key compiled into the binary, and never sends it anywhere. It takes only a timed P99 key with the Studio or Agency tier; a key for another app, a lifetime key, a key whose signature does not verify, or one that does not cover this build is refused. A key covers a build dated on or before its paid-through date plus its days of grace. The build date is the binary's own, fixed when it is compiled (`SOURCE_DATE_EPOCH`, or the date of the commit it was built from), never today's date, so a build made while the key was paid stays covered after the key lapses. `p99 license show` prints the tier, the company, the paid-through date and whether the key covers this build, and never the key itself. A config file holding a key is treated like one holding a secret: P99 writes it with mode 0600 and refuses one anyone else can read.

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

- **Secrets** (`token`, `key`, `resend_key`, `access_client_secret`) are written inline, or as a reference P99 reads through the 1Password CLI when it is installed (`op://vault/item/field`). An inline secret makes P99 refuse a config file anyone else can read.
- **`[me]`** is who the CLI and the TUI act as. An agent acting as that person marks its items, comments and changes, which then read as `Ada Lovelace*` in every view and in mail: `--agent` marks one command, `P99_AGENT=1` (any value but empty or `0`) the commands of a shell, and `agent = true` here every command; `P99_AGENT=0` turns the config's mark off. Only signed requests carry the mark; the browser never does.
- **An account** is one Cloudflare account with its Worker, D1 database and R2 bucket. `url` overrides where the CLI reaches the Worker; by default it is `https://<the account's first host>/_p99`. `resend_key` and `mail_from` turn mail on. When the account's hosts sit behind Cloudflare Access, either set `url` to an address of the Worker that is not behind Access, or set `access_client_id` and `access_client_secret` to an Access service token's pair: every request of the CLI, the TUI and `p99 announce` then carries them as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Set both or neither. P99's own signature still guards every request.
- **A host** belongs to one account and has one environment; `theme` (any `--p99-*` custom property without its prefix) and `strings` (any of the panel's English words, by key) are pushed to the Worker with `p99 hosts`.

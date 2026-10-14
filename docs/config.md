# Configuration

`p99 setup` writes `~/.config/p99/config.toml` (`$XDG_CONFIG_HOME/p99/config.toml` when that is set, or the file `P99_CONFIG` names) with mode 0600, and every command reads it.

```toml
default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "0123456789abcdef0123456789abcdef"
token = "op://Private/Cloudflare P99/credential"
worker = "p99"
database = "p99"
database_id = "00000000-0000-0000-0000-000000000000"
bucket = "p99"
key_id = "p99"
key = "op://Private/P99 key/credential"

[hosts."example.com"]
account = "main"
env = "production"

[hosts."dev.example.com"]
account = "main"
env = "dev"
theme = { accent = "#ffc42e" }
strings = { file = "Send" }
```

- **Secrets** (`token`, `key`, `resend_key`) are written inline, or as an `op://` reference that P99 reads with `op read` when 1Password's CLI is installed. An inline secret makes P99 refuse a config file anyone else can read.
- **`[me]`** is who the CLI and the TUI act as. `P99_AGENT` (or `--agent`) adds an agent label, so an agent's items and comments read as `Ada Lovelace (claude)`.
- **An account** is one Cloudflare account with its Worker, D1 database and R2 bucket. `url` overrides where the CLI reaches the Worker; by default it is `https://<the account's first host>/_p99`. `resend_key` and `mail_from` turn mail on.
- **A host** belongs to one account and has one environment; `theme` (any `--p99-*` custom property without its prefix) and `strings` (any of the panel's English words, by key) are pushed to the Worker with `p99 hosts`.

use std::collections::BTreeSet;
use std::io::{self, BufRead, IsTerminal, Read, Write};
use std::time::Duration;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::{Value, json};

use crate::bundle::{self, ModuleInfo};
use crate::cli::Global;
use crate::cloudflare::{ApiError, CRON, Cloudflare, Named};
use crate::config::{Account, Config, Host};
use crate::vault;

const VERSION: &str = env!("CARGO_PKG_VERSION");

static QUIET: AtomicBool = AtomicBool::new(false);

macro_rules! say {
    ($($arg:tt)*) => {
        if QUIET.load(Ordering::Relaxed) {
            eprintln!($($arg)*)
        } else {
            println!($($arg)*)
        }
    };
}

macro_rules! sayn {
    ($($arg:tt)*) => {
        if QUIET.load(Ordering::Relaxed) {
            eprint!($($arg)*)
        } else {
            print!($($arg)*)
        }
    };
}

fn flush() -> io::Result<()> {
    if QUIET.load(Ordering::Relaxed) {
        io::stderr().flush()
    } else {
        io::stdout().flush()
    }
}

fn emit<T: Serialize>(value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    println!("{text}");
    Ok(())
}

#[derive(Debug, Default, Serialize)]
struct Migrated {
    applied: Vec<String>,
    already: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Uploaded {
    bindings: Vec<String>,
}

struct Routed {
    notes: Vec<String>,
    created: bool,
}

#[derive(Debug, Serialize)]
struct Health {
    host: String,
    ok: bool,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
struct RouteReport {
    host: String,
    pattern: String,
    created: bool,
    notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Default, Serialize)]
struct DeployReport {
    account: String,
    account_id: String,
    worker: String,
    version: &'static str,
    modules: Vec<ModuleInfo>,
    migrations: Migrated,
    routes: Vec<RouteReport>,
    health: Vec<Health>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
const RESERVED_NAMESPACES: [u64; 2] = [7301, 7302];
const FIRST_NAMESPACE: u64 = 1001;
const RATE_LIMIT: u64 = 120;
const RATE_PERIOD: u64 = 60;

const PERMISSIONS: [(&str, &str); 5] = [
    (
        "Account › Workers Scripts: Edit",
        "upload the P99 Worker, set its secrets and its cron schedule",
    ),
    (
        "Account › D1: Edit",
        "create the D1 database and apply its migrations",
    ),
    (
        "Account › Workers R2 Storage: Edit",
        "create the R2 bucket that keeps attachments and backups",
    ),
    (
        "Zone › Workers Routes: Edit",
        "add the route <host>/_p99/* on each host's zone",
    ),
    ("Zone › Zone: Read", "find the zone each host belongs to"),
];

#[derive(Debug, Default, clap::Args)]
pub struct Access {
    #[arg(
        long,
        value_name = "token",
        help = "the Cloudflare API token, or a reference to it"
    )]
    pub token: Option<String>,
    #[arg(long, value_name = "id", help = "the Cloudflare account id")]
    pub account_id: Option<String>,
    #[arg(long, value_name = "name", help = "your name, as P99 shows it")]
    pub name: Option<String>,
    #[arg(
        long,
        value_name = "email",
        help = "your e-mail, which becomes a manager"
    )]
    pub email: Option<String>,
    #[arg(
        long,
        value_name = "vault",
        help = "keep the token and the key in this vault of the password manager CLI"
    )]
    pub vault: Option<String>,
    #[arg(long, help = "keep the secrets in the config file (mode 0600)")]
    pub no_vault: bool,
    #[arg(long, help = "take the default for every question, never ask")]
    pub yes: bool,
}

#[derive(Debug, clap::Args)]
pub struct SetupArgs {
    #[command(flatten)]
    pub access: Access,
    #[arg(long, value_name = "name", help = "the Worker's script name (p99)")]
    pub worker: Option<String>,
    #[arg(long, value_name = "name", help = "the D1 database's name (p99)")]
    pub database: Option<String>,
    #[arg(long, value_name = "name", help = "the R2 bucket's name (p99)")]
    pub bucket: Option<String>,
    #[arg(
        long = "host",
        value_name = "host[=env[:kind]]",
        help = "a host this account serves, with its environment and kind (production:release by default); repeat it"
    )]
    pub hosts: Vec<String>,
    #[arg(
        long,
        value_name = "id",
        help = "the rate-limiting namespace id, when setup can't pick a free one"
    )]
    pub rate_namespace: Option<u64>,
    #[arg(
        long,
        value_name = "key",
        help = "a Resend API key, which turns mail on"
    )]
    pub resend_key: Option<String>,
    #[arg(
        long,
        value_name = "from",
        help = "the mail sender, such as \"P99 <p99@example.com>\""
    )]
    pub mail_from: Option<String>,
    #[arg(long, help = "leave mail off without asking")]
    pub no_mail: bool,
}

#[derive(Debug, clap::Args)]
pub struct DeployArgs {
    #[arg(long, help = "skip the health check of the account's hosts")]
    pub no_check: bool,
}

struct Ask {
    yes: bool,
}

impl Ask {
    fn line(&self, question: &str, default: Option<&str>, flag: &str) -> Result<String, String> {
        if self.yes {
            return default
                .map(str::to_owned)
                .ok_or_else(|| format!("{question}: give it with {flag}"));
        }
        match default {
            Some(d) if !d.is_empty() => sayn!("{question} [{d}]: "),
            _ => sayn!("{question}: "),
        }
        flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        let read = io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Err(format!("{question}: no answer (give it with {flag})"));
        }
        let line = line.trim();
        if line.is_empty() {
            return match default {
                Some(d) => Ok(d.to_owned()),
                None => self.line(question, default, flag),
            };
        }
        Ok(line.to_owned())
    }

    fn confirm(&self, question: &str, default: bool) -> Result<bool, String> {
        if self.yes {
            return Ok(default);
        }
        let hint = if default { "Y/n" } else { "y/N" };
        loop {
            sayn!("{question} [{hint}]: ");
            flush().map_err(|e| e.to_string())?;
            let mut line = String::new();
            if io::stdin()
                .lock()
                .read_line(&mut line)
                .map_err(|e| e.to_string())?
                == 0
            {
                return Ok(default);
            }
            match line.trim().to_ascii_lowercase().as_str() {
                "" => return Ok(default),
                "y" | "yes" => return Ok(true),
                "n" | "no" => return Ok(false),
                _ => say!("  Answer y or n."),
            }
        }
    }

    fn secret(&self, question: &str, flag: &str) -> Result<String, String> {
        if self.yes {
            return Err(format!("{question}: give it with {flag}"));
        }
        sayn!("{question} (hidden): ");
        flush().map_err(|e| e.to_string())?;
        let value = if io::stdin().is_terminal() {
            hidden()?
        } else {
            let mut line = String::new();
            io::stdin()
                .lock()
                .read_line(&mut line)
                .map_err(|e| e.to_string())?;
            line
        };
        let value = value.trim().to_owned();
        if value.is_empty() {
            return Err(format!("{question}: an answer is needed"));
        }
        Ok(value)
    }

    fn pick<'a>(&self, what: &str, items: &'a [Named]) -> Result<&'a Named, String> {
        if items.len() == 1 {
            return Ok(&items[0]);
        }
        for (i, item) in items.iter().enumerate() {
            say!("  {}. {} ({})", i + 1, item.name, item.id);
        }
        if self.yes {
            return Err(format!("several {what}s; name one with --account-id"));
        }
        loop {
            let answer = self.line(
                &format!("Which {what}? (1-{})", items.len()),
                None,
                "--account-id",
            )?;
            match answer.parse::<usize>() {
                Ok(n) if n >= 1 && n <= items.len() => return Ok(&items[n - 1]),
                _ => {
                    if let Some(item) = items.iter().find(|i| i.id == answer || i.name == answer) {
                        return Ok(item);
                    }
                    say!("  Pick a number from the list.");
                }
            }
        }
    }
}

fn hidden() -> Result<String, String> {
    use pito_tui::crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
    use pito_tui::crossterm::terminal;
    terminal::enable_raw_mode().map_err(|e| e.to_string())?;
    let mut value = String::new();
    let outcome = loop {
        match event::read() {
            Ok(Event::Key(key)) if key.kind != KeyEventKind::Release => match key.code {
                KeyCode::Enter => break Ok(()),
                KeyCode::Backspace => {
                    value.pop();
                }
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    break Err("stopped".to_owned());
                }
                KeyCode::Char(c) => value.push(c),
                KeyCode::Esc => break Err("stopped".to_owned()),
                _ => {}
            },
            Ok(Event::Paste(text)) => value.push_str(&text),
            Ok(_) => {}
            Err(error) => break Err(error.to_string()),
        }
    };
    let _ = terminal::disable_raw_mode();
    say!();
    outcome.map(|()| value)
}

pub fn random(buf: &mut [u8]) -> Result<(), String> {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(buf))
        .map_err(|error| format!("/dev/urandom: {error}"))
}

fn new_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    random(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn step(n: usize, total: usize, title: &str, why: &str) {
    say!("\n[{n}/{total}] {title}");
    for line in why.lines() {
        say!("      {line}");
    }
}

fn done(what: &str) {
    say!("  ok  {what}");
}

fn note(what: &str) {
    say!("  --  {what}");
}

fn is_hostname(host: &str) -> bool {
    host.contains('.')
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

struct Session<'a> {
    ask: Ask,
    access: &'a Access,
    vault: Option<Option<String>>,
}

impl Session<'_> {
    fn vault(&mut self) -> Result<Option<String>, String> {
        if let Some(choice) = &self.vault {
            return Ok(choice.clone());
        }
        let choice = if self.access.no_vault {
            None
        } else if let Some(v) = &self.access.vault {
            Some(v.clone())
        } else if self.ask.yes || !vault::available() {
            None
        } else {
            say!(
                "      {} is installed: P99 can keep its secrets there and write only references to the config.",
                vault::tool()
            );
            if self.ask.confirm(
                &format!("Keep the token and the key in {}?", vault::tool()),
                true,
            )? {
                Some(self.ask.line("Which vault?", Some("Private"), "--vault")?)
            } else {
                None
            }
        };
        self.vault = Some(choice.clone());
        Ok(choice)
    }

    fn keep(&mut self, title: &str, secret: &str) -> Result<String, String> {
        if vault::is_reference(secret) {
            return Ok(secret.to_owned());
        }
        match self.vault()? {
            Some(v) => {
                let reference = vault::store(&v, title, secret)?;
                done(&format!("{title} kept in the vault {v}"));
                Ok(reference)
            }
            None => Ok(secret.to_owned()),
        }
    }

    fn me(&self, config: &mut Config) -> Result<(), String> {
        if let Some(name) = &self.access.name {
            config.me.name = name.clone();
        }
        if let Some(email) = &self.access.email {
            config.me.email = email.clone();
        }
        if config.me.name.is_empty() {
            config.me.name = self
                .ask
                .line("Your name, as P99 shows it", None, "--name")?;
        }
        while !config.me.email.contains('@') {
            config.me.email = self.ask.line(
                "Your e-mail (it becomes the account's first manager)",
                None,
                "--email",
            )?;
        }
        Ok(())
    }

    fn token(&mut self, existing: Option<&Account>) -> Result<(String, Cloudflare, Named), String> {
        let configured = existing.map(|a| a.token.clone()).filter(|t| !t.is_empty());
        let mut stored = self.access.token.clone().or_else(|| configured.clone());
        if stored.is_none() {
            say!("      P99 needs a Cloudflare API token with these permissions:");
            for (permission, why) in PERMISSIONS {
                say!("        {permission:<38} to {why}");
            }
            say!(
                "      Create one in the dashboard under My Profile › API Tokens › Create Token › Custom token,"
            );
            say!("      or for a token the account owns, Manage Account › Account API Tokens.");
            say!("      Limit it to the account and the zones of your hosts.");
        }
        loop {
            let raw = match stored.take() {
                Some(s) => s,
                None => self.ask.secret("Paste the token", "--token")?,
            };
            let plain = vault::read(&raw)?;
            let cf = Cloudflare::new(&plain);
            let accounts = match reach(&cf) {
                Ok(accounts) => accounts,
                Err(why) => {
                    say!("  !!  {why}");
                    if self.ask.yes {
                        return Err(why);
                    }
                    continue;
                }
            };
            done("Cloudflare accepts the token");
            let wanted = self.access.account_id.clone().or_else(|| {
                existing
                    .map(|a| a.account_id.clone())
                    .filter(|a| !a.is_empty())
            });
            let account = match wanted {
                Some(id) => accounts
                    .iter()
                    .find(|a| a.id == id)
                    .cloned()
                    .unwrap_or(Named {
                        id,
                        name: String::new(),
                    }),
                None if accounts.is_empty() => Named {
                    id: self
                        .ask
                        .line("The Cloudflare account id", None, "--account-id")?,
                    name: String::new(),
                },
                None => {
                    say!("      The token reaches these accounts:");
                    self.ask.pick("account", &accounts)?.clone()
                }
            };
            done(&format!(
                "account {} {}",
                account.id,
                if account.name.is_empty() {
                    ""
                } else {
                    &account.name
                }
            ));
            let missing = probe(&cf, &account.id)?;
            if missing.is_empty() {
                done("the token can list Workers, D1, R2, zones and routes");
                let kept = if configured.as_deref() == Some(raw.as_str()) {
                    raw
                } else {
                    self.keep("P99 Cloudflare token", &raw)?
                };
                return Ok((kept, cf, account));
            }
            say!("  !!  The token lacks:");
            for m in &missing {
                say!("        {m}");
            }
            if self.ask.yes {
                return Err(format!("the token lacks {}", missing.join(", ")));
            }
            say!("      Edit the token in the dashboard to add them, then paste it again.");
        }
    }
}

fn reach(cf: &Cloudflare) -> Result<Vec<Named>, String> {
    match cf.verify() {
        Ok(v) if v["status"].as_str().is_none_or(|s| s == "active") => {
            return cf.accounts().map_err(String::from);
        }
        Ok(v) => return Err(format!("the token is {}", v["status"])),
        Err(_) => {}
    }
    let accounts = cf
        .accounts()
        .map_err(|e| format!("Cloudflare doesn't accept this token ({e})"))?;
    for account in &accounts {
        if let Ok(v) = cf.verify_account(&account.id) {
            if v["status"].as_str().is_none_or(|s| s == "active") {
                return Ok(accounts);
            }
            return Err(format!("the token is {}", v["status"]));
        }
    }
    Err("Cloudflare doesn't accept this token".into())
}

fn probe(cf: &Cloudflare, account: &str) -> Result<Vec<&'static str>, String> {
    let mut missing = Vec::new();
    let mut check = |result: Result<(), ApiError>, permission: &'static str| match result {
        Ok(()) => Ok(()),
        Err(e) if e.denied() => {
            missing.push(permission);
            Ok(())
        }
        Err(e) => Err(e.message),
    };
    check(cf.scripts(account).map(drop), PERMISSIONS[0].0)?;
    check(cf.databases(account).map(drop), PERMISSIONS[1].0)?;
    check(cf.buckets(account).map(drop), PERMISSIONS[2].0)?;
    let zones = cf.zones(account);
    let first = zones.as_ref().ok().and_then(|z| z.first().cloned());
    check(zones.map(drop), PERMISSIONS[4].0)?;
    match first {
        Some(zone) => check(cf.routes(&zone.id).map(drop), PERMISSIONS[3].0)?,
        None if !missing.contains(&PERMISSIONS[4].0) => {
            note("the token reaches no zone yet; routes are checked when hosts are added")
        }
        None => {}
    }
    Ok(missing)
}

fn ensure_database(cf: &Cloudflare, account: &str, id: &str, name: &str) -> Result<Named, String> {
    let all = cf.databases(account)?;
    if let Some(db) = all
        .iter()
        .find(|d| (!id.is_empty() && d.id == id) || (id.is_empty() && d.name == name))
    {
        done(&format!("D1 database {} ({}) is there", db.name, db.id));
        return Ok(db.clone());
    }
    let db = cf.create_database(account, name)?;
    done(&format!("created the D1 database {} ({})", db.name, db.id));
    Ok(db)
}

pub fn pending<'a>(all: &[(&'a str, &'a str)], applied: &[String]) -> Vec<(&'a str, &'a str)> {
    let mut todo: Vec<(&str, &str)> = all
        .iter()
        .filter(|(name, _)| !applied.iter().any(|a| a == name))
        .copied()
        .collect();
    todo.sort_by(|a, b| a.0.cmp(b.0));
    todo
}

pub fn migration_sql(name: &str, sql: &str) -> String {
    format!(
        "{}\nINSERT INTO d1_migrations (name) VALUES ('{}');",
        sql.trim_end(),
        name.replace('\'', "''")
    )
}

const MIGRATIONS_TABLE: &str = "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);";

fn applied(cf: &Cloudflare, account: &str, db: &str) -> Result<Vec<String>, String> {
    let rows = cf.query(
        account,
        db,
        "SELECT name FROM d1_migrations ORDER BY id",
        &[],
    );
    match rows {
        Ok(rows) => Ok(rows
            .iter()
            .filter_map(|r| r["name"].as_str().map(str::to_owned))
            .collect()),
        Err(e) if e.message.contains("no such table") => Ok(Vec::new()),
        Err(e) => Err(e.message),
    }
}

fn migrate(cf: &Cloudflare, account: &str, db: &str) -> Result<Migrated, String> {
    cf.query(account, db, MIGRATIONS_TABLE, &[])?;
    let applied = applied(cf, account, db)?;
    let todo = pending(bundle::MIGRATIONS, &applied);
    let mut out = Migrated {
        applied: Vec::new(),
        already: bundle::MIGRATIONS
            .iter()
            .filter(|(name, _)| applied.iter().any(|a| a == name))
            .map(|(name, _)| (*name).to_owned())
            .collect(),
    };
    out.already.sort();
    if todo.is_empty() {
        done("every migration is applied");
    }
    for (name, sql) in todo {
        cf.query(account, db, &migration_sql(name, sql), &[])?;
        done(&format!("applied {name}"));
        out.applied.push(name.to_owned());
    }
    Ok(out)
}

fn ensure_bucket(cf: &Cloudflare, account: &str, name: &str) -> Result<(), String> {
    if cf.buckets(account)?.iter().any(|b| b == name) {
        done(&format!("R2 bucket {name} is there"));
        return Ok(());
    }
    cf.create_bucket(account, name)?;
    done(&format!("created the R2 bucket {name}"));
    Ok(())
}

fn binding_name(binding: &Value) -> &str {
    binding["name"].as_str().unwrap_or_default()
}

fn find_binding<'a>(bindings: &'a [Value], kind: &str, name: Option<&str>) -> Option<&'a Value> {
    bindings
        .iter()
        .find(|b| b["type"] == kind && name.is_none_or(|n| binding_name(b) == n))
}

fn d1_id(binding: &Value) -> String {
    binding["database_id"]
        .as_str()
        .or_else(|| binding["id"].as_str())
        .unwrap_or_default()
        .to_owned()
}

fn merge_bindings(existing: &[Value], ours: Vec<Value>) -> Vec<Value> {
    let names: BTreeSet<String> = ours.iter().map(|b| binding_name(b).to_owned()).collect();
    let mut all = ours;
    all.extend(
        existing
            .iter()
            .filter(|b| !matches!(b["type"].as_str(), Some("secret_text" | "secret_key")))
            .filter(|b| !names.contains(binding_name(b)))
            .cloned(),
    );
    all
}

fn our_bindings(account: &Account, rate: Option<u64>) -> Vec<Value> {
    let mut ours = vec![
        json!({ "type": "d1", "name": "DB", "database_id": account.database_id }),
        json!({ "type": "r2_bucket", "name": "BUCKET", "bucket_name": account.bucket }),
        json!({ "type": "plain_text", "name": "VERSION", "text": VERSION }),
    ];
    if let Some(ns) = rate {
        ours.push(json!({
            "type": "ratelimit",
            "name": "RATE",
            "namespace_id": ns.to_string(),
            "simple": { "limit": RATE_LIMIT, "period": RATE_PERIOD },
        }));
    }
    if let Some(from) = &account.mail_from {
        ours.push(json!({ "type": "plain_text", "name": "MAIL_FROM", "text": from }));
    }
    ours
}

fn rate_namespace(
    cf: &Cloudflare,
    ask: &Ask,
    account: &str,
    worker: &str,
    flag: Option<u64>,
) -> Result<u64, String> {
    if let Some(ns) = flag {
        return Ok(ns);
    }
    let used = (|| -> Result<BTreeSet<u64>, ApiError> {
        let mut used = BTreeSet::new();
        for script in cf.scripts(account)? {
            if script == worker {
                continue;
            }
            for b in cf.bindings(account, &script)?.unwrap_or_default() {
                if b["type"] == "ratelimit" {
                    let ns = &b["namespace_id"];
                    if let Some(n) = ns
                        .as_u64()
                        .or_else(|| ns.as_str().and_then(|s| s.parse().ok()))
                    {
                        used.insert(n);
                    }
                }
            }
        }
        Ok(used)
    })();
    match used {
        Ok(used) => {
            let ns = (FIRST_NAMESPACE..)
                .find(|n| !used.contains(n) && !RESERVED_NAMESPACES.contains(n))
                .unwrap_or(FIRST_NAMESPACE);
            done(&format!(
                "rate-limiting namespace {ns} (the account's other Workers use {})",
                if used.is_empty() {
                    "none".to_owned()
                } else {
                    used.iter()
                        .map(u64::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ));
            Ok(ns)
        }
        Err(e) => {
            say!("  !!  Couldn't read the other Workers' rate-limiting namespaces: {e}");
            say!(
                "      Pick a whole number no other Worker in the account uses (never 7301 or 7302)."
            );
            loop {
                let answer = ask.line("Rate-limiting namespace id", None, "--rate-namespace")?;
                match answer.parse::<u64>() {
                    Ok(n) if n > 0 && !RESERVED_NAMESPACES.contains(&n) => return Ok(n),
                    _ => say!("  Give a positive whole number other than 7301 and 7302."),
                }
            }
        }
    }
}

fn upload(
    cf: &Cloudflare,
    account: &Account,
    existing: &[Value],
    rate: Option<u64>,
) -> Result<Uploaded, String> {
    let bindings = merge_bindings(existing, our_bindings(account, rate));
    cf.upload(
        &account.account_id,
        &account.worker,
        bundle::MAIN,
        &bindings,
        &bundle::modules(),
    )?;
    let names: Vec<String> = bindings
        .iter()
        .map(|b| binding_name(b).to_owned())
        .collect();
    done(&format!(
        "uploaded the Worker {} ({VERSION}) with {}",
        account.worker,
        names.join(", ")
    ));
    cf.put_schedules(&account.account_id, &account.worker, &[CRON])?;
    done(&format!(
        "cron schedule {CRON} (the weekly backup runs in its steps)"
    ));
    Ok(Uploaded { bindings: names })
}

pub struct HostSpec {
    pub host: String,
    pub env: String,
    pub kind: String,
}

fn parse_host(spec: &str) -> Result<HostSpec, String> {
    let (host, rest) = spec.split_once('=').unwrap_or((spec, ""));
    let (env, kind) = rest.split_once(':').unwrap_or((rest, ""));
    let host = host.trim().to_ascii_lowercase();
    if !is_hostname(&host) {
        return Err(format!("{host} is not a hostname"));
    }
    let env = if env.is_empty() { "production" } else { env }.to_owned();
    let kind = match kind {
        "" if env == "production" => "release",
        "" => "development",
        k => k,
    }
    .to_owned();
    check_kind(&kind)?;
    Ok(HostSpec { host, env, kind })
}

fn check_kind(kind: &str) -> Result<(), String> {
    if kind == "release" || kind == "development" {
        Ok(())
    } else {
        Err(format!(
            "{kind} is not an environment kind; use release or development"
        ))
    }
}

fn write_env(cf: &Cloudflare, account: &Account, env: &str, kind: &str) -> Result<(), String> {
    cf.query(
        &account.account_id,
        &account.database_id,
        "INSERT INTO envs (name, kind, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM envs)) ON CONFLICT (name) DO UPDATE SET kind = excluded.kind",
        &[json!(env), json!(kind)],
    )?;
    Ok(())
}

fn write_host(cf: &Cloudflare, account: &Account, host: &str, entry: &Host) -> Result<(), String> {
    let config = entry.pushed();
    cf.query(
        &account.account_id,
        &account.database_id,
        "INSERT INTO hosts (host, env, config_json, created_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (host) DO UPDATE SET env = excluded.env, config_json = excluded.config_json",
        &[json!(host), json!(entry.env), json!(config.to_string())],
    )?;
    Ok(())
}

fn route_pattern(host: &str) -> String {
    format!("{host}/_p99/*")
}

fn route(
    cf: &Cloudflare,
    account: &str,
    worker: &str,
    zones: &[Named],
    host: &str,
) -> Result<Routed, String> {
    let mut notes = Vec::new();
    let mut created = false;
    let zone = crate::cloudflare::zone_of(zones, host).ok_or_else(|| {
        format!("{host} is on no zone this token reaches; add the zone to Cloudflare or to the token's Zone › Zone: Read")
    })?;
    notes.push(format!("{host} is on the zone {}", zone.name));
    match cf.custom_domain(account, host) {
        Ok(Some(service)) => notes.push(format!(
            "the Worker {service} serves {host} as a Custom Domain; it stays, and the route runs in front of it for /_p99/*"
        )),
        Ok(None) => {}
        Err(e) => notes.push(format!("couldn't check Custom Domains: {e}")),
    }
    match cf.pages_project(account, host) {
        Ok(Some(project)) => notes.push(format!(
            "the Pages project {project} serves {host}; it stays, and the route runs in front of it for /_p99/*"
        )),
        Ok(None) => {}
        Err(e) if e.denied() => notes.push("couldn't check Pages projects (the token has no Pages read; nothing needs it)".into()),
        Err(e) => notes.push(format!("couldn't check Pages projects: {e}")),
    }
    let pattern = route_pattern(host);
    let routes = cf.routes(&zone.id)?;
    for r in routes
        .iter()
        .filter(|r| r.pattern != pattern && covers(&r.pattern, host))
    {
        notes.push(format!(
            "the route {} runs {}; P99's more specific route takes /_p99/* only",
            r.pattern,
            if r.script.is_empty() {
                "no Worker"
            } else {
                &r.script
            }
        ));
    }
    match routes.iter().find(|r| r.pattern == pattern) {
        Some(r) if r.script == worker => notes.push(format!("the route {pattern} is there")),
        Some(r) => {
            return Err(format!(
                "the route {pattern} already runs the Worker {}; P99 leaves it alone (remove it in the dashboard to give it to {worker})",
                if r.script.is_empty() {
                    "(none)"
                } else {
                    &r.script
                }
            ));
        }
        None => {
            cf.create_route(&zone.id, &pattern, worker)?;
            created = true;
            notes.push(format!("added the route {pattern} → {worker}"));
        }
    }
    Ok(Routed { notes, created })
}

fn covers(pattern: &str, host: &str) -> bool {
    let pattern = pattern
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let pattern_host = pattern.split('/').next().unwrap_or_default();
    match pattern_host.strip_prefix('*') {
        Some(rest) => host.ends_with(rest),
        None => pattern_host == host,
    }
}

pub fn add_route(config: &Config, account: &str, host: &str) -> Result<(), String> {
    let entry = config
        .accounts
        .get(account)
        .ok_or_else(|| format!("no account is called {account}"))?;
    let cf = Cloudflare::new(&vault::read(&entry.token)?);
    let zones = cf.zones(&entry.account_id)?;
    for line in route(&cf, &entry.account_id, &entry.worker, &zones, host)?.notes {
        eprintln!("{line}");
    }
    Ok(())
}

fn health(hosts: &[&str]) -> Vec<Health> {
    let mut out = Vec::new();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .new_agent();
    for host in hosts {
        let url = format!("https://{host}/_p99/health");
        let mut last = String::new();
        let mut answered = None;
        for attempt in 0..6 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_secs(5));
            }
            match agent.get(&url).call() {
                Ok(mut r) if r.status().as_u16() == 200 => {
                    let body: Value = r.body_mut().read_json().unwrap_or_default();
                    let version = body["version"].as_str().unwrap_or_default();
                    answered = Some(version.to_owned());
                    if version == VERSION {
                        last.clear();
                        break;
                    }
                    last = format!("answers version {version}, not {VERSION} yet");
                }
                Ok(r) => last = format!("answers HTTP {}", r.status().as_u16()),
                Err(e) => last = e.to_string(),
            }
        }
        out.push(Health {
            host: (*host).to_owned(),
            ok: last.is_empty(),
            version: answered,
        });
        if last.is_empty() {
            done(&format!("{url} answers {VERSION}"));
        } else {
            say!(
                "  !!  {url} {last}; the route or DNS may need a minute (is the host proxied through Cloudflare?)"
            );
        }
    }
    out
}

pub fn setup(args: &SetupArgs, global: &Global) -> Result<(), String> {
    QUIET.store(global.json, Ordering::Relaxed);
    let mut config = Config::load()?;
    let mut s = Session {
        ask: Ask {
            yes: args.access.yes,
        },
        access: &args.access,
        vault: None,
    };
    let total = 9;
    say!(
        "P99 setup puts P99 on a Cloudflare account: one D1 database, one R2 bucket and one Worker,"
    );
    say!(
        "mounted on each of your hosts as <host>/_p99/*. Every step checks what exists first, so it"
    );
    say!(
        "is safe to run again: it picks up where it stopped, and the config is saved after each step."
    );

    step(
        1,
        total,
        "You",
        "P99 acts as you in the CLI and the TUI, and your e-mail is the account's first manager.",
    );
    s.me(&mut config)?;
    let name = match &global.account {
        Some(name) => name.clone(),
        None if config.accounts.is_empty() => "main".to_owned(),
        None => {
            let names: Vec<&str> = config.accounts.keys().map(String::as_str).collect();
            say!(
                "      The config has the account{} {}. Name one to continue its setup, or a new name to add an account.",
                if names.len() == 1 { "" } else { "s" },
                names.join(", ")
            );
            s.ask.line("Account name", None, "--account")?
        }
    };
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(format!(
            "{name}: use letters, digits, - and _ in an account name"
        ));
    }
    if config.accounts.contains_key(&name) {
        note(&format!("continuing the setup of the account {name}"));
    } else {
        note(&format!(
            "adding the account {name}; other accounts stay as they are"
        ));
    }
    config.save()?;

    step(
        2,
        total,
        "The Cloudflare token",
        "P99 talks to Cloudflare's API with a token you create, limited to what it needs.\nThe token is checked against Cloudflare before anything is created.",
    );
    let existing = config.accounts.get(&name).cloned();
    let (token, cf, cf_account) = s.token(existing.as_ref())?;
    let mut account = existing.unwrap_or_else(|| Account {
        account_id: String::new(),
        token: String::new(),
        worker: "p99".into(),
        database: "p99".into(),
        database_id: String::new(),
        bucket: "p99".into(),
        key_id: "p99".into(),
        key: String::new(),
        url: None,
        resend_key: None,
        mail_from: None,
        access_client_id: None,
        access_client_secret: None,
    });
    if account.account_id != cf_account.id {
        account.database_id.clear();
    }
    account.account_id = cf_account.id.clone();
    account.token = token;
    if let Some(w) = &args.worker {
        account.worker = w.clone();
    }
    if let Some(d) = &args.database {
        if *d != account.database {
            account.database_id.clear();
        }
        account.database = d.clone();
    }
    if let Some(b) = &args.bucket {
        account.bucket = b.clone();
    }
    let id = account.account_id.clone();
    let save = |config: &mut Config, account: &Account| -> Result<(), String> {
        config.accounts.insert(name.clone(), account.clone());
        if config.default_account.is_none() {
            config.default_account = Some(name.clone());
        }
        config.save()
    };
    save(&mut config, &account)?;

    step(
        3,
        total,
        "The D1 database",
        "D1 keeps items, comments, events, codes, hosts and environments.",
    );
    let db = ensure_database(&cf, &id, &account.database_id, &account.database)?;
    account.database = db.name;
    account.database_id = db.id;
    save(&mut config, &account)?;

    step(
        4,
        total,
        "The schema",
        "Migrations are applied in order and recorded in d1_migrations, as wrangler records them.",
    );
    migrate(&cf, &id, &account.database_id)?;

    step(
        5,
        total,
        "The R2 bucket",
        "R2 keeps screenshots, attachments and the weekly backups.",
    );
    ensure_bucket(&cf, &id, &account.bucket)?;
    save(&mut config, &account)?;

    step(
        6,
        total,
        "The key",
        "The CLI and the TUI sign every request with the account's key (key id p99); the Worker\nholds the same key as its secret KEY_P99.",
    );
    if account.key.is_empty() {
        let key = new_key()?;
        account.key = s.keep("P99 key", &key)?;
        done("made a new key (32 random bytes)");
    } else {
        done("the account has its key");
    }
    save(&mut config, &account)?;

    step(
        7,
        total,
        "Mail (optional)",
        "P99 sends no mail by default: the TUI is the inbox. With a Resend API key it mails\nmanagers about new items and reporters about replies and fixes.",
    );
    if let Some(k) = &args.resend_key {
        account.resend_key = Some(s.keep("P99 Resend key", k)?);
    } else if account.resend_key.is_none()
        && !args.no_mail
        && !s.ask.yes
        && s.ask.confirm("Turn mail on through Resend?", false)?
    {
        let k = s.ask.secret("Resend API key", "--resend-key")?;
        account.resend_key = Some(s.keep("P99 Resend key", &k)?);
    }
    if let Some(f) = &args.mail_from {
        account.mail_from = Some(f.clone());
    } else if account.resend_key.is_some() && account.mail_from.is_none() {
        account.mail_from = Some(s.ask.line(
            "Mail sender, such as P99 <p99@example.com>",
            None,
            "--mail-from",
        )?);
    }
    if account.resend_key.is_some() {
        done("mail is on");
    } else {
        done("mail stays off");
    }
    save(&mut config, &account)?;

    step(
        8,
        total,
        "The Worker",
        "One Worker serves every host of the account. It is uploaded with its bindings (DB, BUCKET,\nRATE, VERSION) and its secrets (KEY_P99, MANAGERS).",
    );
    let existing = cf.bindings(&id, &account.worker)?;
    if let Some(bindings) = &existing
        && let Some(db) = find_binding(bindings, "d1", Some("DB"))
        && d1_id(db) != account.database_id
    {
        return Err(format!(
            "a Worker called {} already exists in the account and uses another database; give P99's Worker another name with --worker",
            account.worker
        ));
    }
    let bindings = existing.unwrap_or_default();
    let rate = match find_binding(&bindings, "ratelimit", Some("RATE")) {
        Some(_) => None,
        None => Some(rate_namespace(
            &cf,
            &s.ask,
            &id,
            &account.worker,
            args.rate_namespace,
        )?),
    };
    upload(&cf, &account, &bindings, rate)?;
    let secrets = cf.secrets(&id, &account.worker)?;
    cf.put_secret(&id, &account.worker, "KEY_P99", &vault::read(&account.key)?)?;
    done("secret KEY_P99");
    if !secrets.iter().any(|s| s == "MANAGERS") {
        cf.put_secret(&id, &account.worker, "MANAGERS", &config.me.email)?;
        done(&format!("secret MANAGERS = {}", config.me.email));
    } else {
        done("secret MANAGERS is kept as it is");
    }
    if let Some(k) = &account.resend_key {
        cf.put_secret(&id, &account.worker, "RESEND_API_KEY", &vault::read(k)?)?;
        done("secret RESEND_API_KEY");
    }

    step(
        9,
        total,
        "The hosts",
        "Each host gets the route <host>/_p99/* on its zone, so pages talk only to their own origin.\nA host has one environment: production (release) by default; a development address is\nits own host with an environment such as dev (development).",
    );
    let mut specs = Vec::new();
    for spec in &args.hosts {
        specs.push(parse_host(spec)?);
    }
    if specs.is_empty() {
        let known: Vec<&str> = config.hosts_of(&name);
        let default = known.join(", ");
        if default.is_empty() {
            say!("      Leave it blank to add hosts later with p99 hosts add.");
        }
        let answer = s.ask.line(
            "Hosts this account serves, comma separated",
            Some(default.as_str()),
            "--host",
        )?;
        for host in answer.split([',', ' ']).filter(|h| !h.is_empty()) {
            let host = host.trim().to_ascii_lowercase();
            if !is_hostname(&host) {
                return Err(format!("{host} is not a hostname"));
            }
            let current = config.hosts.get(&host).map(|h| h.env.clone());
            let env = s.ask.line(
                &format!("Environment of {host}"),
                Some(current.as_deref().unwrap_or("production")),
                "--host",
            )?;
            let kind_default = if env == "production" {
                "release"
            } else {
                "development"
            };
            let kind = s.ask.line(
                &format!("Kind of {env}: release or development"),
                Some(kind_default),
                "--host",
            )?;
            check_kind(&kind)?;
            specs.push(HostSpec { host, env, kind });
        }
    }
    let zones = cf.zones(&id)?;
    let mut failed = Vec::new();
    let mut routed: Vec<(String, Routed)> = Vec::new();
    for spec in &specs {
        if let Some(other) = config.hosts.get(&spec.host).filter(|h| h.account != name) {
            say!(
                "  !!  {} belongs to the account {}; skipped",
                spec.host,
                other.account
            );
            failed.push(spec.host.clone());
            continue;
        }
        match route(&cf, &id, &account.worker, &zones, &spec.host) {
            Ok(routes) => {
                routes.notes.iter().for_each(|n| done(n));
                routed.push((spec.host.clone(), routes));
            }
            Err(why) => {
                say!("  !!  {why}");
                failed.push(spec.host.clone());
                continue;
            }
        }
        let mut entry = config.hosts.get(&spec.host).cloned().unwrap_or_default();
        entry.account = name.clone();
        entry.env = spec.env.clone();
        write_env(&cf, &account, &spec.env, &spec.kind)?;
        write_host(&cf, &account, &spec.host, &entry)?;
        done(&format!(
            "{} serves the environment {} ({})",
            spec.host, spec.env, spec.kind
        ));
        config.hosts.insert(spec.host.clone(), entry);
        config.save()?;
    }

    let hosts: Vec<&str> = config.hosts_of(&name);
    let mut checked = Vec::new();
    if !hosts.is_empty() {
        say!("\nChecking the hosts answer this version:");
        checked = health(&hosts);
    }
    say!("\nThe account {name} is set up:");
    say!("  Cloudflare account  {}", account.account_id);
    say!("  Worker              {} ({VERSION})", account.worker);
    say!(
        "  D1 database         {} ({})",
        account.database,
        account.database_id
    );
    say!("  R2 bucket           {}", account.bucket);
    say!(
        "  key                 p99, {}",
        if vault::is_reference(&account.key) {
            "kept in the vault"
        } else {
            "in the config (mode 0600)"
        }
    );
    say!(
        "  mail                {}",
        if account.resend_key.is_some() {
            "on"
        } else {
            "off"
        }
    );
    for host in &hosts {
        let env = &config.hosts[*host].env;
        say!("  host                {host} ({env})");
    }
    say!("  config              {}", crate::config::path().display());
    if !failed.is_empty() {
        say!(
            "\nNot added: {}. Fix what's named above and run p99 setup again.",
            failed.join(", ")
        );
    }
    say!(
        "\nPut <script src=\"/_p99/p99.js\" async></script> in your pages' <head>, then invite people:"
    );
    let host = hosts.first().copied().unwrap_or("<host>");
    let invite = format!(
        "p99 invite {host} --name \"{}\" --email {}",
        config.me.name, config.me.email
    );
    say!("  {invite}");
    if global.json {
        let hosts_json: Vec<Value> = hosts
            .iter()
            .map(|h| {
                let did = routed.iter().find(|(r, _)| r == h).map(|(_, r)| r);
                let kind = specs.iter().find(|s| s.host == *h).map(|s| s.kind.clone());
                json!({
                    "host": h,
                    "env": config.hosts[*h].env,
                    "kind": kind,
                    "routes": [route_pattern(h)],
                    "created": did.map(|r| r.created),
                    "notes": did.map(|r| r.notes.clone()).unwrap_or_default(),
                    "health": checked.iter().find(|c| c.host == *h),
                })
            })
            .collect();
        emit(&json!({
            "account": name,
            "account_id": account.account_id,
            "worker": account.worker,
            "version": VERSION,
            "database": {"name": account.database, "id": account.database_id},
            "bucket": account.bucket,
            "key": if vault::is_reference(&account.key) { "vault" } else { "config" },
            "mail": account.resend_key.is_some(),
            "hosts": hosts_json,
            "failed": failed,
            "config": crate::config::path().display().to_string(),
            "next": invite,
            "ok": failed.is_empty(),
        }))?;
    }
    Ok(())
}

pub fn deploy(args: &DeployArgs, global: &Global) -> Result<(), String> {
    QUIET.store(global.json, Ordering::Relaxed);
    let mut report = DeployReport {
        version: VERSION,
        modules: bundle::listing(),
        ..Default::default()
    };
    let result = deploy_into(args, global, &mut report);
    report.ok = result.is_ok();
    if let Err(why) = &result {
        report.error = Some(why.clone());
    }
    if global.json {
        emit(&report)?;
    }
    result
}

fn deploy_into(
    args: &DeployArgs,
    global: &Global,
    report: &mut DeployReport,
) -> Result<(), String> {
    let config = Config::load()?;
    let (name, account) = config.account(global.account.as_deref())?;
    report.account = name.to_owned();
    report.account_id = account.account_id.clone();
    report.worker = account.worker.clone();
    let cf = Cloudflare::new(&vault::read(&account.token)?);
    let id = &account.account_id;
    say!("Deploying P99 {VERSION} to the account {name} ({id}):");
    let bindings = cf.bindings(id, &account.worker)?.ok_or_else(|| {
        format!(
            "the account has no Worker called {}; run p99 setup",
            account.worker
        )
    })?;
    report.migrations = migrate(&cf, id, &account.database_id)?;
    let rate = match find_binding(&bindings, "ratelimit", Some("RATE")) {
        Some(_) => None,
        None => rate_namespace(&cf, &Ask { yes: true }, id, &account.worker, None).ok(),
    };
    upload(&cf, account, &bindings, rate)?;
    done("secrets kept");
    let hosts = config.hosts_of(name);
    let zones = cf.zones(id)?;
    let mut failed = Vec::new();
    for host in &hosts {
        let pattern = route_pattern(host);
        match route(&cf, id, &account.worker, &zones, host) {
            Ok(routed) => {
                routed.notes.iter().for_each(|n| done(n));
                report.routes.push(RouteReport {
                    host: (*host).to_owned(),
                    pattern,
                    created: routed.created,
                    notes: routed.notes,
                    error: None,
                });
            }
            Err(why) => {
                say!("  !!  {why}");
                report.routes.push(RouteReport {
                    host: (*host).to_owned(),
                    pattern,
                    created: false,
                    notes: Vec::new(),
                    error: Some(why),
                });
                failed.push(*host);
            }
        }
    }
    if !args.no_check && !hosts.is_empty() {
        report.health = health(&hosts);
    }
    if !failed.is_empty() {
        return Err(format!("no route for {}", failed.join(", ")));
    }
    let unhealthy: Vec<&str> = report
        .health
        .iter()
        .filter(|h| !h.ok)
        .map(|h| h.host.as_str())
        .collect();
    if unhealthy.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "no answer of version {VERSION} from {}",
            unhealthy.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_in_order_and_skip_the_recorded() {
        let all = [
            ("0002_y.sql", "B"),
            ("0001_p99.sql", "A"),
            ("0003_x.sql", "C"),
        ];
        fn names<'a>(v: Vec<(&'a str, &'a str)>) -> Vec<&'a str> {
            v.into_iter().map(|t| t.0).collect()
        }
        assert_eq!(
            names(pending(&all, &[])),
            ["0001_p99.sql", "0002_y.sql", "0003_x.sql"]
        );
        assert_eq!(
            names(pending(&all, &["0001_p99.sql".to_owned()])),
            ["0002_y.sql", "0003_x.sql"]
        );
        assert!(
            pending(
                &all[..2],
                &["0002_y.sql".into(), "0001_p99.sql".into()]
            )
            .is_empty()
        );
        assert_eq!(
            migration_sql("0002_y.sql", "CREATE TABLE t (a);\n"),
            "CREATE TABLE t (a);\nINSERT INTO d1_migrations (name) VALUES ('0002_y.sql');"
        );
        let bundled: Vec<&str> = bundle::MIGRATIONS.iter().map(|m| m.0).collect();
        let mut sorted = bundled.clone();
        sorted.sort();
        assert_eq!(bundled, sorted);
    }
}

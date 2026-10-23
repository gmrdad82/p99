use std::collections::BTreeSet;
use std::io::{self, BufRead, IsTerminal, Read, Write};
use std::time::Duration;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::{Value, json};

use crate::bundle::{self, ModuleInfo};
use crate::cli::Global;
use crate::cloudflare::{ApiError, CRON, Cloudflare, Named};
use crate::config::{Account, AccountMe, Config, Host};
use crate::license::State;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    accepted: Option<String>,
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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    access: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unresolved: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    app: Option<String>,
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
const HUB_CLASS: &str = "P99Hub";
const HUB_TAG: &str = "p99-hub-1";

const PERMISSIONS: [(&str, &str); 5] = [
    (
        "Account › Workers Scripts: Edit",
        "upload the P99 Worker with its Durable Object, set its secrets and its cron schedule",
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

#[derive(Default, clap::Args)]
pub struct Access {
    #[arg(
        long,
        value_name = "token",
        help = "the Cloudflare API token, or a reference to it; P99_TOKEN in the environment keeps it out of the shell history"
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

#[derive(clap::Args)]
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
        help = "a Resend API key, which turns mail on; P99_RESEND_KEY in the environment keeps it out of the shell history"
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
    #[arg(
        long,
        value_name = "hash",
        help = "the hash `p99 migrate --plan` printed, which data-changing migrations need"
    )]
    pub accept_plan: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct DeployArgs {
    #[arg(long, help = "skip the health check of the account's hosts")]
    pub no_check: bool,
    #[arg(
        long,
        value_name = "hash",
        help = "the hash `p99 migrate --plan` printed, which data-changing migrations need"
    )]
    pub accept_plan: Option<String>,
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

fn pepper(cf: &Cloudflare, id: &str, worker: &str, secrets: &[String]) -> Result<(), String> {
    if secrets.iter().any(|s| s == "CODE_PEPPER") {
        done("secret CODE_PEPPER is kept as it is");
        return Ok(());
    }
    cf.put_secret(id, worker, "CODE_PEPPER", &new_key()?)?;
    done("secret CODE_PEPPER");
    Ok(())
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

pub(crate) fn is_hostname(host: &str) -> bool {
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
    hosts: Vec<String>,
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

    fn me(&self, config: &mut Config, account: &str) -> Result<AccountMe, String> {
        let known = config.accounts.get(account).map(|a| a.me.clone());
        if config.me.email.is_empty() {
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
            return Ok(known.unwrap_or_default());
        }
        let mut over = known.clone().unwrap_or_default();
        let mut name = self.access.name.clone();
        let mut email = self.access.email.clone();
        if name.is_none() && email.is_none() && known.is_none() {
            let who = format!("{} <{}>", config.me.name, config.me.email);
            if !self
                .ask
                .confirm(&format!("Act as {who} on this account?"), true)?
            {
                name = Some(self.ask.line(
                    "Your name on this account, as P99 shows it",
                    Some(&config.me.name),
                    "--name",
                )?);
                email = Some(self.ask.line(
                    "Your e-mail on this account (it becomes its first manager)",
                    None,
                    "--email",
                )?);
            }
        }
        if let Some(name) = name {
            over.name = (name != config.me.name).then_some(name);
        }
        if let Some(email) = email {
            over.email = (email != config.me.email).then_some(email);
        }
        if config.me.name.is_empty() && over.name.is_none() {
            config.me.name = self
                .ask
                .line("Your name, as P99 shows it", None, "--name")?;
        }
        while !over
            .email
            .as_deref()
            .unwrap_or(&config.me.email)
            .contains('@')
        {
            over.email = Some(self.ask.line(
                "Your e-mail on this account (it becomes its first manager)",
                None,
                "--email",
            )?);
        }
        Ok(over)
    }

    fn token(&mut self, existing: Option<&Account>) -> Result<(String, Cloudflare, Named), String> {
        let configured = existing.map(|a| a.token.clone()).filter(|t| !t.is_empty());
        let mut stored = self
            .access
            .token
            .clone()
            .or_else(|| from_env("P99_TOKEN"))
            .or_else(|| configured.clone());
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
            let missing = probe(&cf, &account.id, &self.hosts)?;
            if missing.is_empty() {
                done(if self.hosts.is_empty() {
                    "the token can list Workers, D1 and R2"
                } else {
                    "the token can list Workers, D1 and R2, and the routes of the hosts' zones"
                });
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
        Ok(v) => return Err(inactive(&v)),
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
            return Err(inactive(&v));
        }
    }
    Err("Cloudflare doesn't accept this token".into())
}

fn inactive(verified: &Value) -> String {
    format!(
        "the token is {}",
        verified["status"].as_str().unwrap_or("not active")
    )
}

fn probe(cf: &Cloudflare, account: &str, hosts: &[String]) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    let mut check = |result: Result<(), ApiError>, permission: String| match result {
        Ok(()) => Ok(()),
        Err(e) if e.denied() => {
            missing.push(permission);
            Ok(())
        }
        Err(e) => Err(e.message),
    };
    check(cf.scripts(account).map(drop), PERMISSIONS[0].0.into())?;
    check(cf.databases(account).map(drop), PERMISSIONS[1].0.into())?;
    check(cf.buckets(account).map(drop), PERMISSIONS[2].0.into())?;
    if hosts.is_empty() {
        note("no host is named yet; zones and routes are checked when hosts are added");
        return Ok(missing);
    }
    let zones = cf.zones(account);
    let found = zones.as_ref().map(|z| z.to_vec()).unwrap_or_default();
    let listed = zones.is_ok();
    check(zones.map(drop), PERMISSIONS[4].0.into())?;
    if !listed {
        return Ok(missing);
    }
    let mut seen = Vec::new();
    let mut blind = Vec::new();
    for host in hosts {
        let Some(zone) = crate::cloudflare::zone_of(&found, host) else {
            blind.push(format!("{} on the zone of {host}", PERMISSIONS[4].0));
            continue;
        };
        if seen.contains(&zone.id) {
            continue;
        }
        seen.push(zone.id.clone());
        check(
            cf.routes(&zone.id).map(drop),
            format!("{} on {} (for {host})", PERMISSIONS[3].0, zone.name),
        )?;
    }
    missing.extend(blind);
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

pub fn applied(cf: &Cloudflare, account: &str, db: &str) -> Result<Vec<String>, String> {
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

struct Steps {
    todo: Vec<(&'static str, &'static str)>,
    already: Vec<String>,
    accepted: Option<String>,
}

fn steps(cf: &Cloudflare, entry: &Account, accept: Option<&str>) -> Result<Steps, String> {
    let before = applied(cf, &entry.account_id, &entry.database_id)?;
    let accepted = crate::migrate::gate(cf, entry, &before, accept)?;
    let mut already: Vec<String> = bundle::MIGRATIONS
        .iter()
        .filter(|(name, _)| before.iter().any(|a| a == name))
        .map(|(name, _)| (*name).to_owned())
        .collect();
    already.sort();
    Ok(Steps {
        todo: pending(bundle::MIGRATIONS, &before),
        already,
        accepted,
    })
}

fn apply(cf: &Cloudflare, entry: &Account, steps: Steps) -> Result<Migrated, String> {
    let (account, db) = (entry.account_id.as_str(), entry.database_id.as_str());
    cf.query(account, db, MIGRATIONS_TABLE, &[])?;
    let mut out = Migrated {
        applied: Vec::new(),
        already: steps.already,
        accepted: steps.accepted,
    };
    if steps.todo.is_empty() {
        done("every migration is applied");
    }
    for (name, sql) in steps.todo {
        cf.query(account, db, &migration_sql(name, sql), &[])?;
        done(&format!("applied {name}"));
        out.applied.push(name.to_owned());
    }
    Ok(out)
}

fn migrate(cf: &Cloudflare, entry: &Account, accept: Option<&str>) -> Result<Migrated, String> {
    apply(cf, entry, steps(cf, entry, accept)?)
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

fn hub_migration(tag: Option<&str>) -> Option<Value> {
    if tag == Some(HUB_TAG) {
        return None;
    }
    let mut step = json!({ "new_tag": HUB_TAG, "new_sqlite_classes": [HUB_CLASS] });
    if let Some(tag) = tag {
        step["old_tag"] = json!(tag);
    }
    Some(step)
}

fn our_bindings(
    account: &Account,
    rate: Option<u64>,
    app: Option<&str>,
    state: State,
) -> Vec<Value> {
    let mut ours = vec![
        json!({ "type": "d1", "name": "DB", "database_id": account.database_id }),
        json!({ "type": "r2_bucket", "name": "BUCKET", "bucket_name": account.bucket }),
        json!({ "type": "plain_text", "name": "VERSION", "text": VERSION }),
        json!({ "type": "plain_text", "name": "LICENSE_STATE", "text": state.word() }),
        json!({ "type": "plain_text", "name": "LICENSE_LINK", "text": state.link_binding() }),
        json!({ "type": "durable_object_namespace", "name": "HUB", "class_name": HUB_CLASS }),
    ];
    if let Some(host) = app {
        ours.push(json!({ "type": "plain_text", "name": "APP_HOST", "text": host }));
    }
    if let Some(ns) = rate {
        ours.push(json!({
            "type": "ratelimit",
            "name": "RATE",
            "namespace_id": ns.to_string(),
            "simple": { "limit": RATE_LIMIT, "period": RATE_PERIOD },
        }));
    }
    ours
}

fn from_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
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
    app: Option<&str>,
    state: State,
    tag: Option<&str>,
) -> Result<Uploaded, String> {
    let bindings = merge_bindings(existing, our_bindings(account, rate, app, state));
    let migrations = hub_migration(tag);
    cf.upload(
        &account.account_id,
        &account.worker,
        bundle::MAIN,
        &bindings,
        migrations.clone(),
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
    if migrations.is_some() {
        done(&format!(
            "Durable Object {HUB_CLASS} created ({HUB_TAG}), which holds the live streams of p99 tui and p99 watch"
        ));
    }
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
    if host.is_empty() {
        return Err(format!("the host is missing in --host {spec:?}"));
    }
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
    pattern: &str,
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
            cf.create_route(&zone.id, pattern, worker)?;
            created = true;
            notes.push(format!("added the route {pattern} → {worker}"));
        }
    }
    Ok(Routed { notes, created })
}

pub(crate) fn open_app(
    cf: &Cloudflare,
    account: &str,
    worker: &str,
    zones: &[Named],
    address: &crate::app::Address,
) -> Result<Vec<String>, String> {
    match address {
        crate::app::Address::Own(host) => {
            Ok(route(cf, account, worker, zones, host, &format!("{host}/*"))?.notes)
        }
        crate::app::Address::WorkersDev(host) => {
            cf.enable_subdomain(account, worker)?;
            Ok(vec![format!(
                "the Worker answers on its workers.dev address {host}"
            )])
        }
    }
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
    let cf = Cloudflare::new(&crate::config::token(entry)?);
    let zones = cf.zones(&entry.account_id)?;
    for line in route(
        &cf,
        &entry.account_id,
        &entry.worker,
        &zones,
        host,
        &route_pattern(host),
    )?
    .notes
    {
        eprintln!("{line}");
    }
    Ok(())
}

fn health(hosts: &[&str]) -> Vec<Health> {
    let mut out = Vec::new();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .new_agent();
    for host in hosts {
        let url = format!("https://{host}/_p99/health");
        let local = std::env::var("P99_HOST_URL").ok().filter(|t| !t.is_empty());
        if local.is_none() && std::net::ToSocketAddrs::to_socket_addrs(&(*host, 443)).is_err() {
            say!(
                "  --  {host} has no DNS record yet, so its check is skipped; p99 deploy checks it once it resolves"
            );
            out.push(Health {
                host: (*host).to_owned(),
                ok: false,
                version: None,
                access: false,
                unresolved: true,
            });
            continue;
        }
        let fetch = local.map_or_else(
            || url.clone(),
            |t| {
                format!(
                    "{}/_p99/health",
                    t.replace("{host}", host).trim_end_matches('/')
                )
            },
        );
        let mut last = String::new();
        let mut answered = None;
        let mut access = false;
        for attempt in 0..6 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_secs(5));
            }
            match agent.get(&fetch).call() {
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
                Ok(r) => {
                    let location = r
                        .headers()
                        .get("location")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("");
                    if r.status().is_redirection() && crate::client::is_access(location) {
                        access = true;
                        last.clear();
                        break;
                    }
                    last = format!("answers HTTP {}", r.status().as_u16());
                }
                Err(e) => last = e.to_string(),
            }
        }
        out.push(Health {
            host: (*host).to_owned(),
            ok: last.is_empty(),
            version: answered,
            access,
            unresolved: false,
        });
        if access {
            done(&format!(
                "{url} is behind Cloudflare Access, as expected for a private host"
            ));
        } else if last.is_empty() {
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
        hosts: args
            .hosts
            .iter()
            .map(|spec| parse_host(spec).map(|h| h.host))
            .collect::<Result<_, _>>()?,
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
    let me = s.me(&mut config, &name)?;
    if let Some(entry) = config.accounts.get_mut(&name) {
        entry.me = me.clone();
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
        key: String::new(),
        url: None,
        app: None,
        resend_key: None,
        mail_from: None,
        access_client_id: None,
        access_client_secret: None,
        code: None,
        me: AccountMe::default(),
    });
    account.me = me;
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
    migrate(&cf, &account, args.accept_plan.as_deref())?;

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
        "The CLI and the TUI sign every request with the account's key; the Worker holds\nthe same key as its secret KEY_P99.",
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
    let mut key = args
        .resend_key
        .clone()
        .or_else(|| from_env("P99_RESEND_KEY"));
    if key.is_none()
        && account.resend_key.is_none()
        && !args.no_mail
        && !s.ask.yes
        && s.ask.confirm("Turn mail on through Resend?", false)?
    {
        key = Some(s.ask.secret("Resend API key", "--resend-key")?);
    }
    let mail = match key {
        Some(key) => {
            let from = match &args.mail_from {
                Some(f) => f.clone(),
                None => s.ask.line(
                    "Mail sender, such as P99 <p99@example.com>",
                    None,
                    "--mail-from",
                )?,
            };
            let note = crate::email::check_sender(&key, &from)?;
            Some((key, from, note))
        }
        None => None,
    };
    let mail_on = mail.is_some() || account.resend_key.is_some();
    if mail_on {
        done("mail is on");
    } else {
        done("mail stays off");
    }

    step(
        8,
        total,
        "The Worker",
        "One Worker serves every host of the account. It is uploaded with its bindings (DB, BUCKET,\nRATE, VERSION, LICENSE_STATE, LICENSE_LINK, HUB) and its secrets (KEY_P99, MANAGERS, and\nCODE_PEPPER, which keys the stored hashes of the personal codes so the database alone can't\nrecover one).",
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
    let tag = cf.migration_tag(&id, &account.worker)?;
    upload(
        &cf,
        &account,
        &bindings,
        rate,
        None,
        State::of(config.license.as_deref()),
        tag.as_deref(),
    )?;
    let secrets = cf.secrets(&id, &account.worker)?;
    cf.put_secret(&id, &account.worker, "KEY_P99", &vault::read(&account.key)?)?;
    done("secret KEY_P99");
    if !secrets.iter().any(|s| s == "MANAGERS") {
        let manager = config.me_for(&name).email;
        cf.put_secret(&id, &account.worker, "MANAGERS", &manager)?;
        done(&format!("secret MANAGERS = {manager}"));
    } else {
        done("secret MANAGERS is kept as it is");
    }
    pepper(&cf, &id, &account.worker, &secrets)?;
    if let Some((key, from, checked)) = &mail {
        crate::email::store(&cf, &account, "resend", Some(from), checked.as_deref())?;
        cf.put_secret(&id, &account.worker, "RESEND_API_KEY", key)?;
        done(&format!("secret RESEND_API_KEY, mail from {from}"));
        if let Some(why) = checked {
            note(why);
        }
    } else if let Some(k) = &account.resend_key {
        cf.put_secret(&id, &account.worker, "RESEND_API_KEY", &vault::read(k)?)?;
        done("secret RESEND_API_KEY");
        if crate::email::adopt_legacy(&cf, &account)? {
            done("the mail sender moved from the config to the database");
        }
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
        match route(
            &cf,
            &id,
            &account.worker,
            &zones,
            &spec.host,
            &route_pattern(&spec.host),
        ) {
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
        if mail_on { "on" } else { "off" }
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
    let me = config.me_for(&name);
    let invite = format!(
        "p99 invite {host} --name \"{}\" --email {}",
        me.name, me.email
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
            "mail": mail_on,
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
    let cf = Cloudflare::new(&crate::config::token(account)?);
    let id = &account.account_id;
    say!("Deploying P99 {VERSION} to the account {name} ({id}):");
    let bindings = cf.bindings(id, &account.worker)?.ok_or_else(|| {
        format!(
            "the account has no Worker called {}; run p99 setup",
            account.worker
        )
    })?;
    let steps = steps(&cf, account, args.accept_plan.as_deref())?;
    let rate = match find_binding(&bindings, "ratelimit", Some("RATE")) {
        Some(_) => None,
        None => Some(
            rate_namespace(&cf, &Ask { yes: true }, id, &account.worker, None).map_err(|e| {
                format!(
                    "couldn't pick a rate-limiting namespace: {e}; run p99 setup --rate-namespace <id>"
                )
            })?,
        ),
    };
    let app = crate::app::address(&cf, account)?;
    let tag = cf.migration_tag(id, &account.worker)?;
    let secrets = cf.secrets(id, &account.worker)?;
    let zones = cf.zones(id)?;
    report.migrations = apply(&cf, account, steps)?;
    upload(
        &cf,
        account,
        &bindings,
        rate,
        app.as_ref().map(|a| a.host()),
        State::of(config.license.as_deref()),
        tag.as_deref(),
    )?;
    done("secrets kept");
    pepper(&cf, id, &account.worker, &secrets)?;
    if crate::email::adopt_legacy(&cf, account)? {
        done("the mail sender moved from the config to the database");
    }
    let hosts = config.hosts_of(name);
    let mut failed = Vec::new();
    for host in &hosts {
        let pattern = route_pattern(host);
        match route(&cf, id, &account.worker, &zones, host, &pattern) {
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
    let app_error = match &app {
        Some(address) => match open_app(&cf, id, &account.worker, &zones, address) {
            Ok(notes) => {
                notes.iter().for_each(|n| done(n));
                done(&format!("the P99 page answers on {}", address.url()));
                report.app = Some(address.url());
                None
            }
            Err(why) => {
                say!("  !!  {why}");
                Some(why)
            }
        },
        None => {
            note(crate::app::NO_SUBDOMAIN);
            None
        }
    };
    if !args.no_check && !hosts.is_empty() {
        report.health = health(&hosts);
    }
    if !failed.is_empty() {
        return Err(format!("no route for {}", failed.join(", ")));
    }
    if let Some(why) = app_error {
        return Err(format!("no address for the P99 page: {why}"));
    }
    let unhealthy: Vec<&str> = report
        .health
        .iter()
        .filter(|h| !h.ok && !h.unresolved)
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
        assert!(pending(&all[..2], &["0002_y.sql".into(), "0001_p99.sql".into()]).is_empty());
        assert_eq!(
            migration_sql("0002_y.sql", "CREATE TABLE t (a);\n"),
            "CREATE TABLE t (a);\nINSERT INTO d1_migrations (name) VALUES ('0002_y.sql');"
        );
        let bundled: Vec<&str> = bundle::MIGRATIONS.iter().map(|m| m.0).collect();
        let mut sorted = bundled.clone();
        sorted.sort();
        assert_eq!(bundled, sorted);
    }

    #[test]
    fn the_worker_gets_the_licence_state_word_and_never_the_key() {
        let account = Account::default();
        for (state, link) in [
            (State::Free, "shown"),
            (State::Studio, "shown"),
            (State::Agency, "hideable"),
            (State::Ff, "shown"),
            (State::Owner, "hideable"),
        ] {
            let ours = our_bindings(&account, None, None, state);
            let found = find_binding(&ours, "plain_text", Some("LICENSE_STATE")).unwrap();
            assert_eq!(found["text"], state.word());
            let found = find_binding(&ours, "plain_text", Some("LICENSE_LINK")).unwrap();
            assert_eq!(found["text"], link);
            assert!(ours.iter().all(|b| !b.to_string().contains("PITO1")));
        }
        let stale =
            vec![json!({ "type": "plain_text", "name": "LICENSE_STATE", "text": "agency" })];
        let merged = merge_bindings(&stale, our_bindings(&account, None, None, State::Free));
        let states: Vec<&Value> = merged
            .iter()
            .filter(|b| binding_name(b) == "LICENSE_STATE")
            .collect();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0]["text"], "free");
        assert_eq!(states[0]["type"], "plain_text");
    }

    #[test]
    fn hostnames_are_lowercase_dotted_labels_without_edge_dashes() {
        let widest = format!("{}.com", "a".repeat(63));
        for good in [
            "example.com",
            "shop.example.com",
            "a-b.example.co",
            "x1.example.com",
            widest.as_str(),
        ] {
            assert!(is_hostname(good), "{good}");
        }
        let long_label = format!("{}.com", "a".repeat(64));
        let long_host = format!("{}.com", vec!["a".repeat(63); 4].join("."));
        for bad in [
            "",
            "localhost",
            "Shop.example.com",
            "shop..example.com",
            ".example.com",
            "example.com.",
            "-shop.example.com",
            "shop-.example.com",
            "shop_1.example.com",
            "shop.example.com/",
            "shop.example.com:8080",
            long_label.as_str(),
            long_host.as_str(),
        ] {
            assert!(!is_hostname(bad), "{bad}");
        }
    }

    #[test]
    fn a_host_spec_takes_its_environment_and_kind_or_their_defaults() {
        let spec = |s: &str| parse_host(s).map(|h| (h.host, h.env, h.kind));
        let three = |h: &str, e: &str, k: &str| -> Result<(String, String, String), String> {
            Ok((h.to_owned(), e.to_owned(), k.to_owned()))
        };
        assert_eq!(
            spec(" Shop.Example.com "),
            three("shop.example.com", "production", "release")
        );
        assert_eq!(
            spec("shop.example.com="),
            three("shop.example.com", "production", "release")
        );
        assert_eq!(
            spec("dev.example.com=dev"),
            three("dev.example.com", "dev", "development")
        );
        assert_eq!(
            spec("stage.example.com=staging:release"),
            three("stage.example.com", "staging", "release")
        );
        assert_eq!(
            spec("shop.example.com=production:development"),
            three("shop.example.com", "production", "development")
        );
        assert_eq!(spec("shop"), Err("shop is not a hostname".into()));
        assert_eq!(
            spec("=dev"),
            Err("the host is missing in --host \"=dev\"".into())
        );
        assert_eq!(spec(""), Err("the host is missing in --host \"\"".into()));
        assert_eq!(
            spec("  =dev:release"),
            Err("the host is missing in --host \"  =dev:release\"".into())
        );
        assert_eq!(
            spec("shop.example.com=dev:beta"),
            Err("beta is not an environment kind; use release or development".into())
        );
        assert_eq!(
            spec("shop.example.com=dev:Release"),
            Err("Release is not an environment kind; use release or development".into())
        );
        assert!(check_kind("release").is_ok() && check_kind("development").is_ok());
        assert!(check_kind("").is_err());
    }

    #[test]
    fn a_route_pattern_covers_its_host_and_wildcards_cover_subdomains() {
        assert_eq!(route_pattern("shop.example.com"), "shop.example.com/_p99/*");
        for (pattern, host) in [
            ("example.com/*", "example.com"),
            ("https://example.com/_p99/*", "example.com"),
            ("http://shop.example.com", "shop.example.com"),
            ("*.example.com/*", "shop.example.com"),
            ("*example.com/*", "example.com"),
            ("*example.com/*", "shop.example.com"),
        ] {
            assert!(covers(pattern, host), "{pattern} should cover {host}");
        }
        for (pattern, host) in [
            ("*.example.com/*", "example.com"),
            ("shop.example.com/*", "blog.example.com"),
            ("example.com/*", "shop.example.com"),
            ("*.example.org/*", "shop.example.com"),
        ] {
            assert!(!covers(pattern, host), "{pattern} should not cover {host}");
        }
    }

    #[test]
    fn an_inactive_token_is_named_by_its_status_without_quotes() {
        assert_eq!(
            inactive(&json!({"status": "disabled"})),
            "the token is disabled"
        );
        assert_eq!(inactive(&json!({"status": 3})), "the token is not active");
        assert_eq!(inactive(&json!({})), "the token is not active");
    }

    #[test]
    fn the_hub_is_migrated_once_from_whatever_tag_it_had() {
        assert_eq!(
            hub_migration(None),
            Some(json!({ "new_tag": HUB_TAG, "new_sqlite_classes": [HUB_CLASS] }))
        );
        assert_eq!(hub_migration(Some(HUB_TAG)), None);
        assert_eq!(
            hub_migration(Some("v0")),
            Some(json!({ "new_tag": HUB_TAG, "new_sqlite_classes": [HUB_CLASS], "old_tag": "v0" }))
        );
    }

    #[test]
    fn our_bindings_replace_theirs_keep_hand_added_ones_and_drop_every_secret() {
        let account = Account {
            database_id: "db9".into(),
            bucket: "files".into(),
            ..Account::default()
        };
        let bare = our_bindings(&account, None, None, State::Free);
        assert!(find_binding(&bare, "ratelimit", None).is_none());
        assert!(find_binding(&bare, "plain_text", Some("APP_HOST")).is_none());
        let ours = our_bindings(
            &account,
            Some(1004),
            Some("p99.example.workers.dev"),
            State::Free,
        );
        let rate = find_binding(&ours, "ratelimit", Some("RATE")).unwrap();
        assert_eq!(rate["namespace_id"], "1004");
        assert_eq!(rate["simple"], json!({ "limit": 120, "period": 60 }));
        assert_eq!(
            find_binding(&ours, "plain_text", Some("APP_HOST")).unwrap()["text"],
            "p99.example.workers.dev"
        );
        let existing = vec![
            json!({ "type": "secret_text", "name": "CODE_PEPPER" }),
            json!({ "type": "secret_key", "name": "SIGNING" }),
            json!({ "type": "plain_text", "name": "HOOK_URL", "text": "https://hooks.example.com/x" }),
            json!({ "type": "plain_text", "name": "VERSION", "text": "0.1.0" }),
            json!({ "type": "d1", "name": "DB", "id": "db-old" }),
        ];
        let merged = merge_bindings(&existing, ours.clone());
        assert_eq!(&merged[..ours.len()], &ours[..]);
        assert_eq!(merged.len(), ours.len() + 1);
        assert_eq!(binding_name(&merged[ours.len()]), "HOOK_URL");
        assert!(
            merged
                .iter()
                .all(|b| b["type"] != "secret_text" && b["type"] != "secret_key")
        );
        assert_eq!(
            find_binding(&merged, "plain_text", Some("VERSION")).unwrap()["text"],
            VERSION
        );
        let db = find_binding(&merged, "d1", None).unwrap();
        assert_eq!(d1_id(db), "db9");
        assert_eq!(
            find_binding(&merged, "r2_bucket", Some("BUCKET")).unwrap()["bucket_name"],
            "files"
        );
        assert!(find_binding(&merged, "plain_text", Some("DB")).is_none());
        assert_eq!(d1_id(&existing[4]), "db-old");
        assert_eq!(
            d1_id(&json!({ "database_id": "db-new", "id": "db-old" })),
            "db-new"
        );
        assert_eq!(d1_id(&json!({ "type": "d1" })), "");
        assert_eq!(binding_name(&json!({})), "");
    }

    #[test]
    fn a_migration_name_is_quoted_and_its_sql_trimmed() {
        assert_eq!(
            migration_sql("0099_o'k.sql", "SELECT 1;\n\n  "),
            "SELECT 1;\nINSERT INTO d1_migrations (name) VALUES ('0099_o''k.sql');"
        );
        assert!(MIGRATIONS_TABLE.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations"));
    }

    #[test]
    fn yes_takes_every_default_and_names_the_flag_when_there_is_none() {
        let ask = Ask { yes: true };
        assert_eq!(
            ask.line("Environment of x", Some("production"), "--host"),
            Ok("production".into())
        );
        assert_eq!(ask.line("Hosts", Some(""), "--host"), Ok(String::new()));
        assert_eq!(
            ask.line("Your name", None, "--name"),
            Err("Your name: give it with --name".into())
        );
        assert_eq!(ask.confirm("Turn mail on?", false), Ok(false));
        assert_eq!(ask.confirm("Act as Ada?", true), Ok(true));
        assert_eq!(
            ask.secret("Paste the token", "--token"),
            Err("Paste the token: give it with --token".into())
        );
        let one = [Named {
            id: "acc1".into(),
            name: "Example".into(),
        }];
        assert_eq!(ask.pick("account", &one).map(|n| n.id.as_str()), Ok("acc1"));
        let two = [
            one[0].clone(),
            Named {
                id: "acc2".into(),
                name: "Other".into(),
            },
        ];
        assert_eq!(
            ask.pick("account", &two).map(|n| n.id.as_str()),
            Err("several accounts; name one with --account-id".into())
        );
    }

    #[test]
    fn a_new_key_is_32_random_bytes_in_hex() {
        let a = new_key().unwrap();
        let b = new_key().unwrap();
        assert_eq!(a.len(), 64);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
        assert_ne!(a, b);
    }
}

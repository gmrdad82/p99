use std::time::Duration;

use serde_json::{Value, json};

use crate::cli::Global;
use crate::cloudflare::{self, Cloudflare};
use crate::config::{Account, Config};
use crate::wire::out;

const RESEND_API: &str = "https://api.resend.com";
const KEY_SECRET: &str = "RESEND_API_KEY";
const UPSERT: &str = "INSERT INTO mail (id, provider, sender, note, updated_at) VALUES (1, ?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (id) DO UPDATE SET provider = excluded.provider, sender = excluded.sender, note = excluded.note, updated_at = excluded.updated_at";
const SENDING_ONLY: &str =
    "the key can only send mail, so the sender's domain was not checked with Resend";

#[derive(clap::Args)]
pub struct EmailArgs {
    #[command(subcommand)]
    pub action: EmailAction,
}

#[derive(clap::Subcommand)]
pub enum EmailAction {
    #[command(
        about = "turn User and Owner mail on: the provider's key goes to the Worker as a secret, the sender to its database"
    )]
    Set(SetArgs),
    #[command(about = "show whether mail is on, with its provider and sender")]
    Show,
    #[command(about = "turn mail off and remove the provider's key from the Worker")]
    Off,
}

#[derive(clap::Args)]
pub struct SetArgs {
    #[arg(long, value_parser = ["resend"], help = "the mail provider; Resend is the one P99 speaks")]
    pub provider: String,
    #[arg(
        long,
        value_name = "ref",
        help = "where the provider's API key lives: op://vault/item/field or env:NAME; the key itself never goes in a file"
    )]
    pub key_ref: String,
    #[arg(
        long,
        value_name = "address",
        help = "the sender, such as \"P99 <p99@example.com>\"; its domain must be verified with the provider"
    )]
    pub from: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Domain {
    Verified,
    SendingOnly,
    Unverified(String),
    Unknown,
}

pub fn run(args: &EmailArgs, global: &Global) -> Result<(), String> {
    let mut config = Config::load()?;
    let (name, account) = config.account(global.account.as_deref())?;
    let (name, account) = (name.to_owned(), account.clone());
    let cf = Cloudflare::new(&crate::config::token(&account)?);
    match &args.action {
        EmailAction::Set(set) => {
            let key = crate::vault::resolve_ref(&set.key_ref)?;
            let note = check_sender(&key, &set.from)?;
            store(&cf, &account, "resend", Some(&set.from), note.as_deref())?;
            cloudflare::worker_secret(&config, &name, KEY_SECRET, &key)?;
            forget_legacy(&mut config, &name)?;
            if global.json {
                return emit(
                    &json!({"space": name, "on": true, "provider": "resend", "from": set.from, "note": note}),
                );
            }
            out!("mail is on for the space {name}: Resend, from {}", set.from);
            out!("the key is the Worker's secret {KEY_SECRET}");
            if let Some(note) = note {
                out!("note: {note}");
            }
            Ok(())
        }
        EmailAction::Off => {
            store(&cf, &account, "off", None, None)?;
            cloudflare::drop_worker_secret(&config, &name, KEY_SECRET)?;
            forget_legacy(&mut config, &name)?;
            if global.json {
                return emit(&json!({"space": name, "on": false}));
            }
            out!("mail is off for the space {name}, and the Worker no longer holds a mail key");
            Ok(())
        }
        EmailAction::Show => show(&cf, &account, &name, global),
    }
}

fn show(cf: &Cloudflare, account: &Account, name: &str, global: &Global) -> Result<(), String> {
    let rows = cf
        .query(
            &account.account_id,
            &account.database_id,
            "SELECT provider, sender, note, updated_at FROM mail WHERE id = 1",
            &[],
        )
        .map_err(|e| older(e.message))?;
    let key = cf
        .secrets(&account.account_id, &account.worker)?
        .iter()
        .any(|s| s == KEY_SECRET);
    let row = rows.first().cloned().unwrap_or(Value::Null);
    let (provider, from, source) = if row.is_null() {
        let legacy = cf
            .bindings(&account.account_id, &account.worker)?
            .unwrap_or_default()
            .into_iter()
            .find(|b| b["name"] == "MAIL_FROM")
            .and_then(|b| b["text"].as_str().map(str::to_owned));
        match legacy {
            Some(from) => ("resend".to_owned(), Some(from), Some("binding")),
            None => ("off".to_owned(), None, None),
        }
    } else {
        (
            row["provider"].as_str().unwrap_or("off").to_owned(),
            row["sender"].as_str().map(str::to_owned),
            Some("database"),
        )
    };
    let on = provider != "off" && from.is_some() && key;
    let note = row["note"].as_str();
    if global.json {
        return emit(&json!({
            "space": name,
            "on": on,
            "provider": provider,
            "from": from,
            "key": key,
            "note": note,
            "updated_at": row["updated_at"],
            "source": source,
        }));
    }
    out!("space     {name}");
    out!("mail      {}", if on { "on" } else { "off" });
    out!("provider  {provider}");
    out!("from      {}", from.as_deref().unwrap_or("-"));
    out!(
        "key       {}",
        if key {
            "the Worker's secret RESEND_API_KEY"
        } else {
            "none"
        }
    );
    if let Some(note) = note {
        out!("note      {note}");
    }
    if source == Some("binding") {
        out!(
            "the sender is still the Worker's MAIL_FROM binding; p99 email set moves it to the database"
        );
    }
    Ok(())
}

fn emit(value: &Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn older(message: String) -> String {
    if message.contains("no such table") {
        "the space's database has no mail settings yet; run p99 deploy first".to_owned()
    } else {
        message
    }
}

pub fn store(
    cf: &Cloudflare,
    account: &Account,
    provider: &str,
    from: Option<&str>,
    note: Option<&str>,
) -> Result<(), String> {
    cf.query(
        &account.account_id,
        &account.database_id,
        UPSERT,
        &[json!(provider), json!(from), json!(note)],
    )
    .map(drop)
    .map_err(|e| older(e.message))
}

pub fn adopt_legacy(cf: &Cloudflare, account: &Account) -> Result<bool, String> {
    let Some(from) = &account.mail_from else {
        return Ok(false);
    };
    let rows = cf
        .query(
            &account.account_id,
            &account.database_id,
            "INSERT OR IGNORE INTO mail (id, provider, sender, updated_at) VALUES (1, 'resend', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) RETURNING id",
            &[json!(from)],
        )
        .map_err(|e| older(e.message))?;
    Ok(!rows.is_empty())
}

fn forget_legacy(config: &mut Config, name: &str) -> Result<(), String> {
    let Some(account) = config.accounts.get_mut(name) else {
        return Ok(());
    };
    if account.mail_from.is_none() && account.resend_key.is_none() {
        return Ok(());
    }
    account.mail_from = None;
    account.resend_key = None;
    config.save()
}

pub fn sender_domain(from: &str) -> Result<String, String> {
    let from = from.trim();
    let address = match (from.rfind('<'), from.ends_with('>')) {
        (Some(open), true) => &from[open + 1..from.len() - 1],
        _ => from,
    };
    let (local, domain) = address
        .trim()
        .rsplit_once('@')
        .ok_or_else(|| format!("{from} is not an e-mail address"))?;
    let domain = domain.to_ascii_lowercase();
    let label = |l: &str| {
        !l.is_empty() && l.len() <= 63 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    if local.is_empty()
        || local.chars().any(char::is_whitespace)
        || !domain.contains('.')
        || !domain.split('.').all(label)
    {
        return Err(format!("{from} is not an e-mail address"));
    }
    Ok(domain)
}

pub fn domain_verdict(status: u16, body: &Value, domain: &str) -> Domain {
    if status == 401 || status == 403 {
        let restricted = body["name"] == "restricted_api_key"
            || body["message"]
                .as_str()
                .is_some_and(|m| m.contains("restricted"));
        return if restricted {
            Domain::SendingOnly
        } else {
            Domain::Unknown
        };
    }
    let listed = body["data"].as_array().into_iter().flatten().find(|d| {
        d["name"]
            .as_str()
            .is_some_and(|n| n.eq_ignore_ascii_case(domain))
    });
    match listed {
        Some(d) if d["status"] == "verified" => Domain::Verified,
        Some(d) => Domain::Unverified(d["status"].as_str().unwrap_or("unknown").to_owned()),
        None => Domain::Unknown,
    }
}

pub fn check_sender(key: &str, from: &str) -> Result<Option<String>, String> {
    let domain = sender_domain(from)?;
    let agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .new_agent();
    let base = std::env::var("P99_RESEND_API")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| RESEND_API.to_owned());
    let mut response = agent
        .get(&format!("{}/domains", base.trim_end_matches('/')))
        .header("Authorization", &format!("Bearer {}", key.trim()))
        .call()
        .map_err(|e| format!("Resend: {e}"))?;
    let status = response.status().as_u16();
    let body: Value = response.body_mut().read_json().unwrap_or(Value::Null);
    if (200..300).contains(&status) && !body["data"].is_array() {
        return Err("Resend's answer for its domains could not be read".to_owned());
    }
    match domain_verdict(status, &body, &domain) {
        Domain::Verified => Ok(None),
        Domain::SendingOnly => Ok(Some(SENDING_ONLY.to_owned())),
        Domain::Unverified(state) => Err(format!(
            "{domain} is {state} with Resend, not verified; finish it at https://resend.com/domains and run this again"
        )),
        Domain::Unknown if status == 401 || status == 403 => {
            Err(format!("Resend refused the key ({status})"))
        }
        Domain::Unknown if !(200..300).contains(&status) => {
            Err(format!("Resend answered {status} for its domains"))
        }
        Domain::Unknown => Err(format!(
            "{domain} is not a domain of this Resend account; add and verify it at https://resend.com/domains"
        )),
    }
}

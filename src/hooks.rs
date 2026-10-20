use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::cli::{Global, client_for, print_json, when};
use crate::client::{query, segment};
use crate::config::Config;
use crate::wire::out;

const EVENTS: [&str; 4] = ["new", "comment", "status", "shipped"];

#[derive(Debug, clap::Args)]
pub struct HooksArgs {
    #[arg(long, help = "only this host's hooks")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<HooksAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum HooksAction {
    #[command(
        about = "post a host's events to a Slack or Discord incoming webhook; setting a service again replaces its URL"
    )]
    Set(SetArgs),
    #[command(about = "stop posting a host's events, to both services or to one")]
    Remove(RemoveArgs),
    #[command(about = "post one test message to each of a host's hooks")]
    Test { host: String },
}

#[derive(Debug, clap::Args)]
#[command(group(clap::ArgGroup::new("url").required(true).args(["slack", "discord", "url_ref"])))]
pub struct SetArgs {
    pub host: String,
    #[arg(
        long,
        value_name = "url",
        help = "a Slack incoming webhook, https://hooks.slack.com/services/…"
    )]
    pub slack: Option<String>,
    #[arg(
        long,
        value_name = "url",
        help = "a Discord webhook, https://discord.com/api/webhooks/…"
    )]
    pub discord: Option<String>,
    #[arg(
        long,
        value_name = "ref",
        help = "read the webhook URL from 1Password (op://…) or an environment variable (env:NAME), so it never sits in the shell's history"
    )]
    pub url_ref: Option<String>,
    #[arg(
        long,
        value_name = "events",
        value_delimiter = ',',
        value_parser = EVENTS,
        help = "what to post: new, comment, status, shipped; all four for a new hook, unchanged when left out"
    )]
    pub on: Vec<String>,
}

#[derive(Debug, clap::Args)]
pub struct RemoveArgs {
    pub host: String,
    #[arg(long, conflicts_with = "discord", help = "only the Slack hook")]
    pub slack: bool,
    #[arg(long, help = "only the Discord hook")]
    pub discord: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Hook {
    pub host: String,
    pub service: String,
    pub hint: String,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub last_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Sent {
    pub service: String,
    pub hint: String,
    pub ok: bool,
    pub status: String,
}

#[derive(Deserialize)]
struct HookList {
    hooks: Vec<Hook>,
}

#[derive(Deserialize)]
struct SentList {
    results: Vec<Sent>,
}

pub fn run(config: &Config, global: &Global, args: &HooksArgs) -> Result<(), String> {
    match &args.action {
        None => list(config, global, args.host.as_deref()),
        Some(HooksAction::Set(a)) => set(config, global, a),
        Some(HooksAction::Remove(a)) => remove(config, global, a),
        Some(HooksAction::Test { host }) => test(config, global, host),
    }
}

fn host_of(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn resolve(reference: &str) -> Result<String, String> {
    if let Some(name) = reference.strip_prefix("env:") {
        return std::env::var(name)
            .ok()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("the environment variable {name} is empty or not set"));
    }
    if crate::vault::is_reference(reference) {
        return crate::vault::read(reference).map(|v| v.trim().to_owned());
    }
    Err(format!(
        "{reference}: --url-ref takes a 1Password reference (op://…) or env:NAME"
    ))
}

fn line(hook: &Hook) -> String {
    let last = match (&hook.last_status, &hook.last_at) {
        (Some(status), Some(at)) => format!("{status} {}", when(at)),
        _ => "never sent".to_owned(),
    };
    format!(
        "{}  {}  ...{}  {}  last: {last}",
        hook.host,
        hook.service,
        hook.hint,
        hook.events.join(","),
    )
}

fn list(config: &Config, global: &Global, host: Option<&str>) -> Result<(), String> {
    let host = host.map(host_of);
    let (client, _) = client_for(config, global, host.as_deref())?;
    let pq = format!("/v1/hooks{}", query(&[("host", host.clone())]));
    let found: HookList = client.json("GET", &pq, None)?;
    if global.json {
        return print_json(&json!({"hooks": found.hooks}));
    }
    if found.hooks.is_empty() {
        println!("no hooks yet; p99 hooks set <host> --slack <url> or --discord <url>");
    }
    for hook in &found.hooks {
        out!("{}", line(hook));
    }
    Ok(())
}

fn set(config: &Config, global: &Global, args: &SetArgs) -> Result<(), String> {
    let host = host_of(&args.host);
    let (service, url) = match (&args.slack, &args.discord, &args.url_ref) {
        (Some(url), _, _) => (Some("slack"), url.trim().to_owned()),
        (_, Some(url), _) => (Some("discord"), url.trim().to_owned()),
        (_, _, Some(reference)) => (None, resolve(reference)?),
        _ => return Err("give --slack, --discord or --url-ref".to_owned()),
    };
    let mut body = json!({"url": url, "service": service});
    if !args.on.is_empty() {
        body["events"] = Value::from(args.on.clone());
    }
    let (client, _) = client_for(config, global, Some(&host))?;
    let pq = format!("/v1/hooks/{}", segment(&host)?);
    let hook: Hook = client.json("PUT", &pq, Some(body))?;
    if global.json {
        return print_json(&hook);
    }
    out!(
        "{} posts {} on {} to ...{}",
        hook.service,
        hook.events.join(", "),
        hook.host,
        hook.hint
    );
    Ok(())
}

fn remove(config: &Config, global: &Global, args: &RemoveArgs) -> Result<(), String> {
    let host = host_of(&args.host);
    let service = if args.slack {
        Some("slack")
    } else if args.discord {
        Some("discord")
    } else {
        None
    };
    let (client, _) = client_for(config, global, Some(&host))?;
    let pq = format!(
        "/v1/hooks/{}{}",
        segment(&host)?,
        query(&[("service", service.map(str::to_owned))])
    );
    client.delete(&pq)?;
    if global.json {
        return print_json(&json!({"removed": {"host": host, "service": service}}));
    }
    match service {
        Some(s) => out!("removed the {s} hook of {host}"),
        None => out!("removed the hooks of {host}"),
    }
    Ok(())
}

fn test(config: &Config, global: &Global, host: &str) -> Result<(), String> {
    let host = host_of(host);
    let (client, _) = client_for(config, global, Some(&host))?;
    let pq = format!("/v1/hooks/{}/test", segment(&host)?);
    let sent: SentList = client.json("POST", &pq, None)?;
    if global.json {
        print_json(&json!({"results": sent.results}))?;
    } else {
        for s in &sent.results {
            let said = if s.ok {
                "posted".to_owned()
            } else {
                format!("failed ({})", s.status)
            };
            out!("{} ...{}  {said}", s.service, s.hint);
        }
    }
    if sent.results.iter().all(|s| s.ok) {
        Ok(())
    } else {
        Err(format!("a hook of {host} did not take the test message"))
    }
}

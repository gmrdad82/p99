use std::time::Duration;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use ureq::Agent;

use crate::cli::{Global, client_for, key_of, print_json};
use crate::config::Config;
use crate::wire::out;

const API: &str = "https://api.github.com";
const EVENTS: [&str; 2] = ["pull_request", "issues"];

#[derive(Debug, clap::Args)]
pub struct GithubArgs {
    #[command(subcommand)]
    pub action: GithubAction,
}

#[derive(Debug, clap::Subcommand)]
pub enum GithubAction {
    #[command(
        about = "link a host to a GitHub repository: the token goes to the Worker as a secret, and the repository gets a webhook"
    )]
    Set {
        #[arg(help = "the host whose items the repository fixes")]
        host: String,
        #[arg(long, value_name = "owner/name", help = "the repository")]
        repo: String,
        #[arg(
            long,
            value_name = "ref",
            help = "a fine-grained token with Issues: read and write (and Webhooks: read and write to add the webhook), as env:NAME, file:PATH or command:WORDS"
        )]
        token_ref: String,
    },
    #[command(about = "list the hosts linked to GitHub")]
    Show,
    #[command(about = "unlink a host: its webhook and its secrets go, the links on its items stay")]
    Off {
        #[arg(help = "the host to unlink")]
        host: String,
    },
    #[command(about = "open a GitHub issue for an item, or print the one it has")]
    Open {
        #[arg(help = "the item's key, such as BUG-12, or its number")]
        key: String,
        #[arg(long, help = "the host the item belongs to")]
        host: Option<String>,
    },
}

pub fn run(config: &Config, global: &Global, args: &GithubArgs) -> Result<(), String> {
    match &args.action {
        GithubAction::Set {
            host,
            repo,
            token_ref,
        } => set(config, global, host, repo, token_ref),
        GithubAction::Show => show(config, global),
        GithubAction::Off { host } => off(config, global, host),
        GithubAction::Open { key, host } => open(config, global, key, host.as_deref()),
    }
}

pub fn secret_names(host: &str) -> (String, String) {
    let tag: String = Sha256::digest(host.as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02X}"))
        .collect();
    (format!("GITHUB_TOKEN_{tag}"), format!("GITHUB_HOOK_{tag}"))
}

fn valid_repo(repo: &str) -> bool {
    let Some((owner, name)) = repo.split_once('/') else {
        return false;
    };
    (1..=39).contains(&owner.len())
        && owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !owner.starts_with('-')
        && (1..=100).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn host_of(config: &Config, raw: &str) -> Result<String, String> {
    let host = raw.trim().to_ascii_lowercase();
    if !config.hosts.contains_key(&host) {
        return Err(format!("no host is called {host}; p99 hosts lists them"));
    }
    Ok(host)
}

fn webhook_url(host: &str) -> String {
    format!("https://{host}/_p99/v1/github")
}

struct Github {
    agent: Agent,
    token: String,
}

impl Github {
    fn new(token: &str) -> Github {
        let agent = Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(30)))
            .build()
            .new_agent();
        Github {
            agent,
            token: token.to_owned(),
        }
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        let base = std::env::var("P99_GITHUB_API")
            .ok()
            .filter(|v| !v.is_empty())
            .map(|v| v.trim_end_matches('/').to_owned())
            .unwrap_or_else(|| API.to_owned());
        let url = format!("{base}{path}");
        let auth = format!("Bearer {}", self.token);
        let response = match (method, body) {
            ("GET", _) => self
                .agent
                .get(&url)
                .header("Authorization", &auth)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "p99")
                .call(),
            (_, body) => {
                let request = if method == "PATCH" {
                    self.agent.patch(&url)
                } else {
                    self.agent.post(&url)
                };
                request
                    .header("Authorization", &auth)
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "p99")
                    .send_json(body.cloned().unwrap_or(Value::Null))
            }
        };
        let bare = path.split('?').next().unwrap_or(path);
        let mut response = response.map_err(|e| format!("GitHub {bare}: {e}"))?;
        let status = response.status().as_u16();
        let read = response.body_mut().read_json().ok();
        if (200..300).contains(&status) && read.is_none() {
            return Err(format!("GitHub {bare}: the answer could not be read"));
        }
        Ok((status, read.unwrap_or(Value::Null)))
    }

    fn hook(&self, repo: &str, url: &str, secret: &str) -> Result<Option<i64>, String> {
        let (status, hooks) =
            self.call("GET", &format!("/repos/{repo}/hooks?per_page=100"), None)?;
        if matches!(status, 403 | 404) {
            return Ok(None);
        }
        if status != 200 {
            return Err(said("GitHub", status, &hooks));
        }
        let body = json!({
            "name": "web",
            "active": true,
            "events": EVENTS,
            "config": {"url": url, "content_type": "json", "secret": secret, "insecure_ssl": "0"},
        });
        let found = hooks
            .as_array()
            .into_iter()
            .flatten()
            .find(|h| h["config"]["url"].as_str() == Some(url))
            .and_then(|h| h["id"].as_i64());
        let (status, made) = match found {
            Some(id) => self.call("PATCH", &format!("/repos/{repo}/hooks/{id}"), Some(&body))?,
            None => self.call("POST", &format!("/repos/{repo}/hooks"), Some(&body))?,
        };
        if matches!(status, 403 | 404) {
            return Ok(None);
        }
        if !(200..300).contains(&status) {
            return Err(said("GitHub", status, &made));
        }
        Ok(made["id"].as_i64())
    }
}

fn said(who: &str, status: u16, body: &Value) -> String {
    match body["message"].as_str() {
        Some(message) => format!("{who} answered {status}: {message}"),
        None => format!("{who} answered {status}"),
    }
}

fn new_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    crate::setup::random(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn set(
    config: &Config,
    global: &Global,
    raw: &str,
    repo: &str,
    token_ref: &str,
) -> Result<(), String> {
    let host = host_of(config, raw)?;
    if !valid_repo(repo) {
        return Err(format!("{repo} is not a repository; give owner/name"));
    }
    let token = crate::vault::resolve_ref(token_ref)?;
    let github = Github::new(&token);
    let (status, found) = github.call("GET", &format!("/repos/{repo}"), None)?;
    match status {
        200 => {}
        401 => return Err("GitHub refused the token; is it current?".into()),
        403 | 404 => {
            return Err(format!(
                "the token can't see {repo}; give it this repository with Issues: read and write"
            ));
        }
        _ => return Err(said("GitHub", status, &found)),
    }
    if found["has_issues"] == Value::Bool(false) {
        return Err(format!("{repo} has issues turned off"));
    }
    let repo = found["full_name"].as_str().unwrap_or(repo).to_owned();
    let (client, account) = client_for(config, global, Some(&host))?;
    let listed: Value = client.json("GET", "/v1/github", None)?;
    let relink = listed["hosts"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|h| h["host"].as_str() == Some(host.as_str()));
    let secret = new_secret()?;
    let (token_name, hook_name) = secret_names(&host);
    let url = webhook_url(&host);
    crate::cloudflare::worker_secret(config, &account, &token_name, &token)?;
    let linked =
        crate::cloudflare::worker_secret(config, &account, &hook_name, &secret).and_then(|()| {
            let hook = github.hook(&repo, &url, &secret)?;
            let entry: Value = client.json(
                "PUT",
                &format!("/v1/github/{host}"),
                Some(json!({"repo": repo, "hook_id": hook})),
            )?;
            Ok((hook, entry))
        });
    let (hook, entry) = linked.map_err(|error| {
        if relink {
            format!(
                "{error}; {host} was linked before, so its secrets stay and its link may need p99 github set again"
            )
        } else {
            unstore(config, &account, &[&token_name, &hook_name], error)
        }
    })?;
    if global.json {
        let mut answer = json!({"github": entry, "webhook": hook.is_some()});
        if hook.is_none() {
            answer["manual"] = json!({
                "url": url,
                "content_type": "application/json",
                "secret": secret,
                "events": EVENTS,
            });
        }
        return print_json(&answer);
    }
    out!("{host} is linked to {repo}; the token is the Worker's secret {token_name}");
    match hook {
        Some(id) => out!("webhook {id} on {repo} sends pull requests and issues to {url}"),
        None => {
            out!("the token can't manage webhooks on {repo}, so add one by hand:");
            out!("  {repo} on GitHub, Settings, Webhooks, Add webhook");
            out!("  Payload URL   {url}");
            out!("  Content type  application/json");
            out!("  Secret        {secret}");
            out!("  Events        Issues and Pull requests");
            out!(
                "running p99 github set again makes a new secret, and the webhook then needs it too"
            );
        }
    }
    Ok(())
}

fn unstore(config: &Config, account: &str, names: &[&str], error: String) -> String {
    let stayed: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| crate::cloudflare::drop_worker_secret(config, account, name).is_err())
        .collect();
    if stayed.is_empty() {
        return error;
    }
    format!(
        "{error}; the Worker still holds {}: delete {} in the Cloudflare dashboard, the Worker's Settings, Variables and Secrets",
        stayed.join(" and "),
        if stayed.len() == 1 { "it" } else { "them" }
    )
}

fn show(config: &Config, global: &Global) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let answer: Value = client.json("GET", "/v1/github", None)?;
    if global.json {
        return print_json(&answer);
    }
    let hosts = answer["hosts"].as_array().cloned().unwrap_or_default();
    if hosts.is_empty() {
        println!(
            "no host is linked to GitHub; p99 github set <host> --repo owner/name --token-ref <ref>"
        );
        return Ok(());
    }
    let text = |h: &Value, f: &str| h[f].as_str().unwrap_or("-").to_owned();
    let width = hosts
        .iter()
        .map(|h| text(h, "host").len())
        .max()
        .unwrap_or(4)
        .max(4);
    let repo = hosts
        .iter()
        .map(|h| text(h, "repo").len())
        .max()
        .unwrap_or(4)
        .max(4);
    println!(
        "{:<width$}  {:<repo$}  {:<7}  STATE",
        "HOST", "REPO", "WEBHOOK"
    );
    for h in &hosts {
        let state = match (h["token"].as_bool(), h["secret"].as_bool()) {
            (Some(true), Some(true)) => "ok",
            (Some(false), _) => "no token on the Worker",
            _ => "no webhook secret on the Worker",
        };
        let hook = h["hook_id"]
            .as_i64()
            .map_or_else(|| "by hand".to_owned(), |id| id.to_string());
        out!(
            "{:<width$}  {:<repo$}  {hook:<7}  {state}",
            text(h, "host"),
            text(h, "repo")
        );
    }
    Ok(())
}

fn off(config: &Config, global: &Global, raw: &str) -> Result<(), String> {
    let host = host_of(config, raw)?;
    let (client, account) = client_for(config, global, Some(&host))?;
    let answer: Value = client.json("DELETE", &format!("/v1/github/{host}"), None)?;
    let (token_name, hook_name) = secret_names(&host);
    crate::cloudflare::drop_worker_secret(config, &account, &token_name)?;
    crate::cloudflare::drop_worker_secret(config, &account, &hook_name)?;
    if global.json {
        return print_json(&answer);
    }
    let repo = answer["repo"].as_str().unwrap_or("the repository");
    out!("{host} is no longer linked to {repo}; its secrets are gone from the Worker");
    if answer["hook_removed"] != Value::Bool(true) {
        out!(
            "remove the webhook to {} on {repo} by hand: Settings, Webhooks",
            webhook_url(&host)
        );
    }
    Ok(())
}

fn open(config: &Config, global: &Global, raw: &str, host: Option<&str>) -> Result<(), String> {
    let host = host.map(|h| h.trim().to_ascii_lowercase());
    let (client, _) = client_for(config, global, host.as_deref())?;
    let client = client.with_host(host.as_deref());
    let path = client.item(&key_of(raw)?, "/github")?;
    let answer: Value = client.json("POST", &path, None)?;
    if global.json {
        return print_json(&answer);
    }
    out!(
        "{}: {} {}",
        answer["key"].as_str().unwrap_or(raw),
        if answer["existing"] == Value::Bool(true) {
            "already linked to"
        } else {
            "opened"
        },
        answer["url"].as_str().unwrap_or("-")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{secret_names, valid_repo};

    #[test]
    fn secret_names_match_the_worker() {
        assert_eq!(
            secret_names("example.com"),
            (
                "GITHUB_TOKEN_A379A6F6EEAFB9A5".to_owned(),
                "GITHUB_HOOK_A379A6F6EEAFB9A5".to_owned()
            )
        );
        assert!(valid_repo("acme/shop"));
        assert!(!valid_repo("acme/shop/x") && !valid_repo("p99") && !valid_repo("-a/b"));
    }
}

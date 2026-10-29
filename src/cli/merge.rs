use serde_json::json;

use super::{Global, client_for, key_of, named, print_json};
use crate::config::Config;
use crate::wire::{Merged, out};

#[derive(Debug, clap::Args)]
pub struct MergeArgs {
    #[arg(
        required = true,
        help = "the cards that repeat it, such as BUG-14 BUG-15"
    )]
    pub items: Vec<String>,
    #[arg(long, value_name = "KEY", help = "the card they fold into")]
    pub into: String,
    #[arg(long, help = "the host the cards are on")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct FeedArgs {
    #[command(subcommand)]
    pub action: Option<FeedAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum FeedAction {
    #[command(about = "serve the host's feed of fixed cards at https://<host>/_p99/feed")]
    On { host: String },
    #[command(about = "stop serving the host's feed; its address answers 404")]
    Off { host: String },
}

pub fn merge(config: &Config, global: &Global, args: &MergeArgs) -> Result<(), String> {
    let into = key_of(&args.into)?;
    let items = args
        .items
        .iter()
        .map(|k| key_of(k))
        .collect::<Result<Vec<_>, _>>()?;
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let done = client
        .with_host(args.host.as_deref())
        .merge(&items, &into)?;
    if global.json {
        return print_json(&done);
    }
    if !done.merged.is_empty() {
        out!("{} merged into {}", done.merged.join(", "), done.into);
    }
    if !done.unchanged.is_empty() {
        out!("{} already in {}", done.unchanged.join(", "), done.into);
    }
    Ok(())
}

pub fn merged_lines(merged: &[Merged]) -> Vec<String> {
    merged
        .iter()
        .map(|m| {
            let name = m.reporter["name"]
                .as_str()
                .or(m.reporter["email"].as_str())
                .unwrap_or("-");
            format!("  {}  {}  ({name})", m.key, m.title)
        })
        .collect()
}

fn feed_url(host: &str) -> String {
    format!("https://{host}/_p99/feed")
}

pub fn feed(config: &mut Config, global: &Global, args: &FeedArgs) -> Result<(), String> {
    let Some(action) = &args.action else {
        return feed_list(config, global);
    };
    let (host, on) = match action {
        FeedAction::On { host } => (host, true),
        FeedAction::Off { host } => (host, false),
    };
    let host = host.trim().to_ascii_lowercase();
    let entry = config
        .hosts
        .get_mut(&host)
        .ok_or_else(|| format!("no host is called {host}; p99 hosts lists them"))?;
    entry.feed = on;
    let (env, pushed) = (entry.env.clone(), entry.pushed());
    config.save()?;
    let (client, _) = client_for(config, global, Some(&host))?;
    client.put_host(&host, &env, &pushed, None)?;
    if global.json {
        return print_json(&json!({"host": host, "on": on, "url": feed_url(&host)}));
    }
    if on {
        out!(
            "{host}'s feed is on: {} (JSON Feed: add ?format=json)",
            feed_url(&host)
        );
    } else {
        out!("{host}'s feed is off");
    }
    Ok(())
}

fn feed_list(config: &Config, global: &Global) -> Result<(), String> {
    let hosts: Vec<(&String, bool)> = config
        .hosts
        .iter()
        .filter(|(_, h)| named(global).is_none_or(|a| a == h.account))
        .map(|(host, h)| (host, h.feed))
        .collect();
    if global.json {
        let feeds: Vec<_> = hosts
            .iter()
            .map(|(host, on)| json!({"host": host, "on": on, "url": feed_url(host)}))
            .collect();
        return print_json(&json!({ "feeds": feeds }));
    }
    if hosts.is_empty() {
        println!("no hosts yet; p99 hosts add <host> --project <name> --env <env>");
    }
    let width = hosts.iter().map(|(h, _)| h.len()).max().unwrap_or(4).max(4);
    for (host, on) in hosts {
        if on {
            out!("{host:<width$}  on   {}", feed_url(host));
        } else {
            out!("{host:<width$}  off");
        }
    }
    Ok(())
}

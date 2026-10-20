use serde_json::json;

use crate::cli::{Global, client_for, key_of, print_json};
use crate::config::Config;
use crate::wire::{Change, Issue, LabelEdit, Tag, out, priority_word};

const PRIORITY_CHOICES: [&str; 5] = ["urgent", "high", "normal", "low", "none"];

#[derive(Debug, clap::Args)]
pub struct PriorityArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(value_parser = PRIORITY_CHOICES, help = "the priority, or none to clear it")]
    pub priority: String,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct LabelArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(required = true, help = "one or more label names")]
    pub names: Vec<String>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct LabelsArgs {
    #[command(subcommand)]
    pub action: Option<LabelsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum LabelsAction {
    #[command(about = "add a label to the account; items take it with p99 label")]
    Add {
        #[arg(help = "the label's name")]
        name: String,
        #[arg(
            long,
            value_name = "#rrggbb",
            help = "its colour (one is picked from the name by default)"
        )]
        color: Option<String>,
    },
    #[command(about = "rename a label on every item that has it")]
    Rename {
        #[arg(help = "the label's name now")]
        from: String,
        #[arg(help = "its new name")]
        to: String,
    },
    #[command(about = "change a label's colour")]
    Color {
        #[arg(help = "the label's name")]
        name: String,
        #[arg(value_name = "#rrggbb", help = "the new colour")]
        color: String,
    },
    #[command(about = "remove a label from the account and from every item that has it")]
    Remove {
        #[arg(help = "the label's name")]
        name: String,
    },
}

pub fn tags(labels: &[Tag]) -> String {
    labels
        .iter()
        .map(|l| l.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn priority(config: &Config, global: &Global, args: &PriorityArgs) -> Result<(), String> {
    let to = (args.priority != "none").then(|| args.priority.clone());
    let change = Change {
        priority: Some(to),
        ..Change::default()
    };
    let issue = changed(config, global, &args.key, args.host.as_deref(), &change)?;
    if global.json {
        return print_json(&issue);
    }
    match &issue.priority {
        Some(p) => out!(
            "{} is {} priority",
            issue.key,
            priority_word(p).to_lowercase()
        ),
        None => out!("{} has no priority", issue.key),
    }
    Ok(())
}

pub fn label(config: &Config, global: &Global, args: &LabelArgs, on: bool) -> Result<(), String> {
    let names = args.names.clone();
    let edit = if on {
        LabelEdit {
            add: names,
            remove: Vec::new(),
        }
    } else {
        LabelEdit {
            add: Vec::new(),
            remove: names,
        }
    };
    let change = Change {
        labels: Some(edit),
        ..Change::default()
    };
    let issue = changed(config, global, &args.key, args.host.as_deref(), &change)?;
    if global.json {
        return print_json(&issue);
    }
    if issue.labels.is_empty() {
        out!("{} has no labels", issue.key);
    } else {
        out!("{} labels: {}", issue.key, tags(&issue.labels));
    }
    Ok(())
}

fn changed(
    config: &Config,
    global: &Global,
    key: &str,
    host: Option<&str>,
    change: &Change,
) -> Result<Issue, String> {
    let (client, _) = client_for(config, global, host)?;
    client.with_host(host).change(&key_of(key)?, change)
}

fn color_of(raw: &str) -> Result<String, String> {
    let color = raw.trim().to_ascii_lowercase();
    let color = if color.starts_with('#') {
        color
    } else {
        format!("#{color}")
    };
    crate::wire::rgb(&color)
        .map(|_| color.clone())
        .ok_or_else(|| format!("{raw} is not a colour; try #3b7dd8"))
}

pub fn labels(config: &Config, global: &Global, args: &LabelsArgs) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    match &args.action {
        None => {
            let list = client.labels()?;
            if global.json {
                return print_json(&json!({ "labels": list }));
            }
            if list.is_empty() {
                println!("no labels yet; p99 labels add <name> makes one");
            }
            for l in &list {
                out!("{:<24} {}  {} items", l.name, l.color, l.items);
            }
            Ok(())
        }
        Some(LabelsAction::Add { name, color }) => {
            let color = color.as_deref().map(color_of).transpose()?;
            let made = client.add_label(name, color.as_deref())?;
            if global.json {
                return print_json(&made);
            }
            out!("added the label {} ({})", made.name, made.color);
            Ok(())
        }
        Some(LabelsAction::Rename { from, to }) => {
            let made = client.change_label(from, Some(to), None)?;
            if global.json {
                return print_json(&made);
            }
            out!("{from} is now {} on {} items", made.name, made.items);
            Ok(())
        }
        Some(LabelsAction::Color { name, color }) => {
            let made = client.change_label(name, None, Some(&color_of(color)?))?;
            if global.json {
                return print_json(&made);
            }
            out!("{} is now {}", made.name, made.color);
            Ok(())
        }
        Some(LabelsAction::Remove { name }) => {
            let gone = client.remove_label(name)?;
            if global.json {
                return print_json(&gone);
            }
            out!(
                "removed the label {} from {} items",
                gone["name"].as_str().unwrap_or(name),
                gone["items"].as_u64().unwrap_or(0)
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_sends_null_to_clear_and_add_remove_lists() {
        let clear = Change {
            priority: Some(None),
            ..Change::default()
        };
        assert_eq!(
            serde_json::to_value(&clear).unwrap(),
            json!({"priority": null})
        );
        let edit = Change {
            labels: Some(LabelEdit {
                add: vec!["ui".into()],
                remove: Vec::new(),
            }),
            ..Change::default()
        };
        assert_eq!(
            serde_json::to_value(&edit).unwrap(),
            json!({"labels": {"add": ["ui"]}})
        );
    }
}

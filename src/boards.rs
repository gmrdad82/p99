use std::io::{BufRead, IsTerminal, Write};

use crate::cli::{Global, client_for, print_json};
use crate::client::Client;
use crate::config::Config;
use crate::one_board::{BoardQuery, DEPRECATED};
use crate::wire::{BoardSpec, Issue, LaneBoard, LaneSpec, MoveTo, out};

#[derive(Debug, clap::Args)]
pub struct MoveArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(
        long,
        value_name = "lane",
        help = "a lane's word (new, planned, in-progress, needs-you, stuck, landed, done) or its name"
    )]
    pub to: String,
    #[arg(
        long,
        value_name = "KEY",
        conflicts_with = "after",
        help = "place it just above this card on your board"
    )]
    pub before: Option<String>,
    #[arg(
        long,
        value_name = "KEY",
        help = "place it just below this card on your board"
    )]
    pub after: Option<String>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct BoardsArgs {
    #[arg(long, help = "the boards of this host")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<BoardsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum BoardsAction {
    #[command(about = "make one of your boards, or change its columns")]
    Set {
        #[arg(help = "the board's name")]
        name: String,
        #[arg(
            long,
            value_name = "labels",
            help = "3 to 6 labels, comma-separated, such as \"Inbox,Doing,QA ready,Done\""
        )]
        columns: String,
        #[arg(
            long,
            value_name = "labels",
            help = "the columns whose label closes an item, comma-separated"
        )]
        closes: Option<String>,
    },
}

#[derive(Debug, clap::Args)]
pub struct BoardArgs {
    #[arg(
        long,
        value_name = "name",
        help = "only this project's cards; repeat it for several"
    )]
    pub project: Vec<String>,
    #[arg(long, help = "only this host's items")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct LabelsArgs {
    #[arg(long, help = "the boards of this host")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<LabelsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum LabelsAction {
    #[command(about = "rename a label on every board and item that has it")]
    Rename {
        #[arg(help = "the label's name now")]
        from: String,
        #[arg(help = "its new name")]
        to: String,
        #[arg(long, help = "rename without asking, even when others' boards use it")]
        yes: bool,
    },
}

fn client(config: &Config, global: &Global, host: Option<&str>) -> Result<Client, String> {
    let host = host.map(|h| h.trim().to_ascii_lowercase());
    let (client, _) = client_for(config, global, host.as_deref())?;
    Ok(client.with_host(host.as_deref()))
}

fn key(raw: &str) -> Result<String, String> {
    crate::cli::key_of(raw)
}

fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

pub fn meanwhile(key: &str, now: &str, to: &str) -> String {
    if same(now, to) {
        format!("{key} moved to {now} meanwhile; nothing left to move")
    } else {
        format!("{key} moved to {now} meanwhile; run it again to move it from there")
    }
}

pub fn raced(client: &Client, key: &str, to: &str, error: String) -> String {
    if !error.ends_with("(409)") {
        return error;
    }
    match client.thread(key).map(|thread| thread.issue) {
        Ok(Issue {
            key,
            label: Some(now),
            ..
        }) => meanwhile(&key, &now, to),
        _ => error,
    }
}

pub fn label_move(
    config: &Config,
    global: &Global,
    raw: &str,
    to: &str,
    host: Option<&str>,
) -> Result<(), String> {
    let client = client(config, global, host)?;
    let key = key(raw)?;
    let from = client
        .thread(&key)?
        .issue
        .label
        .ok_or_else(|| format!("{key} shows no label; only a manager moves items"))?;
    let moved = client
        .move_to(&MoveTo {
            key: key.clone(),
            from,
            to: to.to_owned(),
            ..MoveTo::default()
        })
        .map_err(|error| raced(&client, &key, to, error))?;
    if global.json {
        return print_json(&moved);
    }
    out!("{} is in {}", moved.card.key, moved.card.label);
    Ok(())
}

pub fn run_move(config: &Config, global: &Global, args: &MoveArgs) -> Result<(), String> {
    if args.before.is_none() && args.after.is_none() {
        return label_move(config, global, &args.key, &args.to, args.host.as_deref());
    }
    let client = client(config, global, args.host.as_deref())?;
    let key = key(&args.key)?;
    let from = client
        .thread(&key)?
        .issue
        .label
        .ok_or_else(|| format!("{key} shows no label; only a manager moves items"))?;
    let boards = client.lanes()?.boards;
    let board = boards
        .iter()
        .find(|b| b.mine && b.columns.iter().any(|c| same(&c.label, &args.to)))
        .ok_or_else(|| format!("none of your boards has a {} column", args.to))?;
    let moved = client
        .move_to(&MoveTo {
            key: key.clone(),
            from,
            to: args.to.clone(),
            board: Some(board.id),
            before: args.before.as_deref().map(crate::cli::key_of).transpose()?,
            after: args.after.as_deref().map(crate::cli::key_of).transpose()?,
        })
        .map_err(|error| raced(&client, &key, &args.to, error))?;
    if global.json {
        return print_json(&moved);
    }
    out!(
        "{} is in {} on {}",
        moved.card.key,
        moved.card.label,
        board.name
    );
    Ok(())
}

fn columns_text(board: &LaneBoard) -> String {
    board
        .columns
        .iter()
        .map(|c| {
            if c.closes {
                format!("{} (closes)", c.label)
            } else {
                c.label.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn list(config: &Config, global: &Global, host: Option<&str>) -> Result<(), String> {
    let boards = client(config, global, host)?.old_boards()?;
    if global.json {
        return print_json(&boards);
    }
    eprintln!("p99: {DEPRECATED}");
    todo!("p99 boards' text: the archived boards' names")
}

fn specs(columns: &str, closes: Option<&str>) -> Result<Vec<LaneSpec>, String> {
    let names: Vec<&str> = columns
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .collect();
    let closing: Vec<&str> = closes
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .collect();
    if let Some(stray) = closing.iter().find(|c| !names.iter().any(|n| same(n, c))) {
        return Err(format!(
            "--closes names {stray}, which is not one of the columns"
        ));
    }
    Ok(names
        .iter()
        .map(|n| LaneSpec {
            label: (*n).to_owned(),
            closes: closes.map(|_| closing.iter().any(|c| same(c, n))),
        })
        .collect())
}

pub fn run_boards(config: &Config, global: &Global, args: &BoardsArgs) -> Result<(), String> {
    let Some(BoardsAction::Set {
        name,
        columns,
        closes,
    }) = &args.action
    else {
        return list(config, global, args.host.as_deref());
    };
    let client = client(config, global, args.host.as_deref())?;
    let spec = BoardSpec {
        name: Some(name.clone()),
        columns: Some(specs(columns, closes.as_deref())?),
    };
    let boards = client.lanes()?.boards;
    let board = match boards.iter().find(|b| b.mine && same(&b.name, name)) {
        Some(found) => client.set_lane_board(found.id, &spec)?,
        None => client.add_lane_board(&spec)?,
    };
    if global.json {
        return print_json(&board);
    }
    out!("{}: {}", board.name, columns_text(&board));
    Ok(())
}

pub fn run_board(config: &Config, global: &Global, args: &BoardArgs) -> Result<(), String> {
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let projects = args
        .project
        .iter()
        .map(|p| crate::card::project(p))
        .collect::<Result<Vec<_>, _>>()?;
    let q = BoardQuery {
        projects,
        host: host.clone(),
        ..BoardQuery::default()
    };
    let board = client(config, global, host.as_deref())?.one_board(&q)?;
    if global.json {
        return print_json(&board);
    }
    todo!("p99 board's text: the seven lanes and their cards")
}

fn confirm(question: &str) -> Result<bool, String> {
    if !(std::io::stdin().is_terminal() && std::io::stderr().is_terminal()) {
        return Err(format!("{question} Run it again with --yes to rename"));
    }
    let mut err = std::io::stderr();
    let _ = write!(err, "{question} [y/N] ");
    let _ = err.flush();
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| format!("standard input: {e}"))?;
    Ok(matches!(line.trim(), "y" | "Y" | "yes" | "Yes"))
}

pub fn run_labels(config: &Config, global: &Global, args: &LabelsArgs) -> Result<(), String> {
    let client = client(config, global, args.host.as_deref())?;
    let labels = client.label_list()?;
    let Some(LabelsAction::Rename { from, to, yes }) = &args.action else {
        if global.json {
            return print_json(&serde_json::json!({ "labels": labels }));
        }
        for label in &labels {
            out!(
                "{:<20} {:<7} {}",
                label.name,
                if label.closes { "closes" } else { "" },
                label
                    .boards
                    .iter()
                    .map(|b| format!(
                        "{} @{}",
                        b.name,
                        b.owner_username.as_deref().unwrap_or("someone")
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        return Ok(());
    };
    let label = labels
        .iter()
        .find(|l| same(&l.name, from))
        .ok_or_else(|| format!("no label is called {from}; p99 labels lists them"))?;
    let mine: Vec<i64> = client
        .lanes()?
        .boards
        .iter()
        .filter(|b| b.mine)
        .map(|b| b.id)
        .collect();
    if !*yes && label.boards.iter().any(|b| !mine.contains(&b.id)) {
        let mut owners: Vec<String> = Vec::new();
        for b in &label.boards {
            let who = if mine.contains(&b.id) {
                "@you".to_owned()
            } else {
                format!("@{}", b.owner_username.as_deref().unwrap_or("someone"))
            };
            if !owners.contains(&who) {
                owners.push(who);
            }
        }
        let question = format!(
            "Used on {} boards: {}. Rename for everyone?",
            label.boards.len(),
            owners.join(", ")
        );
        if !confirm(&question)? {
            return Err("nothing renamed".into());
        }
    }
    let renamed = client.rename_label(label.id, to)?;
    if global.json {
        return print_json(&renamed);
    }
    out!("{} is now {}", label.name, renamed.name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meanwhile_says_where_the_card_is_now_and_what_to_do() {
        assert_eq!(
            meanwhile("BUG-12", "Review", "Doing"),
            "BUG-12 moved to Review meanwhile; run it again to move it from there"
        );
        assert_eq!(
            meanwhile("BUG-12", "review", "Review"),
            "BUG-12 moved to review meanwhile; nothing left to move"
        );
    }

    #[test]
    fn closes_marks_only_the_named_columns_and_refuses_a_stray() {
        let set = specs("Inbox, Doing ,QA ready,Done", Some("done")).unwrap();
        assert_eq!(
            set.iter()
                .map(|c| (c.label.as_str(), c.closes))
                .collect::<Vec<_>>(),
            [
                ("Inbox", Some(false)),
                ("Doing", Some(false)),
                ("QA ready", Some(false)),
                ("Done", Some(true))
            ]
        );
        assert!(
            specs("Inbox,Doing,Done", None)
                .unwrap()
                .iter()
                .all(|c| c.closes.is_none())
        );
        assert!(specs("Inbox,Doing,Done", Some("Shipped")).is_err());
    }
}

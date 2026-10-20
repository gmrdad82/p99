use std::io::{BufRead, IsTerminal, Write};

use crate::cli::{Global, client_for, print_json};
use crate::client::Client;
use crate::config::Config;
use crate::wire::{BoardSpec, LaneBoard, LaneCard, LanePage, LaneSpec, MoveTo, out};

#[derive(Debug, clap::Args)]
pub struct MoveArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(
        long,
        value_name = "label",
        help = "a label on your boards: its column"
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
            help = "3 to 5 labels, comma-separated, such as \"Inbox,Doing,QA ready,Done\""
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
    #[arg(help = "a board's name, or @username for that person's board; yours by default")]
    pub which: Option<String>,
    #[arg(long, help = "the boards of this host")]
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
    let moved = client.move_to(&MoveTo {
        key: key.clone(),
        from,
        to: to.to_owned(),
        ..MoveTo::default()
    })?;
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
    let moved = client.move_to(&MoveTo {
        key,
        from,
        to: args.to.clone(),
        board: Some(board.id),
        before: args.before.as_deref().map(crate::cli::key_of).transpose()?,
        after: args.after.as_deref().map(crate::cli::key_of).transpose()?,
    })?;
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

fn owner_of(board: &LaneBoard) -> String {
    board
        .owner
        .as_ref()
        .map_or_else(|| "someone".to_owned(), |o| o.handle())
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
    let boards = client(config, global, host)?.lanes()?;
    if global.json {
        return print_json(&boards);
    }
    for board in &boards.boards {
        out!(
            "{:<5} {:<24} {:<16} {}",
            board.id,
            board.name,
            if board.mine {
                "yours".to_owned()
            } else {
                owner_of(board)
            },
            columns_text(board)
        );
    }
    Ok(())
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

fn pick<'a>(boards: &'a [LaneBoard], which: Option<&str>) -> Result<&'a LaneBoard, String> {
    let found = match which.map(str::trim) {
        None | Some("") => boards.iter().find(|b| b.mine),
        Some(raw) if raw.starts_with('@') => {
            let wanted = raw.trim_start_matches('@');
            boards.iter().find(|b| {
                b.owner
                    .as_ref()
                    .and_then(|o| o.username.as_deref())
                    .is_some_and(|u| same(u, wanted))
            })
        }
        Some(raw) => boards
            .iter()
            .find(|b| b.mine && same(&b.name, raw))
            .or_else(|| boards.iter().find(|b| same(&b.name, raw)))
            .or_else(|| boards.iter().find(|b| b.id.to_string() == raw)),
    };
    found.ok_or_else(|| match which {
        Some(raw) => format!("no board is called {raw}; p99 boards lists them"),
        None => "you have no board here yet".to_owned(),
    })
}

pub fn columns(page: &LanePage) -> Vec<String> {
    let board = &page.board;
    let mut lines = vec![format!(
        "{} ({}){}",
        board.name,
        if board.mine {
            "yours".to_owned()
        } else {
            owner_of(board)
        },
        if board.mine { "" } else { ", watching" }
    )];
    for column in &board.columns {
        let cards: Vec<&LaneCard> = page
            .cards
            .iter()
            .filter(|c| same(&c.label, &column.label))
            .collect();
        lines.push(String::new());
        lines.push(format!(
            "{} ({}){}",
            column.label,
            cards.len(),
            if column.closes { ", closes" } else { "" }
        ));
        for card in cards {
            let mut line = format!("  {:<9} {}", card.key, card.title);
            if let Some(who) = &card.assignee {
                line.push_str(&format!("  {}", who.handle()));
            }
            lines.push(line);
        }
    }
    lines
}

pub fn run_board(config: &Config, global: &Global, args: &BoardArgs) -> Result<(), String> {
    let client = client(config, global, args.host.as_deref())?;
    let boards = client.lanes()?.boards;
    let board = pick(&boards, args.which.as_deref())?;
    let page = client.lane(board.id)?;
    if global.json {
        return print_json(&page);
    }
    for line in columns(&page) {
        out!("{line}");
    }
    Ok(())
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

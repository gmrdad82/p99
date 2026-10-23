use serde_json::Value;

use crate::card::Lane;
use crate::cli::{Global, client_for, print_json};
use crate::client::Client;
use crate::config::Config;
use crate::one_board::{
    BoardQuery, DEPRECATED, LaneInfo, OldBoards, OneBoard, archived_lines, board_lines, lane_lines,
    lane_named, lanes_from, refusal,
};
use crate::wire::{Issue, MoveTo, out};

#[derive(Debug, clap::Args)]
pub struct MoveArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(
        long,
        value_name = "lane",
        help = "a lane's word (`new`, `planned`, `in-progress`, `needs-you`, `stuck`, `landed`, `done`) or its name"
    )]
    pub to: String,
    #[arg(
        long,
        value_name = "KEY",
        conflicts_with = "after",
        help = "place it just above this card in its lane"
    )]
    pub before: Option<String>,
    #[arg(
        long,
        value_name = "KEY",
        help = "place it just below this card in its lane"
    )]
    pub after: Option<String>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct BoardsArgs {
    #[arg(long, help = "the account of this host")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<BoardsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum BoardsAction {
    #[allow(dead_code)]
    #[command(about = "gone: boards are one per account; p99 board prints it")]
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
    #[arg(long, help = "the account of this host")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<LabelsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum LabelsAction {
    #[command(about = "rename a lane for everyone; its word stays")]
    Rename {
        #[arg(help = "the lane's name now, or its word (needs-you)")]
        from: String,
        #[arg(help = "its new name")]
        to: String,
        #[arg(long, help = "kept for scripts; a lane's rename never asks")]
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

pub const GONE: &str = "boards are one per account; see p99 board";

fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

pub fn lane_name(to: &str, lanes: &[LaneInfo]) -> String {
    use clap::ValueEnum;
    match Lane::from_str(to.trim(), true) {
        Ok(lane) => lanes
            .iter()
            .find(|l| l.word == lane)
            .map_or_else(|| lane.name().to_owned(), |l| l.label.clone()),
        Err(_) => to.trim().to_owned(),
    }
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
        return crate::card::refusal(error);
    }
    match client.thread(key).map(|thread| thread.issue) {
        Ok(Issue {
            key,
            label: Some(now),
            ..
        }) => {
            let lanes = lanes_of(client);
            meanwhile(&key, &now, &lane_name(to, &lanes))
        }
        _ => crate::card::refusal(error),
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
        .ok_or_else(|| format!("{key} shows no label; only an Owner moves items"))?;
    let moved = client
        .move_to(&MoveTo {
            key: key.clone(),
            from,
            to: to.trim().to_owned(),
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
        .ok_or_else(|| format!("{key} shows no label; only an Owner moves items"))?;
    let moved = client
        .move_to(&MoveTo {
            key: key.clone(),
            from,
            to: args.to.trim().to_owned(),
            board: None,
            before: args.before.as_deref().map(crate::cli::key_of).transpose()?,
            after: args.after.as_deref().map(crate::cli::key_of).transpose()?,
        })
        .map_err(|error| raced(&client, &key, &args.to, error))?;
    if global.json {
        return print_json(&moved);
    }
    out!("{} is in {}", moved.card.key, moved.card.label);
    Ok(())
}

fn list(config: &Config, global: &Global, host: Option<&str>) -> Result<(), String> {
    let raw = client(config, global, host)?.old_boards()?;
    if global.json {
        return print_json(&raw);
    }
    let boards: OldBoards = serde_json::from_value(raw)
        .map_err(|e| format!("the Worker answered an odd board: {e}"))?;
    eprintln!("p99: {DEPRECATED}");
    for line in archived_lines(&boards) {
        out!("{line}");
    }
    Ok(())
}

pub fn run_boards(config: &Config, global: &Global, args: &BoardsArgs) -> Result<(), String> {
    if args.action.is_some() {
        return Err(GONE.to_owned());
    }
    list(config, global, args.host.as_deref())
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
    let raw: Value = client(config, global, host.as_deref())?
        .one_board(&q)
        .map_err(refusal)?;
    if global.json {
        return print_json(&raw);
    }
    let board: OneBoard = serde_json::from_value(raw)
        .map_err(|e| format!("the Worker answered an odd board: {e}"))?;
    for line in board_lines(&board) {
        out!("{line}");
    }
    Ok(())
}

fn lanes_of(client: &Client) -> Vec<LaneInfo> {
    let query = BoardQuery {
        statuses: vec![Lane::NeedsYou],
        ..BoardQuery::default()
    };
    client
        .one_board::<OneBoard>(&query)
        .map(|board| board.board.lanes)
        .unwrap_or_default()
}

pub fn run_labels(config: &Config, global: &Global, args: &LabelsArgs) -> Result<(), String> {
    let client = client(config, global, args.host.as_deref())?;
    let labels = client.label_list()?;
    let Some(LabelsAction::Rename { from, to, .. }) = &args.action else {
        if global.json {
            return print_json(&serde_json::json!({ "labels": labels }));
        }
        let lanes = lanes_from(&labels);
        for line in lane_lines(&labels, &lanes) {
            out!("{line}");
        }
        return Ok(());
    };
    let lanes = lanes_from(&labels);
    let label = lane_named(&labels, &lanes, from)
        .ok_or_else(|| format!("no lane is called {from}; p99 labels lists them"))?;
    let renamed = client.rename_label(label.id, to.trim())?;
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
    fn a_lane_word_resolves_to_the_boards_name_for_it_and_a_name_stays_itself() {
        let mut lanes: Vec<LaneInfo> = Vec::new();
        assert_eq!(lane_name("needs-you", &lanes), "Needs you");
        assert_eq!(lane_name(" in-progress ", &lanes), "In progress");
        assert_eq!(lane_name(" QA ready ", &lanes), "QA ready");
        lanes.push(LaneInfo {
            word: Lane::NeedsYou,
            label: "Waiting on me".to_owned(),
            closes: false,
        });
        assert_eq!(lane_name("needs-you", &lanes), "Waiting on me");
        assert_eq!(lane_name("needs you", &lanes), "Waiting on me");
        assert_eq!(lane_name("stuck", &lanes), "Stuck");
        assert_eq!(
            meanwhile("FEAT-41", "Waiting on me", &lane_name("needs-you", &lanes)),
            "FEAT-41 moved to Waiting on me meanwhile; nothing left to move"
        );
        assert_eq!(
            meanwhile("FEAT-41", "Needs you", &lane_name("needs-you", &[])),
            "FEAT-41 moved to Needs you meanwhile; nothing left to move"
        );
    }
}

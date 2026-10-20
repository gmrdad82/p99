use std::collections::BTreeMap;

use crate::cli::{Global, client_for, print_json};
use crate::client::Client;
use crate::config::Config;
use crate::wire::{
    Board, BoardView, Card, Move, Moved, NewBoard, RESOLUTIONS, Rollup, StatusEntry, legacy, out,
    status_text,
};

#[derive(Debug, clap::Args)]
pub struct MoveArgs {
    #[arg(help = "the item's key, such as BUG-12, or board:<slug>")]
    pub target: String,
    #[arg(long, help = "the column: a status's key or its name")]
    pub to: Option<String>,
    #[arg(long, value_name = "slug", help = "the board it moves to")]
    pub board: Option<String>,
    #[arg(
        long,
        value_name = "target",
        conflicts_with = "after",
        help = "place it just above this card"
    )]
    pub before: Option<String>,
    #[arg(long, value_name = "target", help = "place it just below this card")]
    pub after: Option<String>,
    #[arg(long, value_parser = RESOLUTIONS, help = "with done: fixed, abandoned or duplicate")]
    pub resolution: Option<String>,
    #[arg(long, help = "only reach this host's boards and items")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct BoardsArgs {
    #[arg(long, help = "only this host's boards")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<BoardsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum BoardsAction {
    #[command(about = "add a board, on its own or as a card inside another board")]
    Add {
        #[arg(help = "the board's name")]
        name: String,
        #[arg(long = "in", value_name = "slug", help = "the board it sits in")]
        parent: Option<String>,
        #[arg(
            long,
            value_name = "status",
            requires = "parent",
            help = "the column it sits in, inbox by default"
        )]
        column: Option<String>,
        #[arg(
            long,
            help = "the host it belongs to; with neither, it spans every host"
        )]
        host: Option<String>,
        #[arg(long, help = "its slug, made from the name by default")]
        slug: Option<String>,
    },
    #[command(about = "rename a board; its slug stays")]
    Rename {
        #[arg(help = "the board's slug")]
        slug: String,
        #[arg(help = "the new name")]
        name: String,
    },
    #[command(about = "remove a board that holds no items and no boards")]
    Remove {
        #[arg(help = "the board's slug")]
        slug: String,
    },
}

#[derive(Debug, clap::Args)]
pub struct BoardArgs {
    #[arg(help = "the board's slug, from p99 boards")]
    pub slug: String,
    #[arg(long, help = "only reach this host's boards")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct StatusesArgs {
    #[command(subcommand)]
    pub action: Option<StatusesAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum StatusesAction {
    #[command(about = "rename a status; its key stays")]
    Rename {
        #[arg(value_parser = crate::wire::STATUSES, help = "the status's key")]
        key: String,
        #[arg(help = "the new name")]
        name: String,
    },
}

fn client(config: &Config, global: &Global, host: Option<&str>) -> Result<Client, String> {
    let host = host.map(|h| h.trim().to_ascii_lowercase());
    let (client, _) = client_for(config, global, host.as_deref())?;
    Ok(client.with_host(host.as_deref()))
}

pub fn target_of(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if let Some(slug) = raw.strip_prefix("board:") {
        if slug.is_empty() {
            return Err("board: needs the board's slug, such as board:site-v2".into());
        }
        return Ok(raw.to_owned());
    }
    crate::wire::item_number(raw)
        .map(|_| raw.to_ascii_uppercase())
        .ok_or_else(|| format!("{raw} is neither an item key such as BUG-12 nor board:<slug>"))
}

pub fn run_move(config: &Config, global: &Global, args: &MoveArgs) -> Result<(), String> {
    if args.to.is_none() && args.board.is_none() && args.before.is_none() && args.after.is_none() {
        return Err("say where it goes: --to, --board, --before or --after".into());
    }
    let request = Move {
        target: target_of(&args.target)?,
        to: args.to.clone(),
        board: args.board.clone(),
        before: args.before.as_deref().map(target_of).transpose()?,
        after: args.after.as_deref().map(target_of).transpose()?,
        resolution: args.resolution.clone(),
    };
    let moved = client(config, global, args.host.as_deref())?.move_card(&request)?;
    if global.json {
        return print_json(&moved);
    }
    out!("{}", moved_line(&request.target, &moved));
    Ok(())
}

pub fn moved_line(target: &str, moved: &Moved) -> String {
    let mut line = match &moved.moved {
        Card::Item(card) => {
            let column = status_text(&card.status, card.resolution.as_deref());
            match &card.board {
                Some(board) => format!("{target} is in {column} on {board}"),
                None => format!("{target} is in {column}"),
            }
        }
        Card::Board(card) => format!(
            "{target} is in {}{}",
            status_text(&card.status, None),
            card.parent
                .as_deref()
                .map(|p| format!(" on {p}"))
                .unwrap_or_default()
        ),
    };
    if let Card::Board(_) = moved.moved {
        match moved.changed.len() {
            0 => line.push_str("; no item changed column"),
            1 => line.push_str(&format!("; 1 item moved with it: {}", moved.changed[0])),
            n => line.push_str(&format!(
                "; {n} items moved with it: {}",
                moved.changed.join(", ")
            )),
        }
    }
    line
}

pub fn status_move(
    config: &Config,
    global: &Global,
    key: &str,
    status: &str,
    host: Option<&str>,
) -> Result<(), String> {
    let (to, resolution) = match legacy(status) {
        Some((to, resolution)) => (to.to_owned(), resolution.map(str::to_owned)),
        None => (status.to_owned(), None),
    };
    let request = Move {
        target: target_of(key)?,
        to: Some(to),
        resolution,
        ..Move::default()
    };
    let moved = client(config, global, host)?.move_card(&request)?;
    if global.json {
        return print_json(&moved);
    }
    out!("{}", moved_line(&request.target, &moved));
    Ok(())
}

pub fn bar(rollup: Rollup, width: usize) -> String {
    let filled = if rollup.total > 0 {
        ((rollup.done as f64 / rollup.total as f64) * width as f64).round() as usize
    } else {
        0
    };
    format!(
        "{}{}",
        "■".repeat(filled),
        "□".repeat(width - filled.min(width))
    )
}

fn rollup_text(rollup: Rollup) -> String {
    format!("{}/{} {}", rollup.done, rollup.total, bar(rollup, 8))
}

fn name_of<'a>(statuses: &'a [StatusEntry], key: &'a str) -> &'a str {
    statuses
        .iter()
        .find(|s| s.key == key)
        .map_or(key, |s| s.name.as_str())
}

pub fn run_boards(config: &Config, global: &Global, args: &BoardsArgs) -> Result<(), String> {
    match &args.action {
        None => list(config, global, args.host.as_deref()),
        Some(BoardsAction::Add {
            name,
            parent,
            column,
            host,
            slug,
        }) => {
            let host = host.as_deref().or(args.host.as_deref());
            let board = client(config, global, host)?.add_board(&NewBoard {
                name: name.clone(),
                slug: slug.clone(),
                host: host.map(|h| h.trim().to_ascii_lowercase()),
                parent: parent.clone(),
                status: column.clone(),
            })?;
            if global.json {
                return print_json(&board);
            }
            out!("added {}", board_line(&board, &[]));
            Ok(())
        }
        Some(BoardsAction::Rename { slug, name }) => {
            let board = client(config, global, args.host.as_deref())?.rename_board(slug, name)?;
            if global.json {
                return print_json(&board);
            }
            out!("{} is now called {}", board.slug, board.name);
            Ok(())
        }
        Some(BoardsAction::Remove { slug }) => {
            client(config, global, args.host.as_deref())?.remove_board(slug)?;
            if global.json {
                return print_json(&serde_json::json!({ "removed": slug }));
            }
            out!("removed {slug}");
            Ok(())
        }
    }
}

fn board_line(board: &Board, statuses: &[StatusEntry]) -> String {
    let place = match &board.parent {
        Some(parent) => format!(
            "  in {parent}, {}",
            name_of(statuses, &board.status).to_lowercase()
        ),
        None => String::new(),
    };
    format!(
        "{:<20} {:<24} {:<18} {}{place}",
        board.slug,
        board.name,
        board.host.as_deref().unwrap_or("every host"),
        rollup_text(board.rollup)
    )
}

fn list(config: &Config, global: &Global, host: Option<&str>) -> Result<(), String> {
    let boards = client(config, global, host)?.boards()?;
    if global.json {
        return print_json(&boards);
    }
    if boards.boards.is_empty() {
        println!("no boards");
        return Ok(());
    }
    let slugs: Vec<&str> = boards.boards.iter().map(|b| b.slug.as_str()).collect();
    let mut kids: BTreeMap<&str, Vec<&Board>> = BTreeMap::new();
    let mut roots = Vec::new();
    for board in &boards.boards {
        match board.parent.as_deref().filter(|p| slugs.contains(p)) {
            Some(parent) => kids.entry(parent).or_default().push(board),
            None => roots.push(board),
        }
    }
    fn walk(
        board: &Board,
        depth: usize,
        kids: &BTreeMap<&str, Vec<&Board>>,
        statuses: &[StatusEntry],
        seen: &mut Vec<String>,
    ) {
        if seen.contains(&board.slug) {
            return;
        }
        seen.push(board.slug.clone());
        out!("{}{}", "  ".repeat(depth), board_line(board, statuses));
        let mut inside = kids.get(board.slug.as_str()).cloned().unwrap_or_default();
        inside.sort_by(|a, b| a.position.total_cmp(&b.position));
        for kid in inside {
            walk(kid, depth + 1, kids, statuses, seen);
        }
    }
    let mut seen = Vec::new();
    for root in roots {
        walk(root, 0, &kids, &boards.statuses, &mut seen);
    }
    Ok(())
}

pub fn run_board(config: &Config, global: &Global, args: &BoardArgs) -> Result<(), String> {
    let view = client(config, global, args.host.as_deref())?.board(&args.slug)?;
    if global.json {
        return print_json(&view);
    }
    for line in columns(&view) {
        out!("{line}");
    }
    Ok(())
}

pub fn columns(view: &BoardView) -> Vec<String> {
    let board = &view.board;
    let mut lines = vec![format!(
        "{} ({}), {}, {} done",
        board.name,
        board.slug,
        board.host.as_deref().unwrap_or("every host"),
        rollup_text(board.rollup)
    )];
    for status in &view.statuses {
        let cards: Vec<&Card> = view
            .cards
            .iter()
            .filter(|c| c.status() == status.key)
            .collect();
        lines.push(String::new());
        lines.push(format!("{} ({})", status.name, cards.len()));
        for card in cards {
            lines.push(match card {
                Card::Item(item) => {
                    let mark = crate::wire::priority_mark(item.priority.as_deref());
                    let mut line = format!(
                        "  {:<9} {}{}{}",
                        item.key,
                        mark,
                        if mark.is_empty() { "" } else { " " },
                        item.title
                    );
                    if status.key == "done"
                        && let Some(resolution) = item.resolution.as_deref()
                        && resolution != "fixed"
                    {
                        line.push_str(&format!(
                            "  ({})",
                            crate::wire::resolution_word(resolution).to_lowercase()
                        ));
                    }
                    if let Some(assignee) = &item.assignee {
                        line.push_str(&format!("  -> {assignee}"));
                    }
                    if !item.labels.is_empty() {
                        line.push_str(&format!("  labels: {}", crate::labels::tags(&item.labels)));
                    }
                    line
                }
                Card::Board(inner) => format!(
                    "  board:{:<20} {}  {}",
                    inner.slug,
                    inner.name,
                    rollup_text(inner.rollup)
                ),
            });
        }
    }
    lines
}

pub fn run_statuses(config: &Config, global: &Global, args: &StatusesArgs) -> Result<(), String> {
    let client = client(config, global, None)?;
    let statuses = match &args.action {
        None => client.statuses()?,
        Some(StatusesAction::Rename { key, name }) => client.rename_status(key, name)?,
    };
    if global.json {
        return print_json(&serde_json::json!({ "statuses": statuses }));
    }
    for status in &statuses {
        out!("{:<8} {}", status.key, status.name);
    }
    Ok(())
}

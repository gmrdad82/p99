use serde::{Deserialize, Serialize};

use crate::wire::Person;

use super::source::Source;

pub const COLUMNS: [&str; 4] = ["inbox", "doing", "review", "done"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatusName {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub position: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rollup {
    pub done: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Label {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardRef {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub rollup: Rollup,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ItemCard {
    pub key: String,
    #[serde(default)]
    pub kind: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub reporter: Person,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub labels: Vec<Label>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardCard {
    pub slug: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub rollup: Rollup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Card {
    Item(ItemCard),
    Board(BoardCard),
}

impl Card {
    pub fn id(&self) -> String {
        match self {
            Card::Item(item) => item.key.clone(),
            Card::Board(board) => format!("board:{}", board.slug),
        }
    }

    pub fn status(&self) -> &str {
        match self {
            Card::Item(item) => &item.status,
            Card::Board(board) => &board.status,
        }
    }

    pub fn position(&self) -> f64 {
        match self {
            Card::Item(item) => item.position,
            Card::Board(board) => board.position,
        }
    }

    pub fn place(&mut self, status: &str, position: f64) {
        match self {
            Card::Item(item) => {
                item.status = status.to_owned();
                item.position = position;
            }
            Card::Board(board) => {
                board.status = status.to_owned();
                board.position = position;
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardView {
    #[serde(default)]
    pub statuses: Vec<StatusName>,
    pub board: BoardRef,
    #[serde(default)]
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Boards {
    #[serde(default)]
    pub statuses: Vec<StatusName>,
    #[serde(default)]
    pub boards: Vec<BoardRef>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Move {
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Moved {
    pub moved: Card,
    #[serde(default)]
    pub changed: Vec<String>,
}

pub fn column_of(status: &str) -> &'static str {
    match status {
        "new" | "inbox" => "inbox",
        "confirmed" | "in_progress" | "doing" => "doing",
        "waiting" | "review" => "review",
        _ => "done",
    }
}

pub fn default_statuses() -> Vec<StatusName> {
    ["Inbox", "Doing", "Review", "Done"]
        .iter()
        .zip(COLUMNS)
        .enumerate()
        .map(|(at, (name, key))| StatusName {
            key: key.to_owned(),
            name: (*name).to_owned(),
            position: at as i64,
        })
        .collect()
}

pub fn sort(cards: &mut [Card]) {
    let rank = |card: &Card| {
        COLUMNS
            .iter()
            .position(|c| *c == card.status())
            .unwrap_or(4)
    };
    cards.sort_by(|a, b| {
        rank(a)
            .cmp(&rank(b))
            .then(a.position().total_cmp(&b.position()))
    });
}

impl Source {
    pub fn boards(&self) -> Result<Boards, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.boards())),
            Source::Live(_) => Err(NOT_YET.into()),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn board(&self, slug: Option<&str>) -> Result<BoardView, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.board(slug)),
            Source::Live(_) => Err(NOT_YET.into()),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn shift(&self, request: &Move) -> Result<Moved, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.shift(request)),
            Source::Live(_) => Err(NOT_YET.into()),
            Source::Broken(why) => Err(why.clone()),
        }
    }
}

const NOT_YET: &str = "this Worker has no boards yet; run p99 deploy";

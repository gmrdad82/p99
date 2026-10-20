use serde::{Deserialize, Serialize};
use serde_json::Value;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Patch {
    Patched,
    Reload,
}

pub fn patch(view: &mut BoardView, event: &Value) -> Patch {
    let here = view.board.slug.as_str();
    let to = event["to"].as_str().unwrap_or_default();
    let position = event["position"].as_f64();
    let (id, home) = match event["type"].as_str() {
        Some("move") => match event["key"].as_str() {
            Some(key) => (key.to_owned(), event["board"].as_str()),
            None => return Patch::Reload,
        },
        Some("board.move") => match event["board"].as_str() {
            Some(slug) => (format!("board:{slug}"), event["parent"].as_str()),
            None => return Patch::Reload,
        },
        _ => return Patch::Reload,
    };
    let at = view.cards.iter().position(|card| card.id() == id);
    match (home == Some(here), at) {
        (true, Some(at)) if COLUMNS.contains(&to) => {
            let card = &mut view.cards[at];
            card.place(to, position.unwrap_or_else(|| card.position()));
            if let Card::Item(item) = card {
                item.resolution = match (to, item.resolution.take()) {
                    ("done", None) => Some("fixed".to_owned()),
                    ("done", kept) => kept,
                    _ => None,
                };
            }
            sort(&mut view.cards);
            Patch::Patched
        }
        (false, Some(at)) => {
            view.cards.remove(at);
            Patch::Reload
        }
        _ => Patch::Reload,
    }
}

pub fn request(lane: &[&Card], target: &str, column: usize, row: usize) -> (Move, f64) {
    let before = lane.get(row).map(|c| c.id());
    let after = row.checked_sub(1).and_then(|r| lane.get(r));
    let position = match (
        after.map(|c| c.position()),
        lane.get(row).map(|c| c.position()),
    ) {
        (Some(a), Some(b)) => (a + b) / 2.0,
        (Some(a), None) => a + 1024.0,
        (None, Some(b)) => b - 1024.0,
        (None, None) => 1024.0,
    };
    let request = Move {
        target: target.to_owned(),
        to: Some(COLUMNS[column.min(COLUMNS.len() - 1)].to_owned()),
        after: if before.is_none() {
            after.map(|c| c.id())
        } else {
            None
        },
        before,
        ..Move::default()
    };
    (request, position)
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn view() -> BoardView {
        serde_json::from_value(json!({
            "statuses": [{"key": "inbox", "name": "Inbox", "position": 0}],
            "board": {"slug": "home", "name": "example.com", "host": "example.com", "parent": null,
                      "status": "inbox", "rollup": {"done": 1, "total": 3}},
            "cards": [
                {"type": "item", "key": "BUG-1", "kind": "bug", "title": "One", "status": "inbox",
                 "resolution": null, "position": 1024, "assignee": null,
                 "reporter": {"name": "Grace", "agent": false}, "priority": null, "labels": []},
                {"type": "board", "slug": "v2", "name": "Site v2", "status": "inbox", "position": 2048,
                 "rollup": {"done": 1, "total": 2}},
                {"type": "item", "key": "BUG-2", "kind": "bug", "title": "Two", "status": "doing",
                 "resolution": null, "position": 1024, "assignee": "ada@example.com",
                 "reporter": {"name": "Ada", "agent": true}, "priority": "high",
                 "labels": [{"name": "cart", "color": "#f7768e"}]}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn a_drop_asks_the_move_endpoint_in_the_contract_shape() {
        let view = view();
        let lane: Vec<&Card> = view
            .cards
            .iter()
            .filter(|c| c.status() == "inbox")
            .collect();
        let (between, position) = request(&lane, "BUG-2", 0, 1);
        assert_eq!(
            serde_json::to_value(&between).unwrap(),
            json!({"target": "BUG-2", "to": "inbox", "before": "board:v2"})
        );
        assert_eq!(position, 1536.0);
        let (last, position) = request(&lane, "BUG-2", 3, 2);
        assert_eq!(
            serde_json::to_value(&last).unwrap(),
            json!({"target": "BUG-2", "to": "done", "after": "board:v2"})
        );
        assert_eq!(position, 3072.0);
        let moved: Moved = serde_json::from_value(json!({
            "moved": {"type": "board", "slug": "v2", "name": "Site v2", "status": "done",
                      "position": 1, "rollup": {"done": 2, "total": 2}},
            "changed": ["BUG-7", "BUG-8"]
        }))
        .unwrap();
        assert_eq!(moved.moved.id(), "board:v2");
        assert_eq!(moved.changed, ["BUG-7", "BUG-8"]);
    }

    #[test]
    fn live_moves_patch_the_board_in_place() {
        let mut view = view();
        let event = json!({"type": "move", "key": "BUG-2", "board": "home", "from": "doing", "to": "inbox", "position": 1500.0});
        assert_eq!(patch(&mut view, &event), Patch::Patched);
        let order: Vec<String> = view.cards.iter().map(Card::id).collect();
        assert_eq!(order, ["BUG-1", "BUG-2", "board:v2"]);
        let event = json!({"type": "board.move", "board": "v2", "parent": "home", "from": "inbox", "to": "done", "position": 1.0});
        assert_eq!(patch(&mut view, &event), Patch::Patched);
        assert_eq!(view.cards.last().map(Card::status), Some("done"));
        let event = json!({"type": "move", "key": "BUG-1", "board": "elsewhere", "from": "inbox", "to": "doing", "position": 1.0});
        assert_eq!(patch(&mut view, &event), Patch::Reload);
        assert!(view.cards.iter().all(|c| c.id() != "BUG-1"));
        let event = json!({"type": "move", "key": "BUG-9", "board": "home", "from": "inbox", "to": "doing", "position": 1.0});
        assert_eq!(patch(&mut view, &event), Patch::Reload);
        assert_eq!(
            patch(&mut view, &json!({"type": "statuses"})),
            Patch::Reload
        );
    }
}

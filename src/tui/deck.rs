use serde_json::Value;

pub use crate::wire::{Board, BoardView, Boards, Card, Move, Moved, StatusEntry};

pub use crate::wire::STATUSES as COLUMNS;

use crate::wire;

use super::source::Source;

impl Card {
    pub fn id(&self) -> String {
        match self {
            Card::Item(item) => item.key.clone(),
            Card::Board(board) => format!("board:{}", board.slug),
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

pub fn default_statuses() -> Vec<StatusEntry> {
    COLUMNS
        .iter()
        .enumerate()
        .map(|(at, key)| StatusEntry {
            key: (*key).to_owned(),
            name: wire::status_word(key).to_owned(),
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
        Some("delete") => {
            let key = event["key"].as_str().unwrap_or_default();
            view.cards.retain(|card| card.id() != key);
            return Patch::Patched;
        }
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
    pub fn boards(&self) -> Result<Vec<(usize, Boards)>, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| Ok(vec![(0, demo.boards())])),
            Source::Live(_) => {
                let mut all = Vec::new();
                for (account, name) in self.accounts().iter().enumerate() {
                    let boards = self
                        .client(account, None)?
                        .boards()
                        .map_err(|why| format!("{name}: {why}"))?;
                    all.push((account, boards));
                }
                Ok(all)
            }
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn board(&self, at: Option<(usize, String)>) -> Result<(usize, BoardView), String> {
        match (self, at) {
            (Source::Demo(..), at) => {
                self.sample(|demo| Ok((0, demo.board(at.as_ref().map(|(_, s)| s.as_str()))?)))
            }
            (Source::Live(_), Some((account, slug))) => {
                Ok((account, self.client(account, None)?.board(&slug)?))
            }
            (Source::Live(_), None) => {
                let all = self.boards()?;
                let home = all
                    .iter()
                    .find_map(|(account, boards)| {
                        boards.boards.iter().find(|b| b.home).map(|b| (*account, b))
                    })
                    .or_else(|| {
                        all.iter().find_map(|(account, boards)| {
                            boards
                                .boards
                                .iter()
                                .find(|b| b.parent.is_none())
                                .map(|b| (*account, b))
                        })
                    })
                    .map(|(account, b)| (account, b.slug.clone()))
                    .ok_or_else(|| "no board yet; p99 boards add makes one".to_owned())?;
                self.board(Some(home))
            }
            (Source::Broken(why), _) => Err(why.clone()),
        }
    }

    pub fn shift(&self, account: usize, request: &Move) -> Result<Moved, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.shift(request)),
            Source::Live(_) => self.client(account, None)?.move_card(request),
            Source::Broken(why) => Err(why.clone()),
        }
    }
}

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

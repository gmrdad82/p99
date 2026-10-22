use serde_json::Value;

pub use crate::wire::{
    Lane as Column, LaneBoard as Board, LaneBoards as Boards, LaneCard as Card,
    LanePage as BoardView, MoveTo as Move, MovedCard as Moved, Owner as Person,
};

use crate::boards::raced;

use super::source::Source;

pub const MOVED: &str = "this card moved; refreshed";
pub const NONE: &str = "no board yet";

impl Board {
    pub fn lane(&self, label: &str) -> Option<usize> {
        self.columns.iter().position(|c| c.label == label)
    }

    pub fn closes(&self, label: &str) -> bool {
        self.columns.iter().any(|c| c.label == label && c.closes)
    }

    pub fn whose(&self) -> String {
        self.owner.clone().unwrap_or_default().handle()
    }
}

pub fn offered(boards: &[Board], card: bool) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    let side = boards
        .iter()
        .filter(|b| b.cards == card && (b.mine || card));
    for column in side.flat_map(|b| &b.columns) {
        if !labels.contains(&column.label) {
            labels.push(column.label.clone());
        }
    }
    labels
}

pub fn sort(view: &mut BoardView) {
    let BoardView { board, cards } = view;
    let rank = |card: &Card| board.lane(&card.label).unwrap_or(usize::MAX);
    cards.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.order.cmp(&b.order)));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Patch {
    Patched,
    Reload,
}

pub fn patch(view: &mut BoardView, event: &Value) -> Patch {
    let Some(key) = event["key"].as_str() else {
        return Patch::Reload;
    };
    let at = view.cards.iter().position(|card| card.key == key);
    match event["type"].as_str() {
        Some("label") => {
            let to = event["to"].as_str().unwrap_or_default();
            match (at, view.board.lane(to).is_some()) {
                (Some(at), true) => {
                    view.cards[at].label = to.to_owned();
                    sort(view);
                    Patch::Patched
                }
                (Some(at), false) => {
                    view.cards.remove(at);
                    Patch::Patched
                }
                (None, true) => Patch::Reload,
                (None, false) => Patch::Patched,
            }
        }
        Some("order") => {
            let board = &event["board"];
            let here = view.board.id;
            if board.as_i64() != Some(here) && board.as_str() != Some(here.to_string().as_str()) {
                return Patch::Patched;
            }
            match (at, event["order"].as_str()) {
                (Some(at), Some(order)) => {
                    view.cards[at].order = Some(order.to_owned());
                    sort(view);
                    Patch::Patched
                }
                _ => Patch::Reload,
            }
        }
        Some("delete") => {
            view.cards.retain(|card| card.key != key);
            Patch::Patched
        }
        _ => Patch::Reload,
    }
}

pub fn request(board: &Board, lane: &[&Card], card: &Card, column: usize, row: usize) -> Move {
    let before = lane.get(row).map(|c| c.key.clone());
    let after = row
        .checked_sub(1)
        .and_then(|r| lane.get(r))
        .map(|c| c.key.clone());
    Move {
        key: card.key.clone(),
        from: card.label.clone(),
        to: board
            .columns
            .get(column)
            .map(|c| c.label.clone())
            .unwrap_or_default(),
        board: Some(board.id),
        after: if before.is_none() { after } else { None },
        before,
    }
}

pub fn stale(error: &str) -> bool {
    error.ends_with("(409)")
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
                        .lanes()
                        .map_err(|why| format!("{name}: {why}"))?;
                    all.push((account, boards));
                }
                Ok(all)
            }
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn board(&self, at: Option<(usize, i64)>) -> Result<(usize, BoardView), String> {
        match (self, at) {
            (Source::Demo(..), at) => {
                self.sample(|demo| Ok((0, demo.board(at.map(|(_, id)| id))?)))
            }
            (Source::Live(_), Some((account, id))) => {
                Ok((account, self.client(account, None)?.lane(id)?))
            }
            (Source::Live(_), None) => {
                let all = self.boards()?;
                let first = all
                    .iter()
                    .find_map(|(account, boards)| {
                        boards.boards.iter().find(|b| b.mine).map(|b| (*account, b))
                    })
                    .or_else(|| {
                        all.iter().find_map(|(account, boards)| {
                            boards.boards.first().map(|b| (*account, b))
                        })
                    })
                    .map(|(account, b)| (account, b.id))
                    .ok_or_else(|| NONE.to_owned())?;
                self.board(Some(first))
            }
            (Source::Broken(why), _) => Err(why.clone()),
        }
    }

    pub fn labels(&self, account: usize, card: bool) -> Result<Vec<String>, String> {
        let boards = match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.boards()))?,
            Source::Live(_) => self.client(account, None)?.lanes()?,
            Source::Broken(why) => return Err(why.clone()),
        };
        Ok(offered(&boards.boards, card))
    }

    pub fn shift(&self, account: usize, request: &Move) -> Result<Moved, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.shift(request)),
            Source::Live(_) => {
                let client = self.client(account, None)?;
                client
                    .move_to(request)
                    .map_err(|error| raced(&client, &request.key, &request.to, error))
            }
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
            "board": {"id": 7, "name": "Shop", "owner": {"username": "ada.lovelace"}, "mine": true,
                      "columns": [{"label": "Inbox", "closes": false}, {"label": "QA ready", "closes": false},
                                  {"label": "Done", "closes": true}]},
            "cards": [
                {"key": "BUG-4", "kind": "bug", "title": "Four", "label": "Inbox", "assignee": null, "order": null},
                {"key": "BUG-1", "kind": "bug", "title": "One", "label": "Inbox", "assignee": null, "order": "a0"},
                {"key": "BUG-3", "kind": "bug", "title": "Three", "label": "Inbox", "assignee": null, "order": "a1"},
                {"key": "BUG-2", "kind": "bug", "title": "Two", "label": "QA ready",
                 "assignee": {"username": "grace.hopper"}, "order": "Zy"}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn a_drop_asks_the_move_endpoint_in_the_contract_shape() {
        let view = view();
        let lane: Vec<&Card> = view.cards.iter().filter(|c| c.label == "Inbox").collect();
        let card = view.cards.iter().find(|c| c.key == "BUG-2").unwrap();
        let between = request(&view.board, &lane, card, 0, 2);
        assert_eq!(
            serde_json::to_value(&between).unwrap(),
            json!({"key": "BUG-2", "from": "QA ready", "to": "Inbox", "board": 7, "before": "BUG-3"})
        );
        let last = request(&view.board, &[], card, 2, 0);
        assert_eq!(
            serde_json::to_value(&last).unwrap(),
            json!({"key": "BUG-2", "from": "QA ready", "to": "Done", "board": 7})
        );
        let moved: Moved = serde_json::from_value(json!({
            "card": {"key": "BUG-2", "kind": "bug", "title": "Two", "label": "Done", "assignee": null, "order": "a0V"}
        }))
        .unwrap();
        assert_eq!(moved.card.order.as_deref(), Some("a0V"));
        assert!(stale("this card moved; refreshed (409)"));
    }

    #[test]
    fn live_label_and_order_events_patch_the_board_in_place() {
        let mut view = view();
        let keys = |view: &BoardView| view.cards.iter().map(|c| c.key.clone()).collect::<Vec<_>>();
        let order = json!({"type": "order", "board": 7, "key": "BUG-3", "order": "Zz", "host": "example.com"});
        assert_eq!(patch(&mut view, &order), Patch::Patched);
        assert_eq!(keys(&view), ["BUG-4", "BUG-3", "BUG-1", "BUG-2"]);
        let elsewhere = json!({"type": "order", "board": "9", "key": "BUG-1", "order": "a", "host": "example.com"});
        assert_eq!(patch(&mut view, &elsewhere), Patch::Patched);
        assert_eq!(keys(&view), ["BUG-4", "BUG-3", "BUG-1", "BUG-2"]);
        let label = json!({"type": "label", "key": "BUG-1", "from": "Inbox", "to": "QA ready", "host": "example.com"});
        assert_eq!(patch(&mut view, &label), Patch::Patched);
        assert_eq!(keys(&view), ["BUG-4", "BUG-3", "BUG-2", "BUG-1"]);
        let gone = json!({"type": "label", "key": "BUG-2", "from": "QA ready", "to": "Testing", "host": "example.com"});
        assert_eq!(patch(&mut view, &gone), Patch::Patched);
        assert_eq!(keys(&view), ["BUG-4", "BUG-3", "BUG-1"]);
        let arrives = json!({"type": "label", "key": "BUG-9", "from": "Testing", "to": "Done", "host": "example.com"});
        assert_eq!(patch(&mut view, &arrives), Patch::Reload);
        let passes = json!({"type": "label", "key": "BUG-8", "from": "Testing", "to": "Shipped", "host": "example.com"});
        assert_eq!(patch(&mut view, &passes), Patch::Patched);
        assert_eq!(
            patch(&mut view, &json!({"type": "comment", "key": "BUG-3"})),
            Patch::Reload
        );
    }
}

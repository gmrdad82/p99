use std::ops::{Deref, DerefMut};

use serde_json::Value;

pub use crate::card::Lane;
pub use crate::one_board::{BoardCard, LaneInfo as Column};
pub use crate::wire::{MoveTo as Move, MovedCard as Moved};

use crate::boards::raced;
use crate::one_board::BoardQuery;

use super::source::{Source, fold};

pub const MOVED: &str = "this card moved; refreshed";
pub const LANES: [(Lane, &str, bool); 7] = [
    (Lane::New, "New", false),
    (Lane::Planned, "Planned", false),
    (Lane::InProgress, "In progress", false),
    (Lane::NeedsYou, "Needs you", false),
    (Lane::Stuck, "Stuck", false),
    (Lane::Landed, "Landed", false),
    (Lane::Done, "Done", true),
];
pub const WAITS: [Lane; 3] = [Lane::NeedsYou, Lane::Stuck, Lane::Landed];

#[derive(Debug, Clone)]
pub struct Card {
    pub account: usize,
    pub id: String,
    pub card: BoardCard,
}

impl Card {
    pub fn new(account: usize, card: BoardCard) -> Card {
        Card {
            id: format!("{account}/{}", card.key),
            account,
            card,
        }
    }
}

impl Deref for Card {
    type Target = BoardCard;

    fn deref(&self) -> &BoardCard {
        &self.card
    }
}

impl DerefMut for Card {
    fn deref_mut(&mut self) -> &mut BoardCard {
        &mut self.card
    }
}

#[derive(Debug, Clone, Default)]
pub struct BoardView {
    pub lanes: Vec<Column>,
    pub cards: Vec<Card>,
    pub missing: Vec<String>,
}

pub fn default_lanes() -> Vec<Column> {
    LANES
        .iter()
        .map(|&(word, label, closes)| Column {
            word,
            label: label.to_owned(),
            closes,
        })
        .collect()
}

impl BoardView {
    pub fn lane(&self, word: Lane) -> Option<usize> {
        self.lanes.iter().position(|c| c.word == word)
    }

    pub fn named(&self, label: &str) -> Option<usize> {
        self.lanes
            .iter()
            .position(|c| c.label == label)
            .or_else(|| {
                let folded = fold(label);
                self.lanes.iter().position(|c| fold(&c.label) == folded)
            })
    }

    pub fn closes(&self, card: &Card) -> bool {
        self.lane(card.status)
            .and_then(|at| self.lanes.get(at))
            .is_some_and(|c| c.closes)
    }

    pub fn find(&self, account: usize, key: &str) -> Option<usize> {
        self.cards
            .iter()
            .position(|c| c.account == account && c.key == key)
    }
}

pub fn sort(view: &mut BoardView) {
    let BoardView { lanes, cards, .. } = view;
    let rank = |card: &Card| {
        lanes
            .iter()
            .position(|c| c.word == card.status)
            .unwrap_or(usize::MAX)
    };
    cards.sort_by(|a, b| {
        rank(a)
            .cmp(&rank(b))
            .then(a.account.cmp(&b.account))
            .then_with(|| a.order.cmp(&b.order))
    });
}

pub fn settle(view: &mut BoardView, at: usize, label: &str) -> bool {
    let Some(lane) = view.named(label).and_then(|l| view.lanes.get(l)).cloned() else {
        return false;
    };
    let card = &mut view.cards[at];
    card.label = lane.label;
    card.status = lane.word;
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Patch {
    Patched,
    Reload,
}

pub fn patch(view: &mut BoardView, account: usize, event: &Value) -> Patch {
    let Some(key) = event["key"].as_str() else {
        return Patch::Reload;
    };
    let at = view.find(account, key);
    match event["type"].as_str() {
        Some("label") => {
            let to = event["to"].as_str().unwrap_or_default();
            match (at, view.named(to).is_some()) {
                (Some(at), true) => {
                    settle(view, at, to);
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
        Some("order") => match (at, event["order"].as_str()) {
            (Some(at), Some(order)) => {
                view.cards[at].order = Some(order.to_owned());
                sort(view);
                Patch::Patched
            }
            _ => Patch::Reload,
        },
        Some("delete") => {
            view.cards
                .retain(|card| card.account != account || card.key != key);
            Patch::Patched
        }
        _ => Patch::Reload,
    }
}

pub fn request(view: &BoardView, lane: &[&Card], card: &Card, column: usize, row: usize) -> Move {
    let same = |c: &&&Card| c.account == card.account;
    let before = lane.get(row..).and_then(|rest| rest.iter().find(same));
    let after = lane
        .get(..row.min(lane.len()))
        .and_then(|head| head.iter().rev().find(same));
    Move {
        key: card.key.clone(),
        from: card.label.clone(),
        to: view
            .lanes
            .get(column)
            .map(|c| c.word.word().to_owned())
            .unwrap_or_default(),
        board: None,
        after: if before.is_none() {
            after.map(|c| c.key.clone())
        } else {
            None
        },
        before: before.map(|c| c.key.clone()),
    }
}

pub fn stale(error: &str) -> bool {
    error.ends_with("(409)")
}

pub fn unrouted(error: &str) -> bool {
    error == "no such route (404)"
}

pub fn behind(account: &str, version: Option<&str>) -> String {
    let worker = version.map_or_else(
        || "an older P99".to_owned(),
        |v| format!("P99 {}", v.trim_start_matches('v')),
    );
    format!(
        "{account}: its Worker is {worker}, the board needs {}; p99 deploy --account {account} upgrades it",
        crate::VERSION
    )
}

pub fn wanted(card_project: Option<&str>, projects: &[String]) -> bool {
    projects.is_empty()
        || card_project.is_some_and(|p| {
            let p = fold(p);
            projects.iter().any(|want| fold(want) == p)
        })
}

impl Source {
    pub fn board(&self, projects: &[String]) -> Result<BoardView, String> {
        let mut view = match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.one_board(projects)))?,
            Source::Live(_) => self.live_board(projects)?,
            Source::Broken(why) => return Err(why.clone()),
        };
        sort(&mut view);
        Ok(view)
    }

    fn live_board(&self, projects: &[String]) -> Result<BoardView, String> {
        let query = BoardQuery {
            projects: projects.to_vec(),
            ..BoardQuery::default()
        };
        let names = self.accounts();
        let mut view = BoardView::default();
        let (mut answered, mut failed) = (false, None);
        for (account, name) in names.iter().enumerate() {
            let client = match self.client(account, None) {
                Ok(client) => client,
                Err(error) => {
                    view.missing.push(format!("{name}: {error}"));
                    failed.get_or_insert(error);
                    continue;
                }
            };
            match client.one_board(&query) {
                Ok(board) => {
                    if !answered {
                        view.lanes = board.board.lanes;
                    }
                    answered = true;
                    view.cards
                        .extend(board.cards.into_iter().map(|c| Card::new(account, c)));
                }
                Err(error) if unrouted(&error) => {
                    let version = client
                        .json::<Value>("GET", "/health", None)
                        .ok()
                        .and_then(|health| health["version"].as_str().map(str::to_owned));
                    view.missing.push(behind(name, version.as_deref()));
                }
                Err(error) => {
                    view.missing.push(format!("{name}: {error}"));
                    failed.get_or_insert(error);
                }
            }
        }
        match failed {
            Some(error) if !answered && view.missing.len() == 1 => Err(error),
            _ => {
                if view.lanes.is_empty() {
                    view.lanes = default_lanes();
                }
                Ok(view)
            }
        }
    }

    pub fn labels(&self, account: usize, _card: bool) -> Result<Vec<String>, String> {
        match self {
            Source::Demo(..) => Ok(default_lanes().into_iter().map(|c| c.label).collect()),
            Source::Live(_) => {
                let board = self.client(account, None)?.one_board(&BoardQuery {
                    statuses: vec![Lane::New],
                    ..BoardQuery::default()
                })?;
                Ok(board.board.lanes.into_iter().map(|c| c.label).collect())
            }
            Source::Broken(why) => Err(why.clone()),
        }
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

    fn card(account: usize, key: &str, status: &str, order: Option<&str>) -> Card {
        Card::new(
            account,
            serde_json::from_value(json!({
                "key": key, "kind": "bug", "project": null, "status": status,
                "label": LANES.iter().find(|l| l.0.word() == status).map(|l| l.1).unwrap(),
                "lane": 1, "title": key, "host": "example.com", "assignee": null,
                "order": order, "changed_at": "2026-10-22T08:00:00.000Z", "changed_by": null
            }))
            .unwrap(),
        )
    }

    fn view() -> BoardView {
        let mut view = BoardView {
            lanes: default_lanes(),
            cards: vec![
                card(0, "BUG-4", "new", None),
                card(0, "BUG-1", "new", Some("a0")),
                card(1, "BUG-1", "new", Some("Zz")),
                card(0, "BUG-3", "new", Some("a1")),
                card(0, "BUG-2", "needs-you", Some("Zy")),
                card(0, "BUG-5", "done", Some("a0")),
            ],
            missing: Vec::new(),
        };
        sort(&mut view);
        view
    }

    fn ids(view: &BoardView) -> Vec<String> {
        view.cards.iter().map(|c| c.id.clone()).collect()
    }

    #[test]
    fn the_seven_lanes_come_in_the_contract_order_with_done_closing() {
        let lanes = default_lanes();
        let words: Vec<&str> = lanes.iter().map(|c| c.word.word()).collect();
        assert_eq!(
            words,
            [
                "new",
                "planned",
                "in-progress",
                "needs-you",
                "stuck",
                "landed",
                "done"
            ]
        );
        assert_eq!(lanes.iter().filter(|c| c.closes).count(), 1);
        assert!(lanes[6].closes);
        assert_eq!(lanes[3].label, "Needs you");
    }

    #[test]
    fn cards_sort_by_lane_then_account_then_order() {
        assert_eq!(
            ids(&view()),
            [
                "0/BUG-4", "0/BUG-1", "0/BUG-3", "1/BUG-1", "0/BUG-2", "0/BUG-5"
            ]
        );
        let view = view();
        assert!(view.closes(&view.cards[5]));
        assert!(!view.closes(&view.cards[4]));
    }

    #[test]
    fn a_lane_is_found_by_word_by_name_and_by_name_in_any_case() {
        let view = view();
        assert_eq!(view.lane(Lane::NeedsYou), Some(3));
        assert_eq!(view.named("Needs you"), Some(3));
        assert_eq!(view.named("needs YOU"), Some(3));
        assert_eq!(view.named("QA ready"), None);
        assert_eq!(view.find(1, "BUG-1"), Some(3));
        assert_eq!(view.find(2, "BUG-1"), None);
    }

    #[test]
    fn a_drop_asks_by_lane_word_with_neighbours_of_the_same_account_only() {
        let view = view();
        let lane: Vec<&Card> = view
            .cards
            .iter()
            .filter(|c| c.status == Lane::New)
            .collect();
        let moving = &view.cards[4];
        let between = request(&view, &lane, moving, 0, 2);
        assert_eq!(
            serde_json::to_value(&between).unwrap(),
            json!({"key": "BUG-2", "from": "Needs you", "to": "new", "before": "BUG-3"})
        );
        let past_mine = request(&view, &lane, moving, 0, 3);
        assert_eq!(
            serde_json::to_value(&past_mine).unwrap(),
            json!({"key": "BUG-2", "from": "Needs you", "to": "new", "after": "BUG-3"})
        );
        let other = &view.cards[3];
        let alone = request(&view, &lane, other, 6, 0);
        assert_eq!(
            serde_json::to_value(&alone).unwrap(),
            json!({"key": "BUG-1", "from": "New", "to": "done"})
        );
        let empty = request(&view, &[], moving, 1, 0);
        assert_eq!(empty.before, None);
        assert_eq!(empty.after, None);
        assert_eq!(empty.to, "planned");
        assert!(stale("this card moved; refreshed (409)"));
        assert!(!stale("no item FEAT-9 (404)"));
    }

    #[test]
    fn live_events_patch_only_the_account_they_came_from() {
        let mut view = view();
        let order = json!({"type": "order", "board": 3, "key": "BUG-3", "order": "Zx"});
        assert_eq!(patch(&mut view, 0, &order), Patch::Patched);
        assert_eq!(
            ids(&view),
            [
                "0/BUG-4", "0/BUG-3", "0/BUG-1", "1/BUG-1", "0/BUG-2", "0/BUG-5"
            ]
        );
        let label = json!({"type": "label", "key": "BUG-1", "from": "New", "to": "stuck"});
        assert_eq!(patch(&mut view, 1, &label), Patch::Patched);
        let moved = &view.cards[view.find(1, "BUG-1").unwrap()];
        assert_eq!((moved.status, moved.label.as_str()), (Lane::Stuck, "Stuck"));
        assert_eq!(view.cards[view.find(0, "BUG-1").unwrap()].status, Lane::New);
        let gone = json!({"type": "label", "key": "BUG-4", "from": "New", "to": "Archive"});
        assert_eq!(patch(&mut view, 0, &gone), Patch::Patched);
        assert_eq!(view.find(0, "BUG-4"), None);
        let arrives = json!({"type": "label", "key": "BUG-9", "from": "New", "to": "Landed"});
        assert_eq!(patch(&mut view, 0, &arrives), Patch::Reload);
        let passes = json!({"type": "label", "key": "BUG-8", "from": "New", "to": "Shipped"});
        assert_eq!(patch(&mut view, 0, &passes), Patch::Patched);
        let delete = json!({"type": "delete", "key": "BUG-1"});
        assert_eq!(patch(&mut view, 1, &delete), Patch::Patched);
        assert_eq!(view.find(1, "BUG-1"), None);
        assert!(view.find(0, "BUG-1").is_some());
        assert_eq!(
            patch(&mut view, 0, &json!({"type": "comment", "key": "BUG-3"})),
            Patch::Reload
        );
        assert_eq!(
            patch(&mut view, 0, &json!({"type": "order", "key": "BUG-3"})),
            Patch::Reload
        );
        assert_eq!(
            patch(&mut view, 0, &json!({"type": "label"})),
            Patch::Reload
        );
    }

    #[test]
    fn an_old_worker_gets_one_line_naming_both_versions_and_the_fix() {
        assert_eq!(
            behind("shop", Some("1.9.2")),
            format!(
                "shop: its Worker is P99 1.9.2, the board needs {}; p99 deploy --account shop upgrades it",
                crate::VERSION
            )
        );
        assert!(behind("shop", None).starts_with("shop: its Worker is an older P99, "));
        assert!(behind("shop", Some("v1.8.0")).contains("P99 1.8.0,"));
        assert!(unrouted("no such route (404)"));
        assert!(!unrouted("no such item (404)"));
    }

    #[test]
    fn a_project_filter_matches_any_chosen_name_in_any_case_and_hides_plain_items() {
        let chosen = vec!["Splicer".to_owned(), "paper".to_owned()];
        assert!(wanted(Some("splicer"), &chosen));
        assert!(wanted(Some("PAPER"), &chosen));
        assert!(!wanted(Some("Dispatch"), &chosen));
        assert!(!wanted(None, &chosen));
        assert!(wanted(None, &[]));
        assert!(wanted(Some("Dispatch"), &[]));
    }
}

use std::collections::HashMap;

use crate::wire::{self, Issue, Thread};

use super::super::deck::{
    Board, BoardView, Boards, Card, Column, MOVED, Move, Moved, Person, sort,
};
use super::{DAY, Demo, HOUR, MINUTE, NOW, iso};

pub(super) const ITEMS: [super::Item; 10] = [
    extra(
        "feature",
        "inbox",
        "Gift wrapping at checkout",
        "/checkout",
        true,
        7 * HOUR,
        None,
        "Let me add a note and wrap a present.",
    ),
    extra(
        "bug",
        "review",
        "Lamp photos crop the shade",
        "/products/lamp",
        true,
        9 * HOUR,
        Some("ada.lovelace"),
        "The top of the lamp is cut off in every photo.",
    ),
    extra(
        "bug",
        "inbox",
        "Apple Pay button missing on iPad",
        "/checkout",
        false,
        4 * HOUR,
        None,
        "Safari on an iPad shows card payment only.",
    ),
    extra(
        "task",
        "doing",
        "One-page checkout form",
        "/checkout",
        false,
        2 * HOUR,
        Some("ada.lovelace"),
        "Address, delivery and payment on one page.",
    ),
    extra(
        "improvement",
        "review",
        "Remember the last shipping address",
        "/checkout",
        true,
        6 * HOUR,
        Some("grace.hopper"),
        "Fill the address from the last order.",
    ),
    extra(
        "task",
        "done",
        "Move the basket into a drawer",
        "/cart",
        false,
        3 * DAY,
        Some("ada.lovelace"),
        "The basket slides in from the right on every page.",
    ),
    extra(
        "feature",
        "inbox",
        "Pay in three instalments",
        "/checkout",
        true,
        26 * HOUR,
        None,
        "Split a payment over three months.",
    ),
    extra(
        "task",
        "doing",
        "Switch to the new card form",
        "/checkout",
        false,
        45 * MINUTE,
        Some("grace.hopper"),
        "The provider's hosted card fields, one iframe.",
    ),
    extra(
        "task",
        "done",
        "Add 3-D Secure to card payments",
        "/checkout",
        false,
        2 * DAY,
        Some("ada.lovelace"),
        "Required for cards issued in the EU.",
    ),
    extra(
        "task",
        "inbox",
        "Delete the old image bucket",
        "/",
        false,
        5 * HOUR,
        None,
        "Once every product image has moved.",
    ),
];

pub(super) const CARDS: [super::Item; 6] = [
    card("feature", "new", "Export keeps every audio track", false, 20 * MINUTE),
    card("task", "planned", "Thumbnails for the clip rail", false, 3 * HOUR),
    card("bug", "in-progress", "Waveform drifts after a cut", true, 50 * MINUTE),
    card("bug", "stuck", "Spanish cues lose their accents", true, 2 * HOUR),
    card("feature", "landed", "Roll-up player plays the cut", true, 30 * MINUTE),
    card("task", "done", "Silence removed by default", false, DAY),
];

const fn card(
    kind: &'static str,
    status: &'static str,
    title: &'static str,
    agent: bool,
    updated: i64,
) -> super::Item {
    super::Item {
        kind,
        status,
        resolution: if matches!(status.as_bytes(), b"done") {
            Some("fixed")
        } else {
            None
        },
        title,
        host: "shop.example.com",
        path: "/",
        grace: false,
        agent,
        created: updated + HOUR,
        updated,
        unread: false,
        assignee: None,
        body: "",
    }
}

pub(super) const FIRST_CARD: i64 = (super::ITEMS.len() + ITEMS.len() + 1) as i64;

pub(super) fn is_card(issue: &Issue) -> bool {
    issue.id >= FIRST_CARD
}

#[allow(clippy::too_many_arguments)]
const fn extra(
    kind: &'static str,
    status: &'static str,
    title: &'static str,
    path: &'static str,
    grace: bool,
    updated: i64,
    assignee: Option<&'static str>,
    body: &'static str,
) -> super::Item {
    super::Item {
        kind,
        status,
        resolution: if matches!(status.as_bytes(), b"done") {
            Some("fixed")
        } else {
            None
        },
        title,
        host: "shop.example.com",
        path,
        grace,
        agent: false,
        created: updated + 2 * DAY,
        updated,
        unread: false,
        assignee,
        body,
    }
}

const SHOP: [(&str, bool); 4] = [
    ("Inbox", false),
    ("Doing", false),
    ("QA ready", false),
    ("Done", true),
];

const LANES: [(&str, bool); 6] = [
    ("New", false),
    ("Planned", false),
    ("In progress", false),
    ("Stuck", false),
    ("Landed", false),
    ("Done", true),
];

const CARDS_BOARD: i64 = 3;

const QA: [(&str, bool); 3] = [("QA ready", false), ("Testing", false), ("Verified", true)];

const LABELED: [(i64, &str); 2] = [(14, "Testing"), (21, "Verified")];

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

pub(super) struct Shelf {
    boards: Vec<Board>,
    orders: HashMap<(i64, String), String>,
}

fn board(id: i64, name: &str, owner: &str, mine: bool, columns: &[(&str, bool)]) -> Board {
    Board {
        id,
        name: name.into(),
        owner: Some(Person {
            username: Some(owner.into()),
        }),
        mine,
        columns: columns
            .iter()
            .map(|&(label, closes)| Column {
                label: label.into(),
                closes,
            })
            .collect(),
    }
}

pub(super) fn label_of(issue: &Issue) -> String {
    LABELED
        .iter()
        .find(|(id, _)| *id == issue.id)
        .map_or_else(|| status_label(&issue.status), |&(_, label)| label)
        .to_owned()
}

pub(super) fn status_label(status: &str) -> &'static str {
    match status {
        "doing" => "Doing",
        "review" => "QA ready",
        "done" => "Done",
        "new" => "New",
        "planned" => "Planned",
        "in-progress" => "In progress",
        "stuck" => "Stuck",
        "landed" => "Landed",
        _ => "Inbox",
    }
}

impl Shelf {
    pub(super) fn new(threads: &[Thread]) -> Shelf {
        let mut shelf = Shelf {
            boards: vec![
                board(1, "Shop", "ada.lovelace", true, &SHOP),
                board(2, "QA", "grace.hopper", false, &QA),
                board(CARDS_BOARD, "Cards", "ada.lovelace", true, &LANES),
            ],
            orders: HashMap::new(),
        };
        for thread in threads {
            let issue = &thread.issue;
            shelf.append(&issue.key, issue.label.as_deref().unwrap_or_default());
        }
        shelf
    }

    fn append(&mut self, key: &str, label: &str) {
        let card = wire::item_number(key).is_some_and(|id| id >= FIRST_CARD);
        for board in &self.boards {
            if board.lane(label).is_none()
                || (board.id == CARDS_BOARD) != card
                || self.orders.contains_key(&(board.id, key.to_owned()))
            {
                continue;
            }
            let last = self
                .orders
                .iter()
                .filter(|((id, _), _)| *id == board.id)
                .map(|(_, order)| order.as_str())
                .max()
                .unwrap_or_default();
            let order = between(last, None);
            self.orders.insert((board.id, key.to_owned()), order);
        }
    }
}

fn between(a: &str, b: Option<&str>) -> String {
    let mut out = Vec::new();
    midpoint(a.as_bytes(), b.map(str::as_bytes), &mut out);
    String::from_utf8(out).unwrap_or_default()
}

fn midpoint(a: &[u8], b: Option<&[u8]>, out: &mut Vec<u8>) {
    let zero = DIGITS[0];
    if let Some(b) = b {
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(zero) == b[n] {
            n += 1;
        }
        if n > 0 {
            out.extend_from_slice(&b[..n]);
            return midpoint(a.get(n..).unwrap_or_default(), Some(&b[n..]), out);
        }
    }
    let digit = |c: u8| DIGITS.iter().position(|&d| d == c).unwrap_or(0);
    let low = a.first().map_or(0, |&c| digit(c));
    let high = b.map_or(DIGITS.len(), |b| b.first().map_or(0, |&c| digit(c)));
    if high - low > 1 {
        out.push(DIGITS[(low + high).div_ceil(2)]);
    } else if let Some(b) = b.filter(|b| b.len() > 1) {
        out.push(b[0]);
    } else {
        out.push(DIGITS[low]);
        midpoint(a.get(1..).unwrap_or_default(), None, out);
    }
}

impl Demo {
    fn find_board(&self, id: i64) -> Result<&Board, String> {
        self.shelf
            .boards
            .iter()
            .find(|b| b.id == id)
            .ok_or_else(|| format!("no board is called {id} (404)"))
    }

    pub fn boards(&self) -> Boards {
        Boards {
            boards: self.shelf.boards.clone(),
        }
    }

    pub fn board(&self, id: Option<i64>) -> Result<BoardView, String> {
        let board = self.find_board(id.unwrap_or(1))?.clone();
        let cards = self
            .threads
            .iter()
            .map(|t| &t.issue)
            .filter_map(|issue| {
                let label = issue.label.clone().unwrap_or_default();
                board.lane(&label)?;
                if (board.id == CARDS_BOARD) != is_card(issue) {
                    return None;
                }
                Some(Card {
                    key: issue.key.clone(),
                    kind: issue.kind.clone(),
                    title: issue.title.clone(),
                    label,
                    assignee: issue.assignee.as_ref().map(|a| Person {
                        username: Some(a.username.clone()),
                    }),
                    order: self
                        .shelf
                        .orders
                        .get(&(board.id, issue.key.clone()))
                        .cloned(),
                })
            })
            .collect();
        let mut view = BoardView { board, cards };
        sort(&mut view);
        Ok(view)
    }

    pub fn shift(&mut self, request: &Move) -> Result<Moved, String> {
        let mine: Vec<&Board> = self.shelf.boards.iter().filter(|b| b.mine).collect();
        let closes = mine
            .iter()
            .flat_map(|b| &b.columns)
            .find(|c| c.label == request.to)
            .map(|c| c.closes)
            .ok_or_else(|| format!("{} is not a label on your boards", request.to))?;
        if let Some(id) = request.board {
            let board = self.find_board(id)?;
            if !board.mine {
                return Err(format!(
                    "this board is {}'s; only its owner moves its cards (403)",
                    board.whose()
                ));
            }
        }
        let number = wire::item_number(&request.key)
            .ok_or_else(|| format!("{} is not an item key", request.key))?;
        let thread = self
            .threads
            .iter_mut()
            .find(|t| t.issue.id == number)
            .ok_or_else(|| format!("no item is called {}", request.key))?;
        let issue = &mut thread.issue;
        if issue.label.as_deref() != Some(request.from.as_str()) {
            return Err(format!("{MOVED} (409)"));
        }
        relabel(issue, &request.to, closes);
        let key = issue.key.clone();
        if let Some(id) = request.board {
            let view = self.board(Some(id))?;
            let lane: Vec<&Card> = view
                .cards
                .iter()
                .filter(|c| c.label == request.to && c.key != key)
                .collect();
            let at = |other: &Option<String>| {
                other
                    .as_ref()
                    .and_then(|o| lane.iter().position(|c| c.key == *o))
            };
            let slot = at(&request.before)
                .or_else(|| at(&request.after).map(|i| i + 1))
                .unwrap_or(0);
            let low = slot
                .checked_sub(1)
                .and_then(|i| lane.get(i))
                .and_then(|c| c.order.as_deref())
                .unwrap_or_default();
            let order = between(low, lane.get(slot).and_then(|c| c.order.as_deref()));
            self.shelf.orders.insert((id, key.clone()), order);
        }
        self.shelf.append(&key, &request.to);
        let card = self
            .board(Some(request.board.unwrap_or(1)))?
            .cards
            .into_iter()
            .find(|c| c.key == key)
            .ok_or_else(|| format!("no card is called {key}"))?;
        Ok(Moved { card })
    }

    pub fn labels(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for column in self
            .shelf
            .boards
            .iter()
            .filter(|b| b.mine)
            .flat_map(|b| &b.columns)
        {
            if !out.contains(&column.label) {
                out.push(column.label.clone());
            }
        }
        out
    }
}

fn relabel(issue: &mut Issue, label: &str, closes: bool) {
    issue.label = Some(label.to_owned());
    issue.status = match (closes, label) {
        (true, _) => "done",
        (false, "Inbox") => "inbox",
        _ => "doing",
    }
    .to_owned();
    if closes {
        issue.resolution.get_or_insert_with(|| "fixed".to_owned());
        issue.closed_at = Some(iso(NOW));
    } else {
        issue.resolution = None;
        issue.closed_at = None;
    }
    issue.updated_at = iso(NOW);
}

#[cfg(test)]
mod tests;

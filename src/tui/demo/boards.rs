use std::collections::HashMap;

use crate::card::{self, Lane};
use crate::one_board::BoardCard;
use crate::wire::{Issue, LaneCard, Owner, Thread};

use super::super::deck::{
    BoardView, Card, LANES, MOVED, Move, Moved, WAITS, default_lanes, sort, wanted,
};
use super::{DAY, Demo, HOUR, MINUTE, NOW, iso, summary};

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
    card(
        "feature",
        "new",
        "Export keeps every audio track",
        false,
        27 * HOUR,
    ),
    card(
        "task",
        "planned",
        "Thumbnails for the clip rail",
        false,
        28 * HOUR,
    ),
    card(
        "bug",
        "needs-you",
        "Waveform drifts after a cut",
        true,
        29 * HOUR,
    ),
    card(
        "bug",
        "stuck",
        "Spanish cues lose their accents",
        true,
        30 * HOUR,
    ),
    card(
        "feature",
        "landed",
        "Roll-up player plays the cut",
        true,
        31 * HOUR,
    ),
    card(
        "task",
        "done",
        "Silence removed by default",
        false,
        16 * DAY,
    ),
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

pub(super) const PROJECTS: [&str; 2] = ["Storefront", "Mobile app"];

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

pub(super) struct Shelf {
    orders: HashMap<String, String>,
}

pub(super) fn project_of(id: i64) -> Option<&'static str> {
    match id - FIRST_CARD {
        1 | 4 => Some(PROJECTS[1]),
        at if at >= 0 => Some(PROJECTS[0]),
        _ => None,
    }
}

pub(super) fn label_of(issue: &Issue) -> String {
    status_label(&issue.status).to_owned()
}

pub(super) fn status_label(status: &str) -> &'static str {
    let word = match status {
        "inbox" => "new",
        "doing" => "in-progress",
        "review" => "landed",
        other => other,
    };
    LANES
        .iter()
        .find(|lane| lane.0.word() == word)
        .map_or(LANES[0].1, |lane| lane.1)
}

fn lane_of(label: &str) -> Lane {
    LANES
        .iter()
        .find(|lane| lane.1 == label)
        .map_or(Lane::New, |lane| lane.0)
}

impl Shelf {
    pub(super) fn new(threads: &[Thread]) -> Shelf {
        let mut shelf = Shelf {
            orders: HashMap::new(),
        };
        for thread in threads {
            shelf.append(&thread.issue.key);
        }
        shelf
    }

    fn append(&mut self, key: &str) {
        let last = self
            .orders
            .values()
            .map(String::as_str)
            .max()
            .unwrap_or_default();
        let order = between(last, None);
        self.orders.insert(key.to_owned(), order);
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
    pub(super) fn shelf_top(&mut self, key: &str) {
        let new = status_label("inbox");
        let lowest = self
            .threads
            .iter()
            .filter(|t| t.issue.label.as_deref() == Some(new))
            .filter_map(|t| self.shelf.orders.get(&t.issue.key))
            .min()
            .cloned();
        let order = between("", lowest.as_deref());
        self.shelf.orders.insert(key.to_owned(), order);
    }

    fn board_card(&self, issue: &Issue) -> BoardCard {
        let label = issue.label.clone().unwrap_or_default();
        BoardCard {
            key: issue.key.clone(),
            kind: issue.kind.clone(),
            project: issue.project.clone(),
            status: lane_of(&label),
            label,
            lane: None,
            title: issue.title.clone(),
            host: issue.host.clone().unwrap_or_default(),
            assignee: issue.assignee.as_ref().map(|a| a.username.clone()),
            order: self.shelf.orders.get(&issue.key).cloned(),
            changed_at: issue.updated_at.clone(),
            changed_by: None,
        }
    }

    pub fn one_board(&self, projects: &[String]) -> BoardView {
        let cards = self
            .threads
            .iter()
            .map(|t| &t.issue)
            .filter(|issue| wanted(issue.project.as_deref(), projects))
            .map(|issue| Card::new(0, self.board_card(issue)))
            .collect();
        let mut view = BoardView {
            lanes: default_lanes(),
            cards,
            missing: Vec::new(),
        };
        sort(&mut view);
        let mut place = (None, 0);
        for card in &mut view.cards {
            place = if place.0 == Some(card.status) {
                (place.0, place.1 + 1)
            } else {
                (Some(card.status), 1)
            };
            card.lane = (card.status != Lane::Done).then_some(place.1);
        }
        view
    }

    pub fn waiting(&self) -> (u64, Vec<card::Card>) {
        let mut cards: Vec<card::Card> = self
            .threads
            .iter()
            .map(|t| &t.issue)
            .filter(|issue| issue.project.is_some())
            .map(|issue| (issue, self.board_card(issue)))
            .filter(|(_, board)| WAITS.contains(&board.status))
            .map(|(issue, board)| {
                let reporter = summary(issue).reporter;
                card::Card {
                    key: board.key,
                    kind: board.kind,
                    project: board.project.unwrap_or_default(),
                    status: board.status,
                    label: board.label,
                    lane: board.lane,
                    title: board.title,
                    host: board.host,
                    reporter: card::Person {
                        name: Some(reporter.name),
                        username: None,
                        agent: reporter.agent,
                        via: reporter.via,
                    },
                    created_at: issue.created_at.clone(),
                    changed_at: board.changed_at,
                    changed_by: None,
                    comments: issue.comments.max(0) as u64,
                    links: Vec::new(),
                }
            })
            .collect();
        cards.sort_by(|a, b| b.changed_at.cmp(&a.changed_at).then(b.key.cmp(&a.key)));
        (cards.len() as u64, cards)
    }

    pub fn projects(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .threads
            .iter()
            .filter_map(|t| t.issue.project.clone())
            .collect();
        names.sort();
        names.dedup();
        names
    }

    pub fn shift(&mut self, request: &Move) -> Result<Moved, String> {
        let to = default_lanes()
            .into_iter()
            .find(|c| c.word.word() == request.to || c.label.eq_ignore_ascii_case(&request.to))
            .ok_or_else(|| format!("{} is not a lane (400)", request.to))?;
        let issue = &mut self.find(&request.key)?.issue;
        if issue.label.as_deref() != Some(request.from.as_str()) {
            return Err(format!("{MOVED} (409)"));
        }
        relabel(issue, &to.label, to.closes);
        let key = issue.key.clone();
        let view = self.one_board(&[]);
        let lane: Vec<&Card> = view
            .cards
            .iter()
            .filter(|c| c.status == to.word && c.key != key)
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
        self.shelf.orders.insert(key.clone(), order);
        let card = self
            .one_board(&[])
            .cards
            .into_iter()
            .find(|c| c.key == key)
            .ok_or_else(|| format!("no card is called {key}"))?;
        Ok(Moved {
            card: LaneCard {
                key: card.card.key,
                kind: card.card.kind,
                title: card.card.title,
                label: card.card.label,
                assignee: card.card.assignee.map(|username| Owner {
                    username: Some(username),
                }),
                order: card.card.order,
            },
        })
    }
}

fn relabel(issue: &mut Issue, label: &str, closes: bool) {
    issue.label = Some(label.to_owned());
    issue.status = match (closes, lane_of(label)) {
        (true, _) => "done",
        (false, Lane::New) => "inbox",
        (false, Lane::Landed) => "review",
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

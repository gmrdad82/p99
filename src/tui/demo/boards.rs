use serde_json::json;

use crate::wire::{self, BoardCard, CardPerson, Event, Issue, ItemCard, Rollup};

use super::super::deck::{
    Board, BoardView, Boards, COLUMNS, Card, Move, Moved, default_statuses, sort,
};
use super::{DAY, Demo, HOUR, ME, MINUTE, NOW, iso};

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
        Some("ada@example.com"),
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
        Some("ada@example.com"),
        "Address, delivery and payment on one page.",
    ),
    extra(
        "improvement",
        "review",
        "Remember the last shipping address",
        "/checkout",
        true,
        6 * HOUR,
        Some("grace@example.com"),
        "Fill the address from the last order.",
    ),
    extra(
        "task",
        "done",
        "Move the basket into a drawer",
        "/cart",
        false,
        3 * DAY,
        Some("ada@example.com"),
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
        Some("grace@example.com"),
        "The provider's hosted card fields, one iframe.",
    ),
    extra(
        "task",
        "done",
        "Add 3-D Secure to card payments",
        "/checkout",
        false,
        2 * DAY,
        Some("ada@example.com"),
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

const SHOP: &str = "shop-example-com";
const CHECKOUT: &str = "checkout-v2";
const PAYMENTS: &str = "payments";
const IMAGES: &str = "image-move";

type Shelved = (
    &'static str,
    &'static str,
    Option<&'static str>,
    Option<&'static str>,
    &'static str,
    f64,
);

const SHELF: [Shelved; 7] = [
    (
        SHOP,
        "shop.example.com",
        Some("shop.example.com"),
        None,
        "inbox",
        0.0,
    ),
    (
        "example-com",
        "example.com",
        Some("example.com"),
        None,
        "inbox",
        0.0,
    ),
    (
        "dev-example-com",
        "dev.example.com",
        Some("dev.example.com"),
        None,
        "inbox",
        0.0,
    ),
    (
        CHECKOUT,
        "Checkout v2",
        Some("shop.example.com"),
        Some(SHOP),
        "doing",
        3072.0,
    ),
    (
        PAYMENTS,
        "Payments",
        Some("shop.example.com"),
        Some(CHECKOUT),
        "doing",
        2048.0,
    ),
    (
        IMAGES,
        "Image move",
        Some("shop.example.com"),
        Some(SHOP),
        "review",
        512.0,
    ),
    ("launch", "Spring launch", None, None, "inbox", 0.0),
];

const PLACES: [(i64, &str, f64); 22] = [
    (11, SHOP, 1024.0),
    (13, SHOP, 2048.0),
    (5, SHOP, 1024.0),
    (7, SHOP, 2048.0),
    (14, SHOP, 1024.0),
    (3, SHOP, 1024.0),
    (12, SHOP, 2048.0),
    (15, CHECKOUT, 1024.0),
    (16, CHECKOUT, 1024.0),
    (17, CHECKOUT, 1024.0),
    (18, CHECKOUT, 1024.0),
    (19, PAYMENTS, 1024.0),
    (20, PAYMENTS, 1024.0),
    (21, PAYMENTS, 1024.0),
    (6, IMAGES, 1024.0),
    (22, IMAGES, 1024.0),
    (1, "example-com", 1024.0),
    (2, "example-com", 2048.0),
    (4, "example-com", 3072.0),
    (10, "example-com", 4096.0),
    (8, "dev-example-com", 1024.0),
    (9, "dev-example-com", 2048.0),
];

type Marks = (i64, &'static str, &'static [(&'static str, &'static str)]);

const MARKS: [Marks; 9] = [
    (11, "urgent", &[("cart", "#f7768e")]),
    (13, "low", &[]),
    (5, "normal", &[("product", "#7dcfff")]),
    (7, "high", &[("orders", "#e0af68")]),
    (14, "normal", &[("photos", "#bb9af7")]),
    (15, "high", &[("ipad", "#7aa2f7")]),
    (16, "high", &[]),
    (20, "urgent", &[("cards", "#9ece6a")]),
    (6, "normal", &[("photos", "#bb9af7")]),
];

pub(super) struct Shelf {
    boards: Vec<Board>,
    places: Vec<(i64, String, f64)>,
}

impl Shelf {
    pub(super) fn new() -> Shelf {
        Shelf {
            boards: SHELF
                .iter()
                .map(|&(slug, name, host, parent, status, position)| Board {
                    slug: slug.into(),
                    name: name.into(),
                    host: host.map(Into::into),
                    parent: parent.map(Into::into),
                    status: status.into(),
                    position,
                    home: parent.is_none() && host.is_some(),
                    rollup: Rollup::default(),
                })
                .collect(),
            places: PLACES
                .iter()
                .map(|&(id, slug, position)| (id, slug.to_owned(), position))
                .collect(),
        }
    }
}

fn card(issue: &Issue, position: f64) -> ItemCard {
    let marks = MARKS.iter().find(|(id, ..)| *id == issue.id);
    let reporter = &issue.reporter;
    ItemCard {
        key: issue.key.clone(),
        kind: issue.kind.clone(),
        title: issue.title.clone(),
        status: issue.status.clone(),
        resolution: issue.resolution.clone(),
        position,
        assignee: issue.assignee.clone(),
        reporter: CardPerson {
            name: reporter["name"].as_str().map(Into::into),
            agent: reporter["agent"].as_bool().unwrap_or(false),
        },
        priority: marks.map(|(_, priority, _)| (*priority).to_owned()),
        labels: marks
            .map(|(_, _, labels)| {
                labels
                    .iter()
                    .map(|(name, color)| json!({"name": name, "color": color}))
                    .collect()
            })
            .unwrap_or_default(),
        board: None,
    }
}

impl Demo {
    fn issue(&self, id: i64) -> Option<&Issue> {
        self.threads
            .iter()
            .map(|t| &t.issue)
            .find(|issue| issue.id == id)
    }

    fn subtree(&self, slug: &str) -> Vec<String> {
        let mut out = vec![slug.to_owned()];
        let mut at = 0;
        while at < out.len() {
            let parent = out[at].clone();
            out.extend(
                self.shelf
                    .boards
                    .iter()
                    .filter(|b| b.parent.as_deref() == Some(parent.as_str()))
                    .map(|b| b.slug.clone()),
            );
            at += 1;
        }
        out
    }

    fn rollup(&self, slug: &str) -> Rollup {
        let slugs = self.subtree(slug);
        self.shelf
            .places
            .iter()
            .filter(|(_, board, _)| slugs.contains(board))
            .filter_map(|(id, ..)| self.issue(*id))
            .fold(Rollup::default(), |sum, issue| Rollup {
                done: sum.done + i64::from(issue.status == "done"),
                total: sum.total + 1,
            })
    }

    fn rolled(&self, board: &Board) -> Board {
        Board {
            rollup: self.rollup(&board.slug),
            ..board.clone()
        }
    }

    pub fn boards(&self) -> Boards {
        Boards {
            statuses: default_statuses(),
            boards: self.shelf.boards.iter().map(|b| self.rolled(b)).collect(),
        }
    }

    pub fn board(&self, slug: Option<&str>) -> Result<BoardView, String> {
        let slug = slug.unwrap_or(SHOP);
        let board = self
            .shelf
            .boards
            .iter()
            .find(|b| b.slug == slug)
            .ok_or_else(|| format!("no board is called {slug}"))?;
        let mut cards: Vec<Card> = self
            .shelf
            .places
            .iter()
            .filter(|(_, at, _)| at == slug)
            .filter_map(|(id, _, position)| {
                self.issue(*id)
                    .map(|issue| Card::Item(card(issue, *position)))
            })
            .collect();
        cards.extend(
            self.shelf
                .boards
                .iter()
                .filter(|b| b.parent.as_deref() == Some(slug))
                .map(|b| {
                    Card::Board(BoardCard {
                        slug: b.slug.clone(),
                        name: b.name.clone(),
                        status: b.status.clone(),
                        position: b.position,
                        rollup: self.rollup(&b.slug),
                        parent: None,
                    })
                }),
        );
        sort(&mut cards);
        Ok(BoardView {
            statuses: default_statuses(),
            board: self.rolled(board),
            cards,
        })
    }

    pub fn shift(&mut self, request: &Move) -> Result<Moved, String> {
        let to = match &request.to {
            Some(to) => Some(
                COLUMNS
                    .iter()
                    .find(|key| key.eq_ignore_ascii_case(to))
                    .ok_or_else(|| format!("{to} is not a status"))?
                    .to_string(),
            ),
            None => None,
        };
        let (home, current) = self.whereabouts(&request.target)?;
        let home = request.board.clone().unwrap_or(home);
        let column = to.unwrap_or(current);
        let view = self.board(Some(&home))?;
        let neighbours: Vec<&Card> = view
            .cards
            .iter()
            .filter(|c| c.status() == column && c.id() != request.target)
            .collect();
        let find = |id: &Option<String>| {
            id.as_ref()
                .and_then(|id| neighbours.iter().position(|c| c.id() == *id))
        };
        let gap = |at: usize| {
            let before = at
                .checked_sub(1)
                .and_then(|i| neighbours.get(i))
                .map(|c| c.position());
            let after = neighbours.get(at).map(|c| c.position());
            match (before, after) {
                (Some(a), Some(b)) => (a + b) / 2.0,
                (Some(a), None) => a + 1024.0,
                (None, Some(b)) => b - 1024.0,
                (None, None) => 1024.0,
            }
        };
        let position = match (find(&request.before), find(&request.after)) {
            (Some(at), _) => gap(at),
            (None, Some(at)) => gap(at + 1),
            _ => gap(0),
        };
        let mut changed = Vec::new();
        if let Some(slug) = request.target.strip_prefix("board:") {
            let slugs = self.subtree(slug);
            if slugs.contains(&home) {
                return Err("a board can't move into itself".into());
            }
            if let Some(board) = self.shelf.boards.iter_mut().find(|b| b.slug == slug) {
                board.status = column.clone();
                board.position = position;
                board.parent = Some(home.clone());
            }
            let ids: Vec<i64> = self
                .shelf
                .places
                .iter()
                .filter(|(_, at, _)| slugs.contains(at))
                .map(|(id, ..)| *id)
                .collect();
            for id in ids {
                if let Some(key) = self.restatus(id, &column) {
                    changed.push(key);
                }
            }
        } else {
            let id = wire::item_number(&request.target)
                .ok_or_else(|| format!("{} is not an item key", request.target))?;
            if let Some(place) = self.shelf.places.iter_mut().find(|(at, ..)| *at == id) {
                if place.1 != home {
                    changed.push(request.target.clone());
                }
                place.1 = home.clone();
                place.2 = position;
            }
            if let Some(key) = self.restatus(id, &column)
                && !changed.contains(&key)
            {
                changed.push(key);
            }
        }
        let view = self.board(Some(&home))?;
        let moved = view
            .cards
            .into_iter()
            .find(|c| c.id() == request.target)
            .ok_or_else(|| format!("no card is called {}", request.target))?;
        Ok(Moved { moved, changed })
    }

    fn whereabouts(&self, target: &str) -> Result<(String, String), String> {
        if let Some(slug) = target.strip_prefix("board:") {
            let board = self
                .shelf
                .boards
                .iter()
                .find(|b| b.slug == slug)
                .ok_or_else(|| format!("no board is called {slug}"))?;
            let parent = board
                .parent
                .clone()
                .ok_or_else(|| format!("{slug} is a top board and sits in no column"))?;
            return Ok((parent, board.status.clone()));
        }
        let id = wire::item_number(target).ok_or_else(|| format!("{target} is not an item key"))?;
        let issue = self
            .issue(id)
            .ok_or_else(|| format!("no item is called {target}"))?;
        let home = self
            .shelf
            .places
            .iter()
            .find(|(at, ..)| *at == id)
            .map(|(_, slug, _)| slug.clone())
            .ok_or_else(|| format!("{target} is on no board"))?;
        Ok((home, issue.status.clone()))
    }

    fn restatus(&mut self, id: i64, column: &str) -> Option<String> {
        let thread = self.threads.iter_mut().find(|t| t.issue.id == id)?;
        let issue = &mut thread.issue;
        if issue.status == column {
            return None;
        }
        let resolution = (column == "done").then(|| "fixed".to_owned());
        let mut detail = json!({"from": issue.status, "to": column});
        if let Some(resolution) = &resolution {
            detail["resolution"] = json!(resolution);
        }
        thread.events.push(Event {
            actor: Some(ME.1.into()),
            actor_name: Some(ME.0.into()),
            kind: "status".into(),
            detail,
            at: iso(NOW),
        });
        issue.closed_at = resolution.as_ref().map(|_| iso(NOW));
        issue.status = column.to_owned();
        issue.resolution = resolution;
        issue.updated_at = iso(NOW);
        Some(issue.key.clone())
    }
}

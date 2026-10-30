use std::sync::LazyLock;

use pito_tui::crossterm::event::KeyEvent;
use pito_tui::keys::{Chord, Key, Keymap, Mode, Now, When, bind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    List,
    Back,
    Reload,
    Status,
    Host,
    NewCard,
    Projects,
    NeedsYou,
    Space,
    AllProjects,
    Scroll,
    Page,
    Top,
    Bottom,
    ReadAgain,
    Reply,
    Edit,
    Move,
    Assign,
    Link,
    Internal,
    SaveFile,
    Browse,
    Delete,
    Step,
    PickUp,
    Open,
    Drop,
    PutBack,
}

pub const CARDS: Mode = Mode("cards");
pub const CARD: Mode = Mode("card");
pub const BOARD: Mode = Mode("board");
pub const CARRYING: Mode = Mode("carrying a card");
pub const CODES: Mode = Mode("codes");
pub const PROJECTS: Mode = Mode("projects");

pub const READ: When = When("once read");
pub const READY: When = When("while nothing is saving");
pub const FILES: When = When("on a card with files");
pub const INTERNAL: When = When("while notes are internal");
pub const OUTWARD: When = When("while replies go out");
pub const HOSTS: When = When("with more than one host");
pub const FILTERED: When = When("while filtered");
pub const SPACES: When = When("with more than one space");
pub const FREE: When = When("while nothing else is open");
pub const CHOSEN: When = When("while projects are chosen");
pub const HERE: When = When("on a card");
pub const REVOKED: When = When("on a revoked code");

const LISTS: [Mode; 2] = [CARDS, CODES];
const AROUND: [Mode; 2] = [CARDS, BOARD];
const SCREENS: [Mode; 3] = [CARDS, BOARD, CODES];

pub static KEYS: LazyLock<Keymap<Act>> = LazyLock::new(keymap);

fn keymap() -> Keymap<Act> {
    Keymap::new()
        .modes(&[CARDS, CARD, BOARD, CARRYING, CODES, PROJECTS])
        .group(
            "Lists",
            [
                bind("up down", "move", Act::List)
                    .modes(&LISTS)
                    .when(READ)
                    .shown("↑↓"),
                bind("enter", "open", Act::List)
                    .on(CARDS)
                    .when(READ)
                    .rank(1),
                bind("/", "filter", Act::List)
                    .modes(&LISTS)
                    .when(READ)
                    .rank(1),
                bind("s", "status", Act::Status)
                    .on(CARDS)
                    .when(READ)
                    .rank(2)
                    .note("open, closed or all"),
                bind("h", "host", Act::Host).on(CARDS).when(HOSTS).rank(2),
                bind("esc", "clear filter", Act::List)
                    .modes(&LISTS)
                    .when(FILTERED),
            ],
        )
        .group(
            "Screens",
            [
                bind("n", "new card", Act::NewCard)
                    .modes(&AROUND)
                    .when(FREE)
                    .rank(1),
                bind("p", "projects", Act::Projects)
                    .modes(&AROUND)
                    .when(FREE)
                    .rank(2),
                bind("S", "space", Act::Space)
                    .modes(&SCREENS)
                    .when(SPACES)
                    .shown("S")
                    .rank(2),
                bind("esc", "all projects", Act::AllProjects)
                    .modes(&AROUND)
                    .when(CHOSEN),
                bind("w", "needs you", Act::NeedsYou)
                    .modes(&AROUND)
                    .when(FREE)
                    .rank(2),
                bind("r", "read again", Act::Reload).modes(&SCREENS).rank(3),
            ],
        )
        .group(
            "Card",
            [
                bind("r", "reply", Act::Reply)
                    .on(CARD)
                    .when(READY)
                    .note("tab adds files"),
                bind("e", "edit", Act::Edit).on(CARD).when(READY).rank(1),
                bind("m", "move to", Act::Move).on(CARD).when(READY).rank(1),
                bind("a", "assign", Act::Assign)
                    .on(CARD)
                    .when(READY)
                    .rank(1),
                bind("l", "link", Act::Link)
                    .on(CARD)
                    .when(READY)
                    .rank(2)
                    .note("a pull request, commit, tag or URL"),
                bind("i", "internal on", Act::Internal)
                    .on(CARD)
                    .when(INTERNAL)
                    .rank(2),
                bind("i", "internal off", Act::Internal)
                    .on(CARD)
                    .when(OUTWARD)
                    .rank(2),
                bind("f", "save file", Act::SaveFile)
                    .on(CARD)
                    .when(FILES)
                    .rank(1),
                bind("f", "save file", Act::SaveFile)
                    .on(CARD)
                    .when(READY)
                    .note("a card without files says so")
                    .quiet(),
                bind("o", "open page", Act::Browse)
                    .on(CARD)
                    .when(READ)
                    .rank(3),
                bind("d", "delete", Act::Delete)
                    .on(CARD)
                    .when(READY)
                    .rank(3)
                    .note("type its key back to delete it for good"),
                bind("up down k j", "scroll", Act::Scroll)
                    .on(CARD)
                    .when(READ)
                    .shown("↑↓")
                    .rank(3),
                bind("pgup pgdn space", "scroll a page", Act::Page)
                    .on(CARD)
                    .when(READ)
                    .quiet(),
                bind("home g", "top", Act::Top).on(CARD).when(READ).quiet(),
                bind("end G", "bottom", Act::Bottom)
                    .on(CARD)
                    .when(READ)
                    .quiet(),
                bind("ctrl+r", "read again", Act::ReadAgain)
                    .on(CARD)
                    .rank(3),
                bind("esc", "back", Act::Back).on(CARD),
            ],
        )
        .group(
            "Board",
            [
                bind("left right up down h l k j", "move", Act::Step)
                    .on(BOARD)
                    .when(READ)
                    .shown("←→↑↓"),
                bind("home g", "first card", Act::Top)
                    .on(BOARD)
                    .when(READ)
                    .quiet(),
                bind("end G", "last card", Act::Bottom)
                    .on(BOARD)
                    .when(READ)
                    .quiet(),
                bind("space", "pick up", Act::PickUp)
                    .on(BOARD)
                    .when(HERE)
                    .rank(1),
                bind("enter", "open", Act::Open)
                    .on(BOARD)
                    .when(HERE)
                    .rank(1),
                bind("left right up down h l k j", "carry", Act::Step)
                    .on(CARRYING)
                    .shown("←→↑↓"),
                bind("home g", "to the top", Act::Top).on(CARRYING).quiet(),
                bind("end G", "to the bottom", Act::Bottom)
                    .on(CARRYING)
                    .quiet(),
                bind("enter space", "drop", Act::Drop)
                    .on(CARRYING)
                    .shown("enter"),
                bind("esc", "put back", Act::PutBack).on(CARRYING),
            ],
        )
        .group(
            "Codes",
            [
                bind("d", "delete", Act::Delete)
                    .on(CODES)
                    .when(REVOKED)
                    .rank(2),
                bind("d", "delete", Act::Delete)
                    .on(CODES)
                    .note("a live code says why it stays")
                    .quiet(),
            ],
        )
        .group(
            "Projects",
            [
                bind("enter", "choose or drop", Act::List).on(PROJECTS),
                bind("up down", "move", Act::List).on(PROJECTS).shown("↑↓"),
                bind("esc", "close", Act::List).on(PROJECTS),
            ],
        )
}

pub fn action(now: Now, key: &KeyEvent) -> Option<(Act, Chord)> {
    let chord = Chord::from_crossterm(key)?;
    KEYS.action(now, chord).map(|act| (*act, chord))
}

pub fn back(chord: Chord) -> bool {
    matches!(
        chord.key,
        Key::Up | Key::Left | Key::Char('k') | Key::Char('h')
    )
}

pub struct Seat {
    pub mode: Mode,
    pub when: Vec<When>,
}

impl Seat {
    pub fn new(mode: Mode) -> Seat {
        Seat {
            mode,
            when: Vec::new(),
        }
    }

    pub fn with(mut self, when: When, holds: bool) -> Seat {
        if holds {
            self.when.push(when);
        }
        self
    }

    pub fn now(&self) -> Now<'_> {
        Now::new(self.mode).when(&self.when)
    }
}

#[cfg(test)]
mod tests;

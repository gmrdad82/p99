use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use pito_tui::Cx;
use pito_tui::footer::Hint;

use crate::card::ProjectList;

use super::Msg;
use super::deck::unrouted;
use super::inbox::Inbox;
use super::source::{Source, fold};

pub const ALL: &str = "All projects";
pub const NONE_YET: &str =
    "No projects yet: p99 card new --project <name> --title <text> files a card.";

pub trait Narrow {
    fn narrow(&mut self, projects: &[String], cx: &mut Cx<'_, Msg>);

    fn filtered(&self) -> bool {
        false
    }

    fn picking(&self) -> bool {
        false
    }

    fn touched(&mut self, cx: &mut Cx<'_, Msg>);
}

impl Narrow for Inbox {
    fn narrow(&mut self, projects: &[String], _cx: &mut Cx<'_, Msg>) {
        self.projects(projects);
    }

    fn filtered(&self) -> bool {
        self.filtering()
    }

    fn picking(&self) -> bool {
        self.choosing()
    }

    fn touched(&mut self, cx: &mut Cx<'_, Msg>) {
        self.refresh(cx);
    }
}

#[derive(Default)]
pub struct State {
    pub chosen: Vec<String>,
    pub known: Vec<String>,
    pub label: String,
    pub turn: u64,
    pub due: Option<Instant>,
    pub asking: bool,
    pub counted: bool,
    pub waiting: Rc<Cell<u64>>,
}

#[derive(Clone, Default)]
pub struct Shared(pub Rc<RefCell<State>>);

impl Shared {
    pub fn new(waiting: Rc<Cell<u64>>) -> Shared {
        Shared(Rc::new(RefCell::new(State {
            waiting,
            ..State::default()
        })))
    }

    pub fn chosen(&self) -> Vec<String> {
        self.0.borrow().chosen.clone()
    }

    pub fn turn(&self) -> u64 {
        self.0.borrow().turn
    }

    pub fn choose(&self, chosen: Vec<String>) {
        let mut state = self.0.borrow_mut();
        state.label = chosen.join(", ");
        state.chosen = chosen;
        state.turn += 1;
    }

    pub fn toggle(&self, name: &str) {
        let mut chosen = self.chosen();
        toggle(&mut chosen, name);
        self.choose(chosen);
    }
}

pub fn rows(known: &[String], chosen: &[String]) -> Vec<String> {
    let mut rows = Vec::with_capacity(known.len() + 1);
    rows.push(ALL.to_owned());
    for name in known {
        let mark = if has(chosen, name) { "✓" } else { " " };
        rows.push(format!("{mark} {name}"));
    }
    rows
}

pub fn has(chosen: &[String], name: &str) -> bool {
    let name = fold(name);
    chosen.iter().any(|c| fold(c) == name)
}

pub fn toggle(chosen: &mut Vec<String>, name: &str) {
    let folded = fold(name);
    let before = chosen.len();
    chosen.retain(|c| fold(c) != folded);
    if chosen.len() == before {
        chosen.push(name.to_owned());
    }
}

pub fn merge(lists: impl IntoIterator<Item = Vec<String>>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for name in lists.into_iter().flatten() {
        if !has(&names, &name) {
            names.push(name);
        }
    }
    names.sort_by_key(|n| fold(n));
    names
}

pub fn hints() -> [Hint<'static>; 3] {
    [
        Hint::new("enter", "choose or drop"),
        Hint::new("↑↓", "move"),
        Hint::new("esc", "close"),
    ]
}

impl Source {
    pub fn projects(&self) -> Result<Vec<String>, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.projects())),
            Source::Live(_) => {
                let (mut lists, mut failed, mut answered) = (Vec::new(), None, false);
                for (space, name) in self.spaces().iter().enumerate() {
                    let answer = self
                        .client(space, None)
                        .and_then(|client| client.json::<ProjectList>("GET", "/v1/projects", None));
                    match answer {
                        Ok(list) => {
                            answered = true;
                            lists.push(list.projects.into_iter().map(|p| p.name).collect());
                        }
                        Err(error) if unrouted(&error) => {}
                        Err(error) => {
                            failed.get_or_insert(format!("{name}: {error}"));
                        }
                    }
                }
                match failed {
                    Some(error) if !answered => Err(error),
                    _ => Ok(merge(lists)),
                }
            }
            Source::Broken(why) => Err(why.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn the_rows_start_with_all_projects_and_tick_the_chosen_ones_in_any_case() {
        let known = names(&["Mobile app", "Storefront"]);
        assert_eq!(
            rows(&known, &names(&["storefront"])),
            ["All projects", "  Mobile app", "✓ Storefront"]
        );
        assert_eq!(rows(&[], &[]), ["All projects"]);
    }

    #[test]
    fn toggling_adds_a_name_once_and_takes_it_off_whatever_its_case() {
        let mut chosen = Vec::new();
        toggle(&mut chosen, "Splicer");
        toggle(&mut chosen, "Paper");
        assert_eq!(chosen, ["Splicer", "Paper"]);
        toggle(&mut chosen, "SPLICER");
        assert_eq!(chosen, ["Paper"]);
        toggle(&mut chosen, "paper");
        assert!(chosen.is_empty());
    }

    #[test]
    fn names_from_several_spaces_merge_once_keeping_the_first_spelling() {
        let merged = merge([
            names(&["Splicer", "paper"]),
            names(&["Paper", "Dispatch"]),
            Vec::new(),
        ]);
        assert_eq!(merged, ["Dispatch", "paper", "Splicer"]);
    }

    #[test]
    fn choosing_moves_the_turn_and_sets_the_header_label() {
        let shared = Shared::new(Rc::new(Cell::new(0)));
        assert_eq!(shared.turn(), 0);
        shared.toggle("Storefront");
        shared.toggle("Mobile app");
        assert_eq!(shared.turn(), 2);
        assert_eq!(shared.0.borrow().label, "Storefront, Mobile app");
        shared.choose(Vec::new());
        assert_eq!(shared.0.borrow().label, "");
        assert_eq!(shared.turn(), 3);
    }

    #[test]
    fn the_sample_lists_its_projects_by_name() {
        let source = Source::demo(std::time::Duration::ZERO);
        assert_eq!(
            source.projects().expect("the sample has projects"),
            ["Mobile app", "Storefront"]
        );
        let broken = Source::Broken("no space yet".into());
        assert_eq!(broken.projects().err().as_deref(), Some("no space yet"));
    }
}

use std::cell::{Cell, RefCell};
use std::fmt::Write;
use std::rc::Rc;
use std::time::Instant;

use pito_tui::crossterm::event::KeyEvent;
use pito_tui::footer::Hint;
use pito_tui::list::{Cell as Text, Column, Key, Keys, List, Row, Step};
use pito_tui::ratatui::{
    Frame,
    layout::Rect,
    widgets::{Block, BorderType, Clear},
};
use pito_tui::{Cx, Palette, text};

use crate::card::ProjectList;

use super::Msg;
use super::deck::unrouted;
use super::inbox::Inbox;
use super::source::{Source, fold};

pub const ALL: &str = "All projects";
pub const NONE_YET: &str = "No projects yet: n files a card and names its project.";

pub const EVERY_SPACE: &str = "All spaces";

pub trait Narrow {
    fn narrow(&mut self, projects: &[String], cx: &mut Cx<'_, Msg>);

    fn rescope(&mut self);

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

    fn rescope(&mut self) {
        self.respace();
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
    pub names: Vec<String>,
    pub space: String,
    pub scope: Option<usize>,
    pub scoped: u64,
    pub named: bool,
    pub projects_of: Vec<(usize, String)>,
    pub total: u64,
}

impl State {
    fn recount(&mut self) {
        let count = if self.chosen.is_empty() {
            self.total
        } else {
            self.projects_of
                .iter()
                .filter(|(_, project)| has(&self.chosen, project))
                .count() as u64
        };
        self.waiting.set(count);
    }
}

pub fn space_label(names: &[String], scope: Option<usize>) -> String {
    match (scope, names) {
        (Some(at), names) => names.get(at).cloned().unwrap_or_default(),
        (None, [only]) => only.clone(),
        (None, []) => String::new(),
        (None, _) => EVERY_SPACE.to_owned(),
    }
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

    pub fn names(&self, names: Vec<String>, scope: Option<usize>) {
        let mut state = self.0.borrow_mut();
        state.space = space_label(&names, scope);
        state.names = names;
        state.scope = scope;
    }

    pub fn rescoped(&self, scope: Option<usize>) {
        let mut state = self.0.borrow_mut();
        state.scope = scope;
        state.space = space_label(&state.names, scope);
        state.chosen.clear();
        state.known.clear();
        state.label.clear();
        state.turn += 1;
        state.scoped += 1;
        state.counted = false;
        state.recount();
    }

    pub fn scoped(&self) -> u64 {
        self.0.borrow().scoped
    }

    pub fn space(&self) -> String {
        self.0.borrow().space.clone()
    }

    pub fn counted(&self, total: u64, projects_of: Vec<(usize, String)>) {
        let mut state = self.0.borrow_mut();
        state.counted = true;
        state.total = total;
        state.projects_of = projects_of;
        state.recount();
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
        state.recount();
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

const CANCEL: [Key; 2] = [Key::Esc, Key::Char('q')];
const GAP: usize = 2;
const NARROWEST: usize = 24;
const TITLE: &str = " Projects ";
const COLUMNS: [Column<'static>; 1] = [Column::new("", 4, 0).flex()];

pub struct Picker {
    list: List,
    widest: usize,
    above: String,
    below: String,
}

impl Picker {
    pub fn new(rows: Vec<String>, at: usize) -> Picker {
        let widest = rows
            .iter()
            .map(|row| text::cells(row) + GAP)
            .max()
            .unwrap_or(0);
        let mut list = List::new()
            .with_rows(rows.into_iter().map(|row| Row::new([Text::new(row)])))
            .keys(Keys::VIM);
        list.select(at);
        Picker {
            list,
            widest,
            above: String::new(),
            below: String::new(),
        }
    }

    pub fn key(&mut self, key: KeyEvent) -> Option<Option<usize>> {
        let key: Key = key.into();
        if CANCEL.contains(&key) {
            return Some(None);
        }
        match self.list.key(key) {
            Step::Open(at) => Some(Some(at)),
            _ => None,
        }
    }

    pub fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        let count = self.list.len();
        let room = usize::from(area.height);
        let spill = count + 2 > room;
        let more = if spill { more_width(count) } else { 0 };
        let wanted = (self.widest + 6)
            .max(text::cells(TITLE) + more + 4)
            .max(NARROWEST);
        let width = u16::try_from(wanted).unwrap_or(u16::MAX).min(area.width);
        let height = u16::try_from(count + 2)
            .unwrap_or(u16::MAX)
            .min(area.height);
        let place = Rect::new(
            area.x + (area.width - width) / 2,
            area.y + (area.height - height) / 3,
            width,
            height,
        );
        frame.render_widget(Clear, place);
        let block = Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(palette.rule)
            .style(palette.base);
        let inner = block.inner(place);
        frame.render_widget(block, place);
        let room = usize::from(place.width.saturating_sub(2));
        frame
            .buffer_mut()
            .set_stringn(place.x + 1, place.y, TITLE, room, palette.selected);
        let view = palette.view(&mut self.list, &COLUMNS).header(false);
        frame.render_widget(view, inner);
        self.above.clear();
        self.below.clear();
        if let Some((first, last, total)) = self.list.shown() {
            if first > 1 {
                let _ = write!(self.above, " ↑ {} more ", first - 1);
            }
            if total > last {
                let _ = write!(self.below, " ↓ {} more ", total - last);
            }
        }
        if place.height < 2 {
            return;
        }
        let title = u16::try_from(text::cells(TITLE)).unwrap_or(u16::MAX);
        let buf = frame.buffer_mut();
        for (mark, y, beside) in [
            (&self.above, place.y, title),
            (&self.below, place.bottom() - 1, 0),
        ] {
            let cells = u16::try_from(text::cells(mark)).unwrap_or(u16::MAX);
            if mark.is_empty() || cells.saturating_add(beside + 3) > place.width {
                continue;
            }
            let x = place.right() - 2 - cells;
            buf.set_string(x, y, mark, palette.muted);
        }
    }
}

fn more_width(count: usize) -> usize {
    text::cells(" ↑  more ")
        + count
            .checked_ilog10()
            .map_or(1, |digits| digits as usize + 1)
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
                let names = self.spaces();
                for space in self.scoped() {
                    let name = names.get(space).map_or("", String::as_str);
                    let answer = self
                        .client(space, None)
                        .and_then(|client| match client.space() {
                            Ok(view) => Ok(view.projects.into_iter().map(|p| p.name).collect()),
                            Err(error) if error.ends_with("(404)") => client
                                .json::<ProjectList>("GET", "/v1/projects", None)
                                .map(|list| list.projects.into_iter().map(|p| p.name).collect()),
                            Err(error) => Err(error),
                        });
                    match answer {
                        Ok(names) => {
                            answered = true;
                            lists.push(names);
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

    fn press(code: pito_tui::crossterm::event::KeyCode) -> KeyEvent {
        KeyEvent::new(code, pito_tui::crossterm::event::KeyModifiers::NONE)
    }

    #[test]
    fn the_picker_picks_with_enter_cancels_with_esc_or_q_and_holds_every_other_key() {
        use pito_tui::crossterm::event::KeyCode;
        let rows = rows(&names(&["Mobile app", "Storefront"]), &[]);
        let mut picker = Picker::new(rows.clone(), 0);
        for code in [KeyCode::Char('2'), KeyCode::Tab, KeyCode::Char('w')] {
            assert_eq!(picker.key(press(code)), None);
        }
        assert_eq!(picker.key(press(KeyCode::End)), None);
        assert_eq!(picker.key(press(KeyCode::Enter)), Some(Some(2)));
        let mut picker = Picker::new(rows.clone(), 1);
        assert_eq!(picker.key(press(KeyCode::Enter)), Some(Some(1)));
        for code in [KeyCode::Esc, KeyCode::Char('q')] {
            assert_eq!(Picker::new(rows.clone(), 0).key(press(code)), Some(None));
        }
    }

    fn drawn(picker: &mut Picker, width: u16, height: u16) -> Vec<String> {
        use pito_tui::ratatui::{Terminal, backend::TestBackend};
        let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("a test terminal");
        let palette = Palette::new(pito_tui::ratatui::style::Color::Blue);
        terminal
            .draw(|frame| picker.draw(frame, frame.area(), &palette))
            .expect("the picker draws");
        let text = pito_tui::dump::text(terminal.backend().buffer());
        let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
        lines.resize(usize::from(height), String::new());
        lines
    }

    fn forty() -> Vec<String> {
        let known: Vec<String> = (1..=40).map(|n| format!("Project {n:02}")).collect();
        rows(&known, &[])
    }

    #[test]
    fn forty_projects_draw_in_the_area_with_what_is_hidden_above_and_below_named_on_the_border() {
        for (width, height, shown) in [(120, 26, 24), (80, 16, 14)] {
            let mut picker = Picker::new(forty(), 0);
            let lines = drawn(&mut picker, width, height);
            let top = lines
                .iter()
                .position(|l| l.contains("╭ Projects"))
                .expect("a top border");
            assert!(lines[top].contains('╮'), "{lines:#?}");
            assert!(!lines[top].contains('↑'), "{lines:#?}");
            let bottom = top + shown + 1;
            assert!(
                lines[bottom].contains(&format!("↓ {} more", 41 - shown)),
                "{lines:#?}"
            );
            assert!(lines[bottom].contains('╰'), "{lines:#?}");
            assert_eq!(
                picker.key(press(pito_tui::crossterm::event::KeyCode::End)),
                None
            );
            let lines = drawn(&mut picker, width, height);
            assert!(
                lines[top].contains(&format!("↑ {} more", 41 - shown)),
                "{lines:#?}"
            );
            assert!(lines[top + shown].contains("Project 40"), "{lines:#?}");
            assert!(!lines[bottom].contains('↓'), "{lines:#?}");
        }
    }

    #[test]
    fn a_picker_never_draws_wider_or_taller_than_its_area_and_drops_a_mark_with_no_room() {
        let mut picker = Picker::new(forty(), 0);
        let lines = drawn(&mut picker, 20, 6);
        assert!(
            lines[0].starts_with('╭') && lines[5].starts_with('╰'),
            "{lines:#?}"
        );
        assert!(lines.iter().all(|l| l.chars().count() <= 20), "{lines:#?}");
        assert!(!lines[0].contains('↑'), "{lines:#?}");
        let mut few = Picker::new(rows(&names(&["Mobile app", "Storefront"]), &[]), 0);
        let lines = drawn(&mut few, 60, 20);
        assert!(lines.iter().all(|l| !l.contains(" more")), "{lines:#?}");
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

    fn waits() -> Vec<(usize, String)> {
        ["Storefront", "storefront", "Mobile app"]
            .iter()
            .map(|p| (0, (*p).to_owned()))
            .collect()
    }

    #[test]
    fn the_waiting_count_narrows_to_the_projects_chosen_in_any_case_and_widens_again() {
        let counter = Rc::new(Cell::new(0));
        let shared = Shared::new(Rc::clone(&counter));
        shared.counted(3, waits());
        assert_eq!(counter.get(), 3);
        shared.toggle("MOBILE APP");
        assert_eq!(counter.get(), 1);
        shared.toggle("Storefront");
        assert_eq!(counter.get(), 3);
        shared.toggle("mobile app");
        assert_eq!(counter.get(), 2);
        shared.choose(Vec::new());
        assert_eq!(counter.get(), 3);
    }

    #[test]
    fn a_count_the_worker_gives_above_the_cards_it_listed_shows_whole_until_a_project_is_chosen() {
        let counter = Rc::new(Cell::new(0));
        let shared = Shared::new(Rc::clone(&counter));
        shared.counted(9, waits());
        assert_eq!(counter.get(), 9);
        shared.toggle("Mobile app");
        assert_eq!(counter.get(), 1);
        shared.toggle("Nowhere");
        assert_eq!(counter.get(), 1);
        shared.choose(Vec::new());
        assert_eq!(counter.get(), 9);
    }

    #[test]
    fn a_space_is_labelled_by_its_name_or_all_spaces_or_nothing() {
        assert_eq!(space_label(&[], None), "");
        assert_eq!(space_label(&names(&["PITO MD"]), None), "PITO MD");
        assert_eq!(
            space_label(&names(&["PITO MD", "Fepra"]), None),
            "All spaces"
        );
        assert_eq!(space_label(&names(&["PITO MD", "Fepra"]), Some(1)), "Fepra");
        assert_eq!(space_label(&names(&["PITO MD"]), Some(4)), "");
    }

    #[test]
    fn switching_space_forgets_the_projects_and_bumps_both_turns_and_widens_the_count() {
        let counter = Rc::new(Cell::new(0));
        let shared = Shared::new(Rc::clone(&counter));
        shared.names(vec!["PITO MD".into(), "Fepra".into()], None);
        assert_eq!(shared.space(), "All spaces");
        shared.counted(3, waits());
        shared.toggle("Mobile app");
        shared.0.borrow_mut().known = vec!["Mobile app".into()];
        let (turn, scoped) = (shared.turn(), shared.scoped());
        assert_eq!(counter.get(), 1);
        shared.rescoped(Some(1));
        assert_eq!(shared.space(), "Fepra");
        assert!(shared.chosen().is_empty());
        assert!(shared.0.borrow().known.is_empty());
        assert_eq!(shared.0.borrow().label, "");
        assert_eq!(shared.turn(), turn + 1);
        assert_eq!(shared.scoped(), scoped + 1);
        assert!(!shared.0.borrow().counted);
        assert_eq!(counter.get(), 3);
        shared.names(vec!["PITO MD".into(), "Fepra Ltd".into()], Some(1));
        assert_eq!(shared.space(), "Fepra Ltd");
    }
}

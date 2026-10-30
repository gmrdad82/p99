use std::time::{Duration, Instant};

use pito_tui::crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use pito_tui::footer::{Hint, InputBar, Notice, Tone};
use pito_tui::layer::Event as Layered;
use pito_tui::ratatui::{Frame, layout::Rect, style::Style};
use pito_tui::{Cx, Field, Job, Modal, Palette, Phase, Pick, Screen, Span, Tone as Shade};

use crate::card::Card;
use crate::wire::{KINDS, kind_word};

use super::Msg;
use super::compose::{Draft, Filed, Place, unflat};
use super::deck::{asked_behind, older, unrouted, wanted};
use super::files::paths;
use super::inbox::Inbox;
use super::projects::{self, NONE_YET, Narrow, Picker, Shared, has};
use super::source::Source;

pub const QUIET: Duration = Duration::from_millis(250);
pub const NOTHING: &str = "Nothing needs you.";

pub type Waiting = (u64, Vec<(usize, Card)>);

pub const NEW_CARD: u64 = 0x99c4;
pub const NEW_PROJECT: &str = "A new project…";

enum Picking {
    Waiting(Vec<(usize, String)>),
    Place(Vec<Place>),
    Kind(Option<Place>),
}

struct Form {
    place: Option<Place>,
    kind: &'static str,
    filing: bool,
}

pub struct Around<S> {
    pub inner: S,
    shared: Shared,
    source: Source,
    reader: Inbox,
    picking: Option<Picking>,
    chooser: Option<Picker>,
    turn: u64,
    scope: u64,
    now: Instant,
    palette: Palette,
    form: Option<Form>,
}

impl<S: Screen<Msg> + Narrow> Around<S> {
    pub fn new(inner: S, source: Source, palette: Palette, shared: Shared) -> Around<S> {
        Around {
            inner,
            reader: Inbox::new(source.clone(), palette),
            turn: shared.turn(),
            scope: shared.scoped(),
            shared,
            source,
            picking: None,
            chooser: None,
            now: Instant::now(),
            palette,
            form: None,
        }
    }

    fn offer_places(&mut self, places: Vec<Place>, cx: &mut Cx<'_, Msg>) {
        let many = self.source.scoped().len() > 1;
        let names = self.shared.0.borrow().names.clone();
        let chosen = self.shared.chosen();
        let at = places
            .iter()
            .position(|place| place.host.is_none() && has(&chosen, &place.project))
            .unwrap_or(0);
        let mut rows: Vec<String> = places
            .iter()
            .map(|place| match names.get(place.space).filter(|_| many) {
                Some(space) => format!("{} ({space})", place.named()),
                None => place.named(),
            })
            .collect();
        rows.push(NEW_PROJECT.to_owned());
        self.picking = Some(Picking::Place(places));
        cx.pick(
            Pick::new("New card in", rows)
                .selected(at)
                .hints(pick_hints()),
        );
    }

    fn offer_kinds(&mut self, place: Option<Place>, cx: &mut Cx<'_, Msg>) {
        let rows: Vec<String> = KINDS
            .iter()
            .map(|kind| kind_word(kind).to_owned())
            .collect();
        self.picking = Some(Picking::Kind(place));
        cx.pick(Pick::new("Kind", rows).hints(pick_hints()));
    }

    fn open_form(&mut self, place: Option<Place>, kind: &'static str, cx: &mut Cx<'_, Msg>) {
        let title = match &place {
            Some(place) => format!("New {} in {}", kind_word(kind), place.named()),
            None => format!("New {} in a new project", kind_word(kind)),
        };
        let mut modal = Modal::new(NEW_CARD, title).width(76);
        if place.is_none() {
            modal = modal.field(Field::new("Project").placeholder("its name"));
        }
        modal = modal
            .field(Field::new("Title").placeholder("one line that says what it is about"))
            .field(Field::new("Details").placeholder("optional; ¶ starts a new line"))
            .field(Field::new("Files").placeholder("optional paths, split by spaces"))
            .hints([
                Hint::new("tab", "next field"),
                Hint::new("enter", "file it"),
                Hint::new("esc", "cancel"),
            ]);
        self.form = Some(Form {
            place,
            kind,
            filing: false,
        });
        cx.open(modal);
    }

    fn submit(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(form) = &mut self.form else { return };
        if form.filing {
            return;
        }
        let space = self.source.scoped().first().copied().unwrap_or(0);
        let Some(modal) = cx.modal(NEW_CARD) else {
            return;
        };
        let value = |part: usize| modal.value(part).unwrap_or_default().to_owned();
        let at = usize::from(form.place.is_none());
        let place = match &form.place {
            Some(place) => Some(place.clone()),
            None => Some(value(0).trim().to_owned())
                .filter(|name| !name.is_empty())
                .map(|project| Place {
                    space,
                    project,
                    host: None,
                }),
        };
        let (title, details, typed) = (value(at).trim().to_owned(), value(at + 1), value(at + 2));
        let draft = match (place, title.is_empty(), paths(&typed)) {
            (None, ..) => Err("Name the project first.".to_owned()),
            (_, true, _) => Err("A card needs a title.".to_owned()),
            (_, _, Err(why)) => Err(why),
            (Some(place), false, Ok(files)) => Ok(Draft {
                place,
                kind: form.kind.to_owned(),
                title,
                body: unflat(&details),
                files,
            }),
        };
        let draft = match draft {
            Ok(draft) => draft,
            Err(why) => {
                modal.set_status(Some((why.into(), Shade::Bad)));
                return;
            }
        };
        modal.set_status(Some(("Filing…".into(), Shade::Muted)));
        form.filing = true;
        let source = self.source.clone();
        cx.detach(move || Msg::Filed(source.file_card(&draft)));
    }

    fn filed(&mut self, result: Result<Filed, String>, cx: &mut Cx<'_, Msg>) {
        match result {
            Ok(filed) => {
                cx.close(NEW_CARD);
                self.form = None;
                let mut said = format!("{} filed in {}", filed.key, filed.project);
                if let Some(host) = &filed.host {
                    said.push_str(&format!(" on {host}"));
                }
                match (&filed.trouble, filed.files) {
                    (Some(why), _) => {
                        said.push_str(&format!(", but {why}"));
                        cx.say(said, Tone::Alert);
                    }
                    (None, 0) => cx.say(said, Tone::Good),
                    (None, 1) => cx.say(format!("{said} with 1 file"), Tone::Good),
                    (None, n) => cx.say(format!("{said} with {n} files"), Tone::Good),
                }
                self.reader.open_key(filed.space, None, filed.key, cx);
                self.inner.touched(cx);
            }
            Err(why) => {
                let open = self.form.as_mut().filter(|form| form.filing);
                match (open, cx.modal(NEW_CARD)) {
                    (Some(form), Some(modal)) => {
                        form.filing = false;
                        modal.set_status(Some((why.into(), Shade::Bad)));
                    }
                    _ => cx.say(why, Tone::Alert),
                }
            }
        }
    }

    fn switch(&mut self, cx: &mut Cx<'_, Msg>) {
        let scope = self.source.rescope();
        self.shared.rescoped(scope);
        self.settle(cx);
    }

    fn settle(&mut self, cx: &mut Cx<'_, Msg>) {
        self.turn = self.shared.turn();
        self.scope = self.shared.scoped();
        self.inner.rescope();
        cx.reload();
        if !self.shared.0.borrow().counted {
            self.ask(false, cx);
        }
        self.name(cx);
    }

    fn name(&mut self, cx: &mut Cx<'_, Msg>) {
        let name = {
            let mut state = self.shared.0.borrow_mut();
            !std::mem::replace(&mut state.named, true) && !self.source.is_demo()
        };
        if name {
            let source = self.source.clone();
            cx.detach(move || {
                let (names, whole) = source.lookup();
                Msg::Spaces(names, whole)
            });
        }
    }

    fn reading(&self) -> bool {
        self.reader.crumb().is_some()
    }

    fn free(&self) -> bool {
        !self.reading()
            && self.picking.is_none()
            && self.chooser.is_none()
            && !self.inner.picking()
            && !self.inner.typing()
            && self.inner.crumb().is_none()
    }

    fn clears_projects(&self) -> bool {
        !self.inner.filtered() && !self.shared.chosen().is_empty()
    }

    fn ask(&mut self, open: bool, cx: &mut Cx<'_, Msg>) {
        {
            let mut state = self.shared.0.borrow_mut();
            if state.asking && !open {
                return;
            }
            state.asking = true;
            state.due = None;
        }
        let (source, scoped) = (self.source.clone(), self.shared.scoped());
        cx.detach(move || Msg::Waiting(open, scoped, source.waiting()));
    }

    fn soon(&mut self, after: Duration) {
        let due = self.now + after;
        let mut state = self.shared.0.borrow_mut();
        state.due = Some(state.due.map_or(due, |at| at.min(due)));
    }

    fn watch(&mut self, event: &Msg) {
        match event {
            Msg::Heard(_, text) => {
                if counts(text) {
                    self.soon(QUIET);
                }
            }
            Msg::Board(_, Ok(_)) | Msg::Shifted(_, Ok(_)) | Msg::Changed(_, Ok(_)) => {
                self.soon(Duration::ZERO);
            }
            Msg::Commented(_, Ok(_)) | Msg::Deleted(_, Ok(_)) => self.soon(Duration::ZERO),
            _ => {}
        }
    }

    fn apply(&mut self, cx: &mut Cx<'_, Msg>) {
        self.turn = self.shared.turn();
        let chosen = self.shared.chosen();
        self.inner.narrow(&chosen, cx);
    }

    fn offer_projects(&mut self, at: usize, cx: &mut Cx<'_, Msg>) {
        let (known, chosen) = {
            let state = self.shared.0.borrow();
            (state.known.clone(), state.chosen.clone())
        };
        if known.is_empty() {
            cx.say(NONE_YET, Tone::Muted);
            return;
        }
        self.chooser = Some(Picker::new(projects::rows(&known, &chosen), at));
    }

    fn chose_project(&mut self, choice: Option<usize>, cx: &mut Cx<'_, Msg>) {
        match choice {
            Some(0) => {
                self.shared.choose(Vec::new());
                self.apply(cx);
            }
            Some(at) => {
                let name = self.shared.0.borrow().known.get(at - 1).cloned();
                if let Some(name) = name {
                    self.shared.toggle(&name);
                    self.apply(cx);
                }
            }
            None => {}
        }
    }

    fn offer_waiting(&mut self, cards: Vec<(usize, Card)>, cx: &mut Cx<'_, Msg>) {
        let chosen = self.shared.chosen();
        let shown: Vec<&(usize, Card)> = cards
            .iter()
            .filter(|(_, card)| wanted(Some(&card.project), &chosen))
            .collect();
        if shown.is_empty() {
            let said = if chosen.is_empty() {
                NOTHING.to_owned()
            } else {
                format!("Nothing needs you in {}.", self.shared.0.borrow().label)
            };
            cx.say(said, Tone::Muted);
            return;
        }
        let rows = shown.iter().map(|(_, card)| line(card)).collect::<Vec<_>>();
        self.picking = Some(Picking::Waiting(
            shown
                .iter()
                .map(|(space, card)| (*space, card.key.clone()))
                .collect(),
        ));
        cx.pick(
            Pick::new(format!("Needs you · {}", shown.len()), rows).hints([
                Hint::new("↑↓", "move"),
                Hint::new("enter", "open"),
                Hint::new("esc", "close"),
            ]),
        );
    }

    fn got(
        &mut self,
        open: bool,
        scoped: u64,
        result: Result<Waiting, String>,
        cx: &mut Cx<'_, Msg>,
    ) {
        let counted = {
            let mut state = self.shared.0.borrow_mut();
            state.asking = false;
            state.counted
        };
        if scoped != self.shared.scoped() {
            if !counted {
                self.ask(open, cx);
            }
            return;
        }
        tally(&self.shared, scoped, &result);
        match result {
            _ if !open || !self.free() => {}
            Ok((_, cards)) => self.offer_waiting(cards, cx),
            Err(error) => cx.say(error, Tone::Alert),
        }
    }
}

pub fn tally(shared: &Shared, scoped: u64, result: &Result<Waiting, String>) {
    if scoped != shared.scoped() {
        return;
    }
    if let Ok((count, cards)) = result {
        let projects = cards
            .iter()
            .map(|(space, card)| (*space, card.project.clone()))
            .collect();
        shared.counted(*count, projects);
    }
}

pub fn counts(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|event| {
        matches!(
            event["type"].as_str(),
            Some("label" | "change" | "comment" | "delete" | "item" | "import" | "project")
        )
    })
}

fn settled(event: &Msg) -> bool {
    matches!(
        event,
        Msg::Commented(_, Ok(_)) | Msg::Changed(_, Ok(_)) | Msg::Deleted(_, Ok(_))
    )
}

pub fn line(card: &Card) -> String {
    format!(
        "{}  {}  {}  {}",
        card.key, card.label, card.project, card.title
    )
}

fn pick_hints() -> [Hint<'static>; 3] {
    [
        Hint::new("↑↓", "move"),
        Hint::new("enter", "choose"),
        Hint::new("esc", "cancel"),
    ]
}

impl Source {
    pub fn waiting(&self) -> Result<Waiting, String> {
        let (mut count, mut cards) = match self {
            Source::Demo(..) => {
                let (count, cards) = self.sample(|demo| Ok(demo.waiting()))?;
                (count, cards.into_iter().map(|card| (0, card)).collect())
            }
            Source::Live(_) => {
                let (mut count, mut cards, mut answered) = (0, Vec::new(), false);
                let (mut failed, mut behind) = (None, None);
                let names = self.spaces();
                for space in self.scoped() {
                    let name = names.get(space).map_or("", String::as_str);
                    let client = match self.client(space, None) {
                        Ok(client) => client,
                        Err(error) => {
                            failed.get_or_insert(format!("{name}: {error}"));
                            continue;
                        }
                    };
                    match client.waiting() {
                        Ok(list) => {
                            answered = true;
                            count += list.count;
                            cards.extend(list.cards.into_iter().map(|card| (space, card)));
                        }
                        Err(error) if unrouted(&error) || older(&error) => {
                            behind.get_or_insert(space);
                        }
                        Err(error) => {
                            failed.get_or_insert(format!("{name}: {error}"));
                        }
                    }
                }
                if !answered {
                    if let Some(error) = failed {
                        return Err(error);
                    }
                    if let Some(space) = behind {
                        let client = self.client(space, None)?;
                        return Err(asked_behind(&client, &names[space]));
                    }
                }
                (count, cards)
            }
            Source::Broken(why) => return Err(why.clone()),
        };
        cards.sort_by(|(_, a), (_, b)| b.changed_at.cmp(&a.changed_at));
        count = count.max(cards.len() as u64);
        Ok((count, cards))
    }
}

impl<S: Screen<Msg> + Narrow> Screen<Msg> for Around<S> {
    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if self.reading() {
            self.reader.draw(frame, area, palette);
        } else {
            self.inner.draw(frame, area, palette);
        }
        if let Some(chooser) = self.chooser.as_mut() {
            chooser.draw(frame, area, palette);
        }
    }

    fn moment(&mut self, now: Instant) {
        self.now = self.now.max(now);
        self.inner.moment(now);
    }

    fn phase(&self) -> Phase<'_> {
        if self.reading() {
            Phase::Ready
        } else {
            self.inner.phase()
        }
    }

    fn load(&mut self) -> Option<Job<Msg>> {
        self.inner.load()
    }

    fn loaded(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        self.watch(&event);
        self.inner.loaded(event, cx);
    }

    fn cancel(&mut self) {
        self.inner.cancel();
    }

    fn start(&mut self, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        self.inner.start(cx);
        if !self.shared.0.borrow().counted {
            self.ask(false, cx);
        }
        self.name(cx);
    }

    fn entered(&mut self, cx: &mut Cx<'_, Msg>) {
        if self.scope != self.shared.scoped() {
            self.settle(cx);
        } else if self.turn != self.shared.turn() {
            self.apply(cx);
        }
        self.inner.entered(cx);
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        if let Some(chooser) = self.chooser.as_mut() {
            if let Some(choice) = chooser.key(key) {
                self.chooser = None;
                self.chose_project(choice, cx);
            }
            return;
        }
        if self.reading() {
            self.reader.key(key, cx);
            return;
        }
        if self.free() {
            match key.code {
                KeyCode::Char('w') => {
                    self.ask(true, cx);
                    return;
                }
                KeyCode::Char('n') => {
                    let source = self.source.clone();
                    cx.detach(move || Msg::Places(source.places()));
                    return;
                }
                KeyCode::Char('S') if self.source.spaces().len() > 1 => {
                    self.switch(cx);
                    return;
                }
                KeyCode::Char('p') => {
                    let source = self.source.clone();
                    cx.detach(move || Msg::Projects(source.projects()));
                    return;
                }
                KeyCode::Esc if self.clears_projects() => {
                    self.shared.choose(Vec::new());
                    self.apply(cx);
                    return;
                }
                _ => {}
            }
        }
        self.inner.key(key, cx);
    }

    fn paste(&mut self, text: &str, cx: &mut Cx<'_, Msg>) {
        if self.chooser.is_some() {
            return;
        }
        if self.reading() {
            self.reader.paste(text, cx);
        } else {
            self.inner.paste(text, cx);
        }
    }

    fn mouse(&mut self, mouse: MouseEvent, area: Rect, cx: &mut Cx<'_, Msg>) {
        if !self.reading() && self.chooser.is_none() {
            self.inner.mouse(mouse, area, cx);
        }
    }

    fn event(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        self.watch(&event);
        match event {
            Msg::Waiting(open, scoped, result) => self.got(open, scoped, result, cx),
            Msg::Places(Ok(places)) if self.free() => self.offer_places(places, cx),
            Msg::Places(Err(error)) if self.free() => cx.say(error, Tone::Alert),
            Msg::Places(_) => {}
            Msg::Filed(result) => self.filed(result, cx),
            Msg::Spaces(names, whole) => {
                self.shared.names(names, self.source.scope());
                if !whole {
                    self.shared.0.borrow_mut().named = false;
                }
            }
            Msg::Projects(Ok(names)) => {
                self.shared.0.borrow_mut().known = names;
                if self.free() {
                    self.offer_projects(0, cx);
                }
            }
            Msg::Projects(Err(error)) if self.free() => cx.say(error, Tone::Alert),
            Msg::Projects(Err(_)) => {}
            Msg::Heard(space, text) if self.reading() => {
                self.reader.event(Msg::Heard(space, text.clone()), cx);
                self.inner.event(Msg::Heard(space, text), cx);
            }
            Msg::Pushed(space, key) if self.reading() => {
                self.reader.event(Msg::Pushed(space, key.clone()), cx);
                self.inner.event(Msg::Pushed(space, key), cx);
            }
            event if self.reading() && settled(&event) => {
                self.reader.event(event, cx);
                self.inner.touched(cx);
            }
            event @ (Msg::Thread(..)
            | Msg::Commented(..)
            | Msg::Changed(..)
            | Msg::Deleted(..)
            | Msg::Labels(_)
            | Msg::Saved(_))
                if self.reading() =>
            {
                self.reader.event(event, cx);
            }
            event => self.inner.event(event, cx),
        }
    }

    fn picked(&mut self, choice: Option<usize>, cx: &mut Cx<'_, Msg>) {
        match (self.picking.take(), choice) {
            (Some(Picking::Waiting(rows)), Some(at)) => {
                if let Some((space, key)) = rows.into_iter().nth(at) {
                    self.reader.open_key(space, None, key, cx);
                }
            }
            (Some(Picking::Place(places)), Some(at)) => {
                let place = places.get(at).cloned();
                self.offer_kinds(place, cx);
            }
            (Some(Picking::Kind(place)), Some(at)) => {
                if let Some(kind) = KINDS.get(at) {
                    self.open_form(place, kind, cx);
                }
            }
            (Some(_), None) => {}
            (None, choice) if self.reading() => self.reader.picked(choice, cx),
            (None, choice) => self.inner.picked(choice, cx),
        }
    }

    fn back(&mut self, cx: &mut Cx<'_, Msg>) {
        if self.reading() {
            self.reader.back(cx);
        } else {
            self.inner.back(cx);
        }
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if self.chooser.is_some() {
            return projects::hints().to_vec();
        }
        if self.reading() {
            return self.reader.hints();
        }
        let mut hints = self.inner.hints();
        if self.free() && self.inner.phase() == Phase::Ready && !self.inner.typing() {
            if self.source.spaces().len() > 1 {
                hints.push(Hint::new("S", "space").rank(2));
            }
            hints.push(Hint::new("n", "new card").rank(1));
            hints.push(Hint::new("p", "projects").rank(2));
            if self.clears_projects() {
                hints.push(Hint::new("esc", "all projects"));
            }
            hints.push(Hint::new("w", "needs you").rank(2));
        }
        hints
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let mut facts = self.inner.facts();
        let state = self.shared.0.borrow();
        if !state.label.is_empty() && !facts.is_empty() {
            let at = facts.len() - usize::from(self.source.is_demo());
            facts.insert(at, (format!("in {}", state.label), self.palette.accent));
        }
        facts
    }

    fn status(&self) -> Option<(String, Style)> {
        let space = self.shared.space();
        Some((space, self.palette.accent)).filter(|(space, _)| !space.is_empty())
    }

    fn badge(&self) -> &[Span] {
        self.inner.badge()
    }

    fn notice(&self) -> Option<Notice<'_>> {
        self.inner.notice()
    }

    fn legend(&self) -> Option<&str> {
        self.inner.legend()
    }

    fn typing(&self) -> bool {
        if self.chooser.is_some() {
            return true;
        }
        if self.reading() {
            self.reader.typing()
        } else {
            self.inner.typing()
        }
    }

    fn input(&self) -> Option<InputBar<'_>> {
        if self.reading() {
            self.reader.input()
        } else {
            self.inner.input()
        }
    }

    fn crumb(&self) -> Option<String> {
        self.reader.crumb().or_else(|| self.inner.crumb())
    }

    fn selected(&self) -> usize {
        self.inner.selected()
    }

    fn busy(&self) -> usize {
        self.inner.busy()
    }

    fn animating(&self) -> bool {
        self.inner.animating()
    }

    fn deadline(&self) -> Option<Instant> {
        let state = self.shared.0.borrow();
        let due = state.due.filter(|_| !state.asking);
        match (self.inner.deadline(), due) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    fn layer(&mut self, id: u64, event: Layered, cx: &mut Cx<'_, Msg>) {
        if id != NEW_CARD {
            self.inner.layer(id, event, cx);
            return;
        }
        match event {
            Layered::Submitted { .. } => self.submit(cx),
            Layered::Closed => self.form = None,
            _ => {}
        }
    }

    fn tick(&mut self, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        let due = self.shared.0.borrow().due;
        if due.is_some_and(|at| at <= self.now) {
            self.ask(false, cx);
        }
        self.inner.tick(cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_events_that_can_change_a_lane_ask_for_a_new_count() {
        for kind in [
            "label", "change", "comment", "delete", "item", "import", "project",
        ] {
            let event = format!(r#"{{"type":"{kind}","key":"BUG-1"}}"#);
            assert!(counts(&event), "{kind}");
        }
        for kind in ["order", "attachment", "github", "read"] {
            let event = format!(r#"{{"type":"{kind}","key":"BUG-1","label":"x"}}"#);
            assert!(!counts(&event), "{kind}");
        }
        assert!(!counts("not json"));
        assert!(!counts(r#"{"key":"BUG-1"}"#));
    }

    #[test]
    fn a_waiting_row_reads_key_lane_project_and_title() {
        let card: Card = serde_json::from_value(serde_json::json!({
            "key": "FEAT-41", "kind": "feature", "project": "Splicer", "status": "needs-you",
            "label": "Needs you", "lane": 1, "title": "Export keeps every audio track",
            "host": "example.com", "reporter": {"name": "Ada Lovelace", "username": "ada"},
            "created_at": "2026-10-22T08:00:00.000Z", "changed_at": "2026-10-22T09:00:00.000Z",
            "changed_by": null, "comments": 0
        }))
        .expect("a card");
        assert_eq!(
            line(&card),
            "FEAT-41  Needs you  Splicer  Export keeps every audio track"
        );
    }
}

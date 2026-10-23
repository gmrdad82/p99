use std::time::{Duration, Instant};

use pito_tui::crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use pito_tui::footer::{Hint, InputBar, Notice, Tone};
use pito_tui::ratatui::{Frame, layout::Rect, style::Style};
use pito_tui::{Cx, Job, Palette, Phase, Pick, Screen, Span};

use crate::card::Card;

use super::Msg;
use super::deck::{asked_behind, older, unrouted, wanted};
use super::inbox::Inbox;
use super::projects::{self, NONE_YET, Narrow, Shared};
use super::source::Source;

pub const QUIET: Duration = Duration::from_millis(250);
pub const NOTHING: &str = "Nothing needs you.";

pub type Waiting = (u64, Vec<(usize, Card)>);

enum Picking {
    Projects,
    Waiting(Vec<(usize, String)>),
}

pub struct Around<S> {
    pub inner: S,
    shared: Shared,
    source: Source,
    reader: Inbox,
    picking: Option<Picking>,
    turn: u64,
    now: Instant,
}

impl<S: Screen<Msg> + Narrow> Around<S> {
    pub fn new(inner: S, source: Source, palette: Palette, shared: Shared) -> Around<S> {
        Around {
            inner,
            reader: Inbox::new(source.clone(), palette),
            turn: shared.turn(),
            shared,
            source,
            picking: None,
            now: Instant::now(),
        }
    }

    fn reading(&self) -> bool {
        self.reader.crumb().is_some()
    }

    fn free(&self) -> bool {
        !self.reading()
            && self.picking.is_none()
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
        let source = self.source.clone();
        cx.detach(move || Msg::Waiting(open, source.waiting()));
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
        self.picking = Some(Picking::Projects);
        cx.pick(
            Pick::new("Projects", projects::rows(&known, &chosen))
                .selected(at)
                .hints(projects::hints()),
        );
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
                .map(|(account, card)| (*account, card.key.clone()))
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

    fn got(&mut self, open: bool, result: Result<Waiting, String>, cx: &mut Cx<'_, Msg>) {
        {
            let mut state = self.shared.0.borrow_mut();
            state.asking = false;
            if let Ok((count, _)) = &result {
                state.counted = true;
                state.waiting.set(*count);
            }
        }
        match result {
            _ if !open || !self.free() => {}
            Ok((_, cards)) => self.offer_waiting(cards, cx),
            Err(error) => cx.say(error, Tone::Alert),
        }
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
                let names = self.accounts();
                for (account, name) in names.iter().enumerate() {
                    let client = match self.client(account, None) {
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
                            cards.extend(list.cards.into_iter().map(|card| (account, card)));
                        }
                        Err(error) if unrouted(&error) || older(&error) => {
                            behind.get_or_insert(account);
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
                    if let Some(account) = behind {
                        let client = self.client(account, None)?;
                        return Err(asked_behind(&client, &names[account]));
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
    }

    fn entered(&mut self, cx: &mut Cx<'_, Msg>) {
        if self.turn != self.shared.turn() {
            self.apply(cx);
        }
        self.inner.entered(cx);
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
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
        if self.reading() {
            self.reader.paste(text, cx);
        } else {
            self.inner.paste(text, cx);
        }
    }

    fn mouse(&mut self, mouse: MouseEvent, area: Rect, cx: &mut Cx<'_, Msg>) {
        if !self.reading() {
            self.inner.mouse(mouse, area, cx);
        }
    }

    fn event(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.now = self.now.max(cx.now());
        self.watch(&event);
        match event {
            Msg::Waiting(open, result) => self.got(open, result, cx),
            Msg::Projects(Ok(names)) => {
                self.shared.0.borrow_mut().known = names;
                if self.free() {
                    self.offer_projects(0, cx);
                }
            }
            Msg::Projects(Err(error)) if self.free() => cx.say(error, Tone::Alert),
            Msg::Projects(Err(_)) => {}
            Msg::Heard(account, text) if self.reading() => {
                self.reader.event(Msg::Heard(account, text.clone()), cx);
                self.inner.event(Msg::Heard(account, text), cx);
            }
            Msg::Pushed(account, key) if self.reading() => {
                self.reader.event(Msg::Pushed(account, key.clone()), cx);
                self.inner.event(Msg::Pushed(account, key), cx);
            }
            event if self.reading() && settled(&event) => {
                self.reader.event(event, cx);
                self.inner.touched(cx);
            }
            event @ (Msg::Thread(..)
            | Msg::Commented(..)
            | Msg::Changed(..)
            | Msg::Deleted(..)
            | Msg::Labels(_))
                if self.reading() =>
            {
                self.reader.event(event, cx);
            }
            event => self.inner.event(event, cx),
        }
    }

    fn picked(&mut self, choice: Option<usize>, cx: &mut Cx<'_, Msg>) {
        match (self.picking.take(), choice) {
            (Some(Picking::Projects), Some(0)) => {
                self.shared.choose(Vec::new());
                self.apply(cx);
            }
            (Some(Picking::Projects), Some(at)) => {
                let name = self.shared.0.borrow().known.get(at - 1).cloned();
                if let Some(name) = name {
                    self.shared.toggle(&name);
                    self.apply(cx);
                }
            }
            (Some(Picking::Waiting(rows)), Some(at)) => {
                if let Some((account, key)) = rows.into_iter().nth(at) {
                    self.reader.open_key(account, None, key, cx);
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
        if self.reading() {
            return self.reader.hints();
        }
        let mut hints = self.inner.hints();
        if self.free() && self.inner.phase() == Phase::Ready && !self.inner.typing() {
            hints.push(Hint::new("p", "projects").rank(2));
            if self.clears_projects() {
                hints.push(Hint::new("esc", "all projects"));
            }
            hints.push(Hint::new("w", "needs you").rank(2));
        }
        hints
    }

    fn facts(&self) -> Vec<(String, Style)> {
        self.inner.facts()
    }

    fn status(&self) -> Option<(String, Style)> {
        let (mut text, style) = self.inner.status()?;
        let state = self.shared.0.borrow();
        if !state.label.is_empty() {
            text.push_str(" · ");
            text.push_str(&state.label);
        }
        Some((text, style))
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

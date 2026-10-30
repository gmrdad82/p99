use std::time::{Duration, Instant};

use pito_tui::clock::{self, Units};
use pito_tui::crossterm::event::KeyEvent;
use pito_tui::footer::{Edit, Input, InputBar, Tone};
use pito_tui::list::{Cell, Column, Row};
use pito_tui::ratatui::{Frame, layout::Rect, style::Style, text::Line};
use pito_tui::{Cx, Filter, Job, Palette, Phase, Screen, Span, Turn};

use crate::cli::codes::{kept, matches, refusal, remove, same};
use crate::one_board::Role;
use crate::wire::Code;

use super::Msg;
use super::badge::Badge;
use super::keys::{self, Act, CODES, FILTERED, READ, REVOKED, SPACES, Seat};
use super::projects::Shared;
use super::source::{Source, fold, hits, unix, words};
use super::waiting::tally;

const COLUMNS: [Column; 7] = [
    Column::new("Person", 12, 16).pinned(),
    Column::new("E-mail", 12, 22).priority(2),
    Column::new("Reaches", 12, 0).flex(),
    Column::new("Role", 6, 8).priority(1),
    Column::new("Code", 6, 6).pinned(),
    Column::new("Last used", 6, 9).right().priority(1),
    Column::new("State", 7, 12).pinned(),
];

pub struct Codes {
    source: Source,
    palette: Palette,
    codes: Option<Vec<(Code, String)>>,
    error: Option<String>,
    stopped: bool,
    filter: Filter,
    badge: Badge,
    asking: Option<(Input, Code, String)>,
    sending: bool,
    shared: Option<Shared>,
    scope: u64,
}

pub fn reach(code: &Code) -> String {
    match &code.grant {
        Some(grant) if grant.space => "Whole space".to_owned(),
        Some(grant) if grant.projects.is_empty() => "Nothing".to_owned(),
        Some(grant) => grant.projects.join(", "),
        None => code.hosts.join(", "),
    }
}

pub fn parked(code: &Code) -> bool {
    code.revoked_at.is_none()
        && code
            .grant
            .as_ref()
            .is_some_and(|grant| !grant.space && grant.projects.is_empty())
}

fn state_word(code: &Code) -> &'static str {
    if code.revoked_at.is_some() {
        "revoked"
    } else if parked(code) {
        "parked"
    } else {
        "active"
    }
}

fn haystack(code: &Code) -> String {
    fold(&format!(
        "{} {} {} {} {} {}",
        code.name,
        code.email,
        reach(code),
        code.hosts.join(" "),
        Role::of(code.manager).word(),
        state_word(code),
    ))
}

impl Codes {
    pub fn new(source: Source, palette: Palette) -> Codes {
        Codes {
            source,
            palette,
            codes: None,
            error: None,
            stopped: false,
            filter: Filter::new("Filter")
                .placeholder("type to filter by person, project, host, role or state")
                .hint("enter keeps the filter · esc clears it"),
            badge: Badge::off(),
            asking: None,
            sending: false,
            shared: None,
            scope: 0,
        }
    }

    pub fn shared(mut self, shared: Shared) -> Self {
        self.scope = shared.scoped();
        self.shared = Some(shared);
        self
    }

    fn switch(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(shared) = &self.shared else { return };
        shared.rescoped(self.source.rescope());
        self.scope = shared.scoped();
        cx.reload();
        let (source, scoped) = (self.source.clone(), self.scope);
        cx.detach(move || Msg::Waiting(false, scoped, source.waiting()));
    }

    pub fn badge(mut self, badge: Badge) -> Self {
        self.badge = badge;
        self
    }

    fn sift(&mut self) {
        let codes = self.codes.take().unwrap_or_default();
        let now = self.source.now();
        let units = Units::new("s", "m", "h", "d").year("y").now("now");
        let ago = |stamp: Option<&str>| {
            stamp.and_then(unix).map_or_else(
                || "never".to_owned(),
                |at| {
                    clock::age(
                        Duration::from_secs(now.saturating_sub(at).max(0) as u64),
                        &units,
                    )
                },
            )
        };
        let palette = &self.palette;
        let words = words(self.filter.query());
        self.filter.sift(
            &codes,
            |(_, haystack), _| hits(haystack, &words),
            |(code, _)| {
                let state = match state_word(code) {
                    "revoked" => Cell::new("revoked").style(palette.bad),
                    "parked" => Cell::new("parked").style(palette.warn),
                    _ => Cell::new("active").style(palette.good),
                };
                Row::new([
                    Cell::new(code.name.as_str()).style(palette.strong),
                    Cell::new(code.email.as_str()).faint(),
                    Cell::new(reach(code)),
                    match Role::of(code.manager) {
                        Role::Owner => Cell::new(Role::Owner.word()).style(palette.accent),
                        Role::User => Cell::new(Role::User.word()).faint(),
                    },
                    Cell::new(format!("…{}", code.hint)).faint(),
                    Cell::new(ago(code.last_used_at.as_deref())).faint(),
                    state,
                ])
            },
        );
        self.codes = Some(codes);
    }

    fn seat(&self) -> Seat {
        let read = self.codes.is_some();
        Seat::new(CODES)
            .with(READ, read)
            .with(SPACES, read && self.source.spaces().len() > 1)
            .with(
                REVOKED,
                self.chosen().is_some_and(|c| c.revoked_at.is_some()),
            )
            .with(FILTERED, read && self.filter.active())
    }

    fn sync(&self, cx: &mut Cx<'_, Msg>) {
        if self
            .shared
            .as_ref()
            .is_none_or(|shared| shared.showing(cx.screen()))
        {
            cx.keys_now(self.seat().now());
        }
    }

    fn pressed(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        let act = keys::action(self.seat().now(), &key).map(|(act, _)| act);
        if self.codes.is_none() {
            if act == Some(Act::Reload) {
                cx.reload();
            }
            return;
        }
        if let Some(asking) = self.asking.take() {
            self.answer(asking, key, cx);
            return;
        }
        match self.filter.key(key) {
            Turn::Filtered => self.sift(),
            Turn::Pass => match act {
                Some(Act::Reload) => cx.reload(),
                Some(Act::Delete) => self.ask(cx),
                Some(Act::Space) => self.switch(cx),
                _ => {}
            },
            _ => {}
        }
    }

    fn chosen(&self) -> Option<&Code> {
        let at = self.filter.current()?;
        self.codes.as_ref()?.get(at).map(|(code, _)| code)
    }

    fn ask(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(code) = self.chosen().cloned() else {
            return;
        };
        if self.sending {
            cx.say("A delete is still on its way.", Tone::Muted);
            return;
        }
        if let Some(why) = refusal(&code) {
            cx.say(why, Tone::Alert);
            return;
        }
        let prompt = format!("type {} to delete code {}", code.hint, code.id);
        self.asking = Some((Input::new(), code, prompt));
    }

    fn answer(&mut self, asking: (Input, Code, String), key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        let (mut input, code, prompt) = asking;
        match input.key(key.into()) {
            Edit::Submit(value) if value.trim().is_empty() => {}
            Edit::Submit(value) if matches(&code, &value) => self.erase(code, cx),
            Edit::Submit(_) => cx.say(kept(code.id), Tone::Muted),
            Edit::Cancel => {}
            _ => self.asking = Some((input, code, prompt)),
        }
    }

    fn erase(&mut self, code: Code, cx: &mut Cx<'_, Msg>) {
        self.sending = true;
        let source = self.source.clone();
        cx.detach(move || {
            let result = erase(&source, &code);
            Msg::CodeDeleted(Box::new(code), result)
        });
    }

    fn erased(&mut self, code: &Code, result: Result<(), String>, cx: &mut Cx<'_, Msg>) {
        self.sending = false;
        if let Err(error) = result {
            cx.say(error, Tone::Alert);
            return;
        }
        if let Some(codes) = &mut self.codes {
            codes.retain(|(c, _)| !same(c, code));
            self.sift();
        }
        cx.say(
            format!("Deleted code {} of {}", code.id, code.name),
            Tone::Good,
        );
    }
}

fn erase(source: &Source, code: &Code) -> Result<(), String> {
    if let Source::Broken(why) = source {
        return Err(why.clone());
    }
    if source.is_demo() {
        return source.sample(|demo| {
            demo.forget(code);
            Ok(())
        });
    }
    for space in 0..source.spaces().len() {
        let client = source.client(space, None)?;
        let held = client.codes(None)?.iter().any(|c| same(c, code));
        if held {
            return remove(&client, code.id).map(|_| ());
        }
    }
    Err(format!("no such code {}", code.id))
}

impl Screen<Msg> for Codes {
    fn moment(&mut self, now: Instant) {
        self.badge.moment(now);
    }

    fn animating(&self) -> bool {
        self.badge.easing()
    }

    fn badge(&self) -> &[Span] {
        self.badge.parts()
    }

    fn legend(&self) -> Option<&str> {
        Some(crate::ASK)
    }

    fn phase(&self) -> Phase<'_> {
        if self.codes.is_some() {
            return Phase::Ready;
        }
        match (&self.error, self.stopped) {
            (Some(error), _) => Phase::Trouble(
                vec![
                    Line::from("Couldn't read the codes."),
                    Line::from(error.as_str()),
                    Line::default(),
                    Line::from("r reads them again."),
                ]
                .into(),
            ),
            (None, false) => Phase::Loading("Reading the codes…".into()),
            (None, true) => Phase::Trouble(
                vec![
                    Line::from("Stopped waiting for the codes."),
                    Line::from("r reads them again."),
                ]
                .into(),
            ),
        }
    }

    fn load(&mut self) -> Option<Job<Msg>> {
        self.codes = None;
        self.error = None;
        self.stopped = false;
        let source = self.source.clone();
        Some(Box::new(move || Msg::Codes(source.codes())))
    }

    fn loaded(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        match event {
            Msg::Codes(Ok(codes)) => {
                self.codes = Some(
                    codes
                        .into_iter()
                        .map(|c| {
                            let haystack = haystack(&c);
                            (c, haystack)
                        })
                        .collect(),
                );
                self.sift();
            }
            Msg::Codes(Err(error)) => self.error = Some(error),
            _ => {}
        }
        self.sync(cx);
    }

    fn event(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        match event {
            Msg::CodeDeleted(code, result) => self.erased(&code, result, cx),
            Msg::Waiting(_, scoped, result) => {
                if let Some(shared) = &self.shared {
                    tally(shared, scoped, &result);
                }
            }
            _ => {}
        }
        self.sync(cx);
    }

    fn entered(&mut self, cx: &mut Cx<'_, Msg>) {
        if let Some(shared) = &self.shared {
            shared.show(cx.screen());
            if self.scope != shared.scoped() {
                self.scope = shared.scoped();
                cx.reload();
            }
        }
        self.sync(cx);
    }

    fn status(&self) -> Option<(String, Style)> {
        let space = self.shared.as_ref()?.space();
        Some((space, self.palette.accent)).filter(|(space, _)| !space.is_empty())
    }

    fn cancel(&mut self) {
        self.stopped = true;
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        self.pressed(key, cx);
        self.sync(cx);
    }

    fn paste(&mut self, text: &str, cx: &mut Cx<'_, Msg>) {
        if let Some((input, ..)) = &mut self.asking {
            input.paste(text);
        } else if self.filter.paste(text) == Turn::Filtered {
            self.sift();
        }
        self.sync(cx);
    }

    fn selected(&self) -> usize {
        self.filter.list().selected().unwrap_or(0)
    }

    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        let view = self
            .filter
            .view(&COLUMNS, palette)
            .header(true)
            .empty(Some("No codes yet. p99 invite makes one."));
        frame.render_widget(view, area);
    }

    fn typing(&self) -> bool {
        self.asking.is_some() || self.filter.typing()
    }

    fn input(&self) -> Option<InputBar<'_>> {
        match &self.asking {
            Some((input, _, prompt)) => Some(
                InputBar::new("Delete for good", input)
                    .placeholder(prompt)
                    .hint("enter deletes the code and its sign-ins · esc keeps it")
                    .tone(Tone::Alert),
            ),
            None => self.filter.bar(),
        }
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let Some(codes) = &self.codes else {
            return Vec::new();
        };
        let active = codes
            .iter()
            .filter(|(c, _)| c.revoked_at.is_none() && !parked(c))
            .count();
        let count = if self.filter.active() {
            format!("{} of {} codes", self.filter.shown().len(), codes.len())
        } else {
            format!("{} codes", codes.len())
        };
        vec![
            (count, Style::new()),
            (format!("{active} active"), self.palette.good),
        ]
    }
}

#[cfg(test)]
mod tests;

use std::time::{Duration, Instant};

use pito_tui::clock::{self, Units};
use pito_tui::crossterm::event::{KeyCode, KeyEvent};
use pito_tui::footer::{Hint, InputBar};
use pito_tui::list::{Cell, Column, Row};
use pito_tui::ratatui::{Frame, layout::Rect, style::Style, text::Line};
use pito_tui::{Cx, Filter, Job, Palette, Phase, Screen, Turn};

use crate::wire::Code;

use super::Msg;
use super::badge::Badge;
use super::source::{Source, fold, hits, unix, words};

const COLUMNS: [Column; 7] = [
    Column::new("Person", 12, 16).pinned(),
    Column::new("E-mail", 12, 22).priority(2),
    Column::new("Hosts", 12, 0).flex(),
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
                .placeholder("type to filter by person or host")
                .hint("enter keeps the filter · esc clears it"),
            badge: Badge::off(),
        }
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
                let state = match &code.revoked_at {
                    Some(_) => Cell::new("revoked").style(palette.bad),
                    None => Cell::new("active").style(palette.good),
                };
                Row::new([
                    Cell::new(code.name.as_str()).style(palette.strong),
                    Cell::new(code.email.as_str()).faint(),
                    Cell::new(code.hosts.join(", ")),
                    if code.manager {
                        Cell::new("manager").style(palette.accent)
                    } else {
                        Cell::new("person").faint()
                    },
                    Cell::new(format!("…{}", code.hint)).faint(),
                    Cell::new(ago(code.last_used_at.as_deref())).faint(),
                    state,
                ])
            },
        );
        self.codes = Some(codes);
    }
}

impl Screen<Msg> for Codes {
    fn moment(&mut self, now: Instant) {
        self.badge.moment(now);
    }

    fn animating(&self) -> bool {
        self.badge.easing()
    }

    fn status_parts(&self, _room: u16) -> Vec<(String, Style)> {
        self.badge.status(None)
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

    fn loaded(&mut self, event: Msg, _cx: &mut Cx<'_, Msg>) {
        match event {
            Msg::Codes(Ok(codes)) => {
                self.codes = Some(
                    codes
                        .into_iter()
                        .map(|c| {
                            let haystack =
                                fold(&format!("{} {} {}", c.name, c.email, c.hosts.join(" ")));
                            (c, haystack)
                        })
                        .collect(),
                );
                self.sift();
            }
            Msg::Codes(Err(error)) => self.error = Some(error),
            _ => {}
        }
    }

    fn cancel(&mut self) {
        self.stopped = true;
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        if self.codes.is_none() {
            if key.code == KeyCode::Char('r') {
                cx.reload();
            }
            return;
        }
        match self.filter.key(key) {
            Turn::Filtered => self.sift(),
            Turn::Pass if key.code == KeyCode::Char('r') => cx.reload(),
            _ => {}
        }
    }

    fn paste(&mut self, text: &str, _cx: &mut Cx<'_, Msg>) {
        if self.filter.paste(text) == Turn::Filtered {
            self.sift();
        }
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
        self.filter.typing()
    }

    fn input(&self) -> Option<InputBar<'_>> {
        self.filter.bar()
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if self.codes.is_none() {
            return vec![Hint::new("r", "read again")];
        }
        let mut hints = vec![
            Hint::new("↑↓", "move"),
            Hint::new("/", "filter").rank(1),
            Hint::new("r", "read again").rank(3),
        ];
        if self.filter.active() {
            hints.push(Hint::new("esc", "clear filter"));
        }
        hints
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let Some(codes) = &self.codes else {
            return Vec::new();
        };
        let active = codes.iter().filter(|(c, _)| c.revoked_at.is_none()).count();
        vec![
            (format!("{} codes", codes.len()), Style::new()),
            (format!("{active} active"), self.palette.good),
        ]
    }
}

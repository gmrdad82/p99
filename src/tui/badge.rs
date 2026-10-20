use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use pito_tui::Palette;
use pito_tui::ratatui::style::{Color, Modifier, Style};

use crate::license::State;

const STATE_ENV: &str = "P99_LICENSE_STATE";
const EASE: Duration = Duration::from_millis(420);
const RULE: char = '─';

#[derive(Clone)]
pub struct Badge {
    word: &'static str,
    caps: [&'static str; 2],
    pill: Style,
    cap: Style,
    rule: Style,
    start: Rc<Cell<Option<Instant>>>,
    now: Option<Instant>,
}

impl Badge {
    pub fn new(state: State, palette: &Palette) -> Badge {
        let (caps, pill, cap) = if palette.mono {
            let reversed = Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD);
            ([" ", " "], reversed, reversed)
        } else {
            let (face, ink) = colours(state);
            (
                ["▐", "▌"],
                Style::new().fg(ink).bg(face).add_modifier(Modifier::BOLD),
                Style::new().fg(face),
            )
        };
        Badge {
            word: state.label(),
            caps,
            pill,
            cap,
            rule: palette.rule,
            start: Rc::new(Cell::new(None)),
            now: None,
        }
    }

    pub fn off() -> Badge {
        Badge {
            word: "",
            caps: ["", ""],
            pill: Style::new(),
            cap: Style::new(),
            rule: Style::new(),
            start: Rc::new(Cell::new(None)),
            now: None,
        }
    }

    pub fn moment(&mut self, now: Instant) {
        self.now = Some(now);
        if self.start.get().is_none() {
            self.start.set(Some(now));
        }
    }

    pub fn easing(&self) -> bool {
        !self.word.is_empty() && self.shown() < 1.0
    }

    fn shown(&self) -> f32 {
        match (self.start.get(), self.now) {
            (Some(start), Some(now)) => ease_out(
                now.saturating_duration_since(start).as_secs_f32() / EASE.as_secs_f32(),
            ),
            _ => 0.0,
        }
    }

    pub fn status(&self, status: Option<(String, Style)>) -> Vec<(String, Style)> {
        let mut parts = Vec::with_capacity(5);
        let lead = status.is_some();
        parts.extend(status);
        if self.word.is_empty() {
            return parts;
        }
        if lead {
            parts.push((" ".to_owned(), Style::new()));
        }
        let pieces = [
            (self.caps[0], self.cap),
            (self.word, self.pill),
            (self.caps[1], self.cap),
        ];
        let total: usize = pieces.iter().map(|(text, _)| text.chars().count()).sum();
        let shown = ((self.shown() * total as f32).round() as usize).min(total);
        let mut left = shown;
        for (text, style) in pieces {
            let end = text
                .char_indices()
                .nth(left)
                .map_or(text.len(), |(at, _)| at);
            if end > 0 {
                parts.push((text[..end].to_owned(), style));
            }
            left -= text[..end].chars().count();
        }
        if shown < total {
            parts.push((std::iter::repeat_n(RULE, total - shown).collect(), self.rule));
        }
        parts
    }
}

fn colours(state: State) -> (Color, Color) {
    let (face, ink, indexed) = match state {
        State::Free => (0xb4c2d1, 0x13202f, (250, 234)),
        State::Studio => (0x2c66b8, 0xffffff, (25, 231)),
        State::Agency => (0x1d4785, 0xffffff, (24, 231)),
        State::Owner => (0xe0a32a, 0x241500, (178, 16)),
        State::Ff => (0xb8264d, 0xffffff, (125, 231)),
    };
    if truecolor() {
        (Color::from_u32(face), Color::from_u32(ink))
    } else {
        (Color::Indexed(indexed.0), Color::Indexed(indexed.1))
    }
}

fn truecolor() -> bool {
    std::env::var("COLORTERM").is_ok_and(|v| matches!(v.trim(), "truecolor" | "24bit"))
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

pub fn demo_state() -> State {
    std::env::var(STATE_ENV)
        .ok()
        .and_then(|word| State::parse(word.trim()))
        .unwrap_or(State::Free)
}


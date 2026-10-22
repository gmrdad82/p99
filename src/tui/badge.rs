use std::borrow::Cow;
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use pito_tui::ratatui::style::{Color, Modifier, Style};
use pito_tui::{Palette, Span};

use crate::license::State;

const STATE_ENV: &str = "P99_LICENSE_STATE";
const EASE: Duration = Duration::from_millis(420);
const RULE: &str = "────────────────";

#[derive(Clone)]
pub struct Badge {
    word: &'static str,
    caps: [&'static str; 2],
    pill: Style,
    cap: Style,
    rule: Style,
    start: Rc<Cell<Option<Instant>>>,
    now: Option<Instant>,
    drawn: usize,
    parts: Vec<Span>,
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
        let mut badge = Badge {
            word: state.label(),
            caps,
            pill,
            cap,
            rule: palette.rule,
            start: Rc::new(Cell::new(None)),
            now: None,
            drawn: usize::MAX,
            parts: Vec::with_capacity(4),
        };
        badge.draw(0);
        badge
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
            drawn: 0,
            parts: Vec::new(),
        }
    }

    pub fn moment(&mut self, now: Instant) {
        self.now = Some(now);
        if self.start.get().is_none() {
            self.start.set(Some(now));
        }
        if !self.word.is_empty() {
            let shown = (self.shown() * self.total() as f32).round() as usize;
            self.draw(shown);
        }
    }

    pub fn parts(&self) -> &[Span] {
        &self.parts
    }

    fn pieces(&self) -> [(&'static str, Style); 3] {
        [
            (self.caps[0], self.cap),
            (self.word, self.pill),
            (self.caps[1], self.cap),
        ]
    }

    fn total(&self) -> usize {
        self.pieces()
            .iter()
            .map(|(text, _)| text.chars().count())
            .sum()
    }

    fn draw(&mut self, shown: usize) {
        let total = self.total();
        let shown = shown.min(total);
        if shown == self.drawn {
            return;
        }
        self.drawn = shown;
        self.parts.clear();
        let mut left = shown;
        for (text, style) in self.pieces() {
            let end = text
                .char_indices()
                .nth(left)
                .map_or(text.len(), |(at, _)| at);
            if end > 0 {
                self.parts.push((Cow::Borrowed(&text[..end]), style));
            }
            left -= text[..end].chars().count();
        }
        if shown < total {
            let end = RULE
                .char_indices()
                .nth(total - shown)
                .map_or(RULE.len(), |(at, _)| at);
            self.parts.push((Cow::Borrowed(&RULE[..end]), self.rule));
        }
    }

    pub fn easing(&self) -> bool {
        !self.word.is_empty() && self.shown() < 1.0
    }

    fn shown(&self) -> f32 {
        match (self.start.get(), self.now) {
            (Some(start), Some(now)) => {
                ease_out(now.saturating_duration_since(start).as_secs_f32() / EASE.as_secs_f32())
            }
            _ => 0.0,
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn palette() -> Palette {
        Palette::new(Color::Rgb(0x3b, 0x7d, 0xd8))
    }

    fn text(badge: &Badge) -> String {
        badge
            .parts()
            .iter()
            .map(|(text, _)| text.as_ref())
            .collect()
    }

    fn settled(state: State, palette: &Palette) -> Badge {
        let mut badge = Badge::new(state, palette);
        let now = Instant::now();
        badge.moment(now);
        badge.moment(now + EASE * 2);
        badge
    }

    #[test]
    fn each_state_settles_to_its_capped_word() {
        for state in State::ALL {
            let badge = settled(state, &palette());
            assert_eq!(text(&badge), format!("▐{}▌", state.label()));
            let parts = badge.parts();
            assert_eq!(parts.len(), 3);
            assert_eq!(parts[0].1, parts[2].1);
            assert_ne!(parts[1].1, parts[0].1);
            assert!(!badge.easing());
        }
    }

    #[test]
    fn mono_pads_with_reversed_spaces() {
        let badge = settled(State::Studio, &palette().mono());
        assert_eq!(text(&badge), " Studio ");
        assert!(
            badge
                .parts()
                .iter()
                .all(|(_, style)| style.add_modifier.contains(Modifier::REVERSED))
        );
    }

    #[test]
    fn before_any_moment_it_is_all_rule_of_the_same_width() {
        let badge = Badge::new(State::Agency, &palette());
        assert_eq!(text(&badge), "─".repeat(8));
        assert_eq!(badge.parts().len(), 1);
        assert_eq!(badge.parts()[0].1, palette().rule);
    }

    #[test]
    fn while_easing_the_width_holds_and_the_pill_grows() {
        let mut badge = Badge::new(State::Owner, &palette());
        let now = Instant::now();
        badge.moment(now);
        let mut seen = 0;
        for step in 1..=20 {
            badge.moment(now + EASE * step / 20);
            let drawn = text(&badge);
            assert_eq!(drawn.chars().count(), 7);
            let pill = drawn.chars().take_while(|c| *c != '─').count();
            assert!(pill >= seen);
            assert!(drawn.chars().skip(pill).all(|c| c == '─'));
            seen = pill;
        }
        assert_eq!(seen, 7);
        assert!(!badge.easing());
    }

    #[test]
    fn off_draws_nothing_and_never_eases() {
        let mut badge = Badge::off();
        badge.moment(Instant::now());
        assert!(badge.parts().is_empty());
        assert!(!badge.easing());
    }

    #[test]
    fn a_steady_badge_allocates_nothing_per_frame() {
        let mut badge = Badge::new(State::Ff, &palette());
        let mut frame = Instant::now();
        for _ in 0..200 {
            badge.moment(frame);
            frame += Duration::from_millis(8);
        }
        assert!(
            badge
                .parts()
                .iter()
                .all(|(text, _)| matches!(text, Cow::Borrowed(_)))
        );
        let at = badge.parts().as_ptr();
        let room = badge.parts.capacity();
        let before: Vec<_> = badge.parts().iter().map(|(t, _)| t.as_ptr()).collect();
        for _ in 0..1000 {
            badge.moment(frame);
            frame += Duration::from_millis(8);
        }
        assert_eq!(badge.parts().as_ptr(), at);
        assert_eq!(badge.parts.capacity(), room);
        let after: Vec<_> = badge.parts().iter().map(|(t, _)| t.as_ptr()).collect();
        assert_eq!(before, after);
        assert_eq!(badge.drawn, badge.total());
    }

    #[test]
    fn clones_share_one_start_so_every_tab_eases_together() {
        let first = Badge::new(State::Free, &palette());
        let mut a = first.clone();
        let mut b = first;
        let now = Instant::now();
        a.moment(now);
        b.moment(now + EASE * 2);
        a.moment(now + EASE * 2);
        assert_eq!(text(&a), text(&b));
        assert_eq!(text(&a), "▐Free▌");
    }
}

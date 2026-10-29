use std::borrow::Cow;
use std::cell::Cell;
use std::fmt::Write;
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
    spare: String,
    waiting: Rc<Cell<u64>>,
    counted: u64,
    wait: [Style; 2],
}

impl Badge {
    pub fn new(state: State, palette: &Palette) -> Badge {
        let (caps, pill, cap) = if palette.mono {
            let reversed = Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD);
            ([" ", " "], reversed, reversed)
        } else {
            let (face, ink) = colours(state, truecolor());
            (
                ["▐", "▌"],
                Style::new().fg(ink).bg(face).add_modifier(Modifier::BOLD),
                Style::new().fg(face),
            )
        };
        let wait = if palette.mono {
            let reversed = Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD);
            [reversed, reversed]
        } else {
            let face = palette.accent.fg.unwrap_or(Color::Blue);
            [
                Style::new().fg(face),
                Style::new()
                    .fg(Color::White)
                    .bg(face)
                    .add_modifier(Modifier::BOLD),
            ]
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
            parts: Vec::with_capacity(8),
            spare: String::with_capacity(24),
            waiting: Rc::new(Cell::new(0)),
            counted: 0,
            wait,
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
            spare: String::new(),
            waiting: Rc::new(Cell::new(0)),
            counted: 0,
            wait: [Style::new(); 2],
        }
    }

    pub fn counter(&self) -> Rc<Cell<u64>> {
        Rc::clone(&self.waiting)
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
        let waiting = self.waiting.get();
        if shown == self.drawn && waiting == self.counted {
            return;
        }
        self.drawn = shown;
        self.counted = waiting;
        for (text, _) in self.parts.drain(..) {
            if let Cow::Owned(owned) = text {
                self.spare = owned;
            }
        }
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
        if shown == total && waiting > 0 {
            let [cap, pill] = self.wait;
            let caps = if self.caps[0] == " " {
                [" ", " "]
            } else {
                ["▐", "▌"]
            };
            self.parts.push((Cow::Borrowed(" "), Style::new()));
            self.parts.push((Cow::Borrowed(caps[0]), cap));
            let mut label = std::mem::take(&mut self.spare);
            label.clear();
            let _ = write!(label, "{waiting} waiting");
            self.parts.push((Cow::Owned(label), pill));
            self.parts.push((Cow::Borrowed(caps[1]), cap));
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

fn colours(state: State, truecolor: bool) -> (Color, Color) {
    let (face, ink, indexed) = match state {
        State::Free => (0xb4c2d1, 0x13202f, (250, 234)),
        State::Studio => (0x2c66b8, 0xffffff, (25, 231)),
        State::Agency | State::Owner => (0x1d4785, 0xffffff, (24, 231)),
        State::Ff => (0xb8264d, 0xffffff, (125, 231)),
    };
    if truecolor {
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
    fn an_owner_key_shows_the_agency_pill_in_its_colours() {
        let owner = settled(State::Owner, &palette());
        let agency = settled(State::Agency, &palette());
        assert_eq!(text(&owner), "▐Agency▌");
        assert_eq!(owner.parts(), agency.parts());
        assert!(!text(&owner).contains("Owner"));
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
            assert_eq!(drawn.chars().count(), 8);
            let pill = drawn.chars().take_while(|c| *c != '─').count();
            assert!(pill >= seen);
            assert!(drawn.chars().skip(pill).all(|c| c == '─'));
            seen = pill;
        }
        assert_eq!(seen, 8);
        assert!(!badge.easing());
    }

    #[test]
    fn the_waiting_count_shows_beside_the_pill_and_none_at_zero() {
        let mut badge = settled(State::Studio, &palette());
        let counter = badge.counter();
        let now = Instant::now() + EASE * 4;
        badge.moment(now);
        assert_eq!(text(&badge), "▐Studio▌");
        counter.set(1);
        badge.moment(now);
        assert_eq!(text(&badge), "▐Studio▌ ▐1 waiting▌");
        let parts = badge.parts();
        assert_eq!(parts[5].1.bg, palette().accent.fg);
        assert!(parts[5].1.add_modifier.contains(Modifier::BOLD));
        counter.set(12);
        badge.moment(now);
        assert_eq!(text(&badge), "▐Studio▌ ▐12 waiting▌");
        counter.set(0);
        badge.moment(now);
        assert_eq!(text(&badge), "▐Studio▌");
    }

    #[test]
    fn every_clone_shows_the_same_count_and_mono_reverses_it() {
        let first = settled(State::Free, &palette().mono());
        let mut other = first.clone();
        first.counter().set(3);
        other.moment(Instant::now() + EASE * 4);
        assert_eq!(text(&other), " Free   3 waiting ");
        assert!(other.parts()[5].1.add_modifier.contains(Modifier::REVERSED));
    }

    #[test]
    fn the_count_waits_until_the_pill_has_eased_in() {
        let mut badge = Badge::new(State::Agency, &palette());
        badge.counter().set(2);
        let now = Instant::now();
        badge.moment(now);
        assert!(!text(&badge).contains("waiting"));
        badge.moment(now + EASE);
        assert_eq!(text(&badge), "▐Agency▌ ▐2 waiting▌");
    }

    #[test]
    fn a_steady_count_allocates_nothing_per_frame() {
        let mut badge = settled(State::Owner, &palette());
        badge.counter().set(5);
        let frame = Instant::now() + EASE * 4;
        badge.moment(frame);
        let before: Vec<_> = badge.parts().iter().map(|(t, _)| t.as_ptr()).collect();
        for step in 0..500 {
            badge.moment(frame + Duration::from_millis(step));
        }
        let after: Vec<_> = badge.parts().iter().map(|(t, _)| t.as_ptr()).collect();
        assert_eq!(before, after);
    }

    #[test]
    fn a_changing_count_writes_into_the_same_buffer_and_easing_keeps_it() {
        let mut badge = settled(State::Owner, &palette());
        let counter = badge.counter();
        let frame = Instant::now() + EASE * 4;
        counter.set(5);
        badge.moment(frame);
        let first = badge.parts()[5].0.as_ptr();
        for count in [6, 7, 12, 3, 9] {
            counter.set(count);
            badge.moment(frame);
            assert_eq!(badge.parts()[5].0.as_ptr(), first, "{count}");
            assert_eq!(badge.parts()[5].0, format!("{count} waiting"));
        }
        counter.set(0);
        badge.moment(frame);
        assert!(
            badge
                .parts()
                .iter()
                .all(|(text, _)| matches!(text, Cow::Borrowed(_)))
        );
        counter.set(4);
        badge.moment(frame);
        assert_eq!(badge.parts()[5].0.as_ptr(), first);
    }

    #[test]
    fn a_pill_easing_in_with_a_count_waiting_allocates_once_for_the_whole_run() {
        let mut badge = Badge::new(State::Studio, &palette());
        badge.counter().set(2);
        let start = Instant::now();
        let held = badge.spare.as_ptr();
        for step in 0..=40 {
            badge.moment(start + EASE * step / 20);
        }
        assert_eq!(text(&badge), "▐Studio▌ ▐2 waiting▌");
        assert_eq!(badge.parts()[5].0.as_ptr(), held);
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

    #[test]
    fn the_badge_eases_in_from_a_rule_to_the_licence_word() {
        let start = Instant::now();
        let mut badge = Badge::new(State::Studio, &palette());
        badge.moment(start);
        assert_eq!(text(&badge), "────────");
        assert!(badge.easing());
        badge.moment(start + Duration::from_millis(100));
        assert_eq!(text(&badge), "▐Stu────");
        assert!(badge.easing());
        badge.moment(start + EASE);
        assert_eq!(text(&badge), "▐Studio▌");
        assert!(!badge.easing());
        badge.moment(start + EASE * 10);
        assert_eq!(text(&badge), "▐Studio▌");
    }

    #[test]
    fn the_ease_runs_ahead_of_a_linear_reveal_never_with_it() {
        let start = Instant::now();
        let mut badge = Badge::new(State::Agency, &palette());
        badge.moment(start);
        let total = "▐Agency▌".chars().count();
        for millis in [60, 120, 210, 300] {
            badge.moment(start + Duration::from_millis(millis));
            let shown = text(&badge).chars().filter(|c| *c != '─').count();
            let linear = (millis as f32 / EASE.as_millis() as f32 * total as f32).round() as usize;
            assert!(
                shown > linear,
                "{millis} ms: {shown} shown, {linear} linear"
            );
        }
    }

    #[test]
    fn a_clock_before_the_first_moment_is_ignored() {
        let start = Instant::now() + Duration::from_secs(60);
        let mut badge = Badge::new(State::Free, &palette());
        badge.moment(start);
        badge.moment(start - Duration::from_secs(1));
        assert_eq!(text(&badge), "──────");
    }

    #[test]
    fn the_pill_has_its_state_colours_and_caps_in_the_face_colour() {
        let badge = settled(State::Studio, &palette());
        let parts = badge.parts();
        let (face, ink) = colours(State::Studio, truecolor());
        assert_eq!(parts[0].1.fg, Some(face));
        assert_eq!(parts[1].1.fg, Some(ink));
        assert_eq!(parts[1].1.bg, Some(face));
        assert!(parts[1].1.add_modifier.contains(Modifier::BOLD));
        assert_eq!(parts[2].1.fg, Some(face));
    }

    #[test]
    fn every_state_has_its_own_face_in_truecolor_and_in_256_colours() {
        for truecolor in [true, false] {
            let faces: std::collections::HashSet<_> = State::ALL
                .into_iter()
                .map(|state| colours(state, truecolor).0)
                .collect();
            assert_eq!(faces.len(), State::ALL.len(), "truecolor {truecolor}");
            for state in State::ALL {
                let (face, ink) = colours(state, truecolor);
                assert_ne!(face, ink, "{state:?}");
                match (truecolor, face) {
                    (true, Color::Rgb(..)) | (false, Color::Indexed(_)) => {}
                    other => panic!("{state:?}: {other:?}"),
                }
            }
        }
    }

    #[test]
    fn ease_out_starts_fast_and_lands_softly() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        assert_eq!(ease_out(-0.5), 0.0);
        assert_eq!(ease_out(1.5), 1.0);
        assert!(ease_out(0.5) > 0.5);
        let steps: Vec<f32> = (0..=10).map(|i| ease_out(i as f32 / 10.0)).collect();
        let gaps: Vec<f32> = steps.windows(2).map(|pair| pair[1] - pair[0]).collect();
        assert!(gaps.windows(2).all(|pair| pair[1] < pair[0]), "{gaps:?}");
    }
}

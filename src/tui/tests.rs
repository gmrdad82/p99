use std::time::Duration;

use pito_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind};
use pito_tui::ratatui::buffer::Buffer;
use pito_tui::{Flow, Palette, Tui, dump};

use crate::license::State;

use super::demo::Demo;
use super::source::Source;
use super::{ACCENT, Msg, SIZE, build, keys, size};

pub(super) const WIDE: u16 = 160;
pub(super) const HIGH: u16 = 44;
pub(super) const INBOX: usize = 0;
pub(super) const BOARD: usize = 1;
pub(super) const CODES: usize = 2;

pub(super) struct Run {
    pub(super) tui: Tui<Msg>,
    pub(super) source: Source,
    pub(super) palette: Palette,
}

pub(super) fn palette() -> Palette {
    Palette::new(ACCENT)
}

pub(super) fn sample() -> Source {
    Source::demo(Duration::ZERO)
}

pub(super) fn run(source: Source) -> Run {
    run_as(source, State::Free)
}

pub(super) fn run_as(source: Source, state: State) -> Run {
    let mut tui = build(source.clone(), state, palette());
    tui.start();
    tui.settle();
    Run {
        tui,
        source,
        palette: palette(),
    }
}

pub(super) fn waiting(source: Source) -> Run {
    let mut tui = build(source.clone(), State::Free, palette());
    tui.shot(WIDE, HIGH, &[], false);
    Run {
        tui,
        source,
        palette: palette(),
    }
}

pub(super) fn ctrl(c: char) -> KeyEvent {
    KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL)
}

impl Run {
    pub(super) fn press(&mut self, keys: &str) -> String {
        for key in dump::keys(keys).expect("every key has a name") {
            self.key(key);
        }
        self.text()
    }

    pub(super) fn key(&mut self, key: KeyEvent) -> Flow {
        self.tui.frame(WIDE, HIGH);
        let flow = self.tui.key(key);
        self.tui.settle();
        flow
    }

    pub(super) fn frame(&mut self) -> Buffer {
        self.tui.frame(WIDE, HIGH)
    }

    pub(super) fn text(&mut self) -> String {
        dump::text(&self.frame())
    }

    pub(super) fn go(&mut self, screen: usize) -> String {
        assert!(self.tui.go(screen), "screen {screen} is a tab");
        self.tui.settle();
        self.text()
    }

    pub(super) fn event(&mut self, screen: usize, msg: Msg) -> String {
        self.tui.event(screen, msg);
        self.tui.settle();
        self.text()
    }

    pub(super) fn advance(&mut self, by: Duration) -> String {
        self.tui.advance(by);
        self.tui.settle();
        self.text()
    }

    pub(super) fn mouse(&mut self, kind: MouseEventKind, column: u16, row: u16) {
        self.tui.mouse(MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        self.tui.settle();
    }

    pub(super) fn paste(&mut self, text: &str) -> String {
        self.tui.paste(text);
        self.tui.settle();
        self.text()
    }

    pub(super) fn demo<T>(&self, look: impl FnOnce(&mut Demo) -> T) -> T {
        let Source::Demo(demo, _) = &self.source else {
            panic!("the run reads the sample data");
        };
        look(&mut demo.lock().expect("the sample data is whole"))
    }
}

pub(super) fn row(text: &str, needle: &str) -> usize {
    text.lines()
        .position(|line| line.contains(needle))
        .unwrap_or_else(|| panic!("{needle:?} is on screen:\n{text}"))
}

pub(super) fn line<'a>(text: &'a str, needle: &str) -> &'a str {
    text.lines()
        .find(|line| line.contains(needle))
        .unwrap_or_else(|| panic!("{needle:?} is on screen:\n{text}"))
}

pub(super) fn spot(buffer: &Buffer, lead: &str, needle: &str) -> (u16, u16) {
    let area = buffer.area;
    for y in area.top()..area.bottom() {
        let mut text = String::new();
        let mut xs = Vec::new();
        for x in area.left()..area.right() {
            let symbol = buffer[(x, y)].symbol();
            xs.extend(std::iter::repeat_n(x, symbol.len()));
            text.push_str(symbol);
        }
        let Some(from) = text.find(lead) else {
            continue;
        };
        if let Some(at) = text[from..].find(needle) {
            return (xs[from + at], y);
        }
    }
    panic!(
        "{needle:?} after {lead:?} is on screen:\n{}",
        dump::text(buffer)
    );
}

#[test]
fn a_size_is_width_by_height_and_nothing_else() {
    assert_eq!(size("120x34"), Ok((120, 34)));
    assert_eq!(size("80X24"), Ok((80, 24)));
    for bad in ["120", "0x34", "120x0", "wide", "x", "-1x5"] {
        assert_eq!(
            size(bad),
            Err("a size is WxH, such as 120x34".to_owned()),
            "{bad}"
        );
    }
    assert_eq!(SIZE, (120, 34));
}

#[test]
fn keys_name_every_key_or_say_which_one_has_no_name() {
    assert_eq!(keys("tab / a enter"), Ok("tab / a enter".to_owned()));
    assert_eq!(keys("ctrl+c esc"), Ok("ctrl+c esc".to_owned()));
    assert_eq!(keys("ctrl+ab"), Err("no key is called ctrl+ab".to_owned()));
}

#[test]
fn the_app_opens_on_the_inbox_with_its_three_screens_and_the_help_line() {
    let mut app = run(sample());
    assert_eq!(app.tui.names(), ["Inbox", "Board", "Codes"]);
    let text = app.text();
    let head = text.lines().take(4).collect::<Vec<_>>().join("\n");
    for word in ["P99", "Inbox", "Board", "Codes"] {
        assert!(head.contains(word), "{word} in the header:\n{text}");
    }
    assert!(text.contains("16 of 22 items"), "{text}");
    assert!(text.contains("? help"), "{text}");
    assert!(text.contains("ctrl+c twice quit"), "{text}");
}

#[test]
fn tab_walks_the_screens_in_order_and_back_tab_walks_back() {
    let mut app = run(sample());
    assert_eq!(app.tui.current(), Some(INBOX));
    let board = app.press("tab");
    assert_eq!(app.tui.current(), Some(BOARD));
    assert!(board.contains("Shop"), "{board}");
    let codes = app.press("tab");
    assert_eq!(app.tui.current(), Some(CODES));
    assert!(codes.contains("4 codes"), "{codes}");
    app.press("backtab");
    assert_eq!(app.tui.current(), Some(BOARD));
}

#[test]
fn ctrl_c_once_asks_and_twice_quits() {
    let mut app = run(sample());
    assert_eq!(app.key(ctrl('c')), Flow::Stay);
    assert!(app.text().contains("ctrl+c again to quit"));
    assert_eq!(app.key(ctrl('c')), Flow::Quit);
}

#[test]
fn a_window_under_forty_by_twelve_says_how_big_it_must_be() {
    let mut app = run(sample());
    let text = dump::text(&app.tui.frame(39, 11));
    assert!(text.contains("Make the window at least 40"), "{text}");
    let fits = dump::text(&app.tui.frame(40, 12));
    assert!(!fits.contains("Make the window"), "{fits}");
}

#[test]
fn the_licence_badge_eases_in_beside_the_status_and_then_holds() {
    let mut app = run_as(sample(), State::Studio);
    let first = app.text();
    assert!(!first.contains("Studio"), "{first}");
    let half = app.advance(Duration::from_millis(100));
    assert!(!half.contains("Studio"), "{half}");
    let shown = app.advance(Duration::from_millis(400));
    assert!(line(&shown, "All hosts").contains("Studio"), "{shown}");
    let later = app.advance(Duration::from_secs(5));
    assert!(line(&later, "All hosts").contains("Studio"), "{later}");
}

#[test]
fn the_badge_follows_the_screen_it_sits_on() {
    let mut app = run_as(sample(), State::Agency);
    app.advance(Duration::from_secs(1));
    let board = app.go(BOARD);
    assert!(board.contains("Agency"), "{board}");
    let codes = app.go(CODES);
    assert!(codes.contains("Agency"), "{codes}");
}

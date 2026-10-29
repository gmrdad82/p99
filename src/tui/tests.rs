use std::time::Duration;

use pito_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind};
use pito_tui::ratatui::buffer::Buffer;
use pito_tui::{Flow, Palette, Tui, dump};

use crate::license::State;

use super::demo::Demo;
use super::source::Source;
use super::waiting::NOTHING;
use super::{ACCENT, Msg, SIZE, build, keys, size};
use crate::wire::Change;

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
    assert!(text.contains("21 of 28 items"), "{text}");
    assert!(text.contains("? help"), "{text}");
    assert!(text.contains("ctrl+c twice quit"), "{text}");
}

#[test]
fn tab_walks_the_screens_in_order_and_back_tab_walks_back() {
    let mut app = run(sample());
    assert_eq!(app.tui.current(), Some(INBOX));
    let board = app.press("tab");
    assert_eq!(app.tui.current(), Some(BOARD));
    assert!(board.contains("New 8"), "{board}");
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
    assert!(line(&shown, "Example shop").contains("Studio"), "{shown}");
    let later = app.advance(Duration::from_secs(5));
    assert!(line(&later, "Example shop").contains("Studio"), "{later}");
}

#[test]
fn the_badge_follows_the_screen_it_sits_on() {
    let mut app = run_as(sample(), State::Agency);
    app.text();
    app.advance(Duration::from_secs(1));
    let board = app.go(BOARD);
    assert!(board.contains("Agency"), "{board}");
    let codes = app.go(CODES);
    assert!(codes.contains("Agency"), "{codes}");
}

fn settled(app: &mut Run) -> String {
    app.text();
    app.advance(Duration::from_secs(1))
}

fn close(app: &Run, key: &str) {
    let done = Change {
        status: Some("done".into()),
        ..Change::default()
    };
    app.source
        .change(0, None, key, &done)
        .expect("the sample takes the change");
}

#[test]
fn the_header_counts_what_waits_beside_the_licence_pill_on_every_tab() {
    let mut app = run_as(sample(), State::Studio);
    let shown = settled(&mut app);
    let header = line(&shown, "Example shop");
    let (pill, count) = (header.find("Studio"), header.find("3 waiting"));
    assert!(pill.is_some() && count.is_some(), "{shown}");
    assert!(pill < count, "{header}");
    for screen in [BOARD, CODES] {
        let text = app.go(screen);
        assert!(text.contains("3 waiting"), "{screen}:\n{text}");
    }
}

#[test]
fn the_count_follows_the_cards_down_to_one_and_shows_nothing_at_zero() {
    let mut app = run(sample());
    settled(&mut app);
    close(&app, "BUG-25");
    close(&app, "BUG-26");
    let one = app.press("w");
    assert!(one.contains("1 waiting"), "{one}");
    assert!(one.contains("Needs you · 1"), "{one}");
    app.press("esc");
    close(&app, "FEAT-27");
    let none = app.press("w");
    assert!(none.contains(NOTHING), "{none}");
    assert!(!none.contains("waiting"), "{none}");
}

#[test]
fn the_count_is_asked_once_at_start_and_never_per_frame() {
    let mut app = run(sample());
    settled(&mut app);
    close(&app, "BUG-25");
    for _ in 0..20 {
        app.frame();
    }
    let still = app.advance(Duration::from_secs(5));
    assert!(still.contains("3 waiting"), "{still}");
}

#[test]
fn a_live_change_counts_again_after_a_quiet_moment() {
    let mut app = run(sample());
    settled(&mut app);
    close(&app, "BUG-25");
    let event = r#"{"type":"label","key":"BUG-25","from":"Needs you","to":"Done"}"#;
    app.event(INBOX, Msg::Heard(0, event.into()));
    let soon = app.advance(super::waiting::QUIET - Duration::from_millis(1));
    assert!(soon.contains("3 waiting"), "{soon}");
    let later = app.advance(Duration::from_millis(1));
    assert!(later.contains("2 waiting"), "{later}");
    let quiet = r#"{"type":"assignee","key":"BUG-26"}"#;
    close(&app, "BUG-26");
    app.event(INBOX, Msg::Heard(0, quiet.into()));
    let unchanged = app.advance(Duration::from_secs(1));
    assert!(unchanged.contains("2 waiting"), "{unchanged}");
}

#[test]
fn a_move_on_the_board_counts_again() {
    let mut app = run(sample());
    settled(&mut app);
    app.go(BOARD);
    app.press("l l l space l l l enter");
    let text = app.advance(Duration::from_millis(1));
    assert!(text.contains("2 waiting"), "{text}");
}

#[test]
fn w_lists_what_needs_you_newest_first_and_enter_opens_the_card() {
    let mut app = run(sample());
    settled(&mut app);
    let list = app.press("w");
    assert!(list.contains("Needs you · 3"), "{list}");
    let rows = [
        "BUG-25  Needs you  Storefront  Waveform drifts after a cut",
        "BUG-26  Stuck  Storefront  Spanish cues lose their accents",
        "FEAT-27  Landed  Mobile app  Roll-up player plays the cut",
    ];
    let at: Vec<usize> = rows.iter().map(|r| row(&list, r)).collect();
    assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "{list}");
    let thread = app.press("enter");
    assert!(
        thread.contains("BUG-25  Waveform drifts after a cut"),
        "{thread}"
    );
    assert!(thread.contains("r reply"), "{thread}");
    let back = app.press("esc");
    assert!(back.contains("21 of 28 items"), "{back}");
    assert!(
        !back.contains("BUG-25  Waveform drifts after a cut"),
        "{back}"
    );
}

#[test]
fn w_works_from_the_board_too_and_esc_closes_the_list() {
    let mut app = run(sample());
    settled(&mut app);
    app.go(BOARD);
    let list = app.press("w");
    assert!(list.contains("Needs you · 3"), "{list}");
    let closed = app.press("esc");
    assert!(!closed.contains("Needs you · 3"), "{closed}");
    assert!(closed.contains("New 8"), "{closed}");
}

#[test]
fn w_while_typing_a_filter_types_it() {
    let mut app = run(sample());
    settled(&mut app);
    let typed = app.press("/ w");
    assert!(!typed.contains("Needs you ·"), "{typed}");
    assert!(typed.contains("Filter"), "{typed}");
}

#[test]
fn p_offers_every_project_and_enter_narrows_the_inbox_and_closes_the_picker() {
    let mut app = run(sample());
    settled(&mut app);
    let pick = app.press("p");
    for said in ["Projects", "All projects", "Mobile app", "Storefront"] {
        assert!(pick.contains(said), "{said}:\n{pick}");
    }
    let narrowed = app.press("down enter");
    assert!(!narrowed.contains("All projects"), "{narrowed}");
    assert!(narrowed.contains("Example shop"), "{narrowed}");
    assert!(narrowed.contains("in Mobile app"), "{narrowed}");
    let ticked = app.press("p");
    assert!(ticked.contains("✓ Mobile app"), "{ticked}");
    assert!(!ticked.contains("✓ Storefront"), "{ticked}");
    let kept = app.press("esc");
    assert!(!kept.contains("All projects"), "{kept}");
    assert!(kept.contains("in Mobile app"), "{kept}");
    assert!(kept.contains("2 of 2 items"), "{kept}");
    for key in ["TASK-24 ", "FEAT-27 "] {
        assert!(kept.contains(key), "{key}:\n{kept}");
    }
    assert!(!kept.contains("BUG-11 "), "{kept}");
}

#[test]
fn several_projects_narrow_every_tab_and_esc_clears_them() {
    let mut app = run(sample());
    settled(&mut app);
    let both = app.press("p down enter p down down enter");
    assert!(both.contains("in Mobile app, Storefront"), "{both}");
    assert!(both.contains("5 of 6 items"), "{both}");
    let board = app.go(BOARD);
    for said in [
        "6 items",
        "New 1",
        "Landed 1",
        "Done 1",
        "Mobile app, Storefront",
    ] {
        assert!(board.contains(said), "{said}:\n{board}");
    }
    assert!(!board.contains(" FEAT-9 "), "{board}");
    let list = app.press("w");
    assert!(list.contains("Needs you · 3"), "{list}");
    app.press("esc");
    let cleared = app.press("esc");
    assert!(cleared.contains("28 items"), "{cleared}");
    assert!(cleared.contains("New 8"), "{cleared}");
    let inbox = app.go(INBOX);
    assert!(inbox.contains("21 of 28 items"), "{inbox}");
    assert!(!inbox.contains("in Mobile app"), "{inbox}");
}

#[test]
fn the_needs_you_list_honours_the_projects_chosen() {
    let mut app = run(sample());
    settled(&mut app);
    app.press("p down enter");
    let list = app.press("w");
    assert!(list.contains("Needs you · 1"), "{list}");
    assert!(list.contains("FEAT-27"), "{list}");
    assert!(!list.contains("BUG-25"), "{list}");
    assert!(list.contains("1 waiting"), "{list}");
    assert!(!list.contains("3 waiting"), "{list}");
    app.press("esc");
    close(&app, "FEAT-27");
    let none = app.press("w");
    assert!(none.contains("Nothing needs you in Mobile app."), "{none}");
}

#[test]
fn all_projects_clears_the_choice_and_closes_the_picker() {
    let mut app = run(sample());
    settled(&mut app);
    app.press("p down enter");
    let all = app.press("p enter");
    assert!(!all.contains("Projects"), "{all}");
    assert!(all.contains("21 of 28 items"), "{all}");
    assert!(!all.contains("in Mobile app"), "{all}");
}

#[test]
fn p_with_no_projects_says_how_to_file_one() {
    let mut app = run(sample());
    settled(&mut app);
    let text = app.event(INBOX, Msg::Projects(Ok(Vec::new())));
    assert!(text.contains(super::projects::NONE_YET), "{text}");
    let failed = app.event(INBOX, Msg::Projects(Err("offline".into())));
    assert!(failed.contains("offline"), "{failed}");
}

#[test]
fn a_failed_count_stays_quiet_and_a_failed_w_says_why() {
    let mut app = run(sample());
    settled(&mut app);
    let quiet = app.event(
        INBOX,
        Msg::Waiting(false, 0, Err("not an owner (403)".into())),
    );
    assert!(!quiet.contains("not an owner"), "{quiet}");
    let loud = app.event(INBOX, Msg::Waiting(true, 0, Err("offline now".into())));
    assert!(loud.contains("offline now"), "{loud}");
}

#[test]
fn the_codes_tab_takes_no_project_filter() {
    let mut app = run(sample());
    settled(&mut app);
    let codes = app.go(CODES);
    assert!(!codes.contains("p projects"), "{codes}");
    let text = app.press("p");
    assert!(!text.contains("All projects"), "{text}");
}

#[test]
fn a_late_project_or_needs_you_answer_never_opens_over_typing() {
    let mut app = run(sample());
    settled(&mut app);
    app.press("/");
    let names = vec!["Mobile app".to_owned(), "Storefront".to_owned()];
    let typed = app.event(INBOX, Msg::Projects(Ok(names)));
    assert!(!typed.contains("All projects"), "{typed}");
    let cards = app.source.waiting().expect("the sample waits");
    let still = app.event(INBOX, Msg::Waiting(true, 0, Ok(cards)));
    assert!(!still.contains("Needs you ·"), "{still}");
    assert!(still.contains("Filter"), "{still}");
    let failed = app.event(INBOX, Msg::Projects(Err("offline".into())));
    assert!(!failed.contains("offline"), "{failed}");
}

#[test]
fn a_late_project_answer_leaves_the_host_picker_and_its_choice_alone() {
    let mut app = run(sample());
    settled(&mut app);
    let hosts = app.press("h");
    assert!(hosts.contains("dev.example.com"), "{hosts}");
    let names = vec!["Mobile app".to_owned(), "Storefront".to_owned()];
    let over = app.event(INBOX, Msg::Projects(Ok(names)));
    assert!(!over.contains("All projects"), "{over}");
    assert!(over.contains("dev.example.com"), "{over}");
    let picked = app.press("down enter");
    assert!(!picked.contains("✓"), "{picked}");
    assert!(picked.contains("host dev.example.com"), "{picked}");
    assert!(!picked.contains("in Mobile app"), "{picked}");
}

#[test]
fn esc_clears_the_text_filter_first_and_the_projects_on_the_next_esc() {
    let mut app = run(sample());
    settled(&mut app);
    let chosen = app.press("p down enter");
    assert!(chosen.contains("esc all projects"), "{chosen}");
    let both = app.press("/ t a s k enter");
    assert!(both.contains("esc clear filter"), "{both}");
    assert!(!both.contains("esc all projects"), "{both}");
    let first = app.press("esc");
    assert!(first.contains("in Mobile app"), "{first}");
    assert!(first.contains("esc all projects"), "{first}");
    let second = app.press("esc");
    assert!(!second.contains("in Mobile app"), "{second}");
    assert!(second.contains("21 of 28 items"), "{second}");
    assert!(!second.contains("esc all projects"), "{second}");
}

#[test]
fn a_change_made_in_a_thread_opened_from_w_refreshes_the_inbox_underneath() {
    let mut app = run(sample());
    settled(&mut app);
    app.press("w enter");
    let done = Change {
        status: Some("done".into()),
        ..Change::default()
    };
    let issue = app
        .source
        .change(0, None, "BUG-25", &done)
        .expect("the sample takes the change");
    app.event(INBOX, Msg::Changed("BUG-25".into(), Ok(issue)));
    let back = app.press("esc");
    assert!(back.contains("20 of 28 items"), "{back}");
}

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
fn the_app_opens_on_the_cards_with_its_three_screens_and_the_help_line() {
    let mut app = run(sample());
    assert_eq!(app.tui.names(), ["Cards", "Board", "Codes"]);
    let text = app.text();
    let head = text.lines().take(4).collect::<Vec<_>>().join("\n");
    for word in ["P99", "Cards", "Board", "Codes"] {
        assert!(head.contains(word), "{word} in the header:\n{text}");
    }
    assert!(text.contains("21 of 28 cards"), "{text}");
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
    assert!(back.contains("21 of 28 cards"), "{back}");
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
    assert!(kept.contains("2 of 2 cards"), "{kept}");
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
    assert!(both.contains("5 of 6 cards"), "{both}");
    let board = app.go(BOARD);
    for said in [
        "6 cards",
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
    assert!(cleared.contains("28 cards"), "{cleared}");
    assert!(cleared.contains("New 8"), "{cleared}");
    let inbox = app.go(INBOX);
    assert!(inbox.contains("21 of 28 cards"), "{inbox}");
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
    assert!(all.contains("21 of 28 cards"), "{all}");
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
    assert!(second.contains("21 of 28 cards"), "{second}");
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
    assert!(back.contains("20 of 28 cards"), "{back}");
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("tmp")
        .join(format!("p99-tui-new-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch folder");
    dir
}

fn issue(app: &Run, key: &str) -> crate::wire::Thread {
    app.demo(|demo| demo.thread(key).expect("the sample has the card"))
}

#[test]
fn n_files_a_card_in_the_place_chosen_with_its_kind_details_and_files_and_opens_it() {
    let dir = scratch("files");
    std::fs::write(dir.join("shot.png"), [1, 2, 3]).expect("a picture");
    let mut app = run(sample());
    settled(&mut app);
    let list = app.text();
    assert!(list.contains("n new card"), "{list}");
    let places = app.press("n");
    assert!(places.contains("New card in"), "{places}");
    let rows = [
        "Mobile app",
        "Storefront",
        "Storefront · shop.example.com",
        "A new project…",
    ];
    let at: Vec<usize> = rows.iter().map(|r| row(&places, r)).collect();
    assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "{places}");
    let kinds = app.press("down down enter");
    for kind in ["Kind", "Bug", "Idea", "Improvement", "Question", "Task"] {
        assert!(kinds.contains(kind), "{kind}:\n{kinds}");
    }
    let form = app.press("down enter");
    assert!(
        form.contains("New Idea in Storefront · shop.example.com"),
        "{form}"
    );
    for field in [
        "Title",
        "Details",
        "Files",
        "tab next field",
        "enter file it",
    ] {
        assert!(form.contains(field), "{field}:\n{form}");
    }
    app.press("Gift space cards tab One ¶ Two tab");
    app.paste(&dir.join("shot.png").display().to_string());
    let filed = app.press("enter");
    assert!(
        filed.contains("FEAT-29 filed in Storefront on shop.example.com with 1 file"),
        "{filed}"
    );
    assert!(filed.contains("Cards / FEAT-29"), "{filed}");
    assert!(filed.contains("project Storefront"), "{filed}");
    let card = issue(&app, "FEAT-29");
    assert_eq!(card.issue.kind, "feature");
    assert_eq!(card.issue.title, "Gift cards");
    assert_eq!(card.issue.body, "One\nTwo");
    assert_eq!(card.issue.host.as_deref(), Some("shop.example.com"));
    assert_eq!(card.issue.label.as_deref(), Some("New"));
    assert_eq!(card.attachments.len(), 1);
    let back = app.press("esc");
    assert!(back.contains("22 of 29 cards"), "{back}");
    assert!(back.contains("FEAT-29"), "{back}");
}

#[test]
fn n_offers_the_project_chosen_with_p_first() {
    let mut app = run(sample());
    settled(&mut app);
    app.event(
        INBOX,
        Msg::Projects(Ok(vec!["Mobile app".into(), "Storefront".into()])),
    );
    app.press("down down enter");
    let places = app.press("n");
    let lit = line(&places, "│▌");
    assert!(lit.contains("Storefront") && !lit.contains("·"), "{places}");
}

#[test]
fn a_new_project_needs_its_name_and_every_card_needs_a_title() {
    let mut app = run(sample());
    settled(&mut app);
    let form = app.press("n end enter enter");
    assert!(form.contains("New Bug in a new project"), "{form}");
    assert!(form.contains("Project"), "{form}");
    let unnamed = app.press("enter");
    assert!(unnamed.contains("Name the project first."), "{unnamed}");
    let untitled = app.press("Ops enter");
    assert!(untitled.contains("A card needs a title."), "{untitled}");
    let filed = app.press("tab Rotate space keys enter");
    assert!(filed.contains("BUG-29 filed in Ops"), "{filed}");
    let card = issue(&app, "BUG-29").issue;
    assert_eq!(card.project.as_deref(), Some("Ops"));
    assert_eq!(card.host, None);
    assert!(card.page.path.is_empty());
}

#[test]
fn a_path_that_cannot_be_read_keeps_the_form_open_and_files_nothing() {
    let dir = scratch("gone");
    let mut app = run(sample());
    settled(&mut app);
    app.press("n enter enter Lamp tab tab");
    app.paste(&dir.join("gone.png").display().to_string());
    let refused = app.press("enter");
    assert!(refused.contains("gone.png: "), "{refused}");
    assert!(refused.contains("New Bug in Mobile app"), "{refused}");
    assert!(app.demo(|demo| demo.thread("BUG-29").is_err()));
    let quoted = app.press("ctrl+u 'x enter");
    assert!(
        quoted.contains("a quote around a path is never closed"),
        "{quoted}"
    );
    let closed = app.press("esc");
    assert!(!closed.contains("New Bug in"), "{closed}");
    assert!(closed.contains("21 of 28 cards"), "{closed}");
    assert!(app.demo(|demo| demo.thread("BUG-29").is_err()));
}

#[test]
fn a_refused_card_says_why_in_the_form() {
    let mut app = run(sample());
    settled(&mut app);
    app.press("n enter enter Lamp");
    let text = app.event(
        INBOX,
        Msg::Filed(Err("no project is called Lamp (404)".into())),
    );
    assert!(text.contains("New Bug in Mobile app"), "{text}");
    let late = app.press("esc");
    let said = app.event(INBOX, Msg::Filed(Err("offline".into())));
    assert!(!late.contains("New Bug in"), "{late}");
    assert!(said.contains("offline"), "{said}");
}

#[test]
fn n_on_the_board_files_a_card_into_new() {
    let mut app = run(sample());
    settled(&mut app);
    let board = app.go(BOARD);
    assert!(board.contains("n new card"), "{board}");
    let filed = app.press("n enter enter Lamp enter");
    assert!(filed.contains("BUG-29 filed in Mobile app"), "{filed}");
    assert!(filed.contains("Board / BUG-29"), "{filed}");
    app.press("esc");
    let back = app.advance(Duration::from_secs(1));
    assert!(back.contains("29 cards"), "{back}");
    let new = line(&back, "New 9");
    let first = back.lines().skip_while(|l| !l.contains("New 9")).nth(2);
    assert!(first.is_some_and(|l| l.contains("BUG-29")), "{new}\n{back}");
}

#[test]
fn n_while_typing_a_filter_types_it() {
    let mut app = run(sample());
    settled(&mut app);
    let text = app.press("/ n");
    assert!(!text.contains("New card in"), "{text}");
    assert!(text.contains("Filter n"), "{text}");
}

fn forty() -> Vec<String> {
    (1..=40).map(|n| format!("Project {n:02}")).collect()
}

fn sized(app: &mut Run, (width, height): (u16, u16), keys: &str) -> String {
    for key in dump::keys(keys).expect("every key has a name") {
        app.tui.frame(width, height);
        app.tui.key(key);
        app.tui.settle();
    }
    dump::text(&app.tui.frame(width, height))
}

fn more(text: &str, arrow: char) -> Option<usize> {
    text.match_indices(arrow).find_map(|(at, _)| {
        let rest = text[at + arrow.len_utf8()..].strip_prefix(' ')?;
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        rest[digits..]
            .starts_with(" more")
            .then(|| rest[..digits].parse().ok())
            .flatten()
    })
}

fn picker_fits(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    let Some(top) = lines.iter().position(|line| line.contains("╭ Projects")) else {
        return false;
    };
    let byte = lines[top].find("╭ Projects").unwrap_or(0);
    let column = lines[top][..byte].chars().count();
    let bottom = lines
        .iter()
        .skip(top + 1)
        .position(|line| line.chars().nth(column) == Some('╰'));
    let footer = lines
        .iter()
        .position(|line| line.contains("enter choose or drop"));
    matches!((bottom, footer), (Some(bottom), Some(footer)) if top + 1 + bottom < footer)
}

#[test]
fn forty_projects_fit_the_picker_at_120x34_and_80x24_and_the_last_one_is_reachable_and_picked() {
    for (screen, size, hidden) in [
        (INBOX, (120, 34), 18),
        (INBOX, (80, 24), 28),
        (BOARD, (120, 34), 18),
        (BOARD, (80, 24), 28),
    ] {
        let mut app = run(sample());
        settled(&mut app);
        app.go(screen);
        app.tui.event(screen, Msg::Projects(Ok(forty())));
        app.tui.settle();
        let open = sized(&mut app, size, "");
        assert!(picker_fits(&open), "{open}");
        assert!(open.contains("All projects"), "{open}");
        assert_eq!(more(&open, '↓'), Some(hidden), "{open}");
        assert_eq!(more(&open, '↑'), None, "{open}");
        let paged = sized(&mut app, size, "pgdn down");
        assert!(picker_fits(&paged), "{paged}");
        assert!(more(&paged, '↑').is_some(), "{paged}");
        assert!(more(&paged, '↓').is_some(), "{paged}");
        let back = sized(&mut app, size, "pgup pgup");
        assert!(back.contains("All projects"), "{back}");
        assert_eq!(more(&back, '↑'), None, "{back}");
        let end = sized(&mut app, size, "end");
        assert!(picker_fits(&end), "{end}");
        assert!(end.contains("Project 40"), "{end}");
        assert_eq!(more(&end, '↑'), Some(hidden), "{end}");
        assert_eq!(more(&end, '↓'), None, "{end}");
        let held = sized(&mut app, size, "2 tab");
        assert!(held.contains("Project 40") && picker_fits(&held), "{held}");
        assert_eq!(app.tui.current(), Some(screen));
        let home = sized(&mut app, size, "home");
        assert!(home.contains("All projects"), "{home}");
        assert_eq!(more(&home, '↑'), None, "{home}");
        let picked = sized(&mut app, size, "end enter");
        assert!(!picked.contains("╭ Projects"), "{picked}");
        let narrowed = if screen == INBOX {
            "in Project 40"
        } else {
            "Project 40"
        };
        assert!(picked.contains(narrowed), "{picked}");
        app.tui.event(screen, Msg::Projects(Ok(forty())));
        app.tui.settle();
        let ticked = sized(&mut app, size, "G");
        assert!(ticked.contains("✓ Project 40"), "{ticked}");
        let closed = sized(&mut app, size, "q");
        assert!(!closed.contains("╭ Projects"), "{closed}");
        assert!(closed.contains(narrowed), "{closed}");
    }
}

fn footer(text: &str) -> &str {
    text.lines()
        .find(|line| line.contains("ctrl+c twice quit"))
        .unwrap_or_default()
}

#[test]
fn question_mark_opens_every_key_of_the_screen_and_esc_closes_them() {
    let mut app = run(sample());
    app.press("?");
    app.tui.advance(Duration::from_secs(1));
    let sheet = app.text();
    for said in [
        "Keys",
        "status: open, closed or all",
        "Elsewhere",
        "esc closes it",
    ] {
        assert!(sheet.contains(said), "{said}:\n{sheet}");
    }
    assert!(app.tui.sheet().is_open());
    app.press("esc");
    assert!(!app.tui.sheet().is_open());
}

#[test]
fn the_footer_shows_the_keys_of_the_tab_and_the_card_in_front() {
    let mut app = run(sample());
    let cards = app.text();
    for hint in ["↑↓ move", "? help", "s status", "n new card"] {
        assert!(footer(&cards).contains(hint), "{hint}:\n{cards}");
    }
    let board = app.go(BOARD);
    for hint in ["←→↑↓ move", "space pick up", "enter open"] {
        assert!(footer(&board).contains(hint), "{hint}:\n{board}");
    }
    assert!(!footer(&board).contains("s status"), "{board}");
    let carrying = app.press("space");
    assert!(footer(&carrying).contains("←→↑↓ carry"), "{carrying}");
    assert!(footer(&carrying).contains("esc put back"), "{carrying}");
    app.press("esc");
    let codes = app.go(CODES);
    assert!(footer(&codes).contains("/ filter"), "{codes}");
    assert!(!footer(&codes).contains("n new card"), "{codes}");
    app.go(INBOX);
    let card = app.press("enter");
    for hint in ["r reply", "esc back", "e edit", "i internal off"] {
        assert!(footer(&card).contains(hint), "{hint}:\n{card}");
    }
    let internal = app.press("i");
    assert!(footer(&internal).contains("i internal on"), "{internal}");
    let back = app.press("esc");
    assert!(footer(&back).contains("s status"), "{back}");
}

#[test]
fn question_mark_opens_the_keys_while_a_card_is_carried_or_the_projects_are_open() {
    let mut app = run(sample());
    app.go(BOARD);
    let carrying = app.press("space");
    assert!(footer(&carrying).contains("? help"), "{carrying}");
    app.press("?");
    app.tui.advance(Duration::from_secs(1));
    let sheet = app.text();
    assert!(app.tui.sheet().is_open(), "{sheet}");
    assert!(sheet.contains("carrying a card"), "{sheet}");
    app.press("esc");
    assert!(!app.tui.sheet().is_open());
    app.tui.advance(Duration::from_secs(1));
    let still = app.text();
    assert!(footer(&still).contains("←→↑↓ carry"), "{still}");
    let put_back = app.press("esc");
    assert!(footer(&put_back).contains("space pick up"), "{put_back}");
    app.go(INBOX);
    let picker = app.press("p");
    assert!(picker.contains("Projects"), "{picker}");
    assert!(footer(&picker).contains("? help"), "{picker}");
    app.press("?");
    assert!(app.tui.sheet().is_open());
    app.press("esc");
    assert!(!app.tui.sheet().is_open());
    app.tui.advance(Duration::from_secs(1));
    let still = app.text();
    assert!(still.contains("Projects"), "{still}");
    let closed = app.press("esc");
    assert!(footer(&closed).contains("s status"), "{closed}");
}

#[test]
fn a_tab_in_the_back_never_takes_the_keys_of_the_tab_in_front() {
    let mut app = run(sample());
    app.go(BOARD);
    app.go(CODES);
    let codes = app.event(INBOX, Msg::Labels(Ok(Vec::new())));
    assert!(footer(&codes).contains("/ filter"), "{codes}");
    assert!(!footer(&codes).contains("n new card"), "{codes}");
    let codes = app.event(BOARD, Msg::Labels(Ok(Vec::new())));
    assert!(!footer(&codes).contains("space pick up"), "{codes}");
}

use pito_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use pito_tui::keys::Mods;

use super::*;

fn press(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn hints(place: &Seat) -> Vec<String> {
    KEYS.hints(place.now())
        .iter()
        .map(ToString::to_string)
        .collect()
}

fn shows(place: &Seat, hint: &str) -> bool {
    hints(place).iter().any(|shown| shown == hint)
}

fn act(place: &Seat, code: KeyCode) -> Option<Act> {
    action(place.now(), &press(code)).map(|(act, _)| act)
}

#[test]
fn no_two_keys_answer_the_same_chord_in_the_same_place() {
    let clashes: Vec<String> = KEYS.clashes().iter().map(ToString::to_string).collect();
    assert!(clashes.is_empty(), "{clashes:#?}");
}

#[test]
fn the_modes_run_in_the_order_the_app_shows_them() {
    assert_eq!(
        KEYS.order(),
        [CARDS, CARD, BOARD, CARRYING, CODES, PROJECTS]
    );
}

#[test]
fn every_place_offers_help_in_its_hints() {
    for mode in [CARDS, CARD, BOARD, CARRYING, CODES, PROJECTS] {
        let place = Seat::new(mode);
        assert!(shows(&place, "? help"), "{mode:?}: {:?}", hints(&place));
    }
}

#[test]
fn the_cards_list_shows_its_keys_only_once_read() {
    let unread = Seat::new(CARDS);
    assert_eq!(hints(&unread), ["? help", "r read again"]);
    assert_eq!(act(&unread, KeyCode::Char('s')), None);
    assert_eq!(act(&unread, KeyCode::Char('r')), Some(Act::Reload));
    let read = Seat::new(CARDS).with(READ, true).with(FREE, true);
    for hint in [
        "↑↓ move",
        "enter open",
        "/ filter",
        "s status",
        "n new card",
        "p projects",
        "w needs you",
    ] {
        assert!(shows(&read, hint), "{hint}: {:?}", hints(&read));
    }
    assert!(!shows(&read, "h host"));
    assert_eq!(act(&read, KeyCode::Char('s')), Some(Act::Status));
    assert_eq!(act(&read, KeyCode::Char('h')), None);
    assert_eq!(act(&read, KeyCode::Char('S')), None);
}

#[test]
fn the_list_wide_keys_wait_while_something_else_is_open() {
    let busy = Seat::new(CARDS).with(READ, true);
    assert_eq!(act(&busy, KeyCode::Char('n')), None);
    assert!(!shows(&busy, "n new card"));
    let free = busy.with(FREE, true);
    assert_eq!(act(&free, KeyCode::Char('n')), Some(Act::NewCard));
    assert_eq!(act(&free, KeyCode::Char('p')), Some(Act::Projects));
    assert_eq!(act(&free, KeyCode::Char('w')), Some(Act::NeedsYou));
}

#[test]
fn esc_clears_the_filter_or_the_projects_whichever_holds() {
    let filtered = Seat::new(CARDS).with(READ, true).with(FILTERED, true);
    assert_eq!(act(&filtered, KeyCode::Esc), Some(Act::List));
    assert!(shows(&filtered, "esc clear filter"));
    let chosen = Seat::new(CARDS).with(READ, true).with(CHOSEN, true);
    assert_eq!(act(&chosen, KeyCode::Esc), Some(Act::AllProjects));
    assert!(shows(&chosen, "esc all projects"));
    assert_eq!(act(&Seat::new(CARDS).with(READ, true), KeyCode::Esc), None);
}

#[test]
fn a_card_changes_only_while_nothing_is_saving() {
    let saving = Seat::new(CARD).with(READ, true).with(OUTWARD, true);
    assert_eq!(act(&saving, KeyCode::Char('r')), None);
    assert_eq!(act(&saving, KeyCode::Char('o')), Some(Act::Browse));
    assert!(!shows(&saving, "r reply"));
    let ready = saving.with(READY, true);
    assert_eq!(act(&ready, KeyCode::Char('r')), Some(Act::Reply));
    assert_eq!(act(&ready, KeyCode::Char('d')), Some(Act::Delete));
    assert_eq!(act(&ready, KeyCode::Char('f')), Some(Act::SaveFile));
    assert!(!shows(&ready, "f save file"));
    assert!(shows(&ready, "r reply"));
}

#[test]
fn ctrl_r_reads_a_card_again_even_before_it_is_read() {
    let ctrl_r = KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL);
    let unread = Seat::new(CARD);
    assert_eq!(
        action(unread.now(), &ctrl_r).map(|(act, _)| act),
        Some(Act::ReadAgain)
    );
    assert_eq!(hints(&unread), ["esc back", "? help", "ctrl+r read again"]);
}

#[test]
fn the_internal_hint_says_which_way_replies_go() {
    let outward = Seat::new(CARD).with(READ, true).with(OUTWARD, true);
    let inward = Seat::new(CARD).with(READ, true).with(INTERNAL, true);
    assert!(shows(&outward, "i internal off"));
    assert!(!shows(&outward, "i internal on"));
    assert!(shows(&inward, "i internal on"));
    assert!(!shows(&inward, "i internal off"));
    assert_eq!(act(&inward, KeyCode::Char('i')), Some(Act::Internal));
    assert_eq!(act(&outward, KeyCode::Char('i')), Some(Act::Internal));
}

#[test]
fn a_card_with_files_offers_to_save_one() {
    let files = Seat::new(CARD)
        .with(READ, true)
        .with(READY, true)
        .with(FILES, true);
    assert!(shows(&files, "f save file"));
    assert_eq!(act(&files, KeyCode::Char('f')), Some(Act::SaveFile));
}

#[test]
fn a_card_scrolls_by_line_page_and_end() {
    let read = Seat::new(CARD).with(READ, true);
    assert_eq!(act(&read, KeyCode::Char('j')), Some(Act::Scroll));
    assert_eq!(act(&read, KeyCode::PageDown), Some(Act::Page));
    assert_eq!(act(&read, KeyCode::Char(' ')), Some(Act::Page));
    assert_eq!(act(&read, KeyCode::Char('g')), Some(Act::Top));
    assert_eq!(act(&read, KeyCode::Char('G')), Some(Act::Bottom));
    assert!(shows(&read, "↑↓ scroll"));
}

#[test]
fn the_board_moves_carries_and_drops() {
    let board = Seat::new(BOARD).with(READ, true).with(HERE, true);
    assert_eq!(act(&board, KeyCode::Char('l')), Some(Act::Step));
    assert_eq!(act(&board, KeyCode::Char(' ')), Some(Act::PickUp));
    assert_eq!(act(&board, KeyCode::Enter), Some(Act::Open));
    let empty = Seat::new(BOARD).with(READ, true);
    assert_eq!(act(&empty, KeyCode::Char(' ')), None);
    assert!(!shows(&empty, "space pick up"));
    let carrying = Seat::new(CARRYING);
    assert_eq!(act(&carrying, KeyCode::Char(' ')), Some(Act::Drop));
    assert_eq!(act(&carrying, KeyCode::Enter), Some(Act::Drop));
    assert_eq!(act(&carrying, KeyCode::Esc), Some(Act::PutBack));
    assert_eq!(act(&carrying, KeyCode::Char('r')), None);
    assert!(shows(&carrying, "←→↑↓ carry"));
    assert!(shows(&carrying, "enter drop"));
}

#[test]
fn a_live_code_still_answers_d_but_shows_it_only_when_revoked() {
    let live = Seat::new(CODES).with(READ, true);
    assert_eq!(act(&live, KeyCode::Char('d')), Some(Act::Delete));
    assert!(!hints(&live).iter().any(|hint| hint.starts_with("d ")));
    let revoked = live.with(REVOKED, true);
    assert!(shows(&revoked, "d delete"));
}

#[test]
fn shift_s_switches_space_where_there_are_spaces() {
    for mode in [CARDS, BOARD, CODES] {
        let place = Seat::new(mode).with(SPACES, true);
        let shift_s = KeyEvent::new(KeyCode::Char('S'), KeyModifiers::SHIFT);
        assert_eq!(
            action(place.now(), &shift_s).map(|(act, _)| act),
            Some(Act::Space),
            "{mode:?}"
        );
        assert!(shows(&place, "S space"), "{mode:?}");
        assert_eq!(act(&Seat::new(mode), KeyCode::Char('S')), None);
    }
}

#[test]
fn up_and_k_and_h_scroll_back() {
    for (key, up) in [
        (Key::Up, true),
        (Key::Left, true),
        (Key::Char('k'), true),
        (Key::Char('h'), true),
        (Key::Down, false),
        (Key::Char('j'), false),
        (Key::Char('l'), false),
    ] {
        assert_eq!(back(Chord::new(key, Mods::NONE)), up, "{key:?}");
    }
}

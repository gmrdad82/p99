use std::time::Duration;

use pito_tui::dump;
use pito_tui::ratatui::style::Color;
use serde_json::json;

use crate::wire::{Change, LaneCard, Owner};

use super::super::deck::{self, BoardCard, Lane, Moved, default_lanes};
use super::super::tests::{BOARD, HIGH, Run, WIDE, line, palette, row, run, sample, spot, waiting};
use super::super::waiting::Around;
use super::*;

const NEW_LANE: [&str; 8] = [
    "FEAT-9", "Q-10", "BUG-11", "FEAT-13", "BUG-15", "FEAT-19", "TASK-22", "FEAT-23",
];
const DOING_LANE: [&str; 6] = ["IMP-5", "TASK-6", "FEAT-7", "BUG-8", "TASK-16", "TASK-20"];
const HEADS: [&str; 7] = [
    "New 8",
    "Planned 1",
    "In progress 6",
    "Needs you 1",
    "Stuck 1",
    "Landed 4",
    "Done 7",
];

fn board(app: &Run) -> &Board {
    &app.tui
        .find::<Around<Board>>()
        .expect("the board is a screen")
        .inner
}

fn board_mut(app: &mut Run) -> &mut Board {
    &mut app
        .tui
        .find_mut::<Around<Board>>()
        .expect("the board is a screen")
        .inner
}

fn shown() -> Run {
    let mut app = run(sample());
    app.text();
    app.advance(Duration::from_secs(1));
    app.go(BOARD);
    app
}

fn word(label: &str) -> Lane {
    deck::LANES
        .iter()
        .find(|lane| lane.1 == label)
        .map(|lane| lane.0)
        .unwrap_or_else(|| panic!("{label} is a lane"))
}

fn lane(app: &Run, label: &str) -> Vec<String> {
    let board = board(app);
    let view = board.view.as_ref().expect("a board is shown");
    let at = view.lane(word(label)).expect("the board has the lane");
    board.lane_ids()[at]
        .iter()
        .map(|&index| view.cards[index].key.clone())
        .collect()
}

fn saved(app: &Run, label: &str) -> Vec<String> {
    let want = word(label);
    app.demo(|demo| {
        demo.one_board(&[])
            .cards
            .into_iter()
            .filter(|card| card.status == want)
            .map(|card| card.card.key)
            .collect()
    })
}

fn current(app: &Run) -> Option<String> {
    board(app).current().map(|card| card.key.clone())
}

fn tap(app: &mut Run, keys: &str) {
    for key in dump::keys(keys).expect("every key has a name") {
        app.tui.key(key);
    }
}

fn hit(app: &Run, key: &str) -> Rect {
    let id = format!("0/{key}");
    board(app)
        .hits
        .iter()
        .find(|(at, _)| *at == id)
        .map(|(_, rect)| *rect)
        .unwrap_or_else(|| panic!("{key} is drawn whole"))
}

fn heard(app: &mut Run, account: usize, event: serde_json::Value) -> String {
    app.event(BOARD, Msg::Heard(account, event.to_string()))
}

fn card(key: &str, label: &str, who: Option<&str>) -> Card {
    let lane = deck::LANES
        .iter()
        .find(|lane| lane.1 == label)
        .copied()
        .unwrap_or(deck::LANES[0]);
    Card::new(
        0,
        BoardCard {
            key: key.into(),
            kind: "bug".into(),
            project: None,
            status: lane.0,
            label: label.into(),
            lane: Some(1),
            title: "A short title".into(),
            host: "example.com".into(),
            assignee: who.map(str::to_owned),
            order: None,
            changed_at: "2026-10-22T08:00:00.000Z".into(),
            changed_by: None,
        },
    )
}

fn moved(key: &str, label: &str, order: &str) -> Moved {
    Moved {
        card: LaneCard {
            key: key.into(),
            kind: "bug".into(),
            title: "A short title".into(),
            label: label.into(),
            assignee: None::<Owner>,
            order: Some(order.into()),
        },
    }
}

fn rows(buffer: &Buffer) -> Vec<String> {
    let mut rows: Vec<String> = dump::text(buffer).lines().map(str::to_owned).collect();
    rows.resize(buffer.area.height as usize, String::new());
    rows
}

#[test]
fn the_one_board_shows_seven_lanes_with_every_item_in_lane_order() {
    let mut app = shown();
    let text = app.text();
    for head in HEADS {
        assert!(text.contains(head), "{head}:\n{text}");
    }
    for fact in ["sample", "28 items", "7/28 done", "sample data"] {
        assert!(text.contains(fact), "{fact}:\n{text}");
    }
    for gone in ["Shop", "QA ready", "Testing", "b boards", "watching"] {
        assert!(!text.contains(gone), "{gone}:\n{text}");
    }
    assert_eq!(lane(&app, "New"), NEW_LANE);
    assert_eq!(lane(&app, "Planned"), ["TASK-24"]);
    assert_eq!(lane(&app, "In progress"), DOING_LANE);
    assert_eq!(lane(&app, "Needs you"), ["BUG-25"]);
    assert_eq!(lane(&app, "Stuck"), ["BUG-26"]);
    assert_eq!(
        lane(&app, "Landed"),
        ["IMP-4", "BUG-14", "IMP-17", "FEAT-27"]
    );
    assert_eq!(
        lane(&app, "Done"),
        [
            "BUG-1", "BUG-2", "BUG-3", "BUG-12", "TASK-18", "TASK-21", "TASK-28"
        ]
    );
    let tops: Vec<usize> = NEW_LANE[..5]
        .iter()
        .map(|key| row(&text, &format!(" {key} ")))
        .collect();
    assert!(
        tops.windows(2).all(|pair| pair[1] == pair[0] + 5),
        "{tops:?}\n{text}"
    );
    assert_eq!(row(&text, " FEAT-9 "), row(&text, " IMP-5 "));
    assert_eq!(row(&text, " FEAT-9 "), row(&text, " BUG-25 "));
    let buffer = app.frame();
    let new = spot(&buffer, " FEAT-9 ", " FEAT-9 ");
    let doing = spot(&buffer, " IMP-5 ", " IMP-5 ");
    let needs = spot(&buffer, " BUG-25 ", " BUG-25 ");
    assert!(new.0 < doing.0 && doing.0 < needs.0);
    let (_, y) = spot(&buffer, " TASK-6 ", " TASK-6 ");
    let lane = board(&app).lanes[2];
    let bottom: String = (lane.x..lane.x + lane.width)
        .map(|x| buffer[(x, y + 3)].symbol())
        .collect();
    assert!(bottom.contains(" @ada.lovelace "), "{bottom}");
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
}

#[test]
fn a_card_shows_its_project_on_its_bottom_edge_and_a_plain_item_none() {
    let mut app = shown();
    let buffer = app.frame();
    let (_, y) = spot(&buffer, " BUG-25 ", " BUG-25 ");
    let needs = board(&app).lanes[3];
    let bottom: String = (needs.x..needs.x + needs.width)
        .map(|x| buffer[(x, y + 3)].symbol())
        .collect();
    assert!(bottom.starts_with("╰─ Storefront "), "{bottom}");
    let column = bottom.chars().take_while(|&c| c != 'S').count();
    let at = (needs.x + column as u16, y + 3);
    assert_eq!(buffer[at].symbol(), "S");
    assert_eq!(Some(buffer[at].fg), palette().accent.fg);
    let (_, y) = spot(&buffer, " FEAT-9 ", " FEAT-9 ");
    let new = board(&app).lanes[0];
    let plain: String = (new.x..new.x + new.width)
        .map(|x| buffer[(x, y + 3)].symbol())
        .collect();
    assert!(plain.chars().all(|c| "╰─╯".contains(c)), "{plain}");
}

#[test]
fn the_selected_card_is_lit_and_done_cards_read_muted() {
    let mut app = shown();
    let buffer = app.frame();
    let accent = app.palette.accent.fg.expect("the accent has a colour");
    let lit = spot(&buffer, " FEAT-9 ", " FEAT-9 ");
    assert_eq!(buffer[(lit.0 + 1, lit.1)].fg, accent);
    assert!(buffer[(lit.0 + 1, lit.1)].modifier.contains(Modifier::BOLD));
    assert_eq!(buffer[(lit.0 - 2, lit.1)].symbol(), "╭");
    assert_eq!(buffer[(lit.0 - 2, lit.1)].fg, accent);
    assert!(!buffer[(lit.0 - 2, lit.1)].modifier.contains(Modifier::BOLD));
    let plain = spot(&buffer, " Q-10 ", " Q-10 ");
    assert_eq!(buffer[(plain.0 + 1, plain.1)].fg, Color::Reset);
    assert!(
        buffer[(plain.0 + 1, plain.1)]
            .modifier
            .contains(Modifier::BOLD)
    );
    let done = spot(&buffer, "Logo looks", "Logo looks");
    assert!(buffer[done].modifier.contains(Modifier::DIM));
    let open = spot(&buffer, "Is the newsletter", "Is the newsletter");
    assert!(!buffer[open].modifier.contains(Modifier::DIM));
}

#[test]
fn arrows_and_vim_keys_walk_the_seven_lanes_and_stop_at_the_edges() {
    let mut app = shown();
    let walk = [
        ("right", "TASK-24"),
        ("right", "IMP-5"),
        ("down down", "FEAT-7"),
        ("right", "BUG-25"),
        ("right", "BUG-26"),
        ("right", "IMP-4"),
        ("down down down down", "FEAT-27"),
        ("right", "BUG-1"),
        ("right", "BUG-1"),
        ("G", "TASK-28"),
        ("g", "BUG-1"),
        ("up k", "BUG-1"),
        ("left", "FEAT-27"),
        ("h h h", "FEAT-7"),
        ("j", "BUG-8"),
        ("k", "FEAT-7"),
        ("h h", "FEAT-9"),
        ("h left", "FEAT-9"),
        ("end", "FEAT-23"),
        ("home", "FEAT-9"),
    ];
    for (keys, want) in walk {
        app.press(keys);
        assert_eq!(current(&app).as_deref(), Some(want), "after {keys}");
    }
    assert!(board(&app).lift.is_none());
}

#[test]
fn b_opens_no_picker_and_the_hints_name_no_boards() {
    let mut app = shown();
    let text = app.press("b");
    assert!(!text.contains("b boards"), "{text}");
    assert_eq!(lane(&app, "New"), NEW_LANE);
    for hint in ["space pick up", "enter open", "p projects", "w needs you"] {
        assert!(text.contains(hint), "{hint}:\n{text}");
    }
}

#[test]
fn space_picks_any_card_up_arrows_carry_it_and_enter_drops_and_saves_it() {
    let mut app = shown();
    let lifted = app.press("space");
    assert!(board(&app).typing());
    for hint in ["carry", "enter drop", "esc put back"] {
        assert!(lifted.contains(hint), "{hint}:\n{lifted}");
    }
    assert!(!lifted.contains("w needs you"), "{lifted}");
    assert!(lifted.contains('╔'), "{lifted}");
    let carried = app.press("right");
    assert!(carried.contains('━'), "{carried}");
    assert!(carried.contains("Planned 2"), "{carried}");
    assert!(carried.contains("New 7"), "{carried}");
    let dropped = app.press("enter");
    assert!(board(&app).lift.is_none());
    assert!(!board(&app).typing());
    assert!(!dropped.contains("saving…"), "{dropped}");
    assert_eq!(lane(&app, "Planned"), ["FEAT-9", "TASK-24"]);
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
    assert_eq!(saved(&app, "Planned"), ["FEAT-9", "TASK-24"]);
    let issue = app.demo(|demo| demo.thread("FEAT-9").expect("the sample has it").issue);
    assert_eq!(issue.label.as_deref(), Some("Planned"));
    assert_eq!(issue.status, "doing");
}

#[test]
fn a_card_carried_into_needs_you_lands_there_on_the_server_too() {
    let mut app = shown();
    app.press("space right right right enter");
    assert_eq!(lane(&app, "Needs you"), ["FEAT-9", "BUG-25"]);
    assert_eq!(saved(&app, "Needs you"), ["FEAT-9", "BUG-25"]);
}

#[test]
fn a_card_dropped_between_two_cards_lands_between_them_on_the_server_too() {
    let mut app = shown();
    app.press("space right right down down enter");
    let want = [
        "IMP-5", "TASK-6", "FEAT-9", "FEAT-7", "BUG-8", "TASK-16", "TASK-20",
    ];
    assert_eq!(lane(&app, "In progress"), want);
    assert_eq!(saved(&app, "In progress"), want);
}

#[test]
fn a_card_carried_past_the_last_lane_and_row_drops_at_the_end_and_closes() {
    let mut app = shown();
    app.press("space left up right right right right right right right right G");
    assert_eq!(board(&app).lift.as_ref().map(|l| l.to), Some((6, 7)));
    let text = app.press("enter");
    assert_eq!(
        lane(&app, "Done").last().map(String::as_str),
        Some("FEAT-9")
    );
    assert_eq!(
        saved(&app, "Done").last().map(String::as_str),
        Some("FEAT-9")
    );
    let issue = app.demo(|demo| demo.thread("FEAT-9").expect("the sample has it").issue);
    assert_eq!(issue.status, "done");
    assert_eq!(issue.resolution.as_deref(), Some("fixed"));
    assert!(text.contains("8/28 done"), "{text}");
}

#[test]
fn esc_puts_a_carried_card_back_where_it_was() {
    let mut app = shown();
    app.press("down space right right esc");
    assert!(board(&app).lift.is_none());
    assert_eq!(lane(&app, "New"), NEW_LANE);
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    assert_eq!(saved(&app, "New"), NEW_LANE);
}

#[test]
fn dropping_a_card_where_it_was_picked_up_saves_nothing() {
    let mut app = shown();
    let events = app.demo(|demo| {
        demo.thread("FEAT-9")
            .expect("the sample has it")
            .events
            .len()
    });
    app.press("space enter space right left enter");
    assert!(board(&app).lift.is_none());
    assert_eq!(board(&app).sending, 0);
    assert_eq!(lane(&app, "New"), NEW_LANE);
    assert_eq!(
        app.demo(|demo| demo
            .thread("FEAT-9")
            .expect("the sample has it")
            .events
            .len()),
        events
    );
}

#[test]
fn a_card_moved_elsewhere_meanwhile_gives_the_409_line_and_the_board_reads_again() {
    let mut app = shown();
    app.press("space");
    let change = Change {
        status: Some("doing".into()),
        ..Change::default()
    };
    app.source
        .change(0, None, "FEAT-9", &change)
        .expect("the sample takes the change");
    let text = app.press("right right right right right enter");
    assert!(text.contains(deck::MOVED), "{text}");
    assert!(lane(&app, "In progress").contains(&"FEAT-9".to_owned()));
    assert!(!lane(&app, "Landed").contains(&"FEAT-9".to_owned()));
    assert_eq!(board(&app).sending, 0);
}

#[test]
fn a_move_that_fails_otherwise_says_why_and_the_board_reads_again() {
    let mut app = shown();
    app.press("space right enter");
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    let text = app.event(
        BOARD,
        Msg::Shifted("0/FEAT-9".into(), Err("the Worker is down".into())),
    );
    assert!(text.contains("the Worker is down"), "{text}");
    assert!(!lane(&app, "New").contains(&"TASK-22".to_owned()));
}

#[test]
fn a_saved_move_to_a_lane_the_board_lacks_takes_the_card_off() {
    let mut app = shown();
    app.event(
        BOARD,
        Msg::Shifted("0/FEAT-9".into(), Ok(moved("FEAT-9", "Shipped", "a0"))),
    );
    assert!(!lane(&app, "New").contains(&"FEAT-9".to_owned()));
    app.event(
        BOARD,
        Msg::Shifted("0/Q-10".into(), Ok(moved("Q-10", "Done", "0"))),
    );
    assert_eq!(lane(&app, "Done")[0], "Q-10");
    let card = &board(&app).view.as_ref().expect("a board").cards;
    let q = card
        .iter()
        .find(|c| c.key == "Q-10")
        .expect("Q-10 is shown");
    assert_eq!((q.status, q.order.as_deref()), (Lane::Done, Some("0")));
}

#[test]
fn an_account_whose_worker_lacks_the_board_gets_one_line_above_the_lanes() {
    let mut app = shown();
    let mut view = app.demo(|demo| demo.one_board(&[]));
    let line_of = deck::behind("blog", Some("1.9.4"));
    view.missing.push(line_of.clone());
    let text = app.event(BOARD, Msg::Board(Vec::new(), Ok(view)));
    assert!(
        text.contains("blog: its Worker is P99 1.9.4, the board needs"),
        "{text}"
    );
    assert!(
        text.contains("p99 deploy --account blog upgrades it"),
        "{text}"
    );
    assert!(
        row(&text, "blog: its Worker") < row(&text, "New 8"),
        "{text}"
    );
    assert_eq!(lane(&app, "New"), NEW_LANE);
    let alone = BoardView {
        lanes: default_lanes(),
        cards: Vec::new(),
        missing: vec![line_of],
    };
    let empty = app.event(BOARD, Msg::Board(Vec::new(), Ok(alone)));
    assert!(empty.contains("blog: its Worker"), "{empty}");
    assert!(empty.contains("New 0"), "{empty}");
    assert!(empty.contains("no cards"), "{empty}");
}

#[test]
fn cards_of_several_accounts_share_the_lanes_and_name_their_account() {
    let mut app = shown();
    board_mut(&mut app).names = vec!["shop".into(), "blog".into()];
    let mut view = app.demo(|demo| demo.one_board(&[]));
    let mut other = card("FEAT-9", "Stuck", None);
    other.account = 1;
    other.id = "1/FEAT-9".into();
    view.cards.push(other);
    let text = app.event(BOARD, Msg::Board(Vec::new(), Ok(view)));
    assert!(text.contains("Stuck 2"), "{text}");
    assert!(text.contains("shop, blog"), "{text}");
    assert!(line(&text, " FEAT-9 ").contains(" shop "), "{text}");
    assert_eq!(lane(&app, "Stuck"), ["BUG-26", "FEAT-9"]);
    heard(
        &mut app,
        1,
        json!({"type": "label", "key": "FEAT-9", "to": "Landed"}),
    );
    assert_eq!(lane(&app, "Stuck"), ["BUG-26"]);
    assert_eq!(lane(&app, "New")[0], "FEAT-9");
    assert!(lane(&app, "Landed").contains(&"FEAT-9".to_owned()));
}

#[test]
fn a_failed_board_read_says_why_and_r_reads_again() {
    let mut app = run(Source::Broken("no account yet; p99 setup makes one".into()));
    let text = app.go(BOARD);
    for said in [
        "Couldn't read the board.",
        "no account yet; p99 setup makes one",
        "r reads it again · p99 tui --demo shows sample data",
        "r read again",
    ] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
    let again = app.press("r space b enter");
    assert!(again.contains("Couldn't read the board."), "{again}");
}

#[test]
fn a_failed_reread_keeps_the_board_and_says_why() {
    let mut app = shown();
    let text = app.event(BOARD, Msg::Board(Vec::new(), Err("offline".into())));
    assert!(text.contains("offline"), "{text}");
    assert!(text.contains("New 8"), "{text}");
}

#[test]
fn esc_while_the_board_loads_stops_waiting_a_late_result_still_shows_and_r_reads_it() {
    let mut app = waiting(sample());
    app.tui.go(BOARD);
    assert_eq!(
        board(&app).phase(),
        Phase::Loading("Reading the board…".into())
    );
    tap(&mut app, "esc");
    let stopped = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(
        stopped.contains("Stopped waiting for the board."),
        "{stopped}"
    );
    app.tui.settle();
    let late = app.text();
    assert!(late.contains("New 8"), "{late}");
    assert!(!late.contains("Stopped waiting"), "{late}");
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    let read = app.press("r");
    assert!(read.contains("New 7"), "{read}");
}

#[test]
fn r_reads_the_board_again() {
    let mut app = shown();
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    tap(&mut app, "r");
    let reading = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(reading.contains("reading…"), "{reading}");
    app.tui.settle();
    let text = app.text();
    assert!(text.contains("New 7"), "{text}");
    assert!(!text.contains("reading…"), "{text}");
}

#[test]
fn live_label_and_order_events_move_cards_in_place_and_keep_the_selection() {
    let mut app = shown();
    let moved = heard(
        &mut app,
        0,
        json!({"type": "label", "key": "FEAT-9", "from": "New", "to": "Done", "host": "shop.example.com"}),
    );
    assert!(moved.contains("New 7"), "{moved}");
    assert!(moved.contains("Done 8"), "{moved}");
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
    assert_eq!(board(&app).column, 6);
    heard(
        &mut app,
        0,
        json!({"type": "order", "board": 3, "key": "TASK-22", "order": "0", "host": "shop.example.com"}),
    );
    assert_eq!(lane(&app, "New")[0], "TASK-22");
    let before = lane(&app, "New");
    let last = before.last().expect("the lane has cards").clone();
    heard(
        &mut app,
        0,
        json!({"type": "order", "board": "1", "key": last, "order": "!", "host": "shop.example.com"}),
    );
    let after = lane(&app, "New");
    assert_eq!(after[0], last);
    assert_eq!(after[1], "TASK-22");
    assert_eq!(after.len(), before.len());
    heard(&mut app, 0, json!({"type": "delete", "key": "Q-10"}));
    assert!(!lane(&app, "New").contains(&"Q-10".to_owned()));
    heard(&mut app, 1, json!({"type": "delete", "key": "BUG-11"}));
    assert!(lane(&app, "New").contains(&"BUG-11".to_owned()));
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "BUG-11", "to": "Shipped"}),
    );
    assert!(!lane(&app, "New").contains(&"BUG-11".to_owned()));
    assert!(board(&app).stale.is_none());
    let kept = lane(&app, "New");
    heard(
        &mut app,
        1,
        json!({"type": "order", "key": "FEAT-13", "order": "!"}),
    );
    assert_eq!(lane(&app, "New"), kept);
    assert!(board(&app).stale.is_some());
}

#[test]
fn a_lane_left_empty_says_no_cards() {
    let mut app = shown();
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "TASK-24", "to": "Done"}),
    );
    let text = app.text();
    assert!(text.contains("Planned 0"), "{text}");
    assert!(text.contains("no cards"), "{text}");
}

#[test]
fn an_unknown_card_arriving_reads_the_board_again_after_a_quiet_moment() {
    let mut app = shown();
    if let Some(view) = board_mut(&mut app).view.as_mut() {
        view.cards.retain(|card| card.key != "TASK-22");
    }
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "TASK-22", "from": "New", "to": "New"}),
    );
    assert!(board(&app).stale.is_some());
    assert!(!lane(&app, "New").contains(&"TASK-22".to_owned()));
    app.advance(QUIET - Duration::from_millis(1));
    assert!(!lane(&app, "New").contains(&"TASK-22".to_owned()));
    let text = app.advance(Duration::from_millis(1));
    assert!(lane(&app, "New").contains(&"TASK-22".to_owned()));
    assert!(text.contains("New 8"), "{text}");
    assert!(board(&app).stale.is_none());
}

#[test]
fn unreadable_or_unknown_events_ask_for_one_reread() {
    let mut app = shown();
    let before = lane(&app, "New");
    app.event(BOARD, Msg::Heard(0, "not json".into()));
    assert!(board(&app).stale.is_none());
    heard(&mut app, 0, json!({"type": "comment", "key": "Q-10"}));
    let due = board(&app).stale.expect("a reread is due");
    heard(&mut app, 0, json!({"type": "assignee", "key": "BUG-11"}));
    assert_eq!(board(&app).stale, Some(due));
    assert_eq!(lane(&app, "New"), before);
}

#[test]
fn a_push_without_a_key_reads_the_board_again_at_once() {
    let mut app = shown();
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    app.event(BOARD, Msg::Pushed(0, None));
    let text = app.advance(Duration::ZERO);
    assert!(text.contains("New 7"), "{text}");
    app.event(BOARD, Msg::Pushed(0, Some("FEAT-9".into())));
    assert!(board(&app).stale.is_none());
}

#[test]
fn a_carried_card_that_moves_or_goes_elsewhere_is_put_down() {
    let mut app = shown();
    app.press("space right");
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "FEAT-9", "to": "Done"}),
    );
    assert!(board(&app).lift.is_none());
    assert!(lane(&app, "Done").contains(&"FEAT-9".to_owned()));
    app.press("h h h h h h h g");
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    app.press("space");
    heard(&mut app, 0, json!({"type": "delete", "key": "Q-10"}));
    assert!(board(&app).lift.is_none());
    app.press("space down");
    heard(
        &mut app,
        0,
        json!({"type": "order", "key": "BUG-15", "order": "0"}),
    );
    assert!(board(&app).lift.is_some());
    assert_eq!(lane(&app, "New")[0], "BUG-15");
}

#[test]
fn enter_reads_the_card_as_a_thread_and_esc_comes_back_to_the_board() {
    let mut app = shown();
    let thread = app.press("enter");
    assert_eq!(board(&app).crumb().as_deref(), Some("FEAT-9"));
    assert!(
        thread.contains("FEAT-9  Dark mode for the blog"),
        "{thread}"
    );
    assert!(thread.contains("r reply"), "{thread}");
    app.mouse(MouseEventKind::ScrollDown, 10, 10);
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
    let back = app.press("esc");
    assert_eq!(board(&app).crumb(), None);
    assert!(back.contains("New 8"), "{back}");
}

#[test]
fn a_card_of_a_second_account_opens_its_own_thread() {
    let mut app = shown();
    let mut other = card("BUG-90", "New", None);
    other.account = 1;
    other.id = "1/BUG-90".into();
    other.order = Some("!".into());
    let view = BoardView {
        lanes: default_lanes(),
        cards: vec![other],
        missing: Vec::new(),
    };
    app.event(BOARD, Msg::Board(Vec::new(), Ok(view)));
    let text = app.press("enter");
    assert_eq!(board(&app).crumb().as_deref(), Some("BUG-90"));
    assert!(text.contains("no item is called BUG-90"), "{text}");
}

#[test]
fn a_reply_from_the_board_lands_on_the_card() {
    let mut app = shown();
    app.press("enter r");
    assert!(board(&app).typing());
    app.paste("On it");
    let sent = app.press("enter");
    assert!(sent.contains("Replied on FEAT-9"), "{sent}");
    let last = app.demo(|demo| {
        demo.thread("FEAT-9")
            .expect("the sample has it")
            .comments
            .pop()
    });
    assert_eq!(last.map(|c| c.body).as_deref(), Some("On it"));
}

#[test]
fn move_to_from_the_board_moves_the_card_and_the_board_follows() {
    let mut app = shown();
    let pick = app.press("enter m");
    assert!(pick.contains("Move to"), "{pick}");
    let moved = app.press("down down enter");
    assert!(moved.contains("FEAT-9 moved to In progress"), "{moved}");
    let back = app.press("esc");
    assert!(back.contains("In progress 7"), "{back}");
    assert!(lane(&app, "In progress").contains(&"FEAT-9".to_owned()));
}

#[test]
fn a_card_deleted_from_its_thread_leaves_the_board() {
    let mut app = shown();
    let gone = app.press("enter d FEAT-9 enter");
    assert!(gone.contains("Deleted FEAT-9"), "{gone}");
    assert_eq!(board(&app).crumb(), None);
    assert!(gone.contains("New 7"), "{gone}");
    assert!(!lane(&app, "New").contains(&"FEAT-9".to_owned()));
}

#[test]
fn a_delete_heard_while_reading_its_thread_closes_the_thread() {
    let mut app = shown();
    app.press("enter");
    let text = heard(
        &mut app,
        0,
        json!({"type": "delete", "key": "FEAT-9", "by": {"name": "Grace Hopper"}}),
    );
    assert_eq!(board(&app).crumb(), None);
    assert!(text.contains("Grace Hopper deleted FEAT-9"), "{text}");
    assert!(!lane(&app, "New").contains(&"FEAT-9".to_owned()));
}

#[test]
fn a_mouse_drag_carries_a_card_and_letting_go_drops_and_saves_it() {
    let mut app = shown();
    app.frame();
    let from = hit(&app, "Q-10");
    app.mouse(
        MouseEventKind::Down(MouseButton::Left),
        from.x + 3,
        from.y + 1,
    );
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    assert!(board(&app).lift.is_none());
    let doing = board(&app).lanes[2];
    app.mouse(
        MouseEventKind::Drag(MouseButton::Left),
        doing.x + 3,
        from.y + 1,
    );
    assert_eq!(board(&app).lift.as_ref().map(|l| l.to.0), Some(2));
    let held = app.text();
    assert!(held.contains('╔'), "{held}");
    app.mouse(
        MouseEventKind::Up(MouseButton::Left),
        doing.x + 3,
        from.y + 1,
    );
    assert!(board(&app).lift.is_none());
    assert!(lane(&app, "In progress").contains(&"Q-10".to_owned()));
    assert!(saved(&app, "In progress").contains(&"Q-10".to_owned()));
}

#[test]
fn a_click_without_a_drag_or_on_no_card_moves_nothing() {
    let mut app = shown();
    app.frame();
    let at = hit(&app, "BUG-11");
    app.mouse(MouseEventKind::Down(MouseButton::Left), at.x + 2, at.y + 2);
    app.mouse(MouseEventKind::Up(MouseButton::Left), at.x + 2, at.y + 2);
    assert_eq!(current(&app).as_deref(), Some("BUG-11"));
    assert!(board(&app).lift.is_none());
    assert_eq!(lane(&app, "New"), NEW_LANE);
    app.mouse(MouseEventKind::Down(MouseButton::Left), 0, HIGH - 1);
    app.mouse(MouseEventKind::Drag(MouseButton::Left), WIDE / 2, HIGH - 1);
    assert!(board(&app).lift.is_none());
    assert!(board(&app).press.is_none());
}

#[test]
fn the_wheel_walks_the_cards_of_the_lane_under_the_pointer() {
    let mut app = shown();
    app.frame();
    let doing = board(&app).lanes[2];
    app.mouse(MouseEventKind::ScrollDown, doing.x + 2, doing.y + 4);
    assert_eq!(current(&app).as_deref(), Some("TASK-6"));
    for _ in 0..10 {
        app.mouse(MouseEventKind::ScrollDown, doing.x + 2, doing.y + 4);
    }
    assert_eq!(current(&app).as_deref(), Some("TASK-20"));
    for _ in 0..10 {
        app.mouse(MouseEventKind::ScrollUp, doing.x + 2, doing.y + 4);
    }
    assert_eq!(current(&app).as_deref(), Some("IMP-5"));
    app.mouse(MouseEventKind::ScrollDown, WIDE - 1, doing.y + 4);
    assert_eq!(board(&app).column, 6);
}

#[test]
fn a_short_window_scrolls_a_long_lane_and_marks_what_is_above_and_below() {
    let mut app = shown();
    let short = |app: &mut Run| dump::text(&app.tui.frame(WIDE, 24));
    let top = short(&mut app);
    assert!(top.contains(" FEAT-9 "), "{top}");
    assert!(!top.contains(" FEAT-23 "), "{top}");
    assert!(line(&top, "New 8").contains('↓'), "{top}");
    assert!(!line(&top, "New 8").contains('↑'), "{top}");
    tap(&mut app, "G");
    short(&mut app);
    app.tui.advance(SLIDE);
    let bottom = short(&mut app);
    assert!(bottom.contains(" FEAT-23 "), "{bottom}");
    assert!(!bottom.contains(" FEAT-9 "), "{bottom}");
    assert!(line(&bottom, "New 8").contains('↑'), "{bottom}");
    tap(&mut app, "g");
    short(&mut app);
    app.tui.advance(SLIDE);
    assert!(short(&mut app).contains(" FEAT-9 "));
}

#[test]
fn seven_lanes_fit_at_80_and_120_columns_with_every_head_and_no_overlap() {
    let mut app = shown();
    for width in [80u16, 120] {
        let text = dump::text(&app.tui.frame(width, 34));
        let lanes = board(&app).lanes;
        assert!(
            lanes.windows(2).all(|pair| pair[0].right() < pair[1].x),
            "{width}"
        );
        assert!(lanes[6].right() <= width, "{width}: {lanes:?}");
        for (at, lane) in lanes.iter().enumerate() {
            assert!(lane.width >= 9, "{width}: lane {at} is {}", lane.width);
        }
        assert!(text.contains("FEAT-9"), "{width}:\n{text}");
        assert!(text.contains("BUG-25"), "{width}:\n{text}");
    }
}

#[test]
fn a_dropped_card_slides_into_place_easing_out_never_linearly() {
    let mut app = shown();
    app.frame();
    let start = hit(&app, "FEAT-9");
    app.press("space right enter");
    assert!(board(&app).animating());
    app.advance(SLIDE / 2);
    let x = board(&app)
        .spots
        .get("0/FEAT-9")
        .map(|spot| spot.at(board(&app).moment).0)
        .expect("the card has a spot");
    let end = board(&app).lanes[1].x as f32;
    let linear = start.x as f32 + (end - start.x as f32) * 0.5;
    let eased = start.x as f32 + (end - start.x as f32) * ease_out(0.5);
    assert!((x - eased).abs() < 0.01, "{x} vs {eased}");
    assert!(x > linear + 1.0, "{x} vs {linear}");
    app.advance(SLIDE);
    assert!(!board(&app).animating());
    assert_eq!(hit(&app, "FEAT-9").x, board(&app).lanes[1].x);
}

#[test]
fn the_easing_curves_start_and_end_still_and_are_never_linear() {
    assert_eq!(ease_out(0.0), 0.0);
    assert_eq!(ease_out(1.0), 1.0);
    assert_eq!(ease_out(0.5), 0.875);
    assert_eq!(ease_out(-1.0), 0.0);
    assert_eq!(ease_out(2.0), 1.0);
    assert_eq!(ease_in_out(0.0), 0.0);
    assert_eq!(ease_in_out(1.0), 1.0);
    assert_eq!(ease_in_out(0.5), 0.5);
    assert_eq!(ease_in_out(0.25), 0.0625);
    assert_eq!(ease_in_out(0.75), 0.9375);
    let steps: Vec<f32> = (0..=20).map(|i| ease_in_out(i as f32 / 20.0)).collect();
    assert!(steps.windows(2).all(|pair| pair[1] >= pair[0]));
}

#[test]
fn a_spot_travels_between_lanes_easing_in_and_out_and_stops_after_the_slide() {
    let start = Instant::now();
    let travel = Spot {
        from: (0.0, 0.0),
        to: (10.0, 20.0),
        start,
        held: false,
        travel: true,
    };
    assert_eq!(travel.at(start), (0.0, 0.0));
    let (x, y) = travel.at(start + SLIDE / 2);
    assert!(
        (x - 5.0).abs() < 0.001 && (y - 10.0).abs() < 0.001,
        "{x} {y}"
    );
    let (x, _) = travel.at(start + SLIDE / 4);
    assert!(x < 2.5, "{x}");
    assert_eq!(travel.at(start + SLIDE * 2), (10.0, 20.0));
    assert!(travel.moving(start + SLIDE / 2));
    assert!(!travel.moving(start + SLIDE));
    let still = Spot {
        to: (0.0, 0.0),
        ..travel
    };
    assert!(!still.moving(start));
}

#[test]
fn a_card_draws_its_key_title_and_assignee_inside_rounded_edges() {
    let palette = palette();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 24, 6));
    let mut item = card("BUG-7", "New", Some("grace.hopper"));
    item.title = "Two words that wrap onto a second line and then some".into();
    let clip = buffer.area;
    draw_card(
        &mut buffer,
        clip,
        0,
        1,
        24,
        (&item, None),
        (false, false, false),
        &palette,
    );
    let text = rows(&buffer);
    assert!(text[1].starts_with("╭─ BUG-7 ─"), "{text:?}");
    assert!(text[1].ends_with('╮'), "{text:?}");
    assert!(text[2].starts_with("│ Two words that wrap"), "{text:?}");
    assert!(text[3].starts_with("│ onto a second line"), "{text:?}");
    assert!(text[3].contains('…'), "{text:?}");
    assert!(text[4].starts_with('╰'), "{text:?}");
    assert!(text[4].contains(" @grace.hopper "), "{text:?}");
    assert!(text[4].ends_with("─╯"), "{text:?}");
    assert_eq!(text[0], "");
    assert_eq!(text[5], "");
}

#[test]
fn a_card_names_its_project_left_and_its_account_on_top_when_there_are_several() {
    let palette = palette();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 30, 4));
    let mut item = card("FEAT-41", "Stuck", Some("ada"));
    item.project = Some("Splicer".into());
    let clip = buffer.area;
    draw_card(
        &mut buffer,
        clip,
        0,
        0,
        30,
        (&item, Some("shop")),
        (false, false, false),
        &palette,
    );
    let text = rows(&buffer);
    assert!(text[0].starts_with("╭─ FEAT-41 ─"), "{text:?}");
    assert!(text[0].ends_with(" shop ─╮"), "{text:?}");
    assert!(text[3].starts_with("╰─ Splicer ─"), "{text:?}");
    assert!(text[3].ends_with(" @ada ─╯"), "{text:?}");
    let mut narrow = Buffer::empty(Rect::new(0, 0, 10, 4));
    item.project = Some("A very long project name".into());
    draw_card(
        &mut narrow,
        Rect::new(0, 0, 10, 4),
        0,
        0,
        10,
        (&item, Some("an account with a long name")),
        (false, false, false),
        &palette,
    );
    let small = rows(&narrow);
    assert!(
        small.iter().all(|row| row.chars().count() <= 10),
        "{small:?}"
    );
    assert!(
        small[3].starts_with('╰') && small[3].ends_with('╯'),
        "{small:?}"
    );
}

#[test]
fn a_held_card_has_double_edges_and_a_lit_key() {
    let palette = palette();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 20, 4));
    let clip = buffer.area;
    draw_card(
        &mut buffer,
        clip,
        0,
        0,
        20,
        (&card("BUG-7", "New", None), None),
        (true, true, false),
        &palette,
    );
    let text = rows(&buffer);
    assert!(text[0].starts_with("╔═ BUG-7 ═"), "{text:?}");
    assert!(text[1].starts_with('║'), "{text:?}");
    assert!(
        text[3].starts_with('╚') && text[3].ends_with('╝'),
        "{text:?}"
    );
    assert!(buffer[(0, 0)].modifier.contains(Modifier::BOLD));
    assert_eq!(Some(buffer[(3, 0)].fg), palette.accent.fg);
}

#[test]
fn a_card_half_above_the_lane_or_too_narrow_draws_only_what_fits() {
    let palette = palette();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 20, 4));
    let clip = buffer.area;
    draw_card(
        &mut buffer,
        clip,
        0,
        -2,
        20,
        (&card("BUG-7", "New", None), None),
        (false, false, false),
        &palette,
    );
    let text = rows(&buffer);
    assert!(text[0].starts_with('│'), "{text:?}");
    assert!(text[1].starts_with('╰'), "{text:?}");
    assert_eq!(text[2], "");
    let mut narrow = Buffer::empty(Rect::new(0, 0, 5, 4));
    let clip = narrow.area;
    draw_card(
        &mut narrow,
        clip,
        0,
        0,
        5,
        (&card("BUG-7", "New", None), None),
        (false, false, false),
        &palette,
    );
    assert!(rows(&narrow).iter().all(String::is_empty));
}

#[test]
fn a_drop_slot_is_a_dashed_outline_and_nothing_when_too_narrow() {
    let palette = palette();
    let mut buffer = Buffer::empty(Rect::new(0, 0, 8, 4));
    dashed(&mut buffer, Rect::new(0, 0, 8, 4), 0, 0, 8, &palette);
    let text = rows(&buffer);
    assert_eq!(text[0], "╭┄┄┄┄┄┄╮");
    assert_eq!(text[1], "┆      ┆");
    assert_eq!(text[3], "╰┄┄┄┄┄┄╯");
    let mut thin = Buffer::empty(Rect::new(0, 0, 8, 4));
    dashed(&mut thin, Rect::new(0, 0, 8, 4), 0, 0, 1, &palette);
    assert!(rows(&thin).iter().all(String::is_empty));
}

#[test]
fn text_outside_the_clip_is_skipped_but_still_advances() {
    let mut buffer = Buffer::empty(Rect::new(0, 0, 10, 2));
    let clip = Rect::new(2, 0, 6, 1);
    assert_eq!(put(&mut buffer, clip, 2, 1, "below", 10, Style::new()), 7);
    assert_eq!(put(&mut buffer, clip, 0, 0, "left", 10, Style::new()), 4);
    let end = put(&mut buffer, clip, 3, 0, "clipped text", 20, Style::new());
    assert_eq!(end, 8);
    assert_eq!(rows(&buffer)[0], "   clipp");
    assert_eq!(rows(&buffer)[1], "");
}

fn mobile(app: &Run) -> usize {
    app.source
        .board(&["Mobile app".to_owned()])
        .expect("the sample has a board")
        .cards
        .len()
}

fn cards(app: &Run) -> usize {
    board(app).view.as_ref().map_or(0, |view| view.cards.len())
}

#[test]
fn a_first_load_that_lands_after_a_new_filter_is_read_again_for_it() {
    let mut app = shown();
    let all = cards(&app);
    let full = app.source.board(&[]).expect("the sample has a board");
    {
        let board = board_mut(&mut app);
        board.view = None;
        board.projects = vec!["Mobile app".to_owned()];
        board.asked = Vec::new();
    }
    let text = app.event(BOARD, Msg::Board(Vec::new(), Ok(full)));
    let want = mobile(&app);
    assert!(want < all, "the filter narrows the sample");
    assert_eq!(cards(&app), want, "{text}");
    assert_eq!(board(&app).asked, ["Mobile app"]);
    assert!(text.contains(&format!("{want} item")), "{text}");
}

#[test]
fn an_answer_for_an_older_filter_never_replaces_the_board_shown() {
    let mut app = run(sample());
    app.text();
    app.advance(Duration::from_secs(1));
    app.press("p down enter");
    let shown = app.go(BOARD);
    let want = mobile(&app);
    assert_eq!(cards(&app), want, "{shown}");
    let full = app.source.board(&[]).expect("the sample has a board");
    let late = app.event(BOARD, Msg::Board(Vec::new(), Ok(full)));
    assert_eq!(cards(&app), want, "{late}");
    assert!(late.contains("Mobile app"), "{late}");
    assert!(!late.contains("28 items"), "{late}");
    let failed = app.event(BOARD, Msg::Board(Vec::new(), Err("offline".into())));
    assert!(!failed.contains("offline"), "{failed}");
    assert_eq!(cards(&app), want, "{failed}");
}

#[test]
fn a_move_made_in_a_thread_opened_from_w_reaches_the_board_underneath() {
    let mut app = shown();
    assert!(lane(&app, "Needs you").contains(&"BUG-25".to_owned()));
    app.press("w enter");
    let done = Change {
        status: Some("done".into()),
        ..Change::default()
    };
    let issue = app
        .source
        .change(0, None, "BUG-25", &done)
        .expect("the sample takes the change");
    app.event(BOARD, Msg::Changed("BUG-25".into(), Ok(issue)));
    app.advance(Duration::from_millis(1));
    let back = app.press("esc");
    assert!(back.contains("New 8"), "{back}");
    assert!(
        !lane(&app, "Needs you").contains(&"BUG-25".to_owned()),
        "{back}"
    );
}

#[test]
fn below_120_columns_only_the_lanes_with_cards_and_the_focused_one_show() {
    let mut app = shown();
    let view = BoardView {
        lanes: default_lanes(),
        cards: vec![card("BUG-1", "New", None), card("TASK-24", "Landed", None)],
        missing: Vec::new(),
    };
    app.event(BOARD, Msg::Board(Vec::new(), Ok(view)));
    let narrow = dump::text(&app.tui.frame(80, 24));
    assert_eq!(board(&app).visible, [0, 5], "{narrow}");
    assert!(
        narrow.contains("New 1") && narrow.contains("Landed 1"),
        "{narrow}"
    );
    for hidden in [
        "Planned 0",
        "In progress 0",
        "Needs you 0",
        "Stuck 0",
        "Done 0",
    ] {
        assert!(!narrow.contains(hidden), "{hidden}:\n{narrow}");
    }
    let new = board(&app).lanes[0];
    let landed = board(&app).lanes[5];
    assert!(new.width >= 38 && landed.width >= 38, "{new:?} {landed:?}");
    assert_eq!(board(&app).lane_of(landed.x + 2), 5);
    assert_eq!(board(&app).lane_of(new.x + 2), 0);
    tap(&mut app, "right");
    let focused = dump::text(&app.tui.frame(80, 24));
    assert_eq!(board(&app).visible, [0, 1, 5], "{focused}");
    assert!(
        focused.contains("Planned 0") && focused.contains("no cards"),
        "{focused}"
    );
    let roomy = dump::text(&app.tui.frame(120, 24));
    assert_eq!(board(&app).visible, [0, 1, 2, 3, 4, 5, 6], "{roomy}");
    assert!(
        roomy.contains("Done 0") && roomy.contains("Stuck 0"),
        "{roomy}"
    );
}

#[test]
fn a_carried_card_keeps_its_own_lane_and_its_target_on_a_narrow_board() {
    let mut app = shown();
    let view = BoardView {
        lanes: default_lanes(),
        cards: vec![card("BUG-1", "New", None)],
        missing: Vec::new(),
    };
    app.event(BOARD, Msg::Board(Vec::new(), Ok(view)));
    app.tui.frame(80, 24);
    tap(&mut app, "space right right");
    let carried = dump::text(&app.tui.frame(80, 24));
    assert_eq!(board(&app).visible, [0, 2], "{carried}");
    assert!(carried.contains("In progress 1"), "{carried}");
}

#[test]
fn a_narrow_card_keeps_one_space_round_its_key_before_it_drops_the_rule() {
    let palette = palette();
    let card = card("TASK-24", "Planned", None);
    for (width, want) in [
        (12u16, "╭─ TASK-24 ╮"),
        (11, "╭ TASK-24 ╮"),
        (10, "╭─TASK-24╮"),
        (9, "╭TASK-24╮"),
    ] {
        let area = Rect::new(0, 0, width, TALL as u16);
        let mut buf = Buffer::empty(area);
        draw_card(
            &mut buf,
            area,
            0,
            0,
            width,
            (&card, None),
            (false, false, false),
            &palette,
        );
        let top: String = (0..width).map(|x| buf[(x, 0)].symbol()).collect();
        assert_eq!(top, want, "{width}");
    }
}

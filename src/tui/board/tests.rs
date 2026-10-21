use std::time::Duration;

use pito_tui::dump;
use pito_tui::ratatui::style::Color;
use serde_json::json;

use crate::wire::Change;

use super::super::deck::{self, Moved};
use super::super::tests::{BOARD, HIGH, Run, WIDE, line, palette, row, run, sample, spot, waiting};
use super::*;

const INBOX_LANE: [&str; 7] = [
    "FEAT-9", "Q-10", "BUG-11", "FEAT-13", "BUG-15", "FEAT-19", "TASK-22",
];
const DOING_LANE: [&str; 6] = ["IMP-5", "TASK-6", "FEAT-7", "BUG-8", "TASK-16", "TASK-20"];

fn board(app: &Run) -> &Board {
    app.tui.find::<Board>().expect("the board is a screen")
}

fn shown() -> Run {
    let mut app = run(sample());
    app.advance(Duration::from_secs(1));
    app.go(BOARD);
    app
}

fn lane(app: &Run, label: &str) -> Vec<String> {
    let board = board(app);
    let view = board.view.as_ref().expect("a board is shown");
    let at = view.board.lane(label).expect("the board has the lane");
    board.lane_ids()[at]
        .iter()
        .map(|&index| view.cards[index].key.clone())
        .collect()
}

fn saved(app: &Run, id: i64, label: &str) -> Vec<String> {
    app.demo(|demo| {
        demo.board(Some(id))
            .expect("the sample has the board")
            .cards
            .into_iter()
            .filter(|card| card.label == label)
            .map(|card| card.key)
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
    board(app)
        .hits
        .iter()
        .find(|(id, _)| id == key)
        .map(|(_, rect)| *rect)
        .unwrap_or_else(|| panic!("{key} is drawn whole"))
}

fn heard(app: &mut Run, account: usize, event: serde_json::Value) -> String {
    app.event(BOARD, Msg::Heard(account, event.to_string()))
}

fn card(key: &str, label: &str, who: Option<&str>) -> Card {
    Card {
        key: key.into(),
        kind: "bug".into(),
        title: "A short title".into(),
        label: label.into(),
        assignee: who.map(|name| deck::Person {
            username: Some(name.into()),
        }),
        order: None,
    }
}

fn rows(buffer: &Buffer) -> Vec<String> {
    dump::text(buffer).lines().map(str::to_owned).collect()
}

#[test]
fn the_board_shows_my_first_board_lane_by_lane_in_its_order() {
    let mut app = shown();
    let text = app.text();
    for head in ["Inbox 7", "Doing 6", "QA ready 2", "Done 5"] {
        assert!(text.contains(head), "{head}:\n{text}");
    }
    for fact in ["Shop", "20 items", "5/20 done", "sample data"] {
        assert!(text.contains(fact), "{fact}:\n{text}");
    }
    assert!(!text.contains("Testing"), "{text}");
    assert_eq!(lane(&app, "Inbox"), INBOX_LANE);
    assert_eq!(lane(&app, "Doing"), DOING_LANE);
    assert_eq!(lane(&app, "QA ready"), ["IMP-4", "IMP-17"]);
    assert_eq!(
        lane(&app, "Done"),
        ["BUG-1", "BUG-2", "BUG-3", "BUG-12", "TASK-18"]
    );
    let tops: Vec<usize> = INBOX_LANE[..5]
        .iter()
        .map(|key| row(&text, &format!(" {key} ")))
        .collect();
    assert!(
        tops.windows(2).all(|pair| pair[1] == pair[0] + 5),
        "{tops:?}\n{text}"
    );
    assert_eq!(row(&text, " FEAT-9 "), row(&text, " IMP-5 "));
    let buffer = app.frame();
    let inbox = spot(&buffer, " FEAT-9 ", " FEAT-9 ");
    let doing = spot(&buffer, " IMP-5 ", " IMP-5 ");
    assert!(doing.0 > inbox.0);
    let (_, y) = spot(&buffer, " TASK-6 ", " TASK-6 ");
    let lane = board(&app).lanes[1];
    let bottom: String = (lane.x..lane.x + lane.width)
        .map(|x| buffer[(x, y + 3)].symbol())
        .collect();
    assert!(bottom.contains(" @ada.lovelace "), "{bottom}");
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
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
    assert!(
        buffer[(plain.0 - 2, plain.1)]
            .modifier
            .contains(Modifier::BOLD)
    );
    let done = spot(&buffer, "Logo looks", "Logo looks");
    assert!(buffer[done].modifier.contains(Modifier::DIM));
    let open = spot(&buffer, "Is the newsletter", "Is the newsletter");
    assert!(!buffer[open].modifier.contains(Modifier::DIM));
}

#[test]
fn arrows_and_vim_keys_walk_lanes_and_cards_and_stop_at_the_edges() {
    let mut app = shown();
    let walk = [
        ("right", "IMP-5"),
        ("down down", "FEAT-7"),
        ("right", "IMP-4"),
        ("down down down", "IMP-17"),
        ("right", "BUG-1"),
        ("right", "BUG-1"),
        ("G", "TASK-18"),
        ("g", "BUG-1"),
        ("up k", "BUG-1"),
        ("left left", "FEAT-7"),
        ("j", "BUG-8"),
        ("k", "FEAT-7"),
        ("h", "FEAT-9"),
        ("h left", "FEAT-9"),
        ("l", "FEAT-7"),
        ("end", "TASK-20"),
        ("home", "IMP-5"),
    ];
    for (keys, want) in walk {
        app.press(keys);
        assert_eq!(current(&app).as_deref(), Some(want), "after {keys}");
    }
    assert!(board(&app).lift.is_none());
}

#[test]
fn space_picks_a_card_up_arrows_carry_it_and_enter_drops_and_saves_it() {
    let mut app = shown();
    let lifted = app.press("space");
    assert!(board(&app).typing());
    for hint in ["carry", "enter drop", "esc put back"] {
        assert!(lifted.contains(hint), "{hint}:\n{lifted}");
    }
    assert!(lifted.contains('╔'), "{lifted}");
    let carried = app.press("right");
    assert!(carried.contains('━'), "{carried}");
    assert!(carried.contains("Doing 7"), "{carried}");
    assert!(carried.contains("Inbox 6"), "{carried}");
    let dropped = app.press("enter");
    assert!(board(&app).lift.is_none());
    assert!(!board(&app).typing());
    assert!(!dropped.contains("saving…"), "{dropped}");
    assert_eq!(lane(&app, "Doing")[0], "FEAT-9");
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
    assert_eq!(saved(&app, 1, "Doing")[0], "FEAT-9");
    let issue = app.demo(|demo| demo.thread("FEAT-9").expect("the sample has it").issue);
    assert_eq!(issue.label.as_deref(), Some("Doing"));
    assert_eq!(issue.status, "doing");
}

#[test]
fn a_card_dropped_between_two_cards_lands_between_them_on_the_server_too() {
    let mut app = shown();
    app.press("space right down down enter");
    let want = [
        "IMP-5", "TASK-6", "FEAT-9", "FEAT-7", "BUG-8", "TASK-16", "TASK-20",
    ];
    assert_eq!(lane(&app, "Doing"), want);
    assert_eq!(saved(&app, 1, "Doing"), want);
}

#[test]
fn a_card_carried_past_the_last_lane_and_row_drops_at_the_end_and_closes() {
    let mut app = shown();
    app.press("space left up right right right right right G");
    assert_eq!(board(&app).lift.as_ref().map(|l| l.to), Some((3, 5)));
    let text = app.press("enter");
    assert_eq!(
        lane(&app, "Done").last().map(String::as_str),
        Some("FEAT-9")
    );
    assert_eq!(
        saved(&app, 1, "Done").last().map(String::as_str),
        Some("FEAT-9")
    );
    let issue = app.demo(|demo| demo.thread("FEAT-9").expect("the sample has it").issue);
    assert_eq!(issue.status, "done");
    assert_eq!(issue.resolution.as_deref(), Some("fixed"));
    assert!(text.contains("6/20 done"), "{text}");
}

#[test]
fn esc_puts_a_carried_card_back_where_it_was() {
    let mut app = shown();
    app.press("down space right right esc");
    assert!(board(&app).lift.is_none());
    assert_eq!(lane(&app, "Inbox"), INBOX_LANE);
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    assert_eq!(saved(&app, 1, "Inbox"), INBOX_LANE);
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
    assert_eq!(lane(&app, "Inbox"), INBOX_LANE);
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
    let text = app.press("right right enter");
    assert!(text.contains(deck::MOVED), "{text}");
    assert!(lane(&app, "Doing").contains(&"FEAT-9".to_owned()));
    assert!(!lane(&app, "QA ready").contains(&"FEAT-9".to_owned()));
    assert_eq!(board(&app).sending, 0);
}

#[test]
fn a_move_that_fails_otherwise_says_why_and_the_board_reads_again() {
    let mut app = shown();
    app.press("space right enter");
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    let text = app.event(
        BOARD,
        Msg::Shifted("FEAT-9".into(), Err("the Worker is down".into())),
    );
    assert!(text.contains("the Worker is down"), "{text}");
    assert!(!lane(&app, "Inbox").contains(&"TASK-22".to_owned()));
}

#[test]
fn a_saved_move_to_a_lane_this_board_lacks_takes_the_card_off() {
    let mut app = shown();
    let mut gone = card("FEAT-9", "Shipped", None);
    gone.order = Some("a0".into());
    app.event(
        BOARD,
        Msg::Shifted("FEAT-9".into(), Ok(Moved { card: gone })),
    );
    assert!(!lane(&app, "Inbox").contains(&"FEAT-9".to_owned()));
    let mut kept = card("Q-10", "Done", None);
    kept.order = Some("0".into());
    app.event(BOARD, Msg::Shifted("Q-10".into(), Ok(Moved { card: kept })));
    assert_eq!(lane(&app, "Done")[0], "Q-10");
}

#[test]
fn b_lists_my_boards_first_then_the_watched_ones_and_opens_the_one_picked() {
    let mut app = shown();
    let pick = app.press("b");
    assert!(pick.contains("Board"), "{pick}");
    assert!(
        row(&pick, "Shop") <= row(&pick, "@grace.hopper · QA"),
        "{pick}"
    );
    let qa = app.press("down enter");
    for head in ["QA ready 2", "Testing 1", "Verified 1"] {
        assert!(qa.contains(head), "{head}:\n{qa}");
    }
    for fact in ["@grace.hopper", "4 items", "1/4 done"] {
        assert!(qa.contains(fact), "{fact}:\n{qa}");
    }
    assert!(qa.contains("watching @grace.hopper"), "{qa}");
    assert!(!qa.contains("space pick up"), "{qa}");
    assert_eq!(board(&app).at, Some(2));
    assert_eq!(lane(&app, "Testing"), ["BUG-14"]);
    assert_eq!(current(&app).as_deref(), Some("IMP-4"));
    let back = app.press("b");
    assert!(back.contains("Shop"), "{back}");
    let shop = app.press("up enter");
    assert!(shop.contains("Inbox 7"), "{shop}");
}

#[test]
fn picking_the_board_shown_or_cancelling_reads_nothing() {
    let mut app = shown();
    app.press("down b enter");
    assert_eq!(board(&app).at, Some(1));
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    assert!(!board(&app).reading);
    app.press("b down esc");
    assert_eq!(board(&app).at, Some(1));
}

#[test]
fn a_watched_board_cannot_be_carried_by_keys_or_mouse() {
    let mut app = shown();
    app.press("b down enter");
    let text = app.press("space");
    assert!(board(&app).lift.is_none());
    assert!(!board(&app).typing());
    assert!(!text.contains('╔'), "{text}");
    app.frame();
    let from = hit(&app, "IMP-4");
    app.mouse(
        MouseEventKind::Down(MouseButton::Left),
        from.x + 2,
        from.y + 1,
    );
    app.mouse(
        MouseEventKind::Drag(MouseButton::Left),
        from.x + from.width + 4,
        from.y + 1,
    );
    app.mouse(
        MouseEventKind::Up(MouseButton::Left),
        from.x + from.width + 4,
        from.y + 1,
    );
    assert_eq!(lane(&app, "QA ready"), ["IMP-4", "IMP-17"]);
    assert_eq!(saved(&app, 2, "QA ready"), ["IMP-4", "IMP-17"]);
}

#[test]
fn no_board_yet_says_how_to_make_one() {
    let mut app = shown();
    let picked = app.event(BOARD, Msg::Boards(Ok(Vec::new())));
    assert!(picked.contains("No board yet: p99 boards set"), "{picked}");
    let failed = app.event(BOARD, Msg::Boards(Err("the boards are down".into())));
    assert!(failed.contains("the boards are down"), "{failed}");
    let mut empty = run(Source::Broken("offline".into()));
    empty.go(BOARD);
    let text = empty.event(BOARD, Msg::Board(None, Err(NONE.into())));
    for said in ["No board yet.", MAKE, "r reads it again"] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
}

#[test]
fn boards_of_several_accounts_are_named_by_account() {
    let mut app = shown();
    let shelf = app.demo(|demo| demo.boards());
    let pick = app.event(BOARD, Msg::Boards(Ok(vec![(0, shelf.clone()), (1, shelf)])));
    assert!(pick.contains("sample · Shop"), "{pick}");
    assert!(pick.contains("sample · @grace.hopper · QA"), "{pick}");
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
    let text = app.event(BOARD, Msg::Board(Some((0, 1)), Err("offline".into())));
    assert!(text.contains("offline"), "{text}");
    assert!(text.contains("Inbox 7"), "{text}");
}

#[test]
fn a_late_read_of_another_board_is_ignored() {
    let mut app = shown();
    let other = app.demo(|demo| demo.board(Some(2)).expect("the sample has it"));
    let text = app.event(BOARD, Msg::Board(Some((0, 2)), Ok((0, other))));
    assert_eq!(board(&app).at, Some(1));
    assert!(text.contains("Inbox 7"), "{text}");
}

#[test]
fn esc_while_the_board_loads_stops_waiting_and_r_reads_it() {
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
    let read = app.press("r");
    assert!(read.contains("Inbox 7"), "{read}");
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
    assert!(text.contains("Inbox 6"), "{text}");
    assert!(!text.contains("reading…"), "{text}");
}

#[test]
fn live_label_and_order_events_move_cards_in_place_and_keep_the_selection() {
    let mut app = shown();
    let moved = heard(
        &mut app,
        0,
        json!({"type": "label", "key": "FEAT-9", "from": "Inbox", "to": "Done", "host": "shop.example.com"}),
    );
    assert!(moved.contains("Inbox 6"), "{moved}");
    assert!(moved.contains("Done 6"), "{moved}");
    assert_eq!(current(&app).as_deref(), Some("FEAT-9"));
    assert_eq!(board(&app).column, 3);
    heard(
        &mut app,
        0,
        json!({"type": "order", "board": 1, "key": "TASK-22", "order": "0", "host": "shop.example.com"}),
    );
    assert_eq!(lane(&app, "Inbox")[0], "TASK-22");
    heard(
        &mut app,
        0,
        json!({"type": "order", "board": "2", "key": "Q-10", "order": "0", "host": "shop.example.com"}),
    );
    assert_eq!(lane(&app, "Inbox")[1], "Q-10");
    heard(&mut app, 0, json!({"type": "delete", "key": "Q-10"}));
    assert!(!lane(&app, "Inbox").contains(&"Q-10".to_owned()));
    heard(&mut app, 1, json!({"type": "delete", "key": "BUG-11"}));
    assert!(lane(&app, "Inbox").contains(&"BUG-11".to_owned()));
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "BUG-11", "to": "Shipped"}),
    );
    assert!(!lane(&app, "Inbox").contains(&"BUG-11".to_owned()));
    assert!(board(&app).stale.is_none());
}

#[test]
fn a_lane_left_empty_says_no_cards() {
    let mut app = shown();
    for key in ["IMP-4", "IMP-17"] {
        heard(
            &mut app,
            0,
            json!({"type": "label", "key": key, "to": "Done"}),
        );
    }
    let text = app.text();
    assert!(text.contains("QA ready 0"), "{text}");
    assert!(text.contains("no cards"), "{text}");
}

#[test]
fn an_unknown_card_arriving_reads_the_board_again_after_a_quiet_moment() {
    let mut app = shown();
    let change = Change {
        status: Some("inbox".into()),
        ..Change::default()
    };
    app.source
        .change(0, None, "TASK-21", &change)
        .expect("the sample takes the change");
    heard(
        &mut app,
        0,
        json!({"type": "label", "key": "TASK-21", "from": "Verified", "to": "Inbox"}),
    );
    assert!(board(&app).stale.is_some());
    assert!(!lane(&app, "Inbox").contains(&"TASK-21".to_owned()));
    app.advance(QUIET - Duration::from_millis(1));
    assert!(!lane(&app, "Inbox").contains(&"TASK-21".to_owned()));
    let text = app.advance(Duration::from_millis(1));
    assert!(lane(&app, "Inbox").contains(&"TASK-21".to_owned()));
    assert!(text.contains("Inbox 8"), "{text}");
    assert!(board(&app).stale.is_none());
}

#[test]
fn unreadable_or_unknown_events_ask_for_one_reread() {
    let mut app = shown();
    let before = lane(&app, "Inbox");
    app.event(BOARD, Msg::Heard(0, "not json".into()));
    assert!(board(&app).stale.is_none());
    heard(&mut app, 0, json!({"type": "comment", "key": "Q-10"}));
    let due = board(&app).stale.expect("a reread is due");
    heard(&mut app, 0, json!({"type": "assignee", "key": "BUG-11"}));
    assert_eq!(board(&app).stale, Some(due));
    assert_eq!(lane(&app, "Inbox"), before);
}

#[test]
fn a_push_without_a_key_reads_the_board_again_at_once() {
    let mut app = shown();
    app.demo(|demo| demo.delete("TASK-22").expect("the sample has it"));
    app.event(BOARD, Msg::Pushed(0, None));
    let text = app.advance(Duration::ZERO);
    assert!(text.contains("Inbox 6"), "{text}");
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
    app.press("h h h");
    assert_eq!(current(&app).as_deref(), Some("Q-10"));
    app.press("space");
    heard(&mut app, 0, json!({"type": "delete", "key": "Q-10"}));
    assert!(board(&app).lift.is_none());
    app.press("space down");
    heard(
        &mut app,
        0,
        json!({"type": "order", "board": 1, "key": "BUG-15", "order": "0"}),
    );
    assert!(board(&app).lift.is_some());
    assert_eq!(lane(&app, "Inbox")[0], "BUG-15");
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
    assert!(back.contains("Inbox 7"), "{back}");
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
    let moved = app.press("down enter");
    assert!(moved.contains("FEAT-9 moved to Doing"), "{moved}");
    let back = app.press("esc");
    assert!(back.contains("Doing 7"), "{back}");
    assert!(lane(&app, "Doing").contains(&"FEAT-9".to_owned()));
}

#[test]
fn a_card_deleted_from_its_thread_leaves_the_board() {
    let mut app = shown();
    let gone = app.press("enter d FEAT-9 enter");
    assert!(gone.contains("Deleted FEAT-9"), "{gone}");
    assert_eq!(board(&app).crumb(), None);
    assert!(gone.contains("Inbox 6"), "{gone}");
    assert!(!lane(&app, "Inbox").contains(&"FEAT-9".to_owned()));
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
    assert!(!lane(&app, "Inbox").contains(&"FEAT-9".to_owned()));
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
    let qa = board(&app).lanes[2];
    app.mouse(
        MouseEventKind::Drag(MouseButton::Left),
        qa.x + 3,
        from.y + 1,
    );
    assert_eq!(board(&app).lift.as_ref().map(|l| l.to.0), Some(2));
    let held = app.text();
    assert!(held.contains('╔'), "{held}");
    app.mouse(MouseEventKind::Up(MouseButton::Left), qa.x + 3, from.y + 1);
    assert!(board(&app).lift.is_none());
    assert!(lane(&app, "QA ready").contains(&"Q-10".to_owned()));
    assert!(saved(&app, 1, "QA ready").contains(&"Q-10".to_owned()));
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
    assert_eq!(lane(&app, "Inbox"), INBOX_LANE);
    app.mouse(MouseEventKind::Down(MouseButton::Left), 0, HIGH - 1);
    app.mouse(MouseEventKind::Drag(MouseButton::Left), WIDE / 2, HIGH - 1);
    assert!(board(&app).lift.is_none());
    assert!(board(&app).press.is_none());
}

#[test]
fn the_wheel_walks_the_cards_of_the_lane_under_the_pointer() {
    let mut app = shown();
    app.frame();
    let doing = board(&app).lanes[1];
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
    assert_eq!(board(&app).column, 3);
}

#[test]
fn a_short_window_scrolls_a_long_lane_and_marks_what_is_above_and_below() {
    let mut app = shown();
    let short = |app: &mut Run| dump::text(&app.tui.frame(WIDE, 24));
    let top = short(&mut app);
    assert!(top.contains(" FEAT-9 "), "{top}");
    assert!(!top.contains(" TASK-22 "), "{top}");
    assert!(line(&top, "Inbox 7").contains('↓'), "{top}");
    assert!(!line(&top, "Inbox 7").contains('↑'), "{top}");
    tap(&mut app, "G");
    let bottom = short(&mut app);
    assert!(bottom.contains(" TASK-22 "), "{bottom}");
    assert!(!bottom.contains(" FEAT-9 "), "{bottom}");
    assert!(line(&bottom, "Inbox 7").contains('↑'), "{bottom}");
    tap(&mut app, "g");
    assert!(short(&mut app).contains(" FEAT-9 "));
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
        .get("FEAT-9")
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
    let mut item = card("BUG-7", "Inbox", Some("grace.hopper"));
    item.title = "Two words that wrap onto a second line and then some".into();
    let clip = buffer.area;
    draw_card(
        &mut buffer,
        clip,
        0,
        1,
        24,
        &item,
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
        &card("BUG-7", "Inbox", None),
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
        &card("BUG-7", "Inbox", None),
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
        &card("BUG-7", "Inbox", None),
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

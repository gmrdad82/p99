use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
#[cfg(unix)]
use std::time::Duration;

use serde_json::json;

use crate::desk::{Back, Desk, Item, World, has_key, rows_with, screen};
use crate::home::Home;
use crate::stub::{KEY, Reply};

#[cfg(unix)]
#[test]
fn us_triage_001_graces_report_shows_in_adas_running_tui_within_a_second() {
    let desk = Desk::with(
        "us-triage-001-live",
        World::new(vec![
            Item::new(9, "Crème brûlée page is cold"),
            Item::new(7, "The back office printer is jammed").hostless("Ops"),
        ])
        .named("main", "PITO MD"),
        |_, _| None,
    );
    let mut tui = crate::live::Live::start(&desk.home, &["tui"], 120, 34);
    assert!(
        tui.wait_for("BUG-9", Duration::from_secs(30)).is_some(),
        "the inbox never drew:\n{}",
        tui.screen()
    );
    assert!(!tui.screen().contains("BUG-4"), "{}", tui.screen());
    let first = tui.screen();
    assert!(
        has_key(&first, "BUG-7"),
        "the hostless card is missing:\n{first}"
    );
    assert!(header(&first).contains("PITO MD"), "{first}");
    desk.wait_for_stream();
    desk.world(|w| w.items.push(Item::new(4, "Gift wrapping is missing")));
    desk.push(&[r#"{"type":"issue","key":"BUG-4","host":"shop.example.com"}"#]);
    let took = tui.wait_for("BUG-4", Duration::from_secs(30));
    assert!(
        took.is_some(),
        "Grace's report never reached the running TUI with no key pressed:\n{}",
        tui.screen()
    );
    let after = tui.screen();
    assert!(
        has_key(&after, "BUG-9") && has_key(&after, "BUG-7"),
        "{after}"
    );
    assert!(header(&after).contains("PITO MD"), "{after}");
    tui.press(b"\x03");
}

#[test]
fn us_triage_001_an_inbox_that_cannot_load_says_why_and_offers_to_read_again() {
    let down = Desk::with(
        "us-triage-001-down",
        World::new(vec![Item::new(12, "The total does not update")]),
        |req, _| {
            (req.method == "GET" && req.path == "/_p99/v1/issues")
                .then(|| Reply::problem(500, "D1 is down"))
        },
    );
    let failed = down.screen("120x30", "");
    assert!(failed.contains("Couldn't read the inbox."), "{failed}");
    assert!(failed.contains("D1 is down (500)"), "{failed}");
    assert!(failed.contains("r reads it again"), "{failed}");
    assert!(!failed.contains("No items yet"), "{failed}");
    assert!(!has_key(&failed, "BUG-12"), "{failed}");

    let tries = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&tries);
    let recovering = Desk::with(
        "us-triage-001-recovering",
        World::new(vec![Item::new(12, "The total does not update")]),
        move |req, _| {
            let list = req.method == "GET" && req.path == "/_p99/v1/issues";
            (list && counted.fetch_add(1, Ordering::SeqCst) == 0)
                .then(|| Reply::problem(500, "D1 is down"))
        },
    );
    let again = recovering.screen("120x30", "r");
    assert!(has_key(&again, "BUG-12"), "{again}");
    assert!(!again.contains("Couldn't read the inbox."), "{again}");
    assert!(tries.load(Ordering::SeqCst) >= 2);
}

fn comment_posts(desk: &Desk) -> Vec<crate::stub::Req> {
    desk.home
        .stub
        .writes()
        .into_iter()
        .filter(|r| r.path.ends_with("/comments"))
        .collect()
}

#[test]
fn us_triage_002_a_failed_reply_says_why_and_keeps_the_thread() {
    let desk = Desk::with(
        "us-triage-002-failed",
        World::new(vec![Item::new(12, "The total does not update")]),
        |req, _| {
            (req.method == "POST" && req.path.ends_with("/comments"))
                .then(|| Reply::problem(500, "the database is busy"))
        },
    );
    let empty = desk.screen("120x34", "enter r enter");
    assert!(empty.contains("Inbox / BUG-12"), "{empty}");
    let cancelled = desk.screen("120x34", "enter r Thanks esc");
    assert!(cancelled.contains("Inbox / BUG-12"), "{cancelled}");
    assert!(
        comment_posts(&desk).is_empty(),
        "an empty or cancelled reply was sent"
    );

    let failed = desk.screen("120x34", "enter r Thanks enter");
    assert!(failed.contains("the database is busy"), "{failed}");
    assert!(failed.contains("Inbox / BUG-12"), "{failed}");
    assert!(failed.contains("The total does not update"), "{failed}");
    assert!(!failed.contains("Replied on BUG-12"), "{failed}");
    let sent = comment_posts(&desk);
    assert!(!sent.is_empty(), "the reply never reached the Worker");
    assert!(sent.iter().all(|r| r.signed));
}

#[test]
fn us_triage_003_a_move_after_another_sessions_move_shows_where_the_item_is_now() {
    let flipped = AtomicBool::new(false);
    let desk = Desk::with(
        "us-triage-003-stale",
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            let read = req.method == "GET"
                && (req.path.ends_with("/issues/BUG-12") || req.path.ends_with("/issues/12"));
            if !read || flipped.swap(true, Ordering::SeqCst) {
                return None;
            }
            let reply = world.answer(req);
            world.items[0].label = "Stuck".to_owned();
            Some(reply)
        },
    );
    let after = desk.screen("120x30", "enter m down down enter");
    assert_eq!(
        desk.moves(),
        [json!({"key": "BUG-12", "from": "New", "to": "In progress"})]
    );
    assert_eq!(desk.world(|w| w.get(12).label), "Stuck");
    assert!(
        after.contains("BUG-12 moved to Stuck meanwhile; run it again to move it from there"),
        "{after}"
    );
    assert!(
        rows_with(&after, "Bug ·")
            .iter()
            .any(|l| l.contains("Stuck")),
        "the item still shows a label it no longer has:\n{after}"
    );
    desk.all_signed();
}

fn spaces_config(first: &str, second: &str) -> String {
    format!(
        r#"[me]
name = "Ada Lovelace"
email = "ada@example.com"

[spaces.pito]
name = "PITO MD"
account_id = "acc1"
token = "cf-token"
database_id = "db1"
key = "{KEY}"
url = "{first}"

[spaces.fepra]
name = "Fepra"
account_id = "acc2"
token = "cf-token"
database_id = "db2"
key = "{KEY}"
url = "{second}"

[hosts."shop.example.com"]
space = "pito"
"#
    )
}

fn header(screen: &str) -> &str {
    screen.lines().nth(1).unwrap_or_default()
}

#[test]
fn us_triage_005_capital_s_switches_space_and_the_header_names_the_space_shown() {
    let pito =
        Back::start(World::new(vec![Item::new(21, "Pito cart is stuck")]).named("pito", "PITO MD"));
    let fepra =
        Back::start(World::new(vec![Item::new(22, "Fepra form is slow")]).named("fepra", "Fepra"));
    let text = spaces_config(&pito.worker(), &fepra.worker());
    let home = Home::with_config("us-triage-005-switch", pito.stub.clone(), &text);

    let every = screen(&home, "120x20", "");
    assert!(header(&every).contains("All spaces"), "{every}");
    assert!(
        has_key(&every, "BUG-21") && has_key(&every, "BUG-22"),
        "{every}"
    );
    assert!(every.contains("S space"), "{every}");

    let first = screen(&home, "120x20", "S");
    assert!(header(&first).contains("Fepra"), "{first}");
    assert!(
        has_key(&first, "BUG-22") && !has_key(&first, "BUG-21"),
        "{first}"
    );

    let second = screen(&home, "120x20", "S S");
    assert!(header(&second).contains("PITO MD"), "{second}");
    assert!(
        has_key(&second, "BUG-21") && !has_key(&second, "BUG-22"),
        "{second}"
    );

    let round = screen(&home, "120x20", "S S S");
    assert!(header(&round).contains("All spaces"), "{round}");
    assert!(
        has_key(&round, "BUG-21") && has_key(&round, "BUG-22"),
        "{round}"
    );
}

#[test]
fn us_triage_005_with_one_space_s_changes_nothing() {
    let desk = Desk::with(
        "us-triage-005-one",
        World::new(vec![Item::new(21, "Pito cart is stuck")]).named("main", "PITO MD"),
        |_, _| None,
    );
    let plain = desk.screen("120x20", "");
    assert!(header(&plain).contains("PITO MD"), "{plain}");
    assert!(!plain.contains("S space"), "{plain}");
    let pressed = desk.screen("120x20", "S");
    assert_eq!(pressed, plain);
}

#[test]
fn us_triage_002_p99_card_comment_ties_its_files_to_the_comment() {
    let h = Home::new("us-triage-002-card-comment", crate::fake::any);
    std::fs::write(h.dir.join("trace.log"), "boom").unwrap();
    std::fs::write(h.dir.join("cart.png"), [0x89, b'P', b'N', b'G']).unwrap();
    let out = h.p99_in(
        &[
            "card",
            "comment",
            "BUG-12",
            "-",
            "--internal",
            "--attach",
            "trace.log",
            "--attach",
            "cart.png",
            "--host",
            "shop.example.com",
        ],
        "Seen it twice.\n",
    );
    out.ok();
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    assert_eq!(out.stdout, "commented on BUG-12 (internal)\n");
    let made = h.stub.call("POST", "/_p99/v1/issues/12/comments");
    assert_eq!(made.json()["body"], "Seen it twice.");
    assert_eq!(made.json()["internal"], true);
    let tried = h.stub.call("POST", "/_p99/v1/cards/BUG-12/comments");
    assert_eq!(tried.json()["client_uid"], made.json()["client_uid"]);
    let files = h.stub.under("PUT", "/_p99/v1/issues/12/attachments/");
    assert_eq!(files.len(), 2, "each file follows the comment once");
    assert!(files.iter().all(|f| f.param("comment") == Some("31")));
    assert_eq!(files[0].param("name"), Some("trace.log"));
    assert_eq!(files[1].header("content-type"), Some("image/png"));
    assert!(h.stub.seen().iter().all(|r| r.signed));

    h.p99(&["card", "comment", "BUG-12", "x", "--attach", "missing.txt"])
        .refused("missing.txt: No such file or directory (os error 2)");
    assert_eq!(h.stub.calls("POST", "/_p99/v1/issues/12/comments").len(), 1);
}

#[test]
fn us_triage_002_p99_comment_still_comments_once_and_says_it_is_now_p99_card_comment() {
    let h = Home::new("us-triage-002-comment-renamed", crate::fake::any);
    let out = h.p99(&["comment", "12", "Fixed on staging", "--json"]);
    out.ok();
    assert_eq!(out.stderr, "p99: p99 comment is now p99 card comment\n");
    assert_eq!(out.json()["comment"]["body"], "Fixed on staging");
    assert_eq!(h.stub.calls("POST", "/_p99/v1/issues/12/comments").len(), 1);
}

#[test]
fn us_triage_003_p99_card_status_closes_as_abandoned_or_duplicate() {
    let desk = Desk::new(
        "us-triage-003-card-close",
        vec![
            Item::new(12, "Checkout total is wrong"),
            Item::new(3, "Total wrong"),
        ],
    );
    let h = &desk.home;
    h.p99(&["card", "status", "BUG-12", "duplicate"])
        .refused("a duplicate needs --duplicate-of KEY");
    h.p99(&[
        "card",
        "status",
        "BUG-12",
        "stuck",
        "--duplicate-of",
        "BUG-3",
    ])
    .refused("--duplicate-of goes with duplicate");
    h.p99(&["card", "status", "BUG-12", "abandoned", "--note", "why"])
        .refused("--note goes with a lane; close it, then p99 card comment says why");
    assert!(h.stub.writes().is_empty(), "a refused close wrote");
    let dropped = h.p99(&["card", "status", "BUG-12", "abandoned"]);
    dropped.ok();
    assert_eq!(dropped.stdout, "BUG-12 is now dropped\n");
    assert_eq!(
        desk.world(|w| w.get(12).resolution),
        Some("abandoned".to_owned())
    );
    let twin = h.p99(&[
        "card",
        "status",
        "12",
        "duplicate",
        "--duplicate-of",
        "BUG-3",
        "--host",
        "shop.example.com",
    ]);
    twin.ok();
    assert_eq!(twin.stdout, "BUG-12 is now duplicate\n");
    assert_eq!(
        desk.world(|w| w.get(12).duplicate_of),
        Some("BUG-3".to_owned())
    );
    let back = h.p99(&["card", "status", "BUG-12", "in-progress"]);
    back.ok();
    assert_eq!(back.stdout, "BUG-12 is in In progress\n");
    assert_eq!(desk.world(|w| w.get(12).resolution), None);
    desk.all_signed();
}

#[test]
fn us_triage_003_p99_status_still_moves_once_and_says_it_is_now_p99_card_status() {
    let desk = Desk::new(
        "us-triage-003-status-renamed",
        vec![Item::new(12, "Checkout total is wrong")],
    );
    let out = desk.home.p99(&["status", "BUG-12", "In progress"]);
    out.ok();
    assert_eq!(out.stderr, "p99: p99 status is now p99 card status\n");
    assert_eq!(out.stdout, "BUG-12 is in In progress\n");
    assert_eq!(
        desk.moves(),
        [json!({"key": "12", "from": "New", "to": "In progress"})]
    );
}

#[test]
fn us_triage_001_p99_list_page_lists_the_cards_filed_on_that_page() {
    let h = Home::new("us-triage-001-list-page", crate::fake::any);
    let out = h.p99(&["list", "shop.example.com", "--page", "/checkout?step=2"]);
    out.ok();
    let asked = h.stub.call("GET", "/_p99/v1/issues");
    assert_eq!(asked.param("scope"), Some("page"));
    assert_eq!(asked.param("path"), Some("/checkout"));
    assert_eq!(asked.param("host"), Some("shop.example.com"));
    assert!(out.stdout.contains("BUG-12"), "{}", out.stdout);
    h.p99(&["list", "--page", "checkout"])
        .refused("checkout is not a page path; try /checkout");
    h.p99(&["list", "--page", "/checkout", "--mine"])
        .clap("the argument '--page <path>' cannot be used with '--mine'");
    assert_eq!(h.stub.calls("GET", "/_p99/v1/issues").len(), 1);
}

#[test]
fn us_triage_001_p99_list_source_keeps_the_cards_a_person_or_an_agent_changed_last() {
    let h = Home::new("us-triage-001-list-source", crate::fake::any);
    h.p99(&["list", "--source", "agent", "--kind", "bug", "-q", "total"])
        .ok();
    let asked = h.stub.call("GET", "/_p99/v1/issues");
    assert_eq!(asked.param("source"), Some("agent"));
    assert_eq!(asked.param("kind"), Some("bug"));
    assert_eq!(asked.param("q"), Some("total"));
    assert_eq!(asked.param("scope"), Some("all"));
    h.p99(&["list", "--source", "human"]).ok();
    assert_eq!(
        h.stub.calls("GET", "/_p99/v1/issues")[1].param("source"),
        Some("human")
    );
    h.p99(&["list", "--source", "robot"])
        .clap("invalid value 'robot' for '--source <SOURCE>'");
}

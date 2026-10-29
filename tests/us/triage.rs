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
    assert!(failed.contains("Couldn't read the cards."), "{failed}");
    assert!(failed.contains("D1 is down (500)"), "{failed}");
    assert!(failed.contains("r reads it again"), "{failed}");
    assert!(!failed.contains("No cards yet"), "{failed}");
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
    assert!(!again.contains("Couldn't read the cards."), "{again}");
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
    assert!(empty.contains("Cards / BUG-12"), "{empty}");
    let cancelled = desk.screen("120x34", "enter r Thanks esc");
    assert!(cancelled.contains("Cards / BUG-12"), "{cancelled}");
    assert!(
        comment_posts(&desk).is_empty(),
        "an empty or cancelled reply was sent"
    );

    let failed = desk.screen("120x34", "enter r Thanks enter");
    assert!(failed.contains("the database is busy"), "{failed}");
    assert!(failed.contains("Cards / BUG-12"), "{failed}");
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

fn attached(req: &crate::stub::Req) -> Option<Reply> {
    (req.method == "PUT" && req.path.contains("/attachments/")).then(|| {
        Reply::json(
            201,
            json!({
                "id": 7,
                "name": req.param("name"),
                "type": req.header("content-type"),
                "bytes": req.body.len(),
                "role": "file",
            }),
        )
    })
}

#[test]
fn us_triage_002_tab_in_a_reply_adds_files_tied_to_that_comment() {
    let desk = Desk::with(
        "us-triage-002-files",
        World::new(vec![Item::new(12, "The total does not update")]),
        |req, _| attached(req),
    );
    std::fs::write(desk.home.dir.join("shot.png"), [1, 2, 3]).unwrap();
    let asked = desk.screen("120x34", "enter r Thanks tab");
    assert!(asked.contains("Files"), "{asked}");
    assert!(
        desk.calls("POST", "/_p99/v1/issues/BUG-12/comments")
            .is_empty()
    );
    let sent = desk.screen("120x34", "enter r Thanks tab shot.png enter");
    assert!(sent.contains("Replied on BUG-12 with 1 file"), "{sent}");
    let comments = desk.calls("POST", "/_p99/v1/issues/BUG-12/comments");
    assert_eq!(comments.len(), 1, "{sent}");
    assert_eq!(comments[0].json()["body"], "Thanks");
    let files: Vec<_> = desk
        .home
        .stub
        .seen()
        .into_iter()
        .filter(|r| r.method == "PUT" && r.path.contains("/issues/BUG-12/attachments/"))
        .collect();
    assert_eq!(files.len(), 1, "{sent}");
    assert_eq!(files[0].param("name"), Some("shot.png"));
    assert_eq!(files[0].param("comment"), Some("31"));
    assert_eq!(files[0].body, [1, 2, 3]);
    desk.all_signed();
}

#[test]
fn us_triage_003_e_edits_the_title_and_details_from_the_thread_and_sends_only_what_changed() {
    let desk = Desk::new(
        "us-triage-003-edit",
        vec![Item::new(12, "The total does not update")],
    );
    let edited = desk.screen("120x34", "enter e space now enter enter");
    assert!(edited.contains("BUG-12 edited: title"), "{edited}");
    let patches = desk.calls("PATCH", "/_p99/v1/issues/BUG-12");
    assert_eq!(patches.len(), 1, "{edited}");
    assert_eq!(
        patches[0].json(),
        json!({"title": "The total does not update now"})
    );
    let details = desk.screen("120x34", "enter e enter ctrl+u Zero ¶ always enter");
    assert!(details.contains("BUG-12 edited: details"), "{details}");
    let patches = desk.calls("PATCH", "/_p99/v1/issues/BUG-12");
    assert_eq!(patches.len(), 2, "{details}");
    assert_eq!(patches[1].json(), json!({"body": "Zero\nalways"}));
    let same = desk.screen("120x34", "enter e enter enter");
    assert!(same.contains("Nothing changed."), "{same}");
    assert_eq!(desk.calls("PATCH", "/_p99/v1/issues/BUG-12").len(), 2);
}

#[test]
fn us_triage_003_l_links_a_card_to_a_request_commit_tag_or_url() {
    let desk = Desk::with(
        "us-triage-003-link",
        World::new(vec![
            Item::new(12, "The total does not update").hostless("Ops"),
        ]),
        |req, _| {
            (req.method == "POST" && req.path == "/_p99/v1/cards/BUG-12/links").then(|| {
                Reply::json(
                    201,
                    json!({"key": "BUG-12", "link": {"ref": req.json()["ref"], "note": null}}),
                )
            })
        },
    );
    let linked = desk.screen("120x34", "enter l PR space #42 enter");
    assert!(linked.contains("BUG-12 linked to PR #42"), "{linked}");
    let links = desk.calls("POST", "/_p99/v1/cards/BUG-12/links");
    assert_eq!(links.len(), 1, "{linked}");
    assert_eq!(links[0].json(), json!({"ref": "PR #42", "note": null}));
    let refused = Desk::with(
        "us-triage-003-link-refused",
        World::new(vec![Item::new(12, "The total does not update")]),
        |req, _| {
            req.path
                .ends_with("/links")
                .then(|| Reply::problem(409, "BUG-12 is not a card"))
        },
    );
    let said = refused.screen("120x34", "enter l PR space #42 enter");
    assert!(said.contains("BUG-12 is not a card"), "{said}");
    assert!(said.contains("Cards / BUG-12"), "{said}");
}

#[test]
fn us_triage_001_a_thread_lists_its_files_and_f_saves_one_beside_the_tui() {
    let desk = Desk::with(
        "us-triage-001-files",
        World::new(vec![Item::new(12, "The total does not update")]),
        |req, world| match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/_p99/v1/issues/BUG-12") => Some(Reply::ok(json!({
                "issue": world.get(12).issue(),
                "comments": [],
                "attachments": [{"id": 5, "name": "cart.png", "type": "image/png", "bytes": 3, "role": "file"}],
                "events": [],
            }))),
            ("GET", "/_p99/v1/files/5") => Some(
                Reply::raw(200, "image/png", &[9, 8, 7])
                    .with("content-disposition", "attachment; filename=\"cart.png\""),
            ),
            _ => None,
        },
    );
    let thread = desk.screen("120x34", "enter");
    assert!(thread.contains("Files (1)"), "{thread}");
    assert!(thread.contains("cart.png · 3 B"), "{thread}");
    assert!(thread.contains("f save file"), "{thread}");
    let saved = desk.screen("120x34", "enter f enter");
    assert!(saved.contains("Saved cart.png (3 B) to "), "{saved}");
    assert_eq!(
        std::fs::read(desk.home.dir.join("cart.png")).unwrap(),
        [9, 8, 7]
    );
    desk.screen("120x34", "enter f enter");
    assert_eq!(
        std::fs::read(desk.home.dir.join("cart-2.png")).unwrap(),
        [9, 8, 7]
    );
}

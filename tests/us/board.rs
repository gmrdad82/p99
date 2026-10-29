use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use crate::desk::{Desk, Item, World, card_at, column_at};

fn two_cards() -> World {
    World::new(vec![
        Item::new(1, "First card"),
        Item::new(2, "Second card"),
    ])
}

#[test]
fn us_board_001_a_card_dragged_on_the_tui_board_moves_and_a_stale_drag_settles_where_the_other_session_put_it()
 {
    let desk = Desk::with("us-board-001-drag", two_cards(), |_, _| None);
    let dragged = desk.screen("140x34", "tab space right enter");
    let sent = desk.moves();
    assert_eq!(sent.len(), 1, "{dragged}");
    let key = sent[0]["key"].as_str().unwrap().to_owned();
    assert_eq!(sent[0], json!({"key": key, "from": "New", "to": "planned"}));
    assert!(
        dragged.contains("Planned 1") && dragged.contains("New 1"),
        "{dragged}"
    );
    assert!(
        card_at(&dragged, &key) >= column_at(&dragged, "Planned 1"),
        "{dragged}"
    );
    desk.all_signed();

    let flipped = AtomicBool::new(false);
    let stale = Desk::with("us-board-001-stale", two_cards(), move |req, world| {
        if !(req.method == "GET" && req.path == "/_p99/v1/board")
            || flipped.swap(true, Ordering::SeqCst)
        {
            return None;
        }
        let reply = world.answer(req);
        for item in &mut world.items {
            item.label = "Landed".to_owned();
        }
        Some(reply)
    });
    let settled = stale.screen("140x34", "tab space right enter");
    let moves = stale.moves();
    assert_eq!(moves.len(), 1);
    assert_eq!(moves[0]["from"], "New");
    let raced = moves[0]["key"].as_str().unwrap().to_owned();
    assert!(
        settled.contains(&format!("{raced} moved to Landed meanwhile")),
        "{settled}"
    );
    assert!(stale.calls("GET", "/_p99/v1/board").len() >= 2);
    assert!(settled.contains("Landed 2"), "{settled}");
    assert!(!settled.contains("Planned 1"), "{settled}");
    for key in ["BUG-1", "BUG-2"] {
        assert!(
            card_at(&settled, key) >= column_at(&settled, "Landed 2"),
            "{settled}"
        );
    }
    stale.all_signed();
}

#[test]
fn us_board_001_p99_card_move_places_a_card_by_lane_and_beside_another() {
    let desk = Desk::new(
        "us-board-001-card-move",
        vec![
            Item::new(1, "First card"),
            Item::new(2, "Second card").in_lane("Stuck"),
        ],
    );
    let h = &desk.home;
    let by_word = h.p99(&["card", "move", "BUG-1", "--to", "stuck", "--after", "BUG-2"]);
    by_word.ok();
    assert!(by_word.stderr.is_empty(), "{}", by_word.stderr);
    assert_eq!(by_word.stdout, "BUG-1 is in Stuck\n");
    let by_name = h.p99(&["card", "move", "1", "--to", "Landed", "--json"]);
    by_name.ok();
    assert_eq!(by_name.json()["card"]["label"], "Landed");
    assert_eq!(
        desk.moves(),
        [
            json!({"key": "1", "from": "New", "to": "stuck", "after": "2"}),
            json!({"key": "1", "from": "Stuck", "to": "Landed"}),
        ]
    );
    h.p99(&[
        "card", "move", "BUG-1", "--to", "new", "--before", "BUG-2", "--after", "BUG-2",
    ])
    .clap("the argument '--before <KEY>' cannot be used with '--after <KEY>'");
    assert_eq!(desk.moves().len(), 2);
    desk.all_signed();
}

#[test]
fn us_board_001_p99_move_still_moves_once_and_says_it_is_now_p99_card_move() {
    let desk = Desk::new(
        "us-board-001-move-renamed",
        vec![Item::new(1, "First card")],
    );
    let out = desk.home.p99(&["move", "BUG-1", "--to", "needs-you"]);
    out.ok();
    assert_eq!(out.stderr, "p99: p99 move is now p99 card move\n");
    assert_eq!(out.stdout, "BUG-1 is in Needs you\n");
    assert_eq!(desk.moves().len(), 1);
}

#[test]
fn us_board_002_n_in_the_tui_files_a_card_in_a_project_with_its_details_and_files() {
    let desk = Desk::with(
        "us-board-002-new",
        World::new(vec![Item::new(1, "First card")]),
        |req, world| match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/_p99/v1/space") => Some(crate::stub::Reply::ok(json!({
                "space": {"slug": "main", "name": "Example"},
                "projects": [
                    {"name": "Ops", "hosts": []},
                    {"name": "Shop", "hosts": ["shop.example.com"]},
                ],
            }))),
            ("POST", "/_p99/v1/cards") => {
                let body = req.json();
                let title = body["title"].as_str().unwrap_or_default();
                let project = body["project"].as_str().unwrap_or_default();
                let item = Item::new(29, title).hostless(project);
                world.items.push(item);
                Some(crate::stub::Reply::json(
                    201,
                    json!({"card": {
                        "key": "BUG-29", "kind": "bug", "project": project, "status": "new",
                        "label": "New", "lane": 1, "title": title, "host": "",
                        "reporter": {"name": "Ada Lovelace"}, "created_at": "2026-10-02T10:00:00.000Z",
                        "changed_at": "2026-10-02T10:00:00.000Z", "changed_by": null, "comments": 0,
                    }}),
                ))
            }
            ("PUT", path) if path.starts_with("/_p99/v1/issues/BUG-29/attachments/") => {
                Some(crate::stub::Reply::json(
                    201,
                    json!({"id": 3, "name": req.param("name"), "bytes": req.body.len()}),
                ))
            }
            _ => None,
        },
    );
    std::fs::write(desk.home.dir.join("log.txt"), "boom").unwrap();
    let places = desk.screen("120x34", "n");
    for place in [
        "New card in",
        "Ops",
        "Shop · shop.example.com",
        "A new project…",
    ] {
        assert!(places.contains(place), "{place}:\n{places}");
    }
    let filed = desk.screen(
        "120x34",
        "n enter enter Rotate space keys tab Every ¶ quarter tab log.txt enter",
    );
    assert!(filed.contains("BUG-29 filed in Ops with 1 file"), "{filed}");
    assert!(filed.contains("Cards / BUG-29"), "{filed}");
    let posted = desk.calls("POST", "/_p99/v1/cards");
    assert_eq!(posted.len(), 1, "{filed}");
    let body = posted[0].json();
    assert_eq!(
        (
            &body["project"],
            &body["title"],
            &body["body"],
            &body["kind"]
        ),
        (
            &json!("Ops"),
            &json!("Rotate keys"),
            &json!("Every\nquarter"),
            &json!("bug")
        )
    );
    assert!(body.get("host").is_none(), "{body}");
    let files: Vec<_> = desk
        .home
        .stub
        .seen()
        .into_iter()
        .filter(|r| r.method == "PUT" && r.path.contains("/issues/BUG-29/attachments/"))
        .collect();
    assert_eq!(files.len(), 1, "{filed}");
    assert_eq!(files[0].param("name"), Some("log.txt"));
    assert_eq!(files[0].param("comment"), None);
    let untitled = desk.screen("120x34", "n enter enter enter");
    assert!(untitled.contains("A card needs a title."), "{untitled}");
    assert_eq!(desk.calls("POST", "/_p99/v1/cards").len(), 1);
    desk.all_signed();
}

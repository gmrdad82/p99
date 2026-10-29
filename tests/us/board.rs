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

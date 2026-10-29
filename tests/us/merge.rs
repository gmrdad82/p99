use serde_json::json;

use crate::desk::{Desk, Item, World};
use crate::stub::Reply;

#[test]
fn us_merge_001_the_tui_merges_a_duplicate_into_the_card_typed() {
    let desk = Desk::with(
        "us-merge-001-tui",
        World::new(vec![
            Item::new(9, "The cart total is wrong"),
            Item::new(12, "The total does not update"),
        ]),
        |req, world| {
            (req.method == "POST" && req.path == "/_p99/v1/merge").then(|| {
                let body = req.json();
                let item = world.item("BUG-12").unwrap();
                item.resolution = Some("duplicate".into());
                item.label = "Done".into();
                item.duplicate_of = body["into"].as_str().map(str::to_owned);
                Reply::ok(json!({"into": body["into"], "merged": body["items"], "unchanged": []}))
            })
        },
    );
    let asked = desk.screen("120x34", "enter m end enter");
    assert!(asked.contains("Merge into"), "{asked}");
    let merged = desk.screen("120x34", "enter m end enter bug-9 enter");
    assert!(merged.contains("BUG-12 is Done (duplicate)"), "{merged}");
    let calls = desk.calls("POST", "/_p99/v1/merge");
    assert_eq!(calls.len(), 1, "{merged}");
    assert_eq!(
        calls[0].json(),
        json!({"items": ["BUG-12"], "into": "BUG-9"})
    );
    let kept = desk.screen("120x34", "enter m end enter esc");
    assert!(!kept.contains("is Done"), "{kept}");
    assert_eq!(desk.calls("POST", "/_p99/v1/merge").len(), 1);
}

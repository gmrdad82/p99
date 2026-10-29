#![cfg(unix)]

use std::time::Duration;

use serde_json::json;

use crate::desk::{Desk, Item};
use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req, thread};

fn delete_home(name: &str) -> Home {
    Home::new(name, |req: &Req| {
        if req.is("GET", "/_p99/v1/issues/12") {
            let mut found = thread(12, "The total does not update");
            found["issue"]["comments"] = json!(1);
            found["attachments"] = json!([{"id": 1, "name": "a.png"}, {"id": 2, "name": "b.png"}]);
            Reply::ok(found)
        } else if req.is("DELETE", "/_p99/v1/issues/12") {
            Reply::ok(json!({
                "key": "BUG-12",
                "comments": 1,
                "files": 2,
                "retrying": 0,
                "unlinked": [],
            }))
        } else {
            fake::any(req)
        }
    })
}

fn deletes(h: &Home) -> usize {
    h.stub.calls("DELETE", "/_p99/v1/issues/12").len()
}

#[test]
fn us_delete_001_typing_the_key_back_at_a_terminal_deletes_it() {
    let h = delete_home("us-delete-001-typed");
    let out = crate::live::at_terminal(&h, &["delete", "12"], b"BUG-12\n");
    out.ok();
    assert!(
        out.stderr.contains("Type BUG-12 to delete it: "),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr
            .contains("removes its 1 comment, 2 files and history for good"),
        "{}",
        out.stderr
    );
    assert_eq!(out.stdout, "BUG-12 deleted with 1 comment and 2 files\n");
    assert_eq!(deletes(&h), 1);
    let delete = h.stub.call("DELETE", "/_p99/v1/issues/12");
    assert!(delete.signed);
    assert_eq!(delete.actor()["email"], "ada@example.com");
}

#[test]
fn us_delete_001_a_wrong_key_or_no_yes_off_a_terminal_keeps_the_item() {
    for (name, typed) in [
        ("us-delete-001-wrong", &b"BUG-13\n"[..]),
        ("us-delete-001-number", b"12\n"),
        ("us-delete-001-blank", b"\n"),
    ] {
        let h = delete_home(name);
        let out = crate::live::at_terminal(&h, &["delete", "BUG-12"], typed);
        out.refused("BUG-12 is kept: the key typed back didn't match");
        assert!(out.stdout.is_empty(), "{name}: {}", out.stdout);
        assert_eq!(deletes(&h), 0, "{name}");
    }
    let h = delete_home("us-delete-001-script");
    h.p99(&["delete", "BUG-12"])
        .refused("deleting BUG-12 needs --yes when no one is at a terminal to type the key back");
    assert!(h.stub.seen().is_empty(), "nothing should reach the Worker");
}

#[test]
fn us_delete_001_an_open_thread_hears_the_delete_and_says_who() {
    let desk = Desk::new(
        "us-delete-001-heard",
        vec![Item::new(12, "The total does not update")],
    );
    let mut tui = crate::live::Live::start(&desk.home, &["tui"], 120, 34);
    assert!(
        tui.wait_for("BUG-12", Duration::from_secs(30)).is_some(),
        "the inbox never drew:\n{}",
        tui.screen()
    );
    tui.press(b"\r");
    assert!(
        tui.wait_for("Cards / BUG-12", Duration::from_secs(30))
            .is_some(),
        "the thread never opened:\n{}",
        tui.screen()
    );
    desk.wait_for_stream();
    desk.push(&[
        r#"{"type":"delete","key":"BUG-12","host":"shop.example.com","by":{"name":"Ada Lovelace","agent":false}}"#,
    ]);
    assert!(
        tui.wait_for("Ada Lovelace deleted BUG-12", Duration::from_secs(30))
            .is_some(),
        "the open thread never heard the delete:\n{}",
        tui.screen()
    );
    let after = tui.screen();
    assert!(!after.contains("Cards / BUG-12"), "{after}");
    assert!(!after.contains("The total does not update"), "{after}");
    tui.press(b"\x03");
}

use super::*;

fn keys(view: &BoardView, label: &str) -> Vec<String> {
    view.cards
        .iter()
        .filter(|card| card.label == label)
        .map(|card| card.key.clone())
        .collect()
}

fn to(key: &str, from: &str, to: &str, board: Option<i64>) -> Move {
    Move {
        key: key.into(),
        from: from.into(),
        to: to.into(),
        board,
        ..Move::default()
    }
}

#[test]
fn a_key_between_two_keys_sorts_strictly_between_them() {
    assert_eq!(between("", None), "V");
    assert_eq!(between("V", None), "l");
    assert_eq!(between("z", None), "zV");
    assert_eq!(between("", Some("z")), "V");
    assert_eq!(between("zV", Some("zl")), "zd");
    for (low, high) in [
        ("", "1"),
        ("a", "b"),
        ("a0", "a1"),
        ("zz", "zzz"),
        ("1", "11"),
        ("Az", "B"),
    ] {
        let middle = between(low, Some(high));
        assert!(
            low < middle.as_str() && middle.as_str() < high,
            "{low} < {middle} < {high}"
        );
        assert!(middle.bytes().all(|b| DIGITS.contains(&b)), "{middle}");
    }
}

#[test]
fn keys_appended_or_squeezed_in_again_and_again_never_collide() {
    let mut last = String::new();
    for _ in 0..200 {
        let next = between(&last, None);
        assert!(next > last, "{next} after {last}");
        last = next;
    }
    let low = "a".to_owned();
    let mut high = "b".to_owned();
    for _ in 0..200 {
        let middle = between(&low, Some(&high));
        assert!(low < middle && middle < high, "{low} < {middle} < {high}");
        high = middle;
    }
}

#[test]
fn the_sample_has_my_board_and_a_watched_one_with_their_own_lanes() {
    let demo = Demo::new();
    let shelf = demo.boards().boards;
    assert_eq!(shelf.len(), 2);
    assert!(shelf[0].mine && !shelf[1].mine);
    assert_eq!(shelf[1].whose(), "@grace.hopper");
    let shop = demo.board(None).expect("the sample has it");
    assert_eq!(shop.board.name, "Shop");
    assert_eq!(keys(&shop, "QA ready"), ["IMP-4", "IMP-17"]);
    assert_eq!(keys(&shop, "Done").len(), 5);
    let qa = demo.board(Some(2)).expect("the sample has it");
    assert_eq!(keys(&qa, "Testing"), ["BUG-14"]);
    assert_eq!(keys(&qa, "Verified"), ["TASK-21"]);
    assert!(qa.cards.iter().all(|card| card.order.is_some()));
    assert_eq!(
        demo.board(Some(9)).err().as_deref(),
        Some("no board is called 9 (404)")
    );
    assert_eq!(demo.labels(), ["Inbox", "Doing", "QA ready", "Done"]);
}

#[test]
fn labels_follow_the_status_unless_an_item_sits_in_a_watched_lane() {
    assert_eq!(status_label("doing"), "Doing");
    assert_eq!(status_label("review"), "QA ready");
    assert_eq!(status_label("done"), "Done");
    assert_eq!(status_label("inbox"), "Inbox");
    assert_eq!(status_label("anything"), "Inbox");
    let testing = Issue {
        id: 14,
        status: "review".into(),
        ..Issue::default()
    };
    assert_eq!(label_of(&testing), "Testing");
    let plain = Issue {
        id: 4,
        status: "review".into(),
        ..Issue::default()
    };
    assert_eq!(label_of(&plain), "QA ready");
}

#[test]
fn a_move_on_my_board_relabels_reorders_and_returns_the_card() {
    let mut demo = Demo::new();
    let mut request = to("Q-10", "Inbox", "Doing", Some(1));
    request.before = Some("TASK-6".into());
    let moved = demo.shift(&request).expect("the sample takes it");
    assert_eq!(moved.card.key, "Q-10");
    assert_eq!(moved.card.label, "Doing");
    let shop = demo.board(Some(1)).expect("the sample has it");
    assert_eq!(&keys(&shop, "Doing")[..3], ["IMP-5", "Q-10", "TASK-6"]);
    let item = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(item.status, "doing");
    assert_eq!(item.resolution, None);
}

#[test]
fn a_move_after_the_last_card_lands_at_the_end() {
    let mut demo = Demo::new();
    let mut request = to("Q-10", "Inbox", "QA ready", Some(1));
    request.after = Some("IMP-17".into());
    demo.shift(&request).expect("the sample takes it");
    let shop = demo.board(Some(1)).expect("the sample has it");
    assert_eq!(keys(&shop, "QA ready"), ["IMP-4", "IMP-17", "Q-10"]);
}

#[test]
fn a_move_into_a_closing_lane_closes_and_out_of_it_reopens() {
    let mut demo = Demo::new();
    demo.shift(&to("Q-10", "Inbox", "Done", Some(1)))
        .expect("the sample takes it");
    let closed = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(closed.status, "done");
    assert_eq!(closed.resolution.as_deref(), Some("fixed"));
    assert!(closed.closed_at.is_some());
    demo.shift(&to("Q-10", "Done", "Inbox", Some(1)))
        .expect("the sample takes it");
    let open = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(open.status, "inbox");
    assert_eq!(open.resolution, None);
    assert_eq!(open.closed_at, None);
    let dropped = demo.thread("BUG-1").expect("the sample has it").issue;
    assert_eq!(dropped.resolution.as_deref(), Some("abandoned"));
    demo.shift(&to("BUG-1", "Done", "Done", Some(1)))
        .expect("the sample takes it");
    let still = demo.thread("BUG-1").expect("the sample has it").issue;
    assert_eq!(still.resolution.as_deref(), Some("abandoned"));
}

#[test]
fn a_move_without_a_board_relabels_and_appends_to_each_board_with_that_lane() {
    let mut demo = Demo::new();
    let moved = demo
        .shift(&to("Q-10", "Inbox", "QA ready", None))
        .expect("the sample takes it");
    assert_eq!(moved.card.label, "QA ready");
    let shop = demo.board(Some(1)).expect("the sample has it");
    assert!(keys(&shop, "QA ready").contains(&"Q-10".to_owned()));
    let qa = demo.board(Some(2)).expect("the sample has it");
    assert_eq!(
        keys(&qa, "QA ready").last().map(String::as_str),
        Some("Q-10")
    );
}

#[test]
fn a_move_the_sample_cannot_make_says_why_like_the_worker() {
    let mut demo = Demo::new();
    assert_eq!(
        demo.shift(&to("Q-10", "Inbox", "Testing", Some(1)))
            .err()
            .as_deref(),
        Some("Testing is not a label on your boards")
    );
    assert_eq!(
        demo.shift(&to("BUG-14", "Testing", "QA ready", Some(2)))
            .err()
            .as_deref(),
        Some("this board is @grace.hopper's; only its owner moves its cards (403)")
    );
    assert_eq!(
        demo.shift(&to("Q-10", "Inbox", "Doing", Some(9)))
            .err()
            .as_deref(),
        Some("no board is called 9 (404)")
    );
    assert_eq!(
        demo.shift(&to("lamp", "Inbox", "Doing", Some(1)))
            .err()
            .as_deref(),
        Some("lamp is not an item key")
    );
    assert_eq!(
        demo.shift(&to("BUG-99", "Inbox", "Doing", Some(1)))
            .err()
            .as_deref(),
        Some("no item is called BUG-99")
    );
    assert_eq!(
        demo.shift(&to("Q-10", "Doing", "Done", Some(1)))
            .err()
            .as_deref(),
        Some("this card moved; refreshed (409)")
    );
    let untouched = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(untouched.label.as_deref(), Some("Inbox"));
    assert_eq!(untouched.status, "inbox");
}

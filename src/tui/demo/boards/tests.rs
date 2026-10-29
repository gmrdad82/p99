use super::*;

fn keys(view: &BoardView, word: Lane) -> Vec<String> {
    view.cards
        .iter()
        .filter(|card| card.status == word)
        .map(|card| card.key.clone())
        .collect()
}

fn to(key: &str, from: &str, to: &str) -> Move {
    Move {
        key: key.into(),
        from: from.into(),
        to: to.into(),
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
fn the_sample_is_one_board_of_seven_lanes_holding_plain_items_and_cards() {
    let demo = Demo::new();
    let view = demo.one_board(&[]);
    let words: Vec<&str> = view.lanes.iter().map(|l| l.word.word()).collect();
    assert_eq!(
        words,
        [
            "new",
            "planned",
            "in-progress",
            "needs-you",
            "stuck",
            "landed",
            "done"
        ]
    );
    assert_eq!(view.cards.len(), 28);
    assert!(view.missing.is_empty());
    assert_eq!(keys(&view, Lane::Planned), ["TASK-24"]);
    assert_eq!(keys(&view, Lane::NeedsYou), ["BUG-25"]);
    assert_eq!(
        keys(&view, Lane::Landed),
        ["IMP-4", "BUG-14", "IMP-17", "FEAT-27"]
    );
    assert_eq!(keys(&view, Lane::Done).len(), 7);
    assert!(view.cards.iter().all(|card| card.order.is_some()));
    assert!(view.cards.iter().all(|card| card.space == 0));
    let places: Vec<Option<u32>> = view
        .cards
        .iter()
        .filter(|c| c.status == Lane::Landed)
        .map(|c| c.lane)
        .collect();
    assert_eq!(places, [Some(1), Some(2), Some(3), Some(4)]);
    assert!(
        view.cards
            .iter()
            .filter(|c| c.status == Lane::Done)
            .all(|c| c.lane.is_none())
    );
}

#[test]
fn a_project_filter_keeps_that_project_s_cards_and_hides_plain_items() {
    let demo = Demo::new();
    let one = demo.one_board(&["storefront".into()]);
    let shown: Vec<&str> = one.cards.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(shown, ["FEAT-23", "BUG-25", "BUG-26", "TASK-28"]);
    let both = demo.one_board(&["Storefront".into(), "Mobile app".into()]);
    assert_eq!(both.cards.len(), 6);
    assert!(both.cards.iter().all(|c| c.project.is_some()));
    assert!(demo.one_board(&["Nothing".into()]).cards.is_empty());
    assert_eq!(demo.projects(), ["Mobile app", "Storefront"]);
}

#[test]
fn what_waits_is_the_cards_in_needs_you_stuck_and_landed_newest_first() {
    let demo = Demo::new();
    let (count, cards) = demo.waiting();
    assert_eq!(count, 3);
    let keys: Vec<&str> = cards.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(keys, ["BUG-25", "BUG-26", "FEAT-27"]);
    assert_eq!(cards[0].status, Lane::NeedsYou);
    assert_eq!(cards[0].label, "Needs you");
    assert_eq!(cards[0].project, "Storefront");
    assert_eq!(cards[2].project, "Mobile app");
    assert!(cards.iter().all(|c| c.reporter.name.is_some()));
    assert!(
        cards
            .windows(2)
            .all(|pair| pair[0].changed_at >= pair[1].changed_at)
    );
}

#[test]
fn labels_follow_the_status_into_the_seven_lanes() {
    assert_eq!(status_label("inbox"), "New");
    assert_eq!(status_label("doing"), "In progress");
    assert_eq!(status_label("review"), "Landed");
    assert_eq!(status_label("done"), "Done");
    assert_eq!(status_label("needs-you"), "Needs you");
    assert_eq!(status_label("stuck"), "Stuck");
    assert_eq!(status_label("anything"), "New");
    let review = Issue {
        id: 14,
        status: "review".into(),
        ..Issue::default()
    };
    assert_eq!(label_of(&review), "Landed");
    assert_eq!(project_of(1), None);
    assert_eq!(project_of(FIRST_CARD), Some("Storefront"));
    assert_eq!(project_of(FIRST_CARD + 1), Some("Mobile app"));
}

#[test]
fn a_move_by_lane_word_relabels_reorders_and_returns_the_card() {
    let mut demo = Demo::new();
    let mut request = to("Q-10", "New", "in-progress");
    request.before = Some("TASK-6".into());
    let moved = demo.shift(&request).expect("the sample takes it");
    assert_eq!(moved.card.key, "Q-10");
    assert_eq!(moved.card.label, "In progress");
    assert!(moved.card.order.is_some());
    let view = demo.one_board(&[]);
    assert_eq!(
        &keys(&view, Lane::InProgress)[..3],
        ["IMP-5", "Q-10", "TASK-6"]
    );
    let item = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(item.status, "doing");
    assert_eq!(item.resolution, None);
}

#[test]
fn a_move_by_lane_name_in_any_case_works_like_its_word() {
    let mut demo = Demo::new();
    let moved = demo
        .shift(&to("Q-10", "New", "needs you"))
        .expect("the sample takes it");
    assert_eq!(moved.card.label, "Needs you");
    assert_eq!(
        keys(&demo.one_board(&[]), Lane::NeedsYou),
        ["Q-10", "BUG-25"]
    );
}

#[test]
fn a_move_after_the_last_card_lands_at_the_end() {
    let mut demo = Demo::new();
    let mut request = to("Q-10", "New", "landed");
    request.after = Some("FEAT-27".into());
    demo.shift(&request).expect("the sample takes it");
    let item = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(item.status, "review");
    assert_eq!(
        keys(&demo.one_board(&[]), Lane::Landed),
        ["IMP-4", "BUG-14", "IMP-17", "FEAT-27", "Q-10"]
    );
}

#[test]
fn a_move_into_the_closing_lane_closes_and_out_of_it_reopens() {
    let mut demo = Demo::new();
    demo.shift(&to("Q-10", "New", "done"))
        .expect("the sample takes it");
    let closed = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(closed.status, "done");
    assert_eq!(closed.resolution.as_deref(), Some("fixed"));
    assert!(closed.closed_at.is_some());
    demo.shift(&to("Q-10", "Done", "new"))
        .expect("the sample takes it");
    let open = demo.thread("Q-10").expect("the sample has it").issue;
    assert_eq!(open.status, "inbox");
    assert_eq!(open.resolution, None);
    assert_eq!(open.closed_at, None);
    let dropped = demo.thread("BUG-1").expect("the sample has it").issue;
    assert_eq!(dropped.resolution.as_deref(), Some("abandoned"));
    demo.shift(&to("BUG-1", "Done", "done"))
        .expect("the sample takes it");
    let still = demo.thread("BUG-1").expect("the sample has it").issue;
    assert_eq!(still.resolution.as_deref(), Some("abandoned"));
}

#[test]
fn a_move_the_sample_cannot_make_says_why_like_the_worker() {
    let mut demo = Demo::new();
    assert_eq!(
        demo.shift(&to("Q-10", "New", "testing")).err().as_deref(),
        Some("testing is not a lane (400)")
    );
    assert_eq!(
        demo.shift(&to("Q-10", "Inbox", "planned")).err().as_deref(),
        Some("this card moved; refreshed (409)")
    );
    assert_eq!(
        demo.shift(&to("lamp", "New", "planned")).err().as_deref(),
        Some("lamp is not a card key")
    );
    assert_eq!(
        demo.shift(&to("BUG-99", "New", "planned")).err().as_deref(),
        Some("no card is called BUG-99")
    );
}

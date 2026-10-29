use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::super::source::Source;
use super::*;

pub(in crate::tui) fn without_codes() -> Source {
    let mut demo = Demo::new();
    demo.codes.clear();
    Source::Demo(Arc::new(Mutex::new(demo)), Duration::ZERO)
}

pub(in crate::tui) fn with_parked() -> Source {
    let mut demo = Demo::new();
    demo.codes.push(Code {
        id: 5,
        name: "Katherine Johnson".into(),
        email: "katherine@example.com".into(),
        hint: "p4rk".into(),
        created_at: iso(NOW - DAY),
        grant: Some(wire::Grant::default()),
        ..Code::default()
    });
    Source::Demo(Arc::new(Mutex::new(demo)), Duration::ZERO)
}

fn issue(demo: &mut Demo, key: &str) -> Issue {
    demo.thread(key).expect("the sample has it").issue
}

#[test]
fn the_sample_holds_every_kind_and_state_with_unique_keys() {
    let demo = Demo::new();
    let list = demo.list();
    assert_eq!(list.len(), 28);
    let mut keys: Vec<&str> = list.iter().map(|e| e.summary.key.as_str()).collect();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), 28);
    for kind in ["bug", "feature", "improvement", "question", "task"] {
        assert!(list.iter().any(|e| e.summary.kind == kind), "{kind}");
    }
    for status in wire::STATUSES {
        assert!(list.iter().any(|e| e.summary.status == status), "{status}");
    }
    assert_eq!(list.iter().filter(|e| e.summary.unread).count(), 3);
    assert!(list.iter().all(|e| e.space == 0));
}

#[test]
fn the_sample_names_only_example_people_and_hosts() {
    let mut demo = Demo::new();
    let keys: Vec<String> = demo.list().into_iter().map(|e| e.summary.key).collect();
    for key in keys {
        let thread = demo.thread(&key).expect("the sample has it");
        let reporter = &thread.issue.reporter;
        assert!(
            reporter["email"]
                .as_str()
                .is_some_and(|e| e.ends_with("@example.com")),
            "{key}"
        );
        assert!(
            thread
                .issue
                .host
                .as_deref()
                .is_some_and(|h| h.ends_with("example.com")),
            "{key}"
        );
        assert!(thread.issue.page.url.starts_with("https://"), "{key}");
        for comment in &thread.comments {
            assert!(comment.author.email.ends_with("@example.com"), "{key}");
        }
    }
    for code in demo.codes() {
        assert!(code.email.ends_with("@example.com"));
        assert!(code.hosts.iter().all(|h| h.ends_with("example.com")));
    }
    assert!(demo.hosts().iter().all(|h| h.ends_with("example.com")));
}

#[test]
fn every_history_runs_oldest_first_and_starts_with_its_creation() {
    let mut demo = Demo::new();
    let keys: Vec<String> = demo.list().into_iter().map(|e| e.summary.key).collect();
    for key in keys {
        let thread = demo.thread(&key).expect("the sample has it");
        assert_eq!(thread.events[0].kind, "created", "{key}");
        assert!(
            thread
                .events
                .windows(2)
                .all(|pair| pair[0].at <= pair[1].at),
            "{key}"
        );
        assert_eq!(
            thread.issue.comments as usize,
            thread.comments.len(),
            "{key}"
        );
        assert_eq!(
            thread.issue.closed_at.is_some(),
            !wire::open(&thread.issue.status),
            "{key}"
        );
    }
}

#[test]
fn the_duplicate_points_at_its_original_and_the_original_lists_it() {
    let mut demo = Demo::new();
    let copy = issue(&mut demo, "BUG-12");
    assert_eq!(copy.duplicate_of.as_deref(), Some("BUG-11"));
    assert_eq!(copy.resolution.as_deref(), Some("duplicate"));
    let original = issue(&mut demo, "BUG-11");
    assert_eq!(original.merged.len(), 1);
    assert_eq!(original.merged[0].key, "BUG-12");
    assert_eq!(original.merged[0].reporter["name"], "Grace Hopper");
}

#[test]
fn reading_a_thread_marks_it_read_and_names_the_people_on_the_space() {
    let mut demo = Demo::new();
    let unread = |demo: &Demo| demo.list().into_iter().filter(|e| e.summary.unread).count();
    assert_eq!(unread(&demo), 3);
    let thread = demo.thread("FEAT-9").expect("the sample has it");
    assert!(!thread.issue.unread);
    assert_eq!(unread(&demo), 2);
    let people: Vec<(&str, bool)> = thread
        .people
        .iter()
        .map(|m| (m.username.as_str(), m.manager))
        .collect();
    assert_eq!(people, [("ada.lovelace", true), ("grace.hopper", false)]);
}

#[test]
fn a_key_that_is_not_one_or_names_nothing_is_refused() {
    let mut demo = Demo::new();
    assert_eq!(
        demo.thread("lamp").err().as_deref(),
        Some("lamp is not a card key")
    );
    assert_eq!(
        demo.thread("BUG-99").err().as_deref(),
        Some("no card is called BUG-99")
    );
    assert_eq!(
        demo.comment("BUG-99", "hi", false).err().as_deref(),
        Some("no card is called BUG-99")
    );
    assert_eq!(
        demo.change("lamp", &Change::default()).err().as_deref(),
        Some("lamp is not a card key")
    );
    assert_eq!(
        demo.delete("BUG-99").err().as_deref(),
        Some("no card is called BUG-99")
    );
    assert_eq!(
        demo.delete("lamp").err().as_deref(),
        Some("lamp is not a card key")
    );
}

#[test]
fn a_comment_is_mine_numbered_after_the_last_and_dated_now() {
    let mut demo = Demo::new();
    let first = demo
        .comment("TASK-6", "Started", false)
        .expect("the sample takes it");
    let second = demo
        .comment("TASK-6", "Halfway", true)
        .expect("the sample takes it");
    assert_eq!(second.id, first.id + 1);
    assert_eq!(first.client_uid, format!("demo-{}", first.id));
    assert_eq!(first.author.name, ME.0);
    assert!(first.author.manager);
    assert!(second.internal);
    assert_eq!(first.created_at, iso(NOW));
    let thread = demo.thread("TASK-6").expect("the sample has it");
    assert_eq!(thread.issue.comments, 2);
    assert_eq!(thread.issue.updated_at, iso(NOW));
}

#[test]
fn a_status_change_moves_the_label_logs_it_and_closes_or_reopens() {
    let mut demo = Demo::new();
    let done = Change {
        status: Some("done".into()),
        ..Change::default()
    };
    let closed = demo.change("Q-10", &done).expect("the sample takes it");
    assert_eq!(closed.resolution.as_deref(), Some("fixed"));
    assert_eq!(closed.label.as_deref(), Some("Done"));
    assert_eq!(closed.closed_at, Some(iso(NOW)));
    let review = Change {
        status: Some("review".into()),
        ..Change::default()
    };
    let reopened = demo.change("Q-10", &review).expect("the sample takes it");
    assert_eq!(reopened.resolution, None);
    assert_eq!(reopened.closed_at, None);
    assert_eq!(reopened.label.as_deref(), Some("Landed"));
    let events = demo.thread("Q-10").expect("the sample has it").events;
    let last = events.last().expect("an event");
    assert_eq!(last.kind, "status");
    assert_eq!(last.detail["from"], "done");
    assert_eq!(last.detail["to"], "review");
    let reopen = Change {
        status: Some("inbox".into()),
        ..Change::default()
    };
    let copy = demo.change("BUG-12", &reopen).expect("the sample takes it");
    assert_eq!(copy.duplicate_of, None);
}

#[test]
fn a_status_or_resolution_the_sample_does_not_know_is_refused() {
    let mut demo = Demo::new();
    let unknown = Change {
        status: Some("shipped".into()),
        ..Change::default()
    };
    assert_eq!(
        demo.change("Q-10", &unknown).err().as_deref(),
        Some("shipped is not a status")
    );
    let open_with_resolution = Change {
        status: Some("doing".into()),
        resolution: Some("fixed".into()),
        ..Change::default()
    };
    assert_eq!(
        demo.change("Q-10", &open_with_resolution).err().as_deref(),
        Some("a resolution goes with done")
    );
    assert_eq!(issue(&mut demo, "Q-10").status, "inbox");
}

#[test]
fn assigning_me_names_the_reader_and_nobody_unassigns_with_a_logged_event() {
    let mut demo = Demo::new();
    let me = Change {
        assignee: Some(Some("me".into())),
        ..Change::default()
    };
    let mine = demo.change("Q-10", &me).expect("the sample takes it");
    assert_eq!(
        mine.assignee.map(|a| a.username).as_deref(),
        Some("ada.lovelace")
    );
    let nobody = Change {
        assignee: Some(None),
        ..Change::default()
    };
    let free = demo.change("Q-10", &nobody).expect("the sample takes it");
    assert!(free.assignee.is_none());
    let events = demo.thread("Q-10").expect("the sample has it").events;
    let last = events.last().expect("an event");
    assert_eq!(last.kind, "assignee");
    assert_eq!(last.detail["from"]["username"], "ada.lovelace");
    assert!(last.detail["to"].is_null());
}

#[test]
fn a_resolution_or_a_duplicate_alone_closes_the_item_into_done() {
    let mut demo = Demo::new();
    let drop = Change {
        resolution: Some("abandoned".into()),
        ..Change::default()
    };
    let dropped = demo.change("Q-10", &drop).expect("the sample takes it");
    assert_eq!(dropped.status, "done");
    assert_eq!(dropped.resolution.as_deref(), Some("abandoned"));
    assert_eq!(dropped.label.as_deref(), Some("Done"));
    let merge = Change {
        duplicate_of: Some("BUG-11".into()),
        ..Change::default()
    };
    let merged = demo.change("BUG-15", &merge).expect("the sample takes it");
    assert_eq!(merged.status, "done");
    assert_eq!(merged.resolution.as_deref(), Some("duplicate"));
    assert_eq!(merged.duplicate_of.as_deref(), Some("BUG-11"));
    let events = demo.thread("BUG-15").expect("the sample has it").events;
    let last = events.last().expect("an event");
    assert_eq!(last.kind, "label");
    assert_eq!(last.detail["to"], "Done");
}

#[test]
fn deleting_an_original_reopens_its_duplicates_and_counts_what_went() {
    let mut demo = Demo::new();
    let gone = demo.delete("BUG-11").expect("the sample takes it");
    assert_eq!(gone.key, "BUG-11");
    assert_eq!(gone.comments, 4);
    assert_eq!(gone.files, 1);
    assert_eq!(gone.unlinked, ["BUG-12"]);
    let copy = issue(&mut demo, "BUG-12");
    assert_eq!(copy.status, "inbox");
    assert_eq!(copy.resolution, None);
    assert_eq!(copy.duplicate_of, None);
    assert_eq!(demo.list().len(), 27);
    let none = demo.delete("BUG-12").expect("the sample takes it");
    assert!(none.unlinked.is_empty());
}

#[test]
fn deleting_a_duplicate_takes_it_off_its_original() {
    let mut demo = Demo::new();
    demo.delete("BUG-12").expect("the sample takes it");
    assert!(issue(&mut demo, "BUG-11").merged.is_empty());
}

#[test]
fn a_summary_carries_the_reporter_and_the_fields_the_list_shows() {
    let mut demo = Demo::new();
    let item = issue(&mut demo, "BUG-8");
    let line = summary(&item);
    assert_eq!(line.key, "BUG-8");
    assert_eq!(line.reporter.name, "Ada Lovelace");
    assert_eq!(line.reporter.email, "ada@example.com");
    assert!(line.reporter.agent);
    assert_eq!(line.host.as_deref(), Some("dev.example.com"));
    assert_eq!(line.env, "development");
    assert!(line.landing.branch);
    let bare = summary(&Issue::default());
    assert_eq!(bare.reporter.name, "");
    assert!(!bare.reporter.agent);
}

#[test]
fn the_codes_cover_a_manager_a_revoked_and_a_never_used_code() {
    let demo = Demo::new();
    let codes = demo.codes();
    assert_eq!(codes.len(), 4);
    assert!(codes.iter().any(|c| c.manager));
    assert!(codes.iter().any(|c| c.revoked_at.is_some()));
    assert!(codes.iter().any(|c| c.last_used_at.is_none()));
    assert!(
        without_codes()
            .codes()
            .expect("the sample reads")
            .is_empty()
    );
}

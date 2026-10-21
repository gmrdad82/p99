use std::sync::mpsc::{Receiver, channel};

use pito_tui::Wake;

use crate::config::Host;
use crate::wire::{Change, PageRef, Person};

use super::super::deck::{Move, NONE};
use super::super::demo::NOW;
use super::*;

fn ghost(accounts: &[&str]) -> Source {
    let mut config = Config::default();
    config.hosts.insert(
        "example.com".into(),
        Host {
            account: "ghost".into(),
            ..Host::default()
        },
    );
    config.hosts.insert(
        "elsewhere.example.com".into(),
        Host {
            account: "other".into(),
            ..Host::default()
        },
    );
    Source::Live(Arc::new(Live {
        config,
        accounts: accounts.iter().map(|name| (*name).to_owned()).collect(),
        agent: false,
        clients: OnceLock::new(),
        listeners: Mutex::new(Vec::new()),
    }))
}

fn listening() -> (Mutex<Vec<Waker<Msg>>>, Receiver<Wake<Msg>>) {
    let (sender, inbox) = channel();
    (Mutex::new(vec![Waker::new(sender, 4)]), inbox)
}

fn heard(inbox: &Receiver<Wake<Msg>>) -> Vec<String> {
    inbox
        .try_iter()
        .map(|wake| match wake {
            Wake::Event(4, Msg::Pushed(account, key)) => format!("pushed {account} {key:?}"),
            Wake::Event(4, Msg::Heard(account, text)) => format!("heard {account} {text}"),
            _ => "something else".to_owned(),
        })
        .collect()
}

fn summary(key: &str) -> Summary {
    Summary {
        key: key.into(),
        kind: "feature".into(),
        status: "done".into(),
        resolution: Some("abandoned".into()),
        title: "Dark mode".into(),
        host: Some("blog.example.com".into()),
        page: PageRef {
            path: "/posts/night".into(),
            ..PageRef::default()
        },
        reporter: Person {
            email: "grace@example.com".into(),
            name: "Grace Hopper".into(),
            agent: false,
        },
        label: Some("QA ready".into()),
        ..Summary::default()
    }
}

#[test]
fn folding_drops_case_and_accents_so_words_match_as_people_type_them() {
    assert_eq!(fold("Ćafé ÜBER Straße"), "cafe uber straße");
    assert_eq!(words("  Grace   HÓPPER "), ["grace", "hopper"]);
    assert!(words("").is_empty());
    let haystack = fold("Grace Hopper grace@example.com");
    assert!(hits(&haystack, &words("hopp GRACE")));
    assert!(hits(&haystack, &[]));
    assert!(!hits(&haystack, &words("grace lovelace")));
}

#[test]
fn an_entry_is_found_by_every_word_a_person_sees_for_it() {
    let entry = Entry::new(2, summary("FEAT-9"));
    assert_eq!(entry.account, 2);
    for word in [
        "feat-9",
        "feature",
        "idea",
        "dropped",
        "dark mode",
        "blog.example.com",
        "/posts/night",
        "grace hopper",
        "grace@example.com",
        "qa ready",
    ] {
        assert!(
            entry.haystack.contains(word),
            "{word} in {}",
            entry.haystack
        );
    }
    let mut changed = entry.clone();
    changed.summary.title = "Light mode".into();
    assert!(changed.haystack.contains("dark mode"));
    changed.refold();
    assert!(changed.haystack.contains("light mode"));
    assert!(!changed.haystack.contains("dark mode"));
}

#[test]
fn a_person_is_their_name_or_else_their_email_and_an_agent_gets_a_star() {
    assert_eq!(
        person("Ada Lovelace", "ada@example.com", false),
        "Ada Lovelace"
    );
    assert_eq!(person("", "ada@example.com", false), "ada@example.com");
    assert_eq!(
        person("Ada Lovelace", "ada@example.com", true),
        "Ada Lovelace*"
    );
    assert_eq!(person("", "", true), "*");
}

#[test]
fn stamps_read_and_write_as_utc_seconds_both_ways() {
    assert_eq!(unix("2026-10-21T12:34:56Z"), Some(1_792_586_096));
    assert_eq!(unix("2026-10-21 12:34:56"), Some(1_792_586_096));
    assert_eq!(unix("2026-10-21T12:34:56.789+00:00"), Some(1_792_586_096));
    assert_eq!(unix("2024-02-29T00:00:00Z"), Some(1_709_164_800));
    assert_eq!(unix("2000-03-01T00:00:00Z"), Some(951_868_800));
    assert_eq!(unix("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(iso(1_792_586_096), "2026-10-21T12:34:56Z");
    assert_eq!(iso(NOW), "2026-10-14T12:00:00Z");
    assert_eq!(iso(-1), "1969-12-31T23:59:59Z");
    assert_eq!(iso(1_709_164_800), "2024-02-29T00:00:00Z");
    for seconds in [
        0,
        59,
        86_399,
        951_868_800,
        1_709_164_800,
        NOW,
        -86_400 * 400,
    ] {
        assert_eq!(unix(&iso(seconds)), Some(seconds), "{seconds}");
    }
}

#[test]
fn a_stamp_that_is_short_misshapen_or_not_numbers_reads_as_none() {
    for bad in [
        "",
        "2026-10-21",
        "2026-10-21X12:34:56",
        "yesterday at noon!",
        "2026-1O-21T12:34:56",
        "2026-10-21T12:3x:56",
    ] {
        assert_eq!(unix(bad), None, "{bad}");
    }
}

#[test]
fn known_hosts_and_hosts_seen_on_items_merge_sorted_once_each() {
    let mut other = summary("BUG-2");
    other.host = Some("example.com".into());
    let mut hostless = summary("BUG-3");
    hostless.host = None;
    let entries = [
        Entry::new(0, summary("BUG-1")),
        Entry::new(0, other),
        Entry::new(0, hostless),
    ];
    assert_eq!(
        merged_hosts(
            vec!["shop.example.com".into(), "example.com".into()],
            &entries
        ),
        ["blog.example.com", "example.com", "shop.example.com"]
    );
    assert!(merged_hosts(Vec::new(), &[]).is_empty());
}

#[test]
fn the_sample_source_is_one_account_at_a_fixed_now() {
    let source = Source::demo(Duration::ZERO);
    assert!(source.is_demo());
    assert_eq!(source.accounts(), ["sample"]);
    assert_eq!(source.now(), NOW);
    assert_eq!(
        source.hosts(),
        ["dev.example.com", "example.com", "shop.example.com"]
    );
    assert_eq!(
        source.client(0, None).err().as_deref(),
        Some("not the live data")
    );
}

#[test]
fn the_sample_inbox_comes_newest_first_and_codes_newest_first() {
    let source = Source::demo(Duration::ZERO);
    let entries = source.inbox().expect("the sample reads");
    assert_eq!(entries.len(), 22);
    assert!(entries.windows(2).all(|pair| {
        let (a, b) = (&pair[0].summary, &pair[1].summary);
        a.updated_at > b.updated_at || (a.updated_at == b.updated_at && a.id > b.id)
    }));
    assert_eq!(entries[0].summary.key, "BUG-11");
    let codes = source.codes().expect("the sample reads");
    let hints: Vec<&str> = codes.iter().map(|c| c.hint.as_str()).collect();
    assert_eq!(hints, ["q81v", "m9xa", "3fpd", "7k2q"]);
}

#[test]
fn the_sample_source_reads_and_writes_threads_through_the_sample() {
    let source = Source::demo(Duration::ZERO);
    let thread = source.thread(0, None, "BUG-11").expect("the sample has it");
    assert_eq!(thread.comments.len(), 4);
    let comment = source
        .comment(0, Some("shop.example.com"), "BUG-11", "Looking", true)
        .expect("the sample takes it");
    assert!(comment.internal);
    assert_eq!(
        source
            .thread(0, None, "BUG-11")
            .expect("the sample has it")
            .comments
            .len(),
        5
    );
    let change = Change {
        status: Some("doing".into()),
        ..Change::default()
    };
    let issue = source
        .change(0, None, "BUG-11", &change)
        .expect("the sample takes it");
    assert_eq!(issue.status, "doing");
    let gone = source
        .delete(0, None, "BUG-11")
        .expect("the sample takes it");
    assert_eq!(gone.unlinked, ["BUG-12"]);
    assert_eq!(
        source.thread(0, None, "BUG-11").err().as_deref(),
        Some("no item is called BUG-11")
    );
    assert_eq!(
        source.thread(0, None, "not a key").err().as_deref(),
        Some("not a key is not an item key")
    );
}

#[test]
fn a_poisoned_sample_says_it_broke_instead_of_panicking() {
    let source = Source::demo(Duration::ZERO);
    let Source::Demo(demo, _) = &source else {
        panic!("the sample");
    };
    let held = Arc::clone(demo);
    let _ = std::thread::spawn(move || {
        let _guard = held.lock();
        panic!("poison the sample");
    })
    .join();
    assert_eq!(
        source.inbox().err().as_deref(),
        Some("the sample data broke")
    );
    assert!(source.hosts().is_empty());
}

#[test]
fn a_broken_source_answers_every_read_and_write_with_why() {
    let source = Source::Broken("no account yet; p99 setup makes one".into());
    let why = Some("no account yet; p99 setup makes one");
    assert!(!source.is_demo());
    assert!(source.accounts().is_empty());
    assert!(source.hosts().is_empty());
    assert_eq!(source.inbox().err().as_deref(), why);
    assert_eq!(source.codes().err().as_deref(), why);
    assert_eq!(source.thread(0, None, "BUG-1").err().as_deref(), why);
    assert_eq!(
        source
            .comment(0, None, "BUG-1", "hi", false)
            .err()
            .as_deref(),
        why
    );
    assert_eq!(
        source
            .change(0, None, "BUG-1", &Change::default())
            .err()
            .as_deref(),
        why
    );
    assert_eq!(source.delete(0, None, "BUG-1").err().as_deref(), why);
    assert_eq!(source.client(0, None).err().as_deref(), why);
    assert_eq!(source.boards().err().as_deref(), why);
    assert_eq!(source.board(None).err().as_deref(), why);
    assert_eq!(source.labels(0).err().as_deref(), why);
    assert_eq!(source.shift(0, &Move::default()).err().as_deref(), why);
    assert_eq!(
        source.sample(|_| Ok(())).err().as_deref(),
        Some("not the sample data")
    );
    assert!(source.now() > NOW - 86_400 * 365);
}

#[test]
fn a_live_source_with_an_account_the_config_lacks_says_so_without_the_network() {
    let source = ghost(&["ghost"]);
    let why = Some("no account is called ghost");
    assert!(!source.is_demo());
    assert_eq!(source.accounts(), ["ghost"]);
    assert_eq!(source.hosts(), ["example.com"]);
    assert_eq!(source.inbox().err().as_deref(), why);
    assert_eq!(source.codes().err().as_deref(), why);
    assert_eq!(source.thread(0, None, "BUG-1").err().as_deref(), why);
    assert_eq!(
        source
            .comment(0, None, "BUG-1", "hi", false)
            .err()
            .as_deref(),
        why
    );
    assert_eq!(
        source
            .change(0, None, "BUG-1", &Change::default())
            .err()
            .as_deref(),
        why
    );
    assert_eq!(source.delete(0, None, "BUG-1").err().as_deref(), why);
    assert_eq!(source.labels(0).err().as_deref(), why);
    assert_eq!(source.shift(0, &Move::default()).err().as_deref(), why);
    assert_eq!(source.board(Some((0, 1))).err().as_deref(), why);
    assert_eq!(source.boards().err().as_deref(), why);
    assert_eq!(source.inbox().err().as_deref(), why);
    let (sender, _inbox) = channel();
    source.follow(&Waker::new(sender, 0));
    let Source::Live(live) = &source else {
        panic!("a live source");
    };
    assert!(live.listeners.lock().expect("whole").is_empty());
}

#[test]
fn a_live_source_with_no_accounts_reads_empty_and_has_no_board() {
    let source = ghost(&[]);
    assert!(source.hosts().is_empty());
    assert!(source.inbox().expect("nothing to read").is_empty());
    assert!(source.codes().expect("nothing to read").is_empty());
    assert!(source.boards().expect("nothing to read").is_empty());
    assert_eq!(source.board(None).err().as_deref(), Some(NONE));
    assert_eq!(
        source.client(0, None).err().as_deref(),
        Some("that account is gone")
    );
    assert_eq!(
        source.labels(0).err().as_deref(),
        Some("that account is gone")
    );
    let (sender, _inbox) = channel();
    source.follow(&Waker::new(sender.clone(), 0));
    source.follow(&Waker::new(sender, 1));
    let Source::Live(live) = &source else {
        panic!("a live source");
    };
    assert_eq!(live.listeners.lock().expect("whole").len(), 2);
}

#[test]
fn the_stream_relays_each_event_as_a_push_and_the_event_itself() {
    let (listeners, inbox) = listening();
    let label = r#"{"type":"label","key":"BUG-1","to":"Done"}"#;
    assert!(relay(&listeners, 0, Heard::Open { again: false }));
    assert!(heard(&inbox).is_empty());
    assert!(relay(&listeners, 1, Heard::Event(label)));
    assert_eq!(
        heard(&inbox),
        [
            "pushed 1 Some(\"BUG-1\")".to_owned(),
            format!("heard 1 {label}")
        ]
    );
}

#[test]
fn a_delete_is_relayed_as_the_event_alone_and_an_unreadable_one_as_a_bare_push() {
    let (listeners, inbox) = listening();
    let delete = r#"{"type":"delete","key":"BUG-1"}"#;
    assert!(relay(&listeners, 0, Heard::Event(delete)));
    assert_eq!(heard(&inbox), [format!("heard 0 {delete}")]);
    assert!(relay(&listeners, 0, Heard::Event("not json")));
    assert_eq!(
        heard(&inbox),
        ["pushed 0 None".to_owned(), "heard 0 not json".to_owned()]
    );
}

#[test]
fn a_reconnect_asks_for_one_full_reread_and_a_drop_waits_quietly() {
    let (listeners, inbox) = listening();
    assert!(relay(
        &listeners,
        0,
        Heard::Dropped("connection reset", Duration::from_secs(1))
    ));
    assert!(heard(&inbox).is_empty());
    assert!(relay(&listeners, 2, Heard::Open { again: true }));
    assert_eq!(heard(&inbox), ["pushed 2 None"]);
}

#[test]
fn a_fake_stream_with_drops_and_reconnects_reaches_the_inbox_in_order() {
    let (listeners, inbox) = listening();
    let comment = r#"{"type":"comment","key":"BUG-4"}"#;
    let script = [
        Heard::Open { again: false },
        Heard::Event(comment),
        Heard::Dropped("timed out", Duration::from_secs(1)),
        Heard::Dropped("refused", Duration::from_secs(2)),
        Heard::Open { again: true },
        Heard::Event(comment),
    ];
    assert!(script.into_iter().all(|step| relay(&listeners, 0, step)));
    assert_eq!(
        heard(&inbox),
        [
            "pushed 0 Some(\"BUG-4\")".to_owned(),
            format!("heard 0 {comment}"),
            "pushed 0 None".to_owned(),
            "pushed 0 Some(\"BUG-4\")".to_owned(),
            format!("heard 0 {comment}"),
        ]
    );
}

#[test]
fn the_stream_stops_once_nobody_listens_but_keeps_retrying_drops() {
    let (listeners, inbox) = listening();
    drop(inbox);
    assert!(!relay(&listeners, 0, Heard::Event(r#"{"key":"BUG-1"}"#)));
    assert!(!relay(&listeners, 0, Heard::Open { again: true }));
    assert!(relay(&listeners, 0, Heard::Open { again: false }));
    assert!(relay(&listeners, 0, Heard::Dropped("gone", Duration::ZERO)));
    let nobody = Mutex::new(Vec::new());
    assert!(!relay(&nobody, 0, Heard::Event("{}")));
}

#[test]
fn one_listener_left_is_enough_to_keep_the_stream() {
    let (dead, gone) = channel();
    drop(gone);
    let (live, inbox) = channel();
    let listeners = Mutex::new(vec![Waker::new(dead, 0), Waker::new(live, 4)]);
    assert!(relay(&listeners, 0, Heard::Open { again: true }));
    assert_eq!(heard(&inbox), ["pushed 0 None"]);
}

#[test]
fn a_poisoned_listener_list_stops_the_stream() {
    let (listeners, _inbox) = listening();
    let listeners = Arc::new(listeners);
    let held = Arc::clone(&listeners);
    let _ = std::thread::spawn(move || {
        let _guard = held.lock();
        panic!("poison the listeners");
    })
    .join();
    assert!(!relay(&listeners, 0, Heard::Open { again: true }));
}

use std::sync::mpsc::{Receiver, channel};

use pito_tui::Wake;

use crate::config::Host;
use crate::wire::{Change, PageRef, Person};

use super::super::deck::Move;
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
        holder: None,
        agent: None,
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
            via: None,
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
fn a_person_is_their_name_or_else_their_email_and_an_agent_gets_a_robot() {
    assert_eq!(
        person("Ada Lovelace", "ada@example.com", false),
        "Ada Lovelace"
    );
    assert_eq!(person("", "ada@example.com", false), "ada@example.com");
    assert_eq!(
        person("Ada Lovelace", "ada@example.com", true),
        "Ada Lovelace 🤖"
    );
    assert_eq!(person("", "", true), "🤖");
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
fn the_sample_offers_a_card_and_a_plain_item_the_same_seven_lanes() {
    let source = Source::demo(Duration::ZERO);
    let lanes = [
        "New",
        "Planned",
        "In progress",
        "Needs you",
        "Stuck",
        "Landed",
        "Done",
    ];
    assert_eq!(source.labels(0).expect("the sample has lanes"), lanes);
    assert_eq!(source.labels(0).expect("the sample has lanes"), lanes);
    let board = source.board(&[]).expect("the sample has a board");
    assert_eq!(board.cards.len(), 28);
    let (count, cards) = source.waiting().expect("the sample has cards waiting");
    assert_eq!((count, cards.len()), (3, 3));
    assert!(cards.iter().all(|(account, _)| *account == 0));
}

#[test]
fn the_sample_inbox_comes_newest_first_and_codes_newest_first() {
    let source = Source::demo(Duration::ZERO);
    let entries = source.inbox().expect("the sample reads").entries;
    assert_eq!(entries.len(), 28);
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
    assert_eq!(source.board(&[]).err().as_deref(), why);
    assert_eq!(source.waiting().err().as_deref(), why);
    assert_eq!(source.projects().err().as_deref(), why);
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
    assert_eq!(source.board(&[]).err().as_deref(), why);
    assert_eq!(
        source.waiting().err().as_deref(),
        Some("ghost: no account is called ghost")
    );
    assert_eq!(
        source.projects().err().as_deref(),
        Some("ghost: no account is called ghost")
    );
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
    assert!(source.inbox().expect("nothing to read").entries.is_empty());
    assert!(source.codes().expect("nothing to read").is_empty());
    let board = source.board(&[]).expect("nothing to read");
    assert!(board.cards.is_empty() && board.missing.is_empty());
    assert_eq!(board.lanes.len(), 7);
    assert_eq!(source.waiting().expect("nothing to read"), (0, Vec::new()));
    assert!(source.projects().expect("nothing to read").is_empty());
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
fn a_fake_stream_with_drops_and_reconnects_reaches_the_listener_in_order() {
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

#[test]
fn the_inbox_follows_a_live_source_once_however_often_it_rereads() {
    let source = ghost(&[]);
    let mut app = super::super::tests::run(source.clone());
    app.press("r");
    app.press("r");
    let Source::Live(live) = &source else {
        panic!("a live source");
    };
    assert_eq!(live.listeners.lock().expect("whole").len(), 1);
}

#[test]
fn unseen_counts_what_the_worker_holds_beyond_the_loaded_items() {
    assert_eq!(unseen(Some(1050), 1000), 50);
    assert_eq!(unseen(Some(1000), 1000), 0);
    assert_eq!(unseen(Some(3), 5), 0);
    assert_eq!(unseen(None, 1000), 0);
    assert_eq!(unseen(Some(u64::MAX), 0), usize::MAX);
}

#[test]
fn counted_is_plain_when_everything_is_loaded() {
    assert_eq!(counted(3, 7, 7, 0, false), ["3 of 7 items"]);
    assert_eq!(counted(0, 0, 0, 0, true), ["0 of 0 items"]);
}

#[test]
fn counted_adds_the_unloaded_items_and_says_only_the_newest_are_loaded() {
    assert_eq!(
        counted(1000, 1000, 1000, 50, false),
        ["1000 of 1050 items", "only the newest 1000 are loaded"]
    );
}

#[test]
fn counted_on_one_host_never_claims_the_unloaded_items_are_its_own() {
    assert_eq!(
        counted(12, 40, 1000, 50, true),
        ["12 of 40+ items", "only the newest 1000 are loaded"]
    );
}

#[test]
fn a_board_over_several_unreadable_accounts_still_draws_with_one_line_each() {
    let source = ghost(&["ghost", "phantom"]);
    let board = source.board(&[]).expect("the board draws with its lines");
    assert_eq!(board.missing.len(), 2);
    assert!(
        board.missing[0].starts_with("ghost: "),
        "{:?}",
        board.missing
    );
    assert!(
        board.missing[1].starts_with("phantom: "),
        "{:?}",
        board.missing
    );
    assert!(board.cards.is_empty());
    assert_eq!(board.lanes.len(), 7);
    assert!(source.waiting().is_err());
}

type Answer = fn(&str) -> (u16, &'static str);

const ROUTELESS: (u16, &str) = (404, r#"{"message":"no such route"}"#);
const LANES_JSON: &str = r#"{"lanes":[
 {"word":"new","label":"New","closes":false},{"word":"planned","label":"Planned","closes":false},
 {"word":"in-progress","label":"In progress","closes":false},{"word":"needs-you","label":"Needs you","closes":false},
 {"word":"stuck","label":"Stuck","closes":false},{"word":"landed","label":"Landed","closes":false},
 {"word":"done","label":"Done","closes":true}]}"#;
const BOARD_CARD: &str = r#"{"key":"BUG-25","kind":"bug","project":"Storefront","status":"needs-you","label":"Needs you",
 "lane":4,"title":"Waveform drifts after a cut","host":"shop.example.com","assignee":null,"order":"a0",
 "changed_at":"2026-10-22T09:12:00.000Z","changed_by":null}"#;
const WAITING_CARD: &str = r#"{"key":"BUG-25","kind":"bug","project":"Storefront","status":"needs-you","label":"Needs you",
 "lane":4,"title":"Waveform drifts after a cut","host":"shop.example.com",
 "reporter":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
 "created_at":"2026-10-22T08:00:00.000Z","changed_at":"2026-10-22T09:12:00.000Z","changed_by":null,"comments":0}"#;

fn current(path: &str) -> (u16, &'static str) {
    static BOARD: OnceLock<String> = OnceLock::new();
    static WAITING: OnceLock<String> = OnceLock::new();
    if path.starts_with("/v1/board") {
        let board =
            BOARD.get_or_init(|| format!(r#"{{"board":{LANES_JSON},"cards":[{BOARD_CARD}]}}"#));
        return (200, board.as_str());
    }
    if path.starts_with("/v1/cards/waiting") {
        let waiting = WAITING.get_or_init(|| format!(r#"{{"count":2,"cards":[{WAITING_CARD}]}}"#));
        return (200, waiting.as_str());
    }
    if path.starts_with("/v1/projects") {
        return (
            200,
            r#"{"projects":[{"name":"Storefront","open":1,"done":0}]}"#,
        );
    }
    if path.starts_with("/v1/labels") {
        return (
            200,
            r#"{"labels":[{"id":1,"name":"New"},{"id":2,"name":"Needs you"},{"id":3,"name":"Done","closes":true}]}"#,
        );
    }
    (404, r#"{"message":"no such route"}"#)
}

fn current_too(path: &str) -> (u16, &'static str) {
    if path.starts_with("/v1/projects") {
        return (
            200,
            r#"{"projects":[{"name":"storefront","open":2,"done":0},{"name":"Mobile app","open":1,"done":1}]}"#,
        );
    }
    current(path)
}

fn behind_named(path: &str) -> (u16, &'static str) {
    if path.starts_with("/health") {
        return (200, r#"{"ok":true,"version":"1.9.2"}"#);
    }
    ROUTELESS
}

fn behind_nameless(path: &str) -> (u16, &'static str) {
    if path.starts_with("/health") {
        return (200, r#"{"ok":true}"#);
    }
    ROUTELESS
}

fn before_waiting(path: &str) -> (u16, &'static str) {
    if path.starts_with("/v1/cards/waiting") {
        return (404, r#"{"message":"no such card"}"#);
    }
    if path.starts_with("/health") {
        return (200, r#"{"ok":true,"version":"1.8.0"}"#);
    }
    current(path)
}

fn broken(_: &str) -> (u16, &'static str) {
    (500, r#"{"message":"the Worker broke"}"#)
}

fn not_owner(_: &str) -> (u16, &'static str) {
    (403, r#"{"message":"not an owner"}"#)
}

fn serve(answer: Answer) -> String {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a free port");
    let url = format!("http://{}/_p99", listener.local_addr().expect("an address"));
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let Ok(clone) = stream.try_clone() else {
                continue;
            };
            let mut reader = BufReader::new(clone);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let path = line
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_owned();
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).map_or(true, |n| n == 0)
                    || header.trim().is_empty()
                {
                    break;
                }
            }
            let path = path.strip_prefix("/_p99").unwrap_or(&path);
            let (status, reply) = answer(path);
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
        }
    });
    url
}

fn workers(accounts: &[(&str, Answer)]) -> Source {
    let mut toml = String::new();
    for (name, answer) in accounts {
        toml.push_str(&format!(
            "[accounts.{name}]\naccount_id = \"a\"\ntoken = \"t\"\nkey = \"k\"\nurl = \"{}\"\n",
            serve(*answer)
        ));
    }
    let config: Config = toml::from_str(&toml).expect("the config parses");
    Source::Live(Arc::new(Live {
        config,
        accounts: accounts
            .iter()
            .map(|(name, _)| (*name).to_owned())
            .collect(),
        holder: None,
        agent: None,
        clients: OnceLock::new(),
        listeners: Mutex::new(Vec::new()),
    }))
}

#[test]
fn a_board_over_one_answering_and_one_routeless_account_shows_the_cards_and_one_line() {
    let source = workers(&[("shop", current), ("old", behind_named)]);
    let view = source.board(&[]).expect("one account answered");
    let keys: Vec<(usize, &str)> = view
        .cards
        .iter()
        .map(|c| (c.account, c.key.as_str()))
        .collect();
    assert_eq!(keys, [(0, "BUG-25")]);
    assert_eq!(view.lanes.len(), 7);
    assert_eq!(
        view.missing,
        [
            "old: its Worker is P99 1.9.2, the board needs 1.10 or later; p99 deploy --account old upgrades it"
        ]
    );
}

#[test]
fn a_routeless_account_with_no_version_alone_gets_its_line_over_empty_lanes() {
    let source = workers(&[("old", behind_nameless)]);
    let view = source
        .board(&[])
        .expect("a routeless account is a line, not a failure");
    assert!(view.cards.is_empty());
    assert_eq!(view.lanes.len(), 7);
    assert_eq!(view.missing.len(), 1);
    assert!(
        view.missing[0].starts_with("old: its Worker is an older P99, the board needs 1.10"),
        "{:?}",
        view.missing
    );
}

#[test]
fn a_routeless_account_beside_a_failing_one_shows_both_lines() {
    let source = workers(&[("old", behind_named), ("down", broken)]);
    let view = source.board(&[]).expect("two lines, no lone failure");
    assert_eq!(view.missing.len(), 2);
    assert!(
        view.missing[0].starts_with("old: its Worker is P99 1.9.2"),
        "{:?}",
        view.missing
    );
    assert_eq!(view.missing[1], "down: the Worker broke (500)");
    assert_eq!(
        source.waiting().err().as_deref(),
        Some("down: the Worker broke (500)")
    );
    assert_eq!(
        source.projects().err().as_deref(),
        Some("down: the Worker broke (500)")
    );
}

#[test]
fn one_failing_account_alone_is_an_error_not_a_board() {
    let source = workers(&[("down", broken)]);
    assert_eq!(
        source.board(&[]).err().as_deref(),
        Some("the Worker broke (500)")
    );
    assert_eq!(
        source.waiting().err().as_deref(),
        Some("down: the Worker broke (500)")
    );
}

#[test]
fn the_count_comes_from_the_accounts_that_answer_and_skips_a_routeless_one() {
    let source = workers(&[("shop", current), ("old", behind_named)]);
    let (count, cards) = source.waiting().expect("one account answered");
    assert_eq!(count, 2);
    let keys: Vec<(usize, &str)> = cards.iter().map(|(a, c)| (*a, c.key.as_str())).collect();
    assert_eq!(keys, [(0, "BUG-25")]);
    let alone = workers(&[("old", behind_named)]);
    assert_eq!(
        alone.waiting().expect("nothing answered, nothing failed").0,
        0
    );
}

#[test]
fn a_worker_older_than_the_waiting_route_is_named_with_its_version() {
    let source = workers(&[("pre", before_waiting)]);
    assert_eq!(
        source.waiting().err().as_deref(),
        Some(
            "pre: its Worker is P99 1.8.0, the board needs 1.10 or later; p99 deploy --account pre upgrades it"
        )
    );
    let beside = workers(&[("shop", current), ("pre", before_waiting)]);
    assert_eq!(beside.waiting().expect("the newer account answered").0, 2);
}

#[test]
fn a_user_account_is_told_it_is_not_an_owner() {
    let source = workers(&[("mine", not_owner)]);
    assert_eq!(
        source.waiting().err().as_deref(),
        Some("mine: not an owner (403)")
    );
    assert_eq!(
        source.board(&[]).err().as_deref(),
        Some("not an owner (403)")
    );
}

#[test]
fn projects_merge_across_accounts_in_any_case_and_skip_a_routeless_one() {
    let source = workers(&[
        ("shop", current),
        ("blog", current_too),
        ("old", behind_named),
    ]);
    assert_eq!(
        source.projects().expect("two accounts answered"),
        ["Mobile app", "Storefront"]
    );
    let alone = workers(&[("old", behind_named)]);
    assert_eq!(
        alone.projects().expect("nothing failed"),
        Vec::<String>::new()
    );
}

#[test]
fn the_move_to_list_reads_the_lane_names_from_labels() {
    let source = workers(&[("shop", current)]);
    assert_eq!(
        source.labels(0).expect("the Worker lists its labels"),
        ["New", "Needs you", "Done"]
    );
}

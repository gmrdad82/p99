use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use pito_tui::dump;

use crate::config::{Account, Config};

use super::super::demo::tests::without_codes;
use super::super::tests::{CODES, HIGH, Run, WIDE, line, row, run, sample, spot, waiting};
use super::*;

fn codes(app: &Run) -> &Codes {
    app.tui.find::<Codes>().expect("the codes are a screen")
}

fn shown() -> Run {
    let mut app = run(sample());
    app.go(CODES);
    app
}

#[test]
fn the_codes_list_newest_first_with_who_where_and_whether_they_still_work() {
    let mut app = shown();
    let text = app.text();
    for fact in ["4 codes", "3 active"] {
        assert!(text.contains(fact), "{fact}:\n{text}");
    }
    let rows: Vec<usize> = ["…q81v", "…m9xa", "…3fpd", "…7k2q"]
        .iter()
        .map(|hint| row(&text, hint))
        .collect();
    assert!(
        rows.windows(2).all(|pair| pair[0] + 1 == pair[1]),
        "{rows:?}\n{text}"
    );
    let blog = line(&text, "…q81v");
    for cell in [
        "Grace Hopper",
        "grace@example.com",
        "example.com",
        "User",
        "never",
        "active",
    ] {
        assert!(blog.contains(cell), "{cell} in {blog}");
    }
    let ada = line(&text, "…7k2q");
    for cell in [
        "Ada Lovelace",
        "example.com, shop.example.com",
        "Owner",
        "12m",
        "active",
    ] {
        assert!(ada.contains(cell), "{cell} in {ada}");
    }
    let old = line(&text, "…3fpd");
    assert!(old.contains("revoked") && old.contains("22d"), "{old}");
    for header in [
        "Person",
        "E-mail",
        "Hosts",
        "Role",
        "Code",
        "Last used",
        "State",
    ] {
        assert!(text.contains(header), "{header}:\n{text}");
    }
}

#[test]
fn a_revoked_code_reads_bad_an_active_one_good_and_an_owner_in_the_accent() {
    let mut app = shown();
    let buffer = app.frame();
    let fg = |at: (u16, u16)| Some(buffer[at].fg);
    assert_eq!(fg(spot(&buffer, "…3fpd", "revoked")), app.palette.bad.fg);
    assert_eq!(fg(spot(&buffer, "…m9xa", "active")), app.palette.good.fg);
    assert_eq!(
        fg(spot(&buffer, "Ada Lovelace", "Owner")),
        app.palette.accent.fg
    );
    assert_eq!(
        fg(spot(&buffer, "3 active", "3 active")),
        app.palette.good.fg
    );
}

#[test]
fn a_filter_finds_codes_by_person_or_host_whatever_the_case_or_accents() {
    let mut app = shown();
    let ada = app.press("/ ada");
    assert!(ada.contains("…7k2q"), "{ada}");
    assert!(!ada.contains("…q81v"), "{ada}");
    assert!(codes(&app).typing());
    assert!(ada.contains("Filter"), "{ada}");
    app.press("esc");
    let shop = app.press("/ SHOP enter");
    for hint in ["…7k2q", "…3fpd", "…m9xa"] {
        assert!(shop.contains(hint), "{hint}:\n{shop}");
    }
    assert!(!shop.contains("…q81v"), "{shop}");
    assert!(shop.contains("esc clear filter"), "{shop}");
    assert!(!codes(&app).typing());
    let cleared = app.press("esc");
    assert!(cleared.contains("…q81v"), "{cleared}");
    let accented = app.press("/ Gráce");
    assert!(
        accented.contains("…m9xa") && !accented.contains("…7k2q"),
        "{accented}"
    );
}

#[test]
fn a_paste_filters_only_while_typing() {
    let mut app = shown();
    let ignored = app.paste("ada");
    assert!(ignored.contains("…q81v"), "{ignored}");
    app.press("/");
    let pasted = app.paste("ada");
    assert!(!pasted.contains("…q81v"), "{pasted}");
    assert!(pasted.contains("…7k2q"), "{pasted}");
}

#[test]
fn arrows_move_the_selection_and_it_stays_inside_the_list() {
    let mut app = shown();
    assert_eq!(codes(&app).selected(), 0);
    app.press("down down");
    assert_eq!(codes(&app).selected(), 2);
    app.press("down down down");
    assert_eq!(codes(&app).selected(), 3);
    app.press("up up up up up");
    assert_eq!(codes(&app).selected(), 0);
}

#[test]
fn r_reads_the_codes_again() {
    let mut app = shown();
    tap(&mut app, "r");
    app.tui.settle();
    let text = app.text();
    assert!(text.contains("4 codes"), "{text}");
    assert!(text.contains("r read again"), "{text}");
}

#[test]
fn no_codes_yet_says_how_to_make_one() {
    let mut app = run(without_codes());
    let text = app.go(CODES);
    assert!(
        text.contains("No codes yet. p99 invite makes one."),
        "{text}"
    );
    assert!(text.contains("0 codes"), "{text}");
    assert!(text.contains("0 active"), "{text}");
}

#[test]
fn codes_that_cannot_be_read_say_why_and_r_reads_them_again() {
    let mut app = run(Source::Broken("no account yet; p99 setup makes one".into()));
    let text = app.go(CODES);
    for said in [
        "Couldn't read the codes.",
        "no account yet; p99 setup makes one",
        "r reads them again.",
        "r read again",
    ] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
    let again = app.press("/ a r");
    assert!(again.contains("Couldn't read the codes."), "{again}");
    assert!(!codes(&app).typing());
}

#[test]
fn esc_while_the_codes_load_stops_waiting_and_r_reads_them() {
    let mut app = waiting(sample());
    app.tui.go(CODES);
    assert_eq!(
        codes(&app).phase(),
        Phase::Loading("Reading the codes…".into())
    );
    tap(&mut app, "esc");
    let stopped = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(
        stopped.contains("Stopped waiting for the codes."),
        "{stopped}"
    );
    let read = app.press("r");
    assert!(read.contains("4 codes"), "{read}");
}

#[test]
fn a_code_never_used_or_with_a_broken_stamp_says_never() {
    let mut app = shown();
    let text = app.text();
    assert!(line(&text, "…q81v").contains("never"), "{text}");
    let screen = app.tui.find_mut::<Codes>().expect("the codes are a screen");
    if let Some(list) = &mut screen.codes {
        list[0].0.last_used_at = Some("last week".into());
    }
    screen.sift();
    let text = app.text();
    assert!(line(&text, "…q81v").contains("never"), "{text}");
}

fn tap(app: &mut Run, keys: &str) {
    for key in dump::keys(keys).expect("every key has a name") {
        app.tui.key(key);
    }
}

#[test]
fn every_role_reads_owner_or_user_and_never_an_old_word() {
    let mut app = shown();
    let text = app.text();
    for hint in ["…q81v", "…m9xa", "…3fpd"] {
        assert!(line(&text, hint).contains("User"), "{hint}:\n{text}");
    }
    assert!(line(&text, "…7k2q").contains("Owner"), "{text}");
    for old in ["manager", "person", "member", "reporter"] {
        assert!(!text.contains(old), "{old}:\n{text}");
    }
}

#[test]
fn d_on_a_revoked_code_asks_for_its_four_characters_and_deletes_it() {
    let mut app = shown();
    let hints = app.press("down down");
    assert!(hints.contains("d delete"), "{hints}");
    let asked = app.press("d");
    assert!(codes(&app).typing());
    assert!(asked.contains("Delete for good"), "{asked}");
    assert!(asked.contains("type 3fpd to delete code 2"), "{asked}");
    let done = app.press("3fpd enter");
    assert!(!codes(&app).typing());
    assert!(!done.contains("…3fpd"), "{done}");
    assert!(done.contains("Deleted code 2 of Grace Hopper"), "{done}");
    assert!(done.contains("3 codes"), "{done}");
    assert!(done.contains("3 active"), "{done}");
    for hint in ["…q81v", "…m9xa", "…7k2q"] {
        assert!(done.contains(hint), "{hint}:\n{done}");
    }
    let left: Vec<i64> = codes(&app)
        .codes
        .as_ref()
        .expect("the codes stay read")
        .iter()
        .map(|(c, _)| c.id)
        .collect();
    assert_eq!(left, [4, 3, 1]);
}

#[test]
fn the_four_characters_typed_back_ignore_case_and_spaces() {
    let mut app = shown();
    app.press("down down d");
    let done = app.press("3FPD enter");
    assert!(!done.contains("…3fpd"), "{done}");
}

#[test]
fn a_wrong_answer_keeps_the_code_and_says_so() {
    let mut app = shown();
    app.press("down down d");
    let kept = app.press("m9xa enter");
    assert!(!codes(&app).typing());
    assert!(kept.contains("…3fpd"), "{kept}");
    assert!(kept.contains("4 codes"), "{kept}");
    assert!(
        kept.contains("code 2 is kept: the four characters typed back didn't match"),
        "{kept}"
    );
}

#[test]
fn esc_or_an_empty_answer_closes_the_question_and_keeps_the_code() {
    let mut app = shown();
    app.press("down down d");
    let closed = app.press("3f esc");
    assert!(!codes(&app).typing());
    assert!(closed.contains("…3fpd") && !closed.contains("Delete for good"), "{closed}");
    app.press("d");
    let empty = app.press("enter");
    assert!(!codes(&app).typing());
    assert!(empty.contains("…3fpd") && !empty.contains("kept"), "{empty}");
}

#[test]
fn d_on_an_active_code_says_revoke_it_first_and_asks_nothing() {
    let mut app = shown();
    let hints = app.text();
    assert!(!hints.contains("d delete"), "{hints}");
    let refused = app.press("d");
    assert!(!codes(&app).typing());
    assert!(
        refused.contains("code 4 is active: revoke it first, p99 revoke 4"),
        "{refused}"
    );
    assert!(refused.contains("…q81v") && refused.contains("4 codes"), "{refused}");
    let typed = app.press("q81v enter");
    assert!(typed.contains("…q81v"), "{typed}");
}

#[test]
fn a_paste_while_asked_goes_into_the_answer() {
    let mut app = shown();
    app.press("down down d");
    app.paste("3fpd");
    let done = app.press("enter");
    assert!(!done.contains("…3fpd"), "{done}");
    let after = app.paste("ada");
    assert!(after.contains("…q81v"), "{after}");
}

#[test]
fn a_filter_then_d_deletes_the_code_on_the_selected_row() {
    let mut app = shown();
    app.press("/ shop enter");
    app.press("down d");
    let asked = app.text();
    assert!(asked.contains("type 3fpd to delete code 2"), "{asked}");
    let done = app.press("3fpd enter");
    assert!(!done.contains("…3fpd"), "{done}");
}

#[test]
fn a_delete_the_worker_refuses_keeps_the_row_and_says_why() {
    let mut app = shown();
    let said = app.event(
        CODES,
        Msg::CodeDeleted(Box::new(revoked(2, "grace@example.com", "3fpd")), Err("revoke it first (409)".into())),
    );
    assert!(said.contains("revoke it first (409)"), "{said}");
    assert!(said.contains("…3fpd") && said.contains("4 codes"), "{said}");
}

fn revoked(id: i64, email: &str, hint: &str) -> Code {
    Code {
        id,
        name: "Grace Hopper".into(),
        email: email.into(),
        hint: hint.into(),
        revoked_at: Some("2026-10-01T00:00:00Z".into()),
        ..Code::default()
    }
}

fn twin(app: &mut Run) -> Code {
    let other = Code {
        name: "Katherine Johnson".into(),
        hosts: vec!["other.example.com".into()],
        created_at: "2026-10-20T00:00:00Z".into(),
        ..revoked(2, "katherine@example.com", "zz99")
    };
    let screen = app.tui.find_mut::<Codes>().expect("the codes are a screen");
    if let Some(list) = &mut screen.codes {
        list.insert(0, (other.clone(), fold("katherine johnson")));
    }
    screen.sift();
    other
}

#[test]
fn a_delete_in_one_account_removes_only_its_own_row_when_another_account_shares_the_id() {
    let mut app = shown();
    let other = twin(&mut app);
    let before = app.text();
    assert!(before.contains("…zz99") && before.contains("…3fpd"), "{before}");
    let done = app.event(CODES, Msg::CodeDeleted(Box::new(other), Ok(())));
    assert!(!done.contains("…zz99"), "{done}");
    assert!(done.contains("…3fpd"), "{done}");
    assert!(done.contains("Deleted code 2 of Katherine Johnson"), "{done}");
    assert!(done.contains("4 codes"), "{done}");
    let kept = app.event(
        CODES,
        Msg::CodeDeleted(Box::new(revoked(2, "grace@example.com", "3fpd")), Ok(())),
    );
    assert!(!kept.contains("…3fpd"), "{kept}");
    assert!(kept.contains("Deleted code 2 of Grace Hopper"), "{kept}");
    assert!(kept.contains("3 codes"), "{kept}");
}

#[test]
fn deleting_the_twin_with_d_takes_the_selected_row_and_leaves_the_other_account_alone() {
    let mut app = shown();
    twin(&mut app);
    let selected = codes(&app).chosen().cloned().expect("a row is selected");
    assert_eq!(selected.hint, "zz99");
    let erased = erase(&app.source, &selected);
    assert_eq!(erased, Ok(()));
    app.event(CODES, Msg::CodeDeleted(Box::new(selected), erased));
    let left: Vec<(i64, String)> = codes(&app)
        .codes
        .as_ref()
        .expect("the codes stay read")
        .iter()
        .map(|(c, _)| (c.id, c.hint.clone()))
        .collect();
    assert!(left.contains(&(2, "3fpd".to_owned())), "{left:?}");
    assert!(!left.iter().any(|(_, hint)| hint == "zz99"), "{left:?}");
}

#[test]
fn a_demo_delete_sticks_when_the_codes_are_read_again() {
    let mut app = shown();
    app.press("down down d 3fpd enter");
    tap(&mut app, "r");
    app.tui.settle();
    let again = app.text();
    assert!(again.contains("3 codes"), "{again}");
    assert!(!again.contains("…3fpd"), "{again}");
    let left = app.source.codes().expect("the sample reads");
    assert!(left.iter().all(|c| c.hint != "3fpd"), "{left:?}");
}

#[test]
fn d_while_a_delete_is_on_its_way_says_so_and_asks_nothing() {
    let mut app = shown();
    app.press("down down");
    app.tui.find_mut::<Codes>().expect("the codes are a screen").sending = true;
    let said = app.press("d");
    assert!(!codes(&app).typing());
    assert!(said.contains("A delete is still on its way."), "{said}");
    assert!(said.contains("…3fpd") && said.contains("4 codes"), "{said}");
    let done = app.event(
        CODES,
        Msg::CodeDeleted(Box::new(revoked(9, "nobody@example.com", "none")), Err("no such code 9".into())),
    );
    assert!(done.contains("no such code 9"), "{done}");
    app.press("d");
    assert!(codes(&app).typing());
}

type Seen = Arc<Mutex<Vec<(String, String)>>>;

fn worker(answer: impl Fn(&str, &str) -> (u16, String) + Send + 'static) -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
    let base = format!("http://{}", listener.local_addr().expect("an address"));
    let seen: Seen = Arc::default();
    let log = seen.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Ok(clone) = stream.try_clone() else { continue };
            let mut reader = BufReader::new(clone);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or_default().to_owned();
            let path = parts.next().unwrap_or_default().to_owned();
            let mut length = 0;
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                    break;
                }
                let (k, v) = header.split_once(':').unwrap_or_default();
                if k.eq_ignore_ascii_case("content-length") {
                    length = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0; length];
            let _ = reader.read_exact(&mut body);
            let (status, reply) = answer(&method, &path);
            log.lock().expect("the log").push((method, path));
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
        }
    });
    (base, seen)
}

fn listing(codes: &[(i64, &str, &str)]) -> String {
    let codes: Vec<serde_json::Value> = codes
        .iter()
        .map(|(id, email, hint)| {
            serde_json::json!({
                "id": id,
                "name": "Grace Hopper",
                "email": email,
                "hint": hint,
                "revoked_at": "2026-10-01T00:00:00Z",
            })
        })
        .collect();
    serde_json::json!({ "codes": codes }).to_string()
}

fn account(codes: &'static [(i64, &'static str, &'static str)], delete: (u16, &'static str)) -> (String, Seen) {
    worker(move |method, path| match method {
        "GET" if path.starts_with("/_p99/v1/codes") => (200, listing(codes)),
        "DELETE" => (delete.0, delete.1.to_owned()),
        _ => (404, r#"{"message":"no such route"}"#.to_owned()),
    })
}

const GRACE_A: &[(i64, &str, &str)] = &[(2, "grace@example.com", "3fpd")];
const KATHERINE_B: &[(i64, &str, &str)] = &[(2, "katherine@example.com", "zz99")];
const DELETED: (u16, &str) = (200, r#"{"id":2,"deleted":true}"#);

fn live(a: (String, Seen), b: (String, Seen)) -> (Source, Seen, Seen) {
    let mut config = Config::default();
    for (name, base) in [("a", &a.0), ("b", &b.0)] {
        config.accounts.insert(
            name.into(),
            Account {
                url: Some(format!("{base}/_p99")),
                key: "a-test-key".into(),
                ..Account::default()
            },
        );
    }
    (Source::over(config), a.1, b.1)
}

fn calls(seen: &Seen) -> Vec<String> {
    seen.lock()
        .expect("the log")
        .iter()
        .map(|(method, path)| format!("{method} {}", path.split('?').next().unwrap_or_default()))
        .collect()
}

#[test]
fn a_live_delete_finds_the_code_in_the_second_account_and_deletes_it_there() {
    let (source, a, b) = live(account(GRACE_A, DELETED), account(KATHERINE_B, DELETED));
    let code = revoked(2, "katherine@example.com", "zz99");
    assert_eq!(erase(&source, &code), Ok(()));
    assert_eq!(calls(&a), ["GET /_p99/v1/codes"]);
    assert_eq!(calls(&b), ["GET /_p99/v1/codes", "DELETE /_p99/v1/codes/2"]);
}

#[test]
fn a_live_delete_of_a_code_no_account_holds_says_so_and_deletes_nothing() {
    let (source, a, b) = live(account(GRACE_A, DELETED), account(KATHERINE_B, DELETED));
    let code = revoked(9, "grace@example.com", "3fpd");
    assert_eq!(erase(&source, &code), Err("no such code 9".to_owned()));
    assert_eq!(calls(&a), ["GET /_p99/v1/codes"]);
    assert_eq!(calls(&b), ["GET /_p99/v1/codes"]);
}

#[test]
fn a_live_delete_whose_id_matches_but_hint_does_not_deletes_nothing() {
    let (source, a, b) = live(account(GRACE_A, DELETED), account(KATHERINE_B, DELETED));
    let code = revoked(2, "grace@example.com", "xxxx");
    assert_eq!(erase(&source, &code), Err("no such code 2".to_owned()));
    for seen in [&a, &b] {
        assert!(!calls(seen).iter().any(|call| call.starts_with("DELETE")), "{:?}", calls(seen));
    }
}

#[test]
fn a_live_delete_the_worker_refuses_with_409_or_404_says_why() {
    for (status, message) in [(409, "revoke it first"), (404, "no such code")] {
        let body: &'static str = Box::leak(format!(r#"{{"message":"{message}"}}"#).into_boxed_str());
        let (source, a, _) = live(account(GRACE_A, (status, body)), account(&[], DELETED));
        let code = revoked(2, "grace@example.com", "3fpd");
        assert_eq!(erase(&source, &code), Err(format!("{message} ({status})")));
        assert_eq!(calls(&a), ["GET /_p99/v1/codes", "DELETE /_p99/v1/codes/2"]);
    }
}

#[test]
fn a_live_account_that_cannot_list_its_codes_stops_the_delete_with_why() {
    let (source, _, b) = live(
        worker(|_, _| (500, r#"{"message":"database is down"}"#.to_owned())),
        account(KATHERINE_B, DELETED),
    );
    let code = revoked(2, "katherine@example.com", "zz99");
    assert_eq!(erase(&source, &code), Err("database is down (500)".to_owned()));
    assert!(calls(&b).is_empty(), "{:?}", calls(&b));
}

#[test]
fn a_broken_source_deletes_nothing_and_says_why() {
    let broken = Source::Broken("no account yet; p99 setup makes one".into());
    let code = Code {
        id: 2,
        hint: "3fpd".into(),
        revoked_at: Some("2026-10-01T00:00:00Z".into()),
        ..Code::default()
    };
    assert_eq!(
        erase(&broken, &code).unwrap_err(),
        "no account yet; p99 setup makes one"
    );
    assert_eq!(erase(&sample(), &code), Ok(()));
}

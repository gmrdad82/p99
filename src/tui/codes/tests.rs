use pito_tui::dump;

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
        Msg::CodeDeleted(2, Err("revoke it first (409)".into())),
    );
    assert!(said.contains("revoke it first (409)"), "{said}");
    assert!(said.contains("…3fpd") && said.contains("4 codes"), "{said}");
    let unknown = app.event(CODES, Msg::CodeDeleted(99, Ok(())));
    assert!(unknown.contains("Deleted code 99"), "{unknown}");
    assert!(unknown.contains("4 codes"), "{unknown}");
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

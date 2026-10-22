use pito_tui::dump;
use pito_tui::ratatui::style::Modifier;
use serde_json::json;

use crate::tui::source::Loaded;
use crate::wire::{GithubLink, Merged};

use super::super::demo::{Demo, NOW};
use super::super::tests::{
    HIGH, INBOX, Run, WIDE, ctrl, line, palette, row, run, sample, spot, waiting,
};
use super::*;

const OPEN: [&str; 16] = [
    "BUG-11 ", "TASK-6 ", "TASK-20 ", "TASK-16 ", "BUG-8 ", "Q-10 ", "BUG-15 ", "TASK-22 ",
    "FEAT-7 ", "IMP-17 ", "FEAT-13 ", "BUG-14 ", "IMP-5 ", "FEAT-9 ", "IMP-4 ", "FEAT-19 ",
];

const CLOSED: [&str; 6] = [
    "BUG-12 ", "TASK-21 ", "BUG-3 ", "TASK-18 ", "BUG-2 ", "BUG-1 ",
];

fn inbox(app: &Run) -> &Inbox {
    app.tui.find::<Inbox>().expect("the inbox is a screen")
}

fn tap(app: &mut Run, keys: &str) {
    for key in dump::keys(keys).expect("every key has a name") {
        app.tui.key(key);
    }
}

fn units() -> Units {
    Units::new("s", "m", "h", "d").year("y").now("now")
}

fn said(lines: &[Line<'_>]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.spans.iter().map(|s| s.content.as_ref()).collect())
        .collect()
}

fn thread(app: &Run, key: &str) -> Thread {
    app.demo(|demo| demo.thread(key).expect("the sample has the item"))
}

#[test]
fn the_inbox_lists_open_items_newest_first_and_counts_the_unread() {
    let mut app = run(sample());
    let text = app.text();
    assert!(text.contains("16 of 22 items"), "{text}");
    assert!(text.contains("3 unread"), "{text}");
    assert!(text.contains("sample data"), "{text}");
    let rows: Vec<usize> = OPEN.iter().map(|key| row(&text, key)).collect();
    assert!(
        rows.windows(2).all(|pair| pair[0] + 1 == pair[1]),
        "{rows:?}\n{text}"
    );
    for key in CLOSED {
        assert!(!text.contains(key), "{key} is closed:\n{text}");
    }
    let item = line(&text, "Q-10 ");
    for cell in [
        "Question",
        "Inbox",
        "Is the newsletter sent every week?",
        "example.com",
        "Grace Hopper",
        "3h",
    ] {
        assert!(item.contains(cell), "{cell} in {item}");
    }
    assert!(line(&text, "BUG-8 ").contains("Ada Lovelace*"), "{text}");
}

#[test]
fn the_list_colours_unread_marks_labels_and_hosts_by_what_they_mean() {
    let mut app = run(sample());
    let buffer = app.frame();
    let fg = |at: (u16, u16)| Some(buffer[at].fg);
    let (_, y) = spot(&buffer, "Q-10 ", "Q-10 ");
    let mark = (0..WIDE)
        .find(|&x| buffer[(x, y)].symbol() == "•")
        .expect("Q-10 is unread");
    assert_eq!(fg((mark, y)), app.palette.accent.fg);
    assert_eq!(fg(spot(&buffer, "Q-10 ", "Inbox")), app.palette.accent.fg);
    assert_eq!(
        fg(spot(&buffer, "Q-10 ", "example.com")),
        app.palette.accent.fg
    );
    assert_eq!(
        fg(spot(&buffer, "FEAT-9 ", "dev.example.com")),
        app.palette.warn.fg
    );
    let doing = spot(&buffer, "TASK-16 ", "Doing");
    assert!(buffer[doing].modifier.contains(Modifier::BOLD));
    assert_ne!(fg(doing), app.palette.accent.fg);
    let (_, y) = spot(&buffer, "TASK-16 ", "TASK-16 ");
    assert!((0..WIDE).all(|x| buffer[(x, y)].symbol() != "•"));
    let closed = app.press("s");
    let buffer = app.frame();
    assert_eq!(
        Some(buffer[spot(&buffer, "BUG-1 ", "Done")].fg),
        app.palette.good.fg,
        "{closed}"
    );
}

#[test]
fn s_cycles_open_closed_and_both() {
    let mut app = run(sample());
    let closed = app.press("s");
    assert!(closed.contains("6 of 22 items"), "{closed}");
    for key in CLOSED {
        assert!(closed.contains(key), "{key}:\n{closed}");
    }
    assert!(!closed.contains("BUG-11 "), "{closed}");
    let both = app.press("s");
    assert!(both.contains("22 of 22 items"), "{both}");
    assert!(both.contains("open or closed"), "{both}");
    let open = app.press("s");
    assert!(open.contains("16 of 22 items"), "{open}");
}

#[test]
fn a_filter_narrows_as_it_is_typed_keeps_on_enter_and_esc_clears_it() {
    let mut app = run(sample());
    let typing = app.press("/ cart");
    assert!(typing.contains("Filter"), "{typing}");
    assert!(typing.contains("1 of 22 items"), "{typing}");
    assert!(inbox(&app).typing());
    let kept = app.press("enter");
    assert!(!inbox(&app).typing());
    assert!(kept.contains("1 of 22 items"), "{kept}");
    assert!(kept.contains("BUG-11 "), "{kept}");
    assert!(kept.contains("esc clear filter"), "{kept}");
    assert!(app.press("s").contains("2 of 22 items"));
    assert!(app.press("s").contains("3 of 22 items"));
    app.press("s");
    let cleared = app.press("esc");
    assert!(cleared.contains("16 of 22 items"), "{cleared}");
    assert!(!cleared.contains("esc clear filter"), "{cleared}");
}

#[test]
fn a_filter_matches_people_and_ignores_case_and_accents() {
    let mut app = run(sample());
    let plain = app.press("/ hopper");
    assert!(plain.contains("9 of 22 items"), "{plain}");
    app.press("esc");
    let accented = app.press("/ Hóppér");
    assert!(accented.contains("9 of 22 items"), "{accented}");
    assert!(!accented.contains("TASK-6 "), "{accented}");
}

#[test]
fn a_paste_lands_in_the_filter_only_while_typing() {
    let mut app = run(sample());
    let ignored = app.paste("cart");
    assert!(ignored.contains("16 of 22 items"), "{ignored}");
    app.press("/");
    let pasted = app.paste("cart");
    assert!(pasted.contains("1 of 22 items"), "{pasted}");
}

#[test]
fn a_filter_with_no_match_says_how_to_clear_it() {
    let mut app = run(sample());
    let text = app.press("/ zzqx enter");
    assert!(text.contains("0 of 22 items"), "{text}");
    assert!(
        text.contains("Nothing matches the filter. esc clears it."),
        "{text}"
    );
}

#[test]
fn an_empty_inbox_says_where_reports_land() {
    let mut app = run(sample());
    let text = app.event(INBOX, Msg::Inbox(Ok(Loaded::default())));
    assert!(
        text.contains("No items yet. Reports from your sites land here."),
        "{text}"
    );
    assert!(text.contains("0 of 0 items"), "{text}");
    assert!(!text.contains("unread"), "{text}");
}

#[test]
fn h_picks_one_host_drops_the_host_column_and_picks_all_again() {
    let mut app = run(sample());
    let pick = app.press("h");
    for host in ["All hosts", "dev.example.com", "shop.example.com"] {
        assert!(pick.contains(host), "{host}:\n{pick}");
    }
    let one = app.press("down enter");
    assert!(one.contains("2 of 2 items"), "{one}");
    assert!(one.contains("1 unread"), "{one}");
    assert!(!one.contains("All hosts"), "{one}");
    assert!(!line(&one, "BUG-8 ").contains("dev.example.com"), "{one}");
    assert!(line(&one, "BUG-8 ").contains("Search box loses focus on mobile"));
    let none = app.press("s");
    assert!(
        none.contains("Nothing closed here. s shows open or closed · h picks another host."),
        "{none}"
    );
    app.press("s s h");
    let all = app.press("up enter");
    assert!(all.contains("16 of 22 items"), "{all}");
    assert!(all.contains("All hosts"), "{all}");
}

#[test]
fn a_cancelled_host_pick_keeps_every_host() {
    let mut app = run(sample());
    let text = app.press("h down esc");
    assert!(text.contains("16 of 22 items"), "{text}");
    assert!(text.contains("All hosts"), "{text}");
}

#[test]
fn nothing_open_here_points_to_the_closed_items() {
    let mut app = run(sample());
    let closed: Vec<Entry> = sample()
        .inbox()
        .expect("the sample reads")
        .entries
        .into_iter()
        .filter(|entry| entry.summary.resolution.is_some())
        .collect();
    let text = app.event(
        INBOX,
        Msg::Inbox(Ok(Loaded {
            entries: closed,
            unloaded: 0,
        })),
    );
    assert!(
        text.contains("Nothing open here. s shows closed."),
        "{text}"
    );
    assert!(!text.contains("h picks another host"), "{text}");
    assert!(text.contains("0 of 6 items"), "{text}");
    let shown = app.press("s");
    assert!(shown.contains("6 of 6 items"), "{shown}");
    assert!(!shown.contains("Nothing"), "{shown}");
}

#[test]
fn enter_opens_the_thread_with_its_facts_comments_and_events() {
    let mut app = run(sample());
    let text = app.press("enter");
    assert_eq!(inbox(&app).crumb().as_deref(), Some("BUG-11"));
    for said in [
        "BUG-11  The total does not update after removing a line",
        "Bug · Inbox · host shop.example.com · production",
        "/cart · unassigned",
        "Grace Hopper reported it 50m ago · updated 12m ago",
        "I removed the second lamp from my cart and the total still shows both.",
        "Landed  nowhere yet",
        "Merged here (1)",
        "BUG-12  Cart total stays the same after removing an item · Grace Hopper",
        "Comments (4)",
        "It happens with any item, not just the lamp.",
        "Ada Lovelace* · internal · 20m ago",
        "50m  created by Grace Hopper",
    ] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
    let buffer = app.frame();
    let fg = |at: (u16, u16)| Some(buffer[at].fg);
    assert_eq!(
        fg(spot(&buffer, "Ada Lovelace*", "internal")),
        app.palette.warn.fg
    );
    assert_eq!(
        fg(spot(&buffer, "Ada Lovelace*", "Ada")),
        app.palette.accent.fg
    );
    assert!(app.demo(|demo| {
        demo.list()
            .iter()
            .all(|e| e.summary.key != "BUG-11" || !e.summary.unread)
    }));
}

#[test]
fn opening_an_item_marks_it_read_in_the_list() {
    let mut app = run(sample());
    app.press("enter esc");
    let text = app.text();
    assert_eq!(inbox(&app).crumb(), None);
    assert!(text.contains("2 unread"), "{text}");
    let buffer = app.frame();
    let (_, y) = spot(&buffer, "BUG-11 ", "BUG-11 ");
    assert!((0..WIDE).all(|x| buffer[(x, y)].symbol() != "•"), "{text}");
}

#[test]
fn a_thread_longer_than_the_screen_scrolls_and_clamps_at_both_ends() {
    let mut app = run(sample());
    app.press("enter");
    let short = |app: &mut Run| dump::text(&app.tui.frame(WIDE, 16));
    let top = short(&mut app);
    assert!(top.contains("BUG-11  The total"), "{top}");
    assert!(top.contains('┃'), "{top}");
    tap(&mut app, "G");
    let bottom = short(&mut app);
    assert!(!bottom.contains("BUG-11  The total"), "{bottom}");
    assert!(bottom.contains("created by Grace Hopper"), "{bottom}");
    tap(&mut app, "j j j");
    assert_eq!(short(&mut app), bottom);
    tap(&mut app, "k");
    assert_ne!(short(&mut app), bottom);
    tap(&mut app, "g");
    assert_eq!(short(&mut app), top);
    tap(&mut app, "k up pgup");
    assert_eq!(short(&mut app), top);
    tap(&mut app, "space");
    assert_ne!(short(&mut app), top);
    tap(&mut app, "home");
    assert_eq!(short(&mut app), top);
    tap(&mut app, "pgdn end");
    assert_eq!(short(&mut app), bottom);
}

#[test]
fn r_sends_a_reply_that_lands_on_the_thread() {
    let mut app = run(sample());
    let typing = app.press("enter r");
    assert!(typing.contains("Reply"), "{typing}");
    assert!(typing.contains("enter sends · esc cancels"), "{typing}");
    assert!(inbox(&app).typing());
    let sent = app.press("Thanks enter");
    assert!(sent.contains("Replied on BUG-11"), "{sent}");
    assert!(sent.contains("Comments (5)"), "{sent}");
    let last = thread(&app, "BUG-11").comments.pop().expect("a comment");
    assert_eq!(last.body, "Thanks");
    assert!(!last.internal);
    assert_eq!(last.author.name, "Ada Lovelace");
}

#[test]
fn i_makes_the_next_reply_an_internal_note() {
    let mut app = run(sample());
    let on = app.press("enter i");
    assert!(on.contains("internal on"), "{on}");
    let typing = app.press("r");
    assert!(typing.contains("Internal note"), "{typing}");
    let sent = app.press("Mine enter");
    assert!(sent.contains("Internal note added on BUG-11"), "{sent}");
    let last = thread(&app, "BUG-11").comments.pop().expect("a comment");
    assert_eq!(last.body, "Mine");
    assert!(last.internal);
    let off = app.press("i");
    assert!(off.contains("internal off"), "{off}");
}

#[test]
fn an_empty_or_cancelled_reply_sends_nothing() {
    let mut app = run(sample());
    app.press("enter r enter");
    assert!(!inbox(&app).typing());
    let cancelled = app.press("r abc esc");
    assert!(!inbox(&app).typing());
    assert_eq!(inbox(&app).crumb().as_deref(), Some("BUG-11"));
    assert!(!cancelled.contains("Replied"), "{cancelled}");
    app.press("r");
    let pasted = app.paste("  ");
    assert!(pasted.contains("Reply"), "{pasted}");
    app.press("enter");
    assert_eq!(thread(&app, "BUG-11").comments.len(), 4);
}

#[test]
fn a_pasted_reply_is_sent_as_typed() {
    let mut app = run(sample());
    app.press("enter r");
    app.paste("Fixed on dev, have a look");
    let sent = app.press("enter");
    assert!(sent.contains("Replied on BUG-11"), "{sent}");
    let last = thread(&app, "BUG-11").comments.pop().expect("a comment");
    assert_eq!(last.body, "Fixed on dev, have a look");
}

#[test]
fn d_deletes_only_when_the_key_is_typed_back() {
    let mut app = run(sample());
    let asked = app.press("enter d");
    assert!(asked.contains("Delete for good"), "{asked}");
    assert!(asked.contains("type BUG-11 to delete it"), "{asked}");
    let kept = app.press("BUG-12 enter");
    assert!(
        kept.contains("BUG-11 is kept: the key typed back didn't match"),
        "{kept}"
    );
    assert!(app.demo(|demo| demo.thread("BUG-11").is_ok()));
    let gone = app.press("d bug-11 enter");
    assert!(
        gone.contains("Deleted BUG-11; BUG-12 back in the inbox"),
        "{gone}"
    );
    assert_eq!(inbox(&app).crumb(), None);
    assert!(app.demo(|demo| demo.thread("BUG-11").is_err()));
    assert!(gone.contains("16 of 21 items"), "{gone}");
    assert!(gone.contains("BUG-12 "), "{gone}");
    assert!(!gone.contains("BUG-11 "), "{gone}");
}

#[test]
fn a_deleted_item_with_files_says_how_many_went_with_it() {
    let mut app = run(sample());
    app.press("enter");
    let done = crate::wire::Deleted {
        key: "BUG-11".into(),
        comments: 4,
        files: 3,
        retrying: 0,
        unlinked: Vec::new(),
    };
    let text = app.event(INBOX, Msg::Deleted("BUG-11".into(), Ok(done)));
    assert!(text.contains("Deleted BUG-11 and its 3 files"), "{text}");
    assert!(text.contains("15 of 21 items"), "{text}");
}

#[test]
fn move_to_lists_the_labels_and_moves_the_item() {
    let mut app = run(sample());
    let pick = app.press("enter m");
    for label in [
        "Move to",
        "Inbox",
        "Doing",
        "QA ready",
        "Done",
        "Drop (close without fixing)",
        "Duplicate of…",
    ] {
        assert!(pick.contains(label), "{label}:\n{pick}");
    }
    assert!(!pick.contains("Testing"), "{pick}");
    let moved = app.press("down enter");
    assert!(moved.contains("BUG-11 moved to Doing"), "{moved}");
    assert!(moved.contains("Bug · Doing · host"), "{moved}");
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(issue.label.as_deref(), Some("Doing"));
    assert_eq!(issue.status, "doing");
    let list = app.press("esc");
    assert!(line(&list, "BUG-11 ").contains("Doing"), "{list}");
}

#[test]
fn move_to_drop_closes_the_item_without_fixing_it() {
    let mut app = run(sample());
    app.press("enter m");
    let dropped = app.press("down down down down enter");
    assert!(dropped.contains("BUG-11 is Done (dropped)"), "{dropped}");
    assert!(dropped.contains("Bug · Done (dropped)"), "{dropped}");
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(issue.status, "done");
    assert_eq!(issue.resolution.as_deref(), Some("abandoned"));
    let list = app.press("esc");
    assert!(list.contains("15 of 22 items"), "{list}");
}

#[test]
fn move_to_duplicate_asks_for_the_key_and_merges_into_it() {
    let mut app = run(sample());
    app.press("enter m");
    let asked = app.press("down down down down down enter");
    assert!(asked.contains("Duplicate of"), "{asked}");
    assert!(asked.contains("an item key, such as BUG-11"), "{asked}");
    let merged = app.press("bug-3 enter");
    assert!(merged.contains("BUG-11 is Done (duplicate)"), "{merged}");
    assert!(merged.contains(", merged into BUG-3"), "{merged}");
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(issue.duplicate_of.as_deref(), Some("BUG-3"));
    assert_eq!(issue.resolution.as_deref(), Some("duplicate"));
}

#[test]
fn an_empty_duplicate_key_changes_nothing() {
    let mut app = run(sample());
    app.press("enter m down down down down down enter enter");
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(issue.status, "inbox");
    assert_eq!(issue.duplicate_of, None);
}

#[test]
fn moving_to_the_label_it_has_or_dropping_a_closed_item_changes_nothing() {
    let mut app = run(sample());
    let events = thread(&app, "BUG-11").events.len();
    let same = app.press("enter m enter");
    assert!(!same.contains("moved to"), "{same}");
    assert_eq!(thread(&app, "BUG-11").events.len(), events);
    app.press("esc s enter");
    assert_eq!(inbox(&app).crumb().as_deref(), Some("BUG-12"));
    let closed = app.press("m down enter");
    assert!(!closed.contains("is Done"), "{closed}");
    assert_eq!(
        thread(&app, "BUG-12").issue.resolution.as_deref(),
        Some("duplicate")
    );
}

#[test]
fn move_to_says_so_when_no_board_has_a_label_or_the_labels_fail() {
    let mut app = run(sample());
    app.press("enter");
    let none = app.event(INBOX, Msg::Labels(Ok(Vec::new())));
    assert!(
        none.contains("No board of yours has a label yet."),
        "{none}"
    );
    let failed = app.event(INBOX, Msg::Labels(Err("the boards are down".into())));
    assert!(failed.contains("the boards are down"), "{failed}");
}

#[test]
fn a_assigns_someone_from_the_people_on_the_account() {
    let mut app = run(sample());
    let pick = app.press("enter a");
    for person in [
        "Assign to",
        "Nobody",
        "Me",
        "@ada.lovelace",
        "@grace.hopper",
    ] {
        assert!(pick.contains(person), "{person}:\n{pick}");
    }
    let assigned = app.press("down down down enter");
    assert!(assigned.contains("BUG-11 is Inbox"), "{assigned}");
    assert!(
        assigned.contains("/cart · assigned to @grace.hopper"),
        "{assigned}"
    );
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(
        issue.assignee.map(|a| a.username).as_deref(),
        Some("grace.hopper")
    );
}

#[test]
fn a_me_assigns_the_one_who_asks() {
    let mut app = run(sample());
    app.press("enter a down enter");
    let issue = thread(&app, "BUG-11").issue;
    assert_eq!(
        issue.assignee.map(|a| a.username).as_deref(),
        Some("ada.lovelace")
    );
}

#[test]
fn assigning_whoever_has_it_or_cancelling_changes_nothing() {
    let mut app = run(sample());
    let events = thread(&app, "BUG-11").events.len();
    let same = app.press("enter a enter");
    assert!(!same.contains("BUG-11 is"), "{same}");
    app.press("a down esc");
    assert_eq!(thread(&app, "BUG-11").events.len(), events);
    app.press("esc down enter");
    assert_eq!(inbox(&app).crumb().as_deref(), Some("TASK-6"));
    let events = thread(&app, "TASK-6").events.len();
    let pick = app.press("a");
    assert!(pick.contains("@ada.lovelace"), "{pick}");
    let same = app.press("enter");
    assert!(!same.contains("TASK-6 is"), "{same}");
    let task = thread(&app, "TASK-6");
    assert_eq!(task.events.len(), events);
    assert_eq!(
        task.issue.assignee.map(|a| a.username).as_deref(),
        Some("ada.lovelace")
    );
}

#[test]
fn a_failed_change_reply_or_delete_says_why_and_keeps_the_thread() {
    let mut app = run(sample());
    app.press("enter");
    for (msg, why) in [
        (
            Msg::Changed("BUG-11".into(), Err("the Worker said no (500)".into())),
            "the Worker said no (500)",
        ),
        (
            Msg::Commented("BUG-11".into(), Err("offline".into())),
            "offline",
        ),
        (
            Msg::Deleted("BUG-11".into(), Err("not yours (403)".into())),
            "not yours (403)",
        ),
    ] {
        let text = app.event(INBOX, msg);
        assert!(text.contains(why), "{why}:\n{text}");
        assert_eq!(inbox(&app).crumb().as_deref(), Some("BUG-11"));
    }
}

#[test]
fn a_thread_that_cannot_be_read_says_why_and_how_to_retry() {
    let mut app = run(sample());
    app.demo(|demo| demo.delete("BUG-11").expect("the sample has it"));
    let text = app.press("enter");
    assert!(text.contains("Couldn't read BUG-11."), "{text}");
    assert!(text.contains("no item is called BUG-11"), "{text}");
    assert!(
        text.contains("ctrl+r reads it again · esc goes back"),
        "{text}"
    );
    assert!(text.contains("ctrl+r read again"), "{text}");
    for key in ["r", "a", "m", "d"] {
        app.press(key);
        assert!(!inbox(&app).typing(), "{key}");
    }
    app.key(ctrl('r'));
    assert!(app.text().contains("Couldn't read BUG-11."));
    let back = app.press("esc");
    assert!(back.contains("16 of 22 items"), "{back}");
}

#[test]
fn a_stale_result_for_another_item_or_a_closed_thread_is_ignored() {
    let mut app = run(sample());
    let other = thread(&app, "TASK-6");
    app.press("enter");
    let text = app.event(INBOX, Msg::Thread("TASK-6".into(), Ok(other.clone())));
    assert!(text.contains("BUG-11  The total"), "{text}");
    assert!(!text.contains("Move product images"), "{text}");
    for msg in [
        Msg::Changed("TASK-6".into(), Ok(other.issue.clone())),
        Msg::Commented("TASK-6".into(), Ok(false)),
        Msg::Deleted("TASK-6".into(), Err("gone".into())),
    ] {
        let text = app.event(INBOX, msg);
        assert!(!text.contains("TASK-6 is"), "{text}");
        assert!(!text.contains("gone"), "{text}");
    }
    app.press("esc");
    let list = app.event(
        INBOX,
        Msg::Thread("BUG-11".into(), Ok(thread(&app, "BUG-11"))),
    );
    assert_eq!(inbox(&app).crumb(), None);
    assert!(list.contains("16 of 22 items"), "{list}");
}

#[test]
fn r_rereads_the_list_and_a_failed_reread_keeps_it_and_says_why() {
    let mut app = run(sample());
    app.demo(|demo| demo.delete("TASK-6").expect("the sample has it"));
    let reread = app.press("r");
    assert!(reread.contains("15 of 21 items"), "{reread}");
    assert!(!reread.contains("reading…"), "{reread}");
    tap(&mut app, "r");
    let reading = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(reading.contains("reading…"), "{reading}");
    app.tui.event(INBOX, Msg::Inbox(Err("offline".into())));
    let failed = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(failed.contains("offline"), "{failed}");
    assert!(failed.contains("15 of 21 items"), "{failed}");
    assert!(!failed.contains("reading…"), "{failed}");
}

#[test]
fn a_reread_asked_while_one_runs_runs_once_more_after_it() {
    let mut app = run(sample());
    tap(&mut app, "r r");
    app.demo(|demo| demo.delete("TASK-6").expect("the sample has it"));
    app.tui.event(INBOX, Msg::Inbox(Err("first read".into())));
    let again = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(again.contains("reading…"), "{again}");
    assert!(!again.contains("first read"), "{again}");
    app.tui.settle();
    let text = app.text();
    assert!(!text.contains("first read"), "{text}");
    assert!(!text.contains("reading…"), "{text}");
    assert!(text.contains("of 21 items"), "{text}");
    app.demo(|demo| demo.delete("FEAT-9").expect("the sample has it"));
    app.tui.settle();
    let after = app.text();
    assert!(after.contains("of 21 items"), "{after}");
}

#[test]
fn an_unasked_failed_read_keeps_the_list() {
    let mut app = run(sample());
    let text = app.event(INBOX, Msg::Inbox(Err("offline".into())));
    assert!(text.contains("16 of 22 items"), "{text}");
    assert!(!text.contains("offline"), "{text}");
}

#[test]
fn a_push_rereads_the_list_and_the_open_thread_only_when_it_is_that_item() {
    let mut app = run(sample());
    app.press("enter");
    app.demo(|demo| {
        demo.comment("BUG-11", "From the site", false)
            .expect("a comment")
    });
    let other = app.event(INBOX, Msg::Pushed(0, Some("TASK-6".into())));
    assert!(!other.contains("From the site"), "{other}");
    let elsewhere = app.event(INBOX, Msg::Pushed(1, Some("BUG-11".into())));
    assert!(!elsewhere.contains("From the site"), "{elsewhere}");
    let this = app.event(INBOX, Msg::Pushed(0, Some("BUG-11".into())));
    assert!(this.contains("From the site"), "{this}");
    assert!(this.contains("Comments (5)"), "{this}");
}

#[test]
fn a_push_while_the_list_has_not_loaded_reads_nothing() {
    let mut app = waiting(sample());
    app.event(INBOX, Msg::Pushed(0, None));
    assert!(inbox(&app).entries.is_none());
    assert!(!inbox(&app).refreshing);
}

#[test]
fn a_delete_heard_from_elsewhere_closes_the_thread_and_says_who() {
    let mut app = run(sample());
    app.press("enter");
    let heard =
        json!({"type": "delete", "key": "BUG-11", "by": {"name": "Grace Hopper", "agent": true}});
    let text = app.event(INBOX, Msg::Heard(0, heard.to_string()));
    assert_eq!(inbox(&app).crumb(), None);
    assert!(text.contains("Grace Hopper* deleted BUG-11"), "{text}");
    assert!(text.contains("15 of 21 items"), "{text}");
    let nameless = json!({"type": "delete", "key": "TASK-6"});
    app.press("enter");
    assert_eq!(inbox(&app).crumb().as_deref(), Some("TASK-6"));
    let text = app.event(INBOX, Msg::Heard(0, nameless.to_string()));
    assert!(text.contains("Someone deleted TASK-6"), "{text}");
}

#[test]
fn heard_events_that_are_not_a_delete_here_change_nothing() {
    let mut app = run(sample());
    app.press("enter");
    for (account, text) in [
        (0, "not json".to_owned()),
        (0, json!({"type": "comment", "key": "BUG-11"}).to_string()),
        (0, json!({"type": "delete"}).to_string()),
        (1, json!({"type": "delete", "key": "BUG-11"}).to_string()),
    ] {
        let shown = app.event(INBOX, Msg::Heard(account, text.clone()));
        assert_eq!(inbox(&app).crumb().as_deref(), Some("BUG-11"), "{text}");
        assert!(!shown.contains("deleted"), "{shown}");
    }
    let list = app.press("esc");
    assert!(list.contains("16 of 22 items"), "{list}");
}

#[test]
fn a_delete_heard_for_another_item_keeps_the_selection() {
    let mut app = run(sample());
    app.press("down down");
    let heard = json!({"type": "delete", "key": "BUG-11"});
    app.event(INBOX, Msg::Heard(0, heard.to_string()));
    let opened = app.press("enter");
    assert_eq!(inbox(&app).crumb().as_deref(), Some("TASK-20"), "{opened}");
}

#[test]
fn a_failed_inbox_load_says_why_and_r_tries_again() {
    let mut app = run(Source::Broken("no account yet; p99 setup makes one".into()));
    let text = app.text();
    for said in [
        "Couldn't read the inbox.",
        "no account yet; p99 setup makes one",
        "r reads it again · p99 tui --demo shows sample data",
    ] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
    assert!(text.contains("r read again"), "{text}");
    let again = app.press("r");
    assert!(again.contains("Couldn't read the inbox."), "{again}");
    let ignored = app.press("s h enter");
    assert!(ignored.contains("Couldn't read the inbox."), "{ignored}");
}

#[test]
fn esc_while_loading_stops_waiting_and_r_reads_again() {
    let mut app = waiting(sample());
    assert_eq!(
        inbox(&app).phase(),
        Phase::Loading("Reading the inbox…".into())
    );
    let stopped = app.press("esc");
    assert!(
        stopped.contains("Stopped waiting for the inbox."),
        "{stopped}"
    );
    let read = app.press("r");
    assert!(read.contains("16 of 22 items"), "{read}");
}

#[test]
fn the_hints_follow_what_the_inbox_can_do_now() {
    let mut app = run(sample());
    let list = app.text();
    for hint in [
        "enter open",
        "/ filter",
        "s status",
        "h host",
        "r read again",
    ] {
        assert!(list.contains(hint), "{hint}:\n{list}");
    }
    let thread = app.press("enter");
    for hint in [
        "r reply",
        "a assign",
        "m move to",
        "i internal off",
        "esc back",
    ] {
        assert!(thread.contains(hint), "{hint}:\n{thread}");
    }
    tap(&mut app, "r Hi enter");
    let saving = dump::text(&app.tui.frame(WIDE, HIGH));
    assert!(saving.contains("saving…"), "{saving}");
    app.tui.settle();
    assert!(!app.text().contains("saving…"));
}

fn opened(app: &mut Run, opener: fn(&str) -> Result<(), String>) -> String {
    app.tui
        .find_mut::<Inbox>()
        .expect("the inbox is a screen")
        .opener = opener;
    app.press("enter");
    let mut paged = thread(app, "BUG-11");
    paged.issue.page.url = "https://shop.example.com/cart".into();
    app.event(INBOX, Msg::Thread("BUG-11".into(), Ok(paged)));
    app.press("o")
}

#[test]
fn o_opens_the_item_page_and_says_so() {
    let mut app = run(sample());
    let text = opened(&mut app, |_| Ok(()));
    assert!(
        text.contains("Opened https://shop.example.com/cart"),
        "{text}"
    );
}

#[test]
fn o_says_why_the_page_did_not_open() {
    let mut app = run(sample());
    let text = opened(&mut app, |url| Err(format!("no opener for {url}")));
    assert!(
        text.contains("no opener for https://shop.example.com/cart"),
        "{text}"
    );
    assert!(!text.contains("Opened"), "{text}");
}

#[test]
fn o_on_an_item_without_a_web_page_says_so() {
    let mut app = run(sample());
    app.press("enter");
    let mut pageless = thread(&app, "BUG-11");
    pageless.issue.page.url = "file:///etc/hosts".into();
    app.event(INBOX, Msg::Thread("BUG-11".into(), Ok(pageless)));
    let text = app.press("o");
    assert!(text.contains("This item has no page to open."), "{text}");
}

#[test]
fn a_thread_shows_where_its_fix_landed_its_links_and_its_history() {
    let mut item = Demo::new().thread("BUG-2").expect("the sample has it");
    item.issue.github.push(GithubLink {
        kind: "pull".into(),
        rel: "fixes".into(),
        repo: "example/site".into(),
        number: 7,
        url: "https://github.com/example/site/pull/7".into(),
        at: String::new(),
    });
    let text = said(&lines(&item, 120, &palette(), NOW, &units()));
    let has = |want: &str| text.iter().any(|line| line.contains(want));
    for want in [
        "BUG-2  Broken link on the about page",
        "Bug · Done · host example.com · production",
        "/about · assigned to @ada.lovelace",
        "Ada Lovelace* reported it 12d ago · updated 6d ago",
        "Landed  dev 9d ago 3a9f2c1 · production 6d ago 1.4.0 3abc678",
        "GitHub  https://github.com/example/site/pull/7 fixes",
        "Comments (0)",
        "  none yet",
        "Events",
        "status Inbox → Doing by Ada Lovelace",
        "status Doing → Done by Ada Lovelace",
    ] {
        assert!(has(want), "{want}:\n{}", text.join("\n"));
    }
    assert!(!has("Merged here"));
}

#[test]
fn a_thread_names_a_branch_only_landing_and_a_drop() {
    let mut demo = Demo::new();
    let branch = said(&lines(
        &demo.thread("BUG-8").expect("the sample has it"),
        120,
        &palette(),
        NOW,
        &units(),
    ));
    assert!(
        branch.iter().any(|l| l == "Landed  on a branch only"),
        "{branch:?}"
    );
    let dropped = said(&lines(
        &demo.thread("BUG-1").expect("the sample has it"),
        120,
        &palette(),
        NOW,
        &units(),
    ));
    assert!(
        dropped
            .iter()
            .any(|l| l.starts_with("Bug · Done (dropped)")),
        "{dropped:?}"
    );
}

#[test]
fn a_narrow_thread_wraps_the_title_under_its_key_and_the_body_under_its_indent() {
    let item = Demo::new().thread("BUG-11").expect("the sample has it");
    let text = said(&lines(&item, 30, &palette(), NOW, &units()));
    assert_eq!(text[0], "BUG-11  The total does not");
    assert_eq!(text[1], "        update after removing");
    assert_eq!(text[2], "        a line");
    let body = text
        .iter()
        .position(|l| l.starts_with("  I removed"))
        .expect("the body is shown");
    assert!(text[body].chars().count() <= 30, "{text:?}");
    assert!(text[body + 1].starts_with("  "), "{text:?}");
}

#[test]
fn a_merged_title_wraps_under_its_key_with_the_reporter_on_the_first_line() {
    let mut item = Demo::new().thread("BUG-11").expect("the sample has it");
    item.issue.merged.push(Merged {
        key: "BUG-30".into(),
        title: "A very long merged title that cannot fit on one line here".into(),
        host: None,
        reporter: json!({"name": "", "email": "grace@example.com", "agent": false}),
    });
    let text = said(&lines(&item, 60, &palette(), NOW, &units()));
    assert!(text.iter().any(|l| l == "Merged here (2)"), "{text:?}");
    let merged = text
        .iter()
        .position(|l| l.starts_with("  BUG-30  "))
        .expect("the merged item is listed");
    assert_eq!(
        text[merged],
        "  BUG-30  A very long merged title that · grace@example.com"
    );
    assert_eq!(text[merged + 1], "          cannot fit on one line here");
}

#[test]
fn an_unparsed_stamp_is_shown_as_it_came() {
    let mut item = Demo::new().thread("BUG-11").expect("the sample has it");
    item.issue.created_at = "yesterday".into();
    item.events[0].at = "yesterday".into();
    let text = said(&lines(&item, 120, &palette(), NOW, &units()));
    assert!(
        text.iter().any(|l| l.contains("reported it yesterday")),
        "{text:?}"
    );
    assert!(
        text.iter().any(|l| l.contains("yesterday  created")),
        "{text:?}"
    );
}

#[test]
fn an_item_is_closed_by_a_resolution_or_a_closing_stage() {
    assert!(!closed(None, ""));
    assert!(!closed(None, "received"));
    assert!(!closed(None, "in_progress"));
    assert!(closed(Some("fixed"), ""));
    for stage in ["fixed", "dropped", "duplicate"] {
        assert!(closed(None, stage), "{stage}");
    }
}

#[test]
fn the_state_word_names_the_label_and_any_resolution_but_fixed() {
    let issue = |label: Option<&str>, stage: &str, resolution: Option<&str>| Issue {
        label: label.map(Into::into),
        stage: stage.into(),
        resolution: resolution.map(Into::into),
        ..Issue::default()
    };
    assert_eq!(state(&issue(Some("Done"), "", Some("fixed"))), "Done");
    assert_eq!(
        state(&issue(Some("Done"), "", Some("abandoned"))),
        "Done (dropped)"
    );
    assert_eq!(
        state(&issue(Some("Done"), "", Some("duplicate"))),
        "Done (duplicate)"
    );
    assert_eq!(state(&issue(None, "in_progress", None)), "In progress");
    assert_eq!(
        state(&issue(Some("QA ready"), "received", None)),
        "QA ready"
    );
}

#[test]
fn the_label_tone_is_good_when_closed_accent_when_new_and_strong_between() {
    let palette = palette();
    assert_eq!(tone(&palette, "Doing", true), palette.good);
    assert_eq!(tone(&palette, "Inbox", false), palette.accent);
    assert_eq!(tone(&palette, "Received", false), palette.accent);
    assert_eq!(tone(&palette, "Doing", false), palette.strong);
    let summary = Summary {
        stage: "in_progress".into(),
        ..Summary::default()
    };
    assert_eq!(label_text(&summary), "In progress");
    assert_eq!(label_style(&palette, &summary), palette.strong);
    assert!(production(""));
    assert!(production("production"));
    assert!(!production("development"));
}

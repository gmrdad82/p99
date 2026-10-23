use std::path::PathBuf;
use std::process::{Command, Output};

fn p99(args: &[&str]) -> Output {
    p99_with(args, &[])
}

fn p99_with(args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_p99"));
    command
        .args(args)
        .env_remove("P99_LICENSE_STATE")
        .env_remove("NO_COLOR")
        .env("P99_CONFIG", scratch("no-config").join("config.toml"));
    for (name, value) in env {
        command.env(name, value);
    }
    command.output().expect("p99 runs")
}

fn scratch(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("tui-{name}"))
}

fn fresh(name: &str) -> PathBuf {
    let dir = scratch(name);
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn out(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn err(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn a_dump_draws_the_sample_inbox_as_text_and_quits() {
    let run = p99(&["tui", "--demo", "--dump", "120x34"]);
    assert!(run.status.success(), "{}", err(&run));
    let text = out(&run);
    assert_eq!(text.lines().count(), 34, "{text}");
    for said in ["P99", "21 of 28 items", "BUG-11", "sample data", "Free"] {
        assert!(text.contains(said), "{said}:\n{text}");
    }
    assert!(!text.contains('\x1b'), "{text}");
}

#[test]
fn keys_drive_the_dump_to_the_board_and_into_a_thread() {
    let board = out(&p99(&[
        "tui", "--demo", "--dump", "120x34", "--keys", "tab",
    ]));
    assert!(
        board.contains("New 8") && board.contains("Needs you 1"),
        "{board}"
    );
    let thread = out(&p99(&[
        "tui", "--demo", "--dump", "120x34", "--keys", "enter",
    ]));
    assert!(
        thread.contains("BUG-11  The total does not update after removing a line"),
        "{thread}"
    );
    let replied = out(&p99(&[
        "tui",
        "--demo",
        "--dump",
        "120x34",
        "--keys",
        "enter r Thanks enter",
    ]));
    assert!(replied.contains("Replied on BUG-11"), "{replied}");
}

#[test]
fn a_dump_while_loading_shows_no_items_yet() {
    let run = p99(&["tui", "--demo", "--dump", "120x34", "--loading"]);
    assert!(run.status.success(), "{}", err(&run));
    let text = out(&run);
    assert!(!text.contains("21 of 28 items"), "{text}");
    assert!(!text.contains("BUG-11"), "{text}");
    assert!(text.contains("Reading the inbox…"), "{text}");
}

#[test]
fn an_ansi_dump_carries_colour_codes() {
    let text = out(&p99(&["tui", "--demo", "--dump", "120x34", "--ansi"]));
    assert!(text.contains("\x1b["), "{text}");
    assert!(text.contains("21 of 28 items"), "{text}");
}

#[test]
fn the_licence_still_follows_the_state_asked_for() {
    for (word, label) in [
        ("studio", "Studio"),
        ("agency", "Agency"),
        ("owner", "Owner"),
        ("ff", "F&F"),
    ] {
        let text = out(&p99_with(
            &["tui", "--demo", "--dump", "120x34"],
            &[("P99_LICENSE_STATE", word)],
        ));
        assert!(text.contains(label), "{word}:\n{text}");
    }
    let unknown = out(&p99_with(
        &["tui", "--demo", "--dump", "120x34"],
        &[("P99_LICENSE_STATE", "platinum")],
    ));
    assert!(unknown.contains("Free"), "{unknown}");
}

#[test]
fn a_size_or_key_that_does_not_parse_is_refused_like_clap() {
    let size = p99(&["tui", "--demo", "--dump", "wide"]);
    assert_eq!(size.status.code(), Some(2));
    assert!(
        err(&size).contains("a size is WxH, such as 120x34"),
        "{}",
        err(&size)
    );
    assert!(out(&size).is_empty());
    assert!(
        err(&size).starts_with("error: invalid value 'wide' for '--dump"),
        "{}",
        err(&size)
    );
    assert!(
        err(&size).ends_with("\n\nFor more information, try '--help'.\n"),
        "{}",
        err(&size)
    );
    let key = p99(&["tui", "--demo", "--dump", "80x24", "--keys", "ctrl+ab"]);
    assert_eq!(key.status.code(), Some(2));
    assert!(
        err(&key).contains("no key is called ctrl+ab"),
        "{}",
        err(&key)
    );
    assert!(
        err(&key).starts_with("error: invalid value 'ctrl+ab' for '--keys"),
        "{}",
        err(&key)
    );
    assert!(
        err(&key).ends_with("\n\nFor more information, try '--help'.\n"),
        "{}",
        err(&key)
    );
    assert!(out(&key).is_empty());
}

#[test]
fn without_an_account_the_inbox_says_how_to_make_one() {
    let run = p99(&["tui", "--dump", "120x34"]);
    assert!(run.status.success(), "{}", err(&run));
    let text = out(&run);
    assert!(text.contains("Couldn't read the inbox."), "{text}");
    assert!(
        text.contains("no account yet; p99 setup makes one"),
        "{text}"
    );
    let named = out(&p99(&["tui", "--account", "shop", "--dump", "120x34"]));
    assert!(named.contains("no account is called shop"), "{named}");
}

#[test]
fn a_bench_times_every_screen_the_thread_and_both_ways_of_carrying_a_card() {
    let run = p99(&["tui", "--demo", "--bench", "3", "--dump", "100x30"]);
    assert!(run.status.success(), "{}", err(&run));
    let text = out(&run);
    for screen in [
        "3 frames of the Inbox screen at 100x30",
        "3 frames of the Board screen at 100x30",
        "3 frames of the Codes screen at 100x30",
        "3 frames of the Thread screen at 100x30",
        "3 frames of the Board, carrying a card with the keys at 100x30",
        "3 frames of the Board, dragging a card with the mouse at 100x30",
    ] {
        assert!(text.contains(screen), "{screen}:\n{text}");
    }
    assert_eq!(
        text.lines()
            .filter(|l| l.starts_with("p99 --bench: "))
            .count(),
        6,
        "{text}"
    );
    assert_eq!(
        text.lines().filter(|l| l.contains(", p99 ")).count(),
        2,
        "{text}"
    );
}

#[test]
fn a_capture_compares_equal_to_itself_and_differs_from_an_empty_folder() {
    let saved = fresh("capture");
    let dir = saved.to_str().expect("a plain path");
    let captured = p99(&["tui", "--capture", dir]);
    assert!(captured.status.success(), "{}", err(&captured));
    assert!(
        out(&captured).contains("frames captured in"),
        "{}",
        out(&captured)
    );
    assert!(std::fs::read_dir(&saved).expect("frames saved").count() > 0);
    let same = p99(&["tui", "--compare", dir]);
    assert!(same.status.success(), "{}{}", out(&same), err(&same));
    assert!(out(&same).contains("every frame matches"), "{}", out(&same));
    let empty = fresh("empty");
    std::fs::create_dir_all(&empty).expect("an empty folder");
    let other = p99(&["tui", "--compare", empty.to_str().expect("a plain path")]);
    assert_eq!(other.status.code(), Some(1), "{}", out(&other));
    assert!(err(&other).starts_with("p99: "), "{}", err(&other));
}

fn dump(size: &str, keys: &str) -> String {
    let mut args = vec!["tui", "--demo", "--dump", size];
    if !keys.is_empty() {
        args.extend(["--keys", keys]);
    }
    let run = p99(&args);
    assert!(run.status.success(), "{}", err(&run));
    out(&run)
}

#[test]
fn the_board_tab_is_one_board_of_seven_lanes_at_80_and_120_columns() {
    for (size, rows) in [("120x34", 34), ("80x24", 24)] {
        let board = dump(size, "tab");
        assert_eq!(board.lines().count(), rows, "{size}:\n{board}");
        assert!(board.lines().all(|l| l.chars().count() <= 120), "{size}");
        for key in [
            "FEAT-9", "TASK-24", "IMP-5", "BUG-25", "BUG-26", "IMP-4", "BUG-1",
        ] {
            assert!(board.contains(key), "{size} {key}:\n{board}");
        }
        for gone in [
            "Shop", "QA ready", "b boards", "watching", "archived", "Archived",
        ] {
            assert!(!board.contains(gone), "{size} {gone}:\n{board}");
        }
    }
    let wide = dump("120x34", "tab");
    for head in [
        "New 8",
        "Planned 1",
        "In progress 6",
        "Needs you 1",
        "Stuck 1",
        "Landed 4",
        "Done 7",
    ] {
        assert!(wide.contains(head), "{head}:\n{wide}");
    }
    assert!(
        wide.contains("28 items") && wide.contains("7/28 done"),
        "{wide}"
    );
}

#[test]
fn the_waiting_badge_sits_in_the_header_at_80_and_120_columns() {
    for size in ["120x34", "80x24"] {
        for keys in ["", "tab"] {
            let text = dump(size, keys);
            let head: String = text.lines().take(3).collect::<Vec<_>>().join("\n");
            assert!(head.contains("3 waiting"), "{size} {keys:?}:\n{text}");
        }
    }
    let studio = out(&p99_with(
        &["tui", "--demo", "--dump", "120x34"],
        &[("P99_LICENSE_STATE", "studio")],
    ));
    let line = studio
        .lines()
        .find(|l| l.contains("3 waiting"))
        .expect("the count is shown");
    assert!(line.find("Studio") < line.find("3 waiting"), "{line}");
}

#[test]
fn w_opens_the_needs_you_list_and_enter_its_first_card() {
    for size in ["120x34", "80x24"] {
        let list = dump(size, "w");
        for said in ["Needs you · 3", "BUG-25", "BUG-26", "FEAT-27"] {
            assert!(list.contains(said), "{size} {said}:\n{list}");
        }
    }
    let thread = dump("120x34", "w enter");
    assert!(
        thread.contains("BUG-25  Waveform drifts after a cut"),
        "{thread}"
    );
    let board = dump("120x34", "tab w");
    assert!(board.contains("Needs you · 3"), "{board}");
}

#[test]
fn p_narrows_the_inbox_and_the_board_to_the_projects_chosen() {
    for size in ["120x34", "80x24"] {
        let pick = dump(size, "p");
        for said in ["Projects", "All projects", "Mobile app", "Storefront"] {
            assert!(pick.contains(said), "{size} {said}:\n{pick}");
        }
    }
    let one = dump("120x34", "p down enter");
    assert!(one.contains("2 of 28 items"), "{one}");
    assert!(one.contains("Mobile app"), "{one}");
    assert!(!one.contains("BUG-11"), "{one}");
    let several = dump("120x34", "p down enter p down down enter");
    assert!(several.contains("5 of 28 items"), "{several}");
    let board = dump("120x34", "p down enter tab");
    assert!(board.contains("2 items"), "{board}");
    assert!(
        board.contains("TASK-24") && board.contains("FEAT-27"),
        "{board}"
    );
    assert!(!board.contains("FEAT-9"), "{board}");
    let cleared = dump("120x34", "p down enter esc");
    assert!(cleared.contains("21 of 28 items"), "{cleared}");
}

#[test]
fn the_waiting_badge_counts_down_as_cards_move_out_and_hides_at_zero() {
    let needs = "tab l l l space l l l enter";
    let stuck = format!("{needs} h h space l l enter");
    let landed = format!("{stuck}{}", " h space l enter".repeat(4));
    for size in ["120x34", "80x24"] {
        for (keys, said) in [
            (needs, Some("2 waiting")),
            (stuck.as_str(), Some("1 waiting")),
            (landed.as_str(), None),
        ] {
            let text = dump(size, keys);
            let head: String = text.lines().take(3).collect::<Vec<_>>().join("\n");
            match said {
                Some(said) => assert!(head.contains(said), "{size} {keys:?}:\n{text}"),
                None => assert!(!head.contains("waiting"), "{size} {keys:?}:\n{text}"),
            }
        }
    }
}

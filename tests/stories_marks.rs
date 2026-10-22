use std::process::{Command, Output, Stdio};

const LANES: [&str; 6] = ["New", "Planned", "In progress", "Stuck", "Landed", "Done"];
const CARDS: [&str; 6] = [
    "FEAT-23", "TASK-24", "BUG-25", "BUG-26", "FEAT-27", "TASK-28",
];

fn home() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("p99-stories-marks-home")
}

fn p99(args: &[&str]) -> Output {
    let home = home();
    Command::new(env!("CARGO_BIN_EXE_p99"))
        .args(args)
        .env("HOME", &home)
        .env("XDG_CONFIG_HOME", home.join("config"))
        .env_remove("P99_AGENT")
        .env_remove("NO_COLOR")
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

fn text(args: &[&str]) -> String {
    let out = p99(args);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn dump(size: &str, keys: &str) -> String {
    let mut args = vec!["tui", "--demo", "--dump", size];
    if !keys.is_empty() {
        args.extend(["--keys", keys]);
    }
    text(&args)
}

fn head_row(screen: &str) -> &str {
    screen
        .lines()
        .find(|line| line.contains("New") && line.contains("Planned"))
        .unwrap_or_else(|| panic!("no lane heads in\n{screen}"))
}

#[test]
fn the_cards_board_draws_six_lanes_at_120_columns() {
    let screen = dump("120x34", "tab b down enter");
    let heads = head_row(&screen);
    let mut from = 0;
    for lane in LANES {
        let at = heads[from..]
            .find(lane)
            .unwrap_or_else(|| panic!("{lane} missing or out of order in {heads:?}"));
        from += at + lane.len();
    }
    for key in CARDS {
        assert!(
            screen.contains(key),
            "{key} not on the Cards board:\n{screen}"
        );
    }
}

#[test]
fn the_cards_board_fits_six_lanes_in_80_columns() {
    let screen = dump("80x24", "tab b down enter");
    let heads = head_row(&screen);
    for lane in ["New", "Planned", "In prog", "Stuck", "Landed", "Done"] {
        assert!(heads.contains(lane), "{lane} missing from {heads:?}");
    }
    assert!(screen.lines().all(|line| line.chars().count() <= 80));
    assert!(screen.contains("FEAT-23"));
    assert!(screen.contains("TASK-28"));
}

#[test]
fn the_shop_board_never_shows_a_card_and_the_cards_board_never_shows_an_item() {
    let shop = dump("120x34", "tab");
    for key in CARDS {
        assert!(
            !shop.contains(key),
            "{key} leaked onto the Shop board:\n{shop}"
        );
    }
    let cards = dump("120x34", "tab b down enter");
    assert!(
        !cards.contains("TASK-18"),
        "a plain item leaked onto the Cards board:\n{cards}"
    );
    assert!(
        !cards.contains("TASK-21"),
        "a plain item leaked onto the Cards board:\n{cards}"
    );
}

#[test]
fn the_inbox_marks_an_agent_with_a_robot_and_never_an_asterisk_after_a_name() {
    let screen = dump("120x34", "");
    assert!(screen.contains("Ada Lovelace 🤖"), "no robot in\n{screen}");
    assert!(!screen.contains("Lovelace*"));
    assert!(!screen.contains("Hopper*"));
}

#[test]
fn show_names_an_agent_reporter_with_the_robot_and_its_label() {
    let out = text(&["--demo", "show", "BUG-25"]);
    assert!(out.contains("reported by Ada Lovelace 🤖 (pci)"), "{out}");
    assert!(!out.contains('*'), "{out}");
}

#[test]
fn show_names_a_person_plainly_with_no_robot_and_no_label() {
    let out = text(&["--demo", "show", "FEAT-23"]);
    assert!(out.contains("reported by Ada Lovelace on"), "{out}");
    assert!(!out.contains("🤖"), "{out}");
    assert!(!out.contains("(pci)"), "{out}");
}

#[test]
fn show_json_carries_via_on_an_agent_and_null_on_a_person() {
    let agent: serde_json::Value =
        serde_json::from_str(&text(&["--demo", "--json", "show", "BUG-25"])).unwrap();
    assert_eq!(agent["issue"]["reporter"]["agent"], true);
    assert_eq!(agent["issue"]["reporter"]["via"], "pci");
    assert_eq!(agent["events"][0]["via"], "pci");
    let person: serde_json::Value =
        serde_json::from_str(&text(&["--demo", "--json", "show", "FEAT-23"])).unwrap();
    assert_eq!(person["issue"]["reporter"]["agent"], false);
    assert!(person["issue"]["reporter"]["via"].is_null());
    assert!(person["events"][0]["via"].is_null());
}

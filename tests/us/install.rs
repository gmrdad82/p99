use crate::fake;
use crate::home::Home;

fn nothing_set_up(name: &str) -> Home {
    let h = Home::new(name, fake::any);
    std::fs::remove_file(h.file()).unwrap();
    h
}

#[test]
fn us_install_001_the_demo_draws_the_sample_inbox_the_board_and_a_thread_with_nothing_set_up() {
    let h = nothing_set_up("us-install-demo");

    let inbox = h.p99(&["tui", "--demo", "--dump", "120x34"]);
    inbox.ok();
    assert_eq!(inbox.stdout.lines().count(), 34, "{}", inbox.stdout);
    for said in ["P99", "BUG-11", "sample data"] {
        assert!(inbox.stdout.contains(said), "{said}:\n{}", inbox.stdout);
    }
    assert!(!inbox.stdout.contains('\x1b'), "{}", inbox.stdout);

    let board = h.p99(&["tui", "--demo", "--dump", "120x34", "--keys", "tab"]);
    board.ok();
    assert!(
        board.stdout.contains("New 8") && board.stdout.contains("Needs you 1"),
        "{}",
        board.stdout
    );

    let thread = h.p99(&["tui", "--demo", "--dump", "120x34", "--keys", "enter"]);
    thread.ok();
    assert!(
        thread
            .stdout
            .contains("BUG-11  The total does not update after removing a line"),
        "{}",
        thread.stdout
    );

    assert!(!h.file().exists(), "the demo wrote a config");
    assert!(h.stub.seen().is_empty(), "the demo called out");
}

#[test]
fn us_install_001_without_a_space_the_inbox_says_how_to_make_one() {
    let h = nothing_set_up("us-install-no-space");

    let out = h.p99(&["tui", "--dump", "120x34"]);
    out.ok();
    assert!(
        out.stdout.contains("no space yet; p99 setup makes one"),
        "{}",
        out.stdout
    );

    let named = h.p99(&["tui", "--space", "shop", "--dump", "120x34"]);
    named.ok();
    assert!(
        named.stdout.contains("no space is called shop"),
        "{}",
        named.stdout
    );

    assert!(!h.file().exists(), "opening the inbox wrote a config");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn us_install_001_a_bare_p99_off_a_terminal_prints_usage_and_opens_no_tui() {
    let h = nothing_set_up("us-install-bare");
    let out = h.p99(&[]);
    out.clap("'p99' requires a subcommand but one was not provided");
    assert!(
        out.stderr.contains("Usage: p99 [OPTIONS] <COMMAND>"),
        "{}",
        out.stderr
    );
    assert!(!out.stderr.contains('\x1b'), "{}", out.stderr);
    assert!(h.stub.seen().is_empty());
}

#[cfg(unix)]
#[test]
fn us_install_001_the_readme_and_guides_say_card_never_item_or_report() {
    use std::path::PathBuf;
    use std::process::Command;

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let guard = root.join("bin/no-old-words");

    let docs = Command::new(&guard).output().unwrap();
    assert_eq!(
        docs.status.code(),
        Some(0),
        "{}{}",
        String::from_utf8_lossy(&docs.stdout),
        String::from_utf8_lossy(&docs.stderr)
    );
    assert!(docs.stdout.is_empty());

    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("us-install-old-words");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("guides")).unwrap();
    std::fs::write(
        dir.join("guides/work.md"),
        "---\ntitle: Work the Inbox\n---\n\nA card names its `reporter` and its `items`.\n\n```\n{\"type\":\"item\"}\nannounced 4f1c2a9e main v1.4.0 to production: 3 items (2 fixes)\n```\n\nSee [the guide](inbox.md) and ![a still](../images/inbox.gif).\n\nWho reported it shows on the card.\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("clean.md"),
        "<img src=\"lockup.svg\" alt=\"P99, issue and feedback reporter\">\n\nPlease report security issues privately.\n\nEach itemised reportage is fine, and so are reports_of and `inbox`.\n",
    )
    .unwrap();

    let out = Command::new(&guard).arg(&dir).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8(out.stdout).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert!(lines[0].ends_with("/guides/work.md:2:title: Work the Inbox"));
    assert!(lines[1].ends_with(
        "/guides/work.md:9:announced 4f1c2a9e main v1.4.0 to production: 3 items (2 fixes)"
    ));
    assert!(lines[2].ends_with("/guides/work.md:14:Who reported it shows on the card."));

    let missing = Command::new(&guard)
        .arg(dir.join("no-such-page.md"))
        .output()
        .unwrap();
    assert_eq!(missing.status.code(), Some(2));
}

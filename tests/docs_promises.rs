#![cfg(unix)]

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};

fn check(name: &str, pages: &[(&str, &str)]) -> Output {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("no-promises-{name}"));
    let _ = fs::remove_dir_all(&dir);
    for (page, text) in pages {
        let path = dir.join(page);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    Command::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/no-promises"))
        .arg(&dir)
        .output()
        .unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

#[test]
fn a_status_word_in_a_code_span_passes() {
    let out = check(
        "span",
        &[(
            "guides/cards.md",
            "# Cards\n\nA card moves to `planned`, then ``in `progress` or planned``.\n",
        )],
    );
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    assert_eq!(stdout(&out), "");
}

#[test]
fn a_word_in_a_fenced_block_passes() {
    let out = check(
        "fence",
        &[(
            "index.md",
            "Run it:\n\n```sh\np99 card status ABC-1 planned\n```\n\n~~~\nroadmap\n~~~\n",
        )],
    );
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
}

#[test]
fn a_promise_in_prose_fails_with_its_file_and_line() {
    let out = check(
        "prose",
        &[
            ("a.md", "# A\n\nWindows support is Planned.\n"),
            (
                "b/c.md",
                "Today.\n`planned` here, but more is coming soon.\n",
            ),
        ],
    );
    assert_eq!(out.status.code(), Some(0));
    let text = stdout(&out);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 2, "{text}");
    assert!(lines[0].ends_with("/a.md:3:Windows support is Planned."));
    assert!(lines[1].ends_with("/b/c.md:2:`planned` here, but more is coming soon."));
}

#[test]
fn every_promise_word_is_caught_and_only_whole_words() {
    for word in ["roadmap", "Upcoming", "the next release adds"] {
        let out = check("word", &[("p.md", &format!("{word}\n"))]);
        assert_eq!(out.status.code(), Some(0), "{word}");
    }
    let out = check(
        "whole",
        &[("p.md", "not_planned, unplanned and roadmaps stay.\n")],
    );
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
}

#[test]
fn a_fence_does_not_leak_into_the_next_page() {
    let out = check(
        "leak",
        &[("a.md", "```\nopen\n"), ("b.md", "This is planned.\n")],
    );
    assert_eq!(out.status.code(), Some(0));
    assert!(stdout(&out).contains("/b.md:1:"));
}

#[test]
fn a_missing_dir_is_a_usage_error() {
    let out = Command::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/no-promises"))
        .arg("tmp/no-such-dir")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
}

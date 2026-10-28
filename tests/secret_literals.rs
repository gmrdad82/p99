use std::fs;
use std::path::PathBuf;
use std::process::Command;

const ALLOWED: [&str; 4] = [
    "src/vault.rs",
    "docs/config.md",
    "tests/cli_vault.rs",
    "tests/stories_setup.rs",
];

fn scheme() -> String {
    ["op", ":", "//"].concat()
}

fn strays(files: &[(&str, &str)]) -> Vec<String> {
    let scheme = scheme();
    let mut found = Vec::new();
    for (path, text) in files {
        if ALLOWED.contains(path) {
            continue;
        }
        for (n, line) in text.lines().enumerate() {
            if line.contains(&scheme) {
                found.push(format!("{path}:{}", n + 1));
            }
        }
    }
    found
}

fn tracked() -> Vec<(String, String)> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let listed = Command::new("git")
        .args(["ls-files", "-z"])
        .current_dir(&root)
        .output()
        .expect("git runs");
    assert!(listed.status.success(), "git ls-files failed");
    String::from_utf8(listed.stdout)
        .unwrap()
        .split('\0')
        .filter(|path| !path.is_empty())
        .filter_map(|path| {
            let text = fs::read_to_string(root.join(path)).ok()?;
            Some((path.to_owned(), text))
        })
        .collect()
}

#[test]
fn no_tracked_file_outside_the_allow_list_names_a_password_manager_reference() {
    let files = tracked();
    assert!(files.iter().any(|(path, _)| path == "src/vault.rs"));
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    assert_eq!(strays(&borrowed), Vec::<String>::new());
}

#[test]
fn the_allow_list_names_only_files_that_still_need_the_scheme() {
    let files = tracked();
    let scheme = scheme();
    for allowed in ALLOWED {
        let (_, text) = files
            .iter()
            .find(|(path, _)| path == allowed)
            .unwrap_or_else(|| panic!("{allowed} is not tracked"));
        assert!(
            text.contains(&scheme),
            "{allowed} no longer needs its place in the allow-list"
        );
    }
}

#[test]
fn a_new_reference_is_named_with_its_file_and_line() {
    let reference = format!("{}vault/item/field", scheme());
    let found = strays(&[
        ("README.md", "nothing here\n"),
        ("docs/new.md", &format!("one\nkeep it at {reference}\n")),
        ("tests/new.rs", &format!("const A: &str = \"{reference}\";")),
        ("src/vault.rs", &reference),
        ("tests/cli_vault.rs", &reference),
    ]);
    assert_eq!(found, vec!["docs/new.md:2", "tests/new.rs:1"]);
}

#[test]
fn a_word_that_only_looks_like_the_scheme_is_no_reference() {
    let found = strays(&[(
        "docs/x.md",
        "https://example.com/op/ and op:/ and OP: and env:NAME",
    )]);
    assert_eq!(found, Vec::<String>::new());
}

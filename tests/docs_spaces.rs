use std::fs;
use std::path::{Path, PathBuf};

fn pages(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            pages(&path, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path);
        }
    }
}

fn every_page() -> Vec<(String, String)> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut found = vec![root.join("README.md")];
    pages(&root.join("docs"), &mut found);
    found.sort();
    found
        .into_iter()
        .map(|path| {
            let text = fs::read_to_string(&path).unwrap();
            let shown = path
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (shown, text)
        })
        .collect()
}

fn hosts_add_without_a_project(page: &str, text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let mut rest = line;
        while let Some(at) = rest.find("p99 hosts add ") {
            let after = &rest[at + "p99 hosts add ".len()..];
            let names_a_host = after
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '<');
            let upto = after.find('`').unwrap_or(after.len());
            if names_a_host && !after[..upto].contains("--project") {
                found.push(format!("{page}:{}", n + 1));
            }
            rest = after;
        }
    }
    found
}

#[test]
fn every_hosts_add_example_in_the_docs_names_its_project() {
    let stray: Vec<String> = every_page()
        .iter()
        .flat_map(|(page, text)| hosts_add_without_a_project(page, text))
        .collect();
    assert_eq!(stray, Vec::<String>::new());
}

#[test]
fn the_check_catches_a_host_without_a_project_and_passes_a_bare_mention() {
    let text = "Run `p99 hosts add example.com --env production`.\n\
                `p99 hosts add` makes the route.\n\
                Run `p99 hosts add <host> --project <name> --env <env>`.\n\
                ```sh\np99 hosts add shop.example.com --env dev\n```\n";
    assert_eq!(
        hosts_add_without_a_project("guide.md", text),
        ["guide.md:1", "guide.md:5"]
    );
}

#[test]
fn the_inbox_is_one_per_space_in_every_page() {
    for (page, text) in every_page() {
        for (n, line) in text.lines().enumerate() {
            assert!(
                !line.contains("inbox per Cloudflare account"),
                "{page}:{} says the inbox is per Cloudflare account; it is per space",
                n + 1
            );
        }
    }
}

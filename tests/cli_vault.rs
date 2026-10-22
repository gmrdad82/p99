#![cfg(unix)]

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::json;

use home::Home;
use stub::{KEY, Reply, Stub, summary};

const REF: &str = "op://Example/p99/key";

fn fake_op(dir: &Path, body: &str) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let file = bin.join("op");
    std::fs::write(
        &file,
        format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/asked\"\n{body}\n"),
    )
    .unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn vaulted(name: &str) -> Home {
    let stub = Stub::new(|req| {
        if req.is("GET", "/_p99/v1/issues") {
            Reply::ok(
                json!({"issues": [summary(1, "Checkout fails", "2026-10-01T09:30:00.000Z")], "next_cursor": null}),
            )
        } else {
            fake::any(req)
        }
    });
    let text =
        home::config(&stub.base).replace(&format!("key = \"{KEY}\""), &format!("key = \"{REF}\""));
    Home::with_config(name, stub, &text)
}

fn path_with(bin: &Path) -> String {
    format!("{}:/usr/bin:/bin", bin.display())
}

#[test]
fn a_key_kept_in_the_vault_is_read_with_op_and_signs_every_call() {
    let h = vaulted("vault-read");
    let bin = fake_op(
        &h.dir,
        &format!(
            "if [ \"$1\" = read ] && [ \"$3\" = \"{REF}\" ]; then printf '%s' '{KEY}'; else exit 9; fi"
        ),
    );
    let out = h.p99_env(&["list", "--json"], &[("PATH", &path_with(&bin))]);
    out.ok();
    assert_eq!(out.json()["issues"][0]["title"], "Checkout fails");
    let calls = h.stub.seen();
    assert!(!calls.is_empty());
    assert!(
        calls.iter().all(|c| c.signed),
        "every call signs with the key the vault tool gave"
    );
    let asked = std::fs::read_to_string(bin.join("asked")).unwrap();
    assert_eq!(asked, format!("read --no-newline {REF}\n"));
}

#[test]
fn a_vault_value_with_a_trailing_newline_does_not_sign() {
    let h = vaulted("vault-newline");
    let bin = fake_op(&h.dir, &format!("printf '%s\\n' '{KEY}'"));
    let out = h.p99_env(&["list", "--json"], &[("PATH", &path_with(&bin))]);
    assert!(!h.stub.seen().is_empty(), "{}", out.stderr);
    assert!(
        h.stub.seen().iter().all(|c| !c.signed),
        "a key with a newline is not the key: {}",
        out.stderr
    );
}

#[test]
fn op_refusing_names_the_reference_and_what_op_said() {
    let h = vaulted("vault-refused");
    let bin = fake_op(
        &h.dir,
        "echo '[ERROR] 2026/10/22 09:30:00 could not read secret' >&2\nexit 1",
    );
    h.p99_env(&["list"], &[("PATH", &path_with(&bin))])
        .refused(&format!(
            "{REF}: [ERROR] 2026/10/22 09:30:00 could not read secret"
        ));
    assert!(h.stub.seen().is_empty());
}

#[test]
fn op_answering_bytes_that_are_not_text_is_refused() {
    let h = vaulted("vault-bytes");
    let bin = fake_op(&h.dir, "printf '\\377\\376'");
    h.p99_env(&["list"], &[("PATH", &path_with(&bin))])
        .refused(&format!("{REF}: not UTF-8"));
    assert!(h.stub.seen().is_empty());
}

#[test]
fn without_op_installed_the_reference_says_to_install_it() {
    let h = vaulted("vault-missing");
    let empty = h.dir.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let out = h.p99_env(&["list"], &[("PATH", empty.to_str().unwrap())]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.starts_with(&format!("p99: {REF}: "))
            && out.stderr.ends_with("; is the 1Password CLI installed?\n"),
        "{}",
        out.stderr
    );
    assert!(out.stdout.is_empty());
    assert!(h.stub.seen().is_empty());
}

#[test]
fn watch_says_it_reads_the_key_from_the_vault_before_connecting() {
    let h = vaulted("vault-watch");
    let empty = h.dir.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let out = h.p99_env(&["watch"], &[("PATH", empty.to_str().unwrap())]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr
            .starts_with("p99: reading the account key from the 1Password CLI\n"),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.ends_with("; is the 1Password CLI installed?\n"),
        "{}",
        out.stderr
    );
}

#[test]
fn a_plain_key_never_runs_op() {
    let h = Home::new("vault-plain", |req| {
        if req.is("GET", "/_p99/v1/issues") {
            Reply::ok(json!({"issues": [], "next_cursor": null}))
        } else {
            fake::any(req)
        }
    });
    let bin = fake_op(&h.dir, "exit 9");
    let out = h.p99_env(&["list", "--json"], &[("PATH", &path_with(&bin))]);
    out.ok();
    assert!(!bin.join("asked").exists(), "op ran for a plain key");
    assert!(h.stub.seen().iter().all(|c| c.signed));
}

const GH_REF: &str = "op://Example/github/token";

fn github_set(h: &Home, bin: &Path) -> home::Out {
    h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            GH_REF,
        ],
        &[("PATH", &path_with(bin))],
    )
}

#[test]
fn a_github_token_kept_in_the_vault_is_read_with_op_and_trimmed() {
    let h = Home::new("vault-gh-read", fake::any);
    let bin = fake_op(
        &h.dir,
        &format!(
            "if [ \"$1\" = read ] && [ \"$3\" = \"{GH_REF}\" ]; then printf ' ghp_vaulted \\n'; else exit 9; fi"
        ),
    );
    github_set(&h, &bin).ok();
    let asked = std::fs::read_to_string(bin.join("asked")).unwrap();
    assert_eq!(asked, format!("read --no-newline {GH_REF}\n"));
    let repo = h.stub.call("GET", "/gh/repos/acme/shop");
    assert_eq!(repo.header("authorization"), Some("Bearer ghp_vaulted"));
    let stored = h
        .stub
        .calls("PUT", "/cf/accounts/acc1/workers/scripts/p99/secrets");
    assert_eq!(stored[0].json()["text"], "ghp_vaulted");
}

#[test]
fn a_github_token_the_vault_holds_empty_is_refused_before_github_is_asked() {
    let h = Home::new("vault-gh-empty", fake::any);
    let bin = fake_op(&h.dir, "printf ' \\n\\t'");
    github_set(&h, &bin).refused(&format!("{GH_REF} is empty"));
    assert!(h.stub.seen().is_empty());
}

#[test]
fn a_github_token_op_refuses_names_the_reference_and_what_op_said() {
    let h = Home::new("vault-gh-refused", fake::any);
    let bin = fake_op(
        &h.dir,
        "echo '[ERROR] \"github\" is not an item in the \"Example\" vault' >&2\nexit 1",
    );
    github_set(&h, &bin).refused(&format!(
        "{GH_REF}: [ERROR] \"github\" is not an item in the \"Example\" vault"
    ));
    assert!(h.stub.seen().is_empty());
}

#[test]
fn a_github_token_without_op_installed_says_to_install_it() {
    let h = Home::new("vault-gh-missing", fake::any);
    let empty = h.dir.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let out = h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            GH_REF,
        ],
        &[("PATH", empty.to_str().unwrap())],
    );
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.starts_with(&format!("p99: {GH_REF}: "))
            && out.stderr.ends_with("; is the 1Password CLI installed?\n"),
        "{}",
        out.stderr
    );
    assert!(h.stub.seen().is_empty());
}

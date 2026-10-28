#![cfg(unix)]

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use serde_json::json;

use home::Home;
use stub::{KEY, Reply, Stub, summary};

fn with_key(name: &str, key: &str) -> Home {
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
        home::config(&stub.base).replace(&format!("key = \"{KEY}\""), &format!("key = {key}"));
    Home::with_config(name, stub, &text)
}

fn kept(dir: &Path, name: &str, text: &str, mode: u32) -> String {
    let file = dir.join(name);
    std::fs::write(&file, text).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
    file.display().to_string()
}

fn signed_with_the_key(h: &Home) {
    let calls = h.stub.seen();
    assert!(!calls.is_empty());
    assert!(calls.iter().all(|c| c.signed), "a call was not signed");
}

#[test]
fn a_key_in_a_file_only_the_owner_reads_signs_every_call_and_the_file_is_not_the_config() {
    let h = with_key("secret-file", "\"placeholder\"");
    let path = kept(&h.dir, "key", &format!("{KEY}\n"), 0o600);
    h.write(&h.config().replace(
        "key = \"placeholder\"",
        &format!("key = {{ file = \"{path}\" }}"),
    ));
    let out = h.p99(&["list", "--json"]);
    out.ok();
    assert_eq!(out.json()["issues"][0]["title"], "Checkout fails");
    signed_with_the_key(&h);
    assert!(!h.config().contains(KEY));
}

#[test]
fn a_key_file_the_group_or_the_world_can_read_is_refused_before_any_request() {
    for (mode, name) in [
        (0o640, "secret-file-group"),
        (0o644, "secret-file-world"),
        (0o604, "secret-file-other"),
    ] {
        let h = with_key(name, "\"placeholder\"");
        let path = kept(&h.dir, "key", &format!("{KEY}\n"), mode);
        h.write(&h.config().replace(
            "key = \"placeholder\"",
            &format!("key = {{ file = \"{path}\" }}"),
        ));
        let out = h.p99(&["list"]);
        out.refused(&format!(
            "{path}: other users can read this file; make it yours alone (chmod 600)"
        ));
        assert!(h.stub.seen().is_empty());
        assert!(!out.stderr.contains(KEY));
    }
}

#[test]
fn a_missing_key_file_is_named() {
    let h = with_key("secret-file-missing", "{ file = \"/nonexistent/p99-key\" }");
    let out = h.p99(&["list"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.starts_with("p99: /nonexistent/p99-key: "),
        "{}",
        out.stderr
    );
    assert_eq!(out.stderr.lines().count(), 1);
    assert!(h.stub.seen().is_empty());
}

#[test]
fn a_key_in_an_environment_variable_signs_and_an_unset_one_is_named() {
    let h = with_key("secret-env", "{ env = \"P99_STORY_KEY\" }");
    h.p99_env(
        &["list", "--json"],
        &[("P99_STORY_KEY", &format!("  {KEY}\n"))],
    )
    .ok();
    signed_with_the_key(&h);
    let unset = with_key("secret-env-unset", "{ env = \"P99_STORY_KEY\" }");
    unset
        .p99(&["list"])
        .refused("P99_STORY_KEY: the variable is not set");
    assert!(unset.stub.seen().is_empty());
}

#[test]
fn a_key_a_command_prints_signs_every_call() {
    let h = with_key("secret-command", "\"placeholder\"");
    let script = kept(&h.dir, "print-key.sh", "printf '%s\\n' \"$1\"\n", 0o600);
    h.write(&h.config().replace(
        "key = \"placeholder\"",
        &format!("key = {{ command = [\"sh\", \"{script}\", \"{KEY}\"] }}"),
    ));
    h.p99(&["list", "--json"]).ok();
    signed_with_the_key(&h);
}

#[test]
fn a_command_that_fails_prints_nothing_or_is_missing_stops_with_one_line() {
    let cases: [(&str, &str, &str); 3] = [
        (
            "secret-command-fails",
            "echo 'the vault is locked' >&2; echo 'second line' >&2; exit 3",
            "sh: the vault is locked",
        ),
        ("secret-command-silent", "exit 0", "sh: printed nothing"),
        (
            "secret-command-status",
            "exit 4",
            "sh: exited with status 4",
        ),
    ];
    for (name, body, said) in cases {
        let h = with_key(name, "\"placeholder\"");
        let script = kept(&h.dir, "fail.sh", body, 0o600);
        h.write(&h.config().replace(
            "key = \"placeholder\"",
            &format!("key = {{ command = [\"sh\", \"{script}\"] }}"),
        ));
        h.p99(&["list"]).refused(said);
        assert!(h.stub.seen().is_empty());
    }
    let h = with_key(
        "secret-command-missing",
        "{ command = [\"p99-no-such-secret-tool\", \"x\"] }",
    );
    let out = h.p99(&["list"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.starts_with("p99: p99-no-such-secret-tool: "),
        "{}",
        out.stderr
    );
    assert_eq!(out.stderr.lines().count(), 1);
}

#[test]
fn a_command_runs_with_no_shell_so_metacharacters_stay_arguments() {
    let h = with_key("secret-command-no-shell", "\"placeholder\"");
    let script = kept(&h.dir, "echo-args.sh", "printf '%s' \"$1$2\"\n", 0o600);
    h.write(&h.config().replace(
        "key = \"placeholder\"",
        &format!("key = {{ command = [\"sh\", \"{script}\", \"{KEY}\", \"; touch pwned\"] }}"),
    ));
    let out = h.p99(&["list"]);
    assert!(!out.stderr.contains(KEY));
    assert!(!h.dir.join("pwned").exists());
    assert!(h.stub.seen().iter().all(|c| !c.signed));
}

#[test]
fn a_plain_string_key_still_signs_and_never_runs_anything() {
    let h = with_key("secret-plain", &format!("\"{KEY}\""));
    h.p99(&["list", "--json"]).ok();
    signed_with_the_key(&h);
}

#[test]
fn a_config_holding_only_sources_loads_while_others_can_read_it() {
    let h = with_key("secret-readable-config", "{ env = \"P99_STORY_KEY\" }");
    let text = h.config().replace(
        "token = \"cf-token\"",
        "token = { env = \"CF_STORY_TOKEN\" }",
    );
    h.write(&text);
    std::fs::set_permissions(h.file(), std::fs::Permissions::from_mode(0o644)).unwrap();
    h.p99_env(&["list", "--json"], &[("P99_STORY_KEY", KEY)])
        .ok();
    signed_with_the_key(&h);
}

#[test]
fn a_config_with_an_inline_secret_that_others_can_read_is_still_refused() {
    let h = with_key("secret-inline-readable", &format!("\"{KEY}\""));
    std::fs::set_permissions(h.file(), std::fs::Permissions::from_mode(0o644)).unwrap();
    let out = h.p99(&["list"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(out.stderr.contains("others can read it"), "{}", out.stderr);
    assert!(h.stub.seen().is_empty());
}

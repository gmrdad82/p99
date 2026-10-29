#![cfg(unix)]

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use home::{Home, Out};
use serde_json::{Value, json};
use stub::{KEY, Reply, Stub};

const REF: &str = "command:p99-fake-secret main";
const TOOL: &str = "p99-fake-secret";
const WRONG: &str = "p99-key-that-must-never-be-shown";
const EMPTY: &str = "P99_KEY is set but empty; unset it or give the key";

const CARD: &str = r#"{"key":"FEAT-41","kind":"feature","project":"Splicer","status":"in-progress","label":"In progress","lane":2,
 "title":"Export keeps every audio track","host":"shop.example.com",
 "reporter":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
 "created_at":"2026-10-22T08:00:00.000Z","changed_at":"2026-10-22T09:12:00.000Z",
 "changed_by":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
 "comments":1,"links":[]}"#;

const COMMENT: &str = r#"{"id":9,"author":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},"body":"Seen.","internal":false,"created_at":"2026-10-22T09:12:00.000Z"}"#;

fn answer(req: &stub::Req) -> Reply {
    let card: Value = serde_json::from_str(CARD).unwrap();
    let comment: Value = serde_json::from_str(COMMENT).unwrap();
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/_p99/v1/cards") => Reply::ok(json!({"cards": [card], "next_cursor": null})),
        ("GET", "/_p99/v1/cards/FEAT-41") => {
            let mut with_body = card.clone();
            with_body["body"] = json!("Every track, in sync.");
            Reply::ok(json!({"card": with_body, "comments": [comment], "events": []}))
        }
        ("POST", "/_p99/v1/cards/FEAT-41/comments") => {
            Reply::json(201, json!({"key": "FEAT-41", "comment": comment}))
        }
        ("POST", "/_p99/v1/cards/FEAT-41/status") => Reply::ok(json!({"card": card})),
        ("POST", "/_p99/v1/cards/FEAT-41/links") => Reply::json(
            201,
            json!({"key": "FEAT-41", "link": {"ref": "pci#2873", "note": null,
                "by": {"name": "Ada Lovelace", "username": "ada", "agent": false, "via": null},
                "at": "2026-10-22T09:30:00.000Z"}}),
        ),
        ("GET", "/_p99/v1/space") => Reply::ok(json!({
            "space": {"slug": "main", "name": "PITO MD"},
            "projects": [{"name": "Splicer", "hosts": ["shop.example.com"], "open": 1, "closed": 0}],
        })),
        _ => fake::any(req),
    }
}

fn guarded(req: &stub::Req) -> Reply {
    if req.path.starts_with("/_p99/") && !req.signed {
        Reply::problem(401, "bad signature")
    } else {
        answer(req)
    }
}

fn toml(value: &str) -> String {
    match value.strip_prefix("command:") {
        Some(words) => {
            let words: Vec<String> = words.split(' ').map(|w| format!("\"{w}\"")).collect();
            format!("{{ command = [{}] }}", words.join(", "))
        }
        None => format!("\"{value}\""),
    }
}

fn asked_of(reference: &str) -> String {
    reference.rsplit(' ').next().unwrap().to_owned()
}

fn home_with(name: &str, key: &str) -> Home {
    let stub = Stub::new(guarded);
    let text = home::config(&stub.base)
        .replace(&format!("key = \"{KEY}\""), &format!("key = {}", toml(key)));
    Home::with_config(name, stub, &text)
}

fn op_that_must_not_run(dir: &Path) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let file = bin.join(TOOL);
    std::fs::write(
        &file,
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/asked\"\necho 'the secret tool must not run' >&2\nexit 9\n",
    )
    .unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn op_giving_the_key(dir: &Path) -> PathBuf {
    op_giving(dir, REF, KEY)
}

fn op_giving(dir: &Path, reference: &str, value: &str) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let file = bin.join(TOOL);
    let argument = asked_of(reference);
    std::fs::write(
        &file,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/asked\"\nif [ \"$1\" = \"{argument}\" ]; then printf '%s' '{value}'; else exit 9; fi\n"
        ),
    )
    .unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn asked(bin: &Path) -> Vec<String> {
    std::fs::read_to_string(bin.join("asked"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn path_with(bin: &Path) -> String {
    format!("{}:/usr/bin:/bin", bin.display())
}

fn op_ran(bin: &Path) -> bool {
    bin.join("asked").exists()
}

fn never_shows(out: &Out, secret: &str) {
    assert!(
        !out.stdout.contains(secret) && !out.stderr.contains(secret),
        "the key leaked\nstdout: {}\nstderr: {}",
        out.stdout,
        out.stderr
    );
}

#[test]
fn p99_key_signs_every_call_over_a_reference_and_op_never_runs() {
    let h = home_with("key-over-ref", REF);
    let bin = op_that_must_not_run(&h.dir);
    let path = path_with(&bin);
    for args in [
        &["list", "--json"][..],
        &["show", "12", "--json"],
        &["card", "comment", "12", "Seen on Firefox too"],
        &["card", "status", "12", "doing"],
    ] {
        let out = h.p99_env(args, &[("PATH", &path), ("P99_KEY", KEY)]);
        out.ok();
        never_shows(&out, KEY);
    }
    let calls = h.stub.seen();
    assert!(calls.len() >= 4, "{} calls", calls.len());
    assert!(
        calls.iter().all(|c| c.signed),
        "every call signs with P99_KEY"
    );
    assert!(!op_ran(&bin), "op ran though P99_KEY was set");
}

#[test]
fn p99_key_comes_first_over_an_inline_key() {
    let h = home_with("key-over-inline", "not-the-worker-key");
    let out = h.p99_env(&["list", "--json"], &[("P99_KEY", KEY)]);
    out.ok();
    assert!(h.stub.seen().iter().all(|c| c.signed));
}

#[test]
fn p99_key_is_used_as_is_so_a_wrong_one_does_not_sign() {
    let h = home_with("key-wrong", KEY);
    let out = h.p99_env(&["list", "--json"], &[("P99_KEY", WRONG)]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(out.stderr.contains("bad signature"), "{}", out.stderr);
    assert!(!h.stub.seen().is_empty());
    assert!(h.stub.seen().iter().all(|c| !c.signed));
}

#[test]
fn without_p99_key_the_inline_key_signs_and_op_never_runs() {
    let h = home_with("key-unset-inline", KEY);
    let bin = op_that_must_not_run(&h.dir);
    let out = h.p99_env(&["list", "--json"], &[("PATH", &path_with(&bin))]);
    out.ok();
    assert!(!h.stub.seen().is_empty());
    assert!(h.stub.seen().iter().all(|c| c.signed));
    assert!(!op_ran(&bin));
}

#[test]
fn without_p99_key_the_reference_is_read_with_op_as_before() {
    let h = home_with("key-unset-ref", REF);
    let bin = op_giving_the_key(&h.dir);
    let out = h.p99_env(&["list", "--json"], &[("PATH", &path_with(&bin))]);
    out.ok();
    assert!(h.stub.seen().iter().all(|c| c.signed));
    assert_eq!(
        std::fs::read_to_string(bin.join("asked")).unwrap(),
        format!("{}\n", asked_of(REF))
    );
}

#[test]
fn an_empty_or_blank_p99_key_is_refused_before_any_request() {
    for (name, value) in [
        ("key-empty", ""),
        ("key-blank", "   "),
        ("key-tab", "\t \n"),
    ] {
        for config_key in [KEY, REF] {
            let h = home_with(name, config_key);
            let bin = op_that_must_not_run(&h.dir);
            let path = path_with(&bin);
            for args in [&["list"][..], &["list", "--json"], &["show", "12"]] {
                let out = h.p99_env(args, &[("PATH", &path), ("P99_KEY", value)]);
                out.refused(EMPTY);
                assert!(out.stdout.is_empty(), "{}", out.stdout);
                assert_eq!(out.stderr.lines().count(), 1, "{}", out.stderr);
                never_shows(&out, KEY);
            }
            assert!(h.stub.seen().is_empty(), "a request went out");
            assert!(!op_ran(&bin));
        }
    }
}

#[test]
fn watch_does_not_announce_the_vault_when_p99_key_is_set() {
    let h = home_with("key-watch", REF);
    let bin = op_that_must_not_run(&h.dir);
    let out = h.p99_env(&["watch"], &[("PATH", &path_with(&bin)), ("P99_KEY", "  ")]);
    out.refused(EMPTY);
    assert!(
        !out.stderr.contains("reading the space key"),
        "{}",
        out.stderr
    );
    assert!(!op_ran(&bin));
}

#[test]
fn the_key_never_shows_on_a_refused_request_or_a_401() {
    let h = Home::new("key-leak", |req| {
        if !req.path.starts_with("/_p99/") {
            fake::any(req)
        } else if !req.signed {
            Reply::problem(401, "bad signature")
        } else if req.method == "POST" {
            Reply::problem(400, "the text is too long")
        } else {
            fake::any(req)
        }
    });
    for (key, args) in [
        (WRONG, &["list"][..]),
        (WRONG, &["list", "--json"]),
        (WRONG, &["show", "12", "--json"]),
        (WRONG, &["card", "comment", "12", "hello"]),
        (KEY, &["card", "comment", "12", "hello"]),
        (KEY, &["card", "status", "12", "doing", "--json"]),
    ] {
        let out = h.p99_env(args, &[("P99_KEY", key)]);
        never_shows(&out, key);
        assert!(!out.stderr.contains("P99_KEY="), "{}", out.stderr);
    }
    let out = h.p99_env(&["card", "comment", "12", "hello"], &[("P99_KEY", KEY)]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains("the text is too long"),
        "{}",
        out.stderr
    );
}

const OTHER: &str = "other-account-key";
const OTHER_REF: &str = "command:p99-fake-secret other";

fn guarded_by(key: &'static str) -> impl Fn(&stub::Req) -> Reply + Send + Sync + 'static {
    move |req| {
        if req.path.starts_with("/_p99/") && !req.signed_by(key) {
            Reply::problem(401, "bad signature")
        } else {
            answer(req)
        }
    }
}

fn two_accounts(name: &str, default: Option<&str>, main: &str, other: &str) -> (Home, Stub) {
    let first = Stub::new(guarded);
    let second = Stub::new(guarded_by(OTHER));
    let (main, other) = (toml(main), toml(other));
    let default = default
        .map(|d| format!("default_space = \"{d}\"\n"))
        .unwrap_or_default();
    let text = format!(
        r#"{default}
[me]
name = "Ada Lovelace"
email = "ada@example.com"

[spaces.main]
account_id = "acc1"
token = "cf-token"
key = {main}
url = "{}/_p99"

[spaces.other]
account_id = "acc2"
token = "cf-token"
key = {other}
url = "{}/_p99"

[hosts."shop.example.com"]
space = "main"

[hosts."other.example.org"]
space = "other"
"#,
        first.base, second.base
    );
    (Home::with_config(name, first, &text), second)
}

fn worker_calls(stub: &Stub) -> Vec<stub::Req> {
    stub.seen()
        .into_iter()
        .filter(|c| c.path.starts_with("/_p99/"))
        .collect()
}

#[test]
fn p99_key_signs_the_default_account_and_the_others_keep_their_own_key() {
    for (name, bound) in [
        ("key-two-default", None),
        ("key-two-bound-main", Some("main")),
    ] {
        let (h, other) = two_accounts(name, Some("main"), REF, OTHER);
        let bin = op_that_must_not_run(&h.dir);
        let path = path_with(&bin);
        let mut envs = vec![("PATH", path.as_str()), ("P99_KEY", KEY)];
        envs.extend(bound.map(|b| ("P99_KEY_SPACE", b)));
        for args in [
            &["list", "--json"][..],
            &["list", "shop.example.com", "--json"],
            &["show", "12", "--json"],
            &["list", "--all", "--json"],
            &["hosts"],
            &["tui", "--dump", "120x30"],
        ] {
            let out = h.p99_env(args, &envs);
            out.ok();
            assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
            assert!(!out.stdout.contains("unreachable"), "{}", out.stdout);
            never_shows(&out, KEY);
            never_shows(&out, OTHER);
        }
        let mains = worker_calls(&h.stub);
        let others = worker_calls(&other);
        assert!(!mains.is_empty() && !others.is_empty());
        assert!(mains.iter().all(|c| c.signed), "main signs with P99_KEY");
        assert!(
            others.iter().all(|c| c.signed_by(OTHER) && !c.signed),
            "the other account signs with its own key, never P99_KEY"
        );
        assert!(!op_ran(&bin), "op ran though P99_KEY was set");
    }
}

const NAMED_OTHER: [&[&str]; 6] = [
    &["list", "other.example.org", "--json"],
    &["list", "--space", "other", "--json"],
    &["list", "--all", "--space", "other", "--json"],
    &["show", "12", "--space", "other", "--json"],
    &["hosts", "--space", "other"],
    &["tui", "--space", "other", "--dump", "120x30"],
];

#[test]
fn p99_key_never_signs_an_account_it_does_not_belong_to() {
    let (h, other) = two_accounts("key-two-named", Some("main"), REF, OTHER_REF);
    let bin = op_giving(&h.dir, OTHER_REF, OTHER);
    let path = path_with(&bin);
    for args in NAMED_OTHER {
        let out = h.p99_env(args, &[("PATH", &path), ("P99_KEY", KEY)]);
        out.ok();
        assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
        assert!(!out.stderr.contains("P99_KEY"), "{}", out.stderr);
        never_shows(&out, KEY);
        never_shows(&out, OTHER);
    }
    assert!(worker_calls(&h.stub).is_empty(), "main was asked");
    let others = worker_calls(&other);
    assert!(!others.is_empty());
    assert!(
        others.iter().all(|c| c.signed_by(OTHER) && !c.signed),
        "the other account received a request signed with P99_KEY"
    );
    let reads = asked(&bin);
    assert!(
        !reads.is_empty(),
        "the other account's reference was not read"
    );
    assert!(
        reads.iter().all(|r| r == &asked_of(OTHER_REF)),
        "op was asked for the bound account: {reads:?}"
    );
}

#[test]
fn p99_key_account_moves_p99_key_to_the_account_it_names() {
    let (h, other) = two_accounts("key-two-flipped", Some("main"), KEY, OTHER_REF);
    let bin = op_that_must_not_run(&h.dir);
    let path = path_with(&bin);
    let envs = [
        ("PATH", path.as_str()),
        ("P99_KEY", OTHER),
        ("P99_KEY_SPACE", "other"),
    ];
    for args in NAMED_OTHER {
        let out = h.p99_env(args, &envs);
        out.ok();
        assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
        never_shows(&out, OTHER);
    }
    assert!(worker_calls(&h.stub).is_empty(), "main was asked");
    assert!(worker_calls(&other).iter().all(|c| c.signed_by(OTHER)));
    for args in [
        &["list", "--json"][..],
        &["list", "--space", "main", "--json"],
        &["show", "12", "--json"],
        &["list", "--all", "--json"],
        &["hosts"],
        &["tui", "--dump", "120x30"],
    ] {
        let out = h.p99_env(args, &envs);
        out.ok();
        assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
        assert!(!out.stdout.contains("unreachable"), "{}", out.stdout);
        never_shows(&out, OTHER);
        never_shows(&out, KEY);
    }
    let mains = worker_calls(&h.stub);
    assert!(!mains.is_empty());
    assert!(
        mains.iter().all(|c| c.signed && !c.signed_by(OTHER)),
        "main received a request signed with P99_KEY"
    );
    assert!(worker_calls(&other).iter().all(|c| c.signed_by(OTHER)));
    assert!(!op_ran(&bin), "op ran for the account P99_KEY belongs to");
}

#[test]
fn an_empty_or_unknown_p99_key_account_never_uses_p99_key_and_says_nothing() {
    for (name, bound) in [
        ("key-bound-empty", ""),
        ("key-bound-gone", "gone"),
        ("key-bound-case", "Main"),
    ] {
        let (h, other) = two_accounts(name, Some("main"), KEY, OTHER);
        let bin = op_that_must_not_run(&h.dir);
        let path = path_with(&bin);
        for args in [
            &["list", "--json"][..],
            &["list", "--all", "--json"],
            &["list", "--space", "other", "--json"],
            &["hosts"],
            &["tui", "--dump", "120x30"],
        ] {
            let out = h.p99_env(
                args,
                &[
                    ("PATH", &path),
                    ("P99_KEY", WRONG),
                    ("P99_KEY_SPACE", bound),
                ],
            );
            out.ok();
            assert!(out.stderr.is_empty(), "{}", out.stderr);
            assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
            never_shows(&out, WRONG);
        }
        let mains = worker_calls(&h.stub);
        let others = worker_calls(&other);
        assert!(!mains.is_empty() && !others.is_empty());
        assert!(mains.iter().all(|c| c.signed && !c.signed_by(WRONG)));
        assert!(
            others
                .iter()
                .all(|c| c.signed_by(OTHER) && !c.signed_by(WRONG))
        );
        assert!(!op_ran(&bin));
    }
}

#[test]
fn p99_key_with_several_accounts_and_no_default_signs_only_the_named_one() {
    let (h, other) = two_accounts("key-two-none", None, KEY, OTHER);
    let bin = op_that_must_not_run(&h.dir);
    let path = path_with(&bin);
    for args in [
        &["list", "--all", "--json"][..],
        &["list", "--space", "main", "--json"],
        &["hosts"],
    ] {
        let out = h.p99_env(args, &[("PATH", &path), ("P99_KEY", WRONG)]);
        out.ok();
        assert!(out.stderr.is_empty(), "{}", out.stderr);
        never_shows(&out, WRONG);
    }
    assert!(worker_calls(&h.stub).iter().all(|c| c.signed));
    assert!(worker_calls(&other).iter().all(|c| c.signed_by(OTHER)));
    let (h, other) = two_accounts("key-two-none-bound", None, REF, OTHER);
    let out = h.p99_env(
        &["list", "--all", "--json"],
        &[
            ("PATH", &path_with(&op_that_must_not_run(&h.dir))),
            ("P99_KEY", KEY),
            ("P99_KEY_ACCOUNT", "main"),
        ],
    );
    out.ok();
    never_shows(&out, KEY);
    assert!(!worker_calls(&h.stub).is_empty());
    assert!(worker_calls(&h.stub).iter().all(|c| c.signed));
    assert!(
        worker_calls(&other)
            .iter()
            .all(|c| c.signed_by(OTHER) && !c.signed)
    );
    assert!(!op_ran(&h.dir.join("bin")));
}

#[test]
fn watch_announces_the_vault_only_for_an_account_p99_key_does_not_belong_to() {
    let h = home_with("key-watch-bound", REF);
    let bin = op_that_must_not_run(&h.dir);
    let path = path_with(&bin);
    let out = h.p99_env(
        &["watch"],
        &[
            ("PATH", &path),
            ("P99_KEY", WRONG),
            ("P99_KEY_ACCOUNT", "gone"),
        ],
    );
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains("reading the space key"),
        "{}",
        out.stderr
    );
    assert!(op_ran(&bin), "the account's own reference was not read");
    assert!(h.stub.seen().is_empty(), "a request went out");
    never_shows(&out, WRONG);
    let h = home_with("key-watch-default", REF);
    let bin = op_that_must_not_run(&h.dir);
    let out = h.p99_env(
        &["watch"],
        &[("PATH", &path_with(&bin)), ("P99_KEY", WRONG)],
    );
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        !out.stderr.contains("reading the space key"),
        "{}",
        out.stderr
    );
    assert!(!op_ran(&bin));
    assert!(!h.stub.seen().is_empty());
    assert!(h.stub.seen().iter().all(|c| !c.signed));
    never_shows(&out, WRONG);
}

const CARD_COMMANDS: [&[&str]; 6] = [
    &["cards", "--json"],
    &["card", "show", "FEAT-41", "--json"],
    &["card", "comment", "FEAT-41", "Seen.", "--json"],
    &["card", "status", "FEAT-41", "in-progress", "--json"],
    &["card", "link", "FEAT-41", "pci#2873", "--json"],
    &["projects", "--json"],
];

fn card_calls(stub: &Stub) -> Vec<stub::Req> {
    worker_calls(stub)
        .into_iter()
        .filter(|c| c.path.starts_with("/_p99/v1/cards") || c.path == "/_p99/v1/space")
        .collect()
}

fn with_account<'a>(args: &[&'a str], account: Option<&'a str>) -> Vec<&'a str> {
    let mut all = args.to_vec();
    if let Some(account) = account {
        all.extend(["--space", account]);
    }
    all
}

#[test]
fn the_card_commands_sign_each_account_with_its_own_key_and_p99_key_only_its_own() {
    for (name, bound) in [
        ("key-cards-default", None),
        ("key-cards-main", Some("main")),
    ] {
        let (h, other) = two_accounts(name, Some("main"), REF, OTHER_REF);
        let bin = op_giving(&h.dir, OTHER_REF, OTHER);
        let path = path_with(&bin);
        let mut envs = vec![("PATH", path.as_str()), ("P99_KEY", KEY)];
        envs.extend(bound.map(|b| ("P99_KEY_SPACE", b)));
        for account in [None, Some("other")] {
            for args in CARD_COMMANDS {
                let out = h.p99_env(&with_account(args, account), &envs);
                out.ok();
                assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
                assert!(!out.stderr.contains("P99_KEY"), "{}", out.stderr);
                never_shows(&out, KEY);
                never_shows(&out, OTHER);
            }
        }
        let mains = card_calls(&h.stub);
        let others = card_calls(&other);
        assert_eq!(mains.len(), CARD_COMMANDS.len(), "{mains:?}");
        assert_eq!(others.len(), CARD_COMMANDS.len(), "{others:?}");
        assert!(mains.iter().all(|c| c.signed), "main signs with P99_KEY");
        assert!(
            others.iter().all(|c| c.signed_by(OTHER) && !c.signed),
            "the other account received a card request signed with P99_KEY"
        );
        let reads = asked(&bin);
        assert!(
            !reads.is_empty(),
            "the other account's reference was not read"
        );
        assert!(
            reads.iter().all(|r| r == &asked_of(OTHER_REF)),
            "op was asked for the bound account: {reads:?}"
        );
    }
}

#[test]
fn p99_key_account_moves_the_card_commands_signature_to_the_account_it_names() {
    let (h, other) = two_accounts("key-cards-flipped", Some("main"), KEY, OTHER_REF);
    let bin = op_that_must_not_run(&h.dir);
    let path = path_with(&bin);
    let envs = [
        ("PATH", path.as_str()),
        ("P99_KEY", OTHER),
        ("P99_KEY_SPACE", "other"),
    ];
    for account in [None, Some("other")] {
        for args in CARD_COMMANDS {
            let out = h.p99_env(&with_account(args, account), &envs);
            out.ok();
            assert!(!out.stdout.contains("bad signature"), "{}", out.stdout);
            never_shows(&out, OTHER);
            never_shows(&out, KEY);
        }
    }
    let mains = card_calls(&h.stub);
    let others = card_calls(&other);
    assert_eq!(mains.len(), CARD_COMMANDS.len(), "{mains:?}");
    assert_eq!(others.len(), CARD_COMMANDS.len(), "{others:?}");
    assert!(
        mains.iter().all(|c| c.signed && !c.signed_by(OTHER)),
        "main received a card request signed with P99_KEY"
    );
    assert!(others.iter().all(|c| c.signed_by(OTHER)));
    assert!(!op_ran(&bin), "op ran for the account P99_KEY belongs to");
}

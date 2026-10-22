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
use stub::{KEY, Reply, Stub};

const REF: &str = "op://Example/p99/key";
const WRONG: &str = "p99-key-that-must-never-be-shown";
const EMPTY: &str = "P99_KEY is set but empty; unset it or give the key";

fn guarded(req: &stub::Req) -> Reply {
    if req.path.starts_with("/_p99/") && !req.signed {
        Reply::problem(401, "bad signature")
    } else {
        fake::any(req)
    }
}

fn home_with(name: &str, key: &str) -> Home {
    let stub = Stub::new(guarded);
    let text =
        home::config(&stub.base).replace(&format!("key = \"{KEY}\""), &format!("key = \"{key}\""));
    Home::with_config(name, stub, &text)
}

fn op_that_must_not_run(dir: &Path) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let file = bin.join("op");
    std::fs::write(
        &file,
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/asked\"\necho 'op must not run' >&2\nexit 9\n",
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
    let file = bin.join("op");
    std::fs::write(
        &file,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/asked\"\nif [ \"$1\" = read ] && [ \"$3\" = \"{reference}\" ]; then printf '%s' '{value}'; else exit 9; fi\n"
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
        &["comment", "12", "Seen on Firefox too"],
        &["status", "12", "doing"],
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
        format!("read --no-newline {REF}\n")
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
        !out.stderr.contains("reading the account key"),
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
        (WRONG, &["comment", "12", "hello"]),
        (KEY, &["comment", "12", "hello"]),
        (KEY, &["status", "12", "doing", "--json"]),
    ] {
        let out = h.p99_env(args, &[("P99_KEY", key)]);
        never_shows(&out, key);
        assert!(!out.stderr.contains("P99_KEY="), "{}", out.stderr);
    }
    let out = h.p99_env(&["comment", "12", "hello"], &[("P99_KEY", KEY)]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains("the text is too long"),
        "{}",
        out.stderr
    );
}

const OTHER: &str = "other-account-key";
const OTHER_REF: &str = "op://Example/p99/other";

fn guarded_by(key: &'static str) -> impl Fn(&stub::Req) -> Reply + Send + Sync + 'static {
    move |req| {
        if req.path.starts_with("/_p99/") && !req.signed_by(key) {
            Reply::problem(401, "bad signature")
        } else {
            fake::any(req)
        }
    }
}

fn two_accounts(name: &str, default: Option<&str>, main: &str, other: &str) -> (Home, Stub) {
    let first = Stub::new(guarded);
    let second = Stub::new(guarded_by(OTHER));
    let default = default
        .map(|d| format!("default_account = \"{d}\"\n"))
        .unwrap_or_default();
    let text = format!(
        r#"{default}
[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "acc1"
token = "cf-token"
key = "{main}"
url = "{}/_p99"

[accounts.other]
account_id = "acc2"
token = "cf-token"
key = "{other}"
url = "{}/_p99"

[hosts."shop.example.com"]
account = "main"

[hosts."other.example.org"]
account = "other"
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
        envs.extend(bound.map(|b| ("P99_KEY_ACCOUNT", b)));
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
    &["list", "--account", "other", "--json"],
    &["list", "--all", "--account", "other", "--json"],
    &["show", "12", "--account", "other", "--json"],
    &["hosts", "--account", "other"],
    &["tui", "--account", "other", "--dump", "120x30"],
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
        reads
            .iter()
            .all(|r| r == &format!("read --no-newline {OTHER_REF}")),
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
        ("P99_KEY_ACCOUNT", "other"),
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
        &["list", "--account", "main", "--json"],
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
            &["list", "--account", "other", "--json"],
            &["hosts"],
            &["tui", "--dump", "120x30"],
        ] {
            let out = h.p99_env(
                args,
                &[
                    ("PATH", &path),
                    ("P99_KEY", WRONG),
                    ("P99_KEY_ACCOUNT", bound),
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
        &["list", "--account", "main", "--json"],
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
        out.stderr.contains("reading the account key"),
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
        !out.stderr.contains("reading the account key"),
        "{}",
        out.stderr
    );
    assert!(!op_ran(&bin));
    assert!(!h.stub.seen().is_empty());
    assert!(h.stub.seen().iter().all(|c| !c.signed));
    never_shows(&out, WRONG);
}

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use serde_json::json;
use sha2::{Digest, Sha256};

use home::Home;
use stub::{Reply, Req, Stub};

const SLACK: &str = "https://hooks.slack.com/services/T000/B000/abcdWXYZ";
const SECRETS: &str = "/cf/accounts/acc1/workers/scripts/p99/secrets";

fn home(name: &str) -> Home {
    Home::new(name, fake::any)
}

fn tag(host: &str) -> String {
    Sha256::digest(host.as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02X}"))
        .collect()
}

#[test]
fn hooks_lists_each_hook_with_its_events_and_last_send() {
    let h = home("hooks-list");
    let out = h.p99(&["hooks"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "shop.example.com  slack  ...x9Qz  new,comment  last: 200 2026-10-02 11:15",
            "shop.example.com  discord  ...Aa12  new,comment,status,shipped  last: never sent",
        ]
    );
    let call = h.stub.call("GET", "/_p99/v1/hooks");
    assert!(call.signed);
    assert_eq!(call.param("host"), None);
    h.p99(&["hooks", "--host", " Shop.Example.com "]).ok();
    assert_eq!(
        h.stub.calls("GET", "/_p99/v1/hooks")[1].param("host"),
        Some("shop.example.com")
    );
    let answer = h.p99(&["hooks", "--json"]).json();
    assert_eq!(answer["hooks"][0]["service"], "slack");
    assert_eq!(answer["hooks"][1]["last_status"], serde_json::Value::Null);
    let empty = Home::new("hooks-empty", |req: &Req| {
        if req.is("GET", "/_p99/v1/hooks") {
            Reply::ok(json!({"hooks": []}))
        } else {
            fake::any(req)
        }
    });
    assert_eq!(
        empty.p99(&["hooks"]).stdout,
        "no hooks yet; p99 hooks set <host> --slack <url> or --discord <url>\n"
    );
    let broken = Home::new("hooks-broken", |req: &Req| {
        if req.is("GET", "/_p99/v1/hooks") {
            Reply::ok(json!({"hooks": "none"}))
        } else {
            fake::any(req)
        }
    });
    let out = broken.p99(&["hooks"]);
    assert!(
        out.stderr.starts_with("p99: unexpected answer: "),
        "{}",
        out.stderr
    );
}

#[test]
fn hooks_set_sends_the_url_its_service_and_the_events() {
    let h = home("hooks-set");
    let out = h.p99(&[
        "hooks",
        "set",
        "Shop.Example.com",
        "--slack",
        &format!(" {SLACK} "),
    ]);
    out.ok();
    assert_eq!(
        out.stdout,
        "slack posts new, comment, status, shipped on shop.example.com to ...WXYZ\n"
    );
    let sent = h.stub.call("PUT", "/_p99/v1/hooks/shop.example.com");
    assert!(sent.signed);
    assert_eq!(sent.json(), json!({"url": SLACK, "service": "slack"}));
    let out = h.p99(&[
        "hooks",
        "set",
        "shop.example.com",
        "--discord",
        "https://discord.com/api/webhooks/1/zzzz",
        "--on",
        "new,shipped",
        "--json",
    ]);
    out.ok();
    assert_eq!(out.json()["events"], json!(["new", "shipped"]));
    let sent = &h.stub.calls("PUT", "/_p99/v1/hooks/shop.example.com")[1];
    assert_eq!(
        sent.json(),
        json!({"url": "https://discord.com/api/webhooks/1/zzzz", "service": "discord", "events": ["new", "shipped"]})
    );
}

#[test]
fn hooks_set_reads_a_url_from_the_environment_and_refuses_anything_else() {
    let h = home("hooks-ref");
    h.p99_env(
        &[
            "hooks",
            "set",
            "shop.example.com",
            "--url-ref",
            "env:P99_TEST_HOOK",
        ],
        &[("P99_TEST_HOOK", &format!("  {SLACK}\n"))],
    )
    .ok();
    assert_eq!(
        h.stub.call("PUT", "/_p99/v1/hooks/shop.example.com").json(),
        json!({"url": SLACK, "service": null})
    );
    h.p99_env(
        &[
            "hooks",
            "set",
            "shop.example.com",
            "--url-ref",
            "env:P99_TEST_HOOK",
        ],
        &[("P99_TEST_HOOK", "   ")],
    )
    .refused("the environment variable P99_TEST_HOOK is empty or not set");
    h.p99(&[
        "hooks",
        "set",
        "shop.example.com",
        "--url-ref",
        "env:P99_NO_SUCH_VAR",
    ])
    .refused("the environment variable P99_NO_SUCH_VAR is empty or not set");
    h.p99(&["hooks", "set", "shop.example.com", "--url-ref", SLACK])
        .refused(&format!(
            "{SLACK}: --url-ref takes a 1Password reference (op://…) or env:NAME"
        ));
    h.p99(&["hooks", "set", "bad host", "--slack", SLACK])
        .refused("not a key, host or id: bad host");
    assert_eq!(
        h.stub.calls("PUT", "/_p99/v1/hooks/shop.example.com").len(),
        1
    );
    h.p99(&["hooks", "set", "shop.example.com"])
        .clap("the following required arguments were not provided:");
    h.p99(&[
        "hooks",
        "set",
        "shop.example.com",
        "--slack",
        SLACK,
        "--on",
        "deploy",
    ])
    .clap("invalid value 'deploy' for '--on <events>'");
    h.p99(&[
        "hooks",
        "set",
        "shop.example.com",
        "--slack",
        SLACK,
        "--discord",
        SLACK,
    ])
    .clap("the argument '");
}

#[test]
fn hooks_set_that_the_worker_refuses_is_one_line() {
    let h = Home::new("hooks-refused", |req: &Req| {
        if req.under("PUT", "/_p99/v1/hooks/") {
            Reply::problem(400, "not a Slack incoming webhook")
        } else {
            fake::any(req)
        }
    });
    h.p99(&[
        "hooks",
        "set",
        "shop.example.com",
        "--slack",
        "https://example.com/x",
    ])
    .refused("not a Slack incoming webhook (400)");
}

#[test]
fn hooks_remove_drops_both_or_one_service() {
    let h = home("hooks-remove");
    let out = h.p99(&["hooks", "remove", "shop.example.com"]);
    out.ok();
    assert_eq!(out.stdout, "removed the hooks of shop.example.com\n");
    let first = h.stub.call("DELETE", "/_p99/v1/hooks/shop.example.com");
    assert!(first.signed);
    assert_eq!(first.param("service"), None);
    let out = h.p99(&["hooks", "remove", "shop.example.com", "--slack"]);
    assert_eq!(out.stdout, "removed the slack hook of shop.example.com\n");
    let out = h.p99(&["hooks", "remove", "shop.example.com", "--discord", "--json"]);
    assert_eq!(
        out.json(),
        json!({"removed": {"host": "shop.example.com", "service": "discord"}})
    );
    let calls = h.stub.calls("DELETE", "/_p99/v1/hooks/shop.example.com");
    assert_eq!(calls[1].param("service"), Some("slack"));
    assert_eq!(calls[2].param("service"), Some("discord"));
    h.p99(&[
        "hooks",
        "remove",
        "shop.example.com",
        "--slack",
        "--discord",
    ])
    .clap("the argument '");
}

#[test]
fn hooks_test_says_which_hook_posted_and_fails_when_one_did_not() {
    let h = home("hooks-test");
    let out = h.p99(&["hooks", "test", "shop.example.com"]);
    out.ok();
    assert_eq!(out.stdout, "slack ...x9Qz  posted\n");
    assert!(
        h.stub
            .call("POST", "/_p99/v1/hooks/shop.example.com/test")
            .signed
    );
    let failing = Home::new("hooks-test-fail", |req: &Req| {
        if req.under("POST", "/_p99/v1/hooks/") {
            Reply::ok(json!({"results": [
                {"service": "slack", "hint": "x9Qz", "ok": true, "status": "200"},
                {"service": "discord", "hint": "Aa12", "ok": false, "status": "404"},
            ]}))
        } else {
            fake::any(req)
        }
    });
    let out = failing.p99(&["hooks", "test", "shop.example.com"]);
    out.refused("a hook of shop.example.com did not take the test message");
    assert_eq!(
        out.lines(),
        ["slack ...x9Qz  posted", "discord ...Aa12  failed (404)"]
    );
    let out = failing.p99(&["hooks", "test", "shop.example.com", "--json"]);
    assert_eq!(out.code, Some(1));
    assert_eq!(out.json()["results"][1]["ok"], false);
}

#[test]
fn github_set_links_the_repository_stores_both_secrets_and_adds_the_webhook() {
    let h = home("github-set");
    let out = h.p99_env(
        &[
            "github",
            "set",
            "Shop.Example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            "env:P99_TEST_GH",
        ],
        &[("P99_TEST_GH", " ghp_example \n")],
    );
    out.ok();
    let t = tag("shop.example.com");
    assert_eq!(
        out.lines(),
        [
            format!("shop.example.com is linked to acme/shop; the token is the Worker's secret GITHUB_TOKEN_{t}"),
            "webhook 77 on acme/shop sends pull requests and issues to https://shop.example.com/_p99/v1/github".to_owned(),
        ]
    );
    let repo = h.stub.call("GET", "/gh/repos/acme/shop");
    assert_eq!(repo.header("authorization"), Some("Bearer ghp_example"));
    assert_eq!(repo.header("user-agent"), Some("p99"));
    let secrets = h.stub.calls("PUT", SECRETS);
    assert_eq!(secrets.len(), 2);
    assert_eq!(secrets[0].header("authorization"), Some("Bearer cf-token"));
    assert_eq!(
        secrets[0].json(),
        json!({"name": format!("GITHUB_TOKEN_{t}"), "text": "ghp_example", "type": "secret_text"})
    );
    let secret = secrets[1].json()["text"].as_str().unwrap().to_owned();
    assert_eq!(secrets[1].json()["name"], format!("GITHUB_HOOK_{t}"));
    assert_eq!(secret.len(), 64);
    assert!(secret.bytes().all(|b| b.is_ascii_hexdigit()));
    let hook = h.stub.call("POST", "/gh/repos/acme/shop/hooks").json();
    assert_eq!(
        hook["config"]["url"],
        "https://shop.example.com/_p99/v1/github"
    );
    assert_eq!(hook["config"]["secret"], secret.as_str());
    assert_eq!(hook["events"], json!(["pull_request", "issues"]));
    let linked = h.stub.call("PUT", "/_p99/v1/github/shop.example.com");
    assert!(linked.signed);
    assert_eq!(linked.json(), json!({"repo": "acme/shop", "hook_id": 77}));
    assert!(!out.stdout.contains(&secret));
}

#[test]
fn github_set_updates_the_webhook_it_finds_and_names_the_repository_github_names() {
    let h = Home::new("github-set-again", |req: &Req| {
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/gh/repos/acme/shop") => {
                Reply::ok(json!({"full_name": "Acme/Shop", "has_issues": true}))
            }
            ("GET", "/gh/repos/Acme/Shop/hooks") => Reply::ok(json!([
                {"id": 5, "config": {"url": "https://other.example.com/hook"}},
                {"id": 9, "config": {"url": "https://shop.example.com/_p99/v1/github"}},
            ])),
            _ => fake::any(req),
        }
    });
    let out = h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            "env:P99_TEST_GH",
            "--json",
        ],
        &[("P99_TEST_GH", "ghp_example")],
    );
    out.ok();
    assert_eq!(
        h.stub.call("PATCH", "/gh/repos/Acme/Shop/hooks/9").json()["active"],
        true
    );
    assert!(h.stub.calls("POST", "/gh/repos/Acme/Shop/hooks").is_empty());
    let answer = out.json();
    assert_eq!(answer["webhook"], true);
    assert_eq!(answer["github"]["repo"], "Acme/Shop");
    assert!(answer.get("manual").is_none());
}

#[test]
fn github_set_without_webhook_rights_prints_the_webhook_to_add_by_hand() {
    let h = Home::new("github-manual", |req: &Req| {
        if req.is("GET", "/gh/repos/acme/shop/hooks") {
            Reply::json(
                403,
                json!({"message": "Resource not accessible by personal access token"}),
            )
        } else {
            fake::any(req)
        }
    });
    let out = h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            "env:P99_TEST_GH",
        ],
        &[("P99_TEST_GH", "ghp_example")],
    );
    out.ok();
    let secret = h.stub.calls("PUT", SECRETS)[1].json()["text"]
        .as_str()
        .unwrap()
        .to_owned();
    let lines = out.lines();
    assert_eq!(
        lines[1],
        "the token can't manage webhooks on acme/shop, so add one by hand:"
    );
    assert_eq!(
        lines[3],
        "  Payload URL   https://shop.example.com/_p99/v1/github"
    );
    assert_eq!(lines[5], format!("  Secret        {secret}"));
    assert_eq!(
        h.stub
            .call("PUT", "/_p99/v1/github/shop.example.com")
            .json(),
        json!({"repo": "acme/shop", "hook_id": null})
    );
    let out = h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            "env:P99_TEST_GH",
            "--json",
        ],
        &[("P99_TEST_GH", "ghp_example")],
    );
    let answer = out.json();
    let secret = h.stub.calls("PUT", SECRETS)[3].json()["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(answer["webhook"], false);
    assert_eq!(
        answer["manual"],
        json!({
            "url": "https://shop.example.com/_p99/v1/github",
            "content_type": "application/json",
            "secret": secret,
            "events": ["pull_request", "issues"],
        })
    );
}

fn github_answers(name: &str, status: u16, body: serde_json::Value) -> Home {
    Home::new(name, move |req: &Req| {
        if req.is("GET", "/gh/repos/acme/shop") {
            Reply::json(status, body.clone())
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn github_set_refusals_stop_before_any_secret_is_stored() {
    let token = [("P99_TEST_GH", "ghp_example")];
    let set = [
        "github",
        "set",
        "shop.example.com",
        "--repo",
        "acme/shop",
        "--token-ref",
        "env:P99_TEST_GH",
    ];
    github_answers("github-401", 401, json!({"message": "Bad credentials"}))
        .p99_env(&set, &token)
        .refused("GitHub refused the token; is it current?");
    github_answers("github-404", 404, json!({"message": "Not Found"}))
        .p99_env(&set, &token)
        .refused(
            "the token can't see acme/shop; give it this repository with Issues: read and write",
        );
    github_answers("github-500", 500, json!({"message": "Server Error"}))
        .p99_env(&set, &token)
        .refused("GitHub answered 500: Server Error");
    github_answers("github-502", 502, json!(null))
        .p99_env(&set, &token)
        .refused("GitHub answered 502");
    let off = github_answers(
        "github-off",
        200,
        json!({"full_name": "acme/shop", "has_issues": false}),
    );
    off.p99_env(&set, &token)
        .refused("acme/shop has issues turned off");
    assert!(off.stub.calls("PUT", SECRETS).is_empty());
    let h = home("github-bad");
    h.p99_env(
        &[
            "github",
            "set",
            "gone.example.com",
            "--repo",
            "acme/shop",
            "--token-ref",
            "env:P99_TEST_GH",
        ],
        &token,
    )
    .refused("no host is called gone.example.com; p99 hosts lists them");
    h.p99_env(
        &[
            "github",
            "set",
            "shop.example.com",
            "--repo",
            "acme",
            "--token-ref",
            "env:P99_TEST_GH",
        ],
        &token,
    )
    .refused("acme is not a repository; give owner/name");
    h.p99(&set)
        .refused("env:P99_TEST_GH: P99_TEST_GH is not set");
    h.p99_env(&set, &[("P99_TEST_GH", "  ")])
        .refused("env:P99_TEST_GH is empty");
    h.p99(&[
        "github",
        "set",
        "shop.example.com",
        "--repo",
        "acme/shop",
        "--token-ref",
        "ghp_raw",
    ])
    .refused("ghp_raw is not a reference; give op://vault/item/field or env:NAME");
    assert!(h.stub.seen().is_empty());
    let hook = Home::new("github-hook-422", |req: &Req| {
        if req.is("POST", "/gh/repos/acme/shop/hooks") {
            Reply::json(422, json!({"message": "Validation Failed"}))
        } else {
            fake::any(req)
        }
    });
    hook.p99_env(&set, &token)
        .refused("GitHub answered 422: Validation Failed");
    assert!(
        hook.stub
            .calls("PUT", "/_p99/v1/github/shop.example.com")
            .is_empty()
    );
    let listing = Home::new("github-hooks-500", |req: &Req| {
        if req.is("GET", "/gh/repos/acme/shop/hooks") {
            Reply::json(500, json!({"message": "down"}))
        } else {
            fake::any(req)
        }
    });
    listing
        .p99_env(&set, &token)
        .refused("GitHub answered 500: down");
}

#[test]
fn github_show_names_each_linked_host_and_what_the_worker_lacks() {
    let h = home("github-show");
    let out = h.p99(&["github", "show"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            format!("{:<16}  {:<9}  {:<7}  STATE", "HOST", "REPO", "WEBHOOK"),
            format!(
                "{:<16}  {:<9}  {:<7}  ok",
                "shop.example.com", "acme/shop", "77"
            ),
        ]
    );
    let mixed = Home::new("github-show-mixed", |req: &Req| {
        if req.is("GET", "/_p99/v1/github") {
            Reply::ok(json!({"hosts": [
                {"host": "a.example.com", "repo": "acme/a", "hook_id": null, "token": false, "secret": true},
                {"host": "b.example.com", "repo": "acme/b", "hook_id": 3, "token": true, "secret": false},
            ]}))
        } else {
            fake::any(req)
        }
    });
    let out = mixed.p99(&["github", "show"]);
    assert_eq!(
        out.lines()[1..],
        [
            format!(
                "{:<13}  {:<6}  {:<7}  no token on the Worker",
                "a.example.com", "acme/a", "by hand"
            ),
            format!(
                "{:<13}  {:<6}  {:<7}  no webhook secret on the Worker",
                "b.example.com", "acme/b", "3"
            ),
        ]
    );
    let answer = mixed.p99(&["github", "show", "--json"]).json();
    assert_eq!(answer["hosts"][1]["hook_id"], 3);
    let none = Home::new("github-show-none", |req: &Req| {
        if req.is("GET", "/_p99/v1/github") {
            Reply::ok(json!({"hosts": []}))
        } else {
            fake::any(req)
        }
    });
    assert_eq!(
        none.p99(&["github", "show"]).stdout,
        "no host is linked to GitHub; p99 github set <host> --repo owner/name --token-ref <ref>\n"
    );
}

#[test]
fn github_off_unlinks_the_host_and_drops_both_secrets() {
    let h = home("github-off");
    let out = h.p99(&["github", "off", "shop.example.com"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "shop.example.com is no longer linked to acme/shop; its secrets are gone from the Worker\n"
    );
    let t = tag("shop.example.com");
    assert!(
        h.stub
            .call("DELETE", "/_p99/v1/github/shop.example.com")
            .signed
    );
    h.stub
        .call("DELETE", &format!("{SECRETS}/GITHUB_TOKEN_{t}"));
    h.stub.call("DELETE", &format!("{SECRETS}/GITHUB_HOOK_{t}"));
    let kept = Home::new("github-off-kept", |req: &Req| {
        if req.under("DELETE", "/_p99/v1/github/") {
            Reply::ok(
                json!({"host": "shop.example.com", "repo": "acme/shop", "hook_removed": false}),
            )
        } else if req.under("DELETE", SECRETS) {
            Reply::cf_error(404, 10007, "secret not found")
        } else {
            fake::any(req)
        }
    });
    let out = kept.p99(&["github", "off", "shop.example.com"]);
    out.ok();
    assert_eq!(
        out.lines()[1],
        "remove the webhook to https://shop.example.com/_p99/v1/github on acme/shop by hand: Settings, Webhooks"
    );
    let answer = kept
        .p99(&["github", "off", "shop.example.com", "--json"])
        .json();
    assert_eq!(answer["hook_removed"], false);
    let denied = Home::new("github-off-denied", |req: &Req| {
        if req.under("DELETE", SECRETS) {
            Reply::cf_error(403, 10000, "Authentication error")
        } else {
            fake::any(req)
        }
    });
    denied.p99(&["github", "off", "shop.example.com"]).refused(
        &format!("Cloudflare {SECRETS}/GITHUB_TOKEN_{t}: Authentication error (10000)")
            .replace("/cf/", "/"),
    );
    h.p99(&["github", "off", "gone.example.com"])
        .refused("no host is called gone.example.com; p99 hosts lists them");
}

#[test]
fn github_open_opens_an_issue_or_names_the_one_an_item_has() {
    let h = home("github-open");
    let out = h.p99(&["github", "open", "BUG-12", "--host", "shop.example.com"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "BUG-12: opened https://github.com/acme/shop/issues/12\n"
    );
    let call = h.stub.call("POST", "/_p99/v1/issues/12/github");
    assert!(call.signed);
    assert_eq!(call.param("host"), Some("shop.example.com"));
    let existing = Home::new("github-open-existing", |req: &Req| {
        if req.under("POST", "/_p99/v1/issues/") {
            Reply::ok(
                json!({"key": "BUG-12", "url": "https://github.com/acme/shop/issues/5", "existing": true}),
            )
        } else {
            fake::any(req)
        }
    });
    let out = existing.p99(&["github", "open", "12"]);
    assert_eq!(
        out.stdout,
        "BUG-12: already linked to https://github.com/acme/shop/issues/5\n"
    );
    let answer = existing.p99(&["github", "open", "12", "--json"]).json();
    assert_eq!(answer["existing"], true);
    h.p99(&["github", "open", "x"])
        .refused("x is not an item key; try BUG-12 or 12");
    h.p99(&["github"])
        .clap("'p99 github' requires a subcommand but one was not provided");
}

const FROM: &str = "P99 <p99@example.com>";

fn d1(h: &Home) -> Vec<Req> {
    h.stub
        .calls("POST", "/cf/accounts/acc1/d1/database/db1/query")
}

#[test]
fn email_set_checks_the_sender_stores_it_and_hands_the_key_to_the_worker() {
    let h = home("email-set");
    let out = h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            FROM,
        ],
        &[("P99_TEST_RESEND", " re_example \n")],
    );
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "mail is on for the account main: Resend, from P99 <p99@example.com>",
            "the key is the Worker's secret RESEND_API_KEY",
        ]
    );
    let domains = h.stub.call("GET", "/resend/domains");
    assert_eq!(domains.header("authorization"), Some("Bearer re_example"));
    let stored = &d1(&h)[0];
    assert_eq!(stored.header("authorization"), Some("Bearer cf-token"));
    assert!(
        stored.json()["sql"]
            .as_str()
            .unwrap()
            .starts_with("INSERT INTO mail")
    );
    assert_eq!(stored.json()["params"], json!(["resend", FROM, null]));
    assert_eq!(
        h.stub.call("PUT", SECRETS).json(),
        json!({"name": "RESEND_API_KEY", "text": "re_example", "type": "secret_text"})
    );
    let out = h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            "p99@example.com",
            "--json",
        ],
        &[("P99_TEST_RESEND", "re_example")],
    );
    assert_eq!(
        out.json(),
        json!({"account": "main", "on": true, "provider": "resend", "from": "p99@example.com", "note": null})
    );
}

#[test]
fn email_set_with_a_sending_only_key_notes_the_sender_was_not_checked() {
    let h = Home::new("email-restricted", |req: &Req| {
        if req.is("GET", "/resend/domains") {
            Reply::json(
                401,
                json!({"name": "restricted_api_key", "message": "This API key is restricted to only send emails"}),
            )
        } else {
            fake::any(req)
        }
    });
    let out = h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            FROM,
        ],
        &[("P99_TEST_RESEND", "re_send_only")],
    );
    out.ok();
    assert_eq!(
        out.lines()[2],
        "note: the key can only send mail, so the sender's domain was not checked with Resend"
    );
    assert_eq!(
        d1(&h)[0].json()["params"][2],
        "the key can only send mail, so the sender's domain was not checked with Resend"
    );
}

fn resend_answers(name: &str, status: u16, body: serde_json::Value) -> Home {
    Home::new(name, move |req: &Req| {
        if req.is("GET", "/resend/domains") {
            Reply::json(status, body.clone())
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn email_set_refuses_a_sender_resend_would_not_send_from() {
    let set = |from: &str| {
        vec![
            "email".to_owned(),
            "set".to_owned(),
            "--provider".to_owned(),
            "resend".to_owned(),
            "--key-ref".to_owned(),
            "env:P99_TEST_RESEND".to_owned(),
            "--from".to_owned(),
            from.to_owned(),
        ]
    };
    let run = |h: &Home, from: &str| {
        let args = set(from);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        h.p99_env(&args, &[("P99_TEST_RESEND", "re_example")])
    };
    let h = home("email-bad");
    run(&h, "P99 <p99@example.org>").refused(
        "example.org is pending with Resend, not verified; finish it at https://resend.com/domains and run this again",
    );
    run(&h, "p99@example.net").refused(
        "example.net is not a domain of this Resend account; add and verify it at https://resend.com/domains",
    );
    run(&h, "nobody").refused("nobody is not an e-mail address");
    run(&h, "a b@example.com").refused("a b@example.com is not an e-mail address");
    run(
        &resend_answers("email-401", 401, json!({"message": "API key is invalid"})),
        FROM,
    )
    .refused("Resend refused the key (401)");
    run(&resend_answers("email-500", 500, json!({})), FROM)
        .refused("Resend answered 500 for its domains");
    assert!(d1(&h).is_empty());
    assert!(h.stub.calls("PUT", SECRETS).is_empty());
    h.p99(&[
        "email",
        "set",
        "--provider",
        "resend",
        "--key-ref",
        "env:P99_NO_SUCH_VAR",
        "--from",
        FROM,
    ])
    .refused("env:P99_NO_SUCH_VAR: P99_NO_SUCH_VAR is not set");
    h.p99(&[
        "email",
        "set",
        "--provider",
        "mailgun",
        "--key-ref",
        "env:X",
        "--from",
        FROM,
    ])
    .clap("invalid value 'mailgun' for '--provider <PROVIDER>'");
    h.p99(&["email"])
        .clap("'p99 email' requires a subcommand but one was not provided");
}

#[test]
fn email_set_on_an_old_database_says_to_deploy_first() {
    let h = Home::new("email-old", |req: &Req| {
        if req.under("POST", "/cf/accounts/acc1/d1/database/") {
            Reply::cf(json!([{"success": false, "error": "no such table: mail"}]))
        } else {
            fake::any(req)
        }
    });
    h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            FROM,
        ],
        &[("P99_TEST_RESEND", "re_example")],
    )
    .refused("the account's database has no mail settings yet; run p99 deploy first");
    assert!(h.stub.calls("PUT", SECRETS).is_empty());
    h.p99(&["email", "show"])
        .refused("the account's database has no mail settings yet; run p99 deploy first");
}

#[test]
fn email_set_moves_the_old_config_mail_lines_out_of_the_config() {
    let stub = Stub::new(fake::any);
    let text = home::config(&stub.base).replace(
        "url = ",
        "resend_key = \"re_old\"\nmail_from = \"Old <old@example.com>\"\nurl = ",
    );
    let h = Home::with_config("email-legacy", stub, &text);
    h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            FROM,
        ],
        &[("P99_TEST_RESEND", "re_example")],
    )
    .ok();
    let account = &h.toml()["accounts"]["main"];
    assert!(account.get("resend_key").is_none());
    assert!(account.get("mail_from").is_none());
    assert_eq!(account["key"].as_str(), Some(stub::KEY));
}

#[test]
fn email_off_stores_off_and_drops_the_key() {
    let h = home("email-off");
    let out = h.p99(&["email", "off"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "mail is off for the account main, and the Worker no longer holds a mail key\n"
    );
    assert_eq!(d1(&h)[0].json()["params"], json!(["off", null, null]));
    h.stub.call("DELETE", &format!("{SECRETS}/RESEND_API_KEY"));
    let answer = h.p99(&["email", "off", "--json"]).json();
    assert_eq!(answer, json!({"account": "main", "on": false}));
}

#[test]
fn email_show_reads_the_database_the_secret_and_an_old_binding() {
    let on = Home::new("email-show", |req: &Req| {
        match (req.method.as_str(), req.path.as_str()) {
            ("POST", "/cf/accounts/acc1/d1/database/db1/query") => {
                Reply::cf(json!([{"success": true, "results": [
                    {"provider": "resend", "sender": FROM, "note": "checked", "updated_at": "2026-10-02T10:00:00.000Z"},
                ]}]))
            }
            ("GET", SECRETS) => Reply::cf(json!([{"name": "KEY_P99"}, {"name": "RESEND_API_KEY"}])),
            _ => fake::any(req),
        }
    });
    let out = on.p99(&["email", "show"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "account   main",
            "mail      on",
            "provider  resend",
            "from      P99 <p99@example.com>",
            "key       the Worker's secret RESEND_API_KEY",
            "note      checked",
        ]
    );
    let answer = on.p99(&["email", "show", "--json"]).json();
    assert_eq!(answer["source"], "database");
    assert_eq!(answer["key"], true);
    assert_eq!(answer["updated_at"], "2026-10-02T10:00:00.000Z");
    let legacy = Home::new("email-show-legacy", |req: &Req| {
        if req.is("GET", "/cf/accounts/acc1/workers/scripts/p99/settings") {
            Reply::cf(json!({"bindings": [
                {"type": "plain_text", "name": "VERSION", "text": "1.7.0"},
                {"type": "plain_text", "name": "MAIL_FROM", "text": "Old <old@example.com>"},
            ]}))
        } else {
            fake::any(req)
        }
    });
    let out = legacy.p99(&["email", "show"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "account   main",
            "mail      off",
            "provider  resend",
            "from      Old <old@example.com>",
            "key       none",
            "the sender is still the Worker's MAIL_FROM binding; p99 email set moves it to the database",
        ]
    );
    assert_eq!(
        legacy.p99(&["email", "show", "--json"]).json()["source"],
        "binding"
    );
    let off = home("email-show-off");
    let out = off.p99(&["email", "show"]);
    assert_eq!(
        out.lines()[1..4],
        ["mail      off", "provider  off", "from      -"]
    );
    assert_eq!(
        off.p99(&["email", "show", "--json"]).json()["source"],
        serde_json::Value::Null
    );
}

#[test]
fn email_without_an_account_says_run_setup() {
    let h = home("email-none");
    std::fs::remove_file(h.file()).unwrap();
    h.p99(&["email", "show"])
        .refused("no account yet; run p99 setup");
}

#[test]
fn app_prints_the_page_address_from_the_config_or_the_workers_dev_subdomain() {
    let h = home("app");
    let out = h.p99(&["app"]);
    out.ok();
    assert_eq!(out.stdout, "https://p99.example.workers.dev/\n");
    assert_eq!(
        h.p99(&["app", "--json"]).json(),
        json!({"account": "main", "app": "https://p99.example.workers.dev/", "own": false})
    );
    let stub = Stub::new(fake::any);
    let own = Home::with_config(
        "app-own",
        stub.clone(),
        &home::config(&stub.base).replace("url = ", "app = \"P99.Example.com.\"\nurl = "),
    );
    assert_eq!(own.p99(&["app"]).stdout, "https://p99.example.com/\n");
    assert!(own.stub.seen().is_empty());
    let bad = Home::with_config(
        "app-bad",
        stub.clone(),
        &home::config(&stub.base).replace("url = ", "app = \"not a host\"\nurl = "),
    );
    bad.p99(&["app"])
        .refused("app = \"not a host\" is not a host name; give a host such as p99.example.com");
    let none = Home::new("app-none", |req: &Req| {
        if req.under("GET", "/cf/accounts/acc1/workers/subdomain") {
            Reply::cf_error(404, 10007, "no subdomain")
        } else {
            fake::any(req)
        }
    });
    none.p99(&["app"]).refused(
        "the account has no workers.dev subdomain, so the P99 page has no address; pick one in the Cloudflare dashboard (Workers & Pages) or set app = \"<host>\" for the account in the config, then run p99 deploy",
    );
}

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req};

const SECRETS: &str = "/cf/accounts/acc1/workers/scripts/p99/secrets";

fn tag(host: &str) -> String {
    Sha256::digest(host.as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02X}"))
        .collect()
}

fn set(h: &Home, extra: &[&str]) -> crate::home::Out {
    let mut args = vec![
        "github",
        "set",
        "shop.example.com",
        "--repo",
        "acme/shop",
        "--token-ref",
        "env:P99_TEST_GH",
    ];
    args.extend_from_slice(extra);
    h.p99_env(&args, &[("P99_TEST_GH", "ghp_example")])
}

#[test]
fn us_github_001_github_set_links_the_repo_and_github_open_files_one_issue() {
    let h = Home::new("us-github-set", fake::any);
    let out = set(&h, &[]);
    out.ok();
    let t = tag("shop.example.com");
    assert_eq!(
        out.lines(),
        [
            format!("shop.example.com is linked to acme/shop; the token is the Worker's secret GITHUB_TOKEN_{t}"),
            "webhook 77 on acme/shop sends pull requests and issues to https://shop.example.com/_p99/v1/github".to_owned(),
        ]
    );
    let secrets = h.stub.calls("PUT", SECRETS);
    assert_eq!(secrets.len(), 2);
    assert_eq!(secrets[0].json()["name"], format!("GITHUB_TOKEN_{t}"));
    assert_eq!(secrets[1].json()["name"], format!("GITHUB_HOOK_{t}"));
    let hook_secret = secrets[1].json()["text"].as_str().unwrap().to_owned();
    assert!(!out.stdout.contains(&hook_secret));
    assert!(!out.stdout.contains("ghp_example"));
    let hook = h.stub.call("POST", "/gh/repos/acme/shop/hooks").json();
    assert_eq!(hook["events"], json!(["pull_request", "issues"]));

    let opened = h.p99(&["github", "open", "BUG-12", "--host", "shop.example.com"]);
    opened.ok();
    assert_eq!(
        opened.stdout,
        "BUG-12: opened https://github.com/acme/shop/issues/12\n"
    );
    let has_one = Home::new("us-github-open-again", |req: &Req| {
        if req.under("POST", "/_p99/v1/issues/") {
            Reply::ok(
                json!({"key": "BUG-12", "url": "https://github.com/acme/shop/issues/5", "existing": true}),
            )
        } else {
            fake::any(req)
        }
    });
    let again = has_one.p99(&["github", "open", "12"]);
    again.ok();
    assert_eq!(
        again.stdout,
        "BUG-12: already linked to https://github.com/acme/shop/issues/5\n"
    );
}

#[test]
fn us_github_001_without_webhook_rights_it_prints_the_webhook_to_add_by_hand() {
    let h = Home::new("us-github-manual", |req: &Req| {
        if req.is("GET", "/gh/repos/acme/shop/hooks") {
            Reply::json(
                403,
                json!({"message": "Resource not accessible by personal access token"}),
            )
        } else {
            fake::any(req)
        }
    });
    let out = set(&h, &[]);
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
}

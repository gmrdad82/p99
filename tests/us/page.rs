use serde_json::json;

use crate::fake;
use crate::home::{self, Home};
use crate::stub::{Reply, Req, Stub};

#[test]
fn us_page_001_p99_app_prints_the_address_to_sign_in_at() {
    let ada = Home::new("us-page-001-address", fake::any);
    let found = ada.p99(&["app"]);
    found.ok();
    assert_eq!(found.stdout, "https://p99.example.workers.dev/\n");
    assert_eq!(
        ada.p99(&["app", "--json"]).json(),
        json!({"space": "main", "app": "https://p99.example.workers.dev/", "own": false})
    );

    let stub = Stub::new(fake::any);
    let own = Home::with_config(
        "us-page-001-own-address",
        stub.clone(),
        &home::config(&stub.base).replace("url = ", "app = \"P99.Example.com.\"\nurl = "),
    );
    let named = own.p99(&["app"]);
    named.ok();
    assert_eq!(named.stdout, "https://p99.example.com/\n");
    assert_eq!(
        own.p99(&["app", "--json"]).json(),
        json!({"space": "main", "app": "https://p99.example.com/", "own": true})
    );
    assert!(own.stub.seen().is_empty());
}

#[test]
fn us_page_001_a_space_with_no_address_says_how_to_get_one() {
    let none = Home::new("us-page-001-no-address", |req: &Req| {
        if req.under("GET", "/cf/accounts/acc1/workers/subdomain") {
            Reply::cf_error(404, 10007, "no subdomain")
        } else {
            fake::any(req)
        }
    });
    let refused = none.p99(&["app"]);
    refused.refused(
        "the Cloudflare account has no workers.dev subdomain, so the P99 page has no address; pick one in the Cloudflare dashboard (Workers & Pages) or set app = \"<host>\" for the space in the config, then run p99 deploy",
    );
    assert!(refused.stdout.is_empty());

    let stub = Stub::new(fake::any);
    let bad = Home::with_config(
        "us-page-001-bad-address",
        stub.clone(),
        &home::config(&stub.base).replace("url = ", "app = \"not a host\"\nurl = "),
    );
    let named = bad.p99(&["app"]);
    named.refused("app = \"not a host\" is not a host name; give a host such as p99.example.com");
    assert!(named.stdout.is_empty());
    assert!(bad.stub.seen().is_empty());
}

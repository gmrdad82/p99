use serde_json::json;

use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req};

#[test]
fn us_hooks_001_hooks_test_says_which_hook_posted() {
    let h = Home::new("us-hooks-test", fake::any);
    let out = h.p99(&["hooks", "test", "shop.example.com"]);
    out.ok();
    assert_eq!(out.stdout, "slack ...x9Qz  posted\n");
    assert!(
        h.stub
            .call("POST", "/_p99/v1/hooks/shop.example.com/test")
            .signed
    );
    let failing = Home::new("us-hooks-test-fail", |req: &Req| {
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

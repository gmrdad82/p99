use serde_json::json;

use crate::fake;
use crate::home::Home;
use crate::stub::{KEY, Reply, Req, Stub, code};

#[test]
fn us_relink_001_a_relink_that_names_no_single_code_is_refused() {
    let h = Home::new("us-relink-bad", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            Reply::ok(json!({"codes": [
                code(4, "Grace Hopper", "grace@example.com", &["shop.example.com"]),
                code(7, "Grace Hopper", "grace@example.com", &["dev.example.com"]),
            ]}))
        } else if req.is("POST", "/_p99/v1/codes/5/relink") {
            Reply::problem(404, "no such code, or it is revoked")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["relink", "linus@example.com"])
        .refused("linus@example.com holds no active code; p99 invite mints one");
    h.p99(&["relink", "grace@example.com"]).refused(
        "grace@example.com holds several codes: 4 (projects: Shop), 7 (projects: Blog); name one by id or --host",
    );
    h.p99(&["relink", "5"])
        .refused("no such code, or it is revoked (404)");
    h.p99(&["relink", "bob"])
        .refused("bob is neither a code id nor an e-mail; p99 invites lists both");
    h.p99(&["relink", "99999999999999999999"])
        .refused("99999999999999999999 is not a code id");
    let posts = h.stub.under("POST", "/_p99/");
    assert_eq!(posts.len(), 1, "{posts:?}");
    assert!(posts[0].is("POST", "/_p99/v1/codes/5/relink"));
    assert!(h.stub.under("PATCH", "/_p99/").is_empty());

    let shop = Home::new("us-relink-project", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            Reply::ok(json!({"codes": [
                code(4, "Grace Hopper", "grace@example.com", &["shop.example.com"]),
            ]}))
        } else {
            fake::any(req)
        }
    });
    shop.p99(&["relink", "grace@example.com", "--host", "dev.example.com"])
        .refused("grace@example.com holds no active code on dev.example.com; p99 invite mints one");
    assert!(shop.stub.writes().is_empty());
    let stub = Stub::new(fake::any);
    let text = format!(
        "[spaces.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n",
        stub.base
    );
    let nobody = Home::with_config("us-relink-nobody", stub, &text);
    nobody
        .p99(&["relink", "--self"])
        .refused("--self needs your e-mail in the config's [me]; p99 setup asks for it");
    assert!(nobody.stub.writes().is_empty());
}

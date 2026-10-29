use serde_json::json;

use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req};

#[test]
fn us_site_001_hosts_add_routes_the_host_into_its_project_and_hosts_set_pushes_its_look() {
    let h = Home::new("us-site-add", fake::any);

    let out = h.p99(&["hosts", "add", "new.example.com", "--project", "shop"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "added new.example.com to main, project Shop, environment production\n"
    );
    assert_eq!(
        h.stub.call("POST", "/cf/zones/z1/workers/routes").json()["pattern"],
        "new.example.com/_p99/*"
    );
    let put = h.stub.call("PUT", "/_p99/v1/hosts/new.example.com");
    assert!(put.signed);
    assert_eq!(put.json()["project"], "Shop");
    assert_eq!(put.json()["env"], "production");
    let config = h.toml();
    assert_eq!(
        config["hosts"]["new.example.com"]["space"].as_str(),
        Some("main")
    );
    let shop = config["spaces"]["main"]["projects"]["Shop"]
        .as_array()
        .expect("the Shop project lists its hosts")
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>();
    assert!(shop.contains(&"new.example.com"), "{shop:?}");

    h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--corner",
        "top-left",
        "--offset",
        "24,40",
        "--theme",
        "accent=#1d2b6b",
        "--string",
        "send=Send it",
    ])
    .ok();
    let pushed = h.stub.calls("PUT", "/_p99/v1/hosts/shop.example.com");
    assert_eq!(pushed.len(), 1, "hosts set pushes the host once");
    let look = &pushed[0].json()["config"];
    assert_eq!(look["corner"], "top-left");
    assert_eq!(look["offset"], json!({"x": 24, "y": 40}));
    assert_eq!(look["theme"]["accent"], "#1d2b6b");
    assert_eq!(look["strings"]["send"], "Send it");

    let moved = h.p99(&["hosts", "set", "shop.example.com", "--project", "blog"]);
    moved.ok();
    assert!(
        moved
            .stdout
            .contains("shop.example.com is in the project Blog now; its items moved with it"),
        "{}",
        moved.stdout
    );
    assert_eq!(
        h.stub
            .call("PATCH", "/_p99/v1/hosts/shop.example.com")
            .json()["project"],
        "Blog"
    );
    let blog = h.toml()["spaces"]["main"]["projects"]["Blog"]
        .as_array()
        .expect("the Blog project lists its hosts")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    assert!(blog.iter().any(|h| h == "shop.example.com"), "{blog:?}");
}

#[test]
fn us_site_001_a_host_another_worker_routes_is_refused() {
    let h = Home::new("us-site-refused", |req: &Req| {
        if req.is("GET", "/cf/zones/z1/workers/routes") {
            Reply::cf(json!([{"pattern": "held.example.com/_p99/*", "script": "other"}]))
        } else {
            fake::any(req)
        }
    });
    let before = h.config();

    h.p99(&["hosts", "add", "held.example.com", "--project", "Shop"]).refused(
        "the route held.example.com/_p99/* already runs the Worker other; P99 leaves it alone (remove it in the dashboard to give it to p99)",
    );
    h.p99(&["hosts", "add", "not a host", "--project", "Shop"])
        .refused("not a host is not a host name; try example.com");
    h.p99(&["hosts", "add", "new.example.org", "--project", "Shop"]).refused(
        "new.example.org is on no zone this token reaches; add the zone to Cloudflare or to the token's Zone › Zone: Read",
    );
    h.p99(&["hosts", "add", "new.example.com", "--project", "Nowhere"])
        .refused(
            "no project is called Nowhere in the space main; p99 projects add \"Nowhere\" makes it",
        );
    h.p99(&["hosts", "add", "new.example.com"])
        .clap("the following required arguments were not provided:");

    assert!(
        h.stub.under("PUT", "/_p99/").is_empty(),
        "a refused host reached the Worker"
    );
    assert!(
        h.stub
            .calls("POST", "/cf/zones/z1/workers/routes")
            .is_empty(),
        "a refused host was routed"
    );
    assert_eq!(h.config(), before, "a refused host changed the config");
}

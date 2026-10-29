use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req};

#[test]
fn us_waiting_001_an_older_worker_gets_a_line_saying_to_deploy() {
    let h = Home::new("us-waiting-001-old", fake::any);
    for args in [
        vec!["cards", "--waiting"],
        vec!["cards", "--waiting", "--json"],
    ] {
        let out = h.p99(&args);
        out.refused("this Worker has no Needs you list yet; run p99 deploy");
        assert!(out.stdout.is_empty(), "{}", out.stdout);
    }
    let asked = h.stub.calls("GET", "/_p99/v1/cards/waiting");
    assert!(asked.len() >= 2, "{}", asked.len());
    assert!(asked.iter().all(|r| r.signed));

    let busy = Home::new("us-waiting-001-500", |req: &Req| {
        if req.is("GET", "/_p99/v1/cards/waiting") {
            Reply::problem(500, "the database is busy")
        } else {
            fake::any(req)
        }
    });
    let out = busy.p99(&["cards", "--waiting"]);
    out.refused("the database is busy");
    assert!(out.stdout.is_empty(), "{}", out.stdout);
    assert!(!out.stderr.contains("p99 deploy"), "{}", out.stderr);
}

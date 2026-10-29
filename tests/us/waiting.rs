use crate::fake;
use crate::home::Home;

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
}

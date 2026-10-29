use crate::fake;
use crate::home::Home;

#[test]
fn us_projects_001_a_host_added_without_a_project_or_into_a_missing_one_is_refused_and_nothing_is_made()
 {
    let h = Home::new("us-projects-host-without-project", fake::any);
    let before = h.config();

    h.p99(&["hosts", "add", "new.example.com"])
        .clap("the following required arguments were not provided:");

    h.p99(&["hosts", "add", "new.example.com", "--project", "Docs"])
        .refused("no project is called Docs in the space main; p99 projects add \"Docs\" makes it");

    assert_eq!(h.config(), before, "a refused host changed the config");
    assert!(
        h.stub.writes().is_empty(),
        "a refused host wrote: {:?}",
        h.stub
            .writes()
            .iter()
            .map(|r| format!("{} {}", r.method, r.path))
            .collect::<Vec<_>>()
    );
    assert!(h.stub.under("POST", "/cf/").is_empty());
    assert!(h.stub.under("PUT", "/_p99/").is_empty());
}

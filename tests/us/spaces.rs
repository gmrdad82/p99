use serde_json::json;

use crate::fake;
use crate::home::{self, Home};
use crate::stub::{KEY, Stub};

fn two_spaces(name: &str) -> (Home, Stub) {
    let work = Stub::new(fake::any);
    let main = Stub::new(fake::any);
    let text = format!(
        "{}\n[spaces.work]\nname = \"Client Co\"\naccount_id = \"acc2\"\ntoken = \"cf-token-work\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n\n[spaces.work.projects]\nPortal = [\"work.example.org\"]\n\n[hosts.\"work.example.org\"]\nspace = \"work\"\n",
        home::config(&main.base),
        work.base
    );
    (Home::with_config(name, main, &text), work)
}

#[test]
fn us_spaces_001_p99_spaces_lists_each_space_and_space_sends_a_command_to_that_one_alone() {
    let (h, work) = two_spaces("us-spaces-two");

    let listed = h.p99(&["spaces", "--json"]);
    listed.ok();
    let answer = listed.json();
    let spaces = answer["spaces"].as_array().unwrap();
    assert_eq!(spaces.len(), 2, "{answer}");
    let main = spaces.iter().find(|s| s["slug"] == "main").unwrap();
    let client = spaces.iter().find(|s| s["slug"] == "work").unwrap();
    assert_eq!(main["name"], "PITO MD");
    assert_eq!(main["url"], h.stub.worker());
    assert_eq!(main["default"], true);
    assert_eq!(client["name"], "Client Co");
    assert_eq!(client["url"], work.worker());
    assert_eq!(client["default"], false);
    assert_eq!(
        client["projects"],
        json!([{"name": "Portal", "hosts": ["work.example.org"]}])
    );

    let text = h.p99(&["spaces"]);
    text.ok();
    let row = text
        .lines()
        .into_iter()
        .find(|l| l.starts_with("work "))
        .unwrap_or_else(|| panic!("no row for work:\n{}", text.stdout));
    assert!(
        row.contains("Client Co") && row.contains(&work.worker()) && row.contains("Portal"),
        "{row}"
    );
    assert!(h.stub.seen().is_empty() && work.seen().is_empty());

    h.p99(&["projects", "--space", "work", "--json"]).ok();
    assert_eq!(work.calls("GET", "/_p99/v1/space").len(), 1);
    assert!(work.seen().iter().all(|r| r.signed));
    assert!(h.stub.seen().is_empty(), "the default space was called");
    let heard = work.seen().len();

    h.p99(&["projects", "--json"]).ok();
    assert_eq!(h.stub.calls("GET", "/_p99/v1/space").len(), 1);
    assert_eq!(work.seen().len(), heard, "the other space was called");
}

const LEGACY: &str = r#"default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "acc1"
token = "cf-token"
key = "test-secret"
url = "BASE/_p99"

[hosts."shop.example.com"]
account = "main"
"#;

#[test]
fn us_spaces_001_an_old_accounts_config_and_the_account_flag_still_work_and_say_to_rename_once() {
    let stub = Stub::new(fake::any);
    let text = LEGACY.replace("BASE", &stub.base);
    let h = Home::with_config("us-spaces-legacy", stub, &text);

    let out = h.p99(&["hosts", "--account", "main"]);
    out.ok();
    assert!(out.stdout.contains("shop.example.com"), "{}", out.stdout);
    assert_eq!(
        out.stderr.matches("--account is now --space").count(),
        1,
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.contains(
            "[accounts.<name>] to [spaces.<name>], default_account to default_space and account = to space = under [hosts]"
        ),
        "{}",
        out.stderr
    );

    h.p99(&["hosts", "set", "shop.example.com", "--corner", "top-left"])
        .ok();
    let saved = h.toml();
    assert!(saved.get("accounts").is_none(), "{}", h.config());
    assert!(saved.get("default_account").is_none(), "{}", h.config());
    assert_eq!(saved["default_space"].as_str(), Some("main"));
    assert_eq!(saved["spaces"]["main"]["account_id"].as_str(), Some("acc1"));
    assert_eq!(
        saved["hosts"]["shop.example.com"]["space"].as_str(),
        Some("main")
    );
    assert!(saved["hosts"]["shop.example.com"].get("account").is_none());

    let again = h.p99(&["hosts"]);
    again.ok();
    assert!(again.stderr.is_empty(), "{}", again.stderr);
}

#[test]
fn us_spaces_001_an_unknown_space_is_refused_and_says_where_to_look() {
    let (h, work) = two_spaces("us-spaces-unknown");

    let out = h.p99(&["projects", "--space", "nowhere"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains("p99: no space is called nowhere"),
        "{}",
        out.stderr
    );
    assert_eq!(out.stderr.lines().count(), 1, "{}", out.stderr);

    h.p99(&["spaces", "--space", "nowhere"])
        .refused("no space is called nowhere; p99 spaces lists them");
    assert!(h.stub.seen().is_empty() && work.seen().is_empty());
}

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use serde_json::{Value, json};

use home::Home;
use stub::{Reply, Req, Stub, summary, thread};

fn home(name: &str) -> Home {
    Home::new(name, fake::any)
}

fn all_signed(home: &Home) {
    let calls: Vec<Req> = home
        .stub
        .seen()
        .into_iter()
        .filter(|r| r.path.starts_with("/_p99/"))
        .collect();
    assert!(!calls.is_empty(), "the Worker was never called");
    for call in calls {
        assert!(call.signed, "{} {} is not signed", call.method, call.target);
        assert_eq!(call.actor()["email"], "ada@example.com", "{}", call.target);
        assert_eq!(call.actor()["name"], "Ada Lovelace");
    }
}

fn row(unread: bool, key: &str, state: &str, host: &str, title: &str) -> String {
    format!(
        "{}{key:<8} {state:<11} {host:<11} {title}",
        if unread { "*" } else { " " }
    )
}

#[test]
fn list_asks_every_host_for_open_items_and_prints_the_newest_first() {
    let h = home("list-plain");
    let out = h.p99(&["list"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            row(
                false,
                "BUG-14",
                "Inbox",
                "shop.example.com",
                "The cart forgets an item"
            ),
            row(
                false,
                "BUG-12",
                "Inbox",
                "shop.example.com",
                "The total does not update"
            ),
        ]
    );
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    let call = h.stub.call("GET", "/_p99/v1/issues");
    assert_eq!(call.param("host"), Some("*"));
    assert_eq!(call.param("scope"), Some("all"));
    assert_eq!(call.param("status"), Some("open"));
    assert_eq!(call.param("limit"), Some("50"));
    assert_eq!(call.param("cursor"), None);
    all_signed(&h);
}

#[test]
fn list_sends_every_filter_it_was_given() {
    let h = home("list-filters");
    h.p99(&[
        "list",
        "shop.example.com",
        "--status",
        "any",
        "--kind",
        "bug",
        "--mine",
        "-q",
        "total café",
        "--label",
        "Doing",
        "--limit",
        "5",
    ])
    .ok();
    let call = h.stub.call("GET", "/_p99/v1/issues");
    assert_eq!(call.param("host"), Some("shop.example.com"));
    assert_eq!(call.param("scope"), Some("mine"));
    assert_eq!(call.param("status"), Some("any"));
    assert_eq!(call.param("kind"), Some("bug"));
    assert_eq!(call.param("q"), Some("total café"));
    assert_eq!(call.params("label"), ["Doing"]);
    assert_eq!(call.param("limit"), Some("5"));
    assert!(
        call.target.contains("q=total%20caf%C3%A9"),
        "{}",
        call.target
    );
}

#[test]
fn list_json_is_the_issues_and_whether_more_follow() {
    let h = home("list-json");
    let out = h.p99(&["list", "--json"]);
    out.ok();
    let answer = out.json();
    assert_eq!(answer["more"], false);
    let keys: Vec<&str> = answer["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["key"].as_str().unwrap())
        .collect();
    assert_eq!(keys, ["BUG-14", "BUG-12"]);
    assert_eq!(answer["issues"][0]["reporter"]["name"], "Grace Hopper");
}

#[test]
fn list_json_names_the_space_it_read() {
    let h = home("list-json-space");
    let answer = h.p99(&["list", "--json"]).json();
    assert_eq!(answer["space"], json!({"slug": "main", "name": "PITO MD"}));
    assert!(answer.get("spaces").is_none());
}

#[test]
fn list_takes_project_repeatedly_and_sends_each_one() {
    let h = home("list-projects");
    h.p99(&["list", "--project", "Shop", "--project", "  Blog  "])
        .ok();
    let call = h.stub.call("GET", "/_p99/v1/issues");
    assert_eq!(call.params("project"), ["Shop", "Blog"]);
    let bare = home("list-no-projects");
    bare.p99(&["list"]).ok();
    assert!(
        bare.stub
            .call("GET", "/_p99/v1/issues")
            .params("project")
            .is_empty()
    );
    h.p99(&["list", "--project", "  "])
        .refused("a project name has 1 to 40 characters");
}

#[test]
fn list_follows_the_cursor_until_the_limit_and_says_more_follow() {
    let h = Home::new("list-pages", |req: &Req| {
        if !req.is("GET", "/_p99/v1/issues") {
            return fake::any(req);
        }
        match req.param("cursor") {
            None => Reply::ok(json!({
                "issues": [summary(1, "one", "2026-10-01T01:00:00Z"), summary(2, "two", "2026-10-01T02:00:00Z")],
                "next_cursor": "c2",
            })),
            Some("c2") => Reply::ok(json!({
                "issues": [summary(3, "three", "2026-10-01T03:00:00Z")],
                "next_cursor": "c3",
            })),
            _ => Reply::problem(400, "unknown cursor"),
        }
    });
    let out = h.p99(&["list", "--limit", "3"]);
    out.ok();
    assert_eq!(out.lines().len(), 3);
    assert!(out.lines()[0].contains("BUG-3"));
    assert_eq!(out.stderr, "more items follow; raise --limit\n");
    let calls = h.stub.calls("GET", "/_p99/v1/issues");
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].param("limit"), Some("3"));
    assert_eq!(calls[1].param("cursor"), Some("c2"));
    assert_eq!(calls[1].param("limit"), Some("1"));
    let json = h.p99(&["list", "--limit", "3", "--json"]);
    assert_eq!(json.json()["more"], true);
    assert_eq!(json.json()["issues"].as_array().unwrap().len(), 3);
}

#[test]
fn list_that_reaches_the_last_page_says_nothing_more() {
    let h = Home::new("list-last", |req: &Req| {
        if !req.is("GET", "/_p99/v1/issues") {
            return fake::any(req);
        }
        match req.param("cursor") {
            None => Reply::ok(
                json!({"issues": [summary(1, "one", "2026-10-01T01:00:00Z")], "next_cursor": "c2"}),
            ),
            _ => Reply::ok(
                json!({"issues": [summary(2, "two", "2026-10-01T02:00:00Z")], "next_cursor": null}),
            ),
        }
    });
    let out = h.p99(&["list", "--json"]);
    out.ok();
    assert_eq!(out.json()["more"], false);
    assert!(out.stderr.is_empty());
}

#[test]
fn an_empty_list_says_no_items() {
    let h = Home::new("list-empty", |req: &Req| {
        if req.is("GET", "/_p99/v1/issues") {
            Reply::ok(json!({"issues": []}))
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["list"]);
    out.ok();
    assert_eq!(out.stdout, "no items\n");
}

#[test]
fn a_list_row_shows_unread_assignee_comments_and_where_a_fix_landed() {
    let h = Home::new("list-row", |req: &Req| {
        if !req.is("GET", "/_p99/v1/issues") {
            return fake::any(req);
        }
        let mut landed = summary(7, "Checkout \u{1b}[2Jbreaks", "2026-10-05T00:00:00Z");
        landed["unread"] = json!(true);
        landed["label"] = Value::Null;
        landed["stage"] = json!("in_progress");
        landed["assignee"] = json!({"username": "grace.hopper"});
        landed["comments"] = json!(3);
        landed["landing"] =
            json!({"branch": false, "envs": [{"env": "staging"}, {"env": "production"}]});
        let mut branch = summary(8, "Footer", "2026-10-04T00:00:00Z");
        branch["landing"] = json!({"branch": true, "envs": []});
        branch["host"] = Value::Null;
        Reply::ok(json!({"issues": [landed, branch]}))
    });
    let out = h.p99(&["list"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            format!(
                "{}  -> @grace.hopper  [3 comments]  landed: staging, production",
                row(
                    true,
                    "BUG-7",
                    "In progress",
                    "shop.example.com",
                    "Checkout [2Jbreaks"
                )
            ),
            format!(
                "{}  fixed on a branch",
                row(false, "BUG-8", "Inbox", "-", "Footer")
            ),
        ]
    );
}

#[test]
fn list_refusals_and_failures_end_in_one_plain_line() {
    let forbidden = Home::new("list-403", |req: &Req| {
        if req.under("GET", "/_p99/v1/issues") {
            Reply::problem(403, "only a manager lists \u{1b}]52;every item")
        } else {
            fake::any(req)
        }
    });
    let out = forbidden.p99(&["list"]);
    out.refused("only a manager lists ]52;every item (403)");
    assert!(out.stdout.is_empty());

    let broken = Home::new("list-502", |req: &Req| {
        if req.under("GET", "/_p99/v1/issues") {
            Reply::raw(502, "text/plain", b"bad gateway")
        } else {
            fake::any(req)
        }
    });
    broken.p99(&["list"]).refused("the Worker answered 502");

    let garbled = Home::new("list-garbled", |req: &Req| {
        if req.under("GET", "/_p99/v1/issues") {
            Reply::raw(200, "application/json", b"{\"issues\": [{\"id\": \"x\"}")
        } else {
            fake::any(req)
        }
    });
    let out = garbled.p99(&["list"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.starts_with("p99: unexpected answer: "),
        "{}",
        out.stderr
    );
    assert_eq!(out.stderr.lines().count(), 1);

    let dropped = Home::new("list-drop", |req: &Req| {
        if req.under("GET", "/_p99/v1/issues") {
            Reply::Drop
        } else {
            fake::any(req)
        }
    });
    let out = dropped.p99(&["list"]);
    assert_eq!(out.code, Some(1));
    let reach = format!("p99: cannot reach {}: ", dropped.stub.worker());
    assert!(out.stderr.starts_with(&reach), "{}", out.stderr);
    assert_eq!(out.stderr.lines().count(), 1);
}

#[test]
fn a_worker_that_is_gone_cannot_be_reached() {
    let base = Stub::closed();
    let h = Home::with_config("list-gone", Stub::new(fake::any), &home::config(&base));
    let out = h.p99(&["list"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .starts_with(&format!("p99: cannot reach {base}/_p99: ")),
        "{}",
        out.stderr
    );
}

#[test]
fn list_without_a_config_or_with_an_unknown_space_says_what_to_do() {
    let h = home("list-noconfig");
    std::fs::remove_file(h.file()).unwrap();
    h.p99(&["list"]).refused("no space yet; run p99 setup");
    assert!(h.stub.seen().is_empty());
    let h = home("list-unknown");
    h.p99(&["list", "--space", "work"])
        .refused("no space is called work");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn list_arguments_clap_cannot_parse_answer_like_clap() {
    let h = home("list-clap");
    h.p99(&["list", "--limit", "many"])
        .clap("invalid value 'many' for '--limit <LIMIT>'");
    h.p99(&["list", "--all", "shop.example.com"])
        .clap("the argument '--all' cannot be used with '[HOST]'");
    h.p99(&["list", "--colour"])
        .clap("unexpected argument '--colour' found");
    h.p99(&["lists"]).clap("unrecognized subcommand 'lists'");
    assert!(h.stub.seen().is_empty());
}

fn full_thread() -> Value {
    let mut t = thread(12, "The total does not update");
    let i = &mut t["issue"];
    i["reporter"] = json!({"email": "grace@example.com", "name": "Grace Hopper", "agent": true});
    i["assignee"] = json!({"username": "ada.lovelace"});
    i["duplicate_of"] = json!("BUG-3");
    i["board"] = json!("Ada's board");
    i["merged"] = json!([{"key": "BUG-15", "title": "Total is 0", "reporter": {"email": "linus@example.com"}}]);
    i["github"] = json!([
        {"kind": "issue", "rel": "opened", "repo": "acme/shop", "number": 5, "url": "https://github.com/acme/shop/issues/5"},
        {"kind": "pull", "rel": "fixes", "repo": "acme/shop", "number": 6, "url": "https://github.com/acme/shop/pull/6"},
    ]);
    i["landing"] = json!({"branch": true, "envs": [
        {"env": "production", "kind": "release", "at": "2026-10-03T12:00:00.000Z", "sha": "0123456789abcdef", "version": "v1.2.0"},
        {"env": "dev", "kind": "development", "at": "2026-10-02T12:00:00.000Z", "sha": "fedcba9876543210"},
    ]});
    i["commits"] = json!([{"sha": "0123456789abcdef", "subject": "Fix the total", "rel": "fixes", "envs": ["dev", "production"]}]);
    t["attachments"] = json!([{"id": 41, "role": "screenshot", "name": "cart.png", "bytes": 2048}]);
    t["comments"] = json!([
        {"id": 31, "author": {"email": "ada@example.com", "name": "Ada Lovelace"}, "body": "Looking", "internal": true, "created_at": "2026-10-02T09:00:00.000Z", "attachments": [41]},
        {"id": 32, "author": {"email": "linus@example.com", "name": "", "agent": true}, "body": "Thanks", "created_at": "2026-10-02T10:00:00.000Z"},
    ]);
    t["events"] = json!([
        {"actor": "ada@example.com", "actor_name": "Ada Lovelace", "kind": "label", "detail": {"from": "Inbox", "to": "Doing"}, "at": "2026-10-02T09:05:00.000Z"},
        {"actor": "grace@example.com", "kind": "note", "detail": "plain words", "at": "2026-10-02T09:06:00.000Z"},
        {"kind": "created", "at": "2026-10-01T09:30:00.000Z"},
    ]);
    t
}

#[test]
fn show_prints_the_whole_thread_in_order() {
    let h = Home::new("show-full", |req: &Req| {
        if req.is("GET", "/_p99/v1/issues/12") {
            Reply::ok(full_thread())
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["show", "bug-12", "--host", " Shop.Example.com "]);
    out.ok();
    let expected = "\
BUG-12  Bug  Inbox
The total does not update
reported by Grace Hopper 🤖 on shop.example.com  2026-10-01 09:30  from production
page: https://shop.example.com/cart
assigned to @ada.lovelace
merged into BUG-3
merged here
  BUG-15  Total is 0  (linus@example.com)
on the board Ada's board
github issue #5 (opened): https://github.com/acme/shop/issues/5
github pull request #6 (fixes): https://github.com/acme/shop/pull/6
received
landed in production (release) 2026-10-03 12:00  01234567  v1.2.0
landed in dev (development) 2026-10-02 12:00  fedcba98
a fix sits on a branch no environment carries yet

The total stays at zero.

commits
  01234567 fixes Fix the total  [dev, production]

attachments
  41  screenshot  cart.png  2048 bytes

2026-10-02 09:00 Ada Lovelace  [internal]
Looking
  attachment 41

2026-10-02 10:00 linus@example.com 🤖
Thanks

events
  2026-10-02 09:05  Ada Lovelace  label  {\"from\":\"Inbox\",\"to\":\"Doing\"}
  2026-10-02 09:06  grace@example.com  note  plain words
  2026-10-01 09:30  -  created\x20\x20
";
    assert_eq!(out.stdout, expected);
    let call = h.stub.call("GET", "/_p99/v1/issues/12");
    assert_eq!(call.param("host"), Some("shop.example.com"));
    all_signed(&h);
}

#[test]
fn show_json_is_the_thread() {
    let h = home("show-json");
    let out = h.p99(&["show", "12", "--json"]);
    out.ok();
    let answer = out.json();
    assert_eq!(answer["issue"]["key"], "BUG-12");
    assert_eq!(answer["comments"], json!([]));
    assert!(answer.get("people").is_none());
}

#[test]
fn show_refuses_a_bad_key_before_any_call_and_says_a_missing_item_plainly() {
    let h = Home::new("show-bad", |req: &Req| {
        if req.under("GET", "/_p99/v1/issues/") {
            Reply::problem(404, "no such item")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["show", "BUG-x"])
        .refused("BUG-x is not an item key; try BUG-12 or 12");
    h.p99(&["show", "../etc"])
        .refused("../etc is not an item key; try BUG-12 or 12");
    assert!(h.stub.seen().is_empty());
    h.p99(&["show", "BUG-99"]).refused("no such item (404)");
    h.p99(&["show"])
        .clap("the following required arguments were not provided:");
}

#[test]
fn file_sends_the_item_with_the_page_and_then_each_attachment() {
    let h = home("file-full");
    std::fs::write(h.dir.join("notes.txt"), "line one\n").unwrap();
    std::fs::write(h.dir.join("cart.PNG"), [0x89, b'P', b'N', b'G']).unwrap();
    let out = h.p99_in(
        &[
            "file",
            " Shop.Example.com ",
            "--kind",
            "bug",
            "--title",
            "The total does not update",
            "--body",
            "-",
            "--page",
            "/cart?step=2#total",
            "--attach",
            "notes.txt",
            "--attach",
            "cart.PNG",
        ],
        "It stays at zero.\n\n",
    );
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "BUG-21 filed on shop.example.com: The total does not update",
            "attached notes.txt as 41",
            "attached cart.PNG as 41",
        ]
    );
    let filed = h.stub.call("POST", "/_p99/v1/issues");
    assert_eq!(filed.param("host"), Some("shop.example.com"));
    let body = filed.json();
    assert_eq!(body["kind"], "bug");
    assert_eq!(body["title"], "The total does not update");
    assert_eq!(body["body"], "It stays at zero.");
    assert_eq!(body["host"], "shop.example.com");
    assert_eq!(body["page"]["path"], "/cart");
    assert_eq!(body["page"]["url"], "https://shop.example.com/cart");
    assert_eq!(body["context"], json!({"source": "cli"}));
    assert_eq!(body["client_uid"].as_str().unwrap().len(), 36);
    let files = h.stub.under("PUT", "/_p99/v1/issues/21/attachments/");
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].param("name"), Some("notes.txt"));
    assert_eq!(files[0].param("role"), Some("file"));
    assert_eq!(files[0].param("host"), None);
    assert_eq!(files[0].header("content-type"), Some("text/plain"));
    assert_eq!(files[0].body, b"line one\n");
    assert_eq!(files[1].header("content-type"), Some("image/png"));
    assert_ne!(files[0].path, files[1].path);
    all_signed(&h);
}

#[test]
fn file_json_and_an_unsafe_page_falls_back_to_the_root() {
    let h = home("file-json");
    let out = h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "question",
        "--title",
        "Where is the receipt?",
        "--page",
        "//evil.example.org/x",
        "--json",
    ]);
    out.ok();
    let answer = out.json();
    assert_eq!(answer["issue"]["key"], "BUG-21");
    assert_eq!(answer["attachments"], json!([]));
    let body = h.stub.call("POST", "/_p99/v1/issues").json();
    assert_eq!(body["page"]["path"], "/");
    assert_eq!(body["body"], "");
    assert_eq!(body["kind"], "question");
}

#[test]
fn file_refuses_a_file_p99_does_not_take_before_filing_anything() {
    let h = home("file-refused");
    std::fs::write(h.dir.join("page.html"), "<p>").unwrap();
    let out = h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "bug",
        "--title",
        "x",
        "--attach",
        "page.html",
    ]);
    out.refused("page.html: P99 takes images, PDFs, text, CSV, JSON, zip and office files");
    let out = h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "bug",
        "--title",
        "x",
        "--attach",
        "missing.txt",
    ]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.starts_with("p99: missing.txt: "),
        "{}",
        out.stderr
    );
    assert!(h.stub.seen().is_empty());
    h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "chore",
        "--title",
        "x",
    ])
    .clap("invalid value 'chore' for '--kind <KIND>'");
    h.p99(&["file", "shop.example.com", "--kind", "bug"])
        .clap("the following required arguments were not provided:");
}

#[test]
fn a_file_the_worker_refuses_files_nothing_after_it() {
    let h = Home::new("file-403", |req: &Req| {
        if req.under("PUT", "/_p99/v1/issues/") {
            Reply::problem(413, "the file is over the limit")
        } else {
            fake::any(req)
        }
    });
    std::fs::write(h.dir.join("a.txt"), "a").unwrap();
    std::fs::write(h.dir.join("b.txt"), "b").unwrap();
    let out = h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "bug",
        "--title",
        "x",
        "--attach",
        "a.txt",
        "--attach",
        "b.txt",
    ]);
    out.refused("the file is over the limit (413)");
    assert_eq!(h.stub.under("PUT", "/_p99/v1/issues/").len(), 1);
}

#[test]
fn comment_reads_standard_input_and_ties_its_files_to_the_comment() {
    let h = home("comment-full");
    std::fs::write(h.dir.join("trace.log"), "boom").unwrap();
    let out = h.p99_in(
        &[
            "comment",
            "BUG-12",
            "-",
            "--internal",
            "--attach",
            "trace.log",
            "--host",
            "shop.example.com",
        ],
        "Seen it twice.\n",
    );
    out.ok();
    assert_eq!(out.stdout, "commented on BUG-12 (internal)\n");
    let made = h.stub.call("POST", "/_p99/v1/issues/12/comments");
    assert_eq!(made.param("host"), Some("shop.example.com"));
    assert_eq!(made.json()["body"], "Seen it twice.");
    assert_eq!(made.json()["internal"], true);
    let file = &h.stub.under("PUT", "/_p99/v1/issues/12/attachments/")[0];
    assert_eq!(file.param("comment"), Some("31"));
    assert_eq!(file.param("host"), Some("shop.example.com"));
    assert_eq!(file.header("content-type"), Some("text/x-log"));
    all_signed(&h);
}

#[test]
fn comment_json_and_a_plain_public_comment() {
    let h = home("comment-json");
    let out = h.p99(&["comment", "12", "Fixed on staging", "--json"]);
    out.ok();
    let answer = out.json();
    assert_eq!(answer["comment"]["id"], 31);
    assert_eq!(answer["comment"]["body"], "Fixed on staging");
    assert_eq!(answer["attachments"], json!([]));
    let made = h.stub.call("POST", "/_p99/v1/issues/12/comments");
    assert_eq!(made.json()["internal"], false);
    assert_eq!(made.param("host"), None);
    let plain = h.p99(&["comment", "12", "Thanks"]);
    assert_eq!(plain.stdout, "commented on 12\n");
    h.p99(&["comment", "twelve", "x"])
        .refused("twelve is not an item key; try BUG-12 or 12");
}

#[test]
fn status_closes_as_dropped_or_duplicate_and_checks_its_flags_first() {
    let h = home("status-close");
    h.p99(&["status", "BUG-12", "duplicate"])
        .refused("a duplicate needs --duplicate-of KEY");
    h.p99(&["status", "BUG-12", "Doing", "--duplicate-of", "BUG-3"])
        .refused("--duplicate-of goes with duplicate");
    assert!(h.stub.seen().is_empty());
    let out = h.p99(&["status", "BUG-12", "abandoned"]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 is now dropped\n");
    let change = h.stub.call("PATCH", "/_p99/v1/issues/12").json();
    assert_eq!(change, json!({"resolution": "abandoned"}));
    let out = h.p99(&[
        "status",
        "BUG-12",
        "duplicate",
        "--duplicate-of",
        "BUG-3",
        "--json",
    ]);
    out.ok();
    assert_eq!(out.json()["duplicate_of"], "BUG-3");
    assert_eq!(out.json()["stage"], "duplicate");
    let sent = &h.stub.calls("PATCH", "/_p99/v1/issues/12")[1];
    assert_eq!(
        sent.json(),
        json!({"resolution": "duplicate", "duplicate_of": "BUG-3"})
    );
}

#[test]
fn status_to_a_label_moves_the_item_from_the_label_it_shows() {
    let h = home("status-label");
    let out = h.p99(&["status", "BUG-12", "Doing"]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 is in Doing\n");
    let moved = h.stub.call("POST", "/_p99/v1/move").json();
    assert_eq!(moved, json!({"key": "12", "from": "Inbox", "to": "Doing"}));
    let out = h.p99(&["status", "12", "Done", "--json"]);
    out.ok();
    assert_eq!(out.json()["card"]["label"], "Done");
}

#[test]
fn status_on_an_item_without_a_label_says_only_an_owner_moves_it() {
    let h = Home::new("status-nolabel", |req: &Req| {
        if req.is("GET", "/_p99/v1/issues/12") {
            let mut t = thread(12, "x");
            t["issue"]["label"] = Value::Null;
            Reply::ok(t)
        } else {
            fake::any(req)
        }
    });
    h.p99(&["status", "BUG-12", "Doing"])
        .refused("12 shows no label; only an Owner moves items");
    assert!(h.stub.calls("POST", "/_p99/v1/move").is_empty());
}

#[test]
fn assign_to_a_username_to_no_one_and_the_clap_errors() {
    let h = home("assign");
    let out = h.p99(&["assign", "BUG-12", " @grace.hopper "]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 is assigned to @grace.hopper\n");
    assert_eq!(
        h.stub.call("PATCH", "/_p99/v1/issues/12").json(),
        json!({"assignee": "grace.hopper"})
    );
    let out = h.p99(&["assign", "12", "--none"]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 is assigned to no one\n");
    assert_eq!(
        h.stub.calls("PATCH", "/_p99/v1/issues/12")[1].json(),
        json!({"assignee": null})
    );
    let out = h.p99(&["assign", "12", "me", "--json"]);
    assert_eq!(out.json()["assignee"], json!({"username": "me"}));
    h.p99(&["assign", "12"])
        .clap("the following required arguments were not provided:");
    h.p99(&["assign", "12", "ada", "--none"])
        .clap("the argument '");
}

#[test]
fn assign_to_a_stranger_is_refused_by_the_worker_in_one_line() {
    let h = Home::new("assign-stranger", |req: &Req| {
        if req.under("PATCH", "/_p99/v1/issues/") {
            Reply::problem(422, "@linus is not a member of shop.example.com")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["assign", "12", "@linus"])
        .refused("@linus is not a member of shop.example.com (422)");
}

#[test]
fn edit_sends_only_what_changed_from_flags_stdin_or_a_file() {
    let h = home("edit");
    let out = h.p99(&["edit", "BUG-12", "--title", "Total stays at 0"]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 edited: title\n");
    assert_eq!(
        h.stub.call("PATCH", "/_p99/v1/issues/12").json(),
        json!({"title": "Total stays at 0"})
    );
    let out = h.p99_in(
        &["edit", "12", "--title", "T", "--text", "-"],
        "Details\n\n",
    );
    out.ok();
    assert_eq!(out.stdout, "BUG-12 edited: title and details\n");
    assert_eq!(
        h.stub.calls("PATCH", "/_p99/v1/issues/12")[1].json(),
        json!({"title": "T", "body": "Details"})
    );
    std::fs::write(h.dir.join("details.md"), "From a file\n").unwrap();
    let out = h.p99(&["edit", "12", "--text-file", "details.md", "--json"]);
    out.ok();
    assert_eq!(out.json()["body"], "From a file");
    let out = h.p99_in(&["edit", "12", "--text-file", "-"], "Piped\n");
    out.ok();
    assert_eq!(
        h.stub.calls("PATCH", "/_p99/v1/issues/12")[3].json(),
        json!({"body": "Piped"})
    );
}

#[test]
fn edit_bad_paths_never_send_a_change() {
    let h = home("edit-bad");
    let out = h.p99(&["edit", "12", "--text-file", "gone.md"]);
    assert_eq!(out.code, Some(1));
    assert!(out.stderr.starts_with("p99: gone.md: "), "{}", out.stderr);
    h.p99(&["edit", "12"])
        .clap("the following required arguments were not provided:");
    h.p99(&["edit", "12", "--text", "a", "--text-file", "b"])
        .clap("the argument '");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn download_saves_under_its_own_name_or_the_one_given() {
    let h = home("download");
    let out = h.p99(&["download", "41"]);
    out.ok();
    assert_eq!(out.stdout, "18 bytes saved to notes.txt\n");
    assert_eq!(
        std::fs::read_to_string(h.dir.join("notes.txt")).unwrap(),
        "line one\nline two\n"
    );
    let call = h.stub.call("GET", "/_p99/v1/files/41");
    assert!(call.signed);
    let target = h.dir.join("out.txt");
    let out = h.p99(&["download", "41", "-o", target.to_str().unwrap(), "--json"]);
    out.ok();
    assert_eq!(
        out.json(),
        json!({"id": 41, "name": "notes.txt", "type": "text/plain", "bytes": 18, "path": target.display().to_string()})
    );
    assert!(target.exists());
}

#[test]
fn download_never_writes_outside_the_folder_a_name_points_to() {
    let h = Home::new("download-names", |req: &Req| match req.path.as_str() {
        "/_p99/v1/files/1" => Reply::raw(200, "", b"a").with(
            "content-disposition",
            "attachment; filename*=UTF-8''..%2F..%2Fcaf%C3%A9.txt",
        ),
        "/_p99/v1/files/2" => Reply::raw(200, "application/pdf", b"b"),
        "/_p99/v1/files/3" => Reply::raw(200, "text/plain", b"c")
            .with("content-disposition", "attachment; filename=\"..\""),
        _ => fake::any(req),
    });
    let out = h.p99(&["download", "1", "--json"]);
    out.ok();
    assert_eq!(out.json()["name"], "../../café.txt");
    assert_eq!(out.json()["type"], "application/octet-stream");
    assert_eq!(out.json()["path"], "café.txt");
    assert!(h.dir.join("café.txt").exists());
    assert!(!h.dir.join("../../café.txt").exists());
    assert!(!h.dir.join("../café.txt").exists());
    let out = h.p99(&["download", "2"]);
    out.ok();
    assert_eq!(out.stdout, "1 bytes saved to file-2\n");
    let out = h.p99(&["download", "3"]);
    out.ok();
    assert!(h.dir.join("file-3").exists());
}

#[test]
fn download_of_a_missing_file_and_a_bad_id() {
    let h = Home::new("download-404", |req: &Req| {
        if req.under("GET", "/_p99/v1/files/") {
            Reply::problem(404, "no such file")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["download", "9"]).refused("no such file (404)");
    assert!(!h.dir.join("file-9").exists());
    h.p99(&["download", "nine"])
        .clap("invalid value 'nine' for '<ID>'");
}

#[test]
fn merge_folds_items_into_one_and_names_those_already_there() {
    let h = home("merge");
    let out = h.p99(&[
        "merge",
        "BUG-14",
        "15",
        "--into",
        "BUG-12",
        "--host",
        "shop.example.com",
    ]);
    out.ok();
    assert_eq!(out.stdout, "BUG-14, BUG-15 merged into BUG-12\n");
    let call = h.stub.call("POST", "/_p99/v1/merge");
    assert_eq!(call.param("host"), Some("shop.example.com"));
    assert_eq!(call.json(), json!({"items": ["14", "15"], "into": "12"}));
    let already = Home::new("merge-already", |req: &Req| {
        if req.is("POST", "/_p99/v1/merge") {
            Reply::ok(json!({"into": "BUG-12", "merged": ["BUG-16"], "unchanged": ["BUG-14"]}))
        } else {
            fake::any(req)
        }
    });
    let out = already.p99(&["merge", "14", "16", "--into", "12"]);
    out.ok();
    assert_eq!(
        out.lines(),
        ["BUG-16 merged into BUG-12", "BUG-14 already in BUG-12"]
    );
    let out = already.p99(&["merge", "14", "--into", "12", "--json"]);
    assert_eq!(out.json()["unchanged"], json!(["BUG-14"]));
    already
        .p99(&["merge", "14", "x", "--into", "12"])
        .refused("x is not an item key; try BUG-12 or 12");
    already
        .p99(&["merge", "14", "--into", "nope"])
        .refused("nope is not an item key; try BUG-12 or 12");
    already
        .p99(&["merge", "--into", "12"])
        .clap("the following required arguments were not provided:");
}

#[test]
fn delete_needs_yes_off_a_terminal_and_reports_what_went() {
    let h = home("delete");
    h.p99(&["delete", "BUG-12"])
        .refused("deleting BUG-12 needs --yes when no one is at a terminal to type the key back");
    assert!(h.stub.seen().is_empty());
    let out = h.p99(&["delete", "BUG-12", "--yes"]);
    out.ok();
    assert_eq!(out.stdout, "BUG-12 deleted with 2 comments and 1 file\n");
    assert!(h.stub.call("DELETE", "/_p99/v1/issues/12").signed);
    let out = h.p99(&["delete", "12", "--yes", "--json"]);
    assert_eq!(
        out.json(),
        json!({"key": "BUG-12", "comments": 2, "files": 1, "retrying": 0, "unlinked": []})
    );
    h.p99(&["delete", "x", "--yes"])
        .refused("x is not an item key; try BUG-12 or 12");
}

#[test]
fn delete_names_files_still_going_and_items_that_were_merged_into_it() {
    let h = Home::new("delete-more", |req: &Req| {
        if req.under("DELETE", "/_p99/v1/issues/") {
            Reply::ok(
                json!({"key": "BUG-12", "comments": 1, "files": 3, "retrying": 1, "unlinked": ["BUG-14", "BUG-15"]}),
            )
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["delete", "12", "--yes", "--host", "shop.example.com"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "BUG-12 deleted with 1 comment and 3 files",
            "1 file still being removed from storage; the Worker retries every 15 minutes",
            "BUG-14, BUG-15 were merged into it: unlinked, and back in the inbox",
        ]
    );
    assert_eq!(
        h.stub.call("DELETE", "/_p99/v1/issues/12").param("host"),
        Some("shop.example.com")
    );
}

#[test]
fn an_agent_is_marked_in_every_signed_call() {
    let h = home("agent");
    h.p99(&["list", "--agent"]).ok();
    assert_eq!(h.stub.seen()[0].actor()["agent"], true);
    h.p99_env(&["list"], &[("P99_AGENT", "1")]).ok();
    assert_eq!(h.stub.seen()[1].actor()["agent"], true);
    h.p99_env(&["list"], &[("P99_AGENT", "0")]).ok();
    assert!(h.stub.seen()[2].actor().get("agent").is_none());
}

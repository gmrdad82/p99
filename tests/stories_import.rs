#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use home::{Home, Out};
use stub::{Reply, Req};

const HOST: &str = "shop.example.com";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nreceipt";
const ZONE: &[u8] = b"\x89PNG\r\n\x1a\nzone";

#[derive(Clone, Copy)]
enum Fault {
    Status(u16, Option<&'static str>),
    Drop,
}

#[derive(Default)]
struct Ledger {
    items: BTreeMap<String, String>,
    comments: BTreeSet<String>,
    files: BTreeMap<String, Vec<u8>>,
    rows: BTreeSet<String>,
    coded: BTreeSet<String>,
    calls: BTreeMap<&'static str, usize>,
    trouble: Option<(&'static str, usize, Fault)>,
    finish_conflicts: Vec<Value>,
    finish_answers: Vec<Value>,
    extra_upload: Vec<String>,
    vanish: Option<std::path::PathBuf>,
}

type Shared = Arc<Mutex<Ledger>>;

fn route(req: &Req) -> Option<&'static str> {
    if req.is("POST", "/_p99/v1/import") {
        Some("import")
    } else if req.is("POST", "/_p99/v1/import/finish") {
        Some("finish")
    } else if req.under("PUT", "/_p99/v1/import/attachments/") {
        Some("file")
    } else {
        None
    }
}

fn worker(ledger: &Shared, req: &Req) -> Reply {
    let Some(name) = route(req) else {
        return fake::any(req);
    };
    let mut l = ledger.lock().unwrap();
    let n = {
        let count = l.calls.entry(name).or_default();
        *count += 1;
        *count
    };
    if let Some((at, nth, fault)) = l.trouble
        && at == name
        && nth == n
    {
        return match fault {
            Fault::Drop => Reply::Drop,
            Fault::Status(status, Some(message)) => Reply::problem(status, message),
            Fault::Status(status, None) => Reply::raw(status, "text/plain", b"upstream trouble"),
        };
    }
    match name {
        "import" => records(&mut l, req),
        "file" => {
            let uid = req.tail("/_p99/v1/import/attachments/").to_owned();
            l.files.insert(uid.clone(), req.body.clone());
            Reply::json(
                201,
                json!({
                    "id": l.files.len(),
                    "client_uid": uid,
                    "name": req.param("name"),
                    "type": req.header("content-type"),
                    "bytes": req.body.len(),
                }),
            )
        }
        _ if !l.finish_answers.is_empty() => Reply::ok(l.finish_answers[n - 1].clone()),
        _ => {
            let body = req.json();
            let items = body["items"].as_array().map_or(0, Vec::len);
            let linked = body["duplicates"].as_array().map_or(0, Vec::len);
            Reply::ok(json!({
                "recounted": items,
                "duplicates": {"linked": linked - l.finish_conflicts.len().min(linked), "conflicts": l.finish_conflicts},
            }))
        }
    }
}

fn records(l: &mut Ledger, req: &Req) -> Reply {
    let dry = req.param("dry_run") == Some("1");
    let body = req.json();
    let Some(records) = body.as_array() else {
        return Reply::problem(400, "the body must be an array of at most 500 records");
    };
    let mut counts: BTreeMap<String, Value> = BTreeMap::new();
    let mut upload = Vec::new();
    let mut managers = Vec::new();
    if let Some(path) = l.vanish.take() {
        std::fs::remove_file(path).unwrap();
    }
    for r in records {
        let kind = r["type"].as_str().unwrap_or("").to_owned();
        let tally = counts
            .entry(kind.clone())
            .or_insert_with(|| json!({"new": 0, "existing": 0, "conflicts": []}));
        let mut bump = |field: &str| tally[field] = json!(tally[field].as_u64().unwrap_or(0) + 1);
        let text = |field: &str| r[field].as_str().unwrap_or("").to_owned();
        match kind.as_str() {
            "item" => match l.items.get(&text("key")) {
                Some(title) if *title == text("title") => bump("existing"),
                Some(title) => {
                    let reason =
                        format!("{} already exists with the title \"{title}\"", text("key"));
                    tally["conflicts"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"ref": text("key"), "reason": reason}));
                }
                None => {
                    bump("new");
                    if !dry {
                        l.items.insert(text("key"), text("title"));
                    }
                }
            },
            "comment" => {
                if l.comments.contains(&text("uid")) {
                    bump("existing");
                } else {
                    bump("new");
                    if !dry {
                        l.comments.insert(text("uid"));
                    }
                }
            }
            "attachment" => {
                if l.files.contains_key(&text("uid")) {
                    bump("existing");
                } else {
                    bump("new");
                    upload.push(text("uid"));
                }
            }
            "manager" => {
                if l.coded.contains(&text("email")) {
                    bump("existing");
                } else {
                    bump("new");
                    managers.push(text("email"));
                }
            }
            _ => {
                if l.rows.contains(&r.to_string()) {
                    bump("existing");
                } else {
                    bump("new");
                    if !dry {
                        l.rows.insert(r.to_string());
                    }
                }
            }
        }
    }
    upload.extend(l.extra_upload.iter().cloned());
    Reply::ok(json!({"dry_run": dry, "counts": counts, "upload": upload, "managers": managers}))
}

fn home(name: &str, setup: impl FnOnce(&mut Ledger)) -> (Home, Shared) {
    let mut ledger = Ledger::default();
    setup(&mut ledger);
    let shared: Shared = Arc::new(Mutex::new(ledger));
    let inner = Arc::clone(&shared);
    (Home::new(name, move |req| worker(&inner, req)), shared)
}

fn bundle(h: &Home, lines: &[Value]) {
    let text: Vec<String> = lines.iter().map(Value::to_string).collect();
    write(
        h,
        "bundle.jsonl",
        format!("{}\n", text.join("\n")).as_bytes(),
    );
}

fn write(h: &Home, name: &str, bytes: &[u8]) {
    let path = h.dir.join("bundle").join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

fn import(h: &Home, extra: &[&str]) -> Out {
    let mut args = vec!["import", "bundle", "--host", HOST];
    args.extend_from_slice(extra);
    h.p99(&args)
}

fn shown(path: &str) -> String {
    Path::new("bundle").join(path).display().to_string()
}

fn row(kind: &str, new: u64, existing: u64, conflicts: u64) -> String {
    format!("  {kind:<11} {new:>8} {existing:>9} {conflicts:>10}")
}

fn header() -> String {
    format!(
        "  {:<11} {:>8} {:>9} {:>10}",
        "type", "new", "existing", "conflicts"
    )
}

fn sent_types(h: &Home) -> Vec<String> {
    h.stub
        .calls("POST", "/_p99/v1/import")
        .iter()
        .map(|r| r.json()[0]["type"].as_str().unwrap_or("").to_owned())
        .collect()
}

fn ada() -> Value {
    json!({"email": "ada@example.com", "name": "Ada Lovelace", "agent": false})
}

fn grace() -> Value {
    json!({"email": "grace@example.com", "name": "Grace Hopper", "agent": false, "manager": true})
}

fn item(key: &str, title: &str) -> Value {
    json!({
        "type": "item", "key": key, "kind": "bug", "title": title, "body": "",
        "status": "inbox", "reporter": ada(), "created_at": "2025-03-01T10:00:00Z",
    })
}

fn comment(item: &str, uid: &str, body: &str) -> Value {
    json!({"type": "comment", "item": item, "uid": uid, "author": grace(), "body": body, "created_at": "2025-03-02T09:00:00Z"})
}

fn receipt(uid: &str) -> Value {
    json!({
        "type": "attachment", "item": "BUG-7", "uid": uid, "comment": "c-41", "role": "file", "mark": null,
        "name": null, "content_type": "image/png", "file": "files/receipt.png", "internal": false,
        "created_at": "2025-03-02T09:00:00Z",
    })
}

fn price_mark() -> Value {
    json!({
        "rect": {"x": 40, "y": 120, "w": 220, "h": 48},
        "viewport": {"w": 1280, "h": 800, "scroll_x": 0, "scroll_y": 0, "dpr": 1},
        "elements": [{"selector": "#price", "label": "Price", "text": "12,50 €", "box": {"x": 44, "y": 124, "w": 80, "h": 20}}],
    })
}

fn full(h: &Home) -> Vec<Value> {
    let lines = vec![
        json!({"type": "manager", "email": "emmy@example.com"}),
        json!({
            "type": "item", "key": "BUG-7", "kind": "bug", "title": "The café menu shows the wrong price",
            "body": "The crème brûlée costs 12,50 € on the menu and 13 € at checkout.", "status": "resolved",
            "duplicate_of": null, "reporter": ada(), "assignee": "grace@example.com", "env": "production",
            "page": {"url": "https://shop.example.com/menu", "path": "/menu", "title": "Menu"}, "context": {},
            "marks": [price_mark()], "created_at": "2025-03-01T10:00:00Z", "updated_at": "2025-03-04T08:00:00Z",
            "closed_at": "2025-03-04T08:00:00Z",
        }),
        json!({
            "type": "item", "key": "bug-8", "kind": "bug", "title": "Ștefan's menu price is wrong too", "status": "duplicate",
            "duplicate_of": "BUG-7", "reporter": ada(), "created_at": "2025-03-01T11:00:00Z",
        }),
        comment(
            "BUG-7",
            "c-41",
            "Confirmed, the menu reads an old price list.",
        ),
        receipt("f-12"),
        json!({
            "type": "attachment", "item": "BUG-7", "uid": "f-13", "role": "region", "mark": 0, "name": "zone.png",
            "content_type": "image/png", "file": "./files/zone.png", "internal": true,
        }),
        json!({
            "type": "event", "item": "BUG-7", "actor": {"email": "grace@example.com", "agent": true, "via": "pci"},
            "kind": "status", "detail": {"from": "confirmed", "to": "resolved"}, "at": "2025-03-04T08:00:00Z",
        }),
        json!({"type": "landing", "item": "BUG-7", "env": "production", "sha": "4f1c2a9e0b7d", "at": "2025-03-04T07:30:00Z"}),
        json!({"type": "read", "item": "BUG-7", "email": "ada@example.com", "at": "2025-03-04T09:00:00Z"}),
        json!({"type": "manager", "email": "grace@example.com"}),
    ];
    bundle(h, &lines);
    write(h, "files/receipt.png", PNG);
    write(h, "files/zone.png", ZONE);
    lines
}

#[test]
fn an_import_sends_each_type_in_order_keeps_keys_and_text_and_uploads_every_file() {
    let (h, ledger) = home("import-full", |l| {
        l.coded.insert("grace@example.com".to_owned());
    });
    let lines = full(&h);
    let out = import(&h, &[]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "item: 2 of 2 sent".to_owned(),
            "comment: 1 of 1 sent".to_owned(),
            "attachment: 2 of 2 sent".to_owned(),
            "event: 1 of 1 sent".to_owned(),
            "landing: 1 of 1 sent".to_owned(),
            "read: 1 of 1 sent".to_owned(),
            "manager: 2 of 2 sent".to_owned(),
            "shop.example.com: 10 records imported".to_owned(),
            header(),
            row("item", 2, 0, 0),
            row("comment", 1, 0, 0),
            row("attachment", 2, 0, 0),
            row("event", 1, 0, 0),
            row("landing", 1, 0, 0),
            row("read", 1, 0, 0),
            row("manager", 1, 1, 0),
            "  files uploaded: 2".to_owned(),
            "  items recounted: 2, duplicates linked: 1".to_owned(),
            "these managers have no manager code yet; mint one each, or list them in MANAGERS:"
                .to_owned(),
            "  p99 invite shop.example.com --manager --name \"<name>\" --email emmy@example.com"
                .to_owned(),
        ]
    );
    assert_eq!(
        sent_types(&h),
        [
            "item",
            "comment",
            "attachment",
            "event",
            "landing",
            "read",
            "manager"
        ]
    );
    let posts = h.stub.calls("POST", "/_p99/v1/import");
    for post in &posts {
        assert!(post.signed, "{}", post.target);
        assert_eq!(post.param("host"), Some(HOST));
        assert_eq!(post.param("dry_run"), Some("0"));
    }
    assert_eq!(posts[0].json(), json!([lines[1], lines[2]]));
    assert_eq!(
        posts[0].json()[0]["title"],
        "The café menu shows the wrong price"
    );
    assert_eq!(posts[0].json()[0]["status"], "resolved");
    assert_eq!(posts[0].json()[1]["key"], "bug-8");

    let puts = h.stub.under("PUT", "/_p99/v1/import/attachments/");
    assert_eq!(puts.len(), 2);
    let file = &puts[0];
    assert_eq!(file.tail("/_p99/v1/import/attachments/"), "f-12");
    assert!(file.signed);
    assert_eq!(file.header("content-type"), Some("image/png"));
    assert_eq!(file.body, PNG);
    assert_eq!(file.param("item"), Some("BUG-7"));
    assert_eq!(file.param("comment"), Some("c-41"));
    assert_eq!(file.param("role"), Some("file"));
    assert_eq!(file.param("name"), Some("receipt.png"));
    assert_eq!(file.param("internal"), Some("0"));
    assert_eq!(file.param("created_at"), Some("2025-03-02T09:00:00Z"));
    assert_eq!(file.param("mark"), None);
    let zone = &puts[1];
    assert_eq!(zone.tail("/_p99/v1/import/attachments/"), "f-13");
    assert_eq!(zone.body, ZONE);
    assert_eq!(zone.param("role"), Some("region"));
    assert_eq!(zone.param("mark"), Some("0"));
    assert_eq!(posts[0].json()[0]["marks"], json!([price_mark()]));
    assert_eq!(zone.param("name"), Some("zone.png"));
    assert_eq!(zone.param("internal"), Some("1"));
    assert_eq!(zone.param("comment"), None);
    assert_eq!(zone.param("created_at"), None);

    let finish = h.stub.call("POST", "/_p99/v1/import/finish");
    assert!(finish.signed);
    assert_eq!(finish.param("host"), Some(HOST));
    assert_eq!(
        finish.json(),
        json!({"items": ["BUG-7", "bug-8"], "duplicates": [{"item": "bug-8", "duplicate_of": "BUG-7"}]})
    );
    let l = ledger.lock().unwrap();
    assert_eq!(l.files["f-12"], PNG);
    assert_eq!(l.items.len(), 2);
    assert_eq!(l.rows.len(), 3);
}

#[test]
fn a_dry_run_asks_the_worker_uploads_nothing_and_never_finishes() {
    let (h, ledger) = home("import-dry", |_| {});
    full(&h);
    let out = import(&h, &["--dry-run"]);
    out.ok();
    let lines = out.lines();
    assert!(
        lines.contains(&"shop.example.com: 10 records checked, nothing written (dry run)"),
        "{}",
        out.stdout
    );
    assert!(lines.contains(&row("attachment", 2, 0, 0).as_str()));
    assert!(!out.stdout.contains("files uploaded"), "{}", out.stdout);
    assert!(!out.stdout.contains("items recounted"), "{}", out.stdout);
    for post in h.stub.calls("POST", "/_p99/v1/import") {
        assert_eq!(post.param("dry_run"), Some("1"));
    }
    assert!(h.stub.under("PUT", "/_p99/v1/import/").is_empty());
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
    let l = ledger.lock().unwrap();
    assert!(l.items.is_empty() && l.files.is_empty() && l.rows.is_empty());
}

#[test]
fn json_answers_the_summary_on_stdout_and_the_progress_on_stderr() {
    let (h, _) = home("import-json", |_| {});
    full(&h);
    let out = import(&h, &["--json"]);
    out.ok();
    let summary = out.json();
    assert_eq!(summary["host"], HOST);
    assert_eq!(summary["dry_run"], false);
    assert_eq!(summary["records"], 10);
    assert_eq!(summary["uploaded"], 2);
    assert_eq!(summary["counts"]["item"]["new"], 2);
    assert_eq!(summary["counts"]["manager"]["new"], 2);
    assert_eq!(
        summary["managers"],
        json!(["emmy@example.com", "grace@example.com"])
    );
    assert_eq!(summary["finish"]["recounted"], 2);
    assert_eq!(summary["finish"]["duplicates"]["linked"], 1);
    assert!(out.stderr.contains("item: 2 of 2 sent\n"), "{}", out.stderr);
    assert!(
        out.stderr.contains("manager: 2 of 2 sent\n"),
        "{}",
        out.stderr
    );
}

#[test]
fn a_bundle_with_windows_line_ends_blank_lines_and_current_statuses_reads_the_same() {
    let (h, _) = home("import-crlf", |_| {});
    let lines = [
        json!({"type": "item", "key": "FEAT-3", "kind": "feature", "title": "Dark mode", "status": "doing", "reporter": ada(), "created_at": "2025-03-01T10:00:00Z"}),
        json!({"type": "item", "key": "TASK-4", "kind": "task", "title": "Tidy", "status": "done", "resolution": "abandoned", "reporter": ada(), "created_at": "2025-03-01"}),
        json!({"type": "item", "key": "Q-5", "kind": "question", "title": "Why?", "status": "review", "reporter": ada(), "created_at": "2025-03-01T10:00:00+02:00"}),
    ];
    let text: Vec<String> = lines.iter().map(Value::to_string).collect();
    write(
        &h,
        "bundle.jsonl",
        format!("{}\r\n\r\n{}\r\n   \r\n{}\r\n", text[0], text[1], text[2]).as_bytes(),
    );
    let out = h.p99(&["import", "bundle", "--host", " SHOP.Example.com "]);
    out.ok();
    assert!(
        out.lines()
            .contains(&"shop.example.com: 3 records imported"),
        "{}",
        out.stdout
    );
    let post = h.stub.call("POST", "/_p99/v1/import");
    assert_eq!(post.param("host"), Some(HOST));
    assert_eq!(post.json(), json!(lines));
}

#[test]
fn a_resumed_import_keeps_what_landed_and_sends_only_the_missing_file() {
    let (h, ledger) = home("import-resume", |l| {
        l.trouble = Some(("file", 1, Fault::Status(503, None)));
    });
    bundle(
        &h,
        &[
            item("BUG-7", "The café menu shows the wrong price"),
            comment("BUG-7", "c-41", "Seen."),
            receipt("f-12"),
        ],
    );
    write(&h, "files/receipt.png", PNG);

    let first = import(&h, &[]);
    first.refused(&format!(
        "line 3: {}: the Worker answered 503",
        shown("files/receipt.png")
    ));
    assert!(
        first.stdout.contains("comment: 1 of 1 sent\n"),
        "{}",
        first.stdout
    );
    assert!(
        !first.stdout.contains("attachment: 1 of 1 sent"),
        "{}",
        first.stdout
    );
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
    assert!(ledger.lock().unwrap().files.is_empty());

    let second = import(&h, &[]);
    second.ok();
    let lines = second.lines();
    for expected in [
        row("item", 0, 1, 0),
        row("comment", 0, 1, 0),
        row("attachment", 1, 0, 0),
        "  files uploaded: 1".to_owned(),
        "  items recounted: 1, duplicates linked: 0".to_owned(),
    ] {
        assert!(
            lines.contains(&expected.as_str()),
            "{expected}\n{}",
            second.stdout
        );
    }
    assert_eq!(ledger.lock().unwrap().files["f-12"], PNG);
    assert_eq!(h.stub.under("PUT", "/_p99/v1/import/attachments/").len(), 2);

    let third = import(&h, &[]);
    third.ok();
    assert!(third.lines().contains(&row("attachment", 0, 1, 0).as_str()));
    assert!(third.lines().contains(&"  files uploaded: 0"));
    assert_eq!(h.stub.under("PUT", "/_p99/v1/import/attachments/").len(), 2);
    assert_eq!(h.stub.calls("POST", "/_p99/v1/import/finish").len(), 2);
}

#[test]
fn a_worker_refusal_part_way_names_the_bundle_line_of_the_record_and_stops() {
    let (h, _) = home("import-refused", |l| {
        l.trouble = Some((
            "import",
            3,
            Fault::Status(
                400,
                Some("record 1 (comment): body must be 1 to 20000 characters"),
            ),
        ));
    });
    let mut lines = vec![item("BUG-7", "Many comments")];
    lines.extend((1..=201).map(|n| comment("BUG-7", &format!("c-{n}"), "Seen.")));
    lines.push(json!({"type": "read", "item": "BUG-7", "email": "ada@example.com", "at": "2025-03-04T09:00:00Z"}));
    bundle(&h, &lines);
    let out = import(&h, &[]);
    out.refused("line 202: record 1 (comment): body must be 1 to 20000 characters (400)");
    assert_eq!(
        out.lines(),
        ["item: 1 of 1 sent", "comment: 200 of 201 sent"]
    );
    let posts = h.stub.calls("POST", "/_p99/v1/import");
    assert_eq!(posts.len(), 3);
    assert_eq!(posts[1].json().as_array().unwrap().len(), 200);
    assert_eq!(posts[2].json()[0]["uid"], "c-201");
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
}

#[test]
fn a_worker_refusal_without_a_record_keeps_its_own_words() {
    let (h, _) = home("import-403", |l| {
        l.trouble = Some((
            "import",
            1,
            Fault::Status(403, Some("only the account's key imports")),
        ));
    });
    bundle(&h, &[item("BUG-7", "One")]);
    import(&h, &[]).refused("only the account's key imports (403)");
}

#[test]
fn a_worker_5xx_part_way_stops_with_its_status_and_never_finishes() {
    let (h, ledger) = home("import-500", |l| {
        l.trouble = Some(("import", 2, Fault::Status(500, None)));
    });
    bundle(
        &h,
        &[item("BUG-7", "One"), comment("BUG-7", "c-1", "Seen.")],
    );
    let out = import(&h, &[]);
    out.refused("the Worker answered 500");
    assert_eq!(out.lines(), ["item: 1 of 1 sent"]);
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
    assert_eq!(ledger.lock().unwrap().items.len(), 1);
}

#[test]
fn a_dropped_connection_part_way_is_one_line_and_never_finishes() {
    let (h, _) = home("import-drop", |l| {
        l.trouble = Some(("import", 2, Fault::Drop));
    });
    bundle(
        &h,
        &[item("BUG-7", "One"), comment("BUG-7", "c-1", "Seen.")],
    );
    let out = import(&h, &[]);
    out.dropped(&format!("cannot reach {}", h.stub.worker()));
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
}

#[test]
fn a_dropped_connection_at_the_finish_is_one_line_after_every_record_landed() {
    let (h, ledger) = home("import-drop-finish", |l| {
        l.trouble = Some(("finish", 1, Fault::Drop));
    });
    bundle(&h, &[item("BUG-7", "One")]);
    let out = import(&h, &[]);
    out.dropped(&format!("cannot reach {}", h.stub.worker()));
    assert_eq!(ledger.lock().unwrap().items.len(), 1);
}

#[test]
fn a_file_the_worker_refuses_names_its_line_and_path() {
    let (h, _) = home("import-file-413", |l| {
        l.trouble = Some((
            "file",
            1,
            Fault::Status(413, Some("a file may be at most 20 MB")),
        ));
    });
    bundle(
        &h,
        &[
            item("BUG-7", "One"),
            comment("BUG-7", "c-41", "Seen."),
            receipt("f-12"),
        ],
    );
    write(&h, "files/receipt.png", PNG);
    import(&h, &[]).refused(&format!(
        "line 3: {}: a file may be at most 20 MB (413)",
        shown("files/receipt.png")
    ));
}

#[test]
fn conflicts_are_listed_by_type_and_the_import_exits_1() {
    let (h, _) = home("import-conflicts", |l| {
        l.items.insert("BUG-7".to_owned(), "Old title".to_owned());
        l.finish_conflicts = vec![json!({"ref": "9", "reason": "duplicate_of names no item 99"})];
    });
    let mut dup = item("BUG-9", "Copy");
    dup["duplicate_of"] = json!("BUG-99");
    bundle(&h, &[item("BUG-7", "New title"), dup]);
    let out = import(&h, &[]);
    out.refused("2 records were left as they are; see the conflicts");
    let lines = out.lines();
    let at = lines
        .iter()
        .position(|l| *l == "conflicts:")
        .expect("a conflicts block");
    assert_eq!(
        lines[at + 1..],
        [
            "  item BUG-7: BUG-7 already exists with the title \"Old title\"",
            "  duplicate_of 9: duplicate_of names no item 99",
        ]
    );
    assert!(
        lines.contains(&row("item", 1, 0, 1).as_str()),
        "{}",
        out.stdout
    );
    assert!(lines.contains(&"  items recounted: 2, duplicates linked: 0"));
}

#[test]
fn a_malformed_bundle_is_refused_whole_with_every_line_and_nothing_is_sent() {
    let (h, _) = home("import-malformed", |_| {});
    let lines = [
        item("BUG-7", "One").to_string(),
        "{not json".to_owned(),
        item("BUG-7", "Again").to_string(),
        json!({"type": "item", "key": "FEAT-8", "kind": "bug", "title": "x", "reporter": ada(), "created_at": "2025-03-01"}).to_string(),
        json!({"type": "attachment", "item": "BUG-7", "uid": "f-1", "content_type": "image/png", "file": "../outside.png"}).to_string(),
        json!({"type": "attachment", "item": "BUG-7", "uid": "f-2", "content_type": "image/png", "file": "files/empty.png"}).to_string(),
        comment("BUG-7", "c-1", "Seen.").to_string(),
        comment("BUG-7", "c-1", "Seen twice.").to_string(),
        json!({"type": "ticket"}).to_string(),
        json!({"type": "attachment", "item": "BUG-7", "uid": "f-3", "content_type": "image/png", "file": "files/missing.png"}).to_string(),
    ];
    write(&h, "bundle.jsonl", lines.join("\n").as_bytes());
    write(&h, "files/empty.png", b"");
    let out = import(&h, &[]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(out.stdout.is_empty(), "{}", out.stdout);
    let said: Vec<&str> = out.stderr.lines().collect();
    assert_eq!(
        said[..9],
        [
            format!(
                "p99: {} has 8 problems; nothing was sent",
                shown("bundle.jsonl")
            ),
            said[1].to_owned(),
            "line 3: item: number 7 is already taken on line 1".to_owned(),
            "line 4: item: a bug is keyed BUG-<number>".to_owned(),
            "line 5: attachment: file must be a path inside the bundle directory: ../outside.png"
                .to_owned(),
            format!(
                "line 6: attachment: {} must hold 1 byte to 20 MB",
                shown("files/empty.png")
            ),
            "line 8: comment: uid c-1 is already used on line 7".to_owned(),
            "line 9: type must be one of item, comment, attachment, event, landing, read, manager"
                .to_owned(),
            said[8].to_owned(),
        ]
    );
    assert!(said[1].starts_with("line 2: not JSON: "), "{}", said[1]);
    assert!(
        said[8].starts_with(&format!(
            "line 10: attachment: {}: ",
            shown("files/missing.png")
        )),
        "{}",
        said[8]
    );
    assert_eq!(said.len(), 9, "{}", out.stderr);
    assert!(h.stub.under("POST", "/_p99/v1/import").is_empty());
    assert!(h.stub.under("PUT", "/_p99/v1/import").is_empty());
}

#[test]
fn a_bundle_directory_without_its_jsonl_is_one_line() {
    let (h, _) = home("import-missing", |_| {});
    std::fs::create_dir_all(h.dir.join("bundle")).unwrap();
    let out = import(&h, &[]);
    out.dropped(&shown("bundle.jsonl"));
    assert!(h.stub.seen().is_empty());
}

#[test]
fn an_empty_bundle_sends_no_records_and_finishes_with_no_items() {
    let (h, _) = home("import-empty", |_| {});
    write(&h, "bundle.jsonl", b"\n\n");
    let out = import(&h, &[]);
    out.ok();
    assert_eq!(
        out.lines()[..2],
        ["shop.example.com: 0 records imported".to_owned(), header()]
    );
    assert!(h.stub.calls("POST", "/_p99/v1/import").is_empty());
    assert_eq!(
        h.stub.call("POST", "/_p99/v1/import/finish").json(),
        json!({"items": [], "duplicates": []})
    );
}

#[test]
fn import_without_a_host_is_a_usage_error() {
    let (h, _) = home("import-usage", |_| {});
    h.p99(&["import", "bundle"])
        .clap("the following required arguments were not provided");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn more_than_5000_items_finish_in_chunks_with_the_duplicates_once_and_the_answers_summed() {
    let (h, _) = home("import-finish-chunks", |l| {
        l.finish_answers = vec![
            json!({"recounted": 5000, "duplicates": {"linked": 1, "conflicts": [{"ref": "5001", "reason": "duplicate_of names no item 9999"}]}}),
            json!({"recounted": 1, "duplicates": {"linked": 2, "conflicts": [{"ref": "77", "reason": "no item 77 on shop.example.com"}]}}),
        ];
    });
    let mut lines: Vec<Value> = (1..=5000)
        .map(|n| item(&format!("BUG-{n}"), "Many"))
        .collect();
    let mut dup = item("BUG-5001", "Copy");
    dup["duplicate_of"] = json!("BUG-1");
    lines.push(dup);
    bundle(&h, &lines);
    let out = import(&h, &[]);
    out.refused("2 records were left as they are; see the conflicts");
    assert_eq!(h.stub.calls("POST", "/_p99/v1/import").len(), 26);
    let finishes = h.stub.calls("POST", "/_p99/v1/import/finish");
    assert_eq!(finishes.len(), 2);
    let first = finishes[0].json();
    let second = finishes[1].json();
    assert_eq!(first["items"].as_array().unwrap().len(), 5000);
    assert_eq!(first["items"][0], "BUG-1");
    assert_eq!(first["items"][4999], "BUG-5000");
    assert_eq!(second["items"], json!(["BUG-5001"]));
    assert_eq!(
        first["duplicates"],
        json!([{"item": "BUG-5001", "duplicate_of": "BUG-1"}])
    );
    assert_eq!(second["duplicates"], json!([]));
    let lines = out.lines();
    assert!(
        lines.contains(&"  items recounted: 5001, duplicates linked: 3"),
        "{}",
        out.stdout
    );
    let at = lines
        .iter()
        .position(|l| *l == "conflicts:")
        .expect("a conflicts block");
    assert_eq!(
        lines[at + 1..],
        [
            "  duplicate_of 5001: duplicate_of names no item 9999",
            "  duplicate_of 77: no item 77 on shop.example.com",
        ]
    );
}

#[test]
fn json_with_conflicts_prints_the_summary_and_still_exits_1() {
    let (h, _) = home("import-json-conflicts", |l| {
        l.items.insert("BUG-7".to_owned(), "Old title".to_owned());
    });
    bundle(&h, &[item("BUG-7", "New title")]);
    let out = import(&h, &["--json"]);
    out.refused("1 records were left as they are; see the conflicts");
    let summary: Value = serde_json::from_str(&out.stdout).unwrap();
    assert_eq!(summary["counts"]["item"]["new"], 0);
    assert_eq!(
        summary["counts"]["item"]["conflicts"],
        json!([{"ref": "BUG-7", "reason": "BUG-7 already exists with the title \"Old title\""}])
    );
    assert_eq!(summary["finish"]["recounted"], 1);
    assert!(!out.stdout.contains("conflicts:\n"), "{}", out.stdout);
}

#[test]
fn a_dry_run_in_json_has_no_finish_and_no_uploads() {
    let (h, _) = home("import-dry-json", |_| {});
    full(&h);
    let out = import(&h, &["--dry-run", "--json"]);
    out.ok();
    let summary = out.json();
    assert_eq!(summary["dry_run"], true);
    assert_eq!(summary["records"], 10);
    assert_eq!(summary["uploaded"], 0);
    assert_eq!(summary["finish"], Value::Null);
    assert_eq!(summary["counts"]["attachment"]["new"], 2);
    assert!(h.stub.under("PUT", "/_p99/v1/import/").is_empty());
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
}

#[test]
fn a_finish_the_worker_refuses_keeps_its_words_and_status() {
    let (h, ledger) = home("import-finish-409", |l| {
        l.trouble = Some((
            "finish",
            1,
            Fault::Status(400, Some("items must list at most 5000 keys")),
        ));
    });
    bundle(&h, &[item("BUG-7", "One")]);
    let out = import(&h, &[]);
    out.refused("items must list at most 5000 keys (400)");
    assert_eq!(out.lines(), ["item: 1 of 1 sent"]);
    assert_eq!(ledger.lock().unwrap().items.len(), 1);
}

#[test]
fn a_finish_answered_5xx_stops_with_its_status() {
    let (h, _) = home("import-finish-502", |l| {
        l.trouble = Some(("finish", 1, Fault::Status(502, None)));
    });
    bundle(&h, &[item("BUG-7", "One")]);
    import(&h, &[]).refused("the Worker answered 502");
}

#[test]
fn an_upload_uid_the_bundle_does_not_hold_is_skipped_and_not_counted() {
    let (h, _) = home("import-extra-upload", |l| {
        l.extra_upload = vec!["f-unknown".to_owned()];
    });
    bundle(
        &h,
        &[
            item("BUG-7", "One"),
            comment("BUG-7", "c-41", "Seen."),
            receipt("f-12"),
        ],
    );
    write(&h, "files/receipt.png", PNG);
    let out = import(&h, &[]);
    out.ok();
    assert!(
        out.lines().contains(&"  files uploaded: 1"),
        "{}",
        out.stdout
    );
    let puts = h.stub.under("PUT", "/_p99/v1/import/attachments/");
    assert_eq!(puts.len(), 1);
    assert_eq!(puts[0].tail("/_p99/v1/import/attachments/"), "f-12");
}

#[test]
fn a_file_gone_after_the_check_names_its_line_and_path_and_never_finishes() {
    let (h, ledger) = home("import-file-gone", |_| {});
    let path = h.dir.join("bundle").join("files").join("receipt.png");
    bundle(
        &h,
        &[
            item("BUG-7", "One"),
            comment("BUG-7", "c-41", "Seen."),
            receipt("f-12"),
        ],
    );
    write(&h, "files/receipt.png", PNG);
    ledger.lock().unwrap().vanish = Some(path.clone());
    let out = import(&h, &[]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    let said = format!("p99: {}: ", shown("files/receipt.png"));
    assert!(
        out.stderr.lines().any(|l| l.starts_with(&said)),
        "{}",
        out.stderr
    );
    assert!(!path.exists());
    assert!(h.stub.under("PUT", "/_p99/v1/import/").is_empty());
    assert!(h.stub.calls("POST", "/_p99/v1/import/finish").is_empty());
}

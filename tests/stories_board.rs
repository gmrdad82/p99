use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};

#[derive(Debug, Clone)]
struct Seen {
    method: String,
    path: String,
    actor: Value,
    body: Value,
}

type Answer = fn(&str, &str, &Value) -> (u16, String);

struct Worker {
    url: String,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Worker {
    fn start(answer: Answer) -> Worker {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/_p99", listener.local_addr().unwrap());
        let seen: Arc<Mutex<Vec<Seen>>> = Arc::default();
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or_default().to_owned();
                let path = parts.next().unwrap_or_default().to_owned();
                let mut length = 0;
                let mut actor = Value::Null;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    let (k, v) = header.split_once(':').unwrap_or_default();
                    if k.eq_ignore_ascii_case("content-length") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                    if k.eq_ignore_ascii_case("x-p99-actor") {
                        let bytes = URL_SAFE_NO_PAD.decode(v.trim()).unwrap();
                        actor = serde_json::from_slice(&bytes).unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let path = path.strip_prefix("/_p99").unwrap_or(&path).to_owned();
                let (status, reply) = answer(&method, &path, &body);
                log.lock().unwrap().push(Seen {
                    method,
                    path,
                    actor,
                    body,
                });
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        Worker { url, seen }
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }

    fn last(&self) -> Seen {
        self.seen().pop().expect("the CLI asked the Worker")
    }
}

fn config(name: &str, url: &str) -> PathBuf {
    config_with(name, url, "", "")
}

fn config_with(name: &str, url: &str, me: &str, account: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join("stories_board")
        .join(name);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("config.toml");
    std::fs::write(
        &file,
        format!(
            "[me]\nname = \"Ada Lovelace\"\nemail = \"ada@example.com\"\n{me}\n[accounts.main]\naccount_id = \"a1\"\ntoken = \"t\"\nkey = \"k\"\nurl = \"{url}\"\n{account}\n[hosts.\"shop.example.com\"]\naccount = \"main\"\nenv = \"production\"\n"
        ),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    file
}

struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn p99(config: &PathBuf, args: &[&str], env: &[(&str, &str)], stdin: Option<&str>) -> Run {
    let mut command = Command::new(env!("CARGO_BIN_EXE_p99"));
    command
        .args(args)
        .env("P99_CONFIG", config)
        .env("NO_COLOR", "1")
        .env_remove("P99_AGENT")
        .env_remove("P99_TOKEN")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        command.env(k, v);
    }
    let mut child = command.spawn().unwrap();
    if let Some(text) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
    let Output {
        status,
        stdout,
        stderr,
    } = child.wait_with_output().unwrap();
    Run {
        code: status.code(),
        stdout: String::from_utf8(stdout).unwrap(),
        stderr: String::from_utf8(stderr).unwrap(),
    }
}

fn run(worker: &Worker, name: &str, args: &[&str]) -> Run {
    p99(&config(name, &worker.url), args, &[], None)
}

fn json_of(run: &Run) -> Value {
    assert_eq!(run.code, Some(0), "{}", run.stderr);
    serde_json::from_str(&run.stdout).expect("exactly one JSON document")
}

fn refused(run: &Run, line: &str) {
    assert_eq!(run.code, Some(1), "{}", run.stderr);
    assert_eq!(run.stderr, format!("p99: {line}\n"));
    assert!(run.stdout.is_empty(), "{}", run.stdout);
}

fn unparsed(args: &[&str], first: &str, usage: Option<&str>) {
    for json in [false, true] {
        let mut all: Vec<&str> = args.to_vec();
        if json {
            all.push("--json");
        }
        let run = p99(
            &config("unparsed", "http://127.0.0.1:9/_p99"),
            &all,
            &[],
            None,
        );
        assert_eq!(run.code, Some(2), "{all:?}: {}", run.stderr);
        assert!(run.stdout.is_empty(), "{all:?}");
        assert!(run.stderr.starts_with(first), "{all:?}: {}", run.stderr);
        let line = run
            .stderr
            .split("\n\n")
            .find(|part| part.starts_with("Usage: "));
        match usage {
            Some(usage) => assert!(
                line.is_some_and(|line| line.starts_with(usage) && !line.contains('\n')),
                "{all:?}: {}",
                run.stderr
            ),
            None => assert!(line.is_none(), "{all:?}: {}", run.stderr),
        }
        assert!(
            run.stderr
                .ends_with("\n\nFor more information, try '--help'.\n")
        );
    }
}

const LANES: [(&str, &str); 7] = [
    ("new", "New"),
    ("planned", "Planned"),
    ("in-progress", "In progress"),
    ("needs-you", "Needs you"),
    ("stuck", "Stuck"),
    ("landed", "Landed"),
    ("done", "Done"),
];

fn lanes() -> Value {
    Value::Array(
        LANES
            .iter()
            .map(|(word, label)| json!({"word": word, "label": label, "closes": *word == "done"}))
            .collect(),
    )
}

fn board_card(key: &str, status: &str, project: Value, title: &str) -> Value {
    let label = LANES.iter().find(|(w, _)| *w == status).unwrap().1;
    json!({"key": key, "kind": "feature", "project": project, "status": status, "label": label,
        "lane": if status == "done" { Value::Null } else { json!(1) }, "title": title,
        "host": "shop.example.com", "assignee": null, "order": "a0",
        "changed_at": "2026-10-22T09:12:00.000Z",
        "changed_by": {"name": "Ada Lovelace", "username": "ada", "agent": false, "via": null}})
}

fn the_board() -> Value {
    json!({"board": {"lanes": lanes()}, "cards": [
        board_card("BUG-12", "new", Value::Null, "Broken button"),
        board_card("FEAT-41", "needs-you", json!("Splicer"), "Export keeps every audio track"),
        board_card("FEAT-40", "needs-you", json!("Paper"), "Print margins"),
        board_card("FEAT-7", "landed", json!("Splicer"), "Clip rail"),
    ]})
}

fn old_boards() -> Value {
    let mut all = the_board();
    all["deprecated"] = json!("one board per account since 1.11; read /board");
    all["archived"] = json!([
        {"id": 2, "name": "Web", "owner": {"username": "ada"}, "columns": [
            {"label": "Inbox", "closes": false}, {"label": "QA ready", "closes": false}, {"label": "Done", "closes": true}],
         "cards": [{"key": "BUG-12", "kind": "bug", "title": "Broken button", "label": "Inbox"}], "archived": true},
        {"id": 3, "name": "Ops", "owner": {"username": "grace"}, "columns": [], "cards": [], "archived": true}
    ]);
    all
}

fn labels() -> Value {
    Value::Array(
        [0, 2, 5, 6, 3, 1, 4]
            .iter()
            .map(|&i| {
                let (word, label) = LANES[i];
                json!({"id": 10 + i, "name": label, "closes": word == "done", "boards": []})
            })
            .collect(),
    )
}

fn old_labels() -> Value {
    Value::Array(
        ["Inbox", "Doing", "Review", "Done", "QA", "Ops", "Web"]
            .iter()
            .enumerate()
            .map(|(i, name)| json!({"id": 20 + i, "name": name, "closes": *name == "Done", "boards": []}))
            .collect(),
    )
}

fn renamed_board() -> Value {
    let mut board = the_board();
    board["board"]["lanes"][3]["label"] = json!("Waiting on me");
    board["board"]["lanes"].as_array_mut().unwrap().pop();
    let mut stray = board_card("FEAT-9", "done", json!("Splicer"), "Old export");
    stray["label"] = json!("Shipped");
    board["cards"][1]["label"] = json!("Waiting on me");
    board["cards"].as_array_mut().unwrap().push(stray);
    board
}

fn answers(method: &str, path: &str, body: &Value) -> (u16, String) {
    let route = path.split('?').next().unwrap_or(path);
    let reply = match (method, route) {
        ("GET", "/v1/board") if path.contains("project=Locked") => {
            return (403, r#"{"message":"only an Owner reads the board"}"#.into());
        }
        ("GET", "/v1/board") if path.contains("project=Renamed") => renamed_board(),
        ("GET", "/v1/board") if path.contains("project=Empty") => {
            json!({"board": {"lanes": []}, "cards": []})
        }
        ("GET", "/v1/board") => the_board(),
        ("GET", "/v1/boards") => old_boards(),
        ("POST", "/v1/boards") | ("PUT", "/v1/boards/2") | ("DELETE", "/v1/boards/2") => {
            return (
                410,
                r#"{"message":"boards are one per account; see p99 board"}"#.into(),
            );
        }
        ("GET", "/v1/issues/41") => {
            json!({"issue":{"id":41,"key":"FEAT-41","kind":"feature","title":"Export keeps every audio track","label":"In progress"},"comments":[],"events":[]})
        }
        ("GET", "/v1/issues/42") => {
            json!({"issue":{"id":42,"key":"FEAT-42","kind":"feature","title":"Moved meanwhile","label":"Landed"},"comments":[],"events":[]})
        }
        ("GET", "/v1/issues/43") => {
            json!({"issue":{"id":43,"key":"FEAT-43","kind":"feature","title":"Moved meanwhile","label":"Needs you"},"comments":[],"events":[]})
        }
        ("POST", "/v1/move") if body["key"] == "42" || body["key"] == "43" => {
            return (409, r#"{"message":"the card moved"}"#.into());
        }
        ("POST", "/v1/move") if body["to"] == "Shipped" => {
            return (404, r#"{"message":"no lane is called Shipped"}"#.into());
        }
        ("POST", "/v1/move") => {
            let to = body["to"].as_str().unwrap_or_default();
            let label = LANES
                .iter()
                .find(|(w, l)| *w == to || l.eq_ignore_ascii_case(to))
                .map_or(to, |(_, l)| l);
            json!({"card": {"key": "FEAT-41", "kind": "feature", "title": "Export keeps every audio track", "label": label, "order": "a1"}})
        }
        ("GET", "/v1/labels") => json!({"labels": labels()}),
        ("PATCH", "/v1/labels/13") => {
            json!({"id": 13, "name": body["name"], "closes": false, "boards": []})
        }
        _ => return (404, r#"{"message":"no such route"}"#.into()),
    };
    (200, reply.to_string())
}

fn old_worker(method: &str, path: &str, body: &Value) -> (u16, String) {
    let route = path.split('?').next().unwrap_or(path);
    let reply = match (method, route) {
        ("GET", "/v1/boards") => {
            json!({"boards": [{"id": 2, "name": "Web", "mine": true, "columns": []}]})
        }
        ("GET", "/v1/labels") => json!({"labels": old_labels()}),
        ("PATCH", "/v1/labels/23") => {
            json!({"id": 23, "name": body["name"], "closes": true, "boards": []})
        }
        ("GET", "/v1/issues/41") => {
            json!({"issue":{"id":41,"key":"FEAT-41","kind":"feature","title":"Export keeps every audio track","label":"Doing"},"comments":[],"events":[]})
        }
        ("POST", "/v1/move") => {
            return (400, r#"{"message":"name a board to move on"}"#.into());
        }
        _ => return (404, r#"{"message":"no such route"}"#.into()),
    };
    (200, reply.to_string())
}

#[test]
fn every_board_form_that_does_not_parse_is_claps_with_exit_2() {
    unparsed(
        &["board", "Web"],
        "error: unexpected argument 'Web' found\n",
        Some("Usage: p99 board "),
    );
    unparsed(
        &["board", "--project"],
        "error: a value is required for '--project <name>' but none was supplied\n",
        None,
    );
    unparsed(
        &["boards", "set", "Web"],
        "error: the following required arguments were not provided:\n  --columns <labels>\n",
        Some("Usage: p99 boards set "),
    );
    unparsed(
        &["move", "FEAT-41"],
        "error: the following required arguments were not provided:\n  --to <lane>\n",
        Some("Usage: p99 move "),
    );
    unparsed(
        &[
            "move", "FEAT-41", "--to", "new", "--before", "BUG-12", "--after", "BUG-13",
        ],
        "error: the argument '--before <KEY>' cannot be used with '--after <KEY>'\n",
        Some("Usage: p99 move "),
    );
    unparsed(
        &["labels", "rename", "Stuck"],
        "error: the following required arguments were not provided:\n  <TO>\n",
        Some("Usage: p99 labels rename "),
    );
    unparsed(
        &["labels", "extra"],
        "error: unrecognized subcommand 'extra'\n",
        Some("Usage: p99 labels "),
    );
}

#[test]
fn board_json_is_the_workers_answer_and_carries_each_filter() {
    let worker = Worker::start(answers);
    let all = json_of(&run(&worker, "board_json", &["board", "--json"]));
    assert_eq!(all, the_board());
    assert_eq!(worker.last().path, "/v1/board");
    let some = json_of(&run(
        &worker,
        "board_json",
        &[
            "board",
            "--project",
            " Splicer ",
            "--project",
            "Paper Two",
            "--host",
            "SHOP.example.com",
            "--json",
        ],
    ));
    assert_eq!(some, the_board());
    let seen = worker.last();
    assert_eq!(seen.method, "GET");
    assert_eq!(
        seen.path,
        "/v1/board?project=Splicer&project=Paper%20Two&host=shop.example.com"
    );
}

#[test]
fn board_text_prints_seven_lanes_with_counts_and_the_project_on_cards() {
    let worker = Worker::start(answers);
    let out = run(&worker, "board_text", &["board"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    let lines: Vec<&str> = out.stdout.lines().collect();
    let heads: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| !l.is_empty() && !l.starts_with("  "))
        .collect();
    assert_eq!(
        heads,
        [
            "New (1)",
            "Planned (0)",
            "In progress (0)",
            "Needs you (2)",
            "Stuck (0)",
            "Landed (1)",
            "Done (0), closes"
        ]
    );
    let needs = lines.iter().position(|l| *l == "Needs you (2)").unwrap();
    assert_eq!(
        lines[needs + 1],
        format!(
            "  {:<9} {:<12} Export keeps every audio track",
            "FEAT-41", "Splicer"
        )
    );
    assert_eq!(
        lines[needs + 2],
        format!("  {:<9} {:<12} Print margins", "FEAT-40", "Paper")
    );
    assert_eq!(
        lines[1],
        format!("  {:<9} {:<12} Broken button", "BUG-12", "")
    );
}

#[test]
fn board_refusals_are_one_line_and_an_old_worker_says_deploy() {
    let worker = Worker::start(answers);
    for args in [
        vec!["board", "--project", "Locked"],
        vec!["board", "--project", "Locked", "--json"],
    ] {
        refused(
            &run(&worker, "board_refused", &args),
            "only an Owner reads the board",
        );
    }
    let old = Worker::start(old_worker);
    for args in [
        vec!["board"],
        vec!["board", "--json"],
        vec!["boards"],
        vec!["boards", "--json"],
    ] {
        refused(
            &run(&old, "board_old", &args),
            "this Worker still has a board per person; run p99 deploy for the one board",
        );
    }
}

#[test]
fn boards_says_it_is_deprecated_and_lists_the_archived_boards() {
    let worker = Worker::start(answers);
    let out = run(&worker, "boards_text", &["boards"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert_eq!(
        out.stderr,
        "p99: p99 boards is deprecated: one board per account since 1.11; p99 board prints it\n"
    );
    assert_eq!(
        out.stdout,
        format!(
            "{:<5} {:<24} {:<16} archived, 3 columns, 1 card\n{:<5} {:<24} {:<16} archived, 0 columns, 0 cards\n",
            2, "Web", "@ada", 3, "Ops", "@grace"
        )
    );
    assert_eq!(worker.last().path, "/v1/boards");

    let json = run(&worker, "boards_json", &["boards", "--json"]);
    let doc = json_of(&json);
    assert!(json.stderr.is_empty(), "{}", json.stderr);
    assert_eq!(
        doc["deprecated"],
        "one board per account since 1.11; read /board"
    );
    assert_eq!(doc["board"]["lanes"], lanes());
    assert_eq!(doc["archived"][0]["name"], "Web");
    assert_eq!(doc["archived"][0]["archived"], true);
    assert_eq!(doc["archived"].as_array().unwrap().len(), 2);
}

#[test]
fn boards_set_refuses_locally_and_never_asks_the_worker() {
    for answer in [answers as Answer, old_worker as Answer] {
        let worker = Worker::start(answer);
        for json in [false, true] {
            let mut args = vec![
                "boards",
                "set",
                "Web",
                "--columns",
                "Inbox,QA ready,Done",
                "--closes",
                "Done",
            ];
            if json {
                args.push("--json");
            }
            refused(
                &run(&worker, "boards_set", &args),
                "boards are one per account; see p99 board",
            );
        }
        refused(
            &run(
                &worker,
                "boards_set",
                &[
                    "boards",
                    "set",
                    "Web",
                    "--columns",
                    "Inbox,Done",
                    "--closes",
                    "Shipped",
                ],
            ),
            "boards are one per account; see p99 board",
        );
        assert!(
            worker.seen().is_empty(),
            "boards set asked the Worker: {:?}",
            worker.seen()
        );
    }
}

#[test]
fn boards_host_scopes_the_archived_list_to_that_host() {
    let worker = Worker::start(answers);
    let out = run(
        &worker,
        "boards_host",
        &["boards", "--host", "SHOP.example.com"],
    );
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert_eq!(worker.last().path, "/v1/boards?host=shop.example.com");
    let doc = json_of(&run(
        &worker,
        "boards_host",
        &["boards", "--host", "shop.example.com", "--json"],
    ));
    assert_eq!(doc, old_boards());
    assert_eq!(worker.last().path, "/v1/boards?host=shop.example.com");
}

#[test]
fn move_takes_a_lane_word_or_name_and_never_names_a_board() {
    let worker = Worker::start(answers);
    let out = run(&worker, "move", &["move", "FEAT-41", "--to", "needs-you"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert_eq!(out.stdout, "FEAT-41 is in Needs you\n");
    let seen = worker.last();
    assert_eq!(
        (seen.method.as_str(), seen.path.as_str()),
        ("POST", "/v1/move")
    );
    assert_eq!(
        seen.body,
        json!({"key": "41", "from": "In progress", "to": "needs-you"})
    );
    assert_eq!(seen.actor["email"], "ada@example.com");
    assert_eq!(seen.actor["agent"], false);

    let named = json_of(&run(
        &worker,
        "move",
        &[
            "move",
            "FEAT-41",
            "--to",
            " needs you ",
            "--before",
            "FEAT-40",
            "--json",
        ],
    ));
    assert_eq!(named["card"]["label"], "Needs you");
    let seen = worker.last();
    assert_eq!(
        seen.body,
        json!({"key": "41", "from": "In progress", "to": "needs you", "before": "40"})
    );
    assert!(seen.body.get("board").is_none());

    let after = run(
        &worker,
        "move",
        &["move", "41", "--to", "Landed", "--after", "FEAT-7"],
    );
    assert_eq!(after.stdout, "FEAT-41 is in Landed\n", "{}", after.stderr);
    assert_eq!(worker.last().body["after"], "7");
}

#[test]
fn move_refusals_come_through_as_one_line() {
    let worker = Worker::start(answers);
    refused(
        &run(
            &worker,
            "move_refused",
            &["move", "FEAT-41", "--to", "Shipped"],
        ),
        "no lane is called Shipped",
    );
    refused(
        &run(
            &worker,
            "move_refused",
            &["move", "FEAT-42", "--to", "new", "--after", "BUG-12"],
        ),
        "FEAT-42 moved to Landed meanwhile; run it again to move it from there",
    );
    refused(
        &run(&worker, "move_refused", &["move", "nope", "--to", "new"]),
        "nope is not an item key; try BUG-12 or 12",
    );
    for to in ["needs-you", "needs you", "Needs You"] {
        refused(
            &run(&worker, "move_refused", &["move", "FEAT-43", "--to", to]),
            "FEAT-43 moved to Needs you meanwhile; nothing left to move",
        );
    }
    refused(
        &run(
            &worker,
            "move_refused",
            &["move", "FEAT-43", "--to", "stuck", "--json"],
        ),
        "FEAT-43 moved to Needs you meanwhile; run it again to move it from there",
    );
}

#[test]
fn move_on_an_old_worker_is_its_refusal_in_one_line() {
    let old = Worker::start(old_worker);
    for args in [
        vec!["move", "FEAT-41", "--to", "new"],
        vec!["move", "FEAT-41", "--to", "new", "--json"],
        vec!["move", "FEAT-41", "--to", "new", "--after", "BUG-12"],
    ] {
        refused(&run(&old, "move_old", &args), "name a board to move on");
        let seen = old.last();
        assert_eq!(
            (seen.method.as_str(), seen.path.as_str()),
            ("POST", "/v1/move")
        );
        assert_eq!(seen.body["from"], "Doing");
        assert!(seen.body.get("board").is_none());
    }
}

#[test]
fn labels_lists_the_seven_lanes_and_renames_one_by_word_or_name() {
    let worker = Worker::start(answers);
    let out = run(&worker, "labels", &["labels"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert_eq!(
        out.stdout.lines().collect::<Vec<_>>(),
        [
            format!("{:<12} New", "new"),
            format!("{:<12} Planned", "planned"),
            format!("{:<12} In progress", "in-progress"),
            format!("{:<12} Needs you", "needs-you"),
            format!("{:<12} Stuck", "stuck"),
            format!("{:<12} Landed", "landed"),
            format!("{:<12} {:<20} closes", "done", "Done"),
        ]
    );
    let doc = json_of(&run(&worker, "labels", &["labels", "--json"]));
    assert_eq!(doc, json!({"labels": labels()}));

    let renamed = run(
        &worker,
        "labels",
        &["labels", "rename", "needs-you", "Waiting on me"],
    );
    assert_eq!(
        renamed.stdout, "Needs you is now Waiting on me\n",
        "{}",
        renamed.stderr
    );
    let seen = worker.last();
    assert_eq!(
        (seen.method.as_str(), seen.path.as_str()),
        ("PATCH", "/v1/labels/13")
    );
    assert_eq!(seen.body, json!({"name": "Waiting on me"}));
    assert!(
        worker
            .seen()
            .iter()
            .all(|s| s.method == "GET" || s.path == "/v1/labels/13"),
        "a rename touched another label: {:?}",
        worker.seen()
    );
    let by_name = json_of(&run(
        &worker,
        "labels",
        &["labels", "rename", "NEEDS YOU", "Yours", "--yes", "--json"],
    ));
    assert_eq!(by_name["name"], "Yours");
    assert_eq!(worker.last().path, "/v1/labels/13");

    refused(
        &run(
            &worker,
            "labels",
            &["labels", "rename", "QA ready", "Ready"],
        ),
        "no lane is called QA ready; p99 labels lists them",
    );
}

#[test]
fn labels_on_an_old_worker_list_with_no_words_and_rename_only_by_name() {
    let old = Worker::start(old_worker);
    let out = run(&old, "labels_old", &["labels"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let lines: Vec<&str> = out.stdout.lines().collect();
    assert_eq!(lines.len(), 7);
    assert_eq!(lines[0], format!("{:<12} Inbox", ""));
    assert_eq!(lines[3], format!("{:<12} {:<20} closes", "", "Done"));
    assert!(
        lines.iter().all(|l| l.starts_with(&" ".repeat(12))),
        "{lines:?}"
    );

    refused(
        &run(
            &old,
            "labels_old",
            &["labels", "rename", "needs-you", "Waiting on me"],
        ),
        "no lane is called needs-you; p99 labels lists them",
    );
    assert!(old.seen().iter().all(|s| s.method == "GET"));
    let renamed = run(&old, "labels_old", &["labels", "rename", "done", "Shipped"]);
    assert_eq!(
        renamed.stdout, "Done is now Shipped\n",
        "{}",
        renamed.stderr
    );
    assert_eq!(old.last().path, "/v1/labels/23");
}

#[test]
fn board_text_shows_a_renamed_lane_a_stray_card_and_an_empty_board() {
    let worker = Worker::start(answers);
    let out = run(&worker, "board_renamed", &["board", "--project", "Renamed"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let lines: Vec<&str> = out.stdout.lines().collect();
    assert!(lines.contains(&"Waiting on me (2)"), "{lines:?}");
    assert!(!lines.contains(&"Needs you (2)"), "{lines:?}");
    assert!(!lines.iter().any(|l| l.starts_with("Done (")), "{lines:?}");
    assert_eq!(
        *lines.last().unwrap(),
        format!("  {:<9} {:<12} Old export  in Shipped", "FEAT-9", "Splicer")
    );

    let empty = run(&worker, "board_empty", &["board", "--project", "Empty"]);
    assert_eq!(empty.code, Some(0), "{}", empty.stderr);
    assert_eq!(
        empty.stdout,
        "this board has no lanes yet; run p99 deploy\n"
    );
    let json = json_of(&run(
        &worker,
        "board_empty",
        &["board", "--project", "Empty", "--json"],
    ));
    assert_eq!(json, json!({"board": {"lanes": []}, "cards": []}));
}

#[test]
fn board_json_passes_fields_the_cli_does_not_know_through_untouched() {
    let worker = Worker::start(|method, path, _| {
        if method == "GET" && path.starts_with("/v1/board") && !path.starts_with("/v1/boards") {
            let mut board = the_board();
            board["since"] = json!("2026-10-22T09:00:00.000Z");
            board["cards"][0]["checks"] = json!(["ci"]);
            return (200, board.to_string());
        }
        if method == "GET" && path.starts_with("/v1/boards") {
            let mut old = old_boards();
            old["next"] = json!(null);
            old["archived"][1] = json!({"id": 3, "name": "Ops"});
            return (200, old.to_string());
        }
        (404, r#"{"message":"no such route"}"#.into())
    });
    let board = json_of(&run(&worker, "board_raw", &["board", "--json"]));
    assert_eq!(board["since"], "2026-10-22T09:00:00.000Z");
    assert_eq!(board["cards"][0]["checks"], json!(["ci"]));
    let old = json_of(&run(&worker, "board_raw", &["boards", "--json"]));
    assert!(old.get("next").is_some());
    assert_eq!(old["archived"][1], json!({"id": 3, "name": "Ops"}));
}

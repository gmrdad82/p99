use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};

const CARD: &str = r#"{"key":"FEAT-41","kind":"feature","project":"Splicer","status":"stuck","label":"Stuck","lane":3,
 "title":"Export keeps every audio track","host":"shop.example.com",
 "reporter":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
 "created_at":"2026-10-22T08:00:00.000Z","changed_at":"2026-10-22T09:12:00.000Z",
 "changed_by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci·splicer·writer"},
 "comments":4,
 "links":[{"ref":"pci#2700","note":"Splicer export","by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"at":"2026-10-22T08:05:00.000Z"}]}"#;

const COMMENT: &str = r#"{"id":9,"author":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"body":"Blocked on the mixer.","internal":false,"created_at":"2026-10-22T09:12:00.000Z"}"#;

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
        .join("stories_cards")
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

fn card() -> Value {
    serde_json::from_str(CARD).unwrap()
}

fn answers(method: &str, path: &str, body: &Value) -> (u16, String) {
    let route = path.split('?').next().unwrap_or(path);
    let card = card();
    let comment: Value = serde_json::from_str(COMMENT).unwrap();
    let reply = match (method, route) {
        ("GET", "/v1/cards") if path.contains("cursor=c2") => {
            json!({"cards":[],"next_cursor":null})
        }
        ("GET", "/v1/cards") => json!({"cards":[card],"next_cursor":"c2"}),
        ("GET", "/v1/cards/FEAT-99") => return (404, r#"{"message":"no item FEAT-99"}"#.into()),
        ("GET", "/v1/cards/BUG-12")
        | ("POST", "/v1/cards/BUG-12/status")
        | ("POST", "/v1/cards/BUG-12/comments") => {
            return (
                409,
                r#"{"message":"BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name>"}"#.into(),
            );
        }
        ("GET", "/v1/cards/FEAT-41") | ("GET", "/v1/cards/41") => {
            let mut with_body = card.clone();
            with_body["body"] = json!("Every track, in sync.");
            json!({"card":with_body,"comments":[comment],"events":[
                {"kind":"project","detail":{"from":null,"to":"Splicer"},"by":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},"at":"2026-10-22T08:00:00.000Z"},
                {"kind":"label","detail":{"from":"New","to":"Stuck"},"by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"at":"2026-10-22T09:12:00.000Z"}
            ]})
        }
        ("GET", "/v1/hosts") => json!({"hosts":[
            {"host":"a.example.com","env":"staging","config":{},"created_at":"2026-10-02T00:00:00.000Z"},
            {"host":"shop.example.com","env":"production","config":{},"created_at":"2026-10-01T00:00:00.000Z"}
        ]}),
        ("POST", "/v1/cards") => {
            let mut made = card.clone();
            made["project"] = body["project"].clone();
            made["host"] = body["host"].clone();
            json!({"card":made})
        }
        ("POST", "/v1/cards/FEAT-41/status") if body["status"] == "done" => {
            return (403, r#"{"message":"only a person closes a card"}"#.into());
        }
        ("POST", "/v1/cards/FEAT-41/status") if body["note"].is_string() => {
            json!({"card":card,"comment":comment})
        }
        ("POST", "/v1/cards/FEAT-41/status") => json!({"card":card}),
        ("POST", "/v1/cards/FEAT-41/comments") => json!({"key":"FEAT-41","comment":comment}),
        ("POST", "/v1/cards/FEAT-41/links") => json!({"key":"FEAT-41","link":{
            "ref":body["ref"],"note":body["note"],"by":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},"at":"2026-10-22T09:30:00.000Z"}}),
        ("GET", "/v1/projects") => {
            json!({"projects":[{"name":"Paper","open":0,"done":2},{"name":"Splicer","open":3,"done":1}]})
        }
        ("PATCH", "/v1/issues/12") if body["project"].is_string() => {
            let mut made = card.clone();
            made["key"] = json!("BUG-12");
            made["status"] = json!("new");
            made["label"] = json!("New");
            made["lane"] = json!(1);
            json!({"card":made})
        }
        ("GET", "/v1/issues/12") => {
            json!({"issue":{"id":12,"key":"BUG-12","kind":"bug","title":"Broken","project":"Splicer"},"comments":[],"events":[]})
        }
        ("GET", "/v1/issues/13") => {
            json!({"issue":{"id":13,"key":"BUG-13","kind":"bug","title":"Plain","project":null},"comments":[],"events":[]})
        }
        ("PATCH", "/v1/issues/12") => {
            json!({"id":12,"key":"BUG-12","kind":"bug","title":"Broken","status":"open","stage":"inbox","project":null,"comments":0})
        }
        _ => return (404, r#"{"message":"no such route"}"#.into()),
    };
    (
        if method == "POST" && route != "/v1/cards/FEAT-41/status" {
            201
        } else {
            200
        },
        reply.to_string(),
    )
}

fn old_worker(_: &str, _: &str, _: &Value) -> (u16, String) {
    (404, r#"{"message":"no such route"}"#.into())
}

fn old_issue_patch(_: &str, _: &str, _: &Value) -> (u16, String) {
    (
        200,
        r#"{"id":12,"key":"BUG-12","kind":"bug","title":"Broken"}"#.into(),
    )
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

#[test]
fn every_parse_error_is_claps_on_stderr_with_exit_2_and_nothing_on_stdout() {
    unparsed(
        &["card"],
        "error: 'p99 card' requires a subcommand but one was not provided\n",
        Some("Usage: p99 card "),
    );
    unparsed(
        &["card", "status", "FEAT-41", "blocked"],
        "error: invalid value 'blocked' for '<STATUS>'\n  [possible values: new, planned, in-progress, stuck, landed, done]\n",
        None,
    );
    unparsed(
        &["--agent", "pci", "cards"],
        "error: unrecognized subcommand 'pci'",
        Some("Usage: p99 "),
    );
    unparsed(
        &["edit", "BUG-12", "--project", "Splicer", "--title", "x"],
        "error: the argument '--project <name>' cannot be used with '--title <TITLE>'",
        Some("Usage: p99 edit "),
    );
    unparsed(
        &["edit", "BUG-12", "--project", "Splicer", "--no-project"],
        "error: the argument '--project <name>' cannot be used with '--no-project'",
        Some("Usage: p99 edit "),
    );
    unparsed(
        &["cards", "--limit", "501"],
        "error: invalid value '501' for '--limit <n>'",
        None,
    );
    unparsed(
        &["cards", "--source", "robot"],
        "error: invalid value 'robot' for '--source <SOURCE>'",
        None,
    );
    unparsed(
        &["card", "new", "--title", "x"],
        "error: the following required arguments were not provided:\n  --project <name>\n",
        Some("Usage: p99 card new "),
    );
    unparsed(
        &[
            "card",
            "new",
            "--project",
            "P",
            "--title",
            "x",
            "--kind",
            "epic",
        ],
        "error: invalid value 'epic' for '--kind <KIND>'",
        None,
    );
    unparsed(
        &["card", "link", "FEAT-41"],
        "error: the following required arguments were not provided:\n  <REF>\n",
        Some("Usage: p99 card link "),
    );
    unparsed(
        &["projects", "extra"],
        "error: unexpected argument 'extra' found",
        Some("Usage: p99 projects"),
    );
}

#[test]
fn cards_lists_in_json_exactly_as_the_worker_answers_and_reads_on_with_the_cursor() {
    let worker = Worker::start(answers);
    let first = json_of(&run(&worker, "cards_json", &["cards", "--json"]));
    assert_eq!(first, json!({"cards":[card()],"next_cursor":"c2"}));
    let seen = worker.last();
    assert_eq!(
        (seen.method.as_str(), seen.path.as_str()),
        ("GET", "/v1/cards?limit=200")
    );
    let next = json_of(&run(
        &worker,
        "cards_json",
        &["cards", "--cursor", "c2", "--json"],
    ));
    assert_eq!(next, json!({"cards":[],"next_cursor":null}));
    assert_eq!(worker.last().path, "/v1/cards?limit=200&cursor=c2");
}

#[test]
fn cards_passes_every_filter_and_turns_an_age_into_a_time() {
    let worker = Worker::start(answers);
    let out = run(
        &worker,
        "cards_filters",
        &[
            "cards",
            "--project",
            " Splicer ",
            "--project",
            "Paper",
            "--status",
            "stuck",
            "--status",
            "landed",
            "--source",
            "agent",
            "--host",
            "shop.example.com",
            "--limit",
            "5",
            "--since",
            "2026-10-22T10:00:00+02:00",
            "--json",
        ],
    );
    json_of(&out);
    assert_eq!(
        worker.last().path,
        "/v1/cards?project=Splicer&project=Paper&status=stuck&status=landed&since=2026-10-22T08%3A00%3A00Z&source=agent&host=shop.example.com&limit=5"
    );
    json_of(&run(
        &worker,
        "cards_filters",
        &["cards", "--since", "6h", "--json"],
    ));
    let path = worker.last().path;
    let since = path
        .split("since=")
        .nth(1)
        .and_then(|s| s.split('&').next())
        .unwrap()
        .replace("%3A", ":");
    assert_eq!(since.len(), 20, "{since}");
    assert!(
        since.ends_with('Z') && since.as_bytes()[10] == b'T',
        "{since}"
    );
}

#[test]
fn cards_text_shows_one_line_a_card_with_the_robot_and_says_more_follow() {
    let worker = Worker::start(answers);
    let out = run(&worker, "cards_text", &["cards"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let lines: Vec<&str> = out.stdout.lines().collect();
    assert_eq!(lines.len(), 2, "{}", out.stdout);
    assert!(lines[0].starts_with(
        "FEAT-41  stuck       Splicer      Export keeps every audio track  Ada Lovelace 🤖 "
    ));
    assert_eq!(lines[1], "more cards follow; read on with --cursor c2");
    assert!(!out.stdout.contains('*'));
    let empty = run(&worker, "cards_text", &["cards", "--cursor", "c2"]);
    assert_eq!(empty.stdout, "no cards\n");
}

#[test]
fn a_bad_since_or_project_is_refused_before_asking() {
    let worker = Worker::start(answers);
    for bad in ["yesterday", "6w", "2026-10-22", ""] {
        refused(
            &run(
                &worker,
                "cards_refused",
                &["cards", "--since", bad, "--json"],
            ),
            "--since takes a time like 2026-10-22T08:00:00Z or an age like 6h",
        );
    }
    let long = "a".repeat(41);
    for args in [
        vec!["cards", "--project", long.as_str()],
        vec!["card", "new", "--project", "  ", "--title", "x"],
        vec![
            "card",
            "new",
            "--project",
            long.as_str(),
            "--title",
            "x",
            "--json",
        ],
        vec!["edit", "BUG-12", "--project", "\u{1}"],
    ] {
        refused(
            &run(&worker, "cards_refused", &args),
            "a project name has 1 to 40 characters",
        );
    }
    assert!(worker.seen().is_empty());
}

#[test]
fn an_old_worker_says_deploy_on_every_card_command() {
    let worker = Worker::start(old_worker);
    for args in [
        vec!["cards"],
        vec!["cards", "--json"],
        vec!["card", "show", "FEAT-41"],
        vec![
            "card",
            "new",
            "--project",
            "Splicer",
            "--title",
            "x",
            "--host",
            "shop.example.com",
        ],
        vec!["card", "comment", "FEAT-41", "hi"],
        vec!["card", "status", "FEAT-41", "stuck"],
        vec!["card", "link", "FEAT-41", "pci#1"],
        vec!["projects", "--json"],
    ] {
        refused(
            &run(&worker, "old_worker", &args),
            "this Worker has no cards yet; run p99 deploy",
        );
    }
    let patch = Worker::start(old_issue_patch);
    for args in [
        vec!["edit", "BUG-12", "--project", "Splicer"],
        vec!["edit", "BUG-12", "--no-project"],
        vec!["edit", "BUG-12", "--no-project", "--json"],
    ] {
        refused(
            &run(&patch, "old_worker", &args),
            "this Worker has no cards yet; run p99 deploy",
        );
    }
}

#[test]
fn the_contracts_refusals_come_through_as_one_line() {
    let worker = Worker::start(answers);
    refused(
        &run(&worker, "refusals", &["card", "show", "FEAT-99"]),
        "no item FEAT-99",
    );
    refused(
        &run(&worker, "refusals", &["card", "show", "BUG-12", "--json"]),
        "BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name>",
    );
    refused(
        &run(&worker, "refusals", &["card", "status", "BUG-12", "stuck"]),
        "BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name>",
    );
    refused(
        &run(
            &worker,
            "refusals",
            &["--agent", "card", "status", "FEAT-41", "done"],
        ),
        "only a person closes a card",
    );
    let run = run(&worker, "refusals", &["card", "show", "FE AT"]);
    assert_eq!(run.code, Some(1));
    assert!(run.stdout.is_empty());
}

#[test]
fn an_unreachable_worker_is_exit_1_with_nothing_on_stdout() {
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/_p99", closed.local_addr().unwrap());
    drop(closed);
    let out = p99(
        &config("unreachable", &url),
        &["cards", "--json"],
        &[],
        None,
    );
    assert_eq!(out.code, Some(1));
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.starts_with("p99: cannot reach "),
        "{}",
        out.stderr
    );
}

#[test]
fn card_show_gives_the_thread_in_json_and_in_text() {
    let worker = Worker::start(answers);
    let thread = json_of(&run(
        &worker,
        "show",
        &["card", "show", "FEAT-41", "--json"],
    ));
    assert_eq!(thread["card"]["body"], "Every track, in sync.");
    assert_eq!(thread["card"]["key"], "FEAT-41");
    assert_eq!(thread["comments"][0]["author"]["via"], "pci");
    assert_eq!(thread["events"][1]["detail"]["to"], "Stuck");
    assert!(!thread.to_string().contains("email"));
    let expected = answers("GET", "/v1/cards/FEAT-41", &Value::Null).1;
    assert_eq!(thread, serde_json::from_str::<Value>(&expected).unwrap());
    let text = run(&worker, "show", &["card", "show", "41"]);
    assert_eq!(text.code, Some(0), "{}", text.stderr);
    assert_eq!(worker.last().path, "/v1/cards/41");
    assert!(text.stdout.starts_with(
        "FEAT-41  Idea  Splicer  Stuck (#3 in its lane)\nExport keeps every audio track\n"
    ));
    assert!(
        text.stdout
            .contains("link pci#2700 (Splicer export)  Ada Lovelace 🤖 via pci")
    );
    assert!(
        text.stdout
            .contains("Ada Lovelace 🤖 via pci  2026-10-22 09:12\n  Blocked on the mixer.")
    );
    assert!(
        text.stdout
            .contains("lane New -> Stuck  Ada Lovelace 🤖 via pci")
    );
}

#[test]
fn card_new_files_on_the_oldest_host_with_a_client_uid_and_the_body_from_stdin() {
    let worker = Worker::start(answers);
    let file = config("new", &worker.url);
    let out = p99(
        &file,
        &[
            "card",
            "new",
            "--project",
            "Splicer",
            "--title",
            "Export keeps every audio track",
            "--body",
            "-",
            "--json",
        ],
        &[],
        Some("Every track.\n\n"),
    );
    let printed = json_of(&out);
    let calls = worker.seen();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].path, "/v1/hosts");
    let filed = &calls[1];
    assert_eq!(
        (filed.method.as_str(), filed.path.as_str()),
        ("POST", "/v1/cards")
    );
    assert_eq!(filed.body["project"], "Splicer");
    assert_eq!(filed.body["title"], "Export keeps every audio track");
    assert_eq!(filed.body["body"], "Every track.");
    assert_eq!(filed.body["kind"], "feature");
    assert_eq!(filed.body["host"], "shop.example.com");
    assert_eq!(filed.body["client_uid"].as_str().unwrap().len(), 36);
    assert_eq!(printed.as_object().unwrap().len(), 1);
    assert_eq!(printed["card"]["project"], "Splicer");

    let text = p99(
        &file,
        &[
            "card",
            "new",
            "--project",
            "splicer",
            "--title",
            "t",
            "--kind",
            "bug",
            "--host",
            "A.Example.com",
        ],
        &[],
        None,
    );
    assert_eq!(text.code, Some(0), "{}", text.stderr);
    let filed = worker.last();
    assert_eq!(worker.seen().len(), 3);
    assert_eq!(filed.body["host"], "a.example.com");
    assert_eq!(filed.body["kind"], "bug");
    assert_eq!(filed.body["body"], "");
    assert_eq!(
        text.stdout,
        "FEAT-41 filed in splicer on a.example.com: Export keeps every audio track\n"
    );
    assert_ne!(calls[1].body["client_uid"], filed.body["client_uid"]);
}

#[test]
fn card_comment_reads_stdin_and_answers_key_and_comment() {
    let worker = Worker::start(answers);
    let file = config("comment", &worker.url);
    let out = p99(
        &file,
        &["card", "comment", "FEAT-41", "-", "--internal", "--json"],
        &[],
        Some("Blocked.\n"),
    );
    let printed = json_of(&out);
    assert_eq!(
        printed,
        json!({"key":"FEAT-41","comment":serde_json::from_str::<Value>(COMMENT).unwrap()})
    );
    let seen = worker.last();
    assert_eq!(seen.path, "/v1/cards/FEAT-41/comments");
    assert_eq!(seen.body["body"], "Blocked.");
    assert_eq!(seen.body["internal"], true);
    assert_eq!(seen.body["client_uid"].as_str().unwrap().len(), 36);
    let text = p99(&file, &["card", "comment", "FEAT-41", "Seen."], &[], None);
    assert_eq!(text.stdout, "commented on FEAT-41\n");
    assert_eq!(worker.last().body["internal"], false);
}

#[test]
fn card_status_moves_with_an_optional_note_from_stdin() {
    let worker = Worker::start(answers);
    let file = config("status", &worker.url);
    let noted = json_of(&p99(
        &file,
        &[
            "card", "status", "FEAT-41", "stuck", "--note", "-", "--json",
        ],
        &[],
        Some("mixer\n"),
    ));
    assert_eq!(noted["card"], card());
    assert_eq!(noted["comment"]["id"], 9);
    let seen = worker.last();
    assert_eq!(seen.path, "/v1/cards/FEAT-41/status");
    assert_eq!(seen.body["status"], "stuck");
    assert_eq!(seen.body["note"], "mixer");
    assert_eq!(seen.body["client_uid"].as_str().unwrap().len(), 36);
    let plain = json_of(&p99(
        &file,
        &["card", "status", "FEAT-41", "in-progress", "--json"],
        &[],
        None,
    ));
    assert_eq!(plain, json!({"card":card()}));
    assert_eq!(worker.last().body["note"], Value::Null);
    assert_eq!(worker.last().body["status"], "in-progress");
    let text = p99(
        &file,
        &["card", "status", "FEAT-41", "stuck", "--note", "why"],
        &[],
        None,
    );
    assert_eq!(
        text.stdout,
        "FEAT-41 is now Stuck (stuck, #3 in its lane), with a note\n"
    );
}

#[test]
fn card_link_sends_ref_and_note_and_answers_key_and_link() {
    let worker = Worker::start(answers);
    let printed = json_of(&run(
        &worker,
        "link",
        &[
            "card",
            "link",
            "FEAT-41",
            "pci#2700",
            "--note",
            "Splicer export",
            "--json",
        ],
    ));
    assert_eq!(printed["key"], "FEAT-41");
    assert_eq!(printed["link"]["ref"], "pci#2700");
    assert_eq!(printed["link"]["note"], "Splicer export");
    assert_eq!(
        printed["link"]["by"],
        json!({"name":"Ada Lovelace","username":"ada","agent":false,"via":null})
    );
    assert_eq!(
        worker.last().body,
        json!({"ref":"pci#2700","note":"Splicer export"})
    );
    let text = run(&worker, "link", &["card", "link", "FEAT-41", "v1.2.0"]);
    assert_eq!(text.stdout, "linked FEAT-41 to v1.2.0\n");
    assert_eq!(worker.last().body, json!({"ref":"v1.2.0","note":null}));
}

#[test]
fn projects_lists_names_with_counts() {
    let worker = Worker::start(answers);
    let printed = json_of(&run(&worker, "projects", &["projects", "--json"]));
    assert_eq!(
        printed,
        json!({"projects":[{"name":"Paper","open":0,"done":2},{"name":"Splicer","open":3,"done":1}]})
    );
    let text = run(&worker, "projects", &["projects"]);
    assert_eq!(
        text.stdout,
        "PROJECT  OPEN  DONE\nPaper       0     2\nSplicer     3     1\n"
    );
}

#[test]
fn edit_turns_an_item_into_a_card_and_back() {
    let worker = Worker::start(answers);
    let made = json_of(&run(
        &worker,
        "edit",
        &["edit", "BUG-12", "--project", "Splicer", "--json"],
    ));
    assert_eq!(made.as_object().unwrap().len(), 1);
    assert_eq!(made["card"]["key"], "BUG-12");
    assert_eq!(made["card"]["status"], "new");
    let seen = worker.last();
    assert_eq!(
        (seen.method.as_str(), seen.path.as_str()),
        ("PATCH", "/v1/issues/12")
    );
    assert_eq!(seen.body, json!({"project":"Splicer"}));
    let text = run(&worker, "edit", &["edit", "12", "--project", "Splicer"]);
    assert_eq!(text.stdout, "BUG-12 is a card of Splicer, in New\n");
    let back = json_of(&run(
        &worker,
        "edit",
        &["edit", "BUG-12", "--no-project", "--json"],
    ));
    assert_eq!(back["key"], "BUG-12");
    assert_eq!(back["title"], "Broken");
    assert_eq!(back["id"], 12);
    assert!(back.get("issue").is_none());
    assert_eq!(worker.last().body, json!({"project":null}));
    let text = run(&worker, "edit", &["edit", "BUG-12", "--no-project"]);
    assert_eq!(text.stdout, "BUG-12 is a plain item again, back in Inbox\n");
}

fn actor_for(worker: &Worker, args: &[&str], env: &[(&str, &str)]) -> Value {
    let mut all: Vec<&str> = args.to_vec();
    all.extend(["projects", "--json"]);
    let out = p99(&config("agents", &worker.url), &all, env, None);
    assert_eq!(out.code, Some(0), "{args:?} {env:?}: {}", out.stderr);
    worker.last().actor
}

#[test]
fn the_agent_forms_reach_the_signed_actor_in_their_order() {
    let worker = Worker::start(answers);
    let ada = json!({"email":"ada@example.com","name":"Ada Lovelace"});
    let marked = |via: Option<&str>| {
        let mut actor = ada.clone();
        actor["agent"] = json!(true);
        if let Some(via) = via {
            actor["via"] = json!(via);
        }
        actor
    };
    assert_eq!(actor_for(&worker, &[], &[]), ada);
    assert_eq!(actor_for(&worker, &["--agent"], &[]), marked(None));
    assert_eq!(
        actor_for(&worker, &["--agent=pci·splicer·writer"], &[]),
        marked(Some("pci·splicer·writer"))
    );
    assert_eq!(
        actor_for(&worker, &[], &[("P99_AGENT", "pci")]),
        marked(Some("pci"))
    );
    assert_eq!(actor_for(&worker, &[], &[("P99_AGENT", "1")]), marked(None));
    assert_eq!(
        actor_for(&worker, &[], &[("P99_AGENT", "true")]),
        marked(None)
    );
    assert_eq!(actor_for(&worker, &[], &[("P99_AGENT", "")]), ada);
    assert_eq!(actor_for(&worker, &[], &[("P99_AGENT", "0")]), ada);
    assert_eq!(
        actor_for(&worker, &["--agent=cli"], &[("P99_AGENT", "env")]),
        marked(Some("cli"))
    );
    assert_eq!(
        actor_for(&worker, &["--agent"], &[("P99_AGENT", "env")]),
        marked(Some("env"))
    );
    let long = format!("--agent={}", "x".repeat(100));
    assert_eq!(
        actor_for(&worker, &[long.as_str()], &[]),
        marked(Some(&"x".repeat(80)))
    );
    assert_eq!(
        actor_for(&worker, &["--agent= \u{1}pci "], &[]),
        marked(Some("pci"))
    );
}

fn no_hosts(method: &str, path: &str, body: &Value) -> (u16, String) {
    match (method, path) {
        ("GET", "/v1/hosts") => (200, r#"{"hosts":[]}"#.into()),
        _ => answers(method, path, body),
    }
}

fn nobody_changed(method: &str, path: &str, body: &Value) -> (u16, String) {
    let route = path.split('?').next().unwrap_or(path);
    let mut system = card();
    system["key"] = json!("FEAT-42");
    system["changed_by"] = Value::Null;
    match (method, route) {
        ("GET", "/v1/cards") => (
            200,
            json!({"cards":[card(), system],"next_cursor":null}).to_string(),
        ),
        ("GET", "/v1/cards/FEAT-42") => {
            system["body"] = json!("");
            (
                200,
                json!({"card":system,"comments":[],"events":[
                    {"kind":"link","detail":{"ref":"https://github.com/example/shop/pull/1"},"by":null,"at":"2026-10-22T09:12:00.000Z"}
                ]})
                .to_string(),
            )
        }
        _ => answers(method, path, body),
    }
}

#[test]
fn p99_agent_zero_unmarks_a_person_whose_config_says_agent() {
    let worker = Worker::start(answers);
    let ada = json!({"email":"ada@example.com","name":"Ada Lovelace"});
    let marked = json!({"email":"ada@example.com","name":"Ada Lovelace","agent":true});
    for (name, me, account) in [
        ("agent_me", "agent = true\n", ""),
        ("agent_account", "", "\n[accounts.main.me]\nagent = true\n"),
    ] {
        let file = config_with(name, &worker.url, me, account);
        let args = ["card", "comment", "FEAT-41", "mine", "--json"];
        json_of(&p99(&file, &args, &[], None));
        assert_eq!(worker.last().actor, marked, "{name}");
        json_of(&p99(&file, &args, &[("P99_AGENT", "0")], None));
        assert_eq!(worker.last().actor, ada, "{name}");
        json_of(&p99(&file, &args, &[("P99_AGENT", "")], None));
        assert_eq!(worker.last().actor, marked, "{name}");
        json_of(&p99(&file, &args, &[("P99_AGENT", "false")], None));
        assert_eq!(worker.last().actor, ada, "{name}");
        let mut flagged = vec!["--agent=pci"];
        flagged.extend(args);
        json_of(&p99(&file, &flagged, &[("P99_AGENT", "0")], None));
        let mut labelled = marked.clone();
        labelled["via"] = json!("pci");
        assert_eq!(worker.last().actor, labelled, "{name}");
    }
}

#[test]
fn a_card_whose_last_change_has_no_person_lists_and_shows_as_p99() {
    let worker = Worker::start(nobody_changed);
    let list = json_of(&run(&worker, "nobody", &["cards", "--json"]));
    assert_eq!(list["cards"][1]["changed_by"], Value::Null);
    assert_eq!(list["cards"][0]["changed_by"]["via"], "pci·splicer·writer");
    let text = run(&worker, "nobody", &["cards"]);
    assert_eq!(text.code, Some(0), "{}", text.stderr);
    let lines: Vec<&str> = text.stdout.lines().collect();
    assert_eq!(lines.len(), 2, "{}", text.stdout);
    assert!(lines[1].starts_with("FEAT-42 "), "{}", lines[1]);
    assert!(lines[1].contains("  P99 "), "{}", lines[1]);
    let shown = run(&worker, "nobody", &["card", "show", "FEAT-42"]);
    assert_eq!(shown.code, Some(0), "{}", shown.stderr);
    assert!(
        shown.stdout.contains("\nchanged by P99 "),
        "{}",
        shown.stdout
    );
    assert!(
        shown
            .stdout
            .ends_with("linked https://github.com/example/shop/pull/1  P99\n"),
        "{}",
        shown.stdout
    );
    let thread = json_of(&run(
        &worker,
        "nobody",
        &["card", "show", "FEAT-42", "--json"],
    ));
    assert_eq!(thread["card"]["changed_by"], Value::Null);
}

#[test]
fn cards_lowercases_its_host_for_the_account_and_the_query() {
    let worker = Worker::start(answers);
    json_of(&run(
        &worker,
        "cards_host",
        &[
            "cards",
            "--host",
            " Shop.Example.COM ",
            "--source",
            "human",
            "--json",
        ],
    ));
    assert_eq!(
        worker.last().path,
        "/v1/cards?source=human&host=shop.example.com&limit=200"
    );
}

#[test]
fn card_new_on_an_account_with_no_host_says_add_one() {
    let worker = Worker::start(no_hosts);
    for json in [false, true] {
        let mut args = vec!["card", "new", "--project", "Splicer", "--title", "x"];
        if json {
            args.push("--json");
        }
        refused(
            &run(&worker, "no_hosts", &args),
            "the account main has no host yet; p99 hosts add",
        );
    }
    assert!(worker.seen().iter().all(|s| s.path == "/v1/hosts"));
}

#[test]
fn a_comment_on_an_item_that_is_not_a_card_is_refused() {
    let worker = Worker::start(answers);
    refused(
        &run(
            &worker,
            "not_a_card",
            &["card", "comment", "BUG-12", "hi", "--json"],
        ),
        "BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name>",
    );
}

#[test]
fn edit_no_project_prints_the_items_summary_typed() {
    let worker = Worker::start(answers);
    let back = json_of(&run(
        &worker,
        "no_project",
        &["edit", "BUG-12", "--no-project", "--json"],
    ));
    assert_eq!(back["key"], "BUG-12");
    assert_eq!(back["kind"], "bug");
    assert_eq!(back["comments"], 0);
    let text = run(&worker, "no_project", &["edit", "12", "--no-project"]);
    assert_eq!(text.stdout, "BUG-12 is a plain item again, back in Inbox\n");
    assert_eq!(worker.last().body, json!({"project":null}));
}

#[test]
fn edit_no_project_on_an_item_that_is_no_card_says_so_and_changes_nothing() {
    let worker = Worker::start(answers);
    let text = run(&worker, "no_card", &["edit", "BUG-13", "--no-project"]);
    assert_eq!(text.code, Some(0), "{}", text.stderr);
    assert_eq!(text.stdout, "BUG-13 is not a card\n");
    assert!(text.stderr.is_empty(), "{}", text.stderr);
    let seen = worker.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        (seen[0].method.as_str(), seen[0].path.as_str()),
        ("GET", "/v1/issues/13")
    );
    let missing = run(&worker, "no_card", &["edit", "BUG-14", "--no-project"]);
    assert_eq!(missing.code, Some(1));
    assert!(missing.stdout.is_empty(), "{}", missing.stdout);
    assert!(worker.seen().iter().all(|s| s.method != "PATCH"));
}

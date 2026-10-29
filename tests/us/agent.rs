use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use crate::fake;
use crate::home::Home;
use crate::stub::{KEY, Reply, Req};

const WAIT: Duration = Duration::from_secs(30);

struct Watching {
    child: Child,
    out: Receiver<String>,
    err: Receiver<String>,
}

impl Watching {
    fn start(h: &Home, args: &[&str]) -> Watching {
        let mut cmd = h.command(args, &[]);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let out = lines(child.stdout.take().unwrap());
        let err = lines(child.stderr.take().unwrap());
        Watching { child, out, err }
    }

    fn line(&self) -> String {
        self.out
            .recv_timeout(WAIT)
            .expect("p99 watch printed no line in time")
    }

    fn said(&self) -> String {
        self.err
            .recv_timeout(WAIT)
            .expect("p99 watch said nothing on stderr in time")
    }
}

impl Drop for Watching {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn lines(pipe: impl std::io::Read + Send + 'static) -> Receiver<String> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    rx
}

fn streaming(name: &str, stream: impl Fn(&Req, usize) -> Reply + Send + Sync + 'static) -> Home {
    let count = Arc::new(AtomicUsize::new(0));
    Home::new(name, move |req| {
        if req.is("GET", "/_p99/v1/stream") {
            stream(req, count.fetch_add(1, Ordering::SeqCst))
        } else {
            fake::any(req)
        }
    })
}

fn item(key: &str, title: &str) -> String {
    json!({"type": "item", "key": key, "host": "shop.example.com", "title": title, "by": {"name": "Grace Hopper"}})
        .to_string()
}

fn agent_thread() -> Value {
    let mut thread = crate::stub::thread(12, "The total does not update");
    thread["comments"] = json!([{
        "id": 3,
        "author": {"email": "ada@example.com", "name": "Ada Lovelace", "agent": true, "via": "writer"},
        "body": "Checking the cart service.",
        "internal": false,
        "created_at": "2026-10-02T10:00:00.000Z",
    }]);
    thread["events"] = json!([{
        "actor": "ada@example.com",
        "actor_name": "Ada Lovelace",
        "agent": true,
        "via": "writer",
        "kind": "status",
        "detail": {"from": "received", "to": "dropped"},
        "at": "2026-10-02T10:05:00.000Z",
    }]);
    thread
}

#[test]
fn us_agent_001_an_agents_command_is_signed_and_shown_as_adas_name_with_the_robot_mark() {
    let h = Home::new("us-agent-mark", |req: &Req| {
        if req.is("GET", "/_p99/v1/issues/12") {
            Reply::ok(agent_thread())
        } else {
            fake::any(req)
        }
    });
    h.p99(&["list", "--agent"]).ok();
    h.p99(&["list", "--agent=writer"]).ok();
    h.p99_env(&["list"], &[("P99_AGENT", "writer")]).ok();
    h.p99_env(&["list", "--agent=writer"], &[("P99_KEY", KEY)])
        .ok();
    h.p99_env(&["list"], &[("P99_AGENT", "0")]).ok();
    let calls = h.stub.calls("GET", "/_p99/v1/issues");
    assert_eq!(calls.len(), 5);
    assert!(calls.iter().all(|c| c.signed), "every call is signed");
    assert_eq!(calls[0].actor()["agent"], true);
    assert!(calls[0].actor().get("via").is_none());
    for labelled in &calls[1..4] {
        assert_eq!(labelled.actor()["agent"], true);
        assert_eq!(labelled.actor()["via"], "writer");
        assert_eq!(labelled.actor()["name"], "Ada Lovelace");
        assert_eq!(labelled.actor()["email"], "ada@example.com");
    }
    assert!(calls[4].actor().get("agent").is_none());

    let shown = h.p99(&["show", "12"]);
    shown.ok();
    assert!(
        shown.stdout.matches("Ada Lovelace 🤖 (writer)").count() >= 2,
        "{}",
        shown.stdout
    );
    let inbox = h.p99(&["tui", "--demo", "--dump", "120x34"]);
    inbox.ok();
    assert!(inbox.stdout.contains("Ada Lovelace 🤖"), "{}", inbox.stdout);
    assert!(!inbox.stdout.contains("Lovelace*"));
}

#[test]
fn us_agent_001_a_parse_error_exits_2_and_a_refusal_exits_1_in_one_line() {
    let h = Home::new("us-agent-exit", |req: &Req| {
        if req.under("POST", "/_p99/v1/cards/") {
            Reply::problem(403, "only a person closes a card")
        } else {
            fake::any(req)
        }
    });
    let parse = h.p99(&["--agent", "comment"]);
    parse.clap("the following required arguments were not provided:");
    assert!(parse.stdout.is_empty(), "{}", parse.stdout);
    let refused = h.p99(&["--agent=writer", "card", "status", "FEAT-41", "done"]);
    refused.refused("only a person closes a card");
    assert!(refused.stdout.is_empty(), "{}", refused.stdout);
    assert_eq!(refused.stderr.lines().count(), 1, "{}", refused.stderr);
    let bad_key = h.p99(&["--agent", "show", "x"]);
    bad_key.refused("x is not a card key; try BUG-12 or 12");
    assert_eq!(bad_key.stderr.lines().count(), 1, "{}", bad_key.stderr);
}

#[test]
fn us_agent_002_watch_reconnects_after_a_dropped_connection_and_says_so() {
    let closing = streaming("us-watch-again", |_, at| {
        if at == 0 {
            Reply::socket(&[item("BUG-3", "Before").as_str()], true)
        } else {
            Reply::socket(&[item("BUG-4", "After").as_str()], false)
        }
    });
    let w = Watching::start(&closing, &["watch", "--json"]);
    assert_eq!(w.said(), "p99: watching every host, connected");
    assert_eq!(w.line(), item("BUG-3", "Before"));
    assert_eq!(
        w.said(),
        "p99: the stream dropped (the Worker closed the stream); reconnecting in 1 s"
    );
    assert_eq!(w.said(), "p99: watching every host, reconnected");
    assert_eq!(w.line(), item("BUG-4", "After"));
    let calls = closing.stub.calls("GET", "/_p99/v1/stream");
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|c| c.signed));

    let trouble = streaming("us-watch-trouble", |_, at| match at {
        0 => Reply::problem(503, "the hub is busy"),
        1 => Reply::Drop,
        _ => Reply::socket(&[item("BUG-5", "Back").as_str()], false),
    });
    let w = Watching::start(&trouble, &["watch", "--json"]);
    assert_eq!(
        w.said(),
        "p99: the stream dropped (the hub is busy (503)); reconnecting in 1 s"
    );
    let dropped = w.said();
    assert!(
        dropped.starts_with(&format!(
            "p99: the stream dropped (cannot reach {}/_p99: ",
            trouble.stub.base
        )) && dropped.ends_with("); reconnecting in 2 s"),
        "{dropped}"
    );
    assert_eq!(w.said(), "p99: watching every host, connected");
    assert_eq!(w.line(), item("BUG-5", "Back"));
}

#[test]
fn us_agent_002_watch_stops_on_a_refusal_it_cannot_outwait() {
    let cases: [(&str, Reply, &str); 3] = [
        (
            "us-watch-401",
            Reply::problem(401, "bad signature"),
            "bad signature (401)",
        ),
        (
            "us-watch-nohost",
            Reply::problem(404, "no such host shop.example.com"),
            "no such host shop.example.com (404)",
        ),
        (
            "us-watch-nopush",
            Reply::problem(404, "not found"),
            "this Worker has no push yet; run p99 deploy",
        ),
    ];
    for (name, reply, said) in cases {
        let reply = Arc::new(Mutex::new(Some(reply)));
        let h = streaming(name, move |_, _| {
            reply
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Reply::problem(500, "asked twice"))
        });
        let out = h.p99(&["watch", "--json"]);
        out.refused(said);
        assert!(out.stdout.is_empty(), "{}", out.stdout);
        assert_eq!(h.stub.calls("GET", "/_p99/v1/stream").len(), 1);
    }
}

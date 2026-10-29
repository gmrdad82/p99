#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, channel};
use std::time::Duration;

use serde_json::json;

use home::Home;
use stub::{Reply, Req, Stub};

const WAIT: Duration = Duration::from_secs(30);

struct Watching {
    child: Child,
    out: Receiver<String>,
    err: Receiver<String>,
}

impl Watching {
    fn start(h: &Home, args: &[&str], envs: &[(&str, &str)]) -> Watching {
        let mut cmd = h.command(args, envs);
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
            let at = count.fetch_add(1, Ordering::SeqCst);
            stream(req, at)
        } else {
            fake::any(req)
        }
    })
}

fn event(value: serde_json::Value) -> String {
    value.to_string()
}

#[test]
fn watch_connects_signed_and_prints_one_line_per_event() {
    let events = [
        event(
            json!({"type": "item", "key": "BUG-7", "host": "shop.example.com", "title": "Cart is empty", "by": {"name": "Grace Hopper"}}),
        ),
        event(
            json!({"type": "move", "key": "BUG-7", "host": "shop.example.com", "title": "Cart is empty", "from": "inbox", "to": "doing", "board": "Web", "by": {"name": "Ada Lovelace", "agent": true}}),
        ),
        event(
            json!({"type": "board.move", "host": "shop.example.com", "board": "Web", "from": "doing", "to": "review"}),
        ),
        event(
            json!({"type": "board", "host": "shop.example.com", "board": "Web", "action": "renamed"}),
        ),
        event(json!({"type": "statuses", "host": "shop.example.com"})),
        event(
            json!({"type": "import", "key": "BUG-9", "host": "shop.example.com", "items": 3, "comments": 5}),
        ),
        "pong".to_owned(),
        "not json at all".to_owned(),
        event(
            json!({"type": "comment", "key": "BUG-8", "host": "shop.example.com", "title": "Last", "by": {"name": "Grace\u{1b}[31m Hopper"}}),
        ),
    ];
    let sent: Vec<String> = events.to_vec();
    let h = streaming("watch-events", move |_, _| {
        let messages: Vec<&str> = sent.iter().map(String::as_str).collect();
        Reply::socket(&messages, false)
    });
    let w = Watching::start(&h, &["watch"], &[]);
    assert_eq!(w.said(), "p99: watching every host, connected");
    let printed: Vec<String> = (0..7).map(|_| w.line()).collect();
    assert_eq!(
        printed,
        [
            "BUG-7  card  shop.example.com  Grace Hopper: Cart is empty",
            "BUG-7  move  shop.example.com  Ada Lovelace 🤖: Cart is empty  Inbox -> Doing on Web",
            "board:Web  board.move  shop.example.com  P99: Doing -> Review",
            "board:Web  board  shop.example.com  P99: renamed",
            "-  statuses  shop.example.com  P99: renamed a status",
            "BUG-9  import  shop.example.com  P99: 3 cards, 5 comments",
            "BUG-8  comment  shop.example.com  Grace[31m Hopper: Last",
        ]
    );
    let call = h.stub.call("GET", "/_p99/v1/stream");
    assert!(call.signed, "the stream opens with a signed request");
    assert_eq!(call.param("host"), None);
    assert_eq!(
        call.header("upgrade")
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("websocket")
    );
}

#[test]
fn watch_json_prints_each_message_as_it_came_but_never_a_pong() {
    let first =
        event(json!({"type": "issue", "key": "BUG-1", "host": "shop.example.com", "title": "One"}));
    let h = streaming("watch-json", {
        let first = first.clone();
        move |_, _| Reply::socket(&["pong", first.as_str(), "plain words"], false)
    });
    let w = Watching::start(&h, &["watch", "--json"], &[]);
    assert_eq!(w.said(), "p99: watching every host, connected");
    assert_eq!(w.line(), first);
    assert_eq!(w.line(), "plain words");
}

#[test]
fn watch_host_asks_for_that_host_only_and_names_it() {
    let h = streaming("watch-host", |_, _| {
        Reply::socket(&[event(json!({"type": "issue", "key": "BUG-2", "host": "shop.example.com", "title": "Two"})).as_str()], false)
    });
    let w = Watching::start(&h, &["watch", "--host", " Shop.Example.COM "], &[]);
    assert_eq!(w.said(), "p99: watching shop.example.com, connected");
    assert_eq!(w.line(), "BUG-2  issue  shop.example.com  P99: Two");
    let call = h.stub.call("GET", "/_p99/v1/stream");
    assert_eq!(call.param("host"), Some("shop.example.com"));
    assert!(call.signed);
}

#[test]
fn watch_reconnects_when_the_worker_closes_and_says_so() {
    let h = streaming("watch-again", |_, at| {
        if at == 0 {
            Reply::socket(&[event(json!({"type": "issue", "key": "BUG-3", "host": "shop.example.com", "title": "Before"})).as_str()], true)
        } else {
            Reply::socket(&[event(json!({"type": "issue", "key": "BUG-4", "host": "shop.example.com", "title": "After"})).as_str()], false)
        }
    });
    let w = Watching::start(&h, &["watch"], &[]);
    assert_eq!(w.said(), "p99: watching every host, connected");
    assert_eq!(w.line(), "BUG-3  issue  shop.example.com  P99: Before");
    assert_eq!(
        w.said(),
        "p99: the stream dropped (the Worker closed the stream); reconnecting in 1 s"
    );
    assert_eq!(w.said(), "p99: watching every host, reconnected");
    assert_eq!(w.line(), "BUG-4  issue  shop.example.com  P99: After");
    let calls = h.stub.calls("GET", "/_p99/v1/stream");
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|c| c.signed));
}

#[test]
fn watch_keeps_trying_through_a_server_error_and_a_dropped_connection() {
    let h = streaming("watch-trouble", |_, at| {
        match at {
        0 => Reply::problem(503, "the hub is busy"),
        1 => Reply::Drop,
        _ => Reply::socket(&[event(json!({"type": "issue", "key": "BUG-5", "host": "shop.example.com", "title": "Back"})).as_str()], false),
    }
    });
    let w = Watching::start(&h, &["watch"], &[]);
    assert_eq!(
        w.said(),
        "p99: the stream dropped (the hub is busy (503)); reconnecting in 1 s"
    );
    let dropped = w.said();
    assert!(
        dropped.starts_with(&format!(
            "p99: the stream dropped (cannot reach {}/_p99: ",
            h.stub.base
        )) && dropped.ends_with("); reconnecting in 2 s"),
        "{dropped}"
    );
    assert_eq!(w.said(), "p99: watching every host, connected");
    assert_eq!(w.line(), "BUG-5  issue  shop.example.com  P99: Back");
}

#[test]
fn watch_stops_on_a_refusal_it_cannot_outwait() {
    let cases: [(&str, Reply, &str); 4] = [
        (
            "watch-401",
            Reply::problem(401, "bad signature"),
            "bad signature (401)",
        ),
        (
            "watch-nohost",
            Reply::problem(404, "no such host shop.example.com"),
            "no such host shop.example.com (404)",
        ),
        (
            "watch-nopush",
            Reply::problem(404, "not found"),
            "this Worker has no push yet; run p99 deploy",
        ),
        (
            "watch-blank",
            Reply::raw(403, "", b""),
            "the Worker answered 403",
        ),
    ];
    for (name, reply, said) in cases {
        let reply = Arc::new(std::sync::Mutex::new(Some(reply)));
        let h = streaming(name, move |_, _| {
            reply
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Reply::problem(500, "asked twice"))
        });
        let out = h.p99(&["watch"]);
        out.refused(said);
        assert!(out.stdout.is_empty(), "{}", out.stdout);
        assert_eq!(h.stub.calls("GET", "/_p99/v1/stream").len(), 1);
    }
}

#[test]
fn watch_names_a_host_that_answers_as_something_else() {
    let h = streaming("watch-page", |_, _| Reply::page(200));
    let host = h.stub.base.trim_start_matches("http://").to_owned();
    h.p99(&["watch"]).refused(&format!(
        "{host} answered with a web page instead of answering as P99"
    ));

    let h = streaming("watch-moved", |_, _| {
        Reply::redirect(302, "https://elsewhere.example.com/")
    });
    let host = h.stub.base.trim_start_matches("http://").to_owned();
    h.p99(&["watch"]).refused(&format!(
        "{host} redirected to elsewhere.example.com instead of answering as P99"
    ));

    let h = streaming("watch-access", |_, _| {
        Reply::redirect(
            302,
            "https://team.cloudflareaccess.com/cdn-cgi/access/login",
        )
    });
    h.p99(&["watch"]).refused(
        "every host of the space main is behind Cloudflare Access, which answered with its login; set `url` for the space to a host that isn't, or set access_client_id and access_client_secret (docs/config.md)",
    );
}

#[test]
fn watch_sends_the_access_service_token_when_the_account_has_one() {
    let stub = Stub::new(|req| {
        if req.is("GET", "/_p99/v1/stream") {
            Reply::socket(&[], false)
        } else {
            fake::any(req)
        }
    });
    let text = home::config(&stub.base).replace(
        "database_id = \"db1\"",
        "database_id = \"db1\"\naccess_client_id = \"id.access\"\naccess_client_secret = \"shh\"",
    );
    let h = Home::with_config("watch-access-token", stub, &text);
    let w = Watching::start(&h, &["watch"], &[]);
    assert_eq!(w.said(), "p99: watching every host, connected");
    let call = h.stub.call("GET", "/_p99/v1/stream");
    assert_eq!(call.header("cf-access-client-id"), Some("id.access"));
    assert_eq!(call.header("cf-access-client-secret"), Some("shh"));
}

#[test]
fn watch_without_a_reachable_worker_keeps_trying() {
    let stub = Stub::new(fake::any);
    let text = home::config(&Stub::closed());
    let h = Home::with_config("watch-gone", stub, &text);
    let w = Watching::start(&h, &["watch"], &[]);
    let first = w.said();
    assert!(
        first.starts_with("p99: the stream dropped (cannot reach ")
            && first.ends_with("); reconnecting in 1 s"),
        "{first}"
    );
}

#[test]
fn watch_refusals_before_any_call() {
    let h = streaming("watch-refusals", |_, _| Reply::problem(500, "never asked"));
    h.p99(&["watch", "--space", "other"])
        .refused("no space is called other");
    h.p99(&["watch", "--hots", "x"])
        .clap("unexpected argument '--hots' found");
    h.p99(&["watch", "--host"])
        .clap("a value is required for '--host <HOST>' but none was supplied");
    assert!(h.stub.seen().is_empty());

    std::fs::remove_file(h.file()).unwrap();
    let out = h.p99(&["watch"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(out.stderr.starts_with("p99: "), "{}", out.stderr);
    assert!(h.stub.seen().is_empty());
}

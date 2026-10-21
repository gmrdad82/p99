use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};

const KEY: &str = "story-account-key-0123456789abcdef";
const ACCESS_ID: &str = "0123456789abcdef.access";
const ACCESS_SECRET: &str = "story-access-secret-fedcba9876543210";
const LOGIN: &str = "https://example.cloudflareaccess.com/cdn-cgi/access/login/example.com?kid=1&redirect_url=%2F_p99";

struct Heard {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Heard {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn through_access(&self) -> bool {
        self.header("cf-access-client-id") == Some(ACCESS_ID)
            && self.header("cf-access-client-secret") == Some(ACCESS_SECRET)
    }
}

type Answer = dyn Fn(&Heard) -> Vec<u8> + Send + Sync;

struct Stub {
    port: u16,
    heard: Arc<Mutex<Vec<Heard>>>,
}

impl Stub {
    fn start(answer: impl Fn(&Heard) -> Vec<u8> + Send + Sync + 'static) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&heard);
        let answer: Arc<Answer> = Arc::new(answer);
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let log = Arc::clone(&log);
                let answer = Arc::clone(&answer);
                thread::spawn(move || serve(stream, &log, answer.as_ref()));
            }
        });
        Stub { port, heard }
    }

    fn base(&self) -> String {
        format!("http://127.0.0.1:{}/_p99", self.port)
    }

    fn count(&self) -> usize {
        self.heard.lock().unwrap().len()
    }
}

fn serve(mut stream: TcpStream, log: &Mutex<Vec<Heard>>, answer: &Answer) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Ok(clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(clone);
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let target = parts.next().unwrap_or_default().to_owned();
    let mut headers = Vec::new();
    loop {
        let mut raw = String::new();
        if reader.read_line(&mut raw).unwrap_or(0) == 0 {
            break;
        }
        let raw = raw.trim_end();
        if raw.is_empty() {
            break;
        }
        if let Some((name, value)) = raw.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }
    }
    let length = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    let heard = Heard {
        method,
        target,
        headers,
        body,
    };
    let reply = answer(&heard);
    log.lock().unwrap().push(heard);
    let _ = stream.write_all(&reply);
    let _ = stream.flush();
}

fn reply(status: u16, kind: &str, extra: &str, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status} Story\r\ncontent-type: {kind}\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

fn json(status: u16, body: &str) -> Vec<u8> {
    reply(status, "application/json", "", body)
}

fn redirect(to: &str) -> Vec<u8> {
    reply(302, "text/plain", &format!("location: {to}\r\n"), "")
}

fn access_gate(heard: &Heard) -> Vec<u8> {
    if heard.through_access() {
        json(200, r#"{"issues":[],"next_cursor":null}"#)
    } else {
        redirect(LOGIN)
    }
}

struct Home {
    dir: PathBuf,
    config: PathBuf,
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

static HOMES: AtomicUsize = AtomicUsize::new(0);

fn home(base: &str, access: &[(&str, &str)]) -> Home {
    let dir = std::env::temp_dir().join(format!(
        "p99-stories-safety-{}-{}",
        std::process::id(),
        HOMES.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let pairs: String = access
        .iter()
        .map(|(k, v)| format!("{k} = \"{v}\"\n"))
        .collect();
    let text = format!(
        "[me]\nname = \"Ada Lovelace\"\nemail = \"ada@example.com\"\n\n[accounts.main]\naccount_id = \"0000\"\ntoken = \"\"\nkey = \"{KEY}\"\nurl = \"{base}\"\n{pairs}\n[hosts.\"example.com\"]\naccount = \"main\"\n"
    );
    let config = dir.join("config.toml");
    fs::write(&config, text).unwrap();
    private(&config);
    Home { dir, config }
}

#[cfg(unix)]
fn private(file: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(file, fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(not(unix))]
fn private(_: &Path) {}

fn p99(home: &Home, args: &[&str]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_p99"))
        .args(args)
        .env("P99_CONFIG", &home.config)
        .env("HOME", &home.dir)
        .env("XDG_CONFIG_HOME", &home.dir)
        .env("NO_COLOR", "1")
        .env_remove("P99_TOKEN")
        .env_remove("P99_AGENT")
        .env_remove("HTTPS_PROXY")
        .env_remove("https_proxy")
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let out = drain(child.stdout.take().unwrap());
    let err = drain(child.stderr.take().unwrap());
    let deadline = Instant::now() + Duration::from_secs(40);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("p99 {} did not stop on its own", args.join(" "));
        }
        thread::sleep(Duration::from_millis(20));
    };
    Output {
        status,
        stdout: out.join().unwrap(),
        stderr: err.join().unwrap(),
    }
}

fn drain(mut from: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = from.read_to_end(&mut bytes);
        bytes
    })
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn keeps_secrets(out: &Output) {
    for said in [text(&out.stdout), text(&out.stderr)] {
        for secret in [KEY, ACCESS_SECRET, "wrong-access-secret"] {
            assert!(
                !said.contains(secret),
                "a secret reached the terminal: {said}"
            );
        }
    }
}

fn signed_by_the_account(heard: &Heard) {
    let auth = heard.header("x-p99-auth").expect("X-P99-Auth");
    let (ts, sig) = auth
        .strip_prefix("v1 ts=")
        .and_then(|rest| rest.split_once(",sig="))
        .expect("v1 ts=…,sig=…");
    let hash = heard.header("x-content-sha256").expect("X-Content-SHA256");
    assert_eq!(hash, format!("{:x}", Sha256::digest(&heard.body)));
    let actor = heard.header("x-p99-actor").unwrap_or("");
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(KEY.as_bytes()).unwrap();
    mac.update(
        format!(
            "v1\n{ts}\n{}\n{}\n{actor}\n{hash}",
            heard.method, heard.target
        )
        .as_bytes(),
    );
    let want: String = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        sig, want,
        "the signature covers {} {}",
        heard.method, heard.target
    );
    assert_eq!(heard.header("x-p99-key-id"), Some("p99"));
    let who: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(actor).unwrap()).unwrap();
    assert_eq!(who["email"], "ada@example.com");
}

#[test]
fn an_access_protected_host_answers_the_cli_through_its_service_token_and_p99_still_signs_every_request()
 {
    let stub = Stub::start(access_gate);
    let home = home(
        &stub.base(),
        &[
            ("access_client_id", ACCESS_ID),
            ("access_client_secret", ACCESS_SECRET),
        ],
    );
    let out = p99(&home, &["list", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(answer, serde_json::json!({"issues": [], "more": false}));
    keeps_secrets(&out);
    let heard = stub.heard.lock().unwrap();
    assert_eq!(heard.len(), 1);
    for request in heard.iter() {
        assert!(
            request.through_access(),
            "{} carried no service token",
            request.target
        );
        assert!(
            request.target.starts_with("/_p99/v1/issues?"),
            "{}",
            request.target
        );
        signed_by_the_account(request);
    }
}

#[test]
fn without_a_service_token_an_access_login_stops_the_cli_with_the_way_in_and_no_made_up_answer() {
    let stub = Stub::start(access_gate);
    let home = home(&stub.base(), &[]);
    let out = p99(&home, &["list", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty(), "{}", text(&out.stdout));
    let said = text(&out.stderr);
    assert!(said.starts_with("p99: "), "{said}");
    assert!(said.contains("behind Cloudflare Access"), "{said}");
    assert!(
        said.contains("access_client_id and access_client_secret"),
        "{said}"
    );
    keeps_secrets(&out);
    let heard = stub.heard.lock().unwrap();
    assert_eq!(heard.len(), 1);
    assert_eq!(heard[0].header("cf-access-client-id"), None);
    assert_eq!(heard[0].header("cf-access-client-secret"), None);
}

#[test]
fn a_wrong_service_token_is_turned_away_and_no_secret_reaches_the_terminal() {
    let stub = Stub::start(access_gate);
    let home = home(
        &stub.base(),
        &[
            ("access_client_id", ACCESS_ID),
            ("access_client_secret", "wrong-access-secret"),
        ],
    );
    let out = p99(&home, &["list", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    assert!(text(&out.stderr).contains("behind Cloudflare Access"));
    keeps_secrets(&out);
    assert_eq!(stub.count(), 1);
}

#[test]
fn half_a_service_token_is_refused_before_any_request_leaves_the_machine() {
    let stub = Stub::start(access_gate);
    for pair in [
        ("access_client_id", ACCESS_ID),
        ("access_client_secret", ACCESS_SECRET),
    ] {
        let home = home(&stub.base(), &[pair]);
        let out = p99(&home, &["list", "--json"]);
        assert_eq!(out.status.code(), Some(1));
        assert!(out.stdout.is_empty());
        assert!(
            text(&out.stderr)
                .contains("needs both access_client_id and access_client_secret, or neither"),
            "{}",
            text(&out.stderr)
        );
        keeps_secrets(&out);
    }
    assert_eq!(stub.count(), 0);
}

#[cfg(unix)]
#[test]
fn a_config_holding_the_service_token_that_others_can_read_is_refused_before_any_request() {
    use std::os::unix::fs::PermissionsExt;
    let stub = Stub::start(access_gate);
    let home = home(
        &stub.base(),
        &[
            ("access_client_id", ACCESS_ID),
            ("access_client_secret", ACCESS_SECRET),
        ],
    );
    fs::set_permissions(&home.config, fs::Permissions::from_mode(0o644)).unwrap();
    let out = p99(&home, &["list", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).contains("chmod 600"),
        "{}",
        text(&out.stderr)
    );
    keeps_secrets(&out);
    assert_eq!(stub.count(), 0);
}

#[test]
fn an_access_page_served_as_html_is_never_taken_for_p99s_answer() {
    for status in [200, 403] {
        let stub = Stub::start(move |_| {
            reply(
                status,
                "text/html; charset=utf-8",
                "",
                "<!doctype html><title>Sign in with Cloudflare Access</title>",
            )
        });
        let home = home(
            &stub.base(),
            &[
                ("access_client_id", ACCESS_ID),
                ("access_client_secret", ACCESS_SECRET),
            ],
        );
        let out = p99(&home, &["list", "--json"]);
        assert_eq!(out.status.code(), Some(1), "status {status}");
        assert!(out.stdout.is_empty());
        assert!(
            text(&out.stderr).contains("answered with a web page instead of answering as P99"),
            "{}",
            text(&out.stderr)
        );
        keeps_secrets(&out);
    }
}

#[test]
fn a_redirect_away_from_the_host_is_not_followed_so_no_signature_or_service_token_travels_on() {
    let elsewhere = Stub::start(|_| json(200, r#"{"issues":[],"next_cursor":null}"#));
    let away = format!("http://127.0.0.1:{}/_p99/v1/issues", elsewhere.port);
    let stub = Stub::start(move |_| redirect(&away));
    let home = home(
        &stub.base(),
        &[
            ("access_client_id", ACCESS_ID),
            ("access_client_secret", ACCESS_SECRET),
        ],
    );
    let out = p99(&home, &["list", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    assert!(
        text(&out.stderr).contains("redirected to 127.0.0.1"),
        "{}",
        text(&out.stderr)
    );
    keeps_secrets(&out);
    assert_eq!(stub.count(), 1);
    assert_eq!(elsewhere.count(), 0);
}

#[test]
fn p99_watch_carries_the_service_token_on_its_stream_and_stops_on_access_or_a_refusal() {
    let stub = Stub::start(|heard| {
        if heard.through_access() {
            json(
                401,
                r#"{"error":"unauthorized","message":"the signature does not verify"}"#,
            )
        } else {
            redirect(LOGIN)
        }
    });
    let with = home(
        &stub.base(),
        &[
            ("access_client_id", ACCESS_ID),
            ("access_client_secret", ACCESS_SECRET),
        ],
    );
    let refused = p99(&with, &["watch"]);
    assert_eq!(refused.status.code(), Some(1));
    let said = text(&refused.stderr);
    assert!(said.starts_with("p99: ") && said.contains("401"), "{said}");
    keeps_secrets(&refused);
    {
        let heard = stub.heard.lock().unwrap();
        assert_eq!(heard.len(), 1);
        assert!(heard[0].through_access());
        assert_eq!(
            heard[0]
                .header("upgrade")
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("websocket")
        );
        assert!(
            heard[0].target.starts_with("/_p99/v1/stream"),
            "{}",
            heard[0].target
        );
        signed_by_the_account(&heard[0]);
    }
    let without = home(&stub.base(), &[]);
    let gated = p99(&without, &["watch"]);
    assert_eq!(gated.status.code(), Some(1));
    assert!(
        text(&gated.stderr).contains("behind Cloudflare Access"),
        "{}",
        text(&gated.stderr)
    );
    keeps_secrets(&gated);
    assert_eq!(stub.count(), 2);
}

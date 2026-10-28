#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const KEY: &str = "test-secret";

#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    pub target: String,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub signed: bool,
    pub connection: usize,
}

impl Req {
    pub fn signed_by(&self, key: &str) -> bool {
        signed(
            key.as_bytes(),
            &self.method,
            &self.target,
            &self.headers,
            &self.body,
        )
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn params(&self, name: &str) -> Vec<&str> {
        self.query
            .iter()
            .filter(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
            .collect()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn is(&self, method: &str, path: &str) -> bool {
        self.method == method && self.path == path
    }

    pub fn under(&self, method: &str, prefix: &str) -> bool {
        self.method == method && self.path.starts_with(prefix)
    }

    pub fn tail(&self, prefix: &str) -> &str {
        self.path.strip_prefix(prefix).unwrap_or("")
    }

    pub fn actor(&self) -> Value {
        use base64::Engine;
        let raw = self.header("x-p99-actor").unwrap_or("");
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(raw)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null)
    }
}

pub enum Reply {
    Answer {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    Drop,
    Socket {
        messages: Vec<String>,
        close: bool,
    },
}

impl Reply {
    pub fn json(status: u16, body: Value) -> Reply {
        Reply::raw(status, "application/json", body.to_string().as_bytes())
    }

    pub fn ok(body: Value) -> Reply {
        Reply::json(200, body)
    }

    pub fn problem(status: u16, message: &str) -> Reply {
        Reply::json(status, json!({"error": "refused", "message": message}))
    }

    pub fn raw(status: u16, kind: &str, body: &[u8]) -> Reply {
        let headers = if kind.is_empty() {
            Vec::new()
        } else {
            vec![("content-type".to_owned(), kind.to_owned())]
        };
        Reply::Answer {
            status,
            headers,
            body: body.to_vec(),
        }
    }

    pub fn redirect(status: u16, location: &str) -> Reply {
        Reply::Answer {
            status,
            headers: vec![("location".to_owned(), location.to_owned())],
            body: Vec::new(),
        }
    }

    pub fn page(status: u16) -> Reply {
        Reply::raw(
            status,
            "text/html; charset=utf-8",
            b"<html><body>Sign in</body></html>",
        )
    }

    pub fn with(mut self, name: &str, value: &str) -> Reply {
        if let Reply::Answer { headers, .. } = &mut self {
            headers.push((name.to_owned(), value.to_owned()));
        }
        self
    }

    pub fn socket(messages: &[&str], close: bool) -> Reply {
        Reply::Socket {
            messages: messages.iter().map(|m| (*m).to_owned()).collect(),
            close,
        }
    }

    pub fn cf(result: Value) -> Reply {
        Reply::ok(json!({"success": true, "errors": [], "result": result}))
    }

    pub fn cf_error(status: u16, code: i64, message: &str) -> Reply {
        Reply::json(
            status,
            json!({"success": false, "errors": [{"code": code, "message": message}], "result": null}),
        )
    }
}

type Handler = Arc<dyn Fn(&Req) -> Reply + Send + Sync>;

#[derive(Clone)]
pub struct Stub {
    pub base: String,
    seen: Arc<Mutex<Vec<Req>>>,
}

impl Stub {
    pub fn new(handler: impl Fn(&Req) -> Reply + Send + Sync + 'static) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let stub = Stub {
            base,
            seen: Arc::default(),
        };
        let handler: Handler = Arc::new(handler);
        let shared = stub.clone();
        let count = Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let handler = Arc::clone(&handler);
                let shared = shared.clone();
                let connection = count.fetch_add(1, Ordering::SeqCst);
                std::thread::spawn(move || shared.serve(stream, &handler, connection));
            }
        });
        stub
    }

    pub fn closed() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        base
    }

    pub fn worker(&self) -> String {
        format!("{}/_p99", self.base)
    }

    pub fn seen(&self) -> Vec<Req> {
        self.seen.lock().unwrap().clone()
    }

    pub fn calls(&self, method: &str, path: &str) -> Vec<Req> {
        self.seen()
            .into_iter()
            .filter(|r| r.is(method, path))
            .collect()
    }

    pub fn call(&self, method: &str, path: &str) -> Req {
        let found = self.calls(method, path);
        assert_eq!(
            found.len(),
            1,
            "{method} {path} once; saw {:?}",
            self.seen()
                .iter()
                .map(|r| format!("{} {}", r.method, r.target))
                .collect::<Vec<_>>()
        );
        found.into_iter().next().unwrap()
    }

    pub fn under(&self, method: &str, prefix: &str) -> Vec<Req> {
        self.seen()
            .into_iter()
            .filter(|r| r.under(method, prefix))
            .collect()
    }

    pub fn writes(&self) -> Vec<Req> {
        self.seen()
            .into_iter()
            .filter(|r| r.method != "GET")
            .collect()
    }

    fn serve(&self, stream: TcpStream, handler: &Handler, connection: usize) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let Some(req) = read(&stream, KEY.as_bytes(), connection) else {
            return;
        };
        let reply = handler(&req);
        self.seen.lock().unwrap().push(req.clone());
        match reply {
            Reply::Drop => drop(stream),
            Reply::Answer {
                status,
                headers,
                body,
            } => {
                let mut head = format!("HTTP/1.1 {status} {}\r\n", reason(status));
                for (k, v) in &headers {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str(&format!(
                    "content-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                ));
                let mut stream = stream;
                let mut whole = head.into_bytes();
                whole.extend_from_slice(&body);
                let _ = stream.write_all(&whole);
                let _ = stream.flush();
            }
            Reply::Socket { messages, close } => socket(stream, &req, &messages, close),
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        101 => "Switching Protocols",
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

fn socket(mut stream: TcpStream, req: &Req, messages: &[String], close: bool) {
    let key = req.header("sec-websocket-key").unwrap_or("");
    let accept = tungstenite::handshake::derive_accept_key(key.as_bytes());
    let head = format!(
        "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: {accept}\r\n\r\n"
    );
    if stream.write_all(head.as_bytes()).is_err() {
        return;
    }
    let mut ws =
        tungstenite::WebSocket::from_raw_socket(stream, tungstenite::protocol::Role::Server, None);
    for message in messages {
        if ws
            .send(tungstenite::Message::text(message.clone()))
            .is_err()
        {
            return;
        }
    }
    if close {
        let _ = ws.close(None);
        let _ = ws.flush();
        let _ = ws.read();
        return;
    }
    let _ = ws.get_ref().set_read_timeout(Some(Duration::from_secs(30)));
    while ws.read().is_ok() {}
}

fn read(stream: &TcpStream, key: &[u8], connection: usize) -> Option<Req> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = header.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_owned()));
        }
    }
    let find = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    let length: usize = find("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    let mut chunked = find("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"));
    while chunked {
        let mut size = String::new();
        reader.read_line(&mut size).ok()?;
        let n = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
        let mut chunk = vec![0; n + 2];
        reader.read_exact(&mut chunk).ok()?;
        body.extend_from_slice(&chunk[..n]);
        chunked = n > 0;
    }
    let (path, raw) = target.split_once('?').unwrap_or((&target, ""));
    let query = raw
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decode(k), decode(v))
        })
        .collect();
    let signed = signed(key, &method, &target, &headers, &body);
    Some(Req {
        method,
        path: path.to_owned(),
        target,
        query,
        headers,
        body,
        signed,
        connection,
    })
}

fn signed(
    key: &[u8],
    method: &str,
    target: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> bool {
    let find = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    };
    let Some(auth) = find("x-p99-auth") else {
        return false;
    };
    let Some(rest) = auth.strip_prefix("v1 ts=") else {
        return false;
    };
    let Some((ts, sig)) = rest.split_once(",sig=") else {
        return false;
    };
    let sha = hex(&Sha256::digest(body));
    if find("x-content-sha256") != Some(sha.as_str()) || find("x-p99-key-id") != Some("p99") {
        return false;
    }
    let actor = find("x-p99-actor").unwrap_or("");
    let message = format!("v1\n{ts}\n{method}\n{target}\n{actor}\n{sha}");
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).unwrap();
    mac.update(message.as_bytes());
    hex(&mac.finalize().into_bytes()) == sig
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                match std::str::from_utf8(bytes.get(i + 1..i + 3).unwrap_or(b""))
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn scratch(name: &str) -> PathBuf {
    let root = option_env!("CARGO_TARGET_TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("tmp")
        });
    let dir = root.join(format!("p99-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn project_of(host: &str) -> &'static str {
    if host == "shop.example.com" {
        "Shop"
    } else {
        "Blog"
    }
}

pub fn projects_of(hosts: &[&str]) -> Vec<&'static str> {
    let mut projects: Vec<&'static str> = Vec::new();
    for host in hosts {
        let project = project_of(host);
        if !projects.contains(&project) {
            projects.push(project);
        }
    }
    projects
}

pub fn code(id: i64, name: &str, email: &str, hosts: &[&str]) -> Value {
    json!({
        "id": id,
        "name": name,
        "email": email,
        "grant": {"projects": projects_of(hosts)},
        "hosts": hosts,
        "manager": false,
        "hint": "k3x9",
        "created_at": "2026-10-01T09:30:00.000Z",
        "created_by": "ada@example.com",
        "revoked_at": null,
        "last_used_at": null,
        "totp": false,
    })
}

pub fn summary(id: i64, title: &str, updated: &str) -> Value {
    json!({
        "id": id,
        "key": format!("BUG-{id}"),
        "kind": "bug",
        "status": "inbox",
        "stage": "received",
        "label": "Inbox",
        "title": title,
        "host": "shop.example.com",
        "env": "production",
        "reporter": {"email": "grace@example.com", "name": "Grace Hopper"},
        "created_at": "2026-10-01T09:30:00.000Z",
        "updated_at": updated,
        "comments": 0,
    })
}

pub fn issue(id: i64, title: &str) -> Value {
    json!({
        "id": id,
        "key": format!("BUG-{id}"),
        "kind": "bug",
        "status": "inbox",
        "stage": "received",
        "label": "Inbox",
        "title": title,
        "host": "shop.example.com",
        "env": "production",
        "page": {"url": "https://shop.example.com/cart", "path": "/cart", "title": "Cart"},
        "reporter": {"email": "grace@example.com", "name": "Grace Hopper"},
        "created_at": "2026-10-01T09:30:00.000Z",
        "updated_at": "2026-10-02T10:00:00.000Z",
        "body": "The total stays at zero.",
    })
}

pub fn thread(id: i64, title: &str) -> Value {
    json!({"issue": issue(id, title), "comments": [], "attachments": [], "events": []})
}

pub fn host_entry(host: &str, env: &str) -> Value {
    json!({"host": host, "env": env, "config": {}, "project": project_of(host), "created_at": "2026-10-01T09:30:00.000Z"})
}

pub fn minted(id: i64, name: &str, email: &str, hosts: &[&str], mail: Option<&str>) -> Value {
    let mut minted = json!({
        "code": code(id, name, email, hosts),
        "secret": "abcd-efgh-jkmn",
        "links": hosts.iter().map(|h| format!("https://{h}/#p99=abcdefghjkmn")).collect::<Vec<_>>(),
    });
    if let Some(mail) = mail {
        minted["mail"] = json!(mail);
    }
    minted
}

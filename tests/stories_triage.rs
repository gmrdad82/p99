use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

const KEY: &str = "test-secret";
const HOST: &str = "shop.example.com";
const LANES: [(&str, &str, bool); 7] = [
    ("new", "New", false),
    ("planned", "Planned", false),
    ("in-progress", "In progress", false),
    ("needs-you", "Needs you", false),
    ("stuck", "Stuck", false),
    ("landed", "Landed", false),
    ("done", "Done", true),
];
const DEADLINE: Duration = Duration::from_secs(40);
const UNSAFE: &[char] = &[
    '\u{1b}', '\u{7}', '\u{9b}', '\u{200e}', '\u{200f}', '\u{202a}', '\u{202b}', '\u{202c}',
    '\u{202d}', '\u{202e}', '\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}',
];

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn iso(seconds: i64) -> String {
    let (day, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let days = day + 719_468;
    let era = days.div_euclid(146_097);
    let of_era = days - era * 146_097;
    let of_cycle = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * of_cycle + of_cycle / 4 - of_cycle / 100);
    let index = (5 * of_year + 2) / 153;
    let date = of_year - (153 * index + 2) / 5 + 1;
    let month = if index < 10 { index + 3 } else { index - 9 };
    let year = of_cycle + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{date:02}T{:02}:{:02}:{:02}.000Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn fold(text: &str) -> String {
    text.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(pair, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
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

#[derive(Debug, Clone)]
struct Req {
    method: String,
    target: String,
    account: String,
    path: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    signed: bool,
}

impl Req {
    fn param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn is(&self, method: &str, path: &str) -> bool {
        self.method == method && self.path == path
    }

    fn on_item(&self, method: &str, id: i64) -> bool {
        self.is(method, &format!("/v1/issues/{id}"))
            || self.is(method, &format!("/v1/issues/BUG-{id}"))
    }
}

struct Gate {
    count: Mutex<usize>,
    need: usize,
    ready: Condvar,
}

impl Gate {
    fn new(need: usize) -> Arc<Gate> {
        Arc::new(Gate {
            count: Mutex::new(0),
            need,
            ready: Condvar::new(),
        })
    }

    fn pass(&self) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut count = self.count.lock().unwrap();
        *count += 1;
        self.ready.notify_all();
        while *count < self.need {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            count = self.ready.wait_timeout(count, left).unwrap().0;
        }
    }
}

struct Reply {
    status: u16,
    kind: &'static str,
    body: String,
    delay: Duration,
    gate: Option<Arc<Gate>>,
    stall: bool,
}

impl Reply {
    fn json(status: u16, body: Value) -> Reply {
        Reply {
            status,
            kind: "application/json",
            body: body.to_string(),
            delay: Duration::ZERO,
            gate: None,
            stall: false,
        }
    }

    fn problem(status: u16, error: &str, message: &str) -> Reply {
        Reply::json(status, json!({"error": error, "message": message}))
    }

    fn raw(status: u16, kind: &'static str, body: &str) -> Reply {
        Reply {
            kind,
            body: body.to_owned(),
            ..Reply::json(status, Value::Null)
        }
    }

    fn after(mut self, delay: Duration) -> Reply {
        self.delay = delay;
        self
    }

    fn gated(mut self, gate: &Arc<Gate>) -> Reply {
        self.gate = Some(Arc::clone(gate));
        self
    }

    fn stalled() -> Reply {
        Reply {
            stall: true,
            ..Reply::json(200, Value::Null)
        }
    }
}

#[derive(Debug, Clone)]
struct Item {
    account: String,
    id: i64,
    kind: String,
    title: String,
    body: String,
    label: String,
    host: String,
    assignee: Option<String>,
    resolution: Option<String>,
    duplicate_of: Option<String>,
    reporter: (String, String),
    updated: i64,
    events: Vec<Value>,
    nameless: bool,
}

impl Item {
    fn new(id: i64, title: &str) -> Item {
        Item {
            account: "main".to_owned(),
            id,
            kind: "bug".to_owned(),
            title: title.to_owned(),
            body: String::new(),
            label: "New".to_owned(),
            host: HOST.to_owned(),
            assignee: None,
            resolution: None,
            duplicate_of: None,
            reporter: ("Grace Hopper".to_owned(), "grace@example.com".to_owned()),
            updated: unix_now() - 7200,
            events: Vec::new(),
            nameless: false,
        }
    }

    fn closed(mut self, resolution: &str) -> Item {
        self.label = "Done".to_owned();
        self.resolution = Some(resolution.to_owned());
        self
    }

    fn key(&self) -> String {
        let prefix = match self.kind.as_str() {
            "bug" => "BUG",
            "feature" => "FEAT",
            "improvement" => "IMP",
            "question" => "Q",
            "task" => "TASK",
            _ => "ITEM",
        };
        format!("{prefix}-{}", self.id)
    }

    fn open(&self) -> bool {
        self.resolution.is_none()
    }

    fn stage(&self) -> &'static str {
        match self.resolution.as_deref() {
            Some("abandoned") => "dropped",
            Some("duplicate") => "duplicate",
            Some(_) => "fixed",
            None if self.label == "New" => "received",
            None => "in_progress",
        }
    }

    fn assignee(&self) -> Value {
        match (&self.assignee, self.nameless) {
            (Some(_), true) => json!({"username": null}),
            (Some(who), false) => json!({"username": who}),
            (None, _) => Value::Null,
        }
    }

    fn summary(&self) -> Value {
        json!({
            "id": self.id,
            "key": self.key(),
            "kind": self.kind,
            "stage": self.stage(),
            "label": self.label,
            "resolution": self.resolution,
            "title": self.title,
            "host": self.host,
            "env": "production",
            "page": {"url": format!("https://{}/checkout", self.host), "path": "/checkout", "title": "Checkout"},
            "reporter": {"email": self.reporter.1, "name": self.reporter.0, "agent": false},
            "assignee": self.assignee(),
            "created_at": iso(self.updated - 3600),
            "updated_at": iso(self.updated),
            "comments": 0,
            "attachments": 0,
            "unread": false,
            "landing": {"branch": false, "envs": []},
        })
    }

    fn issue(&self) -> Value {
        let mut issue = self.summary();
        issue["body"] = json!(self.body);
        issue["duplicate_of"] = json!(self.duplicate_of);
        issue["closed_at"] = if self.open() {
            Value::Null
        } else {
            json!(iso(self.updated))
        };
        issue["context"] = json!({});
        issue["marks"] = json!([]);
        issue["commits"] = json!([]);
        issue["github"] = json!([]);
        issue
    }

    fn board_card(&self, at: usize) -> Value {
        json!({
            "key": self.key(),
            "kind": self.kind,
            "project": null,
            "status": LANES[at].0,
            "label": self.label,
            "lane": if LANES[at].2 { Value::Null } else { json!(1) },
            "title": self.title,
            "host": self.host,
            "assignee": self.assignee.clone().filter(|_| !self.nameless),
            "order": null,
            "changed_at": iso(self.updated),
            "changed_by": null,
        })
    }

    fn card(&self) -> Value {
        json!({
            "key": self.key(),
            "kind": self.kind,
            "title": self.title,
            "label": self.label,
            "assignee": self.assignee(),
            "order": null,
        })
    }
}

fn lane_of(raw: &str) -> Option<(usize, &'static str, &'static str, bool)> {
    LANES
        .iter()
        .enumerate()
        .find(|(_, (word, label, _))| *word == raw || label.eq_ignore_ascii_case(raw.trim()))
        .map(|(at, (word, label, closes))| (at, *word, *label, *closes))
}

fn lanes_json() -> Value {
    json!(
        LANES
            .iter()
            .map(|(word, label, closes)| json!({"word": word, "label": label, "closes": closes}))
            .collect::<Vec<_>>()
    )
}

struct World {
    items: Vec<Item>,
    people: Vec<String>,
    me: String,
}

impl World {
    fn new(items: Vec<Item>) -> World {
        World {
            items,
            people: vec!["ada.lovelace".to_owned(), "grace.hopper".to_owned()],
            me: "ada.lovelace".to_owned(),
        }
    }

    fn many(count: i64) -> World {
        World::new(
            (1..=count)
                .map(|id| Item::new(id, &format!("Report number {id}")))
                .collect(),
        )
    }

    fn item(&mut self, account: &str, raw: &str) -> Option<&mut Item> {
        let digits = raw.rsplit('-').next().unwrap_or(raw);
        let id: i64 = digits.trim().parse().ok()?;
        self.items
            .iter_mut()
            .find(|i| i.account == account && i.id == id)
    }

    fn get(&self, id: i64) -> Item {
        self.items.iter().find(|i| i.id == id).cloned().unwrap()
    }

    fn answer(&mut self, req: &Req) -> Reply {
        let parts: Vec<&str> = req.path.trim_start_matches('/').split('/').collect();
        match (req.method.as_str(), parts.as_slice()) {
            ("GET", ["v1", "issues"]) => self.list(req),
            ("GET", ["v1", "issues", key]) => match self.item(&req.account, key) {
                Some(item) => Reply::json(
                    200,
                    json!({"issue": item.issue(), "comments": [], "attachments": [], "events": item.events}),
                ),
                None => Reply::problem(404, "not_found", "no such item"),
            },
            ("PATCH", ["v1", "issues", key]) => self.patch(req, key),
            ("POST", ["v1", "move"]) => self.shift(req),
            ("GET", ["v1", "board"]) => {
                let statuses: Vec<&str> = req
                    .query
                    .iter()
                    .filter(|(k, _)| k == "status")
                    .map(|(_, v)| v.as_str())
                    .collect();
                let mut cards: Vec<(usize, &Item)> = self
                    .items
                    .iter()
                    .filter(|i| i.account == req.account)
                    .filter_map(|i| lane_of(&i.label).map(|(at, ..)| (at, i)))
                    .filter(|(at, _)| statuses.is_empty() || statuses.contains(&LANES[*at].0))
                    .collect();
                cards.sort_by_key(|(at, i)| (*at, std::cmp::Reverse(i.id)));
                let cards: Vec<Value> = cards.iter().map(|(at, i)| i.board_card(*at)).collect();
                Reply::json(
                    200,
                    json!({"board": {"lanes": lanes_json()}, "cards": cards}),
                )
            }
            ("GET", ["v1", "labels"]) => {
                let labels: Vec<Value> = LANES
                    .iter()
                    .enumerate()
                    .map(|(at, (word, label, closes))| json!({"id": 10 + at, "name": label, "word": word, "closes": closes, "boards": []}))
                    .collect();
                Reply::json(200, json!({ "labels": labels }))
            }
            ("GET", ["v1", "cards", "waiting"]) => {
                Reply::json(200, json!({"count": 0, "cards": []}))
            }
            ("GET", ["v1", "projects"]) => Reply::json(200, json!({"projects": []})),
            ("GET", ["v1", "people"]) => {
                let people: Vec<Value> = self
                    .people
                    .iter()
                    .map(|u| json!({"username": u, "manager": true}))
                    .collect();
                Reply::json(200, json!({ "people": people }))
            }
            _ => Reply::problem(404, "not_found", "no such route"),
        }
    }

    fn list(&self, req: &Req) -> Reply {
        let wanted = req.param("q").map(fold).unwrap_or_default();
        if req.param("q").is_some_and(|q| q.chars().count() > 200) {
            return Reply::problem(400, "bad_request", "q must be at most 200 characters");
        }
        let limit: usize = match req.param("limit").map(str::parse) {
            None => 50,
            Some(Ok(n)) if (1..=100).contains(&n) => n,
            Some(_) => return Reply::problem(400, "bad_request", "limit must be 1 to 100"),
        };
        let kind = req.param("kind");
        if kind.is_some_and(|k| !["bug", "feature", "improvement", "question", "task"].contains(&k))
        {
            return Reply::problem(400, "bad_request", "kind is not known");
        }
        let status = req.param("status").unwrap_or("any");
        let host = req.param("host").filter(|h| *h != "*");
        let label = req.param("label");
        let cursor: Option<i64> = req.param("cursor").and_then(|c| c.parse().ok());
        let mut found: Vec<&Item> = self
            .items
            .iter()
            .filter(|i| {
                i.account == req.account
                    && host.is_none_or(|h| i.host == h)
                    && match status {
                        "open" => i.open(),
                        "closed" => !i.open(),
                        _ => true,
                    }
                    && kind.is_none_or(|k| i.kind == k)
                    && label.is_none_or(|l| i.label.eq_ignore_ascii_case(l))
                    && cursor.is_none_or(|c| i.id < c)
                    && (wanted.is_empty()
                        || fold(&format!("{} {}", i.title, i.body)).contains(&wanted))
            })
            .collect();
        found.sort_by_key(|i| std::cmp::Reverse(i.id));
        let total = found.len();
        let more = total > limit;
        found.truncate(limit);
        let next = if more {
            found.last().map(|i| i.id.to_string())
        } else {
            None
        };
        let mut answer = json!({"issues": found.iter().map(|i| i.summary()).collect::<Vec<_>>(), "next_cursor": next});
        if cursor.is_none() {
            answer["total"] = json!(total);
        }
        Reply::json(200, answer)
    }

    fn patch(&mut self, req: &Req, key: &str) -> Reply {
        let body = req.json();
        let (me, people) = (self.me.clone(), self.people.clone());
        let Some(item) = self.item(&req.account, key) else {
            return Reply::problem(404, "not_found", "no such item");
        };
        if let Some(who) = body.get("assignee") {
            match who.as_str() {
                None => item.assignee = None,
                Some(raw) => {
                    let asked = raw.trim().trim_start_matches('@').to_lowercase();
                    let asked = if asked == "me" { me } else { asked };
                    if !people.contains(&asked) {
                        let said = format!("@{asked} is not a member of {}", item.host);
                        return Reply::problem(400, "bad_request", &said);
                    }
                    item.assignee = Some(asked);
                }
            }
        }
        if let Some(resolution) = body.get("resolution") {
            let of = body.get("duplicate_of").and_then(Value::as_str);
            match resolution.as_str() {
                None => {
                    item.resolution = None;
                    item.label = "New".to_owned();
                }
                Some("duplicate") if of.is_none() => {
                    return Reply::problem(400, "bad_request", "a duplicate needs duplicate_of");
                }
                Some(r) => {
                    item.resolution = Some(r.to_owned());
                    item.label = "Done".to_owned();
                    item.duplicate_of = of.map(str::to_owned);
                }
            }
        }
        if let Some(title) = body.get("title").and_then(Value::as_str) {
            item.title = title.to_owned();
        }
        if let Some(text) = body.get("body").and_then(Value::as_str) {
            item.body = text.to_owned();
        }
        item.updated = unix_now();
        Reply::json(200, item.issue())
    }

    fn shift(&mut self, req: &Req) -> Reply {
        let body = req.json();
        let text = |field: &str| {
            body.get(field)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let (key, from, to) = (text("key"), text("from"), text("to"));
        let Some((_, _, label, closes)) = lane_of(&to) else {
            let words: Vec<&str> = LANES.iter().map(|l| l.0).collect();
            let said = format!(
                "{to} is not a lane; give {} or a lane's name",
                words.join(", ")
            );
            return Reply::problem(400, "bad_request", &said);
        };
        let label = label.to_owned();
        let Some(item) = self.item(&req.account, &key) else {
            return Reply::problem(404, "not_found", &format!("no item {key}"));
        };
        if lane_of(&from).map(|l| l.2) != lane_of(&item.label).map(|l| l.2) {
            return Reply::problem(409, "moved", "this card moved; refreshed");
        }
        item.label = label;
        item.resolution = if closes {
            Some(
                item.resolution
                    .clone()
                    .unwrap_or_else(|| "fixed".to_owned()),
            )
        } else {
            None
        };
        item.updated = unix_now();
        Reply::json(200, json!({"card": item.card()}))
    }
}

type Hook = dyn Fn(&Req, &mut World) -> Option<Reply> + Send + Sync;

struct Shared {
    world: Mutex<World>,
    seen: Mutex<Vec<Req>>,
    hook: Box<Hook>,
    over: AtomicBool,
    stop: Mutex<bool>,
    stopped: Condvar,
}

struct Stub {
    port: u16,
    shared: Arc<Shared>,
}

impl Stub {
    fn start(world: World) -> Stub {
        Stub::hooked(world, |_, _| None)
    }

    fn hooked(
        world: World,
        hook: impl Fn(&Req, &mut World) -> Option<Reply> + Send + Sync + 'static,
    ) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let shared = Arc::new(Shared {
            world: Mutex::new(world),
            seen: Mutex::new(Vec::new()),
            hook: Box::new(hook),
            over: AtomicBool::new(false),
            stop: Mutex::new(false),
            stopped: Condvar::new(),
        });
        let serving = Arc::clone(&shared);
        thread::spawn(move || {
            for stream in listener.incoming() {
                if serving.over.load(Ordering::Relaxed) {
                    return;
                }
                let Ok(stream) = stream else { continue };
                let shared = Arc::clone(&serving);
                thread::spawn(move || serve(stream, &shared));
            }
        });
        Stub { port, shared }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/_p99", self.port)
    }

    fn url_of(&self, account: &str) -> String {
        format!("http://127.0.0.1:{}/{account}/_p99", self.port)
    }

    fn seen(&self) -> Vec<Req> {
        self.shared
            .seen
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path != "/v1/stream")
            .cloned()
            .collect()
    }

    fn sent(&self, method: &str, path: &str) -> Vec<Req> {
        self.seen()
            .into_iter()
            .filter(|r| r.is(method, path))
            .collect()
    }

    fn world<T>(&self, work: impl FnOnce(&mut World) -> T) -> T {
        work(&mut self.shared.world.lock().unwrap())
    }

    fn all_signed(&self) {
        let seen = self.shared.seen.lock().unwrap();
        assert!(!seen.is_empty(), "no request reached the Worker");
        for req in seen.iter() {
            assert!(req.signed, "{} {} was not signed", req.method, req.target);
        }
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.shared.over.store(true, Ordering::Relaxed);
        *self.shared.stop.lock().unwrap() = true;
        self.shared.stopped.notify_all();
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn signed(req: &Req) -> bool {
    let (Some(auth), Some(hash)) = (req.header("x-p99-auth"), req.header("x-content-sha256"))
    else {
        return false;
    };
    let actor = req.header("x-p99-actor").unwrap_or_default();
    if hex(&Sha256::digest(&req.body)) != hash || req.header("x-p99-key-id") != Some("p99") {
        return false;
    }
    let Some((ts, sig)) = auth
        .strip_prefix("v1 ts=")
        .and_then(|rest| rest.split_once(",sig="))
    else {
        return false;
    };
    let message = format!("v1\n{ts}\n{}\n{}\n{actor}\n{hash}", req.method, req.target);
    let mut mac = Hmac::<Sha256>::new_from_slice(KEY.as_bytes()).unwrap();
    mac.update(message.as_bytes());
    hex(&mac.finalize().into_bytes()) == sig
}

fn read_request(stream: &TcpStream) -> Option<Req> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut words = line.split_whitespace();
    let (method, target) = (words.next()?.to_owned(), words.next()?.to_owned());
    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).ok()?;
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.push((name.trim().to_owned(), value.trim().to_owned()));
        }
    }
    let length: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    let (whole, search) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let (account, path) = match whole.strip_prefix("/_p99") {
        Some(rest) => ("main".to_owned(), rest.to_owned()),
        None => {
            let rest = whole.trim_start_matches('/');
            let (account, tail) = rest.split_once('/').unwrap_or((rest, ""));
            let path = format!("/{tail}");
            (
                account.to_owned(),
                path.strip_prefix("/_p99").unwrap_or(&path).to_owned(),
            )
        }
    };
    let query = search
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(k), decode(v))
        })
        .collect();
    let mut req = Req {
        method,
        target: target.clone(),
        account,
        path,
        query,
        headers,
        body,
        signed: false,
    };
    req.signed = signed(&req);
    Some(req)
}

fn serve(mut stream: TcpStream, shared: &Shared) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let Some(req) = read_request(&stream) else {
        return;
    };
    shared.seen.lock().unwrap().push(req.clone());
    let reply = if req.signed {
        let mut guard = shared.world.lock().unwrap();
        let world = &mut *guard;
        (shared.hook)(&req, world).unwrap_or_else(|| world.answer(&req))
    } else {
        Reply::problem(401, "unauthorized", "unauthorized")
    };
    if !reply.delay.is_zero() {
        thread::sleep(reply.delay);
    }
    if let Some(gate) = &reply.gate {
        gate.pass();
    }
    if reply.stall {
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut stop = shared.stop.lock().unwrap();
        while !*stop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            stop = shared.stopped.wait_timeout(stop, left).unwrap().0;
        }
        return;
    }
    let reason = match reply.status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Status",
    };
    let head = format!(
        "HTTP/1.1 {} {reason}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        reply.status,
        reply.kind,
        reply.body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(reply.body.as_bytes());
    let _ = stream.flush();
}

struct Home {
    dir: PathBuf,
    config: PathBuf,
}

impl Home {
    fn new(name: &str, accounts: &[(&str, String)]) -> Home {
        Home::keyed(name, accounts, KEY)
    }

    fn keyed(name: &str, accounts: &[(&str, String)], key: &str) -> Home {
        let dir =
            std::env::temp_dir().join(format!("p99-stories-triage-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("run")).unwrap();
        let mut text = String::from("[me]\nname = \"Ada Lovelace\"\nemail = \"ada@example.com\"\n");
        for (account, url) in accounts {
            text.push_str(&format!(
                "\n[spaces.{account}]\naccount_id = \"test\"\ntoken = \"\"\nkey = \"{key}\"\nurl = \"{url}\"\n"
            ));
        }
        text.push_str(&format!(
            "\n[hosts.\"{HOST}\"]\nspace = \"{}\"\nenv = \"production\"\n",
            accounts[0].0
        ));
        let config = dir.join("config.toml");
        fs::write(&config, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&config, fs::Permissions::from_mode(0o600)).unwrap();
        }
        Home { dir, config }
    }

    fn of(name: &str, stub: &Stub) -> Home {
        Home::new(name, &[("main", stub.url())])
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_p99"));
        command
            .args(args)
            .env("P99_CONFIG", &self.config)
            .env("HOME", &self.dir)
            .env("XDG_CONFIG_HOME", self.dir.join("xdg"))
            .env("XDG_RUNTIME_DIR", self.dir.join("run"))
            .env("NO_COLOR", "1")
            .env_remove("P99_TOKEN")
            .env_remove("P99_AGENT")
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("HTTPS_PROXY")
            .env_remove("https_proxy")
            .env_remove("HTTP_PROXY")
            .env_remove("http_proxy")
            .env_remove("ALL_PROXY")
            .env_remove("all_proxy")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    fn run(&self, args: &[&str]) -> Run {
        run(self.command(args))
    }

    fn ok(&self, args: &[&str]) -> String {
        let run = self.run(args);
        assert_eq!(
            run.code,
            Some(0),
            "p99 {args:?}\nstdout: {}\nstderr: {}",
            run.out,
            run.err
        );
        run.out
    }

    fn screen(&self, size: &str, keys: &str) -> String {
        let mut args = vec!["tui", "--dump", size];
        if !keys.is_empty() {
            args.extend(["--keys", keys]);
        }
        self.ok(&args)
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

struct Run {
    code: Option<i32>,
    out: String,
    err: String,
}

fn run(mut command: Command) -> Run {
    let mut child = command.spawn().unwrap();
    let pipe = |mut from: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = from.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let out = pipe(Box::new(child.stdout.take().unwrap()));
    let err = pipe(Box::new(child.stderr.take().unwrap()));
    let deadline = Instant::now() + DEADLINE;
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("p99 did not finish in {} s", DEADLINE.as_secs());
        }
        thread::sleep(Duration::from_millis(10));
    };
    Run {
        code: status.code(),
        out: out.join().unwrap(),
        err: err.join().unwrap(),
    }
}

fn typed(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            ' ' => "space".to_owned(),
            c => c.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn rows_with<'a>(screen: &'a str, needle: &str) -> Vec<&'a str> {
    screen.lines().filter(|l| l.contains(needle)).collect()
}

fn has_key(screen: &str, key: &str) -> bool {
    screen.lines().any(|line| {
        line.match_indices(key).any(|(at, _)| {
            let next = line[at + key.len()..].chars().next();
            next.is_none_or(|c| !c.is_ascii_digit())
        })
    })
}

fn no_tricks(text: &str) {
    for &c in UNSAFE {
        assert!(
            !text.contains(c),
            "U+{:04X} reached the terminal:\n{text}",
            c as u32
        );
    }
}

fn lone_error(run: &Run, said: &str) {
    assert_eq!(
        run.code,
        Some(1),
        "stdout: {}\nstderr: {}",
        run.out,
        run.err
    );
    assert!(run.out.is_empty(), "stdout: {}", run.out);
    assert_eq!(run.err.lines().count(), 1, "stderr: {}", run.err);
    assert!(run.err.starts_with("p99: "), "stderr: {}", run.err);
    assert!(run.err.contains(said), "wanted {said:?} in {}", run.err);
}

fn moves(stub: &Stub) -> Vec<Value> {
    stub.sent("POST", "/v1/move")
        .iter()
        .map(Req::json)
        .collect()
}

fn patches(stub: &Stub, id: i64) -> Vec<Value> {
    stub.seen()
        .iter()
        .filter(|r| r.on_item("PATCH", id))
        .map(Req::json)
        .collect()
}

#[test]
fn an_owner_who_filters_the_list_sees_exactly_what_the_worker_was_asked_for() {
    let mut question = Item::new(3, "Is shipping free over 50?");
    question.kind = "question".to_owned();
    let mut doing = Item::new(2, "Crème brûlée photo is blurry");
    doing.label = "In progress".to_owned();
    let stub = Stub::start(World::new(vec![
        Item::new(1, "Checkout total is wrong"),
        doing,
        question,
        Item::new(4, "Logo was fixed").closed("fixed"),
    ]));
    let home = Home::of("filters", &stub);

    let open = home.ok(&["list"]);
    assert!(has_key(&open, "BUG-1") && has_key(&open, "BUG-2") && has_key(&open, "Q-3"));
    assert!(
        !has_key(&open, "BUG-4"),
        "a fixed item showed as open:\n{open}"
    );
    let lines: Vec<&str> = open.lines().collect();
    assert_eq!(lines.len(), 3, "{open}");
    assert!(
        lines[0].contains("Q-3") && lines[2].contains("BUG-1"),
        "newest first:\n{open}"
    );
    let asked = stub.sent("GET", "/v1/issues");
    let first = &asked[0];
    assert_eq!(first.param("scope"), Some("all"));
    assert_eq!(first.param("status"), Some("open"));
    assert_eq!(first.param("host"), Some("*"));

    let picked = home.ok(&[
        "list",
        HOST,
        "--label",
        "In progress",
        "--kind",
        "bug",
        "-q",
        "creme",
    ]);
    assert!(has_key(&picked, "BUG-2"), "{picked}");
    assert_eq!(picked.lines().count(), 1, "{picked}");
    let last = stub.sent("GET", "/v1/issues").pop().unwrap();
    assert_eq!(last.param("label"), Some("In progress"));
    assert_eq!(last.param("kind"), Some("bug"));
    assert_eq!(last.param("q"), Some("creme"));
    assert_eq!(last.param("host"), Some(HOST));

    let closed = home.ok(&["list", "--status", "closed"]);
    assert!(
        has_key(&closed, "BUG-4") && closed.lines().count() == 1,
        "{closed}"
    );

    let refused = home.run(&["list", "--kind", "nope"]);
    lone_error(&refused, "kind is not known (400)");
    stub.all_signed();
}

#[test]
fn a_search_always_ends_in_results_a_no_match_line_or_one_plain_error() {
    let stub = Stub::hooked(
        World::new(vec![
            Item::new(1, "Discount 100% off never applies"),
            Item::new(2, "snake_case field breaks the form"),
            Item::new(3, "Crème brûlée page is cold"),
        ]),
        |req, world| match req.param("q") {
            Some("slow") => Some(world.answer(req).after(Duration::from_millis(1500))),
            Some("boom") => Some(Reply::problem(500, "internal", "D1 is down")),
            Some("gateway") => Some(Reply::raw(
                502,
                "text/html",
                "<html><body><h1>502 Bad Gateway</h1></body></html>",
            )),
            Some("garbled") => Some(Reply::raw(200, "application/json", "{\"issues\": [")),
            _ => None,
        },
    );
    let home = Home::of("search", &stub);

    let found = home.ok(&["list", "-q", "crème"]);
    assert!(
        has_key(&found, "BUG-3") && found.lines().count() == 1,
        "{found}"
    );
    assert_eq!(
        stub.sent("GET", "/v1/issues").pop().unwrap().param("q"),
        Some("crème")
    );

    let percent = home.ok(&["list", "-q", "100%"]);
    assert!(
        has_key(&percent, "BUG-1") && percent.lines().count() == 1,
        "{percent}"
    );
    assert_eq!(
        stub.sent("GET", "/v1/issues").pop().unwrap().param("q"),
        Some("100%")
    );
    let under = home.ok(&["list", "-q", "_"]);
    assert!(
        has_key(&under, "BUG-2") && under.lines().count() == 1,
        "{under}"
    );

    let none = home.run(&["list", "-q", "nothing like this"]);
    assert_eq!(none.code, Some(0), "{}", none.err);
    assert_eq!(none.out, "no items\n");
    let none = home.ok(&["list", "-q", "nothing like this", "--json"]);
    let none: Value = serde_json::from_str(&none).unwrap();
    assert_eq!(none, json!({"issues": [], "more": false}));

    let slow = home.ok(&["list", "-q", "slow"]);
    assert_eq!(slow, "no items\n");

    lone_error(&home.run(&["list", "-q", "boom"]), "D1 is down (500)");
    lone_error(
        &home.run(&["list", "-q", "gateway"]),
        "the Worker answered 502",
    );
    let garbled = home.run(&["list", "-q", "garbled"]);
    lone_error(&garbled, "unexpected answer");
    assert!(!garbled.err.contains("<html"), "{}", garbled.err);

    let long = "x".repeat(201);
    lone_error(
        &home.run(&["list", "-q", &long]),
        "q must be at most 200 characters (400)",
    );
    stub.all_signed();
}

#[test]
fn a_search_against_a_worker_that_never_answers_gives_up_with_one_line_instead_of_hanging() {
    let stub = Stub::hooked(World::new(vec![Item::new(1, "Anything")]), |req, _| {
        (req.path == "/v1/issues").then(Reply::stalled)
    });
    let home = Home::of("stalled", &stub);
    let began = Instant::now();
    let stalled = home.run(&["list", "-q", "anything"]);
    assert!(began.elapsed() < Duration::from_secs(30));
    lone_error(&stalled, "cannot reach");
}

#[test]
fn an_owner_with_520_items_pages_through_each_once_and_is_told_when_more_follow() {
    let stub = Stub::start(World::many(520));
    let home = Home::of("many", &stub);

    let all = home.ok(&["list", "--limit", "600"]);
    let keys: Vec<&str> = all
        .lines()
        .map(|l| l.split_whitespace().next().unwrap())
        .collect();
    assert_eq!(keys.len(), 520);
    let mut unique = keys.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 520, "an item showed twice");
    assert_eq!(keys[0], "BUG-520");
    assert_eq!(keys[519], "BUG-1");
    let pages = stub.sent("GET", "/v1/issues");
    assert_eq!(pages.len(), 6);
    let cursors: Vec<Option<&str>> = pages.iter().map(|p| p.param("cursor")).collect();
    assert_eq!(
        cursors,
        [
            None,
            Some("421"),
            Some("321"),
            Some("221"),
            Some("121"),
            Some("21")
        ]
    );
    assert!(pages.iter().all(|p| p.param("limit") == Some("100")));

    let exact = home.run(&["list", "--limit", "520"]);
    assert_eq!(exact.out.lines().count(), 520);
    assert!(!exact.err.contains("more items follow"), "{}", exact.err);

    let first = home.run(&["list"]);
    assert_eq!(first.code, Some(0));
    assert_eq!(first.out.lines().count(), 50);
    assert!(
        first.err.contains("more items follow; raise --limit"),
        "{}",
        first.err
    );
    let json: Value = serde_json::from_str(&home.ok(&["list", "--json"])).unwrap();
    assert_eq!(json["issues"].as_array().unwrap().len(), 50);
    assert_eq!(json["more"], true);
    stub.all_signed();
}

#[test]
fn a_list_limit_of_zero_never_tells_the_owner_their_inbox_is_empty() {
    let stub = Stub::start(World::many(3));
    let home = Home::of("zero", &stub);
    let zero = home.run(&["list", "--limit", "0"]);
    assert!(
        !zero.out.contains("no items"),
        "three items wait, yet the CLI said: {}",
        zero.out
    );
    match zero.code {
        Some(0) => assert!(!zero.out.trim().is_empty(), "{}", zero.err),
        Some(1) => assert!(
            zero.err.starts_with("p99: ") && zero.err.trim_end().lines().count() == 1,
            "a refusal is one p99: line, got: {}",
            zero.err
        ),
        Some(2) => assert!(zero.err.starts_with("error: "), "{}", zero.err),
        other => panic!("p99 list --limit 0 ended with {other:?}: {}", zero.err),
    }
}

#[test]
fn an_empty_page_that_still_carries_a_cursor_ends_the_list_without_saying_more_follow() {
    let stub = Stub::hooked(World::new(vec![]), |req, _| {
        (req.is("GET", "/v1/issues"))
            .then(|| Reply::json(200, json!({"issues": [], "next_cursor": "x"})))
    });
    let home = Home::of("empty-cursor", &stub);
    let began = Instant::now();
    let empty = home.run(&["list", "--limit", "10"]);
    assert!(began.elapsed() < Duration::from_secs(30));
    assert_eq!(empty.code, Some(0), "{}", empty.err);
    assert_eq!(empty.out.trim(), "no items");
    assert!(!empty.err.contains("more items follow"), "{}", empty.err);
    assert_eq!(stub.sent("GET", "/v1/issues").len(), 1);
    let json: Value = serde_json::from_str(&home.ok(&["list", "--json"])).unwrap();
    assert_eq!(json["more"], false);

    let world = World::many(3);
    let first: Vec<Value> = world.items.iter().map(Item::summary).collect();
    let stub = Stub::hooked(world, move |req, _| {
        if !req.is("GET", "/v1/issues") {
            return None;
        }
        let issues = match req.param("cursor") {
            None => first.clone(),
            Some(_) => vec![],
        };
        Some(Reply::json(
            200,
            json!({"issues": issues, "next_cursor": "again"}),
        ))
    });
    let home = Home::of("empty-second", &stub);
    let some = home.run(&["list", "--limit", "10"]);
    assert_eq!(some.code, Some(0), "{}", some.err);
    assert_eq!(some.out.lines().count(), 3, "{}", some.out);
    assert!(!some.err.contains("more items follow"), "{}", some.err);
    assert_eq!(stub.sent("GET", "/v1/issues").len(), 2);
}

#[test]
fn a_list_across_two_accounts_keeps_to_the_limit_and_says_more_follow() {
    let mut world = World::many(5);
    for id in 101..=102 {
        let mut item = Item::new(id, &format!("Side report {id}"));
        item.account = "side".to_owned();
        world.items.push(item);
    }
    let stub = Stub::start(world);
    let home = Home::new(
        "accounts",
        &[("main", stub.url()), ("side", stub.url_of("side"))],
    );
    let both = home.run(&["list", "--all", "--limit", "3"]);
    assert_eq!(both.code, Some(0), "{}", both.err);
    assert!(
        both.out.lines().count() <= 3,
        "--limit 3 printed {} items:\n{}",
        both.out.lines().count(),
        both.out
    );
    assert!(
        both.err.contains("more items follow"),
        "the main account holds more, yet nothing said so: {}",
        both.err
    );
}

#[test]
fn a_move_sends_the_label_it_read_and_a_bad_key_or_label_is_refused_before_harm() {
    let stub = Stub::start(World::new(vec![Item::new(12, "Checkout total is wrong")]));
    let home = Home::of("move", &stub);

    let moved = home.ok(&["move", "BUG-12", "--to", "in-progress", "--host", HOST]);
    assert_eq!(moved, "BUG-12 is in In progress\n");
    assert_eq!(
        moves(&stub),
        [json!({"key": "12", "from": "New", "to": "in-progress"})]
    );
    let shown = home.ok(&["show", "12", "--host", HOST]);
    assert!(shown.starts_with("BUG-12  Bug  In progress\n"), "{shown}");

    let before = stub.seen().len();
    let bad = home.run(&["move", "BUG-", "--to", "in-progress"]);
    lone_error(&bad, "BUG- is not an item key; try BUG-12 or 12");
    assert_eq!(
        stub.seen().len(),
        before,
        "a bad key still reached the Worker"
    );

    let stray = home.run(&["move", "12", "--to", "Shipped", "--host", HOST]);
    lone_error(
        &stray,
        "Shipped is not a lane; give new, planned, in-progress, needs-you, stuck, landed, done or a lane's name",
    );
    assert!(!stray.err.contains("(400)"), "{}", stray.err);
    assert_eq!(stub.world(|w| w.get(12).label), "In progress");
    stub.all_signed();
}

#[test]
fn a_move_beside_a_card_lands_in_that_lane_on_the_one_board_and_names_no_board() {
    let stub = Stub::start(World::new(vec![
        Item::new(7, "Neighbour card"),
        Item::new(12, "Checkout total is wrong"),
    ]));
    let home = Home::of("beside", &stub);

    let placed = home.ok(&[
        "move", "12", "--to", "new", "--after", "BUG-7", "--host", HOST,
    ]);
    assert_eq!(placed, "BUG-12 is in New\n");
    assert_eq!(
        moves(&stub),
        [json!({"key": "12", "from": "New", "to": "new", "after": "7"})]
    );

    let named = home.ok(&[
        "move",
        "12",
        "--to",
        "needs you",
        "--before",
        "BUG-7",
        "--host",
        HOST,
    ]);
    assert_eq!(named, "BUG-12 is in Needs you\n");
    assert_eq!(
        moves(&stub)[1],
        json!({"key": "12", "from": "New", "to": "needs you", "before": "7"})
    );

    let board = home.ok(&["board", "--host", HOST]);
    assert!(
        board.contains("New (1)") && board.contains("BUG-7"),
        "{board}"
    );
    assert!(
        board.contains("Needs you (1)") && board.contains("BUG-12"),
        "{board}"
    );
    stub.all_signed();
}

#[test]
fn two_sessions_moving_one_card_at_once_make_one_move_and_both_end_on_the_same_label() {
    let gate = Gate::new(2);
    let reads = Arc::clone(&gate);
    let stub = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            req.is("GET", "/v1/issues/12")
                .then(|| world.answer(req).gated(&reads))
        },
    );
    let ada = Home::of("race-ada", &stub);
    let grace = Home::of("race-grace", &stub);
    let one = ada.command(&["move", "12", "--to", "in-progress", "--host", HOST]);
    let two = grace.command(&["move", "12", "--to", "landed", "--host", HOST]);
    let one = thread::spawn(move || run(one));
    let two = thread::spawn(move || run(two));
    let (one, two) = (one.join().unwrap(), two.join().unwrap());

    let sent = moves(&stub);
    assert_eq!(sent.len(), 2);
    assert!(sent.iter().all(|m| m["from"] == "New"), "{sent:?}");
    let (won, lost) = match (one.code, two.code) {
        (Some(0), Some(1)) => (&one, &two),
        (Some(1), Some(0)) => (&two, &one),
        _ => panic!(
            "both or neither moved:\n{}{}\n{}{}",
            one.out, one.err, two.out, two.err
        ),
    };
    let end = stub.world(|w| w.get(12).label);
    assert_eq!(won.out, format!("BUG-12 is in {end}\n"));
    lone_error(
        lost,
        &format!("BUG-12 moved to {end} meanwhile; run it again to move it from there"),
    );
    for home in [&ada, &grace] {
        let shown = home.ok(&["show", "12", "--host", HOST]);
        assert!(
            shown.starts_with(&format!("BUG-12  Bug  {end}\n")),
            "{shown}"
        );
    }
    assert!(
        lost.err.contains(&end),
        "the session that lost was told {:?}, not where the card is now ({end})",
        lost.err.trim()
    );
}

fn raced_to(label: &'static str, reread: bool) -> Stub {
    let reads = AtomicUsize::new(0);
    Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            if req.on_item("GET", 12) && reads.fetch_add(1, Ordering::Relaxed) > 0 && !reread {
                return Some(Reply::problem(500, "internal", "D1 is down"));
            }
            if !req.is("POST", "/v1/move") {
                return None;
            }
            world.items[0].label = label.to_owned();
            Some(Reply::problem(409, "moved", "this card moved; refreshed"))
        },
    )
}

#[test]
fn a_move_that_loses_the_race_names_the_label_the_card_moved_to() {
    let stub = raced_to("Landed", true);
    let home = Home::of("raced-review", &stub);
    let lost = home.run(&["move", "12", "--to", "in-progress", "--host", HOST]);
    lone_error(
        &lost,
        "BUG-12 moved to Landed meanwhile; run it again to move it from there",
    );
    assert!(!lost.err.contains("refreshed"), "{}", lost.err);
    assert_eq!(
        stub.seen().iter().filter(|r| r.on_item("GET", 12)).count(),
        2,
        "the card was not read again after the refused move"
    );
}

#[test]
fn a_move_that_loses_the_race_to_the_same_label_says_nothing_is_left_to_move() {
    let stub = raced_to("In progress", true);
    let home = Home::of("raced-same", &stub);
    let lost = home.run(&["move", "12", "--to", "in-progress", "--host", HOST]);
    lone_error(
        &lost,
        "BUG-12 moved to In progress meanwhile; nothing left to move",
    );
}

#[test]
fn a_move_that_loses_the_race_and_cannot_read_the_card_again_keeps_the_worker_words() {
    let stub = raced_to("Landed", false);
    let home = Home::of("raced-dark", &stub);
    let lost = home.run(&["move", "12", "--to", "in-progress", "--host", HOST]);
    lone_error(&lost, "this card moved; refreshed");
    assert!(!lost.err.contains("(409)"), "{}", lost.err);
}

#[test]
fn a_move_refused_for_another_reason_is_never_called_a_race() {
    let stub = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        |req, _| {
            req.is("POST", "/v1/move").then(|| {
                Reply::problem(
                    400,
                    "bad_request",
                    "a resolution goes with a label that closes",
                )
            })
        },
    );
    let home = Home::of("raced-not", &stub);
    let lost = home.run(&["move", "12", "--to", "in-progress", "--host", HOST]);
    lone_error(&lost, "a resolution goes with a label that closes");
    assert!(!lost.err.contains("meanwhile"), "{}", lost.err);
    assert_eq!(
        stub.seen().iter().filter(|r| r.on_item("GET", 12)).count(),
        1
    );
}

#[test]
fn two_sessions_assigning_at_once_both_read_back_the_last_write() {
    let gate = Gate::new(2);
    let writes = Arc::clone(&gate);
    let stub = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            req.is("PATCH", "/v1/issues/12")
                .then(|| world.answer(req).gated(&writes))
        },
    );
    let ada = Home::of("lww-ada", &stub);
    let grace = Home::of("lww-grace", &stub);
    let one = ada.command(&["assign", "12", "@ada.lovelace", "--host", HOST]);
    let two = grace.command(&["assign", "12", "@grace.hopper", "--host", HOST]);
    let one = thread::spawn(move || run(one));
    let two = thread::spawn(move || run(two));
    let (one, two) = (one.join().unwrap(), two.join().unwrap());
    assert_eq!(
        (one.code, two.code),
        (Some(0), Some(0)),
        "{}{}",
        one.err,
        two.err
    );
    assert_eq!(patches(&stub, 12).len(), 2);
    assert_eq!(one.out, "BUG-12 is assigned to @ada.lovelace\n");
    assert_eq!(two.out, "BUG-12 is assigned to @grace.hopper\n");
    let last = stub.world(|w| w.get(12).assignee).unwrap();
    assert!(["ada.lovelace", "grace.hopper"].contains(&last.as_str()));
    for home in [&ada, &grace] {
        let shown = home.ok(&["show", "12", "--host", HOST]);
        assert!(shown.contains(&format!("assigned to @{last}\n")), "{shown}");
    }
}

#[test]
fn an_edit_of_the_title_and_an_assign_at_once_both_stick_because_each_sends_only_its_field() {
    let gate = Gate::new(2);
    let writes = Arc::clone(&gate);
    let stub = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            req.is("PATCH", "/v1/issues/12")
                .then(|| world.answer(req).gated(&writes))
        },
    );
    let ada = Home::of("both-ada", &stub);
    let grace = Home::of("both-grace", &stub);
    let one = ada.command(&[
        "edit",
        "12",
        "--title",
        "Checkout total ignores the coupon",
        "--host",
        HOST,
    ]);
    let two = grace.command(&["assign", "12", "@grace.hopper", "--host", HOST]);
    let one = thread::spawn(move || run(one));
    let two = thread::spawn(move || run(two));
    let (one, two) = (one.join().unwrap(), two.join().unwrap());
    assert_eq!(
        (one.code, two.code),
        (Some(0), Some(0)),
        "{}{}",
        one.err,
        two.err
    );
    assert_eq!(one.out, "BUG-12 edited: title\n");
    assert_eq!(two.out, "BUG-12 is assigned to @grace.hopper\n");
    let sent = patches(&stub, 12);
    assert_eq!(sent.len(), 2);
    assert!(
        sent.contains(&json!({"title": "Checkout total ignores the coupon"})),
        "{sent:?}"
    );
    assert!(
        sent.contains(&json!({"assignee": "grace.hopper"})),
        "{sent:?}"
    );
    let (title, assignee) = stub.world(|w| (w.get(12).title, w.get(12).assignee));
    assert_eq!(title, "Checkout total ignores the coupon");
    assert_eq!(assignee.as_deref(), Some("grace.hopper"));
    for home in [&ada, &grace] {
        let shown = home.ok(&["show", "12", "--host", HOST]);
        assert!(
            shown.contains("Checkout total ignores the coupon"),
            "{shown}"
        );
        assert!(shown.contains("assigned to @grace.hopper\n"), "{shown}");
    }
}

#[test]
fn an_owner_assigns_by_username_to_me_or_to_no_one_and_a_stranger_is_refused_plainly() {
    let stub = Stub::start(World::new(vec![Item::new(12, "Checkout total is wrong")]));
    let home = Home::of("assign", &stub);

    assert_eq!(
        home.ok(&["assign", "BUG-12", "@Grace.Hopper", "--host", HOST]),
        "BUG-12 is assigned to @grace.hopper\n"
    );
    assert_eq!(
        home.ok(&["assign", "12", "me", "--host", HOST]),
        "BUG-12 is assigned to @ada.lovelace\n"
    );
    assert_eq!(
        home.ok(&["assign", "12", "--none", "--host", HOST]),
        "BUG-12 is assigned to no one\n"
    );
    assert_eq!(
        patches(&stub, 12),
        [
            json!({"assignee": "Grace.Hopper"}),
            json!({"assignee": "me"}),
            json!({"assignee": null}),
        ]
    );
    let stranger = home.run(&["assign", "12", "@nobody", "--host", HOST]);
    lone_error(
        &stranger,
        "@nobody is not a member of shop.example.com (400)",
    );
    assert_eq!(stub.world(|w| w.get(12).assignee), None);
    let listed = home.ok(&["list"]);
    assert!(!listed.contains("->"), "{listed}");
    stub.all_signed();
}

#[test]
fn an_owner_closes_as_dropped_or_duplicate_and_reopens_through_a_label() {
    let stub = Stub::start(World::new(vec![
        Item::new(3, "The first report of it"),
        Item::new(12, "Checkout total is wrong"),
    ]));
    let home = Home::of("close", &stub);

    assert_eq!(
        home.ok(&["status", "12", "abandoned", "--host", HOST]),
        "BUG-12 is now dropped\n"
    );
    assert!(has_key(&home.ok(&["list", "--status", "closed"]), "BUG-12"));
    assert!(!has_key(&home.ok(&["list"]), "BUG-12"));

    let before = stub.seen().len();
    lone_error(
        &home.run(&["status", "12", "duplicate", "--host", HOST]),
        "a duplicate needs --duplicate-of KEY",
    );
    lone_error(
        &home.run(&["status", "12", "In progress", "--duplicate-of", "BUG-3"]),
        "--duplicate-of goes with duplicate",
    );
    assert_eq!(
        stub.seen().len(),
        before,
        "a refused close still reached the Worker"
    );

    assert_eq!(
        home.ok(&[
            "status",
            "12",
            "duplicate",
            "--duplicate-of",
            "BUG-3",
            "--host",
            HOST
        ]),
        "BUG-12 is now duplicate\n"
    );
    assert_eq!(
        patches(&stub, 12),
        [
            json!({"resolution": "abandoned"}),
            json!({"resolution": "duplicate", "duplicate_of": "BUG-3"}),
        ]
    );

    assert_eq!(
        home.ok(&["status", "12", "New", "--host", HOST]),
        "BUG-12 is in New\n"
    );
    assert_eq!(
        moves(&stub),
        [json!({"key": "12", "from": "Done", "to": "New"})]
    );
    assert!(has_key(&home.ok(&["list"]), "BUG-12"));
    stub.all_signed();
}

#[test]
fn an_assignee_the_worker_sends_without_a_username_never_breaks_the_list_or_the_item() {
    let mut item = Item::new(12, "Assigned before usernames existed");
    item.assignee = Some("old.hand".to_owned());
    item.nameless = true;
    let stub = Stub::start(World::new(vec![item]));
    let home = Home::of("nameless", &stub);
    let listed = home.run(&["list"]);
    assert_eq!(listed.code, Some(0), "{}", listed.err);
    assert!(has_key(&listed.out, "BUG-12"), "{}", listed.out);
    let shown = home.run(&["show", "12", "--host", HOST]);
    assert_eq!(shown.code, Some(0), "{}", shown.err);
    let screen = home.screen("120x30", "");
    assert!(has_key(&screen, "BUG-12"), "{screen}");
}

fn tricky() -> Vec<Item> {
    vec![
        Item::new(1, "שלום עולם — הכפתור לא עובד"),
        Item::new(2, "زر الدفع لا يعمل"),
        Item::new(3, "Coder 👩\u{200d}💻 sees a crash 🚀"),
        Item::new(4, "Cafe\u{301} menu e\u{301}clair"),
        Item::new(5, "Invoice \u{202e}fdp.exe\u{202c} attached"),
        Item::new(6, "Paste \u{1b}]52;c;ZXZpbA==\u{7} here \u{1b}[31mred"),
    ]
}

#[test]
fn unicode_titles_print_whole_and_bidi_or_escape_tricks_never_reach_the_terminal() {
    let stub = Stub::start(World::new(tricky()));
    let home = Home::of("unicode-cli", &stub);

    let listed = home.ok(&["list"]);
    no_tricks(&listed);
    for whole in [
        "שלום עולם — הכפתור לא עובד",
        "زر الدفع لا يعمل",
        "👩\u{200d}💻",
        "Cafe\u{301} menu e\u{301}clair",
        "fdp.exe attached",
    ] {
        assert!(listed.contains(whole), "{whole:?} lost in:\n{listed}");
    }
    let shown = home.ok(&["show", "1", "--host", HOST]);
    assert!(shown.contains("שלום עולם"), "{shown}");
    no_tricks(&home.ok(&["show", "6", "--host", HOST]));

    home.ok(&["list", "-q", "Cafe\u{301}"]);
    assert_eq!(
        stub.sent("GET", "/v1/issues").pop().unwrap().param("q"),
        Some("Cafe\u{301}")
    );
    let json: Value = serde_json::from_str(&home.ok(&["list", "--json"])).unwrap();
    let titles: Vec<&str> = json["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["title"].as_str().unwrap())
        .collect();
    assert!(
        titles.contains(&"Coder 👩\u{200d}💻 sees a crash 🚀"),
        "{titles:?}"
    );
    assert!(
        titles.contains(&"Cafe\u{301} menu e\u{301}clair"),
        "{titles:?}"
    );
}

#[test]
fn a_20000_character_item_prints_in_full_and_an_edit_sends_the_exact_text() {
    let mut body = String::new();
    while body.chars().count() < 19_000 {
        body.push_str("Steps: open the cart, add 👩\u{200d}💻 and שלום, pay. ");
    }
    body.push('\n');
    body.push_str(&"x".repeat(900));
    body.push_str("\nEND-OF-REPORT");
    let mut item = Item::new(12, "A very long report");
    item.body = body.clone();
    let stub = Stub::start(World::new(vec![item]));
    let home = Home::of("huge-cli", &stub);

    let shown = home.ok(&["show", "12", "--host", HOST]);
    assert!(shown.contains(&body), "the body was cut");

    let text = format!("{}\nשלום 🚀 e\u{301}", "y".repeat(19_000));
    let file = home.dir.join("details.txt");
    fs::write(&file, &text).unwrap();
    let title = "Paiement refusé — الدفع 💳";
    let edited = home.ok(&[
        "edit",
        "12",
        "--title",
        title,
        "--text-file",
        file.to_str().unwrap(),
        "--host",
        HOST,
    ]);
    assert_eq!(edited, "BUG-12 edited: title and details\n");
    assert_eq!(patches(&stub, 12), [json!({"title": title, "body": text})]);
    stub.all_signed();
}

#[test]
fn the_inbox_lists_live_items_and_its_filter_finds_accent_free_and_unpointed_words() {
    let stub = Stub::start(World::new(vec![
        Item::new(1, "Crème brûlée page is cold"),
        Item::new(2, "הַכַּפְתּוֹר בדף שָׁלוֹם לא עובד"),
        Item::new(3, "Checkout total is wrong"),
        Item::new(4, "Old logo was fixed").closed("fixed"),
    ]));
    let home = Home::of("tui-filter", &stub);

    let inbox = home.screen("160x30", "");
    assert!(inbox.contains("open · 3 of 4 items"), "{inbox}");
    assert!(has_key(&inbox, "BUG-1") && has_key(&inbox, "BUG-2") && has_key(&inbox, "BUG-3"));
    assert!(!has_key(&inbox, "BUG-4"), "{inbox}");
    let read = &stub.sent("GET", "/v1/issues")[0];
    assert_eq!(
        (
            read.param("scope"),
            read.param("status"),
            read.param("host")
        ),
        (Some("all"), Some("any"), Some("*"))
    );

    let creme = home.screen("160x30", &format!("/ {}", typed("creme")));
    assert!(
        has_key(&creme, "BUG-1") && !has_key(&creme, "BUG-3"),
        "{creme}"
    );
    let hebrew = home.screen("160x30", &format!("/ {}", typed("שלום")));
    assert!(
        has_key(&hebrew, "BUG-2") && !has_key(&hebrew, "BUG-1"),
        "{hebrew}"
    );
    let none = home.screen("160x30", &format!("/ {}", typed("zzqx")));
    assert!(
        none.contains("Nothing matches the filter. esc clears it."),
        "{none}"
    );
    let closed = home.screen("160x30", "s");
    assert!(
        has_key(&closed, "BUG-4") && !has_key(&closed, "BUG-3"),
        "{closed}"
    );
    stub.all_signed();
}

#[test]
fn an_inbox_that_cannot_load_says_why_and_offers_to_read_again_never_an_empty_inbox() {
    let stub = Stub::hooked(World::many(3), |req, _| {
        (req.path == "/v1/issues").then(|| Reply::problem(500, "internal", "D1 is down"))
    });
    let home = Home::of("tui-error", &stub);
    let failed = home.screen("120x30", "");
    assert!(failed.contains("Couldn't read the inbox."), "{failed}");
    assert!(failed.contains("D1 is down (500)"), "{failed}");
    assert!(failed.contains("r reads it again"), "{failed}");
    assert!(!failed.contains("No items yet"), "{failed}");

    let good = Stub::start(World::many(3));
    let wrong = Home::keyed("tui-wrong-key", &[("main", good.url())], "not-the-key");
    let refused = wrong.screen("120x30", "");
    assert!(refused.contains("Couldn't read the inbox."), "{refused}");
    assert!(refused.contains("(401)"), "{refused}");
    assert!(!refused.contains("No items yet"), "{refused}");
}

#[test]
fn an_inbox_still_loading_never_looks_empty_and_a_slow_reply_still_lands() {
    let stub = Stub::hooked(World::many(3), |req, world| {
        (req.path == "/v1/issues").then(|| world.answer(req).after(Duration::from_millis(1500)))
    });
    let home = Home::of("tui-slow", &stub);
    let loading = home.ok(&["tui", "--dump", "120x30", "--loading"]);
    assert!(loading.contains("Reading the inbox…"), "{loading}");
    assert!(!loading.contains("No items yet"), "{loading}");
    let landed = home.screen("120x30", "");
    assert!(
        has_key(&landed, "BUG-3") && landed.contains("3 of 3 items"),
        "{landed}"
    );
}

#[test]
fn an_inbox_of_600_items_loads_every_page_once_and_counts_them_all() {
    let stub = Stub::start(World::many(600));
    let home = Home::of("tui-600", &stub);
    let inbox = home.screen("120x30", "");
    assert!(inbox.contains("600 of 600 items"), "{inbox}");
    let pages = stub.sent("GET", "/v1/issues");
    let cursors: Vec<Option<&str>> = pages.iter().map(|p| p.param("cursor")).collect();
    assert_eq!(
        cursors,
        [
            None,
            Some("501"),
            Some("401"),
            Some("301"),
            Some("201"),
            Some("101")
        ]
    );
    stub.world(|w| w.items[0].title = "Report number one".to_owned());
    let last = home.screen("120x30", &format!("/ {}", typed("number one")));
    assert!(has_key(&last, "BUG-1"), "{last}");
}

#[test]
fn an_inbox_over_1000_items_loads_the_newest_1000_and_counts_every_item() {
    let stub = Stub::start(World::many(1050));
    let home = Home::of("tui-1050", &stub);
    let counted = home.screen("120x30", "");
    assert!(
        counted.contains("1000 of 1050 items"),
        "the inbox does not count every item:\n{counted}"
    );
    assert!(
        counted.contains("only the newest 1000 are loaded"),
        "the inbox hides that it stopped loading:\n{counted}"
    );
    assert!(has_key(&counted, "BUG-1050"), "{counted}");
    assert!(
        stub.seen()
            .iter()
            .filter(|r| r.is("GET", "/v1/issues"))
            .all(|r| r.param("cursor") != Some("51")),
        "the inbox read past its cap"
    );
}

#[test]
fn an_inbox_under_the_cap_counts_without_a_note() {
    let stub = Stub::start(World::many(120));
    let home = Home::of("tui-120", &stub);
    let counted = home.screen("120x30", "");
    assert!(counted.contains("120 of 120 items"), "{counted}");
    assert!(!counted.contains("are loaded"), "{counted}");
}

#[test]
fn a_move_from_the_item_sends_the_label_it_shows_and_says_where_the_item_went() {
    let stub = Stub::start(World::new(vec![Item::new(12, "Checkout total is wrong")]));
    let home = Home::of("tui-move", &stub);
    let moved = home.screen("120x30", "enter m down down enter");
    assert_eq!(
        moves(&stub),
        [json!({"key": "BUG-12", "from": "New", "to": "In progress"})]
    );
    assert!(moved.contains("BUG-12 moved to In progress"), "{moved}");
    assert!(
        rows_with(&moved, "Bug ·")
            .iter()
            .any(|l| l.contains("In progress")),
        "{moved}"
    );
    stub.all_signed();
}

#[test]
fn a_move_after_another_session_moved_the_item_shows_where_it_is_now() {
    let flipped = AtomicBool::new(false);
    let stub = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        move |req, world| {
            if !req.on_item("GET", 12) || flipped.swap(true, Ordering::Relaxed) {
                return None;
            }
            let reply = world.answer(req);
            world.items[0].label = "Stuck".to_owned();
            Some(reply)
        },
    );
    let home = Home::of("tui-stale-move", &stub);
    let after = home.screen("120x30", "enter m down down enter");
    assert_eq!(
        moves(&stub),
        [json!({"key": "BUG-12", "from": "New", "to": "In progress"})]
    );
    assert_eq!(stub.world(|w| w.get(12).label), "Stuck");
    assert!(
        after.contains("BUG-12 moved to Stuck meanwhile; run it again to move it from there"),
        "{after}"
    );
    assert!(!after.contains("refreshed"), "{after}");
    assert!(
        stub.seen().iter().filter(|r| r.on_item("GET", 12)).count() >= 2,
        "the item was not read again after the refused move"
    );
    assert!(
        rows_with(&after, "Bug ·")
            .iter()
            .any(|l| l.contains("Stuck")),
        "the item still shows the label it no longer has:\n{after}"
    );
}

fn column_at(screen: &str, header: &str) -> usize {
    let line = rows_with(screen, header)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no column {header:?}:\n{screen}"));
    line[..line.find(header).unwrap()].chars().count()
}

fn card_at(screen: &str, key: &str) -> usize {
    let needle = format!("─ {key} ─");
    let line = rows_with(screen, &needle)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no card {key}:\n{screen}"));
    line[..line.find(&needle).unwrap()].chars().count()
}

#[test]
fn a_card_dragged_on_your_board_moves_and_a_stale_drag_settles_where_the_other_session_put_it() {
    let world = || {
        World::new(vec![
            Item::new(1, "First card"),
            Item::new(2, "Second card"),
        ])
    };
    let stub = Stub::start(world());
    let home = Home::of("tui-drag", &stub);
    let dragged = home.screen("140x34", "tab space right enter");
    let sent = moves(&stub);
    assert_eq!(sent.len(), 1, "{dragged}");
    let key = sent[0]["key"].as_str().unwrap().to_owned();
    assert_eq!(sent[0], json!({"key": key, "from": "New", "to": "planned"}));
    assert!(
        dragged.contains("Planned 1") && dragged.contains("New 1"),
        "{dragged}"
    );
    assert!(
        card_at(&dragged, &key) >= column_at(&dragged, "Planned 1"),
        "{dragged}"
    );

    let flipped = AtomicBool::new(false);
    let stale = Stub::hooked(world(), move |req, world| {
        if !req.is("GET", "/v1/board") || flipped.swap(true, Ordering::Relaxed) {
            return None;
        }
        let reply = world.answer(req);
        for item in &mut world.items {
            item.label = "Landed".to_owned();
        }
        Some(reply)
    });
    let home = Home::of("tui-stale-drag", &stale);
    let settled = home.screen("140x34", "tab space right enter");
    assert_eq!(moves(&stale).len(), 1);
    assert_eq!(moves(&stale)[0]["from"], "New");
    let raced = moves(&stale)[0]["key"].as_str().unwrap().to_owned();
    assert!(
        settled.contains(&format!("{raced} moved to Landed meanwhile")),
        "{settled}"
    );
    assert!(stale.sent("GET", "/v1/board").len() >= 2);
    assert!(settled.contains("Landed 2"), "{settled}");
    assert!(!settled.contains("Planned 1"), "{settled}");
    for key in ["BUG-1", "BUG-2"] {
        assert!(
            card_at(&settled, key) >= column_at(&settled, "Landed 2"),
            "{settled}"
        );
    }
    stale.all_signed();
}

#[test]
fn an_assignment_from_the_item_picks_a_member_and_a_refusal_changes_nothing() {
    let stub = Stub::start(World::new(vec![Item::new(12, "Checkout total is wrong")]));
    let home = Home::of("tui-assign", &stub);
    let assigned = home.screen("120x30", "enter a down down down enter");
    assert_eq!(
        patches(&stub, 12),
        [json!({"assignee": "grace.hopper"})],
        "{assigned}"
    );
    assert!(assigned.contains("assigned to @grace.hopper"), "{assigned}");

    let refusing = Stub::hooked(
        World::new(vec![Item::new(12, "Checkout total is wrong")]),
        |req, _| {
            req.on_item("PATCH", 12).then(|| {
                Reply::problem(
                    400,
                    "bad_request",
                    "@grace.hopper is not a member of shop.example.com",
                )
            })
        },
    );
    let home = Home::of("tui-assign-refused", &refusing);
    let refused = home.screen("120x30", "enter a down down down enter");
    assert!(
        refused.contains("@grace.hopper is not a member of shop.example.com (400)"),
        "{refused}"
    );
    assert!(refused.contains("unassigned"), "{refused}");
}

#[test]
fn a_drop_from_the_item_closes_it_and_a_label_reopens_it() {
    let stub = Stub::start(World::new(vec![Item::new(12, "Checkout total is wrong")]));
    let home = Home::of("tui-drop", &stub);
    let dropped = home.screen("120x30", "enter m down down down down down down down enter");
    assert_eq!(
        patches(&stub, 12),
        [json!({"resolution": "abandoned"})],
        "{dropped}"
    );
    assert!(dropped.contains("BUG-12 is Done (dropped)"), "{dropped}");

    let reopened = home.screen("120x30", "s enter m up up up up up up enter");
    assert_eq!(
        moves(&stub),
        [json!({"key": "BUG-12", "from": "Done", "to": "New"})]
    );
    assert!(reopened.contains("BUG-12 moved to New"), "{reopened}");
    assert_eq!(stub.world(|w| w.get(12).resolution), None);
}

#[test]
fn the_history_of_an_item_names_people_never_raw_json() {
    let mut item = Item::new(12, "Checkout total is wrong");
    item.assignee = Some("grace.hopper".to_owned());
    item.events = vec![json!({
        "actor": "ada@example.com",
        "actor_name": "Ada Lovelace",
        "kind": "assignee",
        "detail": {"from": null, "to": {"username": "grace.hopper"}},
        "at": iso(unix_now() - 600),
    })];
    let stub = Stub::start(World::new(vec![item]));
    let home = Home::of("tui-history", &stub);
    let history = home.screen("120x30", "enter G");
    assert!(history.contains("Events"), "{history}");
    assert!(!history.contains("{\"username\""), "{history}");
    assert!(history.contains("nobody → @grace.hopper"), "{history}");
}

#[test]
fn unicode_titles_keep_the_inbox_rows_whole_and_never_pass_bidi_or_escapes_to_the_terminal() {
    let stub = Stub::start(World::new(tricky()));
    let home = Home::of("unicode-tui", &stub);
    let inbox = home.screen("160x30", "");
    no_tricks(&inbox);
    for id in 1..=6 {
        let key = format!("BUG-{id}");
        let row = rows_with(&inbox, &format!(" {key} "));
        assert_eq!(row.len(), 1, "{key}:\n{inbox}");
        assert!(
            row[0].trim_end().ends_with("2h"),
            "{key} lost its row's end:\n{inbox}"
        );
    }
    assert!(inbox.contains("👩\u{200d}💻"), "{inbox}");
    let opened = home.screen("160x30", "end enter");
    no_tricks(&opened);
}

#[test]
fn a_20000_character_item_opens_and_scrolls_to_its_end() {
    let mut body = String::new();
    while body.chars().count() < 19_000 {
        body.push_str("Steps: open the cart, add 👩\u{200d}💻 and שלום, pay. ");
    }
    body.push('\n');
    body.push_str(&"x".repeat(900));
    body.push_str("\nEND-OF-REPORT");
    let mut item = Item::new(12, &"Long title ".repeat(18));
    item.body = body;
    let stub = Stub::start(World::new(vec![item]));
    let home = Home::of("huge-tui", &stub);
    let top = home.screen("80x24", "enter");
    assert!(top.contains("BUG-12"), "{top}");
    let end = home.screen("80x24", "enter G");
    assert!(end.contains("END-OF-REPORT"), "{end}");
    assert!(end.contains("none yet"), "{end}");
}

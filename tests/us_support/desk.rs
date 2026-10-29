#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::home::Home;
use crate::stub::{Reply, Req, Stub};

pub const LANES: [(&str, &str, bool); 7] = [
    ("new", "New", false),
    ("planned", "Planned", false),
    ("in-progress", "In progress", false),
    ("needs-you", "Needs you", false),
    ("stuck", "Stuck", false),
    ("landed", "Landed", false),
    ("done", "Done", true),
];

const AT: &str = "2026-10-02T10:00:00.000Z";

#[derive(Debug, Clone)]
pub struct Item {
    pub id: i64,
    pub title: String,
    pub label: String,
    pub host: Option<String>,
    pub project: Option<String>,
    pub assignee: Option<String>,
    pub resolution: Option<String>,
    pub duplicate_of: Option<String>,
}

impl Item {
    pub fn new(id: i64, title: &str) -> Item {
        Item {
            id,
            title: title.to_owned(),
            label: "New".to_owned(),
            host: Some("shop.example.com".to_owned()),
            project: Some("Shop".to_owned()),
            assignee: None,
            resolution: None,
            duplicate_of: None,
        }
    }

    pub fn in_lane(mut self, label: &str) -> Item {
        self.label = label.to_owned();
        self
    }

    pub fn hostless(mut self, project: &str) -> Item {
        self.host = None;
        self.project = Some(project.to_owned());
        self
    }

    pub fn key(&self) -> String {
        format!("BUG-{}", self.id)
    }

    fn lane(&self) -> usize {
        lane_of(&self.label).map_or(0, |l| l.0)
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

    pub fn summary(&self) -> Value {
        json!({
            "id": self.id,
            "key": self.key(),
            "kind": "bug",
            "stage": self.stage(),
            "label": self.label,
            "resolution": self.resolution,
            "project": self.project,
            "title": self.title,
            "host": self.host,
            "env": "production",
            "page": {"url": "https://shop.example.com/cart", "path": "/cart", "title": "Cart"},
            "reporter": {"email": "grace@example.com", "name": "Grace Hopper", "agent": false},
            "assignee": self.assignee.as_ref().map_or(Value::Null, |u| json!({"username": u})),
            "created_at": AT,
            "updated_at": AT,
            "comments": 0,
            "attachments": 0,
            "unread": false,
        })
    }

    pub fn issue(&self) -> Value {
        let mut issue = self.summary();
        issue["body"] = json!("The total stays at zero.");
        issue["duplicate_of"] = json!(self.duplicate_of);
        issue
    }

    fn card(&self) -> Value {
        let at = self.lane();
        json!({
            "key": self.key(),
            "kind": "bug",
            "project": self.project,
            "status": LANES[at].0,
            "label": self.label,
            "lane": if LANES[at].2 { Value::Null } else { json!(1) },
            "title": self.title,
            "host": self.host,
            "assignee": self.assignee,
            "order": null,
            "changed_at": AT,
            "changed_by": null,
        })
    }
}

pub fn lane_of(raw: &str) -> Option<(usize, &'static str, &'static str, bool)> {
    LANES
        .iter()
        .enumerate()
        .find(|(_, (word, label, _))| *word == raw || label.eq_ignore_ascii_case(raw.trim()))
        .map(|(at, (word, label, closes))| (at, *word, *label, *closes))
}

pub struct World {
    pub items: Vec<Item>,
    pub space: Option<(String, String)>,
    pub comments: Vec<Value>,
}

impl World {
    pub fn new(items: Vec<Item>) -> World {
        World {
            items,
            space: None,
            comments: Vec::new(),
        }
    }

    pub fn named(mut self, slug: &str, name: &str) -> World {
        self.space = Some((slug.to_owned(), name.to_owned()));
        self
    }

    pub fn item(&mut self, key: &str) -> Option<&mut Item> {
        let id: i64 = key.rsplit('-').next()?.trim().parse().ok()?;
        self.items.iter_mut().find(|i| i.id == id)
    }

    pub fn get(&self, id: i64) -> Item {
        self.items.iter().find(|i| i.id == id).cloned().unwrap()
    }

    pub fn answer(&mut self, req: &Req) -> Reply {
        let rest = req.path.strip_prefix("/_p99/v1/").unwrap_or("");
        let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
        match (req.method.as_str(), parts.as_slice()) {
            ("GET", ["issues"]) => self.list(req),
            ("GET", ["issues", key]) => match self.item(key) {
                Some(item) => Reply::ok(json!({
                    "issue": item.issue(),
                    "comments": [],
                    "attachments": [],
                    "events": [],
                })),
                None => Reply::problem(404, "no such item"),
            },
            ("PATCH", ["issues", key]) => self.patch(req, key),
            ("POST", ["issues", _, "comments"]) => {
                let body = req.json();
                self.comments.push(body.clone());
                Reply::json(
                    201,
                    json!({
                        "id": 31,
                        "client_uid": body["client_uid"],
                        "author": {"email": "ada@example.com", "name": "Ada Lovelace", "manager": true},
                        "body": body["body"],
                        "internal": body["internal"],
                        "created_at": AT,
                    }),
                )
            }
            ("POST", ["move"]) => self.shift(req),
            ("GET", ["board"]) => self.board(req),
            ("GET", ["labels"]) => Reply::ok(json!({"labels": LANES
                .iter()
                .enumerate()
                .map(|(at, (word, label, closes))| json!({"id": 10 + at, "name": label, "word": word, "closes": closes, "boards": []}))
                .collect::<Vec<_>>()})),
            ("GET", ["cards", "waiting"]) => Reply::ok(json!({"count": 0, "cards": []})),
            ("GET", ["projects"]) => Reply::ok(json!({"projects": []})),
            ("GET", ["people"]) => Reply::ok(json!({"people": [
                {"username": "ada.lovelace", "manager": true},
                {"username": "grace.hopper", "manager": true},
            ]})),
            ("GET", ["space"]) => match &self.space {
                Some((slug, name)) => Reply::ok(json!({
                    "space": {"slug": slug, "name": name},
                    "projects": [],
                })),
                None => Reply::problem(404, "no such route"),
            },
            _ => Reply::problem(404, "no such route"),
        }
    }

    fn list(&self, req: &Req) -> Reply {
        let status = req.param("status").unwrap_or("any");
        let projects = req.params("project");
        let mut found: Vec<&Item> = self
            .items
            .iter()
            .filter(|i| match status {
                "open" => i.resolution.is_none(),
                "closed" => i.resolution.is_some(),
                _ => true,
            })
            .filter(|i| {
                projects.is_empty() || i.project.as_deref().is_some_and(|p| projects.contains(&p))
            })
            .collect();
        found.sort_by_key(|i| std::cmp::Reverse(i.id));
        let total = found.len();
        Reply::ok(json!({
            "issues": found.iter().map(|i| i.summary()).collect::<Vec<_>>(),
            "next_cursor": null,
            "total": total,
        }))
    }

    fn patch(&mut self, req: &Req, key: &str) -> Reply {
        let body = req.json();
        let Some(item) = self.item(key) else {
            return Reply::problem(404, "no such item");
        };
        if let Some(who) = body.get("assignee") {
            item.assignee = who.as_str().map(|u| u.trim_start_matches('@').to_owned());
        }
        if let Some(resolution) = body.get("resolution") {
            match resolution.as_str() {
                None => {
                    item.resolution = None;
                    item.label = "New".to_owned();
                }
                Some(r) => {
                    item.resolution = Some(r.to_owned());
                    item.label = "Done".to_owned();
                    item.duplicate_of = body
                        .get("duplicate_of")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                }
            }
        }
        if let Some(title) = body.get("title").and_then(Value::as_str) {
            item.title = title.to_owned();
        }
        Reply::ok(item.issue())
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
            return Reply::problem(400, &format!("{to} is not a lane"));
        };
        let Some(item) = self.item(&key) else {
            return Reply::problem(404, &format!("no item {key}"));
        };
        if lane_of(&from).map(|l| l.2) != lane_of(&item.label).map(|l| l.2) {
            return Reply::problem(409, "this card moved; refreshed");
        }
        item.label = label.to_owned();
        item.resolution = closes.then(|| "fixed".to_owned());
        Reply::ok(json!({"card": {
            "key": item.key(),
            "kind": "bug",
            "title": item.title,
            "label": item.label,
            "assignee": item.assignee,
            "order": null,
        }}))
    }

    fn board(&self, req: &Req) -> Reply {
        let statuses = req.params("status");
        let projects = req.params("project");
        let mut cards: Vec<&Item> = self
            .items
            .iter()
            .filter(|i| statuses.is_empty() || statuses.contains(&LANES[i.lane()].0))
            .filter(|i| {
                projects.is_empty() || i.project.as_deref().is_some_and(|p| projects.contains(&p))
            })
            .collect();
        cards.sort_by_key(|i| (i.lane(), std::cmp::Reverse(i.id)));
        Reply::ok(json!({
            "board": {"lanes": LANES
                .iter()
                .map(|(word, label, closes)| json!({"word": word, "label": label, "closes": closes}))
                .collect::<Vec<_>>()},
            "cards": cards.iter().map(|i| i.card()).collect::<Vec<_>>(),
        }))
    }
}

pub type Shared = Arc<Mutex<World>>;
#[derive(Default)]
pub struct Pusher {
    messages: Mutex<Option<Vec<String>>>,
    arrived: AtomicUsize,
}

pub type Pushed = Arc<Pusher>;
pub type Tweak = Box<dyn Fn(&Req, &mut World) -> Option<Reply> + Send + Sync>;

pub fn serve(world: &Shared, tweak: &Tweak, pushed: &Pushed, req: &Req) -> Reply {
    if !req.path.starts_with("/_p99/") {
        return crate::fake::any(req);
    }
    if req.path == "/_p99/v1/stream" {
        pushed.arrived.fetch_add(1, Ordering::SeqCst);
        let began = Instant::now();
        while began.elapsed() < Duration::from_secs(50) {
            if let Some(messages) = pushed.messages.lock().unwrap().take() {
                let said: Vec<&str> = messages.iter().map(String::as_str).collect();
                return Reply::socket(&said, false);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        return Reply::socket(&[], false);
    }
    let mut guard = world.lock().unwrap();
    if let Some(reply) = tweak(req, &mut guard) {
        return reply;
    }
    guard.answer(req)
}

pub struct Back {
    pub stub: Stub,
    pub world: Shared,
    pub pushed: Pushed,
}

impl Back {
    pub fn start(world: World) -> Back {
        let world: Shared = Arc::new(Mutex::new(world));
        let pushed: Pushed = Arc::default();
        let tweak: Tweak = Box::new(|_, _| None);
        let (inner, push) = (Arc::clone(&world), Arc::clone(&pushed));
        let stub = Stub::new(move |req| serve(&inner, &tweak, &push, req));
        Back {
            stub,
            world,
            pushed,
        }
    }

    pub fn worker(&self) -> String {
        self.stub.worker()
    }
}

pub struct Desk {
    pub home: Home,
    pub world: Shared,
    pub pushed: Pushed,
}

impl Desk {
    pub fn new(name: &str, items: Vec<Item>) -> Desk {
        Desk::with(name, World::new(items), |_, _| None)
    }

    pub fn with(
        name: &str,
        world: World,
        tweak: impl Fn(&Req, &mut World) -> Option<Reply> + Send + Sync + 'static,
    ) -> Desk {
        let world: Shared = Arc::new(Mutex::new(world));
        let pushed: Pushed = Arc::default();
        let tweak: Tweak = Box::new(tweak);
        let (inner, push) = (Arc::clone(&world), Arc::clone(&pushed));
        let home = Home::new(name, move |req| serve(&inner, &tweak, &push, req));
        Desk {
            home,
            world,
            pushed,
        }
    }

    pub fn push(&self, messages: &[&str]) {
        *self.pushed.messages.lock().unwrap() =
            Some(messages.iter().map(|m| (*m).to_owned()).collect());
    }

    pub fn streams(&self) -> usize {
        self.pushed.arrived.load(Ordering::SeqCst)
    }

    pub fn wait_for_stream(&self) {
        let began = Instant::now();
        while self.streams() == 0 {
            assert!(
                began.elapsed() < Duration::from_secs(30),
                "the TUI never opened its stream"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    pub fn screen(&self, size: &str, keys: &str) -> String {
        screen(&self.home, size, keys)
    }

    pub fn world<T>(&self, work: impl FnOnce(&mut World) -> T) -> T {
        work(&mut self.world.lock().unwrap())
    }

    pub fn calls(&self, method: &str, path: &str) -> Vec<Req> {
        self.home.stub.calls(method, path)
    }

    pub fn moves(&self) -> Vec<Value> {
        self.calls("POST", "/_p99/v1/move")
            .iter()
            .map(Req::json)
            .collect()
    }

    pub fn all_signed(&self) {
        let calls: Vec<Req> = self
            .home
            .stub
            .seen()
            .into_iter()
            .filter(|r| r.path.starts_with("/_p99/"))
            .collect();
        assert!(!calls.is_empty(), "the Worker was never called");
        for call in calls {
            assert!(call.signed, "{} {} is not signed", call.method, call.target);
        }
    }
}

pub fn screen(home: &Home, size: &str, keys: &str) -> String {
    let mut args = vec!["tui", "--dump", size];
    if !keys.is_empty() {
        args.extend(["--keys", keys]);
    }
    let out = home.p99(&args);
    out.ok();
    out.stdout
}

pub fn rows_with<'a>(screen: &'a str, needle: &str) -> Vec<&'a str> {
    screen.lines().filter(|l| l.contains(needle)).collect()
}

pub fn has_key(screen: &str, key: &str) -> bool {
    screen.lines().any(|line| {
        line.match_indices(key).any(|(at, _)| {
            let next = line[at + key.len()..].chars().next();
            next.is_none_or(|c| !c.is_ascii_digit())
        })
    })
}

pub fn column_at(screen: &str, header: &str) -> usize {
    let line = rows_with(screen, header)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no column {header:?}:\n{screen}"));
    line[..line.find(header).unwrap()].chars().count()
}

pub fn card_at(screen: &str, key: &str) -> usize {
    let needle = format!("─ {key} ─");
    let line = rows_with(screen, &needle)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no card {key}:\n{screen}"));
    line[..line.find(&needle).unwrap()].chars().count()
}

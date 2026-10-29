#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::fake;
use crate::home::{self, Home, Out};
use crate::stub::{Reply, Req, Stub};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const TOKEN: &str = "cf-token-Us7Qm2Zr9Lx4Vb8";
pub const KEY: &str = "p99-key-Us3Wq8Ts5Kd1Fy6";
pub const RESEND: &str = "re_us_Fw6Yp2Jc9Ga7Mu3";
pub const ACCESS: &str = "access-secret-Us4Ne8Rk2Xo6";
pub const PEPPER: &str = "pepper-Us9Hb3Qe7Wn2";
pub const UPLOAD: &str = "/cf/accounts/acc1/workers/scripts/p99";

#[derive(Default, Clone)]
pub struct Cloud {
    pub refuse: bool,
    pub accounts: Vec<(&'static str, &'static str)>,
    pub worker: bool,
    pub bindings: Vec<Value>,
    pub tag: Option<String>,
    pub others: Vec<(String, Vec<Value>)>,
    pub secrets: Vec<(String, String)>,
    pub databases: Vec<(String, String)>,
    pub buckets: Vec<String>,
    pub table: bool,
    pub applied: Vec<String>,
    pub rows: Vec<(&'static str, Value)>,
    pub routes: Vec<(String, String)>,
    pub denied: Vec<&'static str>,
    pub broken: Option<(&'static str, &'static str)>,
    pub zoneless: bool,
    pub fail: Option<String>,
    pub fail_with: Option<&'static str>,
    pub mail: Option<String>,
}

impl Cloud {
    pub fn secret(&self, name: &str) -> Option<String> {
        self.secrets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    }

    pub fn binding(&self, name: &str) -> Value {
        self.bindings
            .iter()
            .find(|b| b["name"] == name)
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn state(&self) -> Value {
        json!({
            "worker": self.worker,
            "bindings": self.bindings,
            "tag": self.tag,
            "secrets": self.secrets,
            "databases": self.databases,
            "buckets": self.buckets,
            "table": self.table,
            "applied": self.applied,
            "routes": self.routes,
            "mail": self.mail,
        })
    }
}

pub type Shared = Arc<Mutex<Cloud>>;

pub fn shipped() -> Vec<String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("worker/migrations");
    let mut all: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".sql"))
        .collect();
    all.sort();
    all
}

pub fn first(n: usize) -> Vec<String> {
    shipped().into_iter().take(n).collect()
}

pub fn after(n: usize) -> Vec<String> {
    shipped().into_iter().skip(n).collect()
}

pub fn recorded(sql: &str) -> Vec<String> {
    let start = "INSERT INTO d1_migrations (name) VALUES ('";
    sql.split(start)
        .skip(1)
        .filter_map(|rest| rest.find("')").map(|end| rest[..end].to_owned()))
        .collect()
}

pub fn metadata(body: &str) -> Value {
    let head = "name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n";
    let Some(at) = body.find(head) else {
        return Value::Null;
    };
    let rest = &body[at + head.len()..];
    let end = rest.find("\r\n--").unwrap_or(rest.len());
    serde_json::from_str(&rest[..end]).unwrap_or(Value::Null)
}

fn listed(items: Vec<Value>) -> Reply {
    Reply::ok(json!({
        "success": true,
        "errors": [],
        "result": items,
        "result_info": {"page": 1, "total_pages": 1},
    }))
}

fn d1(cf: &mut Cloud, req: &Req) -> Reply {
    let body = req.json();
    let sql = body["sql"].as_str().unwrap_or_default().to_owned();
    let rows = |r: Value| Reply::cf(json!([{"success": true, "results": r, "meta": {}}]));
    if sql == "SELECT name FROM d1_migrations ORDER BY id" {
        if !cf.table {
            return Reply::cf_error(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        }
        let names: Vec<Value> = cf.applied.iter().map(|n| json!({"name": n})).collect();
        return rows(Value::Array(names));
    }
    if sql.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations") {
        cf.table = true;
    }
    let names = recorded(&sql);
    if !names.is_empty() {
        if !cf.table {
            return Reply::cf_error(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        }
        if names.iter().any(|n| cf.fail.as_deref() == Some(n.as_str())) {
            return Reply::cf_error(
                400,
                7500,
                cf.fail_with
                    .unwrap_or("near \"github\": syntax error: SQLITE_ERROR"),
            );
        }
        cf.applied.extend(names);
        return rows(json!([]));
    }
    if sql.starts_with("INSERT OR IGNORE INTO mail ") {
        if !cf.applied.iter().any(|a| a == "0008_mail.sql") {
            return Reply::cf_error(400, 7500, "no such table: mail: SQLITE_ERROR");
        }
        if cf.mail.is_some() {
            return rows(json!([]));
        }
        cf.mail = body["params"][0].as_str().map(str::to_owned);
        return rows(json!([{"id": 1}]));
    }
    if sql.starts_with("SELECT ") {
        let labelled = cf.applied.iter().any(|a| a == "0005_labels.sql");
        let carded = cf.applied.iter().any(|a| a == "0015_cards.sql");
        if cf.table && !carded && sql.contains(".cards") {
            return Reply::cf_error(400, 7500, "no such column: b.cards: SQLITE_ERROR");
        }
        if cf.table
            && !labelled
            && ["item_labels", "labels l", "priority"]
                .iter()
                .any(|t| sql.contains(t))
        {
            return Reply::cf_error(400, 7500, "no such table: item_labels: SQLITE_ERROR");
        }
        let found = cf
            .rows
            .iter()
            .find(|(pattern, _)| sql.contains(pattern))
            .map(|(_, r)| r.clone())
            .unwrap_or_else(|| json!([]));
        return rows(found);
    }
    rows(json!([]))
}

fn cloud(cf: &mut Cloud, req: &Req) -> Reply {
    let path = req.path.strip_prefix("/cf").unwrap_or_default();
    if let Some((method, end)) = cf.broken
        && req.method == method
        && path.ends_with(end)
    {
        return Reply::raw(
            502,
            "text/html",
            b"<html><body>502 Bad Gateway</body></html>",
        );
    }
    if cf.refuse {
        return Reply::cf_error(401, 1000, "Invalid API Token");
    }
    if cf.denied.iter().any(|d| path.ends_with(d)) {
        return Reply::cf_error(403, 10000, "Authentication error");
    }
    let s: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let body = req.json();
    match (req.method.as_str(), s.as_slice()) {
        ("GET", ["user", "tokens", "verify"]) | ("GET", ["accounts", _, "tokens", "verify"]) => {
            Reply::cf(json!({"status": "active"}))
        }
        ("GET", ["accounts"]) => listed(
            cf.accounts
                .iter()
                .map(|(id, name)| json!({"id": id, "name": name}))
                .collect(),
        ),
        ("GET", ["accounts", _, "workers", "scripts"]) => {
            let mut all = Vec::new();
            if cf.worker {
                all.push(json!({"id": "p99", "migration_tag": cf.tag.clone().unwrap_or_default()}));
            }
            all.extend(cf.others.iter().map(|(n, _)| json!({"id": n})));
            Reply::cf(Value::Array(all))
        }
        ("GET", ["accounts", _, "workers", "scripts", name, "settings"]) => {
            if *name == "p99" && cf.worker {
                Reply::cf(json!({"bindings": cf.bindings}))
            } else if let Some((_, b)) = cf.others.iter().find(|(n, _)| n == name) {
                Reply::cf(json!({"bindings": b}))
            } else {
                Reply::cf_error(404, 10007, "This Worker does not exist on your account.")
            }
        }
        ("GET", ["accounts", _, "workers", "scripts", _, "secrets"]) => Reply::cf(Value::Array(
            cf.secrets
                .iter()
                .map(|(n, _)| json!({"name": n, "type": "secret_text"}))
                .collect(),
        )),
        ("PUT", ["accounts", _, "workers", "scripts", _, "secrets"]) => {
            let name = body["name"].as_str().unwrap_or_default().to_owned();
            let text = body["text"].as_str().unwrap_or_default().to_owned();
            cf.secrets.retain(|(n, _)| *n != name);
            cf.secrets.push((name, text));
            Reply::cf(json!({}))
        }
        ("PUT", ["accounts", _, "workers", "scripts", _, "schedules"]) => Reply::cf(json!({})),
        ("PUT", ["accounts", _, "workers", "scripts", name]) => {
            let meta = metadata(&req.text());
            let bindings = meta["bindings"].as_array().cloned().unwrap_or_default();
            if *name == "p99" {
                cf.worker = true;
                cf.bindings = bindings;
            } else {
                cf.others.retain(|(n, _)| n != name);
                cf.others.push(((*name).to_owned(), bindings));
            }
            let keeps = meta["keep_bindings"]
                .as_array()
                .is_some_and(|k| k.iter().any(|t| t == "secret_text"));
            if !keeps {
                cf.secrets.clear();
            }
            if let Some(tag) = meta["migrations"]["new_tag"].as_str() {
                cf.tag = Some(tag.to_owned());
            }
            Reply::cf(json!({"id": "p99"}))
        }
        ("GET", ["accounts", _, "d1", "database"]) => listed(
            cf.databases
                .iter()
                .map(|(id, name)| json!({"uuid": id, "name": name}))
                .collect(),
        ),
        ("POST", ["accounts", _, "d1", "database"]) => {
            let name = body["name"].as_str().unwrap_or_default().to_owned();
            cf.databases.push(("db-made".into(), name.clone()));
            Reply::cf(json!({"uuid": "db-made", "name": name}))
        }
        ("POST", ["accounts", _, "d1", "database", _, "query"]) => d1(cf, req),
        ("GET", ["accounts", _, "r2", "buckets"]) => Reply::cf(json!({
            "buckets": cf.buckets.iter().map(|b| json!({"name": b})).collect::<Vec<_>>(),
        })),
        ("POST", ["accounts", _, "r2", "buckets"]) => {
            cf.buckets
                .push(body["name"].as_str().unwrap_or_default().to_owned());
            Reply::cf(json!({}))
        }
        ("GET", ["zones"]) if cf.zoneless => listed(Vec::new()),
        ("GET", ["zones"]) => listed(vec![json!({"id": "z1", "name": "example.com"})]),
        ("GET", ["zones", _, "workers", "routes"]) => Reply::cf(Value::Array(
            cf.routes
                .iter()
                .enumerate()
                .map(|(i, (p, w))| json!({"id": format!("r{i}"), "pattern": p, "script": w}))
                .collect(),
        )),
        ("POST", ["zones", _, "workers", "routes"]) => {
            cf.routes.push((
                body["pattern"].as_str().unwrap_or_default().to_owned(),
                body["script"].as_str().unwrap_or_default().to_owned(),
            ));
            Reply::cf(json!({"id": "r-new"}))
        }
        _ => fake::cloudflare(req),
    }
}

fn answer(state: &Shared, req: &Req) -> Reply {
    if req.path.starts_with("/cf/") {
        return cloud(&mut state.lock().unwrap(), req);
    }
    fake::any(req)
}

pub fn rate(namespace: &str) -> Value {
    json!({"type": "ratelimit", "name": "RATE", "namespace_id": namespace, "simple": {"limit": 120, "period": 60}})
}

pub fn fresh() -> Cloud {
    Cloud {
        accounts: vec![("acc1", "Example")],
        others: vec![("shop-www".into(), vec![rate("1001")])],
        ..Default::default()
    }
}

pub fn live() -> Cloud {
    Cloud {
        worker: true,
        bindings: vec![
            json!({"type": "d1", "name": "DB", "database_id": "db1"}),
            json!({"type": "r2_bucket", "name": "BUCKET", "bucket_name": "p99"}),
            json!({"type": "plain_text", "name": "VERSION", "text": "1.9.0"}),
            rate("1003"),
        ],
        tag: Some("p99-hub-1".into()),
        secrets: vec![
            ("KEY_P99".into(), crate::stub::KEY.into()),
            ("MANAGERS".into(), "ada@example.com".into()),
        ],
        databases: vec![("db1".into(), "p99".into())],
        buckets: vec!["p99".into()],
        table: true,
        applied: shipped(),
        ..fresh()
    }
}

pub fn at(applied: usize, rows: Vec<(&'static str, Value)>) -> Cloud {
    Cloud {
        applied: first(applied),
        rows,
        ..live()
    }
}

pub fn space_config(_base: &str) -> String {
    format!(
        r#"license = "p99-licence-Us5Mi3Qa7Ld9"
default_space = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[spaces.main]
name = "Example Co"
account_id = "acc1"
token = "{TOKEN}"
database_id = "db1"
key = "{KEY}"
resend_key = "{RESEND}"
access_client_id = "id.access"
access_client_secret = "{ACCESS}"

[hosts."example.com"]
space = "main"
"#
    )
}

pub fn with(name: &str, cloud: Cloud, config: impl Fn(&str) -> String) -> (Home, Shared) {
    let state: Shared = Arc::new(Mutex::new(cloud));
    let seen = state.clone();
    let stub = Stub::new(move |req: &Req| answer(&seen, req));
    let text = config(&stub.base);
    (Home::with_config(name, stub, &text), state)
}

pub fn configured(name: &str, cloud: Cloud) -> (Home, Shared) {
    with(name, cloud, home::config)
}

pub fn spaced(name: &str, cloud: Cloud) -> (Home, Shared) {
    with(name, cloud, space_config)
}

pub fn blank(name: &str, cloud: Cloud) -> (Home, Shared) {
    let (h, cf) = configured(name, cloud);
    std::fs::remove_file(h.file()).unwrap();
    (h, cf)
}

pub fn cf_calls(h: &Home) -> Vec<Req> {
    h.stub
        .seen()
        .into_iter()
        .filter(|r| r.path.starts_with("/cf/"))
        .collect()
}

pub fn sql_of(r: &Req) -> Option<String> {
    if !r.path.ends_with("/query") {
        return None;
    }
    r.json()["sql"].as_str().map(str::to_owned)
}

pub fn sqls(h: &Home) -> Vec<(String, Value)> {
    cf_calls(h)
        .into_iter()
        .filter(|r| r.method == "POST" && r.path.ends_with("/query"))
        .map(|r| {
            let body = r.json();
            (
                body["sql"].as_str().unwrap_or_default().to_owned(),
                body["params"].clone(),
            )
        })
        .collect()
}

pub fn inserted_in(calls: &[Req]) -> Vec<String> {
    calls
        .iter()
        .filter_map(sql_of)
        .flat_map(|s| recorded(&s))
        .collect()
}

pub fn inserted(h: &Home) -> Vec<String> {
    inserted_in(&cf_calls(h))
}

pub fn writes_in(calls: &[Req]) -> Vec<String> {
    calls
        .iter()
        .filter(|r| match sql_of(r) {
            Some(sql) => !sql.starts_with("SELECT "),
            None => r.method != "GET",
        })
        .map(|r| match sql_of(r) {
            Some(sql) => format!("D1 {}", sql.chars().take(60).collect::<String>()),
            None => format!("{} {}", r.method, r.path),
        })
        .collect()
}

pub fn since(h: &Home, n: usize) -> Vec<Req> {
    cf_calls(h).into_iter().skip(n).collect()
}

pub fn uploads_in(calls: &[Req]) -> Vec<Req> {
    calls
        .iter()
        .filter(|r| r.is("PUT", UPLOAD))
        .cloned()
        .collect()
}

pub fn all(out: &Out) -> String {
    format!("{}{}", out.stdout, out.stderr)
}

pub fn never_shows(outs: &[&Out], secrets: &[&str]) {
    for out in outs {
        let text = all(out);
        for secret in secrets.iter().chain(&[TOKEN, KEY, RESEND, ACCESS, PEPPER]) {
            assert!(
                !text.contains(secret),
                "a secret reached the output:\n{text}"
            );
        }
    }
}

pub fn plan_hash(text: &str) -> String {
    let at = text.find("Plan hash: ").expect("no plan hash") + "Plan hash: ".len();
    let hash: String = text[at..].chars().take(64).collect();
    assert!(
        hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()),
        "{hash}"
    );
    hash
}

pub fn is_hex(text: &str) -> bool {
    text.len() == 64 && text.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn refuses_and_changes_nothing(h: &Home, cf: &Shared, args: &[&str], why: &str) -> Out {
    let before = cf.lock().unwrap().state();
    let n = cf_calls(h).len();
    let out = h.p99(args);
    assert_eq!(out.code, Some(1), "{args:?}: {}", all(&out));
    assert!(out.stderr.contains(why), "{args:?}: {}", out.stderr);
    let later = since(h, n);
    assert!(
        writes_in(&later).is_empty(),
        "{args:?} was refused yet wrote: {:?}",
        writes_in(&later)
    );
    assert!(uploads_in(&later).is_empty(), "{args:?}");
    assert_eq!(cf.lock().unwrap().state(), before, "{args:?}");
    out
}

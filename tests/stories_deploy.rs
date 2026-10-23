use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const TOKEN: &str = "cf-token-7Qm2Zr9Lx4Vb8Ke1";
const KEY: &str = "p99-key-Hn3Wq8Ts5Kd1Fy6";
const RESEND: &str = "re_Fw6Yp2Jc9Ga7Mu3";
const ACCESS: &str = "access-secret-Ub4Ne8Rk2Xo6";
const LICENSE: &str = "p99-licence-Vz5Mi3Qa7Ld9";
const HOOK: &str = "https://hooks.slack.com/services/T0EXAMPLE/B0EXAMPLE/Xy7Kp3Wm9QrTe2";

const SHIPPED: [&str; 15] = [
    "0001_p99.sql",
    "0002_code_uid.sql",
    "0003_code_totp.sql",
    "0004_boards.sql",
    "0005_labels.sql",
    "0006_hooks.sql",
    "0007_github.sql",
    "0008_mail.sql",
    "0009_merge.sql",
    "0010_deletions.sql",
    "0011_lanes.sql",
    "0012_people.sql",
    "0013_app.sql",
    "0014_backup_cut.sql",
    "0015_cards.sql",
];

#[derive(Debug, Clone)]
struct Call {
    method: String,
    path: String,
    auth: String,
    body: String,
}

impl Call {
    fn sql(&self) -> Option<String> {
        if !self.path.ends_with("/query") {
            return None;
        }
        serde_json::from_str::<Value>(&self.body)
            .ok()
            .and_then(|b| b["sql"].as_str().map(str::to_owned))
    }

    fn writes(&self) -> bool {
        match self.sql() {
            Some(sql) => !sql.starts_with("SELECT "),
            None => self.method != "GET",
        }
    }

    fn upload(&self) -> bool {
        self.method == "PUT"
            && self.path.starts_with("/accounts/")
            && self.path.split('/').count() == 6
            && self.path.contains("/workers/scripts/")
    }
}

#[derive(Default)]
struct Cf {
    worker: bool,
    bindings: Vec<Value>,
    tag: Option<String>,
    secrets: Vec<String>,
    routes: Vec<Value>,
    table: bool,
    applied: Vec<String>,
    rows: Vec<(&'static str, Value)>,
    fail: Option<String>,
    denied: bool,
    deny: Option<&'static str>,
    calls: Vec<Call>,
}

type Shared = Arc<Mutex<Cf>>;

fn ok(result: Value) -> (u16, Value) {
    (
        200,
        json!({ "success": true, "errors": [], "messages": [], "result": result }),
    )
}

fn refused(status: u16, code: i64, message: &str) -> (u16, Value) {
    (
        status,
        json!({ "success": false, "errors": [{ "code": code, "message": message }], "result": null }),
    )
}

fn recorded(sql: &str) -> Option<String> {
    let start = "INSERT INTO d1_migrations (name) VALUES ('";
    let at = sql.find(start)? + start.len();
    let rest = &sql[at..];
    Some(rest[..rest.find("')")?].to_owned())
}

fn d1(cf: &mut Cf, body: &str) -> (u16, Value) {
    let sql = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|b| b["sql"].as_str().map(str::to_owned))
        .unwrap_or_default();
    let rows = |r: Value| ok(json!([{ "success": true, "results": r, "meta": {} }]));
    if sql == "SELECT name FROM d1_migrations ORDER BY id" {
        if !cf.table {
            return refused(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        }
        let names: Vec<Value> = cf.applied.iter().map(|n| json!({ "name": n })).collect();
        return rows(Value::Array(names));
    }
    if sql.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations") {
        cf.table = true;
        return rows(json!([]));
    }
    if let Some(name) = recorded(&sql) {
        if !cf.table {
            return refused(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        }
        if cf.fail.as_deref() == Some(name.as_str()) {
            return refused(400, 7500, "near \"github\": syntax error: SQLITE_ERROR");
        }
        cf.applied.push(name);
        return rows(json!([]));
    }
    if sql.starts_with("SELECT ") {
        let labelled = cf.applied.iter().any(|a| a == "0005_labels.sql");
        if cf.table
            && !labelled
            && ["item_labels", "labels l", "priority"]
                .iter()
                .any(|t| sql.contains(t))
        {
            return refused(400, 7500, "no such table: item_labels: SQLITE_ERROR");
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

fn answer(cf: &mut Cf, method: &str, path: &str, body: &str) -> (u16, Value) {
    let bare = path.split('?').next().unwrap_or(path);
    let parts: Vec<&str> = bare.trim_matches('/').split('/').collect();
    if method == "GET" && parts == ["_p99", "health"] {
        return (200, json!({ "ok": true, "version": VERSION }));
    }
    if cf.denied || cf.deny.is_some_and(|p| bare.ends_with(p)) {
        return refused(403, 10000, "Authentication error");
    }
    match (method, parts.as_slice()) {
        ("GET", ["accounts", _, "workers", "scripts"]) => {
            let scripts: Vec<Value> = if cf.worker {
                vec![json!({ "id": "p99", "migration_tag": cf.tag.clone().unwrap_or_default() })]
            } else {
                Vec::new()
            };
            ok(Value::Array(scripts))
        }
        ("GET", ["accounts", _, "workers", "scripts", _, "settings"]) => {
            if cf.worker {
                ok(json!({ "bindings": cf.bindings }))
            } else {
                refused(404, 10007, "This Worker does not exist on your account.")
            }
        }
        ("GET", ["accounts", _, "workers", "scripts", _, "secrets"]) => {
            let names: Vec<Value> = cf
                .secrets
                .iter()
                .map(|n| json!({ "name": n, "type": "secret_text" }))
                .collect();
            ok(Value::Array(names))
        }
        ("PUT", ["accounts", _, "workers", "scripts", _, "secrets"]) => {
            let sent: Value = serde_json::from_str(body).unwrap_or_default();
            if let Some(name) = sent["name"].as_str() {
                cf.secrets.push(name.to_owned());
            }
            ok(json!({ "name": sent["name"], "type": "secret_text" }))
        }
        ("PUT", ["accounts", _, "workers", "scripts", _]) => {
            cf.worker = true;
            ok(json!({ "id": "p99" }))
        }
        ("PUT", ["accounts", _, "workers", "scripts", _, "schedules"]) => ok(json!({})),
        ("POST", ["accounts", _, "d1", "database", _, "query"]) => d1(cf, body),
        ("GET", ["zones"]) => (
            200,
            json!({
                "success": true,
                "errors": [],
                "result": [{ "id": "z1", "name": "example.com" }],
                "result_info": { "page": 1, "total_pages": 1 },
            }),
        ),
        ("GET", ["zones", _, "workers", "routes"]) => ok(Value::Array(cf.routes.clone())),
        ("POST", ["zones", _, "workers", "routes"]) => {
            let sent: Value = serde_json::from_str(body).unwrap_or_default();
            cf.routes.push(sent);
            ok(json!({ "id": "r1" }))
        }
        ("GET", ["accounts", _, "workers", "subdomain"]) => ok(json!({ "subdomain": "example" })),
        ("POST", ["accounts", _, "workers", "scripts", _, "subdomain"]) => ok(json!({})),
        ("GET", ["accounts", _, "workers", "domains"]) => ok(json!([])),
        ("GET", ["accounts", _, "pages", "projects"]) => ok(json!([])),
        _ => refused(404, 7003, "No route for that URI"),
    }
}

fn serve(cf: Shared) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or_default().to_owned();
            let path = parts.next().unwrap_or_default().to_owned();
            let mut length = 0;
            let mut chunked = false;
            let mut auth = String::new();
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                    break;
                }
                let (k, v) = header.split_once(':').unwrap_or_default();
                if k.eq_ignore_ascii_case("content-length") {
                    length = v.trim().parse().unwrap_or(0);
                }
                if k.eq_ignore_ascii_case("transfer-encoding") {
                    chunked = v.trim().eq_ignore_ascii_case("chunked");
                }
                if k.eq_ignore_ascii_case("authorization") {
                    auth = v.trim().to_owned();
                }
            }
            let mut body = vec![0; length];
            if reader.read_exact(&mut body).is_err() {
                continue;
            }
            while chunked {
                let mut size = String::new();
                if reader.read_line(&mut size).is_err() {
                    break;
                }
                let n = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
                let mut chunk = vec![0; n + 2];
                if reader.read_exact(&mut chunk).is_err() {
                    break;
                }
                body.extend_from_slice(&chunk[..n]);
                chunked = n > 0;
            }
            let body = String::from_utf8_lossy(&body).into_owned();
            let (status, reply) = {
                let mut cf = cf.lock().unwrap();
                let reply = answer(&mut cf, &method, &path, &body);
                cf.calls.push(Call {
                    method,
                    path,
                    auth,
                    body,
                });
                reply
            };
            let reply = reply.to_string();
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
        }
    });
    base
}

struct Out {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Out {
    fn all(&self) -> String {
        format!("{}{}", self.stdout, self.stderr)
    }

    fn json(&self) -> Value {
        serde_json::from_str(&self.stdout)
            .unwrap_or_else(|e| panic!("stdout is not JSON ({e}): {}", self.stdout))
    }
}

struct Home {
    dir: PathBuf,
    base: String,
    cf: Shared,
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn account(name: &str, database: &str, token: &str) -> String {
    format!(
        "[accounts.{name}]\naccount_id = \"acc1\"\ntoken = \"{token}\"\ndatabase_id = \"{database}\"\nkey = \"{KEY}\"\nresend_key = \"{RESEND}\"\naccess_client_id = \"id.access\"\naccess_client_secret = \"{ACCESS}\"\n\n"
    )
}

fn plain_config() -> String {
    format!(
        "license = \"{LICENSE}\"\n\n{}[hosts.\"example.com\"]\naccount = \"main\"\n",
        account("main", "db1", TOKEN)
    )
}

fn home(story: &str, config: &str, cf: Cf) -> Home {
    let dir =
        std::env::temp_dir().join(format!("p99-stories-deploy-{}-{story}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("config.toml");
    std::fs::write(&file, config).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let cf: Shared = Arc::new(Mutex::new(cf));
    let base = serve(cf.clone());
    Home { dir, base, cf }
}

impl Home {
    fn run(&self, args: &[&str]) -> Out {
        self.run_with(args, &[])
    }

    fn run_with(&self, args: &[&str], envs: &[(&str, &str)]) -> Out {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_p99"));
        cmd.args(args)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for keep in [
            "PATH",
            "SYSTEMROOT",
            "TMPDIR",
            "TEMP",
            "TMP",
            "LLVM_PROFILE_FILE",
            "CARGO_LLVM_COV",
            "CARGO_LLVM_COV_TARGET_DIR",
        ] {
            if let Some(value) = std::env::var_os(keep) {
                cmd.env(keep, value);
            }
        }
        cmd.env("HOME", &self.dir)
            .env("P99_CONFIG", self.dir.join("config.toml"))
            .env("P99_CLOUDFLARE_API", &self.base)
            .env("P99_HOST_URL", &self.base)
            .env("NO_COLOR", "1");
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let out = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stdout.read_to_string(&mut s);
            s
        });
        let err = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let deadline = Instant::now() + Duration::from_secs(90);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("p99 {args:?} ran past its deadline");
            }
            std::thread::park_timeout(Duration::from_millis(5));
        };
        Out {
            code: status.code(),
            stdout: out.join().unwrap(),
            stderr: err.join().unwrap(),
        }
    }

    fn calls(&self) -> Vec<Call> {
        self.cf.lock().unwrap().calls.clone()
    }

    fn forget(&self) {
        self.cf.lock().unwrap().calls.clear();
    }

    fn applied(&self) -> Vec<String> {
        self.cf.lock().unwrap().applied.clone()
    }

    fn writes(&self) -> Vec<String> {
        self.calls()
            .iter()
            .filter(|c| c.writes())
            .map(|c| match c.sql() {
                Some(sql) => format!("D1 {}", sql.chars().take(60).collect::<String>()),
                None => format!("{} {}", c.method, c.path),
            })
            .collect()
    }

    fn inserted(&self) -> Vec<String> {
        self.calls()
            .iter()
            .filter_map(|c| c.sql().and_then(|s| recorded(&s)))
            .collect()
    }

    fn upload(&self) -> Option<Call> {
        self.calls().into_iter().find(Call::upload)
    }

    fn account(&self) -> Value {
        let cf = self.cf.lock().unwrap();
        json!({
            "worker": cf.worker,
            "bindings": cf.bindings,
            "tag": cf.tag,
            "secrets": cf.secrets,
            "routes": cf.routes,
            "table": cf.table,
            "applied": cf.applied,
        })
    }

    fn refuses_and_changes_nothing(&self, args: &[&str], why: &str) -> Out {
        let before = self.account();
        self.forget();
        let out = self.run(args);
        assert_eq!(out.code, Some(1), "{args:?}: {}", out.stderr);
        assert!(out.stderr.contains(why), "{args:?}: {}", out.stderr);
        assert!(
            self.writes().is_empty(),
            "{args:?} was refused yet wrote: {:?}",
            self.writes()
        );
        assert!(
            self.calls()
                .iter()
                .all(|c| c.method == "GET" || c.sql().is_some_and(|s| s.starts_with("SELECT "))),
            "{args:?}"
        );
        assert_eq!(self.account(), before, "{args:?}");
        out
    }
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn latest() -> Vec<String> {
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

fn metadata(upload: &Call) -> Value {
    let head = "name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n";
    let at = upload
        .body
        .find(head)
        .expect("the upload has no metadata part")
        + head.len();
    let rest = &upload.body[at..];
    serde_json::from_str(&rest[..rest.find("\r\n--").unwrap()]).unwrap()
}

fn uploaded_files(upload: &Call) -> Vec<String> {
    upload
        .body
        .split("\r\nContent-Disposition: form-data; name=\"")
        .skip(1)
        .filter_map(|part| {
            let name = &part[..part.find('"')?];
            part[name.len()..]
                .starts_with("\"; filename=\"")
                .then(|| name.to_owned())
        })
        .collect()
}

fn plan_hash(text: &str) -> String {
    let at = text.find("Plan hash: ").expect("no plan hash") + "Plan hash: ".len();
    let hash: String = text[at..].chars().take(64).collect();
    assert!(
        hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()),
        "{hash}"
    );
    hash
}

fn never_shows_a_secret(outs: &[&Out], extra: &[&str]) {
    for out in outs {
        let all = out.all();
        for secret in [TOKEN, KEY, RESEND, ACCESS, LICENSE, HOOK]
            .iter()
            .chain(extra)
        {
            assert!(!all.contains(secret), "a secret reached the output:\n{all}");
        }
    }
}

fn bindings_of_a_live_worker() -> Vec<Value> {
    vec![
        json!({ "type": "d1", "name": "DB", "id": "db1" }),
        json!({ "type": "r2_bucket", "name": "BUCKET", "bucket_name": "p99" }),
        json!({ "type": "plain_text", "name": "VERSION", "text": "1.8.3" }),
        json!({ "type": "ratelimit", "name": "RATE", "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } }),
        json!({ "type": "durable_object_namespace", "name": "HUB", "class_name": "P99Hub" }),
        json!({ "type": "secret_text", "name": "CODE_PEPPER" }),
        json!({ "type": "secret_text", "name": "RESEND_KEY" }),
        json!({ "type": "plain_text", "name": "HOOK_URL", "text": HOOK }),
    ]
}

fn live(applied: &[&str], rows: Vec<(&'static str, Value)>) -> Cf {
    Cf {
        worker: true,
        bindings: bindings_of_a_live_worker(),
        tag: Some("p99-hub-1".into()),
        secrets: names(&["CODE_PEPPER", "RESEND_KEY"]),
        routes: vec![json!({ "id": "r0", "pattern": "example.com/_p99/*", "script": "p99" })],
        table: true,
        applied: names(applied),
        rows,
        ..Default::default()
    }
}

fn v17_rows() -> Vec<(&'static str, Value)> {
    vec![
        (
            "FROM items GROUP BY status",
            json!([
                { "status": "new", "items": 3, "open": 2 },
                { "status": "resolved", "items": 1, "open": 0 },
            ]),
        ),
        (
            "WHERE manager = 1 AND revoked_at IS NULL",
            json!([{ "email": "ada@example.com", "name": "Ada Lovelace", "hosts_json": "[\"*\"]" }]),
        ),
        (
            "SELECT h.host",
            json!([{ "host": "example.com", "items": 4 }]),
        ),
        (
            "UNION ALL SELECT lower(trim(assignee))",
            json!([
                { "email": "ada@example.com", "name": "Ada Lovelace", "first": 1 },
                { "email": "grace@example.com", "name": "Grace Hopper", "first": 2 },
            ]),
        ),
        (
            "GROUP BY kind",
            json!([
                { "kind": "bug", "items": 3, "open": 2 },
                { "kind": "feature", "items": 1, "open": 0 },
            ]),
        ),
        (
            "json_extract(config_json, '$.above')",
            json!([{ "host": "example.com", "env": "production", "above": null, "off": null }]),
        ),
    ]
}

fn v18_rows() -> Vec<(&'static str, Value)> {
    vec![
        (
            "FROM statuses s LEFT JOIN items",
            json!([
                { "status": "inbox", "label": "Inbox", "items": 2, "open": 2 },
                { "status": "doing", "label": "Doing", "items": 1, "open": 1 },
                { "status": "review", "label": "Review", "items": 0, "open": 0 },
                { "status": "done", "label": "Done", "items": 3, "open": 0 },
            ]),
        ),
        (
            "WHERE manager = 1 AND revoked_at IS NULL",
            json!([{ "email": "ada@example.com", "name": "Ada Lovelace", "hosts_json": "[\"*\"]" }]),
        ),
        (
            "SELECT b.slug, b.name",
            json!([
                { "slug": "web", "name": "Web", "host": "example.com", "parent": null, "items": 5 },
                { "slug": "mobile", "name": "Mobile", "host": "example.com", "parent": "web", "items": 1 },
            ]),
        ),
        (
            "row_number()",
            json!([{ "board": "web", "label": "Inbox", "cards": 2, "moves": 2 }]),
        ),
        (
            "SELECT l.name AS tag",
            json!([{ "tag": "urgent", "items": 2 }]),
        ),
        (
            "SELECT count(DISTINCT il.item_id) AS items FROM item_labels",
            json!([{ "items": 2 }]),
        ),
        (
            "JOIN labels l ON lower(trim(l.name)) = lower(trim(s.name))",
            json!([{ "label": "Doing", "tag": "doing" }]),
        ),
        (
            "UNION ALL SELECT lower(trim(assignee))",
            json!([
                { "email": "ada@example.com", "name": "Ada Lovelace", "first": 1 },
                { "email": "grace@example.com", "name": "Grace Hopper", "first": 2 },
            ]),
        ),
        (
            "reporter_agent = 1",
            json!([{ "email": "bot@example.com", "name": "Build Bot", "actions": 3 }]),
        ),
        (
            "GROUP BY kind",
            json!([{ "kind": "bug", "items": 6, "open": 3 }]),
        ),
        (
            "json_extract(config_json, '$.above')",
            json!([{ "host": "example.com", "env": "production", "above": "#cookie-bar", "off": "[\"/admin\"]" }]),
        ),
    ]
}

fn v19_rows() -> Vec<(&'static str, Value)> {
    vec![(
        "count(DISTINCT il.label_id) AS tags",
        json!([{ "items": 3, "tags": 2 }]),
    )]
}

#[test]
fn a_fresh_database_gets_every_migration_once_in_order_before_the_worker_goes_up() {
    let fresh = Cf {
        worker: true,
        ..Default::default()
    };
    let h = home("fresh", &plain_config(), fresh);

    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(0), "{}", plan.stderr);
    assert!(
        plan.stdout
            .contains("nothing to migrate: the database is new")
    );
    plan_hash(&plan.stdout);
    assert!(
        h.writes().is_empty(),
        "migrate --plan wrote: {:?}",
        h.writes()
    );
    h.forget();

    let out = h.run(&["deploy", "--json"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let report = out.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["version"], VERSION);
    assert!(report.get("error").is_none());
    assert!(report["migrations"].get("accepted").is_none());
    assert_eq!(report["migrations"]["applied"], json!(latest()));
    assert_eq!(h.inserted(), latest());
    assert_eq!(h.applied(), latest());

    let calls = h.calls();
    let table = calls
        .iter()
        .position(|c| {
            c.sql()
                .is_some_and(|s| s.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations"))
        })
        .expect("the migrations table was never made");
    let first = calls
        .iter()
        .position(|c| c.sql().is_some_and(|s| recorded(&s).is_some()))
        .unwrap();
    let last = calls
        .iter()
        .rposition(|c| c.sql().is_some_and(|s| recorded(&s).is_some()))
        .unwrap();
    let upload = calls.iter().position(Call::upload).expect("no upload");
    assert!(table < first && last < upload);

    let sent = metadata(&calls[upload]);
    assert_eq!(sent["main_module"], "worker.js");
    assert_eq!(sent["keep_bindings"], json!(["secret_text"]));
    assert_eq!(sent["migrations"]["new_tag"], "p99-hub-1");
    assert!(sent["migrations"].get("old_tag").is_none());
    let bound: Vec<&str> = sent["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["name"].as_str().unwrap())
        .collect();
    for name in [
        "DB",
        "BUCKET",
        "VERSION",
        "LICENSE_STATE",
        "LICENSE_LINK",
        "HUB",
        "RATE",
        "APP_HOST",
    ] {
        assert!(bound.contains(&name), "{name} missing from {bound:?}");
    }
    let page = sent["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["name"] == "APP_HOST")
        .unwrap();
    assert!(
        page["text"]
            .as_str()
            .is_some_and(|h| h.ends_with(".example.workers.dev")),
        "{page}"
    );
    let db = sent["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["name"] == "DB")
        .unwrap();
    assert_eq!(db["database_id"], "db1");
    let rate = sent["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["name"] == "RATE")
        .unwrap();
    assert_eq!(rate["namespace_id"], "1001");
    let modules: Vec<String> = report["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(uploaded_files(&calls[upload]), modules);

    let pepper = calls
        .iter()
        .find(|c| c.method == "PUT" && c.path.ends_with("/secrets"))
        .expect("a fresh Worker got no pepper");
    let pepper: Value = serde_json::from_str(&pepper.body).unwrap();
    assert_eq!(pepper["name"], "CODE_PEPPER");
    let value = pepper["text"].as_str().unwrap().to_owned();
    assert!(value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()));
    assert!(
        calls
            .iter()
            .any(|c| c.method == "PUT" && c.path.ends_with("/schedules"))
    );
    assert!(calls.iter().any(|c| c.method == "POST"
        && c.path == "/zones/z1/workers/routes"
        && c.body.contains("example.com/_p99/*")));
    assert_eq!(report["routes"][0]["created"], true);
    assert_eq!(report["health"][0]["ok"], true);
    assert_eq!(report["app"], "https://p99.example.workers.dev/");
    assert!(
        calls
            .iter()
            .all(|c| c.path.ends_with("/_p99/health") || c.auth == format!("Bearer {TOKEN}"))
    );
    never_shows_a_secret(&[&plan, &out], &[&value]);
}

#[test]
fn an_account_already_at_0015_deploys_with_no_hash_applies_nothing_and_keeps_every_secret() {
    let h = home("at-0015", &plain_config(), live(&SHIPPED, v19_rows()));

    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(0), "{}", plan.stderr);
    assert!(plan.stdout.contains("nothing to migrate"));
    assert!(plan.stdout.contains("deploy needs no --accept-plan"));
    assert!(
        plan.stdout.contains(": 2 tags on 3 items"),
        "{}",
        plan.stdout
    );
    h.forget();

    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert!(out.stdout.contains("every migration is applied"));
    assert!(out.stdout.contains("secret CODE_PEPPER is kept as it is"));
    assert!(h.inserted().is_empty());
    assert_eq!(h.applied(), names(&SHIPPED));
    let calls = h.calls();
    assert!(
        !calls
            .iter()
            .any(|c| c.method == "PUT" && c.path.ends_with("/secrets"))
    );
    assert!(
        !calls
            .iter()
            .any(|c| c.method == "POST" && c.path.ends_with("/workers/routes"))
    );
    let upload = h.upload().expect("no upload");
    let sent = metadata(&upload);
    assert!(
        sent.get("migrations").is_none(),
        "the hub was migrated again: {sent}"
    );
    assert_eq!(sent["keep_bindings"], json!(["secret_text"]));
    let bindings = sent["bindings"].as_array().unwrap();
    assert!(
        bindings
            .iter()
            .all(|b| b["type"] != "secret_text" && b["type"] != "secret_key")
    );
    let hook = bindings
        .iter()
        .find(|b| b["name"] == "HOOK_URL")
        .expect("a hand-added binding was dropped");
    assert_eq!(hook["text"], HOOK);
    assert_eq!(bindings.iter().filter(|b| b["name"] == "RATE").count(), 1);
    assert_eq!(
        bindings.iter().find(|b| b["name"] == "VERSION").unwrap()["text"],
        VERSION
    );
    assert!(
        !upload.body.contains(TOKEN)
            && !upload.body.contains(KEY)
            && !upload.body.contains(RESEND)
            && !upload.body.contains(LICENSE)
            && !upload.body.contains(ACCESS)
    );

    let first = h.writes();
    h.forget();
    let again = h.run(&["deploy"]);
    assert_eq!(again.code, Some(0), "{}", again.stderr);
    assert_eq!(
        h.writes(),
        first,
        "a second deploy did something the first didn't"
    );
    never_shows_a_secret(&[&plan, &out, &again], &[]);
}

#[test]
fn deploy_without_a_worker_says_run_setup_and_writes_nothing() {
    let h = home("no-worker", &plain_config(), Cf::default());
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .ends_with("p99: the account has no Worker called p99; run p99 setup\n"),
        "{}",
        out.stderr
    );
    assert!(h.writes().is_empty(), "{:?}", h.writes());
    assert!(h.calls().iter().all(|c| c.sql().is_none()));

    let json = h.run(&["deploy", "--json"]);
    assert_eq!(json.code, Some(1));
    let report = json.json();
    assert_eq!(report["ok"], false);
    assert_eq!(
        report["error"],
        "the account has no Worker called p99; run p99 setup"
    );
    never_shows_a_secret(&[&out, &json], &[]);
}

#[test]
fn migrate_plan_on_a_1_7_schema_shows_states_boards_and_people_reads_only_and_hashes_the_same_twice()
 {
    let h = home("plan-17", &plain_config(), live(&SHIPPED[..3], v17_rows()));
    let out = h.run(&["migrate", "--plan"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let text = &out.stdout;
    assert!(text.starts_with("Migration plan for the account main\n"));
    assert!(
        text.contains(
            "  pending: 0004_boards.sql, 0011_lanes.sql, 0012_people.sql, 0013_app.sql\n"
        ),
        "{text}"
    );
    assert!(text.contains("  with them, 0005_labels.sql, 0006_hooks.sql, 0007_github.sql, 0008_mail.sql, 0009_merge.sql, 0010_deletions.sql add tables, columns and indexes only\n"), "{text}");
    assert!(
        text.contains(&format!(
            "  {:<12} -> {:<7} {:<12} 2 open, 3 in all\n",
            "new", "Inbox", "received"
        )),
        "{text}"
    );
    assert!(
        text.contains(&format!(
            "  {:<12} -> {:<7} {:<12} 0 open, 1 in all\n",
            "resolved", "Done", "fixed"
        )),
        "{text}"
    );
    assert!(text.contains("owned by Ada Lovelace <ada@example.com>"));
    assert!(text.contains("  example.com: 4 items\n"));
    assert!(text.contains("People (0012): 2 rows"));
    assert!(
        text.contains("  BUG- 3 (2 open), FEAT- 1 (0 open)\n"),
        "{text}"
    );
    assert!(text.contains("  none: nothing here needs an answer\n"));
    let hash = plan_hash(text);
    assert!(text.ends_with(&format!(
        "Once the decisions are answered: p99 deploy --accept-plan {hash}\n"
    )));
    assert!(
        h.calls().iter().all(|c| !c.writes()),
        "the plan wrote: {:?}",
        h.writes()
    );

    let json = h.run(&["migrate", "--plan", "--json"]).json();
    assert_eq!(json["account"], "main");
    assert_eq!(json["hash"], hash);
    assert_eq!(
        json["plan"]["pending"],
        json!([
            "0004_boards.sql",
            "0011_lanes.sql",
            "0012_people.sql",
            "0013_app.sql"
        ])
    );
    assert_eq!(json["plan"]["account_id"], "acc1");
    assert_eq!(json["plan"]["database_id"], "db1");
    assert_eq!(json["plan"]["owner"]["email"], "ada@example.com");
    assert_eq!(json["plan"]["decisions"], json!([]));
    assert_eq!(plan_hash(&h.run(&["migrate", "--plan"]).stdout), hash);
    assert!(h.writes().is_empty());
    never_shows_a_secret(&[&out], &[]);
}

#[test]
fn migrate_plan_on_a_1_8_schema_names_every_decision_a_manager_must_answer() {
    let h = home("plan-18", &plain_config(), live(&SHIPPED[..10], v18_rows()));
    let out = h.run(&["migrate", "--plan"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let text = &out.stdout;
    assert!(
        text.contains("  pending: 0011_lanes.sql, 0012_people.sql, 0013_app.sql\n"),
        "{text}"
    );
    assert!(!text.contains("with them,"));
    assert!(text.contains("States become labels (0011)"));
    assert!(
        text.contains("  mobile \"Mobile\" (example.com, nested in web: flattened), 1 item\n"),
        "{text}"
    );
    assert!(text.contains("  web / Inbox: 2 of 2 cards move\n"));
    assert!(text.contains("  urgent: 2 items\n"));
    assert!(text.contains("  - the column Doing and the tag doing would share one label name: rename one before deploying\n"), "{text}");
    assert!(
        text.contains("  - 2 items carry 1 tag beyond their label"),
        "{text}"
    );
    assert!(text.contains("  - Build Bot <bot@example.com> acts through agents but has no code and no assigned items"), "{text}");
    assert!(text.contains("  Build Bot <bot@example.com>: 3 actions, shown as (no username)\n"));
    assert!(
        text.contains("  example.com: env production, above #cookie-bar, off on 1 path\n"),
        "{text}"
    );
    let hash = plan_hash(text);
    let json = h.run(&["migrate", "--plan", "--json"]).json();
    assert_eq!(json["hash"], hash);
    assert_eq!(json["plan"]["nested"], 1);
    assert_eq!(json["plan"]["tagged"], 2);
    assert_eq!(json["plan"]["decisions"].as_array().unwrap().len(), 3);
    assert!(h.writes().is_empty(), "{:?}", h.writes());
}

#[test]
fn deploy_on_1_8_without_the_hash_refuses_cleanly_and_changes_nothing() {
    let h = home(
        "refuse-18",
        &plain_config(),
        live(&SHIPPED[..10], v18_rows()),
    );
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.ends_with("p99: 0011_lanes.sql, 0012_people.sql, 0013_app.sql change this account's data: read `p99 migrate --plan`, answer its decisions, then run again with --accept-plan <hash>\n"),
        "{}",
        out.stderr
    );
    assert!(
        h.writes().is_empty(),
        "a refused deploy wrote: {:?}",
        h.writes()
    );
    assert!(h.upload().is_none());
    assert_eq!(h.applied(), names(&SHIPPED[..10]));

    let json = h.run(&["deploy", "--json"]);
    assert_eq!(json.code, Some(1));
    let report = json.json();
    assert_eq!(report["ok"], false);
    assert!(
        report["error"]
            .as_str()
            .unwrap()
            .contains("--accept-plan <hash>")
    );
    assert_eq!(report["migrations"]["applied"], json!([]));
    assert!(h.writes().is_empty());
    never_shows_a_secret(&[&out, &json], &[]);
}

#[test]
fn deploy_with_a_stale_hash_refuses_and_changes_nothing() {
    let h = home("stale", &plain_config(), live(&SHIPPED[..10], v18_rows()));
    let hash = h.run(&["migrate", "--plan", "--json"]).json()["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    {
        let mut cf = h.cf.lock().unwrap();
        let kinds = cf
            .rows
            .iter_mut()
            .find(|(p, _)| *p == "GROUP BY kind")
            .unwrap();
        kinds.1 = json!([{ "kind": "bug", "items": 7, "open": 4 }]);
    }
    h.forget();
    let out = h.run(&["deploy", "--accept-plan", &hash]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.ends_with("p99: the plan changed since that hash was taken (the database moved on): read `p99 migrate --plan` again and run with its new hash\n"),
        "{}",
        out.stderr
    );
    assert!(h.writes().is_empty(), "{:?}", h.writes());
    assert_eq!(h.applied(), names(&SHIPPED[..10]));

    let wrong = h.run(&[
        "deploy",
        "--accept-plan",
        "0000000000000000000000000000000000000000000000000000000000000000",
    ]);
    assert_eq!(wrong.code, Some(1));
    assert!(
        wrong
            .stderr
            .contains("the plan changed since that hash was taken")
    );
    assert!(h.writes().is_empty());
}

#[test]
fn deploy_with_the_plan_hash_applies_exactly_the_pending_migrations_in_order() {
    let h = home(
        "accept-18",
        &plain_config(),
        live(&SHIPPED[..10], v18_rows()),
    );
    let hash = plan_hash(&h.run(&["migrate", "--plan"]).stdout);
    h.forget();
    let shouted = format!("  {}  ", hash.to_ascii_uppercase());
    let out = h.run(&["deploy", "--json", "--accept-plan", &shouted]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let report = out.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["migrations"]["accepted"], hash);
    assert_eq!(
        report["migrations"]["applied"],
        json!(names(&SHIPPED[10..]))
    );
    assert_eq!(
        report["migrations"]["already"],
        json!(names(&SHIPPED[..10]))
    );
    assert_eq!(h.inserted(), names(&SHIPPED[10..]));
    assert_eq!(h.applied(), names(&SHIPPED));
    let calls = h.calls();
    let last = calls
        .iter()
        .rposition(|c| c.sql().is_some_and(|s| recorded(&s).is_some()))
        .unwrap();
    assert!(calls.iter().position(Call::upload).unwrap() > last);

    h.forget();
    let after = h.run(&["deploy"]);
    assert_eq!(after.code, Some(0), "{}", after.stderr);
    assert!(h.inserted().is_empty());
}

#[test]
fn a_1_7_account_with_its_hash_gets_0004_to_0015_in_order() {
    let mut cf = live(&SHIPPED[..3], v17_rows());
    cf.tag = None;
    let h = home("accept-17", &plain_config(), cf);
    let hash = plan_hash(&h.run(&["migrate", "--plan"]).stdout);
    h.forget();
    let out = h.run(&["deploy", "--accept-plan", &hash]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert_eq!(h.inserted(), names(&SHIPPED[3..]));
    assert_eq!(h.applied(), names(&SHIPPED));
    let sent = metadata(&h.upload().unwrap());
    assert_eq!(sent["migrations"]["new_tag"], "p99-hub-1");
}

#[test]
fn a_hash_taken_on_one_account_never_unlocks_another() {
    let config = format!(
        "{}{}[hosts.\"example.com\"]\naccount = \"main\"\n",
        account("main", "db1", TOKEN),
        account("other", "db2", TOKEN)
    );
    let h = home("cross", &config, live(&SHIPPED[..10], v18_rows()));
    let main = h
        .run(&["migrate", "--plan", "--json", "--account", "main"])
        .json();
    let other = h
        .run(&["migrate", "--plan", "--json", "--account", "other"])
        .json();
    assert_ne!(main["hash"], other["hash"]);
    h.forget();
    let out = h.run(&[
        "deploy",
        "--account",
        "other",
        "--accept-plan",
        main["hash"].as_str().unwrap(),
    ]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .contains("the plan changed since that hash was taken"),
        "{}",
        out.stderr
    );
    assert!(h.writes().is_empty(), "{:?}", h.writes());
}

fn half_rows() -> Vec<(&'static str, Value)> {
    v18_rows()
        .into_iter()
        .filter(|(p, _)| {
            ![
                "row_number()",
                "AS tag",
                "FROM item_labels",
                "JOIN labels l",
            ]
            .iter()
            .any(|t| p.contains(t))
        })
        .collect()
}

#[test]
fn an_account_stopped_between_0004_and_0005_plans_read_only_and_takes_0005_to_0015_in_one_deploy() {
    let h = home(
        "half-0004",
        &plain_config(),
        live(&SHIPPED[..4], half_rows()),
    );
    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(0), "{}", plan.stderr);
    assert!(
        plan.stdout
            .contains("  pending: 0011_lanes.sql, 0012_people.sql, 0013_app.sql\n"),
        "{}",
        plan.stdout
    );
    assert!(h.writes().is_empty(), "{:?}", h.writes());
    let hash = plan_hash(&plan.stdout);

    let after = home(
        "half-0004-twin",
        &plain_config(),
        live(&SHIPPED[..10], half_rows()),
    );
    let twin = plan_hash(&after.run(&["migrate", "--plan"]).stdout);
    assert_eq!(
        hash, twin,
        "the plan read before 0005 must equal the plan 0005 to 0010 would leave"
    );

    let out = h.refuses_and_changes_nothing(
        &["deploy"],
        "0011_lanes.sql, 0012_people.sql, 0013_app.sql change this account's data",
    );
    assert!(!out.stderr.contains("applied 0005"), "{}", out.stderr);
    assert_eq!(h.applied(), names(&SHIPPED[..4]));

    h.forget();
    let done = h.run(&["deploy", "--accept-plan", &hash]);
    assert_eq!(done.code, Some(0), "{}", done.stderr);
    assert_eq!(h.inserted(), names(&SHIPPED[4..]));
    assert_eq!(h.applied(), names(&SHIPPED));
    let calls = h.calls();
    let last = calls
        .iter()
        .rposition(|c| c.sql().is_some_and(|s| recorded(&s).is_some()))
        .unwrap();
    assert!(calls.iter().position(Call::upload).unwrap() > last);
}

#[test]
fn every_refusal_on_an_account_stopped_after_0004_leaves_it_as_it_was() {
    let h = home(
        "refusals-0004",
        &plain_config(),
        live(&SHIPPED[..4], half_rows()),
    );
    let hash = plan_hash(&h.run(&["migrate", "--plan"]).stdout);
    let gated = "0011_lanes.sql, 0012_people.sql, 0013_app.sql change this account's data";
    let changed = "the plan changed since that hash was taken";
    h.refuses_and_changes_nothing(&["deploy"], gated);
    h.refuses_and_changes_nothing(&["deploy", "--json"], gated);
    h.refuses_and_changes_nothing(
        &["deploy", "--accept-plan", "not-a-hash"],
        "--accept-plan takes the 64-character hash",
    );
    h.refuses_and_changes_nothing(&["deploy", "--accept-plan", &"0".repeat(64)], changed);
    let mut other = hash.clone();
    other.replace_range(..1, if hash.starts_with('a') { "b" } else { "a" });
    h.refuses_and_changes_nothing(&["deploy", "--accept-plan", &other], changed);

    {
        let mut cf = h.cf.lock().unwrap();
        let kinds = cf
            .rows
            .iter_mut()
            .find(|(p, _)| *p == "GROUP BY kind")
            .unwrap();
        kinds.1 = json!([{ "kind": "bug", "items": 9, "open": 5 }]);
    }
    h.refuses_and_changes_nothing(&["deploy", "--accept-plan", &hash], changed);
    assert_eq!(h.applied(), names(&SHIPPED[..4]));
    assert!(h.upload().is_none());
}

#[test]
fn a_token_refused_partway_stops_the_deploy_before_its_first_write() {
    for (n, path) in ["/workers/scripts", "/secrets", "/zones", "/subdomain"]
        .into_iter()
        .enumerate()
    {
        let mut cf = live(&SHIPPED[..4], half_rows());
        cf.deny = Some(path);
        let h = home(&format!("partway-{n}"), &plain_config(), cf);
        let hash = plan_hash(&h.run(&["migrate", "--plan"]).stdout);
        let out = h.refuses_and_changes_nothing(
            &["deploy", "--accept-plan", &hash],
            "Authentication error (10000)",
        );
        assert!(out.stderr.contains(path), "{path}: {}", out.stderr);
        assert_eq!(h.applied(), names(&SHIPPED[..4]), "{path}");
        assert!(h.inserted().is_empty(), "{path}");
        never_shows_a_secret(&[&out], &[]);

        h.cf.lock().unwrap().deny = None;
        h.forget();
        let done = h.run(&["deploy", "--accept-plan", &hash]);
        assert_eq!(done.code, Some(0), "{path}: {}", done.stderr);
        assert_eq!(h.inserted(), names(&SHIPPED[4..]), "{path}");
        assert!(h.upload().is_some(), "{path}");
    }
}

#[test]
fn a_token_refused_partway_on_an_up_to_date_account_writes_nothing_either() {
    for (n, path) in ["/workers/scripts", "/secrets", "/zones", "/subdomain"]
        .into_iter()
        .enumerate()
    {
        let mut cf = live(&SHIPPED, Vec::new());
        cf.deny = Some(path);
        let h = home(&format!("partway-done-{n}"), &plain_config(), cf);
        h.refuses_and_changes_nothing(&["deploy"], "Authentication error (10000)");
        assert!(h.upload().is_none(), "{path}");
    }
}

#[test]
fn an_interrupted_1_9_deploy_resumes_from_0012_only_with_the_plan_hash() {
    let mut rows = v18_rows();
    rows.extend(v19_rows());
    let h = home("half-0011", &plain_config(), live(&SHIPPED[..11], rows));
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .contains("p99: 0012_people.sql, 0013_app.sql change this account's data"),
        "{}",
        out.stderr
    );
    assert!(h.writes().is_empty(), "{:?}", h.writes());

    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(0), "{}", plan.stderr);
    assert!(
        plan.stdout
            .contains("  pending: 0012_people.sql, 0013_app.sql\n"),
        "{}",
        plan.stdout
    );
    assert!(!plan.stdout.contains("States become labels"));
    assert!(plan.stdout.contains(": 2 tags on 3 items"));
    let hash = plan_hash(&plan.stdout);
    h.forget();
    let done = h.run(&["deploy", "--accept-plan", &hash]);
    assert_eq!(done.code, Some(0), "{}", done.stderr);
    assert_eq!(h.inserted(), names(&SHIPPED[11..]));
}

#[test]
fn a_migration_that_fails_midway_stops_before_the_upload_and_the_account_resumes_without_losing_a_step()
 {
    let fresh = Cf {
        worker: true,
        fail: Some("0007_github.sql".into()),
        ..Default::default()
    };
    let h = home("fails", &plain_config(), fresh);
    let out = h.run(&["deploy", "--json"]);
    assert_eq!(out.code, Some(1));
    assert!(out.stderr.contains("p99: Cloudflare /accounts/acc1/d1/database/db1/query: near \"github\": syntax error: SQLITE_ERROR (7500)"), "{}", out.stderr);
    assert_eq!(out.json()["ok"], false);
    assert_eq!(h.applied(), names(&SHIPPED[..6]));
    assert!(h.upload().is_none());
    let calls = h.calls();
    assert!(!calls.iter().any(|c| c.method != "GET"
        && (c.path.ends_with("/secrets")
            || c.path.ends_with("/schedules")
            || c.path.ends_with("/workers/routes"))));

    h.cf.lock().unwrap().fail = None;
    h.refuses_and_changes_nothing(
        &["deploy"],
        "0011_lanes.sql, 0012_people.sql, 0013_app.sql change this account's data",
    );
    assert_eq!(h.applied(), names(&SHIPPED[..6]));

    let hash = plan_hash(&h.run(&["migrate", "--plan"]).stdout);
    h.forget();
    let done = h.run(&["deploy", "--accept-plan", &hash]);
    assert_eq!(done.code, Some(0), "{}", done.stderr);
    let rest: Vec<String> = latest().into_iter().skip(6).collect();
    assert_eq!(h.inserted(), rest);
    assert!(h.upload().is_some());
    never_shows_a_secret(&[&out, &done], &[]);
}

#[test]
fn a_revoked_token_stops_deploy_and_plan_with_a_clean_error_and_never_shows_the_token() {
    let mut cf = live(&SHIPPED, Vec::new());
    cf.denied = true;
    let h = home("denied", &plain_config(), cf);
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.ends_with("p99: Cloudflare /accounts/acc1/workers/scripts/p99/settings: Authentication error (10000)\n"),
        "{}",
        out.stderr
    );
    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(1));
    assert!(
        plan.stderr.ends_with(
            "p99: Cloudflare /accounts/acc1/d1/database/db1/query: Authentication error (10000)\n"
        ),
        "{}",
        plan.stderr
    );
    assert!(
        h.calls()
            .iter()
            .all(|c| c.auth == format!("Bearer {TOKEN}"))
    );
    assert!(h.writes().is_empty());
    never_shows_a_secret(&[&out, &plan], &[]);
}

#[test]
fn the_token_from_the_environment_wins_trimmed_and_1password_is_never_needed() {
    let config = plain_config().replace(
        &format!("token = \"{TOKEN}\""),
        "token = \"op://vault/item/field\"",
    );
    let h = home("env-token", &config, live(&SHIPPED, Vec::new()));
    let out = h.run_with(&["deploy"], &[("P99_TOKEN", &format!("  {TOKEN}\n"))]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    assert!(
        h.calls()
            .iter()
            .filter(|c| !c.path.ends_with("/_p99/health"))
            .all(|c| c.auth == format!("Bearer {TOKEN}"))
    );
    never_shows_a_secret(&[&out], &[]);
}

#[test]
fn a_hand_broken_config_line_never_echoes_the_token_or_a_key_in_its_error() {
    let broken = plain_config().replace(
        &format!("token = \"{TOKEN}\""),
        &format!("token = \"{TOKEN}"),
    );
    let h = home("broken-token", &broken, live(&SHIPPED, Vec::new()));
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(out.stderr.starts_with("p99: "), "{}", out.stderr);
    assert!(h.calls().is_empty());
    never_shows_a_secret(&[&out], &[]);
    assert!(out.stderr.contains("line 5, key token"), "{}", out.stderr);
    assert!(
        out.stderr.contains("the value is not shown"),
        "{}",
        out.stderr
    );

    let unquoted = plain_config().replace(
        &format!("resend_key = \"{RESEND}\""),
        &format!("resend_key = {RESEND}"),
    );
    let h = home("broken-key", &unquoted, live(&SHIPPED, Vec::new()));
    let plan = h.run(&["migrate", "--plan"]);
    assert_eq!(plan.code, Some(1));
    assert!(h.calls().is_empty());
    never_shows_a_secret(&[&plan], &[]);
    assert!(plan.stderr.contains("key resend_key"), "{}", plan.stderr);

    let doubled = plain_config().replace(
        &format!("token = \"{TOKEN}\"\n"),
        &format!("token = \"{TOKEN}\" key = \"{KEY}\"\n"),
    );
    let h = home("broken-double", &doubled, live(&SHIPPED, Vec::new()));
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(h.calls().is_empty());
    never_shows_a_secret(&[&out], &[]);
    assert!(out.stderr.contains("line 5, key token"), "{}", out.stderr);
    assert!(
        out.stderr.contains("the value is not shown"),
        "{}",
        out.stderr
    );
}

#[cfg(unix)]
#[test]
fn a_config_others_can_read_is_refused_before_any_call_and_names_no_secret() {
    use std::os::unix::fs::PermissionsExt;
    let h = home("readable", &plain_config(), live(&SHIPPED, Vec::new()));
    std::fs::set_permissions(
        h.dir.join("config.toml"),
        std::fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    let out = h.run(&["deploy"]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .ends_with("holds a secret and others can read it; run chmod 600 on it\n"),
        "{}",
        out.stderr
    );
    assert!(h.calls().is_empty());
    never_shows_a_secret(&[&out], &[]);
}

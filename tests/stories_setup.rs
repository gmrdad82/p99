#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use home::{Home, Out};
use stub::{KEY, Reply, Req, Stub};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const TOKEN: &str = "cf-setup-token-Rk4Tz8Wq2Mv6";
const ME: [&str; 4] = ["--name", "Ada Lovelace", "--email", "ada@example.com"];
const UPLOAD: &str = "/cf/accounts/acc1/workers/scripts/p99";
const SCHEDULES_502: &str = "Cloudflare /accounts/acc1/workers/scripts/p99/schedules: HTTP 502";

#[derive(Default)]
struct Cloud {
    refuse: bool,
    accounts: Vec<(&'static str, &'static str)>,
    worker: bool,
    bindings: Vec<Value>,
    tag: Option<String>,
    others: Vec<(String, Vec<Value>)>,
    secrets: Vec<(String, String)>,
    databases: Vec<(String, String)>,
    buckets: Vec<String>,
    table: bool,
    applied: Vec<String>,
    routes: Vec<(String, String)>,
    denied: Vec<&'static str>,
    broken: Option<(&'static str, &'static str)>,
    sick: bool,
    zoneless: bool,
    status: Option<&'static str>,
    account_token: bool,
}

impl Cloud {
    fn secret(&self, name: &str) -> Option<String> {
        self.secrets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    }

    fn binding(&self, name: &str) -> Value {
        self.bindings
            .iter()
            .find(|b| b["name"] == name)
            .cloned()
            .unwrap_or(Value::Null)
    }
}

type Shared = Arc<Mutex<Cloud>>;

fn listed(items: Vec<Value>) -> Reply {
    Reply::ok(json!({
        "success": true,
        "errors": [],
        "result": items,
        "result_info": {"page": 1, "total_pages": 1},
    }))
}

fn recorded(sql: &str) -> Option<String> {
    let start = "INSERT INTO d1_migrations (name) VALUES ('";
    let at = sql.find(start)? + start.len();
    let rest = &sql[at..];
    Some(rest[..rest.find("')")?].to_owned())
}

fn metadata(body: &str) -> Value {
    let head = "name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n";
    let Some(at) = body.find(head) else {
        return Value::Null;
    };
    let rest = &body[at + head.len()..];
    let end = rest.find("\r\n--").unwrap_or(rest.len());
    serde_json::from_str(&rest[..end]).unwrap_or(Value::Null)
}

fn d1(cf: &mut Cloud, sql: &str) -> Reply {
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
    if let Some(name) = recorded(sql) {
        cf.applied.push(name);
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
        ("GET", ["user", "tokens", "verify"]) if cf.account_token => {
            Reply::cf_error(401, 1000, "Invalid API Token")
        }
        ("GET", ["user", "tokens", "verify"]) | ("GET", ["accounts", _, "tokens", "verify"]) => {
            Reply::cf(json!({"status": cf.status.unwrap_or("active")}))
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
        ("POST", ["accounts", _, "d1", "database", _, "query"]) => {
            d1(cf, body["sql"].as_str().unwrap_or_default())
        }
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
    if req.path.starts_with("/health/") && state.lock().unwrap().sick {
        return Reply::problem(503, "down");
    }
    fake::any(req)
}

fn rate(namespace: &str) -> Value {
    json!({"type": "ratelimit", "name": "RATE", "namespace_id": namespace, "simple": {"limit": 120, "period": 60}})
}

fn shipped() -> Vec<String> {
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

fn fresh() -> Cloud {
    Cloud {
        accounts: vec![("acc1", "Example")],
        others: vec![("shop-www".into(), vec![rate("1001")])],
        ..Default::default()
    }
}

fn live() -> Cloud {
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
            ("KEY_P99".into(), KEY.into()),
            ("MANAGERS".into(), "ada@example.com".into()),
        ],
        databases: vec![("db1".into(), "p99".into())],
        buckets: vec!["p99".into()],
        table: true,
        applied: shipped(),
        ..fresh()
    }
}

fn blank(name: &str, cloud: Cloud) -> (Home, Shared) {
    let (h, cf) = configured(name, cloud);
    std::fs::remove_file(h.file()).unwrap();
    (h, cf)
}

fn configured(name: &str, cloud: Cloud) -> (Home, Shared) {
    let state: Shared = Arc::new(Mutex::new(cloud));
    let seen = state.clone();
    let stub = Stub::new(move |req: &Req| answer(&seen, req));
    let text = home::config(&stub.base);
    (Home::with_config(name, stub, &text), state)
}

fn setup(h: &Home, extra: &[&str]) -> Out {
    let mut args = vec!["setup", "--yes"];
    args.extend(ME);
    args.extend(extra);
    h.p99_env(&args, &[("P99_TOKEN", TOKEN)])
}

fn sqls(h: &Home) -> Vec<(String, Value)> {
    h.stub
        .under("POST", "/cf/accounts/")
        .into_iter()
        .filter(|r| r.path.ends_with("/query"))
        .map(|r| {
            let body = r.json();
            (
                body["sql"].as_str().unwrap_or_default().to_owned(),
                body["params"].clone(),
            )
        })
        .collect()
}

fn inserted(h: &Home) -> Vec<String> {
    sqls(h).iter().filter_map(|(s, _)| recorded(s)).collect()
}

fn cf_writes(h: &Home) -> Vec<String> {
    h.stub
        .writes()
        .into_iter()
        .filter(|r| r.path.starts_with("/cf/"))
        .map(|r| format!("{} {}", r.method, r.path))
        .collect()
}

fn position(h: &Home, method: &str, path: &str) -> usize {
    h.stub
        .seen()
        .iter()
        .position(|r| r.is(method, path))
        .unwrap_or_else(|| panic!("no {method} {path}"))
}

fn never_shows(outs: &[&Out], secrets: &[&str]) {
    for out in outs {
        for secret in secrets.iter().chain(&[TOKEN]) {
            assert!(
                !out.stdout.contains(secret) && !out.stderr.contains(secret),
                "a secret reached the output:\n{}{}",
                out.stdout,
                out.stderr
            );
        }
    }
}

fn is_hex(text: &str) -> bool {
    text.len() == 64 && text.chars().all(|c| c.is_ascii_hexdigit())
}

#[test]
fn a_fresh_account_gets_its_database_bucket_schema_worker_secrets_and_route_in_one_run() {
    let (h, cf) = blank("setup-fresh", fresh());
    let out = setup(&h, &["--host", "Shop.Example.com", "--no-mail"]);
    out.ok();

    let config = h.toml();
    let main = &config["accounts"]["main"];
    assert_eq!(config["default_account"].as_str(), Some("main"));
    assert_eq!(config["me"]["name"].as_str(), Some("Ada Lovelace"));
    assert_eq!(config["me"]["email"].as_str(), Some("ada@example.com"));
    assert_eq!(main["account_id"].as_str(), Some("acc1"));
    assert_eq!(main["database_id"].as_str(), Some("db-made"));
    assert_eq!(main["token"].as_str(), Some(TOKEN));
    let key = main["key"].as_str().unwrap().to_owned();
    assert!(is_hex(&key), "{key}");
    assert_eq!(
        config["hosts"]["shop.example.com"]["account"].as_str(),
        Some("main")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(h.file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    assert_eq!(
        h.stub.call("POST", "/cf/accounts/acc1/d1/database").json()["name"],
        "p99"
    );
    assert_eq!(
        h.stub.call("POST", "/cf/accounts/acc1/r2/buckets").json()["name"],
        "p99"
    );
    assert_eq!(inserted(&h), shipped());
    let made = position(&h, "POST", "/cf/accounts/acc1/d1/database");
    let schema = h
        .stub
        .seen()
        .iter()
        .position(|r| r.path.ends_with("/query"))
        .unwrap();
    let upload = position(&h, "PUT", UPLOAD);
    let route = position(&h, "POST", "/cf/zones/z1/workers/routes");
    assert!(made < schema && schema < upload && upload < route);

    let state = cf.lock().unwrap();
    assert_eq!(state.tag.as_deref(), Some("p99-hub-1"));
    assert_eq!(state.binding("RATE")["namespace_id"], "1002");
    assert_eq!(state.binding("DB")["database_id"], "db-made");
    assert_eq!(state.binding("BUCKET")["bucket_name"], "p99");
    assert_eq!(state.binding("VERSION")["text"], VERSION);
    assert_eq!(state.secret("KEY_P99").as_deref(), Some(key.as_str()));
    assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
    let pepper = state.secret("CODE_PEPPER").unwrap();
    assert!(is_hex(&pepper) && pepper != key);
    assert!(state.secret("RESEND_API_KEY").is_none());
    assert_eq!(
        state.routes,
        [("shop.example.com/_p99/*".to_owned(), "p99".to_owned())]
    );
    drop(state);

    let written = sqls(&h);
    let env = written
        .iter()
        .find(|(s, _)| s.starts_with("INSERT INTO envs"))
        .expect("no environment was written");
    assert_eq!(env.1, json!(["production", "release"]));
    let host = written
        .iter()
        .find(|(s, _)| s.starts_with("INSERT INTO hosts"))
        .expect("no host was written");
    assert_eq!(host.1[0], "shop.example.com");
    assert_eq!(host.1[1], "production");

    for line in [
        "  ok  Cloudflare accepts the token",
        "  ok  created the D1 database p99 (db-made)",
        "  ok  created the R2 bucket p99",
        "  ok  made a new key (32 random bytes)",
        "  ok  rate-limiting namespace 1002 (the account's other Workers use 1001)",
        "  ok  added the route shop.example.com/_p99/* → p99",
        "  ok  shop.example.com serves the environment production (release)",
        "The account main is set up:",
        "  host                shop.example.com (production)",
        "  mail                off",
        "  p99 invite shop.example.com --name \"Ada Lovelace\" --email ada@example.com",
    ] {
        assert!(out.stdout.contains(line), "{line} missing:\n{}", out.stdout);
    }
    assert!(
        out.stdout.contains(&format!(
            "https://shop.example.com/_p99/health answers {VERSION}"
        )),
        "{}",
        out.stdout
    );
    assert!(!out.stdout.contains("Not added"));
    let bearer = format!("Bearer {TOKEN}");
    assert!(
        h.stub
            .under("GET", "/cf/")
            .iter()
            .chain(&h.stub.under("POST", "/cf/"))
            .all(|r| r.header("authorization") == Some(bearer.as_str()))
    );
    never_shows(&[&out], &[key.as_str(), pepper.as_str()]);
}

#[test]
fn setup_with_json_answers_one_document_and_keeps_its_steps_on_stderr() {
    let (h, _cf) = blank("setup-json", fresh());
    let out = setup(
        &h,
        &["--json", "--host", "shop.example.com=dev", "--no-mail"],
    );
    out.ok();
    let report = out.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["account"], "main");
    assert_eq!(report["account_id"], "acc1");
    assert_eq!(report["worker"], "p99");
    assert_eq!(report["version"], VERSION);
    assert_eq!(report["database"], json!({"name": "p99", "id": "db-made"}));
    assert_eq!(report["bucket"], "p99");
    assert_eq!(report["key"], "config");
    assert_eq!(report["mail"], false);
    assert_eq!(report["failed"], json!([]));
    let host = &report["hosts"][0];
    assert_eq!(host["host"], "shop.example.com");
    assert_eq!(host["env"], "dev");
    assert_eq!(host["kind"], "development");
    assert_eq!(host["routes"], json!(["shop.example.com/_p99/*"]));
    assert_eq!(host["created"], true);
    assert_eq!(host["health"]["ok"], true);
    assert_eq!(host["health"]["version"], VERSION);
    assert_eq!(
        report["next"],
        "p99 invite shop.example.com --name \"Ada Lovelace\" --email ada@example.com"
    );
    assert!(out.stderr.contains("[9/9] The hosts"), "{}", out.stderr);
    assert!(!out.stdout.contains("[1/9]"));
    let env = sqls(&h)
        .into_iter()
        .find(|(s, _)| s.starts_with("INSERT INTO envs"))
        .unwrap();
    assert_eq!(env.1, json!(["dev", "development"]));
    never_shows(&[&out], &[]);
}

#[test]
fn running_setup_again_finds_everything_there_and_changes_nothing_it_made() {
    let (h, cf) = blank("setup-again", fresh());
    let first = setup(&h, &["--host", "shop.example.com", "--no-mail"]);
    first.ok();
    let config = h.config();
    let (key, pepper) = {
        let state = cf.lock().unwrap();
        (
            state.secret("KEY_P99").unwrap(),
            state.secret("CODE_PEPPER").unwrap(),
        )
    };
    let seen = h.stub.seen().len();

    let again = h.p99_env(
        &[
            "setup",
            "--yes",
            "--account",
            "main",
            "--host",
            "shop.example.com",
            "--no-mail",
        ],
        &[("P99_TOKEN", TOKEN)],
    );
    again.ok();
    assert_eq!(h.config(), config, "the second run rewrote the config");
    let later: Vec<Req> = h.stub.seen().into_iter().skip(seen).collect();
    for (method, path) in [
        ("POST", "/cf/accounts/acc1/d1/database"),
        ("POST", "/cf/accounts/acc1/r2/buckets"),
        ("POST", "/cf/zones/z1/workers/routes"),
    ] {
        assert!(
            !later.iter().any(|r| r.is(method, path)),
            "{method} {path} ran again"
        );
    }
    assert!(
        !later
            .iter()
            .any(|r| r.json()["sql"].as_str().and_then(recorded).is_some()),
        "a migration was applied twice"
    );
    let secrets: Vec<String> = later
        .iter()
        .filter(|r| r.method == "PUT" && r.path.ends_with("/secrets"))
        .map(|r| r.json()["name"].as_str().unwrap_or_default().to_owned())
        .collect();
    assert_eq!(secrets, ["KEY_P99"]);
    let upload = later.iter().find(|r| r.is("PUT", UPLOAD)).unwrap();
    let sent = metadata(&upload.text());
    assert!(
        sent.get("migrations").is_none(),
        "the hub was migrated again: {sent}"
    );
    assert!(
        !later.iter().any(|r| r.path.ends_with("/shop-www/settings")),
        "a kept RATE binding was picked again"
    );

    let state = cf.lock().unwrap();
    assert_eq!(state.binding("RATE")["namespace_id"], "1002");
    assert_eq!(state.secret("KEY_P99"), Some(key.clone()));
    assert_eq!(state.secret("CODE_PEPPER"), Some(pepper.clone()));
    assert_eq!(state.applied, shipped());
    assert_eq!(state.routes.len(), 1);
    drop(state);

    for line in [
        "  --  continuing the setup of the account main",
        "  ok  D1 database p99 (db-made) is there",
        "  ok  every migration is applied",
        "  ok  R2 bucket p99 is there",
        "  ok  the account has its key",
        "  ok  secret MANAGERS is kept as it is",
        "  ok  secret CODE_PEPPER is kept as it is",
        "  ok  the route shop.example.com/_p99/* is there",
    ] {
        assert!(
            again.stdout.contains(line),
            "{line} missing:\n{}",
            again.stdout
        );
    }
    never_shows(&[&first, &again], &[key.as_str(), pepper.as_str()]);
}

#[test]
fn a_database_and_bucket_already_there_are_adopted_not_made_again() {
    let mut cloud = fresh();
    cloud.databases = vec![
        ("db-kept".into(), "p99".into()),
        ("db-else".into(), "notes".into()),
    ];
    cloud.buckets = vec!["p99".into(), "photos".into()];
    let (h, cf) = blank("setup-adopt", cloud);
    let out = setup(&h, &["--no-mail"]);
    out.ok();
    assert_eq!(
        h.toml()["accounts"]["main"]["database_id"].as_str(),
        Some("db-kept")
    );
    assert!(
        h.stub
            .calls("POST", "/cf/accounts/acc1/d1/database")
            .is_empty()
    );
    assert!(
        h.stub
            .calls("POST", "/cf/accounts/acc1/r2/buckets")
            .is_empty()
    );
    assert!(
        out.stdout
            .contains("  ok  D1 database p99 (db-kept) is there")
    );
    assert!(out.stdout.contains("  ok  R2 bucket p99 is there"));
    assert!(out.stdout.contains("no host is named yet"));
    assert_eq!(inserted(&h), shipped());
    assert_eq!(cf.lock().unwrap().binding("DB")["database_id"], "db-kept");
    assert!(
        h.toml()
            .get("hosts")
            .is_none_or(|t| t.as_table().is_some_and(toml::map::Map::is_empty))
    );

    let mut cloud = fresh();
    cloud.databases = vec![
        ("db-kept".into(), "p99".into()),
        ("db-else".into(), "notes".into()),
    ];
    cloud.buckets = vec!["p99".into(), "photos".into()];
    let (h, cf) = blank("setup-adopt-named", cloud);
    setup(
        &h,
        &["--database", "notes", "--bucket", "photos", "--no-mail"],
    )
    .ok();
    let main = &h.toml()["accounts"]["main"];
    assert_eq!(main["database_id"].as_str(), Some("db-else"));
    assert_eq!(main["bucket"].as_str(), Some("photos"));
    assert!(
        h.stub
            .calls("POST", "/cf/accounts/acc1/r2/buckets")
            .is_empty()
    );
    assert_eq!(
        cf.lock().unwrap().binding("BUCKET")["bucket_name"],
        "photos"
    );
}

fn denying(denied: &[&'static str]) -> Cloud {
    Cloud {
        denied: denied.to_vec(),
        ..fresh()
    }
}

fn lacks(name: &str, cloud: Cloud, hosts: &[&str], said: &str) -> Home {
    let (h, _cf) = blank(name, cloud);
    let mut extra = vec!["--no-mail"];
    for host in hosts {
        extra.extend(["--host", *host]);
    }
    let out = setup(&h, &extra);
    out.refused(said);
    assert!(
        out.stdout.contains("  !!  The token lacks:"),
        "{}",
        out.stdout
    );
    assert!(cf_writes(&h).is_empty(), "{:?}", cf_writes(&h));
    let config = h.toml();
    assert_eq!(config["me"]["email"].as_str(), Some("ada@example.com"));
    assert!(
        config
            .get("accounts")
            .is_none_or(|t| t.as_table().is_some_and(toml::map::Map::is_empty))
    );
    never_shows(&[&out], &[]);
    h
}

#[test]
fn a_token_without_the_zone_permissions_is_refused_before_anything_is_made() {
    lacks(
        "lacks-routes",
        denying(&["/workers/routes"]),
        &["shop.example.com"],
        "the token lacks Zone › Workers Routes: Edit on example.com (for shop.example.com)",
    );
    lacks(
        "lacks-zones",
        denying(&["/zones"]),
        &["shop.example.com", "blog.example.com"],
        "the token lacks Zone › Zone: Read",
    );
    lacks(
        "lacks-zone-of-host",
        Cloud {
            zoneless: true,
            ..fresh()
        },
        &["shop.example.com", "www.example.org"],
        "the token lacks Zone › Zone: Read on the zone of shop.example.com, Zone › Zone: Read on the zone of www.example.org",
    );
    lacks(
        "lacks-d1",
        denying(&["/d1/database"]),
        &[],
        "the token lacks Account › D1: Edit",
    );
    lacks(
        "lacks-all",
        denying(&["/workers/scripts", "/d1/database", "/r2/buckets"]),
        &[],
        "the token lacks Account › Workers Scripts: Edit, Account › D1: Edit, Account › Workers R2 Storage: Edit",
    );

    let mut cloud = fresh();
    cloud.denied = vec!["/workers/routes"];
    let (h, cf) = blank("lacks-routes-no-host", cloud);
    let out = setup(&h, &["--no-mail"]);
    out.ok();
    assert!(
        out.stdout.contains(
            "  --  no host is named yet; zones and routes are checked when hosts are added"
        )
    );
    assert!(cf.lock().unwrap().worker);
    assert!(
        h.stub
            .calls("POST", "/cf/zones/z1/workers/routes")
            .is_empty()
    );
}

fn refuses(name: &str, cloud: Cloud, args: &[&str], token: bool, said: &str) -> (Home, Shared) {
    let (h, cf) = blank(name, cloud);
    let envs: &[(&str, &str)] = if token { &[("P99_TOKEN", TOKEN)] } else { &[] };
    let out = h.p99_env(args, envs);
    out.refused(said);
    assert_eq!(
        out.stderr
            .lines()
            .filter(|l| l.starts_with("p99: "))
            .count(),
        1,
        "{}",
        out.stderr
    );
    never_shows(&[&out], &[]);
    (h, cf)
}

#[test]
fn each_setup_refusal_is_one_line_and_makes_nothing_on_cloudflare() {
    let me = |extra: &[&'static str]| -> Vec<&'static str> {
        let mut args = vec!["setup", "--yes", "--no-mail"];
        args.extend(ME);
        args.extend(extra);
        args
    };
    let cases: Vec<(&str, Cloud, Vec<&str>, bool, &str)> = vec![
        (
            "refuse-token",
            Cloud {
                refuse: true,
                ..fresh()
            },
            me(&[]),
            true,
            "Cloudflare doesn't accept this token (Cloudflare /accounts: Invalid API Token (1000))",
        ),
        (
            "refuse-disabled-token",
            Cloud {
                status: Some("disabled"),
                ..fresh()
            },
            me(&[]),
            true,
            "the token is disabled",
        ),
        (
            "refuse-expired-account-token",
            Cloud {
                account_token: true,
                status: Some("expired"),
                ..fresh()
            },
            me(&[]),
            true,
            "the token is expired",
        ),
        (
            "refuse-no-token",
            fresh(),
            me(&[]),
            false,
            "Paste the token: give it with --token",
        ),
        (
            "refuse-no-email",
            fresh(),
            vec!["setup", "--yes", "--name", "Ada Lovelace"],
            true,
            "Your e-mail (it becomes the account's first Owner): give it with --email",
        ),
        (
            "refuse-no-name",
            fresh(),
            vec!["setup", "--yes", "--email", "ada@example.com"],
            true,
            "Your name, as P99 shows it: give it with --name",
        ),
        (
            "refuse-two-accounts",
            Cloud {
                accounts: vec![("acc1", "Example"), ("acc2", "Other")],
                ..fresh()
            },
            me(&[]),
            true,
            "several accounts; name one with --account-id",
        ),
        (
            "refuse-account-name",
            fresh(),
            me(&["--account", "my acct"]),
            true,
            "my acct: use letters, digits, - and _ in an account name",
        ),
    ];
    for (name, cloud, args, token, said) in cases {
        let (h, _) = refuses(name, cloud, &args, token, said);
        assert!(cf_writes(&h).is_empty(), "{name}: {:?}", cf_writes(&h));
    }

    for (name, host, said) in [
        ("refuse-host", "shop", "shop is not a hostname"),
        (
            "refuse-kind",
            "shop.example.com=dev:staging",
            "staging is not an environment kind; use release or development",
        ),
        (
            "refuse-empty-label",
            "shop..example.com",
            "shop..example.com is not a hostname",
        ),
    ] {
        let (h, _) = refuses(name, fresh(), &me(&["--host", host]), true, said);
        assert!(h.stub.seen().is_empty(), "{name} reached Cloudflare");
        assert!(!h.file().exists(), "{name} wrote a config");
    }

    let (h, _) = blank("refuse-no-token-list", fresh());
    let out = h.p99(&me(&[]));
    out.refused("Paste the token: give it with --token");
    assert!(h.stub.seen().is_empty());
    for permission in [
        "Account › Workers Scripts: Edit",
        "Account › D1: Edit",
        "Account › Workers R2 Storage: Edit",
        "Zone › Workers Routes: Edit",
        "Zone › Zone: Read",
    ] {
        assert!(
            out.stdout.contains(permission),
            "{permission}: {}",
            out.stdout
        );
    }
}

#[test]
fn a_worker_of_the_same_name_on_another_database_is_left_alone() {
    let cloud = Cloud {
        worker: true,
        bindings: vec![json!({"type": "d1", "name": "DB", "database_id": "db-other"})],
        ..fresh()
    };
    let (h, cf) = refuses(
        "refuse-foreign-worker",
        cloud,
        &[
            "setup",
            "--yes",
            "--no-mail",
            "--name",
            "Ada Lovelace",
            "--email",
            "ada@example.com",
        ],
        true,
        "a Worker called p99 already exists in the account and uses another database; give P99's Worker another name with --worker",
    );
    assert!(h.stub.calls("PUT", UPLOAD).is_empty());
    assert!(cf.lock().unwrap().secrets.is_empty());
    assert_eq!(cf.lock().unwrap().binding("DB")["database_id"], "db-other");
    let main = &h.toml()["accounts"]["main"];
    assert_eq!(main["database_id"].as_str(), Some("db-made"));
    assert_eq!(
        h.stub.calls("POST", "/cf/accounts/acc1/d1/database").len(),
        1
    );
    assert_eq!(inserted(&h), shipped());
    assert_eq!(cf.lock().unwrap().buckets, ["p99"]);
    assert!(main["key"].as_str().is_some_and(is_hex));
    let again = h.p99_env(
        &[
            "setup",
            "--yes",
            "--account",
            "main",
            "--no-mail",
            "--worker",
            "p99-site",
        ],
        &[("P99_TOKEN", TOKEN)],
    );
    again.ok();
    assert_eq!(
        h.stub.calls("POST", "/cf/accounts/acc1/d1/database").len(),
        1
    );
    assert_eq!(inserted(&h), shipped());
    assert_eq!(cf.lock().unwrap().buckets, ["p99"]);
    assert_eq!(
        h.stub
            .calls("PUT", "/cf/accounts/acc1/workers/scripts/p99-site")
            .len(),
        1
    );
    assert!(h.stub.calls("PUT", UPLOAD).is_empty());
    let state = cf.lock().unwrap();
    assert_eq!(state.binding("DB")["database_id"], "db-other");
    let (_, site) = state.others.iter().find(|(n, _)| n == "p99-site").unwrap();
    let db = site.iter().find(|b| b["name"] == "DB").unwrap();
    assert_eq!(db["database_id"], "db-made");
}

#[test]
fn an_account_scoped_token_is_verified_on_its_account_and_setup_goes_on() {
    let (h, cf) = blank(
        "setup-account-token",
        Cloud {
            account_token: true,
            ..fresh()
        },
    );
    let out = setup(&h, &["--no-mail"]);
    out.ok();
    assert_eq!(h.stub.calls("GET", "/cf/user/tokens/verify").len(), 1);
    assert_eq!(
        h.stub.calls("GET", "/cf/accounts/acc1/tokens/verify").len(),
        1
    );
    assert!(out.stdout.contains("  ok  Cloudflare accepts the token"));
    assert!(cf.lock().unwrap().worker);
    never_shows(&[&out], &[]);
}

#[test]
fn a_route_another_worker_holds_is_named_and_the_host_is_not_added() {
    let cloud = Cloud {
        routes: vec![("shop.example.com/_p99/*".into(), "shop-www".into())],
        ..fresh()
    };
    let (h, cf) = blank("setup-taken-route", cloud);
    let out = setup(&h, &["--json", "--host", "shop.example.com", "--no-mail"]);
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let report = out.json();
    assert_eq!(report["ok"], false);
    assert_eq!(report["failed"], json!(["shop.example.com"]));
    assert_eq!(report["hosts"], json!([]));
    assert!(
        out.stderr.contains("  !!  the route shop.example.com/_p99/* already runs the Worker shop-www; P99 leaves it alone (remove it in the dashboard to give it to p99)"),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.contains(
            "Not added: shop.example.com. Fix what's named above and run p99 setup again."
        )
    );
    assert!(
        h.toml()
            .get("hosts")
            .is_none_or(|t| t.as_table().is_some_and(toml::map::Map::is_empty))
    );
    assert_eq!(
        cf.lock().unwrap().routes,
        [("shop.example.com/_p99/*".to_owned(), "shop-www".to_owned())]
    );
    assert!(
        !sqls(&h)
            .iter()
            .any(|(s, _)| s.starts_with("INSERT INTO hosts"))
    );
}

#[test]
fn deploy_no_check_skips_every_health_call_even_when_the_hosts_are_down() {
    let (h, _cf) = configured(
        "deploy-no-check",
        Cloud {
            sick: true,
            ..live()
        },
    );
    let out = h.p99(&["deploy", "--no-check", "--json"]);
    out.ok();
    let report = out.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["health"], json!([]));
    assert_eq!(report["routes"].as_array().unwrap().len(), 2);
    assert!(h.stub.under("GET", "/health/").is_empty());
    assert!(!out.stderr.contains("_p99/health"), "{}", out.stderr);
}

#[test]
fn a_cloudflare_5xx_after_the_upload_stops_the_deploy_and_the_next_one_finishes_it() {
    let (h, cf) = configured(
        "deploy-502-schedules",
        Cloud {
            broken: Some(("PUT", "/schedules")),
            ..live()
        },
    );
    let out = h.p99(&["deploy", "--json"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.ends_with(&format!("p99: {SCHEDULES_502}\n")),
        "{}",
        out.stderr
    );
    let report = out.json();
    assert_eq!(report["ok"], false);
    assert_eq!(report["error"], SCHEDULES_502);
    assert_eq!(report["account"], "main");
    assert_eq!(report["account_id"], "acc1");
    assert_eq!(report["version"], VERSION);
    assert!(!report["modules"].as_array().unwrap().is_empty());
    assert_eq!(report["routes"], json!([]));
    assert_eq!(report["health"], json!([]));
    assert_eq!(h.stub.calls("PUT", UPLOAD).len(), 1);
    {
        let state = cf.lock().unwrap();
        assert_eq!(state.binding("VERSION")["text"], VERSION);
        assert_eq!(state.secret("KEY_P99").as_deref(), Some(KEY));
        assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
        assert!(state.secret("CODE_PEPPER").is_none());
        assert!(state.routes.is_empty());
    }
    assert!(h.stub.under("GET", "/health/").is_empty());

    cf.lock().unwrap().broken = None;
    let again = h.p99(&["deploy", "--json"]);
    again.ok();
    let report = again.json();
    assert_eq!(report["ok"], true);
    assert!(report.get("error").is_none());
    let state = cf.lock().unwrap();
    assert!(state.secret("CODE_PEPPER").is_some_and(|p| is_hex(&p)));
    assert_eq!(state.secret("KEY_P99").as_deref(), Some(KEY));
    assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
    assert_eq!(state.binding("RATE")["namespace_id"], "1003");
    assert_eq!(state.binding("DB")["database_id"], "db1");
    let mut routes = state.routes.clone();
    routes.sort();
    assert_eq!(
        routes,
        [
            ("dev.example.com/_p99/*".to_owned(), "p99".to_owned()),
            ("shop.example.com/_p99/*".to_owned(), "p99".to_owned()),
        ]
    );
    drop(state);
    never_shows(&[&out, &again], &[KEY, "cf-token"]);
}

#[test]
fn a_cloudflare_5xx_on_the_upload_leaves_the_running_worker_and_its_secrets_as_they_were() {
    let (h, cf) = configured(
        "deploy-502-upload",
        Cloud {
            broken: Some(("PUT", "/workers/scripts/p99")),
            ..live()
        },
    );
    let out = h.p99(&["deploy"]);
    out.refused("Cloudflare /accounts/acc1/workers/scripts/p99: HTTP 502");
    let state = cf.lock().unwrap();
    assert_eq!(state.binding("VERSION")["text"], "1.9.0");
    assert_eq!(state.secrets, live().secrets);
    assert!(state.routes.is_empty());
    drop(state);
    assert!(
        cf_writes(&h)
            .iter()
            .all(|w| w == &format!("PUT {UPLOAD}") || w.ends_with("/query")),
        "{:?}",
        cf_writes(&h)
    );
    let sqls = sqls(&h);
    assert!(!sqls.is_empty());
    assert!(
        sqls.iter().all(|(s, _)| s.starts_with("SELECT ")
            || s.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations")),
        "{sqls:?}"
    );
}

#[test]
fn deploy_json_with_a_token_cloudflare_refuses_says_ok_false_and_why() {
    let (h, _cf) = configured(
        "deploy-refused-json",
        Cloud {
            refuse: true,
            ..live()
        },
    );
    let out = h.p99(&["deploy", "--json"]);
    assert_eq!(out.code, Some(1));
    let said = "Cloudflare /accounts/acc1/workers/scripts/p99/settings: Invalid API Token (1000)";
    assert!(
        out.stderr.ends_with(&format!("p99: {said}\n")),
        "{}",
        out.stderr
    );
    let report = out.json();
    assert_eq!(report["ok"], false);
    assert_eq!(report["error"], said);
    assert_eq!(report["account"], "main");
    assert_eq!(report["worker"], "p99");
    assert_eq!(report["migrations"]["applied"], json!([]));
    let plain = h.p99(&["deploy"]);
    plain.refused(said);
    assert!(!plain.stdout.contains("\"ok\""), "{}", plain.stdout);
    assert!(cf_writes(&h).is_empty(), "{:?}", cf_writes(&h));
    never_shows(&[&out, &plain], &["cf-token", KEY]);
}

#[test]
fn deploy_accept_plan_takes_the_right_hash_in_any_case_and_refuses_a_wrong_one() {
    let at_1_7: Vec<String> = shipped().into_iter().take(3).collect();
    let (h, cf) = configured(
        "deploy-accept",
        Cloud {
            applied: at_1_7.clone(),
            ..live()
        },
    );

    let bare = h.p99(&["deploy"]);
    bare.refused(
        "0004_boards.sql, 0011_lanes.sql, 0012_people.sql, 0013_app.sql, 0016_one_board.sql change this account's data: read `p99 migrate --plan`, answer its decisions, then run again with --accept-plan <hash>",
    );
    let wrong = h.p99(&["deploy", "--accept-plan", &"0".repeat(64)]);
    wrong.refused(
        "the plan changed since that hash was taken (the database moved on): read `p99 migrate --plan` again and run with its new hash",
    );
    for malformed in ["abc", &"g".repeat(64), &"0".repeat(65)] {
        h.p99(&["deploy", "--accept-plan", malformed])
            .refused("--accept-plan takes the 64-character hash `p99 migrate --plan` ends with");
    }
    assert!(inserted(&h).is_empty());
    assert!(h.stub.calls("PUT", UPLOAD).is_empty());
    assert_eq!(cf.lock().unwrap().applied, at_1_7);

    let plan = h.p99(&["migrate", "--plan", "--json"]);
    plan.ok();
    let hash = plan.json()["hash"].as_str().unwrap().to_owned();
    assert!(is_hex(&hash));
    let given = format!("  {}  ", hash.to_ascii_uppercase());
    let done = h.p99(&["deploy", "--json", "--accept-plan", &given]);
    done.ok();
    let report = done.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["migrations"]["accepted"], hash);
    let rest: Vec<String> = shipped().into_iter().skip(3).collect();
    assert_eq!(report["migrations"]["applied"], json!(rest));
    assert_eq!(report["migrations"]["already"], json!(at_1_7));
    assert_eq!(inserted(&h), rest);
    assert_eq!(cf.lock().unwrap().applied, shipped());
    assert_eq!(h.stub.calls("PUT", UPLOAD).len(), 1);

    let seen = h.stub.seen().len();
    let stale = h.p99(&["deploy", "--json", "--accept-plan", &hash]);
    stale.ok();
    assert!(stale.json()["migrations"].get("accepted").is_none());
    assert!(
        !h.stub
            .seen()
            .iter()
            .skip(seen)
            .any(|r| r.json()["sql"].as_str().and_then(recorded).is_some())
    );
}

#[cfg(unix)]
mod vault {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    const MADE: &str = r#"printf '{"id":"item%s","vault":{"id":"vlt1"}}' "$n""#;

    fn op(dir: &Path, made: &str) -> PathBuf {
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let file = bin.join("op");
        std::fs::write(
            &file,
            format!(
                r#"#!/bin/sh
d="$(dirname "$0")"
printf '%s\n' "$*" >> "$d/asked"
case "$1" in
item)
  n=$(( $(cat "$d/count" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$d/count"
  cat > "$d/item$n"
  {made}
  ;;
read)
  item=$(printf '%s' "$3" | cut -d/ -f4)
  sed 's/.*"value":"\([^"]*\)".*/\1/' "$d/$item" | tr -d '\n'
  ;;
*)
  exit 9
  ;;
esac
"#
            ),
        )
        .unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn path(bin: &Path) -> String {
        format!("{}:/usr/bin:/bin", bin.display())
    }

    fn run(h: &Home, bin: &Path, token: bool, extra: &[&str]) -> Out {
        run_on(h, &path(bin), token, extra)
    }

    fn run_on(h: &Home, path: &str, token: bool, extra: &[&str]) -> Out {
        let mut args = vec!["setup", "--yes"];
        args.extend(ME);
        args.extend(extra);
        let mut envs = vec![("PATH", path)];
        if token {
            envs.push(("P99_TOKEN", TOKEN));
        }
        h.p99_env(&args, &envs)
    }

    fn item(bin: &Path, n: u32) -> Value {
        serde_json::from_str(&std::fs::read_to_string(bin.join(format!("item{n}"))).unwrap())
            .unwrap()
    }

    fn asked(bin: &Path) -> Vec<String> {
        std::fs::read_to_string(bin.join("asked"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn setup_with_a_vault_keeps_the_token_and_the_key_there_and_writes_only_references() {
        let (h, cf) = blank("setup-vault", fresh());
        let bin = op(&h.dir, MADE);
        let out = run(
            &h,
            &bin,
            true,
            &[
                "--vault",
                "Example",
                "--host",
                "shop.example.com",
                "--no-mail",
            ],
        );
        out.ok();

        let config = h.toml();
        let main = &config["accounts"]["main"];
        assert_eq!(main["token"].as_str(), Some("op://vlt1/item1/credential"));
        assert_eq!(main["key"].as_str(), Some("op://vlt1/item2/credential"));
        assert!(!h.config().contains(TOKEN), "{}", h.config());

        let token = item(&bin, 1);
        assert_eq!(token["title"], "P99 Cloudflare token");
        assert_eq!(token["category"], "API_CREDENTIAL");
        assert_eq!(
            token["fields"],
            json!([{"id": "credential", "type": "CONCEALED", "label": "credential", "value": TOKEN}])
        );
        let made = item(&bin, 2);
        assert_eq!(made["title"], "P99 key");
        let key = made["fields"][0]["value"].as_str().unwrap().to_owned();
        assert!(is_hex(&key), "{key}");
        assert!(!h.config().contains(&key));

        let calls = asked(&bin);
        assert_eq!(
            calls
                .iter()
                .filter(|c| *c == "item create --vault Example --format json")
                .count(),
            2,
            "{calls:?}"
        );
        assert!(
            calls.contains(&"read --no-newline op://vlt1/item2/credential".to_owned()),
            "{calls:?}"
        );
        assert_eq!(
            cf.lock().unwrap().secret("KEY_P99").as_deref(),
            Some(key.as_str())
        );

        for line in [
            "  ok  P99 Cloudflare token kept in the vault Example",
            "  ok  P99 key kept in the vault Example",
            "  ok  made a new key (32 random bytes)",
            "  key                 p99, kept in the vault",
        ] {
            assert!(out.stdout.contains(line), "{line} missing:\n{}", out.stdout);
        }
        never_shows(&[&out], &[key.as_str()]);
    }

    #[test]
    fn a_second_run_reads_both_references_from_the_vault_and_stores_nothing_new() {
        let (h, cf) = blank("setup-vault-again", fresh());
        let bin = op(&h.dir, MADE);
        run(
            &h,
            &bin,
            true,
            &[
                "--vault",
                "Example",
                "--host",
                "shop.example.com",
                "--no-mail",
            ],
        )
        .ok();
        let before = h.config();
        std::fs::remove_file(bin.join("asked")).unwrap();

        let again = run(
            &h,
            &bin,
            false,
            &[
                "--account",
                "main",
                "--host",
                "shop.example.com",
                "--no-mail",
            ],
        );
        again.ok();
        assert_eq!(h.config(), before);
        assert_eq!(
            std::fs::read_to_string(bin.join("count")).unwrap().trim(),
            "2"
        );
        let calls = asked(&bin);
        assert!(
            calls.iter().all(|c| c.starts_with("read --no-newline ")),
            "{calls:?}"
        );
        assert!(
            calls.contains(&"read --no-newline op://vlt1/item1/credential".to_owned()),
            "{calls:?}"
        );
        assert!(
            again.stdout.contains("  ok  the account has its key"),
            "{}",
            again.stdout
        );
        let bearer = format!("Bearer {TOKEN}");
        assert!(
            h.stub
                .under("GET", "/cf/")
                .iter()
                .all(|r| r.header("authorization") == Some(bearer.as_str()))
        );
        let key = item(&bin, 2)["fields"][0]["value"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            cf.lock().unwrap().secret("KEY_P99").as_deref(),
            Some(key.as_str())
        );
        never_shows(&[&again], &[key.as_str()]);
    }

    #[test]
    fn a_vault_answer_without_its_vault_id_falls_back_to_the_vault_name() {
        let (h, _cf) = blank("setup-vault-name", fresh());
        let bin = op(&h.dir, r#"printf '{"id":"item%s"}' "$n""#);
        run(&h, &bin, true, &["--vault", "Example", "--no-mail"]).ok();
        let config = h.toml();
        assert_eq!(
            config["accounts"]["main"]["token"].as_str(),
            Some("op://Example/item1/credential")
        );
        assert_eq!(
            config["accounts"]["main"]["key"].as_str(),
            Some("op://Example/item2/credential")
        );
    }

    #[test]
    fn no_vault_never_runs_op_even_when_a_vault_is_named() {
        let (h, _cf) = blank("setup-no-vault", fresh());
        let bin = op(&h.dir, MADE);
        run(
            &h,
            &bin,
            true,
            &["--vault", "Example", "--no-vault", "--no-mail"],
        )
        .ok();
        assert!(asked(&bin).is_empty(), "{:?}", asked(&bin));
        assert_eq!(h.toml()["accounts"]["main"]["token"].as_str(), Some(TOKEN));
    }

    #[test]
    fn storing_in_the_vault_refuses_what_op_does_not_give_and_keeps_the_token_out_of_the_config() {
        let cases = [
            (
                "setup-vault-refused",
                "echo '[ERROR] vault \"Example\" was not found' >&2; exit 1",
                "the 1Password CLI: [ERROR] vault \"Example\" was not found",
            ),
            ("setup-vault-garbled", "true", "the 1Password CLI: "),
            (
                "setup-vault-no-id",
                r#"printf '{"vault":{"id":"vlt1"}}'"#,
                "the 1Password CLI gave no item id",
            ),
        ];
        for (name, made, said) in cases {
            let (h, cf) = blank(name, fresh());
            let bin = op(&h.dir, made);
            let out = run(&h, &bin, true, &["--vault", "Example", "--no-mail"]);
            if said.ends_with(": ") {
                assert_eq!(out.code, Some(1), "{name}: {}", out.stderr);
                let last = out.stderr.lines().last().unwrap_or_default();
                assert!(
                    last.len() > said.len() + 5 && last.starts_with(&format!("p99: {said}")),
                    "{name}: {}",
                    out.stderr
                );
            } else {
                out.refused(said);
            }
            assert!(!h.config().contains(TOKEN), "{name}: {}", h.config());
            assert!(!cf.lock().unwrap().worker, "{name}: a Worker went up");
            assert_eq!(item(&bin, 1)["fields"][0]["value"], TOKEN, "{name}");
            never_shows(&[&out], &[]);
        }
    }

    #[test]
    fn storing_in_the_vault_without_op_installed_says_to_install_it() {
        let (h, cf) = blank("setup-vault-missing", fresh());
        let empty = h.dir.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let out = run_on(
            &h,
            empty.to_str().unwrap(),
            true,
            &["--vault", "Example", "--no-mail"],
        );
        assert_eq!(out.code, Some(1), "{}", out.stderr);
        assert!(
            out.stderr.ends_with("; is the 1Password CLI installed?\n"),
            "{}",
            out.stderr
        );
        assert!(!h.config().contains(TOKEN));
        assert!(!cf.lock().unwrap().worker);
    }
}

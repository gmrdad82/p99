#![allow(dead_code)]

use serde_json::{Value, json};

use crate::stub::{Reply, Req, code, host_entry, issue, minted, project_of, summary, thread};

pub const HOSTS: [&str; 3] = ["shop.example.com", "blog.example.com", "dev.example.com"];

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn any(req: &Req) -> Reply {
    let path = req.path.as_str();
    if path.starts_with("/_p99/") {
        worker(req)
    } else if path.starts_with("/cf/") {
        cloudflare(req)
    } else if path.starts_with("/gh/") {
        github(req)
    } else if path.starts_with("/resend/") {
        resend(req)
    } else if path.starts_with("/health/") {
        Reply::ok(json!({"version": VERSION}))
    } else {
        Reply::problem(404, "no such route")
    }
}

fn segments<'a>(req: &'a Req, prefix: &str) -> Vec<&'a str> {
    req.path
        .strip_prefix(prefix)
        .unwrap_or("")
        .split('/')
        .filter(|s| !s.is_empty())
        .collect()
}

pub const PROJECTS: [&str; 2] = ["Shop", "Blog"];

pub fn put_host(host: &str, body: &Value) -> Reply {
    let project = match body.get("project").and_then(Value::as_str) {
        Some(asked) => match PROJECTS
            .iter()
            .find(|p| p.eq_ignore_ascii_case(asked.trim()))
        {
            Some(found) => Some(*found),
            None => {
                return Reply::problem(
                    400,
                    &format!("no project is called {asked}; p99 projects add makes one"),
                );
            }
        },
        None => None,
    };
    let project = match project {
        Some(found) => found,
        None if HOSTS.contains(&host) => project_of(host),
        None => {
            return Reply::problem(
                400,
                &format!("a new host needs a project: p99 hosts add {host} --project <name>"),
            );
        }
    };
    Reply::ok(json!({
        "host": host,
        "env": body["env"],
        "config": body["config"],
        "project": project,
        "created_at": "2026-10-01T09:30:00.000Z",
    }))
}

fn number(raw: &str) -> i64 {
    raw.parse().unwrap_or(0)
}

pub fn worker(req: &Req) -> Reply {
    let s = segments(req, "/_p99/v1/");
    let body = req.json();
    match (req.method.as_str(), s.as_slice()) {
        ("GET", ["hosts"]) => Reply::ok(json!({"hosts": [
            host_entry("shop.example.com", "production"),
            host_entry("blog.example.com", "production"),
        ]})),
        ("PUT", ["hosts", host]) => put_host(host, &body),
        ("PATCH", ["hosts", host]) => Reply::ok(json!({
            "host": host,
            "env": "production",
            "config": {},
            "project": body["project"],
            "created_at": "2026-10-01T09:30:00.000Z",
        })),
        ("GET", ["space"]) => Reply::ok(json!({
            "space": {"slug": "main", "name": "PITO MD"},
            "projects": [
                {"name": "Shop", "hosts": ["shop.example.com"], "open": 3, "closed": 1},
                {"name": "Blog", "hosts": ["blog.example.com", "dev.example.com"], "open": 0, "closed": 2},
            ],
        })),
        ("POST", ["projects"]) => Reply::json(201, json!({"project": {"name": body["name"]}})),
        ("PATCH", ["projects", _]) => Reply::ok(json!({"project": {"name": body["name"]}})),
        ("DELETE", ["hosts", _]) => Reply::ok(json!({"removed": true})),
        ("GET", ["envs"]) => Reply::ok(json!({"envs": [
            {"name": "production", "kind": "release", "position": 0, "notify": false},
            {"name": "dev", "kind": "development", "position": 1, "notify": true},
        ]})),
        ("PUT", ["envs", name]) => Reply::ok(json!({
            "name": name,
            "kind": body["kind"],
            "position": body["position"],
            "notify": body["notify"],
        })),
        ("GET", ["codes"]) => Reply::ok(json!({"codes": [
            code(4, "Grace Hopper", "grace@example.com", &["shop.example.com"]),
            code(5, "Ada Lovelace", "ada@example.com", &["shop.example.com", "dev.example.com"]),
        ]})),
        ("PATCH", ["codes", id]) => {
            let mut held = code(
                number(id),
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            held["grant"] = body["grant"].clone();
            Reply::ok(json!({"code": held}))
        }
        ("POST", ["codes"]) => {
            let projects: Vec<&str> = body["grant"]["projects"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let hosts: Vec<&str> = HOSTS
                .into_iter()
                .filter(|h| body["grant"]["space"] == true || projects.contains(&project_of(h)))
                .collect();
            let mail = (body["mail"] == true).then_some("sent");
            let mut made = minted(
                9,
                body["name"].as_str().unwrap_or(""),
                body["email"].as_str().unwrap_or(""),
                &hosts,
                mail,
            );
            made["code"]["manager"] = json!(body["role"] == "owner");
            made["code"]["role"] = body["role"].clone();
            made["code"]["grant"] = body["grant"].clone();
            if body["totp"] == true {
                made["code"]["totp"] = json!(true);
                made["totp_key"] = json!("JBSWY3DPEHPK3PXP");
            }
            Reply::json(201, made)
        }
        ("POST", ["codes", id, "relink"]) => {
            let id = number(id);
            let mut made = minted(
                id + 10,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
                (body["mail"] == true).then_some("sent"),
            );
            made["revoked"] = code(
                id,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            if body["new_totp"] != true {
                made["totp"] = json!("carried");
            }
            Reply::ok(made)
        }
        ("POST", ["codes", id, "revoke"]) => {
            let mut revoked = code(
                number(id),
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            revoked["revoked_at"] = json!("2026-10-03T08:00:00.000Z");
            Reply::ok(revoked)
        }
        ("POST", ["codes", id, "totp"]) => {
            let mut held = code(
                number(id),
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            held["totp"] = json!(true);
            Reply::ok(json!({"code": held, "totp_key": "JBSWY3DPEHPK3PXP"}))
        }
        ("POST", ["people", "rename"]) => Reply::ok(json!({
            "from": body["from"],
            "to": body["to"],
            "items": 3,
            "assigned": 1,
            "comments": 2,
            "events": 4,
            "attachments": 0,
            "codes": 1,
        })),
        ("GET", ["issues"]) => Reply::ok(json!({
            "issues": [
                summary(12, "The total does not update", "2026-10-02T10:00:00.000Z"),
                summary(14, "The cart forgets an item", "2026-10-04T10:00:00.000Z"),
            ],
            "next_cursor": null,
        })),
        ("GET", ["issues", n]) => Reply::ok(thread(number(n), "The total does not update")),
        ("POST", ["issues"]) => {
            let mut made = issue(21, body["title"].as_str().unwrap_or(""));
            made["kind"] = body["kind"].clone();
            made["body"] = body["body"].clone();
            Reply::json(201, made)
        }
        ("PATCH", ["issues", n]) => {
            let mut changed = issue(number(n), "The total does not update");
            if let Some(title) = body["title"].as_str() {
                changed["title"] = json!(title);
            }
            if let Some(text) = body["body"].as_str() {
                changed["body"] = json!(text);
            }
            if let Some(assignee) = body.get("assignee") {
                changed["assignee"] = match assignee.as_str() {
                    Some(name) => json!({"username": name}),
                    None => Value::Null,
                };
            }
            match body["resolution"].as_str() {
                Some("abandoned") => changed["stage"] = json!("dropped"),
                Some("duplicate") => {
                    changed["stage"] = json!("duplicate");
                    changed["duplicate_of"] = body["duplicate_of"].clone();
                }
                _ => {}
            }
            Reply::ok(changed)
        }
        ("POST", ["issues", _, "comments"]) => Reply::json(
            201,
            json!({
                "id": 31,
                "client_uid": body["client_uid"],
                "author": {"email": "ada@example.com", "name": "Ada Lovelace", "manager": true},
                "body": body["body"],
                "internal": body["internal"],
                "created_at": "2026-10-03T08:00:00.000Z",
            }),
        ),
        ("PUT", ["issues", _, "attachments", uid]) => Reply::json(
            201,
            json!({
                "id": 41,
                "client_uid": uid,
                "role": req.param("role").unwrap_or(""),
                "name": req.param("name").unwrap_or(""),
                "type": req.header("content-type").unwrap_or(""),
                "bytes": req.body.len(),
                "comment_id": req.param("comment").map(number),
            }),
        ),
        ("GET", ["files", _]) => Reply::raw(200, "text/plain", b"line one\nline two\n")
            .with("content-disposition", "attachment; filename=\"notes.txt\""),
        ("POST", ["merge"]) => {
            let items: Vec<String> = body["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|n| format!("BUG-{n}"))
                .collect();
            Reply::ok(json!({
                "into": format!("BUG-{}", body["into"].as_str().unwrap_or("")),
                "merged": items,
                "unchanged": [],
            }))
        }
        ("DELETE", ["issues", n]) => Reply::ok(json!({
            "key": format!("BUG-{n}"),
            "comments": 2,
            "files": 1,
            "retrying": 0,
            "unlinked": [],
        })),
        ("POST", ["builds"]) => Reply::json(201, json!({"ok": true})),
        ("POST", ["move"]) => Reply::ok(json!({"card": {
            "key": format!("BUG-{}", body["key"].as_str().unwrap_or("")),
            "kind": "bug",
            "title": "The total does not update",
            "label": body["to"],
            "assignee": null,
            "order": null,
        }})),
        ("GET", ["hooks"]) => Reply::ok(json!({"hooks": [{
            "host": "shop.example.com",
            "service": "slack",
            "hint": "x9Qz",
            "events": ["new", "comment"],
            "created_at": "2026-10-01T09:30:00.000Z",
            "updated_at": "2026-10-01T09:30:00.000Z",
            "last_status": "200",
            "last_at": "2026-10-02T11:15:00.000Z",
        }, {
            "host": "shop.example.com",
            "service": "discord",
            "hint": "Aa12",
            "events": ["new", "comment", "status", "shipped"],
        }]})),
        ("PUT", ["hooks", host]) => {
            let url = body["url"].as_str().unwrap_or("");
            let service = body["service"].as_str().map_or_else(
                || {
                    if url.contains("discord") {
                        "discord"
                    } else {
                        "slack"
                    }
                },
                |s| if s == "discord" { "discord" } else { "slack" },
            );
            let events = if body["events"].is_array() {
                body["events"].clone()
            } else {
                json!(["new", "comment", "status", "shipped"])
            };
            let hint: String = url
                .chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            Reply::ok(json!({
                "host": host,
                "service": service,
                "hint": hint,
                "events": events,
            }))
        }
        ("DELETE", ["hooks", _]) => Reply::ok(json!({"removed": 1})),
        ("POST", ["hooks", _, "test"]) => Reply::ok(json!({"results": [
            {"service": "slack", "hint": "x9Qz", "ok": true, "status": "200"},
        ]})),
        ("GET", ["github"]) => Reply::ok(json!({"hosts": [{
            "host": "shop.example.com",
            "repo": "acme/shop",
            "hook_id": 77,
            "token": true,
            "secret": true,
        }]})),
        ("PUT", ["github", host]) => Reply::ok(json!({
            "host": host,
            "repo": body["repo"],
            "hook_id": body["hook_id"],
        })),
        ("DELETE", ["github", host]) => Reply::ok(json!({
            "host": host,
            "repo": "acme/shop",
            "hook_removed": true,
        })),
        ("POST", ["issues", n, "github"]) => Reply::ok(json!({
            "key": format!("BUG-{n}"),
            "url": format!("https://github.com/acme/shop/issues/{n}"),
            "existing": false,
        })),
        _ => Reply::problem(404, "no such route"),
    }
}

pub fn cloudflare(req: &Req) -> Reply {
    let s = segments(req, "/cf/");
    match (req.method.as_str(), s.as_slice()) {
        ("GET", ["user", "tokens", "verify"]) => Reply::cf(json!({"status": "active"})),
        ("GET", ["accounts"]) => Reply::ok(json!({
            "success": true,
            "result": [{"id": "acc1", "name": "Example"}],
            "result_info": {"total_pages": 1},
        })),
        ("GET", ["zones"]) => Reply::ok(json!({
            "success": true,
            "result": [{"id": "z1", "name": "example.com"}],
            "result_info": {"total_pages": 1},
        })),
        ("GET", ["zones", _, "workers", "routes"]) => Reply::cf(json!([])),
        ("POST", ["zones", _, "workers", "routes"]) => Reply::cf(json!({"id": "r1"})),
        ("GET", ["accounts", _, "workers", "domains"]) => Reply::cf(json!([])),
        ("GET", ["accounts", _, "pages", "projects"]) => Reply::cf(json!([])),
        ("GET", ["accounts", _, "workers", "scripts"]) => Reply::cf(json!([])),
        ("GET", ["accounts", _, "workers", "scripts", _, "settings"]) => {
            Reply::cf(json!({"bindings": []}))
        }
        ("GET", ["accounts", _, "workers", "scripts", _, "secrets"]) => {
            Reply::cf(json!([{"name": "KEY_P99", "type": "secret_text"}]))
        }
        ("PUT", ["accounts", _, "workers", "scripts", _, "secrets"]) => Reply::cf(json!({})),
        ("DELETE", ["accounts", _, "workers", "scripts", _, "secrets", _]) => Reply::cf(json!({})),
        ("PUT", ["accounts", _, "workers", "scripts", _]) => Reply::cf(json!({})),
        ("PUT", ["accounts", _, "workers", "scripts", _, "schedules"]) => Reply::cf(json!({})),
        ("GET", ["accounts", _, "workers", "subdomain"]) => {
            Reply::cf(json!({"subdomain": "example"}))
        }
        ("POST", ["accounts", _, "workers", "scripts", _, "subdomain"]) => Reply::cf(json!({})),
        ("GET", ["accounts", _, "d1", "database"]) => Reply::ok(json!({
            "success": true,
            "result": [],
            "result_info": {"total_pages": 1},
        })),
        ("POST", ["accounts", _, "d1", "database"]) => Reply::cf(json!({
            "uuid": "db1",
            "name": req.json()["name"],
        })),
        ("POST", ["accounts", _, "d1", "database", _, "query"]) => {
            Reply::cf(json!([{"results": [], "success": true}]))
        }
        ("GET", ["accounts", _, "r2", "buckets"]) => Reply::cf(json!({"buckets": []})),
        ("POST", ["accounts", _, "r2", "buckets"]) => Reply::cf(json!({})),
        _ => Reply::cf_error(404, 7003, "Could not route to the path"),
    }
}

pub fn github(req: &Req) -> Reply {
    let s = segments(req, "/gh/");
    match (req.method.as_str(), s.as_slice()) {
        ("GET", ["repos", owner, name]) => Reply::ok(json!({
            "full_name": format!("{owner}/{name}"),
            "has_issues": true,
        })),
        ("GET", ["repos", _, _, "hooks"]) => Reply::ok(json!([])),
        ("POST", ["repos", _, _, "hooks"]) => Reply::json(201, json!({"id": 77})),
        ("PATCH", ["repos", _, _, "hooks", id]) => Reply::ok(json!({"id": number(id)})),
        _ => Reply::json(404, json!({"message": "Not Found"})),
    }
}

pub fn resend(req: &Req) -> Reply {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/resend/domains") => Reply::ok(json!({"data": [
            {"name": "example.com", "status": "verified"},
            {"name": "example.org", "status": "pending"},
        ]})),
        _ => Reply::json(404, json!({"message": "Not Found"})),
    }
}

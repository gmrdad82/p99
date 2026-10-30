#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::process::Command;

use serde_json::{Value, json};

use home::Home;
use stub::{KEY, Reply, Req, Stub, code, minted};

fn home(name: &str) -> Home {
    Home::new(name, fake::any)
}

fn host_row(host: &str, project: &str, env: &str, masks: &str, state: &str) -> String {
    format!(
        "{host:<16}  {:<5}  {project:<7}  {env:<10}  {masks}  {state}",
        "main"
    )
}

fn host_head() -> String {
    format!(
        "{:<16}  {:<5}  {:<7}  {:<10}  MASKS  CAPTURE  STATE",
        "HOST", "SPACE", "PROJECT", "ENV"
    )
}

fn shown(host: &str, project: &str, env: &str, state: &str) -> String {
    host_row(host, project, env, "    0  on     ", state)
}

#[test]
fn hosts_lists_the_config_beside_the_worker_and_names_each_state() {
    let h = home("hosts-list");
    let out = h.p99(&["hosts"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            host_head(),
            shown(
                "blog.example.com",
                "Blog",
                "production",
                "only on the Worker"
            ),
            shown("dev.example.com", "Blog", "dev", "not on the Worker"),
            shown("shop.example.com", "Shop", "production", "ok"),
        ]
    );
    assert!(h.stub.call("GET", "/_p99/v1/hosts").signed);
    let answer = h.p99(&["hosts", "--json"]).json();
    assert_eq!(answer["unreachable"], json!({}));
    let hosts = answer["hosts"].as_array().unwrap();
    assert_eq!(hosts.len(), 3);
    assert_eq!(hosts[1]["host"], "dev.example.com");
    assert_eq!(hosts[1]["in_config"], true);
    assert_eq!(hosts[1]["space"], "main");
    assert_eq!(hosts[1]["project"], "Blog");
    assert_eq!(hosts[1]["masks"], 0);
    assert_eq!(hosts[1]["capture"], "on");
    assert_eq!(hosts[1]["worker"], Value::Null);
    assert_eq!(hosts[1]["config"], json!({"theme": {}, "strings": {}}));
    assert_eq!(hosts[0]["in_config"], false);
    assert_eq!(hosts[2]["state"], "ok");
    assert_eq!(hosts[2]["worker"]["env"], "production");
}

#[test]
fn hosts_says_a_host_differs_and_names_a_space_it_cannot_reach() {
    let h = Home::new("hosts-differs", |req: &Req| {
        if req.is("GET", "/_p99/v1/hosts") {
            Reply::ok(json!({"hosts": [stub::host_entry("shop.example.com", "staging")]}))
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["hosts"]);
    out.ok();
    assert!(out.lines()[2].ends_with("differs"), "{}", out.stdout);
    let down = Home::new("hosts-down", |req: &Req| {
        if req.is("GET", "/_p99/v1/hosts") {
            Reply::raw(500, "text/plain", b"boom")
        } else {
            fake::any(req)
        }
    });
    let out = down.p99(&["hosts"]);
    out.ok();
    assert_eq!(
        out.lines()[1..],
        [
            shown("dev.example.com", "Blog", "dev", "unreachable"),
            shown("shop.example.com", "Shop", "production", "unreachable"),
        ]
    );
    assert_eq!(out.stderr, "main: the Worker answered 500\n");
    let answer = down.p99(&["hosts", "--json"]).json();
    assert_eq!(answer["unreachable"]["main"], "the Worker answered 500");
}

#[test]
fn hosts_with_no_host_anywhere_says_how_to_add_one() {
    let stub = Stub::new(fake::any);
    let text = format!(
        "[spaces.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\n\n[spaces.other]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n",
        stub.base
    );
    let h = Home::with_config("hosts-none", stub, &text);
    let out = h.p99(&["hosts", "--space", "main"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "no hosts yet; p99 hosts add <host> --project <name> --env <env>\n"
    );
    assert!(h.stub.seen().is_empty());
}

#[test]
fn hosts_add_saves_the_host_routes_it_pushes_it_and_adds_its_new_environment() {
    let h = home("hosts-add");
    let out = h.p99(&[
        "hosts",
        "add",
        " New.Example.com ",
        "--project",
        "shop",
        "--env",
        "staging",
        "--kind",
        "development",
    ]);
    out.ok();
    assert_eq!(
        out.stdout,
        "added new.example.com to main, project Shop, environment staging\n"
    );
    assert_eq!(
        out.stderr,
        "new.example.com is on the zone example.com\nadded the route new.example.com/_p99/* → p99\n"
    );
    let route = h.stub.call("POST", "/cf/zones/z1/workers/routes");
    assert_eq!(route.header("authorization"), Some("Bearer cf-token"));
    assert_eq!(
        route.json(),
        json!({"pattern": "new.example.com/_p99/*", "script": "p99"})
    );
    let pushed = h.stub.call("PUT", "/_p99/v1/hosts/new.example.com");
    assert!(pushed.signed);
    assert_eq!(
        pushed.json(),
        json!({"env": "staging", "config": {"theme": {}, "strings": {}}, "project": "Shop"})
    );
    assert_eq!(
        h.stub.call("PUT", "/_p99/v1/envs/staging").json(),
        json!({"kind": "development", "position": 2, "notify": false})
    );
    let config = h.toml();
    assert_eq!(
        config["hosts"]["new.example.com"]["space"].as_str(),
        Some("main")
    );
    assert!(config["hosts"]["new.example.com"].get("account").is_none());
    assert_eq!(
        config["spaces"]["main"]["projects"]["Shop"],
        toml::Value::try_from(vec!["new.example.com", "shop.example.com"]).unwrap()
    );
    assert!(config.get("accounts").is_none());
    assert_eq!(
        config["hosts"]["new.example.com"]["env"].as_str(),
        Some("staging")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(h.file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn hosts_add_on_a_known_environment_keeps_it_unless_a_kind_is_given() {
    let h = home("hosts-add-env");
    let out = h.p99(&[
        "hosts",
        "add",
        "two.example.com",
        "--project",
        "Blog",
        "--env",
        "dev",
        "--json",
    ]);
    out.ok();
    assert_eq!(out.json()["host"], "two.example.com");
    assert_eq!(out.json()["env"], "dev");
    assert_eq!(out.json()["space"], "main");
    assert_eq!(out.json()["project"], "Blog");
    assert!(h.stub.under("PUT", "/_p99/v1/envs/").is_empty());
    h.p99_env(
        &[
            "hosts",
            "add",
            "three.example.com",
            "--project",
            "Blog",
            "--env",
            "dev",
            "--kind",
            "release",
        ],
        &[("P99_TOKEN", "  env-token\n")],
    )
    .ok();
    assert_eq!(
        h.stub.call("PUT", "/_p99/v1/envs/dev").json(),
        json!({"kind": "release", "position": 1, "notify": true})
    );
    let routes = h.stub.calls("POST", "/cf/zones/z1/workers/routes");
    assert_eq!(routes[1].header("authorization"), Some("Bearer env-token"));
}

#[test]
fn hosts_add_names_what_already_serves_the_host() {
    let h = Home::new("hosts-add-notes", |req: &Req| match req.path.as_str() {
        "/cf/zones/z1/workers/routes" if req.method == "GET" => Reply::cf(json!([
            {"pattern": "*.example.com/*", "script": "site"},
            {"pattern": "other.example.org/*", "script": "x"},
            {"pattern": "new.example.com/_p99/*", "script": "p99"},
        ])),
        "/cf/accounts/acc1/workers/domains" => {
            Reply::cf(json!([{"hostname": "new.example.com", "service": "site"}]))
        }
        "/cf/accounts/acc1/pages/projects" => Reply::cf_error(403, 10000, "Authentication error"),
        _ => fake::any(req),
    });
    h.p99(&["hosts", "add", "new.example.com", "--project", "Shop"])
        .ok();
    let out = h.p99(&["hosts", "add", "new.example.com", "--project", "Shop"]);
    assert_eq!(
        out.stderr.lines().collect::<Vec<_>>(),
        [
            "new.example.com is on the zone example.com",
            "the Worker site serves new.example.com as a Custom Domain; it stays, and the route runs in front of it for /_p99/*",
            "couldn't check Pages projects (the token has no Pages read; nothing needs it)",
            "the route *.example.com/* runs site; P99's more specific route takes /_p99/* only",
            "the route new.example.com/_p99/* is there",
        ]
    );
    assert!(
        h.stub
            .calls("POST", "/cf/zones/z1/workers/routes")
            .is_empty()
    );
    let pages = Home::new("hosts-add-pages", |req: &Req| match req.path.as_str() {
        "/cf/accounts/acc1/workers/domains" => Reply::raw(500, "text/plain", b"x"),
        "/cf/accounts/acc1/pages/projects" => {
            Reply::cf(json!([{"name": "shop-site", "domains": ["new.example.com"]}]))
        }
        _ => fake::any(req),
    });
    let out = pages.p99(&["hosts", "add", "new.example.com", "--project", "Shop"]);
    out.ok();
    let notes: Vec<&str> = out.stderr.lines().collect();
    assert_eq!(
        notes[1],
        "couldn't check Custom Domains: Cloudflare /accounts/acc1/workers/domains: HTTP 500"
    );
    assert_eq!(
        notes[2],
        "the Pages project shop-site serves new.example.com; it stays, and the route runs in front of it for /_p99/*"
    );
}

#[test]
fn hosts_add_refuses_a_bad_name_a_foreign_zone_and_a_route_another_worker_holds() {
    let h = Home::new("hosts-add-bad", |req: &Req| {
        if req.is("GET", "/cf/zones/z1/workers/routes") {
            Reply::cf(json!([{"pattern": "held.example.com/_p99/*", "script": "other"}]))
        } else {
            fake::any(req)
        }
    });
    h.p99(&["hosts", "add", "not a host", "--project", "Shop"])
        .refused("not a host is not a host name; try example.com");
    h.p99(&["hosts", "add", "localhost", "--project", "Shop"])
        .refused("localhost is not a host name; try example.com");
    assert!(h.stub.seen().is_empty());
    h.p99(&["hosts", "add", "new.example.org", "--project", "Shop"]).refused(
        "new.example.org is on no zone this token reaches; add the zone to Cloudflare or to the token's Zone › Zone: Read",
    );
    h.p99(&["hosts", "add", "held.example.com", "--project", "Shop"]).refused(
        "the route held.example.com/_p99/* already runs the Worker other; P99 leaves it alone (remove it in the dashboard to give it to p99)",
    );
    assert!(h.stub.under("PUT", "/_p99/").is_empty());
    h.p99(&[
        "hosts",
        "add",
        "x.example.com",
        "--project",
        "Shop",
        "--kind",
        "beta",
    ])
    .clap("invalid value 'beta' for '--kind <KIND>'");
    h.p99(&["hosts", "add"])
        .clap("the following required arguments were not provided:");
    h.p99(&["hosts", "add", "x.example.com"])
        .clap("the following required arguments were not provided:");
}

#[test]
fn hosts_add_into_a_project_the_space_lacks_says_how_to_make_it_and_changes_nothing() {
    let h = home("hosts-add-no-project");
    let before = h.config();
    h.p99(&["hosts", "add", "new.example.com", "--project", "Docs"])
        .refused("no project is called Docs in the space main; p99 projects add \"Docs\" makes it");
    assert_eq!(h.config(), before);
    assert!(h.stub.writes().is_empty());
}

#[test]
fn hosts_add_that_the_worker_refuses_leaves_the_config_as_it_was() {
    let h = Home::new("hosts-add-put-refused", |req: &Req| {
        if req.is("PUT", "/_p99/v1/hosts/new.example.com") {
            Reply::problem(400, "config is not valid")
        } else {
            fake::any(req)
        }
    });
    let before = h.config();
    h.p99(&["hosts", "add", "new.example.com", "--project", "Shop"])
        .refused("config is not valid (400)");
    assert_eq!(h.config(), before);
    assert!(h.stub.under("PUT", "/_p99/v1/envs/").is_empty());
}

#[test]
fn hosts_add_when_the_space_cannot_be_read_stops_before_any_change() {
    let h = Home::new("hosts-add-space-down", |req: &Req| {
        if req.is("GET", "/_p99/v1/space") {
            Reply::problem(500, "the space is not answering")
        } else {
            fake::any(req)
        }
    });
    let before = h.config();
    h.p99(&["hosts", "add", "new.example.com", "--project", "Shop"])
        .refused("the space is not answering");
    assert_eq!(h.config(), before);
    assert!(h.stub.writes().is_empty());
    assert!(h.stub.under("POST", "/cf/").is_empty());
}

#[test]
fn hosts_set_on_a_host_the_worker_lacks_gets_the_workers_project_refusal() {
    let h = home("hosts-set-new-host");
    h.write(&format!(
        "{}\n[hosts.\"new.example.com\"]\nspace = \"main\"\n",
        h.config()
    ));
    h.p99(&["hosts", "set", "new.example.com", "--corner", "top-left"])
        .refused(
            "a new host needs a project: p99 hosts add new.example.com --project <name> (400)",
        );
    let put = h.stub.call("PUT", "/_p99/v1/hosts/new.example.com").json();
    assert!(put.get("project").is_none());
    let moved = h.p99(&["hosts", "set", "new.example.com", "--project", "Nowhere"]);
    moved.refused(
        "no project is called Nowhere in the space main; p99 projects add \"Nowhere\" makes it",
    );
}

#[test]
fn hosts_add_with_a_token_cloudflare_refuses_stops_before_the_worker() {
    let h = Home::new("hosts-add-denied", |req: &Req| {
        if req.path.starts_with("/cf/") {
            Reply::cf_error(403, 9109, "Invalid access token")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["hosts", "add", "new.example.com", "--project", "Shop"])
        .refused("Cloudflare /zones: Invalid access token (9109)");
    assert!(h.stub.under("PUT", "/_p99/").is_empty());
}

#[test]
fn hosts_remove_drops_the_host_from_the_worker_then_the_config() {
    let h = home("hosts-remove");
    h.p99(&["hosts", "remove", "gone.example.com"])
        .refused("no host is called gone.example.com; p99 hosts lists them");
    let out = h.p99(&["hosts", "remove", "Shop.Example.com"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "removed shop.example.com from main; its cards stay, and so does its route in Cloudflare\n"
    );
    assert!(
        h.stub
            .call("DELETE", "/_p99/v1/hosts/shop.example.com")
            .signed
    );
    assert!(h.toml()["hosts"].get("shop.example.com").is_none());
    let out = h.p99(&["hosts", "remove", "dev.example.com", "--json"]);
    assert_eq!(
        out.json(),
        json!({"removed": "dev.example.com", "space": "main"})
    );
    assert_eq!(
        h.toml()["spaces"]["main"]["projects"]["Blog"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn hosts_remove_that_the_worker_refuses_keeps_the_config() {
    let h = Home::new("hosts-remove-403", |req: &Req| {
        if req.under("DELETE", "/_p99/v1/hosts/") {
            Reply::problem(403, "only a manager removes a host")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["hosts", "remove", "shop.example.com"])
        .refused("only a manager removes a host (403)");
    assert!(h.toml()["hosts"].get("shop.example.com").is_some());
}

#[test]
fn hosts_set_saves_and_pushes_the_button_its_theme_and_its_words() {
    let h = home("hosts-set");
    let out = h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--corner",
        "top-left",
        "--offset",
        " 16 , -8 ",
        "--above",
        "#cookie",
        "--off",
        "/admin/*",
        "--off",
        "",
        "--off",
        "/checkout",
        "--theme",
        "accent=#0a0",
        "--theme=--p99-radius = 8px",
        "--string",
        "title=Report a problem",
        "--pitomd-link",
        "on",
    ]);
    out.ok();
    assert_eq!(out.stdout, "shop.example.com updated and pushed\n");
    let pushed = h.stub.call("PUT", "/_p99/v1/hosts/shop.example.com").json();
    assert_eq!(
        pushed,
        json!({"env": "production", "config": {
            "theme": {"accent": "#0a0", "radius": "8px"},
            "strings": {"title": "Report a problem"},
            "corner": "top-left",
            "offset": {"x": 16, "y": -8},
            "above": "#cookie",
            "off": ["/admin/*", "/checkout"],
        }})
    );
    let saved = h.toml();
    let shop = &saved["hosts"]["shop.example.com"];
    assert_eq!(shop["corner"].as_str(), Some("top-left"));
    assert_eq!(shop["theme"]["radius"].as_str(), Some("8px"));
    let out = h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--theme",
        "accent=",
        "--above",
        "",
        "--json",
    ]);
    out.ok();
    assert_eq!(out.json()["config"]["theme"], json!({"radius": "8px"}));
    assert!(out.json()["config"].get("above").is_none());
}

#[test]
fn hosts_set_refuses_bad_values_before_saving_or_pushing() {
    let h = home("hosts-set-bad");
    let before = h.config();
    h.p99(&["hosts", "set", "shop.example.com", "--offset", "16"])
        .refused("16 is not X,Y in pixels; try 16,16");
    h.p99(&["hosts", "set", "shop.example.com", "--offset", "a,b"])
        .refused("a,b is not X,Y in pixels; try 16,16");
    h.p99(&["hosts", "set", "shop.example.com", "--theme", "accent"])
        .refused("accent is not key=value");
    h.p99(&["hosts", "set", "shop.example.com", "--string", " =x"])
        .refused(" =x has no key");
    h.p99(&["hosts", "set", "shop.example.com", "--pitomd-link", "off"])
        .refused("Only an Agency key hides the 'by PITO.MD' link");
    h.p99(&["hosts", "set", "gone.example.com", "--corner", "top-left"])
        .refused("no host is called gone.example.com; p99 hosts lists them");
    h.p99(&["hosts", "set", "shop.example.com", "--corner", "middle"])
        .clap("invalid value 'middle' for '--corner <CORNER>'");
    assert_eq!(h.config(), before);
    assert!(h.stub.seen().is_empty());
}

#[test]
fn feed_lists_turns_on_and_off_and_pushes_each_change() {
    let h = home("feed");
    let out = h.p99(&["feed"]);
    out.ok();
    assert_eq!(
        out.lines(),
        ["dev.example.com   off", "shop.example.com  off"]
    );
    let out = h.p99(&["feed", "on", "Shop.Example.com"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "shop.example.com's feed is on: https://shop.example.com/_p99/feed (JSON Feed: add ?format=json)\n"
    );
    let pushed = h.stub.call("PUT", "/_p99/v1/hosts/shop.example.com").json();
    assert_eq!(pushed["config"]["feed"], true);
    assert_eq!(
        h.toml()["hosts"]["shop.example.com"]["feed"].as_bool(),
        Some(true)
    );
    let out = h.p99(&["feed"]);
    assert_eq!(
        out.lines()[1],
        "shop.example.com  on   https://shop.example.com/_p99/feed"
    );
    let answer = h.p99(&["feed", "--json"]).json();
    assert_eq!(
        answer["feeds"][1],
        json!({"host": "shop.example.com", "on": true, "url": "https://shop.example.com/_p99/feed"})
    );
    let out = h.p99(&["feed", "off", "shop.example.com", "--json"]);
    assert_eq!(
        out.json(),
        json!({"host": "shop.example.com", "on": false, "url": "https://shop.example.com/_p99/feed"})
    );
    let out = h.p99(&["feed", "off", "shop.example.com"]);
    assert_eq!(out.stdout, "shop.example.com's feed is off\n");
    assert!(h.toml()["hosts"]["shop.example.com"].get("feed").is_none());
    h.p99(&["feed", "on", "gone.example.com"])
        .refused("no host is called gone.example.com; p99 hosts lists them");
    let other = h.p99(&["feed", "--space", "other"]);
    assert_eq!(
        other.stdout,
        "no hosts yet; p99 hosts add <host> --project <name> --env <env>\n"
    );
    let bare = h.p99(&["feed", "--space"]);
    bare.ok();
    assert_eq!(
        bare.lines(),
        ["dev.example.com   off", "shop.example.com  off"]
    );
}

#[test]
fn invite_mails_a_new_code_and_shows_only_what_the_owner_may_see() {
    let h = home("invite");
    let out = h.p99(&[
        "invite",
        "--project",
        "Shop",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--owner",
        "--totp",
    ]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "Grace Hopper <grace@example.com> (Owner)",
            "mailed the link to grace@example.com (projects: Shop)",
            "mailed the authenticator setup to grace@example.com in a second mail",
        ]
    );
    assert!(!out.stdout.contains("abcd-efgh-jkmn"));
    assert!(!out.stdout.contains("JBSWY3DPEHPK3PXP"));
    assert!(!out.stdout.contains("otpauth"));
    let sent = h.stub.call("POST", "/_p99/v1/codes");
    assert!(sent.signed);
    let body = sent.json();
    assert_eq!(body["grant"], json!({"projects": ["Shop"]}));
    assert!(body.get("hosts").is_none());
    assert_eq!(body["role"], "owner");
    assert!(body.get("manager").is_none());
    assert_eq!(body["totp"], true);
    assert_eq!(body["mail"], true);
    assert_eq!(body["name"], "Grace Hopper");
}

#[test]
fn invite_a_legacy_host_list_grants_the_projects_of_its_hosts_and_says_so() {
    let h = home("invite-nomail");
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "dev.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
    ]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "Grace Hopper <grace@example.com>",
            "secret: abcd-efgh-jkmn",
            "link:   https://shop.example.com/#p99=abcdefghjkmn",
            "link:   https://blog.example.com/#p99=abcdefghjkmn",
            "link:   https://dev.example.com/#p99=abcdefghjkmn",
            "this is the only time the secret is shown",
        ]
    );
    assert!(
        out.stderr.contains(
            "a code grants projects now; shop.example.com, dev.example.com became Shop, Blog"
        ),
        "{}",
        out.stderr
    );
    let body = h.stub.call("POST", "/_p99/v1/codes").json();
    assert_eq!(body["mail"], false);
    assert!(body.get("totp").is_none());
    assert_eq!(body["grant"], json!({"projects": ["Shop", "Blog"]}));
}

#[test]
fn invite_space_alone_grants_the_whole_space_and_project_grants_some() {
    let h = home("invite-grants");
    let out = h.p99(&[
        "invite",
        "--space",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
    ]);
    out.ok();
    assert_eq!(
        out.lines()[3],
        "link:   https://blog.example.com/#p99=abcdefghjkmn"
    );
    let named = h.p99(&[
        "invite",
        "--space",
        "main",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
    ]);
    named.ok();
    let sent = h.stub.calls("POST", "/_p99/v1/codes");
    assert_eq!(sent[0].json()["grant"], json!({"space": true}));
    assert_eq!(sent[1].json()["grant"], json!({"space": true}));
    h.p99(&[
        "invite",
        "--project",
        "Shop",
        "--project",
        "Blog",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
        "--json",
    ])
    .ok();
    let sent = h.stub.calls("POST", "/_p99/v1/codes");
    assert_eq!(
        sent[2].json()["grant"],
        json!({"projects": ["Shop", "Blog"]})
    );
    let json = h
        .p99(&[
            "invite",
            "--project",
            "Shop",
            "--name",
            "G",
            "--email",
            "g@example.com",
            "--no-mail",
            "--json",
        ])
        .json();
    assert_eq!(json["space"], json!({"slug": "main", "name": "PITO MD"}));
    assert_eq!(json["code"]["grant"], json!({"projects": ["Shop"]}));
}

#[test]
fn invite_refuses_a_host_list_with_projects_and_a_grant_that_is_missing() {
    let h = home("invite-grant-bad");
    h.p99(&[
        "invite",
        "shop.example.com",
        "--project",
        "Shop",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("a host list is the old way and cannot go with --project or a bare --space; name projects, or --space alone");
    h.p99(&["invite", "--name", "G", "--email", "g@example.com"])
        .refused("say what the code grants: --space for the whole space, or --project <name> (repeat it)");
    h.p99(&[
        "invite",
        "gone.example.com",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("gone.example.com is in no project; p99 hosts set gone.example.com --project <name>");
    assert!(h.stub.writes().is_empty());
}

#[test]
fn inviting_yourself_prints_your_own_link_and_mails_it_only_when_asked() {
    let h = home("invite-self");
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Ada Lovelace",
        "--email",
        " ADA@example.com ",
    ]);
    out.ok();
    assert_eq!(
        h.stub.calls("POST", "/_p99/v1/codes")[0].json()["mail"],
        false
    );
    assert_eq!(
        out.lines()[3],
        "this is your own link: P99 keeps it nowhere, so save it in your password manager if you want it there"
    );
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Ada Lovelace",
        "--email",
        "ada@example.com",
        "--mail-me",
    ]);
    out.ok();
    assert_eq!(
        h.stub.calls("POST", "/_p99/v1/codes")[1].json()["mail"],
        true
    );
    assert!(
        out.stdout
            .contains("mailed the link to ada@example.com (projects: Shop)")
    );
    assert!(out.stdout.contains("secret: abcd-efgh-jkmn"));
    h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "A",
        "--email",
        "a@example.com",
        "--mail-me",
        "--no-mail",
    ])
    .clap("the argument '");
}

fn mail_said(said: &'static str) -> Home {
    Home::new(&format!("invite-mail-{said}"), move |req: &Req| {
        if req.is("POST", "/_p99/v1/codes") {
            Reply::json(
                201,
                minted(
                    9,
                    "Grace Hopper",
                    "grace@example.com",
                    &["shop.example.com"],
                    Some(said),
                ),
            )
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn invite_says_why_a_mail_did_not_go_out() {
    for (said, note) in [
        (
            "off",
            "mail is off for this space, so nothing was mailed; send the link yourself (p99 email set turns mail on)",
        ),
        (
            "skipped",
            "this e-mail takes no mail; send the link yourself",
        ),
        ("failed", "the mail didn't go out; send the link yourself"),
    ] {
        let h = mail_said(said);
        let out = h.p99(&[
            "invite",
            "shop.example.com",
            "--name",
            "Grace Hopper",
            "--email",
            "grace@example.com",
        ]);
        out.ok();
        let lines = out.lines();
        assert_eq!(lines[1], "secret: abcd-efgh-jkmn", "{said}");
        assert_eq!(lines[lines.len() - 2], note, "{said}");
        assert_eq!(
            lines[lines.len() - 1],
            "this is the only time the secret is shown"
        );
    }
}

#[test]
fn invite_json_and_its_refusals() {
    let h = home("invite-json");
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--json",
    ]);
    out.ok();
    let answer = out.json();
    assert_eq!(answer["code"]["id"], 9);
    assert_eq!(answer["secret"], "abcd-efgh-jkmn");
    assert_eq!(answer["mail"], "sent");
    h.p99(&["invite", "shop.example.com", "--email", "g@example.com"])
        .clap("the following required arguments were not provided:");
    let replayed = Home::new("invite-replayed", |req: &Req| {
        if req.is("POST", "/_p99/v1/codes") {
            let mut made = minted(9, "G", "g@example.com", &["shop.example.com"], None);
            made.as_object_mut().unwrap().remove("secret");
            Reply::ok(made)
        } else {
            fake::any(req)
        }
    });
    replayed
        .p99(&[
            "invite",
            "shop.example.com",
            "--name",
            "G",
            "--email",
            "g@example.com",
        ])
        .refused("this invite was already minted; revoke it and invite again");
}

#[test]
fn a_code_covers_one_space() {
    let stub = Stub::new(fake::any);
    let text = format!(
        "{}\n[spaces.work]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n\n[hosts.\"work.example.org\"]\nspace = \"work\"\n",
        home::config(&stub.base),
        stub.base
    );
    let h = Home::with_config("invite-accounts", stub, &text);
    h.p99(&[
        "invite",
        "shop.example.com",
        "work.example.org",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("work.example.org is in the space work, not main; a code covers one space");
    assert!(h.stub.seen().is_empty());
}

fn code_row(id: i64, state: &str, who: &str, role: &str, grant: &str, last: &str) -> String {
    format!(
        "{id:>4}  {state}  {who}  {role}  ...k3x9  2026-10-01 09:30  grant: {grant}  last used: {last}"
    )
}

#[test]
fn invites_lists_each_code_with_its_role_state_and_last_use() {
    let h = Home::new("invites", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            let mut manager = code(6, "Linus", "linus@example.com", &["dev.example.com"]);
            manager["manager"] = json!(true);
            manager["totp"] = json!(true);
            manager["revoked_at"] = json!("2026-10-03T00:00:00Z");
            manager["last_used_at"] = json!("2026-10-02T18:45:10Z");
            Reply::ok(json!({"codes": [
                code(4, "Grace Hopper", "grace@example.com", &["shop.example.com"]),
                manager,
            ]}))
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["invites", "--host", "dev.example.com"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            code_row(
                4,
                "active",
                "Grace Hopper <grace@example.com>",
                "User",
                "projects: Shop",
                "never"
            ),
            code_row(
                6,
                "revoked",
                "Linus <linus@example.com>",
                "Owner, totp",
                "projects: Blog",
                "2026-10-02 18:45"
            ),
        ]
    );
    assert_eq!(
        h.stub.call("GET", "/_p99/v1/codes").param("host"),
        Some("dev.example.com")
    );
    let answer = h.p99(&["invites", "--json"]).json();
    assert_eq!(answer["codes"][1]["id"], 6);
    let empty = Home::new("invites-empty", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            Reply::ok(json!({}))
        } else {
            fake::any(req)
        }
    });
    assert_eq!(empty.p99(&["invites"]).stdout, "no codes\n");
}

fn two_codes(name: &str) -> Home {
    Home::new(name, |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            let mut owner = code(6, "Ada Lovelace", "ada@example.com", &["example.com"]);
            owner["manager"] = json!(true);
            owner["role"] = json!("owner");
            let mut revoked = code(
                4,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            revoked["role"] = json!("user");
            revoked["revoked_at"] = json!("2026-10-03T00:00:00Z");
            Reply::ok(json!({"codes": [owner, revoked]}))
        } else if req.is("DELETE", "/_p99/v1/codes/4") {
            Reply::ok(json!({"id": 4, "deleted": true}))
        } else if req.is("DELETE", "/_p99/v1/codes/6") {
            Reply::problem(409, "revoke it first")
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn invites_and_its_codes_alias_print_every_role_as_owner_or_user() {
    let h = two_codes("invites-roles");
    for command in ["invites", "codes"] {
        let out = h.p99(&[command]);
        out.ok();
        let roles: Vec<&str> = out
            .lines()
            .iter()
            .map(|l| {
                if l.contains("  Owner  ") {
                    "Owner"
                } else if l.contains("  User  ") {
                    "User"
                } else {
                    l
                }
            })
            .collect();
        assert_eq!(roles, ["Owner", "User"], "{}", out.stdout);
        for old in ["manager", "member", "person", "reporter"] {
            assert!(!out.stdout.contains(old), "{old}: {}", out.stdout);
        }
    }
    let answer = h.p99(&["codes", "--json"]).json();
    let pairs: Vec<(Value, Value)> = answer["codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["manager"].clone(), c["role"].clone()))
        .collect();
    assert_eq!(
        pairs,
        [(json!(true), json!("owner")), (json!(false), json!("user"))]
    );
}

#[test]
fn a_role_filter_takes_owner_or_user_alone() {
    let h = two_codes("invites-role-filter");
    for (word, id) in [("owner", "6"), ("user", "4")] {
        let out = h.p99(&["invites", "--role", word]);
        out.ok();
        assert_eq!(out.lines().len(), 1, "{word}: {}", out.stdout);
        assert!(
            out.lines()[0].trim_start().starts_with(id),
            "{word}: {}",
            out.stdout
        );
        let answer = h.p99(&["codes", "--role", word, "--json"]).json();
        assert_eq!(answer["codes"].as_array().unwrap().len(), 1, "{word}");
        assert_eq!(answer["codes"][0]["id"].to_string(), id, "{word}");
    }
    let out = h.p99(&["invites", "--role", "guest"]);
    out.clap("invalid value 'guest' for '--role <ROLE>'");
    assert!(
        out.stderr.contains("[possible values: owner, user]"),
        "{}",
        out.stderr
    );
    h.p99(&["codes", "--role", "Admin"])
        .clap("invalid value 'Admin' for '--role <ROLE>'");
    for old in ["manager", "person", "reporter"] {
        h.p99(&["invites", "--role", old])
            .clap(&format!("invalid value '{old}' for '--role <ROLE>'"));
    }
}

#[test]
fn invite_owner_mints_an_owner_and_the_old_manager_flag_is_gone() {
    let h = home("invite-owner");
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--owner",
        "--no-mail",
    ]);
    out.ok();
    let sent = h.stub.call("POST", "/_p99/v1/codes").json();
    assert_eq!(sent["role"], "owner");
    let gone = home("invite-manager");
    gone.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--manager",
        "--no-mail",
    ])
    .clap("unexpected argument '--manager' found");
    assert!(gone.stub.seen().is_empty());
    let h = home("invite-user");
    h.p99(&[
        "invite",
        "shop.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
    ])
    .ok();
    assert_eq!(h.stub.call("POST", "/_p99/v1/codes").json()["role"], "user");
}

#[test]
fn invites_delete_removes_a_revoked_code_with_yes_and_names_it() {
    let h = two_codes("invites-delete");
    let out = h.p99(&["invites", "delete", "4", "--yes"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "deleted code 4 of Grace Hopper <grace@example.com>\n"
    );
    let call = h.stub.call("DELETE", "/_p99/v1/codes/4");
    assert!(call.signed);
    assert!(call.text().is_empty());
    let answer = h.p99(&["codes", "delete", "4", "--yes", "--json"]).json();
    assert_eq!(answer, json!({"id": 4, "deleted": true}));
}

#[test]
fn invites_delete_refuses_an_active_code_before_any_delete() {
    let h = two_codes("invites-delete-active");
    h.p99(&["invites", "delete", "6", "--yes"])
        .refused("code 6 is active: revoke it first, p99 revoke 6");
    h.p99(&["codes", "delete", "6", "--yes", "--json"])
        .refused("code 6 is active: revoke it first, p99 revoke 6");
    assert!(h.stub.calls("DELETE", "/_p99/v1/codes/6").is_empty());
}

#[test]
fn invites_delete_says_plainly_when_no_code_has_that_id() {
    let h = two_codes("invites-delete-missing");
    h.p99(&["invites", "delete", "9", "--yes"])
        .refused("no such code 9");
    assert!(h.stub.under("DELETE", "/_p99/v1/codes").is_empty());
}

#[test]
fn invites_delete_without_a_terminal_needs_yes_and_calls_nothing() {
    let h = two_codes("invites-delete-no-terminal");
    let out = h.p99_in(&["invites", "delete", "4"], "3fpd\n");
    out.refused(
        "deleting code 4 needs --yes when no one is at a terminal to type its last four characters back",
    );
    assert!(h.stub.seen().is_empty());
}

#[test]
fn invites_delete_passes_on_what_the_worker_refuses() {
    let h = Home::new("invites-delete-raced", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            let mut revoked = code(
                4,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            revoked["revoked_at"] = json!("2026-10-03T00:00:00Z");
            Reply::ok(json!({"codes": [revoked]}))
        } else if req.is("DELETE", "/_p99/v1/codes/4") {
            Reply::problem(404, "no such code")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["invites", "delete", "4", "--yes"])
        .refused("no such code (404)");
}

#[test]
fn invites_delete_takes_one_numeric_id() {
    let h = two_codes("invites-delete-clap");
    h.p99(&["invites", "delete"])
        .clap("the following required arguments were not provided:");
    h.p99(&["codes", "delete", "BUG-4", "--yes"])
        .clap("invalid value 'BUG-4' for '<ID>'");
    h.p99(&["invites", "delete", "4", "5", "--yes"])
        .clap("unexpected argument '5' found");
    assert!(h.stub.seen().is_empty());
}

fn revoked_code_four(name: &'static str) -> impl Fn(&Req) -> Reply + Send + Sync + 'static {
    move |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            let mut revoked = code(4, name, "grace@example.com", &["work.example.org"]);
            revoked["revoked_at"] = json!("2026-10-03T00:00:00Z");
            Reply::ok(json!({"codes": [revoked]}))
        } else if req.is("DELETE", "/_p99/v1/codes/4") {
            Reply::ok(json!({"id": 4, "deleted": true}))
        } else {
            fake::any(req)
        }
    }
}

fn two_spaces(name: &str) -> (Home, Stub) {
    let work = Stub::new(revoked_code_four("Grace Hopper"));
    let main = Stub::new(revoked_code_four("Ada Lovelace"));
    let text = format!(
        "{}\n[spaces.work]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n\n[hosts.\"work.example.org\"]\nspace = \"work\"\n",
        home::config(&main.base),
        work.base
    );
    (Home::with_config(name, main, &text), work)
}

#[test]
fn invites_delete_with_a_host_deletes_in_that_hosts_space_only() {
    let (h, work) = two_spaces("invites-delete-host");
    let out = h.p99(&[
        "invites",
        "--host",
        "work.example.org",
        "delete",
        "4",
        "--yes",
    ]);
    out.ok();
    assert_eq!(
        out.stdout,
        "deleted code 4 of Grace Hopper <grace@example.com>\n"
    );
    assert!(work.call("DELETE", "/_p99/v1/codes/4").signed);
    assert!(h.stub.seen().is_empty());
    h.p99(&["invites", "delete", "4", "--yes"]).ok();
    assert_eq!(h.stub.calls("DELETE", "/_p99/v1/codes/4").len(), 1);
    assert_eq!(work.calls("DELETE", "/_p99/v1/codes/4").len(), 1);
}

#[test]
fn invites_totp_with_a_host_adds_the_authenticator_in_that_hosts_space() {
    let (h, work) = two_spaces("invites-totp-host");
    h.p99(&["invites", "--host", "work.example.org", "totp", "4"])
        .ok();
    assert_eq!(work.calls("POST", "/_p99/v1/codes/4/totp").len(), 1);
    assert!(h.stub.seen().is_empty());
}

#[test]
fn invites_totp_mails_the_setup_or_shows_the_new_key_once() {
    let h = home("invites-totp");
    let out = h.p99(&["invites", "totp", "4"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "code 4 of Grace Hopper <grace@example.com> now asks for an authenticator code",
            "mailed the authenticator setup to grace@example.com",
        ]
    );
    assert_eq!(
        h.stub.calls("POST", "/_p99/v1/codes/4/totp")[0].query,
        [("mail".to_owned(), "1".to_owned())]
    );
    let mailed = h.p99(&["invites", "totp", "4", "--json"]).json();
    assert_eq!(mailed["mail"], "sent");
    assert!(mailed.get("totp_key").is_none());
    assert!(mailed.get("otpauth").is_none());
    let out = h.p99(&["invites", "totp", "4", "--no-mail"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "code 4 of Grace Hopper <grace@example.com> now asks for an authenticator code",
            "key:    JBSWY3DPEHPK3PXP   (paste it as a one-time password or setup key; totp is the same as a link)",
            "totp:   otpauth://totp/P99:grace@example.com?secret=JBSWY3DPEHPK3PXP&issuer=P99&algorithm=SHA1&digits=6&period=30",
            "send these apart from the link; each browser asks for its 6-digit code once",
            "this is the only time the key is shown",
        ]
    );
    assert!(
        h.stub.calls("POST", "/_p99/v1/codes/4/totp")[2]
            .query
            .is_empty()
    );
    let answer = h
        .p99(&["invites", "totp", "4", "--no-mail", "--json"])
        .json();
    assert_eq!(answer["totp_key"], "JBSWY3DPEHPK3PXP");
    assert_eq!(
        answer["otpauth"],
        "otpauth://totp/P99:grace@example.com?secret=JBSWY3DPEHPK3PXP&issuer=P99&algorithm=SHA1&digits=6&period=30"
    );
    h.p99(&["invites", "totp", "x"])
        .clap("invalid value 'x' for '<ID>'");
}

#[test]
fn revoke_names_the_code_and_a_missing_one_is_said_plainly() {
    let h = Home::new("revoke", |req: &Req| {
        if req.is("POST", "/_p99/v1/codes/99/revoke") {
            Reply::problem(404, "no such code")
        } else {
            fake::any(req)
        }
    });
    let out = h.p99(&["revoke", "4"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "revoked code 4 of Grace Hopper <grace@example.com>\n"
    );
    assert!(h.stub.call("POST", "/_p99/v1/codes/4/revoke").signed);
    let answer = h.p99(&["revoke", "4", "--json"]).json();
    assert_eq!(answer["revoked_at"], "2026-10-03T08:00:00.000Z");
    h.p99(&["revoke", "99"]).refused("no such code (404)");
}

#[test]
fn relink_by_id_or_email_mails_the_person_and_keeps_their_authenticator() {
    let h = home("relink");
    let expected = [
        "Grace Hopper <grace@example.com>",
        "code 14 replaces code 4, which no longer works",
        "mailed the link to grace@example.com (projects: Shop)",
        "the authenticator carries over: the same app keeps giving the 6-digit codes",
    ];
    let out = h.p99(&["relink", "4"]);
    out.ok();
    assert_eq!(out.lines(), expected);
    let body = h.stub.call("POST", "/_p99/v1/codes/4/relink").json();
    assert_eq!(body["mail"], true);
    assert!(body.get("new_totp").is_none());
    let out = h.p99(&["relink", "Grace@Example.com", "--host", "shop.example.com"]);
    out.ok();
    assert_eq!(out.lines(), expected);
    assert_eq!(h.stub.calls("POST", "/_p99/v1/codes/4/relink").len(), 2);
    h.p99(&["relink", "4", "--new-totp", "--no-mail"]).ok();
    let body = &h.stub.calls("POST", "/_p99/v1/codes/4/relink")[2].json();
    assert_eq!(body["new_totp"], true);
    assert!(body.get("mail").is_none());
    let answer = h.p99(&["relink", "4", "--json"]).json();
    assert_eq!(answer["revoked"]["id"], 4);
}

#[test]
fn relink_self_prints_your_own_new_link() {
    let h = home("relink-self");
    let out = h.p99(&["relink", "--self", "--host", "dev.example.com"]);
    out.ok();
    assert!(
        h.stub
            .call("POST", "/_p99/v1/codes/5/relink")
            .json()
            .get("mail")
            .is_none()
    );
    let lines = out.lines();
    assert_eq!(lines[2], "secret: abcd-efgh-jkmn");
    assert_eq!(
        lines[lines.len() - 2],
        "this is your own link: P99 keeps it nowhere, so save it in your password manager if you want it there"
    );
    h.p99(&["relink", "5", "--mail-me"]).ok();
    assert_eq!(
        h.stub.calls("POST", "/_p99/v1/codes/5/relink")[1].json()["mail"],
        true
    );
    h.p99(&["relink", "--self", "4"]).clap("the argument '");
    h.p99(&["relink"])
        .clap("the following required arguments were not provided:");
}

#[test]
fn relink_refuses_what_names_no_single_code() {
    let h = Home::new("relink-bad", |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            Reply::ok(json!({"codes": [
                code(4, "Grace Hopper", "grace@example.com", &["shop.example.com"]),
                code(7, "Grace Hopper", "grace@example.com", &["dev.example.com"]),
            ]}))
        } else {
            fake::any(req)
        }
    });
    h.p99(&["relink", "linus@example.com"])
        .refused("linus@example.com holds no active code; p99 invite mints one");
    h.p99(&["relink", "grace@example.com"]).refused(
        "grace@example.com holds several codes: 4 (projects: Shop), 7 (projects: Blog); name one by id or --host",
    );
    h.p99(&["relink", "grace@example.com", "--host", "blog.example.com"])
        .refused(
            "grace@example.com holds no active code on blog.example.com; p99 invite mints one",
        );
    h.p99(&["relink", "bob"])
        .refused("bob is neither a code id nor an e-mail; p99 invites lists both");
    h.p99(&["relink", "99999999999999999999"])
        .refused("99999999999999999999 is not a code id");
    assert!(h.stub.under("POST", "/_p99/").is_empty());
    let stub = Stub::new(fake::any);
    let text = format!(
        "[spaces.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n",
        stub.base
    );
    let nobody = Home::with_config("relink-nobody", stub, &text);
    nobody
        .p99(&["relink", "--self"])
        .refused("--self needs your e-mail in the config's [me]; p99 setup asks for it");
}

fn with_code(name: &str, code: &str) -> Home {
    let stub = Stub::new(fake::any);
    let text = home::config(&stub.base).replace("url = ", &format!("code = \"{code}\"\nurl = "));
    Home::with_config(name, stub, &text)
}

#[test]
fn link_prints_your_own_link_from_the_code_the_config_keeps() {
    let h = with_code("link-print", " ABCD-EFGH-JKMN ");
    let out = h.p99(&["link", "Shop.Example.com", "--print"]);
    out.ok();
    assert_eq!(out.stdout, "https://shop.example.com/#p99=abcdefghjkmn\n");
    let out = h.p99(&["link", "dev.example.com", "--print", "--json"]);
    assert_eq!(
        out.json(),
        json!({"host": "dev.example.com", "link": "https://dev.example.com/#p99=abcdefghjkmn"})
    );
    assert!(h.stub.seen().is_empty());
}

#[test]
fn link_refuses_a_missing_bad_or_ambiguous_choice() {
    let h = with_code("link-bad", "abcd-efgh");
    h.p99(&["link", "--print"])
        .refused("several hosts: dev.example.com, shop.example.com; name one: p99 link <host>");
    h.p99(&["link", "blog.example.com"])
        .refused("blog.example.com is not a host of the space main; p99 hosts lists them");
    h.p99(&["link", "shop.example.com", "--print"])
        .refused("the code kept for the space main is not a 12-character P99 code");
    let none = home("link-none");
    let out = none.p99(&["link", "shop.example.com", "--print"]);
    out.refused(&format!(
        "the space main keeps no code of yours; add code = \"<your code>\" under [spaces.main] in {} (the file at mode 600), or code = {{ file = \"…\" }}, {{ env = \"…\" }} or {{ command = [\"…\"] }} to read it from elsewhere",
        none.file().display()
    ));
}

#[cfg(unix)]
fn script(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let file = dir.join(name);
    std::fs::write(&file, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    file
}

#[cfg(unix)]
#[test]
fn link_opens_the_browser_the_environment_names() {
    let h = with_code("link-open", "abcdefghjkmn");
    let opener = script(
        &h.dir,
        "open-it",
        "printf '%s' \"$1\" > \"$(dirname \"$0\")/opened\"",
    );
    let out = h.p99_env(
        &["link", "shop.example.com"],
        &[("P99_BROWSER", opener.to_str().unwrap())],
    );
    out.ok();
    assert_eq!(out.stdout, "opened P99 on shop.example.com\n");
    assert_eq!(
        std::fs::read_to_string(h.dir.join("opened")).unwrap(),
        "https://shop.example.com/#p99=abcdefghjkmn"
    );
    let out = h.p99_env(
        &["link", "shop.example.com", "--json"],
        &[("P99_BROWSER", opener.to_str().unwrap())],
    );
    assert_eq!(
        out.json(),
        json!({"host": "shop.example.com", "opened": true})
    );
    let refusing = script(&h.dir, "refuse", "exit 3");
    h.p99_env(
        &["link", "shop.example.com"],
        &[("P99_BROWSER", refusing.to_str().unwrap())],
    )
    .refused(&format!(
        "{} could not open the browser; p99 link --print prints the link instead",
        refusing.display()
    ));
    let missing = h.dir.join("no-browser");
    let out = h.p99_env(
        &["link", "shop.example.com"],
        &[("P99_BROWSER", missing.to_str().unwrap())],
    );
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr
            .starts_with(&format!("p99: {}: ", missing.display()))
            && out
                .stderr
                .ends_with("; p99 link --print prints the link instead\n"),
        "{}",
        out.stderr
    );
}

#[test]
fn people_rename_moves_everything_and_says_what_moved() {
    let h = home("people");
    let out = h.p99(&["people", "rename", "grace@example.com", "grace@example.org"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "moved grace@example.com to grace@example.org: 3 cards, 1 assigned, 2 comments, 4 events, 0 attachments, 1 codes",
            "set the same e-mail in your config's [me] so new work lands there too",
        ]
    );
    assert_eq!(
        h.stub.call("POST", "/_p99/v1/people/rename").json(),
        json!({"from": "grace@example.com", "to": "grace@example.org"})
    );
    let answer = h
        .p99(&[
            "people",
            "rename",
            "a@example.com",
            "b@example.com",
            "--json",
        ])
        .json();
    assert_eq!(answer["items"], 3);
    h.p99(&["people"])
        .clap("'p99 people' requires a subcommand but one was not provided");
    h.p99(&["people", "rename", "a@example.com"])
        .clap("the following required arguments were not provided:");
}

fn git(dir: &std::path::Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.name=Ada Lovelace",
            "-c",
            "user.email=ada@example.com",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "tag.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(dir)
        .env("HOME", dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

fn repo(h: &Home) -> std::path::PathBuf {
    let dir = h.dir.join("repo");
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    std::fs::write(dir.join("a.txt"), "a").unwrap();
    git(&dir, &["add", "a.txt"]);
    git(
        &dir,
        &[
            "commit",
            "-q",
            "-m",
            "Fix the total\n\nFixes: BUG-12, BUG-13\nRefs: FEAT-4",
        ],
    );
    std::fs::write(dir.join("b.txt"), "b").unwrap();
    git(&dir, &["add", "b.txt"]);
    git(
        &dir,
        &["commit", "-q", "-m", "Tidy the cart\n\nRefs: IMP-7"],
    );
    dir
}

fn announce(h: &Home, dir: &std::path::Path, args: &[&str]) -> home::Out {
    let mut cmd = h.command(args, &[("GIT_CONFIG_NOSYSTEM", "1")]);
    cmd.current_dir(dir);
    let out = cmd.output().unwrap();
    home::Out {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

#[test]
fn announce_tells_the_worker_which_items_this_checkout_fixed() {
    let h = home("announce");
    let dir = repo(&h);
    let out = announce(
        &h,
        &dir,
        &["announce", "shop.example.com", "--version", "v1.0.0"],
    );
    out.ok();
    let sent = h.stub.call("POST", "/_p99/v1/builds");
    assert!(sent.signed);
    assert_eq!(sent.header("x-p99-actor"), None);
    let build = sent.json();
    let sha = build["sha"].as_str().unwrap().to_owned();
    assert_eq!(sha.len(), 40);
    assert_eq!(build["branch"], "main");
    assert_eq!(build["version"], "v1.0.0");
    assert_eq!(build["dirty"], false);
    assert_eq!(build["env"], "production");
    let items: Vec<(i64, String)> = build["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                i["id"].as_i64().unwrap(),
                i["rel"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        items,
        [
            (7, "refs".to_owned()),
            (12, "fixes".to_owned()),
            (13, "fixes".to_owned()),
            (4, "refs".to_owned()),
        ]
    );
    assert_eq!(
        out.stdout,
        format!(
            "announced {} main v1.0.0 to production: 4 cards (2 fixes)\n",
            &sha[..8]
        )
    );
}

#[test]
fn announce_with_flags_a_range_and_a_dirty_tree() {
    let h = home("announce-flags");
    let dir = repo(&h);
    std::fs::write(dir.join("c.txt"), "c").unwrap();
    let out = announce(
        &h,
        &dir,
        &[
            "announce",
            "--env",
            "staging",
            "--branch",
            "release",
            "--rev",
            "HEAD~1..HEAD",
            "--json",
        ],
    );
    out.ok();
    let answer = out.json();
    assert_eq!(answer["branch"], "release");
    assert_eq!(answer["dirty"], true);
    assert_eq!(answer["items"], 1);
    assert_eq!(answer["sent"], true);
    assert!(!answer["version"].as_str().unwrap().is_empty());
    let build = h.stub.call("POST", "/_p99/v1/builds").json();
    assert_eq!(build["env"], "staging");
    assert_eq!(build["items"][0]["id"], 7);
    let out = announce(
        &h,
        &dir,
        &["announce", "dev.example.com", "--version", "v2"],
    );
    out.ok();
    assert!(
        out.stdout.contains(" (dirty) to dev: 4 cards (2 fixes)"),
        "{}",
        out.stdout
    );
}

#[test]
fn announce_refusals_name_what_is_missing() {
    let h = home("announce-bad");
    let dir = repo(&h);
    announce(&h, &dir, &["announce"]).refused("name a host or an environment with --env");
    announce(&h, &dir, &["announce", "gone.example.com"])
        .refused("no host is called gone.example.com; p99 hosts lists them");
    let mut cmd = h.command(&["announce", "--env", "production"], &[]);
    cmd.current_dir(&h.dir).env("GIT_DIR", h.dir.join("no-git"));
    let out = cmd.output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("p99: git log: "), "{err}");
    assert!(h.stub.seen().is_empty());
    let refused = Home::new("announce-refused", |req: &Req| {
        if req.is("POST", "/_p99/v1/builds") {
            Reply::problem(400, "no environment is called staging")
        } else {
            fake::any(req)
        }
    });
    let dir = repo(&refused);
    announce(&refused, &dir, &["announce", "--env", "staging"])
        .refused("no environment is called staging (400)");
}

#[cfg(unix)]
#[test]
fn a_config_others_can_read_is_refused_before_any_call() {
    use std::os::unix::fs::PermissionsExt;
    let h = home("config-readable");
    std::fs::set_permissions(h.file(), std::fs::Permissions::from_mode(0o644)).unwrap();
    h.p99(&["hosts"]).refused(&format!(
        "{} holds a secret and others can read it; run chmod 600 on it",
        h.file().display()
    ));
    assert!(h.stub.seen().is_empty());
    h.write("key = \n");
    let out = h.p99(&["hosts"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr
            .starts_with(&format!("p99: {}: ", h.file().display())),
        "{}",
        out.stderr
    );
}

#[test]
fn the_harness_never_hands_p99_a_real_browser_or_display() {
    let h = with_code("harness-env", "abcdefghjkmn");
    let cmd = h.command(&["link", "shop.example.com"], &[]);
    let envs: Vec<_> = cmd.get_envs().collect();
    let set = |name: &str| {
        envs.iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.map(std::path::PathBuf::from))
    };
    assert_eq!(set("DISPLAY"), Some(None));
    assert_eq!(set("WAYLAND_DISPLAY"), Some(None));
    let browser = set("P99_BROWSER").flatten().unwrap();
    assert!(browser.starts_with(&h.dir) && !browser.exists());
    assert!(
        set("XDG_RUNTIME_DIR")
            .flatten()
            .unwrap()
            .starts_with(&h.dir)
    );
    let out = h.p99(&["link", "shop.example.com"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr
            .starts_with(&format!("p99: {}: ", browser.display())),
        "{}",
        out.stderr
    );
}

#[test]
fn spaces_lists_slug_name_worker_and_projects_without_calling_the_worker() {
    let h = home("spaces");
    let out = h.p99(&["spaces"]);
    out.ok();
    let w = h.stub.worker().len();
    assert_eq!(
        out.lines(),
        [
            format!("{:<5}  {:<7}  {:<w$}  PROJECTS", "SPACE", "NAME", "WORKER"),
            format!(
                "{:<5}  {:<7}  {:<w$}  Blog, Shop",
                "main",
                "PITO MD",
                h.stub.worker()
            ),
        ]
    );
    let answer = h.p99(&["spaces", "--json"]).json();
    let main = &answer["spaces"][0];
    assert_eq!(main["slug"], "main");
    assert_eq!(main["name"], "PITO MD");
    assert_eq!(main["url"], h.stub.worker());
    assert_eq!(main["default"], true);
    assert_eq!(
        main["projects"][0],
        json!({"name": "Blog", "hosts": ["dev.example.com"]})
    );
    h.p99(&["spaces", "--space", "work"])
        .refused("no space is called work; p99 spaces lists them");
    assert!(h.stub.seen().is_empty());
    std::fs::remove_file(h.file()).unwrap();
    assert_eq!(h.p99(&["spaces"]).stdout, "no spaces yet; run p99 setup\n");
}

#[test]
fn a_bare_space_flag_means_the_whole_space_only_where_a_grant_is_asked() {
    let h = home("space-bare");
    h.p99(&["list", "--space"])
        .refused("--space names a space here; p99 spaces lists them");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn hosts_set_project_moves_the_host_and_its_mapping() {
    let h = home("hosts-set-project");
    let out = h.p99(&["hosts", "set", "shop.example.com", "--project", "blog"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "shop.example.com updated and pushed",
            "shop.example.com is in the project Blog now; its cards moved with it",
        ]
    );
    let moved = h.stub.call("PATCH", "/_p99/v1/hosts/shop.example.com");
    assert!(moved.signed);
    assert_eq!(moved.json(), json!({"project": "Blog"}));
    let pushed = h.stub.call("PUT", "/_p99/v1/hosts/shop.example.com").json();
    assert!(pushed.get("project").is_none());
    let saved = h.toml();
    let projects = &saved["spaces"]["main"]["projects"];
    assert_eq!(projects["Shop"].as_array().unwrap().len(), 0);
    assert_eq!(
        projects["Blog"],
        toml::Value::try_from(vec!["dev.example.com", "shop.example.com"]).unwrap()
    );
}

#[test]
fn hosts_set_into_a_project_the_space_lacks_changes_nothing() {
    let h = home("hosts-set-project-missing");
    let before = h.config();
    h.p99(&["hosts", "set", "shop.example.com", "--project", "Docs"])
        .refused("no project is called Docs in the space main; p99 projects add \"Docs\" makes it");
    assert_eq!(h.config(), before);
    assert!(h.stub.writes().is_empty());
}

fn pushed_config(h: &Home, at: usize) -> Value {
    h.stub.calls("PUT", "/_p99/v1/hosts/shop.example.com")[at].json()["config"].clone()
}

#[test]
fn hosts_set_mask_and_capture_are_pushed_saved_listed_and_cleared() {
    let h = home("hosts-set-mask");
    h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--mask",
        "#card-number",
        "--mask",
        " .secret, .vault ",
        "--mask",
        "#card-number",
        "--capture",
        "off",
    ])
    .ok();
    let config = pushed_config(&h, 0);
    assert_eq!(config["mask"], json!(["#card-number", ".secret, .vault"]));
    assert_eq!(config["capture"], "off");
    let saved = h.toml();
    let shop = &saved["hosts"]["shop.example.com"];
    assert_eq!(shop["mask"].as_array().unwrap().len(), 2);
    assert_eq!(shop["capture"].as_str(), Some("off"));
    let out = h.p99(&["hosts"]);
    out.ok();
    assert_eq!(
        out.lines()[3],
        host_row(
            "shop.example.com",
            "Shop",
            "production",
            "    2  off    ",
            "ok"
        )
    );
    let answer = h.p99(&["hosts", "--json"]).json();
    assert_eq!(answer["hosts"][2]["masks"], 2);
    assert_eq!(answer["hosts"][2]["capture"], "off");
    assert_eq!(answer["hosts"][0]["masks"], 0);
    h.p99(&["hosts", "set", "shop.example.com", "--corner", "top-left"])
        .ok();
    assert_eq!(pushed_config(&h, 1)["mask"].as_array().unwrap().len(), 2);
    h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--mask",
        "none",
        "--capture",
        "on",
    ])
    .ok();
    let cleared = pushed_config(&h, 2);
    assert!(cleared.get("mask").is_none());
    assert!(cleared.get("capture").is_none());
    let saved = h.toml();
    let shop = &saved["hosts"]["shop.example.com"];
    assert!(shop.get("mask").is_none());
    assert!(shop.get("capture").is_none());
}

#[test]
fn hosts_set_refuses_a_bad_mask_list_before_saving_or_pushing() {
    let h = home("hosts-set-mask-bad");
    let before = h.config();
    h.p99(&[
        "hosts",
        "set",
        "shop.example.com",
        "--mask",
        "none",
        "--mask",
        "#a",
    ])
    .refused("--mask none clears the list and goes alone");
    h.p99(&["hosts", "set", "shop.example.com", "--mask", "  "])
        .refused("a --mask selector is empty; --mask none clears the list");
    let long = "a".repeat(201);
    let out = h.p99(&["hosts", "set", "shop.example.com", "--mask", &long]);
    assert_eq!(out.code, Some(1));
    assert!(
        out.stderr.starts_with(
            "p99: a mask selector has at most 200 characters; aaaaaaaaaaaaaaaaaaaaaaaa... has 201"
        ),
        "{}",
        out.stderr
    );
    let many: Vec<String> = (0..51).map(|n| format!(".m{n}")).collect();
    let mut args = vec!["hosts", "set", "shop.example.com"];
    for mask in &many {
        args.extend(["--mask", mask]);
    }
    h.p99(&args)
        .refused("a host takes at most 50 mask selectors");
    h.p99(&["hosts", "set", "shop.example.com", "--capture", "maybe"])
        .clap("invalid value 'maybe' for '--capture <CAPTURE>'");
    assert_eq!(h.config(), before);
    assert!(h.stub.seen().is_empty());
}

#[test]
fn hosts_set_with_a_selector_the_worker_refuses_says_its_message_and_keeps_the_config() {
    let h = Home::new("hosts-set-mask-refused", |req: &Req| {
        if req.under("PUT", "/_p99/v1/hosts/") {
            Reply::problem(400, "mask: '##' is not a CSS selector")
        } else {
            fake::any(req)
        }
    });
    let before = h.config();
    h.p99(&["hosts", "set", "shop.example.com", "--mask", "##"])
        .refused("mask: '##' is not a CSS selector (400)");
    assert_eq!(h.config(), before);
}

#[test]
fn invites_set_changes_a_grant_and_never_mails() {
    let h = home("invites-set");
    let out = h.p99(&[
        "invites",
        "set",
        "4",
        "--project",
        "shop",
        "--project",
        "Blog",
    ]);
    out.ok();
    assert_eq!(
        out.stdout,
        "code 4 of Grace Hopper <grace@example.com> now grants projects: shop, Blog; no one was mailed\n"
    );
    let call = h.stub.call("PATCH", "/_p99/v1/codes/4");
    assert!(call.signed);
    assert_eq!(
        call.json(),
        json!({"grant": {"projects": ["shop", "Blog"]}})
    );
    let whole = h.p99(&["invites", "set", "4", "--space"]);
    whole.ok();
    assert!(
        whole
            .stdout
            .contains("now grants the whole space; no one was mailed")
    );
    assert_eq!(
        h.stub.calls("PATCH", "/_p99/v1/codes/4")[1].json(),
        json!({"grant": {"space": true}})
    );
    let parked = h.p99(&["invites", "set", "4", "--park"]);
    parked.ok();
    assert_eq!(
        parked.stdout,
        "code 4 of Grace Hopper <grace@example.com> is parked: it opens nothing and is not revoked; no one was mailed\n"
    );
    assert_eq!(
        h.stub.calls("PATCH", "/_p99/v1/codes/4")[2].json(),
        json!({"grant": {"projects": []}})
    );
    let json = h
        .p99(&["codes", "set", "4", "--project", "Shop", "--json"])
        .json();
    assert_eq!(json["grant"], json!({"projects": ["Shop"]}));
    assert_eq!(json["space"], json!({"slug": "main", "name": "PITO MD"}));
    assert_eq!(h.stub.writes().len(), 4);
    assert!(h.stub.writes().iter().all(|r| r.path == "/_p99/v1/codes/4"));
    assert!(
        h.stub
            .writes()
            .iter()
            .all(|r| r.json().get("mail").is_none())
    );
}

#[test]
fn invites_set_reads_the_code_out_of_the_workers_reply() {
    let h = Home::new("invites-set-shape", |req: &Req| {
        if req.is("PATCH", "/_p99/v1/codes/4") {
            let mut held = code(
                4,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            held["grant"] = req.json()["grant"].clone();
            Reply::ok(json!({"code": held}))
        } else {
            fake::any(req)
        }
    });
    let json = h
        .p99(&["invites", "set", "4", "--project", "Blog", "--json"])
        .json();
    assert_eq!(json["id"], 4);
    assert_eq!(json["grant"], json!({"projects": ["Blog"]}));
    assert!(json.get("code").is_none());
    let bare = Home::new("invites-set-bare", |req: &Req| {
        if req.is("PATCH", "/_p99/v1/codes/4") {
            Reply::ok(code(4, "Grace Hopper", "grace@example.com", &[]))
        } else {
            fake::any(req)
        }
    });
    bare.p99(&["invites", "set", "4", "--park"])
        .refused("unexpected answer: no code in the reply");
}

#[test]
fn a_named_space_with_no_project_says_it_grants_the_whole_space_before_sending() {
    let h = Home::new("invite-whole-named", |req: &Req| {
        if req.is("POST", "/_p99/v1/codes") || req.is("PATCH", "/_p99/v1/codes/4") {
            Reply::problem(503, "held")
        } else {
            fake::any(req)
        }
    });
    let note = "--space main with no --project grants the whole space PITO MD";
    let out = h.p99(&[
        "invite",
        "--space",
        "main",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--owner",
        "--no-mail",
    ]);
    out.refused("held (503)");
    assert!(
        out.stderr
            .contains(&format!("{note} as an Owner; --project <name> grants less")),
        "{}",
        out.stderr
    );
    let set = h.p99(&["invites", "set", "4", "--space", "main"]);
    set.refused("held");
    assert!(
        set.stderr
            .contains(&format!("{note}; --project <name> grants less")),
        "{}",
        set.stderr
    );
    let bare = h.p99(&["invites", "set", "4", "--space"]);
    assert!(
        !bare.stderr.contains("with no --project"),
        "{}",
        bare.stderr
    );
    let some = h.p99(&[
        "invites",
        "set",
        "4",
        "--space",
        "main",
        "--project",
        "Shop",
    ]);
    assert!(
        !some.stderr.contains("with no --project"),
        "{}",
        some.stderr
    );
}

#[test]
fn invites_set_refuses_a_missing_or_clashing_grant_before_any_call() {
    let h = home("invites-set-bad");
    h.p99(&["invites", "set", "4"]).refused(
        "say what the code grants: --space for the whole space, --project <name> for some, or --park for nothing",
    );
    h.p99(&["invites", "set", "4", "--park", "--project", "Shop"])
        .clap("the argument '");
    h.p99(&["invites", "set"])
        .clap("the following required arguments were not provided:");
    h.p99(&["invites", "set", "x", "--park"])
        .clap("invalid value 'x' for '<ID>'");
    assert!(h.stub.seen().is_empty());
}

#[test]
fn invites_set_on_a_worker_without_grants_says_deploy() {
    let h = Home::new("invites-set-old", |req: &Req| {
        if req.under("PATCH", "/_p99/v1/codes/") {
            Reply::problem(404, "no such route")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["invites", "set", "4", "--park"])
        .refused("this Worker has no cards yet; run p99 deploy");
}

fn two_spaces_without_a_default() -> (Home, Stub) {
    let main = Stub::new(fake::any);
    let work = Stub::new(fake::any);
    let text = format!(
        "{}\n[spaces.work]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n\n[spaces.work.projects]\nDocs = [\"work.example.org\"]\n\n[hosts.\"work.example.org\"]\nspace = \"work\"\n",
        home::config(&main.base).replace("default_space = \"main\"\n", ""),
        work.base
    );
    (
        Home::with_config("two-spaces-no-default", main, &text),
        work,
    )
}

#[test]
fn invite_finds_the_space_that_holds_the_projects_when_several_are_configured() {
    let (h, work) = two_spaces_without_a_default();
    let out = h.p99(&[
        "invite",
        "--project",
        "docs",
        "--name",
        "G",
        "--email",
        "g@example.com",
        "--no-mail",
        "--json",
    ]);
    out.ok();
    assert_eq!(
        work.call("POST", "/_p99/v1/codes").json()["grant"],
        json!({"projects": ["docs"]})
    );
    assert!(h.stub.seen().is_empty());
    assert_eq!(out.json()["space"], json!({"slug": "work", "name": "work"}));
    h.p99(&[
        "invite",
        "--space",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("several spaces; name one with --space");
    h.p99(&[
        "invite",
        "--project",
        "Nowhere",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("several spaces; name one with --space");
}

const LEGACY: &str = r#"default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "acc1"
token = "cf-token"
key = "test-secret"
url = "BASE/_p99"

[hosts."shop.example.com"]
account = "main"
"#;

fn legacy_home(name: &str) -> Home {
    let stub = Stub::new(fake::any);
    let text = LEGACY.replace("BASE", &stub.base);
    Home::with_config(name, stub, &text)
}

#[test]
fn a_legacy_config_and_flag_work_say_to_rename_once_and_are_written_back_as_space() {
    let h = legacy_home("legacy");
    let out = h.p99(&["hosts", "--account", "main"]);
    out.ok();
    assert_eq!(out.stderr.lines().count(), 2, "{}", out.stderr);
    assert_eq!(
        out.stderr.matches("--account is now --space").count(),
        1,
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.contains(
            "[accounts.<name>] to [spaces.<name>], default_account to default_space and account = to space = under [hosts]"
        ),
        "{}",
        out.stderr
    );
    assert!(out.stdout.contains("shop.example.com"), "{}", out.stdout);
    let flagless = h.p99(&["hosts"]);
    flagless.ok();
    assert_eq!(flagless.stderr.lines().count(), 1, "{}", flagless.stderr);
    assert!(!flagless.stderr.contains("--account"));
    h.p99(&["hosts", "set", "shop.example.com", "--corner", "top-left"])
        .ok();
    let saved = h.toml();
    assert!(saved.get("accounts").is_none());
    assert!(saved.get("default_account").is_none());
    assert_eq!(saved["default_space"].as_str(), Some("main"));
    assert_eq!(saved["spaces"]["main"]["account_id"].as_str(), Some("acc1"));
    assert_eq!(
        saved["hosts"]["shop.example.com"]["space"].as_str(),
        Some("main")
    );
    assert!(saved["hosts"]["shop.example.com"].get("account").is_none());
    let again = h.p99(&["hosts"]);
    again.ok();
    assert!(again.stderr.is_empty(), "{}", again.stderr);
}

#[test]
fn the_new_names_say_nothing_and_a_clashing_old_and_new_name_is_refused() {
    let h = home("renamed-quiet");
    let out = h.p99(&["hosts", "--space", "main"]);
    out.ok();
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    let plain = h.config();
    h.write(&format!(
        "{plain}\n[accounts.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\n"
    ));
    let out = h.p99(&["hosts"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains(
            "the space main is in both [spaces.main] and [accounts.main]; keep [spaces.main]"
        ),
        "{}",
        out.stderr
    );
    h.write(&format!(
        "{plain}\n[hosts.\"nowhere.example.com\"]\nenv = \"production\"\n"
    ));
    let out = h.p99(&["hosts"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr
            .contains("the host nowhere.example.com names no space"),
        "{}",
        out.stderr
    );
}

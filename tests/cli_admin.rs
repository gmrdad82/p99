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

fn host_row(host: &str, account: &str, env: &str, state: &str) -> String {
    format!("{host:<16}  {account:<7}  {env:<10}  {state}")
}

#[test]
fn hosts_lists_the_config_beside_the_worker_and_names_each_state() {
    let h = home("hosts-list");
    let out = h.p99(&["hosts"]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            host_row("HOST", "ACCOUNT", "ENV", "STATE"),
            host_row(
                "blog.example.com",
                "main",
                "production",
                "only on the Worker"
            ),
            host_row("dev.example.com", "main", "dev", "not on the Worker"),
            host_row("shop.example.com", "main", "production", "ok"),
        ]
    );
    assert!(h.stub.call("GET", "/_p99/v1/hosts").signed);
    let answer = h.p99(&["hosts", "--json"]).json();
    assert_eq!(answer["unreachable"], json!({}));
    let hosts = answer["hosts"].as_array().unwrap();
    assert_eq!(hosts.len(), 3);
    assert_eq!(hosts[1]["host"], "dev.example.com");
    assert_eq!(hosts[1]["in_config"], true);
    assert_eq!(hosts[1]["worker"], Value::Null);
    assert_eq!(hosts[1]["config"], json!({"theme": {}, "strings": {}}));
    assert_eq!(hosts[0]["in_config"], false);
    assert_eq!(hosts[2]["state"], "ok");
    assert_eq!(hosts[2]["worker"]["env"], "production");
}

#[test]
fn hosts_says_a_host_differs_and_names_an_account_it_cannot_reach() {
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
            host_row("dev.example.com", "main", "dev", "unreachable"),
            host_row("shop.example.com", "main", "production", "unreachable"),
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
        "[accounts.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\n\n[accounts.other]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n",
        stub.base
    );
    let h = Home::with_config("hosts-none", stub, &text);
    let out = h.p99(&["hosts", "--account", "main"]);
    out.ok();
    assert_eq!(
        out.stdout,
        "no hosts yet; p99 hosts add <host> --env <env>\n"
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
        "--env",
        "staging",
        "--kind",
        "development",
    ]);
    out.ok();
    assert_eq!(
        out.stdout,
        "added new.example.com to main, environment staging\n"
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
        json!({"env": "staging", "config": {"theme": {}, "strings": {}}})
    );
    assert_eq!(
        h.stub.call("PUT", "/_p99/v1/envs/staging").json(),
        json!({"kind": "development", "position": 2, "notify": false})
    );
    let config = h.toml();
    assert_eq!(
        config["hosts"]["new.example.com"]["account"].as_str(),
        Some("main")
    );
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
    let out = h.p99(&["hosts", "add", "two.example.com", "--env", "dev", "--json"]);
    out.ok();
    assert_eq!(out.json()["host"], "two.example.com");
    assert_eq!(out.json()["env"], "dev");
    assert!(h.stub.under("PUT", "/_p99/v1/envs/").is_empty());
    h.p99_env(
        &[
            "hosts",
            "add",
            "three.example.com",
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
    h.p99(&["hosts", "add", "new.example.com"]).ok();
    let out = h.p99(&["hosts", "add", "new.example.com"]);
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
    let out = pages.p99(&["hosts", "add", "new.example.com"]);
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
    h.p99(&["hosts", "add", "not a host"])
        .refused("not a host is not a host name; try example.com");
    h.p99(&["hosts", "add", "localhost"])
        .refused("localhost is not a host name; try example.com");
    assert!(h.stub.seen().is_empty());
    h.p99(&["hosts", "add", "new.example.org"]).refused(
        "new.example.org is on no zone this token reaches; add the zone to Cloudflare or to the token's Zone › Zone: Read",
    );
    h.p99(&["hosts", "add", "held.example.com"]).refused(
        "the route held.example.com/_p99/* already runs the Worker other; P99 leaves it alone (remove it in the dashboard to give it to p99)",
    );
    assert!(h.stub.under("PUT", "/_p99/").is_empty());
    h.p99(&["hosts", "add", "x.example.com", "--kind", "beta"])
        .clap("invalid value 'beta' for '--kind <KIND>'");
    h.p99(&["hosts", "add"])
        .clap("the following required arguments were not provided:");
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
    h.p99(&["hosts", "add", "new.example.com"])
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
        "removed shop.example.com from main; its items stay, and so does its route in Cloudflare\n"
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
        json!({"removed": "dev.example.com", "account": "main"})
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
        .refused("Only an Agency or Owner key hides the 'by PITO.MD' link");
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
    let other = h.p99(&["feed", "--account", "other"]);
    assert_eq!(
        other.stdout,
        "no hosts yet; p99 hosts add <host> --env <env>\n"
    );
}

#[test]
fn invite_mails_a_new_code_and_shows_only_what_the_owner_may_see() {
    let h = home("invite");
    let out = h.p99(&[
        "invite",
        "Shop.Example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--manager",
        "--totp",
    ]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "Grace Hopper <grace@example.com> (manager)",
            "mailed the link for shop.example.com to grace@example.com",
            "key:    JBSWY3DPEHPK3PXP   (paste it as a one-time password or setup key; totp is the same as a link)",
            "totp:   otpauth://totp/P99:grace@example.com?secret=JBSWY3DPEHPK3PXP&issuer=P99&algorithm=SHA1&digits=6&period=30",
            "send these apart from the link; each browser asks for its 6-digit code once",
        ]
    );
    assert!(!out.stdout.contains("abcd-efgh-jkmn"));
    let sent = h.stub.call("POST", "/_p99/v1/codes");
    assert!(sent.signed);
    let body = sent.json();
    assert_eq!(body["hosts"], json!(["shop.example.com"]));
    assert_eq!(body["manager"], true);
    assert_eq!(body["totp"], true);
    assert_eq!(body["mail"], true);
    assert_eq!(body["name"], "Grace Hopper");
}

#[test]
fn invite_without_mail_prints_the_secret_once() {
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
            "link:   https://dev.example.com/#p99=abcdefghjkmn",
            "this is the only time the secret is shown",
        ]
    );
    let body = h.stub.call("POST", "/_p99/v1/codes").json();
    assert!(body.get("mail").is_none());
    assert!(body.get("totp").is_none());
    assert_eq!(
        body["hosts"],
        json!(["shop.example.com", "dev.example.com"])
    );
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
    assert!(h.stub.seen()[0].json().get("mail").is_none());
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
    assert_eq!(h.stub.seen()[1].json()["mail"], true);
    assert!(
        out.stdout
            .contains("mailed the link for shop.example.com to ada@example.com")
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
            "mail is off for this account, so nothing was mailed; send the link yourself (p99 email set turns mail on)",
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
    h.p99(&["invite", "--name", "G", "--email", "g@example.com"])
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
fn a_code_covers_one_account() {
    let stub = Stub::new(fake::any);
    let text = format!(
        "{}\n[accounts.work]\naccount_id = \"acc2\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n\n[hosts.\"work.example.org\"]\naccount = \"work\"\n",
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
    .refused("work.example.org is in the account work, not main; a code covers one account");
    assert!(h.stub.seen().is_empty());
}

fn code_row(id: i64, state: &str, who: &str, role: &str, hosts: &str, last: &str) -> String {
    format!(
        "{id:>4}  {state}  {who}  {role}  ...k3x9  2026-10-01 09:30  hosts: {hosts}  last used: {last}"
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
                "member",
                "shop.example.com",
                "never"
            ),
            code_row(
                6,
                "revoked",
                "Linus <linus@example.com>",
                "manager, totp",
                "dev.example.com",
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

#[test]
fn invites_totp_shows_the_new_key_once() {
    let h = home("invites-totp");
    let out = h.p99(&["invites", "totp", "4"]);
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
    let answer = h.p99(&["invites", "totp", "4", "--json"]).json();
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
        "mailed the link for shop.example.com to grace@example.com",
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
        "grace@example.com holds several codes: 4 (shop.example.com), 7 (dev.example.com); name one by id or --host",
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
        "[accounts.main]\naccount_id = \"acc1\"\ntoken = \"t\"\nkey = \"{KEY}\"\nurl = \"{}/_p99\"\n",
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
        .refused("blog.example.com is not a host of the account main; p99 hosts lists them");
    h.p99(&["link", "shop.example.com", "--print"])
        .refused("the code kept for the account main is not a 12-character P99 code");
    let none = home("link-none");
    let out = none.p99(&["link", "shop.example.com", "--print"]);
    out.refused(&format!(
        "the account main keeps no code of yours; add code = \"<your code>\" under [accounts.main] in {} (the file at mode 600), or code = \"op://vault/item/field\" to read it from the 1Password CLI",
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
            "moved grace@example.com to grace@example.org: 3 items, 1 assigned, 2 comments, 4 events, 0 attachments, 1 codes",
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
            "announced {} main v1.0.0 to production: 4 items (2 fixes)\n",
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
        out.stdout.contains(" (dirty) to dev: 4 items (2 fixes)"),
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

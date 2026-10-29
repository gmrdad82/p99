use serde_json::json;

use crate::cloudflare::{
    Cloud, KEY, PEPPER, RESEND, TOKEN, UPLOAD, VERSION, all, cf_calls, configured, inserted,
    is_hex, live, metadata, never_shows, refuses_and_changes_nothing, since, space_config, spaced,
    sqls, uploads_in, with, writes_in,
};

const HOOK: &str = "https://hooks.example.com/p99-Us2Wm9QrTe";

fn current() -> Cloud {
    let mut cloud = live();
    cloud.secrets = vec![
        ("KEY_P99".into(), KEY.into()),
        ("MANAGERS".into(), "ada@example.com".into()),
        ("CODE_PEPPER".into(), PEPPER.into()),
        ("RESEND_API_KEY".into(), RESEND.into()),
    ];
    cloud
        .bindings
        .push(json!({"type": "plain_text", "name": "HOOK_URL", "text": HOOK}));
    cloud.routes = vec![("example.com/_p99/*".into(), "p99".into())];
    cloud
}

#[test]
fn us_deploy_001_an_up_to_date_space_deploys_and_keeps_every_secret() {
    let (h, cf) = with("us-deploy-current", current(), |base| {
        space_config(base).replace(
            &format!("token = \"{TOKEN}\""),
            "token = { command = [\"p99-secret-tool-that-must-never-run\"] }",
        )
    });
    let secrets = cf.lock().unwrap().secrets.clone();

    let out = h.p99_env(&["deploy"], &[("P99_TOKEN", TOKEN)]);
    out.ok();
    assert!(
        out.stdout.contains("every migration is applied"),
        "{}",
        out.stdout
    );
    let first = cf_calls(&h);
    let bearer = format!("Bearer {TOKEN}");
    assert!(
        first
            .iter()
            .all(|r| r.header("authorization") == Some(bearer.as_str())),
        "a Cloudflare call went without the token from the environment"
    );
    assert!(inserted(&h).is_empty(), "{:?}", inserted(&h));
    assert!(
        !first
            .iter()
            .any(|r| r.method == "PUT" && r.path.ends_with("/secrets")),
        "deploy rewrote a secret"
    );
    let uploads = uploads_in(&first);
    assert_eq!(uploads.len(), 1);
    let body = uploads[0].text();
    let sent = metadata(&body);
    assert!(sent.get("migrations").is_none(), "{sent}");
    assert_eq!(sent["keep_bindings"], json!(["secret_text"]));
    let bound = |name: &str| {
        sent["bindings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not bound: {sent}"))["text"]
            .clone()
    };
    assert_eq!(bound("SPACE"), "main");
    assert_eq!(bound("SPACE_NAME"), "Example Co");
    assert_eq!(bound("VERSION"), VERSION);
    assert_eq!(bound("HOOK_URL"), HOOK);
    for secret in [TOKEN, KEY, RESEND, PEPPER] {
        assert!(!body.contains(secret), "the upload carried a secret");
    }
    assert_eq!(cf.lock().unwrap().secrets, secrets);

    let n = first.len();
    let again = h.p99_env(&["deploy"], &[("P99_TOKEN", TOKEN)]);
    again.ok();
    assert_eq!(
        writes_in(&since(&h, n)),
        writes_in(&first),
        "a second deploy did something the first didn't"
    );
    assert_eq!(cf.lock().unwrap().secrets, secrets);
    never_shows(&[&out, &again], &[HOOK]);
}

#[test]
fn us_deploy_001_deploy_without_a_worker_says_to_run_setup_and_writes_nothing() {
    let (h, cf) = spaced("us-deploy-no-worker", Cloud::default());
    let out = h.p99(&["deploy"]);
    out.refused("the account has no Worker called p99; run p99 setup");
    let calls = cf_calls(&h);
    assert!(writes_in(&calls).is_empty(), "{:?}", writes_in(&calls));
    assert!(calls.iter().all(|r| !r.path.ends_with("/query")));
    let state = cf.lock().unwrap();
    assert!(!state.worker && state.secrets.is_empty() && state.routes.is_empty());
    drop(state);
    never_shows(&[&out], &[]);
}

fn refusal(path: &str) -> &'static str {
    if path == "/workers/routes" {
        "no route for example.com"
    } else {
        "Authentication error (10000)"
    }
}

#[test]
fn us_deploy_001_a_refused_deploy_changes_nothing_on_the_space() {
    for (n, path) in ["/workers/scripts", "/secrets", "/workers/routes"]
        .into_iter()
        .enumerate()
    {
        let mut cloud = current();
        cloud.denied = vec![path];
        let (h, cf) = spaced(&format!("us-deploy-refused-{n}"), cloud);
        let out = refuses_and_changes_nothing(&h, &cf, &["deploy"], refusal(path));
        assert!(
            all(&out).contains("Authentication error (10000)") && all(&out).contains(path),
            "{path}: {}",
            all(&out)
        );
        never_shows(&[&out], &[]);
    }

    let mut cloud = current();
    cloud.denied = vec!["PUT /workers/scripts/p99"];
    let (h, cf) = spaced("us-deploy-refused-upload", cloud);
    let before = cf.lock().unwrap().state();
    let out = h.p99(&["deploy"]);
    assert_eq!(out.code, Some(1), "{}", all(&out));
    assert!(
        all(&out).contains("Authentication error (10000)"),
        "{}",
        all(&out)
    );
    let calls = cf_calls(&h);
    assert_eq!(writes_in(&calls), [format!("PUT {UPLOAD}")]);
    assert_eq!(cf.lock().unwrap().state(), before);
    assert!(sqls(&h).iter().all(|(s, _)| s.starts_with("SELECT ")));
    never_shows(&[&out], &[]);

    let mut cloud = current();
    cloud.routes = vec![("example.com/_p99/*".into(), "other".into())];
    let (h, cf) = spaced("us-deploy-route-held", cloud);
    let out = refuses_and_changes_nothing(&h, &cf, &["deploy"], "no route for example.com");
    assert!(
        out.stdout
            .contains("  !!  the route example.com/_p99/* already runs the Worker other"),
        "{}",
        out.stdout
    );
    never_shows(&[&out], &[]);
}

#[test]
fn us_deploy_001_a_cloudflare_failure_mid_deploy_keeps_the_running_worker_and_the_next_deploy_finishes()
 {
    let (h, cf) = configured(
        "us-deploy-502-upload",
        Cloud {
            broken: Some(("PUT", "/workers/scripts/p99")),
            ..live()
        },
    );
    let out = h.p99(&["deploy"]);
    out.refused("Cloudflare /accounts/acc1/workers/scripts/p99: HTTP 502");
    {
        let state = cf.lock().unwrap();
        assert_eq!(state.binding("VERSION")["text"], "1.9.0");
        assert_eq!(state.secrets, live().secrets);
        assert!(state.routes.is_empty());
    }
    let calls = cf_calls(&h);
    assert!(
        writes_in(&calls)
            .iter()
            .all(|w| w == &format!("PUT {UPLOAD}")
                || w.starts_with("D1 CREATE TABLE IF NOT EXISTS d1_migrations")),
        "{:?}",
        writes_in(&calls)
    );
    assert!(sqls(&h).iter().all(|(s, _)| s.starts_with("SELECT ")
        || s.starts_with("CREATE TABLE IF NOT EXISTS d1_migrations")));
    cf.lock().unwrap().broken = None;
    h.p99(&["deploy"]).ok();
    {
        let state = cf.lock().unwrap();
        assert_eq!(state.binding("VERSION")["text"], VERSION);
        assert_eq!(state.secret("KEY_P99").as_deref(), Some(crate::stub::KEY));
        assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
    }

    let (h, cf) = configured(
        "us-deploy-502-schedules",
        Cloud {
            broken: Some(("PUT", "/schedules")),
            ..live()
        },
    );
    let out = h.p99(&["deploy", "--json"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    let report = out.json();
    assert_eq!(report["ok"], false);
    assert_eq!(
        report["error"],
        "Cloudflare /accounts/acc1/workers/scripts/p99/schedules: HTTP 502"
    );
    assert_eq!(h.stub.calls("PUT", UPLOAD).len(), 1);
    {
        let state = cf.lock().unwrap();
        assert_eq!(state.binding("VERSION")["text"], VERSION);
        assert_eq!(state.secret("KEY_P99").as_deref(), Some(crate::stub::KEY));
        assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
        assert!(state.secret("CODE_PEPPER").is_none());
        assert!(state.routes.is_empty());
    }
    assert!(h.stub.under("GET", "/health/").is_empty());

    cf.lock().unwrap().broken = None;
    let again = h.p99(&["deploy", "--json"]);
    again.ok();
    assert_eq!(again.json()["ok"], true);
    let state = cf.lock().unwrap();
    assert!(state.secret("CODE_PEPPER").is_some_and(|p| is_hex(&p)));
    assert_eq!(state.secret("KEY_P99").as_deref(), Some(crate::stub::KEY));
    assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
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
    never_shows(&[&out, &again], &[crate::stub::KEY, "cf-token"]);
}

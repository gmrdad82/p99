use serde_json::{Value, json};

use crate::cloudflare::{
    Cloud, KEY, Shared, TOKEN, after, at, cf_calls, first, inserted_in, metadata, never_shows,
    plan_hash, recorded, refuses_and_changes_nothing, shipped, since, space_config, spaced, sql_of,
    uploads_in, with, writes_in,
};
use crate::home::Home;
use crate::stub::Req;

const GATED: &str = "0011_lanes.sql, 0012_people.sql, 0013_app.sql, 0016_one_board.sql, 0017_delete_archived.sql, 0018_spaces.sql change this space's data";
const CHANGED: &str = "the plan changed since that hash was taken";

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
            json!([{ "email": "agent@example.com", "name": "Build Agent", "actions": 3 }]),
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

fn v19_rows() -> Vec<(&'static str, Value)> {
    vec![(
        "count(DISTINCT il.label_id) AS tags",
        json!([{ "items": 3, "tags": 2 }]),
    )]
}

fn v110_rows() -> Vec<(&'static str, Value)> {
    vec![
        (
            "AS placed",
            json!([
                { "id": 2, "name": "Web", "owner": "ada@example.com", "cards": 0, "columns": 4, "placed": 3 },
                { "id": 5, "name": "Cards", "owner": "ada@example.com", "cards": 1, "columns": 6, "placed": 2 },
                { "id": 3, "name": "Ops", "owner": "grace@example.com", "cards": 0, "columns": 3, "placed": 1 }
            ]),
        ),
        (
            "l.closes AS closes",
            json!([
                { "label": "Inbox", "role": "inbox", "closes": 0, "items": 3, "open": 1 },
                { "label": "QA ready", "role": null, "closes": 0, "items": 1, "open": 1 },
                { "label": "Shipped", "role": null, "closes": 1, "items": 4, "open": 1 }
            ]),
        ),
        (
            "WHERE NOT EXISTS (SELECT 1 FROM board_positions",
            json!([{ "items": 2 }]),
        ),
    ]
}

fn v111_rows() -> Vec<(&'static str, Value)> {
    vec![
        ("AS lanes FROM board_columns", json!([{ "lanes": 7 }])),
        (
            "AS places",
            json!([
                { "id": 2, "name": "Web", "owner": "ada@example.com", "columns": 4, "places": 3 },
                { "id": 3, "name": "Ops", "owner": null, "columns": 3, "places": 1 }
            ]),
        ),
        (
            "WHERE l.id NOT IN (SELECT bc.label_id",
            json!([
                { "label": "Inbox", "items": 0, "open": 0 },
                { "label": "Triage", "items": 2, "open": 1 }
            ]),
        ),
        ("AS unplaced FROM items", json!([{ "unplaced": 1 }])),
        (
            "SELECT count(*) AS tags FROM item_labels",
            json!([{ "tags": 4 }]),
        ),
    ]
}

fn count_rows() -> Vec<(&'static str, Value)> {
    vec![
        (
            "AS attachments, (SELECT count(*) FROM events) AS events",
            json!([{ "items": 5, "comments": 4, "attachments": 2, "events": 9 }]),
        ),
        (
            "FROM labels l JOIN items i ON i.label_id = l.id",
            json!([{ "label": "In progress", "items": 3 }, { "label": "Triage", "items": 2 }]),
        ),
        (
            "sum(s.moved) AS moved",
            json!([{ "lane": 2, "items": 4, "moved": 1 }, { "lane": 6, "items": 1, "moved": 1 }]),
        ),
    ]
}

fn spaces_rows() -> Vec<(&'static str, Value)> {
    vec![
        (
            "SELECT host FROM hosts ORDER BY host",
            json!([{ "host": "dev.example.com" }, { "host": "example.com" }, { "host": "shop.example.com" }]),
        ),
        (
            "AS named, host",
            json!([
                { "named": null, "host": "example.com", "items": 5, "open": 2 },
                { "named": "Roadmap", "host": "example.com", "items": 3, "open": 3 },
                { "named": null, "host": "shop.example.com", "items": 4, "open": 1 },
                { "named": null, "host": "old.example.com", "items": 1, "open": 0 }
            ]),
        ),
        (
            "SELECT id, kind, host FROM items",
            json!([{ "id": 9, "kind": "bug", "host": "old.example.com" }]),
        ),
        (
            "hosts_json, manager, revoked_at FROM codes",
            json!([
                { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "hosts_json": "[\"dev.example.com\",\"example.com\",\"shop.example.com\"]", "manager": 1, "revoked_at": null },
                { "id": 2, "name": "Grace Hopper", "email": "grace@example.com", "hosts_json": "[\"example.com\"]", "manager": 0, "revoked_at": null },
                { "id": 3, "name": "Mary Jackson", "email": "mary@example.com", "hosts_json": "[\"shop.example.com\"]", "manager": 0, "revoked_at": null }
            ]),
        ),
        (
            "AS codes, (SELECT count(*) FROM items)",
            json!([{ "codes": 3, "items": 13, "open": 6, "comments": 4, "events": 20, "attachments": 1 }]),
        ),
        ("AS old_tags", json!([{ "old_tags": 2, "tagged": 1 }])),
    ]
}

fn spaces_config(base: &str) -> String {
    space_config(base).replace(
        "[hosts.\"example.com\"]",
        "[spaces.main.projects]\n\"Example site\" = [\"example.com\", \"dev.example.com\"]\nLicences = [\"licence.example.com\"]\n\n[hosts.\"example.com\"]",
    )
}

fn spaces_home(name: &str) -> (Home, Shared) {
    with(name, at(17, spaces_rows()), spaces_config)
}

fn applied(cf: &Shared) -> Vec<String> {
    cf.lock().unwrap().applied.clone()
}

fn plan(h: &Home, extra: &[&str]) -> String {
    let mut args = vec!["migrate", "--plan"];
    args.extend(extra);
    let out = h.p99(&args);
    out.ok();
    out.stdout
}

fn plan_writes_nothing(h: &Home, extra: &[&str]) -> String {
    let n = cf_calls(h).len();
    let text = plan(h, extra);
    let later = since(h, n);
    assert!(
        writes_in(&later).is_empty(),
        "the plan wrote: {:?}",
        writes_in(&later)
    );
    text
}

fn migrations_before_upload(calls: &[Req]) {
    let last = calls
        .iter()
        .rposition(|c| sql_of(c).is_some_and(|s| !recorded(&s).is_empty()))
        .expect("no migration was applied");
    let upload = calls
        .iter()
        .position(|c| c.is("PUT", crate::cloudflare::UPLOAD))
        .expect("no upload");
    assert!(upload > last, "the Worker went up before its migrations");
}

fn batch_with(calls: &[Req], migration: &str) -> String {
    let batches: Vec<String> = calls
        .iter()
        .filter_map(sql_of)
        .filter(|sql| recorded(sql).iter().any(|n| n == migration))
        .collect();
    assert_eq!(batches.len(), 1, "{migration}: {batches:?}");
    batches[0].clone()
}

#[test]
fn us_migrate_001_the_plan_reads_only_and_its_hash_applies_exactly_the_pending_migrations() {
    let (h, cf) = spaced("us-migrate-plan", at(10, v18_rows()));
    let text = plan_writes_nothing(&h, &[]);
    let hash = plan_hash(&text);
    assert_eq!(plan_hash(&plan_writes_nothing(&h, &[])), hash);
    assert_eq!(applied(&cf), first(10));

    let n = cf_calls(&h).len();
    let shouted = format!("  {}  ", hash.to_ascii_uppercase());
    let out = h.p99(&["deploy", "--json", "--accept-plan", &shouted]);
    out.ok();
    let report = out.json();
    assert_eq!(report["ok"], true);
    assert_eq!(report["migrations"]["accepted"], hash);
    assert_eq!(report["migrations"]["applied"], json!(after(10)));
    let later = since(&h, n);
    assert_eq!(inserted_in(&later), after(10));
    assert_eq!(applied(&cf), shipped());
    migrations_before_upload(&later);

    let n = cf_calls(&h).len();
    h.p99(&["deploy"]).ok();
    assert!(inserted_in(&since(&h, n)).is_empty());
    never_shows(&[&out], &[]);
}

#[test]
fn us_migrate_001_a_deploy_without_the_hash_or_with_a_stale_one_refuses_and_changes_nothing() {
    let (h, cf) = with("us-migrate-refusals", at(10, v18_rows()), |base| {
        format!(
            "{}\n[spaces.other]\naccount_id = \"acc1\"\ntoken = \"{TOKEN}\"\ndatabase_id = \"db2\"\nkey = \"{KEY}\"\n",
            space_config(base)
        )
    });

    let out = refuses_and_changes_nothing(&h, &cf, &["deploy"], GATED);
    assert!(
        out.stderr
            .contains("read `p99 migrate --plan`, answer its decisions, then run again with --accept-plan <hash>"),
        "{}",
        out.stderr
    );

    let main = h
        .p99(&["migrate", "--plan", "--json", "--space", "main"])
        .json();
    let other = h
        .p99(&["migrate", "--plan", "--json", "--space", "other"])
        .json();
    assert_ne!(main["hash"], other["hash"]);
    let hash = main["hash"].as_str().unwrap().to_owned();
    refuses_and_changes_nothing(
        &h,
        &cf,
        &["deploy", "--space", "other", "--accept-plan", &hash],
        CHANGED,
    );

    {
        let mut state = cf.lock().unwrap();
        let kinds = state
            .rows
            .iter_mut()
            .find(|(p, _)| *p == "GROUP BY kind")
            .unwrap();
        kinds.1 = json!([{ "kind": "bug", "items": 7, "open": 4 }]);
    }
    let stale = refuses_and_changes_nothing(&h, &cf, &["deploy", "--accept-plan", &hash], CHANGED);
    assert!(
        stale
            .stderr
            .contains("read `p99 migrate --plan` again and run with its new hash"),
        "{}",
        stale.stderr
    );
    refuses_and_changes_nothing(
        &h,
        &cf,
        &["deploy", "--accept-plan", &"0".repeat(64)],
        CHANGED,
    );
    assert_eq!(applied(&cf), first(10));
    assert!(uploads_in(&cf_calls(&h)).is_empty());
    never_shows(&[&out, &stale], &[]);
}

#[test]
fn us_migrate_001_a_space_cut_off_between_0004_and_0005_is_refused_writing_nothing_and_its_plan_applies_the_rest()
 {
    let (h, cf) = spaced("us-migrate-cut-off", at(4, half_rows()));
    let text = plan_writes_nothing(&h, &[]);
    assert!(
        text.contains(&format!(
            "  pending: {}\n",
            GATED.split(" change").next().unwrap()
        )),
        "{text}"
    );
    let hash = plan_hash(&text);

    let (twin, _) = spaced("us-migrate-cut-off-twin", at(10, half_rows()));
    assert_eq!(
        plan_hash(&plan(&twin, &[])),
        hash,
        "the plan read before 0005 must equal the plan 0005 to 0010 would leave"
    );

    let out = refuses_and_changes_nothing(&h, &cf, &["deploy"], GATED);
    assert!(!out.stderr.contains("applied 0005"), "{}", out.stderr);
    refuses_and_changes_nothing(&h, &cf, &["deploy", "--json"], GATED);
    refuses_and_changes_nothing(
        &h,
        &cf,
        &["deploy", "--accept-plan", &"0".repeat(64)],
        CHANGED,
    );
    assert_eq!(applied(&cf), first(4));

    let n = cf_calls(&h).len();
    let done = h.p99(&["deploy", "--accept-plan", &hash]);
    done.ok();
    let later = since(&h, n);
    assert_eq!(inserted_in(&later), after(4));
    assert_eq!(applied(&cf), shipped());
    migrations_before_upload(&later);
    never_shows(&[&out, &done], &[]);
}

#[test]
fn us_migrate_001_a_migration_that_fails_midway_stops_before_the_upload_and_resumes_next_time() {
    let (h, cf) = spaced(
        "us-migrate-midway",
        Cloud {
            worker: true,
            fail: Some("0007_github.sql".into()),
            ..Default::default()
        },
    );
    let out = h.p99(&["deploy", "--json"]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(
        out.stderr.contains("p99: Cloudflare /accounts/acc1/d1/database/db1/query: near \"github\": syntax error: SQLITE_ERROR (7500)"),
        "{}",
        out.stderr
    );
    assert_eq!(out.json()["ok"], false);
    assert_eq!(applied(&cf), first(6));
    let calls = cf_calls(&h);
    assert!(uploads_in(&calls).is_empty());
    assert!(!calls.iter().any(|c| c.method != "GET"
        && (c.path.ends_with("/secrets")
            || c.path.ends_with("/schedules")
            || c.path.ends_with("/workers/routes"))));

    cf.lock().unwrap().fail = None;
    refuses_and_changes_nothing(&h, &cf, &["deploy"], GATED);
    assert_eq!(applied(&cf), first(6));

    let hash = plan_hash(&plan_writes_nothing(&h, &[]));
    let n = cf_calls(&h).len();
    let done = h.p99(&["deploy", "--accept-plan", &hash]);
    done.ok();
    let later = since(&h, n);
    assert_eq!(inserted_in(&later), after(6));
    assert_eq!(applied(&cf), shipped());
    assert_eq!(uploads_in(&later).len(), 1);
    never_shows(&[&out, &done], &[]);
}

#[test]
fn us_migrate_002_the_plan_shows_each_hosts_project_each_codes_grant_and_the_counts_and_the_deploy_keeps_every_card()
 {
    let (h, cf) = spaces_home("us-migrate-spaces");
    refuses_and_changes_nothing(
        &h,
        &cf,
        &["deploy"],
        "0018_spaces.sql change this space's data",
    );

    let text = plan_writes_nothing(&h, &["--space", "main"]);
    for want in [
        "  pending: 0018_spaces.sql\n",
        "\nSpaces and projects (0018): the space main, shown as Example Co\n",
        "    Example site: dev.example.com, example.com; 5 items (2 open)\n",
        "    Licences: no host; 0 items (0 open)\n",
        "    Roadmap: no host; 3 items (3 open), 3 cards named it\n",
        "    example.com -> Example site\n",
        "    #1 Ada Lovelace <ada@example.com>, Owner: the whole space\n",
        "    #2 Grace Hopper <grace@example.com>: the project Example site, so it now also reaches dev.example.com\n",
        "\nCount check (0018)\n  before: 13 items (6 open), 4 comments, 20 events, 1 attachment, 3 codes\n",
        "  after:  13 items (6 open), 4 comments, 20 events, 1 attachment, 3 codes\n",
    ] {
        assert!(text.contains(want), "{want}\n{text}");
    }
    let hash = plan_hash(&text);
    let json = h
        .p99(&["migrate", "--plan", "--json", "--space", "main"])
        .json();
    assert_eq!(json["hash"], hash);
    let spaces = &json["plan"]["spaces"];
    let grants: Vec<Value> = spaces["codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["grant"].clone())
        .collect();
    assert_eq!(
        grants,
        [
            json!({ "space": true }),
            json!({ "projects": ["Example site"] }),
            json!({ "projects": ["shop.example.com"] })
        ]
    );
    for key in [
        "items",
        "open",
        "comments",
        "events",
        "attachments",
        "codes",
    ] {
        assert_eq!(
            spaces["counts"]["before"][key], spaces["counts"]["after"][key],
            "{key}"
        );
    }

    let n = cf_calls(&h).len();
    let done = h.p99(&["deploy", "--json", "--accept-plan", &hash]);
    done.ok();
    let report = done.json();
    assert_eq!(report["migrations"]["applied"], json!(["0018_spaces.sql"]));
    let later = since(&h, n);
    assert_eq!(inserted_in(&later), after(17));
    assert_eq!(applied(&cf), shipped());
    migrations_before_upload(&later);
    let sql = batch_with(&later, "0018_spaces.sql");
    for want in [
        "('project', 'Example site', NULL)",
        "('host', 'example.com', 'Example site')",
        "('host', 'dev.example.com', 'Example site')",
        r#"('grant', '1', '{"space":true}')"#,
        r#"('grant', '2', '{"projects":["Example site"]}')"#,
        r#"('grant', '3', '{"projects":["shop.example.com"]}')"#,
        "CONSTRAINT spaces_kept_items CHECK (items >= 0)",
    ] {
        assert!(sql.contains(want), "{want}\n{sql}");
    }
    let upload = uploads_in(&later).pop().unwrap();
    let sent = metadata(&upload.text());
    let bound = |name: &str| {
        sent["bindings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not bound"))["text"]
            .clone()
    };
    assert_eq!(bound("SPACE"), "main");
    assert_eq!(bound("SPACE_NAME"), "Example Co");

    let n = cf_calls(&h).len();
    h.p99(&["deploy", "--accept-plan", &hash]).ok();
    assert!(inserted_in(&since(&h, n)).is_empty());
    let settled = plan(&h, &["--space", "main"]);
    assert!(settled.contains("nothing to migrate"), "{settled}");
    never_shows(&[&done], &[]);
}

#[test]
fn us_migrate_002_an_archived_board_holding_something_unique_comes_up_as_a_decision_and_lands_on_the_board()
 {
    let mut rows = count_rows();
    rows.extend(v111_rows());
    rows.extend(v19_rows());
    let (h, cf) = spaced("us-migrate-archived", at(16, rows));

    let text = plan_writes_nothing(&h, &[]);
    for want in [
        "  pending: 0017_delete_archived.sql, 0018_spaces.sql\n",
        "\nDelete what the one board carries (0017)\n",
        "  deleted: 2 old boards (Web (ada@example.com), Ops), with their 7 columns and 4 card places\n",
        &format!(
            "  carried first: {:<20} 1 open -> in-progress; 1 closed -> done\n",
            "Triage"
        ),
        "  placed first: 1 item with a place only on an old board, after the lane's last card\n",
        "  - 2 items on the old label Triage are not on the one board: 0017 moves 1 open to In progress and 1 closed to Done, after the lane's last card in their old order, each with a migrated label event; move them yourself first to put them elsewhere\n",
        "  - 1 item has a place on an old board but none on the one board: 0017 places it after its lane's last card, in its old order\n",
        "  before: 5 items, 4 comments, 2 attachments, 9 events\n",
        "  after:  5 items, 4 comments, 2 attachments, 11 events\n",
        "  the events grow by the 2 migrated label events and by nothing else\n",
    ] {
        assert!(text.contains(want), "{want}\n{text}");
    }
    let hash = plan_hash(&text);

    let n = cf_calls(&h).len();
    let done = h.p99(&["deploy", "--accept-plan", &hash]);
    done.ok();
    let later = since(&h, n);
    assert_eq!(inserted_in(&later), after(16));
    assert_eq!(applied(&cf), shipped());
    let sql = batch_with(&later, "0017_delete_archived.sql");
    for want in [
        "CONSTRAINT count_check_items CHECK (items = 5)",
        "CONSTRAINT count_check_comments CHECK (comments = 4)",
        "CONSTRAINT count_check_events CHECK (events = 11)",
    ] {
        assert!(sql.contains(want), "{want}");
    }
    migrations_before_upload(&later);

    let n = cf_calls(&h).len();
    h.p99(&["deploy"]).ok();
    assert!(inserted_in(&since(&h, n)).is_empty());
    never_shows(&[&done], &[]);
}

#[test]
fn us_migrate_002_a_host_the_config_does_not_map_and_a_card_on_a_gone_host_are_named_as_decisions()
{
    let (h, cf) = spaces_home("us-migrate-unmapped");
    let text = plan_writes_nothing(&h, &["--space", "main"]);
    for want in [
        "    shop.example.com -> shop.example.com, a project of its own: [spaces.main.projects] doesn't list it\n",
        "  items on hosts the space no longer has:\n    old.example.com: 1 item -> no project\n",
        "  - the host shop.example.com isn't in [spaces.main.projects]: 0018 makes it a project of its own, called shop.example.com; list it there under another project to put it in that one\n",
        "  - BUG-9 is on old.example.com, which is no host of the space, and names no project: 0018 leaves it in no project; list old.example.com under a project in [spaces.main.projects] to give it one\n",
    ] {
        assert!(text.contains(want), "{want}\n{text}");
    }
    let json = h
        .p99(&["migrate", "--plan", "--json", "--space", "main"])
        .json();
    let spaces = &json["plan"]["spaces"];
    assert_eq!(json["plan"]["decisions"].as_array().unwrap().len(), 2);
    assert_eq!(
        spaces["without"],
        json!([{ "host": "old.example.com", "items": ["BUG-9"] }])
    );
    assert!(spaces["hosts"].as_array().unwrap().contains(
        &json!({ "host": "shop.example.com", "project": "shop.example.com", "mapped": false })
    ));
    assert_eq!(
        spaces["counts"]["before"]["items"],
        spaces["counts"]["after"]["items"]
    );

    let n = cf_calls(&h).len();
    h.p99(&["deploy", "--accept-plan", &plan_hash(&text)]).ok();
    let later = since(&h, n);
    assert_eq!(applied(&cf), shipped());
    let sql = batch_with(&later, "0018_spaces.sql");
    assert!(
        sql.contains("('project', 'shop.example.com', NULL)")
            && sql.contains("('host', 'shop.example.com', 'shop.example.com')"),
        "{sql}"
    );
    assert!(!sql.contains("old.example.com"), "{sql}");
}

#[test]
fn us_migrate_002_a_plan_whose_counts_change_before_the_deploy_refuses_and_says_what_ran() {
    let (h, cf) = spaces_home("us-migrate-counts-moved");
    let hash = plan_hash(&plan_writes_nothing(&h, &["--space", "main"]));
    {
        let mut state = cf.lock().unwrap();
        let counts = state
            .rows
            .iter_mut()
            .find(|(p, _)| *p == "AS codes, (SELECT count(*) FROM items)")
            .unwrap();
        counts.1 = json!([{ "codes": 3, "items": 14, "open": 7, "comments": 4, "events": 21, "attachments": 1 }]);
    }
    refuses_and_changes_nothing(&h, &cf, &["deploy", "--accept-plan", &hash], CHANGED);
    assert_eq!(applied(&cf), first(17));

    let mut rows = count_rows();
    rows.extend(v110_rows());
    rows.extend(v19_rows());
    let mut cloud = at(15, rows);
    cloud.fail = Some("0017_delete_archived.sql".into());
    cloud.fail_with = Some("CHECK constraint failed: count_check_events: SQLITE_CONSTRAINT");
    let (h, cf) = spaced("us-migrate-counts-inside", cloud);
    let text = plan_writes_nothing(&h, &[]);
    assert!(
        text.contains("  the deploy runs its migrations as one step and counts again inside 0017: if any count differs, every one of them rolls back, the database stays as it is, and the Worker is not uploaded\n"),
        "{text}"
    );
    let before = cf.lock().unwrap().state();
    let n = cf_calls(&h).len();
    let out = h.p99(&["deploy", "--accept-plan", &plan_hash(&text)]);
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert_eq!(
        out.stderr,
        "p99: the count check stopped 0017: the events no longer count 11 as the plan said, so every migration of this deploy rolled back: the database is as the deploy found it and the Worker is not uploaded; read `p99 migrate --plan` again\n"
    );
    assert!(!out.stdout.contains("applied 0016"), "{}", out.stdout);
    let later = since(&h, n);
    let sent: Vec<String> = later
        .iter()
        .filter_map(sql_of)
        .filter(|sql| !recorded(sql).is_empty())
        .collect();
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(recorded(&sent[0]), after(15));
    assert!(uploads_in(&later).is_empty());
    assert_eq!(applied(&cf), first(15));
    assert_eq!(cf.lock().unwrap().binding("VERSION")["text"], "1.9.0");
    {
        let state = cf.lock().unwrap();
        assert_eq!(state.state(), before);
        assert_eq!(state.binding("DB")["database_id"], "db1");
        assert_eq!(state.binding("BUCKET")["bucket_name"], "p99");
        assert!(state.worker);
    }
    never_shows(&[&out], &[]);
}

#[test]
fn us_migrate_002_a_parked_code_gets_no_grant_and_nobody_is_mailed() {
    let (h, cf) = spaces_home("us-migrate-park");
    let hash = plan_hash(&plan_writes_nothing(&h, &["--space", "main"]));

    refuses_and_changes_nothing(
        &h,
        &cf,
        &[
            "deploy",
            "--accept-plan",
            &hash,
            "--park",
            "2",
            "--park",
            "7",
        ],
        "--park 7: no code with that id in this space; `p99 migrate --plan` lists every code with its id",
    );
    assert_eq!(applied(&cf), first(17));

    let n = cf_calls(&h).len();
    let done = h.p99(&[
        "deploy",
        "--json",
        "--accept-plan",
        &hash,
        "--park",
        "2",
        "--park",
        "3",
    ]);
    done.ok();
    assert_eq!(done.json()["migrations"]["parked"], json!([2, 3]));
    assert!(
        done.stderr.contains(
            "  ok  parked #2, #3: no grant, nothing opens for them, and nobody was mailed\n"
        ),
        "{}",
        done.stderr
    );
    let later = since(&h, n);
    let sql = batch_with(&later, "0018_spaces.sql");
    for want in [
        r#"('grant', '1', '{"space":true}')"#,
        r#"('grant', '2', '{"projects":[]}')"#,
        r#"('grant', '3', '{"projects":[]}')"#,
    ] {
        assert!(sql.contains(want), "{want}\n{sql}");
    }
    assert!(
        later
            .iter()
            .filter_map(sql_of)
            .all(|s| !s.contains("INTO mail") && !s.contains("mail_optouts")),
        "a parked code was mailed"
    );
    assert!(h.stub.under("POST", "/resend/").is_empty());
    assert!(cf.lock().unwrap().mail.is_none());
    assert_eq!(applied(&cf), shipped());
    never_shows(&[&done], &[]);
}

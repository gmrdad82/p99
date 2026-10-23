use clap::ValueEnum;
use serde_json::{Value, json};

use crate::card::Lane;
use crate::cloudflare::Cloudflare;
use crate::config::Account;
use crate::fold::{count, many, select, text};

pub const Q_TOTALS: &str = include_str!("counts/totals.sql");

pub const Q_LABELS: &str = include_str!("counts/labels.sql");

pub const Q_FOLD: &str = include_str!("counts/fold.sql");

pub const Q_PRUNE: &str = include_str!("counts/prune.sql");

const KEPT: [&str; 3] = ["items", "comments", "attachments"];

const GUARD: &str = "count_check";

pub fn plan(
    cf: &Cloudflare,
    account: &Account,
    carded: bool,
    plan: &mut Value,
) -> Result<(), String> {
    let pending = |step: &str| {
        plan["pending"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .any(|p| p.starts_with(step))
    };
    if !pending("0017") {
        return Ok(());
    }
    let totals = select(cf, account, Q_TOTALS)?
        .first()
        .cloned()
        .unwrap_or(Value::Null);
    let readable = crate::fold::earlier(plan).is_empty();
    let (labels, lanes) = if readable {
        let lanes = if pending("0016") {
            if carded {
                select(cf, account, Q_FOLD)?
            } else {
                select(cf, account, &Q_FOLD.replace("b.cards", "0"))?
            }
        } else {
            select(cf, account, Q_PRUNE)?
        };
        (Some(select(cf, account, Q_LABELS)?), Some(lanes))
    } else {
        (None, None)
    };
    plan["count_check"] = shape(&totals, labels.as_deref(), lanes.as_deref());
    Ok(())
}

pub fn shape(totals: &Value, labels: Option<&[Value]>, lanes: Option<&[Value]>) -> Value {
    let mut before = json!({});
    for key in KEPT.iter().chain(["events"].iter()) {
        before[*key] = json!(count(totals, key));
    }
    let mut after = json!({});
    for key in KEPT {
        after[key] = json!(count(totals, key));
    }
    if let Some(labels) = labels {
        before["labels"] = labels
            .iter()
            .map(|r| json!({"label": text(r, "label"), "items": count(r, "items")}))
            .collect();
    }
    if let Some(lanes) = lanes {
        let moved: i64 = lanes.iter().map(|r| count(r, "moved")).sum();
        after["events"] = json!(count(totals, "events") + moved);
        after["lanes"] = Lane::value_variants()
            .iter()
            .enumerate()
            .map(|(at, lane)| {
                let items = lanes
                    .iter()
                    .find(|r| count(r, "lane") == at as i64)
                    .map_or(0, |r| count(r, "items"));
                json!({"lane": lane.name(), "items": items})
            })
            .collect();
    }
    json!({"before": before, "after": after})
}

fn totals_line(side: &Value) -> String {
    let mut said = vec![
        many(count(side, "items"), "item", "items"),
        many(count(side, "comments"), "comment", "comments"),
        many(count(side, "attachments"), "attachment", "attachments"),
    ];
    if side.get("events").is_some() {
        said.push(many(count(side, "events"), "event", "events"));
    }
    said.join(", ")
}

fn per(rows: &Value, key: &str) -> String {
    let said: Vec<String> = rows
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| count(r, "items") > 0)
        .map(|r| format!("{} {}", text(r, key), count(r, "items")))
        .collect();
    if said.is_empty() {
        "none".to_owned()
    } else {
        said.join(", ")
    }
}

pub fn render(out: &mut String, plan: &Value) {
    let Some(check) = plan.get("count_check") else {
        return;
    };
    let (before, after) = (&check["before"], &check["after"]);
    out.push_str("\nCount check\n");
    out.push_str(&format!("  before: {}\n", totals_line(before)));
    if let Some(labels) = before.get("labels") {
        out.push_str(&format!("  before, by label: {}\n", per(labels, "label")));
    }
    out.push_str(&format!("  after:  {}\n", totals_line(after)));
    match after.get("lanes") {
        Some(lanes) => {
            out.push_str(&format!("  after, by lane: {}\n", per(lanes, "lane")));
            let moved = count(after, "events") - count(before, "events");
            out.push_str(&format!(
                "  the events grow by the {} migrated label {} and by nothing else\n",
                moved,
                if moved == 1 { "event" } else { "events" }
            ));
        }
        None => out.push_str(
            "  events and lanes can't be counted until the steps before 0016 have run, so the deploy checks the items, comments and attachments\n",
        ),
    }
    out.push_str("  the deploy counts again inside 0017: if any count differs, 0017 rolls back, nothing is deleted, and the Worker is not uploaded\n");
}

fn checks(plan: &Value) -> Vec<(String, i64, String)> {
    let Some(after) = plan.get("count_check").map(|c| &c["after"]) else {
        return Vec::new();
    };
    let mut out: Vec<(String, i64, String)> = KEPT
        .iter()
        .map(|key| {
            (
                (*key).to_owned(),
                count(after, key),
                format!("(SELECT count(*) FROM {key})"),
            )
        })
        .collect();
    if after.get("events").is_some() {
        out.push((
            "events".to_owned(),
            count(after, "events"),
            "(SELECT count(*) FROM events)".to_owned(),
        ));
    }
    for (at, row) in after["lanes"].as_array().into_iter().flatten().enumerate() {
        out.push((
            format!("lane_{at}"),
            count(row, "items"),
            format!(
                "(SELECT count(*) FROM items i JOIN board_columns bc ON bc.label_id = i.label_id JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1 AND (SELECT count(*) FROM board_columns o JOIN boards ob ON ob.id = o.board_id WHERE ob.cards = 1 AND o.position < bc.position) = {at})"
            ),
        ));
    }
    out
}

pub fn guard(plan: &Value) -> Option<String> {
    let checks = checks(plan);
    if checks.is_empty() {
        return None;
    }
    let columns: Vec<String> = checks
        .iter()
        .map(|(name, want, _)| {
            format!("  {name} INTEGER CONSTRAINT {GUARD}_{name} CHECK ({name} = {want})")
        })
        .collect();
    let reads: Vec<&str> = checks.iter().map(|(_, _, read)| read.as_str()).collect();
    Some(format!(
        "DROP TABLE IF EXISTS {GUARD};\nCREATE TABLE {GUARD} (\n{}\n);\nINSERT INTO {GUARD} SELECT {};\nDROP TABLE {GUARD};",
        columns.join(",\n"),
        reads.join(", ")
    ))
}

pub fn refusal(plan: &Value, message: &str) -> Option<String> {
    let at = message.find(&format!("CHECK constraint failed: {GUARD}_"))?;
    let name: String = message[at + "CHECK constraint failed: ".len() + GUARD.len() + 1..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    let (_, want, _) = checks(plan).into_iter().find(|(n, _, _)| *n == name)?;
    let what = match name.strip_prefix("lane_") {
        Some(at) => format!(
            "the items in {}",
            at.parse::<usize>()
                .ok()
                .and_then(|i| Lane::value_variants().get(i))
                .map_or(at, |l| l.name())
        ),
        None => format!("the {name}"),
    };
    Some(format!(
        "the count check stopped 0017: {what} no longer count {want} as the plan said, so 0017 rolled back: nothing is deleted and the Worker is not uploaded; read `p99 migrate --plan` again"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane(at: i64, items: i64, moved: i64) -> Value {
        json!({"lane": at, "items": items, "moved": moved})
    }

    fn webram() -> Value {
        let totals = json!({"items": 70, "comments": 140, "attachments": 35, "events": 210});
        let labels = [
            json!({"label": "Doing", "items": 1}),
            json!({"label": "Inbox", "items": 69}),
        ];
        let lanes = [lane(0, 69, 69), lane(2, 1, 1)];
        json!({"pending": ["0016_one_board.sql", "0017_delete_archived.sql"], "count_check": shape(&totals, Some(&labels), Some(&lanes))})
    }

    fn rendered(plan: &Value) -> String {
        let mut out = String::new();
        render(&mut out, plan);
        out
    }

    #[test]
    fn every_query_only_reads_one_select() {
        for sql in [Q_TOTALS, Q_LABELS, Q_FOLD, Q_PRUNE] {
            assert!(sql.starts_with("SELECT "), "{sql}");
            assert!(!sql.contains(';'), "{sql}");
            for word in ["UPDATE ", "INSERT ", "DELETE ", "DROP ", "CREATE "] {
                assert!(!sql.contains(word), "{sql}");
            }
        }
        let uncarded = Q_FOLD.replace("b.cards", "0");
        assert!(!uncarded.contains(".cards"), "{uncarded}");
        assert!(uncarded.starts_with("SELECT ") && !uncarded.contains(';'));
    }

    #[test]
    fn the_plan_refuses_anything_but_one_select_before_it_reaches_cloudflare() {
        let cf = Cloudflare::at("t", "http://127.0.0.1:9");
        let account = Account::default();
        for sql in [Q_TOTALS, Q_LABELS, Q_FOLD, Q_PRUNE] {
            let asked = select(&cf, &account, sql).expect_err("nothing answers on port 9");
            assert_ne!(asked, "the plan only reads, one SELECT at a time", "{sql}");
        }
        let mut quiet = json!({"pending": ["0012_people.sql"]});
        plan(&cf, &account, true, &mut quiet).expect("no 0017, nothing read");
        assert!(quiet.get("count_check").is_none());
        let mut asked = json!({"pending": ["0017_delete_archived.sql"]});
        assert!(plan(&cf, &account, true, &mut asked).is_err());
    }

    #[test]
    fn the_counts_after_keep_the_thread_and_add_one_event_per_moved_item() {
        let plan = webram();
        let check = &plan["count_check"];
        assert_eq!(
            check["before"],
            json!({"items": 70, "comments": 140, "attachments": 35, "events": 210, "labels": [{"label": "Doing", "items": 1}, {"label": "Inbox", "items": 69}]})
        );
        assert_eq!(check["after"]["events"], 280);
        assert_eq!(check["after"]["items"], 70);
        let lanes: Vec<(&str, i64)> = check["after"]["lanes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["lane"].as_str().unwrap(), r["items"].as_i64().unwrap()))
            .collect();
        assert_eq!(
            lanes,
            [
                ("New", 69),
                ("Planned", 0),
                ("In progress", 1),
                ("Needs you", 0),
                ("Stuck", 0),
                ("Landed", 0),
                ("Done", 0)
            ]
        );
    }

    #[test]
    fn the_render_prints_the_counts_before_and_after() {
        let out = rendered(&webram());
        assert_eq!(
            out,
            "\nCount check\n  before: 70 items, 140 comments, 35 attachments, 210 events\n  before, by label: Doing 1, Inbox 69\n  after:  70 items, 140 comments, 35 attachments, 280 events\n  after, by lane: New 69, In progress 1\n  the events grow by the 70 migrated label events and by nothing else\n  the deploy counts again inside 0017: if any count differs, 0017 rolls back, nothing is deleted, and the Worker is not uploaded\n"
        );
        let one = json!({"count_check": shape(&json!({"items": 1, "comments": 1, "attachments": 1, "events": 1}), Some(&[]), Some(&[lane(6, 1, 1)]))});
        let out = rendered(&one);
        assert!(
            out.contains("  before: 1 item, 1 comment, 1 attachment, 1 event\n"),
            "{out}"
        );
        assert!(out.contains("  before, by label: none\n"), "{out}");
        assert!(out.contains("  after, by lane: Done 1\n"), "{out}");
        assert!(
            out.contains("grow by the 1 migrated label event and"),
            "{out}"
        );
        assert!(rendered(&json!({"pending": []})).is_empty());
    }

    #[test]
    fn before_the_lanes_exist_only_the_thread_is_counted_and_said_so() {
        let early = json!({"count_check": shape(&json!({"items": 9, "comments": 2, "attachments": 0, "events": 6}), None, None)});
        let out = rendered(&early);
        assert!(
            out.contains("  after:  9 items, 2 comments, 0 attachments\n"),
            "{out}"
        );
        assert!(out.contains("  events and lanes can't be counted until the steps before 0016 have run, so the deploy checks the items, comments and attachments\n"), "{out}");
        assert!(!out.contains("by label"), "{out}");
        let sql = guard(&early).unwrap();
        assert!(sql.contains("items INTEGER CONSTRAINT count_check_items CHECK (items = 9)"));
        assert!(
            sql.contains("comments INTEGER CONSTRAINT count_check_comments CHECK (comments = 2)")
        );
        assert!(!sql.contains("events"), "{sql}");
        assert!(!sql.contains("lane_"), "{sql}");
    }

    #[test]
    fn the_guard_checks_every_count_and_lane_in_one_insert_and_leaves_no_table() {
        let sql = guard(&webram()).unwrap();
        assert!(sql.starts_with("DROP TABLE IF EXISTS count_check;\nCREATE TABLE count_check (\n"));
        assert!(sql.ends_with(";\nDROP TABLE count_check;"));
        for want in [
            "items INTEGER CONSTRAINT count_check_items CHECK (items = 70)",
            "comments INTEGER CONSTRAINT count_check_comments CHECK (comments = 140)",
            "attachments INTEGER CONSTRAINT count_check_attachments CHECK (attachments = 35)",
            "events INTEGER CONSTRAINT count_check_events CHECK (events = 280)",
            "lane_0 INTEGER CONSTRAINT count_check_lane_0 CHECK (lane_0 = 69)",
            "lane_2 INTEGER CONSTRAINT count_check_lane_2 CHECK (lane_2 = 1)",
            "lane_6 INTEGER CONSTRAINT count_check_lane_6 CHECK (lane_6 = 0)",
        ] {
            assert!(sql.contains(want), "{want}\n{sql}");
        }
        assert_eq!(sql.matches("INSERT INTO count_check SELECT ").count(), 1);
        assert_eq!(sql.matches(") = 6)").count(), 1);
        assert_eq!(
            guard(&json!({"pending": ["0017_delete_archived.sql"]})),
            None
        );
    }

    #[test]
    fn a_failed_count_names_what_differs_and_that_nothing_is_deleted() {
        let plan = webram();
        assert_eq!(
            refusal(
                &plan,
                "CHECK constraint failed: count_check_comments: SQLITE_CONSTRAINT"
            )
            .unwrap(),
            "the count check stopped 0017: the comments no longer count 140 as the plan said, so 0017 rolled back: nothing is deleted and the Worker is not uploaded; read `p99 migrate --plan` again"
        );
        assert!(
            refusal(&plan, "CHECK constraint failed: count_check_lane_0")
                .unwrap()
                .starts_with(
                    "the count check stopped 0017: the items in New no longer count 69 as"
                )
        );
        assert!(
            refusal(
                &plan,
                "D1: CHECK constraint failed: count_check_events: SQLITE_ERROR"
            )
            .unwrap()
            .contains("the events no longer count 280")
        );
        assert_eq!(refusal(&plan, "CHECK constraint failed: lanes = 7"), None);
        assert_eq!(
            refusal(&plan, "CHECK constraint failed: count_check_nothing"),
            None
        );
        assert_eq!(
            refusal(&json!({}), "CHECK constraint failed: count_check_items"),
            None
        );
        assert_eq!(refusal(&plan, "network is unreachable"), None);
    }
}

use clap::ValueEnum;
use serde_json::{Value, json};

use crate::card::Lane;
use crate::cloudflare::Cloudflare;
use crate::config::Account;

pub const Q_LANES: &str = include_str!("prune/lanes.sql");

pub const Q_BOARDS: &str = include_str!("prune/boards.sql");

pub const Q_LABELS: &str = include_str!("prune/labels.sql");

pub const Q_ORDERS: &str = include_str!("prune/orders.sql");

pub const Q_TAGS: &str = include_str!("prune/tags.sql");

const STEP: &str = "0017";

fn seven() -> i64 {
    Lane::value_variants().len() as i64
}

fn select(cf: &Cloudflare, account: &Account, sql: &str) -> Result<Vec<Value>, String> {
    if !sql.starts_with("SELECT ") || sql.contains(';') {
        return Err("the plan only reads, one SELECT at a time".into());
    }
    Ok(cf.query(&account.account_id, &account.database_id, sql, &[])?)
}

fn text(row: &Value, key: &str) -> String {
    row[key].as_str().unwrap_or_default().to_owned()
}

fn count(row: &Value, key: &str) -> i64 {
    row[key]
        .as_i64()
        .or_else(|| row[key].as_f64().map(|f| f as i64))
        .unwrap_or(0)
}

fn many(n: i64, one: &str, more: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { more })
}

fn first(cf: &Cloudflare, account: &Account, sql: &str, key: &str) -> Result<i64, String> {
    Ok(select(cf, account, sql)?
        .first()
        .map_or(0, |r| count(r, key)))
}

pub fn earlier(plan: &Value) -> Vec<String> {
    plan["pending"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|p| *p < STEP)
        .map(str::to_owned)
        .collect()
}

pub fn shape(
    lanes: i64,
    boards: &[Value],
    labels: &[Value],
    orders: i64,
    tags: i64,
) -> (Value, Vec<String>) {
    let mut decisions = Vec::new();
    let ready = lanes == seven();
    if !ready {
        decisions.push(format!(
            "the Cards board has {} lanes, not seven, so 0017 can't tell where an old board's cards belong: it deletes no board and no label, and only the old tags go",
            lanes
        ));
    }
    let mut rows = Vec::new();
    for row in labels {
        let items = count(row, "items");
        let open = count(row, "open");
        if ready && items > 0 {
            let mut moves = Vec::new();
            if open > 0 {
                moves.push(format!("{open} open to {}", Lane::InProgress.name()));
            }
            if items > open {
                moves.push(format!("{} closed to {}", items - open, Lane::Done.name()));
            }
            let (them, their) = if items == 1 { ("it", "its") } else { ("them", "their") };
            decisions.push(format!(
                "{} on the old label {} {} not on the one board: 0017 moves {}, after the lane's last card in {their} old order, each with a migrated label event; move {them} yourself first to put {them} elsewhere",
                many(items, "item", "items"),
                text(row, "label"),
                if items == 1 { "is" } else { "are" },
                moves.join(" and "),
            ));
        }
        rows.push(json!({
            "label": text(row, "label"),
            "items": items,
            "open": open,
            "closed": items - open,
        }));
    }
    if ready && orders > 0 {
        decisions.push(format!(
            "{} {} a place on an old board but none on the one board: 0017 places {} after {} lane's last card, in {} old order",
            many(orders, "item", "items"),
            if orders == 1 { "has" } else { "have" },
            if orders == 1 { "it" } else { "them" },
            if orders == 1 { "its" } else { "their" },
            if orders == 1 { "its" } else { "their" },
        ));
    }
    let boards: Vec<Value> = boards
        .iter()
        .map(|b| {
            json!({
                "id": count(b, "id"),
                "name": text(b, "name"),
                "owner": b["owner"].as_str(),
                "columns": count(b, "columns"),
                "places": count(b, "places"),
            })
        })
        .collect();
    (
        json!({
            "lanes": lanes,
            "boards": boards,
            "labels": rows,
            "orders": orders,
            "tags": tags,
        }),
        decisions,
    )
}

pub fn plan(
    cf: &Cloudflare,
    account: &Account,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let before = earlier(plan);
    if !before.is_empty() {
        plan["delete_archived"] = json!({ "after": before });
        return Ok(());
    }
    let lanes = first(cf, account, Q_LANES, "lanes")?;
    let boards = select(cf, account, Q_BOARDS)?;
    let labels = select(cf, account, Q_LABELS)?;
    let orders = first(cf, account, Q_ORDERS, "unplaced")?;
    let tags = first(cf, account, Q_TAGS, "tags")?;
    let (prune, said) = shape(lanes, &boards, &labels, orders, tags);
    plan["delete_archived"] = prune;
    decisions.extend(said);
    Ok(())
}

fn board_name(row: &Value) -> String {
    match row["owner"].as_str() {
        Some(owner) => format!("{} ({owner})", text(row, "name")),
        None => text(row, "name"),
    }
}

pub fn render(out: &mut String, plan: &Value) {
    let Some(prune) = plan.get("delete_archived") else {
        return;
    };
    out.push_str("\nDelete what the one board carries (0017)\n");
    if let Some(after) = prune["after"].as_array() {
        let names: Vec<&str> = after.iter().filter_map(Value::as_str).collect();
        out.push_str(&format!(
            "  runs after {}: once every item is on a lane, the old boards with their columns and places, every label that isn't a lane, and the old tags (item_labels rows nothing reads) are deleted; nothing is archived, and each item's history stays\n",
            names.join(", ")
        ));
        return;
    }
    let ready = count(prune, "lanes") == seven();
    let boards = prune["boards"].as_array().cloned().unwrap_or_default();
    let labels = prune["labels"].as_array().cloned().unwrap_or_default();
    if ready {
        let names: Vec<String> = boards.iter().map(board_name).collect();
        let columns: i64 = boards.iter().map(|b| count(b, "columns")).sum();
        let places: i64 = boards.iter().map(|b| count(b, "places")).sum();
        out.push_str(&format!(
            "  deleted: {}{}\n",
            many(names.len() as i64, "old board", "old boards"),
            if names.is_empty() {
                String::new()
            } else {
                format!(
                    " ({}), with their {} and {}",
                    names.join(", "),
                    many(columns, "column", "columns"),
                    many(places, "card place", "card places")
                )
            }
        ));
        for row in labels.iter().filter(|r| count(r, "items") > 0) {
            let mut said = Vec::new();
            if count(row, "open") > 0 {
                said.push(format!(
                    "{} open -> {}",
                    count(row, "open"),
                    Lane::InProgress.word()
                ));
            }
            if count(row, "closed") > 0 {
                said.push(format!(
                    "{} closed -> {}",
                    count(row, "closed"),
                    Lane::Done.word()
                ));
            }
            out.push_str(&format!(
                "  carried first: {:<20} {}\n",
                text(row, "label"),
                said.join("; ")
            ));
        }
        let names: Vec<String> = labels.iter().map(|r| text(r, "label")).collect();
        out.push_str(&format!(
            "  deleted labels: {}\n",
            if names.is_empty() {
                "none".to_owned()
            } else {
                names.join(", ")
            }
        ));
        let orders = count(prune, "orders");
        if orders > 0 {
            out.push_str(&format!(
                "  placed first: {} with a place only on an old board, after the lane's last card\n",
                many(orders, "item", "items")
            ));
        }
    } else {
        out.push_str(&format!(
            "  kept: the Cards board has {} lanes, not seven, so no board and no label is deleted\n",
            count(prune, "lanes")
        ));
    }
    out.push_str(&format!(
        "  deleted old tags: {} (item_labels rows nothing reads)\n",
        count(prune, "tags")
    ));
    out.push_str("  the archive table goes; each item's history stays\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(id: i64, name: &str, owner: Option<&str>, columns: i64, places: i64) -> Value {
        json!({"id": id, "name": name, "owner": owner, "columns": columns, "places": places})
    }

    fn label(name: &str, items: i64, open: i64) -> Value {
        json!({"label": name, "items": items, "open": open})
    }

    fn rendered(prune: Value) -> String {
        let mut out = String::new();
        render(&mut out, &json!({"delete_archived": prune}));
        out
    }

    #[test]
    fn the_plan_refuses_anything_but_one_select_before_it_reaches_cloudflare() {
        let cf = Cloudflare::at("t", "http://127.0.0.1:9");
        let account = Account::default();
        for sql in [
            "DELETE FROM boards",
            "DROP TABLE archived",
            "SELECT 1; DELETE FROM labels",
            "",
        ] {
            assert_eq!(
                select(&cf, &account, sql),
                Err("the plan only reads, one SELECT at a time".to_owned()),
                "{sql:?}"
            );
        }
        for sql in [Q_LANES, Q_BOARDS, Q_LABELS, Q_ORDERS, Q_TAGS] {
            let asked = select(&cf, &account, sql).expect_err("nothing answers on port 9");
            assert_ne!(asked, "the plan only reads, one SELECT at a time", "{sql}");
        }
    }

    #[test]
    fn every_query_only_reads() {
        for sql in [Q_LANES, Q_BOARDS, Q_LABELS, Q_ORDERS, Q_TAGS] {
            assert!(sql.starts_with("SELECT "), "{sql}");
            assert!(!sql.contains(';'), "{sql}");
            for word in ["UPDATE ", "INSERT ", "DELETE ", "DROP ", "CREATE "] {
                assert!(!sql.contains(word), "{sql}");
            }
        }
    }

    #[test]
    fn only_gated_steps_before_0017_put_the_delete_after_them() {
        let plan = json!({"pending": ["0013_app.sql", "0016_one_board.sql", "0017_delete_archived.sql"]});
        assert_eq!(earlier(&plan), ["0013_app.sql", "0016_one_board.sql"]);
        assert!(earlier(&json!({"pending": ["0017_delete_archived.sql"]})).is_empty());
        assert!(earlier(&json!({})).is_empty());
    }

    #[test]
    fn boards_and_labels_with_nothing_unique_are_deleted_with_no_decision() {
        let (prune, decisions) = shape(
            7,
            &[
                board(2, "Web", Some("ada@example.com"), 4, 3),
                board(3, "Ops", None, 3, 0),
            ],
            &[label("Doing", 0, 0), label("Inbox", 0, 0)],
            0,
            5,
        );
        assert!(decisions.is_empty(), "{decisions:?}");
        assert_eq!(prune["boards"][0]["places"], 3);
        assert_eq!(prune["boards"][1]["owner"], Value::Null);
        assert_eq!(prune["tags"], 5);
        let out = rendered(prune);
        assert!(
            out.starts_with("\nDelete what the one board carries (0017)\n"),
            "{out}"
        );
        assert!(out.contains("  deleted: 2 old boards (Web (ada@example.com), Ops), with their 7 columns and 3 card places\n"), "{out}");
        assert!(out.contains("  deleted labels: Doing, Inbox\n"), "{out}");
        assert!(!out.contains("carried first"), "{out}");
        assert!(!out.contains("placed first"), "{out}");
        assert!(
            out.contains("  deleted old tags: 5 (item_labels rows nothing reads)\n"),
            "{out}"
        );
        assert!(
            out.contains("  the archive table goes; each item's history stays\n"),
            "{out}"
        );
        assert!(!out.contains("archived,"), "{out}");
    }

    #[test]
    fn an_item_left_on_an_old_label_is_a_decision_and_is_carried_onto_its_lane() {
        let (prune, decisions) = shape(
            7,
            &[board(2, "Web", Some("ada@example.com"), 4, 3)],
            &[label("Triage", 3, 1), label("Review", 0, 0)],
            0,
            0,
        );
        assert_eq!(
            decisions,
            [
                "3 items on the old label Triage are not on the one board: 0017 moves 1 open to In progress and 2 closed to Done, after the lane's last card in their old order, each with a migrated label event; move them yourself first to put them elsewhere"
            ]
        );
        assert_eq!(prune["labels"][0]["closed"], 2);
        let out = rendered(prune);
        assert!(
            out.contains(&format!(
                "  carried first: {:<20} 1 open -> in-progress; 2 closed -> done\n",
                "Triage"
            )),
            "{out}"
        );
        assert!(out.contains("  deleted labels: Triage, Review\n"), "{out}");
    }

    #[test]
    fn one_item_reads_in_the_singular() {
        let (_, decisions) = shape(7, &[], &[label("Triage", 1, 1)], 1, 0);
        assert_eq!(
            decisions,
            [
                "1 item on the old label Triage is not on the one board: 0017 moves 1 open to In progress, after the lane's last card in its old order, each with a migrated label event; move it yourself first to put it elsewhere",
                "1 item has a place on an old board but none on the one board: 0017 places it after its lane's last card, in its old order",
            ]
        );
    }

    #[test]
    fn an_order_only_an_old_board_holds_is_a_decision_and_kept() {
        let (prune, decisions) = shape(7, &[board(2, "Web", None, 4, 2)], &[], 2, 0);
        assert_eq!(
            decisions,
            [
                "2 items have a place on an old board but none on the one board: 0017 places them after their lane's last card, in their old order"
            ]
        );
        let out = rendered(prune);
        assert!(out.contains("  placed first: 2 items with a place only on an old board, after the lane's last card\n"), "{out}");
    }

    #[test]
    fn a_cards_board_without_seven_lanes_keeps_everything_but_the_old_tags_and_says_so() {
        let (prune, decisions) = shape(
            6,
            &[board(2, "Web", None, 4, 2)],
            &[label("Triage", 2, 2)],
            3,
            4,
        );
        assert_eq!(
            decisions,
            [
                "the Cards board has 6 lanes, not seven, so 0017 can't tell where an old board's cards belong: it deletes no board and no label, and only the old tags go"
            ]
        );
        let out = rendered(prune);
        assert!(
            out.contains("  kept: the Cards board has 6 lanes, not seven, so no board and no label is deleted\n"),
            "{out}"
        );
        assert!(!out.contains("  deleted: "), "{out}");
        assert!(!out.contains("deleted labels"), "{out}");
        assert!(out.contains("  deleted old tags: 4"), "{out}");
    }

    #[test]
    fn an_account_with_nothing_old_says_so() {
        let (prune, decisions) = shape(7, &[], &[], 0, 0);
        assert!(decisions.is_empty());
        let out = rendered(prune);
        assert!(out.contains("  deleted: 0 old boards\n"), "{out}");
        assert!(out.contains("  deleted labels: none\n"), "{out}");
        assert!(out.contains("  deleted old tags: 0"), "{out}");
    }

    #[test]
    fn after_earlier_steps_the_plan_says_what_goes_once_they_have_run() {
        let out = rendered(json!({"after": ["0016_one_board.sql"]}));
        assert_eq!(
            out,
            "\nDelete what the one board carries (0017)\n  runs after 0016_one_board.sql: once every item is on a lane, the old boards with their columns and places, every label that isn't a lane, and the old tags (item_labels rows nothing reads) are deleted; nothing is archived, and each item's history stays\n"
        );
        let mut nothing = String::new();
        render(&mut nothing, &json!({"pending": []}));
        assert!(nothing.is_empty());
    }
}

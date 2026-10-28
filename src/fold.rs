use clap::ValueEnum;
use serde_json::{Value, json};

use crate::card::Lane;
use crate::cloudflare::Cloudflare;
use crate::config::Account;

pub const Q_BOARDS: &str = include_str!("fold/boards.sql");

pub const Q_LABELS: &str = include_str!("fold/labels.sql");

pub const Q_UNPLACED: &str = include_str!("fold/unplaced.sql");

pub(crate) fn select(cf: &Cloudflare, account: &Account, sql: &str) -> Result<Vec<Value>, String> {
    if !sql.starts_with("SELECT ") || sql.contains(';') {
        return Err("the plan only reads, one SELECT at a time".into());
    }
    Ok(cf.query(&account.account_id, &account.database_id, sql, &[])?)
}

pub(crate) fn text(row: &Value, key: &str) -> String {
    row[key].as_str().unwrap_or_default().to_owned()
}

pub(crate) fn count(row: &Value, key: &str) -> i64 {
    row[key]
        .as_i64()
        .or_else(|| row[key].as_f64().map(|f| f as i64))
        .unwrap_or(0)
}

pub(crate) fn many(n: i64, one: &str, more: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { more })
}

pub fn lane_of(role: Option<&str>) -> Lane {
    match role {
        Some("inbox") => Lane::New,
        Some("review") => Lane::Landed,
        _ => Lane::InProgress,
    }
}

pub fn cards_board(columns: Option<i64>, needs: bool) -> &'static str {
    match columns {
        None => "make",
        Some(0) => "fill",
        Some(6) if !needs => "insert",
        Some(7) => "keep",
        Some(_) => "reset",
    }
}

pub fn earlier(plan: &Value) -> Vec<String> {
    before(plan, "0016")
}

pub(crate) fn before(plan: &Value, step: &str) -> Vec<String> {
    plan["pending"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|p| *p < step)
        .map(str::to_owned)
        .collect()
}

pub fn shape(boards: &[Value], labels: &[Value], unplaced: i64) -> (Value, Vec<String>) {
    let mut decisions = Vec::new();
    let cards = boards.iter().find(|b| count(b, "cards") == 1);
    let step = cards_board(
        cards.map(|b| count(b, "columns")),
        cards.is_some_and(|b| count(b, "needs") > 0),
    );
    let mut rows = Vec::new();
    for row in labels {
        let items = count(row, "items");
        let open = count(row, "open");
        let to = lane_of(row["role"].as_str());
        if open > 0 && count(row, "closes") == 1 {
            decisions.push(format!(
                "{} on the closing column {} {} open: 0016 puts {} in {}, never in Done; close {} first if {} finished",
                many(open, "item", "items"),
                text(row, "label"),
                if open == 1 { "is" } else { "are" },
                if open == 1 { "it" } else { "them" },
                to.name(),
                if open == 1 { "it" } else { "them" },
                if open == 1 { "it is" } else { "they are" }
            ));
        }
        rows.push(json!({
            "label": text(row, "label"),
            "items": items,
            "open": open,
            "closed": items - open,
            "to": to.word(),
        }));
    }
    let boards: Vec<Value> = boards
        .iter()
        .map(|b| {
            json!({
                "id": count(b, "id"),
                "name": text(b, "name"),
                "owner": b["owner"].as_str(),
                "columns": count(b, "columns"),
                "placed": count(b, "placed"),
                "deleted": count(b, "cards") != 1,
            })
        })
        .collect();
    (
        json!({
            "cards_board": step,
            "labels": rows,
            "boards": boards,
            "unplaced": unplaced,
        }),
        decisions,
    )
}

fn uncarded(sql: &str) -> String {
    sql.replace("b.cards", "0").replace("f.cards", "0")
}

pub fn plan(
    cf: &Cloudflare,
    account: &Account,
    carded: bool,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let before = earlier(plan);
    if !before.is_empty() {
        plan["one_board"] = json!({ "after": before });
        return Ok(());
    }
    let read = |sql: &str| {
        if carded {
            select(cf, account, sql)
        } else {
            select(cf, account, &uncarded(sql))
        }
    };
    let boards = read(Q_BOARDS)?;
    let labels = read(Q_LABELS)?;
    let unplaced = select(cf, account, Q_UNPLACED)?
        .first()
        .map_or(0, |r| count(r, "items"));
    let (fold, said) = shape(&boards, &labels, unplaced);
    plan["one_board"] = fold;
    decisions.extend(said);
    Ok(())
}

fn lanes_line() -> String {
    Lane::value_variants()
        .iter()
        .map(|l| l.name())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn board_name(row: &Value) -> String {
    match row["owner"].as_str() {
        Some(owner) => format!("{} ({owner})", text(row, "name")),
        None => text(row, "name"),
    }
}

pub fn render(out: &mut String, plan: &Value) {
    let Some(fold) = plan.get("one_board") else {
        return;
    };
    out.push_str("\nOne board per account (0016)\n");
    if let Some(after) = fold["after"].as_array() {
        let names: Vec<&str> = after.iter().filter_map(Value::as_str).collect();
        out.push_str(&format!(
            "  runs after {}: every board folds into the Cards board's seven lanes ({}), each item gets one migrated label event, and 0017 then deletes the old boards and labels\n",
            names.join(", "),
            lanes_line()
        ));
        out.push_str("  its per-label moves can't be read until those steps have run, so this plan doesn't list them; its --accept-plan applies the fold with them\n");
        return;
    }
    out.push_str(&format!(
        "  the Cards board {}: {}\n",
        match fold["cards_board"].as_str().unwrap_or_default() {
            "make" => "is made, owned by the oldest Owner, with seven lanes",
            "fill" => "gets seven lanes",
            "insert" => "gets Needs you as lane 4; its cards stay where they are",
            "keep" => "keeps its seven lanes",
            _ => "has columns other than the lanes, so they are set to the seven lanes; a card on a column that isn't one moves as below",
        },
        lanes_line()
    ));
    out.push_str("  an item whose label is a lane stays; every other item moves to a lane, with one migrated label event naming its old label:\n");
    let labels = fold["labels"].as_array().cloned().unwrap_or_default();
    let moving: Vec<&Value> = labels.iter().filter(|r| count(r, "items") > 0).collect();
    if moving.is_empty() {
        out.push_str("  no item carries a label outside the lanes\n");
    }
    for row in moving {
        let (open, closed) = (count(row, "open"), count(row, "closed"));
        let mut said = Vec::new();
        if open > 0 {
            said.push(format!("{open} open -> {}", text(row, "to")));
        }
        if closed > 0 {
            said.push(format!("{closed} closed -> done, keeping their resolution"));
        }
        out.push_str(&format!(
            "  {:<20} {}\n",
            text(row, "label"),
            said.join("; ")
        ));
    }
    let boards = fold["boards"].as_array().cloned().unwrap_or_default();
    let deleted: Vec<String> = boards
        .iter()
        .filter(|b| b["deleted"] == true)
        .map(board_name)
        .collect();
    out.push_str(&format!(
        "  deleted once moved (0017): {}{}\n",
        many(deleted.len() as i64, "board", "boards"),
        if deleted.is_empty() {
            String::new()
        } else {
            format!(" ({})", deleted.join(", "))
        }
    ));
    let names: Vec<String> = labels.iter().map(|r| text(r, "label")).collect();
    out.push_str(&format!(
        "  labels deleted once moved (0017): {}\n",
        if names.is_empty() {
            "none".to_owned()
        } else {
            names.join(", ")
        }
    ));
    let order: Vec<String> = boards
        .iter()
        .filter(|b| count(b, "placed") > 0)
        .map(|b| {
            format!(
                "{} {}",
                board_name(b),
                many(count(b, "placed"), "card", "cards")
            )
        })
        .collect();
    let unplaced = count(fold, "unplaced");
    let mut steps = order;
    if unplaced > 0 {
        steps.push(format!(
            "{} with no place, newest first",
            many(unplaced, "item", "items")
        ));
    }
    out.push_str(&format!(
        "  the order in each lane: {}\n",
        if steps.is_empty() {
            "nothing to keep".to_owned()
        } else {
            steps.join(", then ")
        }
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plan_refuses_anything_but_one_select_before_it_reaches_cloudflare() {
        let cf = Cloudflare::at("t", "http://127.0.0.1:9");
        let account = Account::default();
        for sql in [
            "DELETE FROM items",
            "UPDATE labels SET role = NULL",
            "select id FROM items",
            " SELECT id FROM items",
            "SELECT id FROM items; DELETE FROM items",
            "SELECT id FROM items;",
            "",
        ] {
            assert_eq!(
                select(&cf, &account, sql),
                Err("the plan only reads, one SELECT at a time".to_owned()),
                "{sql:?}"
            );
        }
        for sql in [Q_BOARDS, Q_LABELS, Q_UNPLACED] {
            let asked = select(&cf, &account, sql).expect_err("nothing answers on port 9");
            assert_ne!(asked, "the plan only reads, one SELECT at a time", "{sql}");
        }
    }

    fn board(id: i64, name: &str, owner: &str, cards: i64, columns: i64, placed: i64) -> Value {
        json!({"id": id, "name": name, "owner": owner, "cards": cards, "columns": columns, "placed": placed})
    }

    fn label(name: &str, role: Value, closes: i64, items: i64, open: i64) -> Value {
        json!({"label": name, "role": role, "closes": closes, "items": items, "open": open})
    }

    #[test]
    fn the_default_roles_and_custom_columns_map_as_0016_does() {
        assert_eq!(lane_of(Some("inbox")), Lane::New);
        assert_eq!(lane_of(Some("review")), Lane::Landed);
        assert_eq!(lane_of(Some("doing")), Lane::InProgress);
        assert_eq!(lane_of(None), Lane::InProgress);
        assert_eq!(lane_of(Some("done")), Lane::InProgress);
    }

    #[test]
    fn the_cards_board_step_follows_its_column_count() {
        assert_eq!(cards_board(None, false), "make");
        assert_eq!(cards_board(Some(0), false), "fill");
        assert_eq!(cards_board(Some(6), false), "insert");
        assert_eq!(cards_board(Some(6), true), "reset");
        assert_eq!(cards_board(Some(7), false), "keep");
        assert_eq!(cards_board(Some(7), true), "keep");
        for odd in [1, 4, 5, 8] {
            assert_eq!(cards_board(Some(odd), false), "reset");
        }
    }

    #[test]
    fn only_gated_steps_before_0016_put_the_fold_after_them() {
        let plan = json!({"pending": ["0011_lanes.sql", "0013_app.sql", "0016_one_board.sql"]});
        assert_eq!(earlier(&plan), ["0011_lanes.sql", "0013_app.sql"]);
        assert!(earlier(&json!({"pending": ["0016_one_board.sql"]})).is_empty());
        assert!(earlier(&json!({})).is_empty());
    }

    #[test]
    fn every_query_only_reads() {
        for sql in [Q_BOARDS, Q_LABELS, Q_UNPLACED] {
            assert!(sql.starts_with("SELECT "), "{sql}");
            assert!(!sql.contains(';'), "{sql}");
            for word in ["UPDATE ", "INSERT ", "DELETE ", "DROP ", "CREATE "] {
                assert!(!sql.contains(word), "{sql}");
            }
        }
        assert!(Q_BOARDS.contains("ORDER BY CASE WHEN b.cards = 0 AND b.owner IS (SELECT email FROM codes WHERE manager = 1"));
    }

    #[test]
    fn before_0015_every_board_reads_as_no_cards_board_without_naming_the_column() {
        for sql in [Q_BOARDS, Q_LABELS, Q_UNPLACED] {
            let read = uncarded(sql);
            assert!(!read.contains("cards ="), "{read}");
            assert!(!read.contains(".cards"), "{read}");
            assert!(read.starts_with("SELECT ") && !read.contains(';'), "{read}");
        }
        let boards = uncarded(Q_BOARDS);
        assert!(
            boards.starts_with("SELECT b.id AS id, b.name AS name, b.owner AS owner, 0 AS cards,")
        );
        assert!(boards.contains("ORDER BY CASE WHEN 0 = 0 AND b.owner IS"));
        assert!(boards.contains("ORDER BY CASE WHEN 0 = 0 AND f.owner IS"));
        let labels = uncarded(Q_LABELS);
        assert_eq!(labels.matches("WHERE 0 = 1").count(), 5);
        assert!(labels.contains("WHERE 0 = 1 AND n.name = 'Needs you'"));
        assert_eq!(uncarded(Q_UNPLACED), Q_UNPLACED);
    }

    #[test]
    fn migration_0015_only_adds_schema_and_fills_cards_with_zero() {
        let (_, sql) = crate::bundle::MIGRATIONS
            .iter()
            .find(|(name, _)| name.starts_with("0015_"))
            .unwrap();
        let statements: Vec<String> = sql
            .split(';')
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|s| !s.is_empty())
            .collect();
        for statement in &statements {
            let upper = statement.to_ascii_uppercase();
            for word in ["INSERT ", "UPDATE ", "DELETE ", "TRIGGER ", " AS SELECT"] {
                assert!(!upper.contains(word), "0015 writes data: {statement}");
            }
            if upper.starts_with("ALTER TABLE ") {
                assert!(upper.contains(" ADD COLUMN "), "{statement}");
                assert_eq!(
                    upper.contains(" DEFAULT "),
                    upper.starts_with("ALTER TABLE BOARDS ADD COLUMN CARDS "),
                    "{statement}"
                );
            } else {
                assert!(
                    upper.starts_with("CREATE INDEX ") || upper.starts_with("CREATE UNIQUE INDEX "),
                    "{statement}"
                );
            }
        }
        assert!(statements.contains(
            &"ALTER TABLE boards ADD COLUMN cards INTEGER NOT NULL DEFAULT 0 CHECK (cards IN (0, 1))".to_owned()
        ));
    }

    fn two_owners() -> (Value, Vec<String>) {
        let boards = vec![
            board(2, "Web", "ada@example.com", 0, 4, 3),
            board(5, "Cards", "ada@example.com", 1, 6, 2),
            board(3, "Ops", "grace@example.com", 0, 3, 1),
        ];
        let labels = vec![
            label("Doing", json!("doing"), 0, 2, 2),
            label("Inbox", json!("inbox"), 0, 3, 1),
            label("QA ready", Value::Null, 0, 1, 1),
            label("Review", json!("review"), 0, 0, 0),
            label("Shipped", Value::Null, 1, 4, 1),
            label("Triage", Value::Null, 0, 2, 2),
        ];
        shape(&boards, &labels, 2)
    }

    #[test]
    fn the_plan_says_per_label_where_its_items_go_and_what_goes() {
        let (fold, decisions) = two_owners();
        assert_eq!(fold["cards_board"], "insert");
        let to: Vec<(&str, &str, i64, i64)> = fold["labels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["label"].as_str().unwrap(),
                    r["to"].as_str().unwrap(),
                    r["open"].as_i64().unwrap(),
                    r["closed"].as_i64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            to,
            [
                ("Doing", "in-progress", 2, 0),
                ("Inbox", "new", 1, 2),
                ("QA ready", "in-progress", 1, 0),
                ("Review", "landed", 0, 0),
                ("Shipped", "in-progress", 1, 3),
                ("Triage", "in-progress", 2, 0),
            ]
        );
        let deleted: Vec<i64> = fold["boards"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|b| b["deleted"] == true)
            .map(|b| b["id"].as_i64().unwrap())
            .collect();
        assert_eq!(deleted, [2, 3]);
        assert_eq!(fold["unplaced"], 2);
        assert_eq!(
            decisions,
            [
                "1 item on the closing column Shipped is open: 0016 puts it in In progress, never in Done; close it first if it is finished"
            ]
        );
    }

    #[test]
    fn open_items_on_a_closing_column_are_one_decision_in_the_plural() {
        let (_, decisions) = shape(&[], &[label("Shipped", Value::Null, 1, 5, 3)], 0);
        assert_eq!(
            decisions,
            [
                "3 items on the closing column Shipped are open: 0016 puts them in In progress, never in Done; close them first if they are finished"
            ]
        );
        let (_, none) = shape(&[], &[label("Shipped", Value::Null, 1, 5, 0)], 0);
        assert!(none.is_empty());
    }

    #[test]
    fn a_six_column_cards_board_that_already_has_needs_you_is_reset_to_the_seven_lanes() {
        let mut taken = board(5, "Cards", "ada@example.com", 1, 6, 0);
        taken["needs"] = json!(1);
        let (fold, decisions) = shape(&[taken], &[label("Next up", Value::Null, 0, 2, 2)], 0);
        assert_eq!(fold["cards_board"], "reset");
        assert_eq!(fold["labels"][0]["to"], "in-progress");
        assert!(decisions.is_empty());
        let mut seven = board(5, "Cards", "ada@example.com", 1, 7, 0);
        seven["needs"] = json!(1);
        assert_eq!(shape(&[seven], &[], 0).0["cards_board"], "keep");
        assert_eq!(
            shape(&[board(5, "Cards", "ada@example.com", 1, 6, 0)], &[], 0).0["cards_board"],
            "insert"
        );
        assert!(Q_BOARDS.contains("l.name = 'Needs you') AS needs"));
    }

    #[test]
    fn a_cards_board_with_odd_columns_is_reset_and_the_plan_says_so() {
        for columns in [1, 3, 4, 5, 8] {
            let (fold, _) = shape(
                &[board(5, "Cards", "ada@example.com", 1, columns, 0)],
                &[],
                0,
            );
            assert_eq!(fold["cards_board"], "reset", "{columns}");
            let mut out = String::new();
            render(&mut out, &json!({"one_board": fold}));
            assert!(out.contains("  the Cards board has columns other than the lanes, so they are set to the seven lanes; a card on a column that isn't one moves as below: New, Planned, In progress, Needs you, Stuck, Landed, Done\n"), "{out}");
            assert!(!out.contains("boards set"), "{out}");
        }
        let (made, none) = shape(&[board(2, "Web", "ada@example.com", 0, 4, 0)], &[], 0);
        assert_eq!(made["cards_board"], "make");
        assert!(none.is_empty());
    }

    #[test]
    fn the_render_names_lanes_moves_deletes_and_order() {
        let (fold, _) = two_owners();
        let mut out = String::new();
        render(&mut out, &json!({"one_board": fold}));
        assert!(out.starts_with("\nOne board per account (0016)\n"), "{out}");
        assert!(out.contains("  the Cards board gets Needs you as lane 4; its cards stay where they are: New, Planned, In progress, Needs you, Stuck, Landed, Done\n"), "{out}");
        assert!(
            out.contains(&format!("  {:<20} 2 open -> in-progress\n", "Doing")),
            "{out}"
        );
        assert!(
            out.contains(&format!(
                "  {:<20} 1 open -> new; 2 closed -> done, keeping their resolution\n",
                "Inbox"
            )),
            "{out}"
        );
        assert!(!out.contains("  Review "), "{out}");
        assert!(
            out.contains(
                "  deleted once moved (0017): 2 boards (Web (ada@example.com), Ops (grace@example.com))\n"
            ),
            "{out}"
        );
        assert!(
            out.contains("  labels deleted once moved (0017): Doing, Inbox, QA ready, Review, Shipped, Triage\n"),
            "{out}"
        );
        assert!(out.contains("  the order in each lane: Web (ada@example.com) 3 cards, then Cards (ada@example.com) 2 cards, then Ops (grace@example.com) 1 card, then 2 items with no place, newest first\n"), "{out}");
    }

    #[test]
    fn a_board_with_no_owner_is_named_alone_in_the_deleted_line() {
        let orphan = json!({"id": 4, "name": "Old flow", "owner": null, "cards": 0, "columns": 3, "placed": 1});
        let (fold, _) = shape(&[orphan], &[], 0);
        let mut out = String::new();
        render(&mut out, &json!({"one_board": fold}));
        assert!(
            out.contains("  deleted once moved (0017): 1 board (Old flow)\n"),
            "{out}"
        );
        assert!(
            out.contains("  the order in each lane: Old flow 1 card\n"),
            "{out}"
        );
    }

    #[test]
    fn the_render_of_an_empty_account_and_of_a_later_fold() {
        let (fold, _) = shape(&[], &[], 0);
        let mut out = String::new();
        render(&mut out, &json!({"one_board": fold}));
        assert!(
            out.contains("is made, owned by the oldest Owner, with seven lanes"),
            "{out}"
        );
        assert!(
            out.contains("  no item carries a label outside the lanes\n"),
            "{out}"
        );
        assert!(
            out.contains("  deleted once moved (0017): 0 boards\n"),
            "{out}"
        );
        assert!(
            out.contains("  labels deleted once moved (0017): none\n"),
            "{out}"
        );
        assert!(
            out.contains("  the order in each lane: nothing to keep\n"),
            "{out}"
        );

        let mut later = String::new();
        render(
            &mut later,
            &json!({"one_board": {"after": ["0011_lanes.sql", "0013_app.sql"]}}),
        );
        assert!(
            later.contains("  runs after 0011_lanes.sql, 0013_app.sql: every board folds"),
            "{later}"
        );
        assert!(
            later.contains("  its per-label moves can't be read until those steps have run, so this plan doesn't list them; its --accept-plan applies the fold with them\n"),
            "{later}"
        );
        assert_eq!(later.lines().count(), 4, "{later}");

        let mut nothing = String::new();
        render(&mut nothing, &json!({"pending": []}));
        assert!(nothing.is_empty());
    }
}

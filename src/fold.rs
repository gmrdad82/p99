use clap::ValueEnum;
use serde_json::{Value, json};

use crate::card::Lane;
use crate::cloudflare::Cloudflare;
use crate::config::Account;

macro_rules! oldest_owner {
    () => {
        "(SELECT email FROM codes WHERE manager = 1 ORDER BY revoked_at IS NOT NULL, id LIMIT 1)"
    };
}

macro_rules! rank {
    () => {
        concat!(
            "CASE WHEN b.cards = 0 AND b.owner IS ",
            oldest_owner!(),
            " THEN 0 ELSE 1 END, b.created_at, b.id"
        )
    };
}

macro_rules! cards_columns {
    () => {
        "(SELECT bc.label_id FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.cards = 1)"
    };
}

pub const Q_BOARDS: &str = concat!(
    "SELECT b.id AS id, b.name AS name, b.owner AS owner, b.cards AS cards, ",
    "(SELECT count(*) FROM board_columns bc WHERE bc.board_id = b.id) AS columns, ",
    "(SELECT count(*) FROM board_positions bp JOIN items i ON i.id = bp.item_id AND i.label_id = bp.label_id WHERE bp.board_id = b.id) AS placed ",
    "FROM boards b ORDER BY ",
    rank!()
);

pub const Q_LABELS: &str = concat!(
    "SELECT l.name AS label, l.role AS role, l.closes AS closes, count(i.id) AS items, coalesce(sum(i.open), 0) AS open, ",
    "(SELECT bc.position = (SELECT min(c2.position) FROM board_columns c2 WHERE c2.board_id = bc.board_id) ",
    "FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE bc.label_id = l.id ORDER BY ",
    rank!(),
    " LIMIT 1) AS first ",
    "FROM labels l LEFT JOIN items i ON i.label_id = l.id ",
    "WHERE l.id NOT IN ",
    cards_columns!(),
    " AND NOT (l.name = 'Needs you' OR (NOT EXISTS ",
    cards_columns!(),
    " AND (l.role = 'done' OR l.name IN ('New', 'Planned', 'In progress', 'Stuck', 'Landed')))) ",
    "GROUP BY l.id ORDER BY l.name, l.id"
);

pub const Q_UNPLACED: &str = "SELECT count(*) AS items FROM items i WHERE NOT EXISTS (SELECT 1 FROM board_positions bp WHERE bp.item_id = i.id AND bp.label_id = i.label_id)";

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

pub fn lane_of(role: Option<&str>, first: bool) -> Lane {
    match role {
        Some("inbox") => Lane::New,
        Some("review") => Lane::Landed,
        Some("doing") => Lane::InProgress,
        None if first => Lane::New,
        _ => Lane::InProgress,
    }
}

pub fn cards_board(columns: Option<i64>) -> &'static str {
    match columns {
        None => "make",
        Some(0) => "fill",
        Some(6) => "insert",
        Some(7) => "keep",
        Some(_) => "odd",
    }
}

pub fn earlier(plan: &Value) -> Vec<String> {
    plan["pending"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|p| *p < "0016")
        .map(str::to_owned)
        .collect()
}

pub fn shape(boards: &[Value], labels: &[Value], unplaced: i64) -> (Value, Vec<String>) {
    let mut decisions = Vec::new();
    let columns = boards
        .iter()
        .find(|b| count(b, "cards") == 1)
        .map(|b| count(b, "columns"));
    let step = cards_board(columns);
    if step == "odd" {
        decisions.push(format!(
            "the Cards board has {} columns where 0016 expects its six lanes: set them back to New, Planned, In progress, Stuck, Landed and Done before deploying",
            columns.unwrap_or_default()
        ));
    }
    let mut rows = Vec::new();
    for row in labels {
        let items = count(row, "items");
        let open = count(row, "open");
        let role = row["role"].as_str();
        let first = count(row, "first") == 1;
        let to = lane_of(role, first);
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
                "archived": count(b, "cards") != 1,
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

pub fn plan(
    cf: &Cloudflare,
    account: &Account,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let before = earlier(plan);
    if !before.is_empty() {
        plan["one_board"] = json!({ "after": before });
        return Ok(());
    }
    let boards = select(cf, account, Q_BOARDS)?;
    let labels = select(cf, account, Q_LABELS)?;
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

fn board_name(row: &Value) -> String {
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
            "  runs after {}: every board folds into the Cards board's seven lanes ({}), the old boards and labels are archived read-only, and each item gets one migrated label event\n",
            names.join(", "),
            lanes_line()
        ));
        return;
    }
    out.push_str(&format!(
        "  the Cards board {}: {}\n",
        match fold["cards_board"].as_str().unwrap_or_default() {
            "make" => "is made, owned by the oldest Owner, with seven lanes",
            "fill" => "gets seven lanes",
            "insert" => "gets Needs you as lane 4; its cards stay where they are",
            "keep" => "keeps its seven lanes",
            _ => "has odd columns (see the decisions)",
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
    let archived: Vec<String> = boards
        .iter()
        .filter(|b| b["archived"] == true)
        .map(board_name)
        .collect();
    out.push_str(&format!(
        "  archived, read-only: {}{}\n",
        many(archived.len() as i64, "board", "boards"),
        if archived.is_empty() {
            String::new()
        } else {
            format!(" ({})", archived.join(", "))
        }
    ));
    let names: Vec<String> = labels.iter().map(|r| text(r, "label")).collect();
    out.push_str(&format!(
        "  archived labels: {}\n",
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

    fn board(id: i64, name: &str, owner: &str, cards: i64, columns: i64, placed: i64) -> Value {
        json!({"id": id, "name": name, "owner": owner, "cards": cards, "columns": columns, "placed": placed})
    }

    fn label(name: &str, role: Value, closes: i64, items: i64, open: i64, first: Value) -> Value {
        json!({"label": name, "role": role, "closes": closes, "items": items, "open": open, "first": first})
    }

    #[test]
    fn the_default_roles_and_custom_columns_map_as_0016_does() {
        assert_eq!(lane_of(Some("inbox"), false), Lane::New);
        assert_eq!(lane_of(Some("review"), true), Lane::Landed);
        assert_eq!(lane_of(Some("doing"), true), Lane::InProgress);
        assert_eq!(lane_of(None, true), Lane::New);
        assert_eq!(lane_of(None, false), Lane::InProgress);
        assert_eq!(lane_of(Some("done"), true), Lane::InProgress);
    }

    #[test]
    fn the_cards_board_step_follows_its_column_count() {
        assert_eq!(cards_board(None), "make");
        assert_eq!(cards_board(Some(0)), "fill");
        assert_eq!(cards_board(Some(6)), "insert");
        assert_eq!(cards_board(Some(7)), "keep");
        assert_eq!(cards_board(Some(4)), "odd");
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

    fn two_owners() -> (Value, Vec<String>) {
        let boards = vec![
            board(2, "Web", "ada@example.com", 0, 4, 3),
            board(5, "Cards", "ada@example.com", 1, 6, 2),
            board(3, "Ops", "grace@example.com", 0, 3, 1),
        ];
        let labels = vec![
            label("Doing", json!("doing"), 0, 2, 2, json!(0)),
            label("Inbox", json!("inbox"), 0, 3, 1, json!(1)),
            label("QA ready", Value::Null, 0, 1, 1, json!(0)),
            label("Review", json!("review"), 0, 0, 0, json!(0)),
            label("Shipped", Value::Null, 1, 4, 1, json!(0)),
            label("Triage", Value::Null, 0, 2, 2, json!(1)),
        ];
        shape(&boards, &labels, 2)
    }

    #[test]
    fn the_plan_says_per_label_where_its_items_go_and_what_it_archives() {
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
                ("Triage", "new", 2, 0),
            ]
        );
        let archived: Vec<i64> = fold["boards"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|b| b["archived"] == true)
            .map(|b| b["id"].as_i64().unwrap())
            .collect();
        assert_eq!(archived, [2, 3]);
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
        let (_, decisions) = shape(&[], &[label("Shipped", Value::Null, 1, 5, 3, json!(1))], 0);
        assert_eq!(
            decisions,
            [
                "3 items on the closing column Shipped are open: 0016 puts them in New, never in Done; close them first if they are finished"
            ]
        );
        let (_, none) = shape(&[], &[label("Shipped", Value::Null, 1, 5, 0, json!(0))], 0);
        assert!(none.is_empty());
    }

    #[test]
    fn a_cards_board_with_odd_columns_is_a_decision_and_no_cards_board_is_made() {
        let (fold, decisions) = shape(&[board(5, "Cards", "ada@example.com", 1, 4, 0)], &[], 0);
        assert_eq!(fold["cards_board"], "odd");
        assert_eq!(decisions.len(), 1);
        assert!(decisions[0].starts_with("the Cards board has 4 columns"));
        let (made, none) = shape(&[board(2, "Web", "ada@example.com", 0, 4, 0)], &[], 0);
        assert_eq!(made["cards_board"], "make");
        assert!(none.is_empty());
    }

    #[test]
    fn the_render_names_lanes_moves_archives_and_order() {
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
                "  archived, read-only: 2 boards (Web (ada@example.com), Ops (grace@example.com))\n"
            ),
            "{out}"
        );
        assert!(
            out.contains("  archived labels: Doing, Inbox, QA ready, Review, Shipped, Triage\n"),
            "{out}"
        );
        assert!(out.contains("  the order in each lane: Web (ada@example.com) 3 cards, then Cards (ada@example.com) 2 cards, then Ops (grace@example.com) 1 card, then 2 items with no place, newest first\n"), "{out}");
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
        assert!(out.contains("  archived, read-only: 0 boards\n"), "{out}");
        assert!(out.contains("  archived labels: none\n"), "{out}");
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
        assert_eq!(later.lines().count(), 3, "{later}");

        let mut nothing = String::new();
        render(&mut nothing, &json!({"pending": []}));
        assert!(nothing.is_empty());
    }
}

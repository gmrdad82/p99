use serde_json::Value;

use crate::wire::{kind_word, stage_word, status_word};

pub fn what(kind: &str, detail: &Value) -> String {
    let said = |field: &str| detail.get(field).map(|value| plain(kind, value));
    match (kind, detail.get("from"), detail.get("to")) {
        (_, Some(from), Some(to)) => {
            format!("{kind} {} → {}", plain(kind, from), plain(kind, to))
        }
        ("merge", ..) => match (said("into"), said("item")) {
            (Some(into), _) => format!("merged into {into}"),
            (None, Some(item)) => format!("{item} merged in"),
            (None, None) => "merge".to_owned(),
        },
        ("github", ..) => {
            let action = said("action").unwrap_or_else(|| "linked".to_owned());
            let thing = said("kind").unwrap_or_default();
            match detail.get("number").and_then(Value::as_i64) {
                Some(number) => format!("github {action} {thing} #{number}"),
                None => format!("github {action} {thing}").trim_end().to_owned(),
            }
        }
        _ => kind.replace('_', " "),
    }
}

fn plain(kind: &str, value: &Value) -> String {
    match value {
        Value::Null => "nobody".into(),
        Value::String(s) if kind == "status" => match stage_word(s) {
            word if word != s => word.to_owned(),
            _ => status_word(s).to_owned(),
        },
        Value::String(s) if kind == "kind" => kind_word(s).to_owned(),
        Value::String(s) => s.replace('_', " "),
        Value::Bool(b) => if *b { "yes" } else { "no" }.to_owned(),
        Value::Number(n) => n.to_string(),
        Value::Array(items) if items.is_empty() => "nothing".into(),
        Value::Array(items) => items
            .iter()
            .map(|item| plain(kind, item))
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(fields) => match fields.get("username") {
            Some(Value::String(name)) if !name.is_empty() => format!("@{name}"),
            Some(_) => "someone".into(),
            None => ["name", "key", "email"]
                .iter()
                .find_map(|field| fields.get(*field).and_then(Value::as_str))
                .filter(|word| !word.is_empty())
                .map_or_else(|| "something".to_owned(), str::to_owned),
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn an_assignee_change_names_the_person_never_raw_json() {
        let said = what(
            "assignee",
            &json!({"from": null, "to": {"username": "grace.hopper"}}),
        );
        assert_eq!(said, "assignee nobody → @grace.hopper");
        let back = what(
            "assignee",
            &json!({"from": {"username": "grace.hopper"}, "to": {"username": "ada"}}),
        );
        assert_eq!(back, "assignee @grace.hopper → @ada");
    }

    #[test]
    fn an_assignee_without_a_username_is_someone() {
        assert_eq!(
            what("assignee", &json!({"from": {"username": null}, "to": null})),
            "assignee someone → nobody"
        );
        assert_eq!(
            what("assignee", &json!({"from": {"username": ""}, "to": {}})),
            "assignee someone → something"
        );
    }

    #[test]
    fn objects_without_a_username_use_a_name_key_or_email() {
        assert_eq!(
            what(
                "label",
                &json!({"from": {"name": "Inbox"}, "to": {"key": "BUG-3"}})
            ),
            "label Inbox → BUG-3"
        );
        assert_eq!(
            what(
                "x",
                &json!({"from": {"email": "ada@example.com"}, "to": {"name": ""}})
            ),
            "x ada@example.com → something"
        );
    }

    #[test]
    fn statuses_kinds_and_plain_words_read_as_before() {
        assert_eq!(
            what("label", &json!({"from": "In_Progress", "to": "Done"})),
            "label In Progress → Done"
        );
        let kind = what("kind", &json!({"from": "bug", "to": "feature"}));
        assert_eq!(
            kind,
            format!("kind {} → {}", kind_word("bug"), kind_word("feature"))
        );
        let status = what("status", &json!({"from": "received", "to": "fixed"}));
        assert!(!status.contains('"'), "{status}");
    }

    #[test]
    fn arrays_numbers_and_booleans_never_print_as_json() {
        assert_eq!(
            what(
                "labels",
                &json!({"from": [], "to": ["Doing", {"username": "ada"}]})
            ),
            "labels nothing → Doing, @ada"
        );
        assert_eq!(
            what("count", &json!({"from": 1, "to": true})),
            "count 1 → yes"
        );
    }

    #[test]
    fn merges_and_github_links_say_what_happened() {
        assert_eq!(
            what("merge", &json!({"into": "BUG-3"})),
            "merged into BUG-3"
        );
        assert_eq!(what("merge", &json!({"item": "BUG-4"})), "BUG-4 merged in");
        assert_eq!(what("merge", &json!({})), "merge");
        assert_eq!(
            what(
                "github",
                &json!({"action": "opened", "kind": "issue", "repo": "acme/shop", "number": 12, "url": "https://github.com/acme/shop/issues/12"})
            ),
            "github opened issue #12"
        );
        assert_eq!(what("github", &json!({})), "github linked");
    }

    #[test]
    fn details_without_ends_fall_back_to_the_kind() {
        assert_eq!(what("reporter_reply", &Value::Null), "reporter reply");
        assert_eq!(what("mail", &json!({"to": "ada@example.com"})), "mail");
        assert_eq!(what("title", &json!({"from": "Old"})), "title");
    }

    #[test]
    fn history_values_read_as_words() {
        assert_eq!(plain("status", &json!("review")), "Review");
        assert_eq!(plain("status", &json!("in_progress")), "In progress");
        assert_eq!(plain("status", &json!("resolved")), "Fixed");
        assert_eq!(plain("kind", &json!("feature")), "Idea");
        assert_eq!(plain("label", &json!("qa_ready")), "qa ready");
        assert_eq!(plain("assignee", &json!(null)), "nobody");
        assert_eq!(plain("position", &json!(3)), "3");
    }
}

use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: i64,
    pub rel: &'static str,
    pub sha: String,
    pub subject: String,
}

pub const PREFIXES: [&str; 5] = ["BUG", "FEAT", "IMP", "Q", "TASK"];
pub const FIELD: char = '\u{1f}';
pub const RECORD: char = '\u{1e}';
pub const FORMAT: &str = "%H%x1f%s%x1f%(trailers:key=Fixes,valueonly,separator=%x2C)%x1f%(trailers:key=Refs,valueonly,separator=%x2C)%x1e";

pub fn keys(value: &str) -> Vec<i64> {
    let mut found = BTreeSet::new();
    for token in value.split(|c: char| c == ',' || c.is_whitespace()) {
        let token = token.trim().trim_end_matches(['.', ';', ')']);
        let Some((prefix, number)) = token.split_once('-') else {
            continue;
        };
        if !PREFIXES.contains(&prefix)
            || number.is_empty()
            || number.len() > 15
            || !number.chars().all(|c| c.is_ascii_digit())
        {
            continue;
        }
        if let Ok(id) = number.parse::<i64>()
            && id > 0
        {
            found.insert(id);
        }
    }
    found.into_iter().collect()
}

pub fn parse_log(log: &str) -> Vec<Item> {
    let mut items = Vec::new();
    for record in log.split(RECORD) {
        let record = record.trim_start_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let mut fields = record.split(FIELD);
        let sha = fields.next().unwrap_or("").trim().to_owned();
        let subject = fields.next().unwrap_or("").trim().to_owned();
        let fixes = fields.next().unwrap_or("");
        let refs = fields.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        let fixed = keys(fixes);
        for id in &fixed {
            items.push(Item {
                id: *id,
                rel: "fixes",
                sha: sha.clone(),
                subject: subject.clone(),
            });
        }
        for id in keys(refs) {
            if !fixed.contains(&id) {
                items.push(Item {
                    id,
                    rel: "refs",
                    sha: sha.clone(),
                    subject: subject.clone(),
                });
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::{FIELD, RECORD, keys, parse_log};

    #[test]
    fn trailers_name_items_of_every_prefix() {
        assert_eq!(
            keys("BUG-12, FEAT-3,IMP-40 Q-7 TASK-9"),
            vec![3, 7, 9, 12, 40]
        );
        assert!(keys("#12, bug-4, 15, FEP-, -3, PR-45, GH-7, BUG-1234567890123456").is_empty());
        let log = format!(
            "a1{FIELD}Totals refresh{FIELD}BUG-12, FEAT-3{FIELD}IMP-40{RECORD}\nb2{FIELD}Nothing named{FIELD}{FIELD}{RECORD}\nc3{FIELD}Work on it{FIELD}{FIELD}Q-7,TASK-9{RECORD}\n"
        );
        let found: Vec<(i64, &str, &str)> = parse_log(&log)
            .iter()
            .map(|i| (i.id, i.rel, if i.sha == "a1" { "a1" } else { "c3" }))
            .collect();
        assert_eq!(
            found,
            vec![
                (3, "fixes", "a1"),
                (12, "fixes", "a1"),
                (40, "refs", "a1"),
                (7, "refs", "c3"),
                (9, "refs", "c3"),
            ]
        );
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_PROJECT_CHARS: usize = 40;
pub const MAX_VIA_CHARS: usize = 80;
pub const DEFAULT_LIMIT: u32 = 200;
pub const MAX_LIMIT: u32 = 500;
pub const ROBOT: &str = "🤖";
pub const NOT_YET: &str = "this Worker has no cards yet; run p99 deploy";
pub const PROJECT_RULE: &str = "a project name has 1 to 40 characters";
pub const SINCE_RULE: &str = "--since takes a time like 2026-10-22T08:00:00Z or an age like 6h";

pub(crate) fn blank_in<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn blank_out<S: serde::Serializer>(
    text: &str,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if text.is_empty() {
        serializer.serialize_none()
    } else {
        serializer.serialize_str(text)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "kebab-case")]
pub enum Lane {
    New,
    Planned,
    InProgress,
    #[value(alias = "needs you")]
    NeedsYou,
    Stuck,
    Landed,
    Done,
}

impl Lane {
    pub fn word(self) -> &'static str {
        match self {
            Lane::New => "new",
            Lane::Planned => "planned",
            Lane::InProgress => "in-progress",
            Lane::NeedsYou => "needs-you",
            Lane::Stuck => "stuck",
            Lane::Landed => "landed",
            Lane::Done => "done",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Lane::New => "New",
            Lane::Planned => "Planned",
            Lane::InProgress => "In progress",
            Lane::NeedsYou => "Needs you",
            Lane::Stuck => "Stuck",
            Lane::Landed => "Landed",
            Lane::Done => "Done",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Human,
    Agent,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    pub name: Option<String>,
    pub username: Option<String>,
    #[serde(default)]
    pub agent: bool,
    #[serde(default)]
    pub via: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(default)]
    pub note: Option<String>,
    pub by: Person,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    pub key: String,
    pub kind: String,
    #[serde(default, deserialize_with = "blank_in", serialize_with = "blank_out")]
    pub project: String,
    pub status: Lane,
    pub label: String,
    pub lane: Option<u32>,
    pub title: String,
    #[serde(default, deserialize_with = "blank_in", serialize_with = "blank_out")]
    pub host: String,
    pub reporter: Person,
    pub created_at: String,
    pub changed_at: String,
    pub changed_by: Option<Person>,
    pub comments: u64,
    #[serde(default)]
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardWithBody {
    #[serde(flatten)]
    pub card: Card,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardComment {
    pub id: i64,
    pub author: Person,
    pub body: String,
    pub internal: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardEvent {
    pub kind: String,
    pub detail: Value,
    pub by: Option<Person>,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardList {
    pub cards: Vec<Card>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardThread {
    pub card: CardWithBody,
    pub comments: Vec<CardComment>,
    pub events: Vec<CardEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardReply {
    pub card: Card,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<CardComment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentReply {
    pub key: String,
    pub comment: CardComment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkReply {
    pub key: String,
    pub link: Link,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub open: u64,
    pub done: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectList {
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewCard {
    pub client_uid: String,
    pub project: String,
    pub title: String,
    pub body: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusChange {
    pub status: Lane,
    pub note: Option<String>,
    pub client_uid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewLink {
    #[serde(rename = "ref")]
    pub reference: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewComment {
    pub client_uid: String,
    pub body: String,
    pub internal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectChange {
    pub project: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CardQuery {
    pub projects: Vec<String>,
    pub statuses: Vec<Lane>,
    pub since: Option<String>,
    pub source: Option<Source>,
    pub host: Option<String>,
    pub limit: u32,
    pub cursor: Option<String>,
}

impl Source {
    pub fn word(self) -> &'static str {
        match self {
            Source::Human => "human",
            Source::Agent => "agent",
        }
    }
}

pub fn tidy(raw: &str) -> String {
    let kept: String = raw.chars().filter(|c| !c.is_control()).collect();
    crate::wire::clean(&kept).trim().to_owned()
}

pub fn via(raw: &str) -> Option<String> {
    let text = tidy(raw);
    if text.is_empty() {
        None
    } else {
        Some(text.chars().take(MAX_VIA_CHARS).collect())
    }
}

pub fn project(raw: &str) -> Result<String, String> {
    let text = tidy(raw);
    let count = text.chars().count();
    if count == 0 || count > MAX_PROJECT_CHARS {
        return Err(PROJECT_RULE.to_owned());
    }
    Ok(text)
}

pub fn since(text: &str, now: i64) -> Result<String, String> {
    let text = text.trim();
    if let Some(at) = age(text) {
        return match now - at {
            t if t < 0 => Err(SINCE_RULE.to_owned()),
            t => Ok(iso(t)),
        };
    }
    rfc3339(text).map(iso).ok_or_else(|| SINCE_RULE.to_owned())
}

fn age(text: &str) -> Option<i64> {
    let unit = match text.chars().last()? {
        'm' => 60,
        'h' => 3600,
        'd' => 86_400,
        _ => return None,
    };
    let digits = &text[..text.len() - 1];
    if digits.is_empty() || digits.len() > 6 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<i64>().ok().map(|n| n * unit)
}

fn rfc3339(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || !matches!(bytes[10], b'T' | b't')
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| digits_of(text.get(range)?);
    let day = crate::license::civil_day(text.get(..10)?)?;
    let (hour, minute, second) = (digits(11..13)?, digits(14..16)?, digits(17..19)?);
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let end = fraction
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(fraction.len());
        if end == 0 {
            return None;
        }
        rest = &fraction[end..];
    }
    let offset = match rest {
        "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes().first()? {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            if rest.len() != 6 || rest.as_bytes()[3] != b':' {
                return None;
            }
            let (hours, minutes) = (digits_of(rest.get(1..3)?)?, digits_of(rest.get(4..6)?)?);
            if hours > 23 || minutes > 59 {
                return None;
            }
            sign * (hours * 3600 + minutes * 60)
        }
    };
    Some(day * 86_400 + hour * 3600 + minute * 60 + second.min(59) - offset)
}

fn digits_of(part: &str) -> Option<i64> {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}

pub fn iso(seconds: i64) -> String {
    let (day, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let days = day + 719_468;
    let era = days.div_euclid(146_097);
    let of_era = days - era * 146_097;
    let of_cycle = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * of_cycle + of_cycle / 4 - of_cycle / 100);
    let month_index = (5 * of_year + 2) / 153;
    let date = of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = of_cycle + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{date:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

pub fn ago(stamp: &str, now: i64) -> String {
    let Some(at) = rfc3339(stamp) else {
        return "-".to_owned();
    };
    let gone = (now - at).max(0);
    match gone {
        0..60 => "now".to_owned(),
        60..3600 => format!("{}m", gone / 60),
        3600..86_400 => format!("{}h", gone / 3600),
        _ => format!("{}d", gone / 86_400),
    }
}

pub fn query(q: &CardQuery) -> String {
    let mut pairs: Vec<(&str, String)> = Vec::new();
    for name in &q.projects {
        pairs.push(("project", name.clone()));
    }
    for lane in &q.statuses {
        pairs.push(("status", lane.word().to_owned()));
    }
    if let Some(since) = &q.since {
        pairs.push(("since", since.clone()));
    }
    if let Some(source) = q.source {
        pairs.push(("source", source.word().to_owned()));
    }
    if let Some(host) = &q.host {
        pairs.push(("host", host.clone()));
    }
    pairs.push(("limit", q.limit.to_string()));
    if let Some(cursor) = &q.cursor {
        pairs.push(("cursor", cursor.clone()));
    }
    let parts: Vec<String> = pairs
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}={}", crate::client::encode(v)))
        .collect();
    format!("?{}", parts.join("&"))
}

pub fn refusal(why: String) -> String {
    let bare = match why.rsplit_once(" (") {
        Some((head, tail))
            if tail.len() == 4
                && tail.ends_with(')')
                && tail[..3].bytes().all(|b| b.is_ascii_digit()) =>
        {
            head.to_owned()
        }
        _ => why,
    };
    if bare == "no such route" {
        NOT_YET.to_owned()
    } else {
        bare
    }
}

pub fn who(person: &Person) -> String {
    let base = person
        .name
        .as_deref()
        .filter(|n| !n.is_empty())
        .or(person.username.as_deref())
        .unwrap_or("someone");
    if person.agent {
        format!("{base} {ROBOT}")
    } else {
        base.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_792_656_000;

    const CARD: &str = r#"{"key":"FEAT-41","kind":"feature","project":"Splicer","status":"stuck","label":"Stuck","lane":3,
 "title":"Export keeps every audio track","host":"shop.example.com",
 "reporter":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
 "created_at":"2026-10-22T08:00:00.000Z","changed_at":"2026-10-22T09:12:00.000Z",
 "changed_by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci·splicer·writer"},
 "comments":4,
 "links":[{"ref":"pci#2700","note":"Splicer export","by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"at":"2026-10-22T08:05:00.000Z"}]}"#;

    #[test]
    fn the_clock_used_here_is_the_contracts_morning() {
        assert_eq!(iso(NOW), "2026-10-22T08:00:00Z");
    }

    #[test]
    fn an_age_becomes_an_absolute_time() {
        assert_eq!(since("90m", NOW).unwrap(), "2026-10-22T06:30:00Z");
        assert_eq!(since("6h", NOW).unwrap(), "2026-10-22T02:00:00Z");
        assert_eq!(since("2d", NOW).unwrap(), "2026-10-20T08:00:00Z");
        assert_eq!(since(" 1m ", NOW).unwrap(), "2026-10-22T07:59:00Z");
        assert_eq!(since("0h", NOW).unwrap(), "2026-10-22T08:00:00Z");
        assert_eq!(since("30d", NOW).unwrap(), "2026-09-22T08:00:00Z");
    }

    #[test]
    fn an_rfc_3339_time_is_normalised_to_utc() {
        assert_eq!(
            since("2026-10-22T08:00:00Z", NOW).unwrap(),
            "2026-10-22T08:00:00Z"
        );
        assert_eq!(
            since("2026-10-22T08:00:00.123Z", NOW).unwrap(),
            "2026-10-22T08:00:00Z"
        );
        assert_eq!(
            since("2026-10-22T10:30:00+02:00", NOW).unwrap(),
            "2026-10-22T08:30:00Z"
        );
        assert_eq!(
            since("2026-10-21T23:00:00-01:00", NOW).unwrap(),
            "2026-10-22T00:00:00Z"
        );
        assert_eq!(
            since("2024-02-29t00:00:00z", NOW).unwrap(),
            "2024-02-29T00:00:00Z"
        );
    }

    #[test]
    fn anything_else_is_the_contracts_since_line() {
        for bad in [
            "",
            "yesterday",
            "6",
            "h",
            "6w",
            "-6h",
            "6.5h",
            "1234567h",
            "2026-10-22",
            "2026-10-22 08:00:00Z",
            "2026-10-22T08:00:00",
            "2026-10-22T24:00:00Z",
            "2026-10-22T08:60:00Z",
            "2026-02-30T08:00:00Z",
            "2026-13-01T08:00:00Z",
            "2026-10-22T08:00:00.Z",
            "2026-10-22T08:00:00+2:00",
            "2026-10-22T08:00:00+24:00",
            "2026-10-22T08:00:00+02:0é",
            "2026-10-22T08:00:00Zjunk",
            "2026-10-22T08:0é:00Z",
        ] {
            assert_eq!(since(bad, NOW), Err(SINCE_RULE.to_owned()), "{bad}");
        }
    }

    #[test]
    fn an_age_reaching_before_1970_is_refused_with_the_since_line() {
        for bad in ["999999d", "999999h"] {
            assert_eq!(since(bad, NOW), Err(SINCE_RULE.to_owned()), "{bad}");
        }
        assert_eq!(since("6h", 21_600), Ok("1970-01-01T00:00:00Z".to_owned()));
        assert_eq!(since("6h", 21_599), Err(SINCE_RULE.to_owned()));
    }

    #[test]
    fn a_card_whose_last_change_has_no_person_reads_and_round_trips() {
        let mut raw: Value = serde_json::from_str(CARD).unwrap();
        raw["changed_by"] = Value::Null;
        let card: Card = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(card.changed_by, None);
        assert_eq!(serde_json::to_value(&card).unwrap(), raw);
        let list: CardList = serde_json::from_value(serde_json::json!({
            "cards": [raw.clone(), serde_json::from_str::<Value>(CARD).unwrap()],
            "next_cursor": null
        }))
        .unwrap();
        assert_eq!(list.cards.len(), 2);
        assert!(list.cards[1].changed_by.is_some());
    }

    #[test]
    fn ages_print_short() {
        assert_eq!(ago("2026-10-22T08:00:00.000Z", NOW), "now");
        assert_eq!(ago("2026-10-22T07:58:59Z", NOW), "1m");
        assert_eq!(ago("2026-10-22T05:00:00Z", NOW), "3h");
        assert_eq!(ago("2026-10-19T08:00:00Z", NOW), "3d");
        assert_eq!(ago("2026-10-22T09:00:00Z", NOW), "now");
        assert_eq!(ago("not a time", NOW), "-");
    }

    #[test]
    fn the_query_repeats_projects_and_statuses_and_encodes_values() {
        let q = CardQuery {
            projects: vec!["Splicer".into(), "Two words".into()],
            statuses: vec![Lane::InProgress, Lane::Stuck],
            since: Some("2026-10-22T08:00:00Z".into()),
            source: Some(Source::Agent),
            host: Some("shop.example.com".into()),
            limit: 50,
            cursor: Some("a/b".into()),
        };
        assert_eq!(
            query(&q),
            "?project=Splicer&project=Two%20words&status=in-progress&status=stuck&since=2026-10-22T08%3A00%3A00Z&source=agent&host=shop.example.com&limit=50&cursor=a%2Fb"
        );
        let plain = CardQuery {
            limit: DEFAULT_LIMIT,
            ..CardQuery::default()
        };
        assert_eq!(query(&plain), "?limit=200");
    }

    #[test]
    fn lane_and_source_words_match_their_serde_and_clap_names() {
        use clap::ValueEnum;
        for lane in Lane::value_variants() {
            let json = serde_json::to_string(lane).unwrap();
            assert_eq!(json, format!("\"{}\"", lane.word()));
            assert_eq!(lane.to_possible_value().unwrap().get_name(), lane.word());
        }
        let words: Vec<&str> = Lane::value_variants().iter().map(|l| l.word()).collect();
        assert_eq!(
            words,
            [
                "new",
                "planned",
                "in-progress",
                "needs-you",
                "stuck",
                "landed",
                "done"
            ]
        );
        let names: Vec<&str> = Lane::value_variants().iter().map(|l| l.name()).collect();
        assert_eq!(
            names,
            [
                "New",
                "Planned",
                "In progress",
                "Needs you",
                "Stuck",
                "Landed",
                "Done"
            ]
        );
        assert_eq!(Lane::from_str("needs you", true).unwrap(), Lane::NeedsYou);
        assert_eq!(Lane::from_str("NEEDS-YOU", true).unwrap(), Lane::NeedsYou);
        assert!(Lane::from_str("needs_you", true).is_err());
        assert_eq!(
            serde_json::from_str::<Lane>("\"needs-you\"").unwrap(),
            Lane::NeedsYou
        );

        for source in Source::value_variants() {
            let json = serde_json::to_string(source).unwrap();
            assert_eq!(json, format!("\"{}\"", source.word()));
        }
    }

    #[test]
    fn a_project_name_is_cleaned_and_has_one_to_forty_characters() {
        assert_eq!(project("  Splicer ").unwrap(), "Splicer");
        assert_eq!(project("Spl\u{1}icer\u{202e}").unwrap(), "Splicer");
        assert_eq!(project(&"é".repeat(40)).unwrap().chars().count(), 40);
        for bad in ["", "   ", "\u{1}\u{2}", &"a".repeat(41)] {
            assert_eq!(project(bad), Err(PROJECT_RULE.to_owned()), "{bad:?}");
        }
    }

    #[test]
    fn a_label_is_cut_at_eighty_and_empty_is_none() {
        assert_eq!(via(" pci "), Some("pci".into()));
        assert_eq!(via(""), None);
        assert_eq!(via("\u{7}\n"), None);
        assert_eq!(via(&"x".repeat(81)).unwrap().len(), 80);
    }

    #[test]
    fn refusals_lose_the_status_and_an_old_worker_says_deploy() {
        assert_eq!(refusal("no item FEAT-99 (404)".into()), "no item FEAT-99");
        assert_eq!(
            refusal("only a person changes a grant (403)".into()),
            "only a person changes a grant"
        );
        assert_eq!(refusal("no such route (404)".into()), NOT_YET);
        assert_eq!(
            refusal("cannot reach http://127.0.0.1:1: refused".into()),
            "cannot reach http://127.0.0.1:1: refused"
        );
        assert_eq!(refusal("why (40x)".into()), "why (40x)");
        assert_eq!(refusal("why (4040)".into()), "why (4040)");
        assert_eq!(
            refusal("the Worker answered 500".into()),
            "the Worker answered 500"
        );
    }

    #[test]
    fn an_agent_shows_as_the_persons_name_with_a_robot() {
        let mut ada = Person {
            name: Some("Ada Lovelace".into()),
            username: Some("ada".into()),
            agent: false,
            via: None,
        };
        assert_eq!(who(&ada), "Ada Lovelace");
        ada.agent = true;
        assert_eq!(who(&ada), "Ada Lovelace 🤖");
        ada.name = Some(String::new());
        assert_eq!(who(&ada), "ada 🤖");
        assert_eq!(who(&Person::default()), "someone");
    }

    #[test]
    fn the_contracts_card_round_trips_unchanged() {
        let raw: Value = serde_json::from_str(CARD).unwrap();
        let card: Card = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(card.status, Lane::Stuck);
        assert_eq!(card.lane, Some(3));
        assert_eq!(
            card.changed_by.as_ref().and_then(|p| p.via.as_deref()),
            Some("pci·splicer·writer")
        );
        assert_eq!(card.links[0].reference, "pci#2700");
        assert_eq!(serde_json::to_value(&card).unwrap(), raw);
    }

    #[test]
    fn every_reply_round_trips_unchanged() {
        let person = r#"{"name":"Grace Hopper","username":"grace","agent":false,"via":null}"#;
        let comment = format!(
            r#"{{"id":7,"author":{person},"body":"why","internal":false,"created_at":"2026-10-22T08:10:00.000Z"}}"#
        );
        let mut with_body: Value = serde_json::from_str(CARD).unwrap();
        with_body["body"] = Value::from("Every track.");
        with_body["lane"] = Value::Null;
        with_body["status"] = Value::from("done");
        let shapes = [
            format!(r#"{{"cards":[{CARD}],"next_cursor":"c2"}}"#),
            r#"{"cards":[],"next_cursor":null}"#.to_owned(),
            format!(
                r#"{{"card":{with_body},"comments":[{comment}],"events":[{{"kind":"link","detail":{{"ref":"v1.2.0","note":null}},"by":{person},"at":"2026-10-22T08:11:00.000Z"}},{{"kind":"created","detail":{{}},"by":null,"at":"2026-10-22T08:00:00.000Z"}}]}}"#
            ),
            format!(r#"{{"card":{CARD}}}"#),
            format!(r#"{{"card":{CARD},"comment":{comment}}}"#),
            format!(r#"{{"key":"FEAT-41","comment":{comment}}}"#),
            format!(
                r#"{{"key":"FEAT-41","link":{{"ref":"abc123","note":null,"by":{person},"at":"2026-10-22T08:12:00.000Z"}}}}"#
            ),
            r#"{"projects":[{"name":"Paper","open":0,"done":2},{"name":"Splicer","open":3,"done":1}]}"#.to_owned(),
        ];
        fn same<T: serde::de::DeserializeOwned + Serialize>(text: &str) {
            let raw: Value = serde_json::from_str(text).unwrap();
            let typed: T = serde_json::from_value(raw.clone()).unwrap();
            assert_eq!(serde_json::to_value(&typed).unwrap(), raw, "{text}");
        }
        same::<CardList>(&shapes[0]);
        same::<CardList>(&shapes[1]);
        same::<CardThread>(&shapes[2]);
        same::<CardReply>(&shapes[3]);
        same::<CardReply>(&shapes[4]);
        same::<CommentReply>(&shapes[5]);
        same::<LinkReply>(&shapes[6]);
        same::<ProjectList>(&shapes[7]);
    }

    #[test]
    fn request_bodies_carry_the_routes_fields() {
        let status = StatusChange {
            status: Lane::InProgress,
            note: None,
            client_uid: "u".into(),
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({"status":"in-progress","note":null,"client_uid":"u"})
        );
        let link = NewLink {
            reference: "pci#1".into(),
            note: Some("n".into()),
        };
        assert_eq!(
            serde_json::to_value(&link).unwrap(),
            serde_json::json!({"ref":"pci#1","note":"n"})
        );
        assert_eq!(
            serde_json::to_value(ProjectChange {
                project: "Shop".into()
            })
            .unwrap(),
            serde_json::json!({"project":"Shop"})
        );
    }

    #[test]
    fn a_card_with_no_host_reads_as_empty_and_writes_null_again() {
        let mut raw: Value = serde_json::from_str(CARD).unwrap();
        raw["host"] = Value::Null;
        let card: Card = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(card.host, "");
        assert_eq!(serde_json::to_value(&card).unwrap(), raw);
        raw.as_object_mut().unwrap().remove("host");
        let card: Card = serde_json::from_value(raw).unwrap();
        assert_eq!(card.host, "");
    }

    #[test]
    fn a_new_card_names_no_host_unless_asked() {
        let mut request = NewCard {
            client_uid: "u".into(),
            project: "Splicer".into(),
            title: "t".into(),
            body: String::new(),
            kind: "feature".into(),
            host: None,
        };
        assert!(
            serde_json::to_value(&request)
                .unwrap()
                .get("host")
                .is_none()
        );
        request.host = Some("shop.example.com".into());
        assert_eq!(
            serde_json::to_value(&request).unwrap()["host"],
            "shop.example.com"
        );
    }
}

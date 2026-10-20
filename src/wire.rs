use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! out {
    ($($arg:tt)*) => {
        println!("{}", $crate::wire::clean(&format!($($arg)*)))
    };
}
pub(crate) use out;

fn unsafe_char(c: char) -> bool {
    matches!(
        c,
        '\u{0}'..='\u{8}'
            | '\u{b}'..='\u{1f}'
            | '\u{7f}'..='\u{9f}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
    )
}

pub fn clean(text: &str) -> Cow<'_, str> {
    if text.chars().any(unsafe_char) {
        Cow::Owned(text.chars().filter(|c| !unsafe_char(*c)).collect())
    } else {
        Cow::Borrowed(text)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PageRef {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Person {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub agent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Reached {
    pub env: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub at: String,
    #[serde(default)]
    pub sha: String,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Landing {
    #[serde(default)]
    pub branch: bool,
    #[serde(default)]
    pub envs: Vec<Reached>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub key: String,
    pub kind: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub board: Option<String>,
    #[serde(default)]
    pub position: Option<f64>,
    pub title: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub env: String,
    #[serde(default)]
    pub page: PageRef,
    #[serde(default)]
    pub reporter: Person,
    #[serde(default)]
    pub assignee: Option<Assignee>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub comments: i64,
    #[serde(default)]
    pub attachments: i64,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub landing: Landing,
    #[serde(default)]
    pub labels: Vec<Tag>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelEdit {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub add: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remove: Vec<String>,
}

pub fn rgb(color: &str) -> Option<(u8, u8, u8)> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let part = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    Some((part(0)?, part(2)?, part(4)?))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CommitRef {
    #[serde(default)]
    pub sha: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub rel: String,
    #[serde(default)]
    pub envs: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Issue {
    pub id: i64,
    pub key: String,
    pub kind: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub board: Option<String>,
    #[serde(default)]
    pub position: Option<f64>,
    pub title: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub env: String,
    #[serde(default)]
    pub page: PageRef,
    #[serde(default)]
    pub reporter: Value,
    #[serde(default)]
    pub assignee: Option<Assignee>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub comments: i64,
    #[serde(default)]
    pub attachments: i64,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub landing: Landing,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub duplicate_of: Option<String>,
    #[serde(default)]
    pub closed_at: Option<String>,
    #[serde(default)]
    pub context: Value,
    #[serde(default)]
    pub marks: Vec<Value>,
    #[serde(default)]
    pub commits: Vec<CommitRef>,
    #[serde(default)]
    pub labels: Vec<Tag>,
    #[serde(default)]
    pub github: Vec<GithubLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merged: Vec<Merged>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GithubLink {
    pub kind: String,
    pub rel: String,
    pub repo: String,
    pub number: i64,
    pub url: String,
    #[serde(default)]
    pub at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Merged {
    pub key: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub reporter: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Merge {
    pub into: String,
    #[serde(default)]
    pub merged: Vec<String>,
    #[serde(default)]
    pub unchanged: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Deleted {
    pub key: String,
    #[serde(default)]
    pub comments: u64,
    #[serde(default)]
    pub files: u64,
    #[serde(default)]
    pub retrying: u64,
    #[serde(default)]
    pub unlinked: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Author {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub manager: bool,
    #[serde(default)]
    pub agent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Comment {
    pub id: i64,
    #[serde(default)]
    pub client_uid: String,
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub internal: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub attachments: Vec<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    #[serde(default)]
    pub client_uid: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub mark: Option<i64>,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub content_type: String,
    #[serde(default)]
    pub bytes: i64,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub comment_id: Option<i64>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Event {
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub actor_name: Option<String>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub detail: Value,
    #[serde(default)]
    pub at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IssueList {
    #[serde(default)]
    pub issues: Vec<Summary>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Thread {
    pub issue: Issue,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub people: Vec<Member>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Download {
    pub name: String,
    pub content_type: String,
    #[serde(with = "base64_bytes")]
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Announced {
    pub sha: String,
    pub branch: String,
    pub version: String,
    pub dirty: bool,
    pub items: usize,
    pub sent: bool,
}

pub mod base64_bytes {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        STANDARD.decode(text).map_err(serde::de::Error::custom)
    }
}

pub const KINDS: [&str; 5] = ["bug", "feature", "improvement", "question", "task"];
pub const STATUSES: [&str; 4] = ["inbox", "doing", "review", "done"];
pub const RESOLUTIONS: [&str; 3] = ["fixed", "abandoned", "duplicate"];
pub fn legacy(status: &str) -> Option<(&'static str, Option<&'static str>)> {
    match status {
        "new" => Some(("inbox", None)),
        "confirmed" | "in_progress" => Some(("doing", None)),
        "waiting" => Some(("review", None)),
        "resolved" => Some(("done", Some("fixed"))),
        "abandoned" => Some(("done", Some("abandoned"))),
        "duplicate" => Some(("done", Some("duplicate"))),
        _ => None,
    }
}

pub fn kind_word(kind: &str) -> &str {
    match kind {
        "bug" => "Bug",
        "feature" => "Idea",
        "improvement" => "Improvement",
        "question" => "Question",
        "task" => "Task",
        other => other,
    }
}

pub fn status_word(status: &str) -> &str {
    match status {
        "inbox" => "Inbox",
        "doing" => "Doing",
        "review" => "Review",
        "done" => "Done",
        other => match legacy(other) {
            Some((_, Some(resolution))) => resolution_word(resolution),
            Some((key, None)) => status_word(key),
            None => other,
        },
    }
}

pub fn resolution_word(resolution: &str) -> &str {
    match resolution {
        "fixed" => "Fixed",
        "abandoned" => "Dropped",
        "duplicate" => "Duplicate",
        other => other,
    }
}

pub fn status_text<'a>(status: &'a str, resolution: Option<&'a str>) -> &'a str {
    match (status, resolution) {
        ("done", Some(resolution)) => resolution_word(resolution),
        _ => status_word(status),
    }
}

pub const ROLES: [&str; 4] = ["screenshot", "page", "region", "file"];
pub const ATTACHMENT_LIMIT: usize = 20 << 20;
pub const FILE_TYPES: [(&str, &str); 20] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("pdf", "application/pdf"),
    ("txt", "text/plain"),
    ("csv", "text/csv"),
    ("log", "text/x-log"),
    ("json", "application/json"),
    ("zip", "application/zip"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    ("odt", "application/vnd.oasis.opendocument.text"),
    ("ods", "application/vnd.oasis.opendocument.spreadsheet"),
    ("odp", "application/vnd.oasis.opendocument.presentation"),
    ("doc", "application/msword"),
    ("xls", "application/vnd.ms-excel"),
    ("ppt", "application/vnd.ms-powerpoint"),
];

pub fn content_type(name: &str) -> Option<&'static str> {
    let (_, extension) = name.rsplit_once('.')?;
    FILE_TYPES
        .iter()
        .find(|(e, _)| e.eq_ignore_ascii_case(extension))
        .map(|&(_, kind)| kind)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NewIssue {
    pub client_uid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub page: PageRef,
    #[serde(default)]
    pub context: Value,
    #[serde(default)]
    pub marks: Vec<Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignee {
    #[serde(default)]
    pub username: String,
}

impl Assignee {
    pub fn new(username: &str) -> Assignee {
        Assignee {
            username: username.to_owned(),
        }
    }
}

impl std::fmt::Display for Assignee {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "@{}", self.username)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Member {
    pub username: String,
    #[serde(default)]
    pub manager: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Change {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_of: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<LabelEdit>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListQuery {
    #[serde(default = "mine")]
    pub scope: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub label: Vec<String>,
    #[serde(default = "thirty")]
    pub limit: i64,
}

fn mine() -> String {
    "mine".to_owned()
}

fn thirty() -> i64 {
    30
}

pub fn prefix(kind: &str) -> &'static str {
    match kind {
        "bug" => "BUG",
        "feature" => "FEAT",
        "improvement" => "IMP",
        "question" => "Q",
        "task" => "TASK",
        _ => "ITEM",
    }
}

pub fn item_number(key: &str) -> Option<i64> {
    let key = key.trim();
    let digits = match key.rsplit_once('-') {
        Some((head, tail)) if !head.is_empty() && head.chars().all(|c| c.is_ascii_alphabetic()) => {
            tail
        }
        Some(_) => return None,
        None => key,
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n > 0)
}

pub fn page_path(raw: &str) -> String {
    let path = raw.trim().split(['?', '#']).next().unwrap_or("");
    let ok = path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && !path.chars().any(|c| c.is_control() || c.is_whitespace())
        && path.chars().count() <= 512;
    if ok { path.to_owned() } else { "/".to_owned() }
}

pub fn open(status: &str) -> bool {
    !matches!(status, "done" | "resolved" | "abandoned" | "duplicate")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HostEntry {
    pub host: String,
    #[serde(default)]
    pub env: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnvEntry {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub notify: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Code {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub hosts: Vec<String>,
    #[serde(default)]
    pub manager: bool,
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub revoked_at: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub totp: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NewCode {
    pub client_uid: String,
    pub name: String,
    pub email: String,
    pub hosts: Vec<String>,
    #[serde(default)]
    pub manager: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub totp: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub mail: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Minted {
    pub code: Code,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked: Option<Code>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Relink {
    pub client_uid: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub new_totp: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub mail: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TotpKey {
    pub code: Code,
    pub totp_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Build {
    pub sha: String,
    pub branch: String,
    pub version: String,
    pub dirty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default)]
    pub items: Vec<BuildItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BuildItem {
    pub id: i64,
    pub rel: String,
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StatusEntry {
    pub key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub position: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rollup {
    #[serde(default)]
    pub done: i64,
    #[serde(default)]
    pub total: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Board {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub home: bool,
    #[serde(default)]
    pub rollup: Rollup,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Boards {
    #[serde(default)]
    pub statuses: Vec<StatusEntry>,
    #[serde(default)]
    pub boards: Vec<Board>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardPerson {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub agent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ItemCard {
    pub key: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub assignee: Option<Assignee>,
    #[serde(default)]
    pub reporter: CardPerson,
    #[serde(default)]
    pub labels: Vec<Tag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardCard {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub rollup: Rollup,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Card {
    Item(ItemCard),
    Board(BoardCard),
}

impl Card {
    pub fn status(&self) -> &str {
        match self {
            Card::Item(card) => &card.status,
            Card::Board(card) => &card.status,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardView {
    #[serde(default)]
    pub statuses: Vec<StatusEntry>,
    pub board: Board,
    #[serde(default)]
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Move {
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Moved {
    pub moved: Card,
    #[serde(default)]
    pub changed: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Owner {
    #[serde(default)]
    pub username: Option<String>,
}

impl Owner {
    pub fn handle(&self) -> String {
        self.username
            .as_deref()
            .map_or_else(|| "someone".to_owned(), |u| format!("@{u}"))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lane {
    pub label: String,
    #[serde(default)]
    pub closes: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneBoard {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub owner: Option<Owner>,
    #[serde(default)]
    pub mine: bool,
    #[serde(default)]
    pub columns: Vec<Lane>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneBoards {
    #[serde(default)]
    pub boards: Vec<LaneBoard>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneCard {
    pub key: String,
    #[serde(default)]
    pub kind: String,
    pub title: String,
    pub label: String,
    #[serde(default)]
    pub assignee: Option<Owner>,
    #[serde(default)]
    pub order: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LanePage {
    pub board: LaneBoard,
    #[serde(default)]
    pub cards: Vec<LaneCard>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelUse {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub owner_username: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelEntry {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub closes: bool,
    #[serde(default)]
    pub boards: Vec<LabelUse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MoveTo {
    pub key: String,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MovedCard {
    pub card: LaneCard,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneSpec {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closes: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<LaneSpec>>,
}

pub fn stage_word(stage: &str) -> &str {
    match stage {
        "received" => "Received",
        "in_progress" => "In progress",
        "fixed" => "Fixed",
        "dropped" => "Dropped",
        "duplicate" => "Duplicate",
        other => other,
    }
}

pub const IMPORT_TYPES: [&str; 7] = [
    "item",
    "comment",
    "attachment",
    "event",
    "landing",
    "read",
    "manager",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportConflict {
    #[serde(rename = "ref", default)]
    pub reference: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportTally {
    #[serde(default)]
    pub new: u64,
    #[serde(default)]
    pub existing: u64,
    #[serde(default)]
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportReport {
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub counts: std::collections::BTreeMap<String, ImportTally>,
    #[serde(default)]
    pub upload: Vec<String>,
    #[serde(default)]
    pub managers: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DuplicateLinks {
    #[serde(default)]
    pub linked: u64,
    #[serde(default)]
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportFinish {
    #[serde(default)]
    pub recounted: u64,
    #[serde(default)]
    pub duplicates: DuplicateLinks,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn printed_text_loses_escapes_and_bidi_controls() {
        let raw = "a\x1b]52;c;eA==\x07b\u{9b}2J\r\u{202e}c\u{2066}\n\td\u{7f}";
        assert_eq!(clean(raw), "a]52;c;eA==b2Jc\n\td");
        assert!(matches!(clean("plain é ✓\n"), Cow::Borrowed(_)));
    }

    #[test]
    fn every_file_type_is_one_the_worker_takes() {
        let worker = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/worker/src/worker.js"));
        let start = worker.find("const FILE_SIGNATURES = {").unwrap();
        let table = &worker[start..start + worker[start..].find("};").unwrap()];
        for (_, kind) in FILE_TYPES {
            assert!(table.contains(&format!("\"{kind}\":")), "{kind}");
        }
        assert_eq!(content_type("Report.PDF"), Some("application/pdf"));
        assert_eq!(content_type("notes.html"), None);
        assert_eq!(content_type("README"), None);
    }

    #[test]
    fn the_resolutions_are_the_workers() {
        let boards = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/worker/src/boards.js"));
        let resolutions: Vec<String> = RESOLUTIONS.iter().map(|s| format!("\"{s}\"")).collect();
        let line = format!("export const RESOLUTIONS = [{}];", resolutions.join(", "));
        assert!(boards.contains(&line), "{line}");
    }
}

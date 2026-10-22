use std::borrow::Cow;

use serde::{Deserialize, Deserializer, Serialize};
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

fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn assigned<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Assignee>, D::Error> {
    Ok(Option::<Assignee>::deserialize(deserializer)?.filter(|a| !a.username.is_empty()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PageRef {
    #[serde(default, deserialize_with = "lenient")]
    pub url: String,
    #[serde(default, deserialize_with = "lenient")]
    pub path: String,
    #[serde(default, deserialize_with = "lenient")]
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Person {
    #[serde(default, deserialize_with = "lenient")]
    pub email: String,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub agent: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub via: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Reached {
    pub env: String,
    #[serde(default, deserialize_with = "lenient")]
    pub kind: String,
    #[serde(default, deserialize_with = "lenient")]
    pub at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub sha: String,
    #[serde(default, deserialize_with = "lenient")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Landing {
    #[serde(default, deserialize_with = "lenient")]
    pub branch: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub envs: Vec<Reached>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub key: String,
    pub kind: String,
    #[serde(default, deserialize_with = "lenient")]
    pub status: String,
    #[serde(default, deserialize_with = "lenient")]
    pub stage: String,
    #[serde(default, deserialize_with = "lenient")]
    pub label: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub resolution: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub project: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub board: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub position: Option<f64>,
    pub title: String,
    #[serde(default, deserialize_with = "lenient")]
    pub host: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub env: String,
    #[serde(default, deserialize_with = "lenient")]
    pub page: PageRef,
    #[serde(default, deserialize_with = "lenient")]
    pub reporter: Person,
    #[serde(default, deserialize_with = "assigned")]
    pub assignee: Option<Assignee>,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub updated_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub comments: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub attachments: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub unread: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub landing: Landing,
    #[serde(default, deserialize_with = "lenient")]
    pub labels: Vec<Tag>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelEdit {
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub add: Vec<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub remove: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CommitRef {
    #[serde(default, deserialize_with = "lenient")]
    pub sha: String,
    #[serde(default, deserialize_with = "lenient")]
    pub subject: String,
    #[serde(default, deserialize_with = "lenient")]
    pub rel: String,
    #[serde(default, deserialize_with = "lenient")]
    pub envs: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Issue {
    pub id: i64,
    pub key: String,
    pub kind: String,
    #[serde(default, deserialize_with = "lenient")]
    pub status: String,
    #[serde(default, deserialize_with = "lenient")]
    pub stage: String,
    #[serde(default, deserialize_with = "lenient")]
    pub label: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub resolution: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub project: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub board: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub position: Option<f64>,
    pub title: String,
    #[serde(default, deserialize_with = "lenient")]
    pub host: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub env: String,
    #[serde(default, deserialize_with = "lenient")]
    pub page: PageRef,
    #[serde(default, deserialize_with = "lenient")]
    pub reporter: Value,
    #[serde(default, deserialize_with = "assigned")]
    pub assignee: Option<Assignee>,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub updated_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub comments: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub attachments: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub unread: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub landing: Landing,
    #[serde(default, deserialize_with = "lenient")]
    pub body: String,
    #[serde(default, deserialize_with = "lenient")]
    pub duplicate_of: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub closed_at: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub context: Value,
    #[serde(default, deserialize_with = "lenient")]
    pub marks: Vec<Value>,
    #[serde(default, deserialize_with = "lenient")]
    pub commits: Vec<CommitRef>,
    #[serde(default, deserialize_with = "lenient")]
    pub labels: Vec<Tag>,
    #[serde(default, deserialize_with = "lenient")]
    pub github: Vec<GithubLink>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub merged: Vec<Merged>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GithubLink {
    pub kind: String,
    pub rel: String,
    pub repo: String,
    pub number: i64,
    pub url: String,
    #[serde(default, deserialize_with = "lenient")]
    pub at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Merged {
    pub key: String,
    #[serde(default, deserialize_with = "lenient")]
    pub title: String,
    #[serde(default, deserialize_with = "lenient")]
    pub host: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub reporter: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Merge {
    pub into: String,
    #[serde(default, deserialize_with = "lenient")]
    pub merged: Vec<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub unchanged: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Deleted {
    pub key: String,
    #[serde(default, deserialize_with = "lenient")]
    pub comments: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub files: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub retrying: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub unlinked: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Author {
    #[serde(default, deserialize_with = "lenient")]
    pub email: String,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub manager: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub agent: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub via: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Comment {
    pub id: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub client_uid: String,
    #[serde(default, deserialize_with = "lenient")]
    pub author: Author,
    #[serde(default, deserialize_with = "lenient")]
    pub body: String,
    #[serde(default, deserialize_with = "lenient")]
    pub internal: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub attachments: Vec<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub client_uid: String,
    #[serde(default, deserialize_with = "lenient")]
    pub role: String,
    #[serde(default, deserialize_with = "lenient")]
    pub mark: Option<i64>,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient", rename = "type")]
    pub content_type: String,
    #[serde(default, deserialize_with = "lenient")]
    pub bytes: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub sha256: String,
    #[serde(default, deserialize_with = "lenient")]
    pub comment_id: Option<i64>,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Event {
    #[serde(default, deserialize_with = "lenient")]
    pub actor: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub actor_name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub agent: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub via: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub kind: String,
    #[serde(default, deserialize_with = "lenient")]
    pub detail: Value,
    #[serde(default, deserialize_with = "lenient")]
    pub at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IssueList {
    #[serde(default, deserialize_with = "lenient")]
    pub issues: Vec<Summary>,
    #[serde(default, deserialize_with = "lenient")]
    pub next_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Thread {
    pub issue: Issue,
    #[serde(default, deserialize_with = "lenient")]
    pub comments: Vec<Comment>,
    #[serde(default, deserialize_with = "lenient")]
    pub attachments: Vec<Attachment>,
    #[serde(default, deserialize_with = "lenient")]
    pub events: Vec<Event>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
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
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub host: Option<String>,
    pub kind: String,
    pub title: String,
    #[serde(default, deserialize_with = "lenient")]
    pub body: String,
    #[serde(default, deserialize_with = "lenient")]
    pub page: PageRef,
    #[serde(default, deserialize_with = "lenient")]
    pub context: Value,
    #[serde(default, deserialize_with = "lenient")]
    pub marks: Vec<Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignee {
    #[serde(default, deserialize_with = "lenient")]
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
    #[serde(default, deserialize_with = "lenient")]
    pub manager: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Change {
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub resolution: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub duplicate_of: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub body: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub labels: Option<LabelEdit>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListQuery {
    #[serde(default = "mine")]
    pub scope: String,
    #[serde(default, deserialize_with = "lenient")]
    pub path: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub status: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub q: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub cursor: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub host: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
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
    #[serde(default, deserialize_with = "lenient")]
    pub env: String,
    #[serde(default, deserialize_with = "lenient")]
    pub config: Value,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnvEntry {
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub kind: String,
    #[serde(default, deserialize_with = "lenient")]
    pub position: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub notify: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Code {
    pub id: i64,
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub email: String,
    #[serde(default, deserialize_with = "lenient")]
    pub hosts: Vec<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub manager: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub hint: String,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub created_by: String,
    #[serde(default, deserialize_with = "lenient")]
    pub revoked_at: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub last_used_at: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub totp: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NewCode {
    pub client_uid: String,
    pub name: String,
    pub email: String,
    pub hosts: Vec<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub manager: bool,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub totp: bool,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub mail: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Minted {
    pub code: Code,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub secret: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub links: Vec<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub totp_key: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub totp: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub mail: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub revoked: Option<Code>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Relink {
    pub client_uid: String,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub new_totp: bool,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "std::ops::Not::not"
    )]
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
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub env: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub items: Vec<BuildItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BuildItem {
    pub id: i64,
    pub rel: String,
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Owner {
    #[serde(default, deserialize_with = "lenient")]
    pub username: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lane {
    pub label: String,
    #[serde(default, deserialize_with = "lenient")]
    pub closes: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneBoard {
    pub id: i64,
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub owner: Option<Owner>,
    #[serde(default, deserialize_with = "lenient")]
    pub mine: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub cards: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub columns: Vec<Lane>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneBoards {
    #[serde(default, deserialize_with = "lenient")]
    pub boards: Vec<LaneBoard>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaneCard {
    pub key: String,
    #[serde(default, deserialize_with = "lenient")]
    pub kind: String,
    pub title: String,
    pub label: String,
    #[serde(default, deserialize_with = "lenient")]
    pub assignee: Option<Owner>,
    #[serde(default, deserialize_with = "lenient")]
    pub order: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelUse {
    pub id: i64,
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub owner_username: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LabelEntry {
    pub id: i64,
    pub name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub closes: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub boards: Vec<LabelUse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MoveTo {
    pub key: String,
    pub from: String,
    pub to: String,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub board: Option<i64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub before: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub after: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MovedCard {
    pub card: LaneCard,
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
    #[serde(default, deserialize_with = "lenient")]
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportTally {
    #[serde(default, deserialize_with = "lenient")]
    pub new: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub existing: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportReport {
    #[serde(default, deserialize_with = "lenient")]
    pub dry_run: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub counts: std::collections::BTreeMap<String, ImportTally>,
    #[serde(default, deserialize_with = "lenient")]
    pub upload: Vec<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub managers: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DuplicateLinks {
    #[serde(default, deserialize_with = "lenient")]
    pub linked: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportFinish {
    #[serde(default, deserialize_with = "lenient")]
    pub recounted: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub duplicates: DuplicateLinks,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn via_reads_on_people_authors_and_events_and_defaults_to_none() {
        let summary: Summary = serde_json::from_value(serde_json::json!({
            "id": 7, "key": "BUG-7", "kind": "bug", "title": "t",
            "reporter": {"email": "ada@example.com", "name": "Ada Lovelace", "agent": true, "via": "pci"}
        }))
        .unwrap();
        assert!(summary.reporter.agent);
        assert_eq!(summary.reporter.via.as_deref(), Some("pci"));
        let author: Author =
            serde_json::from_str(r#"{"name":"Ada Lovelace","agent":true,"via":"pci·splicer"}"#)
                .unwrap();
        assert_eq!(author.via.as_deref(), Some("pci·splicer"));
        let event: Event =
            serde_json::from_str(r#"{"kind":"label","agent":true,"via":"pci","at":"x"}"#).unwrap();
        assert!(event.agent);
        assert_eq!(event.via.as_deref(), Some("pci"));
        let old: Event = serde_json::from_str(r#"{"kind":"label","at":"x"}"#).unwrap();
        assert!(!old.agent);
        assert_eq!(old.via, None);
        let person: Person =
            serde_json::from_str(r#"{"name":"Grace Hopper","agent":false,"via":null}"#).unwrap();
        assert_eq!(person.via, None);
    }

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
    fn null_optional_fields_read_as_absent_in_a_list_and_a_thread() {
        let list: IssueList = serde_json::from_value(serde_json::json!({
            "issues": [{
                "id": 12, "key": "BUG-12", "kind": "bug", "title": "Null fields",
                "status": null, "stage": null, "label": null, "host": null, "env": null,
                "page": null, "reporter": {"email": null, "name": null, "agent": null},
                "assignee": {"username": null}, "created_at": null, "updated_at": null,
                "comments": null, "attachments": null, "unread": null,
                "landing": {"branch": null, "envs": null}, "labels": null
            }],
            "next_cursor": null
        }))
        .unwrap();
        let item = &list.issues[0];
        assert_eq!(item.key, "BUG-12");
        assert_eq!(item.assignee, None);
        assert_eq!(item.status, "");
        assert_eq!(item.comments, 0);
        assert!(!item.unread && item.labels.is_empty() && item.landing.envs.is_empty());
        assert_eq!(item.reporter.email, "");
        assert_eq!(list.next_cursor, None);

        let thread: Thread = serde_json::from_value(serde_json::json!({
            "issue": {"id": 3, "key": "BUG-3", "kind": "bug", "title": "T", "assignee": null,
                      "body": null, "marks": null, "commits": null, "github": null, "merged": null},
            "comments": [{"id": 1, "author": null, "body": null, "internal": null, "attachments": null}],
            "attachments": null,
            "events": [{"actor": null, "kind": null, "detail": null, "at": null}],
            "people": null
        }))
        .unwrap();
        assert_eq!(thread.issue.assignee, None);
        assert_eq!(thread.issue.body, "");
        assert_eq!(thread.comments[0].author.email, "");
        assert_eq!(thread.events[0].kind, "");
        assert!(thread.attachments.is_empty() && thread.people.is_empty());
    }

    #[test]
    fn an_assignee_reads_whole_and_an_empty_or_missing_username_is_unassigned() {
        let read = |assignee: serde_json::Value| {
            serde_json::from_value::<Summary>(serde_json::json!({
                "id": 1, "key": "BUG-1", "kind": "bug", "title": "T", "assignee": assignee
            }))
            .unwrap()
            .assignee
        };
        assert_eq!(
            read(serde_json::json!({"username": "ada.lovelace"})),
            Some(Assignee::new("ada.lovelace"))
        );
        assert_eq!(read(serde_json::json!({"username": ""})), None);
        assert_eq!(read(serde_json::json!({})), None);
        assert_eq!(read(serde_json::Value::Null), None);
        let missing: Summary = serde_json::from_value(
            serde_json::json!({"id": 1, "key": "BUG-1", "kind": "bug", "title": "T"}),
        )
        .unwrap();
        assert_eq!(missing.assignee, None);
    }

    #[test]
    fn a_null_required_field_or_a_wrong_type_is_still_refused() {
        let null_title = serde_json::json!({"id": 1, "key": "BUG-1", "kind": "bug", "title": null});
        assert!(serde_json::from_value::<Summary>(null_title).is_err());
        let wrong = serde_json::json!({"id": 1, "key": "BUG-1", "kind": "bug", "title": "T", "comments": "two"});
        assert!(serde_json::from_value::<Summary>(wrong).is_err());
        let username = serde_json::json!({"id": 1, "key": "BUG-1", "kind": "bug", "title": "T", "assignee": {"username": 7}});
        assert!(serde_json::from_value::<Summary>(username).is_err());
    }

    #[test]
    fn the_resolutions_are_the_workers() {
        let boards = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/worker/src/boards.js"));
        let resolutions: Vec<String> = RESOLUTIONS.iter().map(|s| format!("\"{s}\"")).collect();
        let line = format!("export const RESOLUTIONS = [{}];", resolutions.join(", "));
        assert!(boards.contains(&line), "{line}");
    }
}

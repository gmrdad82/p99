use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub status: String,
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
    pub assignee: Option<String>,
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
    pub status: String,
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
    pub assignee: Option<String>,
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
pub const STATUSES: [&str; 7] = [
    "new",
    "confirmed",
    "in_progress",
    "waiting",
    "resolved",
    "abandoned",
    "duplicate",
];
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
        "new" => "New",
        "confirmed" => "Confirmed",
        "in_progress" => "In progress",
        "waiting" => "Waiting",
        "resolved" => "Resolved",
        "abandoned" => "Dropped",
        "duplicate" => "Duplicate",
        other => other,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Change {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
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
    matches!(status, "new" | "confirmed" | "in_progress" | "waiting")
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NewCode {
    pub name: String,
    pub email: String,
    pub hosts: Vec<String>,
    #[serde(default)]
    pub manager: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Minted {
    pub code: Code,
    pub secret: String,
    #[serde(default)]
    pub links: Vec<String>,
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
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_PROJECT_CHARS: usize = 40;
pub const MAX_VIA_CHARS: usize = 80;
pub const MAX_REF_CHARS: usize = 200;
pub const MAX_NOTE_CHARS: usize = 200;
pub const DEFAULT_LIMIT: u32 = 200;
pub const MAX_LIMIT: u32 = 500;
pub const ROBOT: &str = "🤖";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "kebab-case")]
pub enum Lane {
    New,
    Planned,
    InProgress,
    Stuck,
    Landed,
    Done,
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
    pub project: String,
    pub status: Lane,
    pub label: String,
    pub lane: Option<u32>,
    pub title: String,
    pub host: String,
    pub reporter: Person,
    pub created_at: String,
    pub changed_at: String,
    pub changed_by: Person,
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
    pub host: String,
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
    pub project: Option<String>,
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

pub fn since(text: &str, now: i64) -> Result<String, String> {
    todo!("{text} {now}")
}

pub fn query(q: &CardQuery) -> String {
    todo!("{q:?}")
}

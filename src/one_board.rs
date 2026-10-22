use serde::{Deserialize, Serialize};

use crate::card::{Card, Lane, Person, Source};
use crate::wire::{LaneCard, Owner};

pub const DEPRECATED: &str = "p99 boards is deprecated: one board per account since 1.10; p99 board prints it";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaneInfo {
    pub word: Lane,
    pub label: String,
    #[serde(default)]
    pub closes: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lanes {
    #[serde(default)]
    pub lanes: Vec<LaneInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardCard {
    pub key: String,
    pub kind: String,
    #[serde(default)]
    pub project: Option<String>,
    pub status: Lane,
    pub label: String,
    #[serde(default)]
    pub lane: Option<u32>,
    pub title: String,
    pub host: String,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    pub changed_at: String,
    #[serde(default)]
    pub changed_by: Option<Person>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OneBoard {
    pub board: Lanes,
    #[serde(default)]
    pub cards: Vec<BoardCard>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ArchivedBoard {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub owner: Option<Owner>,
    #[serde(default)]
    pub columns: Vec<crate::wire::Lane>,
    #[serde(default)]
    pub cards: Vec<LaneCard>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OldBoards {
    pub deprecated: String,
    pub board: Lanes,
    #[serde(default)]
    pub cards: Vec<BoardCard>,
    #[serde(default)]
    pub archived: Vec<ArchivedBoard>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waiting {
    pub count: u64,
    #[serde(default)]
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BoardQuery {
    pub projects: Vec<String>,
    pub host: Option<String>,
    pub source: Option<Source>,
    pub statuses: Vec<Lane>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    #[value(alias = "manager")]
    Owner,
    #[value(alias = "person", alias = "reporter")]
    User,
}

impl Role {
    pub fn of(manager: bool) -> Role {
        if manager { Role::Owner } else { Role::User }
    }

    pub fn word(self) -> &'static str {
        match self {
            Role::Owner => "Owner",
            Role::User => "User",
        }
    }
}

pub fn query(q: &BoardQuery) -> String {
    let mut pairs: Vec<(&str, String)> = Vec::new();
    for name in &q.projects {
        pairs.push(("project", name.clone()));
    }
    if let Some(host) = &q.host {
        pairs.push(("host", host.clone()));
    }
    if let Some(source) = q.source {
        pairs.push(("source", source.word().to_owned()));
    }
    for lane in &q.statuses {
        pairs.push(("status", lane.word().to_owned()));
    }
    let parts: Vec<String> = pairs
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}={}", crate::client::encode(v)))
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

use serde_json::Value;

use crate::config::Config;
use crate::sign::Actor;
use crate::wire::{
    Attachment, Build, Change, Code, Comment, Counts, Download, EnvEntry, HostEntry, Issue,
    IssueList, ListQuery, Minted, NewCode, NewIssue, Thread,
};

#[derive(Debug, Clone)]
pub struct Client {
    pub url: String,
    pub key_id: String,
    key: Vec<u8>,
    pub actor: Actor,
}

impl Client {
    pub fn for_account(
        config: &Config,
        account: &str,
        agent: Option<String>,
    ) -> Result<Client, String> {
        let entry = config
            .accounts
            .get(account)
            .ok_or_else(|| format!("no account is called {account}"))?;
        let key = crate::config::secret(&entry.key)?.into_bytes();
        let actor = Actor {
            email: config.me.email.clone(),
            name: config.me.name.clone(),
            rank: "super_administrator".to_owned(),
            agent,
            person: config.me.email.clone(),
        };
        Ok(Client {
            url: config.url(account)?,
            key_id: entry.key_id.clone(),
            key,
            actor,
        })
    }

    pub fn health(&self) -> Result<Value, String> {
        Err(unbuilt())
    }

    pub fn counts(&self, _host: &str, _path: Option<&str>) -> Result<Counts, String> {
        Err(unbuilt())
    }

    pub fn list(&self, _query: &ListQuery) -> Result<IssueList, String> {
        Err(unbuilt())
    }

    pub fn thread(&self, _key: &str) -> Result<Thread, String> {
        Err(unbuilt())
    }

    pub fn file(&self, _issue: &NewIssue) -> Result<Issue, String> {
        Err(unbuilt())
    }

    pub fn change(&self, _key: &str, _change: &Change) -> Result<Issue, String> {
        Err(unbuilt())
    }

    pub fn comment(&self, _key: &str, _body: &str, _internal: bool) -> Result<Comment, String> {
        Err(unbuilt())
    }

    pub fn attach(
        &self,
        _key: &str,
        _name: &str,
        _role: &str,
        _bytes: &[u8],
        _comment: Option<i64>,
    ) -> Result<Attachment, String> {
        Err(unbuilt())
    }

    pub fn download(&self, _id: i64) -> Result<Download, String> {
        Err(unbuilt())
    }

    pub fn hosts(&self) -> Result<Vec<HostEntry>, String> {
        Err(unbuilt())
    }

    pub fn put_host(&self, _host: &str, _env: &str, _config: &Value) -> Result<HostEntry, String> {
        Err(unbuilt())
    }

    pub fn remove_host(&self, _host: &str) -> Result<(), String> {
        Err(unbuilt())
    }

    pub fn envs(&self) -> Result<Vec<EnvEntry>, String> {
        Err(unbuilt())
    }

    pub fn put_env(&self, _env: &EnvEntry) -> Result<EnvEntry, String> {
        Err(unbuilt())
    }

    pub fn codes(&self, _host: Option<&str>) -> Result<Vec<Code>, String> {
        Err(unbuilt())
    }

    pub fn mint(&self, _code: &NewCode) -> Result<Minted, String> {
        Err(unbuilt())
    }

    pub fn revoke(&self, _id: i64) -> Result<Code, String> {
        Err(unbuilt())
    }

    pub fn announce(&self, _build: &Build) -> Result<(), String> {
        Err(unbuilt())
    }
}

fn unbuilt() -> String {
    "the client is not built yet".to_owned()
}

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::config::Config;
use crate::sign::{Actor, encode_actor, sign};
use crate::stream::{Opening, Stream, Trouble, websocket_base};
use crate::wire::{
    Attachment, BoardSpec, BoardView, Boards, Build, Change, Code, Comment, Download, EnvEntry,
    HostEntry, ImportFinish, ImportReport, Issue, IssueList, LabelEntry, LaneBoard, LaneBoards,
    LanePage, ListQuery, Member, Minted, Move, MoveTo, Moved, MovedCard, NewCode, NewIssue, Thread,
};

const KEY_ID: &str = "p99";
const TIMEOUT: Duration = Duration::from_secs(10);
const TRANSFER: Duration = Duration::from_secs(60);
const ANSWER_LIMIT: u64 = 32 << 20;
pub const NO_PUSH: &str = "this Worker has no push yet; run p99 deploy";

#[derive(Clone)]
pub struct Client {
    account: String,
    bases: Arc<[String]>,
    target: Option<usize>,
    answered: Arc<AtomicUsize>,
    key: Vec<u8>,
    pub actor: Actor,
    pub host: Option<String>,
    access: Option<(String, String)>,
    quick: ureq::Agent,
    slow: ureq::Agent,
}

struct Reply {
    status: u16,
    content_type: String,
    disposition: String,
    bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Answer,
    Access,
    Moved(String),
    Foreign,
}

impl Client {
    pub fn for_account(config: &Config, account: &str, agent: bool) -> Result<Client, String> {
        let entry = config
            .accounts
            .get(account)
            .ok_or_else(|| format!("no account is called {account}"))?;
        let key = crate::config::secret(&entry.key)?.into_bytes();
        let access = match (&entry.access_client_id, &entry.access_client_secret) {
            (None, None) => None,
            (Some(id), Some(secret)) => Some((id.clone(), crate::config::secret(secret)?)),
            _ => {
                return Err(format!(
                    "the account {account} needs both access_client_id and access_client_secret, or neither"
                ));
            }
        };
        let me = config.me_for(account);
        let actor = Actor {
            agent: crate::config::agent(agent, &me),
            email: me.email,
            name: me.name,
        };
        Ok(Client {
            account: account.to_owned(),
            bases: config.bases(account, None)?.into(),
            target: None,
            answered: Arc::new(AtomicUsize::new(0)),
            key,
            actor,
            host: None,
            access,
            quick: http(TIMEOUT),
            slow: http(TRANSFER),
        })
    }

    pub fn with_host(mut self, host: Option<&str>) -> Client {
        self.host = host.map(str::to_owned);
        self.aimed(host)
    }

    pub fn aimed(mut self, host: Option<&str>) -> Client {
        if let Some(host) = host {
            let base = format!("https://{host}/_p99");
            if let Some(at) = self.bases.iter().position(|b| *b == base) {
                self.target = Some(at);
            }
        }
        self
    }

    fn order(&self) -> Vec<usize> {
        let mut order: Vec<usize> = Vec::with_capacity(self.bases.len());
        let answered = self.answered.load(Ordering::Relaxed);
        for first in [answered.checked_sub(1), self.target].into_iter().flatten() {
            if first < self.bases.len() && !order.contains(&first) {
                order.push(first);
            }
        }
        order.extend(
            (0..self.bases.len())
                .filter(|at| !order.contains(at))
                .collect::<Vec<_>>(),
        );
        order
    }

    pub fn list(&self, q: &ListQuery) -> Result<IssueList, String> {
        let mut pairs = vec![
            ("host", q.host.clone()),
            ("scope", Some(q.scope.clone())),
            ("path", q.path.clone()),
            ("status", q.status.clone()),
            ("kind", q.kind.clone()),
            ("q", q.q.clone()),
            ("cursor", q.cursor.clone()),
            ("limit", Some(q.limit.clamp(1, 100).to_string())),
        ];
        pairs.extend(q.label.iter().map(|l| ("label", Some(l.clone()))));
        let pq = format!("/v1/issues{}", query(&pairs));
        self.json("GET", &pq, None)
    }

    pub fn label_list(&self) -> Result<Vec<LabelEntry>, String> {
        let list: Value = self.json("GET", &self.scoped("/v1/labels"), None)?;
        field(list, "labels")
    }

    pub fn rename_label(&self, id: i64, name: &str) -> Result<LabelEntry, String> {
        self.json(
            "PATCH",
            &format!("/v1/labels/{id}"),
            Some(json!({ "name": name })),
        )
    }

    pub fn lanes(&self) -> Result<LaneBoards, String> {
        self.json("GET", &self.scoped("/v1/boards"), None)
    }

    pub fn lane(&self, id: i64) -> Result<LanePage, String> {
        self.json("GET", &self.scoped(&format!("/v1/boards/{id}")), None)
    }

    pub fn add_lane_board(&self, spec: &BoardSpec) -> Result<LaneBoard, String> {
        let body = serde_json::to_value(spec).map_err(|e| e.to_string())?;
        self.json("POST", &self.scoped("/v1/boards"), Some(body))
    }

    pub fn set_lane_board(&self, id: i64, spec: &BoardSpec) -> Result<LaneBoard, String> {
        let body = serde_json::to_value(spec).map_err(|e| e.to_string())?;
        self.json("PUT", &self.scoped(&format!("/v1/boards/{id}")), Some(body))
    }

    pub fn move_to(&self, request: &MoveTo) -> Result<MovedCard, String> {
        let body = serde_json::to_value(request).map_err(|e| e.to_string())?;
        self.json("POST", &self.scoped("/v1/move"), Some(body))
    }

    pub fn thread(&self, key: &str) -> Result<Thread, String> {
        self.json("GET", &self.item(key, "")?, None)
    }

    pub fn file(&self, issue: &NewIssue) -> Result<Issue, String> {
        let pq = format!("/v1/issues{}", query(&[("host", issue.host.clone())]));
        let body = serde_json::to_value(issue).map_err(|e| e.to_string())?;
        self.json("POST", &pq, Some(body))
    }

    pub fn change(&self, key: &str, change: &Change) -> Result<Issue, String> {
        let body = serde_json::to_value(change).map_err(|e| e.to_string())?;
        self.json("PATCH", &self.item(key, "")?, Some(body))
    }

    pub fn comment(&self, key: &str, body: &str, internal: bool) -> Result<Comment, String> {
        let body = json!({"client_uid": uid(), "body": body, "internal": internal});
        self.json("POST", &self.item(key, "/comments")?, Some(body))
    }

    pub fn attach(
        &self,
        key: &str,
        name: &str,
        content_type: &str,
        bytes: &[u8],
        comment: Option<i64>,
    ) -> Result<Attachment, String> {
        let pairs = vec![
            ("host", self.host.clone()),
            ("name", Some(name.to_owned())),
            ("role", Some("file".to_owned())),
            ("comment", comment.map(|c| c.to_string())),
        ];
        let pq = format!(
            "/v1/issues/{}/attachments/{}{}",
            segment(key)?,
            uid(),
            query(&pairs)
        );
        let reply = self.send_as("PUT", &pq, Some(content_type), bytes, TRANSFER)?;
        parse(&reply)
    }

    pub fn download(&self, id: i64) -> Result<Download, String> {
        let pq = format!("/v1/files/{id}{}", query(&[("host", self.host.clone())]));
        let reply = self.send("GET", &pq, true, false, &[], TRANSFER)?;
        let name = filename(&reply.disposition).unwrap_or_else(|| format!("file-{id}"));
        let content_type = if reply.content_type.is_empty() {
            "application/octet-stream".to_owned()
        } else {
            reply.content_type
        };
        Ok(Download {
            name,
            content_type,
            bytes: reply.bytes,
        })
    }

    pub fn merge(&self, items: &[String], into: &str) -> Result<crate::wire::Merge, String> {
        let pq = format!("/v1/merge{}", query(&[("host", self.host.clone())]));
        self.json("POST", &pq, Some(json!({"items": items, "into": into})))
    }

    pub fn delete_item(&self, key: &str) -> Result<crate::wire::Deleted, String> {
        self.json("DELETE", &self.item(key, "")?, None)
    }

    pub fn hosts(&self) -> Result<Vec<HostEntry>, String> {
        let list: Value = self.json("GET", "/v1/hosts", None)?;
        field(list, "hosts")
    }

    pub fn put_host(&self, host: &str, env: &str, config: &Value) -> Result<HostEntry, String> {
        let pq = format!("/v1/hosts/{}", segment(host)?);
        self.json("PUT", &pq, Some(json!({"env": env, "config": config})))
    }

    pub fn remove_host(&self, host: &str) -> Result<(), String> {
        let pq = format!("/v1/hosts/{}", segment(host)?);
        self.send("DELETE", &pq, true, false, &[], TIMEOUT)
            .map(|_| ())
    }

    pub fn delete(&self, pq: &str) -> Result<(), String> {
        self.send("DELETE", pq, true, false, &[], TIMEOUT)
            .map(|_| ())
    }

    pub fn envs(&self) -> Result<Vec<EnvEntry>, String> {
        let list: Value = self.json("GET", "/v1/envs", None)?;
        field(list, "envs")
    }

    pub fn put_env(&self, env: &EnvEntry) -> Result<EnvEntry, String> {
        let pq = format!("/v1/envs/{}", segment(&env.name)?);
        let body = json!({"kind": env.kind, "position": env.position, "notify": env.notify});
        self.json("PUT", &pq, Some(body))
    }

    pub fn codes(&self, host: Option<&str>) -> Result<Vec<Code>, String> {
        let pq = format!("/v1/codes{}", query(&[("host", host.map(str::to_owned))]));
        let list: Value = self.json("GET", &pq, None)?;
        field(list, "codes")
    }

    pub fn mint(&self, code: &NewCode) -> Result<Minted, String> {
        let body = serde_json::to_value(code).map_err(|e| e.to_string())?;
        self.json("POST", "/v1/codes", Some(body))
    }

    pub fn relink(&self, id: i64, relink: &crate::wire::Relink) -> Result<Minted, String> {
        let body = serde_json::to_value(relink).map_err(|e| e.to_string())?;
        self.json("POST", &format!("/v1/codes/{id}/relink"), Some(body))
    }

    pub fn revoke(&self, id: i64) -> Result<Code, String> {
        self.json("POST", &format!("/v1/codes/{id}/revoke"), None)
    }

    pub fn people(&self) -> Result<Vec<Member>, String> {
        let pq = format!("/v1/people{}", query(&[("host", self.host.clone())]));
        let list: Value = self.json("GET", &pq, None)?;
        field(list, "people")
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<serde_json::Value, String> {
        self.json(
            "POST",
            "/v1/people/rename",
            Some(serde_json::json!({ "from": from, "to": to })),
        )
    }

    pub fn totp(&self, id: i64) -> Result<crate::wire::TotpKey, String> {
        self.json("POST", &format!("/v1/codes/{id}/totp"), None)
    }

    pub fn announce(&self, build: &Build) -> Result<(), String> {
        let body = serde_json::to_vec(build).map_err(|e| e.to_string())?;
        self.send("POST", "/v1/builds", false, false, &body, TIMEOUT)
            .map(|_| ())
    }

    pub fn import(
        &self,
        host: &str,
        dry_run: bool,
        records: &[Value],
    ) -> Result<ImportReport, String> {
        let pq = format!(
            "/v1/import{}",
            query(&[
                ("host", Some(host.to_owned())),
                ("dry_run", Some(if dry_run { "1" } else { "0" }.to_owned())),
            ])
        );
        let body = serde_json::to_vec(records).map_err(|e| e.to_string())?;
        let reply = self.send_as("POST", &pq, None, &body, TRANSFER)?;
        parse(&reply)
    }

    pub fn import_file(
        &self,
        host: &str,
        uid: &str,
        params: &[(&str, Option<String>)],
        content_type: &str,
        bytes: &[u8],
    ) -> Result<Attachment, String> {
        let mut pairs = vec![("host", Some(host.to_owned()))];
        pairs.extend(params.iter().cloned());
        let pq = format!("/v1/import/attachments/{}{}", segment(uid)?, query(&pairs));
        let reply = self.send_as("PUT", &pq, Some(content_type), bytes, TRANSFER)?;
        parse(&reply)
    }

    pub fn import_finish(
        &self,
        host: &str,
        items: &[String],
        duplicates: &[Value],
    ) -> Result<ImportFinish, String> {
        let pq = format!(
            "/v1/import/finish{}",
            query(&[("host", Some(host.to_owned()))])
        );
        let body = serde_json::to_vec(&json!({"items": items, "duplicates": duplicates}))
            .map_err(|e| e.to_string())?;
        let reply = self.send_as("POST", &pq, None, &body, TRANSFER)?;
        parse(&reply)
    }

    pub fn boards(&self) -> Result<Boards, String> {
        self.json("GET", &self.scoped("/v1/boards"), None)
    }

    pub fn board(&self, slug: &str) -> Result<BoardView, String> {
        let pq = self.scoped(&format!("/v1/boards/{}", segment(slug)?));
        self.json("GET", &pq, None)
    }

    pub fn move_card(&self, request: &Move) -> Result<Moved, String> {
        let body = serde_json::to_value(request).map_err(|e| e.to_string())?;
        self.json("POST", &self.scoped("/v1/move"), Some(body))
    }

    fn scoped(&self, path: &str) -> String {
        format!("{path}{}", query(&[("host", self.host.clone())]))
    }

    pub(crate) fn item(&self, key: &str, tail: &str) -> Result<String, String> {
        Ok(format!(
            "/v1/issues/{}{tail}{}",
            segment(key)?,
            query(&[("host", self.host.clone())])
        ))
    }

    pub(crate) fn json<T: DeserializeOwned>(
        &self,
        method: &str,
        pq: &str,
        body: Option<Value>,
    ) -> Result<T, String> {
        let bytes = match body {
            Some(value) => serde_json::to_vec(&value).map_err(|e| e.to_string())?,
            None => Vec::new(),
        };
        let reply = self.send(method, pq, true, false, &bytes, TIMEOUT)?;
        parse(&reply)
    }

    fn headers(
        &self,
        base: &str,
        ts: i64,
        method: &str,
        pq: &str,
        actor: bool,
        body: &[u8],
    ) -> Vec<(&'static str, String)> {
        let actor_header = if actor {
            encode_actor(&self.actor)
        } else {
            String::new()
        };
        let signed = sign(
            &self.key,
            ts,
            method,
            &signed_path(base, pq),
            &actor_header,
            body,
        );
        let mut headers = vec![("X-P99-Key-Id", KEY_ID.to_owned())];
        if actor {
            headers.push(("X-P99-Actor", actor_header));
        }
        headers.push(("X-Content-SHA256", signed.content_sha256));
        headers.push(("X-P99-Auth", signed.auth));
        headers
    }

    fn send(
        &self,
        method: &str,
        pq: &str,
        actor: bool,
        unsigned: bool,
        body: &[u8],
        timeout: Duration,
    ) -> Result<Reply, String> {
        self.send_with(method, pq, actor, unsigned, None, body, timeout)
    }

    fn send_as(
        &self,
        method: &str,
        pq: &str,
        content_type: Option<&str>,
        body: &[u8],
        timeout: Duration,
    ) -> Result<Reply, String> {
        self.send_with(method, pq, true, false, content_type, body, timeout)
    }

    #[allow(clippy::too_many_arguments)]
    fn send_with(
        &self,
        method: &str,
        pq: &str,
        actor: bool,
        unsigned: bool,
        content_type: Option<&str>,
        body: &[u8],
        timeout: Duration,
    ) -> Result<Reply, String> {
        let agent = if timeout > TIMEOUT {
            &self.slow
        } else {
            &self.quick
        };
        let mut moved: Option<(String, String)> = None;
        for at in self.order() {
            let base = &self.bases[at];
            let url = format!("{base}{pq}");
            let mut request = ureq::http::Request::builder().method(method).uri(&url);
            if !unsigned {
                for (name, value) in self.headers(base, now(), method, pq, actor, body) {
                    request = request.header(name, value);
                }
            }
            if let Some((id, secret)) = &self.access {
                request = request
                    .header("CF-Access-Client-Id", id)
                    .header("CF-Access-Client-Secret", secret);
            }
            if !body.is_empty() {
                let kind = match content_type {
                    Some(kind) => kind,
                    None if method == "PUT" => "application/octet-stream",
                    None => "application/json",
                };
                request = request.header("Content-Type", kind);
            }
            let sent = if body.is_empty() {
                agent.run(request.body(()).map_err(|e| e.to_string())?)
            } else {
                agent.run(request.body(body.to_vec()).map_err(|e| e.to_string())?)
            };
            let mut response = sent.map_err(|e| format!("cannot reach {base}: {e}"))?;
            let status = response.status().as_u16();
            let header = |name: &str| {
                response
                    .headers()
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_owned()
            };
            let content_type = header("content-type");
            let disposition = header("content-disposition");
            let location = header("location");
            match classify(status, &content_type, &location) {
                Outcome::Answer => {}
                Outcome::Access => continue,
                Outcome::Moved(to) => {
                    moved.get_or_insert((host_of(base).to_owned(), to));
                    continue;
                }
                Outcome::Foreign => {
                    moved.get_or_insert((host_of(base).to_owned(), String::new()));
                    continue;
                }
            }
            self.answered.store(at + 1, Ordering::Relaxed);
            let bytes = response
                .body_mut()
                .with_config()
                .limit(ANSWER_LIMIT)
                .read_to_vec()
                .map_err(|e| format!("cannot read the answer of {base}: {e}"))?;
            let reply = Reply {
                status,
                content_type,
                disposition,
                bytes,
            };
            return if (200..300).contains(&status) {
                Ok(reply)
            } else {
                Err(problem(&reply))
            };
        }
        Err(self.lost(moved))
    }

    fn lost(&self, moved: Option<(String, String)>) -> String {
        match moved {
            Some((host, to)) if to.is_empty() => {
                format!("{host} answered with a web page instead of answering as P99")
            }
            Some((host, to)) => format!(
                "{host} redirected to {} instead of answering as P99",
                crate::wire::clean(&to)
            ),
            None => format!(
                "every host of the account {} is behind Cloudflare Access, which answered with its login; set `url` for the account to a host that isn't, or set access_client_id and access_client_secret (docs/config.md)",
                self.account
            ),
        }
    }

    pub fn stream(&self, host: Option<&str>) -> Result<Stream, Trouble> {
        let pq = format!("/v1/stream{}", query(&[("host", host.map(str::to_owned))]));
        let mut moved: Option<(String, String)> = None;
        for at in self.order() {
            let base = &self.bases[at];
            let mut headers = self.headers(base, now(), "GET", &pq, true, &[]);
            if let Some((id, secret)) = &self.access {
                headers.push(("CF-Access-Client-Id", id.clone()));
                headers.push(("CF-Access-Client-Secret", secret.clone()));
            }
            let url = format!("{}{pq}", websocket_base(base));
            let refused = match crate::stream::open(&url, &headers) {
                Ok(stream) => {
                    self.answered.store(at + 1, Ordering::Relaxed);
                    return Ok(stream);
                }
                Err(Opening::Failed(why)) => {
                    return Err(Trouble::Passing(format!("cannot reach {base}: {why}")));
                }
                Err(Opening::Refused(refused)) => refused,
            };
            match classify(refused.status, &refused.content_type, &refused.location) {
                Outcome::Answer => {}
                Outcome::Access => continue,
                Outcome::Moved(to) => {
                    moved.get_or_insert((host_of(base).to_owned(), to));
                    continue;
                }
                Outcome::Foreign => {
                    moved.get_or_insert((host_of(base).to_owned(), String::new()));
                    continue;
                }
            }
            self.answered.store(at + 1, Ordering::Relaxed);
            let reply = Reply {
                status: refused.status,
                content_type: refused.content_type,
                disposition: String::new(),
                bytes: refused.body,
            };
            let said = problem(&reply);
            return Err(match reply.status {
                404 if said.starts_with("no such host") => Trouble::Fatal(said),
                404 => Trouble::Fatal(NO_PUSH.to_owned()),
                400..=428 => Trouble::Fatal(said),
                _ => Trouble::Passing(said),
            });
        }
        Err(Trouble::Fatal(self.lost(moved)))
    }
}

fn signed_path(base: &str, pq: &str) -> String {
    let rest = base.split_once("://").map_or(base, |(_, rest)| rest);
    let prefix = rest.find('/').map_or("", |at| &rest[at..]);
    format!("{}{pq}", prefix.trim_end_matches('/'))
}

fn host_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#']).next().unwrap_or(rest)
}

pub fn is_access(location: &str) -> bool {
    host_of(location).ends_with(".cloudflareaccess.com") || location.contains("/cdn-cgi/access/")
}

fn classify(status: u16, content_type: &str, location: &str) -> Outcome {
    if (300..400).contains(&status) {
        if is_access(location) {
            return Outcome::Access;
        }
        return Outcome::Moved(host_of(location).to_owned());
    }
    let page = content_type
        .trim_start()
        .to_ascii_lowercase()
        .starts_with("text/html");
    if page && ((200..300).contains(&status) || matches!(status, 401 | 403 | 404)) {
        return Outcome::Foreign;
    }
    Outcome::Answer
}

fn http(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(timeout))
        .build()
        .into()
}

fn problem(reply: &Reply) -> String {
    let parsed: Value = serde_json::from_slice(&reply.bytes).unwrap_or(Value::Null);
    match parsed.get("message").and_then(Value::as_str) {
        Some(message) => format!("{} ({})", crate::wire::clean(message), reply.status),
        None => format!("the Worker answered {}", reply.status),
    }
}

fn parse<T: DeserializeOwned>(reply: &Reply) -> Result<T, String> {
    serde_json::from_slice(&reply.bytes).map_err(|e| format!("unexpected answer: {e}"))
}

fn field<T: DeserializeOwned>(mut value: Value, name: &str) -> Result<Vec<T>, String> {
    let list = value.get_mut(name).map(Value::take).unwrap_or(Value::Null);
    if list.is_null() {
        return Ok(Vec::new());
    }
    serde_json::from_value(list).map_err(|e| format!("unexpected answer: {e}"))
}

pub fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub(crate) fn query(pairs: &[(&str, Option<String>)]) -> String {
    let parts: Vec<String> = pairs
        .iter()
        .filter_map(|(k, v)| {
            v.as_ref()
                .filter(|v| !v.is_empty())
                .map(|v| format!("{k}={}", encode(v)))
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

pub(crate) fn segment(value: &str) -> Result<&str, String> {
    let ok = !value.is_empty()
        && value.len() <= 255
        && value.bytes().any(|b| b.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    if ok {
        Ok(value)
    } else {
        Err(format!("not a key, host or id: {value}"))
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn uid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seed = format!(
        "{nanos}:{}:{}",
        std::process::id(),
        COUNT.fetch_add(1, Ordering::Relaxed)
    );
    let mut bytes: Vec<u8> = Sha256::digest(seed.as_bytes())[..16].to_vec();
    if let Ok(mut random) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let mut fresh = [0u8; 16];
        if random.read_exact(&mut fresh).is_ok() {
            bytes = fresh.to_vec();
        }
    }
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    let h = crate::sign::hex(&bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn filename(disposition: &str) -> Option<String> {
    if let Some(rest) = disposition.split("filename*=").nth(1) {
        let value = rest.split(';').next()?.trim();
        let value = value.rsplit("''").next()?;
        return Some(decode(value)).filter(|n| !n.is_empty());
    }
    let rest = disposition.split("filename=").nth(1)?;
    let value = rest.split(';').next()?.trim().trim_matches('"');
    Some(value.to_owned()).filter(|n| !n.is_empty())
}

fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_signing_vector_of_the_api_docs() {
        let client = Client {
            account: "main".to_owned(),
            bases: vec!["https://example.com/_p99".to_owned()].into(),
            target: None,
            answered: Arc::new(AtomicUsize::new(0)),
            key: b"test-secret".to_vec(),
            actor: Actor {
                email: "ada@example.com".to_owned(),
                name: "Ada Lovelace".to_owned(),
                agent: false,
            },
            host: None,
            access: None,
            quick: http(TIMEOUT),
            slow: http(TRANSFER),
        };
        let body = r#"{"client_uid":"0b9c2f4e-1a2b-4c3d-8e9f-001122334455","kind":"bug","title":"The total does not update","body":"","page":{"url":"https://example.com/orders","path":"/orders","title":"Orders"},"context":{},"marks":[]}"#;
        let headers = client.headers(
            "https://example.com/_p99",
            1_760_400_000,
            "POST",
            "/v1/issues?host=example.com",
            true,
            body.as_bytes(),
        );
        let get = |name: &str| {
            headers
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| v.as_str())
                .unwrap()
        };
        assert_eq!(
            get("X-P99-Actor"),
            "eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsIm5hbWUiOiJBZGEgTG92ZWxhY2UifQ"
        );
        assert_eq!(
            get("X-Content-SHA256"),
            "ecf774eccd7e95d4a00046092fe70059b83b5d650c1a1da9e9cc6c22e5ce22bf"
        );
        assert_eq!(
            get("X-P99-Auth"),
            "v1 ts=1760400000,sig=89b1d507574a2e8bb9c58d3ba92a29eab0f03baad0e422c4882f17c8ba33505a"
        );
    }

    #[test]
    fn an_access_login_falls_through_and_other_redirects_are_named() {
        assert_eq!(
            classify(
                302,
                "",
                "https://team.cloudflareaccess.com/cdn-cgi/access/login/dev.example.com?kid=1"
            ),
            Outcome::Access
        );
        assert_eq!(
            classify(
                302,
                "",
                "https://dev.example.com/cdn-cgi/access/login?redirect_url=%2F_p99"
            ),
            Outcome::Access
        );
        assert_eq!(
            classify(301, "", "https://www.example.com/_p99/v1/hosts"),
            Outcome::Moved("www.example.com".into())
        );
        assert_eq!(
            classify(200, "text/html; charset=utf-8", ""),
            Outcome::Foreign
        );
        assert_eq!(classify(403, "application/json", ""), Outcome::Answer);
    }
}

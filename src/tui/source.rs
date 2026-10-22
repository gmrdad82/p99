use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pito_tui::Waker;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use crate::client::Client;
use crate::config::Config;
use crate::stream::Heard;
use crate::wire::{
    Change, Code, Comment, Issue, ListQuery, Summary, Thread, kind_word, status_text,
};

use super::Msg;
use super::demo::Demo;

#[derive(Debug, Clone)]
pub struct Entry {
    pub account: usize,
    pub summary: Summary,
    pub haystack: String,
}

impl Entry {
    pub fn new(account: usize, summary: Summary) -> Entry {
        let mut entry = Entry {
            account,
            summary,
            haystack: String::new(),
        };
        entry.refold();
        entry
    }

    pub fn refold(&mut self) {
        let item = &self.summary;
        self.haystack = fold(&format!(
            "{} {} {} {} {} {} {} {} {} {} {}",
            item.key,
            item.kind,
            kind_word(&item.kind),
            item.status,
            status_text(&item.status, item.resolution.as_deref()),
            item.title,
            item.host.as_deref().unwrap_or_default(),
            item.page.path,
            item.reporter.name,
            item.reporter.email,
            item.label.as_deref().unwrap_or_default()
        ));
    }
}

pub fn fold(text: &str) -> String {
    text.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn words(query: &str) -> Vec<String> {
    fold(query).split_whitespace().map(str::to_owned).collect()
}

pub fn hits(haystack: &str, words: &[String]) -> bool {
    words.iter().all(|word| haystack.contains(word.as_str()))
}

#[derive(Clone)]
pub enum Source {
    Demo(Arc<Mutex<Demo>>, Duration),
    Live(Arc<Live>),
    Broken(String),
}

pub struct Live {
    config: Config,
    accounts: Vec<String>,
    agent: bool,
    clients: OnceLock<Result<Vec<Client>, String>>,
    listeners: Mutex<Vec<Waker<Msg>>>,
}

const PAGE: i64 = 100;
const MOST: usize = 1000;

impl Source {
    pub fn demo(pace: Duration) -> Source {
        Source::Demo(Arc::new(Mutex::new(Demo::new())), pace)
    }

    pub fn live(account: Option<&str>, agent: bool) -> Source {
        let config = match Config::load() {
            Ok(config) => config,
            Err(why) => return Source::Broken(why),
        };
        let accounts: Vec<String> = match account {
            Some(name) if config.accounts.contains_key(name) => vec![name.to_owned()],
            Some(name) => return Source::Broken(format!("no account is called {name}")),
            None => config.accounts.keys().cloned().collect(),
        };
        if accounts.is_empty() {
            return Source::Broken("no account yet; p99 setup makes one".into());
        }
        Source::Live(Arc::new(Live {
            config,
            accounts,
            agent,
            clients: OnceLock::new(),
            listeners: Mutex::new(Vec::new()),
        }))
    }

    pub fn accounts(&self) -> Vec<String> {
        match self {
            Source::Demo(..) => vec!["sample".to_owned()],
            Source::Live(live) => live.accounts.clone(),
            Source::Broken(_) => Vec::new(),
        }
    }

    pub(super) fn client(&self, account: usize, host: Option<&str>) -> Result<Client, String> {
        match self {
            Source::Live(live) => live.client(account, host),
            Source::Demo(..) => Err("not the live data".into()),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn is_demo(&self) -> bool {
        matches!(self, Source::Demo(..))
    }

    pub fn now(&self) -> i64 {
        match self {
            Source::Demo(..) => super::demo::NOW,
            _ => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs() as i64),
        }
    }

    pub fn hosts(&self) -> Vec<String> {
        match self {
            Source::Demo(demo, _) => demo.lock().map(|d| d.hosts()).unwrap_or_default(),
            Source::Live(live) => live
                .config
                .hosts
                .iter()
                .filter(|(_, host)| live.accounts.contains(&host.account))
                .map(|(name, _)| name.clone())
                .collect(),
            Source::Broken(_) => Vec::new(),
        }
    }

    fn wait(&self) {
        if let Source::Demo(_, pace) = self
            && !pace.is_zero()
        {
            thread::sleep(*pace);
        }
    }

    pub(super) fn sample<T>(
        &self,
        work: impl FnOnce(&mut Demo) -> Result<T, String>,
    ) -> Result<T, String> {
        self.wait();
        match self {
            Source::Demo(demo, _) => {
                let mut demo = demo
                    .lock()
                    .map_err(|_| "the sample data broke".to_owned())?;
                work(&mut demo)
            }
            _ => Err("not the sample data".into()),
        }
    }

    pub fn inbox(&self) -> Result<Vec<Entry>, String> {
        let mut entries = match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.list()))?,
            Source::Live(live) => live.inbox()?,
            Source::Broken(why) => return Err(why.clone()),
        };
        entries.sort_by(|a, b| {
            b.summary
                .updated_at
                .cmp(&a.summary.updated_at)
                .then(b.summary.id.cmp(&a.summary.id))
        });
        Ok(entries)
    }

    pub fn thread(&self, account: usize, host: Option<&str>, key: &str) -> Result<Thread, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.thread(key)),
            Source::Live(live) => {
                let client = live.client(account, host)?;
                let (thread, people) = thread::scope(|s| {
                    let people = s.spawn(|| client.people());
                    (client.thread(key), people.join())
                });
                let mut thread = thread?;
                thread.people = people.ok().and_then(Result::ok).unwrap_or_default();
                Ok(thread)
            }
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn comment(
        &self,
        account: usize,
        host: Option<&str>,
        key: &str,
        body: &str,
        internal: bool,
    ) -> Result<Comment, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.comment(key, body, internal)),
            Source::Live(live) => live.client(account, host)?.comment(key, body, internal),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn change(
        &self,
        account: usize,
        host: Option<&str>,
        key: &str,
        change: &Change,
    ) -> Result<Issue, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.change(key, change)),
            Source::Live(live) => live.client(account, host)?.change(key, change),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn delete(
        &self,
        account: usize,
        host: Option<&str>,
        key: &str,
    ) -> Result<crate::wire::Deleted, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.delete(key)),
            Source::Live(live) => live.client(account, host)?.delete_item(key),
            Source::Broken(why) => Err(why.clone()),
        }
    }

    pub fn follow(&self, waker: &Waker<Msg>) {
        let Source::Live(live) = self else { return };
        let Ok(clients) = live.clients() else { return };
        let Ok(mut listeners) = live.listeners.lock() else {
            return;
        };
        listeners.push(waker.clone());
        if listeners.len() > 1 {
            return;
        }
        for (account, client) in clients.iter().enumerate() {
            let (client, live) = (client.clone(), Arc::clone(live));
            thread::spawn(move || {
                let _ = crate::stream::follow(&client, None, |heard| {
                    relay(&live.listeners, account, heard)
                });
            });
        }
    }

    pub fn codes(&self) -> Result<Vec<Code>, String> {
        let mut codes = match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.codes()))?,
            Source::Live(live) => {
                let mut all = Vec::new();
                for client in live.clients()? {
                    all.extend(client.codes(None)?);
                }
                all
            }
            Source::Broken(why) => return Err(why.clone()),
        };
        codes.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(codes)
    }
}

fn relay(listeners: &Mutex<Vec<Waker<Msg>>>, account: usize, heard: Heard<'_>) -> bool {
    let tell = |send: &dyn Fn(&Waker<Msg>) -> bool| {
        listeners
            .lock()
            .map(|listeners| listeners.iter().filter(|w| send(w)).count() > 0)
            .unwrap_or(false)
    };
    match heard {
        Heard::Open { again: false } | Heard::Dropped(..) => true,
        Heard::Open { again: true } => tell(&|w| w.send(Msg::Pushed(account, None))),
        Heard::Event(text) => {
            let event = serde_json::from_str::<serde_json::Value>(text).ok();
            let key = event
                .as_ref()
                .and_then(|event| event["key"].as_str().map(str::to_owned));
            let gone = event.is_some_and(|event| event["type"] == "delete");
            tell(&|w| {
                (gone || w.send(Msg::Pushed(account, key.clone())))
                    & w.send(Msg::Heard(account, text.to_owned()))
            })
        }
    }
}

impl Live {
    fn clients(&self) -> Result<&[Client], String> {
        self.clients
            .get_or_init(|| {
                self.accounts
                    .iter()
                    .map(|name| Client::for_account(&self.config, name, self.agent))
                    .collect()
            })
            .as_deref()
            .map_err(Clone::clone)
    }

    fn client(&self, account: usize, host: Option<&str>) -> Result<Client, String> {
        self.clients()?
            .get(account)
            .map(|client| client.clone().with_host(host))
            .ok_or_else(|| "that account is gone".to_owned())
    }

    fn inbox(&self) -> Result<Vec<Entry>, String> {
        let mut entries = Vec::new();
        for (account, client) in self.clients()?.iter().enumerate() {
            let mut cursor = None;
            loop {
                let query = ListQuery {
                    scope: "all".into(),
                    status: Some("any".into()),
                    host: Some("*".into()),
                    cursor: cursor.take(),
                    limit: PAGE,
                    ..ListQuery::default()
                };
                let page = client
                    .list(&query)
                    .map_err(|why| format!("{}: {why}", self.accounts[account]))?;
                entries.extend(
                    page.issues
                        .into_iter()
                        .map(|summary| Entry::new(account, summary)),
                );
                match page.next_cursor {
                    Some(next) if entries.len() < MOST => cursor = Some(next),
                    _ => break,
                }
            }
        }
        Ok(entries)
    }
}

pub fn merged_hosts(known: Vec<String>, entries: &[Entry]) -> Vec<String> {
    let mut hosts: BTreeSet<String> = known.into_iter().collect();
    hosts.extend(entries.iter().filter_map(|e| e.summary.host.clone()));
    hosts.into_iter().collect()
}

pub fn person(name: &str, email: &str, agent: bool) -> String {
    let who = if name.is_empty() { email } else { name };
    if agent {
        format!("{who}*")
    } else {
        who.to_owned()
    }
}

pub fn unix(stamp: &str) -> Option<i64> {
    let bytes = stamp.as_bytes();
    let number = |from: usize, to: usize| -> Option<i64> {
        stamp.get(from..to).and_then(|part| part.parse().ok())
    };
    if bytes.len() < 19 || !matches!(bytes[10], b'T' | b' ') {
        return None;
    }
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    Some(days(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second)
}

pub fn iso(seconds: i64) -> String {
    let (day, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let (year, month, date) = civil(day);
    format!(
        "{year:04}-{month:02}-{date:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn days(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_cycle - 719_468
}

fn civil(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let of_era = days - era * 146_097;
    let of_cycle = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * of_cycle + of_cycle / 4 - of_cycle / 100);
    let month_index = (5 * of_year + 2) / 153;
    let day = of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = of_cycle + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests;

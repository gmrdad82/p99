use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use crate::secret::Secret;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(try_from = "RawConfig")]
pub struct Config {
    #[serde(
        default,
        rename = "default_space",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default)]
    pub me: Me,
    #[serde(default, rename = "spaces")]
    pub accounts: BTreeMap<String, Account>,
    #[serde(default)]
    pub hosts: BTreeMap<String, Host>,
    #[serde(skip)]
    pub renamed: bool,
}

#[derive(Deserialize)]
struct RawConfig {
    #[serde(default)]
    default_space: Option<String>,
    #[serde(default)]
    default_account: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    me: Me,
    #[serde(default)]
    spaces: BTreeMap<String, Account>,
    #[serde(default)]
    accounts: BTreeMap<String, Account>,
    #[serde(default)]
    hosts: BTreeMap<String, Host>,
}

impl TryFrom<RawConfig> for Config {
    type Error = String;

    fn try_from(raw: RawConfig) -> Result<Config, String> {
        let mut renamed = raw.default_account.is_some() || !raw.accounts.is_empty();
        let mut spaces = raw.spaces;
        for (slug, space) in raw.accounts {
            if spaces.insert(slug.clone(), space).is_some() {
                return Err(format!(
                    "the space {slug} is in both [spaces.{slug}] and [accounts.{slug}]; keep [spaces.{slug}]"
                ));
            }
        }
        let mut hosts = raw.hosts;
        for (host, entry) in &mut hosts {
            match (entry.legacy.take(), entry.account.is_empty()) {
                (Some(old), true) => {
                    entry.account = old;
                    renamed = true;
                }
                (Some(_), false) => {
                    return Err(format!(
                        "the host {host} has both space and account; keep space"
                    ));
                }
                (None, true) => return Err(format!("the host {host} names no space")),
                (None, false) => {}
            }
        }
        Ok(Config {
            default_account: raw.default_space.or(raw.default_account),
            license: raw.license,
            me: raw.me,
            accounts: spaces,
            hosts,
            renamed,
        })
    }
}

pub const RENAMED: &str = "the config uses the old name account where P99 now says space; rename [accounts.<name>] to [spaces.<name>], default_account to default_space and account = to space = under [hosts] (p99 writes the new names when it next saves the config)";
pub const WHOLE: &str = "*";
pub const FLAG_RENAMED: &str = "--account is now --space; --account works one more release";

pub fn said_once(line: &str) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static CONFIG: AtomicBool = AtomicBool::new(false);
    static FLAG: AtomicBool = AtomicBool::new(false);
    let once = if line == FLAG_RENAMED { &FLAG } else { &CONFIG };
    if !once.swap(true, Ordering::Relaxed) {
        eprintln!("{}: {line}", crate::NAME);
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Me {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub agent: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Account {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub account_id: String,
    pub token: Secret,
    #[serde(default = "p99")]
    pub worker: String,
    #[serde(default = "p99")]
    pub database: String,
    #[serde(default)]
    pub database_id: String,
    #[serde(default = "p99")]
    pub bucket: String,
    #[serde(default)]
    pub key: Secret,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resend_key: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mail_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_client_secret: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<Secret>,
    #[serde(default, skip_serializing_if = "AccountMe::is_empty")]
    pub me: AccountMe,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub projects: BTreeMap<String, Vec<String>>,
}

impl Account {
    pub fn title<'a>(&'a self, slug: &'a str) -> &'a str {
        self.name
            .as_deref()
            .filter(|n| !n.is_empty())
            .unwrap_or(slug)
    }

    pub fn project_of(&self, host: &str) -> Option<&str> {
        self.projects
            .iter()
            .find(|(_, hosts)| hosts.iter().any(|h| h == host))
            .map(|(name, _)| name.as_str())
    }

    pub fn project_named(&self, name: &str) -> Option<&str> {
        self.projects
            .keys()
            .find(|known| known.eq_ignore_ascii_case(name))
            .map(String::as_str)
    }

    pub fn place(&mut self, host: &str, project: &str) {
        for hosts in self.projects.values_mut() {
            hosts.retain(|h| h != host);
        }
        let name = self.project_named(project).unwrap_or(project).to_owned();
        let hosts = self.projects.entry(name).or_default();
        hosts.push(host.to_owned());
        hosts.sort();
    }

    pub fn unplace(&mut self, host: &str) {
        for hosts in self.projects.values_mut() {
            hosts.retain(|h| h != host);
        }
    }

    pub fn rename_project(&mut self, from: &str, to: &str) {
        if let Some(old) = self.project_named(from).map(str::to_owned)
            && let Some(hosts) = self.projects.remove(&old)
        {
            self.projects.insert(to.to_owned(), hosts);
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountMe {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<bool>,
}

impl AccountMe {
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.email.is_none() && self.agent.is_none()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Host {
    #[serde(default, rename = "space")]
    pub account: String,
    #[serde(default, rename = "account", skip_serializing)]
    pub legacy: Option<String>,
    #[serde(default = "production")]
    pub env: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub theme: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub strings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<Offset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub above: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub off: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub feed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mask: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Offset {
    pub x: i64,
    pub y: i64,
}

pub const CORNERS: [&str; 4] = ["bottom-right", "bottom-left", "top-right", "top-left"];

impl Host {
    pub fn pushed(&self) -> serde_json::Value {
        let mut config = serde_json::Map::new();
        config.insert("theme".into(), serde_json::json!(self.theme));
        config.insert("strings".into(), serde_json::json!(self.strings));
        if let Some(corner) = &self.corner {
            config.insert("corner".into(), corner.clone().into());
        }
        if let Some(offset) = self.offset {
            config.insert(
                "offset".into(),
                serde_json::json!({"x": offset.x, "y": offset.y}),
            );
        }
        if let Some(above) = &self.above {
            config.insert("above".into(), above.clone().into());
        }
        if !self.off.is_empty() {
            config.insert("off".into(), serde_json::json!(self.off));
        }
        if self.feed {
            config.insert("feed".into(), true.into());
        }
        if self.link == Some(false) {
            config.insert("link".into(), false.into());
        }
        if !self.mask.is_empty() {
            config.insert("mask".into(), serde_json::json!(self.mask));
        }
        if self.capture.as_deref() == Some("off") {
            config.insert("capture".into(), "off".into());
        }
        serde_json::Value::Object(config)
    }
}

fn p99() -> String {
    "p99".to_owned()
}

fn production() -> String {
    "production".to_owned()
}

pub fn path() -> PathBuf {
    if let Some(file) = env::var_os("P99_CONFIG").filter(|v| !v.is_empty()) {
        return PathBuf::from(file);
    }
    let base = env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env::var_os("HOME").unwrap_or_default()).join(".config"));
    base.join("p99").join("config.toml")
}

impl Config {
    pub fn load() -> Result<Config, String> {
        let config = Config::load_from(&path())?;
        if config.renamed {
            said_once(RENAMED);
        }
        Ok(config)
    }

    pub fn load_from(file: &Path) -> Result<Config, String> {
        let text = match fs::read_to_string(file) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Config::default());
            }
            Err(error) => return Err(format!("{}: {error}", file.display())),
        };
        let config: Config =
            toml::from_str(&text).map_err(|error| parse_error(file, &text, &error))?;
        if config.has_inline_secret() && world_readable(file) {
            return Err(format!(
                "{} holds a secret and others can read it; run chmod 600 on it",
                file.display()
            ));
        }
        Ok(config)
    }

    pub fn save(&self) -> Result<(), String> {
        self.save_to(&path())
    }

    pub fn save_to(&self, file: &Path) -> Result<(), String> {
        let text = toml::to_string_pretty(self).map_err(|error| error.to_string())?;
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        }
        let partial = file.with_extension("toml.partial");
        let mut out = open_private(&partial).map_err(|e| format!("{}: {e}", partial.display()))?;
        out.write_all(text.as_bytes())
            .and_then(|()| out.sync_all())
            .map_err(|e| format!("{}: {e}", partial.display()))?;
        fs::rename(&partial, file).map_err(|e| format!("{}: {e}", file.display()))
    }

    pub fn account(&self, name: Option<&str>) -> Result<(&str, &Account), String> {
        if name == Some(WHOLE) {
            return Err("--space names a space here; p99 spaces lists them".into());
        }
        let name = match name.or(self.default_account.as_deref()) {
            Some(name) => name,
            None if self.accounts.len() == 1 => self.accounts.keys().next().unwrap(),
            None if self.accounts.is_empty() => return Err("no space yet; run p99 setup".into()),
            None => return Err("several spaces; name one with --space".into()),
        };
        self.accounts
            .get_key_value(name)
            .map(|(k, v)| (k.as_str(), v))
            .ok_or_else(|| format!("no space is called {name}"))
    }

    pub fn project_of_host(&self, host: &str) -> Option<&str> {
        let space = self.hosts.get(host).map(|h| h.account.as_str())?;
        self.accounts.get(space)?.project_of(host)
    }

    pub fn hosts_of(&self, account: &str) -> Vec<&str> {
        self.hosts
            .iter()
            .filter(|(_, h)| h.account == account)
            .map(|(name, _)| name.as_str())
            .collect()
    }

    pub fn me_for(&self, account: &str) -> Me {
        let mut me = self.me.clone();
        if let Some(over) = self.accounts.get(account).map(|a| &a.me) {
            if let Some(name) = &over.name {
                me.name = name.clone();
            }
            if let Some(email) = &over.email {
                me.email = email.clone();
            }
            if let Some(agent) = over.agent {
                me.agent = agent;
            }
        }
        me
    }

    pub fn bases(&self, account: &str, target: Option<&str>) -> Result<Vec<String>, String> {
        let entry = self
            .accounts
            .get(account)
            .ok_or_else(|| format!("no space is called {account}"))?;
        if let Some(url) = &entry.url {
            return Ok(vec![url.trim_end_matches('/').to_owned()]);
        }
        let mut hosts: Vec<(&str, &Host)> = self
            .hosts
            .iter()
            .filter(|(_, h)| h.account == account)
            .map(|(name, h)| (name.as_str(), h))
            .collect();
        if hosts.is_empty() {
            return Err(format!(
                "the space {account} has no host yet; p99 hosts add"
            ));
        }
        hosts.sort_by_key(|(name, h)| (Some(*name) != target, h.env != "production"));
        Ok(hosts
            .into_iter()
            .map(|(name, _)| format!("https://{name}/_p99"))
            .collect())
    }

    fn has_inline_secret(&self) -> bool {
        self.license.as_ref().is_some_and(|key| !key.is_empty())
            || self.accounts.values().any(|a| {
                [
                    Some(&a.token),
                    Some(&a.key),
                    a.resend_key.as_ref(),
                    a.access_client_secret.as_ref(),
                    a.code.as_ref(),
                ]
                .into_iter()
                .flatten()
                .any(Secret::is_inline)
            })
    }
}

const SECRET_KEYS: [&str; 6] = [
    "token",
    "key",
    "resend_key",
    "access_client_secret",
    "code",
    "license",
];

const KNOWN_KEYS: [&str; 39] = [
    "default_space",
    "license",
    "me",
    "spaces",
    "projects",
    "hosts",
    "name",
    "email",
    "agent",
    "account_id",
    "token",
    "worker",
    "database",
    "database_id",
    "bucket",
    "key",
    "url",
    "app",
    "resend_key",
    "mail_from",
    "access_client_id",
    "access_client_secret",
    "code",
    "space",
    "env",
    "theme",
    "strings",
    "corner",
    "offset",
    "above",
    "off",
    "feed",
    "link",
    "mask",
    "capture",
    "x",
    "y",
    "file",
    "command",
];

fn keys_on(line: &str) -> Vec<String> {
    let part = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '"' || c == '\'';
    line.match_indices('=')
        .filter_map(|(at, _)| {
            let before = line[..at].trim_end();
            let start = before
                .char_indices()
                .rev()
                .find(|(_, c)| !part(*c))
                .map_or(0, |(i, c)| i + c.len_utf8());
            let name = before[start..].trim_matches(|c| c == '"' || c == '\'');
            (!name.is_empty()).then(|| name.to_owned())
        })
        .collect()
}

fn secret_values(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|line| {
            keys_on(line)
                .iter()
                .any(|k| SECRET_KEYS.contains(&k.as_str()))
        })
        .flat_map(|line| {
            line.split(|c: char| c == '=' || c == '"' || c == '\'' || c == ',' || c.is_whitespace())
        })
        .filter(|part| part.len() >= 4 && !SECRET_KEYS.contains(part))
        .collect()
}

fn parse_error(file: &Path, text: &str, error: &toml::de::Error) -> String {
    let message = error.message().trim();
    let leaks = secret_values(text)
        .iter()
        .any(|value| message.contains(value));
    let Some(span) = error.span() else {
        return if leaks {
            format!("{}: not valid TOML", file.display())
        } else {
            format!("{}: {message}", file.display())
        };
    };
    let at = span.start.min(text.len());
    let number = text.as_bytes()[..at]
        .iter()
        .filter(|b| **b == b'\n')
        .count()
        + 1;
    let line = text.lines().nth(number - 1).unwrap_or("");
    let keys = keys_on(line);
    let secret = keys.iter().any(|k| SECRET_KEYS.contains(&k.as_str()));
    let place = match keys.first().filter(|k| KNOWN_KEYS.contains(&k.as_str())) {
        Some(key) => format!("{}: line {number}, key {key}", file.display()),
        None => format!("{}: line {number}", file.display()),
    };
    if secret || leaks {
        format!("{place}: not valid TOML; the value is not shown")
    } else {
        format!("{place}: {message}")
    }
}

pub fn secret(value: &Secret) -> Result<String, String> {
    value.read()
}

pub fn token(account: &Account) -> Result<String, String> {
    match env::var("P99_TOKEN") {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => secret(&account.token),
    }
}

pub fn key(account: &Account, in_use: bool) -> Result<String, String> {
    key_from(env::var_os("P99_KEY").filter(|_| in_use), &account.key)
}

pub fn key_holder(config: &Config) -> Result<Option<String>, String> {
    holder_from(
        env::var_os("P99_KEY"),
        bound_space(env::var_os("P99_KEY_SPACE"), env::var_os("P99_KEY_ACCOUNT")),
        config,
    )
}

fn bound_space(
    space: Option<std::ffi::OsString>,
    legacy: Option<std::ffi::OsString>,
) -> Option<std::ffi::OsString> {
    space.or(legacy)
}

fn holder_from(
    given: Option<std::ffi::OsString>,
    bound: Option<std::ffi::OsString>,
    config: &Config,
) -> Result<Option<String>, String> {
    if given.is_none() {
        return Ok(None);
    }
    key_from(given, &Secret::default())?;
    Ok(match bound {
        Some(name) => name
            .into_string()
            .ok()
            .filter(|name| config.accounts.contains_key(name)),
        None => config.account(None).ok().map(|(name, _)| name.to_owned()),
    })
}

pub fn key_overridden(config: &Config, account: &str) -> bool {
    match key_holder(config) {
        Ok(holder) => holder.as_deref() == Some(account),
        Err(_) => true,
    }
}

fn key_from(given: Option<std::ffi::OsString>, configured: &Secret) -> Result<String, String> {
    let Some(given) = given else {
        return secret(configured);
    };
    match given.into_string() {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        Ok(_) => Err("P99_KEY is set but empty; unset it or give the key".to_owned()),
        Err(_) => Err("P99_KEY is not text; unset it or give the key".to_owned()),
    }
}

pub fn agent(flag: &Option<Option<String>>, me: &Me) -> (bool, Option<String>) {
    agent_from(flag, env::var("P99_AGENT").ok().as_deref(), me)
}

pub fn agent_from(
    flag: &Option<Option<String>>,
    variable: Option<&str>,
    me: &Me,
) -> (bool, Option<String>) {
    let from_env = match variable.map(str::trim) {
        None | Some("") => None,
        Some(word) if word == "0" || word.eq_ignore_ascii_case("false") => Some(None),
        Some(word) if word == "1" || word.eq_ignore_ascii_case("true") => Some(Some(None)),
        Some(label) => Some(Some(crate::card::via(label))),
    };
    let label = from_env.clone().flatten().flatten();
    match flag {
        Some(Some(given)) => (true, crate::card::via(given).or(label)),
        Some(None) => (true, label),
        None => match from_env {
            Some(Some(label)) => (true, label),
            Some(None) => (false, None),
            None => (me.agent, None),
        },
    }
}

#[cfg(unix)]
fn world_readable(file: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(file).is_ok_and(|m| m.permissions().mode() & 0o077 != 0)
}

#[cfg(not(unix))]
fn world_readable(_: &Path) -> bool {
    false
}

#[cfg(unix)]
fn open_private(file: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(file)
}

#[cfg(not(unix))]
fn open_private(file: &Path) -> std::io::Result<fs::File> {
    fs::File::create(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "s3cr3t-Vq8Lm2Xw7Rk4";

    fn unreachable() -> Secret {
        Secret::Command(vec!["p99-secret-tool-that-must-never-run".into()])
    }
    const OTHER: &str = "s3cr3t-Hd5Tz1Pc9Ny6";

    fn broken(text: &str) -> String {
        let error = toml::from_str::<Config>(text)
            .err()
            .expect("the text is broken");
        parse_error(Path::new("config.toml"), text, &error)
    }

    fn account_with(line: &str) -> String {
        format!("[spaces.main]\naccount_id = \"a\"\n{line}\ndatabase_id = \"d\"\n")
    }

    fn hides(message: &str, secrets: &[&str]) {
        for secret in secrets {
            assert!(
                !message.contains(secret),
                "a secret reached the error: {message}"
            );
            assert!(
                !message.contains(&secret[..10]),
                "part of a secret reached the error: {message}"
            );
        }
    }

    #[test]
    fn a_broken_line_of_every_secret_key_names_line_and_key_never_the_value() {
        for key in ["token", "key", "resend_key", "access_client_secret", "code"] {
            for line in [
                format!("{key} = \"{SECRET}"),
                format!("{key} = {SECRET}"),
                format!("{key} = \"{SECRET}\" x"),
                format!("{key} = 12{SECRET}"),
            ] {
                let message = broken(&account_with(&line));
                hides(&message, &[SECRET]);
                assert!(
                    message.starts_with(&format!("config.toml: line 3, key {key}: ")),
                    "{line}: {message}"
                );
                assert!(message.ends_with("the value is not shown"), "{message}");
            }
        }
        for line in [
            format!("license = \"{SECRET}"),
            format!("license = {SECRET}"),
        ] {
            let message = broken(&format!("{line}\n\n{}", account_with("token = \"\"")));
            hides(&message, &[SECRET]);
            assert_eq!(
                message,
                "config.toml: line 1, key license: not valid TOML; the value is not shown"
            );
        }
    }

    #[test]
    fn a_secret_of_the_wrong_type_is_not_quoted_back() {
        let message = broken(&account_with(&format!("token = [\"{SECRET}\"]")));
        hides(&message, &[SECRET]);
        assert!(
            message.starts_with("config.toml: line 3, key token: "),
            "{message}"
        );
        let message = broken(&account_with("token = true"));
        assert!(
            message.starts_with("config.toml: line 3, key token: "),
            "{message}"
        );
    }

    #[test]
    fn a_broken_line_with_two_values_hides_both_whichever_comes_first() {
        for line in [
            format!("token = \"{SECRET}\" key = \"{OTHER}\""),
            format!("key = \"{OTHER}\" token = \"{SECRET}"),
            format!("worker = \"p99\" token = \"{SECRET}\""),
            format!("worker = \"p99\", resend_key = {SECRET}"),
            format!("me = {{ name = \"Ada Lovelace\" }} key = \"{OTHER}\" token = {SECRET}"),
        ] {
            let message = broken(&account_with(&line));
            hides(&message, &[SECRET, OTHER]);
            assert!(
                message.starts_with("config.toml: line 3, key "),
                "{line}: {message}"
            );
            assert!(
                message.ends_with("the value is not shown"),
                "{line}: {message}"
            );
        }
    }

    #[test]
    fn dotted_and_inline_secret_keys_are_hidden_too() {
        let message = broken(&format!(
            "spaces.main.account_id = \"a\"\nspaces.main.token = \"{SECRET}\n"
        ));
        hides(&message, &[SECRET]);
        assert!(
            message.starts_with("config.toml: line 2, key token: "),
            "{message}"
        );
        let message = broken(&format!(
            "[spaces.main]\naccount_id = \"a\"\nme = {{ name = \"Ada Lovelace\", token = {SECRET} }}\n"
        ));
        hides(&message, &[SECRET]);
        assert!(
            message.starts_with("config.toml: line 3, key me: "),
            "{message}"
        );
        assert!(message.ends_with("the value is not shown"), "{message}");
    }

    #[test]
    fn a_secret_pasted_alone_on_a_line_is_never_named_as_a_key() {
        let message = broken(&format!("{}{SECRET}\n", account_with("token = \"\"")));
        hides(&message, &[SECRET]);
        assert!(message.starts_with("config.toml: line 5"), "{message}");
        let message = broken(&format!("{}{SECRET} = \n", account_with("token = \"\"")));
        hides(&message, &[SECRET]);
        assert!(message.starts_with("config.toml: line 5"), "{message}");
    }

    #[test]
    fn an_unterminated_multiline_secret_never_reaches_the_error() {
        let message = broken(&format!(
            "{}[hosts.\"example.com\"]\nspace = \"main\"\n",
            account_with(&format!("token = \"\"\"{SECRET}"))
        ));
        hides(&message, &[SECRET]);
        assert!(message.starts_with("config.toml: line "), "{message}");
        let message = broken(&account_with(&format!("token = [\n\"{SECRET}\" x\n]")));
        hides(&message, &[SECRET]);
        assert!(message.starts_with("config.toml: line 4"), "{message}");
    }

    #[test]
    fn a_broken_plain_line_keeps_its_line_key_and_reason() {
        let message = broken("[hosts.\"example.com\"]\nspace = \"main\"\nfeed = maybe\n");
        assert!(
            message.starts_with("config.toml: line 3, key feed: "),
            "{message}"
        );
        assert!(!message.contains("not shown"), "{message}");
        let message = broken("[spaces.main]\ntoken = \"\"\n");
        assert!(message.starts_with("config.toml: line "), "{message}");
        assert!(message.contains("account_id"), "{message}");
        assert!(!message.contains("not shown"), "{message}");
    }

    #[test]
    fn keys_on_reads_every_key_of_a_line_and_survives_any_text() {
        assert_eq!(keys_on("token = \"a=b\" key = 1"), ["token", "a", "key"]);
        assert_eq!(keys_on("spaces.main.token = 1"), ["token"]);
        assert_eq!(keys_on("\"token\" = 1"), ["token"]);
        assert!(keys_on("é=ü = 1").is_empty());
        assert_eq!(keys_on("ünï_key = 1"), ["_key"]);
        assert!(keys_on("no equals here").is_empty());
        assert!(keys_on("= 1").is_empty());
    }

    #[test]
    fn a_spanless_error_hides_a_secret_it_quotes_and_keeps_any_other_reason() {
        use serde::de::Error as _;
        let text = account_with(&format!("token = \"{SECRET}\""));
        let quoted = toml::de::Error::custom(format!("invalid value {SECRET}"));
        assert!(quoted.span().is_none());
        let message = parse_error(Path::new("config.toml"), &text, &quoted);
        hides(&message, &[SECRET]);
        assert_eq!(message, "config.toml: not valid TOML");
        let plain = toml::de::Error::custom("missing field `account_id`");
        assert_eq!(
            parse_error(Path::new("config.toml"), &text, &plain),
            "config.toml: missing field `account_id`"
        );
    }

    fn named_keys(value: &toml::Value, path: &str, into: &mut Vec<String>) {
        let Some(table) = value.as_table() else {
            return;
        };
        let named = ["spaces", "projects", "hosts", "theme", "strings"].contains(&path);
        for (key, value) in table {
            if !named {
                into.push(key.clone());
            }
            named_keys(value, if named { "" } else { key }, into);
        }
    }

    #[test]
    fn every_key_a_config_writes_is_known_and_every_credential_is_secret() {
        let full = |s: &str| Some(s.to_owned());
        let mut config = Config {
            default_account: full("main"),
            license: full("l"),
            me: Me {
                name: "Ada Lovelace".into(),
                email: "ada@example.com".into(),
                agent: true,
            },
            ..Config::default()
        };
        config.accounts.insert(
            "main".into(),
            Account {
                name: full("PITO MD"),
                projects: [("PITO MD site".to_owned(), vec!["example.com".to_owned()])].into(),
                account_id: "a".into(),
                token: "t".into(),
                worker: "w".into(),
                database: "d".into(),
                database_id: "i".into(),
                bucket: "b".into(),
                key: "k".into(),
                url: full("https://example.com"),
                app: full("app.example.com"),
                resend_key: full("/run/p99/resend").map(Secret::File),
                mail_from: full("P99 <p99@example.com>"),
                access_client_id: full("c"),
                access_client_secret: Some(Secret::Command(vec![
                    "pass".into(),
                    "show".into(),
                    "access".into(),
                ])),
                code: full("P99_CODE").map(Secret::Env),
                me: AccountMe {
                    name: full("Grace Hopper"),
                    email: full("grace@example.com"),
                    agent: Some(true),
                },
            },
        );
        config.hosts.insert(
            "example.com".into(),
            Host {
                account: "main".into(),
                legacy: None,
                env: "production".into(),
                theme: [("accent".to_owned(), "#000".to_owned())].into(),
                strings: [("title".to_owned(), "Hi".to_owned())].into(),
                corner: full("bottom-left"),
                offset: Some(Offset { x: 1, y: 2 }),
                above: full("#footer"),
                off: vec!["/admin".into()],
                feed: true,
                link: Some(true),
                mask: vec!["#card-number".into()],
                capture: full("off"),
            },
        );
        let value: toml::Value = toml::from_str(&toml::to_string(&config).unwrap()).unwrap();
        let mut keys = Vec::new();
        named_keys(&value, "", &mut keys);
        for key in &keys {
            assert!(
                KNOWN_KEYS.contains(&key.as_str()),
                "{key} is not in KNOWN_KEYS"
            );
            let credential = ["token", "key", "secret", "code", "license", "password"]
                .iter()
                .any(|word| key.contains(word));
            assert_eq!(
                credential,
                SECRET_KEYS.contains(&key.as_str()),
                "{key}: SECRET_KEYS is out of step"
            );
        }
        for key in SECRET_KEYS.iter().chain(KNOWN_KEYS.iter()) {
            assert!(
                keys.iter().any(|k| k == key),
                "{key} is listed but never written"
            );
        }
    }

    #[test]
    fn a_config_that_parses_still_loads() {
        let config: Config =
            toml::from_str(&account_with(&format!("token = \"{SECRET}\""))).unwrap();
        assert_eq!(config.accounts["main"].token, SECRET);
    }

    #[test]
    fn bases_put_the_target_then_production_first() {
        let config: Config = toml::from_str(
            r#"
            [me]
            name = "Ada Lovelace"
            email = "ada@example.com"

            [spaces.main]
            account_id = "a"
            token = ""
            me = { name = "Grace Hopper", email = "grace@example.org" }

            [spaces.custom]
            account_id = "b"
            token = ""
            url = "https://p99.example.org/_p99/"

            [hosts."dev.example.com"]
            space = "main"
            env = "dev"

            [hosts."a.example.com"]
            space = "main"
            env = "staging"

            [hosts."example.com"]
            space = "main"
            env = "production"

            [hosts."example.org"]
            space = "custom"
            "#,
        )
        .unwrap();
        assert_eq!(
            config.bases("main", None).unwrap(),
            [
                "https://example.com/_p99",
                "https://a.example.com/_p99",
                "https://dev.example.com/_p99"
            ]
        );
        assert_eq!(
            config.bases("main", Some("dev.example.com")).unwrap(),
            [
                "https://dev.example.com/_p99",
                "https://example.com/_p99",
                "https://a.example.com/_p99"
            ]
        );
        assert_eq!(
            config.bases("custom", Some("example.org")).unwrap(),
            ["https://p99.example.org/_p99"]
        );
        let me = config.me_for("main");
        assert_eq!(
            (me.name.as_str(), me.email.as_str()),
            ("Grace Hopper", "grace@example.org")
        );
        assert_eq!(config.me_for("custom").email, "ada@example.com");
    }

    #[test]
    fn p99_key_comes_first_over_an_inline_key_and_a_reference() {
        let given = |v: &str| Some(std::ffi::OsString::from(v));
        assert_eq!(
            key_from(given("from-env"), &"inline".into()).unwrap(),
            "from-env"
        );
        assert_eq!(
            key_from(given("from-env"), &unreachable()).unwrap(),
            "from-env"
        );
        assert_eq!(
            key_from(given(" padded "), &"inline".into()).unwrap(),
            " padded "
        );
    }

    #[test]
    fn without_p99_key_the_configured_key_is_used() {
        assert_eq!(key_from(None, &"inline".into()).unwrap(), "inline");
    }

    #[test]
    fn an_empty_p99_key_is_refused_without_the_configured_key() {
        for empty in ["", " ", "\t\n  "] {
            assert_eq!(
                key_from(Some(empty.into()), &"inline".into()).unwrap_err(),
                "P99_KEY is set but empty; unset it or give the key"
            );
            assert_eq!(
                key_from(Some(empty.into()), &unreachable()).unwrap_err(),
                "P99_KEY is set but empty; unset it or give the key"
            );
        }
    }

    fn accounts(default: Option<&str>, names: &[&str]) -> Config {
        let mut text = default
            .map(|d| format!("default_space = \"{d}\"\n"))
            .unwrap_or_default();
        for name in names {
            text.push_str(&format!(
                "[spaces.{name}]\naccount_id = \"{name}\"\ntoken = \"\"\n"
            ));
        }
        toml::from_str(&text).unwrap()
    }

    fn bound(name: &str) -> Option<std::ffi::OsString> {
        Some(name.into())
    }

    #[test]
    fn p99_key_belongs_to_the_default_account_unless_p99_key_account_names_one() {
        let account = Account {
            key: "inline".into(),
            ..Account::default()
        };
        assert_eq!(key(&account, false).unwrap(), "inline");
        let given = || Some(std::ffi::OsString::from("from-env"));
        let one = accounts(None, &["main"]);
        assert_eq!(holder_from(None, None, &one).unwrap(), None);
        assert_eq!(holder_from(None, bound("main"), &one).unwrap(), None);
        assert_eq!(
            holder_from(given(), None, &one).unwrap().as_deref(),
            Some("main")
        );
        let two = accounts(Some("other"), &["main", "other"]);
        assert_eq!(
            holder_from(given(), None, &two).unwrap().as_deref(),
            Some("other")
        );
        assert_eq!(
            holder_from(given(), bound("main"), &two)
                .unwrap()
                .as_deref(),
            Some("main")
        );
        assert_eq!(
            holder_from(given(), bound("other"), &two)
                .unwrap()
                .as_deref(),
            Some("other")
        );
    }

    #[test]
    fn an_empty_or_unknown_p99_key_account_binds_p99_key_to_no_account() {
        let given = || Some(std::ffi::OsString::from("from-env"));
        let two = accounts(Some("main"), &["main", "other"]);
        for name in ["", " ", "gone", "Main", " main", "main "] {
            assert_eq!(
                holder_from(given(), bound(name), &two).unwrap(),
                None,
                "{name:?}"
            );
        }
        assert_eq!(
            holder_from(given(), bound("main"), &accounts(None, &[])).unwrap(),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_p99_key_account_that_is_not_text_binds_no_account() {
        use std::os::unix::ffi::OsStringExt;
        let two = accounts(Some("main"), &["main", "other"]);
        let raw = std::ffi::OsString::from_vec(vec![b'm', 0xff, b'n']);
        assert_eq!(
            holder_from(Some("from-env".into()), Some(raw), &two).unwrap(),
            None
        );
    }

    #[test]
    fn without_p99_key_account_and_no_default_account_p99_key_binds_none() {
        let given = || Some(std::ffi::OsString::from("from-env"));
        let two = accounts(None, &["main", "other"]);
        assert_eq!(holder_from(None, None, &two).unwrap(), None);
        assert_eq!(holder_from(given(), None, &two).unwrap(), None);
        assert_eq!(
            holder_from(given(), bound("other"), &two)
                .unwrap()
                .as_deref(),
            Some("other")
        );
        assert_eq!(
            holder_from(given(), None, &accounts(None, &[])).unwrap(),
            None
        );
        assert_eq!(
            holder_from(given(), None, &accounts(Some("gone"), &["main"])).unwrap(),
            None
        );
    }

    #[test]
    fn an_empty_p99_key_is_refused_whatever_account_it_names() {
        let two = accounts(Some("main"), &["main", "other"]);
        for name in [None, bound("main"), bound("other"), bound("gone")] {
            assert_eq!(
                holder_from(Some(" ".into()), name, &two).unwrap_err(),
                "P99_KEY is set but empty; unset it or give the key"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_p99_key_that_is_not_text_is_refused_without_echoing_it() {
        use std::os::unix::ffi::OsStringExt;
        let raw = std::ffi::OsString::from_vec(vec![b'k', 0xff, b'y']);
        let why = key_from(Some(raw), &"inline".into()).unwrap_err();
        assert_eq!(why, "P99_KEY is not text; unset it or give the key");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("tmp")
            .join(format!("p99-config-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn written(dir: &Path, text: &str, mode: u32) -> PathBuf {
        let file = dir.join("config.toml");
        fs::write(&file, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();
        }
        #[cfg(not(unix))]
        let _ = mode;
        file
    }

    const INLINE: &str = r#"
        [spaces.main]
        account_id = "a"
        token = "cf-inline-token"
        key = { file = "/run/p99/key" }
        "#;

    const REFERENCES: &str = r#"
        [spaces.main]
        account_id = "a"
        token = { command = ["pass", "show", "cloudflare"] }
        key = { env = "P99_KEY_FOR_TESTS" }
        "#;

    #[cfg(unix)]
    #[test]
    fn a_config_holding_a_secret_others_can_read_is_refused() {
        let dir = scratch("readable");
        for mode in [0o644, 0o640, 0o604] {
            let file = written(&dir, INLINE, mode);
            assert_eq!(
                Config::load_from(&file).err().unwrap(),
                format!(
                    "{} holds a secret and others can read it; run chmod 600 on it",
                    file.display()
                )
            );
        }
        let file = written(&dir, INLINE, 0o600);
        assert_eq!(
            Config::load_from(&file).unwrap().accounts["main"].token,
            "cf-inline-token"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_readable_config_of_references_only_still_loads() {
        let dir = scratch("references");
        let file = written(&dir, REFERENCES, 0o644);
        let config = Config::load_from(&file).unwrap();
        assert_eq!(
            config.accounts["main"].token,
            Secret::Command(vec!["pass".into(), "show".into(), "cloudflare".into()])
        );
        assert_eq!(
            config.accounts["main"].key,
            Secret::Env("P99_KEY_FOR_TESTS".into())
        );
        assert!(!config.has_inline_secret());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_secret_keeps_its_source_through_a_save_and_a_load() {
        let dir = scratch("sources");
        let mut config: Config = toml::from_str(REFERENCES).unwrap();
        let account = config.accounts.get_mut("main").unwrap();
        account.resend_key = Some(Secret::File("~/.p99-resend".into()));
        account.access_client_secret = Some(Secret::Env("ACCESS_SECRET".into()));
        account.code = Some(Secret::Command(vec![
            "bw".into(),
            "get".into(),
            "p99".into(),
        ]));
        let file = dir.join("config.toml");
        config.save_to(&file).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(!text.contains("cf-inline"), "{text}");
        let back = Config::load_from(&file).unwrap();
        let (was, now) = (&config.accounts["main"], &back.accounts["main"]);
        assert_eq!(was.token, now.token);
        assert_eq!(was.key, now.key);
        assert_eq!(was.resend_key, now.resend_key);
        assert_eq!(was.access_client_secret, now.access_client_secret);
        assert_eq!(was.code, now.code);
        assert!(!back.has_inline_secret());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_secret_written_inline_beside_a_source_still_counts_as_inline() {
        let config: Config = toml::from_str(
            "[spaces.main]\naccount_id = \"a\"\ntoken = { env = \"T\" }\nkey = \"inline-key\"\n",
        )
        .unwrap();
        assert!(config.has_inline_secret());
    }

    #[test]
    fn a_licence_key_counts_as_an_inline_secret() {
        let config: Config =
            toml::from_str(&format!("license = \"P99-KEY\"\n{REFERENCES}")).unwrap();
        assert!(config.has_inline_secret());
        let config: Config = toml::from_str(INLINE).unwrap();
        assert!(config.has_inline_secret());
    }

    #[test]
    fn malformed_toml_is_named_with_its_file() {
        let dir = scratch("malformed");
        let file = written(&dir, "key = \n", 0o600);
        let error = Config::load_from(&file).err().unwrap();
        assert!(
            error.starts_with(&format!("{}: ", file.display())),
            "{error}"
        );
        assert!(
            error.len() > file.display().to_string().len() + 2,
            "{error}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_config_that_cannot_be_read_is_named_with_its_file() {
        let dir = scratch("unreadable");
        let file = dir.join("config.toml");
        fs::create_dir_all(&file).unwrap();
        let error = Config::load_from(&file).err().unwrap();
        assert!(
            error.starts_with(&format!("{}: ", file.display())),
            "{error}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_config_is_the_empty_default() {
        let dir = scratch("missing");
        let config = Config::load_from(&dir.join("config.toml")).unwrap();
        assert!(config.accounts.is_empty() && config.hosts.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    fn marked(
        flag: Option<Option<&str>>,
        variable: Option<&str>,
        me: bool,
    ) -> (bool, Option<String>) {
        let flag = flag.map(|f| f.map(str::to_owned));
        let me = Me {
            agent: me,
            ..Me::default()
        };
        agent_from(&flag, variable, &me)
    }

    #[test]
    fn the_agent_flag_and_p99_agent_mark_with_or_without_a_label() {
        assert_eq!(marked(None, None, false), (false, None));
        assert_eq!(marked(None, None, true), (true, None));
        assert_eq!(marked(Some(None), None, false), (true, None));
        assert_eq!(
            marked(Some(Some("pci")), None, false),
            (true, Some("pci".into()))
        );
        assert_eq!(
            marked(None, Some("pci·splicer"), false),
            (true, Some("pci·splicer".into()))
        );
        assert_eq!(marked(None, Some("1"), false), (true, None));
        assert_eq!(marked(None, Some("true"), false), (true, None));
        assert_eq!(marked(None, Some("TRUE"), false), (true, None));
        assert_eq!(marked(None, Some(""), true), (true, None));
        assert_eq!(marked(None, Some("  "), false), (false, None));
        assert_eq!(marked(None, Some("0"), false), (false, None));
        assert_eq!(marked(None, Some("false"), false), (false, None));
    }

    #[test]
    fn p99_agent_zero_turns_off_the_configs_agent_mark() {
        assert_eq!(marked(None, Some("0"), true), (false, None));
        assert_eq!(marked(None, Some(" 0 "), true), (false, None));
        assert_eq!(marked(None, Some("false"), true), (false, None));
        assert_eq!(marked(None, Some("FALSE"), true), (false, None));
        assert_eq!(marked(None, Some(""), true), (true, None));
        assert_eq!(marked(Some(None), Some("0"), true), (true, None));
        assert_eq!(
            marked(Some(Some("pci")), Some("false"), false),
            (true, Some("pci".into()))
        );
    }

    #[test]
    fn p99_agent_zero_turns_off_an_accounts_agent_mark() {
        let config: Config = toml::from_str(
            r#"
            [me]
            name = "Ada Lovelace"
            email = "ada@example.com"

            [spaces.shop]
            account_id = "a"
            token = ""

            [spaces.shop.me]
            agent = true
            "#,
        )
        .unwrap();
        let me = config.me_for("shop");
        assert!(me.agent);
        assert_eq!(agent_from(&None, Some("0"), &me), (false, None));
        assert_eq!(agent_from(&None, None, &me), (true, None));
    }

    #[test]
    fn the_flag_label_wins_and_a_bare_flag_keeps_p99_agents_label() {
        assert_eq!(
            marked(Some(Some("cli")), Some("env"), false),
            (true, Some("cli".into()))
        );
        assert_eq!(
            marked(Some(None), Some("env"), false),
            (true, Some("env".into()))
        );
        assert_eq!(marked(Some(None), Some("0"), false), (true, None));
        assert_eq!(
            marked(Some(Some("")), Some("env"), false),
            (true, Some("env".into()))
        );
        assert_eq!(
            marked(Some(Some("x")), Some("0"), true),
            (true, Some("x".into()))
        );
    }

    #[test]
    fn a_label_is_cleaned_trimmed_and_cut_at_eighty_characters() {
        let long = "é".repeat(100);
        let (agent, via) = marked(Some(Some(&long)), None, false);
        assert!(agent);
        assert_eq!(via.as_deref().map(|v| v.chars().count()), Some(80));
        assert_eq!(
            marked(Some(Some(" a\u{1}b\u{202e} ")), None, false),
            (true, Some("ab".into()))
        );
        assert_eq!(marked(None, Some("\u{7}"), false), (true, None));
    }

    const LEGACY_TEXT: &str = r#"
        default_account = "main"

        [accounts.main]
        account_id = "a"
        token = ""

        [hosts."example.com"]
        account = "main"
        env = "production"
        "#;

    #[test]
    fn the_legacy_names_load_as_spaces_and_say_they_were_renamed() {
        let config: Config = toml::from_str(LEGACY_TEXT).unwrap();
        assert!(config.renamed);
        assert_eq!(config.default_account.as_deref(), Some("main"));
        assert_eq!(config.accounts["main"].account_id, "a");
        assert_eq!(config.hosts["example.com"].account, "main");
        assert_eq!(config.hosts["example.com"].legacy, None);
        let written = toml::to_string(&config).unwrap();
        assert!(written.contains("[spaces.main]"), "{written}");
        assert!(written.contains("default_space = \"main\""), "{written}");
        assert!(written.contains("space = \"main\""), "{written}");
        assert!(!written.contains("accounts"), "{written}");
        assert!(!written.contains("default_account"), "{written}");
        assert!(!written.contains("\naccount = "), "{written}");
        let again: Config = toml::from_str(&written).unwrap();
        assert!(!again.renamed);
    }

    #[test]
    fn a_space_and_an_account_of_one_name_or_a_host_with_no_space_are_refused() {
        let both = "[spaces.a]\naccount_id = \"1\"\ntoken = \"\"\n[accounts.a]\naccount_id = \"2\"\ntoken = \"\"\n";
        let error = toml::from_str::<Config>(both).err().unwrap().to_string();
        assert!(
            error.contains("the space a is in both [spaces.a] and [accounts.a]; keep [spaces.a]"),
            "{error}"
        );
        let twice = "[spaces.a]\naccount_id = \"1\"\ntoken = \"\"\n[hosts.\"x.example.com\"]\nspace = \"a\"\naccount = \"a\"\n";
        let error = toml::from_str::<Config>(twice).err().unwrap().to_string();
        assert!(error.contains("has both space and account"), "{error}");
        let none = "[hosts.\"x.example.com\"]\nenv = \"production\"\n";
        let error = toml::from_str::<Config>(none).err().unwrap().to_string();
        assert!(
            error.contains("the host x.example.com names no space"),
            "{error}"
        );
    }

    #[test]
    fn spaces_read_their_name_and_projects_and_write_them_back() {
        let text = r#"
            [spaces.pito]
            name = "PITO MD"
            account_id = "a"
            token = ""

            [spaces.pito.projects]
            "PITO MD site" = ["pitomd.com", "dev.pitomd.com"]
            Alfred = ["license.pitomd.com"]

            [hosts."pitomd.com"]
            space = "pito"
            "#;
        let config: Config = toml::from_str(text).unwrap();
        assert!(!config.renamed);
        let pito = &config.accounts["pito"];
        assert_eq!(pito.title("pito"), "PITO MD");
        assert_eq!(pito.project_of("dev.pitomd.com"), Some("PITO MD site"));
        assert_eq!(pito.project_of("elsewhere.com"), None);
        assert_eq!(pito.project_named("alfred"), Some("Alfred"));
        let bare = Account::default();
        assert_eq!(bare.title("fepra"), "fepra");
        let written = toml::to_string(&config).unwrap();
        let again: Config = toml::from_str(&written).unwrap();
        assert_eq!(again.accounts["pito"].projects, pito.projects);
        assert_eq!(again.accounts["pito"].name, pito.name);
    }

    #[test]
    fn placing_a_host_moves_it_between_projects_and_renaming_keeps_its_hosts() {
        let mut space = Account::default();
        space.place("a.example.com", "Shop");
        space.place("b.example.com", "shop");
        assert_eq!(space.projects.len(), 1);
        assert_eq!(space.projects["Shop"], ["a.example.com", "b.example.com"]);
        space.place("a.example.com", "Blog");
        assert_eq!(space.projects["Shop"], ["b.example.com"]);
        assert_eq!(space.projects["Blog"], ["a.example.com"]);
        space.rename_project("blog", "Notes");
        assert_eq!(space.project_of("a.example.com"), Some("Notes"));
        assert!(!space.projects.contains_key("Blog"));
        space.unplace("b.example.com");
        assert!(space.projects["Shop"].is_empty());
        space.rename_project("gone", "Other");
        assert!(!space.projects.contains_key("Other"));
    }

    #[test]
    fn a_hosts_project_comes_from_its_spaces_mapping() {
        let config: Config = toml::from_str(
            r#"
            [spaces.a]
            account_id = "1"
            token = ""
            [spaces.a.projects]
            Shop = ["x.example.com"]
            [hosts."x.example.com"]
            space = "a"
            [hosts."y.example.com"]
            space = "a"
            "#,
        )
        .unwrap();
        assert_eq!(config.project_of_host("x.example.com"), Some("Shop"));
        assert_eq!(config.project_of_host("y.example.com"), None);
        assert_eq!(config.project_of_host("z.example.com"), None);
    }

    #[test]
    fn the_space_errors_and_a_bare_space_flag_say_space() {
        let none = accounts(None, &[]);
        assert_eq!(
            none.account(None).err().unwrap(),
            "no space yet; run p99 setup"
        );
        let two = accounts(None, &["a", "b"]);
        assert_eq!(
            two.account(None).err().unwrap(),
            "several spaces; name one with --space"
        );
        assert_eq!(
            two.account(Some("c")).err().unwrap(),
            "no space is called c"
        );
        assert_eq!(
            two.account(Some(WHOLE)).err().unwrap(),
            "--space names a space here; p99 spaces lists them"
        );
        assert_eq!(two.bases("c", None).err().unwrap(), "no space is called c");
    }

    #[test]
    fn p99_key_space_is_read_before_p99_key_account() {
        let name = |v: &str| Some(std::ffi::OsString::from(v));
        assert_eq!(bound_space(name("a"), name("b")), name("a"));
        assert_eq!(bound_space(None, name("b")), name("b"));
        assert_eq!(bound_space(name("a"), None), name("a"));
        assert_eq!(bound_space(None, None), None);
        let two = accounts(Some("main"), &["main", "other"]);
        assert_eq!(
            holder_from(
                Some("k".into()),
                bound_space(name("other"), name("main")),
                &two
            )
            .unwrap()
            .as_deref(),
            Some("other")
        );
    }
}

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default)]
    pub me: Me,
    #[serde(default)]
    pub accounts: BTreeMap<String, Account>,
    #[serde(default)]
    pub hosts: BTreeMap<String, Host>,
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
    pub token: String,
    #[serde(default = "p99")]
    pub worker: String,
    #[serde(default = "p99")]
    pub database: String,
    #[serde(default)]
    pub database_id: String,
    #[serde(default = "p99")]
    pub bucket: String,
    #[serde(default)]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resend_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mail_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_client_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "AccountMe::is_empty")]
    pub me: AccountMe,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub projects: BTreeMap<String, Vec<String>>,
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
    pub account: String,
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
        Config::load_from(&path())
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
        let name = match name.or(self.default_account.as_deref()) {
            Some(name) => name,
            None if self.accounts.len() == 1 => self.accounts.keys().next().unwrap(),
            None if self.accounts.is_empty() => return Err("no account yet; run p99 setup".into()),
            None => return Err("several accounts; name one with --account".into()),
        };
        self.accounts
            .get_key_value(name)
            .map(|(k, v)| (k.as_str(), v))
            .ok_or_else(|| format!("no account is called {name}"))
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
            .ok_or_else(|| format!("no account is called {account}"))?;
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
                "the account {account} has no host yet; p99 hosts add"
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
                .any(|s| !s.is_empty() && !crate::vault::is_reference(s))
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

const KNOWN_KEYS: [&str; 34] = [
    "default_account",
    "license",
    "me",
    "accounts",
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
    "account",
    "env",
    "theme",
    "strings",
    "corner",
    "offset",
    "above",
    "off",
    "feed",
    "link",
    "x",
    "y",
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

pub fn secret(value: &str) -> Result<String, String> {
    crate::vault::read(value)
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
        env::var_os("P99_KEY_ACCOUNT"),
        config,
    )
}

fn holder_from(
    given: Option<std::ffi::OsString>,
    bound: Option<std::ffi::OsString>,
    config: &Config,
) -> Result<Option<String>, String> {
    if given.is_none() {
        return Ok(None);
    }
    key_from(given, "")?;
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

fn key_from(given: Option<std::ffi::OsString>, configured: &str) -> Result<String, String> {
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
    const OTHER: &str = "s3cr3t-Hd5Tz1Pc9Ny6";

    fn broken(text: &str) -> String {
        let error = toml::from_str::<Config>(text)
            .err()
            .expect("the text is broken");
        parse_error(Path::new("config.toml"), text, &error)
    }

    fn account_with(line: &str) -> String {
        format!("[accounts.main]\naccount_id = \"a\"\n{line}\ndatabase_id = \"d\"\n")
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
            "accounts.main.account_id = \"a\"\naccounts.main.token = \"{SECRET}\n"
        ));
        hides(&message, &[SECRET]);
        assert!(
            message.starts_with("config.toml: line 2, key token: "),
            "{message}"
        );
        let message = broken(&format!(
            "[accounts.main]\naccount_id = \"a\"\nme = {{ name = \"Ada Lovelace\", token = {SECRET} }}\n"
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
            "{}[hosts.\"example.com\"]\naccount = \"main\"\n",
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
        let message = broken("[hosts.\"example.com\"]\naccount = \"main\"\nfeed = maybe\n");
        assert!(
            message.starts_with("config.toml: line 3, key feed: "),
            "{message}"
        );
        assert!(!message.contains("not shown"), "{message}");
        let message = broken("[accounts.main]\ntoken = \"\"\n");
        assert!(message.starts_with("config.toml: line "), "{message}");
        assert!(message.contains("account_id"), "{message}");
        assert!(!message.contains("not shown"), "{message}");
    }

    #[test]
    fn keys_on_reads_every_key_of_a_line_and_survives_any_text() {
        assert_eq!(keys_on("token = \"a=b\" key = 1"), ["token", "a", "key"]);
        assert_eq!(keys_on("accounts.main.token = 1"), ["token"]);
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
        let named = ["accounts", "hosts", "theme", "strings"].contains(&path);
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
                account_id: "a".into(),
                token: "t".into(),
                worker: "w".into(),
                database: "d".into(),
                database_id: "i".into(),
                bucket: "b".into(),
                key: "k".into(),
                url: full("https://example.com"),
                app: full("app.example.com"),
                resend_key: full("r"),
                mail_from: full("P99 <p99@example.com>"),
                access_client_id: full("c"),
                access_client_secret: full("s"),
                code: full("o"),
                me: AccountMe {
                    name: full("Grace Hopper"),
                    email: full("grace@example.com"),
                    agent: Some(true),
                },
                ..Account::default()
            },
        );
        config.hosts.insert(
            "example.com".into(),
            Host {
                account: "main".into(),
                env: "production".into(),
                theme: [("accent".to_owned(), "#000".to_owned())].into(),
                strings: [("title".to_owned(), "Hi".to_owned())].into(),
                corner: full("bottom-left"),
                offset: Some(Offset { x: 1, y: 2 }),
                above: full("#footer"),
                off: vec!["/admin".into()],
                feed: true,
                link: Some(true),
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

            [accounts.main]
            account_id = "a"
            token = ""
            me = { name = "Grace Hopper", email = "grace@example.org" }

            [accounts.custom]
            account_id = "b"
            token = ""
            url = "https://p99.example.org/_p99/"

            [hosts."dev.example.com"]
            account = "main"
            env = "dev"

            [hosts."a.example.com"]
            account = "main"
            env = "staging"

            [hosts."example.com"]
            account = "main"
            env = "production"

            [hosts."example.org"]
            account = "custom"
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
        assert_eq!(key_from(given("from-env"), "inline").unwrap(), "from-env");
        assert_eq!(
            key_from(given("from-env"), "op://Example/p99/key").unwrap(),
            "from-env"
        );
        assert_eq!(key_from(given(" padded "), "inline").unwrap(), " padded ");
    }

    #[test]
    fn without_p99_key_the_configured_key_is_used() {
        assert_eq!(key_from(None, "inline").unwrap(), "inline");
    }

    #[test]
    fn an_empty_p99_key_is_refused_without_the_configured_key() {
        for empty in ["", " ", "\t\n  "] {
            assert_eq!(
                key_from(Some(empty.into()), "inline").unwrap_err(),
                "P99_KEY is set but empty; unset it or give the key"
            );
            assert_eq!(
                key_from(Some(empty.into()), "op://Example/p99/key").unwrap_err(),
                "P99_KEY is set but empty; unset it or give the key"
            );
        }
    }

    fn accounts(default: Option<&str>, names: &[&str]) -> Config {
        let mut text = default
            .map(|d| format!("default_account = \"{d}\"\n"))
            .unwrap_or_default();
        for name in names {
            text.push_str(&format!(
                "[accounts.{name}]\naccount_id = \"{name}\"\ntoken = \"\"\n"
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
        let why = key_from(Some(raw), "inline").unwrap_err();
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
        [accounts.main]
        account_id = "a"
        token = "cf-inline-token"
        key = "op://Vault/P99/key"
        "#;

    const REFERENCES: &str = r#"
        [accounts.main]
        account_id = "a"
        token = "op://Vault/Cloudflare/token"
        key = "op://Vault/P99/key"
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
        assert_eq!(config.accounts["main"].token, "op://Vault/Cloudflare/token");
        assert!(!config.has_inline_secret());
        let _ = fs::remove_dir_all(&dir);
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

            [accounts.shop]
            account_id = "a"
            token = ""

            [accounts.shop.me]
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
}

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
            toml::from_str(&text).map_err(|error| format!("{}: {error}", file.display()))?;
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

pub fn secret(value: &str) -> Result<String, String> {
    crate::vault::read(value)
}

pub fn token(account: &Account) -> Result<String, String> {
    match env::var("P99_TOKEN") {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => secret(&account.token),
    }
}

pub fn agent(flag: bool, me: &Me) -> bool {
    if flag {
        return true;
    }
    match env::var("P99_AGENT") {
        Ok(value) if !value.trim().is_empty() => value.trim() != "0",
        _ => me.agent,
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
}

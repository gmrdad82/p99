use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_account: Option<String>,
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    #[serde(default = "p99")]
    pub key_id: String,
    #[serde(default)]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resend_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mail_from: Option<String>,
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

    pub fn host(&self, host: &str) -> Result<(&Host, &Account), String> {
        let entry = self
            .hosts
            .get(host)
            .ok_or_else(|| format!("no host is called {host}; p99 hosts lists them"))?;
        let account = self.accounts.get(&entry.account).ok_or_else(|| {
            format!(
                "{host} names the account {}, which is missing",
                entry.account
            )
        })?;
        Ok((entry, account))
    }

    pub fn hosts_of(&self, account: &str) -> Vec<&str> {
        self.hosts
            .iter()
            .filter(|(_, h)| h.account == account)
            .map(|(name, _)| name.as_str())
            .collect()
    }

    pub fn url(&self, account: &str) -> Result<String, String> {
        let entry = self
            .accounts
            .get(account)
            .ok_or_else(|| format!("no account is called {account}"))?;
        if let Some(url) = &entry.url {
            return Ok(url.trim_end_matches('/').to_owned());
        }
        self.hosts_of(account)
            .first()
            .map(|host| format!("https://{host}/_p99"))
            .ok_or_else(|| format!("the account {account} has no host yet; p99 hosts add"))
    }

    fn has_inline_secret(&self) -> bool {
        self.accounts.values().any(|a| {
            [Some(&a.token), Some(&a.key), a.resend_key.as_ref()]
                .into_iter()
                .flatten()
                .any(|s| !s.is_empty() && !crate::vault::is_reference(s))
        })
    }
}

pub fn secret(value: &str) -> Result<String, String> {
    crate::vault::read(value)
}

pub fn agent(flag: Option<&str>) -> Option<String> {
    flag.map(str::to_owned)
        .or_else(|| env::var("P99_AGENT").ok())
        .map(|label| label.trim().to_owned())
        .filter(|label| !label.is_empty())
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

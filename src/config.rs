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

pub fn key(account: &Account, in_use: bool) -> Result<String, String> {
    key_from(env::var_os("P99_KEY").filter(|_| in_use), &account.key)
}

pub fn key_holder(config: &Config, named: Option<&str>) -> Result<Option<String>, String> {
    holder_from(env::var_os("P99_KEY"), config, named)
}

fn holder_from(
    given: Option<std::ffi::OsString>,
    config: &Config,
    named: Option<&str>,
) -> Result<Option<String>, String> {
    if given.is_none() {
        return Ok(None);
    }
    key_from(given, "")?;
    match config.account(named) {
        Ok((name, _)) => Ok(Some(name.to_owned())),
        Err(_) if named.is_none() && config.accounts.len() > 1 => {
            Err("P99_KEY signs one account; name it with --account".to_owned())
        }
        Err(why) => Err(why),
    }
}

pub fn key_overridden() -> bool {
    env::var_os("P99_KEY").is_some()
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

    #[test]
    fn p99_key_signs_only_the_account_in_use() {
        let account = Account {
            key: "inline".into(),
            ..Account::default()
        };
        assert_eq!(key(&account, false).unwrap(), "inline");
        let given = || Some(std::ffi::OsString::from("from-env"));
        let one = accounts(None, &["main"]);
        assert_eq!(holder_from(None, &one, None).unwrap(), None);
        assert_eq!(
            holder_from(given(), &one, None).unwrap().as_deref(),
            Some("main")
        );
        let two = accounts(Some("other"), &["main", "other"]);
        assert_eq!(
            holder_from(given(), &two, None).unwrap().as_deref(),
            Some("other")
        );
        assert_eq!(
            holder_from(given(), &two, Some("main")).unwrap().as_deref(),
            Some("main")
        );
    }

    #[test]
    fn p99_key_with_several_accounts_and_no_default_needs_one_named() {
        let given = || Some(std::ffi::OsString::from("from-env"));
        let two = accounts(None, &["main", "other"]);
        assert_eq!(holder_from(None, &two, None).unwrap(), None);
        assert_eq!(
            holder_from(given(), &two, None).unwrap_err(),
            "P99_KEY signs one account; name it with --account"
        );
        assert_eq!(
            holder_from(given(), &two, Some("other"))
                .unwrap()
                .as_deref(),
            Some("other")
        );
        assert_eq!(
            holder_from(given(), &two, Some("gone")).unwrap_err(),
            "no account is called gone"
        );
        assert_eq!(
            holder_from(Some(" ".into()), &two, None).unwrap_err(),
            "P99_KEY is set but empty; unset it or give the key"
        );
        assert_eq!(
            holder_from(given(), &accounts(None, &[]), None).unwrap_err(),
            "no account yet; run p99 setup"
        );
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
}

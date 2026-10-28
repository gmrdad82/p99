use std::fmt;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::de::{self, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::vault;

pub const WAIT: Duration = Duration::from_secs(20);

const FIELDS: [&str; 3] = ["file", "env", "command"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Secret {
    Text(String),
    File(String),
    Env(String),
    Command(Vec<String>),
}

impl Default for Secret {
    fn default() -> Secret {
        Secret::Text(String::new())
    }
}

impl From<&str> for Secret {
    fn from(value: &str) -> Secret {
        Secret::Text(value.to_owned())
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Secret {
        Secret::Text(value)
    }
}

impl PartialEq<&str> for Secret {
    fn eq(&self, other: &&str) -> bool {
        matches!(self, Secret::Text(text) if text == other)
    }
}

impl Secret {
    pub fn is_empty(&self) -> bool {
        matches!(self, Secret::Text(text) if text.is_empty())
    }

    pub fn is_blank(&self) -> bool {
        matches!(self, Secret::Text(text) if text.trim().is_empty())
    }

    pub fn is_inline(&self) -> bool {
        matches!(self, Secret::Text(text) if !text.is_empty() && !vault::is_reference(text))
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Secret::Text(text) if vault::is_reference(text) => "vault",
            Secret::Text(_) => "config",
            Secret::File(_) => "file",
            Secret::Env(_) => "env",
            Secret::Command(_) => "command",
        }
    }

    pub fn kept(&self) -> String {
        match self {
            Secret::Text(text) if vault::is_reference(text) => "kept in the vault".to_owned(),
            Secret::Text(_) => "in the config (mode 0600)".to_owned(),
            Secret::File(path) => format!("read from the file {path}"),
            Secret::Env(name) => format!("read from the variable {name}"),
            Secret::Command(words) => format!("read from the command {}", words[0]),
        }
    }

    pub fn slow_source(&self) -> Option<String> {
        match self {
            Secret::Text(text) if vault::is_reference(text) => Some(vault::tool().to_owned()),
            Secret::Command(words) => Some(format!("the command {}", words[0])),
            _ => None,
        }
    }

    pub fn from_spec(spec: &str) -> Result<Secret, String> {
        let spec = spec.trim();
        if let Some(path) = spec.strip_prefix("file:") {
            return nonempty(path, "file:").map(|p| Secret::File(p.to_owned()));
        }
        if let Some(name) = spec.strip_prefix("env:") {
            return nonempty(name, "env:").map(|n| Secret::Env(n.to_owned()));
        }
        if let Some(words) = spec.strip_prefix("command:") {
            return Ok(Secret::Command(split_words(words)?));
        }
        Ok(Secret::Text(spec.to_owned()))
    }

    pub fn read(&self) -> Result<String, String> {
        self.read_within(WAIT)
    }

    pub fn read_within(&self, wait: Duration) -> Result<String, String> {
        match self {
            Secret::Text(text) => vault::read(text),
            Secret::File(path) => from_file(path),
            Secret::Env(name) => from_env(name),
            Secret::Command(words) => from_command(words, wait),
        }
    }
}

fn nonempty<'a>(value: &'a str, prefix: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{prefix} needs something after it"))
    } else {
        Ok(value)
    }
}

pub fn split_words(text: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut started = false;
    let mut quote: Option<char> = None;
    for c in text.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            (None, c) => {
                word.push(c);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("a quote in the command is never closed".to_owned());
    }
    if started {
        words.push(word);
    }
    if words.is_empty() || words[0].is_empty() {
        return Err("command: needs a program to run".to_owned());
    }
    Ok(words)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), home()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

#[cfg(unix)]
fn others_can_read(meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o077 != 0
}

#[cfg(not(unix))]
fn others_can_read(_: &fs::Metadata) -> bool {
    false
}

fn from_file(path: &str) -> Result<String, String> {
    let file = expand(path);
    let meta = fs::metadata(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    if !meta.is_file() {
        return Err(format!("{}: not a file", file.display()));
    }
    if others_can_read(&meta) {
        return Err(format!(
            "{}: other users can read this file; make it yours alone (chmod 600)",
            file.display()
        ));
    }
    let bytes = fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{}: not UTF-8", file.display()))?;
    let text = text.trim();
    if text.is_empty() {
        return Err(format!("{}: is empty", file.display()));
    }
    Ok(text.to_owned())
}

fn from_env(name: &str) -> Result<String, String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        Ok(_) => Err(format!("{name}: the variable is empty")),
        Err(_) => Err(format!("{name}: the variable is not set")),
    }
}

fn drain<R: Read + Send + 'static>(mut from: R) -> mpsc::Receiver<Vec<u8>> {
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = from.read_to_end(&mut bytes);
        let _ = send.send(bytes);
    });
    receive
}

fn from_command(words: &[String], wait: Duration) -> Result<String, String> {
    let Some(name) = words.first().filter(|w| !w.is_empty()) else {
        return Err("command: needs a program to run".to_owned());
    };
    let mut child = Command::new(name)
        .args(&words[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{name}: {e}"))?;
    let out = child.stdout.take().map(drain);
    let err = child.stderr.take().map(drain);
    let deadline = Instant::now() + wait;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{name}: gave no answer within {}s",
                    wait.as_secs().max(1)
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(5)),
            Err(e) => return Err(format!("{name}: {e}")),
        }
    };
    let left = deadline.saturating_duration_since(Instant::now());
    let collect = |receive: Option<mpsc::Receiver<Vec<u8>>>| {
        receive
            .and_then(|r| r.recv_timeout(left.max(Duration::from_millis(50))).ok())
            .unwrap_or_default()
    };
    let stdout = collect(out);
    let stderr = collect(err);
    if !status.success() {
        let said = String::from_utf8_lossy(&stderr);
        let said = said.lines().map(str::trim).find(|l| !l.is_empty());
        return Err(match (said, status.code()) {
            (Some(said), _) => format!("{name}: {}", cut(said)),
            (None, Some(code)) => format!("{name}: exited with status {code}"),
            (None, None) => format!("{name}: stopped by a signal"),
        });
    }
    let text = String::from_utf8(stdout).map_err(|_| format!("{name}: its output is not UTF-8"))?;
    let text = text.trim();
    if text.is_empty() {
        return Err(format!("{name}: printed nothing"));
    }
    Ok(text.to_owned())
}

fn cut(line: &str) -> String {
    match line.char_indices().nth(200) {
        Some((at, _)) => format!("{}…", &line[..at]),
        None => line.to_owned(),
    }
}

impl Serialize for Secret {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Secret::Text(text) => serializer.serialize_str(text),
            Secret::File(path) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("file", path)?;
                map.end()
            }
            Secret::Env(name) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("env", name)?;
                map.end()
            }
            Secret::Command(words) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("command", words)?;
                map.end()
            }
        }
    }
}

struct SecretVisitor;

impl<'de> Visitor<'de> for SecretVisitor {
    type Value = Secret;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a secret: text, or a table with one of file, env or command")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Secret, E> {
        Ok(Secret::Text(value.to_owned()))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Secret, E> {
        Ok(Secret::Text(value))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Secret, A::Error> {
        let mut found: Option<Secret> = None;
        while let Some(key) = map.next_key::<String>()? {
            let next = match key.as_str() {
                "file" => Secret::File(map.next_value()?),
                "env" => Secret::Env(map.next_value()?),
                "command" => Secret::Command(map.next_value()?),
                other => return Err(de::Error::unknown_field(other, &FIELDS)),
            };
            if found.is_some() {
                return Err(de::Error::custom(
                    "a secret takes one of file, env or command, not several",
                ));
            }
            found = Some(next);
        }
        let secret =
            found.ok_or_else(|| de::Error::custom("a secret table needs file, env or command"))?;
        match &secret {
            Secret::File(v) | Secret::Env(v) if v.trim().is_empty() => {
                Err(de::Error::custom("a secret's file or env is empty"))
            }
            Secret::Command(words) if words.first().is_none_or(|w| w.is_empty()) => Err(
                de::Error::custom("a secret's command needs a program to run"),
            ),
            _ => Ok(secret),
        }
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Secret, D::Error> {
        deserializer.deserialize_any(SecretVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    struct Holder {
        token: Secret,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        other: Option<Secret>,
    }

    fn parsed(text: &str) -> Result<Holder, String> {
        toml::from_str(text).map_err(|e| e.message().to_owned())
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("p99-secret-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    fn sh(body: &str, args: &[&str]) -> Secret {
        let mut words = vec!["sh".to_owned(), "-c".into(), body.into(), "tool".into()];
        words.extend(args.iter().map(|a| (*a).to_owned()));
        Secret::Command(words)
    }

    #[test]
    fn a_plain_string_is_text_and_stays_a_string_when_written() {
        let holder = parsed("token = \"abc-123\"").unwrap();
        assert_eq!(holder.token, Secret::Text("abc-123".into()));
        assert_eq!(toml::to_string(&holder).unwrap(), "token = \"abc-123\"\n");
    }

    #[test]
    fn the_three_table_forms_parse_and_write_back_as_themselves() {
        let file = parsed("token = { file = \"~/.p99-token\" }").unwrap();
        assert_eq!(file.token, Secret::File("~/.p99-token".into()));
        let env = parsed("token = { env = \"CF_TOKEN\" }").unwrap();
        assert_eq!(env.token, Secret::Env("CF_TOKEN".into()));
        let command = parsed("token = { command = [\"pass\", \"show\", \"cf\"] }").unwrap();
        assert_eq!(
            command.token,
            Secret::Command(vec!["pass".into(), "show".into(), "cf".into()])
        );
        for holder in [file, env, command] {
            let text = toml::to_string_pretty(&holder).unwrap();
            assert_eq!(parsed(&text).unwrap(), holder, "{text}");
        }
    }

    #[test]
    fn a_secret_table_with_two_sources_none_or_an_unknown_one_is_refused() {
        assert!(
            parsed("token = { file = \"a\", env = \"B\" }")
                .unwrap_err()
                .contains("not several")
        );
        assert!(
            parsed("token = {}")
                .unwrap_err()
                .contains("needs file, env or command")
        );
        assert!(
            parsed("token = { fle = \"a\" }")
                .unwrap_err()
                .contains("fle")
        );
        assert!(
            parsed("token = { env = \"\" }")
                .unwrap_err()
                .contains("empty")
        );
        assert!(
            parsed("token = { command = [] }")
                .unwrap_err()
                .contains("needs a program")
        );
        assert!(parsed("token = 5").unwrap_err().contains("a secret"));
    }

    #[test]
    fn a_spec_names_its_source_and_anything_else_is_the_text() {
        assert_eq!(
            Secret::from_spec("env:CF_TOKEN").unwrap(),
            Secret::Env("CF_TOKEN".into())
        );
        assert_eq!(
            Secret::from_spec("file:/run/p99").unwrap(),
            Secret::File("/run/p99".into())
        );
        assert_eq!(
            Secret::from_spec("command:pass show \"my item\"").unwrap(),
            Secret::Command(vec!["pass".into(), "show".into(), "my item".into()])
        );
        assert_eq!(
            Secret::from_spec("plain-token").unwrap(),
            Secret::Text("plain-token".into())
        );
        assert!(Secret::from_spec("env:").is_err());
        assert!(Secret::from_spec("file: ").is_err());
        assert!(Secret::from_spec("command:").is_err());
        assert!(Secret::from_spec("command:pass \"open").is_err());
    }

    #[test]
    fn words_split_on_spaces_and_keep_quoted_runs_whole() {
        assert_eq!(split_words("a  b").unwrap(), vec!["a", "b"]);
        assert_eq!(
            split_words("a 'b c' \"d e\"").unwrap(),
            vec!["a", "b c", "d e"]
        );
        assert_eq!(split_words("a \"\" b").unwrap(), vec!["a", "", "b"]);
        assert!(split_words("   ").is_err());
    }

    #[test]
    fn blank_inline_and_vault_text_are_told_apart() {
        assert!(Secret::default().is_empty());
        assert!(Secret::from("  ").is_blank());
        assert!(!Secret::from("  ").is_empty());
        assert!(Secret::from("abc").is_inline());
        assert!(!Secret::from("").is_inline());
        assert!(!Secret::Env("X".into()).is_inline());
        assert_eq!(Secret::from("abc").kind(), "config");
        assert_eq!(Secret::Env("X".into()).kind(), "env");
        assert_eq!(Secret::File("x".into()).kind(), "file");
        assert_eq!(Secret::Command(vec!["x".into()]).kind(), "command");
    }

    #[test]
    fn plain_text_reads_as_it_is() {
        assert_eq!(Secret::from("  as-is ").read().unwrap(), "  as-is ");
    }

    #[test]
    fn a_variable_is_read_trimmed_and_named_when_unset_or_empty() {
        let name = "P99_SECRET_TEST_VARIABLE_UNSET";
        assert_eq!(
            Secret::Env(name.into()).read().unwrap_err(),
            format!("{name}: the variable is not set")
        );
        assert_eq!(
            Secret::Env("PATH".into()).read().unwrap(),
            std::env::var("PATH").unwrap().trim()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_only_the_owner_can_read_is_read_trimmed() {
        let dir = scratch("file-ok");
        let file = dir.join("token");
        fs::write(&file, "  cf-token\n\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            Secret::File(file.display().to_string()).read().unwrap(),
            "cf-token"
        );
        fs::set_permissions(&file, fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            Secret::File(file.display().to_string()).read().unwrap(),
            "cf-token"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_the_group_or_the_world_can_read_is_refused_without_a_word_of_it() {
        let dir = scratch("file-open");
        let file = dir.join("token");
        fs::write(&file, "cf-token-never-shown").unwrap();
        for mode in [0o640, 0o604, 0o644, 0o660, 0o666, 0o777] {
            fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();
            let why = Secret::File(file.display().to_string()).read().unwrap_err();
            assert!(
                why.contains("other users can read this file"),
                "{mode:o}: {why}"
            );
            assert!(why.contains("chmod 600"), "{why}");
            assert!(!why.contains("never-shown"), "{why}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_empty_or_binary_file_and_a_directory_are_each_named() {
        let dir = scratch("file-bad");
        let missing = Secret::File(dir.join("nope").display().to_string());
        assert!(missing.read().unwrap_err().contains("nope"));
        let empty = dir.join("empty");
        fs::write(&empty, "\n").unwrap();
        fs::set_permissions(&empty, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            Secret::File(empty.display().to_string())
                .read()
                .unwrap_err()
                .ends_with(": is empty")
        );
        let binary = dir.join("binary");
        fs::write(&binary, [0xff, 0xfe]).unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            Secret::File(binary.display().to_string())
                .read()
                .unwrap_err()
                .ends_with(": not UTF-8")
        );
        assert!(
            Secret::File(dir.display().to_string())
                .read()
                .unwrap_err()
                .ends_with(": not a file")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_command_is_run_without_a_shell_and_its_output_trimmed() {
        let secret = sh("printf '%s\\n' \"$1$2\"", &["a b", "; echo no"]);
        assert_eq!(secret.read().unwrap(), "a b; echo no");
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_command_says_why_in_one_line() {
        let said = sh(
            "echo 'item not found' >&2; echo 'second line' >&2; exit 3",
            &[],
        );
        assert_eq!(said.read().unwrap_err(), "sh: item not found");
        assert_eq!(
            sh("exit 4", &[]).read().unwrap_err(),
            "sh: exited with status 4"
        );
        assert_eq!(sh("exit 0", &[]).read().unwrap_err(), "sh: printed nothing");
        let missing = Secret::Command(vec!["p99-no-such-tool".into()])
            .read()
            .unwrap_err();
        assert!(missing.starts_with("p99-no-such-tool: "), "{missing}");
        assert!(!missing.contains('\n'));
    }

    #[cfg(unix)]
    #[test]
    fn a_command_that_does_not_answer_in_time_is_stopped_and_named() {
        let started = Instant::now();
        let why = sh("exec sleep 30", &[])
            .read_within(Duration::from_millis(150))
            .unwrap_err();
        assert_eq!(why, "sh: gave no answer within 1s");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn where_a_secret_is_kept_is_said_for_each_source() {
        assert_eq!(Secret::from("abc").kept(), "in the config (mode 0600)");
        assert_eq!(Secret::File("/a".into()).kept(), "read from the file /a");
        assert_eq!(Secret::Env("A".into()).kept(), "read from the variable A");
        assert_eq!(
            Secret::Command(vec!["pass".into(), "show".into()]).kept(),
            "read from the command pass"
        );
        assert_eq!(
            Secret::Command(vec!["pass".into()])
                .slow_source()
                .as_deref(),
            Some("the command pass")
        );
        assert!(Secret::from("abc").slow_source().is_none());
        assert!(Secret::Env("A".into()).slow_source().is_none());
    }
}

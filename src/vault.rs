use std::io::Write;
use std::process::{Command, Stdio};

const SCHEME: &str = "op://";
const TOOL: &str = "the 1Password CLI";

pub fn is_reference(value: &str) -> bool {
    value.starts_with(SCHEME)
}

pub fn read(value: &str) -> Result<String, String> {
    if !is_reference(value) {
        return Ok(value.to_owned());
    }
    let out = Command::new("op")
        .args(["read", "--no-newline", value])
        .output()
        .map_err(|error| format!("{value}: {error}; is {TOOL} installed?"))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        return Err(format!("{value}: {}", why.trim()));
    }
    String::from_utf8(out.stdout).map_err(|_| format!("{value}: not UTF-8"))
}

pub fn tool() -> &'static str {
    TOOL
}

pub fn available() -> bool {
    Command::new("op")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub fn store(vault: &str, title: &str, secret: &str) -> Result<String, String> {
    let template = serde_json::json!({
        "title": title,
        "category": "API_CREDENTIAL",
        "fields": [{
            "id": "credential",
            "type": "CONCEALED",
            "label": "credential",
            "value": secret,
        }],
    });
    let mut child = Command::new("op")
        .args(["item", "create", "--vault", vault, "--format", "json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{error}; is {TOOL} installed?"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(template.to_string().as_bytes())
        .map_err(|error| error.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "{TOOL}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let item: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("{TOOL}: {e}"))?;
    let vault_id = item["vault"]["id"].as_str().unwrap_or(vault);
    let item_id = item["id"]
        .as_str()
        .ok_or_else(|| format!("{TOOL} gave no item id"))?;
    Ok(format!("{SCHEME}{vault_id}/{item_id}/credential"))
}

pub fn resolve_ref(raw: &str) -> Result<String, String> {
    let value = if is_reference(raw) {
        read(raw)?
    } else if let Some(name) = raw.strip_prefix("env:") {
        std::env::var(name).map_err(|_| format!("{raw}: {name} is not set"))?
    } else {
        return Err(format!(
            "{raw} is not a reference; give op://vault/item/field or env:NAME"
        ));
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(format!("{raw} is empty"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_op_scheme_is_a_reference() {
        assert!(is_reference("op://vault/item/field"));
        assert!(!is_reference("OP://vault/item/field"));
        assert!(!is_reference(" op://vault/item/field"));
        assert!(!is_reference("env:P99_TOKEN"));
        assert!(!is_reference(""));
    }

    #[test]
    fn a_plain_value_reads_as_itself_without_op() {
        assert_eq!(read("plain-secret").unwrap(), "plain-secret");
        assert_eq!(read("").unwrap(), "");
        assert_eq!(read(" spaced \n").unwrap(), " spaced \n");
    }

    #[test]
    fn the_tool_is_named_for_people() {
        assert_eq!(tool(), "the 1Password CLI");
    }

    #[test]
    fn resolve_ref_reads_an_environment_variable_trimmed() {
        let path = std::env::var("PATH").unwrap();
        assert_eq!(resolve_ref("env:PATH").unwrap(), path.trim());
    }

    #[test]
    fn resolve_ref_names_an_unset_variable() {
        assert_eq!(
            resolve_ref("env:P99_SURELY_NEVER_SET_7F3A").unwrap_err(),
            "env:P99_SURELY_NEVER_SET_7F3A: P99_SURELY_NEVER_SET_7F3A is not set"
        );
    }

    #[test]
    fn resolve_ref_refuses_a_value_that_is_no_reference() {
        for raw in ["ghp_raw", "", "env", "op:/vault/item"] {
            assert_eq!(
                resolve_ref(raw).unwrap_err(),
                format!("{raw} is not a reference; give op://vault/item/field or env:NAME")
            );
        }
    }
}

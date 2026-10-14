use std::process::Command;

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

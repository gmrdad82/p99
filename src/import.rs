use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde_json::{Value, json};

use crate::client::Client;
use crate::wire::{
    ATTACHMENT_LIMIT, IMPORT_TYPES, ImportConflict, ImportFinish, ImportTally, KINDS, ROLES,
    STATUSES, item_number, prefix,
};

const BATCH_RECORDS: usize = 200;
const BATCH_BYTES: usize = 2 << 20;
const FINISH_ITEMS: usize = 5000;
const TITLE_CHARS: usize = 200;
const BODY_CHARS: usize = 20000;

#[derive(Debug, clap::Args)]
pub struct ImportArgs {
    #[arg(
        value_name = "bundle-dir",
        help = "a directory holding bundle.jsonl and the files it names"
    )]
    pub dir: PathBuf,
    #[arg(long, help = "the host the items belong to")]
    pub host: String,
    #[arg(long, help = "report what would change, and write nothing")]
    pub dry_run: bool,
}

#[derive(Debug, Clone)]
pub struct Record {
    pub line: usize,
    pub kind: &'static str,
    pub value: Value,
}

fn text<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn absent(value: &Value, field: &str) -> bool {
    value.get(field).is_none_or(Value::is_null)
}

fn is_email(value: &str) -> bool {
    let len = value.chars().count();
    (3..=254).contains(&len)
        && !value.chars().any(char::is_whitespace)
        && value
            .split_once('@')
            .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty() && !b.contains('@'))
}

fn is_uid(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn is_stamp(value: &str) -> bool {
    let b = value.as_bytes();
    value.len() >= 10
        && value.len() <= 64
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
}

fn is_env(value: &str) -> bool {
    let b = value.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-'))
}

fn need<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    text(value, field).ok_or_else(|| format!("{field} is required and must be text"))
}

fn stamp(value: &Value, field: &str, required: bool) -> Result<(), String> {
    if !required && absent(value, field) {
        return Ok(());
    }
    match text(value, field) {
        Some(s) if is_stamp(s) => Ok(()),
        _ => Err(format!(
            "{field} must be a date and time such as 2025-03-01T10:00:00Z"
        )),
    }
}

fn flag(value: &Value, field: &str) -> Result<bool, String> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        _ => Err(format!("{field} must be true or false")),
    }
}

fn email(value: &Value, field: &str) -> Result<(), String> {
    if is_email(need(value, field)?) {
        Ok(())
    } else {
        Err(format!("{field} must be an e-mail address"))
    }
}

fn person(value: &Value, field: &str) -> Result<(), String> {
    let who = value
        .get(field)
        .filter(|v| v.is_object())
        .ok_or_else(|| format!("{field} must be an object with an email"))?;
    email(who, "email").map_err(|e| format!("{field}.{e}"))?;
    if !absent(who, "name") && text(who, "name").is_none_or(|n| n.chars().count() > 200) {
        return Err(format!(
            "{field}.name must be text of at most 200 characters"
        ));
    }
    flag(who, "agent").map_err(|e| format!("{field}.{e}"))?;
    flag(who, "manager").map_err(|e| format!("{field}.{e}"))?;
    Ok(())
}

fn item_ref(value: &Value, field: &str) -> Result<i64, String> {
    text(value, field)
        .and_then(item_number)
        .ok_or_else(|| format!("{field} must be a key such as BUG-3"))
}

fn object_or_absent(value: &Value, field: &str) -> Result<(), String> {
    if absent(value, field) || value[field].is_object() {
        Ok(())
    } else {
        Err(format!("{field} must be an object"))
    }
}

fn check_item(value: &Value) -> Result<i64, String> {
    let key = need(value, "key")?.trim();
    let kind = need(value, "kind")?;
    if !KINDS.contains(&kind) {
        return Err(format!("kind must be one of {}", KINDS.join(", ")));
    }
    let id = item_number(key)
        .filter(|_| key.contains('-'))
        .ok_or("key must be a key such as BUG-3")?;
    let head = key.split('-').next().unwrap_or("");
    if !head.eq_ignore_ascii_case(prefix(kind)) {
        return Err(format!("a {kind} is keyed {}-<number>", prefix(kind)));
    }
    let title = need(value, "title")?.trim().chars().count();
    if !(1..=TITLE_CHARS).contains(&title) {
        return Err(format!("title must be 1 to {TITLE_CHARS} characters"));
    }
    if !absent(value, "body") && text(value, "body").is_none_or(|b| b.chars().count() > BODY_CHARS)
    {
        return Err(format!(
            "body must be text of at most {BODY_CHARS} characters"
        ));
    }
    if !absent(value, "status") && !STATUSES.contains(&need(value, "status")?) {
        return Err(format!("status must be one of {}", STATUSES.join(", ")));
    }
    person(value, "reporter")?;
    if !absent(value, "assignee") {
        email(value, "assignee")?;
    }
    if !absent(value, "duplicate_of") {
        item_ref(value, "duplicate_of")?;
    }
    if !absent(value, "env") && !is_env(need(value, "env")?) {
        return Err("env must name an environment".to_owned());
    }
    object_or_absent(value, "page")?;
    if let Some(url) = value.get("page").and_then(|p| text(p, "url"))
        && !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err("page.url must start with http:// or https://".to_owned());
    }
    object_or_absent(value, "context")?;
    if !absent(value, "marks") && !value["marks"].is_array() {
        return Err("marks must be a list".to_owned());
    }
    stamp(value, "created_at", true)?;
    stamp(value, "updated_at", false)?;
    stamp(value, "closed_at", false)?;
    Ok(id)
}

fn check_comment(value: &Value) -> Result<(), String> {
    item_ref(value, "item")?;
    person(value, "author")?;
    let body = need(value, "body")?;
    if body.trim().is_empty() || body.chars().count() > BODY_CHARS {
        return Err(format!("body must be 1 to {BODY_CHARS} characters"));
    }
    flag(value, "internal")?;
    stamp(value, "created_at", true)
}

fn bundle_file(dir: &Path, value: &Value) -> Result<PathBuf, String> {
    let file = need(value, "file")?;
    let relative = Path::new(file);
    if file.is_empty()
        || !relative
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!(
            "file must be a path inside the bundle directory: {file}"
        ));
    }
    Ok(dir.join(relative))
}

fn check_attachment(value: &Value, dir: &Path) -> Result<(), String> {
    item_ref(value, "item")?;
    if !absent(value, "comment") && !is_uid(need(value, "comment")?) {
        return Err("comment must be the uid of a comment".to_owned());
    }
    let role = if absent(value, "role") {
        "file"
    } else {
        need(value, "role")?
    };
    if !ROLES.contains(&role) {
        return Err(format!("role must be one of {}", ROLES.join(", ")));
    }
    let marked = !absent(value, "mark");
    if marked && value["mark"].as_u64().is_none_or(|m| m > 99) {
        return Err("mark must be the index of one of the item's marks".to_owned());
    }
    if marked != (role == "region") {
        return Err("a region carries a mark, and nothing else does".to_owned());
    }
    if !absent(value, "name")
        && text(value, "name").is_none_or(|n| {
            n.trim().is_empty() || n.contains(['/', '\\']) || n.chars().count() > 200
        })
    {
        return Err("name must be 1 to 200 characters, no slashes".to_owned());
    }
    if need(value, "content_type")?.trim().is_empty() {
        return Err("content_type must be the file's media type, such as image/png".to_owned());
    }
    flag(value, "internal")?;
    stamp(value, "created_at", false)?;
    let path = bundle_file(dir, value)?;
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .len();
    if size == 0 || size > ATTACHMENT_LIMIT as u64 {
        return Err(format!("{} must hold 1 byte to 20 MB", path.display()));
    }
    Ok(())
}

fn check_event(value: &Value) -> Result<(), String> {
    item_ref(value, "item")?;
    let kind = need(value, "kind")?;
    let ok = (1..=40).contains(&kind.len())
        && kind.starts_with(|c: char| c.is_ascii_lowercase())
        && kind.chars().all(|c| c.is_ascii_lowercase() || c == '_');
    if !ok {
        return Err("kind must be 1 to 40 lowercase letters or underscores".to_owned());
    }
    object_or_absent(value, "actor")?;
    if let Some(actor) = value.get("actor").filter(|a| a.is_object()) {
        if !absent(actor, "email") {
            email(actor, "email").map_err(|e| format!("actor.{e}"))?;
        }
        flag(actor, "agent").map_err(|e| format!("actor.{e}"))?;
    }
    object_or_absent(value, "detail")?;
    flag(value, "internal")?;
    stamp(value, "at", true)
}

fn check_landing(value: &Value) -> Result<(), String> {
    item_ref(value, "item")?;
    if !is_env(need(value, "env")?) {
        return Err("env must name an environment".to_owned());
    }
    let sha = need(value, "sha")?;
    if !(7..=64).contains(&sha.len()) || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("sha must be a commit id".to_owned());
    }
    stamp(value, "at", true)
}

fn check_read(value: &Value) -> Result<(), String> {
    item_ref(value, "item")?;
    email(value, "email")?;
    stamp(value, "at", true)
}

pub fn validate(text_in: &str, dir: &Path) -> Result<Vec<Record>, Vec<String>> {
    let mut records = Vec::new();
    let mut errors = Vec::new();
    let mut numbers: HashMap<i64, usize> = HashMap::new();
    let mut uids: HashMap<(&'static str, String), usize> = HashMap::new();
    for (index, raw) in text_in.lines().enumerate() {
        let line = index + 1;
        if raw.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(e) => {
                errors.push(format!("line {line}: not JSON: {e}"));
                continue;
            }
        };
        let Some(kind) = text(&value, "type").and_then(|t| IMPORT_TYPES.iter().find(|k| **k == t))
        else {
            errors.push(format!(
                "line {line}: type must be one of {}",
                IMPORT_TYPES.join(", ")
            ));
            continue;
        };
        let checked = match *kind {
            "item" => check_item(&value).and_then(|id| match numbers.insert(id, line) {
                Some(first) => Err(format!("number {id} is already taken on line {first}")),
                None => Ok(()),
            }),
            "comment" => check_comment(&value),
            "attachment" => check_attachment(&value, dir),
            "event" => check_event(&value),
            "landing" => check_landing(&value),
            "read" => check_read(&value),
            _ => email(&value, "email"),
        };
        let checked = checked.and_then(|()| {
            if !matches!(*kind, "comment" | "attachment") {
                return Ok(());
            }
            let uid = need(&value, "uid")?;
            if !is_uid(uid) {
                return Err(
                    "uid must be 1 to 64 letters, digits, dots, dashes or underscores".to_owned(),
                );
            }
            match uids.insert((kind, uid.to_owned()), line) {
                Some(first) => Err(format!("uid {uid} is already used on line {first}")),
                None => Ok(()),
            }
        });
        match checked {
            Ok(()) => records.push(Record { line, kind, value }),
            Err(why) => errors.push(format!("line {line}: {kind}: {why}")),
        }
    }
    if errors.is_empty() {
        Ok(records)
    } else {
        Err(errors)
    }
}

pub fn read(dir: &Path) -> Result<Vec<Record>, String> {
    let path = dir.join("bundle.jsonl");
    let content = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    validate(&content, dir).map_err(|errors| {
        format!(
            "{} has {} problems; nothing was sent\n{}",
            path.display(),
            errors.len(),
            errors.join("\n")
        )
    })
}

fn batches<'a>(group: &[&'a Record]) -> Vec<Vec<&'a Record>> {
    let mut out: Vec<Vec<&Record>> = Vec::new();
    let mut bytes = 0;
    for record in group {
        let size = record.value.to_string().len() + 1;
        let full = out
            .last()
            .is_none_or(|b| b.len() >= BATCH_RECORDS || bytes + size > BATCH_BYTES);
        if full {
            out.push(Vec::new());
            bytes = 0;
        }
        bytes += size;
        if let Some(last) = out.last_mut() {
            last.push(record);
        }
    }
    out
}

fn at_line(why: String, chunk: &[&Record]) -> String {
    let index = why
        .strip_prefix("record ")
        .and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|n| n.parse::<usize>().ok());
    match index.and_then(|n| chunk.get(n.wrapping_sub(1))) {
        Some(record) => format!("line {}: {why}", record.line),
        None => why,
    }
}

fn upload(client: &Client, host: &str, dir: &Path, record: &Record) -> Result<(), String> {
    let v = &record.value;
    let path = bundle_file(dir, v)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = text(v, "name").map(str::to_owned).unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_owned()
    });
    let owned = |field: &str| text(v, field).map(str::to_owned);
    let params = [
        ("item", owned("item")),
        ("comment", owned("comment")),
        ("role", owned("role")),
        (
            "mark",
            v.get("mark").and_then(Value::as_u64).map(|m| m.to_string()),
        ),
        ("name", Some(name)),
        (
            "internal",
            Some(if flag(v, "internal")? { "1" } else { "0" }.to_owned()),
        ),
        ("created_at", owned("created_at")),
    ];
    let uid = need(v, "uid")?;
    let kind = need(v, "content_type")?.trim();
    client
        .import_file(host, uid, &params, kind, &bytes)
        .map(|_| ())
        .map_err(|e| format!("line {}: {}: {e}", record.line, path.display()))
}

fn finish(client: &Client, host: &str, records: &[Record]) -> Result<ImportFinish, String> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut duplicates = Vec::new();
    for record in records {
        let field = if record.kind == "item" { "key" } else { "item" };
        if let Some(key) = text(&record.value, field)
            && matches!(record.kind, "item" | "comment" | "attachment")
            && seen.insert(item_number(key))
        {
            items.push(key.to_owned());
        }
        if record.kind == "item"
            && let Some(target) = text(&record.value, "duplicate_of")
        {
            duplicates.push(json!({"item": record.value["key"], "duplicate_of": target}));
        }
    }
    let mut total = ImportFinish::default();
    let chunks: Vec<&[String]> = if items.is_empty() {
        vec![&[]]
    } else {
        items.chunks(FINISH_ITEMS).collect()
    };
    for (i, chunk) in chunks.into_iter().enumerate() {
        let pairs = if i == 0 { duplicates.as_slice() } else { &[] };
        let done = client.import_finish(host, chunk, pairs)?;
        total.recounted += done.recounted;
        total.duplicates.linked += done.duplicates.linked;
        total.duplicates.conflicts.extend(done.duplicates.conflicts);
    }
    Ok(total)
}

pub fn run(client: &Client, args: &ImportArgs, json_out: bool) -> Result<(), String> {
    let host = args.host.trim().to_ascii_lowercase();
    let records = read(&args.dir)?;
    let progress = |line: String| {
        if json_out {
            eprintln!("{line}");
        } else {
            println!("{line}");
        }
    };
    let mut totals: BTreeMap<String, ImportTally> = BTreeMap::new();
    let mut managers: Vec<String> = Vec::new();
    let mut uploaded = 0;
    for kind in IMPORT_TYPES {
        let group: Vec<&Record> = records.iter().filter(|r| r.kind == kind).collect();
        if group.is_empty() {
            continue;
        }
        let tally = totals.entry(kind.to_owned()).or_default();
        let mut done = 0;
        for chunk in batches(&group) {
            let values: Vec<Value> = chunk.iter().map(|r| r.value.clone()).collect();
            let report = client
                .import(&host, args.dry_run, &values)
                .map_err(|why| at_line(why, &chunk))?;
            for counted in report.counts.into_values() {
                tally.new += counted.new;
                tally.existing += counted.existing;
                tally.conflicts.extend(counted.conflicts);
            }
            managers.extend(report.managers);
            if !args.dry_run {
                for uid in &report.upload {
                    if let Some(record) = chunk.iter().find(|r| text(&r.value, "uid") == Some(uid))
                    {
                        upload(client, &host, &args.dir, record)?;
                        uploaded += 1;
                    }
                }
            }
            done += chunk.len();
            progress(format!("{kind}: {done} of {} sent", group.len()));
        }
    }
    let finished = if args.dry_run {
        None
    } else {
        Some(finish(client, &host, &records)?)
    };
    let mut conflicts: Vec<(String, ImportConflict)> = totals
        .iter()
        .flat_map(|(kind, t)| t.conflicts.iter().map(|c| (kind.clone(), c.clone())))
        .collect();
    if let Some(done) = &finished {
        conflicts.extend(
            done.duplicates
                .conflicts
                .iter()
                .map(|c| ("duplicate_of".to_owned(), c.clone())),
        );
    }
    if json_out {
        let text_out = serde_json::to_string_pretty(&json!({
            "host": host,
            "dry_run": args.dry_run,
            "records": records.len(),
            "counts": totals,
            "uploaded": uploaded,
            "managers": managers,
            "finish": finished,
        }))
        .map_err(|e| e.to_string())?;
        println!("{text_out}");
    } else {
        print_summary(
            &host,
            args.dry_run,
            records.len(),
            &totals,
            uploaded,
            &managers,
            finished.as_ref(),
            &conflicts,
        );
    }
    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} records were left as they are; see the conflicts",
            conflicts.len()
        ))
    }
}

#[allow(clippy::too_many_arguments)]
fn print_summary(
    host: &str,
    dry_run: bool,
    count: usize,
    totals: &BTreeMap<String, ImportTally>,
    uploaded: usize,
    managers: &[String],
    finished: Option<&ImportFinish>,
    conflicts: &[(String, ImportConflict)],
) {
    if dry_run {
        println!("{host}: {count} records checked, nothing written (dry run)");
    } else {
        println!("{host}: {count} records imported");
    }
    println!(
        "  {:<11} {:>8} {:>9} {:>10}",
        "type", "new", "existing", "conflicts"
    );
    for kind in IMPORT_TYPES {
        if let Some(t) = totals.get(kind) {
            println!(
                "  {:<11} {:>8} {:>9} {:>10}",
                kind,
                t.new,
                t.existing,
                t.conflicts.len()
            );
        }
    }
    if !dry_run {
        println!("  files uploaded: {uploaded}");
    }
    if let Some(done) = finished {
        println!(
            "  items recounted: {}, duplicates linked: {}",
            done.recounted, done.duplicates.linked
        );
    }
    if !managers.is_empty() {
        println!(
            "these managers have no manager code yet; mint one each, or list them in MANAGERS:"
        );
        for email in managers {
            crate::wire::out!("  p99 invite {host} --manager --name \"<name>\" --email {email}");
        }
    }
    if !conflicts.is_empty() {
        println!("conflicts:");
        for (kind, c) in conflicts {
            crate::wire::out!("  {kind} {}: {}", c.reference, c.reason);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundle_is_checked_line_by_line_before_anything_is_sent() {
        let good = concat!(
            r#"{"type":"item","key":"BUG-7","kind":"bug","title":"The crème brûlée costs too much in the café","body":"","status":"confirmed","duplicate_of":null,"reporter":{"email":"ada@example.com","name":"Ada Lovelace","agent":false},"assignee":null,"env":null,"page":{"url":"https://example.com/cart","path":"/cart","title":"Cart"},"context":{},"marks":[],"created_at":"2025-03-01T10:00:00Z","updated_at":null,"closed_at":null}"#,
            "\n\n",
            r#"{"type":"comment","item":"BUG-7","uid":"c-1","author":{"email":"grace@example.com","name":"Grace Hopper","agent":false,"manager":true},"body":"Seen.","internal":false,"created_at":"2025-03-02T09:00:00Z"}"#,
            "\n",
            r#"{"type":"landing","item":"BUG-7","env":"production","sha":"0123abc","at":"2025-03-03T10:00:00Z"}"#,
            "\n",
            r#"{"type":"manager","email":"grace@example.com"}"#,
        );
        let records = validate(good, Path::new(".")).unwrap();
        assert_eq!(
            records.iter().map(|r| (r.line, r.kind)).collect::<Vec<_>>(),
            [(1, "item"), (3, "comment"), (4, "landing"), (5, "manager")]
        );
        assert_eq!(
            records[0].value["title"],
            "The crème brûlée costs too much in the café"
        );

        let bad = concat!(
            r#"{"type":"item","key":"FEAT-7","kind":"bug","title":"x","reporter":{"email":"ada@example.com"},"created_at":"2025-03-01"}"#,
            "\n",
            r#"{"type":"item","key":"BUG-7","kind":"bug","title":"x","reporter":{"email":"ada@example.com"},"created_at":"2025-03-01"}"#,
            "\n",
            r#"{"type":"item","key":"Q-7","kind":"question","title":"x","reporter":{"email":"ada@example.com"},"created_at":"2025-03-01"}"#,
            "\n",
            r#"{"type":"attachment","item":"BUG-7","uid":"a-1","content_type":"text/plain","file":"../secret.txt"}"#,
            "\nnot json\n",
            r#"{"type":"ticket"}"#,
        );
        let errors = validate(bad, Path::new(".")).unwrap_err();
        assert_eq!(errors.len(), 5, "{errors:#?}");
        assert!(errors[0].starts_with("line 1: item: a bug is keyed BUG-"));
        assert!(errors[1].starts_with("line 3: item: number 7 is already taken on line 2"));
        assert!(errors[2].starts_with("line 4:"));
        assert!(errors[3].starts_with("line 5: not JSON"));
        assert!(errors[4].starts_with("line 6: type must be"));
    }
}

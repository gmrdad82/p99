use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::cloudflare::Cloudflare;
use crate::config::Account;

pub const STEP: &str = "0018";

const Q_HOSTS: &str = "SELECT host FROM hosts ORDER BY host";

const Q_ITEMS: &str = "SELECT CASE WHEN trim(project) <> '' THEN trim(project) END AS named, host, count(*) AS items, COALESCE(sum(open), 0) AS open, min(id) AS earliest FROM items GROUP BY lower(trim(project)), host ORDER BY earliest, host";

const Q_WITHOUT: &str = "SELECT id, kind, host FROM items WHERE COALESCE(trim(project), '') = '' AND host NOT IN (SELECT host FROM hosts) ORDER BY id";

const Q_CODES: &str =
    "SELECT id, name, email, hosts_json, manager, revoked_at FROM codes ORDER BY id";

const Q_TOTALS: &str = "SELECT (SELECT count(*) FROM codes) AS codes, (SELECT count(*) FROM items) AS items, (SELECT COALESCE(sum(open), 0) FROM items) AS open, (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM attachments) AS attachments";

const Q_TAGS: &str =
    "SELECT count(*) AS old_tags, count(DISTINCT item_id) AS tagged FROM item_labels";

const KEPT: [&str; 6] = [
    "items",
    "open",
    "comments",
    "events",
    "attachments",
    "codes",
];

const GUARD: &str = "CHECK constraint failed: spaces_kept_";

pub struct Read {
    pub hosts: Vec<String>,
    pub groups: Vec<Value>,
    pub without: Vec<Value>,
    pub codes: Vec<Value>,
    pub totals: Value,
    pub tags: Value,
}

#[derive(Default)]
struct Projects {
    names: Vec<String>,
    index: BTreeMap<String, usize>,
}

impl Projects {
    fn add(&mut self, name: &str) -> usize {
        let key = name.to_ascii_lowercase();
        if let Some(at) = self.index.get(&key) {
            return *at;
        }
        self.names.push(name.to_owned());
        self.index.insert(key, self.names.len() - 1);
        self.names.len() - 1
    }

    fn find(&self, name: &str) -> Option<usize> {
        self.index.get(&name.to_ascii_lowercase()).copied()
    }
}

fn select(cf: &Cloudflare, account: &Account, sql: &str) -> Result<Vec<Value>, String> {
    if !sql.starts_with("SELECT ") || sql.contains(';') {
        return Err("the plan only reads, one SELECT at a time".into());
    }
    Ok(cf.query(&account.account_id, &account.database_id, sql, &[])?)
}

fn text(row: &Value, key: &str) -> String {
    row[key].as_str().unwrap_or_default().to_owned()
}

fn count(row: &Value, key: &str) -> i64 {
    row[key]
        .as_i64()
        .or_else(|| row[key].as_f64().map(|f| f as i64))
        .unwrap_or(0)
}

fn list(value: &Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

fn many(n: i64, one: &str, more: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { more })
}

fn person(name: &str, email: &str) -> String {
    if name.trim().is_empty() {
        email.to_owned()
    } else {
        format!("{} <{email}>", name.trim())
    }
}

fn applied(applied: &[String], step: &str) -> bool {
    applied.iter().any(|a| {
        a.strip_prefix(step)
            .is_some_and(|rest| rest.starts_with('_'))
    })
}

pub fn shown<'a>(space: &'a str, account: &'a Account) -> &'a str {
    account
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(space)
}

pub fn uncarded(sql: &str) -> String {
    sql.replace("project", "NULL")
}

pub fn plan(
    cf: &Cloudflare,
    slug: &str,
    account: &Account,
    done: &[String],
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let carded = applied(done, "0015");
    let items = |sql: &str| {
        if carded {
            select(cf, account, sql)
        } else {
            select(cf, account, &uncarded(sql))
        }
    };
    let first = |rows: Vec<Value>| rows.into_iter().next().unwrap_or_default();
    let read = Read {
        hosts: select(cf, account, Q_HOSTS)?
            .iter()
            .map(|r| text(r, "host"))
            .collect(),
        groups: items(Q_ITEMS)?,
        without: items(Q_WITHOUT)?,
        codes: select(cf, account, Q_CODES)?,
        totals: first(select(cf, account, Q_TOTALS)?),
        tags: if applied(done, "0005") {
            first(select(cf, account, Q_TAGS)?)
        } else {
            json!({})
        },
    };
    let (section, said) = shape(slug, account, &read)?;
    plan["spaces"] = section;
    decisions.extend(said);
    Ok(())
}

fn configured(
    slug: &str,
    account: &Account,
) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    let mut mapped: BTreeMap<String, String> = BTreeMap::new();
    for (project, hosts) in &account.projects {
        let name = project.trim();
        if name.is_empty() {
            return Err(format!(
                "[spaces.{slug}.projects] has a project with no name: give it one"
            ));
        }
        if let Some(other) = seen.insert(name.to_ascii_lowercase(), name.to_owned()) {
            return Err(format!(
                "[spaces.{slug}.projects] names one project twice, as {other} and {name}: keep one"
            ));
        }
        names.push(name.to_owned());
        for host in hosts {
            let host = host.trim().to_ascii_lowercase();
            if host.is_empty() {
                continue;
            }
            if let Some(was) = mapped.insert(host.clone(), name.to_owned())
                && was != name
            {
                return Err(format!(
                    "[spaces.{slug}.projects] puts {host} in both {was} and {name}: a host belongs to one project"
                ));
            }
        }
    }
    Ok((names, mapped))
}

fn key(row: &Value) -> String {
    format!(
        "{}-{}",
        crate::wire::prefix(&text(row, "kind")),
        count(row, "id")
    )
}

pub fn shape(slug: &str, account: &Account, read: &Read) -> Result<(Value, Vec<String>), String> {
    let (names, mapped) = configured(slug, account)?;
    let mut decisions = Vec::new();
    let mut projects = Projects::default();
    for name in &names {
        projects.add(name);
    }

    let mut home: BTreeMap<String, usize> = BTreeMap::new();
    let mut hosts = Vec::new();
    for host in &read.hosts {
        let (at, listed) = match mapped.get(&host.to_ascii_lowercase()) {
            Some(name) => (projects.add(name), true),
            None => (projects.add(host), false),
        };
        if !listed {
            decisions.push(format!(
                "the host {host} isn't in [spaces.{slug}.projects]: 0018 makes it a project of its own, called {}; list it there under another project to put it in that one",
                projects.names[at]
            ));
        }
        home.insert(host.clone(), at);
        hosts.push((host.clone(), at, listed));
    }
    for group in &read.groups {
        if let Some(name) = group["named"].as_str().map(str::trim)
            && !name.is_empty()
        {
            projects.add(name);
        }
    }

    let total = projects.names.len();
    let (mut items, mut open, mut cards) = (vec![0; total], vec![0; total], vec![0; total]);
    let mut strays: BTreeMap<String, (Option<usize>, i64)> = BTreeMap::new();
    for group in &read.groups {
        let named = group["named"]
            .as_str()
            .map(str::trim)
            .filter(|n| !n.is_empty());
        let host = text(group, "host");
        let by_host = || {
            home.get(&host).copied().or_else(|| {
                mapped
                    .get(&host.to_ascii_lowercase())
                    .and_then(|p| projects.find(p))
            })
        };
        let at = match named {
            Some(name) => projects.find(name),
            None => by_host(),
        };
        if !home.contains_key(&host) && named.is_none() {
            let stray = strays.entry(host.clone()).or_insert((at, 0));
            stray.1 += count(group, "items");
        }
        if let Some(at) = at {
            items[at] += count(group, "items");
            open[at] += count(group, "open");
            if named.is_some() {
                cards[at] += count(group, "items");
            }
        }
    }

    let mut without: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in &read.without {
        let host = text(row, "host");
        if !mapped.contains_key(&host.to_ascii_lowercase()) {
            without.entry(host).or_default().push(key(row));
        }
    }
    for (host, keys) in &without {
        decisions.push(format!(
            "{} {} on {host}, which is no host of the space, and {} no project: 0018 leaves {} in no project; list {host} under a project in [spaces.{slug}.projects] to give {} one",
            keys.join(", "),
            if keys.len() == 1 { "is" } else { "are" },
            if keys.len() == 1 { "names" } else { "name" },
            if keys.len() == 1 { "it" } else { "them" },
            if keys.len() == 1 { "it" } else { "them" },
        ));
    }

    let everywhere: BTreeSet<&str> = read.hosts.iter().map(String::as_str).collect();
    let mut codes = Vec::new();
    for row in &read.codes {
        let listed: Vec<String> = serde_json::from_str::<Vec<Value>>(&text(row, "hosts_json"))
            .unwrap_or_default()
            .iter()
            .filter_map(|h| h.as_str().map(str::to_ascii_lowercase))
            .collect();
        let star = listed.iter().any(|h| h == "*");
        let space = star
            || (!everywhere.is_empty()
                && everywhere
                    .iter()
                    .all(|h| listed.iter().any(|l| l.as_str() == *h)));
        let granted: BTreeSet<usize> = if space {
            BTreeSet::new()
        } else {
            listed.iter().filter_map(|h| home.get(h).copied()).collect()
        };
        let reaches: Vec<&str> = hosts
            .iter()
            .filter(|(_, at, _)| space || granted.contains(at))
            .map(|(h, _, _)| h.as_str())
            .collect();
        let gains: Vec<&str> = if star {
            Vec::new()
        } else {
            reaches
                .into_iter()
                .filter(|h| !listed.iter().any(|l| l.as_str() == *h))
                .collect()
        };
        let grant = if space {
            json!({ "space": true })
        } else {
            json!({ "projects": granted.iter().map(|at| projects.names[*at].as_str()).collect::<Vec<_>>() })
        };
        codes.push(json!({
            "id": count(row, "id"),
            "name": text(row, "name"),
            "email": text(row, "email"),
            "owner": count(row, "manager") == 1,
            "revoked": !row["revoked_at"].is_null(),
            "grant": grant,
            "gains": gains,
        }));
    }

    let mut before = json!({});
    let mut after = json!({});
    for key in KEPT {
        before[key] = json!(count(&read.totals, key));
        after[key] = json!(count(&read.totals, key));
    }
    before["cards"] = (0..total)
        .filter(|at| cards[*at] > 0)
        .map(|at| json!({ "project": projects.names[at], "items": cards[at] }))
        .collect();
    after["projects"] = (0..total)
        .map(|at| json!({ "project": projects.names[at], "items": items[at] }))
        .collect();

    let section = json!({
        "space": slug,
        "name": shown(slug, account),
        "projects": (0..total).map(|at| json!({
            "name": projects.names[at],
            "hosts": hosts.iter().filter(|(_, p, _)| *p == at).map(|(h, _, _)| h.as_str()).collect::<Vec<_>>(),
            "items": items[at],
            "open": open[at],
            "cards": cards[at],
        })).collect::<Vec<_>>(),
        "hosts": hosts.iter().map(|(h, at, listed)| json!({
            "host": h,
            "project": projects.names[*at],
            "mapped": listed,
        })).collect::<Vec<_>>(),
        "strays": strays.iter().map(|(h, (at, n))| json!({
            "host": h,
            "project": at.map(|at| projects.names[at].as_str()),
            "items": n,
        })).collect::<Vec<_>>(),
        "without": without.iter().map(|(h, keys)| json!({ "host": h, "items": keys })).collect::<Vec<_>>(),
        "codes": codes,
        "old_tags": { "rows": count(&read.tags, "old_tags"), "items": count(&read.tags, "tagged") },
        "counts": { "before": before, "after": after },
    });
    Ok((section, decisions))
}

fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

pub fn parked(plan: Option<&Value>, park: &[u64]) -> Result<(), String> {
    let section = plan.and_then(|p| p.get("spaces"));
    if !park.is_empty() {
        let Some(section) = section else {
            return Err(
                "--park parks a code only in the deploy that applies 0018; after it, `p99 invites set <id> --park` does it"
                    .into(),
            );
        };
        let known: BTreeSet<i64> = list(&section["codes"])
            .iter()
            .map(|c| count(c, "id"))
            .collect();
        let unknown: Vec<String> = park
            .iter()
            .filter(|id| !i64::try_from(**id).is_ok_and(|id| known.contains(&id)))
            .map(u64::to_string)
            .collect();
        if !unknown.is_empty() {
            return Err(format!(
                "--park {}: no code with that id in this space; `p99 migrate --plan` lists every code with its id",
                unknown.join(", ")
            ));
        }
    }
    match section.and_then(lower) {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

pub fn lower(section: &Value) -> Option<String> {
    let (before, after) = (&section["counts"]["before"], &section["counts"]["after"]);
    let refuse = |what: String, was: i64, now: i64| {
        Some(format!(
            "the count check refuses 0018 before any write: the plan would leave {now} {what} where there are {was}; nothing is written"
        ))
    };
    for key in KEPT {
        let what = if key == "open" { "open items" } else { key };
        if count(after, key) < count(before, key) {
            return refuse(what.to_owned(), count(before, key), count(after, key));
        }
    }
    let projects = list(&after["projects"]);
    for card in list(&before["cards"]) {
        let name = text(&card, "project");
        let now = projects
            .iter()
            .find(|p| text(p, "project") == name)
            .map_or(0, |p| count(p, "items"));
        if now < count(&card, "items") {
            return refuse(format!("items in {name}"), count(&card, "items"), now);
        }
    }
    None
}

pub fn prelude(plan: &Value, park: &[u64]) -> String {
    let section = &plan["spaces"];
    let mut rows: Vec<String> = Vec::new();
    for project in list(&section["projects"]) {
        rows.push(format!(
            "('project', {}, NULL)",
            quoted(&text(&project, "name"))
        ));
    }
    for host in list(&section["hosts"]).iter().chain(
        list(&section["strays"])
            .iter()
            .filter(|s| s["project"].is_string()),
    ) {
        rows.push(format!(
            "('host', {}, {})",
            quoted(&text(host, "host").to_ascii_lowercase()),
            quoted(&text(host, "project"))
        ));
    }
    for code in list(&section["codes"]) {
        let id = count(&code, "id");
        let grant = if park.iter().any(|p| i64::try_from(*p) == Ok(id)) {
            json!({ "projects": [] })
        } else {
            code["grant"].clone()
        };
        rows.push(format!(
            "('grant', {}, {})",
            quoted(&id.to_string()),
            quoted(&grant.to_string())
        ));
    }
    let mut sql = "DROP TABLE IF EXISTS spaces_plan;\nCREATE TABLE spaces_plan (kind TEXT NOT NULL, name TEXT NOT NULL, value TEXT);".to_owned();
    for chunk in rows.chunks(100) {
        sql.push_str(&format!(
            "\nINSERT INTO spaces_plan (kind, name, value) VALUES\n  {};",
            chunk.join(",\n  ")
        ));
    }
    sql
}

pub fn refusal(message: &str, run: &[&str]) -> Option<String> {
    let at = message.find(GUARD)? + GUARD.len();
    let what: String = message[at..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    let left = match what.as_str() {
        "items" => "fewer items than before",
        "open" => "fewer open items than before",
        "comments" => "fewer comments than before",
        "events" => "fewer events than before",
        "attachments" => "fewer attachments than before",
        "codes" => "fewer codes than before",
        "cards" => "a project holding fewer items than it had cards",
        "hosts" => "a host in no project",
        _ => return None,
    };
    Some(format!(
        "the count check stopped 0018: it would have left {left}, so {} rolled back: none of it is written and the Worker is not uploaded; read `p99 migrate --plan` again",
        run.join(" with ")
    ))
}

fn grant_words(grant: &Value) -> String {
    if grant["space"] == true {
        return "the whole space".into();
    }
    let names: Vec<String> = list(&grant["projects"])
        .iter()
        .filter_map(|n| n.as_str().map(str::to_owned))
        .collect();
    match names.len() {
        0 => "nothing".into(),
        1 => format!("the project {}", names[0]),
        _ => format!("the projects {}", names.join(", ")),
    }
}

fn totals_line(side: &Value) -> String {
    format!(
        "{} ({} open), {}, {}, {}, {}",
        many(count(side, "items"), "item", "items"),
        count(side, "open"),
        many(count(side, "comments"), "comment", "comments"),
        many(count(side, "events"), "event", "events"),
        many(count(side, "attachments"), "attachment", "attachments"),
        many(count(side, "codes"), "code", "codes"),
    )
}

fn per(rows: &Value) -> String {
    let said: Vec<String> = list(rows)
        .iter()
        .map(|r| format!("{} {}", text(r, "project"), count(r, "items")))
        .collect();
    if said.is_empty() {
        "none".to_owned()
    } else {
        said.join(", ")
    }
}

pub fn render(out: &mut String, plan: &Value) {
    let Some(section) = plan.get("spaces") else {
        return;
    };
    let slug = text(section, "space");
    out.push_str(&format!(
        "\nSpaces and projects (0018): the space {slug}, shown as {}\n",
        text(section, "name")
    ));
    out.push_str("  projects, with their hosts and what they hold after 0018:\n");
    let projects = list(&section["projects"]);
    if projects.is_empty() {
        out.push_str("    none: the space has no host and no card\n");
    }
    for project in &projects {
        let hosts: Vec<String> = list(&project["hosts"])
            .iter()
            .filter_map(|h| h.as_str().map(str::to_owned))
            .collect();
        let cards = count(project, "cards");
        out.push_str(&format!(
            "    {}: {}; {} ({} open){}\n",
            text(project, "name"),
            if hosts.is_empty() {
                "no host".to_owned()
            } else {
                hosts.join(", ")
            },
            many(count(project, "items"), "item", "items"),
            count(project, "open"),
            if cards > 0 {
                format!(", {} named it", many(cards, "card", "cards"))
            } else {
                String::new()
            }
        ));
    }
    out.push_str("  each host's project:\n");
    let hosts = list(&section["hosts"]);
    if hosts.is_empty() {
        out.push_str("    no host yet\n");
    }
    for host in hosts {
        out.push_str(&format!(
            "    {} -> {}{}\n",
            text(&host, "host"),
            text(&host, "project"),
            if host["mapped"] == true {
                String::new()
            } else {
                format!(", a project of its own: [spaces.{slug}.projects] doesn't list it")
            }
        ));
    }
    let strays = list(&section["strays"]);
    if !strays.is_empty() {
        out.push_str("  items on hosts the space no longer has:\n");
    }
    for stray in strays {
        out.push_str(&format!(
            "    {}: {} -> {}\n",
            text(&stray, "host"),
            many(count(&stray, "items"), "item", "items"),
            stray["project"].as_str().unwrap_or("no project")
        ));
    }
    out.push_str("  each code's grant (a code that reached every host gets the whole space, any other the projects of its hosts):\n");
    let codes = list(&section["codes"]);
    let revoked = codes.iter().filter(|c| c["revoked"] == true).count() as i64;
    if codes.len() as i64 == revoked {
        out.push_str("    no live code\n");
    }
    for code in codes.iter().filter(|c| c["revoked"] != true) {
        let gains: Vec<String> = list(&code["gains"])
            .iter()
            .filter_map(|h| h.as_str().map(str::to_owned))
            .collect();
        out.push_str(&format!(
            "    #{} {}{}: {}{}\n",
            count(code, "id"),
            person(&text(code, "name"), &text(code, "email")),
            if code["owner"] == true { ", Owner" } else { "" },
            grant_words(&code["grant"]),
            if gains.is_empty() {
                String::new()
            } else {
                format!(", so it now also reaches {}", gains.join(", "))
            }
        ));
    }
    if revoked > 0 {
        out.push_str(&format!(
            "    and {}, granted the same way\n",
            many(revoked, "revoked code", "revoked codes")
        ));
    }
    out.push_str("  `p99 deploy --park <id>` gives a code no grant instead: it opens nothing and sees nothing, stays unrevoked, and nobody is mailed\n");
    let tags = &section["old_tags"];
    out.push_str(&format!(
        "  old tags (item_labels, which nothing reads): {} on {}; 0018 drops the table\n",
        many(count(tags, "rows"), "row", "rows"),
        many(count(tags, "items"), "item", "items")
    ));
    out.push_str(
        "  new and empty: the settings a pasted licence key goes in, and each person's avatar\n",
    );

    let counts = &section["counts"];
    out.push_str("\nCount check (0018)\n");
    out.push_str(&format!("  before: {}\n", totals_line(&counts["before"])));
    out.push_str(&format!(
        "  cards by project before: {}\n",
        per(&counts["before"]["cards"])
    ));
    out.push_str(&format!("  after:  {}\n", totals_line(&counts["after"])));
    out.push_str(&format!(
        "  items by project after: {}\n",
        per(&counts["after"]["projects"])
    ));
    out.push_str("  the deploy counts again inside 0018: if any count is lower after it, 0018 rolls back, nothing is written and the Worker is not uploaded\n");
    out.push_str("  a new item, comment, event, attachment or code before the deploy changes this plan's hash: read the plan again then\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(projects: &[(&str, &[&str])]) -> Account {
        Account {
            name: Some("Example Co".into()),
            projects: projects
                .iter()
                .map(|(p, hosts)| {
                    (
                        (*p).to_owned(),
                        hosts.iter().map(|h| (*h).to_owned()).collect(),
                    )
                })
                .collect(),
            ..Account::default()
        }
    }

    fn group(named: Option<&str>, host: &str, items: i64, open: i64) -> Value {
        json!({ "named": named, "host": host, "items": items, "open": open })
    }

    fn code(id: i64, name: &str, hosts: &str, manager: i64, revoked: bool) -> Value {
        json!({
            "id": id,
            "name": name,
            "email": format!("{}@example.com", name.split(' ').next().unwrap().to_ascii_lowercase()),
            "hosts_json": hosts,
            "manager": manager,
            "revoked_at": if revoked { json!("2026-01-01T00:00:00.000Z") } else { Value::Null },
        })
    }

    fn read() -> Read {
        Read {
            hosts: vec![
                "dev.example.com".into(),
                "example.com".into(),
                "shop.example.com".into(),
            ],
            groups: vec![
                group(None, "example.com", 5, 2),
                group(Some("Roadmap"), "example.com", 3, 3),
                group(None, "shop.example.com", 4, 1),
                group(None, "old.example.com", 1, 0),
                group(Some("roadmap"), "shop.example.com", 2, 1),
                group(None, "gone.example.com", 2, 1),
            ],
            without: vec![
                json!({ "id": 9, "kind": "bug", "host": "old.example.com" }),
                json!({ "id": 11, "kind": "feature", "host": "gone.example.com" }),
                json!({ "id": 12, "kind": "task", "host": "gone.example.com" }),
            ],
            codes: vec![
                code(
                    1,
                    "Ada Lovelace",
                    r#"["example.com","dev.example.com","shop.example.com"]"#,
                    1,
                    false,
                ),
                code(2, "Grace Hopper", r#"["example.com"]"#, 0, false),
                code(3, "Old Manager", r#"["*"]"#, 1, true),
                code(4, "Jo", r#"["shop.example.com"]"#, 0, false),
                code(5, "Broken", "not json", 0, false),
            ],
            totals: json!({ "items": 17, "open": 8, "comments": 6, "events": 30, "attachments": 2, "codes": 5 }),
            tags: json!({ "old_tags": 4, "tagged": 3 }),
        }
    }

    fn mapped() -> Account {
        account(&[
            ("Site", &["example.com", "DEV.example.com"]),
            ("Archive", &["gone.example.com"]),
        ])
    }

    #[test]
    fn every_query_only_reads_one_select_and_reads_without_the_project_column_before_0015() {
        for sql in [Q_HOSTS, Q_ITEMS, Q_WITHOUT, Q_CODES, Q_TOTALS, Q_TAGS] {
            assert!(sql.starts_with("SELECT "), "{sql}");
            assert!(!sql.contains(';'), "{sql}");
            for word in ["UPDATE ", "INSERT ", "DELETE ", "DROP ", "CREATE "] {
                assert!(!sql.contains(word), "{sql}");
            }
        }
        for sql in [Q_ITEMS, Q_WITHOUT] {
            let before = uncarded(sql);
            assert!(!before.contains("project"), "{before}");
            assert!(before.starts_with("SELECT ") && !before.contains(';'));
        }
        assert!(!uncarded(Q_ITEMS).contains("trim(project)"));
        assert_eq!(
            select(
                &Cloudflare::at("t", "http://127.0.0.1:9"),
                &Account::default(),
                "DELETE FROM items"
            ),
            Err("the plan only reads, one SELECT at a time".into())
        );
    }

    #[test]
    fn the_config_maps_hosts_to_projects_and_an_unmapped_host_is_a_decision_with_its_own_project() {
        let (section, decisions) = shape("main", &mapped(), &read()).unwrap();
        let hosts: Vec<(&str, &str, bool)> = section["hosts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| {
                (
                    h["host"].as_str().unwrap(),
                    h["project"].as_str().unwrap(),
                    h["mapped"].as_bool().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            hosts,
            [
                ("dev.example.com", "Site", true),
                ("example.com", "Site", true),
                ("shop.example.com", "shop.example.com", false),
            ]
        );
        assert_eq!(
            decisions[0],
            "the host shop.example.com isn't in [spaces.main.projects]: 0018 makes it a project of its own, called shop.example.com; list it there under another project to put it in that one"
        );
        let names: Vec<&str> = section["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["Archive", "Site", "shop.example.com", "Roadmap"]);
        assert_eq!(section["space"], "main");
        assert_eq!(section["name"], "Example Co");
    }

    #[test]
    fn every_item_lands_in_its_named_project_or_its_hosts_and_no_count_is_lost() {
        let (section, decisions) = shape("main", &mapped(), &read()).unwrap();
        let held: Vec<(&str, i64, i64, i64)> = section["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["name"].as_str().unwrap(),
                    p["items"].as_i64().unwrap(),
                    p["open"].as_i64().unwrap(),
                    p["cards"].as_i64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            held,
            [
                ("Archive", 2, 1, 0),
                ("Site", 5, 2, 0),
                ("shop.example.com", 4, 1, 0),
                ("Roadmap", 5, 4, 5),
            ]
        );
        let counts = &section["counts"];
        for key in KEPT {
            assert_eq!(counts["before"][key], counts["after"][key], "{key}");
        }
        assert_eq!(
            counts["before"]["cards"],
            json!([{ "project": "Roadmap", "items": 5 }])
        );
        assert_eq!(lower(&section), None);
        assert_eq!(
            section["strays"],
            json!([
                { "host": "gone.example.com", "project": "Archive", "items": 2 },
                { "host": "old.example.com", "project": null, "items": 1 },
            ])
        );
        assert_eq!(
            section["without"],
            json!([{ "host": "old.example.com", "items": ["BUG-9"] }])
        );
        assert_eq!(
            decisions.last().unwrap(),
            "BUG-9 is on old.example.com, which is no host of the space, and names no project: 0018 leaves it in no project; list old.example.com under a project in [spaces.main.projects] to give it one"
        );
        assert_eq!(decisions.len(), 2, "{decisions:?}");
    }

    #[test]
    fn several_items_with_no_project_are_named_together_per_host() {
        let (_, decisions) = shape("main", &account(&[]), &read()).unwrap();
        assert!(decisions.contains(&"FEAT-11, TASK-12 are on gone.example.com, which is no host of the space, and name no project: 0018 leaves them in no project; list gone.example.com under a project in [spaces.main.projects] to give them one".to_owned()), "{decisions:?}");
        assert_eq!(decisions.len(), 5, "{decisions:?}");
    }

    #[test]
    fn a_code_that_reached_every_host_gets_the_space_and_any_other_the_projects_of_its_hosts() {
        let (section, _) = shape("main", &mapped(), &read()).unwrap();
        let grants: Vec<(i64, Value, Value)> = section["codes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["id"].as_i64().unwrap(),
                    c["grant"].clone(),
                    c["gains"].clone(),
                )
            })
            .collect();
        assert_eq!(
            grants,
            [
                (1, json!({ "space": true }), json!([])),
                (
                    2,
                    json!({ "projects": ["Site"] }),
                    json!(["dev.example.com"])
                ),
                (3, json!({ "space": true }), json!([])),
                (4, json!({ "projects": ["shop.example.com"] }), json!([])),
                (5, json!({ "projects": [] }), json!([])),
            ]
        );
        assert_eq!(section["codes"][2]["revoked"], true);
        assert_eq!(section["codes"][0]["owner"], true);
        let bare = Read {
            hosts: Vec::new(),
            ..read()
        };
        let (empty, _) = shape("main", &mapped(), &bare).unwrap();
        assert_eq!(empty["codes"][0]["grant"], json!({ "projects": [] }));
        assert_eq!(empty["codes"][2]["grant"], json!({ "space": true }));
    }

    #[test]
    fn a_config_that_puts_a_host_in_two_projects_or_names_one_twice_is_refused() {
        let twice = account(&[("Site", &["example.com"]), ("Shop", &["Example.com "])]);
        assert_eq!(
            shape("main", &twice, &read()).unwrap_err(),
            "[spaces.main.projects] puts example.com in both Shop and Site: a host belongs to one project"
        );
        let named = account(&[("Site", &[]), ("site", &[])]);
        assert_eq!(
            shape("main", &named, &read()).unwrap_err(),
            "[spaces.main.projects] names one project twice, as Site and site: keep one"
        );
        let blank = account(&[(" ", &[])]);
        assert!(
            shape("main", &blank, &read())
                .unwrap_err()
                .contains("a project with no name")
        );
        let again = account(&[("Site", &["example.com", "example.com", ""])]);
        assert!(shape("main", &again, &read()).is_ok());
    }

    #[test]
    fn a_plan_that_would_lose_a_count_is_refused_before_any_write() {
        let (section, _) = shape("main", &mapped(), &read()).unwrap();
        let mut fewer = section.clone();
        fewer["counts"]["after"]["comments"] = json!(5);
        assert_eq!(
            lower(&fewer).unwrap(),
            "the count check refuses 0018 before any write: the plan would leave 5 comments where there are 6; nothing is written"
        );
        let mut open = section.clone();
        open["counts"]["after"]["open"] = json!(7);
        assert!(
            lower(&open)
                .unwrap()
                .contains("7 open items where there are 8")
        );
        let mut cards = section.clone();
        cards["counts"]["after"]["projects"] = json!([{ "project": "Roadmap", "items": 4 }]);
        assert!(
            lower(&cards)
                .unwrap()
                .contains("leave 4 items in Roadmap where there are 5")
        );
        cards["counts"]["after"]["projects"] = json!([]);
        assert!(lower(&cards).unwrap().contains("leave 0 items in Roadmap"));
        let plan = json!({ "spaces": fewer });
        assert!(parked(Some(&plan), &[]).is_err());
        assert!(parked(Some(&json!({ "spaces": section })), &[2]).is_ok());
    }

    #[test]
    fn park_takes_only_codes_the_plan_lists_and_only_while_0018_is_pending() {
        let (section, _) = shape("main", &mapped(), &read()).unwrap();
        let plan = json!({ "spaces": section });
        assert_eq!(parked(Some(&plan), &[2, 4]), Ok(()));
        assert_eq!(
            parked(Some(&plan), &[2, 9, 77]).unwrap_err(),
            "--park 9, 77: no code with that id in this space; `p99 migrate --plan` lists every code with its id"
        );
        assert!(
            parked(None, &[2])
                .unwrap_err()
                .starts_with("--park parks a code only in the deploy that applies 0018")
        );
        assert!(
            parked(Some(&json!({ "pending": [] })), &[2])
                .unwrap_err()
                .contains("p99 invites set <id> --park")
        );
        assert_eq!(parked(None, &[]), Ok(()));
        assert_eq!(parked(Some(&json!({})), &[]), Ok(()));
    }

    #[test]
    fn the_prelude_stages_every_project_host_and_grant_and_a_parked_code_grants_nothing() {
        let (section, _) = shape("main", &mapped(), &read()).unwrap();
        let plan = json!({ "spaces": section });
        let sql = prelude(&plan, &[2]);
        assert!(sql.starts_with("DROP TABLE IF EXISTS spaces_plan;\nCREATE TABLE spaces_plan ("));
        for want in [
            "('project', 'Archive', NULL)",
            "('project', 'Roadmap', NULL)",
            "('host', 'dev.example.com', 'Site')",
            "('host', 'shop.example.com', 'shop.example.com')",
            "('host', 'gone.example.com', 'Archive')",
            "('grant', '1', '{\"space\":true}')",
            "('grant', '2', '{\"projects\":[]}')",
            "('grant', '4', '{\"projects\":[\"shop.example.com\"]}')",
        ] {
            assert!(sql.contains(want), "{want}\n{sql}");
        }
        assert!(!sql.contains("old.example.com"), "{sql}");
        assert!(!sql.contains("mail"), "{sql}");
        let unparked = prelude(&plan, &[]);
        assert!(unparked.contains("('grant', '2', '{\"projects\":[\"Site\"]}')"));
        let quote = json!({ "spaces": { "projects": [{ "name": "Ada's site" }] } });
        assert!(prelude(&quote, &[]).contains("('project', 'Ada''s site', NULL)"));
        let many: Vec<Value> = (0..250)
            .map(|n| json!({ "name": format!("p{n}") }))
            .collect();
        let big = prelude(&json!({ "spaces": { "projects": many } }), &[]);
        assert_eq!(big.matches("INSERT INTO spaces_plan").count(), 3);
        assert_eq!(
            prelude(&json!({ "spaces": {} }), &[]),
            "DROP TABLE IF EXISTS spaces_plan;\nCREATE TABLE spaces_plan (kind TEXT NOT NULL, name TEXT NOT NULL, value TEXT);"
        );
    }

    #[test]
    fn a_count_check_that_stops_0018_names_what_would_drop_and_that_nothing_is_written() {
        assert_eq!(
            refusal(
                "D1: \"CHECK constraint failed: spaces_kept_comments: SQLITE_CONSTRAINT\"",
                &["0018_spaces.sql"]
            )
            .unwrap(),
            "the count check stopped 0018: it would have left fewer comments than before, so 0018_spaces.sql rolled back: none of it is written and the Worker is not uploaded; read `p99 migrate --plan` again"
        );
        assert!(
            refusal(
                "CHECK constraint failed: spaces_kept_hosts",
                &["0017_delete_archived.sql", "0018_spaces.sql"]
            )
            .unwrap()
            .contains("left a host in no project, so 0017_delete_archived.sql with 0018_spaces.sql rolled back")
        );
        for (what, said) in [
            ("items", "fewer items than"),
            ("open", "fewer open items"),
            ("events", "fewer events"),
            ("attachments", "fewer attachments"),
            ("codes", "fewer codes"),
            ("cards", "a project holding fewer items than it had cards"),
        ] {
            let message = format!("CHECK constraint failed: spaces_kept_{what}");
            assert!(
                refusal(&message, &["0018_spaces.sql"])
                    .unwrap()
                    .contains(said),
                "{what}"
            );
        }
        assert_eq!(
            refusal("CHECK constraint failed: spaces_kept_nothing", &[]),
            None
        );
        assert_eq!(
            refusal("CHECK constraint failed: count_check_items", &[]),
            None
        );
        assert_eq!(refusal("network is unreachable", &[]), None);
    }

    #[test]
    fn the_render_shows_projects_hosts_grants_old_tags_and_the_counts() {
        let (section, _) = shape("main", &mapped(), &read()).unwrap();
        let mut out = String::new();
        render(&mut out, &json!({ "spaces": section }));
        for want in [
            "\nSpaces and projects (0018): the space main, shown as Example Co\n",
            "    Site: dev.example.com, example.com; 5 items (2 open)\n",
            "    Roadmap: no host; 5 items (4 open), 5 cards named it\n",
            "    Archive: no host; 2 items (1 open)\n",
            "    shop.example.com -> shop.example.com, a project of its own: [spaces.main.projects] doesn't list it\n",
            "    example.com -> Site\n",
            "  items on hosts the space no longer has:\n    gone.example.com: 2 items -> Archive\n    old.example.com: 1 item -> no project\n",
            "    #1 Ada Lovelace <ada@example.com>, Owner: the whole space\n",
            "    #2 Grace Hopper <grace@example.com>: the project Site, so it now also reaches dev.example.com\n",
            "    #4 Jo <jo@example.com>: the project shop.example.com\n",
            "    #5 Broken <broken@example.com>: nothing\n",
            "    and 1 revoked code, granted the same way\n",
            "`p99 deploy --park <id>` gives a code no grant instead",
            "  old tags (item_labels, which nothing reads): 4 rows on 3 items; 0018 drops the table\n",
            "\nCount check (0018)\n  before: 17 items (8 open), 6 comments, 30 events, 2 attachments, 5 codes\n  cards by project before: Roadmap 5\n  after:  17 items (8 open), 6 comments, 30 events, 2 attachments, 5 codes\n  items by project after: Archive 2, Site 5, shop.example.com 4, Roadmap 5\n",
        ] {
            assert!(out.contains(want), "{want}\n{out}");
        }
        assert!(!out.contains("Old Manager"), "{out}");
        let mut empty = String::new();
        let bare = Read {
            hosts: Vec::new(),
            groups: Vec::new(),
            without: Vec::new(),
            codes: Vec::new(),
            totals: json!({}),
            tags: json!({}),
        };
        let (none, decisions) = shape("fresh", &Account::default(), &bare).unwrap();
        assert!(decisions.is_empty());
        assert_eq!(none["name"], "fresh");
        render(&mut empty, &json!({ "spaces": none }));
        for want in [
            "    none: the space has no host and no card\n",
            "    no host yet\n",
            "    no live code\n",
            "  cards by project before: none\n",
            "  old tags (item_labels, which nothing reads): 0 rows on 0 items",
        ] {
            assert!(empty.contains(want), "{want}\n{empty}");
        }
        assert!(!empty.contains("no longer has"), "{empty}");
        let mut nothing = String::new();
        render(&mut nothing, &json!({ "pending": [] }));
        assert!(nothing.is_empty());
    }

    #[test]
    fn small_words_read_the_same_everywhere() {
        assert_eq!(grant_words(&json!({ "space": true })), "the whole space");
        assert_eq!(grant_words(&json!({ "projects": [] })), "nothing");
        assert_eq!(
            grant_words(&json!({ "projects": ["A", "B"] })),
            "the projects A, B"
        );
        assert_eq!(person("", "ada@example.com"), "ada@example.com");
        assert_eq!(shown("main", &Account::default()), "main");
        assert_eq!(shown("main", &account(&[])), "Example Co");
        let blank = Account {
            name: Some("  ".into()),
            ..Account::default()
        };
        assert_eq!(shown("main", &blank), "main");
        assert_eq!(quoted("it's"), "'it''s'");
        assert!(applied(&["0015_cards.sql".into()], "0015"));
        assert!(!applied(&["00150_x.sql".into()], "0015"));
        assert_eq!(key(&json!({ "id": 3, "kind": "question" })), "Q-3");
    }
}

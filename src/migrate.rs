use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::bundle::{self, GATED};
use crate::cli::Global;
use crate::cloudflare::Cloudflare;
use crate::config::{Account, Config};

#[derive(Debug, clap::Args)]
pub struct MigrateArgs {
    #[arg(
        long,
        required = true,
        help = "print, read-only, what this version's data-changing migrations would do on the account, ending with the hash `p99 deploy --accept-plan` takes"
    )]
    pub plan: bool,
}

const BOARDS_PER_PERSON: usize = 3;

const KINDS: [(&str, &str); 5] = [
    ("bug", "BUG"),
    ("feature", "FEAT"),
    ("improvement", "IMP"),
    ("question", "Q"),
    ("task", "TASK"),
];

const LEGACY: [(&str, &str, &str); 7] = [
    ("new", "Inbox", "received"),
    ("confirmed", "Doing", "in_progress"),
    ("in_progress", "Doing", "in_progress"),
    ("waiting", "Review", "in_progress"),
    ("resolved", "Done", "fixed"),
    ("abandoned", "Done", "dropped"),
    ("duplicate", "Done", "duplicate"),
];

const Q_STATUSES: &str =
    "SELECT status, count(*) AS items, COALESCE(sum(open), 0) AS open FROM items GROUP BY status";

const Q_HOMES: &str = "SELECT h.host, (SELECT count(*) FROM items i WHERE i.host = h.host) AS items FROM (SELECT host FROM hosts UNION SELECT host FROM items) h ORDER BY h.host";

const Q_LABELS: &str = "SELECT s.key AS status, s.name AS label, count(i.id) AS items, COALESCE(sum(i.open), 0) AS open FROM statuses s LEFT JOIN items i ON i.status = s.key GROUP BY s.key ORDER BY s.position, s.key";

const Q_MANAGERS: &str = "SELECT lower(trim(email)) AS email, name, hosts_json FROM codes WHERE manager = 1 AND revoked_at IS NULL ORDER BY id";

const Q_BOARDS: &str = "SELECT b.slug, b.name, b.host, p.slug AS parent, (SELECT count(*) FROM items i WHERE i.board_id = b.id) AS items FROM boards b LEFT JOIN boards p ON p.id = b.parent_id ORDER BY b.id";

const Q_ORDER: &str = "SELECT b.slug AS board, COALESCE(s.name, x.status) AS label, count(*) AS cards, sum(x.now_at <> x.next_at) AS moves FROM (SELECT board_id, status, row_number() OVER (PARTITION BY board_id, status ORDER BY position, id) AS now_at, row_number() OVER (PARTITION BY board_id, status ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, position, id) AS next_at FROM items) x JOIN boards b ON b.id = x.board_id LEFT JOIN statuses s ON s.key = x.status GROUP BY x.board_id, x.status HAVING moves > 0 ORDER BY b.id, s.position";

const EXTRA_TAGS: &str = "FROM item_labels il JOIN labels l ON l.id = il.label_id JOIN items i ON i.id = il.item_id LEFT JOIN statuses s ON s.key = i.status WHERE s.name IS NULL OR lower(trim(s.name)) <> lower(trim(l.name))";

const Q_OLD_TAGS: &str = "SELECT count(DISTINCT il.item_id) AS items, count(DISTINCT il.label_id) AS tags FROM item_labels il JOIN items i ON i.id = il.item_id WHERE il.label_id <> i.label_id";

const Q_MEMBERS: &str = "SELECT lower(trim(e.actor_email)) AS email, (SELECT n.name FROM codes n WHERE lower(trim(n.email)) = lower(trim(e.actor_email)) ORDER BY n.id DESC LIMIT 1) AS name, count(*) AS changes FROM events e WHERE e.kind = 'status' AND e.actor_email IS NOT NULL AND EXISTS (SELECT 1 FROM codes r WHERE lower(trim(r.email)) = lower(trim(e.actor_email))) AND NOT EXISTS (SELECT 1 FROM codes m WHERE lower(trim(m.email)) = lower(trim(e.actor_email)) AND m.manager = 1 AND m.revoked_at IS NULL) AND NOT (json_extract(e.detail_json, '$.to') = 'abandoned' OR (json_extract(e.detail_json, '$.to') = 'done' AND json_extract(e.detail_json, '$.resolution') = 'abandoned')) AND NOT (json_extract(e.detail_json, '$.from') IN ('done', 'resolved', 'abandoned', 'duplicate') AND json_extract(e.detail_json, '$.to') IN ('inbox', 'new')) AND NOT (json_extract(e.detail_json, '$.from') = 'waiting' AND json_extract(e.detail_json, '$.to') = 'confirmed' AND EXISTS (SELECT 1 FROM items i WHERE i.id = e.item_id AND lower(trim(i.reporter_email)) = lower(trim(e.actor_email)))) GROUP BY lower(trim(e.actor_email)) ORDER BY 1";

const Q_COLLIDE: &str = "SELECT s.name AS label, l.name AS tag FROM statuses s JOIN labels l ON lower(trim(l.name)) = lower(trim(s.name)) ORDER BY s.position, l.id";

const Q_TWINS: &str = "SELECT a.name AS label, b.name AS other FROM statuses a JOIN statuses b ON a.key < b.key AND lower(trim(a.name)) = lower(trim(b.name)) ORDER BY a.position, b.position";

const Q_PEOPLE: &str = "SELECT lower(trim(c.email)) AS email, (SELECT n.name FROM codes n WHERE lower(trim(n.email)) = lower(trim(c.email)) ORDER BY n.id DESC LIMIT 1) AS name, min(c.id) AS first FROM codes c GROUP BY lower(trim(c.email)) UNION ALL SELECT lower(trim(assignee)), '', 1000000000 + min(id) FROM items WHERE assignee IS NOT NULL AND lower(trim(assignee)) NOT IN (SELECT lower(trim(email)) FROM codes) GROUP BY lower(trim(assignee)) ORDER BY 3";

const Q_USERNAMES: &str = "SELECT email, username FROM people";

const Q_AGENTS: &str = "SELECT lower(trim(email)) AS email, max(name) AS name, sum(n) AS actions FROM (SELECT reporter_email AS email, reporter_name AS name, count(*) AS n FROM items WHERE reporter_agent = 1 GROUP BY reporter_email UNION ALL SELECT author_email, author_name, count(*) FROM comments WHERE author_agent = 1 GROUP BY author_email UNION ALL SELECT actor_email, NULL, count(*) FROM events WHERE actor_agent = 1 AND actor_email IS NOT NULL GROUP BY actor_email) GROUP BY lower(trim(email)) ORDER BY 1";

const Q_KINDS: &str =
    "SELECT kind, count(*) AS items, sum(open) AS open FROM items GROUP BY kind ORDER BY kind";

const Q_HOSTS: &str = "SELECT host, env, CASE WHEN json_valid(config_json) THEN json_extract(config_json, '$.above') END AS above, CASE WHEN json_valid(config_json) THEN json_extract(config_json, '$.off') END AS off FROM hosts ORDER BY host";

pub fn run(_args: &MigrateArgs, global: &Global) -> Result<(), String> {
    let config = Config::load()?;
    let (name, account) = config.account(global.account.as_deref())?;
    let cf = Cloudflare::new(&crate::config::token(account)?);
    let applied = crate::setup::applied(&cf, &account.account_id, &account.database_id)?;
    let plan = plan(&cf, account, &applied)?;
    let hash = hash(&plan);
    if global.json {
        let text = serde_json::to_string_pretty(&json!({
            "account": name,
            "hash": hash,
            "plan": plan,
        }))
        .map_err(|e| e.to_string())?;
        println!("{text}");
    } else {
        print!("{}", render(name, &plan, &hash));
    }
    Ok(())
}

pub fn gated_pending(applied: &[String]) -> Vec<String> {
    GATED
        .iter()
        .filter(|prefix| !applied.iter().any(|a| numbered(a, prefix)))
        .map(|prefix| {
            bundle::MIGRATIONS
                .iter()
                .find(|(name, _)| numbered(name, prefix))
                .map_or_else(|| (*prefix).to_owned(), |(name, _)| (*name).to_owned())
        })
        .collect()
}

fn numbered(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('_'))
}

pub fn gate(
    cf: &Cloudflare,
    account: &Account,
    applied: &[String],
    accept: Option<&str>,
) -> Result<Option<(String, Value)>, String> {
    let pending = gated_pending(applied);
    if applied.is_empty() || pending.is_empty() {
        return Ok(None);
    }
    let Some(given) = accept.map(|h| h.trim().to_ascii_lowercase()) else {
        return Err(format!(
            "{} change this account's data: read `p99 migrate --plan`, answer its decisions, then run again with --accept-plan <hash>",
            pending.join(", ")
        ));
    };
    if given.len() != 64 || !given.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(
            "--accept-plan takes the 64-character hash `p99 migrate --plan` ends with".into(),
        );
    }
    let read = plan(cf, account, applied)?;
    let now = hash(&read);
    if given != now {
        return Err(
            "the plan changed since that hash was taken (the database moved on): read `p99 migrate --plan` again and run with its new hash"
                .into(),
        );
    }
    Ok(Some((now, read)))
}

pub fn hash(plan: &Value) -> String {
    let mut text = String::new();
    canonical(plan, &mut text);
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            out.push('{');
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                canonical(&map[key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn select(cf: &Cloudflare, account: &Account, sql: &str) -> Result<Vec<Value>, String> {
    reads(sql)?;
    Ok(cf.query(&account.account_id, &account.database_id, sql, &[])?)
}

fn reads(sql: &str) -> Result<(), String> {
    if !sql.starts_with("SELECT ") || sql.contains(';') {
        return Err("the plan only reads, one SELECT at a time".into());
    }
    Ok(())
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

fn many(n: i64, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

fn person(name: &str, email: &str) -> String {
    if name.trim().is_empty() {
        email.to_owned()
    } else {
        format!("{} <{email}>", name.trim())
    }
}

pub fn plan(cf: &Cloudflare, account: &Account, applied: &[String]) -> Result<Value, String> {
    let pending = gated_pending(applied);
    let mut plan = json!({
        "account_id": account.account_id,
        "database_id": account.database_id,
        "pending": pending,
    });
    old_tags(cf, account, applied, &mut plan)?;
    if applied.is_empty() || pending.is_empty() {
        plan["decisions"] = json!([]);
        return Ok(plan);
    }
    let legacy = pending.iter().any(|p| p.starts_with("0004"));
    let labelled = applied.iter().any(|a| numbered(a, "0005"));
    let carded = applied.iter().any(|a| numbered(a, "0015"));
    let lanes = pending.iter().any(|p| p.starts_with("0011"));
    let people = pending.iter().any(|p| p.starts_with("0012"));
    let mut decisions: Vec<String> = Vec::new();

    if legacy {
        legacy_plan(cf, account, &mut plan, &mut decisions)?;
    } else if lanes {
        lanes_plan(cf, account, labelled, &mut plan, &mut decisions)?;
    }
    if pending.iter().any(|p| p.starts_with("0016")) {
        crate::fold::plan(cf, account, carded, &mut plan, &mut decisions)?;
    }
    if pending.iter().any(|p| p.starts_with("0017")) {
        crate::prune::plan(cf, account, &mut plan, &mut decisions)?;
    }
    crate::counts::plan(cf, account, carded, &mut plan)?;

    let mut usernames: BTreeMap<String, String> = BTreeMap::new();
    if people {
        let rows = select(cf, account, Q_PEOPLE)?;
        let sources: Vec<(String, String)> = rows
            .iter()
            .map(|r| (text(r, "email"), text(r, "name")))
            .collect();
        let derived = default_usernames(&sources);
        let mut notable = Vec::new();
        for (email, name, username, why) in &derived {
            usernames.insert(email.clone(), username.clone());
            if *why != "name" {
                notable.push(json!({
                    "email": email,
                    "name": name,
                    "username": username,
                    "why": why,
                }));
            }
        }
        plan["people"] = json!({ "rows": derived.len(), "usernames": notable, "digest": hash(&json!(usernames)) });
    } else if applied.iter().any(|a| numbered(a, "0012")) {
        for row in select(cf, account, Q_USERNAMES)? {
            usernames.insert(text(&row, "email"), text(&row, "username"));
        }
    }

    let mut agents = Vec::new();
    for row in select(cf, account, Q_AGENTS)? {
        let email = text(&row, "email");
        let shown = usernames.get(&email).map(|u| agent_shown(u));
        if shown.is_none() {
            decisions.push(format!(
                "{} acts through agents but has no code and no assigned items, so 0012 gives them no username: mint them a code, or accept that their agent actions show without one",
                person(&text(&row, "name"), &email)
            ));
        }
        agents.push(json!({
            "email": email,
            "name": text(&row, "name"),
            "actions": count(&row, "actions"),
            "shown": shown,
        }));
    }
    plan["agents"] = Value::Array(agents);

    let mut kinds = Vec::new();
    for row in select(cf, account, Q_KINDS)? {
        let kind = text(&row, "kind");
        let prefix = KINDS.iter().find(|(k, _)| *k == kind).map(|(_, p)| *p);
        if prefix.is_none() {
            decisions.push(format!(
                "{} items have the kind {kind}, which is not one of the five: change their kind first",
                count(&row, "items")
            ));
        }
        kinds.push(json!({
            "kind": kind,
            "prefix": prefix,
            "items": count(&row, "items"),
            "open": count(&row, "open"),
        }));
    }
    plan["kinds"] = Value::Array(kinds);

    let mut hosts = Vec::new();
    for row in select(cf, account, Q_HOSTS)? {
        let off: Vec<Value> = row["off"]
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        hosts.push(json!({
            "host": text(&row, "host"),
            "env": text(&row, "env"),
            "above": row["above"].as_str(),
            "off": off,
        }));
    }
    plan["hosts"] = Value::Array(hosts);
    plan["url"] = json!(account.url);
    plan["decisions"] = json!(decisions);
    Ok(plan)
}

fn old_tags(
    cf: &Cloudflare,
    account: &Account,
    applied: &[String],
    plan: &mut Value,
) -> Result<(), String> {
    if !applied.iter().any(|a| numbered(a, "0011"))
        || applied.iter().any(|a| numbered(a, "0017"))
        || crate::prune::earlier(plan).is_empty()
    {
        return Ok(());
    }
    let row = select(cf, account, Q_OLD_TAGS)?
        .into_iter()
        .next()
        .unwrap_or_default();
    plan["old_tags"] = json!({ "items": count(&row, "items"), "tags": count(&row, "tags") });
    Ok(())
}

type Owner = Option<(String, String)>;

fn owner(
    cf: &Cloudflare,
    account: &Account,
    plan: &mut Value,
) -> Result<(Owner, BTreeSet<String>), String> {
    let managers = select(cf, account, Q_MANAGERS)?;
    let owner = managers
        .first()
        .map(|r| (text(r, "email"), text(r, "name")));
    let mut reach: BTreeSet<String> = BTreeSet::new();
    if let Some((email, _)) = &owner {
        for row in managers.iter().filter(|r| text(r, "email") == *email) {
            let hosts: Vec<String> =
                serde_json::from_str(&text(row, "hosts_json")).unwrap_or_default();
            reach.extend(hosts);
        }
    }
    plan["owner"] = match &owner {
        Some((email, name)) => json!({ "email": email, "name": name }),
        None => Value::Null,
    };
    Ok((owner, reach))
}

fn owner_decisions(
    owner: &Owner,
    reach: &BTreeSet<String>,
    hosts: &[Option<String>],
    why: &str,
    decisions: &mut Vec<String>,
) {
    let unreached: BTreeSet<&str> = hosts
        .iter()
        .flatten()
        .filter(|host| !reach.contains("*") && !reach.contains(host.as_str()))
        .map(String::as_str)
        .collect();
    let mut spaces: BTreeMap<Option<&str>, usize> = BTreeMap::new();
    for host in hosts {
        *spaces.entry(host.as_deref()).or_default() += 1;
    }
    match owner {
        None if !hosts.is_empty() => decisions.push(
            "no live Owner code exists to own the boards: mint an Owner code before deploying"
                .into(),
        ),
        Some((email, name)) => {
            for (space, n) in spaces.iter().filter(|(_, n)| **n > BOARDS_PER_PERSON) {
                decisions.push(format!(
                    "{} would own all {n} boards of {} ({why}), over the {BOARDS_PER_PERSON} a person may have in one space: say who owns which, or which boards to remove first",
                    person(name, email),
                    space.unwrap_or("every host")
                ));
            }
        }
        _ => {}
    }
    if let Some((email, name)) = owner
        && !unreached.is_empty()
    {
        decisions.push(format!(
            "{} would own boards of {}, which their code doesn't cover: widen their code or name another owner",
            person(name, email),
            unreached.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
}

fn members(
    cf: &Cloudflare,
    account: &Account,
    decisions: &mut Vec<String>,
) -> Result<Value, String> {
    let members: Vec<Value> = select(cf, account, Q_MEMBERS)?
        .iter()
        .map(|r| {
            json!({
                "email": text(r, "email"),
                "name": text(r, "name"),
                "changes": count(r, "changes"),
            })
        })
        .collect();
    if !members.is_empty() {
        decisions.push(format!(
            "{} changed states that only Owners set from 1.9 on: give them Owner codes, or leave them Users",
            many(members.len() as i64, "member")
        ));
    }
    Ok(Value::Array(members))
}

fn legacy_plan(
    cf: &Cloudflare,
    account: &Account,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let rows = select(cf, account, Q_STATUSES)?;
    let statuses: Vec<Value> = LEGACY
        .iter()
        .map(|(status, label, stage)| {
            let row = rows.iter().find(|r| text(r, "status") == *status);
            json!({
                "status": status,
                "label": label,
                "stage": stage,
                "items": row.map_or(0, |r| count(r, "items")),
                "open": row.map_or(0, |r| count(r, "open")),
            })
        })
        .collect();
    plan["statuses"] = Value::Array(statuses);

    let (owner, reach) = owner(cf, account, plan)?;
    let homes = select(cf, account, Q_HOMES)?;
    let hosts: Vec<Option<String>> = homes.iter().map(|r| Some(text(r, "host"))).collect();
    owner_decisions(&owner, &reach, &hosts, "one home board per host", decisions);
    plan["boards"] = Value::Array(
        homes
            .iter()
            .map(|r| json!({ "name": text(r, "host"), "host": text(r, "host"), "items": count(r, "items") }))
            .collect(),
    );
    plan["members"] = members(cf, account, decisions)?;
    Ok(())
}

fn lanes_plan(
    cf: &Cloudflare,
    account: &Account,
    labelled: bool,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let labels: Vec<Value> = select(cf, account, Q_LABELS)?
        .iter()
        .map(|r| {
            json!({
                "status": text(r, "status"),
                "label": text(r, "label"),
                "items": count(r, "items"),
                "open": count(r, "open"),
            })
        })
        .collect();
    plan["labels"] = Value::Array(labels);

    let (owner, reach) = owner(cf, account, plan)?;
    let mut boards = Vec::new();
    let mut hosts = Vec::new();
    let mut nested = 0;
    for row in select(cf, account, Q_BOARDS)? {
        let host = row["host"].as_str().map(str::to_owned);
        if row["parent"].is_string() {
            nested += 1;
        }
        hosts.push(host.clone());
        boards.push(json!({
            "slug": text(&row, "slug"),
            "name": text(&row, "name"),
            "host": host,
            "parent": row["parent"].as_str(),
            "items": count(&row, "items"),
        }));
    }
    owner_decisions(
        &owner,
        &reach,
        &hosts,
        "1.8 kept no board creator",
        decisions,
    );
    plan["boards"] = Value::Array(boards);
    plan["nested"] = json!(nested);

    let labelled_rows = |sql: &str| -> Result<Vec<Value>, String> {
        if labelled {
            select(cf, account, sql)
        } else {
            Ok(Vec::new())
        }
    };
    let order: Vec<Value> = labelled_rows(Q_ORDER)?
        .iter()
        .map(|r| {
            json!({
                "board": text(r, "board"),
                "label": text(r, "label"),
                "cards": count(r, "cards"),
                "moves": count(r, "moves"),
            })
        })
        .collect();
    plan["order"] = Value::Array(order);

    let tags: Vec<Value> = labelled_rows(&format!(
        "SELECT l.name AS tag, count(*) AS items {EXTRA_TAGS} GROUP BY l.id ORDER BY lower(l.name), l.id"
    ))?
    .iter()
    .map(|r| json!({ "tag": text(r, "tag"), "items": count(r, "items") }))
    .collect();
    let tagged = labelled_rows(&format!(
        "SELECT count(DISTINCT il.item_id) AS items {EXTRA_TAGS}"
    ))?
    .first()
    .map_or(0, |r| count(r, "items"));
    if tagged > 0 {
        decisions.push(format!(
            "{} carry {} beyond their label; 0011 keeps them untouched and unused: say later whether a migration drops them",
            many(tagged, "item"),
            many(tags.len() as i64, "tag")
        ));
    }
    plan["tags"] = Value::Array(tags);
    plan["tagged"] = json!(tagged);

    plan["members"] = members(cf, account, decisions)?;

    let mut collisions = Vec::new();
    for row in labelled_rows(Q_COLLIDE)? {
        let (label, tag) = (text(&row, "label"), text(&row, "tag"));
        decisions.push(format!(
            "the column {label} and the tag {tag} would share one label name: rename one before deploying"
        ));
        collisions.push(json!({ "label": label, "with": tag, "kind": "tag" }));
    }
    for row in select(cf, account, Q_TWINS)? {
        let (label, other) = (text(&row, "label"), text(&row, "other"));
        decisions.push(format!(
            "the columns {label} and {other} would become one label: rename one before deploying"
        ));
        collisions.push(json!({ "label": label, "with": other, "kind": "column" }));
    }
    plan["collisions"] = Value::Array(collisions);
    Ok(())
}

const KEEP: &str = "abcdefghijklmnopqrstuvwxyz0123456789._-";
const FOLD_FROM: &str = "àáâãäåāăąÀÁÂÃÄÅĀĂĄçćčÇĆČďđðĎĐèéêëēėęěÈÉÊËĒĖĘĚìíîïīįıÌÍÎÏĪĮłŁñńňÑŃŇòóôõöøōőÒÓÔÕÖØŌŐřŘśšşŚŠŞťŤùúûüūůűųÙÚÛÜŪŮŰŲýÿÝŸźżžŹŻŽ";
const FOLD_TO: &str = "aaaaaaaaaaaaaaaaaaccccccdddddeeeeeeeeeeeeeeeeiiiiiiiiiiiiillnnnnnnoooooooooooooooorrssssssttuuuuuuuuuuuuuuuuyyyyzzzzzz";
const RESERVED: [&str; 11] = [
    "admln", "p99", "root", "support", "manager", "system", "null", "me", "everyone", "here",
    "channel",
];

fn fold(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.trim_matches(' ').to_ascii_lowercase().chars() {
        if KEEP.contains(c) {
            out.push(c);
        } else if c == ' ' || c == '\t' {
            out.push('.');
        } else if let Some(at) = FOLD_FROM.chars().position(|f| f == c) {
            out.extend(FOLD_TO.chars().nth(at));
        } else {
            out.push_str(match c {
                'ß' => "ss",
                'æ' | 'Æ' => "ae",
                'œ' | 'Œ' => "oe",
                'þ' | 'Þ' => "th",
                _ => "",
            });
        }
    }
    let out = out
        .replace("...", ".")
        .replace("..", ".")
        .replace("__", "_")
        .replace("--", "-")
        .replace("..", ".")
        .replace(".-", "-");
    let trimmed: String = out
        .trim_start_matches(['.', '_', '-'])
        .chars()
        .take(26)
        .collect();
    trimmed.trim_end_matches(['.', '_', '-']).to_owned()
}

fn skeleton(username: &str) -> String {
    let mut s: String = username
        .chars()
        .filter(|c| !matches!(c, '.' | '_' | '-'))
        .collect();
    for (from, to) in [
        ("0", "o"),
        ("1", "l"),
        ("i", "l"),
        ("3", "e"),
        ("4", "a"),
        ("5", "s"),
        ("7", "t"),
        ("8", "b"),
        ("rn", "m"),
        ("vv", "w"),
    ] {
        s = s.replace(from, to);
    }
    s
}

fn default_usernames(sources: &[(String, String)]) -> Vec<(String, String, String, &'static str)> {
    let based: Vec<(String, &'static str)> = sources
        .iter()
        .map(|(email, name)| {
            let from_name = fold(name);
            let local = fold(email.split_once('@').map_or("", |(l, _)| l));
            if from_name.chars().count() >= 3 {
                (from_name, "name")
            } else if local.chars().count() >= 3 {
                (local, "e-mail")
            } else {
                ("member".to_owned(), "member")
            }
        })
        .collect();
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut taken: BTreeSet<String> = BTreeSet::new();
    let mut shapes: BTreeSet<String> = BTreeSet::new();
    let mut out = Vec::new();
    for ((email, name), (base, why)) in sources.iter().zip(based) {
        let shape = skeleton(&base);
        let n = seen.entry(shape.clone()).or_insert(0);
        *n += 1;
        let rank = *n + usize::from(RESERVED.contains(&shape.as_str()));
        let username = if rank > 1 {
            format!("{base}{rank}")
        } else {
            base
        };
        let mut why = why;
        if rank > 1 {
            why = "numbered";
        }
        let (username, why) = if taken.contains(&username) || shapes.contains(&skeleton(&username))
        {
            ("member-…".to_owned(), "random")
        } else {
            taken.insert(username.clone());
            shapes.insert(skeleton(&username));
            (username, why)
        };
        out.push((email.clone(), name.clone(), username, why));
    }
    out
}

fn render(account: &str, plan: &Value, hash: &str) -> String {
    let mut out = String::new();
    let list = |v: &Value| v.as_array().cloned().unwrap_or_default();
    let pending: Vec<String> = list(&plan["pending"])
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    out.push_str(&format!("Migration plan for the account {account}\n"));
    if pending.is_empty() || plan.get("kinds").is_none() {
        out.push_str("  nothing to migrate: the database is new or already past every gated migration; deploy needs no --accept-plan\n");
        render_old_tags(&mut out, plan);
        out.push_str(&format!("\nPlan hash: {hash}\n"));
        return out;
    }
    out.push_str(&format!("  pending: {}\n", pending.join(", ")));
    let owner = match plan["owner"].as_object() {
        Some(o) => person(
            o["name"].as_str().unwrap_or_default(),
            o["email"].as_str().unwrap_or_default(),
        ),
        None => "nobody (no live Owner code)".into(),
    };

    if plan.get("statuses").is_some() {
        let between: Vec<&str> = bundle::MIGRATIONS
            .iter()
            .map(|(name, _)| *name)
            .filter(|name| {
                pending.first().is_some_and(|f| *name > f.as_str())
                    && pending.last().is_some_and(|l| *name < l.as_str())
                    && !pending.iter().any(|p| p == name)
            })
            .collect();
        if !between.is_empty() {
            out.push_str(&format!(
                "  with them, {} add tables, columns and indexes only\n",
                between.join(", ")
            ));
        }
        out.push_str(
            "\n1.7 states become labels (0004, then 0011): one label per item, its column, and the stage reporters see\n",
        );
        for row in list(&plan["statuses"]) {
            out.push_str(&format!(
                "  {:<12} -> {:<7} {:<12} {} open, {} in all\n",
                text(&row, "status"),
                text(&row, "label"),
                text(&row, "stage"),
                count(&row, "open"),
                count(&row, "items")
            ));
        }
        out.push_str(&format!(
            "\nBoards (0004, then 0011): one home board per host with the four default columns, owned by {owner}\n  (1.7 had no boards, so the account's first Owner code that isn't revoked owns them; each column holds its cards newest first)\n"
        ));
        for row in list(&plan["boards"]) {
            out.push_str(&format!(
                "  {}: {}\n",
                text(&row, "name"),
                many(count(&row, "items"), "item")
            ));
        }
        render_members(&mut out, plan);
    } else if plan.get("labels").is_some() {
        out.push_str("\nStates become labels (0011): one label per item, its column\n");
        for row in list(&plan["labels"]) {
            out.push_str(&format!(
                "  {:<10} -> {:<14} {} open, {} in all\n",
                text(&row, "status"),
                text(&row, "label"),
                count(&row, "open"),
                count(&row, "items")
            ));
        }
        out.push_str(&format!(
            "\nBoards (0011): each becomes its own board with the four default columns, owned by {owner}\n  (1.8 kept no board creator, so the account's first Owner code that isn't revoked owns them)\n"
        ));
        for row in list(&plan["boards"]) {
            let nest = row["parent"]
                .as_str()
                .map(|p| format!(", nested in {p}: flattened"))
                .unwrap_or_default();
            let host = row["host"].as_str().unwrap_or("every host");
            out.push_str(&format!(
                "  {} \"{}\" ({host}{nest}), {}\n",
                text(&row, "slug"),
                text(&row, "name"),
                many(count(&row, "items"), "item")
            ));
        }
        let order = list(&plan["order"]);
        out.push_str(
            "\nCard order (0011): priority becomes each column's order, then the current place\n",
        );
        if order.is_empty() {
            out.push_str("  no card moves\n");
        }
        for row in order {
            out.push_str(&format!(
                "  {} / {}: {} of {} cards move\n",
                text(&row, "board"),
                text(&row, "label"),
                count(&row, "moves"),
                count(&row, "cards")
            ));
        }
        out.push_str(&format!(
            "\nTags beyond the label (0011 keeps them untouched; a later migration drops them on your word): {}\n",
            many(count(plan, "tagged"), "item")
        ));
        for row in list(&plan["tags"]) {
            out.push_str(&format!(
                "  {}: {}\n",
                text(&row, "tag"),
                many(count(&row, "items"), "item")
            ));
        }
        render_members(&mut out, plan);
        let collisions = list(&plan["collisions"]);
        out.push_str("\nLabel names\n");
        if collisions.is_empty() {
            out.push_str("  no collisions\n");
        }
        for row in collisions {
            out.push_str(&format!(
                "  the column {} and the {} {}\n",
                text(&row, "label"),
                text(&row, "kind"),
                text(&row, "with")
            ));
        }
    }

    if let Some(people) = plan.get("people") {
        out.push_str(&format!(
            "\nPeople (0012): {} rows, each with a default username they can change\n",
            count(people, "rows")
        ));
        for row in list(&people["usernames"]) {
            let why = match row["why"].as_str().unwrap_or_default() {
                "numbered" => "a number, the name is taken",
                "e-mail" => "from the e-mail, the name is too short",
                "member" => "fallback, name and e-mail too short",
                _ => "random, every default is taken",
            };
            out.push_str(&format!(
                "  {} -> @{} ({why})\n",
                person(&text(&row, "name"), &text(&row, "email")),
                text(&row, "username")
            ));
        }
    }

    let agents = list(&plan["agents"]);
    out.push_str("\nAgents act as their person\n");
    if agents.is_empty() {
        out.push_str("  no agent actions\n");
    }
    for row in agents {
        out.push_str(&format!(
            "  {}: {}, shown as {}\n",
            person(&text(&row, "name"), &text(&row, "email")),
            many(count(&row, "actions"), "action"),
            row["shown"].as_str().unwrap_or("(no username)")
        ));
    }

    render_old_tags(&mut out, plan);

    out.push_str("\nKinds and keys (unchanged)\n");
    let kinds: Vec<String> = list(&plan["kinds"])
        .iter()
        .map(|row| {
            format!(
                "{} {} ({} open)",
                row["prefix"]
                    .as_str()
                    .map_or_else(|| text(row, "kind"), |p| format!("{p}-")),
                count(row, "items"),
                count(row, "open")
            )
        })
        .collect();
    out.push_str(&format!(
        "  {}\n",
        if kinds.is_empty() {
            "no items".to_owned()
        } else {
            kinds.join(", ")
        }
    ));

    out.push_str("\nHosts (their settings carry over)\n");
    for row in list(&plan["hosts"]) {
        let mut said = vec![format!("env {}", text(&row, "env"))];
        if let Some(above) = row["above"].as_str() {
            said.push(format!("above {above}"));
        }
        let off = list(&row["off"]);
        if !off.is_empty() {
            said.push(format!("off on {}", many(off.len() as i64, "path")));
        }
        out.push_str(&format!("  {}: {}\n", text(&row, "host"), said.join(", ")));
    }
    if let Some(url) = plan["url"].as_str() {
        out.push_str(&format!("  the CLI's url {url} stays\n"));
    }
    crate::fold::render(&mut out, plan);
    crate::prune::render(&mut out, plan);
    crate::counts::render(&mut out, plan);

    out.push_str("\nDecisions\n");
    let decisions = list(&plan["decisions"]);
    if decisions.is_empty() {
        out.push_str("  none: nothing here needs an answer\n");
    }
    for d in decisions {
        out.push_str(&format!("  - {}\n", d.as_str().unwrap_or_default()));
    }
    out.push_str(&format!(
        "\nPlan hash: {hash}\nOnce the decisions are answered: p99 deploy --accept-plan {hash}\n"
    ));
    out
}

fn render_old_tags(out: &mut String, plan: &Value) {
    if let Some(tags) = plan.get("old_tags") {
        out.push_str(&format!(
            "\nOld tags beyond the label (item_labels rows nothing reads; 0017 deletes them): {} on {}\n",
            many(count(tags, "tags"), "tag"),
            many(count(tags, "items"), "item")
        ));
    }
}

fn render_members(out: &mut String, plan: &Value) {
    let members = plan["members"].as_array().cloned().unwrap_or_default();
    out.push_str("\nMembers who changed states that only Owners set from 1.9 on\n");
    if members.is_empty() {
        out.push_str("  none\n");
    }
    for row in members {
        out.push_str(&format!(
            "  {}: {}\n",
            person(&text(&row, "name"), &text(&row, "email")),
            many(count(&row, "changes"), "change")
        ));
    }
}

fn agent_shown(username: &str) -> String {
    format!("@{username} {}", crate::card::ROBOT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_0005_to_0010_only_add_empty_schema_so_a_plan_read_before_0005_still_holds() {
        let between: Vec<&(&str, &str)> = crate::bundle::MIGRATIONS
            .iter()
            .filter(|(name, _)| ("0005".."0011").contains(&&name[..4]))
            .collect();
        assert_eq!(between.len(), 6);
        for (name, sql) in between {
            let body: String = sql
                .lines()
                .map(|l| l.split("--").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            for statement in body.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                let upper = statement.to_ascii_uppercase();
                assert!(
                    [
                        "CREATE TABLE ",
                        "CREATE INDEX ",
                        "CREATE UNIQUE INDEX ",
                        "ALTER TABLE "
                    ]
                    .iter()
                    .any(|start| upper.starts_with(start)),
                    "{name} does more than add schema: {statement}"
                );
                for word in [" AS SELECT", "INSERT ", "UPDATE ", "DELETE ", "TRIGGER "] {
                    assert!(!upper.contains(word), "{name} writes data: {statement}");
                }
                if upper.starts_with("ALTER TABLE ") {
                    assert!(
                        upper.contains(" ADD COLUMN ") && !upper.contains(" DEFAULT "),
                        "{name} fills a column the plan reads as empty: {statement}"
                    );
                }
            }
        }
    }

    #[test]
    fn an_agent_in_the_plan_shows_with_the_robot_never_an_asterisk() {
        assert_eq!(agent_shown("ada.lovelace"), "@ada.lovelace 🤖");
        assert!(!agent_shown("ada.lovelace").contains('*'));
    }

    #[test]
    fn the_hash_is_the_sha256_of_sorted_compact_json() {
        let a = json!({"b": [1, {"y": "é", "x": null}], "a": true});
        let mut text = String::new();
        canonical(&a, &mut text);
        assert_eq!(text, r#"{"a":true,"b":[1,{"x":null,"y":"é"}]}"#);
        assert_eq!(hash(&a).len(), 64);
        assert_ne!(hash(&a), hash(&json!({"a": false, "b": []})));
    }

    #[test]
    fn a_migration_that_changes_data_waits_for_a_plan() {
        for (name, sql) in bundle::MIGRATIONS {
            if GATED.contains(&&name[..4]) {
                continue;
            }
            for line in sql.lines() {
                let line = line.trim().to_ascii_uppercase();
                let writes = ["UPDATE ", "DELETE ", "INSERT ", "REPLACE ", "DROP "]
                    .iter()
                    .any(|word| line.starts_with(word));
                assert!(
                    !writes && !line.contains(" DROP "),
                    "{name} changes data, so its number belongs in GATED: {line}"
                );
            }
        }
    }

    #[test]
    fn gated_migrations_are_known_by_their_number() {
        let names: Vec<String> = bundle::MIGRATIONS
            .iter()
            .map(|(n, _)| (*n).to_owned())
            .collect();
        let numbers: BTreeSet<&str> = names.iter().map(|n| &n[..4]).collect();
        assert_eq!(numbers.len(), names.len());
        assert!(names.iter().all(|n| n.as_bytes()[4] == b'_'));
        assert!(GATED.windows(2).all(|w| w[0] < w[1]));
        let past: Vec<String> = GATED.iter().map(|g| format!("{g}_x.sql")).collect();
        assert!(gated_pending(&past).is_empty());
        assert_eq!(gated_pending(&[]).len(), GATED.len());
        let v17: Vec<String> = bundle::MIGRATIONS[..3]
            .iter()
            .map(|(n, _)| (*n).to_owned())
            .collect();
        assert_eq!(
            gated_pending(&v17).first().map(String::as_str),
            Some("0004_boards.sql")
        );
    }

    #[test]
    fn the_board_limit_counts_one_space_at_a_time() {
        let owner: Owner = Some(("ada@example.com".into(), "Ada Lovelace".into()));
        let reach: BTreeSet<String> = ["*".to_owned()].into();
        let spread: Vec<Option<String>> = ["a", "b", "c", "d"]
            .iter()
            .map(|h| Some(format!("{h}.example.com")))
            .collect();
        let mut decisions = Vec::new();
        owner_decisions(&owner, &reach, &spread, "test", &mut decisions);
        assert!(decisions.is_empty(), "{decisions:?}");
        let piled = vec![Some("example.com".to_owned()); 4];
        owner_decisions(&owner, &reach, &piled, "test", &mut decisions);
        assert_eq!(decisions.len(), 1, "{decisions:?}");
        assert!(decisions[0].contains("all 4 boards of example.com"));
        let everywhere = vec![None; 4];
        owner_decisions(&owner, &reach, &everywhere, "test", &mut decisions);
        assert_eq!(decisions.len(), 2, "{decisions:?}");
        assert!(decisions[1].contains("all 4 boards of every host"));
        let mut none = Vec::new();
        owner_decisions(&None, &BTreeSet::new(), &spread, "test", &mut none);
        assert_eq!(none.len(), 1);
        assert!(none[0].starts_with("no live Owner code"));
    }

    #[test]
    fn default_usernames_fold_number_and_fall_back() {
        let rows: Vec<(String, String)> = [
            ("ada@example.com", "Ada Lovelace"),
            ("ada2@example.com", "Ada  Lovelace"),
            ("grace@example.com", "Grâce Hopper"),
            ("x@example.com", "X"),
            ("jo@example.com", ""),
            ("root@example.com", "Root"),
            ("adalovelace@example.com", "Ada-Lovelace"),
        ]
        .iter()
        .map(|(e, n)| ((*e).to_owned(), (*n).to_owned()))
        .collect();
        let got: Vec<(String, &str)> = default_usernames(&rows)
            .into_iter()
            .map(|(_, _, u, w)| (u, w))
            .collect();
        assert_eq!(
            got,
            [
                ("ada.lovelace".to_owned(), "name"),
                ("ada.lovelace2".to_owned(), "numbered"),
                ("grace.hopper".to_owned(), "name"),
                ("member".to_owned(), "member"),
                ("member2".to_owned(), "numbered"),
                ("root2".to_owned(), "numbered"),
                ("ada-lovelace3".to_owned(), "numbered"),
            ]
        );
    }

    #[test]
    fn fold_lowers_strips_accents_joins_words_and_caps_at_26_as_0012_people_sql_does() {
        for (raw, folded) in [
            ("  Ada Lovelace ", "ada.lovelace"),
            ("Grâce Hopper", "grace.hopper"),
            ("Straße", "strasse"),
            ("Æsir", "aesir"),
            ("Œuvre", "oeuvre"),
            ("Þór", "thor"),
            ("ŽELKO Đurić", "zelko.duric"),
            ("a...b", "a.b"),
            ("..ada--", "ada"),
            ("x__y--z", "x_y-z"),
            ("ada\tbyron", "ada.byron"),
            ("ada .- byron", "ada-.byron"),
            ("a---b", "a--b"),
            ("a___b", "a__b"),
            ("a....b", "a.b"),
            ("日本", ""),
            (
                "abcdefghijklmnopqrstuvwxyz1234",
                "abcdefghijklmnopqrstuvwxyz",
            ),
            ("abcdefghijklmnopqrstuvwxy.z", "abcdefghijklmnopqrstuvwxy"),
        ] {
            assert_eq!(fold(raw), folded, "{raw:?}");
        }
    }

    #[test]
    fn skeleton_ignores_separators_and_lookalike_letters() {
        assert_eq!(skeleton("ada.lovelace"), "adalovelace");
        assert_eq!(skeleton("r00t"), "root");
        assert_eq!(skeleton("rn1ck"), "mlck");
        assert_eq!(skeleton("vvi11"), "wlll");
        assert_eq!(skeleton("s_4-7.e"), "sate");
        assert_eq!(skeleton("b8"), "bb");
        assert_eq!(skeleton("admin"), skeleton("adm1n"));
        assert_eq!(skeleton("adm1n"), "admln");
    }

    #[test]
    fn small_words_count_people_and_numbers_the_same_way_everywhere() {
        assert_eq!(many(0, "tag"), "0 tags");
        assert_eq!(many(1, "tag"), "1 tag");
        assert_eq!(many(2, "item"), "2 items");
        assert_eq!(person("", "ada@example.com"), "ada@example.com");
        assert_eq!(person("  ", "ada@example.com"), "ada@example.com");
        assert_eq!(
            person(" Ada Lovelace ", "ada@example.com"),
            "Ada Lovelace <ada@example.com>"
        );
        let row = json!({"n": 3, "f": 2.9, "s": "x", "bad": "7"});
        assert_eq!(count(&row, "n"), 3);
        assert_eq!(count(&row, "f"), 2);
        assert_eq!(count(&row, "bad"), 0);
        assert_eq!(count(&row, "none"), 0);
        assert_eq!(text(&row, "s"), "x");
        assert_eq!(text(&row, "n"), "");
        assert!(numbered("0004_boards.sql", "0004"));
        assert!(!numbered("00040_x.sql", "0004"));
        assert!(!numbered("0004", "0004"));
        assert!(!numbered("0005_labels.sql", "0004"));
    }

    #[test]
    fn the_plan_reads_one_select_and_nothing_else() {
        for sql in [
            "DELETE FROM items",
            "select 1",
            "SELECT 1; DROP TABLE items",
            " SELECT 1",
        ] {
            assert_eq!(
                reads(sql),
                Err("the plan only reads, one SELECT at a time".into()),
                "{sql}"
            );
        }
        assert_eq!(reads("SELECT name FROM d1_migrations ORDER BY id"), Ok(()));
    }

    #[test]
    fn the_plan_of_a_database_with_nothing_gated_says_so_and_ends_with_its_hash() {
        let plan = json!({"pending": [], "decisions": []});
        let out = render("main", &plan, "abc123");
        assert!(out.starts_with("Migration plan for the account main\n"));
        assert!(out.contains("nothing to migrate"));
        assert!(out.contains("deploy needs no --accept-plan"));
        assert!(out.ends_with("\nPlan hash: abc123\n"), "{out}");
        assert!(!out.contains("Old tags"));
        let tagged = json!({"pending": [], "old_tags": {"tags": 1, "items": 2}});
        let out = render("main", &tagged, "abc123");
        assert!(out.contains(": 1 tag on 2 items\n"), "{out}");
        let mut members = String::new();
        render_members(&mut members, &json!({}));
        assert!(members.ends_with("  none\n"));
        let mut members = String::new();
        render_members(
            &mut members,
            &json!({"members": [{"name": "Grace Hopper", "email": "grace@example.com", "changes": 1}]}),
        );
        assert!(members.ends_with("  Grace Hopper <grace@example.com>: 1 change\n"));
    }

    #[test]
    fn gated_pending_names_each_missing_gate_by_its_shipped_file() {
        let all: Vec<String> = bundle::MIGRATIONS
            .iter()
            .map(|(n, _)| (*n).to_owned())
            .collect();
        let gates: Vec<String> = GATED
            .iter()
            .map(|g| all.iter().find(|n| numbered(n, g)).unwrap().clone())
            .collect();
        assert_eq!(gated_pending(&[]), gates);
        assert_eq!(gated_pending(&all[..11]), gates[2..]);
        assert!(gated_pending(&all).is_empty());
    }
}

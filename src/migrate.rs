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

const Q_LABELS: &str = "SELECT s.key AS status, s.name AS label, count(i.id) AS items, COALESCE(sum(i.open), 0) AS open FROM statuses s LEFT JOIN items i ON i.status = s.key GROUP BY s.key ORDER BY s.position, s.key";

const Q_MANAGERS: &str = "SELECT lower(trim(email)) AS email, name, hosts_json, revoked_at IS NULL AS live FROM codes WHERE manager = 1 ORDER BY revoked_at IS NOT NULL, id";

const Q_BOARDS: &str = "SELECT b.slug, b.name, b.host, p.slug AS parent, (SELECT count(*) FROM items i WHERE i.board_id = b.id) AS items FROM boards b LEFT JOIN boards p ON p.id = b.parent_id ORDER BY b.id";

const Q_ORDER: &str = "SELECT b.slug AS board, COALESCE(s.name, x.status) AS label, count(*) AS cards, sum(x.now_at <> x.next_at) AS moves FROM (SELECT board_id, status, row_number() OVER (PARTITION BY board_id, status ORDER BY position, id) AS now_at, row_number() OVER (PARTITION BY board_id, status ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, position, id) AS next_at FROM items) x JOIN boards b ON b.id = x.board_id LEFT JOIN statuses s ON s.key = x.status GROUP BY x.board_id, x.status HAVING moves > 0 ORDER BY b.id, s.position";

const EXTRA_TAGS: &str = "FROM item_labels il JOIN labels l ON l.id = il.label_id JOIN items i ON i.id = il.item_id LEFT JOIN statuses s ON s.key = i.status WHERE s.name IS NULL OR lower(trim(s.name)) <> lower(trim(l.name))";

const Q_MEMBERS: &str = "SELECT lower(trim(e.actor_email)) AS email, (SELECT n.name FROM codes n WHERE lower(trim(n.email)) = lower(trim(e.actor_email)) ORDER BY n.id DESC LIMIT 1) AS name, count(*) AS changes FROM events e WHERE e.kind = 'status' AND e.actor_email IS NOT NULL AND EXISTS (SELECT 1 FROM codes r WHERE lower(trim(r.email)) = lower(trim(e.actor_email))) AND NOT EXISTS (SELECT 1 FROM codes m WHERE lower(trim(m.email)) = lower(trim(e.actor_email)) AND m.manager = 1 AND m.revoked_at IS NULL) AND NOT (json_extract(e.detail_json, '$.to') = 'abandoned' OR (json_extract(e.detail_json, '$.to') = 'done' AND json_extract(e.detail_json, '$.resolution') = 'abandoned')) AND NOT (json_extract(e.detail_json, '$.from') IN ('done', 'resolved', 'abandoned', 'duplicate') AND json_extract(e.detail_json, '$.to') IN ('inbox', 'new')) GROUP BY lower(trim(e.actor_email)) ORDER BY 1";

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
) -> Result<Option<String>, String> {
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
    let now = hash(&plan(cf, account, applied)?);
    if given != now {
        return Err(
            "the plan changed since that hash was taken (the database moved on): read `p99 migrate --plan` again and run with its new hash"
                .into(),
        );
    }
    Ok(Some(now))
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
    if applied.is_empty() || pending.is_empty() {
        plan["decisions"] = json!([]);
        return Ok(plan);
    }
    let first_gated = GATED.first().copied().unwrap_or_default();
    let behind: Vec<&str> = bundle::MIGRATIONS
        .iter()
        .map(|(name, _)| *name)
        .filter(|name| *name < first_gated && !applied.iter().any(|a| a == name))
        .collect();
    if !behind.is_empty() {
        return Err(format!(
            "this account's schema is older than P99 1.8 ({} not applied): deploy P99 1.8 first, then plan",
            behind.join(", ")
        ));
    }
    let lanes = pending.iter().any(|p| p.starts_with("0011"));
    let people = pending.iter().any(|p| p.starts_with("0012"));
    let mut decisions: Vec<String> = Vec::new();

    if lanes {
        lanes_plan(cf, account, &mut plan, &mut decisions)?;
    }

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
        plan["people"] = json!({ "rows": derived.len(), "usernames": notable });
    } else if applied.iter().any(|a| numbered(a, "0012")) {
        for row in select(cf, account, Q_USERNAMES)? {
            usernames.insert(text(&row, "email"), text(&row, "username"));
        }
    }

    let mut agents = Vec::new();
    for row in select(cf, account, Q_AGENTS)? {
        let email = text(&row, "email");
        let shown = usernames.get(&email).map(|u| format!("@{u}*"));
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

fn lanes_plan(
    cf: &Cloudflare,
    account: &Account,
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

    let managers = select(cf, account, Q_MANAGERS)?;
    let owner = managers
        .first()
        .map(|r| (text(r, "email"), text(r, "name")));
    let mut reach: BTreeSet<String> = BTreeSet::new();
    if let Some((email, _)) = &owner {
        for row in managers
            .iter()
            .filter(|r| text(r, "email") == *email && count(r, "live") == 1)
        {
            let hosts: Vec<String> =
                serde_json::from_str(&text(row, "hosts_json")).unwrap_or_default();
            reach.extend(hosts);
        }
    }
    plan["owner"] = match &owner {
        Some((email, name)) => json!({ "email": email, "name": name }),
        None => Value::Null,
    };

    let mut boards = Vec::new();
    let mut nested = 0;
    let mut unreached = BTreeSet::new();
    for row in select(cf, account, Q_BOARDS)? {
        let host = row["host"].as_str().map(str::to_owned);
        if row["parent"].is_string() {
            nested += 1;
        }
        if let (Some(host), Some(_)) = (&host, &owner)
            && !reach.contains("*")
            && !reach.contains(host)
        {
            unreached.insert(host.clone());
        }
        boards.push(json!({
            "slug": text(&row, "slug"),
            "name": text(&row, "name"),
            "host": host,
            "parent": row["parent"].as_str(),
            "items": count(&row, "items"),
        }));
    }
    match &owner {
        None if !boards.is_empty() => decisions.push(
            "no manager code exists to own the boards: mint a manager code before deploying".into(),
        ),
        Some((email, name)) if boards.len() > BOARDS_PER_PERSON => decisions.push(format!(
            "{} would own all {} boards (1.8 kept no board creator), over the {BOARDS_PER_PERSON} a person may have: say who owns which, or which boards to remove first",
            person(name, email),
            boards.len()
        )),
        _ => {}
    }
    if let Some((email, name)) = &owner
        && !unreached.is_empty()
    {
        decisions.push(format!(
            "{} would own boards of {}, which their code doesn't cover: widen their code or name another owner",
            person(name, email),
            unreached.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    plan["boards"] = Value::Array(boards);
    plan["nested"] = json!(nested);

    let order: Vec<Value> = select(cf, account, Q_ORDER)?
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

    let tags: Vec<Value> = select(
        cf,
        account,
        &format!("SELECT l.name AS tag, count(*) AS items {EXTRA_TAGS} GROUP BY l.id ORDER BY lower(l.name), l.id"),
    )?
    .iter()
    .map(|r| json!({ "tag": text(r, "tag"), "items": count(r, "items") }))
    .collect();
    let tagged = select(
        cf,
        account,
        &format!("SELECT count(DISTINCT il.item_id) AS items {EXTRA_TAGS}"),
    )?
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
            "{} changed states that only managers set from 1.9 on: give them manager codes, or leave them reporters",
            many(members.len() as i64, "member")
        ));
    }
    plan["members"] = Value::Array(members);

    let mut collisions = Vec::new();
    for row in select(cf, account, Q_COLLIDE)? {
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
        out.push_str(&format!("\nPlan hash: {hash}\n"));
        return out;
    }
    out.push_str(&format!("  pending: {}\n", pending.join(", ")));

    if plan.get("labels").is_some() {
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
        let owner = match plan["owner"].as_object() {
            Some(o) => person(
                o["name"].as_str().unwrap_or_default(),
                o["email"].as_str().unwrap_or_default(),
            ),
            None => "nobody (no manager code)".into(),
        };
        out.push_str(&format!(
            "\nBoards (0011): each becomes its own board with the four default columns, owned by {owner}\n  (1.8 kept no board creator, so the account's first manager owns them)\n"
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
        let members = list(&plan["members"]);
        out.push_str("\nMembers who changed states that only managers set from 1.9 on\n");
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

#[cfg(test)]
mod tests {
    use super::*;

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
}

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command as Process;

use serde::Serialize;
use serde_json::{Value, json};

use crate::client::Client;
use crate::config::{CORNERS, Config, Host, Offset};
use crate::trailers;
use crate::wire::{
    ATTACHMENT_LIMIT, Announced, Build, BuildItem, Change, Code, Comment, EnvEntry, HostEntry,
    Issue, KINDS, ListQuery, NewCode, NewIssue, PageRef, STATUSES, Summary, Thread, content_type,
    out,
};

#[derive(Debug, Default, clap::Args)]
pub struct Global {
    #[arg(long, global = true, help = "answer in JSON, for agents and scripts")]
    pub json: bool,
    #[arg(
        long,
        global = true,
        value_name = "name",
        help = "the account to use, when the config has several"
    )]
    pub account: Option<String>,
    #[arg(
        long,
        global = true,
        help = "act as an agent of the configured person, shown as their name with a * (or P99_AGENT=1)"
    )]
    pub agent: bool,
    #[arg(
        long,
        global = true,
        hide = true,
        help = "serve built-in sample data: no config and no network"
    )]
    pub demo: bool,
}

#[derive(Debug, clap::Subcommand)]
pub enum Command {
    #[command(about = "list the hosts P99 serves; add, remove or set one")]
    Hosts(HostsArgs),
    #[command(about = "mint a personal code for a person on one or more hosts")]
    Invite(InviteArgs),
    #[command(about = "list the personal codes")]
    Invites(InvitesArgs),
    #[command(about = "revoke a personal code")]
    Revoke(RevokeArgs),
    #[command(about = "move a person's items, comments, events and codes to another e-mail")]
    People(PeopleArgs),
    #[command(about = "list items")]
    List(ListArgs),
    #[command(about = "show an item with its comments, events and landings")]
    Show(ShowArgs),
    #[command(about = "file an item on a host")]
    File(FileArgs),
    #[command(about = "comment on an item")]
    Comment(CommentArgs),
    #[command(about = "change an item's status")]
    Status(StatusArgs),
    #[command(about = "assign an item to someone, or to no one")]
    Assign(AssignArgs),
    #[command(about = "download an attachment")]
    Download(DownloadArgs),
    #[command(about = "tell P99 which items this checkout's commits fixed or referred to")]
    Announce(AnnounceArgs),
    #[command(about = "bring items over from another tracker, keeping their keys and numbers")]
    Import(crate::import::ImportArgs),
}

#[derive(Debug, clap::Args)]
pub struct PeopleArgs {
    #[command(subcommand)]
    pub action: PeopleAction,
}

#[derive(Debug, clap::Subcommand)]
pub enum PeopleAction {
    #[command(
        about = "move everything filed, said or held under one e-mail to another, on the whole account"
    )]
    Rename {
        #[arg(help = "the e-mail the items are under now")]
        from: String,
        #[arg(help = "the e-mail they move to")]
        to: String,
    },
}

#[derive(Debug, clap::Args)]
pub struct HostsArgs {
    #[command(subcommand)]
    pub action: Option<HostsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum HostsAction {
    #[command(about = "add a host: its route, its record and its environment")]
    Add(AddArgs),
    #[command(about = "remove a host from the Worker and the config; its items stay")]
    Remove { host: String },
    #[command(about = "change where the button sits, which pages it skips, its theme and words")]
    Set(SetArgs),
}

#[derive(Debug, clap::Args)]
pub struct AddArgs {
    pub host: String,
    #[arg(long, default_value = "production", help = "the host's environment")]
    pub env: String,
    #[arg(
        long,
        value_parser = ["development", "release"],
        help = "the environment's kind, when it is new or changes"
    )]
    pub kind: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct SetArgs {
    pub host: String,
    #[arg(long, value_parser = CORNERS, help = "the button's corner")]
    pub corner: Option<String>,
    #[arg(long, value_name = "X,Y", help = "pixels from the corner's two edges")]
    pub offset: Option<String>,
    #[arg(
        long,
        value_name = "selector",
        help = "sit above this element while it shows"
    )]
    pub above: Option<String>,
    #[arg(
        long,
        value_name = "pattern",
        help = "a path where P99 never loads; repeat it, they replace the list"
    )]
    pub off: Vec<String>,
    #[arg(
        long,
        value_name = "key=value",
        help = "a theme variable; an empty value removes it"
    )]
    pub theme: Vec<String>,
    #[arg(
        long,
        value_name = "key=value",
        help = "one of the panel's words; an empty value removes it"
    )]
    pub string: Vec<String>,
}

#[derive(Debug, clap::Args)]
pub struct InviteArgs {
    #[arg(required = true, help = "the hosts the code works on")]
    pub hosts: Vec<String>,
    #[arg(long, help = "the person's name, as P99 shows it")]
    pub name: String,
    #[arg(long, help = "the person's e-mail, which ties their items to them")]
    pub email: String,
    #[arg(long, help = "let the person see and change every item")]
    pub manager: bool,
    #[arg(
        long,
        help = "also ask for a 6-digit code from an authenticator app the first time each browser uses the link"
    )]
    pub totp: bool,
}

#[derive(Debug, clap::Args)]
pub struct InvitesArgs {
    #[arg(long, help = "only the codes for this host")]
    pub host: Option<String>,
    #[command(subcommand)]
    pub action: Option<InvitesAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum InvitesAction {
    #[command(
        about = "add an authenticator to a code, or replace it; the person's link stays, every browser asks for a 6-digit code again"
    )]
    Totp {
        #[arg(help = "the code's id, from p99 invites")]
        id: i64,
    },
}

#[derive(Debug, clap::Args)]
pub struct RevokeArgs {
    #[arg(help = "the code's id, from p99 invites")]
    pub id: i64,
}

#[derive(Debug, clap::Args)]
pub struct ListArgs {
    #[arg(help = "the host to list")]
    pub host: Option<String>,
    #[arg(long, conflicts_with = "host", help = "every host")]
    pub all: bool,
    #[arg(long, default_value = "open", help = "open, closed, any or one status")]
    pub status: String,
    #[arg(
        long,
        help = "only this kind: bug, feature, improvement, question or task"
    )]
    pub kind: Option<String>,
    #[arg(long, help = "only what you reported")]
    pub mine: bool,
    #[arg(
        short = 'q',
        long = "query",
        value_name = "text",
        help = "items whose title or text holds these words, accents ignored"
    )]
    pub query: Option<String>,
    #[arg(long, default_value_t = 50, help = "at most this many items")]
    pub limit: usize,
}

#[derive(Debug, clap::Args)]
pub struct ShowArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct FileArgs {
    #[arg(help = "the host the item is for")]
    pub host: String,
    #[arg(long, value_parser = KINDS, help = "what it is")]
    pub kind: String,
    #[arg(long, help = "one line that says what it is about")]
    pub title: String,
    #[arg(long, help = "the text, or - to read it from standard input")]
    pub body: Option<String>,
    #[arg(
        long,
        value_name = "path",
        default_value = "/",
        help = "the page it is about"
    )]
    pub page: String,
    #[arg(long, value_name = "file", help = "a file to attach; repeat it")]
    pub attach: Vec<PathBuf>,
}

#[derive(Debug, clap::Args)]
pub struct CommentArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(help = "the text, or - to read it from standard input")]
    pub text: String,
    #[arg(long, help = "for managers only")]
    pub internal: bool,
    #[arg(long, value_name = "file", help = "a file to attach; repeat it")]
    pub attach: Vec<PathBuf>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct StatusArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(value_parser = STATUSES, help = "the new status")]
    pub status: String,
    #[arg(
        long,
        value_name = "KEY",
        help = "with duplicate: the item this one repeats"
    )]
    pub duplicate_of: Option<String>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct AssignArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(help = "an e-mail address, or me", required_unless_present = "none")]
    pub who: Option<String>,
    #[arg(long, conflicts_with = "who", help = "leave it unassigned")]
    pub none: bool,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct DownloadArgs {
    #[arg(help = "the file's id, from p99 show")]
    pub id: i64,
    #[arg(
        short = 'o',
        long,
        value_name = "path",
        help = "where to save it (its own name by default)"
    )]
    pub out: Option<PathBuf>,
}

#[derive(Debug, clap::Args)]
pub struct AnnounceArgs {
    #[arg(help = "the host the build went to; its environment is the build's")]
    pub host: Option<String>,
    #[arg(long, help = "the environment, when no host names it")]
    pub env: Option<String>,
    #[arg(long, help = "the branch (the current one by default)")]
    pub branch: Option<String>,
    #[arg(long, help = "the version (git describe by default)")]
    pub version: Option<String>,
    #[arg(
        long,
        value_name = "range",
        help = "a git range; the default is the last 500 commits"
    )]
    pub rev: Option<String>,
}

pub fn run(command: Command, global: &Global) -> Result<(), String> {
    let mut config = Config::load()?;
    match command {
        Command::Hosts(args) => match args.action {
            None => hosts_list(&config, global),
            Some(HostsAction::Add(a)) => hosts_add(&mut config, global, &a),
            Some(HostsAction::Remove { host }) => hosts_remove(&mut config, global, &host),
            Some(HostsAction::Set(a)) => hosts_set(&mut config, global, &a),
        },
        Command::Invite(a) => invite(&config, global, &a),
        Command::Invites(a) => invites(&config, global, &a),
        Command::Revoke(a) => revoke(&config, global, &a),
        Command::People(PeopleArgs {
            action: PeopleAction::Rename { from, to },
        }) => rename(&config, global, &from, &to),
        Command::List(a) => list(&config, global, &a),
        Command::Show(a) => show(&config, global, &a),
        Command::File(a) => file(&config, global, &a),
        Command::Comment(a) => comment(&config, global, &a),
        Command::Status(a) => status(&config, global, &a),
        Command::Assign(a) => assign(&config, global, &a),
        Command::Download(a) => download(&config, global, &a),
        Command::Announce(a) => announce(&config, global, &a),
        Command::Import(a) => import(&config, global, &a),
    }
}

fn import(
    config: &Config,
    global: &Global,
    args: &crate::import::ImportArgs,
) -> Result<(), String> {
    let host = args.host.trim().to_ascii_lowercase();
    let (client, _) = client_for(config, global, Some(&host))?;
    crate::import::run(&client, args, global.json)
}

fn account_of(config: &Config, global: &Global, host: Option<&str>) -> Result<String, String> {
    if let Some(name) = &global.account {
        return config.account(Some(name)).map(|(n, _)| n.to_owned());
    }
    if let Some(host) = host
        && let Some(entry) = config.hosts.get(host)
    {
        return Ok(entry.account.clone());
    }
    config.account(None).map(|(n, _)| n.to_owned())
}

fn client_for(
    config: &Config,
    global: &Global,
    host: Option<&str>,
) -> Result<(Client, String), String> {
    let account = account_of(config, global, host)?;
    let client = Client::for_account(config, &account, global.agent)?.aimed(host);
    Ok((client, account))
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    println!("{text}");
    Ok(())
}

fn key_of(raw: &str) -> Result<String, String> {
    crate::wire::item_number(raw)
        .map(|n| n.to_string())
        .ok_or_else(|| format!("{raw} is not an item key; try BUG-12 or 12"))
}

fn when(stamp: &str) -> String {
    stamp.replace('T', " ").chars().take(16).collect()
}

fn who(email: &str, name: &str, agent: bool) -> String {
    let base = if name.is_empty() { email } else { name };
    if agent {
        format!("{base}*")
    } else {
        base.to_owned()
    }
}

fn read_stdin() -> Result<String, String> {
    std::io::read_to_string(std::io::stdin()).map_err(|e| format!("standard input: {e}"))
}

fn text_arg(value: &str) -> Result<String, String> {
    if value == "-" {
        Ok(read_stdin()?.trim_end().to_owned())
    } else {
        Ok(value.to_owned())
    }
}

fn read_attachment(path: &Path) -> Result<(String, &'static str, Vec<u8>), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_owned();
    let kind = content_type(&name).ok_or_else(|| {
        format!(
            "{}: P99 takes images, PDFs, text, CSV, JSON, zip and office files",
            path.display()
        )
    })?;
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes.len() > ATTACHMENT_LIMIT {
        return Err(format!("{} is over 20 MB", path.display()));
    }
    Ok((name, kind, bytes))
}

fn hosts_list(config: &Config, global: &Global) -> Result<(), String> {
    struct Row {
        account: String,
        env: String,
        config: Value,
        local: bool,
        worker: Option<HostEntry>,
    }
    let mut rows: BTreeMap<String, Row> = BTreeMap::new();
    let mut unreachable: BTreeMap<String, String> = BTreeMap::new();
    for (host, entry) in &config.hosts {
        if global.account.as_ref().is_some_and(|a| *a != entry.account) {
            continue;
        }
        rows.insert(
            host.clone(),
            Row {
                account: entry.account.clone(),
                env: entry.env.clone(),
                config: entry.pushed(),
                local: true,
                worker: None,
            },
        );
    }
    let agent = global.agent;
    for account in config.accounts.keys() {
        if global.account.as_ref().is_some_and(|a| a != account) {
            continue;
        }
        if config.bases(account, None).is_err() {
            continue;
        }
        let seen = Client::for_account(config, account, agent).and_then(|c| c.hosts());
        match seen {
            Ok(list) => {
                for found in list {
                    match rows.get_mut(&found.host) {
                        Some(row) => row.worker = Some(found),
                        None => {
                            rows.insert(
                                found.host.clone(),
                                Row {
                                    account: account.clone(),
                                    env: found.env.clone(),
                                    config: found.config.clone(),
                                    local: false,
                                    worker: Some(found),
                                },
                            );
                        }
                    }
                }
            }
            Err(why) => {
                unreachable.insert(account.clone(), why);
            }
        }
    }
    let state = |row: &Row| match (&row.worker, unreachable.contains_key(&row.account)) {
        (Some(w), _) if row.local && w.env != row.env => "differs",
        (Some(_), _) if row.local => "ok",
        (Some(_), _) => "only on the Worker",
        (None, true) => "unreachable",
        (None, false) => "not on the Worker",
    };
    if global.json {
        let hosts: Vec<Value> = rows
            .iter()
            .map(|(host, row)| {
                json!({
                    "host": host,
                    "account": row.account,
                    "env": row.env,
                    "config": row.config,
                    "in_config": row.local,
                    "state": state(row),
                    "worker": row.worker,
                })
            })
            .collect();
        return print_json(&json!({"hosts": hosts, "unreachable": unreachable}));
    }
    if rows.is_empty() {
        println!("no hosts yet; p99 hosts add <host> --env <env>");
    } else {
        let width = rows.keys().map(String::len).max().unwrap_or(4).max(4);
        let account = rows
            .values()
            .map(|r| r.account.len())
            .max()
            .unwrap_or(7)
            .max(7);
        let env = rows.values().map(|r| r.env.len()).max().unwrap_or(3).max(3);
        println!(
            "{:<width$}  {:<account$}  {:<env$}  STATE",
            "HOST", "ACCOUNT", "ENV"
        );
        for (host, row) in &rows {
            out!(
                "{host:<width$}  {:<account$}  {:<env$}  {}",
                row.account,
                row.env,
                state(row)
            );
        }
    }
    for (account, why) in &unreachable {
        eprintln!("{account}: {why}");
    }
    Ok(())
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
}

fn hosts_add(config: &mut Config, global: &Global, args: &AddArgs) -> Result<(), String> {
    let host = args.host.trim().to_ascii_lowercase();
    if !valid_host(&host) {
        return Err(format!("{host} is not a host name; try example.com"));
    }
    let account = match &global.account {
        Some(name) => config.account(Some(name))?.0.to_owned(),
        None => config.account(None)?.0.to_owned(),
    };
    let kept = config.hosts.get(&host).cloned().unwrap_or_default();
    config.hosts.insert(
        host.clone(),
        Host {
            account: account.clone(),
            env: args.env.clone(),
            ..kept
        },
    );
    config.save()?;
    crate::setup::add_route(config, &account, &host)?;
    let client = Client::for_account(config, &account, global.agent)?.aimed(Some(&host));
    let entry = client.put_host(&host, &args.env, &config.hosts[&host].pushed())?;
    let known = client.envs()?;
    let current = known.iter().find(|e| e.name == args.env);
    if args.kind.is_some() || current.is_none() {
        let env = EnvEntry {
            name: args.env.clone(),
            kind: args
                .kind
                .clone()
                .or_else(|| current.map(|e| e.kind.clone()))
                .unwrap_or_else(|| "release".to_owned()),
            position: current.map_or(known.len() as i64, |e| e.position),
            notify: current.is_some_and(|e| e.notify),
        };
        client.put_env(&env)?;
    }
    if global.json {
        return print_json(&entry);
    }
    println!("added {host} to {account}, environment {}", args.env);
    Ok(())
}

fn hosts_remove(config: &mut Config, global: &Global, host: &str) -> Result<(), String> {
    let host = host.trim().to_ascii_lowercase();
    if !config.hosts.contains_key(&host) {
        return Err(format!("no host is called {host}; p99 hosts lists them"));
    }
    let (client, account) = client_for(config, global, Some(&host))?;
    client.remove_host(&host)?;
    config.hosts.remove(&host);
    config.save()?;
    if global.json {
        return print_json(&json!({"removed": host, "account": account}));
    }
    println!("removed {host} from {account}; its items stay, and so does its route in Cloudflare");
    Ok(())
}

fn pair(raw: &str) -> Result<(String, String), String> {
    let (key, value) = raw
        .split_once('=')
        .ok_or_else(|| format!("{raw} is not key=value"))?;
    let key = key.trim().trim_start_matches("--p99-").trim();
    if key.is_empty() {
        return Err(format!("{raw} has no key"));
    }
    Ok((key.to_owned(), value.trim().to_owned()))
}

fn merge(into: &mut BTreeMap<String, String>, pairs: &[String]) -> Result<(), String> {
    for raw in pairs {
        let (key, value) = pair(raw)?;
        if value.is_empty() {
            into.remove(&key);
        } else {
            into.insert(key, value);
        }
    }
    Ok(())
}

fn offset_of(raw: &str) -> Result<Offset, String> {
    let bad = || format!("{raw} is not X,Y in pixels; try 16,16");
    let (x, y) = raw.split_once(',').ok_or_else(bad)?;
    Ok(Offset {
        x: x.trim().parse().map_err(|_| bad())?,
        y: y.trim().parse().map_err(|_| bad())?,
    })
}

fn hosts_set(config: &mut Config, global: &Global, args: &SetArgs) -> Result<(), String> {
    let host = args.host.trim().to_ascii_lowercase();
    let entry = config
        .hosts
        .get_mut(&host)
        .ok_or_else(|| format!("no host is called {host}; p99 hosts lists them"))?;
    if let Some(corner) = &args.corner {
        entry.corner = Some(corner.clone());
    }
    if let Some(offset) = &args.offset {
        entry.offset = Some(offset_of(offset)?);
    }
    if let Some(above) = &args.above {
        entry.above = Some(above.clone()).filter(|a| !a.is_empty());
    }
    if !args.off.is_empty() {
        entry.off = args.off.iter().filter(|p| !p.is_empty()).cloned().collect();
    }
    merge(&mut entry.theme, &args.theme)?;
    merge(&mut entry.strings, &args.string)?;
    let (env, pushed) = (entry.env.clone(), entry.pushed());
    config.save()?;
    let (client, _) = client_for(config, global, Some(&host))?;
    let sent = client.put_host(&host, &env, &pushed)?;
    if global.json {
        return print_json(&sent);
    }
    println!("{host} updated and pushed");
    Ok(())
}

fn invite(config: &Config, global: &Global, args: &InviteArgs) -> Result<(), String> {
    let hosts: Vec<String> = args
        .hosts
        .iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect();
    let account = account_of(config, global, hosts.first().map(String::as_str))?;
    for host in &hosts {
        if let Some(entry) = config.hosts.get(host)
            && entry.account != account
        {
            return Err(format!(
                "{host} is in the account {}, not {account}; a code covers one account",
                entry.account
            ));
        }
    }
    let (client, _) = client_for(config, global, hosts.first().map(String::as_str))?;
    let minted = client.mint(&NewCode {
        client_uid: crate::client::uid(),
        name: args.name.clone(),
        email: args.email.clone(),
        hosts,
        manager: args.manager,
        totp: args.totp,
    })?;
    let Some(secret) = &minted.secret else {
        return Err("this invite was already minted; revoke it and invite again".into());
    };
    if global.json {
        return print_json(&minted);
    }
    let role = if args.manager { " (manager)" } else { "" };
    out!("{} <{}>{role}", minted.code.name, minted.code.email);
    out!("secret: {secret}");
    for link in &minted.links {
        out!("link:   {link}");
    }
    if let Some(key) = &minted.totp_key {
        print_totp(&minted.code, key);
    }
    println!("this is the only time the secret is shown");
    Ok(())
}

fn otpauth(email: &str, key: &str) -> String {
    format!(
        "otpauth://totp/P99:{}?secret={key}&issuer=P99",
        crate::client::encode(email)
    )
}

fn grouped(key: &str) -> String {
    key.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_totp(code: &Code, key: &str) {
    out!("totp:   {}", otpauth(&code.email, key));
    out!(
        "key:    {}   (for apps that only take a setup key)",
        grouped(key)
    );
    println!("send the totp line apart from the link; each browser asks for its 6-digit code once");
}

fn totp(config: &Config, global: &Global, id: i64) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let set = client.totp(id)?;
    if global.json {
        let mut value = serde_json::to_value(&set).map_err(|e| e.to_string())?;
        value["otpauth"] = json!(otpauth(&set.code.email, &set.totp_key));
        return print_json(&value);
    }
    out!(
        "code {} of {} <{}> now asks for an authenticator code",
        set.code.id,
        set.code.name,
        set.code.email
    );
    print_totp(&set.code, &set.totp_key);
    println!("this is the only time the key is shown");
    Ok(())
}

fn code_state(code: &Code) -> &'static str {
    if code.revoked_at.is_some() {
        "revoked"
    } else {
        "active"
    }
}

fn invites(config: &Config, global: &Global, args: &InvitesArgs) -> Result<(), String> {
    if let Some(InvitesAction::Totp { id }) = &args.action {
        return totp(config, global, *id);
    }
    let codes = match demo(global) {
        Some(d) => d
            .codes()
            .into_iter()
            .filter(|c| args.host.as_ref().is_none_or(|h| c.hosts.contains(h)))
            .collect(),
        None => client_for(config, global, args.host.as_deref())?
            .0
            .codes(args.host.as_deref())?,
    };
    if global.json {
        return print_json(&json!({"codes": codes}));
    }
    if codes.is_empty() {
        println!("no codes");
    }
    for code in &codes {
        let role = if code.manager { "manager" } else { "member" };
        let role = if code.totp {
            format!("{role}, totp")
        } else {
            role.to_owned()
        };
        out!(
            "{:>4}  {}  {} <{}>  {role}  ...{}  {}  hosts: {}  last used: {}",
            code.id,
            code_state(code),
            code.name,
            code.email,
            code.hint,
            when(&code.created_at),
            code.hosts.join(", "),
            code.last_used_at
                .as_deref()
                .map_or("never".to_owned(), when),
        );
    }
    Ok(())
}

fn revoke(config: &Config, global: &Global, args: &RevokeArgs) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let code = client.revoke(args.id)?;
    if global.json {
        return print_json(&code);
    }
    out!("revoked code {} of {} <{}>", code.id, code.name, code.email);
    Ok(())
}

fn rename(config: &Config, global: &Global, from: &str, to: &str) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let moved = client.rename(from, to)?;
    if global.json {
        return print_json(&moved);
    }
    let n = |k: &str| moved[k].as_i64().unwrap_or(0);
    out!(
        "moved {} to {}: {} items, {} assigned, {} comments, {} events, {} attachments, {} codes",
        moved["from"].as_str().unwrap_or(from),
        moved["to"].as_str().unwrap_or(to),
        n("items"),
        n("assigned"),
        n("comments"),
        n("events"),
        n("attachments"),
        n("codes")
    );
    println!("set the same e-mail in your config's [me] so new work lands there too");
    Ok(())
}

fn summary_line(item: &Summary) -> String {
    let mut line = format!(
        "{}{:<8} {:<11} {:<11} {}",
        if item.unread { "*" } else { " " },
        item.key,
        crate::wire::status_word(&item.status),
        item.host.as_deref().unwrap_or("-"),
        item.title
    );
    if let Some(assignee) = &item.assignee {
        line.push_str(&format!("  -> {assignee}"));
    }
    if item.comments > 0 {
        line.push_str(&format!("  [{} comments]", item.comments));
    }
    let landed: Vec<&str> = item.landing.envs.iter().map(|e| e.env.as_str()).collect();
    if !landed.is_empty() {
        line.push_str(&format!("  landed: {}", landed.join(", ")));
    } else if item.landing.branch {
        line.push_str("  fixed on a branch");
    }
    line
}

fn demo(global: &Global) -> Option<crate::tui::demo::Demo> {
    global.demo.then(crate::tui::demo::Demo::new)
}

fn demo_list(global: &Global, args: &ListArgs) -> Option<Vec<Summary>> {
    let wanted = |s: &Summary| {
        let status = match args.status.as_str() {
            "any" => true,
            "open" => crate::wire::open(&s.status),
            "closed" => !crate::wire::open(&s.status),
            one => s.status == one,
        };
        let text = args.query.as_deref().map(str::to_lowercase);
        status
            && args.kind.as_ref().is_none_or(|k| &s.kind == k)
            && args
                .host
                .as_ref()
                .is_none_or(|h| s.host.as_ref() == Some(h))
            && (!args.mine || s.reporter.email == crate::tui::demo::ME.1)
            && text.is_none_or(|t| s.title.to_lowercase().contains(&t))
    };
    let mut found: Vec<Summary> = demo(global)?
        .list()
        .into_iter()
        .map(|e| e.summary)
        .filter(wanted)
        .collect();
    found.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    found.truncate(args.limit);
    Some(found)
}

fn list(config: &Config, global: &Global, args: &ListArgs) -> Result<(), String> {
    if let Some(found) = demo_list(global, args) {
        return listed(found, false, global);
    }
    let accounts: Vec<String> = if args.all && global.account.is_none() {
        config.accounts.keys().cloned().collect()
    } else {
        vec![account_of(config, global, args.host.as_deref())?]
    };
    if accounts.is_empty() {
        return Err("no account yet; run p99 setup".into());
    }
    let host = if args.all || args.host.is_none() {
        Some("*".to_owned())
    } else {
        args.host.clone()
    };
    let scope = if args.mine { "mine" } else { "all" };
    let agent = global.agent;
    let mut found: Vec<Summary> = Vec::new();
    let mut more = false;
    for account in &accounts {
        let client = Client::for_account(config, account, agent)?;
        let mut cursor: Option<String> = None;
        let mut taken = 0;
        while taken < args.limit {
            let query = ListQuery {
                scope: scope.to_owned(),
                path: None,
                status: Some(args.status.clone()),
                kind: args.kind.clone(),
                q: args.query.clone(),
                cursor: cursor.clone(),
                host: host.clone(),
                limit: (args.limit - taken).min(100) as i64,
            };
            let page = client.list(&query)?;
            taken += page.issues.len();
            found.extend(page.issues);
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
            more = taken >= args.limit;
        }
        if cursor.is_none() {
            more = false;
        }
    }
    found.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    listed(found, more, global)
}

fn listed(found: Vec<Summary>, more: bool, global: &Global) -> Result<(), String> {
    if global.json {
        return print_json(&json!({"issues": found, "more": more}));
    }
    if found.is_empty() {
        println!("no items");
    }
    for item in &found {
        out!("{}", summary_line(item));
    }
    if more {
        eprintln!("more items follow; raise --limit");
    }
    Ok(())
}

fn print_thread(thread: &Thread) {
    let issue: &Issue = &thread.issue;
    out!(
        "{}  {}  {}",
        issue.key,
        crate::wire::kind_word(&issue.kind),
        crate::wire::status_word(&issue.status)
    );
    out!("{}", issue.title);
    let reporter = &issue.reporter;
    let text = |field: &str| reporter.get(field).and_then(Value::as_str).unwrap_or("");
    let agent = reporter
        .get("agent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    out!(
        "reported by {} on {}  {}{}",
        who(text("email"), text("name"), agent),
        issue.host.as_deref().unwrap_or("-"),
        when(&issue.created_at),
        if issue.env.is_empty() {
            String::new()
        } else {
            format!("  from {}", issue.env)
        }
    );
    if !issue.page.url.is_empty() {
        out!("page: {}", issue.page.url);
    }
    if let Some(assignee) = &issue.assignee {
        out!("assigned to {assignee}");
    }
    if let Some(of) = &issue.duplicate_of {
        out!("duplicate of {of}");
    }
    for reached in &issue.landing.envs {
        out!(
            "landed in {} ({}) {}  {}{}",
            reached.env,
            reached.kind,
            when(&reached.at),
            reached.sha.chars().take(8).collect::<String>(),
            reached
                .version
                .as_deref()
                .map_or(String::new(), |v| format!("  {v}"))
        );
    }
    if issue.landing.branch {
        println!("a fix sits on a branch no environment carries yet");
    }
    if !issue.body.is_empty() {
        out!("\n{}", issue.body);
    }
    if !issue.commits.is_empty() {
        println!("\ncommits");
        for commit in &issue.commits {
            out!(
                "  {} {} {}  [{}]",
                commit.sha.chars().take(8).collect::<String>(),
                commit.rel,
                commit.subject,
                commit.envs.join(", ")
            );
        }
    }
    if !thread.attachments.is_empty() {
        println!("\nattachments");
        for a in &thread.attachments {
            out!("  {}  {}  {}  {} bytes", a.id, a.role, a.name, a.bytes);
        }
    }
    for comment in &thread.comments {
        let author = &comment.author;
        out!(
            "\n{} {}{}",
            when(&comment.created_at),
            who(&author.email, &author.name, author.agent),
            if comment.internal { "  [internal]" } else { "" }
        );
        out!("{}", comment.body);
        for id in &comment.attachments {
            out!("  attachment {id}");
        }
    }
    if !thread.events.is_empty() {
        println!("\nevents");
        for e in &thread.events {
            let detail = match &e.detail {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            out!(
                "  {}  {}  {}  {}",
                when(&e.at),
                e.actor.as_deref().unwrap_or("-"),
                e.kind,
                detail
            );
        }
    }
}

fn show(config: &Config, global: &Global, args: &ShowArgs) -> Result<(), String> {
    let thread = match demo(global) {
        Some(mut d) => d.thread(&key_of(&args.key)?)?,
        None => client_for(config, global, args.host.as_deref())?
            .0
            .with_host(args.host.as_deref())
            .thread(&key_of(&args.key)?)?,
    };
    if global.json {
        return print_json(&thread);
    }
    print_thread(&thread);
    Ok(())
}

fn file(config: &Config, global: &Global, args: &FileArgs) -> Result<(), String> {
    let files = args
        .attach
        .iter()
        .map(|p| read_attachment(p))
        .collect::<Result<Vec<_>, _>>()?;
    let host = args.host.trim().to_ascii_lowercase();
    let (client, _) = client_for(config, global, Some(&host))?;
    let body = match &args.body {
        Some(text) => text_arg(text)?,
        None => String::new(),
    };
    let path = crate::wire::page_path(&args.page);
    let issue = NewIssue {
        client_uid: crate::client::uid(),
        host: Some(host.clone()),
        kind: args.kind.clone(),
        title: args.title.clone(),
        body,
        page: PageRef {
            url: format!("https://{host}{path}"),
            path,
            title: String::new(),
        },
        context: json!({"source": "cli"}),
        marks: Vec::new(),
    };
    let filed = client.file(&issue)?;
    let key = filed.id.to_string();
    let mut attached = Vec::new();
    for (name, kind, bytes) in &files {
        attached.push(client.attach(&key, name, kind, bytes, None)?);
    }
    if global.json {
        return print_json(&json!({"issue": filed, "attachments": attached}));
    }
    out!("{} filed on {host}: {}", filed.key, filed.title);
    for a in &attached {
        out!("attached {} as {}", a.name, a.id);
    }
    Ok(())
}

fn comment(config: &Config, global: &Global, args: &CommentArgs) -> Result<(), String> {
    let files = args
        .attach
        .iter()
        .map(|p| read_attachment(p))
        .collect::<Result<Vec<_>, _>>()?;
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let client = client.with_host(args.host.as_deref());
    let key = key_of(&args.key)?;
    let text = text_arg(&args.text)?;
    let made: Comment = client.comment(&key, &text, args.internal)?;
    let mut attached = Vec::new();
    for (name, kind, bytes) in &files {
        attached.push(client.attach(&key, name, kind, bytes, Some(made.id))?);
    }
    if global.json {
        return print_json(&json!({"comment": made, "attachments": attached}));
    }
    println!(
        "commented on {}{}",
        args.key,
        if args.internal { " (internal)" } else { "" }
    );
    Ok(())
}

fn status(config: &Config, global: &Global, args: &StatusArgs) -> Result<(), String> {
    if args.status == "duplicate" && args.duplicate_of.is_none() {
        return Err("a duplicate needs --duplicate-of KEY".into());
    }
    if args.status != "duplicate" && args.duplicate_of.is_some() {
        return Err("--duplicate-of goes with the status duplicate".into());
    }
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let change = Change {
        status: Some(args.status.clone()),
        duplicate_of: args.duplicate_of.clone(),
        ..Change::default()
    };
    let issue = client
        .with_host(args.host.as_deref())
        .change(&key_of(&args.key)?, &change)?;
    if global.json {
        return print_json(&issue);
    }
    out!(
        "{} is now {}",
        issue.key,
        crate::wire::status_word(&issue.status).to_lowercase()
    );
    Ok(())
}

fn assign(config: &Config, global: &Global, args: &AssignArgs) -> Result<(), String> {
    let (client, account) = client_for(config, global, args.host.as_deref())?;
    let assignee = match (&args.who, args.none) {
        (Some(who), false) if who == "me" => {
            let me = config.me_for(&account);
            if me.email.is_empty() {
                return Err(format!(
                    "neither [me] nor [accounts.{account}.me] has an email in the config"
                ));
            }
            Some(me.email)
        }
        (Some(who), false) => Some(who.clone()),
        _ => None,
    };
    let change = Change {
        assignee: Some(assignee),
        ..Change::default()
    };
    let issue = client
        .with_host(args.host.as_deref())
        .change(&key_of(&args.key)?, &change)?;
    if global.json {
        return print_json(&issue);
    }
    match &issue.assignee {
        Some(who) => out!("{} is assigned to {who}", issue.key),
        None => out!("{} is assigned to no one", issue.key),
    }
    Ok(())
}

fn download(config: &Config, global: &Global, args: &DownloadArgs) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let file = client.download(args.id)?;
    let target = match &args.out {
        Some(path) => path.clone(),
        None => {
            let name = Path::new(&file.name)
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|n| !n.is_empty() && *n != "." && *n != "..")
                .map_or_else(|| format!("file-{}", args.id), str::to_owned);
            PathBuf::from(name)
        }
    };
    std::fs::write(&target, &file.bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    if global.json {
        return print_json(&json!({
            "id": args.id,
            "name": file.name,
            "type": file.content_type,
            "bytes": file.bytes.len(),
            "path": target.display().to_string(),
        }));
    }
    out!("{} bytes saved to {}", file.bytes.len(), target.display());
    Ok(())
}

fn git(args: &[&str]) -> Result<String, String> {
    let out = Process::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "git {}: {}",
            args.first().unwrap_or(&""),
            why.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn announce(config: &Config, global: &Global, args: &AnnounceArgs) -> Result<(), String> {
    let (client, account) = client_for(config, global, args.host.as_deref())?;
    let env = match (&args.env, &args.host) {
        (Some(env), _) => env.clone(),
        (None, Some(host)) => config
            .hosts
            .get(host)
            .map(|h| h.env.clone())
            .ok_or_else(|| format!("no host is called {host}; p99 hosts lists them"))?,
        (None, None) => {
            let hosts = config.hosts_of(&account);
            match hosts.as_slice() {
                [only] => config.hosts[*only].env.clone(),
                _ => return Err("name a host or an environment with --env".into()),
            }
        }
    };
    let format = format!("--format={}", trailers::FORMAT);
    let log = match &args.rev {
        Some(range) => git(&["log", &format, range])?,
        None => git(&["log", "-n", "500", &format])?,
    };
    let items: Vec<BuildItem> = trailers::parse_log(&log)
        .into_iter()
        .map(|i| BuildItem {
            id: i.id,
            rel: i.rel.to_owned(),
            sha: i.sha,
            subject: i.subject,
        })
        .collect();
    let sha = git(&["rev-parse", "HEAD"])?.trim().to_owned();
    let branch = match &args.branch {
        Some(branch) => branch.clone(),
        None => git(&["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_owned(),
    };
    let version = match &args.version {
        Some(version) => version.clone(),
        None => git(&["describe", "--tags", "--always"])?.trim().to_owned(),
    };
    let dirty = !git(&["status", "--porcelain"])?.trim().is_empty();
    let fixes = items.iter().filter(|i| i.rel == "fixes").count();
    let build = Build {
        sha: sha.clone(),
        branch: branch.clone(),
        version: version.clone(),
        dirty,
        env: Some(env.clone()),
        items,
    };
    client.announce(&build)?;
    if global.json {
        return print_json(&Announced {
            sha,
            branch,
            version,
            dirty,
            items: build.items.len(),
            sent: true,
        });
    }
    println!(
        "announced {} {branch} {version}{} to {env}: {} items ({fixes} fixes)",
        sha.chars().take(8).collect::<String>(),
        if dirty { " (dirty)" } else { "" },
        build.items.len(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::key_of;

    #[test]
    fn keys_take_any_prefix_or_a_bare_number() {
        for raw in ["BUG-12", "bug-12", "12", " feat-12 "] {
            assert_eq!(key_of(raw).unwrap(), "12", "{raw}");
        }
        for raw in ["", "BUG-", "BUG-x", "12abc", "-3", "../x"] {
            assert!(key_of(raw).is_err(), "{raw}");
        }
    }
}

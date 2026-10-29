mod card;
pub(crate) mod codes;
mod delete;
mod merge;
mod waiting;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command as Process;

use serde::Serialize;
use serde_json::{Value, json};

use crate::client::Client;
use crate::config::{CORNERS, Config, Host, Offset, WHOLE};
use crate::stream::Heard;
use crate::trailers;
use crate::wire::{
    ATTACHMENT_LIMIT, Announced, Build, BuildItem, Change, Code, Comment, EnvEntry, Grant,
    HostEntry, Issue, KINDS, ListQuery, NewCode, NewIssue, PageRef, Summary, Thread, content_type,
    out,
};

#[derive(Debug, Default, clap::Args)]
pub struct Global {
    #[arg(long, global = true, help = "answer in JSON, for agents and scripts")]
    pub json: bool,
    #[arg(
        long = "space",
        alias = "account",
        global = true,
        value_name = "slug",
        num_args = 0..=1,
        default_missing_value = WHOLE,
        help = "the space to use, when the config has several; p99 invite and p99 invites set read it alone as the whole space"
    )]
    pub account: Option<String>,
    #[arg(
        long,
        global = true,
        value_name = "label",
        num_args = 0..=1,
        require_equals = true,
        help = "act as an agent of the configured person, shown as their name with 🤖; --agent=<label> says which (or P99_AGENT=<label>)"
    )]
    pub agent: Option<Option<String>>,
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
    #[command(about = "list the spaces the config holds: slug, name, Worker and projects")]
    Spaces,
    #[command(about = "list the hosts P99 serves; add, remove or set one")]
    Hosts(HostsArgs),
    #[command(about = "mint a personal code for a person on a whole space or some of its projects")]
    Invite(InviteArgs),
    #[command(
        about = "list the personal codes with what each grants; change a grant, add an authenticator or delete a revoked one",
        visible_alias = "codes"
    )]
    Invites(InvitesArgs),
    #[command(about = "revoke a personal code")]
    Revoke(RevokeArgs),
    #[command(
        about = "give a person a new code in place of their current one, which stops working; mails the new link"
    )]
    Relink(crate::links::RelinkArgs),
    #[command(about = "open your own P99 link in the browser, from the code your config keeps")]
    Link(crate::links::LinkArgs),
    #[command(
        about = "move a person's items, comments, events and codes to another e-mail",
        subcommand_required = true,
        arg_required_else_help = false
    )]
    People(PeopleArgs),
    #[command(about = "list items")]
    List(ListArgs),
    #[command(about = "show an item with its comments, events and landings")]
    Show(ShowArgs),
    #[command(about = "file an item on a host")]
    File(FileArgs),
    #[command(about = "comment on an item")]
    Comment(CommentArgs),
    #[command(about = "set an item's label, or close it as abandoned or duplicate")]
    Status(StatusArgs),
    #[command(about = "move an item to a lane of the one board, or beside another card in it")]
    Move(crate::boards::MoveArgs),
    #[command(about = "list cards in lane order, or the ones waiting on you")]
    Cards(card::CardsArgs),
    #[command(
        about = "show, file, comment on, move or link one card",
        subcommand_required = true,
        arg_required_else_help = false
    )]
    Card(card::CardArgs),
    #[command(
        about = "list the space's projects with their hosts and counts; add or rename one",
        subcommand_required = false,
        arg_required_else_help = false
    )]
    Projects(ProjectsArgs),
    #[command(about = "deprecated: prints the one board, as p99 board does")]
    Boards(crate::boards::BoardsArgs),
    #[command(about = "print the one board: its seven lanes and their cards")]
    Board(crate::boards::BoardArgs),
    #[command(about = "assign an item to someone, or to no one")]
    Assign(AssignArgs),
    #[command(
        about = "change an item's title or details; the history keeps the old and new text, and no one is mailed"
    )]
    Edit(EditArgs),
    #[command(about = "download an attachment")]
    Download(DownloadArgs),
    #[command(about = "tell P99 which items this checkout's commits fixed or referred to")]
    Announce(AnnounceArgs),
    #[command(about = "bring items over from another tracker, keeping their keys and numbers")]
    Import(crate::import::ImportArgs),
    #[command(
        about = "print each new item, comment, change and attachment as it happens, until stopped"
    )]
    Watch(WatchArgs),
    #[command(
        about = "post a site's new items, comments, status changes and shipped fixes to Slack or Discord"
    )]
    Hooks(crate::hooks::HooksArgs),
    #[command(
        about = "link a host to a GitHub repository, and open GitHub issues for items",
        subcommand_required = true,
        arg_required_else_help = false
    )]
    Github(crate::github::GithubArgs),
    #[command(about = "list the lanes, the one board's columns; rename one")]
    Labels(crate::boards::LabelsArgs),
    #[command(
        about = "fold duplicates into one item; their reporters follow it and get its updates"
    )]
    Merge(merge::MergeArgs),
    #[command(about = "list each host's feed of fixed items; turn one on or off")]
    Feed(merge::FeedArgs),
    #[command(
        about = "delete an item for good, with its comments, notes, events and files; asks for the key typed back"
    )]
    Delete(delete::DeleteArgs),
}

#[derive(Debug, clap::Args)]
pub struct WatchArgs {
    #[arg(long, help = "only this host's items")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct PeopleArgs {
    #[command(subcommand)]
    pub action: PeopleAction,
}

#[derive(Debug, clap::Subcommand)]
pub enum PeopleAction {
    #[command(
        about = "move everything filed, said or held under one e-mail to another, on the whole space"
    )]
    Rename {
        #[arg(help = "the e-mail the items are under now")]
        from: String,
        #[arg(help = "the e-mail they move to")]
        to: String,
    },
}

#[derive(Debug, clap::Args)]
pub struct ProjectsArgs {
    #[command(subcommand)]
    pub action: Option<ProjectsAction>,
}

#[derive(Debug, clap::Subcommand)]
pub enum ProjectsAction {
    #[command(about = "create a project in the space")]
    Add {
        #[arg(help = "the project's name, 1 to 40 characters, unique in the space without case")]
        name: String,
    },
    #[command(about = "rename a project; its cards and hosts stay with it")]
    Rename {
        #[arg(help = "the project's name now")]
        old: String,
        #[arg(help = "its new name")]
        new: String,
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
    #[arg(
        long,
        value_name = "name",
        help = "the project the host belongs to; reports filed on the host land in it"
    )]
    pub project: String,
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
    #[arg(
        long,
        value_name = "name",
        help = "move the host to this project; its items move with it"
    )]
    pub project: Option<String>,
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
    #[arg(
        long,
        value_parser = ["off", "on"],
        help = "hide (off) or show (on) the panel's 'by PITO.MD' link; off takes an Agency or Owner key"
    )]
    pub pitomd_link: Option<String>,
    #[arg(
        long,
        value_name = "selector",
        help = "a CSS selector the panel masks in every capture, besides data-p99-redact; repeat it, they replace the list, and --mask none clears it"
    )]
    pub mask: Vec<String>,
    #[arg(
        long,
        value_parser = ["on", "off"],
        help = "off: the panel files the text report with no screenshot and says so; on is the default"
    )]
    pub capture: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct InviteArgs {
    #[arg(
        hide = true,
        value_name = "host",
        help = "the old way: hosts, which become their projects"
    )]
    pub hosts: Vec<String>,
    #[arg(
        long,
        value_name = "name",
        help = "grant this project; repeat it for several (--space alone grants the whole space)"
    )]
    pub project: Vec<String>,
    #[arg(long, help = "the person's name, as P99 shows it")]
    pub name: String,
    #[arg(long, help = "the person's e-mail, which ties their items to them")]
    pub email: String,
    #[arg(
        long,
        alias = "manager",
        help = "make the person an Owner, who sees and changes every item"
    )]
    pub owner: bool,
    #[arg(
        long,
        help = "also ask for a 6-digit code from an authenticator app the first time each browser uses the link"
    )]
    pub totp: bool,
    #[arg(long, help = "print the link here instead of mailing it")]
    pub no_mail: bool,
    #[arg(
        long,
        conflicts_with = "no_mail",
        help = "when you invite yourself, also mail you the link; it is printed here either way"
    )]
    pub mail_me: bool,
}

#[derive(Debug, clap::Args)]
pub struct GrantArgs {
    #[arg(help = "the code's id, from p99 invites")]
    pub id: i64,
    #[arg(
        long,
        value_name = "name",
        conflicts_with = "park",
        help = "grant exactly these projects; repeat it for several (--space alone grants the whole space)"
    )]
    pub project: Vec<String>,
    #[arg(
        long,
        help = "grant nothing: the code opens nothing and is not revoked"
    )]
    pub park: bool,
}

#[derive(Debug, clap::Args)]
pub struct InvitesArgs {
    #[arg(long, help = "only the codes that reach this host")]
    pub host: Option<String>,
    #[arg(long, value_enum, help = "only the codes of this role")]
    pub role: Option<crate::one_board::Role>,
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
    #[command(
        about = "delete a revoked code for good, with its devices; asks for its last four characters typed back"
    )]
    Delete(codes::CodeDeleteArgs),
    #[command(
        about = "change what a code grants: --space for the whole space, --project for some, --park for nothing; no one is mailed"
    )]
    Set(GrantArgs),
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
    #[arg(
        long,
        value_name = "name",
        help = "only this project's items; repeat it for several"
    )]
    pub project: Vec<String>,
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
    #[arg(long, value_name = "name", help = "only items with this label")]
    pub label: Option<String>,
    #[arg(
        long,
        default_value_t = 50,
        value_parser = clap::value_parser!(u64).range(1..),
        help = "at most this many items in all"
    )]
    pub limit: u64,
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
    #[arg(long, help = "for Owners only")]
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
    #[arg(help = "a label on your boards, such as Doing or Done, or abandoned or duplicate")]
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
    #[arg(
        help = "a username such as @ada.lovelace, or me",
        required_unless_present = "none"
    )]
    pub who: Option<String>,
    #[arg(long, conflicts_with = "who", help = "leave it unassigned")]
    pub none: bool,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
#[command(group(clap::ArgGroup::new("change").required(true).multiple(true).args(["title", "text", "text_file", "project", "no_project"])))]
pub struct EditArgs {
    #[arg(help = "the item's key, such as BUG-12, or its number")]
    pub key: String,
    #[arg(long, help = "the new title")]
    pub title: Option<String>,
    #[arg(long, help = "the new details, or - to read them from standard input")]
    pub text: Option<String>,
    #[arg(
        long,
        value_name = "path",
        conflicts_with = "text",
        help = "read the new details from a file, or - for standard input"
    )]
    pub text_file: Option<PathBuf>,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
    #[arg(
        long,
        value_name = "name",
        conflicts_with_all = ["title", "text", "text_file", "no_project"],
        help = "make the item a card of this project, in lane new"
    )]
    pub project: Option<String>,
    #[arg(
        long,
        conflicts_with_all = ["title", "text", "text_file"],
        help = "make a card a plain item again, back in Inbox"
    )]
    pub no_project: bool,
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

pub fn notices() {
    let old = std::env::args_os()
        .skip(1)
        .take_while(|a| a != "--")
        .any(|a| {
            let a = a.to_string_lossy();
            a == "--account" || a.starts_with("--account=")
        });
    if old {
        crate::config::said_once(crate::config::FLAG_RENAMED);
    }
}

pub fn run(command: Command, global: &Global) -> Result<(), String> {
    let mut config = Config::load()?;
    match command {
        Command::Spaces => spaces(&config, global),
        Command::Hosts(args) => match args.action {
            None => hosts_list(&config, global),
            Some(HostsAction::Add(a)) => hosts_add(&mut config, global, &a),
            Some(HostsAction::Remove { host }) => hosts_remove(&mut config, global, &host),
            Some(HostsAction::Set(a)) => hosts_set(&mut config, global, &a),
        },
        Command::Invite(a) => invite(&config, global, &a),
        Command::Invites(a) => invites(&config, global, &a),
        Command::Revoke(a) => revoke(&config, global, &a),
        Command::Relink(a) => crate::links::relink(&config, global, &a),
        Command::Link(a) => crate::links::link(&config, global, &a),
        Command::People(PeopleArgs {
            action: PeopleAction::Rename { from, to },
        }) => rename(&config, global, &from, &to),
        Command::List(a) => list(&config, global, &a),
        Command::Show(a) => show(&config, global, &a),
        Command::File(a) => file(&config, global, &a),
        Command::Comment(a) => comment(&config, global, &a),
        Command::Status(a) => status(&config, global, &a),
        Command::Move(a) => crate::boards::run_move(&config, global, &a),
        Command::Boards(a) => crate::boards::run_boards(&config, global, &a),
        Command::Board(a) => crate::boards::run_board(&config, global, &a),
        Command::Cards(a) => card::cards(&config, global, &a),
        Command::Card(a) => card::card(&config, global, &a),
        Command::Projects(a) => card::projects(&mut config, global, &a),
        Command::Assign(a) => assign(&config, global, &a),
        Command::Edit(a) => edit(&config, global, &a),
        Command::Download(a) => download(&config, global, &a),
        Command::Announce(a) => announce(&config, global, &a),
        Command::Import(a) => import(&config, global, &a),
        Command::Watch(a) => watch(&config, global, &a),
        Command::Hooks(a) => crate::hooks::run(&config, global, &a),
        Command::Github(a) => crate::github::run(&config, global, &a),
        Command::Labels(a) => crate::boards::run_labels(&config, global, &a),
        Command::Merge(a) => merge::merge(&config, global, &a),
        Command::Feed(a) => merge::feed(&mut config, global, &a),
        Command::Delete(a) => delete::delete(&config, global, &a),
    }
}

fn watch(config: &Config, global: &Global, args: &WatchArgs) -> Result<(), String> {
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let account = account_of(config, global, host.as_deref())?;
    if !crate::config::key_overridden(config, &account)
        && let Some(source) = config
            .accounts
            .get(&account)
            .and_then(|a| a.key.slow_source())
    {
        eprintln!("{}: reading the space key from {source}", crate::NAME);
    }
    let (client, _) = client_for(config, global, host.as_deref())?;
    let json = global.json;
    let scope = host.clone().unwrap_or_else(|| "every host".to_owned());
    crate::stream::follow(&client, host.as_deref(), |heard| {
        match heard {
            Heard::Open { again } => eprintln!(
                "{}: watching {scope}, {}",
                crate::NAME,
                if again { "reconnected" } else { "connected" }
            ),
            Heard::Event(text) if json => out!("{text}"),
            Heard::Event(text) => {
                if let Some(line) = event_line(text) {
                    out!("{line}");
                }
            }
            Heard::Dropped(why, wait) => eprintln!(
                "{}: the stream dropped ({}); reconnecting in {} s",
                crate::NAME,
                crate::wire::clean(why),
                wait.as_secs()
            ),
        }
        true
    })
}

fn event_line(text: &str) -> Option<String> {
    let event: Value = serde_json::from_str(text).ok()?;
    let field = |name: &str| event[name].as_str().unwrap_or("-").to_owned();
    let by = &event["by"];
    let name = who_via(
        "",
        by["name"].as_str().unwrap_or("P99"),
        by["agent"].as_bool().unwrap_or(false),
        by["via"].as_str(),
    );
    let step = || {
        format!(
            "{} -> {}",
            crate::wire::status_word(&field("from")),
            crate::wire::status_word(&field("to"))
        )
    };
    let board = format!("board:{}", field("board"));
    let (key, said) = match event["type"].as_str() {
        Some("import") => (
            field("key"),
            format!(
                "{} items, {} comments",
                event["items"].as_u64().unwrap_or(0),
                event["comments"].as_u64().unwrap_or(0)
            ),
        ),
        Some("move") => (
            field("key"),
            format!("{}  {} on {}", field("title"), step(), field("board")),
        ),
        Some("board.move") => (board, step()),
        Some("board") => (board, field("action")),
        Some("statuses") => ("-".to_owned(), "renamed a status".to_owned()),
        _ => (field("key"), field("title")),
    };
    Some(format!(
        "{key}  {}  {}  {name}: {said}",
        field("type"),
        field("host")
    ))
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

pub(crate) fn account_of(
    config: &Config,
    global: &Global,
    host: Option<&str>,
) -> Result<String, String> {
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

pub(crate) fn client_for(
    config: &Config,
    global: &Global,
    host: Option<&str>,
) -> Result<(Client, String), String> {
    let account = account_of(config, global, host)?;
    let client = Client::for_account(config, &account, &global.agent)?.aimed(host);
    Ok((client, account))
}

pub(crate) fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    println!("{text}");
    Ok(())
}

pub(crate) fn key_of(raw: &str) -> Result<String, String> {
    crate::wire::item_number(raw)
        .map(|n| n.to_string())
        .ok_or_else(|| format!("{raw} is not an item key; try BUG-12 or 12"))
}

pub(crate) fn when(stamp: &str) -> String {
    stamp.replace('T', " ").chars().take(16).collect()
}

fn who(email: &str, name: &str, agent: bool) -> String {
    let base = if name.is_empty() { email } else { name };
    if agent {
        format!("{base} {}", crate::card::ROBOT)
    } else {
        base.to_owned()
    }
}

fn who_via(email: &str, name: &str, agent: bool, via: Option<&str>) -> String {
    let base = who(email, name, agent);
    match via
        .map(str::trim)
        .filter(|label| agent && !label.is_empty())
    {
        Some(label) => format!("{base} ({label})"),
        None => base,
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

fn named(global: &Global) -> Option<&str> {
    global.account.as_deref().filter(|name| *name != WHOLE)
}

fn without_whole(global: &Global) -> Global {
    Global {
        json: global.json,
        account: named(global).map(str::to_owned),
        agent: global.agent.clone(),
        demo: global.demo,
    }
}

fn spaces(config: &Config, global: &Global) -> Result<(), String> {
    let rows: Vec<(&String, &crate::config::Account)> = config
        .accounts
        .iter()
        .filter(|(slug, _)| named(global).is_none_or(|n| n == slug.as_str()))
        .collect();
    if let Some(wanted) = named(global)
        && rows.is_empty()
    {
        return Err(format!(
            "no space is called {wanted}; p99 spaces lists them"
        ));
    }
    let url = |slug: &str| {
        config
            .bases(slug, None)
            .ok()
            .and_then(|bases| bases.into_iter().next())
    };
    if global.json {
        let spaces: Vec<Value> = rows
            .iter()
            .map(|(slug, space)| {
                let projects: Vec<Value> = space
                    .projects
                    .iter()
                    .map(|(name, hosts)| json!({"name": name, "hosts": hosts}))
                    .collect();
                json!({
                    "slug": slug,
                    "name": space.title(slug),
                    "url": url(slug),
                    "default": config.default_account.as_deref() == Some(slug.as_str()),
                    "projects": projects,
                })
            })
            .collect();
        return print_json(&json!({"spaces": spaces}));
    }
    if rows.is_empty() {
        println!("no spaces yet; run p99 setup");
        return Ok(());
    }
    let width = |f: &dyn Fn(&(&String, &crate::config::Account)) -> usize, least: usize| {
        rows.iter().map(f).max().unwrap_or(least).max(least)
    };
    let slugs = width(&|r| r.0.chars().count(), 5);
    let names = width(&|r| r.1.title(r.0).chars().count(), 4);
    let urls = width(&|r| url(r.0).map_or(1, |u| u.chars().count()), 6);
    println!(
        "{:<slugs$}  {:<names$}  {:<urls$}  PROJECTS",
        "SPACE", "NAME", "WORKER"
    );
    for (slug, space) in &rows {
        let projects: Vec<&str> = space.projects.keys().map(String::as_str).collect();
        out!(
            "{slug:<slugs$}  {:<names$}  {:<urls$}  {}",
            space.title(slug),
            url(slug).unwrap_or_else(|| "-".to_owned()),
            if projects.is_empty() {
                "-".to_owned()
            } else {
                projects.join(", ")
            }
        );
    }
    Ok(())
}

fn hosts_list(config: &Config, global: &Global) -> Result<(), String> {
    struct Row {
        space: String,
        project: Option<String>,
        env: String,
        config: Value,
        local: bool,
        worker: Option<HostEntry>,
    }
    let wanted = named(global);
    let mut rows: BTreeMap<String, Row> = BTreeMap::new();
    let mut unreachable: BTreeMap<String, String> = BTreeMap::new();
    for (host, entry) in &config.hosts {
        if wanted.is_some_and(|a| a != entry.account) {
            continue;
        }
        rows.insert(
            host.clone(),
            Row {
                space: entry.account.clone(),
                project: config
                    .accounts
                    .get(&entry.account)
                    .and_then(|a| a.project_of(host))
                    .map(str::to_owned),
                env: entry.env.clone(),
                config: entry.pushed(),
                local: true,
                worker: None,
            },
        );
    }
    let agent = &global.agent;
    let holder = crate::config::key_holder(config)?;
    for space in config.accounts.keys() {
        if wanted.is_some_and(|a| a != space) {
            continue;
        }
        if config.bases(space, None).is_err() {
            continue;
        }
        let seen = Client::among(config, space, holder.as_deref(), agent).and_then(|c| c.hosts());
        match seen {
            Ok(list) => {
                for found in list {
                    match rows.get_mut(&found.host) {
                        Some(row) => {
                            if found.project.is_some() {
                                row.project = found.project.clone();
                            }
                            row.worker = Some(found);
                        }
                        None => {
                            rows.insert(
                                found.host.clone(),
                                Row {
                                    space: space.clone(),
                                    project: found.project.clone(),
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
                unreachable.insert(space.clone(), why);
            }
        }
    }
    let state = |row: &Row| match (&row.worker, unreachable.contains_key(&row.space)) {
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
                    "space": row.space,
                    "project": row.project,
                    "env": row.env,
                    "config": row.config,
                    "masks": row.config["mask"].as_array().map_or(0, Vec::len),
                    "capture": if row.config["capture"] == "off" { "off" } else { "on" },
                    "in_config": row.local,
                    "state": state(row),
                    "worker": row.worker,
                })
            })
            .collect();
        return print_json(&json!({"hosts": hosts, "unreachable": unreachable}));
    }
    if rows.is_empty() {
        println!("no hosts yet; p99 hosts add <host> --project <name> --env <env>");
    } else {
        let project = |r: &Row| r.project.clone().unwrap_or_else(|| "-".to_owned());
        let masks = |r: &Row| r.config["mask"].as_array().map_or(0, Vec::len);
        let capture = |r: &Row| {
            if r.config["capture"] == "off" {
                "off"
            } else {
                "on"
            }
        };
        let width = rows.keys().map(String::len).max().unwrap_or(4).max(4);
        let space = rows
            .values()
            .map(|r| r.space.len())
            .max()
            .unwrap_or(5)
            .max(5);
        let projects = rows
            .values()
            .map(|r| project(r).chars().count())
            .max()
            .unwrap_or(7)
            .max(7);
        let env = rows.values().map(|r| r.env.len()).max().unwrap_or(3).max(3);
        println!(
            "{:<width$}  {:<space$}  {:<projects$}  {:<env$}  MASKS  CAPTURE  STATE",
            "HOST", "SPACE", "PROJECT", "ENV"
        );
        for (host, row) in &rows {
            out!(
                "{host:<width$}  {:<space$}  {:<projects$}  {:<env$}  {:>5}  {:<7}  {}",
                row.space,
                project(row),
                row.env,
                masks(row),
                capture(row),
                state(row)
            );
        }
    }
    for (space, why) in &unreachable {
        eprintln!("{space}: {why}");
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
    let asked = crate::card::project(&args.project)?;
    let account = config.account(named(global))?.0.to_owned();
    let fresh = !config.has_base(&account);
    if fresh {
        crate::setup::add_route(config, &account, &host)?;
    }
    let view = Client::through(config, &account, &global.agent, &host)?
        .space()
        .map_err(crate::card::refusal)?;
    let project = view
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&asked))
        .map(|p| p.name.clone())
        .ok_or_else(|| missing_project(&asked, &account))?;
    let kept = config.hosts.get(&host).cloned().unwrap_or_default();
    let held = Host {
        account: account.clone(),
        env: args.env.clone(),
        ..kept
    };
    if !fresh {
        crate::setup::add_route(config, &account, &host)?;
    }
    let client = Client::through(config, &account, &global.agent, &host)?;
    let entry = client.put_host(&host, &args.env, &held.pushed(), Some(&project))?;
    config.hosts.insert(host.clone(), held);
    if let Some(space) = config.accounts.get_mut(&account) {
        space.place(&host, &project);
    }
    config.save()?;
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
        let mut value = serde_json::to_value(&entry).map_err(|e| e.to_string())?;
        value["space"] = json!(account);
        return print_json(&value);
    }
    println!(
        "added {host} to {account}, project {project}, environment {}",
        args.env
    );
    Ok(())
}

fn missing_project(project: &str, space: &str) -> String {
    format!(
        "no project is called {project} in the space {space}; p99 projects add \"{project}\" makes it"
    )
}

fn hosts_remove(config: &mut Config, global: &Global, host: &str) -> Result<(), String> {
    let host = host.trim().to_ascii_lowercase();
    if !config.hosts.contains_key(&host) {
        return Err(format!("no host is called {host}; p99 hosts lists them"));
    }
    let (client, account) = client_for(config, global, Some(&host))?;
    client.remove_host(&host)?;
    config.hosts.remove(&host);
    if let Some(space) = config.accounts.get_mut(&account) {
        space.unplace(&host);
    }
    config.save()?;
    if global.json {
        return print_json(&json!({"removed": host, "space": account}));
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

pub const MASKS_MOST: usize = 50;
pub const MASK_LONGEST: usize = 200;

fn masks_of(raw: &[String]) -> Result<Vec<String>, String> {
    let given: Vec<String> = raw.iter().map(|m| m.trim().to_owned()).collect();
    if given.iter().any(|m| m.eq_ignore_ascii_case("none")) {
        return if given.len() == 1 {
            Ok(Vec::new())
        } else {
            Err("--mask none clears the list and goes alone".to_owned())
        };
    }
    if given.iter().any(String::is_empty) {
        return Err("a --mask selector is empty; --mask none clears the list".to_owned());
    }
    if let Some(long) = given.iter().find(|m| m.chars().count() > MASK_LONGEST) {
        return Err(format!(
            "a mask selector has at most {MASK_LONGEST} characters; {} has {}",
            long.chars().take(24).collect::<String>() + "...",
            long.chars().count()
        ));
    }
    let mut kept: Vec<String> = Vec::new();
    for mask in given {
        if !kept.contains(&mask) {
            kept.push(mask);
        }
    }
    if kept.len() > MASKS_MOST {
        return Err(format!("a host takes at most {MASKS_MOST} mask selectors"));
    }
    Ok(kept)
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
    if !args.mask.is_empty() {
        entry.mask = masks_of(&args.mask)?;
    }
    if let Some(capture) = &args.capture {
        entry.capture = Some(capture.clone()).filter(|c| c == "off");
    }
    if let Some(wanted) = &args.pitomd_link {
        entry.link = pitomd_link(crate::license::State::of(config.license.as_deref()), wanted)?;
    }
    let (env, pushed, space) = (entry.env.clone(), entry.pushed(), entry.account.clone());
    let mut project = args
        .project
        .as_deref()
        .map(crate::card::project)
        .transpose()?;
    let (client, _) = client_for(config, global, Some(&host))?;
    if let Some(wanted) = &project {
        let view = client.space().map_err(crate::card::refusal)?;
        match view
            .projects
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(wanted))
        {
            Some(found) => project = Some(found.name.clone()),
            None => return Err(missing_project(wanted, &space)),
        }
    }
    let mut sent = client.put_host(&host, &env, &pushed, None)?;
    config.save()?;
    if let Some(name) = &project {
        sent = client
            .move_host(&host, name)
            .map_err(crate::card::refusal)?;
        if let Some(entry) = config.accounts.get_mut(&space) {
            entry.place(&host, name);
        }
        config.save()?;
    }
    if global.json {
        return print_json(&sent);
    }
    println!("{host} updated and pushed");
    if let Some(name) = &project {
        println!("{host} is in the project {name} now; its items moved with it");
    }
    if args.pitomd_link.as_deref() == Some("off") {
        println!("the 'by PITO.MD' link hides once the Worker carries this key: p99 deploy");
    }
    Ok(())
}

fn pitomd_link(state: crate::license::State, wanted: &str) -> Result<Option<bool>, String> {
    match wanted {
        "off" if state.may_hide_link() => Ok(Some(false)),
        "off" => Err("Only an Agency or Owner key hides the 'by PITO.MD' link".to_owned()),
        _ => Ok(None),
    }
}

fn account_for(
    config: &Config,
    scoped: &Global,
    host: Option<&str>,
    projects: &[String],
) -> Result<String, String> {
    match account_of(config, scoped, host) {
        Ok(account) => Ok(account),
        Err(why) => {
            let hits: Vec<&String> = config
                .accounts
                .iter()
                .filter(|(_, space)| {
                    !projects.is_empty()
                        && projects.iter().all(|p| space.project_named(p).is_some())
                })
                .map(|(slug, _)| slug)
                .collect();
            match hits.as_slice() {
                [one] => Ok((*one).clone()),
                _ => Err(why),
            }
        }
    }
}

fn mapped(
    config: &Config,
    client: &Client,
    account: &str,
    hosts: &[String],
) -> Result<Vec<String>, String> {
    let view = client.space().map_err(crate::card::refusal)?;
    let mut projects: Vec<String> = Vec::new();
    for host in hosts {
        let found = view
            .projects
            .iter()
            .find(|p| p.hosts.iter().any(|h| h == host))
            .map(|p| p.name.clone())
            .or_else(|| {
                config
                    .accounts
                    .get(account)
                    .and_then(|space| space.project_of(host))
                    .map(str::to_owned)
            })
            .ok_or_else(|| {
                format!("{host} is in no project; p99 hosts set {host} --project <name>")
            })?;
        if !projects.contains(&found) {
            projects.push(found);
        }
    }
    Ok(projects)
}

fn invite(config: &Config, global: &Global, args: &InviteArgs) -> Result<(), String> {
    let hosts: Vec<String> = args
        .hosts
        .iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect();
    let projects = args
        .project
        .iter()
        .map(|p| crate::card::project(p))
        .collect::<Result<Vec<_>, _>>()?;
    if !hosts.is_empty() && (!projects.is_empty() || global.account.as_deref() == Some(WHOLE)) {
        return Err(
            "a host list is the old way and cannot go with --project or a bare --space; name projects, or --space alone"
                .into(),
        );
    }
    if hosts.is_empty() && projects.is_empty() && global.account.is_none() {
        return Err(
            "say what the code grants: --space for the whole space, or --project <name> (repeat it)"
                .into(),
        );
    }
    let scoped = without_whole(global);
    let first = hosts.first().map(String::as_str);
    let account = account_for(config, &scoped, first, &projects)?;
    for host in &hosts {
        if let Some(entry) = config.hosts.get(host)
            && entry.account != account
        {
            return Err(format!(
                "{host} is in the space {}, not {account}; a code covers one space",
                entry.account
            ));
        }
    }
    let client = Client::for_account(config, &account, &global.agent)?.aimed(first);
    let grant = if !hosts.is_empty() {
        let projects = mapped(config, &client, &account, &hosts)?;
        eprintln!(
            "{}: a code grants projects now; {} became {}",
            crate::NAME,
            hosts.join(", "),
            projects.join(", ")
        );
        Grant::of(projects)
    } else if projects.is_empty() {
        whole_note(config, global, &account, args.owner);
        Grant::whole()
    } else {
        Grant::of(projects)
    };
    let mine = crate::links::owner(config, &account, &args.email);
    let asked = crate::links::mailing(mine, args.no_mail, args.mail_me);
    let minted = client.mint(&NewCode {
        client_uid: crate::client::uid(),
        name: args.name.clone(),
        email: args.email.clone(),
        grant,
        manager: args.owner,
        totp: args.totp,
        mail: asked,
    })?;
    if minted.secret.is_none() {
        return Err("this invite was already minted; revoke it and invite again".into());
    }
    if global.json {
        let mut value = serde_json::to_value(&minted).map_err(|e| e.to_string())?;
        value["space"] = space_ref(config, &account);
        return print_json(&value);
    }
    crate::links::report(&minted, mine, asked)
}

fn whole_note(config: &Config, global: &Global, account: &str, owner: bool) {
    if named(global).is_none() {
        return;
    }
    let name = config
        .accounts
        .get(account)
        .map_or(account, |s| s.title(account));
    let role = if owner { " as an Owner" } else { "" };
    eprintln!(
        "{}: --space {account} with no --project grants the whole space {name}{role}; --project <name> grants less",
        crate::NAME
    );
}

fn space_ref(config: &Config, slug: &str) -> Value {
    let name = config.accounts.get(slug).map_or(slug, |s| s.title(slug));
    json!({"slug": slug, "name": name})
}

fn grant_set(config: &Config, global: &Global, args: &GrantArgs) -> Result<(), String> {
    let projects = args
        .project
        .iter()
        .map(|p| crate::card::project(p))
        .collect::<Result<Vec<_>, _>>()?;
    let grant = if args.park {
        Grant::of(Vec::new())
    } else if !projects.is_empty() {
        Grant::of(projects.clone())
    } else if global.account.is_some() {
        Grant::whole()
    } else {
        return Err(
            "say what the code grants: --space for the whole space, --project <name> for some, or --park for nothing"
                .into(),
        );
    };
    let scoped = without_whole(global);
    let account = account_for(config, &scoped, None, &projects)?;
    if grant.space {
        whole_note(config, global, &account, false);
    }
    let client = Client::for_account(config, &account, &global.agent)?;
    let code = client
        .set_grant(args.id, &grant)
        .map_err(crate::card::refusal)?;
    if global.json {
        let mut value = serde_json::to_value(&code).map_err(|e| e.to_string())?;
        value["space"] = space_ref(config, &account);
        return print_json(&value);
    }
    let held = code.grant.clone().unwrap_or(grant);
    if held.parked() {
        out!(
            "code {} of {} <{}> is parked: it opens nothing and is not revoked; no one was mailed",
            code.id,
            code.name,
            code.email
        );
    } else {
        out!(
            "code {} of {} <{}> now grants {}; no one was mailed",
            code.id,
            code.name,
            code.email,
            held.words()
        );
    }
    Ok(())
}

fn otpauth(email: &str, key: &str) -> String {
    format!(
        "otpauth://totp/P99:{}?secret={key}&issuer=P99&algorithm=SHA1&digits=6&period=30",
        crate::client::encode(email).replace("%40", "@")
    )
}

pub(crate) fn print_totp(code: &Code, key: &str) {
    out!(
        "key:    {key}   (paste it as a one-time password or setup key; totp is the same as a link)"
    );
    out!("totp:   {}", otpauth(&code.email, key));
    println!("send these apart from the link; each browser asks for its 6-digit code once");
}

fn totp(config: &Config, global: &Global, host: Option<&str>, id: i64) -> Result<(), String> {
    let (client, _) = client_for(config, global, host)?;
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
    match &args.action {
        Some(InvitesAction::Totp { id }) => return totp(config, global, args.host.as_deref(), *id),
        Some(InvitesAction::Delete(a)) => {
            return codes::delete(config, global, args.host.as_deref(), a);
        }
        Some(InvitesAction::Set(a)) => return grant_set(config, global, a),
        None => {}
    }
    let mut codes = match demo(global) {
        Some(d) => d
            .codes()
            .into_iter()
            .filter(|c| {
                args.host
                    .as_ref()
                    .is_none_or(|h| c.hosts.contains(h) || c.reaches(h, config.project_of_host(h)))
            })
            .collect(),
        None => client_for(config, global, args.host.as_deref())?
            .0
            .codes(args.host.as_deref())?,
    };
    if let Some(role) = args.role {
        codes.retain(|c| crate::one_board::Role::of(c.manager) == role);
    }
    if global.json {
        return print_json(&json!({"codes": codes}));
    }
    if codes.is_empty() {
        println!("no codes");
    }
    for code in &codes {
        let role = crate::one_board::Role::of(code.manager).word();
        let role = if code.totp {
            format!("{role}, totp")
        } else {
            role.to_owned()
        };
        out!(
            "{:>4}  {}  {} <{}>  {role}  ...{}  {}  grant: {}  last used: {}",
            code.id,
            code_state(code),
            code.name,
            code.email,
            code.hint,
            when(&code.created_at),
            code.reach(),
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

fn state_text<'a>(label: Option<&'a str>, stage: &'a str) -> &'a str {
    label.unwrap_or_else(|| crate::wire::stage_word(stage))
}

fn summary_line(item: &Summary) -> String {
    let mut line = format!(
        "{}{:<8} {:<11} {:<11} {}",
        if item.unread { "*" } else { " " },
        item.key,
        state_text(item.label.as_deref(), &item.stage),
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
            && (args.project.is_empty()
                || s.project
                    .as_ref()
                    .is_some_and(|p| args.project.iter().any(|w| w.eq_ignore_ascii_case(p))))
            && (!args.mine || s.reporter.email == crate::tui::demo::ME.1)
            && text.is_none_or(|t| s.title.to_lowercase().contains(&t))
            && args.label.iter().all(|l| {
                s.labels
                    .iter()
                    .any(|t| t.name.to_lowercase() == l.to_lowercase())
            })
    };
    let mut found: Vec<Summary> = demo(global)?
        .list()
        .into_iter()
        .map(|e| e.summary)
        .filter(wanted)
        .collect();
    found.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    found.truncate(args.limit as usize);
    Some(found)
}

fn list(config: &Config, global: &Global, args: &ListArgs) -> Result<(), String> {
    if let Some(found) = demo_list(global, args) {
        return listed(found, false, global, Vec::new());
    }
    let projects = args
        .project
        .iter()
        .map(|p| crate::card::project(p))
        .collect::<Result<Vec<_>, _>>()?;
    let accounts: Vec<String> = if args.all && global.account.is_none() {
        config.accounts.keys().cloned().collect()
    } else {
        vec![account_of(config, global, args.host.as_deref())?]
    };
    let holder = crate::config::key_holder(config)?;
    if accounts.is_empty() {
        return Err("no space yet; run p99 setup".into());
    }
    let host = if args.all || args.host.is_none() {
        Some("*".to_owned())
    } else {
        args.host.clone()
    };
    let scope = if args.mine { "mine" } else { "all" };
    let agent = &global.agent;
    let limit = args.limit as usize;
    let mut found: Vec<Summary> = Vec::new();
    let mut more = false;
    for account in &accounts {
        let client = Client::among(config, account, holder.as_deref(), agent)?;
        let mut cursor: Option<String> = None;
        let mut taken = 0;
        while taken < limit {
            let query = ListQuery {
                scope: scope.to_owned(),
                path: None,
                status: Some(args.status.clone()),
                kind: args.kind.clone(),
                q: args.query.clone(),
                cursor: cursor.clone(),
                host: host.clone(),
                project: projects.clone(),
                label: args.label.iter().cloned().collect(),
                limit: (limit - taken).min(100) as i64,
            };
            let page = client.list(&query)?;
            if page.issues.is_empty() {
                cursor = None;
                break;
            }
            taken += page.issues.len();
            found.extend(page.issues);
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        more |= cursor.is_some();
    }
    more |= newest(&mut found, limit);
    let spaces = accounts.iter().map(|a| space_ref(config, a)).collect();
    listed(found, more, global, spaces)
}

fn newest(found: &mut Vec<Summary>, limit: usize) -> bool {
    found.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let cut = found.len() > limit;
    found.truncate(limit);
    cut
}

fn listed(
    found: Vec<Summary>,
    more: bool,
    global: &Global,
    mut spaces: Vec<Value>,
) -> Result<(), String> {
    if global.json {
        let mut value = json!({"issues": found, "more": more});
        if spaces.len() == 1 {
            value["space"] = spaces.remove(0);
        } else if !spaces.is_empty() {
            value["spaces"] = Value::Array(spaces);
        }
        return print_json(&value);
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
        state_text(issue.label.as_deref(), &issue.stage)
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
        who_via(
            text("email"),
            text("name"),
            agent,
            reporter.get("via").and_then(Value::as_str)
        ),
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
        out!("merged into {of}");
    }
    if !issue.merged.is_empty() {
        println!("merged here");
        for line in merge::merged_lines(&issue.merged) {
            out!("{line}");
        }
    }
    if let Some(board) = &issue.board {
        out!("on the board {board}");
    }
    for link in &issue.github {
        out!(
            "github {} #{} ({}): {}",
            if link.kind == "pull" {
                "pull request"
            } else {
                "issue"
            },
            link.number,
            link.rel,
            link.url
        );
    }
    if issue.label.is_some() && !issue.stage.is_empty() {
        out!("{}", crate::wire::stage_word(&issue.stage).to_lowercase());
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
            who_via(
                &author.email,
                &author.name,
                author.agent,
                author.via.as_deref()
            ),
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
                who_via(
                    e.actor.as_deref().unwrap_or("-"),
                    e.actor_name.as_deref().unwrap_or_default(),
                    e.agent,
                    e.via.as_deref(),
                ),
                e.kind,
                detail
            );
        }
    }
}

fn show(config: &Config, global: &Global, args: &ShowArgs) -> Result<(), String> {
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let thread = match demo(global) {
        Some(mut d) => d.thread(&key_of(&args.key)?)?,
        None => client_for(config, global, host.as_deref())?
            .0
            .with_host(host.as_deref())
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
        return Err("--duplicate-of goes with duplicate".into());
    }
    if args.status != "duplicate" && args.status != "abandoned" {
        return crate::boards::label_move(
            config,
            global,
            &args.key,
            &args.status,
            args.host.as_deref(),
        );
    }
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let change = Change {
        resolution: Some(args.status.clone()),
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
        crate::wire::stage_word(&issue.stage).to_lowercase()
    );
    Ok(())
}

fn edit(config: &Config, global: &Global, args: &EditArgs) -> Result<(), String> {
    if args.project.is_some() || args.no_project {
        return card::edit_project(config, global, args);
    }
    let body = match (&args.text, &args.text_file) {
        (Some(text), _) => Some(text_arg(text)?),
        (None, Some(path)) if path.as_os_str() == "-" => Some(read_stdin()?.trim_end().to_owned()),
        (None, Some(path)) => Some(
            std::fs::read_to_string(path)
                .map_err(|e| format!("{}: {e}", path.display()))?
                .trim_end()
                .to_owned(),
        ),
        (None, None) => None,
    };
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let change = Change {
        title: args.title.clone(),
        body: body.clone(),
        ..Change::default()
    };
    let issue = client
        .with_host(args.host.as_deref())
        .change(&key_of(&args.key)?, &change)?;
    if global.json {
        return print_json(&issue);
    }
    let what: Vec<&str> = [
        args.title.as_ref().map(|_| "title"),
        body.as_ref().map(|_| "details"),
    ]
    .into_iter()
    .flatten()
    .collect();
    out!("{} edited: {}", issue.key, what.join(" and "));
    Ok(())
}

fn assign(config: &Config, global: &Global, args: &AssignArgs) -> Result<(), String> {
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let assignee = match (&args.who, args.none) {
        (Some(who), false) => Some(who.trim().trim_start_matches('@').to_owned()),
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
    use super::{ListArgs, Summary, key_of, newest, pitomd_link};
    use crate::config::Host;
    use crate::license::State;
    use clap::Parser;

    const REFUSED: &str = "Only an Agency or Owner key hides the 'by PITO.MD' link";

    fn pushed(link: Option<bool>) -> serde_json::Value {
        Host {
            link,
            ..Host::default()
        }
        .pushed()
    }

    #[test]
    fn free_cannot_turn_the_link_off() {
        assert_eq!(pitomd_link(State::Free, "off").unwrap_err(), REFUSED);
        assert_eq!(pitomd_link(State::Free, "on"), Ok(None));
    }

    #[test]
    fn studio_cannot_turn_the_link_off() {
        assert_eq!(pitomd_link(State::Studio, "off").unwrap_err(), REFUSED);
    }

    #[test]
    fn agency_turns_the_link_off_and_the_host_pushes_it_hidden() {
        let link = pitomd_link(State::Agency, "off").unwrap();
        assert_eq!(link, Some(false));
        assert_eq!(pushed(link)["link"], false);
        let link = pitomd_link(State::Agency, "on").unwrap();
        assert_eq!(link, None);
        assert!(pushed(link).get("link").is_none());
    }

    #[test]
    fn ff_cannot_turn_the_link_off() {
        assert_eq!(pitomd_link(State::Ff, "off").unwrap_err(), REFUSED);
    }

    #[test]
    fn owner_turns_the_link_off() {
        let link = pitomd_link(State::Owner, "off").unwrap();
        assert_eq!(link, Some(false));
        assert_eq!(pushed(link)["link"], false);
    }

    #[test]
    fn keys_take_any_prefix_or_a_bare_number() {
        for raw in ["BUG-12", "bug-12", "12", " feat-12 "] {
            assert_eq!(key_of(raw).unwrap(), "12", "{raw}");
        }
        for raw in ["", "BUG-", "BUG-x", "12abc", "-3", "../x"] {
            assert!(key_of(raw).is_err(), "{raw}");
        }
    }

    #[derive(Parser)]
    struct Listing {
        #[command(flatten)]
        list: ListArgs,
    }

    fn limit(args: &[&str]) -> Result<u64, clap::Error> {
        Listing::try_parse_from(std::iter::once("list").chain(args.iter().copied()))
            .map(|l| l.list.limit)
    }

    fn item(key: &str, updated_at: &str) -> Summary {
        Summary {
            key: key.to_owned(),
            updated_at: updated_at.to_owned(),
            ..Summary::default()
        }
    }

    #[test]
    fn a_limit_is_fifty_by_default_and_any_count_from_one() {
        assert_eq!(limit(&[]).unwrap(), 50);
        assert_eq!(limit(&["--limit", "1"]).unwrap(), 1);
        assert_eq!(limit(&["--limit", "520"]).unwrap(), 520);
    }

    #[test]
    fn a_limit_of_zero_or_less_or_no_number_is_clap_s_own_error() {
        for bad in ["0", "-1", "three", ""] {
            let error = limit(&["--limit", bad]).unwrap_err();
            assert_eq!(error.exit_code(), 2, "{bad}");
        }
        let zero = limit(&["--limit", "0"]).unwrap_err().to_string();
        assert!(
            zero.starts_with("error: invalid value '0' for '--limit"),
            "{zero}"
        );
    }

    #[test]
    fn newest_keeps_the_most_recent_across_accounts_and_says_when_it_cut() {
        let mut found = vec![
            item("BUG-1", "2026-10-01"),
            item("BUG-101", "2026-10-05"),
            item("BUG-2", "2026-10-03"),
            item("BUG-102", "2026-10-02"),
            item("BUG-3", "2026-10-04"),
        ];
        assert!(newest(&mut found, 3));
        let keys: Vec<&str> = found.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["BUG-101", "BUG-3", "BUG-2"]);
    }

    #[test]
    fn newest_keeps_everything_at_or_under_the_limit() {
        let mut found = vec![item("BUG-1", "2026-10-01"), item("BUG-2", "2026-10-02")];
        assert!(!newest(&mut found, 2));
        assert_eq!(found.len(), 2);
        assert!(!newest(&mut found, 50));
        assert_eq!(found[0].key, "BUG-2");
        let mut none: Vec<Summary> = Vec::new();
        assert!(!newest(&mut none, 1));
    }

    fn masks(raw: &[&str]) -> Result<Vec<String>, String> {
        super::masks_of(&raw.iter().map(|m| (*m).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn masks_are_trimmed_deduplicated_and_none_clears() {
        assert_eq!(
            masks(&[" #a ", ".b, .c", "#a"]).unwrap(),
            ["#a", ".b, .c"].map(String::from)
        );
        assert_eq!(masks(&["none"]).unwrap(), Vec::<String>::new());
        assert_eq!(masks(&["NONE"]).unwrap(), Vec::<String>::new());
        assert!(masks(&["none", "#a"]).is_err());
        assert!(masks(&[" "]).is_err());
    }

    #[test]
    fn masks_are_held_to_fifty_selectors_of_two_hundred_characters() {
        let many: Vec<String> = (0..50).map(|n| format!(".m{n}")).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        assert_eq!(masks(&refs).unwrap().len(), 50);
        let mut over = refs.clone();
        over.push(".one-more");
        assert_eq!(
            masks(&over).unwrap_err(),
            "a host takes at most 50 mask selectors"
        );
        let edge = "a".repeat(200);
        assert!(masks(&[edge.as_str()]).is_ok());
        let long = "a".repeat(201);
        assert!(
            masks(&[long.as_str()])
                .unwrap_err()
                .starts_with("a mask selector has at most 200 characters")
        );
    }

    #[test]
    fn a_host_pushes_its_masks_and_only_capture_off() {
        let host = Host {
            mask: vec!["#a".into()],
            capture: Some("off".into()),
            ..Host::default()
        };
        let pushed = host.pushed();
        assert_eq!(pushed["mask"], serde_json::json!(["#a"]));
        assert_eq!(pushed["capture"], "off");
        let on = Host {
            capture: Some("on".into()),
            ..Host::default()
        };
        assert!(on.pushed().get("capture").is_none());
        assert!(on.pushed().get("mask").is_none());
    }
}

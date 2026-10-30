use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::card::{
    Card, CardEvent, CardList, CardQuery, CardReply, CardThread, Lane, LinkReply, NewCard,
    NewComment, NewLink, Person, ProjectChange, Source, StatusChange, ago, refusal, who,
};
use crate::cli::{
    Global, ProjectsAction, ProjectsArgs, client_for, key_of, print_json, read_attachment, text_arg,
};
use crate::client::{Client, segment, uid};
use crate::config::Config;
use crate::wire::{Attachment, Change, KINDS, NewIssue, PageRef, SpaceView, out};

#[derive(Debug, clap::Args)]
pub struct CardsArgs {
    #[arg(
        long,
        value_name = "name",
        help = "only this project's cards; repeat it for several"
    )]
    pub project: Vec<String>,
    #[arg(
        long,
        value_enum,
        value_name = "word",
        help = "only the cards in this lane; repeat it for several (every lane but done by default)"
    )]
    pub status: Vec<Lane>,
    #[arg(
        long,
        value_name = "when",
        help = "only the cards changed at or after a time (2026-10-22T08:00:00Z) or within an age (90m, 6h, 2d)"
    )]
    pub since: Option<String>,
    #[arg(
        long,
        value_enum,
        help = "only the cards whose last change was a person's or an agent's"
    )]
    pub source: Option<Source>,
    #[arg(long, help = "only this host's cards")]
    pub host: Option<String>,
    #[arg(
        long,
        value_name = "n",
        default_value_t = crate::card::DEFAULT_LIMIT,
        value_parser = clap::value_parser!(u32).range(1..=i64::from(crate::card::MAX_LIMIT)),
        help = "at most this many cards, up to 500"
    )]
    pub limit: u32,
    #[arg(long, value_name = "c", help = "read on from a list's next_cursor")]
    pub cursor: Option<String>,
    #[arg(
        long,
        conflicts_with_all = ["project", "status", "since", "source", "host", "limit", "cursor"],
        help = "only the cards waiting on a person (needs-you, stuck, landed), newest change first"
    )]
    pub waiting: bool,
}

#[derive(Debug, clap::Args)]
pub struct CardArgs {
    #[command(subcommand)]
    pub action: CardAction,
}

#[derive(Debug, clap::Subcommand)]
pub enum CardAction {
    #[command(about = "show a card with its comments, links and events")]
    Show(CardShowArgs),
    #[command(
        about = "file a card in a project or on a host, with a page and files; --project files it in lane new"
    )]
    New(CardNewArgs),
    #[command(about = "comment on a card, with files; --internal for Owners only")]
    Comment(CardCommentArgs),
    #[command(
        about = "move a card to a lane, at its top; done closes it as fixed, or close it as abandoned or duplicate"
    )]
    Status(CardStatusArgs),
    #[command(about = "move a card to a lane, or beside another card in it")]
    Move(crate::boards::MoveArgs),
    #[command(about = "link a card to a request, a commit, a tag or a URL")]
    Link(CardLinkArgs),
}

#[derive(Debug, clap::Args)]
pub struct CardShowArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
}

#[derive(Debug, clap::Args)]
#[command(group(clap::ArgGroup::new("place").required(true).multiple(true).args(["project", "host"])))]
pub struct CardNewArgs {
    #[arg(
        long,
        value_name = "name",
        help = "the project the card belongs to; it starts in lane new"
    )]
    pub project: Option<String>,
    #[arg(
        long,
        help = "the host it is about; alone, the card lands in the host's project as the panel files it"
    )]
    pub host: Option<String>,
    #[arg(
        long,
        value_name = "text",
        help = "one line that says what it is about"
    )]
    pub title: String,
    #[arg(
        long,
        value_name = "text|-",
        help = "the details, or - to read them from standard input"
    )]
    pub body: Option<String>,
    #[arg(long, value_parser = KINDS, default_value = "feature", help = "what it is")]
    pub kind: String,
    #[arg(
        long,
        value_name = "path",
        requires = "host",
        help = "the page on the host it is about; none by default"
    )]
    pub page: Option<String>,
    #[arg(long, value_name = "file", help = "a file to attach; repeat it")]
    pub attach: Vec<PathBuf>,
}

#[derive(Debug, clap::Args)]
pub struct CardCommentArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(
        value_name = "text|-",
        help = "the text, or - to read it from standard input"
    )]
    pub text: String,
    #[arg(long, help = "for Owners only")]
    pub internal: bool,
    #[arg(long, value_name = "file", help = "a file to attach; repeat it")]
    pub attach: Vec<PathBuf>,
    #[arg(long, help = "the host the card is on")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct CardStatusArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(
        value_name = "STATUS",
        help = "a lane's word (`new`, `planned`, `in-progress`, `needs-you`, `stuck`, `landed`, `done`) or its name, or `abandoned` or `duplicate` to close it"
    )]
    pub status: String,
    #[arg(
        long,
        value_name = "text|-",
        help = "a comment in the same write, such as why it is stuck, or - for standard input"
    )]
    pub note: Option<String>,
    #[arg(
        long,
        value_name = "KEY",
        help = "with duplicate: the card this one repeats"
    )]
    pub duplicate_of: Option<String>,
    #[arg(long, help = "the host the card is on")]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct CardLinkArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(
        value_name = "REF",
        help = "a request id, a commit, a tag or a URL, up to 200 characters"
    )]
    pub reference: String,
    #[arg(long, value_name = "text", help = "a note, up to 200 characters")]
    pub note: Option<String>,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn key(raw: &str) -> Result<String, String> {
    key_of(raw)?;
    Ok(segment(raw.trim())?.to_owned())
}

fn ask<T: DeserializeOwned>(
    client: &Client,
    method: &str,
    pq: &str,
    body: Option<Value>,
) -> Result<T, String> {
    client.json(method, pq, body).map_err(refusal)
}

fn body_of<T: serde::Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn optional_text(value: &Option<String>) -> Result<Option<String>, String> {
    value.as_deref().map(text_arg).transpose()
}

pub fn card_line(card: &Card, now: i64) -> String {
    format!(
        "{:<8} {:<11} {:<12} {}  {} {}",
        card.key,
        card.status.word(),
        card.project,
        card.title,
        changer(&card.changed_by),
        ago(&card.changed_at, now)
    )
}

pub fn cards(config: &Config, global: &Global, args: &CardsArgs) -> Result<(), String> {
    if args.waiting {
        return super::waiting::waiting(config, global);
    }
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let projects = args
        .project
        .iter()
        .map(|p| crate::card::project(p))
        .collect::<Result<Vec<_>, _>>()?;
    let since = args
        .since
        .as_deref()
        .map(|s| crate::card::since(s, now()))
        .transpose()?;
    let q = CardQuery {
        projects,
        statuses: args.status.clone(),
        since,
        source: args.source,
        host: host.clone(),
        limit: args.limit,
        cursor: args.cursor.clone(),
    };
    let (client, _) = client_for(config, global, host.as_deref())?;
    let list: CardList = ask(
        &client,
        "GET",
        &format!("/v1/cards{}", crate::card::query(&q)),
        None,
    )?;
    if global.json {
        return print_json(&list);
    }
    if list.cards.is_empty() {
        println!("no cards");
    }
    let at = now();
    for card in &list.cards {
        out!("{}", card_line(card, at));
    }
    if let Some(cursor) = &list.next_cursor {
        out!("more cards follow; read on with --cursor {cursor}");
    }
    Ok(())
}

pub fn card(config: &Config, global: &Global, args: &CardArgs) -> Result<(), String> {
    match &args.action {
        CardAction::Show(a) => show(config, global, a),
        CardAction::New(a) => new(config, global, a),
        CardAction::Comment(a) => comment(config, global, a),
        CardAction::Status(a) => status(config, global, a),
        CardAction::Move(a) => crate::boards::run_move(config, global, a),
        CardAction::Link(a) => link(config, global, a),
    }
}

fn show(config: &Config, global: &Global, args: &CardShowArgs) -> Result<(), String> {
    let key = key(&args.key)?;
    let (client, _) = client_for(config, global, None)?;
    let thread: CardThread = ask(&client, "GET", &format!("/v1/cards/{key}"), None)?;
    if global.json {
        return print_json(&thread);
    }
    for line in thread_lines(&thread, now()) {
        out!("{line}");
    }
    Ok(())
}

pub fn thread_lines(thread: &CardThread, now: i64) -> Vec<String> {
    let card = &thread.card.card;
    let place = match card.lane {
        Some(n) => format!("{} (#{n} in its lane)", card.label),
        None => card.label.clone(),
    };
    let mut lines = vec![
        format!(
            "{}  {}  {}  {}",
            card.key,
            crate::wire::kind_word(&card.kind),
            card.project,
            place
        ),
        card.title.clone(),
        if card.host.is_empty() {
            format!(
                "filed by {}  {}",
                who(&card.reporter),
                crate::cli::when(&card.created_at)
            )
        } else {
            format!(
                "filed by {} on {}  {}",
                who(&card.reporter),
                card.host,
                crate::cli::when(&card.created_at)
            )
        },
        format!("changed by {} {}", changer(&card.changed_by), {
            match ago(&card.changed_at, now).as_str() {
                "now" => "just now".to_owned(),
                age => format!("{age} ago"),
            }
        }),
    ];
    if !thread.card.body.is_empty() {
        lines.push(String::new());
        lines.extend(thread.card.body.lines().map(str::to_owned));
    }
    if !card.links.is_empty() {
        lines.push(String::new());
        for link in &card.links {
            let mut line = format!("link {}", link.reference);
            if let Some(note) = link.note.as_deref().filter(|n| !n.is_empty()) {
                line.push_str(&format!(" ({note})"));
            }
            line.push_str(&format!("  {}{}", who(&link.by), detail(&link.by)));
            lines.push(line);
        }
    }
    for comment in &thread.comments {
        lines.push(String::new());
        lines.push(format!(
            "{}{}  {}{}",
            who(&comment.author),
            detail(&comment.author),
            crate::cli::when(&comment.created_at),
            if comment.internal { "  internal" } else { "" }
        ));
        lines.extend(comment.body.lines().map(|l| format!("  {l}")));
    }
    if !thread.events.is_empty() {
        lines.push(String::new());
        for event in &thread.events {
            lines.push(event_line(event));
        }
    }
    lines
}

fn changer(person: &Option<Person>) -> String {
    person.as_ref().map(who).unwrap_or_else(|| "P99".to_owned())
}

fn detail(person: &Person) -> String {
    match person
        .via
        .as_deref()
        .filter(|v| person.agent && !v.is_empty())
    {
        Some(via) => format!(" via {via}"),
        None => String::new(),
    }
}

fn event_line(event: &CardEvent) -> String {
    let text = |name: &str| {
        event
            .detail
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or("-")
            .to_owned()
    };
    let what = match event.kind.as_str() {
        "project" => format!("project {} -> {}", text("from"), text("to")),
        "label" => format!("lane {} -> {}", text("from"), text("to")),
        "link" => format!("linked {}", text("ref")),
        other => other.to_owned(),
    };
    let by = event
        .by
        .as_ref()
        .map(|p| format!("{}{}", who(p), detail(p)))
        .unwrap_or_else(|| "P99".to_owned());
    format!("{}  {what}  {by}", crate::cli::when(&event.at))
}

pub fn new(config: &Config, global: &Global, args: &CardNewArgs) -> Result<(), String> {
    let project = args
        .project
        .as_deref()
        .map(crate::card::project)
        .transpose()?;
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let files = attachments(&args.attach)?;
    let body = optional_text(&args.body)?.unwrap_or_default();
    let (client, account) = client_for(config, global, host.as_deref())?;
    let space = super::space_ref(config, &account);
    match (project, &host) {
        (Some(project), _) if args.page.is_none() => {
            let reply = client
                .new_card(&NewCard {
                    client_uid: uid(),
                    project,
                    title: args.title.clone(),
                    body,
                    kind: args.kind.clone(),
                    host,
                })
                .map_err(refusal)?;
            carded(global, &client, space, reply, &files)
        }
        (project, Some(host)) => {
            let filed = client.file(&filing(args, host, body))?;
            let number = filed.id.to_string();
            if let Some(project) = project {
                let answer: Value = ask(
                    &client,
                    "PATCH",
                    &client.item(&number, "")?,
                    Some(body_of(&ProjectChange { project })?),
                )?;
                let reply: CardReply =
                    serde_json::from_value(answer).map_err(|_| crate::card::NOT_YET.to_owned())?;
                return carded(global, &client, space, reply, &files);
            }
            let attached = upload(&client, &number, &files, None)?;
            if global.json {
                return print_json(&json!({"issue": filed, "attachments": attached}));
            }
            out!("{} filed on {host}: {}", filed.key, filed.title);
            attached_lines(&attached);
            Ok(())
        }
        (_, None) => Err("a page is on a host; give --host <host>".into()),
    }
}

fn filing(args: &CardNewArgs, host: &str, body: String) -> NewIssue {
    let path = args
        .page
        .as_deref()
        .map(crate::wire::page_path)
        .unwrap_or_default();
    NewIssue {
        client_uid: uid(),
        host: Some(host.to_owned()),
        kind: args.kind.clone(),
        title: args.title.clone(),
        body,
        page: PageRef {
            url: format!(
                "https://{host}{}",
                if path.is_empty() { "/" } else { &path }
            ),
            path,
            title: String::new(),
        },
        context: json!({"source": "cli"}),
        marks: Vec::new(),
    }
}

fn carded(
    global: &Global,
    client: &Client,
    space: Value,
    reply: CardReply,
    files: &[Upload],
) -> Result<(), String> {
    let attached = upload(client, &key_of(&reply.card.key)?, files, None)?;
    if global.json {
        let mut value = json!({"card": reply.card, "space": space});
        if !files.is_empty() {
            value["attachments"] = json!(attached);
        }
        return print_json(&value);
    }
    if reply.card.host.is_empty() {
        out!(
            "{} filed in {}: {}",
            reply.card.key,
            reply.card.project,
            reply.card.title
        );
    } else {
        out!(
            "{} filed in {} on {}: {}",
            reply.card.key,
            reply.card.project,
            reply.card.host,
            reply.card.title
        );
    }
    attached_lines(&attached);
    Ok(())
}

type Upload = (String, &'static str, Vec<u8>);

fn attachments(paths: &[PathBuf]) -> Result<Vec<Upload>, String> {
    paths.iter().map(|p| read_attachment(p)).collect()
}

fn upload(
    client: &Client,
    number: &str,
    files: &[Upload],
    comment: Option<i64>,
) -> Result<Vec<Attachment>, String> {
    files
        .iter()
        .map(|(name, kind, bytes)| client.attach(number, name, kind, bytes, comment))
        .collect()
}

fn attached_lines(attached: &[Attachment]) {
    for a in attached {
        out!("attached {} as {}", a.name, a.id);
    }
}

pub(crate) fn not_a_card(error: &str) -> bool {
    let bare = refusal(error.to_owned());
    (error.ends_with("(409)") && (bare.contains(" not a card") || bare.contains(" no project")))
        || (error.ends_with("(403)") && bare == OWNERS_ONLY)
        || bare == crate::card::NOT_YET
}

const OWNERS_ONLY: &str = "only an Owner may do this";

pub fn comment(config: &Config, global: &Global, args: &CardCommentArgs) -> Result<(), String> {
    let files = attachments(&args.attach)?;
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let shown = key(&args.key)?;
    let number = key_of(&args.key)?;
    let text = text_arg(&args.text)?;
    let (client, _) = client_for(config, global, host.as_deref())?;
    let client = client.with_host(host.as_deref());
    let request = NewComment {
        client_uid: uid(),
        body: text,
        internal: args.internal,
    };
    match client.card_comment(&shown, &request) {
        Ok(reply) => {
            let attached = upload(&client, &number, &files, Some(reply.comment.id))?;
            if global.json {
                let mut value = body_of(&reply)?;
                if !files.is_empty() {
                    value["attachments"] = json!(attached);
                }
                return print_json(&value);
            }
            commented(&reply.key, reply.comment.internal);
            Ok(())
        }
        Err(why) if not_a_card(&why) => {
            let made = client
                .comment_as(&number, &request.client_uid, &request.body, args.internal)
                .map_err(refusal)?;
            let attached = upload(&client, &number, &files, Some(made.id))?;
            if global.json {
                return print_json(&json!({"comment": made, "attachments": attached}));
            }
            commented(&args.key, args.internal);
            Ok(())
        }
        Err(why) => Err(refusal(why)),
    }
}

fn commented(key: &str, internal: bool) {
    out!(
        "commented on {key}{}",
        if internal { " (internal)" } else { "" }
    );
}

pub fn status(config: &Config, global: &Global, args: &CardStatusArgs) -> Result<(), String> {
    let word = args.status.trim();
    let closing = matches!(word, "abandoned" | "duplicate");
    if word == "duplicate" && args.duplicate_of.is_none() {
        return Err("a duplicate needs --duplicate-of KEY".into());
    }
    if word != "duplicate" && args.duplicate_of.is_some() {
        return Err("--duplicate-of goes with duplicate".into());
    }
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    if closing {
        if args.note.is_some() {
            return Err("--note goes with a lane; close it, then p99 card comment says why".into());
        }
        return close(config, global, args, host.as_deref());
    }
    let lane = <Lane as clap::ValueEnum>::from_str(word, true).ok();
    let Some(lane) = lane else {
        if args.note.is_some() {
            return Err(format!(
                "--note goes with a lane's word: {}",
                LANE_WORDS.join(", ")
            ));
        }
        return crate::boards::label_move(config, global, &args.key, word, host.as_deref());
    };
    let key = key(&args.key)?;
    let note = optional_text(&args.note)?;
    let (client, _) = client_for(config, global, host.as_deref())?;
    let request = StatusChange {
        status: lane,
        note,
        client_uid: uid(),
    };
    let reply: Result<CardReply, String> = client.json(
        "POST",
        &format!("/v1/cards/{key}/status"),
        Some(body_of(&request)?),
    );
    let reply = match reply {
        Ok(reply) => reply,
        Err(why) if request.note.is_none() && not_a_card(&why) => {
            return crate::boards::label_move(config, global, &args.key, word, host.as_deref())
                .map_err(refusal);
        }
        Err(why) => return Err(refusal(why)),
    };
    if global.json {
        return print_json(&reply);
    }
    out!(
        "{} is now {}{}",
        reply.card.key,
        status_text(&reply.card),
        if reply.comment.is_some() {
            ", with a note"
        } else {
            ""
        }
    );
    Ok(())
}

const LANE_WORDS: [&str; 7] = [
    "new",
    "planned",
    "in-progress",
    "needs-you",
    "stuck",
    "landed",
    "done",
];

fn close(
    config: &Config,
    global: &Global,
    args: &CardStatusArgs,
    host: Option<&str>,
) -> Result<(), String> {
    let (client, _) = client_for(config, global, host)?;
    let change = Change {
        resolution: Some(args.status.trim().to_owned()),
        duplicate_of: args.duplicate_of.clone(),
        ..Change::default()
    };
    let issue = client
        .with_host(host)
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

pub fn status_text(card: &Card) -> String {
    match card.lane {
        Some(n) => format!("{} ({}, #{n} in its lane)", card.label, card.status.word()),
        None => format!("{} ({})", card.label, card.status.word()),
    }
}

fn link(config: &Config, global: &Global, args: &CardLinkArgs) -> Result<(), String> {
    let key = key(&args.key)?;
    let (client, _) = client_for(config, global, None)?;
    let request = NewLink {
        reference: args.reference.clone(),
        note: args.note.clone(),
    };
    let reply: LinkReply = ask(
        &client,
        "POST",
        &format!("/v1/cards/{key}/links"),
        Some(body_of(&request)?),
    )?;
    if global.json {
        return print_json(&reply);
    }
    out!("linked {} to {}", reply.key, reply.link.reference);
    Ok(())
}

pub fn projects(config: &mut Config, global: &Global, args: &ProjectsArgs) -> Result<(), String> {
    match &args.action {
        None => project_list(config, global),
        Some(ProjectsAction::Add { name }) => project_add(config, global, name),
        Some(ProjectsAction::Rename { old, new }) => project_rename(config, global, old, new),
    }
}

fn spaces_in_scope(config: &Config, global: &Global) -> Result<Vec<String>, String> {
    match config.account(global.account.as_deref()) {
        Ok((slug, _)) => Ok(vec![slug.to_owned()]),
        Err(_) if global.account.is_none() && config.accounts.len() > 1 => {
            Ok(config.accounts.keys().cloned().collect())
        }
        Err(why) => Err(why),
    }
}

pub fn project_lines(view: &SpaceView) -> Vec<String> {
    if view.projects.is_empty() {
        return vec!["no projects yet; p99 projects add <name>".to_owned()];
    }
    let names = view
        .projects
        .iter()
        .map(|p| p.name.chars().count())
        .max()
        .unwrap_or(7)
        .max(7);
    let hosts: Vec<String> = view
        .projects
        .iter()
        .map(|p| {
            if p.hosts.is_empty() {
                "-".to_owned()
            } else {
                p.hosts.join(", ")
            }
        })
        .collect();
    let wide = hosts
        .iter()
        .map(|h| h.chars().count())
        .max()
        .unwrap_or(5)
        .max(5);
    let mut lines = vec![format!(
        "{:<names$}  {:<wide$}  OPEN  CLOSED",
        "PROJECT", "HOSTS"
    )];
    for (project, hosts) in view.projects.iter().zip(&hosts) {
        lines.push(format!(
            "{:<names$}  {hosts:<wide$}  {:>4}  {:>6}",
            project.name, project.open, project.closed
        ));
    }
    lines
}

fn project_list(config: &Config, global: &Global) -> Result<(), String> {
    let slugs = spaces_in_scope(config, global)?;
    let mut views: Vec<SpaceView> = Vec::new();
    for slug in &slugs {
        let client = Client::for_account(config, slug, &global.agent)?;
        let mut view: SpaceView = client.space().map_err(refusal)?;
        if view.space.slug.is_empty() {
            view.space.slug = slug.clone();
        }
        views.push(view);
    }
    if global.json {
        return match views.as_slice() {
            [one] => print_json(one),
            _ => print_json(&json!({"spaces": views})),
        };
    }
    let several = views.len() > 1;
    for view in &views {
        if several {
            out!("{} ({})", view.space.name, view.space.slug);
        }
        for line in project_lines(view) {
            out!("{line}");
        }
    }
    Ok(())
}

fn project_add(config: &mut Config, global: &Global, raw: &str) -> Result<(), String> {
    let name = crate::card::project(raw)?;
    let (client, account) = client_for(config, global, None)?;
    let reply = client.add_project(&name).map_err(refusal)?;
    let made = reply["project"]["name"]
        .as_str()
        .or(reply["project"].as_str())
        .unwrap_or(&name)
        .to_owned();
    if let Some(space) = config.accounts.get_mut(&account)
        && space.project_named(&made).is_none()
    {
        space.projects.insert(made.clone(), Vec::new());
        config.save()?;
    }
    if global.json {
        return print_json(&json!({
            "project": reply["project"],
            "space": super::space_ref(config, &account),
        }));
    }
    out!("added the project {made} to {account}");
    Ok(())
}

fn project_rename(
    config: &mut Config,
    global: &Global,
    old: &str,
    new: &str,
) -> Result<(), String> {
    let old = crate::card::project(old)?;
    let new = crate::card::project(new)?;
    let (client, account) = client_for(config, global, None)?;
    let reply = client.rename_project(&old, &new).map_err(refusal)?;
    if let Some(space) = config.accounts.get_mut(&account) {
        space.rename_project(&old, &new);
        config.save()?;
    }
    if global.json {
        return print_json(&json!({
            "project": reply["project"],
            "renamed": {"from": old, "to": new},
            "space": super::space_ref(config, &account),
        }));
    }
    out!("renamed the project {old} to {new} in {account}; its cards and hosts stay with it");
    Ok(())
}

pub fn edit_project(
    config: &Config,
    global: &Global,
    raw: &str,
    host: Option<&str>,
    name: &str,
) -> Result<(), String> {
    let project = crate::card::project(name)?;
    let number = key_of(raw)?;
    let (client, _) = client_for(config, global, host)?;
    let client = client.with_host(host);
    let body = body_of(&ProjectChange { project })?;
    let pq = client.item(&number, "")?;
    let answer: Value = ask(&client, "PATCH", &pq, Some(body))?;
    if answer.get("card").is_none() {
        return Err(crate::card::NOT_YET.to_owned());
    }
    let reply: CardReply =
        serde_json::from_value(answer).map_err(|e| format!("unexpected answer: {e}"))?;
    if global.json {
        return print_json(&json!({"card": reply.card}));
    }
    out!(
        "{} is a card of {}, in {}",
        reply.card.key,
        reply.card.project,
        reply.card.label
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_792_661_100;

    fn thread() -> CardThread {
        serde_json::from_value(json!({
            "card": {"key":"FEAT-41","kind":"feature","project":"Splicer","status":"stuck","label":"Stuck","lane":3,
                "title":"Export keeps every audio track","host":"shop.example.com",
                "reporter":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},
                "created_at":"2026-10-22T08:00:00.000Z","changed_at":"2026-10-22T09:12:00.000Z",
                "changed_by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci·splicer·writer"},
                "comments":1,
                "links":[{"ref":"pci#2700","note":"Splicer export","by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"at":"2026-10-22T08:05:00.000Z"}],
                "body":"Every track.\nIn sync."},
            "comments":[{"id":1,"author":{"name":"Grace Hopper","username":"grace","agent":false,"via":null},"body":"Seen it.","internal":true,"created_at":"2026-10-22T08:30:00.000Z"}],
            "events":[
                {"kind":"project","detail":{"from":null,"to":"Splicer"},"by":{"name":"Ada Lovelace","username":"ada","agent":false,"via":null},"at":"2026-10-22T08:00:00.000Z"},
                {"kind":"label","detail":{"from":"New","to":"Stuck"},"by":{"name":"Ada Lovelace","username":"ada","agent":true,"via":"pci"},"at":"2026-10-22T09:12:00.000Z"},
                {"kind":"link","detail":{"ref":"pci#2700","note":null},"by":null,"at":"2026-10-22T08:05:00.000Z"}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn a_card_line_shows_the_last_changer_with_a_robot_and_its_age() {
        let card = &thread().card.card;
        let line = card_line(card, NOW);
        assert!(
            line.starts_with("FEAT-41  stuck       Splicer      Export keeps every audio track")
        );
        assert!(line.ends_with("Ada Lovelace 🤖 13m"), "{line}");
    }

    #[test]
    fn a_thread_shows_body_links_comments_and_events_with_agents_and_labels() {
        let lines = thread_lines(&thread(), NOW);
        let text = lines.join("\n");
        assert_eq!(lines[0], "FEAT-41  Idea  Splicer  Stuck (#3 in its lane)");
        assert_eq!(lines[1], "Export keeps every audio track");
        assert_eq!(
            lines[2],
            "filed by Ada Lovelace on shop.example.com  2026-10-22 08:00"
        );
        assert_eq!(lines[3], "changed by Ada Lovelace 🤖 13m ago");
        assert!(text.contains("\nEvery track.\nIn sync.\n"));
        assert!(text.contains("link pci#2700 (Splicer export)  Ada Lovelace 🤖 via pci"));
        assert!(text.contains("Grace Hopper  2026-10-22 08:30  internal\n  Seen it."));
        assert!(text.contains("2026-10-22 08:00  project - -> Splicer  Ada Lovelace\n"));
        assert!(text.contains("2026-10-22 09:12  lane New -> Stuck  Ada Lovelace 🤖 via pci"));
        assert!(text.ends_with("2026-10-22 08:05  linked pci#2700  P99"));
        assert!(!text.contains('*'));
    }

    #[test]
    fn a_done_card_has_no_place_and_a_fresh_change_is_just_now() {
        let mut t = thread();
        t.card.card.lane = None;
        t.card.card.status = Lane::Done;
        t.card.card.label = "Done".into();
        t.card.card.changed_at = crate::card::iso(NOW);
        t.card.card.changed_by.as_mut().unwrap().agent = false;
        t.card.body.clear();
        t.card.card.links.clear();
        t.comments.clear();
        t.events.clear();
        let lines = thread_lines(&t, NOW);
        assert_eq!(lines[0], "FEAT-41  Idea  Splicer  Done");
        assert_eq!(lines[3], "changed by Ada Lovelace just now");
        assert_eq!(lines.len(), 4);
        assert_eq!(status_text(&t.card.card), "Done (done)");
    }

    #[test]
    fn a_change_with_no_person_shows_as_p99_in_the_line_and_the_thread() {
        let mut t = thread();
        t.card.card.changed_by = None;
        let line = card_line(&t.card.card, NOW);
        assert!(
            line.ends_with("Export keeps every audio track  P99 13m"),
            "{line}"
        );
        assert_eq!(thread_lines(&t, NOW)[3], "changed by P99 13m ago");
    }

    #[test]
    fn a_status_line_names_the_label_the_word_and_the_place() {
        let card = &thread().card.card;
        assert_eq!(status_text(card), "Stuck (stuck, #3 in its lane)");
    }

    #[test]
    fn only_a_refusal_that_reflects_no_project_or_no_owner_falls_back_to_the_item_route() {
        for falls in [
            "FEAT-41 has no project of its own; give it one with p99 edit FEAT-41 --project <name> (409)",
            "BUG-12 is not a card; give it a project with p99 edit BUG-12 --project <name> (409)",
            "only an Owner may do this (403)",
            "no such route (404)",
        ] {
            assert!(not_a_card(falls), "{falls}");
        }
        for stays in [
            "this card moved; refreshed (409)",
            "client_uid is already used (409)",
            "only a person changes a grant (403)",
            "no item FEAT-99 (404)",
            "BUG-12 is not a card",
        ] {
            assert!(!not_a_card(stays), "{stays}");
        }
    }

    #[test]
    fn a_key_takes_any_key_form_and_refuses_the_rest() {
        assert_eq!(key("FEAT-41").unwrap(), "FEAT-41");
        assert_eq!(key(" 41 ").unwrap(), "41");
        assert!(key("FEAT-").is_err());
        assert!(key("../x").is_err());
        assert!(key("FE AT-1").is_err());
    }

    #[test]
    fn a_thread_of_a_card_with_no_host_says_who_filed_it_and_when_only() {
        let mut t = thread();
        t.card.card.host = String::new();
        assert_eq!(
            thread_lines(&t, NOW)[2],
            "filed by Ada Lovelace  2026-10-22 08:00"
        );
    }

    #[test]
    fn the_projects_table_lines_up_hosts_and_counts() {
        let view: SpaceView = serde_json::from_value(json!({
            "space": {"slug": "pito", "name": "PITO MD"},
            "projects": [
                {"name": "Alfred", "hosts": ["license.example.com", "dev.example.com"], "open": 2, "closed": 15},
                {"name": "Docs", "hosts": [], "open": 0, "closed": 0},
            ],
        }))
        .unwrap();
        assert_eq!(
            project_lines(&view),
            [
                format!(
                    "{:<7}  {:<36}  {:>4}  {:>6}",
                    "PROJECT", "HOSTS", "OPEN", "CLOSED"
                ),
                format!(
                    "{:<7}  {:<36}  {:>4}  {:>6}",
                    "Alfred", "license.example.com, dev.example.com", 2, 15
                ),
                format!("{:<7}  {:<36}  {:>4}  {:>6}", "Docs", "-", 0, 0),
            ]
        );
        let none = SpaceView::default();
        assert_eq!(
            project_lines(&none),
            ["no projects yet; p99 projects add <name>"]
        );
    }
}

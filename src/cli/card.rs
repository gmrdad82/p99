use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::card::{
    Card, CardEvent, CardList, CardQuery, CardReply, CardThread, CommentReply, Lane, LinkReply,
    NewCard, NewComment, NewLink, Person, ProjectChange, ProjectList, Source, StatusChange, ago,
    refusal, who,
};
use crate::cli::{EditArgs, Global, client_for, key_of, print_json, text_arg};
use crate::client::{Client, segment, uid};
use crate::config::Config;
use crate::wire::{KINDS, out};

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
        conflicts_with_all = ["project", "status", "since", "source", "host", "cursor"],
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
    #[command(about = "file a card in a project, in lane new")]
    New(CardNewArgs),
    #[command(about = "comment on a card")]
    Comment(CardCommentArgs),
    #[command(about = "move a card to a lane, at its top; only a person moves it to done")]
    Status(CardStatusArgs),
    #[command(about = "link a card to a request, a commit, a tag or a URL")]
    Link(CardLinkArgs),
}

#[derive(Debug, clap::Args)]
pub struct CardShowArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
}

#[derive(Debug, clap::Args)]
pub struct CardNewArgs {
    #[arg(long, value_name = "name", help = "the project the card belongs to")]
    pub project: String,
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
        help = "the host it sits on for the panel (the account's oldest by default)"
    )]
    pub host: Option<String>,
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
    #[arg(long, help = "for managers only")]
    pub internal: bool,
}

#[derive(Debug, clap::Args)]
pub struct CardStatusArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(value_enum, help = "the lane it moves to")]
    pub status: Lane,
    #[arg(
        long,
        value_name = "text|-",
        help = "a comment in the same write, such as why it is stuck, or - for standard input"
    )]
    pub note: Option<String>,
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

fn now() -> i64 {
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
        format!(
            "filed by {} on {}  {}",
            who(&card.reporter),
            card.host,
            crate::cli::when(&card.created_at)
        ),
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

fn oldest_host(client: &Client, account: &str) -> Result<String, String> {
    let mut hosts = client.hosts()?;
    hosts.sort_by(|a, b| (&a.created_at, &a.host).cmp(&(&b.created_at, &b.host)));
    hosts
        .into_iter()
        .next()
        .map(|h| h.host)
        .ok_or_else(|| format!("the account {account} has no host yet; p99 hosts add"))
}

fn new(config: &Config, global: &Global, args: &CardNewArgs) -> Result<(), String> {
    let project = crate::card::project(&args.project)?;
    let wanted = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let body = optional_text(&args.body)?.unwrap_or_default();
    let (client, account) = client_for(config, global, wanted.as_deref())?;
    let host = match wanted {
        Some(host) => host,
        None => oldest_host(&client, &account)?,
    };
    let request = NewCard {
        client_uid: uid(),
        project,
        title: args.title.clone(),
        body,
        kind: args.kind.clone(),
        host,
    };
    let reply: CardReply = ask(&client, "POST", "/v1/cards", Some(body_of(&request)?))?;
    if global.json {
        return print_json(&json!({"card": reply.card}));
    }
    out!(
        "{} filed in {} on {}: {}",
        reply.card.key,
        reply.card.project,
        reply.card.host,
        reply.card.title
    );
    Ok(())
}

fn comment(config: &Config, global: &Global, args: &CardCommentArgs) -> Result<(), String> {
    let key = key(&args.key)?;
    let text = text_arg(&args.text)?;
    let (client, _) = client_for(config, global, None)?;
    let request = NewComment {
        client_uid: uid(),
        body: text,
        internal: args.internal,
    };
    let reply: CommentReply = ask(
        &client,
        "POST",
        &format!("/v1/cards/{key}/comments"),
        Some(body_of(&request)?),
    )?;
    if global.json {
        return print_json(&reply);
    }
    out!(
        "commented on {}{}",
        reply.key,
        if reply.comment.internal {
            " (internal)"
        } else {
            ""
        }
    );
    Ok(())
}

fn status(config: &Config, global: &Global, args: &CardStatusArgs) -> Result<(), String> {
    let key = key(&args.key)?;
    let note = optional_text(&args.note)?;
    let (client, _) = client_for(config, global, None)?;
    let request = StatusChange {
        status: args.status,
        note,
        client_uid: uid(),
    };
    let reply: CardReply = ask(
        &client,
        "POST",
        &format!("/v1/cards/{key}/status"),
        Some(body_of(&request)?),
    )?;
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

pub fn projects(config: &Config, global: &Global) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let list: ProjectList = ask(&client, "GET", "/v1/projects", None)?;
    if global.json {
        return print_json(&list);
    }
    if list.projects.is_empty() {
        println!("no projects yet; p99 card new --project <name> --title <text>");
        return Ok(());
    }
    let width = list
        .projects
        .iter()
        .map(|p| p.name.chars().count())
        .max()
        .unwrap_or(7)
        .max(7);
    println!("{:<width$}  OPEN  DONE", "PROJECT");
    for project in &list.projects {
        out!(
            "{:<width$}  {:>4}  {:>4}",
            project.name,
            project.open,
            project.done
        );
    }
    Ok(())
}

pub fn edit_project(config: &Config, global: &Global, args: &EditArgs) -> Result<(), String> {
    let project = match &args.project {
        Some(name) => Some(crate::card::project(name)?),
        None => None,
    };
    let number = key_of(&args.key)?;
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let client = client.with_host(args.host.as_deref());
    let body = body_of(&ProjectChange {
        project: project.clone(),
    })?;
    let pq = client.item(&number, "")?;
    if project.is_some() {
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
        return Ok(());
    }
    if !global.json {
        let before: Value = ask(&client, "GET", &pq, None)?;
        match before["issue"].get("project") {
            None => return Err(crate::card::NOT_YET.to_owned()),
            Some(Value::Null) => {
                out!(
                    "{} is not a card",
                    before["issue"]["key"].as_str().unwrap_or(&args.key)
                );
                return Ok(());
            }
            Some(_) => {}
        }
    }
    let answer: Value = ask(&client, "PATCH", &pq, Some(body))?;
    if answer.get("project").is_none() {
        return Err(crate::card::NOT_YET.to_owned());
    }
    let issue: crate::wire::Issue =
        serde_json::from_value(answer).map_err(|e| format!("unexpected answer: {e}"))?;
    if global.json {
        return print_json(&issue);
    }
    out!("{} is a plain item again, back in Inbox", issue.key);
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
    fn a_key_takes_any_key_form_and_refuses_the_rest() {
        assert_eq!(key("FEAT-41").unwrap(), "FEAT-41");
        assert_eq!(key(" 41 ").unwrap(), "41");
        assert!(key("FEAT-").is_err());
        assert!(key("../x").is_err());
        assert!(key("FE AT-1").is_err());
    }
}

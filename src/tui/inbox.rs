use std::process::{Command, Stdio};
use std::time::Duration;

use pito_tui::clock::{self, Units};
use pito_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use pito_tui::footer::{Edit, Hint, Input, InputBar, Tone};
use pito_tui::list::{Cell, Column, Row};
use pito_tui::ratatui::{
    Frame,
    layout::Rect,
    style::Style,
    text::{Line, Span},
};
use pito_tui::{Cx, Filter, Job, Palette, Phase, Pick, Screen, Turn, message, text};

use crate::wire::{self, Change, Issue, Summary, Thread, kind_word, status_text, status_word};

use super::Msg;
use super::deck::Move;
use super::source::{Entry, Source, hits, merged_hosts, person, unix, words};

const COLUMNS_ALL: [Column; 8] = [
    Column::new("", 1, 1).pinned(),
    Column::new("Key", 6, 8).pinned(),
    Column::new("Kind", 4, 11).priority(2),
    Column::new("Label", 6, 11).pinned(),
    Column::new("Title", 16, 0).flex(),
    Column::new("Host", 10, 17).priority(1),
    Column::new("Reporter", 10, 22).priority(2),
    Column::new("Updated", 4, 7).right().pinned(),
];

const COLUMNS_ONE: [Column; 7] = [
    Column::new("", 1, 1).pinned(),
    Column::new("Key", 6, 8).pinned(),
    Column::new("Kind", 4, 11).priority(2),
    Column::new("Label", 6, 11).pinned(),
    Column::new("Title", 16, 0).flex(),
    Column::new("Reporter", 10, 22).priority(1),
    Column::new("Updated", 4, 7).right().pinned(),
];

fn production(env: &str) -> bool {
    env.is_empty() || env == "production"
}

const SCROLL_PAGE: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shown {
    Open,
    Closed,
    Any,
}

impl Shown {
    fn next(self) -> Shown {
        match self {
            Shown::Open => Shown::Closed,
            Shown::Closed => Shown::Any,
            Shown::Any => Shown::Open,
        }
    }

    fn word(self) -> &'static str {
        match self {
            Shown::Open => "open",
            Shown::Closed => "closed",
            Shown::Any => "open or closed",
        }
    }

    fn keeps(self, closed: bool) -> bool {
        match self {
            Shown::Open => !closed,
            Shown::Closed => closed,
            Shown::Any => true,
        }
    }
}

const DROP: &str = "Drop (close without fixing)";
const DUPLICATE: &str = "Duplicate of…";

enum Picking {
    Host,
    Assign(Vec<Option<String>>),
    Move(Vec<String>),
}

enum Typing {
    Reply(Input),
    Duplicate(Input),
    Delete(Input, String),
}

#[derive(Clone, Copy)]
enum Asked {
    Status,
    Label,
}

struct Open {
    key: String,
    account: usize,
    host: Option<String>,
    entry: Option<usize>,
    thread: Option<Thread>,
    error: Option<String>,
    scroll: usize,
    lines: Option<(u16, Vec<Line<'static>>)>,
    typing: Option<Typing>,
    internal: bool,
    sending: bool,
    asked: Asked,
}

pub struct Inbox {
    source: Source,
    palette: Palette,
    units: Units,
    entries: Option<Vec<Entry>>,
    error: Option<String>,
    stopped: bool,
    filter: Filter,
    hosts: Vec<String>,
    host: Option<String>,
    shown: Shown,
    counts: (usize, usize),
    now: i64,
    picking: Option<Picking>,
    open: Option<Open>,
    following: bool,
    refreshing: bool,
    again: bool,
}

impl Inbox {
    pub fn new(source: Source, palette: Palette) -> Inbox {
        Inbox {
            now: source.now(),
            hosts: source.hosts(),
            source,
            palette,
            units: Units::new("s", "m", "h", "d").year("y").now("now"),
            entries: None,
            error: None,
            stopped: false,
            filter: Filter::new("Filter")
                .placeholder("type to filter by key, title, page, host or person")
                .hint("enter keeps the filter · esc clears it"),
            host: None,
            shown: Shown::Open,
            counts: (0, 0),
            picking: None,
            open: None,
            following: false,
            refreshing: false,
            again: false,
        }
    }

    fn refresh(&mut self, cx: &mut Cx<'_, Msg>) {
        if self.entries.is_none() {
            return;
        }
        if self.refreshing {
            self.again = true;
            return;
        }
        self.refreshing = true;
        let source = self.source.clone();
        cx.detach(move || Msg::Inbox(source.inbox()));
    }

    fn pushed(&mut self, account: usize, key: Option<String>, cx: &mut Cx<'_, Msg>) {
        self.refresh(cx);
        let reread = self.open.as_ref().is_some_and(|open| {
            !open.sending && open.account == account && key.as_deref() == Some(open.key.as_str())
        });
        if reread {
            self.read_thread(cx);
        }
    }

    fn keep(&mut self, kept: Option<(usize, String)>) {
        let (Some((account, key)), Some(entries)) = (kept, &self.entries) else {
            return;
        };
        let at = self.filter.shown().iter().position(|&index| {
            entries
                .get(index)
                .is_some_and(|e| e.account == account && e.summary.key == key)
        });
        if let Some(at) = at {
            self.filter.list_mut().select(at);
        }
    }

    fn ago(&self, stamp: &str) -> String {
        match unix(stamp) {
            Some(at) => clock::age(
                Duration::from_secs(self.now.saturating_sub(at).max(0) as u64),
                &self.units,
            ),
            None => String::new(),
        }
    }

    fn sift(&mut self) {
        let entries = self.entries.take().unwrap_or_default();
        let words = words(self.filter.query());
        let mut filter = std::mem::replace(&mut self.filter, Filter::new(""));
        let host = self.host.clone();
        let shown = self.shown;
        let palette = &self.palette;
        let this = &*self;
        let keeps = |entry: &Entry, _: &str| {
            let item = &entry.summary;
            shown.keeps(closed(item.resolution.as_deref(), &item.status))
                && host.as_ref().is_none_or(|h| item.host.as_ref() == Some(h))
                && hits(&entry.haystack, &words)
        };
        let all_hosts = self.host.is_none();
        let line = |entry: &Entry| {
            let item = &entry.summary;
            let mark = if item.unread { "•" } else { "" };
            let mut cells = vec![
                Cell::new(mark).style(palette.accent),
                Cell::new(item.key.as_str()).style(palette.strong),
                Cell::new(kind_word(&item.kind)).faint(),
                Cell::new(label_text(item)).style(label_style(palette, item)),
                Cell::new(item.title.as_str()),
            ];
            if all_hosts {
                let tone = if production(&item.env) {
                    palette.accent
                } else {
                    palette.warn
                };
                cells.push(Cell::new(item.host.as_deref().unwrap_or("")).style(tone));
            }
            cells.push(Cell::new(person(
                &item.reporter.name,
                &item.reporter.email,
                item.reporter.agent,
            )));
            cells.push(Cell::new(this.ago(&item.updated_at)).faint());
            Row::new(cells)
        };
        filter.sift(&entries, keeps, line);
        self.counts = entries
            .iter()
            .filter(|e| {
                host.as_ref()
                    .is_none_or(|h| e.summary.host.as_ref() == Some(h))
            })
            .fold((0, 0), |(all, unread), e| {
                (all + 1, unread + usize::from(e.summary.unread))
            });
        self.filter = filter;
        self.entries = Some(entries);
    }

    fn summary_from(&mut self, at: Option<usize>, issue: &Issue) {
        let Some(entry) = at.and_then(|at| self.entries.as_mut()?.get_mut(at)) else {
            return;
        };
        let summary = &mut entry.summary;
        summary.status = issue.status.clone();
        summary.resolution = issue.resolution.clone();
        summary.board = issue.board.clone();
        summary.position = issue.position;
        summary.kind = issue.kind.clone();
        summary.title = issue.title.clone();
        summary.assignee = issue.assignee.clone();
        summary.updated_at = issue.updated_at.clone();
        summary.comments = issue.comments;
        summary.unread = false;
        summary.landing = issue.landing.clone();
        summary.label = issue.label.clone();
        entry.refold();
    }

    fn open_at(&mut self, index: usize, cx: &mut Cx<'_, Msg>) {
        let Some(entry) = self.entries.as_mut().and_then(|e| e.get_mut(index)) else {
            return;
        };
        entry.summary.unread = false;
        let key = entry.summary.key.clone();
        let account = entry.account;
        let host = entry.summary.host.clone();
        self.open = Some(Open {
            key: key.clone(),
            account,
            host,
            entry: Some(index),
            thread: None,
            error: None,
            scroll: 0,
            lines: None,
            typing: None,
            internal: false,
            sending: false,
            asked: Asked::Status,
        });
        self.sift();
        self.read_thread(cx);
    }

    pub(super) fn open_key(
        &mut self,
        account: usize,
        host: Option<String>,
        key: String,
        cx: &mut Cx<'_, Msg>,
    ) {
        self.open = Some(Open {
            key,
            account,
            host,
            entry: None,
            thread: None,
            error: None,
            scroll: 0,
            lines: None,
            typing: None,
            internal: false,
            sending: false,
            asked: Asked::Status,
        });
        self.read_thread(cx);
    }

    fn read_thread(&self, cx: &mut Cx<'_, Msg>) {
        let Some(open) = &self.open else { return };
        let (source, key, account, host) = (
            self.source.clone(),
            open.key.clone(),
            open.account,
            open.host.clone(),
        );
        cx.detach(move || {
            let result = source.thread(account, host.as_deref(), &key);
            Msg::Thread(key, result)
        });
    }

    fn change(&mut self, change: Change, cx: &mut Cx<'_, Msg>) {
        let Some(open) = &mut self.open else { return };
        open.sending = true;
        open.asked = Asked::Status;
        let (source, key, account, host) = (
            self.source.clone(),
            open.key.clone(),
            open.account,
            open.host.clone(),
        );
        cx.detach(move || {
            let result = source.change(account, host.as_deref(), &key, &change);
            Msg::Changed(key, result)
        });
    }

    fn relabel(&mut self, to: String, cx: &mut Cx<'_, Msg>) {
        let Some(issue) = self.issue() else { return };
        let request = Move {
            key: issue.key.clone(),
            from: issue_label(issue),
            to,
            ..Move::default()
        };
        let Some(open) = &mut self.open else { return };
        open.sending = true;
        open.asked = Asked::Label;
        let (source, key, account, host) = (
            self.source.clone(),
            open.key.clone(),
            open.account,
            open.host.clone(),
        );
        cx.detach(move || {
            let result = source
                .shift(account, &request)
                .and_then(|_| source.thread(account, host.as_deref(), &key))
                .map(|thread| thread.issue);
            Msg::Changed(key, result)
        });
    }

    fn reply(&mut self, body: String, cx: &mut Cx<'_, Msg>) {
        let Some(open) = &mut self.open else { return };
        open.sending = true;
        let internal = open.internal;
        let (source, key, account, host) = (
            self.source.clone(),
            open.key.clone(),
            open.account,
            open.host.clone(),
        );
        cx.detach(move || {
            let result = source.comment(account, host.as_deref(), &key, &body, internal);
            Msg::Commented(key, result.map(|_| internal))
        });
    }

    fn delete(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(open) = &mut self.open else { return };
        open.sending = true;
        let (source, key, account, host) = (
            self.source.clone(),
            open.key.clone(),
            open.account,
            open.host.clone(),
        );
        cx.detach(move || {
            let result = source.delete(account, host.as_deref(), &key);
            Msg::Deleted(key, result)
        });
    }

    fn drop_entry(&mut self, account: usize, key: &str) {
        let kept = self
            .filter
            .current()
            .and_then(|at| self.entries.as_ref()?.get(at))
            .map(|e| (e.account, e.summary.key.clone()));
        let Some(entries) = &mut self.entries else {
            return;
        };
        let before = entries.len();
        entries.retain(|e| !(e.account == account && e.summary.key == key));
        if entries.len() == before {
            return;
        }
        if let Some(open) = &mut self.open {
            open.entry = entries
                .iter()
                .position(|e| e.account == open.account && e.summary.key == open.key);
        }
        self.sift();
        self.keep(kept);
    }

    fn heard(&mut self, account: usize, text: &str, cx: &mut Cx<'_, Msg>) {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        let (Some("delete"), Some(key)) = (event["type"].as_str(), event["key"].as_str()) else {
            return;
        };
        self.drop_entry(account, key);
        let reading = self
            .open
            .as_ref()
            .is_some_and(|o| o.account == account && o.key == key && !o.sending);
        if reading {
            self.open = None;
            let by = &event["by"];
            let name = by["name"].as_str().unwrap_or("Someone");
            let star = if by["agent"].as_bool().unwrap_or(false) {
                "*"
            } else {
                ""
            };
            cx.say(format!("{name}{star} deleted {key}"), Tone::Alert);
        }
    }

    fn pick_host(&mut self, cx: &mut Cx<'_, Msg>) {
        let mut options = vec!["All hosts".to_owned()];
        options.extend(self.hosts.iter().cloned());
        let at = self
            .host
            .as_ref()
            .and_then(|h| self.hosts.iter().position(|x| x == h))
            .map_or(0, |at| at + 1);
        self.picking = Some(Picking::Host);
        cx.pick(Pick::new("Host", options).selected(at).hints(pick_hints()));
    }

    fn pick_assignee(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(thread) = self.open.as_ref().and_then(|o| o.thread.as_ref()) else {
            return;
        };
        let current = thread.issue.assignee.as_ref().map(|a| a.username.clone());
        let mut people: Vec<(Option<String>, String)> =
            vec![(None, "Nobody".into()), (Some("me".into()), "Me".into())];
        for name in thread
            .people
            .iter()
            .map(|m| &m.username)
            .chain(current.as_ref())
        {
            if !people.iter().any(|(u, _)| u.as_ref() == Some(name)) {
                people.push((Some(name.clone()), format!("@{name}")));
            }
        }
        let at = people
            .iter()
            .position(|(u, _)| u.is_some() && *u == current)
            .unwrap_or(0);
        let (usernames, labels): (Vec<_>, Vec<_>) = people.into_iter().unzip();
        self.picking = Some(Picking::Assign(usernames));
        cx.pick(
            Pick::new("Assign to", labels)
                .selected(at)
                .hints(pick_hints()),
        );
    }

    fn pick_label(&mut self, cx: &mut Cx<'_, Msg>) {
        let Some(account) = self.open.as_ref().map(|o| o.account) else {
            return;
        };
        let source = self.source.clone();
        cx.detach(move || Msg::Labels(source.labels(account)));
    }

    fn offer_labels(&mut self, labels: Vec<String>, cx: &mut Cx<'_, Msg>) {
        let Some(issue) = self.issue() else { return };
        if labels.is_empty() {
            cx.say("No board of yours has a label yet.", Tone::Muted);
            return;
        }
        let at = labels
            .iter()
            .position(|l| *l == issue_label(issue))
            .unwrap_or(0);
        let mut options = labels.clone();
        options.extend([DROP.to_owned(), DUPLICATE.to_owned()]);
        self.picking = Some(Picking::Move(labels));
        cx.pick(Pick::new("Move to", options).selected(at).hints(pick_hints()));
    }

    fn issue(&self) -> Option<&Issue> {
        Some(&self.open.as_ref()?.thread.as_ref()?.issue)
    }

    fn browse(&self, cx: &mut Cx<'_, Msg>) {
        let Some(issue) = self.issue() else { return };
        let url = issue.page.url.clone();
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            cx.say("This item has no page to open.", Tone::Alert);
            return;
        }
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        let spawned = Command::new(opener)
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        match spawned {
            Ok(_) => cx.say(format!("Opened {url}"), Tone::Muted),
            Err(error) => cx.say(format!("{opener}: {error}"), Tone::Alert),
        }
    }

    fn thread_key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        let Some(open) = &mut self.open else { return };
        if let Some(typing) = &mut open.typing {
            let input = match typing {
                Typing::Reply(input) | Typing::Duplicate(input) | Typing::Delete(input, _) => input,
            };
            match input.key(key.into()) {
                Edit::Submit(value) => {
                    let value = value.trim().to_owned();
                    let reply = matches!(typing, Typing::Reply(_));
                    let delete = matches!(typing, Typing::Delete(..));
                    open.typing = None;
                    if value.is_empty() {
                        return;
                    }
                    if delete {
                        if value.eq_ignore_ascii_case(&open.key) {
                            self.delete(cx);
                        } else {
                            cx.say(
                                format!("{} is kept: the key typed back didn't match", open.key),
                                Tone::Muted,
                            );
                        }
                    } else if reply {
                        self.reply(value, cx);
                    } else {
                        let of = value.to_uppercase();
                        self.change(
                            Change {
                                duplicate_of: Some(of),
                                ..Change::default()
                            },
                            cx,
                        );
                    }
                }
                Edit::Cancel => open.typing = None,
                _ => {}
            }
            return;
        }
        let ready = open.thread.is_some() && !open.sending;
        let scroll = &mut open.scroll;
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => *scroll += 1,
            KeyCode::PageUp => *scroll = scroll.saturating_sub(SCROLL_PAGE),
            KeyCode::PageDown | KeyCode::Char(' ') => *scroll += SCROLL_PAGE,
            KeyCode::Home | KeyCode::Char('g') => *scroll = 0,
            KeyCode::End | KeyCode::Char('G') => *scroll = usize::MAX,
            KeyCode::Char('i') => open.internal = !open.internal,
            KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.read_thread(cx);
            }
            KeyCode::Char('r') if ready => open.typing = Some(Typing::Reply(Input::new())),
            KeyCode::Char('a') if ready => self.pick_assignee(cx),
            KeyCode::Char('m') if ready => self.pick_label(cx),
            KeyCode::Char('o') => self.browse(cx),
            KeyCode::Char('d') if ready => {
                let prompt = format!("type {} to delete it", open.key);
                open.typing = Some(Typing::Delete(Input::new(), prompt));
            }
            _ => {}
        }
    }

    fn draw_thread(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        let now = self.now;
        let units = &self.units;
        let Some(open) = &mut self.open else { return };
        let Some(thread) = &open.thread else {
            let lines = match &open.error {
                Some(error) => vec![
                    Line::styled(format!("Couldn't read {}.", open.key), palette.bad),
                    Line::styled(error.clone(), palette.muted),
                    Line::default(),
                    Line::styled("ctrl+r reads it again · esc goes back", palette.muted),
                ],
                None => vec![Line::styled(
                    format!("Reading {}…", open.key),
                    palette.muted,
                )],
            };
            message(frame, area, lines);
            return;
        };
        let width = area.width.saturating_sub(1).max(20);
        if open.lines.as_ref().is_none_or(|(w, _)| *w != width) {
            open.lines = Some((width, lines(thread, width, palette, now, units)));
        }
        let Some((_, lines)) = &open.lines else {
            return;
        };
        let height = usize::from(area.height);
        let last = lines.len().saturating_sub(height);
        open.scroll = open.scroll.min(last);
        for (row, line) in lines.iter().skip(open.scroll).take(height).enumerate() {
            frame
                .buffer_mut()
                .set_line(area.x, area.y + row as u16, line, area.width);
        }
        if lines.len() > height && area.width > 0 {
            let thumb = (height * height / lines.len()).max(1);
            let top = ((height - thumb) * open.scroll)
                .checked_div(last)
                .unwrap_or(0);
            let x = area.x + area.width - 1;
            for row in 0..height {
                let lit = row >= top && row < top + thumb;
                let symbol = if lit { "┃" } else { "│" };
                let style = if lit { palette.accent } else { palette.rule };
                frame
                    .buffer_mut()
                    .set_string(x, area.y + row as u16, symbol, style);
            }
        }
    }
}

fn pick_hints() -> [Hint<'static>; 3] {
    [
        Hint::new("↑↓", "move"),
        Hint::new("enter", "choose"),
        Hint::new("esc", "cancel"),
    ]
}

fn closed(resolution: Option<&str>, status: &str) -> bool {
    resolution.is_some() || (!status.is_empty() && !wire::open(status))
}

fn label_text(item: &Summary) -> &str {
    item.label
        .as_deref()
        .unwrap_or_else(|| status_text(&item.status, item.resolution.as_deref()))
}

fn issue_label(issue: &Issue) -> String {
    issue
        .label
        .clone()
        .unwrap_or_else(|| status_word(&issue.status).to_owned())
}

fn state(issue: &Issue) -> String {
    match issue.resolution.as_deref().filter(|r| *r != "fixed") {
        Some(resolution) => format!(
            "{} ({})",
            issue_label(issue),
            wire::resolution_word(resolution).to_lowercase()
        ),
        None => issue_label(issue),
    }
}

fn label_style(palette: &Palette, item: &Summary) -> Style {
    if closed(item.resolution.as_deref(), &item.status) {
        palette.good
    } else if label_text(item) == "Inbox" {
        palette.accent
    } else {
        palette.strong
    }
}

fn status_style(palette: &Palette, status: &str) -> Style {
    match status {
        "inbox" => palette.accent,
        "doing" => palette.strong,
        "review" => palette.warn,
        "done" => palette.good,
        _ => palette.muted,
    }
}

fn lines(
    thread: &Thread,
    width: u16,
    palette: &Palette,
    now: i64,
    units: &Units,
) -> Vec<Line<'static>> {
    let width = usize::from(width);
    let ago = |stamp: &str| match unix(stamp) {
        Some(at) => clock::age(
            Duration::from_secs(now.saturating_sub(at).max(0) as u64),
            units,
        ),
        None => stamp.to_owned(),
    };
    let since = |stamp: &str| match ago(stamp) {
        text if text == "now" => "just now".to_owned(),
        text => format!("{text} ago"),
    };
    let issue = &thread.issue;
    let reporter = &issue.reporter;
    let who = person(
        reporter["name"].as_str().unwrap_or_default(),
        reporter["email"].as_str().unwrap_or_default(),
        reporter["agent"].as_bool().unwrap_or(false),
    );
    let dot = || Span::styled(" · ", palette.muted);
    let mut out: Vec<Line<'static>> = Vec::new();
    for (at, part) in text::wrap(&issue.title, width.saturating_sub(issue.key.len() + 2))
        .into_iter()
        .enumerate()
    {
        let lead = if at == 0 {
            Span::styled(format!("{}  ", issue.key), palette.strong)
        } else {
            Span::raw(" ".repeat(issue.key.len() + 2))
        };
        out.push(Line::from(vec![lead, Span::styled(part, palette.selected)]));
    }
    let mut facts = vec![
        Span::styled(kind_word(&issue.kind).to_owned(), palette.ink),
        dot(),
        Span::styled(
            match &issue.label {
                Some(label) => label.clone(),
                None => status_text(&issue.status, issue.resolution.as_deref()).to_owned(),
            },
            status_style(palette, &issue.status),
        ),
    ];
    if let (Some(_), Some(resolution)) = (&issue.label, issue.resolution.as_deref())
        && resolution != "fixed"
    {
        facts.push(Span::styled(
            format!(" ({})", wire::resolution_word(resolution).to_lowercase()),
            palette.muted,
        ));
    }
    if let Some(of) = &issue.duplicate_of {
        facts.push(Span::styled(format!(", merged into {of}"), palette.muted));
    }
    if let Some(host) = &issue.host {
        let tone = if production(&issue.env) {
            palette.accent
        } else {
            palette.warn
        };
        facts.push(dot());
        facts.push(Span::styled("host ", palette.muted));
        facts.push(Span::styled(host.clone(), tone));
        if !issue.env.is_empty() {
            facts.push(Span::styled(" · ", palette.muted));
            facts.push(Span::styled(issue.env.clone(), tone));
        }
    }
    out.push(Line::from(facts));
    out.push(Line::from(vec![
        Span::styled(issue.page.path.clone(), palette.ink),
        dot(),
        match &issue.assignee {
            Some(to) => Span::styled(format!("assigned to {to}"), palette.ink),
            None => Span::styled("unassigned", palette.muted),
        },
    ]));
    out.push(Line::from(vec![
        Span::styled(who, palette.strong),
        Span::styled(
            format!(" reported it {}", since(&issue.created_at)),
            palette.muted,
        ),
        dot(),
        Span::styled(
            format!("updated {}", since(&issue.updated_at)),
            palette.muted,
        ),
    ]));
    out.push(Line::default());
    for paragraph in issue.body.lines() {
        if paragraph.trim().is_empty() {
            out.push(Line::default());
        }
        for part in text::wrap(paragraph, width.saturating_sub(2)) {
            out.push(Line::styled(format!("  {part}"), palette.ink));
        }
    }
    out.push(Line::default());
    let mut landing = vec![Span::styled("Landed  ", palette.strong)];
    if issue.landing.envs.is_empty() {
        landing.push(Span::styled(
            if issue.landing.branch {
                "on a branch only"
            } else {
                "nowhere yet"
            },
            palette.muted,
        ));
    }
    for (at, env) in issue.landing.envs.iter().enumerate() {
        if at > 0 {
            landing.push(dot());
        }
        landing.push(Span::styled(env.env.clone(), palette.good));
        let mut detail = format!(" {}", since(&env.at));
        if let Some(version) = &env.version {
            detail.push_str(&format!(" {version}"));
        }
        if !env.sha.is_empty() {
            detail.push_str(&format!(" {}", env.sha.chars().take(7).collect::<String>()));
        }
        landing.push(Span::styled(detail, palette.muted));
    }
    out.push(Line::from(landing));
    for link in &issue.github {
        out.push(Line::from(vec![
            Span::styled("GitHub  ", palette.strong),
            Span::styled(link.url.clone(), palette.accent),
            Span::styled(format!(" {}", link.rel), palette.muted),
        ]));
    }
    if !issue.merged.is_empty() {
        out.push(Line::default());
        out.push(Line::styled(
            format!("Merged here ({})", issue.merged.len()),
            palette.strong,
        ));
        for merged in &issue.merged {
            let reporter = person(
                merged.reporter["name"].as_str().unwrap_or_default(),
                merged.reporter["email"].as_str().unwrap_or_default(),
                merged.reporter["agent"].as_bool().unwrap_or(false),
            );
            let lead = format!("  {}  ", merged.key);
            let indent = lead.chars().count();
            let mut parts = text::wrap(
                &merged.title,
                width.saturating_sub(indent + reporter.chars().count() + 3),
            )
            .into_iter();
            let first = parts.next().unwrap_or_default();
            out.push(Line::from(vec![
                Span::styled(lead, palette.strong),
                Span::styled(first, palette.ink),
                dot(),
                Span::styled(reporter, palette.muted),
            ]));
            for part in parts {
                out.push(Line::styled(
                    format!("{}{part}", " ".repeat(indent)),
                    palette.ink,
                ));
            }
        }
    }
    out.push(Line::default());
    out.push(Line::styled(
        format!("Comments ({})", thread.comments.len()),
        palette.strong,
    ));
    if thread.comments.is_empty() {
        out.push(Line::styled("  none yet", palette.muted));
    }
    for comment in &thread.comments {
        let author = &comment.author;
        let mut head = vec![Span::styled(
            person(&author.name, &author.email, author.agent),
            if author.manager {
                palette.accent
            } else {
                palette.strong
            },
        )];
        if comment.internal {
            head.push(dot());
            head.push(Span::styled("internal", palette.warn));
        }
        head.push(dot());
        head.push(Span::styled(since(&comment.created_at), palette.muted));
        out.push(Line::from(head));
        for paragraph in comment.body.lines() {
            for part in text::wrap(paragraph, width.saturating_sub(2)) {
                out.push(Line::styled(format!("  {part}"), palette.ink));
            }
        }
        out.push(Line::default());
    }
    if !thread.events.is_empty() {
        out.push(Line::styled("Events", palette.strong));
        for event in &thread.events {
            let detail = &event.detail;
            let what = match (detail.get("from"), detail.get("to")) {
                (Some(from), Some(to)) => format!(
                    "{} {} → {}",
                    event.kind,
                    plain(&event.kind, from),
                    plain(&event.kind, to)
                ),
                _ => event.kind.replace('_', " "),
            };
            let by = event
                .actor_name
                .as_deref()
                .or(event.actor.as_deref())
                .map(|a| format!(" by {a}"))
                .unwrap_or_default();
            let at = format!("  {:>4}  ", ago(&event.at));
            out.push(Line::from(vec![
                Span::styled(at, palette.muted),
                Span::styled(text::clip(&what, width.saturating_sub(8)), palette.ink),
                Span::styled(by, palette.muted),
            ]));
        }
    }
    out
}

fn plain(kind: &str, value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "nobody".into(),
        serde_json::Value::String(s) if kind == "status" => status_word(s).to_owned(),
        serde_json::Value::String(s) if kind == "kind" => kind_word(s).to_owned(),
        serde_json::Value::String(s) => s.replace('_', " "),
        other => other.to_string(),
    }
}

impl Screen<Msg> for Inbox {
    fn legend(&self) -> Option<&str> {
        Some(crate::ASK)
    }

    fn phase(&self) -> Phase<'_> {
        if self.open.is_some() || self.entries.is_some() {
            return Phase::Ready;
        }
        match (&self.error, self.stopped) {
            (Some(error), _) => Phase::Trouble(
                vec![
                    Line::from("Couldn't read the inbox."),
                    Line::from(error.as_str()),
                    Line::default(),
                    Line::from("r reads it again · p99 tui --demo shows sample data"),
                ]
                .into(),
            ),
            (None, false) => Phase::Loading("Reading the inbox…".into()),
            (None, true) => Phase::Trouble(
                vec![
                    Line::from("Stopped waiting for the inbox."),
                    Line::from("r reads it again."),
                ]
                .into(),
            ),
        }
    }

    fn load(&mut self) -> Option<Job<Msg>> {
        self.entries = None;
        self.error = None;
        self.stopped = false;
        let source = self.source.clone();
        Some(Box::new(move || Msg::Inbox(source.inbox())))
    }

    fn loaded(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.event(event, cx);
    }

    fn cancel(&mut self) {
        self.stopped = true;
    }

    fn event(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        match event {
            Msg::Inbox(result) => {
                let refreshed = std::mem::take(&mut self.refreshing);
                match result {
                    Ok(entries) => {
                        let kept = self
                            .filter
                            .current()
                            .and_then(|at| self.entries.as_ref()?.get(at))
                            .map(|e| (e.account, e.summary.key.clone()));
                        self.hosts = merged_hosts(self.source.hosts(), &entries);
                        self.now = self.source.now();
                        if let Some(open) = &mut self.open {
                            open.entry = entries.iter().position(|e| {
                                e.account == open.account && e.summary.key == open.key
                            });
                        }
                        self.entries = Some(entries);
                        self.sift();
                        self.keep(kept);
                        if !self.following && !self.source.is_demo() {
                            self.following = true;
                            self.source.follow(&cx.waker());
                        }
                    }
                    Err(_) if refreshed && self.entries.is_some() => {}
                    Err(error) => self.error = Some(error),
                }
                if refreshed && std::mem::take(&mut self.again) {
                    self.refresh(cx);
                }
            }
            Msg::Pushed(account, key) => self.pushed(account, key, cx),
            Msg::Labels(Ok(labels)) => self.offer_labels(labels, cx),
            Msg::Labels(Err(error)) => cx.say(error, Tone::Alert),
            Msg::Heard(account, text) => self.heard(account, &text, cx),
            Msg::Deleted(key, result) => {
                let Some(open) = self.open.as_mut().filter(|o| o.key == key) else {
                    return;
                };
                open.sending = false;
                match result {
                    Ok(done) => {
                        let account = open.account;
                        self.open = None;
                        self.drop_entry(account, &key);
                        let mut said = format!("Deleted {key}");
                        if done.files > 0 {
                            said.push_str(&format!(" and its {} files", done.files));
                        }
                        if !done.unlinked.is_empty() {
                            said.push_str(&format!(
                                "; {} back in the inbox",
                                done.unlinked.join(", ")
                            ));
                            self.refresh(cx);
                        }
                        cx.say(said, Tone::Good);
                    }
                    Err(error) => cx.say(error, Tone::Alert),
                }
            }
            Msg::Thread(key, result) => {
                let Some(open) = self.open.as_mut().filter(|o| o.key == key) else {
                    return;
                };
                open.sending = false;
                match result {
                    Ok(thread) => {
                        let at = open.entry;
                        let issue = thread.issue.clone();
                        open.thread = Some(thread);
                        open.error = None;
                        open.lines = None;
                        self.summary_from(at, &issue);
                        self.sift();
                    }
                    Err(error) => open.error = Some(error),
                }
            }
            Msg::Commented(key, result) => {
                let Some(open) = self.open.as_mut().filter(|o| o.key == key) else {
                    return;
                };
                open.sending = false;
                match result {
                    Ok(internal) => {
                        open.scroll = usize::MAX;
                        let word = if internal {
                            "Internal note added"
                        } else {
                            "Replied"
                        };
                        cx.say(format!("{word} on {key}"), Tone::Good);
                        self.read_thread(cx);
                    }
                    Err(error) => cx.say(error, Tone::Alert),
                }
            }
            Msg::Changed(key, result) => {
                let Some(open) = self.open.as_mut().filter(|o| o.key == key) else {
                    return;
                };
                open.sending = false;
                match result {
                    Ok(issue) => {
                        let at = open.entry;
                        let said = match open.asked {
                            Asked::Status => format!("{key} is {}", state(&issue)),
                            Asked::Label => format!("{key} moved to {}", issue_label(&issue)),
                        };
                        cx.say(said, Tone::Good);
                        self.summary_from(at, &issue);
                        self.sift();
                        self.read_thread(cx);
                    }
                    Err(error) => cx.say(error, Tone::Alert),
                }
            }
            _ => {}
        }
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        if self.open.is_some() {
            self.thread_key(key, cx);
            return;
        }
        if self.entries.is_none() {
            if key.code == KeyCode::Char('r') {
                cx.reload();
            }
            return;
        }
        match self.filter.key(key) {
            Turn::Filtered => self.sift(),
            Turn::Open(index) => self.open_at(index, cx),
            Turn::Pass => match key.code {
                KeyCode::Char('r') => cx.reload(),
                KeyCode::Char('s') => {
                    self.shown = self.shown.next();
                    self.sift();
                }
                KeyCode::Char('h') => self.pick_host(cx),
                _ => {}
            },
            _ => {}
        }
    }

    fn picked(&mut self, choice: Option<usize>, cx: &mut Cx<'_, Msg>) {
        let (Some(picking), Some(choice)) = (self.picking.take(), choice) else {
            return;
        };
        match picking {
            Picking::Host => {
                self.host = choice
                    .checked_sub(1)
                    .and_then(|at| self.hosts.get(at).cloned());
                self.sift();
            }
            Picking::Move(labels) => {
                let Some(to) = labels.get(choice).cloned() else {
                    match choice - labels.len() {
                        0 if self.issue().is_some_and(|i| i.resolution.is_none()) => self.change(
                            Change {
                                resolution: Some("abandoned".into()),
                                ..Change::default()
                            },
                            cx,
                        ),
                        1 => {
                            if let Some(open) = &mut self.open {
                                open.typing = Some(Typing::Duplicate(Input::new()));
                            }
                        }
                        _ => {}
                    }
                    return;
                };
                if self.issue().is_some_and(|i| issue_label(i) == to) {
                    return;
                }
                self.relabel(to, cx);
            }
            Picking::Assign(people) => {
                let Some(to) = people.get(choice).cloned() else {
                    return;
                };
                if self
                    .issue()
                    .is_some_and(|i| i.assignee.as_ref().map(|a| &a.username) == to.as_ref())
                {
                    return;
                }
                self.change(
                    Change {
                        assignee: Some(to),
                        ..Change::default()
                    },
                    cx,
                );
            }
        }
    }

    fn back(&mut self, _cx: &mut Cx<'_, Msg>) {
        self.open = None;
    }

    fn crumb(&self) -> Option<String> {
        self.open.as_ref().map(|open| open.key.clone())
    }

    fn selected(&self) -> usize {
        self.filter.list().selected().unwrap_or(0)
    }

    fn paste(&mut self, text: &str, _cx: &mut Cx<'_, Msg>) {
        if let Some(open) = &mut self.open {
            if let Some(
                Typing::Reply(input) | Typing::Duplicate(input) | Typing::Delete(input, _),
            ) = &mut open.typing
            {
                input.paste(text);
            }
            return;
        }
        if self.filter.paste(text) == Turn::Filtered {
            self.sift();
        }
    }

    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if self.open.is_some() {
            self.draw_thread(frame, area, palette);
            return;
        }
        let columns: &[Column] = if self.host.is_none() {
            &COLUMNS_ALL
        } else {
            &COLUMNS_ONE
        };
        let view = self.filter.view(columns, palette).header(true).empty(Some(
            "Nothing here. s shows open or closed items, h other hosts.",
        ));
        frame.render_widget(view, area);
    }

    fn typing(&self) -> bool {
        match &self.open {
            Some(open) => open.typing.is_some(),
            None => self.filter.typing(),
        }
    }

    fn input(&self) -> Option<InputBar<'_>> {
        let Some(open) = &self.open else {
            return self.filter.bar();
        };
        match open.typing.as_ref()? {
            Typing::Reply(input) => {
                let label = if open.internal {
                    "Internal note"
                } else {
                    "Reply"
                };
                Some(
                    InputBar::new(label, input)
                        .placeholder("write a reply")
                        .hint("enter sends · esc cancels")
                        .tone(Tone::Accent),
                )
            }
            Typing::Duplicate(input) => Some(
                InputBar::new("Duplicate of", input)
                    .placeholder("an item key, such as BUG-11")
                    .hint("enter marks it · esc cancels")
                    .tone(Tone::Accent),
            ),
            Typing::Delete(input, prompt) => Some(
                InputBar::new("Delete for good", input)
                    .placeholder(prompt)
                    .hint("enter deletes it, its comments and files · esc keeps it")
                    .tone(Tone::Alert),
            ),
        }
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if let Some(open) = &self.open {
            if open.thread.is_none() {
                return vec![Hint::new("ctrl+r", "read again"), Hint::new("esc", "back")];
            }
            let internal = if open.internal {
                "internal on"
            } else {
                "internal off"
            };
            return vec![
                Hint::new("r", "reply"),
                Hint::new("a", "assign").rank(1),
                Hint::new("m", "move to").rank(1),
                Hint::new("i", internal).rank(2),
                Hint::new("o", "open page").rank(3),
                Hint::new("d", "delete").rank(3),
                Hint::new("↑↓", "scroll").rank(3),
                Hint::new("esc", "back"),
            ];
        }
        if self.entries.is_none() {
            return vec![Hint::new("r", "read again")];
        }
        let mut hints = vec![
            Hint::new("↑↓", "move"),
            Hint::new("enter", "open").rank(1),
            Hint::new("/", "filter").rank(1),
            Hint::new("s", "status").rank(2),
            Hint::new("h", "host").rank(2),
            Hint::new("r", "read again").rank(3),
        ];
        if self.filter.active() {
            hints.push(Hint::new("esc", "clear filter"));
        }
        hints
    }

    fn status(&self) -> Option<(String, Style)> {
        let host = self.host.as_deref().unwrap_or("All hosts");
        Some((host.to_owned(), self.palette.accent))
    }

    fn facts(&self) -> Vec<(String, Style)> {
        if self.entries.is_none() {
            return Vec::new();
        }
        let (in_scope, unread) = self.counts;
        let shown = self.filter.shown().len();
        let mut facts = vec![(self.shown.word().to_owned(), self.palette.strong)];
        facts.push((format!("{shown} of {in_scope} items"), Style::new()));
        if unread > 0 {
            facts.push((format!("{unread} unread"), self.palette.accent));
        }
        if self.source.is_demo() {
            facts.push(("sample data".to_owned(), self.palette.muted));
        }
        facts
    }
}

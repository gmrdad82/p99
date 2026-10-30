use serde_json::{Value, json};

use crate::wire::{
    self, Assignee, Attachment, Author, Change, Code, Comment, Download, Event, Issue, Landing,
    Member, PageRef, Person, Reached, Summary, Thread,
};

use super::compose::{Draft, Place};
use super::files::Upload;
use super::source::{Entry, iso};

mod boards;

pub const NOW: i64 = 1_791_979_200;
pub const SPACE: &str = "Example shop";
pub const ME: (&str, &str) = ("Ada Lovelace", "ada@example.com");
const GRACE: (&str, &str) = ("Grace Hopper", "grace@example.com");
const VIA: &str = "dispatch";

const MINUTE: i64 = 60;
const HOUR: i64 = 3600;
const DAY: i64 = 86_400;

struct Item {
    kind: &'static str,
    status: &'static str,
    resolution: Option<&'static str>,
    title: &'static str,
    host: &'static str,
    path: &'static str,
    grace: bool,
    agent: bool,
    created: i64,
    updated: i64,
    unread: bool,
    assignee: Option<&'static str>,
    body: &'static str,
}

const ITEMS: [Item; 12] = [
    Item {
        kind: "bug",
        status: "done",
        resolution: Some("abandoned"),
        title: "Logo looks blurry on older phones",
        host: "example.com",
        path: "/",
        grace: true,
        agent: false,
        created: 20 * DAY,
        updated: 15 * DAY,
        unread: false,
        assignee: None,
        body: "The logo in the header is soft on an older phone. Newer ones look fine.",
    },
    Item {
        kind: "bug",
        status: "done",
        resolution: Some("fixed"),
        title: "Broken link on the about page",
        host: "example.com",
        path: "/about",
        grace: false,
        agent: true,
        created: 12 * DAY,
        updated: 6 * DAY,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "The \"Our story\" link points to a page that no longer exists.",
    },
    Item {
        kind: "bug",
        status: "done",
        resolution: Some("fixed"),
        title: "Checkout button overlaps the price",
        host: "shop.example.com",
        path: "/checkout",
        grace: true,
        agent: false,
        created: 9 * DAY,
        updated: 2 * DAY,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "On a narrow window the Pay button covers the total, so I can't read what I'm paying.",
    },
    Item {
        kind: "improvement",
        status: "review",
        resolution: None,
        title: "Make the footer links larger",
        host: "example.com",
        path: "/",
        grace: true,
        agent: false,
        created: 6 * DAY,
        updated: DAY,
        unread: false,
        assignee: None,
        body: "The links at the bottom are hard to tap.",
    },
    Item {
        kind: "improvement",
        status: "doing",
        resolution: None,
        title: "Show delivery dates on product pages",
        host: "shop.example.com",
        path: "/products/lamp",
        grace: false,
        agent: false,
        created: 5 * DAY,
        updated: 20 * HOUR,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "Say when an order placed today would arrive, under the price.",
    },
    Item {
        kind: "task",
        status: "doing",
        resolution: None,
        title: "Move product images to the new bucket",
        host: "shop.example.com",
        path: "/",
        grace: false,
        agent: false,
        created: 4 * DAY,
        updated: 30 * MINUTE,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "Copy every product image, switch the URLs, then remove the old ones.",
    },
    Item {
        kind: "feature",
        status: "doing",
        resolution: None,
        title: "Export orders as CSV",
        host: "shop.example.com",
        path: "/orders",
        grace: true,
        agent: false,
        created: 3 * DAY,
        updated: 5 * HOUR,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "I'd like to download this month's orders for the accounts.",
    },
    Item {
        kind: "bug",
        status: "doing",
        resolution: None,
        title: "Search box loses focus on mobile",
        host: "dev.example.com",
        path: "/search",
        grace: false,
        agent: true,
        created: 2 * DAY,
        updated: 2 * HOUR,
        unread: false,
        assignee: Some("ada.lovelace"),
        body: "Typing the second letter closes the keyboard on a phone. The input is re-rendered on every key.",
    },
    Item {
        kind: "feature",
        status: "inbox",
        resolution: None,
        title: "Dark mode for the blog",
        host: "dev.example.com",
        path: "/blog",
        grace: true,
        agent: false,
        created: DAY,
        updated: DAY,
        unread: true,
        assignee: None,
        body: "Reading at night is bright. A dark theme would be lovely.",
    },
    Item {
        kind: "question",
        status: "inbox",
        resolution: None,
        title: "Is the newsletter sent every week?",
        host: "example.com",
        path: "/newsletter",
        grace: true,
        agent: false,
        created: 3 * HOUR,
        updated: 3 * HOUR,
        unread: true,
        assignee: None,
        body: "The sign-up page doesn't say how often it comes.",
    },
    Item {
        kind: "bug",
        status: "inbox",
        resolution: None,
        title: "The total does not update after removing a line",
        host: "shop.example.com",
        path: "/cart",
        grace: true,
        agent: false,
        created: 50 * MINUTE,
        updated: 12 * MINUTE,
        unread: true,
        assignee: None,
        body: "I removed the second lamp from my cart and the total still shows both. A reload fixes it.",
    },
    Item {
        kind: "bug",
        status: "done",
        resolution: Some("duplicate"),
        title: "Cart total stays the same after removing an item",
        host: "shop.example.com",
        path: "/cart",
        grace: true,
        agent: false,
        created: 40 * MINUTE,
        updated: 35 * MINUTE,
        unread: false,
        assignee: None,
        body: "Same as before, sent twice by mistake.",
    },
];

type Said = (usize, i64, bool, bool, bool, &'static str);

const COMMENTS: [Said; 12] = [
    (
        3,
        8 * DAY,
        false,
        false,
        false,
        "Thanks, I can see it at 380 pixels wide.",
    ),
    (
        3,
        3 * DAY,
        false,
        true,
        false,
        "The total is a flex child now; below 400 pixels it wraps under the Pay button. On dev for a look.",
    ),
    (
        3,
        2 * DAY,
        false,
        false,
        false,
        "Fixed and live: the button wraps under the total now.",
    ),
    (
        4,
        DAY,
        false,
        false,
        false,
        "Which links do you mean, the social ones or the menu?",
    ),
    (
        7,
        5 * HOUR,
        false,
        false,
        false,
        "Planned for this week. Which columns do you need?",
    ),
    (
        8,
        2 * DAY,
        false,
        true,
        false,
        "Found it: the search field remounts on each keystroke.",
    ),
    (
        8,
        2 * HOUR,
        true,
        false,
        false,
        "It still happens on an older phone, but less.",
    ),
    (
        8,
        2 * HOUR,
        false,
        true,
        true,
        "The fix is on a branch; waiting on review before main.",
    ),
    (
        11,
        40 * MINUTE,
        true,
        false,
        false,
        "It happens with any item, not just the lamp.",
    ),
    (
        11,
        30 * MINUTE,
        false,
        false,
        false,
        "Thanks Grace, looking at it now.",
    ),
    (
        11,
        20 * MINUTE,
        false,
        true,
        true,
        "The cart reads the total once and never again after a remove.",
    ),
    (
        11,
        12 * MINUTE,
        true,
        false,
        false,
        "Also on the phone app view.",
    ),
];

const MOVES: [(usize, i64, &str, &str, Option<&str>); 9] = [
    (1, 15 * DAY, "inbox", "done", Some("abandoned")),
    (2, 10 * DAY, "inbox", "doing", None),
    (2, 6 * DAY, "doing", "done", Some("fixed")),
    (3, 8 * DAY, "inbox", "doing", None),
    (3, 2 * DAY, "doing", "done", Some("fixed")),
    (4, DAY, "inbox", "review", None),
    (5, 20 * HOUR, "inbox", "doing", None),
    (7, 5 * HOUR, "inbox", "doing", None),
    (8, 2 * DAY, "inbox", "doing", None),
];

pub struct Demo {
    threads: Vec<Thread>,
    codes: Vec<Code>,
    next_comment: i64,
    shelf: boards::Shelf,
    files: Vec<(i64, Vec<u8>)>,
}

const SHOT: &str = "cart-total.png";
const SHOT_BYTES: usize = 48 * 1024;

impl Demo {
    pub fn new() -> Demo {
        let mut threads: Vec<Thread> = ITEMS
            .iter()
            .chain(boards::ITEMS.iter())
            .chain(boards::CARDS.iter())
            .enumerate()
            .map(|(at, item)| thread(at as i64 + 1, item))
            .collect();
        let mut next_comment = 1;
        for &(item, ago, grace, agent, internal, body) in &COMMENTS {
            let (name, email) = if grace { GRACE } else { ME };
            threads[item - 1].comments.push(Comment {
                id: next_comment,
                client_uid: format!("demo-{next_comment}"),
                author: Author {
                    email: email.into(),
                    name: name.into(),
                    manager: !grace,
                    agent,
                    via: agent.then(|| VIA.to_owned()),
                },
                body: body.into(),
                internal,
                created_at: iso(NOW - ago),
                attachments: Vec::new(),
            });
            threads[item - 1].issue.comments += 1;
            next_comment += 1;
        }
        for &(item, ago, from, to, resolution) in &MOVES {
            let mut detail = json!({"from": from, "to": to});
            if let Some(resolution) = resolution {
                detail["resolution"] = json!(resolution);
            }
            threads[item - 1].events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "status".into(),
                detail,
                at: iso(NOW - ago),
            });
        }
        land(
            &mut threads[1],
            &[("dev", 9 * DAY), ("production", 6 * DAY)],
        );
        land(
            &mut threads[2],
            &[("dev", 3 * DAY), ("production", 2 * DAY)],
        );
        land(&mut threads[4], &[("dev", 18 * HOUR)]);
        threads[7].issue.landing.branch = true;
        threads[11].issue.duplicate_of = Some("BUG-11".into());
        for thread in &mut threads {
            thread.issue.project = boards::project_of(thread.issue.id).map(Into::into);
            thread.issue.label = Some(boards::label_of(&thread.issue));
        }
        let folded = &threads[11].issue;
        let merged = wire::Merged {
            key: folded.key.clone(),
            title: folded.title.clone(),
            host: folded.host.clone(),
            reporter: folded.reporter.clone(),
        };
        if let Some(target) = threads.iter_mut().find(|t| t.issue.key == "BUG-11") {
            target.issue.merged.push(merged);
        }
        for thread in &mut threads {
            thread.events.sort_by(|a, b| a.at.cmp(&b.at));
        }
        let mut demo = Demo {
            shelf: boards::Shelf::new(&threads),
            threads,
            codes: codes(),
            next_comment,
            files: Vec::new(),
        };
        let shot = Upload {
            name: SHOT.into(),
            kind: "image/png",
            bytes: vec![0; SHOT_BYTES],
        };
        let _ = demo.attach("BUG-11", &shot, None);
        if let Some(file) = demo.threads[10].attachments.first_mut() {
            file.created_at = iso(NOW - 50 * MINUTE);
        }
        demo
    }

    pub fn places(&self) -> Vec<Place> {
        let mut places = Vec::new();
        for project in self.projects() {
            let hosts: &[&str] = if project == boards::PROJECTS[0] {
                &["shop.example.com"]
            } else {
                &[]
            };
            places.push(Place {
                space: 0,
                project: project.clone(),
                host: None,
            });
            places.extend(hosts.iter().map(|host| Place {
                space: 0,
                project: project.clone(),
                host: Some((*host).into()),
            }));
        }
        places
    }

    pub fn attach(
        &mut self,
        key: &str,
        upload: &Upload,
        comment: Option<i64>,
    ) -> Result<(), String> {
        let id = self.files.len() as i64 + 1;
        let thread = self.find(key)?;
        if let Some(comment) = comment {
            let said = thread
                .comments
                .iter_mut()
                .find(|c| c.id == comment)
                .ok_or_else(|| format!("no comment {comment} on {key}"))?;
            said.attachments.push(id);
        }
        thread.attachments.push(Attachment {
            id,
            client_uid: format!("demo-file-{id}"),
            role: "file".into(),
            name: upload.name.clone(),
            content_type: upload.kind.into(),
            bytes: upload.bytes.len() as i64,
            comment_id: comment,
            created_at: iso(NOW),
            ..Attachment::default()
        });
        thread.issue.attachments += 1;
        self.files.push((id, upload.bytes.clone()));
        Ok(())
    }

    pub fn download(&self, id: i64) -> Result<Download, String> {
        let file = self
            .threads
            .iter()
            .flat_map(|t| &t.attachments)
            .find(|a| a.id == id)
            .ok_or_else(|| format!("no file {id} (404)"))?;
        let bytes = self
            .files
            .iter()
            .find(|(at, _)| *at == id)
            .map(|(_, bytes)| bytes.clone())
            .unwrap_or_default();
        Ok(Download {
            name: file.name.clone(),
            content_type: file.content_type.clone(),
            bytes,
        })
    }

    pub fn file_card(&mut self, draft: &Draft) -> Result<(String, String), String> {
        if !wire::KINDS.contains(&draft.kind.as_str()) {
            return Err("kind must be bug, feature, improvement, question or task".into());
        }
        let title = draft.title.trim();
        if title.is_empty() {
            return Err("a card needs a title".into());
        }
        let id = self.threads.iter().map(|t| t.issue.id).max().unwrap_or(0) + 1;
        let place = &draft.place;
        let host = place.host.clone();
        let issue = Issue {
            id,
            key: format!("{}-{id}", wire::prefix(&draft.kind)),
            kind: draft.kind.clone(),
            status: "inbox".into(),
            title: title.into(),
            host: host.clone(),
            env: host.as_deref().map(env_of).unwrap_or_default().into(),
            page: PageRef {
                url: host
                    .as_ref()
                    .map(|h| format!("https://{h}/"))
                    .unwrap_or_default(),
                path: String::new(),
                title: title.into(),
            },
            reporter: json!({"email": ME.1, "name": ME.0, "agent": false, "via": null}),
            created_at: iso(NOW),
            updated_at: iso(NOW),
            body: draft.body.clone(),
            project: Some(place.project.clone()),
            label: Some(boards::status_label("inbox").into()),
            ..Issue::default()
        };
        let key = issue.key.clone();
        self.shelf_top(&key);
        self.threads.push(Thread {
            events: vec![Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "created".into(),
                detail: json!({"kind": draft.kind, "title": title}),
                at: iso(NOW),
            }],
            issue,
            comments: Vec::new(),
            attachments: Vec::new(),
            people: Vec::new(),
        });
        Ok((key, place.project.clone()))
    }

    pub fn link(&mut self, key: &str, reference: &str) -> Result<(), String> {
        let reference = reference.trim();
        if reference.is_empty() {
            return Err("ref must be 1 to 200 characters".into());
        }
        let thread = self.find(key)?;
        thread.events.push(Event {
            actor: Some(ME.1.into()),
            actor_name: Some(ME.0.into()),
            agent: false,
            via: None,
            kind: "link".into(),
            detail: json!({"ref": reference, "note": null}),
            at: iso(NOW),
        });
        thread.issue.updated_at = iso(NOW);
        Ok(())
    }

    pub fn merge(&mut self, key: &str, into: &str) -> Result<(), String> {
        let target = self.find(into)?.issue.key.clone();
        let source = self.find(key)?.issue.key.clone();
        if target == source {
            return Err("a card cannot merge into itself".into());
        }
        let event = |detail: Value| Event {
            actor: Some(ME.1.into()),
            actor_name: Some(ME.0.into()),
            agent: false,
            via: None,
            kind: "merge".into(),
            detail,
            at: iso(NOW),
        };
        let folded = self.find(&source)?;
        folded.events.push(event(json!({"into": target})));
        let issue = &mut folded.issue;
        issue.duplicate_of = Some(target.clone());
        issue.status = "done".into();
        issue.resolution = Some("duplicate".into());
        issue.label = Some("Done".into());
        issue.closed_at = Some(iso(NOW));
        issue.updated_at = iso(NOW);
        let merged = wire::Merged {
            key: issue.key.clone(),
            title: issue.title.clone(),
            host: issue.host.clone(),
            reporter: issue.reporter.clone(),
        };
        let kept = self.find(&target)?;
        kept.events.push(event(json!({"item": source})));
        kept.issue.merged.retain(|m| m.key != merged.key);
        kept.issue.merged.push(merged);
        kept.issue.updated_at = iso(NOW);
        Ok(())
    }

    pub fn hosts(&self) -> Vec<String> {
        vec![
            "dev.example.com".into(),
            "example.com".into(),
            "shop.example.com".into(),
        ]
    }

    pub fn list(&self) -> Vec<Entry> {
        self.threads
            .iter()
            .map(|thread| Entry::new(0, summary(&thread.issue)))
            .collect()
    }

    fn find(&mut self, key: &str) -> Result<&mut Thread, String> {
        let number = wire::item_number(key).ok_or_else(|| format!("{key} is not a card key"))?;
        self.threads
            .iter_mut()
            .find(|thread| thread.issue.id == number)
            .ok_or_else(|| format!("no card is called {key}"))
    }

    pub fn thread(&mut self, key: &str) -> Result<Thread, String> {
        let thread = self.find(key)?;
        thread.issue.unread = false;
        let mut thread = thread.clone();
        thread.people = ["ada.lovelace", "grace.hopper"]
            .map(|username| Member {
                username: username.into(),
                manager: username == "ada.lovelace",
            })
            .into();
        Ok(thread)
    }

    pub fn comment(&mut self, key: &str, body: &str, internal: bool) -> Result<Comment, String> {
        let id = self.next_comment;
        let thread = self.find(key)?;
        let comment = Comment {
            id,
            client_uid: format!("demo-{id}"),
            author: Author {
                email: ME.1.into(),
                name: ME.0.into(),
                manager: true,
                agent: false,
                via: None,
            },
            body: body.into(),
            internal,
            created_at: iso(NOW),
            attachments: Vec::new(),
        };
        thread.comments.push(comment.clone());
        thread.issue.comments += 1;
        thread.issue.updated_at = iso(NOW);
        self.next_comment += 1;
        Ok(comment)
    }

    pub fn delete(&mut self, key: &str) -> Result<wire::Deleted, String> {
        let number = wire::item_number(key).ok_or_else(|| format!("{key} is not a card key"))?;
        let at = self
            .threads
            .iter()
            .position(|thread| thread.issue.id == number)
            .ok_or_else(|| format!("no card is called {key}"))?;
        let gone = self.threads.remove(at);
        let mut unlinked = Vec::new();
        for thread in &mut self.threads {
            let issue = &mut thread.issue;
            issue.merged.retain(|m| m.key != gone.issue.key);
            if issue.duplicate_of.as_deref() == Some(gone.issue.key.as_str()) {
                issue.duplicate_of = None;
                if issue.status == "done" {
                    issue.status = "inbox".into();
                    issue.resolution = None;
                    issue.closed_at = None;
                }
                unlinked.push(issue.key.clone());
            }
        }
        Ok(wire::Deleted {
            key: gone.issue.key,
            comments: gone.comments.len() as u64,
            files: gone.attachments.len() as u64,
            retrying: 0,
            unlinked,
        })
    }

    pub fn change(&mut self, key: &str, change: &Change) -> Result<Issue, String> {
        let thread = self.find(key)?;
        let issue = &mut thread.issue;
        if let Some(status) = &change.status {
            if !wire::STATUSES.contains(&status.as_str()) {
                return Err(format!("{status} is not a status"));
            }
            let resolution = match (status.as_str(), &change.resolution) {
                ("done", Some(resolution)) => Some(resolution.clone()),
                ("done", None) => Some("fixed".to_owned()),
                (_, Some(_)) => return Err("a resolution goes with done".into()),
                _ => None,
            };
            let mut detail = json!({"from": issue.status, "to": status});
            if let Some(resolution) = &resolution {
                detail["resolution"] = json!(resolution);
            }
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "status".into(),
                detail,
                at: iso(NOW),
            });
            issue.closed_at = (!wire::open(status)).then(|| iso(NOW));
            issue.status = status.clone();
            issue.label = Some(boards::status_label(status).to_owned());
            if resolution.as_deref() != Some("duplicate") && change.duplicate_of.is_none() {
                issue.duplicate_of = None;
            }
            issue.resolution = resolution;
        }
        if let Some(assignee) = &change.assignee {
            let to = assignee
                .as_deref()
                .map(|name| Assignee::new(if name == "me" { "ada.lovelace" } else { name }));
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "assignee".into(),
                detail: json!({"from": issue.assignee, "to": to}),
                at: iso(NOW),
            });
            issue.assignee = to;
        }
        if let Some(of) = &change.duplicate_of {
            issue.duplicate_of = Some(of.clone());
        }
        if let Some(title) = &change.title {
            let title = title.trim();
            if title.is_empty() {
                return Err("title must be 1 to 200 characters".into());
            }
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "title".into(),
                detail: json!({"from": issue.title, "to": title}),
                at: iso(NOW),
            });
            issue.title = title.into();
        }
        if let Some(body) = &change.body {
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "body".into(),
                detail: Value::Null,
                at: iso(NOW),
            });
            issue.body = body.clone();
        }
        let closing = match (&change.status, &change.resolution, &change.duplicate_of) {
            (None, Some(resolution), _) => Some(resolution.clone()),
            (None, None, Some(_)) => Some("duplicate".to_owned()),
            _ => None,
        };
        if let Some(resolution) = closing {
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                agent: false,
                via: None,
                kind: "label".into(),
                detail: json!({"from": issue.label, "to": "Done"}),
                at: iso(NOW),
            });
            issue.label = Some("Done".into());
            issue.status = "done".into();
            issue.resolution = Some(resolution);
            issue.closed_at = Some(iso(NOW));
        }
        issue.updated_at = iso(NOW);
        Ok(issue.clone())
    }

    pub fn codes(&self) -> Vec<Code> {
        self.codes.clone()
    }

    pub fn forget(&mut self, code: &Code) {
        self.codes.retain(|c| !crate::cli::codes::same(c, code));
    }
}

fn env_of(host: &str) -> &'static str {
    if host.starts_with("dev.") {
        "development"
    } else {
        "production"
    }
}

fn thread(id: i64, item: &Item) -> Thread {
    let (name, email) = if item.grace { GRACE } else { ME };
    let key = format!("{}-{id}", wire::prefix(item.kind));
    let issue = Issue {
        id,
        key,
        kind: item.kind.into(),
        status: item.status.into(),
        resolution: item.resolution.map(Into::into),
        title: item.title.into(),
        host: Some(item.host.into()),
        env: env_of(item.host).into(),
        page: PageRef {
            url: format!("https://{}{}", item.host, item.path),
            path: item.path.into(),
            title: String::new(),
        },
        reporter: json!({"email": email, "name": name, "agent": item.agent, "via": item.agent.then_some(VIA)}),
        assignee: item.assignee.map(Assignee::new),
        created_at: iso(NOW - item.created),
        updated_at: iso(NOW - item.updated),
        unread: item.unread,
        body: item.body.into(),
        closed_at: (!wire::open(item.status)).then(|| iso(NOW - item.updated)),
        context: json!({"viewport": "1280x800"}),
        ..Issue::default()
    };
    Thread {
        events: vec![Event {
            actor: Some(email.into()),
            actor_name: Some(name.into()),
            agent: item.agent,
            via: item.agent.then(|| VIA.to_owned()),
            kind: "created".into(),
            detail: Value::Null,
            at: iso(NOW - item.created),
        }],
        issue,
        comments: Vec::new(),
        attachments: Vec::new(),
        people: Vec::new(),
    }
}

fn land(thread: &mut Thread, envs: &[(&str, i64)]) {
    thread.issue.landing = Landing {
        branch: false,
        envs: envs
            .iter()
            .enumerate()
            .map(|(at, &(env, ago))| Reached {
                env: env.into(),
                kind: if env == "dev" {
                    "development"
                } else {
                    "release"
                }
                .into(),
                at: iso(NOW - ago),
                sha: format!("{:07x}", 0x3a9f2c1 + at * 0x1d3b7),
                version: (env != "dev").then(|| "1.4.0".into()),
            })
            .collect(),
    };
}

pub fn summary(issue: &Issue) -> Summary {
    let reporter = &issue.reporter;
    let text = |field: &str| reporter[field].as_str().unwrap_or_default().to_owned();
    Summary {
        id: issue.id,
        key: issue.key.clone(),
        kind: issue.kind.clone(),
        status: issue.status.clone(),
        stage: issue.stage.clone(),
        label: issue.label.clone(),
        resolution: issue.resolution.clone(),
        project: issue.project.clone(),
        board: issue.board.clone(),
        position: issue.position,
        title: issue.title.clone(),
        host: issue.host.clone(),
        env: issue.env.clone(),
        page: issue.page.clone(),
        reporter: Person {
            email: text("email"),
            name: text("name"),
            agent: reporter["agent"].as_bool().unwrap_or(false),
            via: reporter["via"].as_str().map(str::to_owned),
        },
        assignee: issue.assignee.clone(),
        created_at: issue.created_at.clone(),
        updated_at: issue.updated_at.clone(),
        comments: issue.comments,
        attachments: issue.attachments,
        unread: issue.unread,
        landing: issue.landing.clone(),
        labels: issue.labels.clone(),
    }
}

fn codes() -> Vec<Code> {
    let code = |id: i64, who: (&str, &str), hosts: &[&str], manager: bool, hint: &str| Code {
        id,
        name: who.0.into(),
        email: who.1.into(),
        hosts: hosts.iter().map(|h| (*h).into()).collect(),
        manager,
        hint: hint.into(),
        created_by: ME.1.into(),
        ..Code::default()
    };
    let projects = |names: &[&str]| {
        Some(wire::Grant {
            space: false,
            projects: names.iter().map(|n| (*n).into()).collect(),
        })
    };
    let both = ["example.com", "shop.example.com"];
    let mut ada = code(1, ME, &both, true, "7k2q");
    ada.grant = Some(wire::Grant {
        space: true,
        projects: Vec::new(),
    });
    ada.created_at = iso(NOW - 30 * DAY);
    ada.last_used_at = Some(iso(NOW - 12 * MINUTE));
    let mut old = code(2, GRACE, &["shop.example.com"], false, "3fpd");
    old.grant = projects(&[boards::PROJECTS[0]]);
    old.created_at = iso(NOW - 25 * DAY);
    old.revoked_at = Some(iso(NOW - 21 * DAY));
    old.last_used_at = Some(iso(NOW - 22 * DAY));
    let mut grace = code(3, GRACE, &["shop.example.com"], false, "m9xa");
    grace.grant = projects(&[boards::PROJECTS[0]]);
    grace.created_at = iso(NOW - 21 * DAY);
    grace.last_used_at = Some(iso(NOW - 12 * MINUTE));
    let mut agent = code(4, GRACE, &[], false, "q81v");
    agent.grant = projects(&[boards::PROJECTS[1]]);
    agent.created_at = iso(NOW - 2 * DAY);
    vec![ada, old, grace, agent]
}

#[cfg(test)]
pub(super) mod tests;

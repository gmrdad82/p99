use serde_json::{Value, json};

use crate::wire::{
    self, Author, Change, Code, Comment, Event, Issue, Landing, PageRef, Person, Reached, Summary,
    Tag, Thread,
};

use super::source::{Entry, iso};

pub const NOW: i64 = 1_791_979_200;
pub const ME: (&str, &str) = ("Ada Lovelace", "ada@example.com");
const GRACE: (&str, &str) = ("Grace Hopper", "grace@example.com");

const LABELS: [(&str, &str); 4] = [
    ("checkout", "#e0823d"),
    ("mobile", "#539bf5"),
    ("design", "#986ee2"),
    ("copy", "#57ab5a"),
];

const TAGS: [(usize, Option<&str>, &[usize]); 7] = [
    (1, Some("low"), &[1, 2]),
    (3, Some("high"), &[0, 2]),
    (4, Some("normal"), &[2]),
    (5, Some("normal"), &[3]),
    (8, Some("high"), &[1]),
    (9, None, &[2]),
    (11, Some("urgent"), &[0]),
];

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
        assignee: Some("ada@example.com"),
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
        assignee: Some("ada@example.com"),
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
        assignee: Some("ada@example.com"),
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
        assignee: Some("ada@example.com"),
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
        assignee: Some("ada@example.com"),
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
        assignee: Some("ada@example.com"),
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
}

impl Demo {
    pub fn new() -> Demo {
        let mut threads: Vec<Thread> = ITEMS
            .iter()
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
        for &(item, priority, labels) in &TAGS {
            if let Some(thread) = threads.get_mut(item - 1) {
                thread.issue.priority = priority.map(Into::into);
                thread.issue.labels = labels.iter().map(|&at| tag(LABELS[at].0)).collect();
            }
        }
        for thread in &mut threads {
            thread.events.sort_by(|a, b| a.at.cmp(&b.at));
        }
        Demo {
            threads,
            codes: codes(),
            next_comment,
        }
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
        let number = wire::item_number(key).ok_or_else(|| format!("{key} is not an item key"))?;
        self.threads
            .iter_mut()
            .find(|thread| thread.issue.id == number)
            .ok_or_else(|| format!("no item is called {key}"))
    }

    pub fn thread(&mut self, key: &str) -> Result<Thread, String> {
        let thread = self.find(key)?;
        thread.issue.unread = false;
        Ok(thread.clone())
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
                kind: "status".into(),
                detail,
                at: iso(NOW),
            });
            issue.closed_at = (!wire::open(status)).then(|| iso(NOW));
            issue.status = status.clone();
            if resolution.as_deref() != Some("duplicate") && change.duplicate_of.is_none() {
                issue.duplicate_of = None;
            }
            issue.resolution = resolution;
        }
        if let Some(assignee) = &change.assignee {
            thread.events.push(Event {
                actor: Some(ME.1.into()),
                actor_name: Some(ME.0.into()),
                kind: "assignee".into(),
                detail: json!({"from": issue.assignee, "to": assignee}),
                at: iso(NOW),
            });
            issue.assignee = assignee.clone();
        }
        if let Some(of) = &change.duplicate_of {
            issue.duplicate_of = Some(of.clone());
        }
        if let Some(priority) = &change.priority {
            if priority
                .as_deref()
                .is_some_and(|p| !wire::PRIORITIES.contains(&p))
            {
                return Err("priority must be urgent, high, normal or low".into());
            }
            issue.priority = priority.clone();
        }
        if let Some(edit) = &change.labels {
            let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
            issue
                .labels
                .retain(|t| !edit.remove.iter().any(|r| same(r, &t.name)));
            for name in &edit.add {
                if !issue.labels.iter().any(|t| same(&t.name, name)) {
                    issue.labels.push(tag(name));
                }
            }
            issue.labels.sort_by_key(|t| t.name.to_lowercase());
        }
        issue.updated_at = iso(NOW);
        Ok(issue.clone())
    }

    pub fn codes(&self) -> Vec<Code> {
        self.codes.clone()
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
        reporter: json!({"email": email, "name": name, "agent": item.agent}),
        assignee: item.assignee.map(Into::into),
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
            kind: "created".into(),
            detail: Value::Null,
            at: iso(NOW - item.created),
        }],
        issue,
        comments: Vec::new(),
        attachments: Vec::new(),
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
        resolution: issue.resolution.clone(),
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
        },
        assignee: issue.assignee.clone(),
        created_at: issue.created_at.clone(),
        updated_at: issue.updated_at.clone(),
        comments: issue.comments,
        attachments: issue.attachments,
        unread: issue.unread,
        landing: issue.landing.clone(),
        priority: issue.priority.clone(),
        labels: issue.labels.clone(),
    }
}

fn tag(name: &str) -> Tag {
    let color = LABELS
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(name))
        .map_or("#39a5a0", |(_, c)| c);
    Tag {
        name: name.to_owned(),
        color: color.to_owned(),
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
    let both = ["example.com", "shop.example.com"];
    let mut ada = code(1, ME, &both, true, "7k2q");
    ada.created_at = iso(NOW - 30 * DAY);
    ada.last_used_at = Some(iso(NOW - 12 * MINUTE));
    let mut old = code(2, GRACE, &["shop.example.com"], false, "3fpd");
    old.created_at = iso(NOW - 25 * DAY);
    old.revoked_at = Some(iso(NOW - 21 * DAY));
    old.last_used_at = Some(iso(NOW - 22 * DAY));
    let mut grace = code(3, GRACE, &both, false, "m9xa");
    grace.created_at = iso(NOW - 21 * DAY);
    grace.last_used_at = Some(iso(NOW - 12 * MINUTE));
    let mut blog = code(4, GRACE, &["example.com"], false, "q81v");
    blog.created_at = iso(NOW - 2 * DAY);
    vec![ada, old, grace, blog]
}

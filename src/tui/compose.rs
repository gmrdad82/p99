use std::path::PathBuf;

use serde_json::{Value, json};

use crate::card::{CardReply, NewCard, ProjectList, refusal};
use crate::client::{segment, uid};
use crate::wire::Issue;

use super::deck::unrouted;
use super::files::read_all;
use super::source::Source;

pub const LINE: &str = " ¶ ";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub space: usize,
    pub project: String,
    pub host: Option<String>,
}

impl Place {
    pub fn named(&self) -> String {
        match &self.host {
            Some(host) => format!("{} · {host}", self.project),
            None => self.project.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Draft {
    pub place: Place,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub files: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filed {
    pub space: usize,
    pub key: String,
    pub host: Option<String>,
    pub project: String,
    pub files: usize,
    pub trouble: Option<String>,
}

pub fn flat(body: &str) -> String {
    body.lines().collect::<Vec<_>>().join(LINE)
}

pub fn unflat(typed: &str) -> String {
    let parts: Vec<&str> = typed.split('¶').collect();
    let last = parts.len().saturating_sub(1);
    parts
        .iter()
        .enumerate()
        .map(|(at, part)| {
            let part = if at > 0 {
                part.strip_prefix(' ').unwrap_or(part)
            } else {
                part
            };
            if at < last {
                part.strip_suffix(' ').unwrap_or(part)
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .trim_start_matches('\n')
        .to_owned()
}

impl Source {
    pub fn places(&self) -> Result<Vec<Place>, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| Ok(demo.places())),
            Source::Broken(why) => Err(why.clone()),
            Source::Live(_) => {
                let (mut places, mut failed, mut answered) = (Vec::new(), None, false);
                let names = self.spaces();
                for space in self.scoped() {
                    let name = names.get(space).map_or("", String::as_str);
                    match self.client(space, None).and_then(|client| rows(&client)) {
                        Ok(rows) => {
                            answered = true;
                            for (project, hosts) in rows {
                                places.push(Place {
                                    space,
                                    project: project.clone(),
                                    host: None,
                                });
                                places.extend(hosts.into_iter().map(|host| Place {
                                    space,
                                    project: project.clone(),
                                    host: Some(host),
                                }));
                            }
                        }
                        Err(error) if unrouted(&error) => {}
                        Err(error) => {
                            failed.get_or_insert(format!("{name}: {error}"));
                        }
                    }
                }
                match failed {
                    Some(error) if !answered => Err(error),
                    _ => Ok(places),
                }
            }
        }
    }

    pub fn file_card(&self, draft: &Draft) -> Result<Filed, String> {
        let uploads = read_all(&draft.files)?;
        let place = &draft.place;
        let (key, project) = match self {
            Source::Demo(..) => self.sample(|demo| demo.file_card(draft))?,
            _ => {
                let client = self.client(place.space, None)?;
                let request = NewCard {
                    client_uid: uid(),
                    project: place.project.clone(),
                    title: draft.title.clone(),
                    body: draft.body.clone(),
                    kind: draft.kind.clone(),
                    host: place.host.clone(),
                };
                let body = serde_json::to_value(&request).map_err(|e| e.to_string())?;
                let reply: CardReply = client
                    .json("POST", "/v1/cards", Some(body))
                    .map_err(refusal)?;
                (reply.card.key, reply.card.project)
            }
        };
        let (files, trouble) = match self.attach(place.space, None, &key, &uploads, None) {
            Ok(files) => (files, None),
            Err(why) => (0, Some(why)),
        };
        Ok(Filed {
            space: place.space,
            key,
            host: place.host.clone(),
            project,
            files,
            trouble,
        })
    }

    pub fn link(
        &self,
        space: usize,
        host: Option<&str>,
        key: &str,
        reference: &str,
    ) -> Result<Issue, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.link(key, reference))?,
            _ => {
                let path = format!("/v1/cards/{}/links", segment(key)?);
                let body = json!({"ref": reference, "note": Value::Null});
                self.client(space, None)?
                    .json::<Value>("POST", &path, Some(body))
                    .map_err(refusal)?;
            }
        }
        self.thread(space, host, key).map(|thread| thread.issue)
    }

    pub fn merge(
        &self,
        space: usize,
        host: Option<&str>,
        key: &str,
        into: &str,
    ) -> Result<Issue, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.merge(key, into))?,
            _ => {
                self.client(space, host)?.merge(&[key.to_owned()], into)?;
            }
        }
        self.thread(space, host, key).map(|thread| thread.issue)
    }
}

fn rows(client: &crate::client::Client) -> Result<Vec<(String, Vec<String>)>, String> {
    match client.space() {
        Ok(view) => Ok(view
            .projects
            .into_iter()
            .map(|project| (project.name, project.hosts))
            .collect()),
        Err(error) if error.ends_with("(404)") => client
            .json::<ProjectList>("GET", "/v1/projects", None)
            .map(|list| {
                list.projects
                    .into_iter()
                    .map(|project| (project.name, Vec::new()))
                    .collect()
            }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn details_flatten_to_one_line_and_come_back_with_their_lines() {
        let body = "First line\n\nSecond paragraph\nlast";
        let line = flat(body);
        assert_eq!(line, "First line ¶  ¶ Second paragraph ¶ last");
        assert_eq!(unflat(&line), body);
        assert_eq!(unflat("one ¶ two"), "one\ntwo");
        assert_eq!(unflat("one¶two"), "one\ntwo");
        assert_eq!(unflat(&flat("list:\n  - kept")), "list:\n  - kept");
        assert_eq!(unflat("plain  "), "plain");
        assert_eq!(unflat(""), "");
    }

    #[test]
    fn a_place_reads_as_its_project_and_its_host() {
        let mut place = Place {
            space: 0,
            project: "Storefront".into(),
            host: None,
        };
        assert_eq!(place.named(), "Storefront");
        place.host = Some("shop.example.com".into());
        assert_eq!(place.named(), "Storefront · shop.example.com");
    }

    #[test]
    fn the_sample_offers_each_project_then_its_hosts() {
        let places = Source::demo(std::time::Duration::ZERO)
            .places()
            .expect("the sample has places");
        let named: Vec<String> = places.iter().map(Place::named).collect();
        assert_eq!(
            named,
            ["Mobile app", "Storefront", "Storefront · shop.example.com"]
        );
        assert_eq!(
            Source::Broken("no space yet".into())
                .places()
                .err()
                .as_deref(),
            Some("no space yet")
        );
    }
}

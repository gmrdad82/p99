use serde::{Deserialize, Serialize};

use crate::card::{Card, Lane, Person, Source};

pub const DEPRECATED: &str =
    "p99 boards is deprecated: one board per space since 1.11; p99 board prints it";
pub const OLD_WORKER: &str =
    "this Worker still has a board per person; run p99 deploy for the one board";
pub const NO_LANES: &str = "this board has no lanes yet; run p99 deploy";
pub const NO_WAITING: &str = "this Worker has no Needs you list yet; run p99 deploy";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaneInfo {
    pub word: Lane,
    pub label: String,
    #[serde(default)]
    pub closes: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lanes {
    #[serde(default)]
    pub lanes: Vec<LaneInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardCard {
    pub key: String,
    pub kind: String,
    #[serde(default)]
    pub project: Option<String>,
    pub status: Lane,
    pub label: String,
    #[serde(default)]
    pub lane: Option<u32>,
    pub title: String,
    pub host: String,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    pub changed_at: String,
    #[serde(default)]
    pub changed_by: Option<Person>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OneBoard {
    pub board: Lanes,
    #[serde(default)]
    pub cards: Vec<BoardCard>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waiting {
    pub count: u64,
    #[serde(default)]
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BoardQuery {
    pub projects: Vec<String>,
    pub host: Option<String>,
    pub source: Option<Source>,
    pub statuses: Vec<Lane>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    #[value(alias = "manager")]
    Owner,
    #[value(alias = "person", alias = "reporter")]
    User,
}

impl Role {
    pub fn of(manager: bool) -> Role {
        if manager { Role::Owner } else { Role::User }
    }

    pub fn word(self) -> &'static str {
        match self {
            Role::Owner => "Owner",
            Role::User => "User",
        }
    }
}

pub fn refusal(why: String) -> String {
    match crate::card::refusal(why) {
        bare if bare == crate::card::NOT_YET => OLD_WORKER.to_owned(),
        bare => bare,
    }
}

pub fn waiting_refusal(why: String) -> String {
    match crate::card::refusal(why) {
        bare if bare == crate::card::NOT_YET || bare == "no item waiting" => NO_WAITING.to_owned(),
        bare => bare,
    }
}

fn card_line(card: &BoardCard) -> String {
    let mut line = format!(
        "  {:<9} {:<12} {}",
        card.key,
        card.project.as_deref().unwrap_or(""),
        card.title
    );
    if let Some(who) = card.assignee.as_deref().filter(|w| !w.is_empty()) {
        line.push_str(&format!("  @{who}"));
    }
    line
}

pub fn board_lines(board: &OneBoard) -> Vec<String> {
    if board.board.lanes.is_empty() && board.cards.is_empty() {
        return vec![NO_LANES.to_owned()];
    }
    let mut lines = Vec::new();
    for lane in &board.board.lanes {
        let cards: Vec<&BoardCard> = board
            .cards
            .iter()
            .filter(|c| c.status == lane.word)
            .collect();
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.push(format!(
            "{} ({}){}",
            lane.label,
            cards.len(),
            if lane.closes { ", closes" } else { "" }
        ));
        lines.extend(cards.into_iter().map(card_line));
    }
    let strays: Vec<&BoardCard> = board
        .cards
        .iter()
        .filter(|c| !board.board.lanes.iter().any(|l| l.word == c.status))
        .collect();
    for card in strays {
        lines.push(format!("{}  in {}", card_line(card), card.label));
    }
    lines
}

fn word_of<'a>(lanes: &'a [LaneInfo], name: &str) -> Option<&'a LaneInfo> {
    lanes
        .iter()
        .find(|l| l.label.to_lowercase() == name.to_lowercase())
}

pub fn lane_lines(labels: &[crate::wire::LabelEntry], lanes: &[LaneInfo]) -> Vec<String> {
    let mut ordered: Vec<&crate::wire::LabelEntry> = labels.iter().collect();
    ordered.sort_by_key(|label| {
        lanes
            .iter()
            .position(|l| l.label.to_lowercase() == label.name.to_lowercase())
            .unwrap_or(usize::MAX)
    });
    ordered
        .into_iter()
        .map(|label| {
            let word = word_of(lanes, &label.name).map_or("", |l| l.word.word());
            format!(
                "{word:<12} {:<20} {}",
                label.name,
                if label.closes { "closes" } else { "" }
            )
            .trim_end()
            .to_owned()
        })
        .collect()
}

pub fn lanes_from(labels: &[crate::wire::LabelEntry]) -> Vec<LaneInfo> {
    use clap::ValueEnum;
    let mut lanes: Vec<LaneInfo> = labels
        .iter()
        .filter_map(|label| {
            Some(LaneInfo {
                word: Lane::from_str(label.word.as_deref()?, true).ok()?,
                label: label.name.clone(),
                closes: label.closes,
            })
        })
        .collect();
    lanes.sort_by_key(|lane| Lane::value_variants().iter().position(|v| *v == lane.word));
    lanes
}

pub fn lane_named<'a>(
    labels: &'a [crate::wire::LabelEntry],
    lanes: &[LaneInfo],
    raw: &str,
) -> Option<&'a crate::wire::LabelEntry> {
    use clap::ValueEnum;
    let wanted = raw.trim().to_lowercase();
    labels
        .iter()
        .find(|l| l.name.to_lowercase() == wanted)
        .or_else(|| {
            let lane = Lane::from_str(raw.trim(), true).ok()?;
            let name = &lanes.iter().find(|l| l.word == lane)?.label;
            labels
                .iter()
                .find(|l| l.name.to_lowercase() == name.to_lowercase())
        })
}

pub fn query(q: &BoardQuery) -> String {
    let mut pairs: Vec<(&str, String)> = Vec::new();
    for name in &q.projects {
        pairs.push(("project", name.clone()));
    }
    if let Some(host) = &q.host {
        pairs.push(("host", host.clone()));
    }
    if let Some(source) = q.source {
        pairs.push(("source", source.word().to_owned()));
    }
    for lane in &q.statuses {
        pairs.push(("status", lane.word().to_owned()));
    }
    let parts: Vec<String> = pairs
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}={}", crate::client::encode(v)))
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::LabelEntry;

    fn lanes() -> Lanes {
        use clap::ValueEnum;
        Lanes {
            lanes: Lane::value_variants()
                .iter()
                .map(|l| LaneInfo {
                    word: *l,
                    label: l.name().to_owned(),
                    closes: *l == Lane::Done,
                })
                .collect(),
        }
    }

    fn card(key: &str, status: Lane, project: Option<&str>, assignee: Option<&str>) -> BoardCard {
        BoardCard {
            key: key.to_owned(),
            kind: "feature".to_owned(),
            project: project.map(str::to_owned),
            status,
            label: status.name().to_owned(),
            lane: Some(1),
            title: format!("{key} title"),
            host: "shop.example.com".to_owned(),
            assignee: assignee.map(str::to_owned),
            order: Some("a0".to_owned()),
            changed_at: "2026-10-22T09:12:00.000Z".to_owned(),
            changed_by: None,
        }
    }

    fn entries(names: &[&str]) -> Vec<LabelEntry> {
        names
            .iter()
            .enumerate()
            .map(|(i, n)| LabelEntry {
                id: i as i64 + 10,
                name: (*n).to_owned(),
                word: None,
                closes: *n == "Done",
                boards: Vec::new(),
            })
            .collect()
    }

    #[test]
    fn the_lanes_come_from_the_labels_words_in_lane_order_and_a_label_without_one_is_left_out() {
        let mut labels = entries(&["Done", "Waiting on me", "New", "Inbox", "Odd"]);
        labels[0].word = Some("done".into());
        labels[1].word = Some("needs-you".into());
        labels[2].word = Some("new".into());
        labels[4].word = Some("someday".into());
        let lanes = lanes_from(&labels);
        assert_eq!(
            lanes
                .iter()
                .map(|l| (l.word, l.label.as_str(), l.closes))
                .collect::<Vec<_>>(),
            [
                (Lane::New, "New", false),
                (Lane::NeedsYou, "Waiting on me", false),
                (Lane::Done, "Done", true),
            ]
        );
        assert!(lanes_from(&entries(&["Inbox", "Done"])).is_empty());
        assert_eq!(
            lane_named(&labels, &lanes, "needs-you").map(|l| l.id),
            Some(11)
        );
    }

    #[test]
    fn the_board_prints_every_lane_in_order_with_its_count_and_cards() {
        let board = OneBoard {
            board: lanes(),
            cards: vec![
                card("FEAT-41", Lane::NeedsYou, Some("Splicer"), None),
                card("BUG-12", Lane::New, None, Some("grace")),
                card("FEAT-40", Lane::NeedsYou, Some("Paper"), Some("")),
            ],
        };
        let lines = board_lines(&board);
        assert_eq!(lines[0], "New (1)");
        assert_eq!(
            lines[1],
            format!("  {:<9} {:<12} BUG-12 title  @grace", "BUG-12", "")
        );
        let needs = lines.iter().position(|l| l == "Needs you (2)").unwrap();
        assert_eq!(
            lines[needs + 1],
            format!("  {:<9} {:<12} FEAT-41 title", "FEAT-41", "Splicer")
        );
        assert_eq!(
            lines[needs + 2],
            format!("  {:<9} {:<12} FEAT-40 title", "FEAT-40", "Paper")
        );
        assert_eq!(lines.last().unwrap(), "Done (0), closes");
        assert_eq!(lines.iter().filter(|l| l.is_empty()).count(), 6);
        assert_eq!(
            lines
                .iter()
                .filter(|l| l.ends_with(')') || l.ends_with("closes"))
                .count(),
            7
        );
    }

    #[test]
    fn a_renamed_lane_prints_its_name_and_a_card_outside_the_lanes_still_shows() {
        let mut board = OneBoard {
            board: lanes(),
            cards: vec![card("FEAT-9", Lane::Stuck, Some("Splicer"), None)],
        };
        board.board.lanes[4].label = "Blocked".to_owned();
        board.board.lanes.truncate(6);
        board
            .cards
            .push(card("FEAT-8", Lane::Done, Some("Splicer"), None));
        let lines = board_lines(&board);
        assert!(lines.contains(&"Blocked (1)".to_owned()), "{lines:?}");
        assert_eq!(
            lines.last().unwrap(),
            &format!("  {:<9} {:<12} FEAT-8 title  in Done", "FEAT-8", "Splicer")
        );
        assert_eq!(board_lines(&OneBoard::default()), [NO_LANES]);
        let stray_only = OneBoard {
            board: Lanes::default(),
            cards: vec![card("FEAT-3", Lane::New, None, None)],
        };
        assert_eq!(
            board_lines(&stray_only),
            [format!("  {:<9} {:<12} FEAT-3 title  in New", "FEAT-3", "")]
        );
    }

    #[test]
    fn each_label_takes_its_word_from_the_boards_lanes_by_name_not_by_position() {
        let base_order = entries(&[
            "New",
            "In progress",
            "Landed",
            "Done",
            "Needs you",
            "Planned",
            "Stuck",
        ]);
        let lines = lane_lines(&base_order, &lanes().lanes);
        assert_eq!(
            lines,
            [
                format!("{:<12} New", "new"),
                format!("{:<12} Planned", "planned"),
                format!("{:<12} In progress", "in-progress"),
                format!("{:<12} Needs you", "needs-you"),
                format!("{:<12} Stuck", "stuck"),
                format!("{:<12} Landed", "landed"),
                format!("{:<12} {:<20} closes", "done", "Done"),
            ]
        );
        let old = lane_lines(
            &entries(&["Inbox", "Doing", "Review", "Done", "QA", "Ops", "Web"]),
            &[],
        );
        assert_eq!(old[0], format!("{:<12} Inbox", ""));
        assert_eq!(old[3], format!("{:<12} {:<20} closes", "", "Done"));
        let custom = lane_lines(&entries(&["Triage", "New"]), &lanes().lanes);
        assert_eq!(
            custom,
            [format!("{:<12} New", "new"), format!("{:<12} Triage", "")]
        );
    }

    #[test]
    fn a_lane_is_found_by_its_name_in_any_case_or_by_its_word_through_the_boards_lanes() {
        let base_order = entries(&[
            "New",
            "In progress",
            "Landed",
            "Done",
            "Waiting on me",
            "Planned",
            "Stuck",
        ]);
        let mut renamed = lanes();
        renamed.lanes[3].label = "Waiting on me".to_owned();
        assert_eq!(
            lane_named(&base_order, &renamed.lanes, "waiting ON me")
                .unwrap()
                .id,
            14
        );
        assert_eq!(
            lane_named(&base_order, &renamed.lanes, "needs-you")
                .unwrap()
                .id,
            14
        );
        assert_eq!(
            lane_named(&base_order, &renamed.lanes, " needs you ")
                .unwrap()
                .id,
            14
        );
        assert_eq!(
            lane_named(&base_order, &renamed.lanes, "in-progress")
                .unwrap()
                .id,
            11
        );
        assert_eq!(
            lane_named(&base_order, &renamed.lanes, "done").unwrap().id,
            13
        );
        assert!(lane_named(&base_order, &renamed.lanes, "QA ready").is_none());
        let old = entries(&["Inbox", "Doing", "Review", "Done", "QA", "Ops", "Web"]);
        assert!(lane_named(&old, &[], "needs-you").is_none());
        assert!(lane_named(&old, &[], "new").is_none());
        assert_eq!(lane_named(&old, &[], "done").unwrap().id, 13);
        assert_eq!(lane_named(&old, &[], "qa").unwrap().id, 14);
    }

    #[test]
    fn an_old_worker_gets_its_own_line_and_other_refusals_pass_bare() {
        assert_eq!(refusal("no such route (404)".into()), OLD_WORKER);
        assert_eq!(
            refusal("only an Owner reads the board (403)".into()),
            "only an Owner reads the board"
        );
        assert_eq!(waiting_refusal("no such route (404)".into()), NO_WAITING);
        assert_eq!(waiting_refusal("no item waiting (404)".into()), NO_WAITING);
        assert_eq!(
            waiting_refusal("bad signature (401)".into()),
            "bad signature"
        );
    }

    #[test]
    fn the_board_query_carries_each_filter_once_and_skips_empty_ones() {
        let q = BoardQuery {
            projects: vec!["Splicer".to_owned(), "Paper Two".to_owned(), String::new()],
            host: Some("shop.example.com".to_owned()),
            source: Some(Source::Agent),
            statuses: vec![Lane::NeedsYou, Lane::Landed],
        };
        assert_eq!(
            query(&q),
            "?project=Splicer&project=Paper%20Two&host=shop.example.com&source=agent&status=needs-you&status=landed"
        );
        assert_eq!(query(&BoardQuery::default()), "");
    }

    #[test]
    fn the_role_words_and_their_aliases() {
        use clap::ValueEnum;
        assert_eq!(Role::of(true), Role::Owner);
        assert_eq!(Role::of(false).word(), "User");
        assert_eq!(Role::from_str("manager", true).unwrap(), Role::Owner);
        assert_eq!(Role::from_str("reporter", true).unwrap(), Role::User);
        assert_eq!(serde_json::to_string(&Role::Owner).unwrap(), "\"owner\"");
    }
}

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use pito_tui::crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use pito_tui::footer::{Hint, InputBar, Tone};
use pito_tui::ratatui::{
    Frame,
    buffer::Buffer,
    layout::Rect,
    style::{Modifier, Style},
    text::Line,
};
use pito_tui::{Cx, Job, Palette, Phase, Pick, Screen, Span, text};

use super::Msg;
use super::badge::Badge;
use super::deck::{BoardView, Boards, Card, MOVED, NONE, Patch, patch, request, sort, stale};
use super::inbox::Inbox;
use super::source::Source;

const TALL: i32 = 4;
const PITCH: i32 = 5;
const SLIDE: Duration = Duration::from_millis(180);
const LANES: usize = 5;
const QUIET: Duration = Duration::from_millis(250);
const MAKE: &str = "p99 boards set <name> --columns \"Inbox,Doing,Done\" makes one.";

struct Lift {
    id: String,
    from: (usize, usize),
    to: (usize, usize),
    mouse: Option<Grip>,
}

#[derive(Clone, Copy)]
struct Grip {
    dx: i32,
    dy: i32,
    x: i32,
    y: i32,
}

struct Press {
    id: String,
    grip: Grip,
}

#[derive(Clone, Copy)]
struct Spot {
    from: (f32, f32),
    to: (f32, f32),
    start: Instant,
    held: bool,
    travel: bool,
}

impl Spot {
    fn at(&self, now: Instant) -> (f32, f32) {
        let t = now.saturating_duration_since(self.start).as_secs_f32() / SLIDE.as_secs_f32();
        let t = if self.travel {
            ease_in_out(t)
        } else {
            ease_out(t)
        };
        (
            self.from.0 + (self.to.0 - self.from.0) * t,
            self.from.1 + (self.to.1 - self.from.1) * t,
        )
    }

    fn moving(&self, now: Instant) -> bool {
        self.from != self.to && now.saturating_duration_since(self.start) < SLIDE
    }
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

fn ease_in_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        4.0 * t.powi(3)
    } else {
        1.0 - (2.0 - 2.0 * t).powi(3) / 2.0
    }
}

pub struct Board {
    source: Source,
    palette: Palette,
    view: Option<BoardView>,
    account: usize,
    at: Option<i64>,
    watching: String,
    error: Option<String>,
    stopped: bool,
    reading: bool,
    column: usize,
    rows: [usize; LANES],
    tops: [usize; LANES],
    fit: usize,
    lift: Option<Lift>,
    press: Option<Press>,
    moment: Instant,
    spots: HashMap<String, Spot>,
    area: Rect,
    lanes: [Rect; LANES],
    hits: Vec<(String, Rect)>,
    picking: Option<Vec<(usize, i64)>>,
    wanted: Option<(usize, i64)>,
    sending: usize,
    reader: Inbox,
    following: bool,
    stale: Option<Instant>,
    badge: Badge,
}

impl Board {
    pub fn new(source: Source, palette: Palette) -> Board {
        Board {
            reader: Inbox::new(source.clone(), palette),
            following: false,
            stale: None,
            source,
            palette,
            view: None,
            account: 0,
            at: None,
            watching: String::new(),
            error: None,
            stopped: false,
            reading: false,
            column: 0,
            rows: [0; LANES],
            tops: [0; LANES],
            fit: 1,
            lift: None,
            press: None,
            moment: Instant::now(),
            spots: HashMap::new(),
            area: Rect::default(),
            lanes: [Rect::default(); LANES],
            hits: Vec::new(),
            picking: None,
            wanted: None,
            sending: 0,
            badge: Badge::off(),
        }
    }

    pub fn badge(mut self, badge: Badge) -> Self {
        self.badge = badge;
        self
    }

    fn slug(&self) -> Option<(usize, i64)> {
        self.at.map(|id| (self.account, id))
    }

    fn lanes(&self) -> usize {
        self.view
            .as_ref()
            .map_or(1, |v| v.board.columns.len().clamp(1, LANES))
    }

    fn mine(&self) -> bool {
        self.view.as_ref().is_some_and(|v| v.board.mine)
    }

    fn lane_ids(&self) -> [Vec<usize>; LANES] {
        let mut lanes: [Vec<usize>; LANES] = Default::default();
        let Some(view) = &self.view else {
            return lanes;
        };
        let lifted = self.lift.as_ref().map(|lift| lift.id.as_str());
        for (at, card) in view.cards.iter().enumerate() {
            if Some(card.key.as_str()) == lifted {
                continue;
            }
            if let Some(lane) = view.board.lane(&card.label).filter(|&l| l < LANES) {
                lanes[lane].push(at);
            }
        }
        lanes
    }

    fn card_at(&self, column: usize, row: usize) -> Option<&Card> {
        let lanes = self.lane_ids();
        let index = *lanes.get(column)?.get(row)?;
        self.view.as_ref()?.cards.get(index)
    }

    fn current(&self) -> Option<&Card> {
        self.card_at(self.column, self.rows[self.column])
    }

    fn select(&mut self, id: &str) {
        let lanes = self.lane_ids();
        let Some(view) = &self.view else { return };
        for (column, lane) in lanes.iter().enumerate() {
            if let Some(row) = lane.iter().position(|&at| view.cards[at].key == id) {
                self.column = column;
                self.rows[column] = row;
                self.scroll(column);
                return;
            }
        }
    }

    fn clamp(&mut self) {
        let lanes = self.lane_ids();
        for (column, lane) in lanes.iter().enumerate() {
            let extra = usize::from(self.lift.as_ref().is_some_and(|l| l.to.0 == column));
            let last = (lane.len() + extra).saturating_sub(1);
            self.rows[column] = self.rows[column].min(last);
            self.scroll(column);
        }
    }

    fn scroll(&mut self, column: usize) {
        let row = match &self.lift {
            Some(lift) if lift.to.0 == column => lift.to.1,
            _ => self.rows[column],
        };
        let fit = self.fit.max(1);
        let top = &mut self.tops[column];
        if row < *top {
            *top = row;
        } else if row >= *top + fit {
            *top = row + 1 - fit;
        }
    }

    fn read(&mut self, slug: Option<(usize, i64)>, cx: &mut Cx<'_, Msg>) {
        self.reading = true;
        let source = self.source.clone();
        cx.detach(move || {
            let result = source.board(slug);
            Msg::Board(slug, result)
        });
    }

    fn shown(&mut self, account: usize, mut view: BoardView) {
        let same = self.account == account
            && self
                .view
                .as_ref()
                .is_some_and(|old| old.board.id == view.board.id);
        self.account = account;
        let kept = if same {
            self.current().map(|c| c.key.clone())
        } else {
            None
        };
        if !same {
            self.spots.clear();
            self.rows = [0; LANES];
            self.tops = [0; LANES];
            self.column = 0;
            self.lift = None;
            self.press = None;
        }
        self.at = Some(view.board.id);
        self.watching = format!("watching {}", view.board.whose());
        sort(&mut view);
        self.view = Some(view);
        if let Some(id) = kept {
            self.select(&id);
        } else if !same {
            self.column = (0..self.lanes())
                .find(|&c| self.card_at(c, 0).is_some())
                .unwrap_or(0);
        }
        self.clamp();
    }

    fn name(&self, column: usize) -> String {
        self.view
            .as_ref()
            .and_then(|v| v.board.columns.get(column))
            .map(|c| c.label.clone())
            .unwrap_or_default()
    }

    fn enter(&mut self, cx: &mut Cx<'_, Msg>) {
        if let Some(key) = self.current().map(|c| c.key.clone()) {
            self.reader.open_key(self.account, None, key, cx);
        }
    }

    fn reading_thread(&self) -> bool {
        self.reader.crumb().is_some()
    }

    fn heard(&mut self, text: &str) {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        let lifted = self.lift.as_ref().map(|l| l.id.clone());
        let kept = self.current().map(|c| c.key.clone());
        let Some(view) = self.view.as_mut() else {
            return;
        };
        let outcome = patch(view, &event);
        if let Some(id) = lifted {
            let gone = self
                .view
                .as_ref()
                .is_none_or(|v| v.cards.iter().all(|c| c.key != id));
            if gone || event["key"].as_str() == Some(id.as_str()) {
                self.lift = None;
                self.press = None;
            }
        }
        if let Some(id) = kept.filter(|_| self.lift.is_none()) {
            self.select(&id);
        }
        self.clamp();
        if outcome == Patch::Reload && self.stale.is_none() {
            self.stale = Some(self.moment + QUIET);
        }
    }

    fn pick_board(&mut self, cx: &mut Cx<'_, Msg>) {
        let source = self.source.clone();
        cx.detach(move || Msg::Boards(source.boards()));
    }

    fn offer(&mut self, all: Vec<(usize, Boards)>, cx: &mut Cx<'_, Msg>) {
        let names = self.source.accounts();
        let many = all.len() > 1;
        let mut rows: Vec<(usize, i64, String)> = Vec::new();
        for (account, boards) in &all {
            let lead = if many {
                names
                    .get(*account)
                    .map(|n| format!("{n} · "))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let mut shelf: Vec<_> = boards.boards.iter().collect();
            shelf.sort_by_key(|b| (!b.mine, (!b.mine).then(|| b.whose().to_lowercase())));
            for board in shelf {
                let label = if board.mine {
                    format!("{lead}{}", board.name)
                } else {
                    format!("{lead}{} · {}", board.whose(), board.name)
                };
                rows.push((*account, board.id, label));
            }
        }
        if rows.is_empty() {
            cx.say(format!("No board yet: {MAKE}"), Tone::Muted);
            return;
        }
        let here = self.slug();
        let at = rows
            .iter()
            .position(|(account, id, _)| {
                here.as_ref()
                    .is_some_and(|(a, here)| a == account && here == id)
            })
            .unwrap_or(0);
        let labels: Vec<String> = rows.iter().map(|(_, _, label)| label.clone()).collect();
        self.picking = Some(
            rows.into_iter()
                .map(|(account, id, _)| (account, id))
                .collect(),
        );
        cx.pick(Pick::new("Board", labels).selected(at).hints([
            Hint::new("↑↓", "move"),
            Hint::new("enter", "open"),
            Hint::new("esc", "cancel"),
        ]));
    }

    fn lift(&mut self, mouse: Option<Grip>) {
        if !self.mine() {
            return;
        }
        let Some(id) = self.current().map(|c| c.key.clone()) else {
            return;
        };
        let at = (self.column, self.rows[self.column]);
        self.lift = Some(Lift {
            id,
            from: at,
            to: at,
            mouse,
        });
    }

    fn carry(&mut self, column: usize, row: usize) {
        let lanes = self.lane_ids();
        let last = self.lanes() - 1;
        let Some(lift) = &mut self.lift else { return };
        let column = column.min(last);
        let row = row.min(lanes[column].len());
        lift.to = (column, row);
        self.column = column;
        self.rows[column] = row;
        self.scroll(column);
    }

    fn put_back(&mut self) {
        let Some(lift) = self.lift.take() else { return };
        self.column = lift.from.0;
        self.rows[lift.from.0] = lift.from.1;
        self.clamp();
    }

    fn drop_card(&mut self, cx: &mut Cx<'_, Msg>) {
        let lanes = self.lane_ids();
        let Some(lift) = self.lift.take() else { return };
        let Some(view) = &mut self.view else { return };
        let (column, row) = lift.to;
        if lift.to == lift.from {
            self.select(&lift.id);
            return;
        }
        let Some(at) = view.cards.iter().position(|c| c.key == lift.id) else {
            return;
        };
        let lane: Vec<&Card> = lanes[column].iter().map(|&at| &view.cards[at]).collect();
        let request = request(&view.board, &lane, &view.cards[at], column, row);
        let mut card = view.cards.remove(at);
        card.label = request.to.clone();
        let find = |key: &Option<String>| {
            key.as_ref()
                .and_then(|key| view.cards.iter().position(|c| c.key == *key))
        };
        let board = &view.board;
        let spot = find(&request.before)
            .or_else(|| find(&request.after).map(|at| at + 1))
            .unwrap_or_else(|| {
                view.cards
                    .iter()
                    .position(|c| board.lane(&c.label).is_none_or(|l| l > column))
                    .unwrap_or(view.cards.len())
            });
        view.cards.insert(spot, card);
        self.select(&lift.id);
        self.sending += 1;
        let source = self.source.clone();
        let account = self.account;
        let id = lift.id;
        cx.detach(move || {
            let result = source.shift(account, &request);
            Msg::Shifted(id, result)
        });
    }

    fn lane_of(&self, x: u16) -> usize {
        self.lanes
            .iter()
            .take(self.lanes())
            .position(|lane| x < lane.x + lane.width + 1)
            .unwrap_or(self.lanes() - 1)
    }

    fn row_in(&self, column: usize, y: i32) -> usize {
        let region = self.lanes[column];
        let top = (region.y + 2) as i32;
        let offset = y - top + PITCH / 2 + self.tops[column] as i32 * PITCH;
        (offset.max(0) / PITCH) as usize
    }

    fn hit(&self, x: u16, y: u16) -> Option<(String, Rect)> {
        self.hits
            .iter()
            .rev()
            .find(|(_, r)| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
            .cloned()
    }

    fn mouse_key(&mut self, event: MouseEvent, cx: &mut Cx<'_, Msg>) {
        let (x, y) = (event.column, event.row);
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                self.press = None;
                if let Some((id, rect)) = self.hit(x, y) {
                    self.select(&id);
                    self.press = Some(Press {
                        id,
                        grip: Grip {
                            dx: i32::from(x) - i32::from(rect.x),
                            dy: i32::from(y) - i32::from(rect.y),
                            x: i32::from(x),
                            y: i32::from(y),
                        },
                    });
                }
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                if self.lift.is_none()
                    && let Some(press) = self.press.take()
                {
                    self.select(&press.id);
                    self.lift(Some(press.grip));
                }
                let Some(grip) = self.lift.as_mut().and_then(|l| l.mouse.as_mut()) else {
                    return;
                };
                grip.x = i32::from(x);
                grip.y = i32::from(y);
                let top = grip.y - grip.dy;
                let column = self.lane_of(x);
                let row = self.row_in(column, top);
                self.carry(column, row);
            }
            MouseEventKind::Up(MouseButton::Left) => {
                self.press = None;
                if self.lift.as_ref().is_some_and(|l| l.mouse.is_some()) {
                    self.drop_card(cx);
                }
            }
            MouseEventKind::ScrollDown | MouseEventKind::ScrollUp if self.lift.is_none() => {
                let column = self.lane_of(x);
                let len = self.lane_ids()[column].len();
                let row = &mut self.rows[column];
                *row = if event.kind == MouseEventKind::ScrollDown {
                    (*row + 1).min(len.saturating_sub(1))
                } else {
                    row.saturating_sub(1)
                };
                self.column = column;
                self.scroll(column);
            }
            _ => {}
        }
    }

    fn place(&mut self, id: &str, to: (f32, f32), held: bool) -> (f32, f32) {
        let now = self.moment;
        match self.spots.get_mut(id) {
            Some(spot) if spot.to != to => {
                let from = spot.at(now);
                *spot = Spot {
                    from,
                    to,
                    start: now,
                    travel: !held && !spot.held && from.0 != to.0,
                    held,
                };
                from
            }
            Some(spot) => {
                spot.held = held;
                spot.at(now)
            }
            None => {
                self.spots.insert(
                    id.to_owned(),
                    Spot {
                        from: to,
                        to,
                        start: now,
                        held,
                        travel: false,
                    },
                );
                to
            }
        }
    }

    #[allow(clippy::needless_range_loop)]
    fn draw_board(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if area != self.area {
            self.spots.clear();
            self.area = area;
        }
        let gap = 1u16;
        let count = self.lanes();
        let room = area.width.saturating_sub(gap * (count as u16 - 1));
        let (width, spare) = (room / count as u16, room % count as u16);
        let mut x = area.x;
        for (at, lane) in self.lanes.iter_mut().enumerate().take(count) {
            let wide = width + u16::from((at as u16) < spare);
            *lane = Rect::new(x, area.y, wide, area.height);
            x += wide + gap;
        }
        let region_height = area.height.saturating_sub(2);
        self.fit = ((i32::from(region_height) + PITCH - TALL) / PITCH).max(1) as usize;
        let lanes = self.lane_ids();
        let lifted = self.lift.as_ref().map(|l| (l.id.clone(), l.to, l.mouse));
        self.hits.clear();
        let mut floating = None;
        for column in 0..count {
            self.scroll(column);
            let lane = self.lanes[column];
            let region = Rect::new(lane.x, lane.y + 2, lane.width, region_height);
            let count = lanes[column].len()
                + usize::from(lifted.as_ref().is_some_and(|(_, to, _)| to.0 == column));
            let target = lifted.as_ref().is_some_and(|(_, to, _)| to.0 == column);
            self.draw_head(frame.buffer_mut(), lane, column, count, target, palette);
            let mut slot = 0usize;
            let gap_at = lifted
                .as_ref()
                .filter(|(_, to, _)| to.0 == column)
                .map(|(_, to, _)| to.1);
            let total = lanes[column].len() + usize::from(gap_at.is_some());
            if total == 0 && region.height > 1 {
                put(
                    frame.buffer_mut(),
                    region,
                    i32::from(region.x) + 2,
                    i32::from(region.y) + 1,
                    "no cards",
                    usize::from(region.width.saturating_sub(2)),
                    palette.muted,
                );
            }
            for row in 0..total {
                let y = i32::from(region.y) + (row as i32 - self.tops[column] as i32) * PITCH;
                let spot = (f32::from(region.x), y as f32);
                if gap_at == Some(row) {
                    let (id, _, mouse) = lifted.clone().unwrap_or_default();
                    dashed(
                        frame.buffer_mut(),
                        region,
                        region.x,
                        y,
                        region.width,
                        palette,
                    );
                    let at = match mouse {
                        Some(grip) => {
                            let x = (grip.x - grip.dx).clamp(
                                i32::from(area.x),
                                i32::from(area.right()) - i32::from(region.width),
                            );
                            let y = (grip.y - grip.dy)
                                .clamp(i32::from(area.y), i32::from(area.bottom()) - TALL);
                            self.spots.insert(
                                id.clone(),
                                Spot {
                                    from: (x as f32, y as f32),
                                    to: (x as f32, y as f32),
                                    start: self.moment,
                                    held: true,
                                    travel: false,
                                },
                            );
                            (x as f32, y as f32)
                        }
                        None => self.place(&id, spot, true),
                    };
                    floating = Some((id, at, region.width));
                    continue;
                }
                let index = lanes[column][slot];
                slot += 1;
                let Some(card) = self.view.as_ref().map(|v| v.cards[index].clone()) else {
                    continue;
                };
                let done = self
                    .view
                    .as_ref()
                    .is_some_and(|v| v.board.closes(&card.label));
                let id = card.key.clone();
                let (x, y) = self.place(&id, spot, false);
                let (x, y) = (x.round() as i32, y.round() as i32);
                let selected =
                    self.lift.is_none() && column == self.column && row == self.rows[column];
                draw_card(
                    frame.buffer_mut(),
                    region,
                    x,
                    y,
                    region.width,
                    &card,
                    (selected, false, done),
                    palette,
                );
                if y >= i32::from(region.y) && y + TALL <= i32::from(region.bottom()) {
                    self.hits
                        .push((id, Rect::new(x as u16, y as u16, region.width, TALL as u16)));
                }
            }
        }
        if let Some((id, (x, y), width)) = floating
            && let Some(card) = self
                .view
                .as_ref()
                .and_then(|v| v.cards.iter().find(|c| c.key == id))
                .cloned()
        {
            let done = self
                .view
                .as_ref()
                .is_some_and(|v| v.board.closes(&card.label));
            draw_card(
                frame.buffer_mut(),
                area,
                x.round() as i32,
                y.round() as i32,
                width,
                &card,
                (true, true, done),
                palette,
            );
        }
    }

    fn draw_head(
        &self,
        buf: &mut Buffer,
        lane: Rect,
        column: usize,
        count: usize,
        target: bool,
        palette: &Palette,
    ) {
        if lane.height < 2 || lane.width < 4 {
            return;
        }
        let name = self.name(column);
        let lit = column == self.column;
        let style = if lit { palette.accent } else { palette.strong };
        let room = usize::from(lane.width);
        let mut more = String::new();
        let top = self.tops[column];
        if top > 0 {
            more.push_str(&format!("↑{top}"));
        }
        let below = count.saturating_sub(top + self.fit);
        if below > 0 {
            if !more.is_empty() {
                more.push(' ');
            }
            more.push_str(&format!("↓{below}"));
        }
        let count = count.to_string();
        let tail = text::cells(&count)
            + if more.is_empty() {
                0
            } else {
                2 + text::cells(&more)
            };
        let name = text::clip(&name, room.saturating_sub(1 + tail));
        let (x, _) = buf.set_stringn(
            lane.x,
            lane.y,
            &name,
            room,
            style.add_modifier(Modifier::BOLD),
        );
        let room = usize::from(lane.right().saturating_sub(x + 1));
        let (x, _) = buf.set_stringn(x + 1, lane.y, &count, room, palette.muted);
        if !more.is_empty() {
            let room = usize::from(lane.right().saturating_sub(x + 2));
            buf.set_stringn(x + 2, lane.y, &more, room, palette.muted);
        }
        let room = usize::from(lane.width);
        let rule = if target {
            "━".repeat(room)
        } else {
            "─".repeat(room)
        };
        let rule_style = if target || lit {
            palette.accent
        } else {
            palette.rule
        };
        buf.set_stringn(lane.x, lane.y + 1, rule, room, rule_style);
    }
}

fn put(buf: &mut Buffer, clip: Rect, x: i32, y: i32, text: &str, room: usize, style: Style) -> i32 {
    if y < i32::from(clip.y) || y >= i32::from(clip.bottom()) || x < i32::from(clip.x) {
        return x + text::cells(text).min(room) as i32;
    }
    let room = room.min(usize::from(clip.right()).saturating_sub(x as usize));
    let (end, _) = buf.set_stringn(x as u16, y as u16, text, room, style);
    i32::from(end)
}

fn dashed(buf: &mut Buffer, clip: Rect, x: u16, y: i32, width: u16, palette: &Palette) {
    let w = usize::from(width);
    if w < 2 {
        return;
    }
    let x = i32::from(x);
    let style = palette.muted;
    let line = format!("╭{}╮", "┄".repeat(w - 2));
    put(buf, clip, x, y, &line, w, style);
    for row in 1..TALL - 1 {
        put(buf, clip, x, y + row, "┆", 1, style);
        put(buf, clip, x + w as i32 - 1, y + row, "┆", 1, style);
    }
    let line = format!("╰{}╯", "┄".repeat(w - 2));
    put(buf, clip, x, y + TALL - 1, &line, w, style);
}

struct Edges {
    top: [&'static str; 3],
    side: &'static str,
    bottom: [&'static str; 3],
}

const ROUND: Edges = Edges {
    top: ["╭", "─", "╮"],
    side: "│",
    bottom: ["╰", "─", "╯"],
};

const HELD: Edges = Edges {
    top: ["╔", "═", "╗"],
    side: "║",
    bottom: ["╚", "═", "╝"],
};

#[allow(clippy::too_many_arguments)]
fn edge(
    buf: &mut Buffer,
    clip: Rect,
    x: i32,
    y: i32,
    width: usize,
    ends: [&str; 3],
    parts: &[(String, Style)],
    tail: &[(String, Style)],
    style: Style,
) {
    let inner = width.saturating_sub(2);
    let used: usize = parts.iter().chain(tail).map(|(t, _)| text::cells(t)).sum();
    let fill = inner.saturating_sub(used + 2);
    let mut at = put(buf, clip, x, y, ends[0], 1, style);
    at = put(buf, clip, at, y, ends[1], 1, style);
    for (part, look) in parts {
        at = put(buf, clip, at, y, part, inner, *look);
    }
    at = put(buf, clip, at, y, &ends[1].repeat(fill), fill, style);
    for (part, look) in tail {
        at = put(buf, clip, at, y, part, inner, *look);
    }
    let end = x + width as i32 - 2;
    if at <= end {
        put(
            buf,
            clip,
            at,
            y,
            &ends[1].repeat((end - at + 1) as usize),
            width,
            style,
        );
    }
    put(buf, clip, x + width as i32 - 1, y, ends[2], 1, style);
}

#[allow(clippy::too_many_arguments)]
fn draw_card(
    buf: &mut Buffer,
    clip: Rect,
    x: i32,
    y: i32,
    width: u16,
    card: &Card,
    (selected, held, done): (bool, bool, bool),
    palette: &Palette,
) {
    let w = usize::from(width);
    if w < 6 {
        return;
    }
    let inner = w - 4;
    let (edges, frame) = match (held, selected) {
        (true, _) => (&HELD, palette.accent.add_modifier(Modifier::BOLD)),
        (false, true) => (&ROUND, palette.accent),
        (false, false) => (&ROUND, palette.rule),
    };
    let area = clip.intersection(Rect::new(
        x.max(0) as u16,
        y.max(0) as u16,
        width,
        TALL as u16,
    ));
    if y >= 0 {
        buf.set_style(area, Style::reset());
    }
    for row in 1..TALL - 1 {
        put(buf, clip, x, y + row, edges.side, 1, frame);
        put(
            buf,
            clip,
            x + 1,
            y + row,
            &" ".repeat(w - 2),
            w - 2,
            Style::new(),
        );
        put(buf, clip, x + w as i32 - 1, y + row, edges.side, 1, frame);
    }
    let head = vec![(
        format!(" {} ", card.key),
        key_style(palette, selected || held),
    )];
    edge(buf, clip, x, y, w, edges.top, &head, &[], frame);
    let title = if done && !(selected || held) {
        palette.muted
    } else if selected || held {
        palette.selected
    } else {
        palette.ink
    };
    let lines = text::wrap(&card.title, inner);
    let first = lines.first().cloned().unwrap_or_default();
    let rest = lines.get(1..).map(|r| r.join(" ")).unwrap_or_default();
    put(buf, clip, x + 2, y + 1, &first, inner, title);
    put(
        buf,
        clip,
        x + 2,
        y + 2,
        &text::clip(&rest, inner),
        inner,
        title,
    );
    let mut tail = Vec::new();
    if let Some(who) = card.assignee.as_ref().filter(|p| p.username.is_some()) {
        let who = text::clip(&who.handle(), inner.saturating_sub(2));
        tail.push((format!(" {who} "), palette.muted));
    }
    edge(
        buf,
        clip,
        x,
        y + TALL - 1,
        w,
        edges.bottom,
        &[],
        &tail,
        frame,
    );
}

fn key_style(palette: &Palette, lit: bool) -> Style {
    if lit {
        palette.accent.add_modifier(Modifier::BOLD)
    } else {
        palette.strong
    }
}

impl Screen<Msg> for Board {
    fn legend(&self) -> Option<&str> {
        Some(crate::ASK)
    }

    fn phase(&self) -> Phase<'_> {
        if self.view.is_some() {
            return Phase::Ready;
        }
        match (&self.error, self.stopped) {
            (Some(error), _) if error == NONE => Phase::Trouble(
                vec![
                    Line::from("No board yet."),
                    Line::from(MAKE),
                    Line::default(),
                    Line::from("r reads it again · p99 tui --demo shows sample data"),
                ]
                .into(),
            ),
            (Some(error), _) => Phase::Trouble(
                vec![
                    Line::from("Couldn't read the board."),
                    Line::from(error.as_str()),
                    Line::default(),
                    Line::from("r reads it again · p99 tui --demo shows sample data"),
                ]
                .into(),
            ),
            (None, false) => Phase::Loading("Reading the board…".into()),
            (None, true) => Phase::Trouble(
                vec![
                    Line::from("Stopped waiting for the board."),
                    Line::from("r reads it again."),
                ]
                .into(),
            ),
        }
    }

    fn load(&mut self) -> Option<Job<Msg>> {
        self.view = None;
        self.error = None;
        self.stopped = false;
        let source = self.source.clone();
        let slug = self.slug();
        Some(Box::new(move || {
            let result = source.board(slug);
            Msg::Board(slug, result)
        }))
    }

    fn loaded(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.event(event, cx);
    }

    fn cancel(&mut self) {
        self.stopped = true;
    }

    fn moment(&mut self, now: Instant) {
        self.moment = now;
        self.badge.moment(now);
    }

    fn animating(&self) -> bool {
        let now = self.moment;
        self.badge.easing() || self.spots.values().any(|spot| spot.moving(now))
    }

    fn event(&mut self, event: Msg, cx: &mut Cx<'_, Msg>) {
        self.moment = self.moment.max(cx.now());
        match event {
            Msg::Board(slug, result) => {
                let asked = slug.is_some() && slug == self.wanted;
                if slug.is_some() && self.at.is_some() && slug != self.slug() && !asked {
                    return;
                }
                if asked {
                    self.wanted = None;
                }
                self.reading = false;
                if result.is_ok() && !self.following && !self.source.is_demo() {
                    self.following = true;
                    self.source.follow(&cx.waker());
                }
                match result {
                    Ok((account, view)) => self.shown(account, view),
                    Err(error) if self.view.is_some() => cx.say(error, Tone::Alert),
                    Err(error) => self.error = Some(error),
                }
            }
            Msg::Shifted(id, result) => {
                self.sending = self.sending.saturating_sub(1);
                match result {
                    Ok(moved) => {
                        let kept = self.current().map(|c| c.key.clone());
                        if let Some(view) = &mut self.view
                            && let Some(at) = view.cards.iter().position(|c| c.key == id)
                        {
                            if view.board.lane(&moved.card.label).is_some() {
                                view.cards[at] = moved.card;
                            } else {
                                view.cards.remove(at);
                            }
                            sort(view);
                        }
                        if let Some(key) = kept.filter(|_| self.lift.is_none()) {
                            self.select(&key);
                        }
                        self.clamp();
                    }
                    Err(error) if stale(&error) => {
                        cx.say(MOVED, Tone::Alert);
                        self.read(self.slug(), cx);
                    }
                    Err(error) => {
                        cx.say(error, Tone::Alert);
                        self.read(self.slug(), cx);
                    }
                }
            }
            Msg::Heard(account, text) if account == self.account => {
                self.heard(&text);
                if self.reading_thread() {
                    self.reader.event(Msg::Heard(account, text), cx);
                }
            }
            Msg::Deleted(key, result) => {
                if result.is_ok()
                    && let Some(view) = &mut self.view
                {
                    view.cards.retain(|c| c.key != key);
                    self.clamp();
                }
                self.reader.event(Msg::Deleted(key, result), cx);
            }
            Msg::Boards(Ok(all)) => self.offer(all, cx),
            Msg::Boards(Err(error)) => cx.say(error, Tone::Alert),
            Msg::Pushed(_, None) => self.stale = Some(self.moment),
            Msg::Changed(key, result) => {
                if result.is_ok() {
                    self.stale = Some(self.moment);
                }
                self.reader.event(Msg::Changed(key, result), cx);
            }
            event @ (Msg::Thread(..)
            | Msg::Commented(..)
            | Msg::Inbox(_)
            | Msg::Pushed(..)
            | Msg::Labels(_))
                if self.reading_thread() =>
            {
                self.reader.event(event, cx);
            }
            _ => {}
        }
    }

    fn deadline(&self) -> Option<Instant> {
        self.stale
    }

    fn tick(&mut self, cx: &mut Cx<'_, Msg>) {
        self.moment = self.moment.max(cx.now());
        if self.stale.is_some_and(|due| due <= self.moment) {
            self.stale = None;
            if !self.reading {
                self.read(self.slug(), cx);
            }
        }
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        self.moment = self.moment.max(cx.now());
        if self.reading_thread() {
            self.reader.key(key, cx);
            return;
        }
        if self.view.is_none() {
            if key.code == KeyCode::Char('r') {
                cx.reload();
            }
            return;
        }
        if let Some(lift) = &self.lift {
            let (column, row) = lift.to;
            match key.code {
                KeyCode::Left | KeyCode::Char('h') => self.carry(column.saturating_sub(1), row),
                KeyCode::Right | KeyCode::Char('l') => self.carry(column + 1, row),
                KeyCode::Up | KeyCode::Char('k') => self.carry(column, row.saturating_sub(1)),
                KeyCode::Down | KeyCode::Char('j') => self.carry(column, row + 1),
                KeyCode::Home | KeyCode::Char('g') => self.carry(column, 0),
                KeyCode::End | KeyCode::Char('G') => self.carry(column, usize::MAX),
                KeyCode::Enter | KeyCode::Char(' ') => self.drop_card(cx),
                KeyCode::Esc => self.put_back(),
                _ => {}
            }
            return;
        }
        let column = self.column;
        let len = self.lane_ids()[column].len();
        match key.code {
            KeyCode::Left | KeyCode::Char('h') => {
                self.column = column.saturating_sub(1);
                self.clamp();
            }
            KeyCode::Right | KeyCode::Char('l') => {
                self.column = (column + 1).min(self.lanes() - 1);
                self.clamp();
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.rows[column] = self.rows[column].saturating_sub(1);
                self.scroll(column);
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.rows[column] = (self.rows[column] + 1).min(len.saturating_sub(1));
                self.scroll(column);
            }
            KeyCode::Home | KeyCode::Char('g') => {
                self.rows[column] = 0;
                self.scroll(column);
            }
            KeyCode::End | KeyCode::Char('G') => {
                self.rows[column] = len.saturating_sub(1);
                self.scroll(column);
            }
            KeyCode::Char(' ') => self.lift(None),
            KeyCode::Enter => self.enter(cx),
            KeyCode::Char('b') => self.pick_board(cx),
            KeyCode::Char('r') => self.read(self.slug(), cx),
            _ => {}
        }
    }

    fn mouse(&mut self, mouse: MouseEvent, _area: Rect, cx: &mut Cx<'_, Msg>) {
        self.moment = self.moment.max(cx.now());
        if self.view.is_some() && !self.reading_thread() {
            self.mouse_key(mouse, cx);
        }
    }

    fn picked(&mut self, choice: Option<usize>, cx: &mut Cx<'_, Msg>) {
        if self.reading_thread() {
            self.reader.picked(choice, cx);
            return;
        }
        let (Some(rows), Some(choice)) = (self.picking.take(), choice) else {
            return;
        };
        let Some(slug) = rows.into_iter().nth(choice) else {
            return;
        };
        if Some(slug) == self.slug() {
            return;
        }
        self.wanted = Some(slug);
        self.read(Some(slug), cx);
    }

    fn back(&mut self, cx: &mut Cx<'_, Msg>) {
        if self.reading_thread() {
            self.reader.back(cx);
            if self.stale.is_some() {
                self.stale = Some(self.moment);
            }
        }
    }

    fn crumb(&self) -> Option<String> {
        self.reader.crumb()
    }

    fn typing(&self) -> bool {
        self.lift.is_some() || (self.reading_thread() && self.reader.typing())
    }

    fn input(&self) -> Option<InputBar<'_>> {
        if self.reading_thread() {
            self.reader.input()
        } else {
            None
        }
    }

    fn paste(&mut self, text: &str, cx: &mut Cx<'_, Msg>) {
        if self.reading_thread() {
            self.reader.paste(text, cx);
        }
    }

    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if self.reading_thread() {
            self.reader.draw(frame, area, palette);
            return;
        }
        super::BOARD_SHOWN.store(true, Ordering::Relaxed);
        self.draw_board(frame, area, palette);
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if self.reading_thread() {
            return self.reader.hints();
        }
        if self.view.is_none() {
            return vec![Hint::new("r", "read again")];
        }
        if self.lift.is_some() {
            return vec![
                Hint::new("←→↑↓", "carry"),
                Hint::new("enter", "drop"),
                Hint::new("esc", "put back"),
            ];
        }
        let mut hints = vec![Hint::new("←→↑↓", "move")];
        let card = self.current().is_some();
        if !self.mine() {
            hints.push(Hint::new("", &self.watching));
        } else if card {
            hints.push(Hint::new("space", "pick up").rank(1));
        }
        if card {
            hints.push(Hint::new("enter", "open").rank(1));
        }
        hints.push(Hint::new("b", "boards").rank(2));
        hints.push(Hint::new("r", "read again").rank(3));
        hints
    }

    fn status(&self) -> Option<(String, Style)> {
        let view = self.view.as_ref()?;
        Some((view.board.name.clone(), self.palette.accent))
    }

    fn badge(&self) -> &[Span] {
        self.badge.parts()
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let Some(view) = &self.view else {
            return Vec::new();
        };
        let items = view.cards.len();
        let done = view
            .cards
            .iter()
            .filter(|c| view.board.closes(&c.label))
            .count();
        let mut facts = vec![(view.board.name.clone(), self.palette.strong)];
        if !view.board.mine {
            facts.push((view.board.whose(), self.palette.accent));
        }
        facts.push((
            format!("{items} {}", if items == 1 { "item" } else { "items" }),
            Style::new(),
        ));
        facts.push((format!("{done}/{items} done"), self.palette.good));
        if self.sending > 0 {
            facts.push(("saving…".to_owned(), self.palette.muted));
        } else if self.reading {
            facts.push(("reading…".to_owned(), self.palette.muted));
        }
        if self.source.is_demo() {
            facts.push(("sample data".to_owned(), self.palette.muted));
        }
        facts
    }

    fn selected(&self) -> usize {
        self.rows[self.column]
    }
}

#[cfg(test)]
mod tests;

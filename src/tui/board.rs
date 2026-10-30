use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use pito_tui::crossterm::event::{KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use pito_tui::footer::{Hint, InputBar, Tone};
use pito_tui::keys::Key;
use pito_tui::ratatui::{
    Frame,
    buffer::Buffer,
    layout::Rect,
    style::{Modifier, Style},
    text::Line,
};
use pito_tui::{Cx, Job, Palette, Phase, Screen, Span, text};

use super::Msg;
use super::badge::Badge;
use super::deck::{BoardView, Card, MOVED, Patch, patch, request, settle, sort, stale};
use super::inbox::Inbox;
use super::keys::{self, Act, BOARD, CARRYING, HERE, READ, Seat};
use super::projects::{Narrow, Shared};
use super::source::Source;

const TALL: i32 = 4;
const PITCH: i32 = 5;
const SLIDE: Duration = Duration::from_millis(180);
const LANES: usize = 7;
const QUIET: Duration = Duration::from_millis(250);
const NOTES: u16 = 3;
const ROOMY: u16 = 120;

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
    names: Vec<String>,
    many: bool,
    projects: Vec<String>,
    asked: Vec<String>,
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
    visible: Vec<usize>,
    hits: Vec<(String, Rect)>,
    sending: usize,
    reader: Inbox,
    following: bool,
    stale: Option<Instant>,
    badge: Badge,
    shared: Option<Shared>,
}

impl Board {
    pub fn new(source: Source, palette: Palette) -> Board {
        Board {
            reader: Inbox::new(source.clone(), palette),
            following: false,
            stale: None,
            names: source.spaces(),
            shared: None,
            many: source.scoped().len() > 1,
            projects: Vec::new(),
            asked: Vec::new(),
            source,
            palette,
            view: None,
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
            visible: Vec::new(),
            hits: Vec::new(),
            sending: 0,
            badge: Badge::off(),
        }
    }

    pub fn badge(mut self, badge: Badge) -> Self {
        self.badge = badge;
        self
    }

    pub fn shared(mut self, shared: Shared) -> Self {
        self.shared = Some(shared);
        self
    }

    fn named(&mut self) {
        let Some(shared) = &self.shared else { return };
        let state = shared.0.borrow();
        if state.names.len() == self.names.len() && state.names != self.names {
            self.names.clone_from(&state.names);
        }
    }

    fn lanes(&self) -> usize {
        self.view
            .as_ref()
            .map_or(1, |v| v.lanes.len().clamp(1, LANES))
    }

    fn lane_ids(&self) -> [Vec<usize>; LANES] {
        let mut lanes: [Vec<usize>; LANES] = Default::default();
        let Some(view) = &self.view else {
            return lanes;
        };
        let lifted = self.lift.as_ref().map(|lift| lift.id.as_str());
        for (at, card) in view.cards.iter().enumerate() {
            if Some(card.id.as_str()) == lifted {
                continue;
            }
            if let Some(lane) = view.lane(card.status).filter(|&l| l < LANES) {
                lanes[lane].push(at);
            }
        }
        lanes
    }

    fn showing(&self, roomy: bool) -> Vec<usize> {
        let count = self.lanes();
        if roomy {
            return (0..count).collect();
        }
        let lanes = self.lane_ids();
        let carried = self.lift.as_ref().map(|l| (l.from.0, l.to.0));
        (0..count)
            .filter(|&column| {
                !lanes[column].is_empty()
                    || column == self.column
                    || carried.is_some_and(|(from, to)| column == from || column == to)
            })
            .collect()
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
            if let Some(row) = lane.iter().position(|&at| view.cards[at].id == id) {
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

    fn read(&mut self, cx: &mut Cx<'_, Msg>) {
        self.reading = true;
        cx.detach(self.asking());
    }

    fn asking(&mut self) -> impl FnOnce() -> Msg + Send + 'static {
        self.asked = self.projects.clone();
        let source = self.source.clone();
        let projects = self.projects.clone();
        move || {
            let result = source.board(&projects);
            Msg::Board(projects, result)
        }
    }

    fn shown(&mut self, mut view: BoardView) {
        let same = self.view.is_some();
        let kept = if same {
            self.current().map(|c| c.id.clone())
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
            .and_then(|v| v.lanes.get(column))
            .map(|c| c.label.clone())
            .unwrap_or_default()
    }

    fn enter(&mut self, cx: &mut Cx<'_, Msg>) {
        if let Some((space, key)) = self.current().map(|c| (c.space, c.key.clone())) {
            self.reader.open_key(space, None, key, cx);
        }
    }

    fn reading_thread(&self) -> bool {
        self.reader.crumb().is_some()
    }

    pub fn seat(&self) -> Seat {
        if self.reading_thread() {
            return self.reader.seat();
        }
        if self.lift.is_some() {
            return Seat::new(CARRYING);
        }
        let read = self.view.is_some();
        Seat::new(BOARD)
            .with(READ, read)
            .with(HERE, read && self.current().is_some())
    }

    fn heard(&mut self, space: usize, text: &str) {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        let lifted = self.lift.as_ref().map(|l| l.id.clone());
        let kept = self.current().map(|c| c.id.clone());
        let Some(view) = self.view.as_mut() else {
            return;
        };
        let outcome = patch(view, space, &event);
        if let Some(id) = lifted {
            let gone = self
                .view
                .as_ref()
                .is_none_or(|v| v.cards.iter().all(|c| c.id != id));
            let key = event["key"].as_str().map(|key| format!("{space}/{key}"));
            if gone || key.as_deref() == Some(id.as_str()) {
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

    fn lift(&mut self, mouse: Option<Grip>) {
        let Some(id) = self.current().map(|c| c.id.clone()) else {
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
        let Some(at) = view.cards.iter().position(|c| c.id == lift.id) else {
            return;
        };
        let lane: Vec<&Card> = lanes[column].iter().map(|&at| &view.cards[at]).collect();
        let request = request(view, &lane, &view.cards[at], column, row);
        let space = view.cards[at].space;
        let mut card = view.cards.remove(at);
        if let Some(to) = view.lanes.get(column) {
            card.label = to.label.clone();
            card.status = to.word;
        }
        let find = |key: &Option<String>| key.as_ref().and_then(|key| view.find(space, key));
        let spot = find(&request.before)
            .or_else(|| find(&request.after).map(|at| at + 1))
            .unwrap_or_else(|| {
                view.cards
                    .iter()
                    .position(|c| view.lane(c.status).is_none_or(|l| l > column))
                    .unwrap_or(view.cards.len())
            });
        view.cards.insert(spot, card);
        self.select(&lift.id);
        self.sending += 1;
        let source = self.source.clone();
        let id = lift.id;
        cx.detach(move || {
            let result = source.shift(space, &request);
            Msg::Shifted(id, result)
        });
    }

    fn lane_of(&self, x: u16) -> usize {
        let last = self.visible.last().copied().unwrap_or_default();
        self.visible
            .iter()
            .copied()
            .find(|&column| x < self.lanes[column].x + self.lanes[column].width + 1)
            .unwrap_or(last)
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

    fn draw_board(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        let area = self.draw_notes(frame.buffer_mut(), area, palette);
        if area != self.area {
            self.spots.clear();
            self.area = area;
        }
        let gap = 1u16;
        self.visible = self.showing(frame.area().width >= ROOMY);
        let shown = self.visible.clone();
        let count = shown.len().max(1);
        let room = area.width.saturating_sub(gap * (count as u16 - 1));
        let (width, spare) = (room / count as u16, room % count as u16);
        let mut x = area.x;
        self.lanes = [Rect::default(); LANES];
        for (at, &column) in shown.iter().enumerate() {
            let wide = width + u16::from((at as u16) < spare);
            self.lanes[column] = Rect::new(x, area.y, wide, area.height);
            x += wide + gap;
        }
        let region_height = area.height.saturating_sub(2);
        self.fit = ((i32::from(region_height) + PITCH - TALL) / PITCH).max(1) as usize;
        let lanes = self.lane_ids();
        let lifted = self.lift.as_ref().map(|l| (l.id.clone(), l.to, l.mouse));
        self.hits.clear();
        let mut floating = None;
        for column in shown {
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
                let done = self.view.as_ref().is_some_and(|v| v.closes(&card));
                let id = card.id.clone();
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
                    (&card, self.whose(&card)),
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
                .and_then(|v| v.cards.iter().find(|c| c.id == id))
                .cloned()
        {
            let done = self.view.as_ref().is_some_and(|v| v.closes(&card));
            draw_card(
                frame.buffer_mut(),
                area,
                x.round() as i32,
                y.round() as i32,
                width,
                (&card, self.whose(&card)),
                (true, true, done),
                palette,
            );
        }
    }

    fn whose(&self, card: &Card) -> Option<&str> {
        if self.many {
            self.names.get(card.space).map(String::as_str)
        } else {
            None
        }
    }

    fn draw_notes(&self, buf: &mut Buffer, area: Rect, palette: &Palette) -> Rect {
        let notes = self.view.as_ref().map_or(&[][..], |v| v.missing.as_slice());
        let room = NOTES.min(area.height / 3);
        let used = (notes.len() as u16).min(room);
        for (at, note) in notes.iter().take(usize::from(used)).enumerate() {
            let line = text::clip(note, usize::from(area.width));
            buf.set_stringn(
                area.x,
                area.y + at as u16,
                &line,
                usize::from(area.width),
                palette.warn,
            );
        }
        if used == 0 {
            return area;
        }
        let used = used + 1;
        Rect::new(
            area.x,
            area.y + used,
            area.width,
            area.height.saturating_sub(used),
        )
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
        if lane.height < 2 || lane.width < 1 {
            return;
        }
        let lit = column == self.column;
        let rule_style = if target || lit {
            palette.accent
        } else {
            palette.rule
        };
        let glyph = if target { "━" } else { "─" };
        for x in lane.left()..lane.right() {
            if let Some(cell) = buf.cell_mut((x, lane.y + 1)) {
                cell.set_symbol(glyph).set_style(rule_style);
            }
        }
        if lane.width < 4 {
            return;
        }
        let name = self.name(column);
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
                1 + text::cells(&more)
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
            let room = usize::from(lane.right().saturating_sub(x + 1));
            buf.set_stringn(x + 1, lane.y, &more, room, palette.muted);
        }
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
    if inner > used {
        at = put(buf, clip, at, y, ends[1], 1, style);
    }
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
    (card, space): (&Card, Option<&str>),
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
    let key = if text::cells(&card.key) + 4 <= w {
        format!(" {} ", card.key)
    } else {
        card.key.clone()
    };
    let head = vec![(key, key_style(palette, selected || held))];
    let mut top = Vec::new();
    if let Some(space) = space {
        let room = inner.saturating_sub(text::cells(&card.key) + 4);
        if room > 2 {
            top.push((format!(" {} ", text::clip(space, room - 2)), palette.muted));
        }
    }
    edge(buf, clip, x, y, w, edges.top, &head, &top, frame);
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
    let mut room = inner.saturating_sub(2);
    if let Some(who) = card.assignee.as_deref().and_then(|u| handle(u, room)) {
        room = room.saturating_sub(text::cells(&who) + 3);
        tail.push((format!(" {who} "), palette.muted));
    }
    let mut parts = Vec::new();
    if let Some(project) = card.project.as_deref().filter(|_| room > 2) {
        parts.push((
            format!(" {} ", text::clip(project, room - 2)),
            palette.accent,
        ));
    }
    edge(
        buf,
        clip,
        x,
        y + TALL - 1,
        w,
        edges.bottom,
        &parts,
        &tail,
        frame,
    );
}

fn handle(who: &str, room: usize) -> Option<String> {
    if who.is_empty() {
        return None;
    }
    let full = format!("@{who}");
    if text::cells(&full) <= room {
        return Some(full);
    }
    let first = who.split(['.', '_', '-']).next().unwrap_or(who);
    if first != who {
        let kept = fits(first, room.saturating_sub(2));
        return (text::cells(kept) >= 2).then(|| format!("@{kept}…"));
    }
    snip(who, room.saturating_sub(1)).map(|s| format!("@{s}"))
}

fn snip(text: &str, room: usize) -> Option<String> {
    let clipped = text::clip(text, room);
    if text::cells(&clipped) > 1 {
        return Some(clipped);
    }
    let kept = fits(text, room.saturating_sub(1));
    (text::cells(kept) >= 2).then(|| format!("{kept}…"))
}

fn fits(text: &str, room: usize) -> &str {
    let end = text
        .char_indices()
        .map(|(at, _)| at)
        .chain([text.len()])
        .take_while(|&at| text::cells(&text[..at]) <= room)
        .last()
        .unwrap_or(0);
    &text[..end]
}

enum Way {
    Left,
    Right,
    Up,
    Down,
}

impl Way {
    fn of(key: Key) -> Way {
        match key {
            Key::Left | Key::Char('h') => Way::Left,
            Key::Right | Key::Char('l') => Way::Right,
            Key::Up | Key::Char('k') => Way::Up,
            _ => Way::Down,
        }
    }
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
        Some(Box::new(self.asking()))
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
            Msg::Board(projects, _) if projects != self.projects => {
                if self.asked != self.projects {
                    self.read(cx);
                }
            }
            Msg::Board(_, result) => {
                self.reading = false;
                if result.is_ok() && !self.following && !self.source.is_demo() {
                    self.following = true;
                    self.source.follow(&cx.waker());
                }
                match result {
                    Ok(view) => self.shown(view),
                    Err(error) if self.view.is_some() => cx.say(error, Tone::Alert),
                    Err(error) => self.error = Some(error),
                }
            }
            Msg::Shifted(id, result) => {
                self.sending = self.sending.saturating_sub(1);
                match result {
                    Ok(moved) => {
                        let kept = self.current().map(|c| c.id.clone());
                        if let Some(view) = &mut self.view
                            && let Some(at) = view.cards.iter().position(|c| c.id == id)
                        {
                            if settle(view, at, &moved.card.label) {
                                view.cards[at].order = moved.card.order;
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
                        self.read(cx);
                    }
                    Err(error) => {
                        cx.say(error, Tone::Alert);
                        self.read(cx);
                    }
                }
            }
            Msg::Heard(space, text) => {
                self.heard(space, &text);
                if self.reading_thread() {
                    self.reader.event(Msg::Heard(space, text), cx);
                }
            }
            Msg::Deleted(key, result) => {
                if result.is_ok()
                    && let Some(view) = &mut self.view
                {
                    if self.many {
                        self.stale = Some(self.moment);
                    } else {
                        view.cards.retain(|c| c.key != key);
                    }
                    self.clamp();
                }
                self.reader.event(Msg::Deleted(key, result), cx);
            }
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
            | Msg::Labels(_)
            | Msg::Saved(_))
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
                self.read(cx);
            }
        }
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        self.moment = self.moment.max(cx.now());
        if self.reading_thread() {
            self.reader.key(key, cx);
            return;
        }
        let Some((act, chord)) = keys::action(self.seat().now(), &key) else {
            return;
        };
        if self.view.is_none() {
            if act == Act::Reload {
                cx.reload();
            }
            return;
        }
        if let Some(lift) = &self.lift {
            let (column, row) = lift.to;
            match (act, Way::of(chord.key)) {
                (Act::Step, Way::Left) => self.carry(column.saturating_sub(1), row),
                (Act::Step, Way::Right) => self.carry(column + 1, row),
                (Act::Step, Way::Up) => self.carry(column, row.saturating_sub(1)),
                (Act::Step, Way::Down) => self.carry(column, row + 1),
                (Act::Top, _) => self.carry(column, 0),
                (Act::Bottom, _) => self.carry(column, usize::MAX),
                (Act::Drop, _) => self.drop_card(cx),
                (Act::PutBack, _) => self.put_back(),
                _ => {}
            }
            return;
        }
        let column = self.column;
        let len = self.lane_ids()[column].len();
        match (act, Way::of(chord.key)) {
            (Act::Step, Way::Left) => {
                self.column = column.saturating_sub(1);
                self.clamp();
            }
            (Act::Step, Way::Right) => {
                self.column = (column + 1).min(self.lanes() - 1);
                self.clamp();
            }
            (Act::Step, Way::Up) => {
                self.rows[column] = self.rows[column].saturating_sub(1);
                self.scroll(column);
            }
            (Act::Step, Way::Down) => {
                self.rows[column] = (self.rows[column] + 1).min(len.saturating_sub(1));
                self.scroll(column);
            }
            (Act::Top, _) => {
                self.rows[column] = 0;
                self.scroll(column);
            }
            (Act::Bottom, _) => {
                self.rows[column] = len.saturating_sub(1);
                self.scroll(column);
            }
            (Act::PickUp, _) => self.lift(None),
            (Act::Open, _) => self.enter(cx),
            (Act::Reload, _) => self.read(cx),
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
        }
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
        self.named();
        self.draw_board(frame, area, palette);
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if self.reading_thread() {
            return self.reader.hints();
        }
        Vec::new()
    }

    fn badge(&self) -> &[Span] {
        self.badge.parts()
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let Some(view) = &self.view else {
            return Vec::new();
        };
        let count = view.cards.len();
        let done = view.cards.iter().filter(|c| view.closes(c)).count();
        let mut facts = vec![(
            format!("{count} {}", super::source::cards(count)),
            Style::new(),
        )];
        facts.push((format!("{done}/{count} done"), self.palette.good));
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

impl Narrow for Board {
    fn narrow(&mut self, projects: &[String], cx: &mut Cx<'_, Msg>) {
        if self.projects == projects {
            return;
        }
        self.projects = projects.to_vec();
        if self.view.is_some() {
            self.read(cx);
        }
    }

    fn rescope(&mut self) {
        self.projects.clear();
        self.asked.clear();
        self.many = self.source.scoped().len() > 1;
    }

    fn touched(&mut self, _cx: &mut Cx<'_, Msg>) {
        if self.view.is_some() {
            self.stale = Some(self.moment);
        }
    }

    fn seat(&self) -> Seat {
        Board::seat(self)
    }
}

#[cfg(test)]
mod tests;

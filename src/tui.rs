use std::path::Path;
use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use pito_tui::capture::{self, Script, Walk};
use pito_tui::crossterm::event::{KeyCode, KeyEvent};
use pito_tui::footer::{Hint, InputBar};
use pito_tui::header::Section;
use pito_tui::list::{Cell, Column, Row};
use pito_tui::ratatui::{Frame, layout::Rect, style::Color, style::Style, text::Line};
use pito_tui::{Cx, Filter, Job, Palette, Phase, Screen, Tui, Turn, Words, dump, matches, message};

use crate::{NAME, VERSION};

#[derive(Debug, Default, clap::Args)]
pub struct Args {
    #[arg(long, value_name = "WxH", value_parser = size, help = "draw one frame at a size such as 120x34 as text, then quit")]
    pub dump: Option<(u16, u16)>,
    #[arg(long, value_name = "keys", value_parser = keys, help = "the keys --dump presses first, such as \"tab / a enter\"")]
    pub keys: Option<Vec<KeyEvent>>,
    #[arg(long, help = "--dump draws the screen before it has loaded")]
    pub loading: bool,
    #[arg(long, help = "--dump draws in colour")]
    pub ansi: bool,
    #[arg(
        long,
        value_name = "frames",
        help = "time that many frames of each screen, at --dump's size or 120x34"
    )]
    pub bench: Option<usize>,
    #[arg(
        long,
        value_name = "dir",
        help = "save every frame of each screen and script into a folder without frames"
    )]
    pub capture: Option<String>,
    #[arg(
        long,
        value_name = "dir",
        help = "compare every frame with a folder --capture saved"
    )]
    pub compare: Option<String>,
}

fn size(value: &str) -> Result<(u16, u16), String> {
    dump::size(value).ok_or_else(|| "a size is WxH, such as 120x34".to_owned())
}

fn keys(value: &str) -> Result<Vec<KeyEvent>, String> {
    dump::keys(value).map_err(|key| format!("no key is called {key}"))
}

pub fn run(options: &Args) -> ExitCode {
    if let Some(dir) = &options.capture {
        return match capture::capture(Path::new(dir), &walk(), tui) {
            Ok(frames) => {
                println!("{NAME}: {frames} frames captured in {dir}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{NAME}: {dir}: {error}");
                ExitCode::FAILURE
            }
        };
    }
    if let Some(dir) = &options.compare {
        return match capture::compare(Path::new(dir), &walk(), tui) {
            Ok(differences) if differences.is_empty() => {
                println!("{NAME}: every frame matches {dir}");
                ExitCode::SUCCESS
            }
            Ok(differences) => {
                for difference in &differences {
                    println!("{difference}");
                }
                eprintln!("{NAME}: {} differences from {dir}", differences.len());
                ExitCode::FAILURE
            }
            Err(error) => {
                eprintln!("{NAME}: {dir}: {error}");
                ExitCode::FAILURE
            }
        };
    }
    if let Some(frames) = options.bench {
        let (width, height) = options.dump.unwrap_or(SIZE);
        for bench in tui().bench(width, height, frames) {
            println!(
                "{NAME} --bench: {frames} frames of the {} screen at {width}x{height}: average {:.3} ms, worst {:.3} ms",
                bench.screen,
                bench.average.as_secs_f64() * 1000.0,
                bench.worst.as_secs_f64() * 1000.0,
            );
        }
        return ExitCode::SUCCESS;
    }
    if let Some((width, height)) = options.dump {
        let keys = options.keys.clone().unwrap_or_default();
        let buffer = tui().shot(width, height, &keys, !options.loading);
        if options.ansi {
            print!("{}", dump::ansi(&buffer));
        } else {
            println!("{}", dump::text(&buffer));
        }
        return ExitCode::SUCCESS;
    }
    match tui().run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{NAME}: {error}");
            ExitCode::FAILURE
        }
    }
}

const ACCENT: Color = Color::Rgb(0x3b, 0x7d, 0xd8);
const LOAD: Duration = Duration::from_millis(600);
const SIZE: (u16, u16) = (120, 34);

const STEPS: [Step; 4] = [
    Step::new(
        "Replace this screen",
        "Home and Next in src/main.rs are Screens",
    ),
    Step::new("Set your accent", "ACCENT in src/main.rs, or a Palette"),
    Step::new(
        "Add your first command",
        "a key in Screen::key, its work in Cx::detach",
    ),
    Step::new(
        "Load real data",
        "Screen::load reads, Screen::loaded gets it",
    ),
];

const COLUMNS: [Column; 2] = [
    Column::new("Step", 16, 26).pinned(),
    Column::new("How", 12, 0),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Step {
    title: &'static str,
    how: &'static str,
}

impl Step {
    const fn new(title: &'static str, how: &'static str) -> Self {
        Step { title, how }
    }
}

enum Msg {
    Steps(Vec<Step>),
}

struct Home;

impl Screen<Msg> for Home {
    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        let lines = vec![
            Line::styled(NAME, palette.selected),
            Line::styled(format!("v{VERSION}"), palette.muted),
        ];
        message(frame, area, lines);
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        vec![Hint::new("tab", "next screen")]
    }
}

struct Next {
    steps: Option<Vec<Step>>,
    stopped: bool,
    filter: Filter,
    open: Option<usize>,
}

impl Next {
    fn new() -> Self {
        Next {
            steps: None,
            stopped: false,
            filter: Filter::new("Filter")
                .placeholder("type to filter the steps")
                .hint("enter keeps the filter · esc clears it"),
            open: None,
        }
    }

    fn opened(&self) -> Option<&Step> {
        self.steps.as_ref()?.get(self.open?)
    }

    fn sift(&mut self) {
        let steps = self.steps.as_deref().unwrap_or_default();
        self.filter.sift(
            steps,
            |step, query| matches(&format!("{} {}", step.title, step.how), query),
            |step| Row::new([Cell::new(step.title), Cell::new(step.how).faint()]),
        );
    }
}

impl Screen<Msg> for Next {
    fn phase(&self) -> Phase<'_> {
        match (&self.steps, self.stopped) {
            (Some(_), _) => Phase::Ready,
            (None, false) => Phase::Loading("Finding what to do next...".into()),
            (None, true) => Phase::Trouble(
                vec![
                    Line::from("Stopped waiting for the steps."),
                    Line::from("r reads them again."),
                ]
                .into(),
            ),
        }
    }

    fn load(&mut self) -> Option<Job<Msg>> {
        self.steps = None;
        self.stopped = false;
        self.open = None;
        Some(Box::new(|| {
            thread::sleep(LOAD);
            Msg::Steps(STEPS.to_vec())
        }))
    }

    fn loaded(&mut self, event: Msg, _cx: &mut Cx<'_, Msg>) {
        let Msg::Steps(steps) = event;
        self.steps = Some(steps);
        self.sift();
    }

    fn cancel(&mut self) {
        self.stopped = true;
    }

    fn key(&mut self, key: KeyEvent, cx: &mut Cx<'_, Msg>) {
        if self.open.is_some() {
            return;
        }
        match self.filter.key(key) {
            Turn::Filtered => self.sift(),
            Turn::Open(index) => self.open = Some(index),
            Turn::Pass if key.code == KeyCode::Char('r') => cx.reload(),
            _ => {}
        }
    }

    fn back(&mut self, _cx: &mut Cx<'_, Msg>) {
        self.open = None;
    }

    fn crumb(&self) -> Option<String> {
        self.opened().map(|step| step.title.to_string())
    }

    fn selected(&self) -> usize {
        self.filter.list().selected().unwrap_or(0)
    }

    fn paste(&mut self, text: &str, _cx: &mut Cx<'_, Msg>) {
        if self.filter.paste(text) == Turn::Filtered {
            self.sift();
        }
    }

    fn draw(&mut self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if let Some(step) = self.opened() {
            let lines = vec![
                Line::styled(step.title, palette.selected),
                Line::default(),
                Line::styled(step.how, palette.ink),
            ];
            message(frame, area, lines);
            return;
        }
        let view = self
            .filter
            .view(&COLUMNS, palette)
            .header(true)
            .empty(Some("Nothing matches the filter."));
        frame.render_widget(view, area);
    }

    fn typing(&self) -> bool {
        self.open.is_none() && self.filter.typing()
    }

    fn input(&self) -> Option<InputBar<'_>> {
        self.open.is_none().then(|| self.filter.bar()).flatten()
    }

    fn hints(&self) -> Vec<Hint<'_>> {
        if self.steps.is_none() {
            return vec![Hint::new("r", "read again")];
        }
        if self.open.is_some() {
            return vec![Hint::new("esc", "back")];
        }
        let mut hints = vec![
            Hint::new("↑↓", "move"),
            Hint::new("enter", "open").rank(1),
            Hint::new("/", "filter").rank(2),
            Hint::new("r", "read again").rank(3),
        ];
        if self.filter.active() {
            hints.push(Hint::new("esc", "clear filter"));
        }
        hints
    }

    fn facts(&self) -> Vec<(String, Style)> {
        let Some(steps) = &self.steps else {
            return Vec::new();
        };
        let shown = self.filter.shown().len();
        let count = if self.filter.active() {
            format!("{shown} of {} steps", steps.len())
        } else {
            format!("{} steps", steps.len())
        };
        vec![(count, Style::new())]
    }
}

fn words() -> Words {
    Words::new()
        .help("? help")
        .again("ctrl+c again to quit")
        .busy(|running| format!("{running} still running. Quit anyway?"))
        .yes("Yes")
        .no("No")
        .choose("y/n choose · enter accept · esc cancel")
        .too_small("Make the window at least 40 × 12")
        .waiting("esc stops waiting")
}

fn tui() -> Tui<Msg> {
    Tui::new(NAME, VERSION, ACCENT)
        .words(words())
        .hints([
            Hint::new("?", "help").rank(4),
            Hint::new("ctrl+c", "twice quit").pinned(),
        ])
        .footer_look(|footer, _| footer.separator(" · "))
        .screen(Section::new("Home"), Home)
        .screen(Section::new("What to do next").short("Next"), Next::new())
}

fn walk() -> Walk {
    let script = |name: &str, keys: &str| Script::new(name, dump::keys(keys).unwrap_or_default());
    Walk::new()
        .script(script("filter", "tab / accent"))
        .script(script("drill-in", "tab enter"))
        .script(script("quit guard", "ctrl+c"))
        .script(
            script("hourglass", "tab")
                .loading()
                .at(Duration::from_millis(300)),
        )
}

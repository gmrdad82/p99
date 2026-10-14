use std::env;
use std::io::{self, IsTerminal};
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

const NAME: &str = env!("CARGO_PKG_NAME");
const VERSION: &str = env!("CARGO_PKG_VERSION");
const ABOUT: &str = "a TUI app on pito-tui; with no options it opens in the terminal";
const FLAGS: [&str; 7] = [
    "--dump <WxH>",
    "--keys <keys>",
    "--loading",
    "--ansi",
    "--bench <frames>",
    "--capture <dir>",
    "--compare <dir>",
];
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

fn help() -> String {
    format!(
        "{NAME} {VERSION}, {ABOUT}

Usage: {NAME} [OPTIONS]

Options:
      --dump <WxH>      draw one frame at a size such as 120x34 as text, then quit
      --keys <keys>     the keys --dump presses first, such as \"tab / a enter\"
      --loading         --dump draws the screen before it has loaded
      --ansi            --dump draws in colour
      --bench <frames>  time that many frames of each screen, at --dump's size or 120x34
      --capture <dir>   save every frame of each screen and script into a folder without frames
      --compare <dir>   compare every frame with a folder --capture saved
  -h, --help            print this help
      --version         print the name and version
"
    )
}

#[derive(Default)]
struct Options<'a> {
    dump: Option<(u16, u16)>,
    keys: Vec<KeyEvent>,
    loading: bool,
    ansi: bool,
    bench: Option<usize>,
    capture: Option<&'a str>,
    compare: Option<&'a str>,
}

impl<'a> Options<'a> {
    fn set(&mut self, name: &str, value: &'a str) -> Result<(), String> {
        match name {
            "--dump" => self.dump = Some(dump::size(value).ok_or("a size is WxH, such as 120x34")?),
            "--keys" => {
                self.keys = dump::keys(value).map_err(|key| format!("no key is called {key}"))?
            }
            "--bench" => self.bench = Some(value.parse().map_err(|_| "frames are a whole number")?),
            "--capture" => self.capture = Some(value),
            _ => self.compare = Some(value),
        }
        Ok(())
    }
}

enum Ask<'a> {
    Run(Options<'a>),
    Help,
    Version,
}

enum Problem<'a> {
    Unexpected(&'a str),
    NeedsValue(&'static str),
    Twice(&'static str),
    Invalid {
        value: &'a str,
        flag: &'static str,
        why: String,
    },
}

fn parse(args: &[String]) -> Result<Ask<'_>, Problem<'_>> {
    let mut options = Options::default();
    let mut seen = Vec::new();
    let mut args = args.iter().map(String::as_str).peekable();
    while let Some(arg) = args.next() {
        match arg {
            "-h" | "--help" | "help" => return Ok(Ask::Help),
            "--version" => return Ok(Ask::Version),
            _ => {}
        }
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) if name.starts_with("--") => (name, Some(value)),
            _ => (arg, None),
        };
        let known = FLAGS
            .iter()
            .find(|flag| flag.split(' ').next() == Some(name));
        let Some(&flag) = known else {
            return Err(Problem::Unexpected(arg));
        };
        if seen.contains(&flag) {
            return Err(Problem::Twice(flag));
        }
        seen.push(flag);
        if !flag.contains(' ') {
            if inline.is_some() {
                return Err(Problem::Unexpected(arg));
            }
            match name {
                "--loading" => options.loading = true,
                _ => options.ansi = true,
            }
            continue;
        }
        let value = match inline {
            Some(value) => value,
            None => args
                .next_if(|next| next.len() < 2 || !next.starts_with('-'))
                .ok_or(Problem::NeedsValue(flag))?,
        };
        options
            .set(name, value)
            .map_err(|why| Problem::Invalid { value, flag, why })?;
    }
    Ok(Ask::Run(options))
}

fn refuse(problem: &Problem<'_>) -> ExitCode {
    let colour = io::stderr().is_terminal()
        && env::var_os("NO_COLOR").is_none_or(|value| value.is_empty())
        && env::var_os("TERM").is_none_or(|term| term != "dumb");
    let paint = |code: &str, text: &str| {
        if colour {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    };
    let message = match problem {
        Problem::Unexpected(arg) => format!("unexpected argument '{}' found", paint("33", arg)),
        Problem::NeedsValue(flag) => format!("a value is required for '{}'", paint("33", flag)),
        Problem::Twice(flag) => {
            let flag = paint("33", flag);
            format!("the argument '{flag}' cannot be used multiple times")
        }
        Problem::Invalid { value, flag, why } => {
            let (value, flag) = (paint("33", value), paint("1", flag));
            format!("invalid value '{value}' for '{flag}': {why}")
        }
    };
    eprint!(
        "{} {message}\n\n{} {} [OPTIONS]\n\nFor more information, try '{}'.\n",
        paint("1;31", "error:"),
        paint("1;4", "Usage:"),
        paint("1", NAME),
        paint("1", "--help"),
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let options = match parse(&args) {
        Ok(Ask::Run(options)) => options,
        Ok(Ask::Help) => {
            print!("{}", help());
            return ExitCode::SUCCESS;
        }
        Ok(Ask::Version) => {
            println!("{NAME} {VERSION}");
            return ExitCode::SUCCESS;
        }
        Err(problem) => return refuse(&problem),
    };
    if let Some(dir) = options.capture {
        return match capture::capture(Path::new(dir), &walk(), tui) {
            Ok(frames) => {
                println!("{NAME}: {frames} frames captured in {dir}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{NAME}: {dir}: {error}");
                ExitCode::from(2)
            }
        };
    }
    if let Some(dir) = options.compare {
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
                ExitCode::from(2)
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
        let buffer = tui().shot(width, height, &options.keys, !options.loading);
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

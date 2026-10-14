mod codes;
mod demo;
mod inbox;
mod source;

use std::path::Path;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use pito_tui::capture::{self, Script, Walk};
use pito_tui::crossterm::event::KeyEvent;
use pito_tui::footer::Hint;
use pito_tui::header::Section;
use pito_tui::ratatui::style::Color;
use pito_tui::{Palette, Tui, Words, dump};

use crate::wire::{Code, Issue, Thread};
use crate::{NAME, VERSION};

use codes::Codes;
use inbox::Inbox;
use source::{Entry, Source};

#[derive(Debug, Default, clap::Args)]
pub struct Args {
    #[arg(long, help = "serve built-in sample data: no config and no network")]
    pub demo: bool,
    #[arg(long, value_name = "WxH", value_parser = size, help = "draw one frame at a size such as 120x34 as text, then quit")]
    pub dump: Option<(u16, u16)>,
    #[arg(long, value_name = "keys", value_parser = keys, help = "the keys --dump presses first, such as \"tab / a enter\"")]
    pub keys: Option<String>,
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

fn keys(value: &str) -> Result<String, String> {
    dump::keys(value)
        .map(|_| value.to_owned())
        .map_err(|key| format!("no key is called {key}"))
}

pub fn run(options: &Args, global: &crate::cli::Global) -> ExitCode {
    let headless = options.dump.is_some() || options.bench.is_some();
    let source = if options.demo {
        Source::demo(if headless { Duration::ZERO } else { PACE })
    } else {
        Source::live(
            global.account.as_deref(),
            crate::config::agent(global.agent.as_deref()),
        )
    };
    let fixture = || tui(Source::demo(Duration::ZERO));
    if let Some(dir) = &options.capture {
        return match capture::capture(Path::new(dir), &walk(), fixture) {
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
        return match capture::compare(Path::new(dir), &walk(), fixture) {
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
        let mut app = tui(source.clone());
        for bench in app.bench(width, height, frames) {
            report(
                &bench.screen,
                frames,
                width,
                height,
                bench.average,
                bench.worst,
            );
        }
        let mut app = tui(source);
        app.shot(
            width,
            height,
            &dump::keys("enter").unwrap_or_default(),
            true,
        );
        let (mut total, mut worst) = (Duration::ZERO, Duration::ZERO);
        for _ in 0..frames {
            let began = Instant::now();
            app.frame(width, height);
            let spent = began.elapsed();
            total += spent;
            worst = worst.max(spent);
        }
        let average = total / u32::try_from(frames.max(1)).unwrap_or(u32::MAX);
        report("Thread", frames, width, height, average, worst);
        return ExitCode::SUCCESS;
    }
    if let Some((width, height)) = options.dump {
        let keys: Vec<KeyEvent> = options
            .keys
            .as_deref()
            .and_then(|keys| dump::keys(keys).ok())
            .unwrap_or_default();
        let buffer = tui(source).shot(width, height, &keys, !options.loading);
        if options.ansi {
            print!("{}", dump::ansi(&buffer));
        } else {
            println!("{}", dump::text(&buffer));
        }
        return ExitCode::SUCCESS;
    }
    match tui(source).run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{NAME}: {error}");
            ExitCode::FAILURE
        }
    }
}

const ACCENT: Color = Color::Rgb(0x3b, 0x7d, 0xd8);
const PACE: Duration = Duration::from_millis(250);
const SIZE: (u16, u16) = (120, 34);

pub enum Msg {
    Inbox(Result<Vec<Entry>, String>),
    Thread(String, Result<Thread, String>),
    Commented(String, Result<bool, String>),
    Changed(String, Result<Issue, String>),
    Codes(Result<Vec<Code>, String>),
}

fn report(
    screen: &str,
    frames: usize,
    width: u16,
    height: u16,
    average: Duration,
    worst: Duration,
) {
    println!(
        "{NAME} --bench: {frames} frames of the {screen} screen at {width}x{height}: average {:.3} ms, worst {:.3} ms",
        average.as_secs_f64() * 1000.0,
        worst.as_secs_f64() * 1000.0,
    );
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

fn palette() -> Palette {
    if std::env::var_os("NO_COLOR").is_some_and(|v| !v.is_empty()) {
        Palette::new(ACCENT).mono()
    } else {
        Palette::new(ACCENT)
    }
}

fn tui(source: Source) -> Tui<Msg> {
    Tui::new(NAME, VERSION, ACCENT)
        .title("P99")
        .words(words())
        .hints([
            Hint::new("?", "help").rank(4),
            Hint::new("ctrl+c", "twice quit").pinned(),
        ])
        .footer_look(|footer, _| footer.separator(" · "))
        .screen(Section::new("Inbox"), Inbox::new(source.clone(), palette()))
        .screen(Section::new("Codes"), Codes::new(source, palette()))
}

fn walk() -> Walk {
    let script = |name: &str, keys: &str| Script::new(name, dump::keys(keys).unwrap_or_default());
    Walk::new()
        .script(script("filter", "/ cart"))
        .script(script("any status", "s s"))
        .script(script("host pick", "h"))
        .script(script("one host", "h down enter"))
        .script(script("thread", "enter"))
        .script(script("reply", "enter r T h a n k s"))
        .script(script("replied", "enter r T h a n k s enter"))
        .script(script("status pick", "enter s"))
        .script(script("status changed", "enter s down down enter"))
        .script(script("assign pick", "enter a"))
        .script(script("codes", "tab / g r a c e"))
        .script(script("quit guard", "ctrl+c"))
        .script(
            script("hourglass", "")
                .loading()
                .at(Duration::from_millis(300)),
        )
}

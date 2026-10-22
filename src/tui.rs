mod badge;
mod board;
mod codes;
mod deck;
pub mod demo;
mod inbox;
mod source;
#[cfg(test)]
mod tests;

use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use pito_tui::capture::{self, Script, Walk};
use pito_tui::crossterm::event::{KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use pito_tui::footer::Hint;
use pito_tui::header::Section;
use pito_tui::ratatui::style::Color;
use pito_tui::{FRAME, Modes, Palette, Tui, Words, dump};

use crate::license::State;
use crate::wire::{Code, Issue, Thread};
use crate::{NAME, VERSION};

use badge::Badge;
use board::Board;
use codes::Codes;
use inbox::Inbox;
use source::{Entry, Source};

#[derive(Debug, Default, clap::Args)]
pub struct Args {
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
    let source = if global.demo {
        Source::demo(if headless { Duration::ZERO } else { PACE })
    } else {
        Source::live(global.account.as_deref(), global.agent)
    };
    let state = if global.demo {
        badge::demo_state()
    } else {
        crate::config::Config::load()
            .map_or(State::Free, |config| State::of(config.license.as_deref()))
    };
    let tui = |source: Source| tui(source, state);
    let fixture = || self::tui(Source::demo(Duration::ZERO), State::Free);
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
        let mut app = tui(source.clone());
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
        let carry = dump::keys("right right down left left up").unwrap_or_default();
        let times = timed(
            &source,
            state,
            width,
            height,
            frames,
            "space",
            |app, frame| {
                if frame % 6 == 0 {
                    app.key(carry[frame / 6 % carry.len()]);
                }
            },
        );
        spread(
            "Board, carrying a card with the keys",
            frames,
            width,
            height,
            &times,
        );
        let reach = i32::from(width.saturating_sub(12));
        let times = timed(&source, state, width, height, frames, "", |app, frame| {
            let swing = (frame as i32 * 3) % (2 * reach);
            let x = 6 + if swing < reach {
                swing
            } else {
                2 * reach - swing
            };
            let y = 9 + (frame as i32 / 4) % 12;
            let kind = if frame == 0 {
                MouseEventKind::Down(MouseButton::Left)
            } else {
                MouseEventKind::Drag(MouseButton::Left)
            };
            app.mouse(MouseEvent {
                kind,
                column: x as u16,
                row: y as u16,
                modifiers: KeyModifiers::NONE,
            });
        });
        spread(
            "Board, dragging a card with the mouse",
            frames,
            width,
            height,
            &times,
        );
        return ExitCode::SUCCESS;
    }
    if let Some((width, height)) = options.dump {
        let keys: Vec<KeyEvent> = options
            .keys
            .as_deref()
            .and_then(|keys| dump::keys(keys).ok())
            .unwrap_or_default();
        let mut app = tui(source);
        let mut buffer = app.shot(width, height, &keys, !options.loading);
        if !options.loading {
            app.advance(SETTLE);
            buffer = app.frame(width, height);
        }
        if options.ansi {
            print!("{}", dump::ansi(&buffer));
        } else {
            println!("{}", dump::text(&buffer));
        }
        return ExitCode::SUCCESS;
    }
    match tui(source).after_draw(capture()).run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{NAME}: {error}");
            ExitCode::FAILURE
        }
    }
}

pub static BOARD_SHOWN: AtomicBool = AtomicBool::new(false);

fn capture() -> impl FnMut(Duration) {
    let mut on = true;
    move |_| {
        let want = BOARD_SHOWN.swap(false, Ordering::Relaxed);
        if want == on {
            return;
        }
        on = want;
        let mut out = std::io::stdout();
        let sent = if on {
            pito_tui::crossterm::execute!(out, pito_tui::crossterm::event::EnableMouseCapture)
        } else {
            pito_tui::crossterm::execute!(out, pito_tui::crossterm::event::DisableMouseCapture)
        };
        if sent.is_ok() {
            let _ = out.flush();
        }
    }
}

const ACCENT: Color = Color::Rgb(0x3b, 0x7d, 0xd8);
const PACE: Duration = Duration::from_millis(250);
const SIZE: (u16, u16) = (120, 34);
const SETTLE: Duration = Duration::from_secs(1);

pub enum Msg {
    Inbox(Result<Vec<Entry>, String>),
    Thread(String, Result<Thread, String>),
    Commented(String, Result<bool, String>),
    Changed(String, Result<Issue, String>),
    Deleted(String, Result<crate::wire::Deleted, String>),
    Codes(Result<Vec<Code>, String>),
    Pushed(usize, Option<String>),
    Board(
        Option<(usize, i64)>,
        Result<(usize, deck::BoardView), String>,
    ),
    Shifted(String, Result<deck::Moved, String>),
    Heard(usize, String),
    Boards(Result<Vec<(usize, deck::Boards)>, String>),
    Labels(Result<Vec<String>, String>),
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

fn timed(
    source: &Source,
    state: State,
    width: u16,
    height: u16,
    frames: usize,
    lift: &str,
    mut step: impl FnMut(&mut Tui<Msg>, usize),
) -> Vec<Duration> {
    let mut app = tui(source.clone(), state);
    app.shot(width, height, &dump::keys("tab").unwrap_or_default(), true);
    for key in dump::keys(lift).unwrap_or_default() {
        app.key(key);
    }
    let mut times = Vec::with_capacity(frames);
    for frame in 0..frames {
        step(&mut app, frame);
        app.advance(FRAME);
        let began = Instant::now();
        app.frame(width, height);
        times.push(began.elapsed());
    }
    times.sort();
    times
}

fn spread(screen: &str, frames: usize, width: u16, height: u16, times: &[Duration]) {
    let ms = |d: Duration| d.as_secs_f64() * 1000.0;
    let total: Duration = times.iter().sum();
    let average = total / u32::try_from(times.len().max(1)).unwrap_or(u32::MAX);
    let p99 = times
        .get((times.len() * 99 / 100).min(times.len().saturating_sub(1)))
        .copied()
        .unwrap_or_default();
    let worst = times.last().copied().unwrap_or_default();
    println!(
        "{NAME} --bench: {frames} frames of the {screen} at {width}x{height}, a slide always running: average {:.3} ms, p99 {:.3} ms, worst {:.3} ms",
        ms(average),
        ms(p99),
        ms(worst),
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

fn tui(source: Source, state: State) -> Tui<Msg> {
    build(source, state, palette())
}

fn build(source: Source, state: State, palette: Palette) -> Tui<Msg> {
    let badge = Badge::new(state, &palette);
    Tui::new(NAME, VERSION, ACCENT)
        .title("P99")
        .words(words())
        .hints([
            Hint::new("?", "help").rank(4),
            Hint::new("ctrl+c", "twice quit").pinned(),
        ])
        .footer_look(|footer, _| footer.separator(" · "))
        .modes(Modes::new().mouse(true))
        .screen(
            Section::new("Inbox"),
            Inbox::new(source.clone(), palette).badge(badge.clone()),
        )
        .screen(
            Section::new("Board"),
            Board::new(source.clone(), palette).badge(badge.clone()),
        )
        .screen(
            Section::new("Codes"),
            Codes::new(source, palette).badge(badge),
        )
}

fn walk() -> Walk {
    let script = |name: &str, keys: &str| Script::new(name, dump::keys(keys).unwrap_or_default());
    Walk::new()
        .script(script("filter", "/ cart"))
        .script(script("open and closed", "s s"))
        .script(script("host pick", "h"))
        .script(script("one host", "h down enter"))
        .script(script("thread", "enter"))
        .script(script("reply", "enter r T h a n k s"))
        .script(script("replied", "enter r T h a n k s enter"))
        .script(script("move pick", "enter m"))
        .script(script("moved", "enter m down down enter"))
        .script(script("assign pick", "enter a"))
        .script(script("codes", "tab / g r a c e"))
        .script(script("quit guard", "ctrl+c"))
        .script(
            script("hourglass", "")
                .loading()
                .at(Duration::from_millis(300)),
        )
}

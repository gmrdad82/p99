mod app;
mod boards;
mod bundle;
mod card;
mod cli;
mod client;
mod cloudflare;
mod config;
mod docs;
mod email;
mod fold;
mod github;
mod hooks;
mod import;
mod license;
mod links;
mod migrate;
mod one_board;
mod prune;
mod setup;
mod sign;
mod stream;
mod trailers;
mod tui;
mod vault;
mod wire;

use std::io::IsTerminal;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

const NAME: &str = env!("CARGO_PKG_NAME");
const VERSION: &str = env!("CARGO_PKG_VERSION");
const ASK: &str = "P99: got questions or doubts? Ping me on Discord https://discord.gg/XsNcn3kYzn";

#[derive(Parser)]
#[command(
    name = "p99",
    version,
    about = "P99: issue and feedback reporting for any website, on Cloudflare",
    long_about = "P99: issue and feedback reporting for any website, on Cloudflare\n\n`p99` alone, in a terminal, opens the inbox (as `p99 tui` does); any command or flag is the CLI.",
    after_help = ASK,
    subcommand_required = true,
    arg_required_else_help = false
)]
struct P99 {
    #[command(subcommand)]
    command: Command,
    #[command(flatten)]
    global: cli::Global,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "open the inbox in the terminal, as `p99` alone does")]
    Tui(tui::Args),
    #[command(
        about = "set up an account, step by step: the Cloudflare token, D1, R2, the Worker, routes and keys"
    )]
    Setup(setup::SetupArgs),
    #[command(about = "upload this version's Worker to an account")]
    Deploy(setup::DeployArgs),
    #[command(
        about = "show, read-only, what this version's data-changing migrations would do on an account"
    )]
    Migrate(migrate::MigrateArgs),
    #[command(
        about = "print the address of the account's P99 page, which works when a site is down"
    )]
    App,
    #[command(about = "list the Worker build embedded in this binary, without touching Cloudflare")]
    Bundle,
    #[command(
        about = "store, show or remove this installation's P99 licence key, checked offline",
        subcommand_required = true,
        arg_required_else_help = false
    )]
    License(license::Args),
    #[command(
        about = "turn mail on or off for an account, or show how it is set",
        arg_required_else_help = false
    )]
    Email(email::EmailArgs),
    #[command(flatten)]
    Work(cli::Command),
    #[command(name = "docs-cli", hide = true)]
    DocsCli,
}

fn bare() -> bool {
    std::env::args_os().len() == 1
        && std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
}

fn main() -> ExitCode {
    let p99 = if bare() {
        P99::parse_from([NAME, "tui"])
    } else {
        P99::parse()
    };
    let result = match p99.command {
        Command::Tui(args) => return tui::run(&args, &p99.global),
        Command::Setup(args) => setup::setup(&args, &p99.global),
        Command::Deploy(args) => setup::deploy(&args, &p99.global),
        Command::Migrate(args) => migrate::run(&args, &p99.global),
        Command::App => app::run(&p99.global),
        Command::Bundle => bundle::run(&p99.global),
        Command::License(args) => license::run(&args, &p99.global),
        Command::Email(args) => email::run(&args, &p99.global),
        Command::Work(command) => cli::run(command, &p99.global),
        Command::DocsCli => docs::run(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("{NAME}: {why}");
            ExitCode::FAILURE
        }
    }
}

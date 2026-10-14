#![allow(dead_code)]

mod cli;
mod config;
mod setup;
mod tui;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

const NAME: &str = env!("CARGO_PKG_NAME");
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(
    name = "p99",
    version,
    about = "P99: issue and feedback reporting for any website, on Cloudflare; with no command it opens the inbox"
)]
struct P99 {
    #[command(subcommand)]
    command: Option<Command>,
    #[command(flatten)]
    tui: tui::Args,
    #[command(flatten)]
    global: cli::Global,
}

#[derive(Subcommand)]
enum Command {
    #[command(
        about = "set up an account: the Cloudflare token, the Worker, D1, R2, routes and keys"
    )]
    Setup(setup::SetupArgs),
    #[command(about = "take over an existing tracker deployment in place, keys unchanged")]
    Adopt(setup::AdoptArgs),
    #[command(about = "upload this version's Worker to an account")]
    Deploy(setup::DeployArgs),
    #[command(flatten)]
    Work(cli::Command),
}

fn main() -> ExitCode {
    let p99 = P99::parse();
    let result = match p99.command {
        None => return tui::run(&p99.tui),
        Some(Command::Setup(args)) => setup::setup(&args, &p99.global),
        Some(Command::Adopt(args)) => setup::adopt(&args, &p99.global),
        Some(Command::Deploy(args)) => setup::deploy(&args, &p99.global),
        Some(Command::Work(command)) => cli::run(command, &p99.global),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("{NAME}: {why}");
            ExitCode::FAILURE
        }
    }
}

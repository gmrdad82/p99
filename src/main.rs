#![allow(dead_code)]

mod cli;
mod client;
mod config;
mod setup;
mod sign;
mod trailers;
mod tui;
mod vault;
mod wire;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

const NAME: &str = env!("CARGO_PKG_NAME");
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(
    name = "p99",
    version,
    about = "P99: issue and feedback reporting for any website, on Cloudflare",
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
    #[command(about = "open the inbox in the terminal")]
    Tui(tui::Args),
    #[command(
        about = "set up an account, step by step: the Cloudflare token, D1, R2, the Worker, routes and keys"
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
        Command::Tui(args) => return tui::run(&args, &p99.global),
        Command::Setup(args) => setup::setup(&args, &p99.global),
        Command::Adopt(args) => setup::adopt(&args, &p99.global),
        Command::Deploy(args) => setup::deploy(&args, &p99.global),
        Command::Work(command) => cli::run(command, &p99.global),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("{NAME}: {why}");
            ExitCode::FAILURE
        }
    }
}

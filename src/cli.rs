#[derive(Debug, Default, clap::Args)]
pub struct Global {
    #[arg(long, global = true, help = "answer in JSON, for agents and scripts")]
    pub json: bool,
    #[arg(
        long,
        global = true,
        value_name = "name",
        help = "the account to use, when the config has several"
    )]
    pub account: Option<String>,
    #[arg(
        long,
        global = true,
        value_name = "label",
        help = "act as an agent of the configured person (or P99_AGENT)"
    )]
    pub agent: Option<String>,
}

#[derive(Debug, clap::Subcommand)]
pub enum Command {
    #[command(about = "the hosts P99 serves")]
    Hosts,
}

pub fn run(command: Command, _global: &Global) -> Result<(), String> {
    match command {
        Command::Hosts => Err("hosts is not built yet".into()),
    }
}

use crate::card::{Lane, Source};
use crate::cli::{EditArgs, Global};
use crate::config::Config;
use crate::wire::KINDS;

#[derive(Debug, clap::Args)]
pub struct CardsArgs {
    #[arg(
        long,
        value_name = "name",
        help = "only this project's cards; repeat it for several"
    )]
    pub project: Vec<String>,
    #[arg(
        long,
        value_enum,
        value_name = "word",
        help = "only the cards in this lane; repeat it for several (every lane but done by default)"
    )]
    pub status: Vec<Lane>,
    #[arg(
        long,
        value_name = "when",
        help = "only the cards changed at or after a time (2026-10-22T08:00:00Z) or within an age (90m, 6h, 2d)"
    )]
    pub since: Option<String>,
    #[arg(
        long,
        value_enum,
        help = "only the cards whose last change was a person's or an agent's"
    )]
    pub source: Option<Source>,
    #[arg(long, help = "only this host's cards")]
    pub host: Option<String>,
    #[arg(
        long,
        value_name = "n",
        default_value_t = crate::card::DEFAULT_LIMIT,
        value_parser = clap::value_parser!(u32).range(1..=i64::from(crate::card::MAX_LIMIT)),
        help = "at most this many cards, up to 500"
    )]
    pub limit: u32,
    #[arg(long, value_name = "c", help = "read on from a list's next_cursor")]
    pub cursor: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct CardArgs {
    #[command(subcommand)]
    pub action: CardAction,
}

#[derive(Debug, clap::Subcommand)]
pub enum CardAction {
    #[command(about = "show a card with its comments, links and events")]
    Show(CardShowArgs),
    #[command(about = "file a card in a project, in lane new")]
    New(CardNewArgs),
    #[command(about = "comment on a card")]
    Comment(CardCommentArgs),
    #[command(about = "move a card to a lane, at its top; only a person moves it to done")]
    Status(CardStatusArgs),
    #[command(about = "link a card to a request, a commit, a tag or a URL")]
    Link(CardLinkArgs),
}

#[derive(Debug, clap::Args)]
pub struct CardShowArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
}

#[derive(Debug, clap::Args)]
pub struct CardNewArgs {
    #[arg(long, value_name = "name", help = "the project the card belongs to")]
    pub project: String,
    #[arg(long, value_name = "text", help = "one line that says what it is about")]
    pub title: String,
    #[arg(
        long,
        value_name = "text|-",
        help = "the details, or - to read them from standard input"
    )]
    pub body: Option<String>,
    #[arg(long, value_parser = KINDS, default_value = "feature", help = "what it is")]
    pub kind: String,
    #[arg(
        long,
        help = "the host it sits on for the panel (the account's oldest by default)"
    )]
    pub host: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct CardCommentArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(
        value_name = "text|-",
        help = "the text, or - to read it from standard input"
    )]
    pub text: String,
    #[arg(long, help = "for managers only")]
    pub internal: bool,
}

#[derive(Debug, clap::Args)]
pub struct CardStatusArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(value_enum, help = "the lane it moves to")]
    pub status: Lane,
    #[arg(
        long,
        value_name = "text|-",
        help = "a comment in the same write, such as why it is stuck, or - for standard input"
    )]
    pub note: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct CardLinkArgs {
    #[arg(help = "the card's key, such as FEAT-41, or its number")]
    pub key: String,
    #[arg(
        value_name = "REF",
        help = "a request id, a commit, a tag or a URL, up to 200 characters"
    )]
    pub reference: String,
    #[arg(long, value_name = "text", help = "a note, up to 200 characters")]
    pub note: Option<String>,
}

pub fn cards(_config: &Config, _global: &Global, _args: &CardsArgs) -> Result<(), String> {
    todo!()
}

pub fn card(_config: &Config, _global: &Global, _args: &CardArgs) -> Result<(), String> {
    todo!()
}

pub fn projects(_config: &Config, _global: &Global) -> Result<(), String> {
    todo!()
}

pub fn edit_project(_config: &Config, _global: &Global, _args: &EditArgs) -> Result<(), String> {
    todo!()
}

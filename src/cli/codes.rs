use super::Global;
use crate::config::Config;

#[derive(Debug, clap::Args)]
pub struct CodeDeleteArgs {
    #[arg(help = "the revoked code's id, from p99 invites")]
    pub id: i64,
    #[arg(
        long,
        help = "delete without asking, for scripts and agents; there is no undo"
    )]
    pub yes: bool,
}

pub fn delete(config: &Config, global: &Global, args: &CodeDeleteArgs) -> Result<(), String> {
    let _ = (config, global, args);
    todo!("p99 invites delete: the last four typed back, then DELETE /v1/codes/{{id}}")
}

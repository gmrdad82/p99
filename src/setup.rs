use crate::cli::Global;

#[derive(Debug, clap::Args)]
pub struct SetupArgs {}

#[derive(Debug, clap::Args)]
pub struct AdoptArgs {}

#[derive(Debug, clap::Args)]
pub struct DeployArgs {}

pub fn setup(_args: &SetupArgs, _global: &Global) -> Result<(), String> {
    Err("setup is not built yet".into())
}

pub fn adopt(_args: &AdoptArgs, _global: &Global) -> Result<(), String> {
    Err("adopt is not built yet".into())
}

pub fn deploy(_args: &DeployArgs, _global: &Global) -> Result<(), String> {
    Err("deploy is not built yet".into())
}

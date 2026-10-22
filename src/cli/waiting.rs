use super::{Global, client_for, print_json};
use crate::config::Config;

pub fn waiting(config: &Config, global: &Global) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let list = client.waiting()?;
    if global.json {
        return print_json(&list);
    }
    todo!("p99 cards --waiting's text: the count, then one line per card")
}

use super::{Global, client_for, print_json};
use crate::config::Config;
use crate::one_board::Waiting;
use crate::wire::out;

pub fn heading(count: u64) -> String {
    match count {
        0 => "nothing waits on you".to_owned(),
        1 => "1 card waits on you".to_owned(),
        n => format!("{n} cards wait on you"),
    }
}

pub fn lines(list: &Waiting, now: i64) -> Vec<String> {
    let mut lines = vec![heading(list.count)];
    lines.extend(list.cards.iter().map(|c| super::card::card_line(c, now)));
    lines
}

pub fn waiting(config: &Config, global: &Global) -> Result<(), String> {
    let (client, _) = client_for(config, global, None)?;
    let list = client
        .waiting()
        .map_err(crate::one_board::waiting_refusal)?;
    if global.json {
        return print_json(&list);
    }
    for line in lines(&list, super::card::now()) {
        out!("{line}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_heading_counts_none_one_and_many() {
        assert_eq!(heading(0), "nothing waits on you");
        assert_eq!(heading(1), "1 card waits on you");
        assert_eq!(heading(12), "12 cards wait on you");
    }
}

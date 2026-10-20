use std::io::{self, BufRead, IsTerminal, Write};

use super::{Global, client_for, key_of, print_json};
use crate::config::Config;
use crate::wire::out;

#[derive(Debug, clap::Args)]
pub struct DeleteArgs {
    #[arg(help = "the item to delete, such as BUG-12")]
    pub key: String,
    #[arg(long, help = "the host the item belongs to")]
    pub host: Option<String>,
    #[arg(
        long,
        help = "delete without asking, for scripts and agents; there is no undo"
    )]
    pub yes: bool,
}

fn plural(n: u64, one: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {one}s")
    }
}

fn typed_back(key: &str, title: &str, comments: i64, files: usize) -> Result<bool, String> {
    let mut err = io::stderr();
    let shown = crate::wire::clean(title);
    let _ = writeln!(
        err,
        "{key}  {shown}\nDeleting it removes its {}, {} and history for good; GitHub keeps its own issue.",
        plural(u64::try_from(comments).unwrap_or(0), "comment"),
        plural(files as u64, "file"),
    );
    let _ = write!(err, "Type {key} to delete it: ");
    let _ = err.flush();
    let mut line = String::new();
    io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    Ok(line.trim().eq_ignore_ascii_case(key))
}

pub fn delete(config: &Config, global: &Global, args: &DeleteArgs) -> Result<(), String> {
    let number = key_of(&args.key)?;
    let (client, _) = client_for(config, global, args.host.as_deref())?;
    let client = client.with_host(args.host.as_deref());
    if !args.yes {
        if !io::stdin().is_terminal() {
            return Err(format!(
                "deleting {} needs --yes when no one is at a terminal to type the key back",
                args.key
            ));
        }
        let thread = client.thread(&number)?;
        let key = thread.issue.key.clone();
        if !typed_back(
            &key,
            &thread.issue.title,
            thread.issue.comments,
            thread.attachments.len(),
        )? {
            return Err(format!("{key} is kept: the key typed back didn't match"));
        }
    }
    let done = client.delete_item(&number)?;
    if global.json {
        return print_json(&done);
    }
    out!(
        "{} deleted with {} and {}",
        done.key,
        plural(done.comments, "comment"),
        plural(done.files, "file")
    );
    if done.retrying > 0 {
        out!(
            "{} still being removed from storage; the Worker retries every 15 minutes",
            plural(done.retrying, "file")
        );
    }
    if !done.unlinked.is_empty() {
        out!(
            "{} were merged into it: unlinked, and back in the inbox",
            done.unlinked.join(", ")
        );
    }
    Ok(())
}

use clap::{Arg, Command, CommandFactory};

const TUI_HARNESS: [&str; 7] = [
    "dump", "keys", "loading", "ansi", "bench", "capture", "compare",
];

pub fn run() -> Result<(), String> {
    print!("{}", cli());
    Ok(())
}

pub fn cli() -> String {
    let mut root = crate::P99::command();
    root.build();
    let mut out = String::new();
    out.push_str(&format!(
        "Every command and flag of `p99`, generated from its own definitions. `p99 <command> --help` prints the same in the terminal.\n\n```\n{}\n```\n\n",
        usage(&mut root)
    ));
    out.push_str("## Global options\n\nThese work with every command.\n\n");
    let globals: Vec<&Arg> = root
        .get_arguments()
        .filter(|a| shown(a) && a.is_global_set())
        .collect();
    table(&mut out, &globals);
    for sub in root.get_subcommands_mut() {
        if sub.is_hide_set() || sub.get_name() == "help" {
            continue;
        }
        command(&mut out, sub, 2);
    }
    out
}

fn usage(cmd: &mut Command) -> String {
    cmd.render_usage()
        .to_string()
        .trim_start_matches("Usage: ")
        .trim()
        .to_owned()
}

fn shown(arg: &Arg) -> bool {
    !arg.is_hide_set()
        && !matches!(
            arg.get_action(),
            clap::ArgAction::Help
                | clap::ArgAction::HelpShort
                | clap::ArgAction::HelpLong
                | clap::ArgAction::Version
        )
}

fn command(out: &mut String, cmd: &mut Command, depth: usize) {
    let path = cmd.get_bin_name().unwrap_or(cmd.get_name()).to_owned();
    out.push_str(&format!("{} {}\n\n", "#".repeat(depth), path));
    if let Some(about) = cmd.get_about() {
        out.push_str(&format!("{}.\n\n", capital(&about.to_string())));
    }
    out.push_str(&format!("```\n{}\n```\n\n", usage(cmd)));
    let harness = cmd.get_name() == "tui";
    let args: Vec<&Arg> = cmd
        .get_arguments()
        .filter(|a| {
            shown(a)
                && !a.is_global_set()
                && !(harness && TUI_HARNESS.contains(&a.get_id().as_str()))
        })
        .collect();
    if !args.is_empty() {
        table(out, &args);
    }
    for sub in cmd.get_subcommands_mut() {
        if sub.is_hide_set() || sub.get_name() == "help" {
            continue;
        }
        command(out, sub, depth + 1);
    }
}

fn table(out: &mut String, args: &[&Arg]) {
    out.push_str("| Argument | What it does |\n| --- | --- |\n");
    for arg in args {
        out.push_str(&format!("| `{}` | {} |\n", name(arg), cell(arg)));
    }
    out.push('\n');
}

fn name(arg: &Arg) -> String {
    let values = arg
        .get_value_names()
        .map(|v| v.iter().map(|n| n.to_string()).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![arg.get_id().as_str().to_owned()]);
    let many = arg.get_num_args().is_some_and(|n| n.max_values() > 1);
    let dots = if many { "..." } else { "" };
    match arg.get_long() {
        None => format!("<{}>{dots}", values.join("> <")),
        Some(long) => {
            let short = arg
                .get_short()
                .map(|s| format!("-{s}, "))
                .unwrap_or_default();
            if arg.get_action().takes_values() {
                format!("{short}--{long} <{}>", values.join("> <"))
            } else {
                format!("{short}--{long}")
            }
        }
    }
}

fn cell(arg: &Arg) -> String {
    let mut text = arg
        .get_help()
        .map(|h| capital(&h.to_string()))
        .unwrap_or_default();
    let mut notes = Vec::new();
    if arg.get_long().is_none() && arg.is_required_set() {
        notes.push("required".to_owned());
    }
    if arg.get_action().takes_values() {
        let values: Vec<String> = arg
            .get_possible_values()
            .iter()
            .filter(|v| !v.is_hide_set())
            .map(|v| format!("`{}`", v.get_name()))
            .collect();
        if !values.is_empty() {
            notes.push(format!("one of {}", values.join(", ")));
        }
        let defaults: Vec<String> = arg
            .get_default_values()
            .iter()
            .map(|v| format!("`{}`", v.to_string_lossy()))
            .collect();
        if !defaults.is_empty() {
            notes.push(format!("default {}", defaults.join(", ")));
        }
        if arg.get_long().is_some()
            && matches!(arg.get_action(), clap::ArgAction::Append)
            && !text.contains("repeat")
        {
            notes.push("repeatable".to_owned());
        }
    }
    if !notes.is_empty() {
        if !text.is_empty() {
            text.push_str(". ");
        }
        text.push_str(&capital(&notes.join("; ")));
    }
    text.replace('<', "&lt;")
        .replace('|', "\\|")
        .replace('\n', " ")
}

fn capital(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_reference_covers_every_visible_command_and_no_hidden_flag() {
        let page = super::cli();
        for command in [
            "tui",
            "setup",
            "deploy",
            "bundle",
            "list",
            "import",
            "hosts add",
        ] {
            assert!(page.contains(&format!(" p99 {command}\n")), "{command}");
        }
        for hidden in ["--demo", "--dump", "--capture", "docs-cli", "p99 help"] {
            assert!(!page.contains(hidden), "{hidden}");
        }
    }
}

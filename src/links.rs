use std::io::{BufRead, IsTerminal, Write};
use std::process::{Command, Stdio};

use serde_json::json;

use crate::cli::{Global, account_of, client_for, print_json, print_totp};
use crate::config::Config;
use crate::wire::{Code, Minted, Relink, out};

const OPENER: &str = "P99_BROWSER";

#[derive(Debug, clap::Args)]
pub struct RelinkArgs {
    #[arg(
        required_unless_present = "me",
        help = "the code's id, from p99 invites, or the person's e-mail"
    )]
    pub target: Option<String>,
    #[arg(
        long = "self",
        conflicts_with = "target",
        help = "your own code: the e-mail of the configured person"
    )]
    pub me: bool,
    #[arg(long, help = "with an e-mail: the code that covers this host")]
    pub host: Option<String>,
    #[arg(
        long,
        help = "give the new code a new authenticator instead of keeping the person's"
    )]
    pub new_totp: bool,
    #[arg(long, help = "print the new link here instead of mailing it")]
    pub no_mail: bool,
    #[arg(
        long,
        conflicts_with = "no_mail",
        help = "also mail your own new link to you; it is printed here either way"
    )]
    pub mail_me: bool,
}

#[derive(Debug, clap::Args)]
pub struct LinkArgs {
    #[arg(help = "the host to open; with several and none named, P99 asks")]
    pub host: Option<String>,
    #[arg(long, help = "print the link instead of opening it")]
    pub print: bool,
}

pub fn owner(config: &Config, account: &str, email: &str) -> bool {
    let me = config.me_for(account);
    !me.email.is_empty() && me.email.trim().eq_ignore_ascii_case(email.trim())
}

pub fn mailing(owner: bool, no_mail: bool, mail_me: bool) -> bool {
    !no_mail && (!owner || mail_me)
}

pub fn report(minted: &Minted, owner: bool, asked: bool) -> Result<(), String> {
    let code = &minted.code;
    let role = if code.manager { " (manager)" } else { "" };
    out!("{} <{}>{role}", code.name, code.email);
    if let Some(old) = &minted.revoked {
        out!(
            "code {} replaces code {}, which no longer works",
            code.id,
            old.id
        );
    }
    let sent = minted.mail.as_deref() == Some("sent");
    if sent {
        out!(
            "mailed the link for {} to {}",
            code.hosts.join(", "),
            code.email
        );
    }
    if !sent || owner {
        let Some(secret) = &minted.secret else {
            return Err("this code was already minted; revoke it and mint again".into());
        };
        out!("secret: {secret}");
        for link in &minted.links {
            out!("link:   {link}");
        }
    }
    match minted.totp.as_deref() {
        Some("carried") => {
            out!("the authenticator carries over: the same app keeps giving the 6-digit codes")
        }
        _ => {
            if let Some(key) = &minted.totp_key {
                print_totp(code, key);
            }
        }
    }
    if sent && !owner {
        return Ok(());
    }
    let note = match minted.mail.as_deref() {
        Some("sent") | None if owner => {
            "this is your own link: P99 keeps it nowhere, so save it in your password manager if you want it there"
        }
        Some("sent") | None if !asked => "",
        Some("off") => {
            "mail is off for this account, so nothing was mailed; send the link yourself (p99 email set turns mail on)"
        }
        Some("skipped") => "this e-mail takes no mail; send the link yourself",
        _ => "the mail didn't go out; send the link yourself",
    };
    if !note.is_empty() {
        out!("{note}");
    }
    println!("this is the only time the secret is shown");
    Ok(())
}

fn active(code: &Code) -> bool {
    code.revoked_at.is_none()
}

fn pick(codes: Vec<Code>, email: &str, host: Option<&str>) -> Result<i64, String> {
    let held: Vec<Code> = codes
        .into_iter()
        .filter(|c| active(c) && c.email.eq_ignore_ascii_case(email))
        .filter(|c| host.is_none_or(|h| c.hosts.iter().any(|x| x == h)))
        .collect();
    let on = host.map(|h| format!(" on {h}")).unwrap_or_default();
    match held.as_slice() {
        [] => Err(format!(
            "{email} holds no active code{on}; p99 invite mints one"
        )),
        [one] => Ok(one.id),
        many => Err(format!(
            "{email} holds several codes{on}: {}; name one by id or --host",
            many.iter()
                .map(|c| format!("{} ({})", c.id, c.hosts.join(", ")))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

pub fn relink(config: &Config, global: &Global, args: &RelinkArgs) -> Result<(), String> {
    let host = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let (client, account) = client_for(config, global, host.as_deref())?;
    let me = config.me_for(&account);
    let codes = client.codes(None)?;
    let id = match args.target.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit()) => raw
            .parse::<i64>()
            .map_err(|_| format!("{raw} is not a code id"))?,
        Some(email) if email.contains('@') => pick(codes.clone(), email, host.as_deref())?,
        Some(raw) => {
            return Err(format!(
                "{raw} is neither a code id nor an e-mail; p99 invites lists both"
            ));
        }
        None if me.email.is_empty() => {
            return Err(
                "--self needs your e-mail in the config's [me]; p99 setup asks for it".into(),
            );
        }
        None => pick(codes.clone(), &me.email, host.as_deref())?,
    };
    let mine = args.me
        || codes
            .iter()
            .any(|c| c.id == id && owner(config, &account, &c.email));
    let asked = mailing(mine, args.no_mail, args.mail_me);
    let minted = client.relink(
        id,
        &Relink {
            client_uid: crate::client::uid(),
            new_totp: args.new_totp,
            mail: asked,
        },
    )?;
    if global.json {
        return print_json(&minted);
    }
    report(&minted, mine, asked)
}

fn code_of(config: &Config, account: &str) -> Result<String, String> {
    let entry = config
        .accounts
        .get(account)
        .ok_or_else(|| format!("no account is called {account}"))?;
    let Some(store) = entry.code.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Err(format!(
            "the account {account} keeps no code of yours; add code = \"<your code>\" under [accounts.{account}] in {} (the file at mode 600), or code = \"op://vault/item/field\" to read it from {}",
            crate::config::path().display(),
            crate::vault::tool()
        ));
    };
    let raw = crate::config::secret(store)?;
    let code: String = raw
        .trim()
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if code.len() != 12 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!(
            "the code kept for the account {account} is not a 12-character P99 code"
        ));
    }
    Ok(code)
}

fn choose(hosts: &[&str]) -> Result<String, String> {
    if !(std::io::stdin().is_terminal() && std::io::stderr().is_terminal()) {
        return Err(format!(
            "several hosts: {}; name one: p99 link <host>",
            hosts.join(", ")
        ));
    }
    let mut err = std::io::stderr();
    for (at, host) in hosts.iter().enumerate() {
        let _ = writeln!(err, "  {}  {host}", at + 1);
    }
    let _ = write!(err, "Which host? [1-{}] ", hosts.len());
    let _ = err.flush();
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| format!("standard input: {e}"))?;
    let typed = line.trim();
    typed
        .parse::<usize>()
        .ok()
        .and_then(|n| n.checked_sub(1))
        .and_then(|n| hosts.get(n))
        .or_else(|| hosts.iter().find(|h| **h == typed))
        .map(|h| (*h).to_owned())
        .ok_or_else(|| format!("{typed} is not one of the hosts"))
}

fn opener() -> Command {
    if let Some(program) = std::env::var_os(OPENER).filter(|v| !v.is_empty()) {
        return Command::new(program);
    }
    if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(windows) {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    } else {
        Command::new("xdg-open")
    }
}

fn open(url: &str) -> Result<(), String> {
    let mut command = opener();
    let name = command.get_program().to_string_lossy().into_owned();
    let status = command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("{name}: {e}; p99 link --print prints the link instead"))?;
    if !status.success() {
        return Err(format!(
            "{name} could not open the browser; p99 link --print prints the link instead"
        ));
    }
    Ok(())
}

pub fn link(config: &Config, global: &Global, args: &LinkArgs) -> Result<(), String> {
    let wanted = args.host.as_deref().map(|h| h.trim().to_ascii_lowercase());
    let account = account_of(config, global, wanted.as_deref())?;
    let hosts = config.hosts_of(&account);
    let host = match wanted {
        Some(h) if hosts.contains(&h.as_str()) => h,
        Some(h) => {
            return Err(format!(
                "{h} is not a host of the account {account}; p99 hosts lists them"
            ));
        }
        None => match hosts.as_slice() {
            [] => {
                return Err(format!(
                    "the account {account} has no host yet; p99 hosts add"
                ));
            }
            [one] => (*one).to_owned(),
            many => choose(many)?,
        },
    };
    let url = format!("https://{host}/#p99={}", code_of(config, &account)?);
    if args.print {
        if global.json {
            return print_json(&json!({"host": host, "link": url}));
        }
        println!("{url}");
        return Ok(());
    }
    open(&url)?;
    if global.json {
        return print_json(&json!({"host": host, "opened": true}));
    }
    println!("opened P99 on {host}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(id: i64, email: &str, hosts: &[&str], revoked: bool) -> Code {
        Code {
            id,
            email: email.into(),
            hosts: hosts.iter().map(|h| (*h).to_owned()).collect(),
            revoked_at: revoked.then(|| "2026-10-01T00:00:00Z".into()),
            ..Code::default()
        }
    }

    #[test]
    fn an_email_names_one_active_code_or_says_which() {
        let codes = || {
            vec![
                code(1, "grace@example.com", &["example.com"], true),
                code(2, "Grace@example.com", &["example.com"], false),
                code(3, "grace@example.com", &["shop.example.com"], false),
                code(4, "ada@example.com", &["example.com"], false),
            ]
        };
        assert_eq!(
            pick(codes(), "grace@example.com", Some("example.com")),
            Ok(2)
        );
        assert!(
            pick(codes(), "grace@example.com", None)
                .unwrap_err()
                .contains("2 (example.com), 3 (shop.example.com)")
        );
        assert!(pick(codes(), "linus@example.com", None).is_err());
    }

    #[test]
    fn the_owner_is_mailed_only_when_asked() {
        assert!(!mailing(true, false, false));
        assert!(mailing(true, false, true));
        assert!(mailing(false, false, false));
        assert!(!mailing(false, true, false));
    }
}

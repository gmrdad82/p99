use std::io::{self, BufRead, IsTerminal, Write};

use serde::{Deserialize, Serialize};

use super::{Global, client_for, print_json};
use crate::client::Client;
use crate::config::Config;
use crate::one_board::Role;
use crate::wire::{Code, out};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeDeleted {
    pub id: i64,
    pub deleted: bool,
}

pub(crate) fn remove(client: &Client, id: i64) -> Result<CodeDeleted, String> {
    client.json("DELETE", &format!("/v1/codes/{id}"), None)
}

pub(crate) fn find(codes: Vec<Code>, id: i64) -> Result<Code, String> {
    codes
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("no such code {id}"))
}

pub(crate) fn refusal(code: &Code) -> Option<String> {
    code.revoked_at.is_none().then(|| {
        format!(
            "code {} is active: revoke it first, p99 revoke {}",
            code.id, code.id
        )
    })
}

pub(crate) fn matches(code: &Code, typed: &str) -> bool {
    !code.hint.is_empty() && typed.trim().eq_ignore_ascii_case(&code.hint)
}

pub(crate) fn same(a: &Code, b: &Code) -> bool {
    a.id == b.id && a.hint == b.hint && a.email == b.email
}

pub(crate) fn kept(id: i64) -> String {
    format!("code {id} is kept: the four characters typed back didn't match")
}

fn typed_back(input: &mut impl BufRead, err: &mut impl Write, code: &Code) -> Result<bool, String> {
    let _ = writeln!(
        err,
        "{:>4}  revoked  {} <{}>  {}  ...{}\nDeleting it removes the code and its browsers' sign-ins for good; the person's items and comments stay.",
        code.id,
        crate::wire::clean(&code.name),
        crate::wire::clean(&code.email),
        Role::of(code.manager).word(),
        crate::wire::clean(&code.hint),
    );
    let _ = write!(err, "Type {} to delete it: ", crate::wire::clean(&code.hint));
    let _ = err.flush();
    let mut line = String::new();
    input.read_line(&mut line).map_err(|e| e.to_string())?;
    Ok(matches(code, &line))
}

pub fn delete(config: &Config, global: &Global, args: &CodeDeleteArgs) -> Result<(), String> {
    if !args.yes && !io::stdin().is_terminal() {
        return Err(format!(
            "deleting code {} needs --yes when no one is at a terminal to type its last four characters back",
            args.id
        ));
    }
    let (client, _) = client_for(config, global, None)?;
    let code = find(client.codes(None)?, args.id)?;
    if let Some(why) = refusal(&code) {
        return Err(why);
    }
    if !args.yes && !typed_back(&mut io::stdin().lock(), &mut io::stderr(), &code)? {
        return Err(kept(code.id));
    }
    let done = remove(&client, code.id)?;
    if global.json {
        return print_json(&done);
    }
    out!("deleted code {} of {} <{}>", code.id, code.name, code.email);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde_json::json;

    use super::*;
    use crate::wire::{Author, Member};

    fn code(id: i64, hint: &str, revoked: bool, manager: bool) -> Code {
        Code {
            id,
            name: "Grace Hopper".into(),
            email: "grace@example.com".into(),
            hosts: vec!["example.com".into()],
            manager,
            hint: hint.into(),
            revoked_at: revoked.then(|| "2026-10-01T00:00:00Z".into()),
            ..Code::default()
        }
    }

    fn ask(code: &Code, typed: &str) -> (bool, String) {
        let mut err = Vec::new();
        let said = typed_back(&mut Cursor::new(typed.as_bytes()), &mut err, code).unwrap();
        (said, String::from_utf8(err).unwrap())
    }

    #[test]
    fn the_four_characters_typed_back_delete_and_anything_else_keeps_the_code() {
        let revoked = code(2, "3fpd", true, false);
        assert!(ask(&revoked, "3fpd\n").0);
        assert!(ask(&revoked, "  3FPD \n").0);
        assert!(ask(&revoked, "3fpd").0);
        for wrong in ["", "\n", "3fp\n", "3fpdx\n", "...3fpd\n", "2\n", "yes\n", "m9xa\n"] {
            assert!(!ask(&revoked, wrong).0, "{wrong:?}");
        }
        assert!(!matches(&code(2, "", true, false), ""));
        assert!(!matches(&code(2, "", true, false), "\n"));
    }

    #[test]
    fn the_question_names_the_code_its_role_and_what_stays() {
        let (_, said) = ask(&code(2, "3fpd", true, false), "no\n");
        let lines: Vec<&str> = said.lines().collect();
        assert_eq!(
            lines[0],
            "   2  revoked  Grace Hopper <grace@example.com>  User  ...3fpd"
        );
        assert_eq!(
            lines[1],
            "Deleting it removes the code and its browsers' sign-ins for good; the person's items and comments stay."
        );
        assert_eq!(lines[2], "Type 3fpd to delete it: ");
        let (_, owner) = ask(&code(9, "7k2q", true, true), "\n");
        assert!(owner.starts_with("   9  revoked  Grace Hopper <grace@example.com>  Owner  ...7k2q\n"), "{owner}");
    }

    #[test]
    fn the_question_drops_control_characters_from_what_the_worker_sent() {
        let mut sly = code(4, "q81v", true, false);
        sly.name = "Grace\u{1b}]52;x Hopper\u{202e}".into();
        let (_, said) = ask(&sly, "\n");
        assert!(!said.contains('\u{1b}') && !said.contains('\u{202e}'), "{said:?}");
        assert!(said.contains("Grace]52;x Hopper <grace@example.com>"), "{said}");
    }

    #[test]
    fn an_active_code_is_refused_in_one_line_and_a_revoked_one_is_not() {
        assert_eq!(
            refusal(&code(3, "m9xa", false, false)).as_deref(),
            Some("code 3 is active: revoke it first, p99 revoke 3")
        );
        assert_eq!(refusal(&code(2, "3fpd", true, false)), None);
        assert_eq!(
            kept(2),
            "code 2 is kept: the four characters typed back didn't match"
        );
    }

    #[test]
    fn a_code_is_found_by_id_and_a_missing_one_is_said_plainly() {
        let codes = vec![code(1, "7k2q", false, true), code(2, "3fpd", true, false)];
        assert_eq!(find(codes.clone(), 2).unwrap().hint, "3fpd");
        assert_eq!(find(codes, 7).unwrap_err(), "no such code 7");
        assert_eq!(find(Vec::new(), 1).unwrap_err(), "no such code 1");
    }

    #[test]
    fn the_worker_answer_reads_and_prints_as_it_came() {
        let done: CodeDeleted = serde_json::from_value(json!({"id": 2, "deleted": true})).unwrap();
        assert_eq!(done, CodeDeleted { id: 2, deleted: true });
        assert_eq!(serde_json::to_value(&done).unwrap(), json!({"id": 2, "deleted": true}));
        assert!(serde_json::from_value::<CodeDeleted>(json!({"deleted": true})).is_err());
    }

    #[test]
    fn a_code_author_and_member_print_role_beside_manager() {
        let owner = serde_json::to_value(code(1, "7k2q", false, true)).unwrap();
        assert_eq!((owner["manager"].clone(), owner["role"].clone()), (json!(true), json!("owner")));
        let user = serde_json::to_value(code(2, "3fpd", true, false)).unwrap();
        assert_eq!((user["manager"].clone(), user["role"].clone()), (json!(false), json!("user")));
        let keys: Vec<&str> = user.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["id", "name", "email", "hosts", "manager", "role", "hint", "created_at", "created_by", "revoked_at", "last_used_at", "totp"]
        );
        let author = serde_json::to_value(Author {
            name: "Ada Lovelace".into(),
            manager: true,
            ..Author::default()
        })
        .unwrap();
        assert_eq!(author["role"], "owner");
        assert_eq!(author["manager"], true);
        assert_eq!(author["via"], json!(null));
        let member = serde_json::to_value(Member {
            username: "grace.hopper".into(),
            manager: false,
        })
        .unwrap();
        assert_eq!(member, json!({"username": "grace.hopper", "manager": false, "role": "user"}));
    }

    #[test]
    fn a_role_from_the_worker_reads_and_prints_back_the_same() {
        let read: Code = serde_json::from_value(json!({
            "id": 5, "name": "Ada Lovelace", "email": "ada@example.com", "hosts": ["example.com"],
            "manager": true, "role": "owner", "hint": "7k2q", "totp": true
        }))
        .unwrap();
        assert!(read.manager);
        let back = serde_json::to_value(&read).unwrap();
        assert_eq!(back["role"], "owner");
        assert_eq!(back["totp"], true);
        let again: Code = serde_json::from_value(back).unwrap();
        assert_eq!((again.id, again.manager, again.hint.as_str()), (5, true, "7k2q"));
        let old: Member = serde_json::from_value(json!({"username": "ada", "manager": true})).unwrap();
        assert_eq!(serde_json::to_value(old).unwrap()["role"], "owner");
    }

    #[test]
    fn every_role_word_is_owner_or_user() {
        assert_eq!(Role::of(true).word(), "Owner");
        assert_eq!(Role::of(false).word(), "User");
        assert_eq!(serde_json::to_value(Role::Owner).unwrap(), json!("owner"));
        assert_eq!(serde_json::to_value(Role::User).unwrap(), json!("user"));
        use clap::ValueEnum;
        for (word, role) in [
            ("owner", Role::Owner),
            ("manager", Role::Owner),
            ("user", Role::User),
            ("person", Role::User),
            ("reporter", Role::User),
        ] {
            assert_eq!(Role::from_str(word, false), Ok(role), "{word}");
        }
        for word in ["guest", "member", "admin", ""] {
            assert!(Role::from_str(word, false).is_err(), "{word}");
        }
        let shown: Vec<String> = Role::value_variants()
            .iter()
            .filter_map(|r| r.to_possible_value())
            .map(|v| v.get_name().to_owned())
            .collect();
        assert_eq!(shown, ["owner", "user"]);
    }
}

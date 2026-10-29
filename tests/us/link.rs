use serde_json::json;

use crate::fake;
use crate::home::{self, Home};
use crate::stub::Stub;

fn with_code_line(name: &str, line: &str) -> Home {
    let stub = Stub::new(fake::any);
    let text = home::config(&stub.base).replace("url = ", &format!("{line}\nurl = "));
    Home::with_config(name, stub, &text)
}

#[cfg(unix)]
fn script(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let file = dir.join(name);
    std::fs::write(&file, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    file
}

#[cfg(unix)]
#[test]
fn us_link_001_p99_link_opens_adas_site_with_her_code() {
    let h = with_code_line("us-link-open", "code = \" ABCD-EFGH-JKMN \"");
    let printed = h.p99(&["link", "Shop.Example.com", "--print"]);
    printed.ok();
    assert_eq!(
        printed.stdout,
        "https://shop.example.com/#p99=abcdefghjkmn\n"
    );
    let opener = script(
        &h.dir,
        "open-it",
        "printf '%s' \"$1\" > \"$(dirname \"$0\")/opened\"",
    );
    let opened = h.p99_env(
        &["link", "shop.example.com"],
        &[("P99_BROWSER", opener.to_str().unwrap())],
    );
    opened.ok();
    assert_eq!(opened.stdout, "opened P99 on shop.example.com\n");
    assert_eq!(
        std::fs::read_to_string(h.dir.join("opened")).unwrap(),
        printed.stdout.trim_end()
    );
    let refusing = script(&h.dir, "refuse", "exit 3");
    h.p99_env(
        &["link", "shop.example.com"],
        &[("P99_BROWSER", refusing.to_str().unwrap())],
    )
    .refused(&format!(
        "{} could not open the browser; p99 link --print prints the link instead",
        refusing.display()
    ));
    let json = h
        .p99(&["link", "dev.example.com", "--print", "--json"])
        .json();
    assert_eq!(
        json,
        json!({"host": "dev.example.com", "link": "https://dev.example.com/#p99=abcdefghjkmn"})
    );
    assert!(h.stub.seen().is_empty());
}

#[cfg(unix)]
#[test]
fn us_link_001_a_code_kept_by_a_command_a_file_or_an_env_var_is_read_then_and_never_written_back() {
    use std::os::unix::fs::PermissionsExt;
    let want = "https://shop.example.com/#p99=abcdefghjkmn\n";

    let by_command = with_code_line("us-link-command", "");
    let getter = script(&by_command.dir, "get-code", "printf 'ABCD-EFGH-JKMN\\n'");
    by_command.write(&by_command.config().replace(
        "\nurl = ",
        &format!(
            "\ncode = {{ command = [\"{}\"] }}\nurl = ",
            getter.display()
        ),
    ));
    let before = by_command.config();
    let out = by_command.p99(&["link", "shop.example.com", "--print"]);
    out.ok();
    assert_eq!(out.stdout, want);
    assert_eq!(by_command.config(), before);

    let by_file = with_code_line("us-link-file", "");
    let kept = by_file.dir.join("my-code");
    std::fs::write(&kept, "abcd efgh jkmn\n").unwrap();
    std::fs::set_permissions(&kept, std::fs::Permissions::from_mode(0o600)).unwrap();
    by_file.write(&by_file.config().replace(
        "\nurl = ",
        &format!("\ncode = {{ file = \"{}\" }}\nurl = ", kept.display()),
    ));
    let before = by_file.config();
    let out = by_file.p99(&["link", "shop.example.com", "--print"]);
    out.ok();
    assert_eq!(out.stdout, want);
    assert_eq!(by_file.config(), before);
    assert_eq!(std::fs::read_to_string(&kept).unwrap(), "abcd efgh jkmn\n");

    let by_env = with_code_line("us-link-env", "code = { env = \"US_LINK_CODE\" }");
    let before = by_env.config();
    let out = by_env.p99_env(
        &["link", "shop.example.com", "--print"],
        &[("US_LINK_CODE", "abcd-efgh-jkmn")],
    );
    out.ok();
    assert_eq!(out.stdout, want);
    assert_eq!(by_env.config(), before);
    assert!(!by_env.config().contains("abcdefghjkmn"));
    by_env
        .p99(&["link", "shop.example.com", "--print"])
        .refused("US_LINK_CODE: the variable is not set");
}

#[test]
fn us_link_001_a_missing_or_ambiguous_site_is_refused() {
    let h = with_code_line("us-link-bad", "code = \"abcd-efgh\"");
    h.p99(&["link", "--print"])
        .refused("several hosts: dev.example.com, shop.example.com; name one: p99 link <host>");
    h.p99(&["link", "blog.example.com"])
        .refused("blog.example.com is not a host of the space main; p99 hosts lists them");
    h.p99(&["link", "shop.example.com", "--print"])
        .refused("the code kept for the space main is not a 12-character P99 code");
    let none = Home::new("us-link-none", fake::any);
    none.p99(&["link", "shop.example.com", "--print"]).refused(&format!(
        "the space main keeps no code of yours; add code = \"<your code>\" under [spaces.main] in {} (the file at mode 600), or code = {{ file = \"…\" }}, {{ env = \"…\" }} or {{ command = [\"…\"] }} to read it from elsewhere",
        none.file().display()
    ));
    assert!(h.stub.seen().is_empty());
    assert!(none.stub.seen().is_empty());
}

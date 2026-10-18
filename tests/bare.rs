use std::process::{Command, Stdio};

#[test]
fn a_bare_call_off_a_terminal_answers_like_clap_and_never_opens_the_tui() {
    let out = Command::new(env!("CARGO_BIN_EXE_p99"))
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.starts_with("error: 'p99' requires a subcommand but one was not provided"));
    assert!(err.ends_with("For more information, try '--help'.\n"));
}

#![cfg(any(target_os = "linux", target_os = "macos"))]

#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[path = "cli/stub.rs"]
mod stub;

use std::ffi::CStr;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::raw::{c_char, c_int};
use std::os::unix::fs::OpenOptionsExt;
use std::process::Stdio;
use std::sync::{Mutex, mpsc};
use std::time::Duration;

use serde_json::json;

use home::{Home, Out};
use stub::{Reply, Req, thread};

unsafe extern "C" {
    fn posix_openpt(flags: c_int) -> c_int;
    fn grantpt(fd: c_int) -> c_int;
    fn unlockpt(fd: c_int) -> c_int;
    fn ptsname(fd: c_int) -> *mut c_char;
    fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
}

const O_RDWR: c_int = 2;
#[cfg(target_os = "macos")]
const O_NOCTTY: c_int = 0x20000;
#[cfg(target_os = "linux")]
const O_NOCTTY: c_int = 0o400;
#[cfg(target_os = "linux")]
const O_CLOEXEC: c_int = 0o2000000;
#[cfg(target_os = "macos")]
const O_CLOEXEC: c_int = 0;
const F_GETFD: c_int = 1;
const F_SETFD: c_int = 2;
const FD_CLOEXEC: c_int = 1;
const CTRL_D: &[u8] = &[4];
const ESC_TITLE: &str = "The total \u{1b}[31mdoes not\u{1b}[0m update";
const PROMPT: &str = "BUG-12  The total [31mdoes not[0m update\nDeleting it removes its 1 comment, 2 files and history for good; GitHub keeps its own issue.\nType BUG-12 to delete it: ";

static NAMING: Mutex<()> = Mutex::new(());

fn pty() -> (File, File) {
    let _held = NAMING.lock().unwrap();
    let fd = unsafe { posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC) };
    assert!(fd >= 0, "{}", std::io::Error::last_os_error());
    let master = unsafe { File::from_raw_fd(fd) };
    assert_eq!(
        unsafe { fcntl(fd, F_SETFD, FD_CLOEXEC) },
        0,
        "{}",
        std::io::Error::last_os_error()
    );
    assert_eq!(unsafe { grantpt(fd) }, 0, "{}", std::io::Error::last_os_error());
    assert_eq!(unsafe { unlockpt(fd) }, 0, "{}", std::io::Error::last_os_error());
    let name = unsafe { ptsname(fd) };
    assert!(!name.is_null());
    let name = unsafe { CStr::from_ptr(name) }.to_str().unwrap().to_owned();
    let slave = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(O_NOCTTY)
        .open(name)
        .unwrap();
    (master, slave)
}

fn at_terminal(h: &Home, args: &[&str], typed: &[u8]) -> Out {
    let (mut master, slave) = pty();
    master.write_all(typed).unwrap();
    let mut cmd = h.command(args, &[]);
    cmd.stdin(Stdio::from(slave))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().unwrap();
    drop(cmd);
    let (done, finished) = mpsc::channel();
    let pipe = |mut from: Box<dyn Read + Send>, done: mpsc::Sender<()>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = from.read_to_string(&mut text);
            let _ = done.send(());
            text
        })
    };
    let out = pipe(Box::new(child.stdout.take().unwrap()), done.clone());
    let err = pipe(Box::new(child.stderr.take().unwrap()), done);
    let late = (0..2).any(|_| finished.recv_timeout(Duration::from_secs(60)).is_err());
    if late {
        let _ = child.kill();
    }
    let status = child.wait().unwrap();
    drop(master);
    let (stdout, stderr) = (out.join().unwrap(), err.join().unwrap());
    assert!(!late, "p99 {args:?} never finished\n{stdout}{stderr}");
    Out {
        code: status.code(),
        stdout,
        stderr,
    }
}

fn delete_home(name: &str) -> Home {
    delete_home_with(name, 1)
}

fn delete_home_with(name: &str, comments: i64) -> Home {
    Home::new(name, move |req: &Req| {
        if req.is("GET", "/_p99/v1/issues/12") {
            let mut found = thread(12, ESC_TITLE);
            found["issue"]["comments"] = json!(comments);
            found["attachments"] = json!([{"id": 1, "name": "a.png"}, {"id": 2, "name": "b.png"}]);
            Reply::ok(found)
        } else if req.is("GET", "/_p99/v1/issues/13") {
            Reply::problem(404, "no such item")
        } else {
            fake::any(req)
        }
    })
}

fn deleted(h: &Home) -> usize {
    h.stub.calls("DELETE", "/_p99/v1/issues/12").len()
}

#[test]
fn the_key_typed_back_at_a_terminal_deletes_the_item() {
    let h = delete_home("delete-tty-typed");
    let out = at_terminal(&h, &["delete", "12"], b"BUG-12\n");
    out.ok();
    assert_eq!(out.stderr, PROMPT);
    assert_eq!(out.stdout, "BUG-12 deleted with 2 comments and 1 file\n");
    let seen: Vec<String> = h
        .stub
        .seen()
        .iter()
        .map(|r| format!("{} {}", r.method, r.path))
        .collect();
    assert_eq!(
        seen,
        ["GET /_p99/v1/issues/12", "DELETE /_p99/v1/issues/12"]
    );
    assert!(h.stub.seen().iter().all(|r| r.signed));
}

#[test]
fn the_key_typed_back_in_lower_case_and_padded_still_deletes() {
    let h = delete_home("delete-tty-lower");
    at_terminal(&h, &["delete", "BUG-12"], b"  bug-12 \n").ok();
    assert_eq!(deleted(&h), 1);
}

#[test]
fn the_key_typed_back_with_a_host_asks_and_deletes_on_that_host() {
    let h = delete_home("delete-tty-host");
    at_terminal(
        &h,
        &["delete", "12", "--host", "shop.example.com"],
        b"BUG-12\n",
    )
    .ok();
    assert_eq!(
        h.stub.call("GET", "/_p99/v1/issues/12").param("host"),
        Some("shop.example.com")
    );
    assert_eq!(
        h.stub.call("DELETE", "/_p99/v1/issues/12").param("host"),
        Some("shop.example.com")
    );
}

#[test]
fn a_wrong_key_typed_back_keeps_the_item() {
    for (name, typed) in [
        ("delete-tty-wrong", &b"BUG-13\n"[..]),
        ("delete-tty-number", b"12\n"),
        ("delete-tty-blank", b"\n"),
        ("delete-tty-longer", b"BUG-120\n"),
    ] {
        let h = delete_home(name);
        let out = at_terminal(&h, &["delete", "BUG-12"], typed);
        out.refused("BUG-12 is kept: the key typed back didn't match");
        assert_eq!(out.stderr, format!("{PROMPT}p99: BUG-12 is kept: the key typed back didn't match\n"));
        assert!(out.stdout.is_empty(), "{name}: {}", out.stdout);
        assert_eq!(deleted(&h), 0, "{name}");
    }
}

#[test]
fn ctrl_d_at_the_prompt_keeps_the_item() {
    let h = delete_home("delete-tty-eof");
    let out = at_terminal(&h, &["delete", "12"], CTRL_D);
    out.refused("BUG-12 is kept: the key typed back didn't match");
    assert!(out.stderr.starts_with(PROMPT), "{}", out.stderr);
    assert_eq!(deleted(&h), 0);
}

#[test]
fn yes_at_a_terminal_deletes_without_asking() {
    let h = delete_home("delete-tty-yes");
    let out = at_terminal(&h, &["delete", "12", "--yes"], b"");
    out.ok();
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    assert!(h.stub.calls("GET", "/_p99/v1/issues/12").is_empty());
    assert_eq!(deleted(&h), 1);
}

#[test]
fn an_item_the_worker_cannot_find_is_never_asked_about_or_deleted() {
    let h = delete_home("delete-tty-missing");
    let out = at_terminal(&h, &["delete", "BUG-13"], b"BUG-13\n");
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    assert!(!out.stderr.contains("Type BUG-13"), "{}", out.stderr);
    assert!(out.stderr.contains("no such item"), "{}", out.stderr);
    assert!(h.stub.under("DELETE", "/_p99/v1/issues/").is_empty());
}

#[test]
fn the_terminal_s_master_side_is_never_inherited_by_a_child() {
    let (master, _slave) = pty();
    let flags = unsafe { fcntl(master.as_raw_fd(), F_GETFD) };
    assert!(flags >= 0, "{}", std::io::Error::last_os_error());
    assert_eq!(flags & FD_CLOEXEC, FD_CLOEXEC);
}

#[test]
fn a_line_typed_back_that_is_not_utf8_keeps_the_item() {
    let h = delete_home("delete-tty-bytes");
    let out = at_terminal(&h, &["delete", "12"], b"BUG-\xc3\n");
    assert_eq!(out.code, Some(1), "{}", out.stderr);
    let after = out
        .stderr
        .strip_prefix(PROMPT)
        .unwrap_or_else(|| panic!("{}", out.stderr));
    assert!(after.starts_with("p99: "), "{after}");
    assert!(!after.contains("is kept"), "{after}");
    assert!(out.stdout.is_empty(), "{}", out.stdout);
    assert_eq!(deleted(&h), 0);
}

#[test]
fn a_negative_comment_count_from_the_worker_reads_as_none() {
    let h = delete_home_with("delete-tty-negative", -3);
    let out = at_terminal(&h, &["delete", "12"], b"BUG-12\n");
    out.ok();
    assert!(
        out.stderr
            .contains("Deleting it removes its 0 comments, 2 files and history for good"),
        "{}",
        out.stderr
    );
    assert_eq!(deleted(&h), 1);
}

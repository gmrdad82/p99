#![cfg(any(target_os = "linux", target_os = "macos"))]

use std::ffi::CStr;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::os::raw::{c_char, c_int};
use std::os::unix::fs::OpenOptionsExt;
use std::process::Stdio;
use std::sync::{Mutex, mpsc};
use std::time::Duration;

use serde_json::json;

use crate::fake;
use crate::home::{Home, Out};
use crate::stub::{Reply, Req, code};

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
const F_SETFD: c_int = 2;
const FD_CLOEXEC: c_int = 1;
const CODE_PROMPT: &str = "   4  revoked  Grace Hopper <grace@example.com>  User  ...k3x9\nDeleting it removes the code and its browsers' sign-ins for good; the person's items and comments stay.\nType k3x9 to delete it: ";

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
    assert_eq!(
        unsafe { grantpt(fd) },
        0,
        "{}",
        std::io::Error::last_os_error()
    );
    assert_eq!(
        unsafe { unlockpt(fd) },
        0,
        "{}",
        std::io::Error::last_os_error()
    );
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

fn code_home(name: &str) -> Home {
    Home::new(name, |req: &Req| {
        if req.is("GET", "/_p99/v1/codes") {
            let mut revoked = code(
                4,
                "Grace Hopper",
                "grace@example.com",
                &["shop.example.com"],
            );
            revoked["role"] = json!("user");
            revoked["revoked_at"] = json!("2026-10-03T00:00:00Z");
            Reply::ok(json!({"codes": [revoked]}))
        } else if req.is("DELETE", "/_p99/v1/codes/4") {
            Reply::ok(json!({"id": 4, "deleted": true}))
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn us_revoke_001_a_revoked_code_is_deleted_once_its_four_characters_are_typed_back() {
    let wrong = code_home("us-revoke-wrong");
    let kept = at_terminal(&wrong, &["invites", "delete", "4"], b"3fpd\n");
    kept.refused("code 4 is kept: the four characters typed back didn't match");
    assert!(kept.stdout.is_empty(), "{}", kept.stdout);
    assert!(wrong.stub.under("DELETE", "/_p99/v1/codes").is_empty());

    let h = code_home("us-revoke-typed");
    let out = at_terminal(&h, &["invites", "delete", "4"], b"K3X9\n");
    out.ok();
    assert_eq!(out.stderr, CODE_PROMPT);
    assert_eq!(
        out.stdout,
        "deleted code 4 of Grace Hopper <grace@example.com>\n"
    );
    let deleted = h.stub.calls("DELETE", "/_p99/v1/codes/4");
    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].signed);
}

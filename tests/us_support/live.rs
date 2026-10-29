#![cfg(unix)]
#![allow(dead_code)]

use std::ffi::CStr;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::raw::{c_char, c_int, c_ulong};
use std::os::unix::fs::OpenOptionsExt;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use crate::home::{Home, Out};

#[repr(C)]
struct Winsize {
    rows: u16,
    cols: u16,
    x: u16,
    y: u16,
}

unsafe extern "C" {
    fn posix_openpt(flags: c_int) -> c_int;
    fn grantpt(fd: c_int) -> c_int;
    fn unlockpt(fd: c_int) -> c_int;
    fn ptsname(fd: c_int) -> *mut c_char;
    fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
    fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
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
#[cfg(target_os = "linux")]
const TIOCSWINSZ: c_ulong = 0x5414;
#[cfg(target_os = "macos")]
const TIOCSWINSZ: c_ulong = 0x8008_7467;
const F_SETFD: c_int = 2;
const FD_CLOEXEC: c_int = 1;

pub fn pty() -> (File, File) {
    let _held = crate::NAMING.lock().unwrap();
    let fd = unsafe { posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC) };
    assert!(fd >= 0, "{}", std::io::Error::last_os_error());
    let master = unsafe { File::from_raw_fd(fd) };
    assert_eq!(unsafe { fcntl(fd, F_SETFD, FD_CLOEXEC) }, 0);
    assert_eq!(unsafe { grantpt(fd) }, 0);
    assert_eq!(unsafe { unlockpt(fd) }, 0);
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

pub fn at_terminal(h: &Home, args: &[&str], typed: &[u8]) -> Out {
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

pub struct Live {
    child: Child,
    master: File,
    heard: Arc<Mutex<Vec<u8>>>,
    cols: usize,
    rows: usize,
}

impl Live {
    pub fn start(home: &Home, args: &[&str], cols: u16, rows: u16) -> Live {
        let (master, slave) = pty();
        let size = Winsize {
            rows,
            cols,
            x: 0,
            y: 0,
        };
        assert_eq!(
            unsafe { ioctl(master.as_raw_fd(), TIOCSWINSZ, &size as *const Winsize) },
            0,
            "{}",
            std::io::Error::last_os_error()
        );
        let mut cmd = home.command(args, &[("TERM", "xterm-256color")]);
        cmd.stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave));
        let child = cmd.spawn().unwrap();
        drop(cmd);
        let heard: Arc<Mutex<Vec<u8>>> = Arc::default();
        let mut reader = master.try_clone().unwrap();
        let sink = Arc::clone(&heard);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = reader.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        });
        Live {
            child,
            master,
            heard,
            cols: usize::from(cols),
            rows: usize::from(rows),
        }
    }

    pub fn press(&mut self, bytes: &[u8]) {
        self.master.write_all(bytes).unwrap();
        self.master.flush().unwrap();
    }

    pub fn screen(&self) -> String {
        let bytes = self.heard.lock().unwrap().clone();
        paint(&bytes, self.cols, self.rows)
    }

    pub fn wait_for(&self, needle: &str, within: Duration) -> Option<Duration> {
        let began = Instant::now();
        loop {
            if self.screen().contains(needle) {
                return Some(began.elapsed());
            }
            if began.elapsed() > within {
                return None;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn paint(bytes: &[u8], cols: usize, rows: usize) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut grid = vec![vec![' '; cols]; rows];
    let (mut row, mut col) = (0usize, 0usize);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    let mut params = String::new();
                    let mut last = ' ';
                    for next in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            last = next;
                            break;
                        }
                        params.push(next);
                    }
                    if params.starts_with(['?', '>', '<', '=']) {
                        continue;
                    }
                    let numbers: Vec<usize> =
                        params.split(';').map(|p| p.parse().unwrap_or(0)).collect();
                    let first = numbers.first().copied().unwrap_or(0).max(1);
                    match last {
                        'H' | 'f' => {
                            row = first.saturating_sub(1).min(rows - 1);
                            col = numbers
                                .get(1)
                                .copied()
                                .unwrap_or(1)
                                .max(1)
                                .saturating_sub(1)
                                .min(cols - 1);
                        }
                        'A' => row = row.saturating_sub(first),
                        'B' => row = (row + first).min(rows - 1),
                        'C' => col = (col + first).min(cols - 1),
                        'D' => col = col.saturating_sub(first),
                        'G' => col = first.saturating_sub(1).min(cols - 1),
                        'd' => row = first.saturating_sub(1).min(rows - 1),
                        'J' => match numbers.first().copied().unwrap_or(0) {
                            0 => {
                                grid[row][col.min(cols - 1)..].fill(' ');
                                for line in grid.iter_mut().skip(row + 1) {
                                    line.fill(' ');
                                }
                            }
                            _ => grid.iter_mut().for_each(|line| line.fill(' ')),
                        },
                        'K' => match numbers.first().copied().unwrap_or(0) {
                            0 => grid[row][col.min(cols - 1)..].fill(' '),
                            1 => grid[row][..=col.min(cols - 1)].fill(' '),
                            _ => grid[row].fill(' '),
                        },
                        _ => {}
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\x1b' {
                            chars.next();
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            '\r' => col = 0,
            '\n' => row = (row + 1).min(rows - 1),
            c if c.is_control() => {}
            c => {
                if col < cols {
                    grid[row][col] = c;
                }
                col = (col + 1).min(cols);
            }
        }
    }
    grid.iter()
        .map(|line| line.iter().collect::<String>().trim_end().to_owned())
        .collect::<Vec<_>>()
        .join("\n")
}

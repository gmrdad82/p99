#![allow(dead_code)]

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::stub::{KEY, Reply, Req, Stub, scratch};

const DEADLINE: Duration = Duration::from_secs(60);

pub struct Out {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Out {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout)
            .unwrap_or_else(|e| panic!("stdout is not JSON ({e}): {}{}", self.stdout, self.stderr))
    }

    pub fn ok(&self) -> &Out {
        assert_eq!(
            self.code,
            Some(0),
            "exit {:?}\nstdout: {}\nstderr: {}",
            self.code,
            self.stdout,
            self.stderr
        );
        self
    }

    pub fn refused(&self, said: &str) -> &Out {
        assert_eq!(
            self.code,
            Some(1),
            "exit {:?}\nstdout: {}\nstderr: {}",
            self.code,
            self.stdout,
            self.stderr
        );
        assert!(
            self.stderr.ends_with(&format!("p99: {said}\n")),
            "stderr should end with p99: {said}\n got: {}",
            self.stderr
        );
        self
    }

    pub fn dropped(&self, said: &str) -> &Out {
        assert_eq!(self.code, Some(1), "{}", self.stderr);
        assert!(
            self.stderr.starts_with(&format!("p99: {said}: ")),
            "stderr should start with p99: {said}: \n got: {}",
            self.stderr
        );
        assert_eq!(self.stderr.lines().count(), 1, "{}", self.stderr);
        self
    }

    pub fn clap(&self, said: &str) -> &Out {
        assert_eq!(self.code, Some(2), "{}", self.stderr);
        assert!(self.stdout.is_empty(), "{}", self.stdout);
        assert!(
            self.stderr.starts_with(&format!("error: {said}")),
            "{}",
            self.stderr
        );
        assert!(self.stderr.ends_with('\n'), "{}", self.stderr);
        let lines: Vec<&str> = self.stderr.lines().collect();
        let n = lines.len();
        assert!(n >= 3, "{}", self.stderr);
        assert_eq!(
            lines[n - 2..],
            ["", "For more information, try '--help'."],
            "{}",
            self.stderr
        );
        if lines[n - 3].starts_with("Usage:") {
            assert!(lines[n - 3].starts_with("Usage: p99 "), "{}", self.stderr);
            assert!(n >= 5 && lines[n - 4].is_empty(), "{}", self.stderr);
        }
        assert_eq!(
            lines.iter().filter(|l| l.starts_with("Usage:")).count(),
            usize::from(lines[n - 3].starts_with("Usage:")),
            "{}",
            self.stderr
        );
        self
    }

    pub fn lines(&self) -> Vec<&str> {
        self.stdout.lines().collect()
    }
}

pub struct Home {
    pub dir: PathBuf,
    pub stub: Stub,
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn config(base: &str) -> String {
    format!(
        r#"default_account = "main"

[me]
name = "Ada Lovelace"
email = "ada@example.com"

[accounts.main]
account_id = "acc1"
token = "cf-token"
database_id = "db1"
key = "{KEY}"
url = "{base}/_p99"

[hosts."shop.example.com"]
account = "main"

[hosts."dev.example.com"]
account = "main"
env = "dev"
"#
    )
}

impl Home {
    pub fn new(name: &str, handler: impl Fn(&Req) -> Reply + Send + Sync + 'static) -> Home {
        let stub = Stub::new(handler);
        let text = config(&stub.base);
        Home::with_config(name, stub, &text)
    }

    pub fn with_config(name: &str, stub: Stub, text: &str) -> Home {
        let dir = scratch(name);
        let home = Home { dir, stub };
        home.write(text);
        home
    }

    pub fn file(&self) -> PathBuf {
        self.dir.join("config.toml")
    }

    pub fn write(&self, text: &str) {
        let file = self.file();
        std::fs::write(&file, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    pub fn config(&self) -> String {
        std::fs::read_to_string(self.file()).unwrap_or_default()
    }

    pub fn toml(&self) -> toml::Value {
        toml::from_str(&self.config()).unwrap()
    }

    pub fn p99(&self, args: &[&str]) -> Out {
        self.run(args, &[], None)
    }

    pub fn p99_in(&self, args: &[&str], stdin: &str) -> Out {
        self.run(args, &[], Some(stdin))
    }

    pub fn p99_env(&self, args: &[&str], envs: &[(&str, &str)]) -> Out {
        self.run(args, envs, None)
    }

    pub fn runtime(&self) -> PathBuf {
        let dir = self.dir.join("run");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn command(&self, args: &[&str], envs: &[(&str, &str)]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_p99"));
        cmd.args(args)
            .current_dir(&self.dir)
            .env("HOME", &self.dir)
            .env("XDG_CONFIG_HOME", self.dir.join("xdg"))
            .env("P99_CONFIG", self.file())
            .env("P99_CLOUDFLARE_API", format!("{}/cf", self.stub.base))
            .env("P99_GITHUB_API", format!("{}/gh", self.stub.base))
            .env("P99_RESEND_API", format!("{}/resend", self.stub.base))
            .env(
                "P99_HOST_URL",
                format!("{}/health/{{host}}", self.stub.base),
            )
            .env("NO_COLOR", "1")
            .env_remove("P99_TOKEN")
            .env_remove("P99_KEY")
            .env_remove("P99_AGENT")
            .env("P99_BROWSER", self.dir.join("no-browser-in-tests"))
            .env("XDG_RUNTIME_DIR", self.runtime())
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("P99_RESEND_KEY")
            .env_remove("P99_LICENSE_STATE");
        for (k, v) in envs {
            cmd.env(k, v);
        }
        cmd
    }

    pub fn run(&self, args: &[&str], envs: &[(&str, &str)], stdin: Option<&str>) -> Out {
        let mut cmd = self.command(args, envs);
        cmd.stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        if let Some(text) = stdin {
            let mut input = child.stdin.take().unwrap();
            let text = text.to_owned();
            std::thread::spawn(move || {
                let _ = input.write_all(text.as_bytes());
            });
        }
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let (done, finished) = mpsc::channel();
        let closed = done.clone();
        let out = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stdout.read_to_string(&mut s);
            let _ = closed.send(());
            s
        });
        let err = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            let _ = done.send(());
            s
        });
        let deadline = Instant::now() + DEADLINE;
        let mut late = false;
        for _ in 0..2 {
            let left = deadline.saturating_duration_since(Instant::now());
            if finished.recv_timeout(left).is_err() {
                late = true;
                break;
            }
        }
        if late {
            let _ = child.kill();
        }
        let status = child.wait().unwrap();
        let (stdout, stderr) = (out.join().unwrap(), err.join().unwrap());
        assert!(
            !late,
            "p99 {args:?} ran past {DEADLINE:?} and was killed\nstdout: {stdout}\nstderr: {stderr}"
        );
        Out {
            code: status.code(),
            stdout,
            stderr,
        }
    }
}

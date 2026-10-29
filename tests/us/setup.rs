use serde_json::json;

use crate::cloudflare::{
    Cloud, Shared, TOKEN, UPLOAD, all, blank, cf_calls, configured, fresh, inserted, is_hex,
    metadata, never_shows, shipped, since, sqls, writes_in,
};
use crate::home::{Home, Out};

const ME: [&str; 4] = ["--name", "Ada Lovelace", "--email", "ada@example.com"];
const PERMISSIONS: [&str; 5] = [
    "Account › Workers Scripts: Edit",
    "Account › D1: Edit",
    "Account › Workers R2 Storage: Edit",
    "Zone › Workers Routes: Edit",
    "Zone › Zone: Read",
];

fn setup(h: &Home, extra: &[&str]) -> Out {
    let mut args = vec!["setup", "--yes"];
    args.extend(ME);
    args.extend(extra);
    h.p99_env(&args, &[("P99_TOKEN", TOKEN)])
}

fn every_cloudflare_call_carried_the_token(h: &Home) {
    let bearer = format!("Bearer {TOKEN}");
    let calls = cf_calls(h);
    assert!(!calls.is_empty());
    for call in &calls {
        assert_eq!(
            call.header("authorization"),
            Some(bearer.as_str()),
            "{} {}",
            call.method,
            call.path
        );
    }
}

fn no_space_in(h: &Home) -> bool {
    let config = h.toml();
    config
        .get("spaces")
        .is_none_or(|t| t.as_table().is_some_and(toml::map::Map::is_empty))
}

#[test]
fn us_setup_001_one_run_makes_everything_p99_needs_and_a_second_run_changes_nothing() {
    let (h, cf) = blank("us-setup-once", fresh());
    let first = setup(&h, &["--host", "Shop.Example.com", "--no-mail"]);
    first.ok();

    let config = h.toml();
    let main = &config["spaces"]["main"];
    assert_eq!(config["default_space"].as_str(), Some("main"));
    assert!(config.get("accounts").is_none(), "{}", h.config());
    assert_eq!(main["account_id"].as_str(), Some("acc1"));
    assert_eq!(main["database_id"].as_str(), Some("db-made"));
    let key = main["key"].as_str().unwrap().to_owned();
    assert!(is_hex(&key), "{key}");
    assert_eq!(
        config["hosts"]["shop.example.com"]["space"].as_str(),
        Some("main")
    );
    assert_eq!(
        main["projects"]["shop.example.com"],
        toml::Value::try_from(vec!["shop.example.com"]).unwrap()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(h.file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    assert_eq!(inserted(&h), shipped());
    let written = sqls(&h);
    assert!(
        written
            .iter()
            .any(|(s, p)| s.starts_with("INSERT INTO projects") && p[0] == "shop.example.com"),
        "no project was made for the host"
    );
    let host = written
        .iter()
        .find(|(s, _)| s.starts_with("INSERT INTO hosts"))
        .expect("no host was written");
    assert_eq!(host.1[0], "shop.example.com");
    assert_eq!(host.1[3], "shop.example.com");

    let (pepper, made) = {
        let state = cf.lock().unwrap();
        assert!(state.worker);
        assert_eq!(state.binding("DB")["database_id"], "db-made");
        assert_eq!(state.binding("BUCKET")["bucket_name"], "p99");
        assert_eq!(state.binding("RATE")["namespace_id"], "1002");
        assert_eq!(state.secret("KEY_P99").as_deref(), Some(key.as_str()));
        assert_eq!(state.secret("MANAGERS").as_deref(), Some("ada@example.com"));
        assert_eq!(
            state.routes,
            [("shop.example.com/_p99/*".to_owned(), "p99".to_owned())]
        );
        assert_eq!(state.buckets, ["p99"]);
        (
            state.secret("CODE_PEPPER").expect("no CODE_PEPPER"),
            state.databases.clone(),
        )
    };
    assert!(is_hex(&pepper) && pepper != key);
    for line in [
        "  ok  Cloudflare accepts the token",
        "  ok  created the D1 database p99 (db-made)",
        "  ok  created the R2 bucket p99",
        "  ok  added the route shop.example.com/_p99/* → p99",
        "The space main is set up:",
    ] {
        assert!(
            first.stdout.contains(line),
            "{line} missing:\n{}",
            first.stdout
        );
    }

    let text = h.config();
    let n = cf_calls(&h).len();
    let again = h.p99_env(
        &[
            "setup",
            "--yes",
            "--space",
            "main",
            "--host",
            "shop.example.com",
            "--no-mail",
        ],
        &[("P99_TOKEN", TOKEN)],
    );
    again.ok();
    assert_eq!(h.config(), text, "the second run rewrote the config");
    let later = since(&h, n);
    for (method, path) in [
        ("POST", "/cf/accounts/acc1/d1/database"),
        ("POST", "/cf/accounts/acc1/r2/buckets"),
        ("POST", "/cf/zones/z1/workers/routes"),
    ] {
        assert!(
            !later.iter().any(|r| r.is(method, path)),
            "{method} {path} ran again"
        );
    }
    assert!(
        crate::cloudflare::inserted_in(&later).is_empty(),
        "a migration ran twice"
    );
    let upload = later.iter().find(|r| r.is("PUT", UPLOAD)).unwrap();
    assert!(metadata(&upload.text()).get("migrations").is_none());
    let state = cf.lock().unwrap();
    assert_eq!(state.secret("KEY_P99"), Some(key.clone()));
    assert_eq!(state.secret("CODE_PEPPER"), Some(pepper.clone()));
    assert_eq!(state.databases, made);
    assert_eq!(state.routes.len(), 1);
    assert_eq!(state.applied, shipped());
    drop(state);
    assert!(
        again
            .stdout
            .contains("  --  continuing the setup of the space main"),
        "{}",
        again.stdout
    );
    never_shows(&[&first, &again], &[key.as_str(), pepper.as_str()]);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod terminal {
    use std::ffi::CStr;
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::raw::{c_char, c_int};
    use std::os::unix::fs::OpenOptionsExt;
    use std::process::Stdio;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use crate::home::{Home, Out};

    unsafe extern "C" {
        fn posix_openpt(flags: c_int) -> c_int;
        fn grantpt(fd: c_int) -> c_int;
        fn unlockpt(fd: c_int) -> c_int;
        fn ptsname(fd: c_int) -> *mut c_char;
        fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
        fn tcgetattr(fd: c_int, termios: *mut u64) -> c_int;
        fn tcsetattr(fd: c_int, action: c_int, termios: *const u64) -> c_int;
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
    const TCSANOW: c_int = 0;
    const ICRNL: u64 = 0o400;
    const DEADLINE: Duration = Duration::from_secs(60);

    fn pty() -> (File, File) {
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
        let mut termios = [0u64; 32];
        assert_eq!(
            unsafe { tcgetattr(slave.as_raw_fd(), termios.as_mut_ptr()) },
            0
        );
        termios[0] &= !ICRNL;
        assert_eq!(
            unsafe { tcsetattr(slave.as_raw_fd(), TCSANOW, termios.as_ptr()) },
            0
        );
        (master, slave)
    }

    pub fn walk(h: &Home, args: &[&str], envs: &[(&str, &str)], script: &[(&str, &[u8])]) -> Out {
        let (mut master, slave) = pty();
        let mut cmd = h.command(args, envs);
        cmd.stdin(Stdio::from(slave))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        drop(cmd);
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let (chunks, heard) = mpsc::channel::<Vec<u8>>();
        let reader = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if chunks.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let err = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        let deadline = Instant::now() + DEADLINE;
        let mut seen: Vec<u8> = Vec::new();
        let mut from = 0;
        let mut stuck = None;
        for (prompt, typed) in script {
            loop {
                let text = String::from_utf8_lossy(&seen[from..]).into_owned();
                if let Some(at) = text.find(prompt) {
                    from += text[..at + prompt.len()].len();
                    master.write_all(typed).unwrap();
                    master.flush().unwrap();
                    break;
                }
                let left = deadline.saturating_duration_since(Instant::now());
                match heard.recv_timeout(left) {
                    Ok(chunk) => seen.extend(chunk),
                    Err(_) => {
                        stuck = Some(*prompt);
                        break;
                    }
                }
            }
            if stuck.is_some() {
                break;
            }
        }
        if stuck.is_some() {
            let _ = child.kill();
        }
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match heard.recv_timeout(left) {
                Ok(chunk) => seen.extend(chunk),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = child.kill();
                    stuck = stuck.or(Some("the end of setup"));
                }
            }
        }
        let status = child.wait().unwrap();
        reader.join().unwrap();
        drop(master);
        let stdout = String::from_utf8_lossy(&seen).into_owned();
        let stderr = err.join().unwrap();
        assert!(
            stuck.is_none(),
            "p99 {args:?} never reached {stuck:?}\nstdout: {stdout}\nstderr: {stderr}"
        );
        Out {
            code: status.code(),
            stdout,
            stderr,
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn us_setup_001_the_walk_at_a_terminal_explains_each_permission_and_hides_the_token() {
    let (h, cf) = blank("us-setup-terminal", fresh());
    let empty = h.dir.join("no-tools");
    std::fs::create_dir_all(&empty).unwrap();
    let mut args = vec!["setup"];
    args.extend(ME);
    args.extend(["--no-vault", "--no-mail", "--host", "shop.example.com"]);
    let typed = format!("{TOKEN}\r");
    let out = terminal::walk(
        &h,
        &args,
        &[("PATH", empty.to_str().unwrap())],
        &[
            ("Choice [1]: ", b"1\n"),
            ("Paste the token (hidden): ", typed.as_bytes()),
            ("Choice [1]: ", b"\n"),
        ],
    );
    out.ok();

    let text = &out.stdout;
    let asked = text
        .find("Where does the token come from?")
        .expect("setup never asked where the token comes from");
    let pasted = text
        .find("Paste the token (hidden): ")
        .expect("setup never asked for the token");
    for permission in PERMISSIONS {
        let at = text
            .find(permission)
            .unwrap_or_else(|| panic!("{permission} is never explained:\n{text}"));
        assert!(at < asked && asked < pasted, "{permission}:\n{text}");
    }
    assert!(
        text.contains("  ok  Cloudflare accepts the token"),
        "{text}"
    );
    every_cloudflare_call_carried_the_token(&h);
    assert_eq!(
        h.toml()["spaces"]["main"]["token"].as_str(),
        Some(TOKEN),
        "the pasted token was not kept"
    );
    assert!(cf.lock().unwrap().worker);
    assert!(
        !all(&out).contains(TOKEN),
        "the token showed:\n{}",
        all(&out)
    );
}

fn lacks(name: &str, cloud: Cloud, hosts: &[&str], said: &str) {
    let (h, cf) = blank(name, cloud);
    let mut extra = vec!["--no-mail"];
    for host in hosts {
        extra.extend(["--host", *host]);
    }
    let out = setup(&h, &extra);
    out.refused(said);
    assert_eq!(
        out.stderr
            .lines()
            .filter(|l| l.starts_with("p99: "))
            .count(),
        1,
        "{}",
        out.stderr
    );
    assert!(
        out.stdout.contains("  !!  The token lacks:"),
        "{}",
        out.stdout
    );
    assert!(
        writes_in(&cf_calls(&h)).is_empty(),
        "{name}: {:?}",
        writes_in(&cf_calls(&h))
    );
    let state = cf.lock().unwrap();
    assert!(!state.worker && state.databases.is_empty() && state.buckets.is_empty());
    assert!(state.routes.is_empty());
    drop(state);
    assert!(no_space_in(&h), "{}", h.config());
    never_shows(&[&out], &[]);
}

#[test]
fn us_setup_001_a_token_without_the_zone_permissions_is_refused_and_nothing_is_made() {
    lacks(
        "us-setup-lacks-routes",
        Cloud {
            denied: vec!["/workers/routes"],
            ..fresh()
        },
        &["shop.example.com"],
        "the token lacks Zone › Workers Routes: Edit on example.com (for shop.example.com)",
    );
    lacks(
        "us-setup-lacks-zone",
        Cloud {
            zoneless: true,
            ..fresh()
        },
        &["shop.example.com"],
        "the token lacks Zone › Zone: Read on the zone of shop.example.com",
    );
}

#[test]
fn us_setup_001_a_route_another_worker_holds_is_named_and_that_host_is_left_out() {
    let cloud = Cloud {
        routes: vec![("shop.example.com/_p99/*".into(), "shop-www".into())],
        ..fresh()
    };
    let (h, cf) = blank("us-setup-taken-route", cloud);
    let out = setup(
        &h,
        &[
            "--json",
            "--host",
            "shop.example.com",
            "--host",
            "blog.example.com",
            "--no-mail",
        ],
    );
    assert_eq!(out.code, Some(0), "{}", out.stderr);
    let report = out.json();
    assert_eq!(report["ok"], false);
    assert_eq!(report["failed"], json!(["shop.example.com"]));
    assert!(
        out.stderr.contains("  !!  the route shop.example.com/_p99/* already runs the Worker shop-www; P99 leaves it alone (remove it in the dashboard to give it to p99)"),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.contains(
            "Not added: shop.example.com. Fix what's named above and run p99 setup again."
        ),
        "{}",
        out.stderr
    );
    let config = h.toml();
    assert!(config["hosts"].get("shop.example.com").is_none());
    assert_eq!(
        config["hosts"]["blog.example.com"]["space"].as_str(),
        Some("main")
    );
    let state = cf.lock().unwrap();
    assert!(state.worker);
    assert!(
        state
            .routes
            .contains(&("shop.example.com/_p99/*".to_owned(), "shop-www".to_owned()))
    );
    assert!(
        state
            .routes
            .contains(&("blog.example.com/_p99/*".to_owned(), "p99".to_owned()))
    );
    drop(state);
    assert!(
        !sqls(&h)
            .iter()
            .any(|(s, p)| s.starts_with("INSERT INTO hosts") && p[0] == "shop.example.com")
    );
}

#[test]
fn us_setup_001_setup_for_someone_else_makes_their_email_the_first_owner_beside_adas_own_space() {
    let (h, cf) = configured("us-setup-someone-else", fresh());
    let before = h.toml();
    let out = h.run(
        &[
            "setup",
            "--space",
            "work",
            "--no-vault",
            "--no-mail",
            "--host",
            "client.example.com",
        ],
        &[("P99_TOKEN", TOKEN)],
        Some("n\nGrace Hopper\ngrace@example.com\n\n"),
    );
    out.ok();
    for asked in [
        "Act as Ada Lovelace <ada@example.com> in this space? [Y/n]: ",
        "Your name in this space, as P99 shows it [Ada Lovelace]: ",
        "Your e-mail in this space (it becomes its first Owner): ",
    ] {
        assert!(out.stdout.contains(asked), "{asked}:\n{}", out.stdout);
    }
    assert!(
        out.stdout
            .contains("adding the space work; other spaces stay as they are"),
        "{}",
        out.stdout
    );
    assert_eq!(
        cf.lock().unwrap().secret("MANAGERS").as_deref(),
        Some("grace@example.com")
    );

    let after = h.toml();
    let mut main = before["spaces"]["main"].as_table().unwrap().clone();
    for key in ["worker", "database", "bucket"] {
        main.entry(key).or_insert_with(|| "p99".into());
    }
    assert_eq!(after["spaces"]["main"].as_table().unwrap(), &main);
    assert_eq!(after["me"], before["me"]);
    assert_eq!(after["default_space"], before["default_space"]);
    for host in ["shop.example.com", "dev.example.com"] {
        let mut kept = before["hosts"][host].as_table().unwrap().clone();
        kept.entry("env").or_insert_with(|| "production".into());
        assert_eq!(after["hosts"][host].as_table().unwrap(), &kept, "{host}");
    }
    let work = &after["spaces"]["work"];
    assert_eq!(work["me"]["email"].as_str(), Some("grace@example.com"));
    assert_eq!(work["me"]["name"].as_str(), Some("Grace Hopper"));
    assert_eq!(work["account_id"].as_str(), Some("acc1"));
    assert_eq!(
        after["hosts"]["client.example.com"]["space"].as_str(),
        Some("work")
    );
    never_shows(&[&out], &[]);
}

#[cfg(unix)]
fn kept(h: &Home, name: &str, text: &str, mode: u32) -> String {
    use std::os::unix::fs::PermissionsExt;
    let file = h.dir.join(name);
    std::fs::write(&file, text).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
    file.display().to_string()
}

#[cfg(unix)]
const OWN_KEY: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
#[cfg(unix)]
const MAIL_KEY: &str = "re_us_story_Wq8Tz2Lm4Xv9";
#[cfg(unix)]
const SENDER: &str = "P99 <p99@example.com>";

#[cfg(unix)]
fn secret_of(cf: &Shared, name: &str) -> Option<String> {
    cf.lock().unwrap().secret(name)
}

#[cfg(unix)]
#[test]
fn us_setup_002_each_secret_comes_from_a_file_a_variable_or_a_command_and_the_config_keeps_only_where()
 {
    let (h, cf) = blank("us-setup-sources", fresh());
    let script = kept(
        &h,
        "print-token.sh",
        &format!("printf '%s\\n' {TOKEN}\n"),
        0o600,
    );
    let key_file = kept(&h, "key", &format!("{OWN_KEY}\n"), 0o600);
    let token = format!("command:sh {script}");
    let key = format!("file:{key_file}");
    let envs = [("P99_STORY_MAIL_KEY", MAIL_KEY)];
    let mut args = vec!["setup", "--yes"];
    args.extend(ME);
    args.extend([
        "--token",
        &token,
        "--key-from",
        &key,
        "--resend-key",
        "env:P99_STORY_MAIL_KEY",
        "--mail-from",
        SENDER,
        "--host",
        "shop.example.com",
    ]);
    let first = h.p99_env(&args, &envs);
    first.ok();

    let config = h.toml();
    let main = &config["spaces"]["main"];
    let words: Vec<&str> = main["token"]["command"]
        .as_array()
        .expect("the config keeps the token's command")
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert_eq!(words, ["sh", script.as_str()]);
    assert_eq!(main["key"]["file"].as_str(), Some(key_file.as_str()));
    assert_eq!(
        main["resend_key"]["env"].as_str(),
        Some("P99_STORY_MAIL_KEY")
    );
    let text = h.config();
    for secret in [TOKEN, OWN_KEY, MAIL_KEY] {
        assert!(
            !text.contains(secret),
            "a secret reached the config:\n{text}"
        );
    }
    assert_eq!(secret_of(&cf, "KEY_P99").as_deref(), Some(OWN_KEY));
    assert_eq!(secret_of(&cf, "RESEND_API_KEY").as_deref(), Some(MAIL_KEY));
    every_cloudflare_call_carried_the_token(&h);
    assert_eq!(
        h.stub
            .call("GET", "/resend/domains")
            .header("authorization"),
        Some(format!("Bearer {MAIL_KEY}").as_str())
    );

    let again = h.p99_env(
        &[
            "setup",
            "--yes",
            "--space",
            "main",
            "--host",
            "shop.example.com",
        ],
        &envs,
    );
    again.ok();
    assert_eq!(h.config(), text, "the second run rewrote the config");
    assert_eq!(secret_of(&cf, "KEY_P99").as_deref(), Some(OWN_KEY));
    every_cloudflare_call_carried_the_token(&h);
    never_shows(&[&first, &again], &[OWN_KEY, MAIL_KEY]);
}

#[cfg(unix)]
#[test]
fn us_setup_002_a_secret_source_that_cannot_be_read_is_named_and_nothing_is_made() {
    let run = |h: &Home, extra: &[&str], envs: &[(&str, &str)]| -> Out {
        let mut args = vec!["setup", "--yes", "--no-mail"];
        args.extend(ME);
        args.extend(extra);
        h.p99_env(&args, envs)
    };

    let (h, _cf) = blank("us-setup-source-open", fresh());
    let path = kept(&h, "token", TOKEN, 0o644);
    let spec = format!("file:{path}");
    let out = run(&h, &["--token", &spec], &[]);
    out.refused(&format!(
        "{path}: other users can read this file; make it yours alone (chmod 600)"
    ));
    assert!(h.stub.seen().is_empty());
    never_shows(&[&out], &[]);

    let (h, _cf) = blank("us-setup-source-unset", fresh());
    let out = run(&h, &["--token", "env:P99_STORY_UNSET"], &[]);
    out.refused("P99_STORY_UNSET: the variable is not set");
    assert!(h.stub.seen().is_empty());

    let (h, _cf) = blank("us-setup-source-failed", fresh());
    let script = kept(
        &h,
        "token.sh",
        "echo 'the vault is locked' >&2; exit 3",
        0o600,
    );
    let spec = format!("command:sh {script}");
    let out = run(&h, &["--token", &spec], &[]);
    out.refused("sh: the vault is locked");
    assert!(h.stub.seen().is_empty());

    let (h, cf) = blank("us-setup-source-key-open", fresh());
    let path = kept(&h, "key", OWN_KEY, 0o644);
    let spec = format!("file:{path}");
    let out = run(&h, &["--key-from", &spec], &[("P99_TOKEN", TOKEN)]);
    out.refused(&format!(
        "{path}: other users can read this file; make it yours alone (chmod 600)"
    ));
    assert!(secret_of(&cf, "KEY_P99").is_none());
    assert!(!h.stub.writes().iter().any(|r| r.is("PUT", UPLOAD)));
    never_shows(&[&out], &[OWN_KEY]);
}

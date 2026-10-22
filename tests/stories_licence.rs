use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{Value, json};

#[allow(dead_code)]
mod cli {
    pub struct Global {
        pub json: bool,
    }
}

#[allow(dead_code)]
mod config {
    #[derive(Default)]
    pub struct Config {
        pub license: Option<String>,
    }

    impl Config {
        pub fn load() -> Result<Config, String> {
            Ok(Config::default())
        }

        pub fn save(&self) -> Result<(), String> {
            Ok(())
        }
    }
}

mod wire {
    macro_rules! out {
        ($($arg:tt)*) => {
            println!($($arg)*)
        };
    }
    pub(crate) use out;
}

#[allow(dead_code)]
#[path = "../src/license.rs"]
mod license;

use license::{Refusal, State};

const SEED: [u8; 32] = [42; 32];
const STRANGER: [u8; 32] = [43; 32];
const FOREVER: &str = "9999-12-31";
const SHOWN: &str = "p99: Only an Agency or Owner key hides the 'by PITO.MD' link";
const NOT_A_KEY: &str = "p99: that is not a PITO MD licence key";
const FORGED: &str = "p99: that key's signature does not verify against the PITO MD licence key";
const ACCOUNT_ID: &str = "0123456789abcdef0123456789abcdef";

struct Issuer {
    pair: Ed25519KeyPair,
    public: String,
}

impl Issuer {
    fn new(seed: &[u8; 32]) -> Issuer {
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        let public = STANDARD.encode(pair.public_key().as_ref());
        Issuer { pair, public }
    }

    fn sign(&self, payload: &str) -> String {
        let signed = format!("PITO1.{}", URL_SAFE_NO_PAD.encode(payload.as_bytes()));
        let signature = self.pair.sign(signed.as_bytes());
        format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.as_ref()))
    }

    fn key(&self, sale: &Sale) -> String {
        self.sign(&sale.payload())
    }

    fn read(&self, key: &str) -> Result<license::Claims, Refusal> {
        license::verify(&self.public, key)
    }
}

#[derive(Clone)]
struct Sale {
    id: String,
    app: &'static str,
    tier: &'static str,
    kind: Option<&'static str>,
    group: Option<&'static str>,
    paid_through: &'static str,
    grace_days: u32,
}

impl Sale {
    fn customer(tier: &'static str, paid_through: &'static str) -> Sale {
        Sale {
            id: "k1".to_owned(),
            app: "p99",
            tier,
            kind: Some("timed"),
            group: Some("customer"),
            paid_through,
            grace_days: 14,
        }
    }

    fn grouped(group: &'static str) -> Sale {
        Sale {
            group: Some(group),
            ..Sale::customer("agency", FOREVER)
        }
    }

    fn payload(&self) -> String {
        let mut claims = json!({
            "v": 2,
            "id": self.id,
            "email": "ada@example.com",
            "app": self.app,
            "tier": self.tier,
            "major": 1,
            "device_cap": 1,
            "issued": "2026-01-01",
            "studio": "Ada Lovelace Studio",
            "paid_through": self.paid_through,
            "grace_days": self.grace_days,
        });
        if let Some(kind) = self.kind {
            claims["type"] = json!(kind);
        }
        if let Some(group) = self.group {
            claims["group"] = json!(group);
        }
        claims.to_string()
    }
}

fn state_of(issuer: &Issuer, key: &str, built: &str) -> State {
    issuer
        .read(key)
        .map_or(State::Free, |claims| claims.state(Some(built)))
}

fn armour(token: &str, width: usize, newline: &str) -> String {
    let mut text = format!("----- BEGIN PITO MD LICENSE -----{newline}");
    for chunk in token.as_bytes().chunks(width) {
        text.push_str("    ");
        text.push_str(std::str::from_utf8(chunk).unwrap());
        text.push_str(newline);
    }
    text.push_str(&format!("------ END PITO MD LICENSE ------{newline}"));
    text
}

fn swap_payload(key: &str, payload: &str) -> String {
    let (_, signature) = key.rsplit_once('.').unwrap();
    format!(
        "PITO1.{}.{signature}",
        URL_SAFE_NO_PAD.encode(payload.as_bytes())
    )
}

#[test]
fn story_a_studio_customer_pastes_the_mailed_key_and_must_see_studio_with_the_link_kept() {
    let issuer = Issuer::new(&SEED);
    let token = issuer.key(&Sale::customer("studio", "2027-03-31"));
    for pasted in [
        token.clone(),
        format!("  {token}\n"),
        armour(&token, 64, "\n"),
        armour(&token, 40, "\r\n"),
        armour(&token, 76, "\r\n").replace("    ", "\t"),
    ] {
        let claims = issuer.read(&pasted).unwrap();
        assert_eq!(claims.tier(), "studio");
        assert_eq!(claims.studio.as_deref(), Some("Ada Lovelace Studio"));
        let state = claims.state(Some("2026-10-21"));
        assert_eq!(state, State::Studio);
        assert_eq!(state.label(), "Studio");
        assert!(!state.may_hide_link());
        assert_eq!(state.link_binding(), "shown");
    }
    let truncated = &token[..token.len() - 1];
    assert_eq!(issuer.read(truncated).unwrap_err(), Refusal::Signature);
    let mismatched = armour(&token, 64, "\n").replace("END PITO MD LICENSE", "END PITO MD KEY");
    assert_eq!(issuer.read(&mismatched).unwrap_err(), Refusal::Shape);
    assert_eq!(
        issuer.read(&format!("{token}.extra")).unwrap_err(),
        Refusal::Shape
    );
    assert_eq!(issuer.read("").unwrap_err(), Refusal::Shape);
    assert_eq!(
        issuer.read(&"A".repeat(16 * 1024 + 1)).unwrap_err(),
        Refusal::Shape
    );
}

#[test]
#[ignore = "red until fixed: a key with a UTF-8 BOM before its armour is refused as not a key"]
fn story_a_key_copied_from_a_windows_file_or_an_html_mail_must_still_verify() {
    let issuer = Issuer::new(&SEED);
    let token = issuer.key(&Sale::customer("studio", "2027-03-31"));
    let bom = format!("\u{feff}{}", armour(&token, 64, "\r\n"));
    assert_eq!(
        issuer.read(&bom).map(|c| c.state(Some("2026-10-21"))),
        Ok(State::Studio),
        "a UTF-8 BOM before the armour"
    );
    let (head, tail) = token.split_at(token.len() / 2);
    let zero_width = format!("{head}\u{200b}{tail}");
    assert_eq!(
        issuer
            .read(&zero_width)
            .map(|c| c.state(Some("2026-10-21"))),
        Ok(State::Studio),
        "a zero-width space a mail client put in the long line"
    );
    let nbsp = format!("{head}\u{a0}{tail}");
    assert_eq!(
        issuer.read(&nbsp).map(|c| c.state(Some("2026-10-21"))),
        Ok(State::Studio)
    );
}

#[test]
#[ignore = "red until fixed: a key wrapped so one line holds only a hyphen fails its signature"]
fn story_a_key_wrapped_so_a_line_holds_only_a_hyphen_must_still_verify() {
    let issuer = Issuer::new(&SEED);
    let (token, at) = (1..10_000)
        .find_map(|n| {
            let sale = Sale {
                id: format!("k{n}"),
                ..Sale::customer("agency", "2027-03-31")
            };
            let token = issuer.key(&sale);
            let at = token.find('-')?;
            Some((token, at))
        })
        .unwrap();
    let wrapped = format!(
        "----- BEGIN PITO MD LICENSE -----\n{}\n-\n{}\n------ END PITO MD LICENSE ------\n",
        &token[..at],
        &token[at + 1..]
    );
    assert_eq!(
        issuer.read(&wrapped).map(|c| c.state(Some("2026-10-21"))),
        Ok(State::Agency)
    );
}

#[test]
fn story_an_agency_customer_hides_the_link_and_loses_it_on_a_build_past_their_cover() {
    let issuer = Issuer::new(&SEED);
    for group in [Some("customer"), Some("education"), Some("nonprofit"), None] {
        let key = issuer.key(&Sale {
            group,
            ..Sale::customer("agency", "2027-03-31")
        });
        let paid = state_of(&issuer, &key, "2026-10-21");
        assert_eq!(paid, State::Agency);
        assert!(paid.may_hide_link());
        assert_eq!(paid.link_binding(), "hideable");
        let past = state_of(&issuer, &key, "2027-04-15");
        assert_eq!(past, State::Free);
        assert!(!past.may_hide_link());
        assert_eq!(past.link_binding(), "shown");
    }
}

#[test]
fn story_a_lapsed_subscription_must_keep_every_build_it_paid_for_and_no_later_one() {
    let issuer = Issuer::new(&SEED);
    let key = issuer.key(&Sale {
        grace_days: 0,
        ..Sale::customer("studio", "2020-01-31")
    });
    for built in ["2019-06-01", "2020-01-15", "2020-01-31"] {
        assert_eq!(state_of(&issuer, &key, built), State::Studio, "{built}");
    }
    for built in ["2020-02-01", "2026-10-21", FOREVER] {
        assert_eq!(state_of(&issuer, &key, built), State::Free, "{built}");
    }
    let graced = issuer.key(&Sale::customer("agency", "2027-03-31"));
    assert_eq!(state_of(&issuer, &graced, "2027-04-14"), State::Agency);
    assert_eq!(state_of(&issuer, &graced, "2027-04-15"), State::Free);
    let leap = issuer.key(&Sale {
        grace_days: 0,
        ..Sale::customer("agency", "2028-02-29")
    });
    assert_eq!(state_of(&issuer, &leap, "2028-02-29"), State::Agency);
    assert_eq!(state_of(&issuer, &leap, "2028-03-01"), State::Free);
    let year_end = issuer.key(&Sale {
        grace_days: 1,
        ..Sale::customer("studio", "2026-12-31")
    });
    assert_eq!(state_of(&issuer, &year_end, "2027-01-01"), State::Studio);
    assert_eq!(state_of(&issuer, &year_end, "2027-01-02"), State::Free);
    let claims = issuer.read(&key).unwrap();
    assert_eq!(claims.state(None), State::Free);
    for undated in [
        "",
        "2026-10",
        "2026-13-01",
        "2026-02-30",
        "20261021",
        "2026-1-01",
    ] {
        assert_eq!(claims.state(Some(undated)), State::Free, "{undated:?}");
    }
}

#[test]
fn story_the_owner_must_keep_agency_and_the_hidden_link_on_every_build_through_9999() {
    let issuer = Issuer::new(&SEED);
    for tier in ["agency", "studio"] {
        let key = issuer.key(&Sale {
            tier,
            ..Sale::grouped("owner")
        });
        let claims = issuer.read(&key).unwrap();
        assert_eq!(claims.tier(), "agency");
        for built in ["2026-10-21", "2099-01-01", FOREVER] {
            let state = claims.state(Some(built));
            assert_eq!(state, State::Owner, "{tier} {built}");
            assert_eq!(state.label(), "Owner");
            assert!(state.may_hide_link());
            assert_eq!(state.link_binding(), "hideable");
        }
    }
}

#[test]
fn story_friends_and_family_read_as_agency_through_9999_but_must_never_hide_the_link() {
    let issuer = Issuer::new(&SEED);
    for tier in ["agency", "studio"] {
        let key = issuer.key(&Sale {
            tier,
            ..Sale::grouped("friends-family")
        });
        let claims = issuer.read(&key).unwrap();
        assert_eq!(claims.tier(), "agency");
        for built in ["2026-10-21", "2099-01-01", FOREVER] {
            let state = claims.state(Some(built));
            assert_eq!(state, State::Ff, "{tier} {built}");
            assert_eq!(state.label(), "F&F");
            assert!(!state.may_hide_link());
            assert_eq!(state.link_binding(), "shown");
        }
    }
    for near in [
        "Owner",
        "OWNER",
        "owner ",
        "friends_family",
        "family",
        "staff",
    ] {
        let key = issuer.key(&Sale {
            group: Some(near),
            ..Sale::customer("studio", "2027-03-31")
        });
        assert_eq!(
            state_of(&issuer, &key, "2026-10-21"),
            State::Studio,
            "{near}"
        );
    }
}

#[test]
fn story_a_tampered_forged_or_foreign_key_must_read_as_free_and_never_hide_the_link() {
    let issuer = Issuer::new(&SEED);
    let bought = Sale::customer("studio", "2026-12-31");
    let key = issuer.key(&bought);
    let forgeries = [
        Sale {
            tier: "agency",
            ..bought.clone()
        },
        Sale {
            paid_through: FOREVER,
            ..bought.clone()
        },
        Sale {
            grace_days: 100_000,
            ..bought.clone()
        },
        Sale::grouped("owner"),
        Sale::grouped("friends-family"),
    ];
    for forged in forgeries {
        let token = swap_payload(&key, &forged.payload());
        assert_eq!(issuer.read(&token).unwrap_err(), Refusal::Signature);
        assert_eq!(state_of(&issuer, &token, "2026-10-21"), State::Free);
    }
    let stranger = Issuer::new(&STRANGER);
    let foreign = stranger.key(&Sale::grouped("owner"));
    assert_eq!(issuer.read(&foreign).unwrap_err(), Refusal::Signature);
    assert_eq!(
        license::verify(license::PUBLIC_KEY, &foreign).unwrap_err(),
        Refusal::Signature
    );
    assert_eq!(State::of(Some(&foreign)), State::Free);
    assert_eq!(State::of(Some(&key)), State::Free);
    let (head, signature) = key.rsplit_once('.').unwrap();
    let mut flipped = URL_SAFE_NO_PAD.decode(signature).unwrap();
    flipped[0] ^= 1;
    let bitflip = format!("{head}.{}", URL_SAFE_NO_PAD.encode(&flipped));
    assert_eq!(issuer.read(&bitflip).unwrap_err(), Refusal::Signature);
    assert_eq!(
        issuer.read(&format!("{head}.")).unwrap_err(),
        Refusal::Signature
    );
    assert_eq!(
        issuer.read(&format!("PITO2.{}", &key[6..])).unwrap_err(),
        Refusal::Shape
    );
}

#[test]
fn story_a_signed_key_for_another_app_kind_tier_or_format_must_be_refused() {
    let issuer = Issuer::new(&SEED);
    let refused = |sale: Sale| issuer.read(&issuer.key(&sale)).unwrap_err();
    let base = Sale::customer("agency", "2027-03-31");
    assert_eq!(
        refused(Sale {
            app: "pfx",
            ..base.clone()
        }),
        Refusal::App
    );
    assert_eq!(
        refused(Sale {
            app: "P99",
            ..base.clone()
        }),
        Refusal::App
    );
    for kind in [None, Some("lifetime"), Some("trial"), Some("Timed")] {
        assert_eq!(
            refused(Sale {
                kind,
                ..base.clone()
            }),
            Refusal::Kind,
            "{kind:?}"
        );
    }
    for paid_through in ["", "2027-02-30", "31-03-2027", "forever"] {
        assert_eq!(
            refused(Sale {
                paid_through,
                ..base.clone()
            }),
            Refusal::Kind,
            "{paid_through}"
        );
    }
    for tier in ["pro", "indie", "Agency", "owner", "free"] {
        assert_eq!(
            refused(Sale {
                tier,
                ..base.clone()
            }),
            Refusal::Tier,
            "{tier}"
        );
    }
    let v3 = base.payload().replace(r#""v":2"#, r#""v":3"#);
    assert_eq!(
        issuer.read(&issuer.sign(&v3)).unwrap_err(),
        Refusal::Version
    );
    assert_eq!(
        issuer.read(&issuer.sign("not json")).unwrap_err(),
        Refusal::Payload
    );
    let negative = base
        .payload()
        .replace(r#""grace_days":14"#, r#""grace_days":-1"#);
    assert_eq!(
        issuer.read(&issuer.sign(&negative)).unwrap_err(),
        Refusal::Payload
    );
}

#[test]
fn story_the_bindings_deploy_writes_must_be_the_words_the_worker_reads() {
    let words: Vec<&str> = State::ALL.iter().map(|s| s.word()).collect();
    assert_eq!(words, ["free", "studio", "agency", "owner", "ff"]);
    let hiders: Vec<&str> = State::ALL
        .iter()
        .filter(|s| s.may_hide_link())
        .map(|s| s.word())
        .collect();
    assert_eq!(hiders, ["agency", "owner"]);
    assert_eq!(license::HIDES_LINK, ["agency", "owner"]);
    for state in State::ALL {
        assert_eq!(State::parse(state.word()), Some(state));
        let expected = if state.may_hide_link() {
            "hideable"
        } else {
            "shown"
        };
        assert_eq!(state.link_binding(), expected, "{}", state.word());
    }
    for word in ["", "Free", "OWNER", " owner", "trial", "f&f"] {
        assert_eq!(State::parse(word), None, "{word:?}");
    }
    let worker = std::fs::read_to_string(repo().join("worker/src/license.js")).unwrap();
    let quoted: Vec<String> = words.iter().map(|w| format!("\"{w}\"")).collect();
    assert!(
        worker.contains(&format!("const STATES = [{}];", quoted.join(", "))),
        "worker/src/license.js reads other licence words than deploy writes"
    );
    assert!(worker.contains(r#"LICENSE_LINK === "hideable""#));
    assert!(worker.contains("config.link === false"));
}

#[test]
fn story_the_offline_check_must_never_grow_a_network_call() {
    let source = std::fs::read_to_string(repo().join("src/license.rs")).unwrap();
    for net in [
        "ureq",
        "std::net",
        "TcpStream",
        "UdpSocket",
        "Cloudflare",
        "crate::client",
        "http://",
        "https://",
        "rustls",
    ] {
        assert!(!source.contains(net), "src/license.rs mentions {net}");
    }
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

struct Home {
    dir: PathBuf,
}

impl Home {
    fn new(story: &str) -> Home {
        let dir = std::env::temp_dir().join(format!(
            "p99-stories-licence-{}-{story}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Home { dir }
    }

    fn config(&self) -> PathBuf {
        self.dir.join("config.toml")
    }

    fn write(&self, text: &str) {
        std::fs::write(self.config(), text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(self.config(), std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }
    }

    fn read(&self) -> Option<String> {
        std::fs::read_to_string(self.config()).ok()
    }

    fn p99(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_p99"));
        command
            .args(args)
            .env("P99_CONFIG", self.config())
            .env("HOME", &self.dir)
            .env("XDG_CONFIG_HOME", &self.dir)
            .env("NO_COLOR", "1")
            .env_remove("P99_TOKEN")
            .env_remove("P99_AGENT")
            .env_remove("P99_LICENSE_STATE")
            .env_remove("COLORTERM")
            .stdin(Stdio::null());
        command
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

struct Trap {
    listener: TcpListener,
    url: String,
}

impl Trap {
    fn new() -> Trap {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        Trap { listener, url }
    }

    fn arm<'a>(&self, command: &'a mut Command) -> &'a mut Command {
        for name in [
            "P99_CLOUDFLARE_API",
            "P99_GITHUB_API",
            "P99_RESEND_API",
            "P99_HOST_URL",
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            command.env(name, &self.url);
        }
        command
            .env_remove("NO_PROXY")
            .env_remove("no_proxy")
            .env("P99_BROWSER", "p99-stories-no-browser")
    }

    fn knocks(&self) -> usize {
        let probe = TcpStream::connect(self.listener.local_addr().unwrap()).unwrap();
        let sentinel = probe.local_addr().unwrap();
        let mut count = 0;
        loop {
            match self.listener.accept() {
                Ok((_, peer)) if peer == sentinel => return count,
                Ok(_) => count += 1,
                Err(error) => panic!("trap: {error}"),
            }
        }
    }
}

fn run(command: &mut Command, stdin: Option<&str>) -> Output {
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().unwrap();
    if let Some(text) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
    let out = drain(child.stdout.take().unwrap());
    let err = drain(child.stderr.take().unwrap());
    let deadline = Instant::now() + Duration::from_secs(90);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("p99 did not finish in 90 s");
        }
        thread::sleep(Duration::from_millis(10));
    };
    Output {
        status,
        stdout: out.join().unwrap(),
        stderr: err.join().unwrap(),
    }
}

fn drain(mut from: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = from.read_to_end(&mut bytes);
        bytes
    })
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn refused(out: &Output, line: &str) {
    assert_eq!(out.status.code(), Some(1), "{}", text(&out.stderr));
    assert_eq!(text(&out.stderr), format!("{line}\n"));
    assert!(out.stdout.is_empty(), "{}", text(&out.stdout));
}

fn forged_owner() -> String {
    Issuer::new(&STRANGER).key(&Sale::grouped("owner"))
}

fn with_key(key: &str, url: &str) -> String {
    format!(
        "license = \"{key}\"\n\n[accounts.acme]\naccount_id = \"{ACCOUNT_ID}\"\ntoken = \"\"\ndatabase_id = \"d1-acme\"\nurl = \"{url}/_p99\"\n\n[hosts.\"example.com\"]\naccount = \"acme\"\ncorner = \"bottom-right\"\n"
    )
}

#[test]
fn story_checking_a_key_offline_must_open_no_socket_whatever_the_key() {
    let home = Home::new("offline");
    let trap = Trap::new();
    let token = forged_owner();
    let steps: Vec<(Vec<&str>, Option<String>)> = vec![
        (vec!["license", "show"], None),
        (vec!["license", "show", "--json"], None),
        (vec!["license", "set", &token], None),
        (
            vec!["license", "set", "-"],
            Some(armour(&token, 64, "\r\n")),
        ),
        (
            vec!["license", "set", "-"],
            Some("PITO1.abc.def\n".to_owned()),
        ),
        (vec!["license", "set", "not a key"], None),
        (vec!["license", "remove"], None),
        (vec!["license", "remove", "--json"], None),
    ];
    for (args, stdin) in &steps {
        let out = run(trap.arm(&mut home.p99(args)), stdin.as_deref());
        assert!(out.status.code().is_some(), "{args:?} was killed");
        assert_eq!(trap.knocks(), 0, "{args:?} opened a connection");
    }
    home.write(&with_key(&token, &trap.url));
    for args in [["license", "show"], ["license", "remove"]] {
        let out = run(trap.arm(&mut home.p99(&args)), None);
        assert!(out.status.code().is_some());
        assert_eq!(
            trap.knocks(),
            0,
            "{args:?} with a stored key opened a connection"
        );
    }
}

#[test]
fn story_a_bad_key_must_be_refused_in_one_line_and_never_stored() {
    let home = Home::new("refused");
    let trap = Trap::new();
    let genuine_shape = Issuer::new(&SEED).key(&Sale::customer("agency", FOREVER));
    let cases: Vec<(String, Option<String>, &str)> = vec![
        ("not a key".to_owned(), None, NOT_A_KEY),
        ("PITO1.abc".to_owned(), None, NOT_A_KEY),
        (forged_owner(), None, FORGED),
        (genuine_shape.clone(), None, FORGED),
        (
            "-".to_owned(),
            Some(armour(&forged_owner(), 64, "\n")),
            FORGED,
        ),
        ("-".to_owned(), Some(String::new()), NOT_A_KEY),
        ("-".to_owned(), Some("A".repeat(20 * 1024)), NOT_A_KEY),
    ];
    for (key, stdin, line) in &cases {
        let out = run(
            trap.arm(&mut home.p99(&["license", "set", key])),
            stdin.as_deref(),
        );
        refused(&out, line);
        assert_eq!(home.read(), None, "a refused key wrote the config");
    }
    let before = with_key("", &trap.url).replace("license = \"\"\n\n", "");
    home.write(&before);
    let out = run(
        trap.arm(&mut home.p99(&["license", "set", &forged_owner()])),
        None,
    );
    refused(&out, FORGED);
    assert_eq!(home.read().as_deref(), Some(before.as_str()));
    assert_eq!(trap.knocks(), 0);
}

#[test]
fn story_a_free_installation_must_say_free_and_that_the_link_stays() {
    let home = Home::new("free");
    let trap = Trap::new();
    let out = run(
        trap.arm(&mut home.p99(&["license", "show", "--json"])),
        None,
    );
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    let shown: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        shown,
        json!({"state": "free", "may_hide_link": false, "license": null})
    );
    let out = run(trap.arm(&mut home.p99(&["license", "show"])), None);
    assert_eq!(out.status.code(), Some(0));
    let said = text(&out.stdout);
    assert!(said.contains("state         Free"), "{said}");
    assert!(
        said.contains("always shown; only an Agency or Owner key hides it"),
        "{said}"
    );
    let out = run(
        trap.arm(&mut home.p99(&["license", "remove", "--json"])),
        None,
    );
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        serde_json::from_slice::<Value>(&out.stdout).unwrap(),
        json!({"removed": false})
    );
    assert_eq!(home.read(), None);
    assert_eq!(trap.knocks(), 0);
}

#[test]
fn story_a_key_tampered_inside_the_config_must_unlock_nothing_and_still_be_removable() {
    let home = Home::new("planted");
    let trap = Trap::new();
    let planted = with_key(&forged_owner(), &trap.url);
    home.write(&planted);
    let out = run(trap.arm(&mut home.p99(&["license", "show"])), None);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).starts_with("p99: the stored licence key is refused: "),
        "{}",
        text(&out.stderr)
    );
    let out = run(
        trap.arm(&mut home.p99(&["license", "show", "--json"])),
        None,
    );
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    let out = run(
        trap.arm(&mut home.p99(&[
            "hosts",
            "set",
            "example.com",
            "--corner",
            "top-left",
            "--pitomd-link",
            "off",
        ])),
        None,
    );
    refused(&out, SHOWN);
    assert_eq!(home.read().as_deref(), Some(planted.as_str()));
    assert_eq!(trap.knocks(), 0, "a refused link change reached the Worker");
    let out = run(trap.arm(&mut home.p99(&["license", "remove"])), None);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    assert!(text(&out.stdout).starts_with("removed the licence key\n"));
    let left = home.read().unwrap();
    assert!(!left.contains("license"), "{left}");
    assert!(left.contains("[hosts.\"example.com\"]"), "{left}");
    assert_eq!(trap.knocks(), 0);
}

#[test]
fn story_a_free_installation_must_not_turn_the_link_off_even_with_other_changes_in_the_call() {
    let home = Home::new("free-link");
    let trap = Trap::new();
    let before = with_key("", &trap.url).replace("license = \"\"\n\n", "");
    home.write(&before);
    for extra in [
        vec![],
        vec!["--corner", "top-left"],
        vec!["--offset", "16,16"],
    ] {
        let mut args = vec!["hosts", "set", "example.com"];
        args.extend(extra);
        args.extend(["--pitomd-link", "off"]);
        let out = run(trap.arm(&mut home.p99(&args)), None);
        refused(&out, SHOWN);
        assert_eq!(home.read().as_deref(), Some(before.as_str()), "{args:?}");
    }
    for word in ["OFF", "no", "false", "hidden"] {
        let out = run(
            trap.arm(&mut home.p99(&["hosts", "set", "example.com", "--pitomd-link", word])),
            None,
        );
        assert_eq!(out.status.code(), Some(2), "{word}");
        assert_eq!(home.read().as_deref(), Some(before.as_str()), "{word}");
    }
    assert_eq!(trap.knocks(), 0);
}

#[derive(Clone)]
struct Hit {
    method: String,
    path: String,
    body: Vec<u8>,
}

struct Cloudflare {
    url: String,
    hits: Arc<Mutex<Vec<Hit>>>,
}

impl Cloudflare {
    fn start(existing: Value) -> Cloudflare {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&hits);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let existing = existing.clone();
                let seen = Arc::clone(&seen);
                std::thread::spawn(move || serve(stream, &existing, &seen));
            }
        });
        Cloudflare { url, hits }
    }

    fn hits(&self) -> Vec<Hit> {
        self.hits.lock().unwrap().clone()
    }

    fn uploaded(&self) -> Vec<Value> {
        let upload = format!("/accounts/{ACCOUNT_ID}/workers/scripts/p99");
        let hits: Vec<Hit> = self
            .hits()
            .into_iter()
            .filter(|h| h.method == "PUT" && h.path == upload)
            .collect();
        assert_eq!(
            hits.len(),
            1,
            "the Worker was uploaded {} times",
            hits.len()
        );
        let body = text(&hits[0].body);
        let (_, after) = body.split_once("name=\"metadata\"").unwrap();
        let (_, json) = after.split_once("\r\n\r\n").unwrap();
        let (json, _) = json.split_once("\r\n--").unwrap();
        let metadata: Value = serde_json::from_str(json).unwrap();
        metadata["bindings"].as_array().unwrap().clone()
    }
}

fn serve(stream: TcpStream, existing: &Value, seen: &Mutex<Vec<Hit>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut head = String::new();
    if reader.read_line(&mut head).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = head.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let path = parts.next().unwrap_or_default().to_owned();
    let mut length = 0usize;
    let mut chunked = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().unwrap_or(0);
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("transfer-encoding")
        {
            chunked = value.trim().eq_ignore_ascii_case("chunked");
        }
    }
    let body = if chunked {
        unchunk(&mut reader)
    } else {
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        body
    };
    let route = path.split('?').next().unwrap_or_default().to_owned();
    seen.lock().unwrap().push(Hit {
        method: method.clone(),
        path: route.clone(),
        body,
    });
    let result = if route.ends_with("/settings") {
        json!({ "bindings": existing })
    } else if route.ends_with("/query") {
        json!([{ "success": true, "results": [] }])
    } else if route.ends_with("/secrets") && method == "GET" {
        json!([{ "name": "CODE_PEPPER" }, { "name": "MANAGERS" }])
    } else if route.ends_with("/workers/subdomain") {
        json!({ "subdomain": "" })
    } else {
        json!([])
    };
    let answer = json!({
        "success": true,
        "errors": [],
        "messages": [],
        "result": result,
        "result_info": { "page": 1, "total_pages": 1 },
    })
    .to_string();
    let mut stream = stream;
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
        answer.len()
    );
}

fn unchunk(reader: &mut impl BufRead) -> Vec<u8> {
    let mut body = Vec::new();
    loop {
        let mut size = String::new();
        reader.read_line(&mut size).unwrap();
        let size =
            usize::from_str_radix(size.trim().split(';').next().unwrap_or("0"), 16).unwrap_or(0);
        let mut chunk = vec![0; size + 2];
        reader.read_exact(&mut chunk).unwrap();
        if size == 0 {
            return body;
        }
        body.extend_from_slice(&chunk[..size]);
    }
}

fn deploy(home: &Home, cloudflare: &Cloudflare) -> Output {
    let mut command = home.p99(&["deploy", "--no-check"]);
    command
        .env("P99_CLOUDFLARE_API", &cloudflare.url)
        .env("P99_TOKEN", "test-token")
        .env("P99_BROWSER", "p99-stories-no-browser");
    for proxy in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        command.env_remove(proxy);
    }
    command
        .env("NO_PROXY", "127.0.0.1")
        .env("no_proxy", "127.0.0.1");
    run(&mut command, None)
}

fn binding<'a>(bindings: &'a [Value], name: &str) -> Vec<&'a str> {
    bindings
        .iter()
        .filter(|b| b["name"] == name)
        .map(|b| b["text"].as_str().unwrap_or_default())
        .collect()
}

fn deploy_config(key: Option<&str>) -> String {
    let license = key.map_or_else(String::new, |key| format!("license = \"{key}\"\n\n"));
    format!(
        "{license}[accounts.acme]\naccount_id = \"{ACCOUNT_ID}\"\ntoken = \"\"\ndatabase_id = \"d1-acme\"\n"
    )
}

fn worker_had(state: &str, link: &str) -> Value {
    json!([
        { "type": "ratelimit", "name": "RATE", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } },
        { "type": "plain_text", "name": "LICENSE_STATE", "text": state },
        { "type": "plain_text", "name": "LICENSE_LINK", "text": link },
        { "type": "secret_text", "name": "KEY_P99" },
    ])
}

#[test]
fn story_deploying_without_a_paid_key_must_bind_free_and_a_shown_link() {
    let keys = [None, Some(forged_owner()), Some("PITO1.abc".to_owned())];
    for (n, key) in keys.iter().enumerate() {
        let home = Home::new(&format!("deploy-{n}"));
        home.write(&deploy_config(key.as_deref()));
        let cloudflare = Cloudflare::start(worker_had("free", "shown"));
        let out = deploy(&home, &cloudflare);
        assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
        let bindings = cloudflare.uploaded();
        assert_eq!(binding(&bindings, "LICENSE_STATE"), ["free"], "{key:?}");
        assert_eq!(binding(&bindings, "LICENSE_LINK"), ["shown"], "{key:?}");
    }
}

#[test]
fn story_a_removed_or_lapsed_key_must_take_the_hidden_link_away_at_the_next_deploy() {
    for (n, (state, key)) in [("owner", None), ("agency", Some(forged_owner()))]
        .into_iter()
        .enumerate()
    {
        let home = Home::new(&format!("lapsed-{n}"));
        home.write(&deploy_config(key.as_deref()));
        let cloudflare = Cloudflare::start(worker_had(state, "hideable"));
        let out = deploy(&home, &cloudflare);
        assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
        let bindings = cloudflare.uploaded();
        assert_eq!(binding(&bindings, "LICENSE_STATE"), ["free"], "{state}");
        assert_eq!(binding(&bindings, "LICENSE_LINK"), ["shown"], "{state}");
        assert_eq!(binding(&bindings, "RATE").len(), 1);
        assert!(
            bindings.iter().all(|b| b["type"] != "secret_text"),
            "a secret binding was re-sent"
        );
    }
}

fn dump(home: &Home, demo: bool, state: Option<&str>) -> String {
    let mut args = vec!["tui", "--dump", "120x34"];
    if demo {
        args.insert(0, "--demo");
    }
    let trap = Trap::new();
    let mut command = home.p99(&args);
    trap.arm(&mut command);
    if let Some(state) = state {
        command.env("P99_LICENSE_STATE", state);
    }
    let out = run(&mut command, None);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    assert_eq!(trap.knocks(), 0, "the TUI dump opened a connection");
    text(&out.stdout)
}

const LABELS: [&str; 5] = ["Free", "Studio", "Agency", "Owner", "F&F"];

fn badge_of(screen: &str) -> Vec<&'static str> {
    LABELS
        .into_iter()
        .filter(|label| {
            screen.contains(&format!("▐{label}▌")) || screen.contains(&format!(" {label} "))
        })
        .collect()
}

#[test]
fn story_the_inbox_badge_must_name_each_licence_state() {
    let home = Home::new("badge");
    for state in State::ALL {
        let screen = dump(&home, true, Some(state.word()));
        assert_eq!(
            badge_of(&screen),
            [state.label()],
            "{}\n{screen}",
            state.word()
        );
    }
    for word in ["OWNER", " agency-", "trial", ""] {
        let screen = dump(&home, true, Some(word));
        assert_eq!(badge_of(&screen), ["Free"], "{word:?}\n{screen}");
    }
}

#[test]
fn story_the_demo_state_variable_must_never_lift_a_real_installation() {
    let home = Home::new("badge-live");
    for word in ["owner", "agency", "ff"] {
        let screen = dump(&home, false, Some(word));
        assert_eq!(badge_of(&screen), ["Free"], "{word}\n{screen}");
    }
    home.write(&format!("license = \"{}\"\n", forged_owner()));
    let screen = dump(&home, false, Some("owner"));
    assert_eq!(badge_of(&screen), ["Free"], "{screen}");
}

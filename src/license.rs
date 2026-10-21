use std::io::Read;

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cli::Global;
use crate::config::Config;

pub const PUBLIC_KEY: &str = "jeSuvgBw+ExXNw32a/dbweivyLRLNGyE67aSb8BBfdg=";
pub const BUILT: Option<&str> = option_env!("P99_BUILD_DATE");
const PREFIX: &str = "PITO1";
const MAX_LEN: usize = 16 * 1024;
const VERSION: u32 = 2;
const TIMED: &str = "timed";
const APP: &str = "p99";
const TIERS: [&str; 2] = ["studio", "agency"];
const TOP: &str = "agency";
pub const HIDES_LINK: &[&str] = &["agency", "owner"];

#[derive(Debug, clap::Args)]
pub struct Args {
    #[command(subcommand)]
    pub action: Action,
}

#[derive(Debug, clap::Subcommand)]
pub enum Action {
    #[command(
        about = "store a P99 Studio or Agency key for this installation, checked offline (- reads it from stdin)"
    )]
    Set {
        #[arg(help = "the key, or its armoured block; - reads it from stdin")]
        key: String,
    },
    #[command(
        about = "show the stored key's tier, holder, paid-through date and this build's cover"
    )]
    Show,
    #[command(about = "forget the stored key")]
    Remove,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    Shape,
    Signature,
    Payload,
    Version,
    App,
    Kind,
    Tier,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Refusal::Shape => "that is not a PITO MD licence key",
            Refusal::Signature => {
                "that key's signature does not verify against the PITO MD licence key"
            }
            Refusal::Payload => "that key's contents are not a licence this version reads",
            Refusal::Version => "that key's format is not one this version reads",
            Refusal::App => "that key is for another app, not P99",
            Refusal::Kind => "that key is not a timed P99 licence",
            Refusal::Tier => "that key's tier is not Studio or Agency",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Claims {
    pub v: u32,
    pub app: String,
    pub tier: String,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub studio: Option<String>,
    #[serde(default)]
    pub paid_through: Option<String>,
    #[serde(default)]
    pub grace_days: Option<u32>,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Owner,
    FriendsFamily,
    Customer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Free,
    Studio,
    Agency,
    Owner,
    Ff,
}

impl State {
    pub const ALL: [State; 5] = [
        State::Free,
        State::Studio,
        State::Agency,
        State::Owner,
        State::Ff,
    ];

    pub fn word(self) -> &'static str {
        match self {
            State::Free => "free",
            State::Studio => "studio",
            State::Agency => "agency",
            State::Owner => "owner",
            State::Ff => "ff",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            State::Free => "Free",
            State::Studio => "Studio",
            State::Agency => "Agency",
            State::Owner => "Owner",
            State::Ff => "F&F",
        }
    }

    pub fn parse(word: &str) -> Option<State> {
        State::ALL.into_iter().find(|state| state.word() == word)
    }

    pub fn may_hide_link(self) -> bool {
        HIDES_LINK.contains(&self.word())
    }

    pub fn link_binding(self) -> &'static str {
        if self.may_hide_link() {
            "hideable"
        } else {
            "shown"
        }
    }

    pub fn of(key: Option<&str>) -> State {
        key.and_then(|key| verify(PUBLIC_KEY, key).ok())
            .map_or(State::Free, |claims| claims.state(BUILT))
    }
}

#[derive(Deserialize)]
struct Version {
    v: u32,
}

impl Claims {
    pub fn is_timed(&self) -> bool {
        self.kind.as_deref() == Some(TIMED)
    }

    pub fn covers_build(&self, build_date: &str) -> bool {
        let (true, Some(through), Some(built)) = (
            self.is_timed(),
            self.paid_through.as_deref().and_then(civil_day),
            civil_day(build_date),
        ) else {
            return false;
        };
        built <= through + i64::from(self.grace_days.unwrap_or(0))
    }

    pub fn group(&self) -> Group {
        match self.group.as_deref() {
            Some("owner") => Group::Owner,
            Some("friends-family") => Group::FriendsFamily,
            _ => Group::Customer,
        }
    }

    pub fn tier(&self) -> &str {
        match self.group() {
            Group::Owner | Group::FriendsFamily => TOP,
            Group::Customer => &self.tier,
        }
    }

    pub fn state(&self, build_date: Option<&str>) -> State {
        if !covers(self, build_date) {
            return State::Free;
        }
        match (self.group(), self.tier()) {
            (Group::Owner, _) => State::Owner,
            (Group::FriendsFamily, _) => State::Ff,
            (Group::Customer, "studio") => State::Studio,
            (Group::Customer, "agency") => State::Agency,
            (Group::Customer, _) => State::Free,
        }
    }
}

pub fn verify(public_key: &str, key: &str) -> Result<Claims, Refusal> {
    let payload = signed(public_key, key)?;
    let version: Version = serde_json::from_slice(&payload).map_err(|_| Refusal::Payload)?;
    if version.v != VERSION {
        return Err(Refusal::Version);
    }
    let claims: Claims = serde_json::from_slice(&payload).map_err(|_| Refusal::Payload)?;
    if claims.app != APP {
        return Err(Refusal::App);
    }
    if !claims.is_timed() || claims.paid_through.as_deref().and_then(civil_day).is_none() {
        return Err(Refusal::Kind);
    }
    if !TIERS.contains(&claims.tier.as_str()) {
        return Err(Refusal::Tier);
    }
    Ok(claims)
}

pub fn covers(claims: &Claims, build_date: Option<&str>) -> bool {
    build_date.is_some_and(|date| claims.covers_build(date))
}

#[derive(Debug, Serialize)]
struct Shown<'a> {
    tier: &'a str,
    studio: Option<&'a str>,
    paid_through: Option<&'a str>,
    grace_days: u32,
    build_date: Option<&'a str>,
    covers_build: bool,
}

fn shown(claims: &Claims) -> Shown<'_> {
    Shown {
        tier: claims.tier(),
        studio: claims.studio.as_deref(),
        paid_through: claims.paid_through.as_deref(),
        grace_days: claims.grace_days.unwrap_or(0),
        build_date: BUILT,
        covers_build: covers(claims, BUILT),
    }
}

const FOLLOWS: &str = "the Worker's badge and link follow at the next p99 deploy";

pub fn run(args: &Args, global: &Global) -> Result<(), String> {
    let mut config = Config::load()?;
    match &args.action {
        Action::Set { key } => set(&mut config, global, key),
        Action::Show => show(&config, global),
        Action::Remove => remove(&mut config, global),
    }
}

fn set(config: &mut Config, global: &Global, raw: &str) -> Result<(), String> {
    let pasted = if raw.trim() == "-" {
        let mut text = String::new();
        std::io::stdin()
            .take(MAX_LEN as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|e| format!("stdin: {e}"))?;
        text
    } else {
        raw.to_owned()
    };
    let claims = verify(PUBLIC_KEY, &pasted).map_err(|r| r.to_string())?;
    if let Some(built) = BUILT
        && !claims.covers_build(built)
    {
        return Err(format!(
            "that key covers builds up to {} plus {} days' grace, and this build is dated {built}",
            claims.paid_through.as_deref().unwrap_or("?"),
            claims.grace_days.unwrap_or(0)
        ));
    }
    config.license = Some(normalize(&pasted));
    config.save()?;
    if global.json {
        return print_json(&verdict(claims.state(BUILT), Some(&claims)));
    }
    println!("stored the {} licence key", title(claims.tier()));
    print_human(&claims);
    println!("{FOLLOWS}");
    Ok(())
}

fn show(config: &Config, global: &Global) -> Result<(), String> {
    let Some(key) = config.license.as_deref() else {
        if global.json {
            return print_json(&verdict(State::Free, None));
        }
        crate::wire::out!("{:<14}{}", "state", State::Free.label());
        crate::wire::out!("{:<14}{}", "pitomd link", link_word(State::Free));
        println!("no licence key; p99 license set <key> stores one");
        return Ok(());
    };
    let claims = verify(PUBLIC_KEY, key)
        .map_err(|r| format!("the stored licence key is refused: {r}; p99 license set <key>"))?;
    if global.json {
        return print_json(&verdict(claims.state(BUILT), Some(&claims)));
    }
    print_human(&claims);
    Ok(())
}

fn remove(config: &mut Config, global: &Global) -> Result<(), String> {
    let removed = config.license.take().is_some();
    if removed {
        config.save()?;
    }
    if global.json {
        return print_json(&json!({"removed": removed}));
    }
    println!(
        "{}",
        if removed {
            "removed the licence key"
        } else {
            "no licence key was stored"
        }
    );
    if removed {
        println!("{FOLLOWS}");
    }
    Ok(())
}

fn print_human(claims: &Claims) {
    let shown = shown(claims);
    let line = |label: &str, value: &str| crate::wire::out!("{label:<14}{value}");
    let state = claims.state(BUILT);
    line("state", state.label());
    line("pitomd link", link_word(state));
    line("tier", &title(shown.tier));
    line("studio", shown.studio.unwrap_or("-"));
    line(
        "paid through",
        &format!(
            "{}, {} days' grace",
            shown.paid_through.unwrap_or("-"),
            shown.grace_days
        ),
    );
    line(
        "this build",
        &match shown.build_date {
            Some(date) if shown.covers_build => format!("{date}, covered"),
            Some(date) => format!("{date}, not covered"),
            None => "no build date, not covered".to_owned(),
        },
    );
}

fn verdict(state: State, claims: Option<&Claims>) -> serde_json::Value {
    json!({
        "state": state.word(),
        "may_hide_link": state.may_hide_link(),
        "license": claims.map(shown),
    })
}

fn link_word(state: State) -> &'static str {
    if state.may_hide_link() {
        "this key may hide the 'by PITO.MD' link"
    } else {
        "always shown; only an Agency or Owner key hides it"
    }
}

fn title(tier: &str) -> String {
    let mut chars = tier.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    println!("{text}");
    Ok(())
}

pub fn civil_day(date: &str) -> Option<i64> {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        bytes[range.clone()]
            .iter()
            .all(u8::is_ascii_digit)
            .then(|| date[range].parse().ok())?
    };
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if day < 1 || day > month_days {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn normalize(pasted: &str) -> String {
    let mut begin = None;
    let mut end = None;
    let mut body = String::new();
    for line in pasted.lines() {
        if !is_armour(line) {
            body.push_str(line);
            continue;
        }
        let label = line.trim().trim_matches('-').trim();
        if let Some(name) = label.strip_prefix("BEGIN ") {
            begin.get_or_insert(name);
        } else if let Some(name) = label.strip_prefix("END ") {
            end = Some(name);
        }
    }
    if let (Some(begin), Some(end)) = (begin, end)
        && !begin.split_whitespace().eq(end.split_whitespace())
    {
        return String::new();
    }
    body.chars().filter(|c| !c.is_whitespace()).collect()
}

fn is_armour(line: &str) -> bool {
    let trimmed = line.trim_start();
    let dashes = trimmed.chars().take_while(|c| *c == '-').count();
    dashes > 0
        && trimmed[dashes..]
            .chars()
            .next()
            .is_none_or(char::is_whitespace)
}

fn signed(public_key: &str, key: &str) -> Result<Vec<u8>, Refusal> {
    if key.len() > MAX_LEN {
        return Err(Refusal::Shape);
    }
    let cleaned = normalize(key);
    let parts: Vec<&str> = cleaned.splitn(4, '.').collect();
    if parts.len() != 3 || parts[0].to_uppercase() != PREFIX {
        return Err(Refusal::Shape);
    }
    let public: [u8; 32] = STANDARD
        .decode(public_key.trim())
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(Refusal::Signature)?;
    let signature: [u8; 64] = URL_SAFE_NO_PAD
        .decode(parts[2])
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(Refusal::Signature)?;
    let message = format!("{PREFIX}.{}", parts[1]);
    UnparsedPublicKey::new(&ED25519, public)
        .verify(message.as_bytes(), &signature)
        .map_err(|_| Refusal::Signature)?;
    URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| Refusal::Payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::Ed25519KeyPair;

    fn pair() -> (Ed25519KeyPair, String) {
        let signing = Ed25519KeyPair::from_seed_unchecked(&[7u8; 32]).unwrap();
        let public = STANDARD.encode(ring::signature::KeyPair::public_key(&signing));
        (signing, public)
    }

    fn mint(signing: &Ed25519KeyPair, payload: &str) -> String {
        let signed = format!("PITO1.{}", URL_SAFE_NO_PAD.encode(payload.as_bytes()));
        let signature = signing.sign(signed.as_bytes());
        format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.as_ref()))
    }

    fn claims(app: &str, tier: &str, kind: Option<&str>) -> String {
        let timed = match kind {
            Some(kind) => format!(
                r#","type":"{kind}","studio":"Acme","paid_through":"2026-12-31","grace_days":14"#
            ),
            None => String::new(),
        };
        format!(
            r#"{{"v":2,"id":"k1","email":"a@b.c","app":"{app}","tier":"{tier}","major":1,"device_cap":1,"issued":"2026-01-01"{timed}}}"#
        )
    }

    fn grouped(tier: &str, paid_through: &str, group: Option<&str>) -> String {
        let group = group.map_or_else(String::new, |group| format!(r#","group":"{group}""#));
        format!(
            r#"{{"v":2,"id":"k1","email":"ada@example.com","app":"p99","tier":"{tier}","major":1,"device_cap":1,"issued":"2026-01-01","type":"timed","studio":"Acme","paid_through":"{paid_through}","grace_days":14{group}}}"#
        )
    }

    fn read(group: Option<&str>, tier: &str, paid_through: &str) -> Claims {
        let (signing, public) = pair();
        verify(
            &public,
            &mint(&signing, &grouped(tier, paid_through, group)),
        )
        .unwrap()
    }

    #[test]
    fn free_may_not_hide_the_link() {
        assert_eq!(State::of(None), State::Free);
        assert_eq!(State::of(Some("PITO1.abc")), State::Free);
        assert!(!State::Free.may_hide_link());
        assert_eq!(State::Free.link_binding(), "shown");
        let lapsed = read(Some("customer"), "agency", "2026-12-31");
        assert_eq!(lapsed.state(Some("2027-01-15")), State::Free);
        assert!(!lapsed.state(Some("2027-01-15")).may_hide_link());
        assert!(!lapsed.state(None).may_hide_link());
    }

    #[test]
    fn a_studio_key_may_not_hide_the_link() {
        for group in [Some("customer"), Some("education"), Some("nonprofit"), None] {
            let claims = read(group, "studio", "2026-12-31");
            assert_eq!(claims.group(), Group::Customer);
            assert_eq!(claims.tier(), "studio");
            assert_eq!(claims.state(Some("2026-10-20")), State::Studio);
            assert!(!claims.state(Some("2026-10-20")).may_hide_link());
        }
        assert_eq!(State::Studio.link_binding(), "shown");
    }

    #[test]
    fn an_agency_key_covering_the_build_may_hide_the_link() {
        for group in [Some("customer"), Some("education"), Some("nonprofit"), None] {
            let claims = read(group, "agency", "2026-12-31");
            assert_eq!(claims.group(), Group::Customer);
            assert_eq!(claims.state(Some("2026-10-20")), State::Agency);
            assert!(claims.state(Some("2026-10-20")).may_hide_link());
            assert!(claims.state(Some("2027-01-14")).may_hide_link());
            assert!(!claims.state(Some("2027-01-15")).may_hide_link());
        }
        assert_eq!(State::Agency.link_binding(), "hideable");
    }

    #[test]
    fn an_ff_key_reads_as_agency_and_may_not_hide_the_link() {
        let claims = read(Some("friends-family"), "agency", "9999-12-31");
        assert_eq!(claims.group(), Group::FriendsFamily);
        assert_eq!(claims.tier(), "agency");
        for built in ["2026-10-20", "2099-01-01", "9999-12-31"] {
            assert_eq!(claims.state(Some(built)), State::Ff);
            assert!(!claims.state(Some(built)).may_hide_link());
        }
        assert_eq!(State::Ff.word(), "ff");
        assert_eq!(State::Ff.label(), "F&F");
        assert_eq!(State::Ff.link_binding(), "shown");
    }

    #[test]
    fn an_owner_key_reads_as_agency_and_may_hide_the_link() {
        let claims = read(Some("owner"), "agency", "9999-12-31");
        assert_eq!(claims.group(), Group::Owner);
        assert_eq!(claims.tier(), "agency");
        for built in ["2026-10-20", "2099-01-01", "9999-12-31"] {
            assert_eq!(claims.state(Some(built)), State::Owner);
            assert!(claims.state(Some(built)).may_hide_link());
        }
        assert_eq!(State::Owner.word(), "owner");
        assert_eq!(State::Owner.link_binding(), "hideable");
    }

    #[test]
    fn a_key_without_a_group_is_a_customer() {
        let (signing, public) = pair();
        let bare = verify(
            &public,
            &mint(&signing, &grouped("agency", "2026-12-31", None)),
        )
        .unwrap();
        assert_eq!(bare.group, None);
        assert_eq!(bare.group(), Group::Customer);
        assert_eq!(bare.state(Some("2026-10-20")), State::Agency);
        let old = verify(
            &public,
            &mint(&signing, &claims("p99", "agency", Some("timed"))),
        )
        .unwrap();
        assert_eq!(old.group(), Group::Customer);
    }

    #[test]
    fn a_tampered_group_fails_the_signature() {
        let (signing, public) = pair();
        let key = mint(&signing, &grouped("studio", "2026-12-31", Some("customer")));
        let (_, signature) = key.rsplit_once('.').unwrap();
        for forged in [
            grouped("studio", "2026-12-31", Some("owner")),
            grouped("studio", "2026-12-31", Some("friends-family")),
            grouped("agency", "9999-12-31", Some("owner")),
        ] {
            let token = format!(
                "PITO1.{}.{signature}",
                URL_SAFE_NO_PAD.encode(forged.as_bytes())
            );
            assert_eq!(verify(&public, &token), Err(Refusal::Signature));
            assert_eq!(State::of(Some(&token)), State::Free);
        }
    }

    #[test]
    fn a_timed_studio_or_agency_key_covers_builds_through_its_grace() {
        let (signing, public) = pair();
        for tier in TIERS {
            let key = mint(&signing, &claims("p99", tier, Some("timed")));
            let claims = verify(&public, &key).unwrap();
            assert_eq!(claims.studio.as_deref(), Some("Acme"));
            assert!(covers(&claims, Some("2026-10-20")));
            assert!(covers(&claims, Some("2027-01-14")));
            assert!(!covers(&claims, Some("2027-01-15")));
            assert!(!covers(&claims, None));
        }
    }

    #[test]
    fn an_armoured_key_with_line_breaks_verifies() {
        let (signing, public) = pair();
        let token = mint(&signing, &claims("p99", "studio", Some("timed")));
        let mut armoured = String::from("----- BEGIN PITO MD LICENSE -----\n");
        for chunk in token.as_bytes().chunks(40) {
            armoured.push_str(std::str::from_utf8(chunk).unwrap());
            armoured.push('\n');
        }
        armoured.push_str("------ END PITO MD LICENSE ------\n");
        assert!(verify(&public, &armoured).is_ok());
        assert_eq!(normalize(&armoured), token);
    }

    #[test]
    fn another_app_a_lifetime_or_unknown_type_or_another_tier_is_refused() {
        let (signing, public) = pair();
        let refused = |payload: String| verify(&public, &mint(&signing, &payload)).unwrap_err();
        assert_eq!(
            refused(claims("pfx", "studio", Some("timed"))),
            Refusal::App
        );
        assert_eq!(refused(claims("p99", "studio", None)), Refusal::Kind);
        assert_eq!(
            refused(claims("p99", "studio", Some("lifetime"))),
            Refusal::Kind
        );
        assert_eq!(
            refused(claims("p99", "studio", Some("forever"))),
            Refusal::Kind
        );
        assert_eq!(refused(claims("p99", "pro", Some("timed"))), Refusal::Tier);
        assert_eq!(
            refused(claims("p99", "studio", Some("timed")).replace(r#""v":2"#, r#""v":3"#)),
            Refusal::Version
        );
    }

    #[test]
    fn a_tampered_or_foreign_key_is_refused() {
        let (signing, public) = pair();
        let key = mint(&signing, &claims("p99", "studio", Some("timed")));
        let (head, signature) = key.rsplit_once('.').unwrap();
        let forged = format!(
            "PITO1.{}.{signature}",
            URL_SAFE_NO_PAD.encode(
                claims("p99", "agency", Some("timed"))
                    .replace("2026-12-31", "2099-12-31")
                    .as_bytes()
            )
        );
        assert_eq!(verify(&public, &forged), Err(Refusal::Signature));
        assert_ne!(head, forged.rsplit_once('.').unwrap().0);
        let other = Ed25519KeyPair::from_seed_unchecked(&[9u8; 32]).unwrap();
        let foreign = mint(&other, &claims("p99", "studio", Some("timed")));
        assert_eq!(verify(&public, &foreign), Err(Refusal::Signature));
        assert_eq!(verify(PUBLIC_KEY, &key), Err(Refusal::Signature));
        assert_eq!(verify(&public, "PITO1.abc"), Err(Refusal::Shape));
    }
}

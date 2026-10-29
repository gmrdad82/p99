use std::borrow::Cow;
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
pub const HIDES_LINK: &[&str] = &["agency"];
const FOREVER: &str = "9999-12-31";

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
    FriendsFamily,
    Customer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Free,
    Studio,
    Agency,
    Ff,
}

impl State {
    pub const ALL: [State; 4] = [State::Free, State::Studio, State::Agency, State::Ff];

    pub fn word(self) -> &'static str {
        match self {
            State::Free => "free",
            State::Studio => "studio",
            State::Agency => "agency",
            State::Ff => "ff",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            State::Free => "Free",
            State::Studio => "Studio",
            State::Agency => "Agency",
            State::Ff => "F&F",
        }
    }

    pub fn parse(word: &str) -> Option<State> {
        if word == "owner" {
            return Some(State::Agency);
        }
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
            Some("friends-family") => Group::FriendsFamily,
            _ => Group::Customer,
        }
    }

    pub fn tier(&self) -> &str {
        match self.group() {
            Group::FriendsFamily => TOP,
            Group::Customer => &self.tier,
        }
    }

    pub fn state(&self, build_date: Option<&str>) -> State {
        if !covers(self, build_date) {
            return State::Free;
        }
        match (self.group(), self.tier()) {
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
    line("paid through", &through_line(&shown));
    line(
        "this build",
        &match shown.build_date {
            Some(date) if shown.covers_build => format!("{date}, covered"),
            Some(date) => format!("{date}, not covered"),
            None => "no build date, not covered".to_owned(),
        },
    );
}

fn through_line(shown: &Shown<'_>) -> String {
    match shown.paid_through {
        Some(FOREVER) => "every release".to_owned(),
        other => format!("{}, {} days' grace", other.unwrap_or("-"), shown.grace_days),
    }
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
        "always shown; only an Agency key hides it"
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
    let decoded = soft_breaks(pasted);
    let text = unglue(&decoded);
    let mut begin = None;
    let mut end = None;
    let mut before = String::new();
    let mut body = String::new();
    for raw in text.lines() {
        let line = raw.trim_matches(|c: char| c == '>' || c.is_whitespace() || invisible(c));
        match armour(line) {
            Some(Armour::Begin(name)) if begin.is_none() => begin = Some(name),
            Some(Armour::End(name)) => {
                end = Some(name);
                if begin.is_some() {
                    break;
                }
            }
            Some(Armour::Begin(_)) => {}
            None if begin.is_some() => body.push_str(line),
            None if end.is_none() => before.push_str(line),
            None => {}
        }
    }
    if let (Some(begin), Some(end)) = (begin, end)
        && !begin.split_whitespace().eq(end.split_whitespace())
    {
        return String::new();
    }
    let kept = if begin.is_some() { body } else { before };
    kept.chars()
        .filter(|c| !c.is_whitespace() && !invisible(*c))
        .collect()
}

enum Armour<'a> {
    Begin(&'a str),
    End(&'a str),
}

fn armour(line: &str) -> Option<Armour<'_>> {
    if !line.starts_with('-') {
        return None;
    }
    let label = line.trim_matches(|c: char| c == '-' || c.is_whitespace());
    if let Some(name) = label.strip_prefix("BEGIN ") {
        Some(Armour::Begin(name))
    } else {
        label.strip_prefix("END ").map(Armour::End)
    }
}

fn invisible(c: char) -> bool {
    matches!(
        c,
        '\u{ad}' | '\u{180e}' | '\u{200b}'..='\u{200d}' | '\u{2060}' | '\u{feff}'
    )
}

fn unglue(text: &str) -> Cow<'_, str> {
    let mut marks: Vec<usize> = text
        .match_indices("BEGIN ")
        .chain(text.match_indices("END "))
        .map(|(at, _)| at)
        .collect();
    marks.sort_unstable();
    let mut out = String::new();
    let mut last = 0;
    for at in marks {
        if at < last {
            continue;
        }
        let lead = text[..at].trim_end_matches([' ', '\t']);
        let start = lead.trim_end_matches('-').len();
        if start == lead.len() || start < last {
            continue;
        }
        let label = text[at..]
            .find(['-', '\r', '\n'])
            .map_or(text.len(), |n| at + n);
        let stop = label + (text[label..].len() - text[label..].trim_start_matches('-').len());
        out.push_str(&text[last..start]);
        out.push('\n');
        out.push_str(&text[start..stop]);
        out.push('\n');
        last = stop;
    }
    if last == 0 {
        return Cow::Borrowed(text);
    }
    out.push_str(&text[last..]);
    Cow::Owned(out)
}

fn soft_breaks(pasted: &str) -> Cow<'_, str> {
    if !pasted.contains('=') {
        return Cow::Borrowed(pasted);
    }
    let bytes = pasted.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'=' {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let blank = bytes[i + 1..]
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let after = i + 1 + blank;
        match &bytes[after.min(bytes.len())..] {
            [b'\r', b'\n', ..] => i = after + 2,
            [b'\n', ..] => i = after + 1,
            [] => i = after,
            [high, low, ..]
                if blank == 0 && high.is_ascii_hexdigit() && low.is_ascii_hexdigit() =>
            {
                let hex = [*high, *low];
                let text = std::str::from_utf8(&hex).unwrap_or("00");
                out.push(u8::from_str_radix(text, 16).unwrap_or(0));
                i += 3;
            }
            _ => {
                out.push(b'=');
                i += 1;
            }
        }
    }
    Cow::Owned(String::from_utf8_lossy(&out).into_owned())
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
    fn an_owner_group_key_reads_as_a_customer_agency_key_and_may_hide_the_link() {
        let claims = read(Some("owner"), "agency", "9999-12-31");
        assert_eq!(claims.group(), Group::Customer);
        assert_eq!(claims.tier(), "agency");
        for built in ["2026-10-20", "2099-01-01", "9999-12-31"] {
            assert_eq!(claims.state(Some(built)), State::Agency);
            assert!(claims.state(Some(built)).may_hide_link());
        }
    }

    #[test]
    fn an_owner_group_studio_key_is_a_plain_studio_key() {
        let claims = read(Some("owner"), "studio", "2026-12-31");
        assert_eq!(claims.tier(), "studio");
        assert_eq!(claims.state(Some("2026-10-20")), State::Studio);
        assert!(!claims.state(Some("2026-10-20")).may_hide_link());
    }

    #[test]
    fn the_word_owner_from_an_older_deploy_reads_as_agency() {
        assert_eq!(State::parse("owner"), Some(State::Agency));
        assert_eq!(State::parse("agency"), Some(State::Agency));
        assert_eq!(State::parse("platinum"), None);
        assert!(!State::ALL.iter().any(|state| state.word() == "owner"));
    }

    #[test]
    fn a_never_lapsing_key_says_every_release_and_a_dated_one_its_date() {
        let forever = read(Some("customer"), "agency", "9999-12-31");
        assert_eq!(through_line(&shown(&forever)), "every release");
        let dated = read(Some("customer"), "agency", "2026-12-31");
        assert_eq!(through_line(&shown(&dated)), "2026-12-31, 0 days' grace");
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

    fn wrap(token: &str, width: usize, newline: &str) -> String {
        let mut text = format!("----- BEGIN PITO MD LICENSE -----{newline}");
        for chunk in token.as_bytes().chunks(width) {
            text.push_str(std::str::from_utf8(chunk).unwrap());
            text.push_str(newline);
        }
        text.push_str(&format!("------ END PITO MD LICENSE ------{newline}"));
        text
    }

    fn studio() -> (String, String) {
        let (signing, public) = pair();
        (
            mint(&signing, &claims("p99", "studio", Some("timed"))),
            public,
        )
    }

    #[test]
    fn a_bom_crlf_spaces_or_invisible_marks_around_a_key_still_verify() {
        let (token, public) = studio();
        let (head, tail) = token.split_at(token.len() / 2);
        let pasted = [
            format!("\u{feff}{}", wrap(&token, 64, "\r\n")),
            format!("\u{feff}{token}\r\n"),
            format!("   {token}   \n"),
            format!("\t{head}\u{a0}{tail}\t"),
            format!("{head}\u{200b}{tail}"),
            format!("{head}\u{ad}{tail}"),
            format!("{head}\u{2060}\u{200d}{tail}"),
            wrap(&token, 40, "\r\n").replace('\n', "  \n"),
        ];
        for text in pasted {
            assert_eq!(normalize(&text), token, "{text:?}");
            assert!(verify(&public, &text).is_ok(), "{text:?}");
        }
    }

    #[test]
    fn a_line_holding_only_hyphens_is_part_of_the_key_inside_the_armour() {
        let (signing, public) = pair();
        let token = (1..10_000)
            .map(|n| {
                let payload =
                    claims("p99", "studio", Some("timed")).replace("a@b.c", &format!("a{n}@b.c"));
                mint(&signing, &payload)
            })
            .find(|t| t.contains('-'))
            .unwrap();
        let at = token.find('-').unwrap();
        let wrapped = format!(
            "----- BEGIN PITO MD LICENSE -----\n{}\n-\n{}\n------ END PITO MD LICENSE ------\n",
            &token[..at],
            &token[at + 1..]
        );
        assert_eq!(normalize(&wrapped), token);
        assert_eq!(verify(&public, &wrapped).unwrap().tier(), "studio");
    }

    #[test]
    fn mail_text_around_the_armour_and_quote_marks_are_left_out() {
        let (token, public) = studio();
        let mail = format!(
            "Hi Ada,\r\nyour key:\r\n\r\n{}\r\n-- \r\nGrace Hopper\r\nexample.com\r\n",
            wrap(&token, 50, "\r\n")
        );
        assert_eq!(normalize(&mail), token);
        let quoted: String = wrap(&token, 50, "\n")
            .lines()
            .map(|l| format!("> > {l}\n"))
            .collect();
        assert_eq!(normalize(&quoted), token);
        assert!(verify(&public, &quoted).is_ok());
    }

    #[test]
    fn quoted_printable_soft_breaks_and_escapes_read_back_to_the_key() {
        let (token, public) = studio();
        let soft: String = token
            .as_bytes()
            .chunks(30)
            .map(|c| format!("{}=\r\n", std::str::from_utf8(c).unwrap()))
            .collect();
        assert_eq!(normalize(&soft), token);
        assert!(verify(&public, &soft).is_ok());
        let spaced = soft.replace("=\r\n", "=  \n");
        assert_eq!(normalize(&spaced), token);
        let escaped = format!("=EF=BB=BF{}=20\n", wrap(&token, 64, "=\n"));
        assert_eq!(normalize(&escaped), token, "{escaped:?}");
        assert!(verify(&public, &escaped).is_ok(), "{escaped:?}");
        let (head, tail) = token.split_at(75);
        let mail = format!(
            "Content-Transfer-Encoding: quoted-printable\r\n\r\nHi Ada=2C your key:\r\n\r\n=EF=BB=BF----- BEGIN PITO MD LICENSE -----\r\n{head}=\r\n{tail}\r\n------ END PITO MD LICENSE ------\r\n-- =\r\nGrace Hopper\r\n"
        );
        assert_eq!(normalize(&mail), token, "{mail:?}");
        assert!(verify(&public, &mail).is_ok(), "{mail:?}");
        assert_eq!(soft_breaks("a=3Db=\nc="), "a=bc");
        assert_eq!(soft_breaks("a=zz"), "a=zz");
        assert_eq!(soft_breaks("a= b"), "a= b");
        assert!(matches!(soft_breaks("plain"), Cow::Borrowed("plain")));
    }

    #[test]
    fn armour_glued_onto_the_key_by_a_rewrapping_client_is_split_back_out() {
        let (token, public) = studio();
        let glued = format!(
            "> ----- BEGIN PITO MD LICENSE -----{token}------ END PITO MD LICENSE ------ thanks\n"
        );
        assert_eq!(normalize(&glued), token, "{glued:?}");
        assert!(verify(&public, &glued).is_ok());
        let half = format!(
            "----- BEGIN PITO MD LICENSE -----{token}\n------ END PITO MD LICENSE ------\n"
        );
        assert_eq!(normalize(&half), token);
        let mismatched =
            format!("----- BEGIN PITO MD LICENSE -----{token}------ END PITO MD KEY ------");
        assert_eq!(verify(&public, &mismatched), Err(Refusal::Shape));
        assert_eq!(unglue("SEND it, BEGIN now"), "SEND it, BEGIN now");
        assert!(matches!(unglue("plain"), Cow::Borrowed("plain")));
        assert_eq!(unglue("a-- END X --b"), "a\n-- END X --\nb");
        assert_eq!(unglue("-BEGIN X"), "\n-BEGIN X\n");
    }

    #[test]
    fn what_is_no_key_is_still_refused_as_shape() {
        let (token, public) = studio();
        for text in [
            String::new(),
            "\u{feff}".to_owned(),
            "\u{feff}\r\n   \r\n".to_owned(),
            "-----\n-\n--\n".to_owned(),
            "Hello, here is no key at all".to_owned(),
            "=\n=\n".to_owned(),
            format!("{token}.extra"),
            wrap(&token, 64, "\n").replace("END PITO MD LICENSE", "END PITO MD KEY"),
            "----- BEGIN PITO MD LICENSE -----\n------ END PITO MD LICENSE ------\n".to_owned(),
        ] {
            assert_eq!(verify(&public, &text), Err(Refusal::Shape), "{text:?}");
        }
        let mut flipped = token.clone().into_bytes();
        flipped[10] = if flipped[10] == b'x' { b'y' } else { b'x' };
        let broken = wrap(std::str::from_utf8(&flipped).unwrap(), 64, "\r\n");
        assert_eq!(
            verify(&public, &format!("\u{feff}{broken}")),
            Err(Refusal::Signature)
        );
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

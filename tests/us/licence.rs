use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::Ed25519KeyPair;
use serde_json::json;

use crate::fake;
use crate::home::Home;

const NOT_A_KEY: &str = "that is not a PITO MD licence key";
const FORGED: &str = "that key's signature does not verify against the PITO MD licence key";

fn forged_studio_key() -> String {
    let pair = Ed25519KeyPair::from_seed_unchecked(&[43; 32]).unwrap();
    let payload = json!({
        "v": 2,
        "id": "k1",
        "email": "ada@example.com",
        "app": "p99",
        "tier": "studio",
        "type": "timed",
        "group": "customer",
        "major": 1,
        "device_cap": 1,
        "issued": "2026-01-01",
        "studio": "Ada Lovelace Studio",
        "paid_through": "9999-12-31",
        "grace_days": 14,
    });
    let signed = format!(
        "PITO1.{}",
        URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes())
    );
    let signature = pair.sign(signed.as_bytes());
    format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.as_ref()))
}

#[test]
fn us_licence_001_a_bad_or_forged_key_is_refused_in_one_line_and_never_stored() {
    let h = Home::new("us-licence-bad-key", fake::any);
    let before = h.config();
    let forged = forged_studio_key();

    for (key, said) in [
        ("not a key", NOT_A_KEY),
        ("PITO1.abc", NOT_A_KEY),
        (forged.as_str(), FORGED),
    ] {
        let out = h.p99(&["license", "set", key]);
        out.refused(said);
        assert_eq!(out.stderr, format!("p99: {said}\n"));
        assert!(out.stdout.is_empty(), "{}", out.stdout);
        assert_eq!(h.config(), before, "a refused key changed the config");
        assert!(!out.stderr.contains(&forged), "the key was echoed back");
    }

    let shown = h.p99(&["license", "show", "--json"]);
    shown.ok();
    let answer = shown.json();
    assert_eq!(answer["state"], "free");
    assert_eq!(answer["license"], serde_json::Value::Null);
    assert!(h.stub.seen().is_empty(), "checking a key made a call");
}

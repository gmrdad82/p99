use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Actor {
    pub email: String,
    pub name: String,
    pub rank: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub person: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signed {
    pub content_sha256: String,
    pub auth: String,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn encode_actor(actor: &Actor) -> String {
    let json = serde_json::to_vec(actor).unwrap_or_default();
    URL_SAFE_NO_PAD.encode(json)
}

pub fn sign(
    secret: &[u8],
    ts: i64,
    method: &str,
    path_and_query: &str,
    actor: &str,
    body: &[u8],
) -> Signed {
    let content_sha256 = hex(&Sha256::digest(body));
    let message = format!("v1\n{ts}\n{method}\n{path_and_query}\n{actor}\n{content_sha256}");
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).expect("HMAC takes any key");
    mac.update(message.as_bytes());
    let sig = hex(&mac.finalize().into_bytes());
    Signed {
        auth: format!("v1 ts={ts},sig={sig}"),
        content_sha256,
    }
}

use serde_json::json;

use crate::cli::Global;
use crate::cloudflare::Cloudflare;
use crate::config::{Account, Config};

pub const NO_SUBDOMAIN: &str = "the account has no workers.dev subdomain, so the P99 page has no address; pick one in the Cloudflare dashboard (Workers & Pages) or set app = \"<host>\" for the account in the config, then run p99 deploy";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Address {
    Own(String),
    WorkersDev(String),
}

impl Address {
    pub fn host(&self) -> &str {
        match self {
            Address::Own(host) | Address::WorkersDev(host) => host,
        }
    }

    pub fn url(&self) -> String {
        format!("https://{}/", self.host())
    }
}

fn own(account: &Account) -> Result<Option<String>, String> {
    let Some(raw) = account.app.as_deref() else {
        return Ok(None);
    };
    let host = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if !crate::setup::is_hostname(&host) {
        return Err(format!(
            "app = \"{raw}\" is not a host name; give a host such as p99.example.com"
        ));
    }
    Ok(Some(host))
}

pub fn address(cf: &Cloudflare, account: &Account) -> Result<Option<Address>, String> {
    if let Some(host) = own(account)? {
        return Ok(Some(Address::Own(host)));
    }
    Ok(cf
        .subdomain(&account.account_id)?
        .map(|sub| Address::WorkersDev(format!("{}.{sub}.workers.dev", account.worker))))
}

pub fn run(global: &Global) -> Result<(), String> {
    let config = Config::load()?;
    let (name, account) = config.account(global.account.as_deref())?;
    let found = match own(account)? {
        Some(host) => Address::Own(host),
        None => {
            let cf = Cloudflare::new(&crate::config::token(account)?);
            address(&cf, account)?.ok_or(NO_SUBDOMAIN)?
        }
    };
    if global.json {
        println!(
            "{}",
            json!({ "account": name, "app": found.url(), "own": matches!(found, Address::Own(_)) })
        );
    } else {
        println!("{}", found.url());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    type Seen = Arc<Mutex<Vec<(String, String, String)>>>;

    fn stub(answer: fn(&str, &str) -> String) -> (String, Seen) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen: Seen = Arc::default();
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or_default().to_owned();
                let path = parts.next().unwrap_or_default().to_owned();
                let mut length = 0;
                let mut chunked = false;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    let (k, v) = header.split_once(':').unwrap_or_default();
                    if k.eq_ignore_ascii_case("content-length") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                    if k.eq_ignore_ascii_case("transfer-encoding") {
                        chunked = v.trim().eq_ignore_ascii_case("chunked");
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                while chunked {
                    let mut size = String::new();
                    reader.read_line(&mut size).unwrap();
                    let n = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
                    let mut chunk = vec![0; n + 2];
                    reader.read_exact(&mut chunk).unwrap();
                    body.extend_from_slice(&chunk[..n]);
                    chunked = n > 0;
                }
                let body = String::from_utf8_lossy(&body).into_owned();
                let reply = answer(&method, &path);
                log.lock().unwrap().push((method, path, body));
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        (base, seen)
    }

    fn cloudflare(method: &str, path: &str) -> String {
        match (method, path) {
            ("GET", "/accounts/a1/workers/subdomain") => {
                r#"{"success":true,"result":{"subdomain":"example"}}"#
            }
            ("GET", p) if p.starts_with("/zones/z1/workers/routes") => {
                r#"{"success":true,"result":[]}"#
            }
            _ => r#"{"success":true,"result":{}}"#,
        }
        .to_owned()
    }

    fn account(app: Option<&str>) -> Account {
        Account {
            account_id: "a1".into(),
            worker: "p99".into(),
            app: app.map(str::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn deploy_gives_the_page_its_workers_dev_address_or_routes_the_own_host() {
        let (base, seen) = stub(cloudflare);
        let cf = Cloudflare::at("t", &base);
        let plain = address(&cf, &account(None)).unwrap().unwrap();
        assert_eq!(plain, Address::WorkersDev("p99.example.workers.dev".into()));
        assert_eq!(plain.url(), "https://p99.example.workers.dev/");
        crate::setup::open_app(&cf, "a1", "p99", &[], &plain).unwrap();
        let zones = [crate::cloudflare::Named {
            id: "z1".into(),
            name: "example.com".into(),
        }];
        let before = seen.lock().unwrap().len();
        let own = address(&cf, &account(Some("P99.Example.com")))
            .unwrap()
            .unwrap();
        assert_eq!(own, Address::Own("p99.example.com".into()));
        assert_eq!(seen.lock().unwrap().len(), before);
        crate::setup::open_app(&cf, "a1", "p99", &zones, &own).unwrap();
        let calls = seen.lock().unwrap().clone();
        let enabled = calls
            .iter()
            .find(|c| c.0 == "POST" && c.1 == "/accounts/a1/workers/scripts/p99/subdomain")
            .unwrap();
        let body =
            |c: &(String, String, String)| serde_json::from_str::<serde_json::Value>(&c.2).unwrap();
        assert_eq!(body(enabled)["enabled"], true);
        let routed = calls
            .iter()
            .find(|c| c.0 == "POST" && c.1 == "/zones/z1/workers/routes")
            .unwrap();
        assert_eq!(body(routed)["pattern"], "p99.example.com/*");
        assert!(address(&cf, &account(Some("not a host"))).is_err());
    }
}

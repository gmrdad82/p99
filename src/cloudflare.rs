use std::time::Duration;

use serde_json::{Value, json};
use ureq::Agent;

const API: &str = "https://api.cloudflare.com/client/v4";
pub const CRON: &str = "*/15 * * * *";

pub struct Cloudflare {
    agent: Agent,
    token: String,
    base: String,
}

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub codes: Vec<i64>,
    pub message: String,
}

impl ApiError {
    pub fn denied(&self) -> bool {
        self.status == 401
            || self.status == 403
            || self.codes.iter().any(|c| matches!(c, 9109 | 10000 | 10001))
    }

    pub fn missing(&self) -> bool {
        self.status == 404
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<ApiError> for String {
    fn from(error: ApiError) -> String {
        error.message
    }
}

pub type Answer<T> = Result<T, ApiError>;

#[derive(Debug, Clone)]
pub struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Route {
    pub pattern: String,
    pub script: String,
}

#[derive(Debug, Clone)]
pub struct Module<'a> {
    pub name: &'a str,
    pub content_type: &'a str,
    pub bytes: &'a [u8],
}

impl Cloudflare {
    pub fn new(token: &str) -> Cloudflare {
        let agent = Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(120)))
            .build()
            .new_agent();
        Cloudflare {
            agent,
            token: token.trim().to_owned(),
            base: api(),
        }
    }

    #[cfg(test)]
    pub fn at(token: &str, base: &str) -> Cloudflare {
        Cloudflare {
            base: base.trim_end_matches('/').to_owned(),
            ..Cloudflare::new(token)
        }
    }

    fn auth(&self) -> String {
        format!("Bearer {}", self.token)
    }

    fn get(&self, path: &str) -> Answer<Value> {
        let response = self
            .agent
            .get(&format!("{}{path}", self.base))
            .header("Authorization", &self.auth())
            .call();
        envelope(response, path)
    }

    fn send_json(&self, method: &str, path: &str, body: &Value) -> Answer<Value> {
        let url = format!("{}{path}", self.base);
        let request = match method {
            "POST" => self.agent.post(&url),
            "PATCH" => self.agent.patch(&url),
            _ => self.agent.put(&url),
        };
        let response = request
            .header("Authorization", &self.auth())
            .send_json(body);
        envelope(response, path)
    }

    fn pages(&self, path: &str) -> Answer<Vec<Value>> {
        let mut all = Vec::new();
        let join = if path.contains('?') { '&' } else { '?' };
        for page in 1..=100 {
            let full = self.get_full(&format!("{path}{join}page={page}&per_page=50"))?;
            let items = full["result"].as_array().cloned().unwrap_or_default();
            let count = items.len();
            all.extend(items);
            let total = full["result_info"]["total_pages"].as_u64().unwrap_or(1);
            if count == 0 || page as u64 >= total {
                break;
            }
        }
        Ok(all)
    }

    fn get_full(&self, path: &str) -> Answer<Value> {
        let response = self
            .agent
            .get(&format!("{}{path}", self.base))
            .header("Authorization", &self.auth())
            .call();
        whole(response, path)
    }

    pub fn verify(&self) -> Answer<Value> {
        self.get("/user/tokens/verify")
    }

    pub fn verify_account(&self, account: &str) -> Answer<Value> {
        self.get(&format!("/accounts/{account}/tokens/verify"))
    }

    pub fn accounts(&self) -> Answer<Vec<Named>> {
        Ok(self.pages("/accounts")?.iter().map(named).collect())
    }

    pub fn databases(&self, account: &str) -> Answer<Vec<Named>> {
        Ok(self
            .pages(&format!("/accounts/{account}/d1/database"))?
            .iter()
            .map(|db| Named {
                id: text(&db["uuid"]),
                name: text(&db["name"]),
            })
            .collect())
    }

    pub fn create_database(&self, account: &str, name: &str) -> Answer<Named> {
        let db = self.send_json(
            "POST",
            &format!("/accounts/{account}/d1/database"),
            &json!({ "name": name }),
        )?;
        Ok(Named {
            id: text(&db["uuid"]),
            name: text(&db["name"]),
        })
    }

    pub fn query(
        &self,
        account: &str,
        database: &str,
        sql: &str,
        params: &[Value],
    ) -> Answer<Vec<Value>> {
        let mut body = json!({ "sql": sql });
        if !params.is_empty() {
            body["params"] = Value::Array(params.to_vec());
        }
        let result = self.send_json(
            "POST",
            &format!("/accounts/{account}/d1/database/{database}/query"),
            &body,
        )?;
        let mut rows = Vec::new();
        for statement in result.as_array().into_iter().flatten() {
            if statement["success"] == Value::Bool(false) {
                return Err(ApiError {
                    status: 400,
                    codes: Vec::new(),
                    message: format!("D1: {}", statement["error"]),
                });
            }
            rows.extend(statement["results"].as_array().cloned().unwrap_or_default());
        }
        Ok(rows)
    }

    pub fn buckets(&self, account: &str) -> Answer<Vec<String>> {
        let result = self.get(&format!("/accounts/{account}/r2/buckets?per_page=1000"))?;
        Ok(result["buckets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|b| text(&b["name"]))
            .collect())
    }

    pub fn create_bucket(&self, account: &str, name: &str) -> Answer<()> {
        self.send_json(
            "POST",
            &format!("/accounts/{account}/r2/buckets"),
            &json!({ "name": name }),
        )
        .map(drop)
    }

    pub fn scripts(&self, account: &str) -> Answer<Vec<String>> {
        let result = self.get(&format!("/accounts/{account}/workers/scripts"))?;
        Ok(result
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| text(&s["id"]))
            .collect())
    }

    pub fn migration_tag(&self, account: &str, script: &str) -> Answer<Option<String>> {
        let result = self.get(&format!("/accounts/{account}/workers/scripts"))?;
        Ok(result
            .as_array()
            .into_iter()
            .flatten()
            .find(|s| s["id"] == script)
            .and_then(|s| s["migration_tag"].as_str())
            .filter(|tag| !tag.is_empty())
            .map(str::to_owned))
    }

    pub fn settings(&self, account: &str, script: &str) -> Answer<Option<Value>> {
        match self.get(&format!(
            "/accounts/{account}/workers/scripts/{script}/settings"
        )) {
            Ok(settings) => Ok(Some(settings)),
            Err(error) if error.missing() || error.codes.contains(&10007) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn bindings(&self, account: &str, script: &str) -> Answer<Option<Vec<Value>>> {
        Ok(self
            .settings(account, script)?
            .map(|s| s["bindings"].as_array().cloned().unwrap_or_default()))
    }

    pub fn secrets(&self, account: &str, script: &str) -> Answer<Vec<String>> {
        let result = self.get(&format!(
            "/accounts/{account}/workers/scripts/{script}/secrets"
        ))?;
        Ok(result
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| text(&s["name"]))
            .collect())
    }

    pub fn upload(
        &self,
        account: &str,
        script: &str,
        main_module: &str,
        bindings: &[Value],
        migrations: Option<Value>,
        modules: &[Module],
    ) -> Answer<Value> {
        let metadata = metadata(main_module, bindings, migrations);
        let boundary = boundary();
        let body = multipart(&boundary, &metadata, modules);
        let path = format!("/accounts/{account}/workers/scripts/{script}");
        let response = self
            .agent
            .put(&format!("{}{path}", self.base))
            .header("Authorization", &self.auth())
            .header(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send(&body[..]);
        envelope(response, &path)
    }

    pub fn put_secret(&self, account: &str, script: &str, name: &str, value: &str) -> Answer<()> {
        self.send_json(
            "PUT",
            &format!("/accounts/{account}/workers/scripts/{script}/secrets"),
            &json!({ "name": name, "text": value, "type": "secret_text" }),
        )
        .map(drop)
    }

    pub fn put_schedules(&self, account: &str, script: &str, crons: &[&str]) -> Answer<()> {
        let body: Vec<Value> = crons.iter().map(|c| json!({ "cron": c })).collect();
        self.send_json(
            "PUT",
            &format!("/accounts/{account}/workers/scripts/{script}/schedules"),
            &Value::Array(body),
        )
        .map(drop)
    }

    pub fn zones(&self, account: &str) -> Answer<Vec<Named>> {
        Ok(self
            .pages(&format!("/zones?account.id={account}"))?
            .iter()
            .map(named)
            .collect())
    }

    pub fn routes(&self, zone: &str) -> Answer<Vec<Route>> {
        let result = self.get(&format!("/zones/{zone}/workers/routes"))?;
        Ok(result
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| Route {
                pattern: text(&r["pattern"]),
                script: text(&r["script"]),
            })
            .collect())
    }

    pub fn create_route(&self, zone: &str, pattern: &str, script: &str) -> Answer<()> {
        self.send_json(
            "POST",
            &format!("/zones/{zone}/workers/routes"),
            &json!({ "pattern": pattern, "script": script }),
        )
        .map(drop)
    }

    pub fn subdomain(&self, account: &str) -> Answer<Option<String>> {
        match self.get(&format!("/accounts/{account}/workers/subdomain")) {
            Ok(result) => Ok(result["subdomain"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)),
            Err(error) if error.missing() || error.codes.contains(&10007) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn enable_subdomain(&self, account: &str, script: &str) -> Answer<()> {
        self.send_json(
            "POST",
            &format!("/accounts/{account}/workers/scripts/{script}/subdomain"),
            &json!({ "enabled": true, "previews_enabled": false }),
        )
        .map(drop)
    }

    pub fn custom_domain(&self, account: &str, host: &str) -> Answer<Option<String>> {
        let result = self.get(&format!(
            "/accounts/{account}/workers/domains?hostname={host}"
        ))?;
        Ok(result
            .as_array()
            .into_iter()
            .flatten()
            .find(|d| d["hostname"].as_str() == Some(host))
            .map(|d| text(&d["service"])))
    }

    pub fn pages_project(&self, account: &str, host: &str) -> Answer<Option<String>> {
        let projects = self.get(&format!("/accounts/{account}/pages/projects"))?;
        Ok(projects
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| {
                p["domains"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|d| d.as_str() == Some(host))
            })
            .map(|p| text(&p["name"])))
    }
}

pub fn metadata(main_module: &str, bindings: &[Value], migrations: Option<Value>) -> Value {
    let mut metadata = json!({
        "main_module": main_module,
        "compatibility_date": crate::bundle::COMPATIBILITY_DATE,
        "bindings": bindings,
        "keep_bindings": ["secret_text"],
        "observability": { "enabled": true },
    });
    if let Some(migrations) = migrations {
        metadata["migrations"] = migrations;
    }
    metadata
}

pub fn multipart(boundary: &str, metadata: &Value, modules: &[Module]) -> Vec<u8> {
    let mut body = Vec::new();
    let mut part = |name: &str, filename: Option<&str>, content_type: &str, bytes: &[u8]| {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let disposition = match filename {
            Some(file) => format!("form-data; name=\"{name}\"; filename=\"{file}\""),
            None => format!("form-data; name=\"{name}\""),
        };
        body.extend_from_slice(format!("Content-Disposition: {disposition}\r\n").as_bytes());
        body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    };
    part(
        "metadata",
        None,
        "application/json",
        metadata.to_string().as_bytes(),
    );
    for module in modules {
        part(
            module.name,
            Some(module.name),
            module.content_type,
            module.bytes,
        );
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

pub fn zone_of<'a>(zones: &'a [Named], host: &str) -> Option<&'a Named> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    zones
        .iter()
        .filter(|z| {
            let zone = z.name.to_ascii_lowercase();
            host == zone || host.ends_with(&format!(".{zone}"))
        })
        .max_by_key(|z| z.name.len())
}

fn boundary() -> String {
    let mut bytes = [0u8; 12];
    if crate::setup::random(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        bytes.copy_from_slice(&nanos.to_le_bytes()[..12]);
    }
    format!(
        "p99-{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

fn api() -> String {
    std::env::var("P99_CLOUDFLARE_API")
        .ok()
        .filter(|v| !v.is_empty())
        .map(|v| v.trim_end_matches('/').to_owned())
        .unwrap_or_else(|| API.to_owned())
}

fn named(value: &Value) -> Named {
    Named {
        id: text(&value["id"]),
        name: text(&value["name"]),
    }
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}

fn whole(
    response: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    path: &str,
) -> Answer<Value> {
    let mut response = response.map_err(|error| ApiError {
        status: 0,
        codes: Vec::new(),
        message: format!("Cloudflare {path}: {error}"),
    })?;
    let status = response.status().as_u16();
    let body: Value = response
        .body_mut()
        .read_json()
        .unwrap_or_else(|_| json!({ "success": false }));
    if (200..300).contains(&status) && body["success"] != Value::Bool(false) {
        return Ok(body);
    }
    let errors = body["errors"].as_array().cloned().unwrap_or_default();
    let codes = errors.iter().filter_map(|e| e["code"].as_i64()).collect();
    let said: Vec<String> = errors
        .iter()
        .map(|e| format!("{} ({})", text(&e["message"]), e["code"]))
        .collect();
    let said = if said.is_empty() {
        format!("HTTP {status}")
    } else {
        said.join("; ")
    };
    Err(ApiError {
        status,
        codes,
        message: format!(
            "Cloudflare {}: {said}",
            path.split('?').next().unwrap_or(path)
        ),
    })
}

fn envelope(
    response: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    path: &str,
) -> Answer<Value> {
    whole(response, path).map(|mut body| body["result"].take())
}

pub fn worker_secret(
    config: &crate::config::Config,
    account: &str,
    name: &str,
    value: &str,
) -> Result<(), String> {
    let (cf, entry) = account_api(config, account)?;
    cf.put_secret(&entry.account_id, &entry.worker, name, value)?;
    Ok(())
}

pub fn drop_worker_secret(
    config: &crate::config::Config,
    account: &str,
    name: &str,
) -> Result<(), String> {
    let (cf, entry) = account_api(config, account)?;
    let path = format!(
        "/accounts/{}/workers/scripts/{}/secrets/{name}",
        entry.account_id, entry.worker
    );
    let response = cf
        .agent
        .delete(&format!("{}{path}", cf.base))
        .header("Authorization", &cf.auth())
        .call();
    match envelope(response, &path) {
        Ok(_) => Ok(()),
        Err(error) if error.missing() => Ok(()),
        Err(error) => Err(error.message),
    }
}

fn account_api<'a>(
    config: &'a crate::config::Config,
    account: &str,
) -> Result<(Cloudflare, &'a crate::config::Account), String> {
    let entry = config
        .accounts
        .get(account)
        .ok_or_else(|| format!("no account is called {account}"))?;
    Ok((Cloudflare::new(&crate::config::token(entry)?), entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_body_is_metadata_then_modules() {
        let meta = metadata(
            "worker.js",
            &[json!({"type":"d1","name":"DB","database_id":"x"})],
            None,
        );
        let modules = [
            Module {
                name: "worker.js",
                content_type: "application/javascript+module",
                bytes: b"export default {}",
            },
            Module {
                name: "web/p99.css",
                content_type: "text/plain",
                bytes: b"a{}",
            },
        ];
        let body = String::from_utf8(multipart("B", &meta, &modules)).unwrap();
        let parts: Vec<&str> = body.split("--B").collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0], "");
        assert!(parts[1].starts_with(
            "\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{"
        ));
        let sent: Value =
            serde_json::from_str(parts[1].split("\r\n\r\n").nth(1).unwrap().trim_end()).unwrap();
        assert_eq!(sent["main_module"], "worker.js");
        assert_eq!(sent["keep_bindings"], json!(["secret_text"]));
        assert_eq!(
            parts[2],
            "\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\nexport default {}\r\n"
        );
        assert_eq!(
            parts[3],
            "\r\nContent-Disposition: form-data; name=\"web/p99.css\"; filename=\"web/p99.css\"\r\nContent-Type: text/plain\r\n\r\na{}\r\n"
        );
        assert_eq!(parts[4], "--\r\n");
    }

    #[test]
    fn zone_is_the_longest_suffix() {
        let zones = [
            Named {
                id: "1".into(),
                name: "example.com".into(),
            },
            Named {
                id: "2".into(),
                name: "shop.example.com".into(),
            },
            Named {
                id: "3".into(),
                name: "ample.com".into(),
            },
        ];
        assert_eq!(zone_of(&zones, "example.com").unwrap().id, "1");
        assert_eq!(zone_of(&zones, "dev.example.com").unwrap().id, "1");
        assert_eq!(zone_of(&zones, "a.shop.example.com").unwrap().id, "2");
        assert_eq!(zone_of(&zones, "Shop.Example.com.").unwrap().id, "2");
        assert!(zone_of(&zones, "example.org").is_none());
        assert!(zone_of(&zones, "xexample.com").is_none());
    }
}

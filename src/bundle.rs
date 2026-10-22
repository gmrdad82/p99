use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::cli::Global;
use crate::cloudflare::Module;

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub const MAIN: &str = "worker.js";
pub const COMPATIBILITY_DATE: &str = "2026-09-15";

const ES: &str = "application/javascript+module";
const TEXT: &str = "text/plain";

macro_rules! worker {
    ($name:literal, $kind:expr) => {
        (
            $name,
            $kind,
            include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/worker/src/", $name)) as &[u8],
        )
    };
}

macro_rules! migration {
    ($name:literal) => {
        (
            $name,
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/worker/migrations/",
                $name
            )),
        )
    };
}

pub const MODULES: &[(&str, &str, &[u8])] = &[
    worker!("worker.js", ES),
    worker!("mail.js", ES),
    worker!("boards.js", ES),
    worker!("order.js", ES),
    worker!("labels.js", ES),
    worker!("hooks.js", ES),
    worker!("github.js", ES),
    worker!("feed.js", ES),
    worker!("mailer.js", ES),
    worker!("deletes.js", ES),
    worker!("links.js", ES),
    worker!("people.js", ES),
    worker!("tries.js", ES),
    worker!("text.js", ES),
    worker!("license.js", ES),
    worker!("standalone.js", ES),
    worker!("web/p99.js", TEXT),
    worker!("web/panel.js", TEXT),
    worker!("web/board.js", TEXT),
    worker!("web/avatar.js", TEXT),
    worker!("web/shot.js", TEXT),
    worker!("web/p99.css", TEXT),
    worker!("web/app.js", TEXT),
    worker!("web/app.css", TEXT),
    worker!("web/app-first.css", TEXT),
    worker!("web/vendor/modern-screenshot-4.7.0.js", TEXT),
    worker!("web/art/concrete.svg", TEXT),
    worker!("web/art/concrete-dark.svg", TEXT),
    worker!("web/art/lockup-dark.svg", TEXT),
    worker!("web/badges/free.svg", TEXT),
    worker!("web/badges/studio.svg", TEXT),
    worker!("web/badges/agency.svg", TEXT),
    worker!("web/badges/owner.svg", TEXT),
    worker!("web/badges/ff.svg", TEXT),
];

pub const MIGRATIONS: &[(&str, &str)] = &[
    migration!("0001_p99.sql"),
    migration!("0002_code_uid.sql"),
    migration!("0003_code_totp.sql"),
    migration!("0004_boards.sql"),
    migration!("0005_labels.sql"),
    migration!("0006_hooks.sql"),
    migration!("0007_github.sql"),
    migration!("0008_mail.sql"),
    migration!("0009_merge.sql"),
    migration!("0010_deletions.sql"),
    migration!("0011_lanes.sql"),
    migration!("0012_people.sql"),
    migration!("0013_app.sql"),
];

pub const GATED: &[&str] = &["0004", "0011", "0012", "0013"];

pub fn modules() -> Vec<Module<'static>> {
    MODULES
        .iter()
        .map(|&(name, content_type, bytes)| Module {
            name,
            content_type,
            bytes,
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct ModuleInfo {
    pub name: &'static str,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub bytes: usize,
    pub sha256: String,
}

pub fn listing() -> Vec<ModuleInfo> {
    MODULES
        .iter()
        .map(|&(name, kind, bytes)| ModuleInfo {
            name,
            kind,
            bytes: bytes.len(),
            sha256: Sha256::digest(bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        })
        .collect()
}

pub fn run(global: &Global) -> Result<(), String> {
    let modules = listing();
    let migrations: Vec<&str> = MIGRATIONS.iter().map(|m| m.0).collect();
    if global.json {
        let text = serde_json::to_string_pretty(&serde_json::json!({
            "version": VERSION,
            "main": MAIN,
            "modules": modules,
            "migrations": migrations,
        }))
        .map_err(|e| e.to_string())?;
        println!("{text}");
        return Ok(());
    }
    println!("P99 {VERSION}: the Worker this build uploads (main module {MAIN})");
    for m in &modules {
        println!(
            "  {:<42} {:>8} bytes  {}  {}",
            m.name, m.bytes, m.sha256, m.kind
        );
    }
    println!("migrations");
    for name in migrations {
        println!("  {name}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_migration_file_is_bundled_in_order() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/worker/migrations");
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.ends_with(".sql"))
            .collect();
        files.sort();
        let bundled: Vec<&str> = MIGRATIONS.iter().map(|m| m.0).collect();
        assert_eq!(bundled, files);
    }

    #[test]
    fn every_worker_module_and_what_it_imports_is_bundled() {
        let src = concat!(env!("CARGO_MANIFEST_DIR"), "/worker/src");
        let bundled: Vec<&str> = MODULES.iter().map(|m| m.0).collect();
        let mut wanted: Vec<String> = std::fs::read_dir(src)
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.ends_with(".js"))
            .collect();
        for (name, _, bytes) in MODULES.iter().filter(|m| m.1 == ES) {
            let text = std::str::from_utf8(bytes).unwrap();
            let dir = name.rsplit_once('/').map_or("", |(d, _)| d);
            for quote in ["from \"./", "import \"./"] {
                for part in text.split(quote).skip(1) {
                    let path = &part[..part.find('"').unwrap()];
                    wanted.push(if dir.is_empty() {
                        path.to_owned()
                    } else {
                        format!("{dir}/{path}")
                    });
                }
            }
        }
        for file in wanted {
            assert!(bundled.contains(&file.as_str()), "{file} is not bundled");
        }
    }

    #[test]
    fn the_listing_covers_every_module() {
        let listed = listing();
        assert_eq!(listed.len(), MODULES.len());
        for (info, (name, _, bytes)) in listed.iter().zip(MODULES) {
            assert_eq!(info.name, *name);
            assert_eq!(info.bytes, bytes.len());
            assert_eq!(info.sha256.len(), 64);
        }
        assert!(listed.iter().any(|m| m.name == MAIN));
    }

    #[test]
    fn the_upload_runs_under_the_date_the_tests_run_under() {
        let wrangler = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/worker/wrangler.toml"));
        let line = format!("compatibility_date = \"{COMPATIBILITY_DATE}\"");
        assert!(wrangler.lines().any(|l| l.trim() == line));
    }
}

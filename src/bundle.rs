use crate::cloudflare::Module;

pub const MAIN: &str = "worker.js";

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
    worker!("web/p99.js", TEXT),
    worker!("web/panel.js", TEXT),
    worker!("web/p99.css", TEXT),
    worker!("web/vendor/modern-screenshot-4.7.0.js", TEXT),
    worker!("web/art/concrete.svg", TEXT),
    worker!("web/art/concrete-dark.svg", TEXT),
];

pub const MIGRATIONS: &[(&str, &str)] =
    &[migration!("0001_tracker.sql"), migration!("0002_p99.sql")];

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

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

const FOLDERS: [&str; 2] = ["worker", "render/web"];
const HOOKS: [&str; 3] = ["preinstall", "install", "postinstall"];
const SKIPPED_BY_NPMRC: [&str; 3] = ["esbuild", "fsevents", "workerd"];
const FETCHED_BY_PIN: [&str; 2] = ["esbuild", "workerd"];

fn name_of(path: &str) -> &str {
    path.rsplit_once("node_modules/").map_or(path, |(_, n)| n)
}

fn hooks(lock: &Value) -> Vec<String> {
    let Some(packages) = lock["packages"].as_object() else {
        return vec!["no packages".to_owned()];
    };
    let mut found = Vec::new();
    for (path, entry) in packages {
        if path.is_empty() {
            continue;
        }
        let name = name_of(path);
        let scripted = entry["hasInstallScript"].as_bool() == Some(true)
            || HOOKS.iter().any(|hook| !entry["scripts"][hook].is_null());
        if scripted && !SKIPPED_BY_NPMRC.contains(&name) {
            found.push(name.to_owned());
        }
    }
    found.sort();
    found
}

fn unpinned(lock: &Value) -> Vec<String> {
    let Some(packages) = lock["packages"].as_object() else {
        return vec!["no packages".to_owned()];
    };
    let mut found = Vec::new();
    for (path, entry) in packages {
        if path.is_empty() {
            continue;
        }
        let name = name_of(path);
        if !FETCHED_BY_PIN.contains(&name) {
            continue;
        }
        let version = entry["version"].as_str().unwrap_or_default();
        let pinned = |p: &Value| {
            p["resolved"]
                .as_str()
                .is_some_and(|r| r.starts_with("https://"))
                && p["integrity"]
                    .as_str()
                    .is_some_and(|i| i.starts_with("sha512-"))
        };
        if version.is_empty() || !pinned(entry) {
            found.push(format!("{name} is not pinned by version and hash"));
        }
        let Some(platforms) = entry["optionalDependencies"].as_object() else {
            found.push(format!("{name} names no platform packages"));
            continue;
        };
        for (platform, wanted) in platforms {
            let Some(locked) = packages.get(&format!("node_modules/{platform}")) else {
                found.push(format!("{platform} is not in the lockfile"));
                continue;
            };
            if wanted.as_str() != Some(version) || locked["version"].as_str() != Some(version) {
                found.push(format!("{platform} is not at {name}'s version {version}"));
            }
            if !pinned(locked) {
                found.push(format!("{platform} is not pinned by hash"));
            }
        }
    }
    found.sort();
    found
}

fn npmrc_skips_scripts(text: &str) -> bool {
    text.lines()
        .map(str::trim)
        .any(|line| line.replace(' ', "") == "ignore-scripts=true")
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn lock(folder: &str) -> Value {
    let file = root().join(folder).join("package-lock.json");
    serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap()
}

fn lockfiles(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if !name.starts_with('.')
                && !["node_modules", "target", "dist", "tmp"].contains(&name.as_str())
            {
                lockfiles(&path, found);
            }
        } else if name == "package-lock.json" {
            found.push(path);
        }
    }
}

#[test]
fn no_lockfile_holds_an_install_hook_beyond_the_two_binaries_npmrc_skips() {
    for folder in FOLDERS {
        assert_eq!(hooks(&lock(folder)), Vec::<String>::new(), "{folder}");
    }
}

#[test]
fn every_lockfile_in_the_repo_is_one_of_the_checked_folders() {
    let mut found = Vec::new();
    lockfiles(&root(), &mut found);
    let mut found: Vec<String> = found
        .iter()
        .map(|p| {
            p.parent()
                .unwrap()
                .strip_prefix(root())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    found.sort();
    let mut wanted: Vec<String> = FOLDERS.iter().map(|f| (*f).to_owned()).collect();
    wanted.sort();
    assert_eq!(found, wanted);
}

#[test]
fn each_folder_with_a_lockfile_tells_npm_to_skip_install_scripts() {
    for folder in FOLDERS {
        let text = fs::read_to_string(root().join(folder).join(".npmrc"))
            .unwrap_or_else(|_| panic!("{folder} has no .npmrc"));
        assert!(npmrc_skips_scripts(&text), "{folder}: {text}");
    }
}

#[test]
fn esbuild_and_workerd_come_from_platform_packages_pinned_by_version_and_hash() {
    for folder in FOLDERS {
        assert_eq!(unpinned(&lock(folder)), Vec::<String>::new(), "{folder}");
    }
    let worker = lock("worker");
    for name in FETCHED_BY_PIN {
        assert!(
            worker["packages"][format!("node_modules/{name}")]["optionalDependencies"].is_object(),
            "{name}"
        );
    }
}

#[test]
fn a_package_that_gains_an_install_hook_is_named() {
    let lock = json!({"packages": {
        "": {"name": "p99-worker"},
        "node_modules/esbuild": {"version": "1", "hasInstallScript": true},
        "node_modules/left-pad": {"version": "1"},
        "node_modules/native-thing": {"version": "2", "hasInstallScript": true},
        "node_modules/a/node_modules/old-thing": {"version": "3", "scripts": {"postinstall": "node x.js"}},
        "node_modules/prep": {"version": "4", "scripts": {"preinstall": "node y.js"}},
        "node_modules/tests-only": {"version": "5", "scripts": {"test": "node z.js"}},
    }});
    assert_eq!(hooks(&lock), vec!["native-thing", "old-thing", "prep"]);
}

#[test]
fn a_lockfile_with_no_packages_is_refused_not_passed() {
    assert_eq!(hooks(&json!({})), vec!["no packages"]);
    assert_eq!(unpinned(&json!({})), vec!["no packages"]);
}

#[test]
fn a_platform_package_off_the_pin_or_without_a_hash_is_named() {
    let hash = "sha512-abc";
    let url = "https://registry.example.com/x.tgz";
    let lock = json!({"packages": {
        "": {},
        "node_modules/esbuild": {"version": "2.0.0", "resolved": url, "integrity": hash,
            "optionalDependencies": {"@esbuild/a": "2.0.0", "@esbuild/b": "2.0.0", "@esbuild/c": "2.0.0", "@esbuild/d": "1.0.0"}},
        "node_modules/@esbuild/a": {"version": "2.0.0", "resolved": url, "integrity": hash},
        "node_modules/@esbuild/b": {"version": "2.0.0"},
        "node_modules/@esbuild/d": {"version": "1.0.0", "resolved": url, "integrity": hash},
        "node_modules/workerd": {"version": "3.0.0"},
    }});
    assert_eq!(
        unpinned(&lock),
        vec![
            "@esbuild/b is not pinned by hash",
            "@esbuild/c is not in the lockfile",
            "@esbuild/d is not at esbuild's version 2.0.0",
            "workerd is not pinned by version and hash",
            "workerd names no platform packages",
        ]
    );
}

#[test]
fn an_npmrc_has_to_say_ignore_scripts_true_and_nothing_weaker() {
    assert!(npmrc_skips_scripts("ignore-scripts=true\n"));
    assert!(npmrc_skips_scripts(
        "save-exact=true\n ignore-scripts = true\n"
    ));
    assert!(!npmrc_skips_scripts("ignore-scripts=false\n"));
    assert!(!npmrc_skips_scripts("# ignore-scripts=true\n"));
    assert!(!npmrc_skips_scripts(""));
}

use std::fs;
use std::path::{Path, PathBuf};

const DIRS: [&str; 3] = ["render", "scripts", "bin"];

fn walk(dir: &Path, root: &Path, hits: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if entry.file_name() != "node_modules" {
                walk(&path, root, hits);
            }
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let text = text.to_lowercase();
        if text.contains("ffmpeg") || text.contains("ffprobe") {
            let rel = path.strip_prefix(root).unwrap();
            hits.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn hits(root: &Path) -> Vec<String> {
    let mut hits = Vec::new();
    for dir in DIRS {
        walk(&root.join(dir), root, &mut hits);
    }
    hits.sort();
    hits
}

#[test]
fn render_scripts_and_bin_call_pcod_not_ffmpeg() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    assert!(root.join("render/web/pitomd.mjs").is_file());
    assert_eq!(hits(&root), Vec::<String>::new());
}

#[test]
fn an_ffmpeg_or_ffprobe_call_is_named_wherever_it_hides() {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("no-ffmpeg");
    let _ = fs::remove_dir_all(&root);
    let files: [(&str, &[u8]); 7] = [
        ("bin/encode", b"#!/bin/sh\nffprobe -v error in.mp4\n"),
        (
            "render/web/gif.mjs",
            b"execFileSync(\"FFmpeg\", [\"-i\", web]);\n",
        ),
        ("scripts/deep/clip.sh", b"exec ffmpeg -y \"$@\"\n"),
        (
            "render/web/pitomd.mjs",
            b"execFileSync(\"pcod\", [\"frames\"]);\n",
        ),
        ("render/web/node_modules/playwright/ffmpeg.js", b"ffmpeg\n"),
        ("render/web/frame.png", b"\xff\xfe\x00ffmpeg\xc3\x28"),
        ("docs/media.md", b"ffmpeg is gone\n"),
    ];
    for (name, body) in files {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }
    assert_eq!(
        hits(&root),
        ["bin/encode", "render/web/gif.mjs", "scripts/deep/clip.sh"]
    );
}

#[test]
fn a_tree_without_the_folders_has_no_hits() {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("no-ffmpeg-empty");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    assert!(hits(&root).is_empty());
}

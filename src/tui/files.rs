use std::path::{Path, PathBuf};

use crate::wire::{ATTACHMENT_LIMIT, Download, content_type};

use super::source::Source;

pub struct Upload {
    pub name: String,
    pub kind: &'static str,
    pub bytes: Vec<u8>,
}

pub fn paths(typed: &str) -> Result<Vec<PathBuf>, String> {
    let mut found = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = typed.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                started = true;
            }
            (None, '\\') => {
                if let Some(next) = chars.next() {
                    word.push(next);
                    started = true;
                }
            }
            (None, c) if c.is_whitespace() => {
                if started {
                    found.push(home(&std::mem::take(&mut word)));
                    started = false;
                }
            }
            (None, c) => {
                word.push(c);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("a quote around a path is never closed".into());
    }
    if started {
        found.push(home(&word));
    }
    Ok(found)
}

fn home(word: &str) -> PathBuf {
    match word.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME").map_or_else(
            || PathBuf::from(word),
            |home| PathBuf::from(home).join(rest),
        ),
        None => PathBuf::from(word),
    }
}

pub fn read(path: &Path) -> Result<Upload, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_owned();
    let kind = content_type(&name).ok_or_else(|| {
        format!("{name}: P99 takes images, PDFs, text, CSV, JSON, zip and office files")
    })?;
    let bytes = std::fs::read(path).map_err(|e| format!("{name}: {e}"))?;
    if bytes.len() > ATTACHMENT_LIMIT {
        return Err(format!("{name} is over 20 MB"));
    }
    Ok(Upload { name, kind, bytes })
}

pub fn read_all(paths: &[PathBuf]) -> Result<Vec<Upload>, String> {
    paths.iter().map(|path| read(path)).collect()
}

pub fn size(bytes: i64) -> String {
    match bytes.max(0) {
        b if b < 1024 => format!("{b} B"),
        b if b < 1024 * 1024 => format!("{} KB", (b + 1023) / 1024),
        b => format!("{:.1} MB", b as f64 / (1024.0 * 1024.0)),
    }
}

pub fn free_name(dir: &Path, name: &str, id: i64) -> PathBuf {
    let name = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && *n != "." && *n != "..")
        .map_or_else(|| format!("file-{id}"), str::to_owned);
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_owned(), format!(".{extension}")),
        _ => (name.clone(), String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}{extension}")))
        .find(|path| !path.exists())
        .unwrap_or(first)
}

pub fn save(dir: &Path, id: i64, file: &Download) -> Result<String, String> {
    let target = free_name(dir, &file.name, id);
    std::fs::write(&target, &file.bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(format!(
        "Saved {} ({}) to {}",
        file.name,
        size(file.bytes.len() as i64),
        target.display()
    ))
}

impl Source {
    pub fn download(&self, space: usize, host: Option<&str>, id: i64) -> Result<Download, String> {
        match self {
            Source::Demo(..) => self.sample(|demo| demo.download(id)),
            _ => self.client(space, host)?.download(id),
        }
    }

    pub fn reply(
        &self,
        space: usize,
        host: Option<&str>,
        key: &str,
        body: &str,
        internal: bool,
        files: &[PathBuf],
    ) -> Result<usize, String> {
        let uploads = read_all(files)?;
        let made = self.comment(space, host, key, body, internal)?;
        self.attach(space, host, key, &uploads, Some(made.id))
            .map_err(|why| format!("Replied on {key}, but {why}"))
    }

    pub fn attach(
        &self,
        space: usize,
        host: Option<&str>,
        key: &str,
        uploads: &[Upload],
        comment: Option<i64>,
    ) -> Result<usize, String> {
        if uploads.is_empty() {
            return Ok(0);
        }
        let failed = |upload: &Upload, why: String| format!("{} didn't upload: {why}", upload.name);
        match self {
            Source::Demo(..) => self.sample(|demo| {
                for upload in uploads {
                    demo.attach(key, upload, comment)
                        .map_err(|why| failed(upload, why))?;
                }
                Ok(uploads.len())
            }),
            _ => {
                let client = self.client(space, host)?;
                for upload in uploads {
                    client
                        .attach(key, &upload.name, upload.kind, &upload.bytes, comment)
                        .map_err(|why| failed(upload, why))?;
                }
                Ok(uploads.len())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("tmp")
            .join(format!("p99-tui-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch folder");
        dir
    }

    #[test]
    fn typed_paths_split_on_spaces_and_keep_quoted_or_escaped_ones_whole() {
        let found = paths(r#"shot.png 'Screen Shot 1.png' "a b.txt" c\ d.pdf  "#).expect("paths");
        assert_eq!(
            found,
            ["shot.png", "Screen Shot 1.png", "a b.txt", "c d.pdf"].map(PathBuf::from)
        );
        assert!(paths("   ").expect("none").is_empty());
        assert_eq!(
            paths("'open.png").err().as_deref(),
            Some("a quote around a path is never closed")
        );
    }

    #[test]
    fn a_path_from_home_starts_at_home() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        assert_eq!(
            paths("~/shot.png").expect("a path"),
            [PathBuf::from(home).join("shot.png")]
        );
    }

    #[test]
    fn a_file_reads_with_its_type_and_an_unknown_type_or_a_missing_file_says_why() {
        let dir = scratch("read");
        let note = dir.join("note.txt");
        std::fs::write(&note, "hello").expect("a note");
        let upload = read(&note).expect("it reads");
        assert_eq!(
            (upload.name.as_str(), upload.kind, upload.bytes.as_slice()),
            ("note.txt", "text/plain", &b"hello"[..])
        );
        let odd = dir.join("tool.exe");
        std::fs::write(&odd, "x").expect("a file");
        assert!(read(&odd).err().is_some_and(|why| {
            why.ends_with("P99 takes images, PDFs, text, CSV, JSON, zip and office files")
        }),);
        assert!(
            read(&dir.join("gone.png"))
                .err()
                .is_some_and(|why| why.starts_with("gone.png: "))
        );
    }

    #[test]
    fn a_saved_file_never_overwrites_one_already_there() {
        let dir = scratch("save");
        let file = Download {
            name: "shot.png".into(),
            content_type: "image/png".into(),
            bytes: vec![1, 2, 3],
        };
        let first = save(&dir, 7, &file).expect("saved");
        assert!(first.starts_with("Saved shot.png (3 B) to "), "{first}");
        let second = save(&dir, 7, &file).expect("saved again");
        assert!(second.ends_with("shot-2.png"), "{second}");
        assert!(dir.join("shot.png").exists() && dir.join("shot-2.png").exists());
        let odd = Download {
            name: "..".into(),
            ..file
        };
        assert!(save(&dir, 9, &odd).expect("saved").ends_with("file-9"));
    }

    #[test]
    fn sizes_read_in_bytes_kilobytes_or_megabytes() {
        assert_eq!(size(0), "0 B");
        assert_eq!(size(1023), "1023 B");
        assert_eq!(size(1025), "2 KB");
        assert_eq!(size(3 * 1024 * 1024 + 512 * 1024), "3.5 MB");
    }
}

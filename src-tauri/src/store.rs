//! 履歴のディスク保存。固定した項目は常に、それ以外は設定が有効なときだけ保存する。
//!
//! 一覧は `index.json` に、画像は `img-<ハッシュ>.png` と `.thumb.png` に分けて置く。
//! 画像のファイルは新しいものだけ書き、参照されなくなったものは消す。

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::history::{Content, History, Item, RichFormat, StoredImage};
use crate::save;

const INDEX_FILE: &str = "index.json";
const IMAGE_PREFIX: &str = "img-";
const IMAGE_SUFFIX: &str = ".png";
const THUMB_SUFFIX: &str = ".thumb.png";

#[derive(Serialize, Deserialize)]
struct RichRecord {
    name: String,
    /// Base64 にした中身。
    data: String,
}

#[derive(Serialize, Deserialize)]
struct ImageRecord {
    hash: u64,
    width: u32,
    height: u32,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Record {
    text: Option<String>,
    rich: Vec<RichRecord>,
    image: Option<ImageRecord>,
    paths: Option<Vec<String>>,
    formats: Vec<String>,
    pinned: bool,
    updated_at: u64,
}

fn to_record(item: &Item) -> Record {
    let mut record = Record {
        formats: item.formats.clone(),
        pinned: item.pinned,
        updated_at: item.updated_at,
        ..Record::default()
    };
    match &item.content {
        Content::Text { text, rich } => {
            record.text = Some(text.clone());
            record.rich = rich
                .iter()
                .map(|format| RichRecord {
                    name: format.name.clone(),
                    data: BASE64.encode(&format.data),
                })
                .collect();
        }
        Content::Image(image) => {
            record.image = Some(ImageRecord {
                hash: image.hash,
                width: image.width,
                height: image.height,
            });
        }
        Content::Files(paths) => record.paths = Some(paths.clone()),
    }
    record
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join(INDEX_FILE)
    }

    fn image_path(&self, hash: u64, thumb: bool) -> PathBuf {
        let suffix = if thumb { THUMB_SUFFIX } else { IMAGE_SUFFIX };
        self.dir.join(format!("{IMAGE_PREFIX}{hash:016x}{suffix}"))
    }

    fn restore(&self, record: Record) -> Option<Content> {
        if let Some(text) = record.text {
            let rich = record
                .rich
                .iter()
                .filter_map(|format| {
                    Some(RichFormat {
                        name: format.name.clone(),
                        data: BASE64.decode(&format.data).ok()?,
                    })
                })
                .collect();
            return Some(Content::Text { text, rich });
        }
        if let Some(image) = record.image {
            let png = fs::read(self.image_path(image.hash, false)).ok()?;
            let thumbnail = fs::read(self.image_path(image.hash, true)).ok()?;
            return Some(Content::Image(StoredImage {
                png: Arc::new(png),
                thumbnail: Arc::new(thumbnail),
                width: image.width,
                height: image.height,
                hash: image.hash,
            }));
        }
        record.paths.map(Content::Files)
    }

    /// 保存してある項目を履歴の末尾に足す。読めない項目は飛ばす。
    pub fn load(&self, history: &mut History) -> Result<(), String> {
        let bytes = match fs::read(self.index_path()) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        let records: Vec<Record> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        for record in records {
            let formats = record.formats.clone();
            let (pinned, updated_at) = (record.pinned, record.updated_at);
            if let Some(content) = self.restore(record) {
                history.append_loaded(content, formats, pinned, updated_at);
            }
        }
        Ok(())
    }

    /// 履歴を書く。`persist_all` が偽なら固定した項目だけを書く。
    pub fn save(&self, history: &History, persist_all: bool) -> Result<(), String> {
        let items: Vec<&Item> = history
            .items()
            .iter()
            .filter(|item| item.pinned || persist_all)
            .collect();
        if items.is_empty() {
            return self.clear();
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;

        let records: Vec<Record> = items.iter().map(|item| to_record(item)).collect();
        let json = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
        save::write_atomically(&self.index_path(), &json)?;

        let mut referenced = HashSet::new();
        for item in &items {
            let Content::Image(image) = &item.content else {
                continue;
            };
            for (thumb, bytes) in [(false, &image.png), (true, &image.thumbnail)] {
                let path = self.image_path(image.hash, thumb);
                if !path.exists() {
                    save::write_atomically(&path, bytes)?;
                }
                referenced.insert(path);
            }
        }
        self.remove_images_except(&referenced);
        Ok(())
    }

    /// 保存してある履歴をすべて消す。
    pub fn clear(&self) -> Result<(), String> {
        match fs::remove_file(self.index_path()) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        self.remove_images_except(&HashSet::new());
        Ok(())
    }

    fn remove_images_except(&self, keep: &HashSet<PathBuf>) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if is_image_file(&path) && !keep.contains(&path) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn is_image_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(IMAGE_PREFIX) && name.ends_with(IMAGE_SUFFIX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> Store {
        let dir = std::env::temp_dir().join(format!("clipglass-store-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Store::new(dir)
    }

    fn sample_history() -> History {
        let mut history = History::default();
        history.insert(
            Content::Image(StoredImage {
                png: Arc::new(vec![1, 2, 3]),
                thumbnail: Arc::new(vec![4]),
                width: 2,
                height: 1,
                hash: 0xabc,
            }),
            vec!["PNG".into()],
            1,
        );
        history.insert(Content::Files(vec!["C:\\a.txt".into()]), Vec::new(), 2);
        let text_id = history.insert(
            Content::Text {
                text: "本文".into(),
                rich: vec![RichFormat {
                    name: "HTML Format".into(),
                    data: b"<b>x</b>".to_vec(),
                }],
            },
            vec!["CF_UNICODETEXT".into(), "HTML Format".into()],
            3,
        );
        history.set_pinned(text_id, true);
        history
    }

    fn texts(history: &History) -> Vec<String> {
        history
            .items()
            .iter()
            .map(|item| match &item.content {
                Content::Text { text, .. } => text.clone(),
                Content::Image(image) => format!("image:{:x}", image.hash),
                Content::Files(paths) => paths.join("|"),
            })
            .collect()
    }

    #[test]
    fn everything_roundtrips_when_persisting_all() {
        let store = temp_store("all");
        let original = sample_history();
        store.save(&original, true).unwrap();

        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert_eq!(texts(&loaded), texts(&original));
        let item = &loaded.items()[0];
        assert!(item.pinned);
        assert_eq!(item.updated_at, 3);
        assert_eq!(item.formats, original.items()[0].formats);
        match &item.content {
            Content::Text { rich, .. } => assert_eq!(rich[0].data, b"<b>x</b>"),
            _ => panic!("テキストではありません"),
        }
        match &loaded.items()[2].content {
            Content::Image(image) => {
                assert_eq!(*image.png, vec![1, 2, 3]);
                assert_eq!(*image.thumbnail, vec![4]);
                assert_eq!((image.width, image.height, image.hash), (2, 1, 0xabc));
            }
            _ => panic!("画像ではありません"),
        }
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn only_pinned_items_are_kept_when_not_persisting() {
        let store = temp_store("pinned");
        store.save(&sample_history(), false).unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert_eq!(texts(&loaded), ["本文"]);
        assert!(!store.image_path(0xabc, false).exists());
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn unreferenced_images_are_removed_and_empty_history_leaves_no_index() {
        let store = temp_store("cleanup");
        let mut history = sample_history();
        store.save(&history, true).unwrap();
        assert!(store.image_path(0xabc, true).exists());

        let image_id = history.items()[2].id;
        assert!(history.remove(image_id));
        store.save(&history, true).unwrap();
        assert!(!store.image_path(0xabc, false).exists());
        assert!(!store.image_path(0xabc, true).exists());

        store.save(&History::default(), true).unwrap();
        assert!(!store.index_path().exists());
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert!(loaded.items().is_empty());
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn items_with_missing_image_files_are_skipped() {
        let store = temp_store("missing");
        store.save(&sample_history(), true).unwrap();
        fs::remove_file(store.image_path(0xabc, false)).unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert_eq!(texts(&loaded), ["本文", "C:\\a.txt"]);
        fs::remove_dir_all(&store.dir).unwrap();
    }
}

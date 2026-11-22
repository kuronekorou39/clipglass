//! 履歴のディスク保存。設定が有効なときだけ、一覧にある項目を保存する。
//!
//! 一覧は `index.json` に、画像は `img-<ハッシュ>.png` と `.thumb.png` に分けて置く。
//! 画像のファイルは新しいものだけ書き、参照されなくなったものは消す。

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
/// 読めなかった履歴フォルダーの退避先に付ける接尾辞。後ろに日時が付く。
const BROKEN_SUFFIX: &str = ".broken-";
/// 一覧から外れた項目の保管先(`archive.rs`)。履歴フォルダーの中に置く。
pub const ARCHIVE_DIR: &str = "archive";

#[derive(Serialize, Deserialize)]
pub(crate) struct RichRecord {
    name: String,
    /// Base64 にした中身。
    data: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ImageRecord {
    pub hash: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Record {
    pub text: Option<String>,
    pub rich: Vec<RichRecord>,
    pub image: Option<ImageRecord>,
    pub paths: Option<Vec<String>>,
    pub formats: Vec<String>,
    /// 0.7 までの「固定」。読むだけで、もう書かない(お気に入りへ移す)。
    #[serde(skip_serializing)]
    pub pinned: bool,
    pub updated_at: u64,
}

pub(crate) fn to_record(item: &Item) -> Record {
    let mut record = Record {
        formats: item.formats.clone(),
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

pub(crate) fn image_file_name(hash: u64, thumb: bool) -> String {
    let suffix = if thumb { THUMB_SUFFIX } else { IMAGE_SUFFIX };
    format!("{IMAGE_PREFIX}{hash:016x}{suffix}")
}

/// 画像とサムネイルを `dir` に書く。すでにあるファイルは書き直さない。
pub(crate) fn write_images(dir: &Path, image: &StoredImage) -> Result<(), String> {
    for (thumb, bytes) in [(false, &image.png), (true, &image.thumbnail)] {
        let path = dir.join(image_file_name(image.hash, thumb));
        if !path.exists() {
            save::write_atomically(&path, bytes)?;
        }
    }
    Ok(())
}

/// 記録を履歴の内容に戻す。画像は `image_dir` から読む。読めなければ `None`。
pub(crate) fn restore(record: Record, image_dir: &Path) -> Option<Content> {
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
        let png = fs::read(image_dir.join(image_file_name(image.hash, false))).ok()?;
        let thumbnail = fs::read(image_dir.join(image_file_name(image.hash, true))).ok()?;
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

/// `dir` の直下にある画像のファイルのうち、`keep` にないものを消す。
pub(crate) fn remove_images_except(dir: &Path, keep: &HashSet<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_image_file(&path) && !keep.contains(&path) {
            let _ = fs::remove_file(path);
        }
    }
}

pub struct Store {
    dir: PathBuf,
    /// 読めなかった履歴や設定を上書きしないよう、この起動のあいだ保存を止めているか。
    writes_held: AtomicBool,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            writes_held: AtomicBool::new(false),
        }
    }

    pub fn hold_writes(&self) {
        self.writes_held.store(true, Ordering::Relaxed);
    }

    pub fn writes_held(&self) -> bool {
        self.writes_held.load(Ordering::Relaxed)
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join(INDEX_FILE)
    }

    #[cfg(test)]
    fn image_path(&self, hash: u64, thumb: bool) -> PathBuf {
        self.dir.join(image_file_name(hash, thumb))
    }

    /// 保存してある項目を履歴の末尾に足す。読めない項目は飛ばす。
    ///
    /// 一覧そのものが読めない場合は、次の保存で消してしまわないよう
    /// フォルダーごと退避してから失敗を返す。
    ///
    /// 0.7 までに固定してあった文字を返す。呼び出し側がお気に入りへ移す。
    pub fn load(&self, history: &mut History) -> Result<Vec<String>, String> {
        let bytes = match fs::read(self.index_path()) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => {
                // 一時的に読めないだけかもしれないので、次の保存で上書きしない
                self.hold_writes();
                return Err(e.to_string());
            }
        };
        let records: Vec<Record> = match serde_json::from_slice(&bytes) {
            Ok(records) => records,
            Err(e) => {
                let backup = self.move_aside().inspect_err(|_| self.hold_writes())?;
                return Err(format!(
                    "{e}(読めなかった履歴は {} に退避しました)",
                    backup.display()
                ));
            }
        };
        let mut pinned_texts = Vec::new();
        for record in records {
            let formats = record.formats.clone();
            let (pinned, updated_at) = (record.pinned, record.updated_at);
            if let Some(content) = restore(record, &self.dir) {
                if let (true, Content::Text { text, .. }) = (pinned, &content) {
                    pinned_texts.push(text.clone());
                }
                history.append_loaded(content, formats, updated_at);
            }
        }
        Ok(pinned_texts)
    }

    /// 履歴を書く。`persist` が偽なら、保存してあるものを消す。
    /// 保存を止めているあいだは、利用者が保存を切ったときの消去だけを行う。
    pub fn save(&self, history: &History, persist: bool) -> Result<(), String> {
        if !persist {
            return self.clear();
        }
        if self.writes_held() {
            return Ok(());
        }
        let items = history.items();
        if items.is_empty() {
            return self.clear();
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;

        let records: Vec<Record> = items.iter().map(to_record).collect();
        let json = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
        save::write_atomically(&self.index_path(), &json)?;

        let mut referenced = HashSet::new();
        for item in items {
            let Content::Image(image) = &item.content else {
                continue;
            };
            write_images(&self.dir, image)?;
            for thumb in [false, true] {
                referenced.insert(self.dir.join(image_file_name(image.hash, thumb)));
            }
        }
        remove_images_except(&self.dir, &referenced);
        Ok(())
    }

    /// フォルダーを日時付きの名前に変えて退避する。保管(`archive`)は壊れていないので残す。
    fn move_aside(&self) -> Result<PathBuf, String> {
        let name = self
            .dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("history");
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let backup = self
            .dir
            .with_file_name(format!("{name}{BROKEN_SUFFIX}{stamp}"));
        fs::rename(&self.dir, &backup).map_err(|e| e.to_string())?;
        let archive = backup.join(ARCHIVE_DIR);
        if archive.is_dir() && fs::create_dir_all(&self.dir).is_ok() {
            let _ = fs::rename(&archive, self.dir.join(ARCHIVE_DIR));
        }
        Ok(backup)
    }

    /// 読めなかったときに退避したフォルダー(`history.broken-<日時>`)を消す。
    /// 履歴が空になるたびに呼ぶ `clear` とは分け、保存を切ったときだけ使う。
    pub fn remove_backups(&self) -> Result<(), String> {
        let (Some(parent), Some(name)) = (
            self.dir.parent(),
            self.dir.file_name().and_then(|name| name.to_str()),
        ) else {
            return Ok(());
        };
        let prefix = format!("{name}{BROKEN_SUFFIX}");
        let Ok(entries) = fs::read_dir(parent) else {
            return Ok(());
        };
        for entry in entries.flatten() {
            let is_backup = entry.file_name().to_string_lossy().starts_with(&prefix);
            if is_backup && entry.path().is_dir() {
                fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// 保存してある履歴をすべて消す。
    pub fn clear(&self) -> Result<(), String> {
        match fs::remove_file(self.index_path()) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        remove_images_except(&self.dir, &HashSet::new());
        Ok(())
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
        let dir =
            std::env::temp_dir().join(format!("clipglass-store-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Store::new(dir)
    }

    #[test]
    fn remove_backups_deletes_only_this_stores_broken_folders() {
        let root = std::env::temp_dir().join(format!("clipglass-backups-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let store = Store::new(root.join("history"));
        fs::create_dir_all(root.join("history")).unwrap();
        fs::create_dir_all(root.join("history.broken-20260101-000000")).unwrap();
        fs::create_dir_all(root.join("history.other")).unwrap();
        fs::write(root.join("history.broken-file"), b"x").unwrap();

        store.remove_backups().unwrap();

        assert!(!root.join("history.broken-20260101-000000").exists());
        assert!(root.join("history").is_dir());
        assert!(root.join("history.other").is_dir());
        assert!(root.join("history.broken-file").is_file());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn held_writes_keep_the_saved_index_until_saving_is_turned_off() {
        let store = temp_store("held");
        store.save(&sample_history(), true).unwrap();
        let saved = fs::read(store.index_path()).unwrap();
        store.hold_writes();
        // 空の履歴でも、別の内容でも、保存してあるものを変えない
        store.save(&History::default(), true).unwrap();
        let mut other = History::default();
        other.insert(
            Content::Text {
                text: "new".into(),
                rich: Vec::new(),
            },
            Vec::new(),
            1,
        );
        store.save(&other, true).unwrap();
        assert_eq!(fs::read(store.index_path()).unwrap(), saved);
        // 利用者が保存を切ったときは消す
        store.save(&other, false).unwrap();
        assert!(!store.index_path().exists());
        fs::remove_dir_all(&store.dir).unwrap();
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
        history.insert(
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
    fn nothing_is_kept_when_not_persisting() {
        let store = temp_store("off");
        store.save(&sample_history(), true).unwrap();
        store.save(&sample_history(), false).unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert!(loaded.items().is_empty());
        assert!(!store.index_path().exists());
        assert!(!store.image_path(0xabc, false).exists());
        let _ = fs::remove_dir_all(&store.dir);
    }

    #[test]
    fn pinned_texts_of_older_versions_are_returned_and_not_written_back() {
        let store = temp_store("pinned");
        fs::create_dir_all(&store.dir).unwrap();
        let json =
            r#"[{"text":"keep","pinned":true},{"text":"plain"},{"paths":["C:/a"],"pinned":true}]"#;
        fs::write(store.index_path(), json).unwrap();
        let mut loaded = History::default();
        // 固定してあった文字だけを返す。項目そのものは普通の履歴として残る
        assert_eq!(store.load(&mut loaded).unwrap(), ["keep"]);
        assert_eq!(texts(&loaded), ["keep", "plain", "C:/a"]);
        store.save(&loaded, true).unwrap();
        assert!(!fs::read_to_string(store.index_path())
            .unwrap()
            .contains("pinned"));
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn archive_survives_moving_a_broken_history_aside() {
        let store = temp_store("keep-archive");
        let archive = store.dir.join(ARCHIVE_DIR);
        fs::create_dir_all(&archive).unwrap();
        fs::write(archive.join("x"), b"1").unwrap();
        fs::write(store.index_path(), b"{not json").unwrap();
        let backup = store.move_aside().unwrap();
        assert_eq!(fs::read(archive.join("x")).unwrap(), b"1");
        assert!(!backup.join(ARCHIVE_DIR).exists());
        fs::remove_dir_all(&store.dir).unwrap();
        fs::remove_dir_all(&backup).unwrap();
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
    fn broken_index_is_moved_aside_instead_of_being_overwritten() {
        let store = temp_store("broken");
        store.save(&sample_history(), true).unwrap();
        fs::write(store.index_path(), b"{not json").unwrap();

        let mut loaded = History::default();
        let error = store.load(&mut loaded).unwrap_err();
        assert!(error.contains("退避"), "{error}");
        assert!(loaded.items().is_empty());
        assert!(!store.dir.exists());

        // 退避先に元のファイルがそのまま残る
        let parent = store.dir.parent().unwrap();
        let prefix = format!(
            "{}{BROKEN_SUFFIX}",
            store.dir.file_name().unwrap().to_str().unwrap()
        );
        let backup = fs::read_dir(parent)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix))
            })
            .expect("退避先がありません");
        assert_eq!(fs::read(backup.join(INDEX_FILE)).unwrap(), b"{not json");
        assert!(backup
            .join(store.image_path(0xabc, false).file_name().unwrap())
            .exists());

        // 退避したあとは、何もなかったときと同じように保存できる
        store.save(&sample_history(), true).unwrap();
        let mut reloaded = History::default();
        store.load(&mut reloaded).unwrap();
        assert_eq!(reloaded.items().len(), 3);
        fs::remove_dir_all(&store.dir).unwrap();
        fs::remove_dir_all(&backup).unwrap();
    }

    #[test]
    fn invalid_rich_data_is_dropped_but_text_survives() {
        let store = temp_store("rich");
        fs::create_dir_all(&store.dir).unwrap();
        let json = r#"[{"text":"a","rich":[{"name":"HTML Format","data":"%%%"},{"name":"Rich Text Format","data":"b2s="}],"pinned":true}]"#;
        fs::write(store.index_path(), json).unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        match &loaded.items()[0].content {
            Content::Text { text, rich } => {
                assert_eq!(text, "a");
                assert_eq!(rich.len(), 1);
                assert_eq!(rich[0].name, "Rich Text Format");
                assert_eq!(rich[0].data, b"ok");
            }
            _ => panic!("テキストではありません"),
        }
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn records_without_content_are_skipped_and_order_is_kept() {
        let store = temp_store("order");
        fs::create_dir_all(&store.dir).unwrap();
        let json = r#"[{"text":"first"},{"formats":["x"]},{"paths":["C:\\b"]},{"text":"last","updatedAt":5}]"#;
        fs::write(store.index_path(), json).unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert_eq!(texts(&loaded), ["first", "C:\\b", "last"]);
        assert_eq!(loaded.items()[2].updated_at, 5);
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn clear_on_missing_dir_is_not_an_error() {
        let store = temp_store("nodir");
        store.clear().unwrap();
        let mut loaded = History::default();
        store.load(&mut loaded).unwrap();
        assert!(loaded.items().is_empty());
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

    #[test]
    fn unreadable_index_holds_writes_and_keeps_it() {
        let store = temp_store("index-dir");
        // 一覧がフォルダーだと読めない(一時的に読めない場合と同じ経路)
        fs::create_dir_all(store.index_path()).unwrap();
        let mut history = History::default();
        assert!(store.load(&mut history).is_err());
        assert!(store.writes_held());
        assert!(store.index_path().is_dir());
        assert!(history.items().is_empty());
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn clear_reports_error_when_index_cannot_be_removed() {
        let store = temp_store("clear-dir");
        fs::create_dir_all(store.index_path()).unwrap();
        assert!(store.clear().is_err());
        fs::remove_dir_all(&store.dir).unwrap();
    }

    #[test]
    fn write_images_fails_when_folder_is_missing() {
        let store = temp_store("no-folder");
        let image = StoredImage {
            png: std::sync::Arc::new(vec![1]),
            thumbnail: std::sync::Arc::new(vec![2]),
            width: 1,
            height: 1,
            hash: 1,
        };
        assert!(write_images(&store.dir, &image).is_err());
        assert!(!store.dir.exists());
    }

    #[test]
    fn remove_backups_ignores_paths_without_a_readable_parent() {
        // 親のないパスでは何も消さない
        assert!(Store::new(PathBuf::new()).remove_backups().is_ok());
        let missing = temp_store("no-parent").dir.join("missing").join("history");
        assert!(Store::new(missing).remove_backups().is_ok());
    }
}

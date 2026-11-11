//! 一覧の上限を超えて外れた項目の保管。数日前の内容をさかのぼって探せるようにする。
//!
//! 履歴フォルダーの `archive\<年-月-日>\` に、その日に最後に使った項目を置く。
//! 一覧は1行1件の `index.jsonl`(追記するだけで済む)、画像は同じフォルダーに置く。
//! 整理は日ごとのフォルダー単位で行う。保管する日数を過ぎた日と、全体の大きさが
//! 上限を超えたときの古い日を、フォルダーごと消す。

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{Days, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

use crate::history::{Content, Item};
use crate::limits::ARCHIVE_PREVIEW_CHARS;
use crate::save;
use crate::store::{self, Record};

const INDEX_FILE: &str = "index.jsonl";
const DAY_FORMAT: &str = "%Y-%m-%d";
/// 記録を指す名前(`<日>/<番号>`)の区切り。
const KEY_SEPARATOR: char = '/';

/// 最後に配った番号。同じミリ秒に続けて保管しても重ならないようにする。
static LAST_KEY: AtomicU64 = AtomicU64::new(0);

fn next_key(now_ms: u64) -> u64 {
    let candidate = now_ms.saturating_mul(1000);
    let previous = LAST_KEY
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |last| {
            Some(candidate.max(last + 1))
        })
        .unwrap_or_default();
    candidate.max(previous + 1)
}

#[derive(Serialize, Deserialize)]
struct Entry {
    key: u64,
    #[serde(flatten)]
    record: Record,
}

/// 保管してある1件の、一覧に出す分。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedView {
    /// 戻すときに渡す名前(`<日>/<番号>`)。
    pub key: String,
    pub day: String,
    pub kind: &'static str,
    pub text: Option<String>,
    pub char_count: Option<usize>,
    pub truncated: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub paths: Option<Vec<String>>,
    /// サムネイルを取り出すための画像のハッシュ(16進)。
    pub image_hash: Option<String>,
    pub updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<ArchivedView>,
    /// まだ続きがあるか。
    pub has_more: bool,
}

fn kind_of(record: &Record) -> Option<&'static str> {
    if record.text.is_some() {
        Some("text")
    } else if record.image.is_some() {
        Some("image")
    } else if record.paths.is_some() {
        Some("files")
    } else {
        None
    }
}

/// 検索語(小文字にしてある)と種類に合うか。画像は文字を持たないので、検索語があれば外れる。
fn matches(record: &Record, needle: &str, kinds: &[String]) -> bool {
    let Some(kind) = kind_of(record) else {
        return false;
    };
    if !kinds.iter().any(|wanted| wanted == kind) {
        return false;
    }
    if needle.is_empty() {
        return true;
    }
    if let Some(text) = &record.text {
        return text.to_lowercase().contains(needle);
    }
    record
        .paths
        .iter()
        .flatten()
        .any(|path| path.to_lowercase().contains(needle))
}

fn view(day: &str, entry: Entry) -> ArchivedView {
    let kind = kind_of(&entry.record).unwrap_or("text");
    let record = entry.record;
    let char_count = record.text.as_ref().map(|text| text.chars().count());
    ArchivedView {
        key: format!("{day}{KEY_SEPARATOR}{}", entry.key),
        day: day.to_string(),
        kind,
        text: record
            .text
            .map(|text| text.chars().take(ARCHIVE_PREVIEW_CHARS).collect()),
        char_count,
        truncated: char_count.is_some_and(|count| count > ARCHIVE_PREVIEW_CHARS),
        width: record.image.as_ref().map(|image| image.width),
        height: record.image.as_ref().map(|image| image.height),
        paths: record.paths,
        image_hash: record.image.map(|image| format!("{:016x}", image.hash)),
        updated_at: record.updated_at,
    }
}

/// その項目を最後に使った日(ローカル時刻)。
fn day_of(updated_at: u64, fallback: NaiveDate) -> NaiveDate {
    Local
        .timestamp_millis_opt(updated_at as i64)
        .single()
        .map(|time| time.date_naive())
        .unwrap_or(fallback)
}

fn parse_day(name: &str) -> Option<NaiveDate> {
    let day = NaiveDate::parse_from_str(name, DAY_FORMAT).ok()?;
    // "2026-1-5" のような別の書き方や、フォルダーをたどる名前を受けない
    (day.format(DAY_FORMAT).to_string() == name).then_some(day)
}

fn dir_size(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

pub struct Archive {
    dir: PathBuf,
}

impl Archive {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn day_dir(&self, day: NaiveDate) -> PathBuf {
        self.dir.join(day.format(DAY_FORMAT).to_string())
    }

    /// 保管してある日を、古い順で返す。
    fn days(&self) -> Vec<NaiveDate> {
        let mut days: Vec<NaiveDate> = fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| parse_day(entry.file_name().to_str()?))
            .collect();
        days.sort();
        days
    }

    /// その日の記録を、書いた順で読む。読めない行は飛ばす。
    fn read_day(&self, day: NaiveDate) -> Vec<Entry> {
        let Ok(text) = fs::read_to_string(self.day_dir(day).join(INDEX_FILE)) else {
            return Vec::new();
        };
        text.lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    /// 一覧から外れた項目を保管する。日は、その項目を最後に使った日にする。
    pub fn append(&self, items: &[Item], now_ms: u64) -> Result<(), String> {
        let today = Local::now().date_naive();
        for item in items {
            let dir = self.day_dir(day_of(item.updated_at, today));
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            if let Content::Image(image) = &item.content {
                store::write_images(&dir, image)?;
            }
            let entry = Entry {
                key: next_key(now_ms),
                record: store::to_record(item),
            };
            let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
            line.push('\n');
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(INDEX_FILE))
                .and_then(|mut file| file.write_all(line.as_bytes()))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 保管してある項目を新しい順に並べ、検索語と種類に合うものを `offset` から `limit` 件返す。
    pub fn list(&self, query: &str, kinds: &[String], offset: usize, limit: usize) -> Page {
        let needle = query.trim().to_lowercase();
        let mut items = Vec::new();
        let mut skipped = 0;
        for day in self.days().into_iter().rev() {
            let name = day.format(DAY_FORMAT).to_string();
            let mut entries = self.read_day(day);
            // 同じ日の中は、最後に使った時刻の新しい順
            entries.sort_by_key(|entry| std::cmp::Reverse((entry.record.updated_at, entry.key)));
            for entry in entries {
                if !matches(&entry.record, &needle, kinds) {
                    continue;
                }
                if skipped < offset {
                    skipped += 1;
                    continue;
                }
                if items.len() == limit {
                    return Page {
                        items,
                        has_more: true,
                    };
                }
                items.push(view(&name, entry));
            }
        }
        Page {
            items,
            has_more: false,
        }
    }

    /// 保管から1件を取り出して消す。内容、形式名、最後に使った時刻を返す。
    pub fn take(&self, key: &str) -> Result<(Content, Vec<String>, u64), String> {
        let missing = || "保管してある項目が見つかりません".to_string();
        let (day, number) = key.split_once(KEY_SEPARATOR).ok_or_else(missing)?;
        let day = parse_day(day).ok_or_else(missing)?;
        let number: u64 = number.parse().map_err(|_| missing())?;
        let dir = self.day_dir(day);

        let mut entries = self.read_day(day);
        let index = entries
            .iter()
            .position(|entry| entry.key == number)
            .ok_or_else(missing)?;
        let entry = entries.remove(index);
        let (formats, updated_at) = (entry.record.formats.clone(), entry.record.updated_at);
        // 読めなかったときは、記録を消さずに残す
        let content =
            store::restore(entry.record, &dir).ok_or("保管してある項目を読めませんでした")?;

        if entries.is_empty() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        } else {
            let mut lines = String::new();
            let mut referenced = HashSet::new();
            for entry in &entries {
                lines.push_str(&serde_json::to_string(entry).map_err(|e| e.to_string())?);
                lines.push('\n');
                if let Some(image) = &entry.record.image {
                    for thumb in [false, true] {
                        referenced.insert(dir.join(store::image_file_name(image.hash, thumb)));
                    }
                }
            }
            save::write_atomically(&dir.join(INDEX_FILE), lines.as_bytes())?;
            store::remove_images_except(&dir, &referenced);
        }
        Ok((content, formats, updated_at))
    }

    /// 保管してある画像のサムネイル。`hash` は16進。
    pub fn thumbnail(&self, day: &str, hash: &str) -> Option<Vec<u8>> {
        let day = parse_day(day)?;
        let hash = u64::from_str_radix(hash, 16).ok()?;
        fs::read(self.day_dir(day).join(store::image_file_name(hash, true))).ok()
    }

    /// `keep_days` 日より前の日を消し、全体が `max_bytes` を超えていれば古い日から消す。
    /// いちばん新しい日は、大きさの整理では消さない(保管した直後に消えないように)。
    pub fn prune(&self, keep_days: u64, max_bytes: u64, today: NaiveDate) {
        let oldest_kept = today
            .checked_sub_days(Days::new(keep_days))
            .unwrap_or(NaiveDate::MIN);
        let mut kept = Vec::new();
        for day in self.days() {
            if day < oldest_kept {
                let _ = fs::remove_dir_all(self.day_dir(day));
            } else {
                kept.push((day, dir_size(&self.day_dir(day))));
            }
        }
        let mut total: u64 = kept.iter().map(|(_, size)| size).sum();
        let newest = kept.len().saturating_sub(1);
        for (day, size) in kept.into_iter().take(newest) {
            if total <= max_bytes {
                break;
            }
            let _ = fs::remove_dir_all(self.day_dir(day));
            total -= size;
        }
    }

    /// 保管している全体の大きさ(バイト)。
    pub fn size(&self) -> u64 {
        self.days()
            .into_iter()
            .map(|day| dir_size(&self.day_dir(day)))
            .sum()
    }

    /// 保管してあるものをすべて消す。
    pub fn clear(&self) -> Result<(), String> {
        match fs::remove_dir_all(&self.dir) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{History, StoredImage};
    use std::sync::Arc;

    const DAY_MS: u64 = 24 * 60 * 60 * 1000;

    fn temp_archive(tag: &str) -> Archive {
        let dir =
            std::env::temp_dir().join(format!("clipglass-archive-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Archive::new(dir)
    }

    fn date(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, DAY_FORMAT).unwrap()
    }

    /// ローカル時刻でその日の正午。
    fn noon(day: &str) -> u64 {
        let time = date(day).and_hms_opt(12, 0, 0).unwrap();
        Local
            .from_local_datetime(&time)
            .single()
            .unwrap()
            .timestamp_millis() as u64
    }

    fn all_kinds() -> Vec<String> {
        ["text", "image", "files"].map(String::from).to_vec()
    }

    /// 履歴に入れて、上限から外れた形で取り出す。
    fn evicted(contents: Vec<(Content, u64)>) -> Vec<Item> {
        let mut history = History::default();
        for (content, updated_at) in contents {
            history.insert(content, vec!["F".into()], updated_at);
        }
        history.insert(Content::Files(vec!["keep".into()]), Vec::new(), 0);
        history.set_max_items(1);
        history.take_evicted()
    }

    fn text(text: &str) -> Content {
        Content::Text {
            text: text.into(),
            rich: Vec::new(),
        }
    }

    fn image(hash: u64) -> Content {
        Content::Image(StoredImage {
            png: Arc::new(vec![1, 2, 3]),
            thumbnail: Arc::new(vec![4]),
            width: 2,
            height: 1,
            hash,
        })
    }

    fn texts(page: &Page) -> Vec<String> {
        page.items
            .iter()
            .map(|item| item.text.clone().unwrap_or_else(|| item.kind.to_string()))
            .collect()
    }

    #[test]
    fn items_are_grouped_by_day_and_listed_newest_first() {
        let archive = temp_archive("list");
        let items = evicted(vec![
            (text("old"), noon("2026-11-01")),
            (text("morning"), noon("2026-11-03") - 1000),
            (text("noon"), noon("2026-11-03")),
            (image(0xabc), noon("2026-11-02")),
        ]);
        archive.append(&items, 1).unwrap();

        let page = archive.list("", &all_kinds(), 0, 10);
        assert_eq!(texts(&page), ["noon", "morning", "image", "old"]);
        assert!(!page.has_more);
        assert_eq!(page.items[0].day, "2026-11-03");
        assert_eq!(
            page.items[2].image_hash.as_deref(),
            Some("0000000000000abc")
        );
        assert_eq!(
            (page.items[2].width, page.items[2].height),
            (Some(2), Some(1))
        );
        assert_eq!(archive.thumbnail("2026-11-02", "abc"), Some(vec![4]));

        // 続きは offset で取る
        let first = archive.list("", &all_kinds(), 0, 3);
        assert!(first.has_more);
        assert_eq!(texts(&archive.list("", &all_kinds(), 3, 3)), ["old"]);
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn search_uses_the_whole_text_and_kinds() {
        let archive = temp_archive("search");
        let long = format!("{}needle", "あ".repeat(ARCHIVE_PREVIEW_CHARS + 10));
        let items = evicted(vec![
            (text(&long), noon("2026-11-01")),
            (text("Hello"), noon("2026-11-01")),
            (
                Content::Files(vec!["C:\\Docs\\Report.xlsx".into()]),
                noon("2026-11-01"),
            ),
            (image(1), noon("2026-11-01")),
        ]);
        archive.append(&items, 1).unwrap();

        // 一覧に出す分は切り詰めるが、検索は全文で行う。大文字小文字は区別しない
        let page = archive.list("NEEDLE", &all_kinds(), 0, 10);
        assert_eq!(page.items.len(), 1);
        assert!(page.items[0].truncated);
        assert_eq!(page.items[0].char_count, Some(ARCHIVE_PREVIEW_CHARS + 16));
        assert_eq!(
            texts(&archive.list("hello", &all_kinds(), 0, 10)),
            ["Hello"]
        );
        assert_eq!(
            archive.list("report", &all_kinds(), 0, 10).items[0].kind,
            "files"
        );
        // 画像は検索語があると外れ、種類だけなら残る
        assert!(archive
            .list("1", &["image".to_string()], 0, 10)
            .items
            .is_empty());
        assert_eq!(
            archive.list("", &["image".to_string()], 0, 10).items.len(),
            1
        );
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn take_returns_the_content_and_removes_only_that_record() {
        let archive = temp_archive("take");
        let items = evicted(vec![
            (image(0xabc), noon("2026-11-01")),
            (image(0xdef), noon("2026-11-01")),
        ]);
        archive.append(&items, 1).unwrap();
        let page = archive.list("", &all_kinds(), 0, 10);
        let key = page
            .items
            .iter()
            .find(|item| item.image_hash.as_deref() == Some("0000000000000abc"))
            .unwrap()
            .key
            .clone();

        let (content, formats, updated_at) = archive.take(&key).unwrap();
        assert!(
            matches!(content, Content::Image(image) if image.hash == 0xabc && *image.png == [1, 2, 3])
        );
        assert_eq!(formats, ["F"]);
        assert_eq!(updated_at, noon("2026-11-01"));
        // 取り出した記録と、ほかから使われていない画像だけが消える
        assert_eq!(archive.list("", &all_kinds(), 0, 10).items.len(), 1);
        assert_eq!(archive.thumbnail("2026-11-01", "abc"), None);
        assert_eq!(archive.thumbnail("2026-11-01", "def"), Some(vec![4]));
        assert!(archive.take(&key).is_err());

        // 最後の1件を取り出すと、その日のフォルダーも残さない
        let last = archive.list("", &all_kinds(), 0, 10).items[0].key.clone();
        archive.take(&last).unwrap();
        assert!(archive.days().is_empty());
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn bad_keys_are_rejected_without_touching_other_folders() {
        let archive = temp_archive("keys");
        archive
            .append(&evicted(vec![(text("a"), noon("2026-11-01"))]), 1)
            .unwrap();
        for key in [
            "",
            "2026-11-01",
            "../x/1",
            "2026-11-01/x",
            "2026-1-1/1",
            "..\\..\\a/1",
        ] {
            assert!(archive.take(key).is_err(), "{key}");
        }
        assert_eq!(archive.thumbnail("..", "abc"), None);
        assert_eq!(archive.list("", &all_kinds(), 0, 10).items.len(), 1);
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn prune_drops_days_past_retention_then_oldest_days_over_the_size() {
        let archive = temp_archive("prune");
        let big = "x".repeat(2000);
        let items = evicted(vec![
            (text("expired"), noon("2026-10-01")),
            (text(&big), noon("2026-11-08")),
            (text(&format!("{big}2")), noon("2026-11-09")),
            (text(&format!("{big}3")), noon("2026-11-10")),
        ]);
        archive.append(&items, 1).unwrap();
        let today = date("2026-11-11");

        // 30日より前の日だけが消える
        archive.prune(30, u64::MAX, today);
        assert_eq!(
            archive.days(),
            [date("2026-11-08"), date("2026-11-09"), date("2026-11-10")]
        );
        // 大きさの上限を超えたら、古い日から消す
        archive.prune(30, 4500, today);
        assert_eq!(archive.days(), [date("2026-11-09"), date("2026-11-10")]);
        assert!(archive.size() <= 4500);
        // いちばん新しい日は、上限より大きくても残す
        archive.prune(30, 10, today);
        assert_eq!(archive.days(), [date("2026-11-10")]);
        // 保管する範囲のちょうど端の日は残る
        archive.prune(1, u64::MAX, today);
        assert_eq!(archive.days(), [date("2026-11-10")]);
        archive.prune(0, u64::MAX, today);
        assert!(archive.days().is_empty());
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn broken_lines_and_stray_folders_are_ignored() {
        let archive = temp_archive("broken");
        archive
            .append(&evicted(vec![(text("ok"), noon("2026-11-01"))]), 1)
            .unwrap();
        let index = archive.day_dir(date("2026-11-01")).join(INDEX_FILE);
        let mut content = fs::read_to_string(&index).unwrap();
        content.push_str("{not json\n{\"key\":5}\n");
        fs::write(&index, content).unwrap();
        fs::create_dir_all(archive.dir.join("notes")).unwrap();

        assert_eq!(texts(&archive.list("", &all_kinds(), 0, 10)), ["ok"]);
        assert_eq!(archive.days(), [date("2026-11-01")]);
        fs::remove_dir_all(&archive.dir).unwrap();
    }

    #[test]
    fn keys_are_unique_within_the_same_millisecond_and_clear_is_safe() {
        let archive = temp_archive("keys-unique");
        let day = noon("2026-11-01");
        let items = evicted(vec![(text("a"), day), (text("b"), day + DAY_MS)]);
        archive.append(&items, 7).unwrap();
        archive.append(&evicted(vec![(text("c"), day)]), 7).unwrap();
        let keys: HashSet<String> = archive
            .list("", &all_kinds(), 0, 10)
            .items
            .into_iter()
            .map(|item| item.key)
            .collect();
        assert_eq!(keys.len(), 3);
        archive.clear().unwrap();
        archive.clear().unwrap();
        assert_eq!(archive.size(), 0);
        assert!(archive.list("", &all_kinds(), 0, 10).items.is_empty());
    }
}

//! 画像のファイル保存。

use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDateTime;

const PNG_EXTENSION: &str = "png";

pub fn default_file_name(now: NaiveDateTime) -> String {
    format!("clipboard-{}.{PNG_EXTENSION}", now.format("%Y%m%d-%H%M%S"))
}

/// 拡張子がPNGでなければ `.png` を付け足す。
pub fn ensure_png_extension(path: PathBuf) -> PathBuf {
    let is_png = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PNG_EXTENSION));
    if is_png {
        return path;
    }
    let mut name = path.into_os_string();
    name.push(".");
    name.push(PNG_EXTENSION);
    PathBuf::from(name)
}

/// 一時ファイルへ書いてから置き換える。途中で失敗しても既存のファイルを壊さない。
pub fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temp_name = path.as_os_str().to_owned();
    temp_name.push(format!(".{}.tmp", std::process::id()));
    let temp_path = PathBuf::from(temp_name);

    let result = fs::write(&temp_path, bytes).and_then(|()| fs::rename(&temp_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn file_name_uses_local_timestamp() {
        let now = NaiveDate::from_ymd_opt(2026, 10, 6)
            .unwrap()
            .and_hms_opt(9, 5, 3)
            .unwrap();
        assert_eq!(default_file_name(now), "clipboard-20261006-090503.png");
    }

    #[test]
    fn extension_is_added_only_when_missing() {
        assert_eq!(
            ensure_png_extension(PathBuf::from("a")),
            PathBuf::from("a.png")
        );
        assert_eq!(
            ensure_png_extension(PathBuf::from("a.jpg")),
            PathBuf::from("a.jpg.png")
        );
        assert_eq!(
            ensure_png_extension(PathBuf::from("a.PNG")),
            PathBuf::from("a.PNG")
        );
    }

    #[test]
    fn write_replaces_existing_file_and_leaves_no_temp_file() {
        let dir = std::env::temp_dir().join(format!("clipglass-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("image.png");
        fs::write(&path, b"old").unwrap();

        write_atomically(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_write_reports_error() {
        let missing = std::env::temp_dir()
            .join(format!("clipglass-missing-{}", std::process::id()))
            .join("image.png");
        assert!(write_atomically(&missing, b"data").is_err());
    }
}

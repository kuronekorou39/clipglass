//! Rust側が持つ設定。データフォルダーの `config.yaml` に保存する。
//! ウィンドウの見た目に関する設定はUI側(localStorage)が持つ。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::limits::{
    ARCHIVE_DAYS_LIMIT, ARCHIVE_MAX_MB_LIMIT, ARCHIVE_MAX_MB_MIN, DEFAULT_ARCHIVE_DAYS,
    DEFAULT_ARCHIVE_MAX_MB, DEFAULT_HISTORY_MAX_ITEMS, HISTORY_MAX_ITEMS_LIMIT,
};

pub const FILE_NAME: &str = "config.yaml";
const BROKEN_FILE_NAME: &str = "config.broken.yaml";
/// ウィンドウの表示/非表示を切り替えるショートカットの初期値。
/// Ctrl+Shift+V はブラウザーやチャットの「書式なしで貼り付け」と被るので避ける。
/// 左手だけで押しやすいよう、左端の Q にする。
pub const DEFAULT_HOTKEY: &str = "Alt+Shift+Q";

const FILE_HEADER: &str = "# Clipglass の設定。アプリが書き換えるので、コメントは残りません。\n";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HistoryConfig {
    /// 一覧に残す項目の上限。
    pub max_items: usize,
    /// 履歴をディスクに保存するかどうか(初期値は保存する)。
    pub persist: bool,
    /// 一覧から外れた項目を保管しておく日数。0 なら保管しない。
    pub archive_days: u64,
    /// 保管全体の大きさの上限(MB)。超えたら古い日から消す。
    pub archive_max_mb: u64,
}

impl HistoryConfig {
    /// 一覧から外れた項目を保管するか。ディスクに保存しない設定では保管もしない。
    pub fn archives(&self) -> bool {
        self.persist && self.archive_days > 0
    }

    pub fn archive_max_bytes(&self) -> u64 {
        self.archive_max_mb.saturating_mul(1024 * 1024)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub history: HistoryConfig,
    /// ウィンドウの表示/非表示を切り替えるショートカット。空なら登録しない。
    pub hotkey: String,
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            max_items: DEFAULT_HISTORY_MAX_ITEMS,
            persist: true,
            archive_days: DEFAULT_ARCHIVE_DAYS,
            archive_max_mb: DEFAULT_ARCHIVE_MAX_MB,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            history: HistoryConfig::default(),
            hotkey: DEFAULT_HOTKEY.to_string(),
        }
    }
}

pub fn clamp_max_items(max_items: usize) -> usize {
    max_items.clamp(1, HISTORY_MAX_ITEMS_LIMIT)
}

pub fn clamp_archive_days(days: u64) -> u64 {
    days.min(ARCHIVE_DAYS_LIMIT)
}

pub fn clamp_archive_max_mb(max_mb: u64) -> u64 {
    max_mb.clamp(ARCHIVE_MAX_MB_MIN, ARCHIVE_MAX_MB_LIMIT)
}

pub fn parse(yaml: &str) -> Result<Config, String> {
    if yaml.trim().is_empty() {
        return Ok(Config::default());
    }
    let mut config: Config = serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    config.history.max_items = clamp_max_items(config.history.max_items);
    config.history.archive_days = clamp_archive_days(config.history.archive_days);
    config.history.archive_max_mb = clamp_archive_max_mb(config.history.archive_max_mb);
    config.hotkey = config.hotkey.trim().to_string();
    Ok(config)
}

/// ファイルがなければ初期値を返す。読めない場合は、次の保存で上書きしてしまわないよう
/// `config.broken.yaml` に写してから失敗を返す。
pub fn load(path: &Path) -> Result<Config, String> {
    let yaml = match fs::read_to_string(path) {
        Ok(yaml) => yaml,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(e.to_string()),
    };
    parse(&yaml).map_err(|message| {
        let backup = path.with_file_name(BROKEN_FILE_NAME);
        match fs::copy(path, &backup) {
            Ok(_) => format!(
                "{message}(元のファイルは {} に写しました)",
                backup.display()
            ),
            Err(e) => format!("{message}(写しを作れませんでした: {e})"),
        }
    })
}

pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let yaml = serde_yaml_ng::to_string(config).map_err(|e| e.to_string())?;
    fs::write(path, format!("{FILE_HEADER}{yaml}")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_partial_yaml_falls_back_to_defaults() {
        assert_eq!(parse("").unwrap(), Config::default());
        let config = parse("history:\n  max_items: 50\n").unwrap();
        assert_eq!(config.history.max_items, 50);
        assert!(config.history.persist);
        assert_eq!(config.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn max_items_is_clamped() {
        assert_eq!(
            parse("history:\n  max_items: 0\n")
                .unwrap()
                .history
                .max_items,
            1
        );
        assert_eq!(
            parse("history:\n  max_items: 100000\n")
                .unwrap()
                .history
                .max_items,
            HISTORY_MAX_ITEMS_LIMIT
        );
    }

    #[test]
    fn archive_settings_default_and_are_clamped() {
        // 0.7 までの設定ファイルには項目がないので、初期値で補う
        let config = parse("history:\n  max_items: 50\n").unwrap();
        assert_eq!(config.history.archive_days, DEFAULT_ARCHIVE_DAYS);
        assert_eq!(config.history.archive_max_mb, DEFAULT_ARCHIVE_MAX_MB);
        assert!(config.history.archives());

        let config = parse("history:\n  archive_days: 9999\n  archive_max_mb: 1\n").unwrap();
        assert_eq!(config.history.archive_days, ARCHIVE_DAYS_LIMIT);
        assert_eq!(config.history.archive_max_mb, ARCHIVE_MAX_MB_MIN);
        assert_eq!(
            config.history.archive_max_bytes(),
            ARCHIVE_MAX_MB_MIN * 1024 * 1024
        );

        // 0日、またはディスクに保存しない設定では保管しない
        assert!(!parse("history:\n  archive_days: 0\n")
            .unwrap()
            .history
            .archives());
        assert!(!parse("history:\n  persist: false\n")
            .unwrap()
            .history
            .archives());
    }

    #[test]
    fn roundtrip_through_file() {
        let dir = std::env::temp_dir().join(format!("clipglass-config-{}", std::process::id()));
        let path = dir.join("sub").join(FILE_NAME);
        let config = Config {
            history: HistoryConfig {
                max_items: 30,
                persist: true,
                archive_days: 7,
                archive_max_mb: 50,
            },
            hotkey: String::new(),
        };
        save(&path, &config).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with('#'));
        assert_eq!(load(&path).unwrap(), config);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn broken_file_is_copied_aside_and_reported() {
        let dir =
            std::env::temp_dir().join(format!("clipglass-config-broken-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        fs::write(&path, "history: [1, 2\n").unwrap();

        let error = load(&path).unwrap_err();
        assert!(error.contains(BROKEN_FILE_NAME), "{error}");
        assert_eq!(
            fs::read_to_string(dir.join(BROKEN_FILE_NAME)).unwrap(),
            "history: [1, 2\n"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_keys_and_wrong_types_do_not_panic() {
        let config = parse("hotkey: '  Alt+Q '\nfuture_key: 1\n").unwrap();
        assert_eq!(config.hotkey, "Alt+Q");
        assert!(parse("history:\n  max_items: many\n").is_err());
        assert!(parse("history:\n  persist: 3\n").is_err());
        assert!(parse("- a\n").is_err());
    }

    #[test]
    fn missing_file_gives_defaults() {
        let path = std::env::temp_dir().join("clipglass-no-such-config.yaml");
        assert_eq!(load(&path).unwrap(), Config::default());
    }
}

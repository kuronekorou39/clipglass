//! Rust側が持つ設定。データフォルダーの `config.yaml` に保存する。
//! ウィンドウの見た目に関する設定はUI側(localStorage)が持つ。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::limits::{DEFAULT_HISTORY_MAX_ITEMS, HISTORY_MAX_ITEMS_LIMIT};

pub const FILE_NAME: &str = "config.yaml";
/// ウィンドウの表示/非表示を切り替えるショートカットの初期値。
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+V";

const FILE_HEADER: &str = "# Clipglass の設定。アプリが書き換えるので、コメントは残りません。\n";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HistoryConfig {
    /// 固定していない項目の上限。
    pub max_items: usize,
    /// 固定していない項目もディスクに保存するかどうか。固定した項目は常に保存する。
    pub persist: bool,
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
            persist: false,
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

pub fn parse(yaml: &str) -> Result<Config, String> {
    if yaml.trim().is_empty() {
        return Ok(Config::default());
    }
    let mut config: Config = serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    config.history.max_items = clamp_max_items(config.history.max_items);
    config.hotkey = config.hotkey.trim().to_string();
    Ok(config)
}

/// ファイルがない、または読めない場合は初期値を返す。
pub fn load(path: &Path) -> Result<Config, String> {
    match fs::read_to_string(path) {
        Ok(yaml) => parse(&yaml),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
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
        assert!(!config.history.persist);
        assert_eq!(config.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn max_items_is_clamped() {
        assert_eq!(parse("history:\n  max_items: 0\n").unwrap().history.max_items, 1);
        assert_eq!(
            parse("history:\n  max_items: 100000\n").unwrap().history.max_items,
            HISTORY_MAX_ITEMS_LIMIT
        );
    }

    #[test]
    fn roundtrip_through_file() {
        let dir = std::env::temp_dir().join(format!("clipglass-config-{}", std::process::id()));
        let path = dir.join("sub").join(FILE_NAME);
        let config = Config {
            history: HistoryConfig {
                max_items: 30,
                persist: true,
            },
            hotkey: String::new(),
        };
        save(&path, &config).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with('#'));
        assert_eq!(load(&path).unwrap(), config);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_file_gives_defaults() {
        let path = std::env::temp_dir().join("clipglass-no-such-config.yaml");
        assert_eq!(load(&path).unwrap(), Config::default());
    }
}

//! お気に入り。プリセットに入れるほどではないが、しばらく使う文字を並べておく。
//!
//! フォルダーはなく、データフォルダーの `favorites.yaml` に文字のリストとして置く。
//! 新しく加えたものが先頭に来る。

use std::fs;
use std::path::Path;

use serde_yaml_ng::Value;

pub const FILE_NAME: &str = "favorites.yaml";
const BROKEN_FILE_NAME: &str = "favorites.broken.yaml";
const FILE_HEADER: &str =
    "# Clipglass のお気に入り。上にあるものほど新しい。アプリが書き換えるので、コメントは残りません。\n";

/// 文字のリストとして読む。数値や真偽値は文字として扱い、空の値は飛ばす。
pub fn parse(yaml: &str) -> Result<Vec<String>, String> {
    if yaml.trim().is_empty() {
        return Ok(Vec::new());
    }
    let values: Vec<Value> = serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for value in values {
        let text = match value {
            Value::String(text) => text,
            Value::Number(number) => number.to_string(),
            Value::Bool(flag) => flag.to_string(),
            Value::Null => continue,
            _ => return Err("お気に入りは文字のリストで書いてください".to_string()),
        };
        if !text.trim().is_empty() && !list.contains(&text) {
            list.push(text);
        }
    }
    Ok(list)
}

/// ファイルがなければ空で始める。読めない場合は、次の保存で上書きしてしまわないよう
/// `favorites.broken.yaml` に写してから失敗を返す。
pub fn load(path: &Path) -> Result<Vec<String>, String> {
    let yaml = match fs::read_to_string(path) {
        Ok(yaml) => yaml,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
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

pub fn save(path: &Path, list: &[String]) -> Result<(), String> {
    let yaml = serde_yaml_ng::to_string(list).map_err(|e| e.to_string())?;
    fs::write(path, format!("{FILE_HEADER}{yaml}")).map_err(|e| e.to_string())
}

/// 先頭に加える。すでにあれば何もせず `false` を返す。空白だけの文字は受けない。
pub fn add(list: &mut Vec<String>, text: String) -> Result<bool, String> {
    if text.trim().is_empty() {
        return Err("空の文字はお気に入りにできません".to_string());
    }
    if list.contains(&text) {
        return Ok(false);
    }
    list.insert(0, text);
    Ok(true)
}

/// 外す。入っていなければ `false` を返す。
pub fn remove(list: &mut Vec<String>, text: &str) -> bool {
    let before = list.len();
    list.retain(|item| item != text);
    list.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_comes_first_and_duplicates_are_not_added() {
        let mut list = Vec::new();
        assert!(add(&mut list, "a".into()).unwrap());
        assert!(add(&mut list, "b".into()).unwrap());
        assert!(!add(&mut list, "a".into()).unwrap());
        assert_eq!(list, ["b", "a"]);
        assert!(add(&mut list, "  \n".into()).is_err());
        // 前後の空白が違えば別の文字として扱う(履歴との一致を完全一致で見るため)
        assert!(add(&mut list, "a ".into()).unwrap());
        assert!(remove(&mut list, "a"));
        assert!(!remove(&mut list, "a"));
        assert_eq!(list, ["a ", "b"]);
    }

    #[test]
    fn roundtrip_keeps_multiline_and_scalar_like_texts() {
        let dir = std::env::temp_dir().join(format!("clipglass-favorites-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let list: Vec<String> = [
            "1行目\n2行目\n",
            "123",
            "true",
            "# 見出し",
            "- 箇条書き",
            " 空白 ",
        ]
        .map(String::from)
        .to_vec();
        save(&path, &list).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with('#'));
        assert_eq!(load(&path).unwrap(), list);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn hand_written_file_is_read_leniently() {
        let list = parse("- test\n- 42\n- true\n-\n- test\n- ''\n").unwrap();
        assert_eq!(list, ["test", "42", "true"]);
        assert_eq!(parse("").unwrap(), Vec::<String>::new());
        assert!(parse("a: b\n").is_err());
        assert!(parse("- [1, 2]\n").is_err());
    }

    #[test]
    fn missing_file_is_empty_and_broken_file_is_copied_aside() {
        let dir =
            std::env::temp_dir().join(format!("clipglass-favorites-broken-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        assert_eq!(load(&path).unwrap(), Vec::<String>::new());
        fs::write(&path, "- [a\n").unwrap();
        let error = load(&path).unwrap_err();
        assert!(error.contains(BROKEN_FILE_NAME), "{error}");
        assert_eq!(
            fs::read_to_string(dir.join(BROKEN_FILE_NAME)).unwrap(),
            "- [a\n"
        );
        fs::remove_dir_all(&dir).unwrap();
    }
}

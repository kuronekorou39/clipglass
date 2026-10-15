//! プリセット。YAMLの入れ子の対応で表し、値が文字ならプリセット、対応ならフォルダーとする。
//!
//! ```yaml
//! 挨拶:
//!   朝: おはようございます
//!   署名: |
//!     山田 太郎
//! メール: example@example.com
//! ```

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};

use crate::save;

pub const FILE_NAME: &str = "presets.yaml";

const FILE_HEADER: &str = "\
# Clipglass のプリセット
# 「名前: 文字」で1件。名前の下に字下げして書くとフォルダーになり、何段でも入れ子にできます。
# 複数行の文字は「名前: |」と書き、次の行から字下げして書きます。
# アプリから登録・削除すると、この先頭のコメント以外のコメントは残りません。
";

const INITIAL_FILE: &str = "\
例:
  挨拶: お世話になっております。
  署名: |
    山田 太郎
    example@example.com
";

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Text(String),
    Folder(Root),
}

/// 名前と内容の並び。ファイルに書いた順を保つ。
pub type Root = Vec<(String, Node)>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub name: String,
    /// 先頭からの名前の並び。UIからの指定に使う。
    pub path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<NodeView>>,
}

fn location(path: &[String]) -> String {
    if path.is_empty() {
        "先頭".to_string()
    } else {
        format!("「{}」", path.join(" / "))
    }
}

fn key_name(key: &Value, path: &[String]) -> Result<String, String> {
    match key {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err(format!("{}の名前は文字にしてください", location(path))),
    }
}

fn node_from(value: Value, path: &[String]) -> Result<Node, String> {
    match value {
        Value::String(s) => Ok(Node::Text(s)),
        Value::Number(n) => Ok(Node::Text(n.to_string())),
        Value::Bool(b) => Ok(Node::Text(b.to_string())),
        Value::Null => Ok(Node::Text(String::new())),
        Value::Mapping(mapping) => Ok(Node::Folder(folder_from(mapping, path)?)),
        Value::Sequence(_) => Err(format!(
            "{}にリスト(- で始まる行)は使えません。「名前: 文字」の形で書いてください",
            location(path)
        )),
        Value::Tagged(_) => Err(format!("{}にタグは使えません", location(path))),
    }
}

fn folder_from(mapping: Mapping, path: &[String]) -> Result<Root, String> {
    let mut root = Vec::with_capacity(mapping.len());
    for (key, value) in mapping {
        let name = key_name(&key, path)?;
        let child_path: Vec<String> = path.iter().cloned().chain([name.clone()]).collect();
        root.push((name, node_from(value, &child_path)?));
    }
    Ok(root)
}

pub fn parse(yaml: &str) -> Result<Root, String> {
    if yaml.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: Value = serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    match value {
        Value::Null => Ok(Vec::new()),
        Value::Mapping(mapping) => folder_from(mapping, &[]),
        _ => Err("先頭は「名前: 文字」の形で書いてください".to_string()),
    }
}

fn to_value(root: &Root) -> Value {
    let mut mapping = Mapping::with_capacity(root.len());
    for (name, node) in root {
        let value = match node {
            Node::Text(text) => Value::String(text.clone()),
            Node::Folder(children) => to_value(children),
        };
        mapping.insert(Value::String(name.clone()), value);
    }
    Value::Mapping(mapping)
}

pub fn to_yaml(root: &Root) -> Result<String, String> {
    if root.is_empty() {
        return Ok(String::new());
    }
    serde_yaml_ng::to_string(&to_value(root)).map_err(|e| e.to_string())
}

fn view_node(path: &[String], name: &str, node: &Node) -> NodeView {
    let path: Vec<String> = path.iter().cloned().chain([name.to_string()]).collect();
    let (text, children) = match node {
        Node::Text(text) => (Some(text.clone()), None),
        Node::Folder(children) => (None, Some(view_children(&path, children))),
    };
    NodeView {
        name: name.to_string(),
        path,
        text,
        children,
    }
}

fn view_children(path: &[String], root: &Root) -> Vec<NodeView> {
    root.iter()
        .map(|(name, node)| view_node(path, name, node))
        .collect()
}

pub fn view(root: &Root) -> Vec<NodeView> {
    view_children(&[], root)
}

pub fn find<'a>(root: &'a Root, path: &[String]) -> Option<&'a Node> {
    let (first, rest) = path.split_first()?;
    let node = root
        .iter()
        .find(|(name, _)| name == first)
        .map(|(_, node)| node)?;
    match (rest, node) {
        ([], _) => Some(node),
        (_, Node::Folder(children)) => find(children, rest),
        _ => None,
    }
}

pub fn find_text<'a>(root: &'a Root, path: &[String]) -> Option<&'a str> {
    match find(root, path)? {
        Node::Text(text) => Some(text),
        Node::Folder(_) => None,
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("名前を入力してください".to_string());
    }
    if name != name.trim() {
        return Err("名前の前後に空白は使えません".to_string());
    }
    Ok(())
}

/// `path` の最後を名前として登録する。途中のフォルダーがなければ作る。
/// 同じ名前のプリセットやフォルダーがある場合は登録しない。
pub fn insert(root: &mut Root, path: &[String], text: String) -> Result<(), String> {
    let Some((name, folders)) = path.split_last() else {
        return Err("名前を入力してください".to_string());
    };
    validate_name(name)?;
    let mut current = root;
    for folder in folders {
        validate_name(folder)?;
        let index = match current.iter().position(|(n, _)| n == folder) {
            Some(index) => index,
            None => {
                current.push((folder.clone(), Node::Folder(Vec::new())));
                current.len() - 1
            }
        };
        current = match &mut current[index].1 {
            Node::Folder(children) => children,
            Node::Text(_) => {
                return Err(format!(
                    "「{folder}」はプリセットなので、中に登録できません"
                ))
            }
        };
    }
    if current.iter().any(|(n, _)| n == name) {
        return Err(format!("「{name}」は登録済みです"));
    }
    current.push((name.clone(), Node::Text(text)));
    Ok(())
}

/// プリセットまたはフォルダー(中身ごと)を削除する。
pub fn remove(root: &mut Root, path: &[String]) -> Result<(), String> {
    let Some((name, folders)) = path.split_last() else {
        return Err("削除する項目が指定されていません".to_string());
    };
    let mut current = root;
    for folder in folders {
        current = match current.iter_mut().find(|(n, _)| n == folder) {
            Some((_, Node::Folder(children))) => children,
            _ => return Err(format!("{}が見つかりません", location(path))),
        };
    }
    let index = current
        .iter()
        .position(|(n, _)| n == name)
        .ok_or_else(|| format!("{}が見つかりません", location(path)))?;
    current.remove(index);
    Ok(())
}

/// ファイルがなければ、例を書いたファイルを作る。中身は読まない。
pub fn ensure_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    write(path, INITIAL_FILE)
}

/// ファイルを読む。なければ例を書いたファイルを作る。
pub fn load(path: &Path) -> Result<Root, String> {
    ensure_exists(path)?;
    parse(&fs::read_to_string(path).map_err(|e| e.to_string())?)
}

fn write(path: &Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    save::write_atomically(path, format!("{FILE_HEADER}{body}").as_bytes())
}

pub fn save(path: &Path, root: &Root) -> Result<(), String> {
    write(path, &to_yaml(root)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(value: &str) -> String {
        value.to_string()
    }

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| s(p)).collect()
    }

    const SAMPLE: &str = "\
挨拶:
  朝: おはようございます
  深い:
    さらに:
      一番下: 底
署名: |
  山田 太郎
  example@example.com
番号: 123
";

    #[test]
    fn nested_mapping_becomes_folders_and_texts() {
        let root = parse(SAMPLE).unwrap();
        assert_eq!(root.len(), 3);
        assert_eq!(
            find_text(&root, &path(&["挨拶", "朝"])),
            Some("おはようございます")
        );
        assert_eq!(
            find_text(&root, &path(&["挨拶", "深い", "さらに", "一番下"])),
            Some("底")
        );
        assert_eq!(
            find_text(&root, &path(&["署名"])),
            Some("山田 太郎\nexample@example.com\n")
        );
        assert_eq!(find_text(&root, &path(&["番号"])), Some("123"));
        assert!(find_text(&root, &path(&["挨拶"])).is_none());
        assert!(find(&root, &path(&["挨拶", "夜"])).is_none());
        assert!(find(&root, &path(&["署名", "x"])).is_none());
    }

    #[test]
    fn empty_file_has_no_presets() {
        assert!(parse("").unwrap().is_empty());
        assert!(parse("# コメントだけ\n").unwrap().is_empty());
    }

    #[test]
    fn sequences_are_rejected_with_location() {
        let error = parse("挨拶:\n  - a\n  - b\n").unwrap_err();
        assert!(error.contains("「挨拶」"), "{error}");
        assert!(parse("- a\n").is_err());
    }

    #[test]
    fn yaml_roundtrip_keeps_order_and_multiline_text() {
        let root = parse(SAMPLE).unwrap();
        let yaml = to_yaml(&root).unwrap();
        let reparsed = parse(&yaml).unwrap();
        assert_eq!(reparsed, root);
        let names: Vec<&str> = reparsed.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["挨拶", "署名", "番号"]);
    }

    #[test]
    fn view_carries_full_paths() {
        let root = parse(SAMPLE).unwrap();
        let view = view(&root);
        assert_eq!(view[0].name, "挨拶");
        let children = view[0].children.as_ref().unwrap();
        assert_eq!(children[0].path, path(&["挨拶", "朝"]));
        assert_eq!(children[0].text.as_deref(), Some("おはようございます"));
        assert!(children[0].children.is_none());
        assert!(view[1].children.is_none());
    }

    #[test]
    fn insert_creates_folders_and_rejects_duplicates() {
        let mut root = Vec::new();
        insert(&mut root, &path(&["a", "b", "c"]), s("1")).unwrap();
        insert(&mut root, &path(&["a", "d"]), s("2")).unwrap();
        insert(&mut root, &path(&["e"]), s("3")).unwrap();
        assert_eq!(find_text(&root, &path(&["a", "b", "c"])), Some("1"));
        assert_eq!(find_text(&root, &path(&["a", "d"])), Some("2"));
        assert_eq!(root.len(), 2);

        assert!(insert(&mut root, &path(&["e"]), s("x")).is_err());
        assert!(insert(&mut root, &path(&["a"]), s("x")).is_err());
        assert!(insert(&mut root, &path(&["e", "f"]), s("x")).is_err());
        assert!(insert(&mut root, &path(&[""]), s("x")).is_err());
        assert!(insert(&mut root, &path(&[" g"]), s("x")).is_err());
        assert!(insert(&mut root, &[], s("x")).is_err());
    }

    #[test]
    fn remove_deletes_text_or_whole_folder() {
        let mut root = parse(SAMPLE).unwrap();
        remove(&mut root, &path(&["挨拶", "朝"])).unwrap();
        assert!(find(&root, &path(&["挨拶", "朝"])).is_none());
        remove(&mut root, &path(&["挨拶"])).unwrap();
        assert!(find(&root, &path(&["挨拶", "深い"])).is_none());
        assert!(remove(&mut root, &path(&["なし"])).is_err());
        assert!(remove(&mut root, &path(&["署名", "x"])).is_err());
    }

    /// YAMLで特別な意味を持つ文字や空白を、アプリが書いたファイルから元どおり読めること。
    #[test]
    fn tricky_texts_and_names_survive_save_and_load() {
        let dir =
            std::env::temp_dir().join(format!("clipglass-presets-tricky-{}", std::process::id()));
        let file = dir.join(FILE_NAME);
        let long = "長い".repeat(5000);
        let texts = [
            "null",
            "~",
            "true",
            "123",
            "1.5",
            "",
            " 先頭に空白",
            "末尾に改行\n",
            "行1\r\n行2",
            "タブ\tあり",
            "a: b",
            "- リスト風",
            "# コメント風",
            "'引用'",
            "\"二重\"",
            "{}",
            "[]",
            "改行だけ\n\n\n",
            long.as_str(),
        ];
        let names = [
            "null",
            "123",
            "a: b",
            "a/b",
            "- x",
            "名前 \"引用\"",
            "#",
            "yes",
        ];
        let mut root = Vec::new();
        for (i, text) in texts.iter().enumerate() {
            insert(&mut root, &path(&["文字", &format!("t{i}")]), s(text)).unwrap();
        }
        for name in names {
            insert(&mut root, &path(&["名前", name]), s("x")).unwrap();
        }
        save(&file, &root).unwrap();
        let loaded = load(&file).unwrap();
        assert_eq!(loaded, root);
        for (i, text) in texts.iter().enumerate() {
            assert_eq!(
                find_text(&loaded, &path(&["文字", &format!("t{i}")])),
                Some(*text)
            );
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn empty_folder_survives_roundtrip() {
        let root: Root = vec![("空".into(), Node::Folder(Vec::new()))];
        let yaml = to_yaml(&root).unwrap();
        assert_eq!(parse(&yaml).unwrap(), root);
    }

    #[test]
    fn removing_the_last_item_leaves_an_empty_folder() {
        let mut root = Vec::new();
        insert(&mut root, &path(&["a", "b"]), s("1")).unwrap();
        remove(&mut root, &path(&["a", "b"])).unwrap();
        assert_eq!(root, vec![("a".into(), Node::Folder(Vec::new()))]);
        assert!(to_yaml(&Vec::new()).unwrap().is_empty());
    }

    #[test]
    fn handwritten_scalars_are_read_as_text() {
        let root = parse("a: yes\nb: 1.50\nc: ~\nd:\ne: 'null'\n").unwrap();
        assert_eq!(find_text(&root, &path(&["a"])), Some("yes"));
        assert_eq!(find_text(&root, &path(&["b"])), Some("1.5"));
        assert_eq!(find_text(&root, &path(&["c"])), Some(""));
        assert_eq!(find_text(&root, &path(&["d"])), Some(""));
        assert_eq!(find_text(&root, &path(&["e"])), Some("null"));
    }

    #[test]
    fn broken_file_is_reported_without_touching_it() {
        let dir =
            std::env::temp_dir().join(format!("clipglass-presets-broken-{}", std::process::id()));
        let file = dir.join(FILE_NAME);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&file, "a: [1\n").unwrap();
        assert!(load(&file).is_err());
        ensure_exists(&file).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "a: [1\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_file_is_created_with_example() {
        let dir = std::env::temp_dir().join(format!("clipglass-presets-{}", std::process::id()));
        let file = dir.join(FILE_NAME);
        let mut root = load(&file).unwrap();
        assert!(find_text(&root, &path(&["例", "挨拶"])).is_some());
        assert!(fs::read_to_string(&file)
            .unwrap()
            .starts_with("# Clipglass"));

        insert(&mut root, &path(&["追加"]), s("a\nb")).unwrap();
        save(&file, &root).unwrap();
        assert_eq!(load(&file).unwrap(), root);

        save(&file, &Vec::new()).unwrap();
        assert!(load(&file).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}

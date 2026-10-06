//! メモリー上の履歴。先頭が最新で、同じ内容は1件にまとめる。

use std::hash::Hasher;
use std::sync::Arc;

use serde::Serialize;

use crate::limits::{HISTORY_MAX_ITEMS, TEXT_PREVIEW_CHARS};

pub struct StoredImage {
    pub png: Arc<Vec<u8>>,
    pub thumbnail: Arc<Vec<u8>>,
    pub width: u32,
    pub height: u32,
}

pub enum Content {
    Text(String),
    Image(StoredImage),
}

pub struct Item {
    pub id: u64,
    pub hash: u64,
    pub content: Content,
    pub formats: Vec<String>,
    pub updated_at: u64,
}

/// クリップボードが履歴に入らない状態のときの表示内容。
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Status {
    Empty,
    Files {
        names: Vec<String>,
        formats: Vec<String>,
    },
    Unsupported {
        formats: Vec<String>,
    },
    TooLarge {
        formats: Vec<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    id: u64,
    kind: &'static str,
    text: Option<String>,
    char_count: Option<usize>,
    truncated: bool,
    width: Option<u32>,
    height: Option<u32>,
    formats: Vec<String>,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateView {
    status: Option<Status>,
    current_id: Option<u64>,
    items: Vec<ItemView>,
}

#[derive(Default)]
pub struct History {
    items: Vec<Item>,
    next_id: u64,
    current_id: Option<u64>,
    status: Option<Status>,
}

pub fn hash_text(text: &str) -> u64 {
    let mut hasher = std::hash::DefaultHasher::new();
    hasher.write(text.as_bytes());
    hasher.finish()
}

impl History {
    /// 同じ内容の項目があれば先頭へ移動して `true` を返す。
    /// `text` はテキストの場合だけ渡し、文字列の完全一致で確かめる。
    pub fn promote(&mut self, hash: u64, text: Option<&str>, formats: &[String], now: u64) -> bool {
        let found = self
            .items
            .iter()
            .position(|item| match (&item.content, text) {
                (Content::Text(existing), Some(text)) => existing == text,
                (Content::Image(_), None) => item.hash == hash,
                _ => false,
            });
        let Some(index) = found else {
            return false;
        };
        let mut item = self.items.remove(index);
        item.formats = formats.to_vec();
        item.updated_at = now;
        self.mark_current(item.id);
        self.items.insert(0, item);
        true
    }

    /// 新しい項目を先頭に入れ、上限を超えた古い項目を捨てる。
    pub fn insert(&mut self, hash: u64, content: Content, formats: Vec<String>, now: u64) {
        self.next_id += 1;
        let id = self.next_id;
        self.items.insert(
            0,
            Item {
                id,
                hash,
                content,
                formats,
                updated_at: now,
            },
        );
        self.items.truncate(HISTORY_MAX_ITEMS);
        self.mark_current(id);
    }

    /// クリップボードが履歴の項目と一致しなくなったことを記録する。
    pub fn set_status(&mut self, status: Status) {
        self.status = Some(status);
        self.current_id = None;
    }

    pub fn get(&self, id: u64) -> Option<&Item> {
        self.items.iter().find(|item| item.id == id)
    }

    pub fn view(&self) -> StateView {
        StateView {
            status: self.status.clone(),
            current_id: self.current_id,
            items: self.items.iter().map(item_view).collect(),
        }
    }

    fn mark_current(&mut self, id: u64) {
        self.current_id = Some(id);
        self.status = None;
    }
}

fn item_view(item: &Item) -> ItemView {
    let mut view = ItemView {
        id: item.id,
        kind: "text",
        text: None,
        char_count: None,
        truncated: false,
        width: None,
        height: None,
        formats: item.formats.clone(),
        updated_at: item.updated_at,
    };
    match &item.content {
        Content::Text(text) => {
            let char_count = text.chars().count();
            view.text = Some(text.chars().take(TEXT_PREVIEW_CHARS).collect());
            view.char_count = Some(char_count);
            view.truncated = char_count > TEXT_PREVIEW_CHARS;
        }
        Content::Image(image) => {
            view.kind = "image";
            view.width = Some(image.width);
            view.height = Some(image.height);
        }
    }
    view
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add_text(history: &mut History, text: &str, now: u64) {
        let hash = hash_text(text);
        if !history.promote(hash, Some(text), &[], now) {
            history.insert(hash, Content::Text(text.to_string()), Vec::new(), now);
        }
    }

    fn texts(history: &History) -> Vec<&str> {
        history
            .items
            .iter()
            .map(|item| match &item.content {
                Content::Text(text) => text.as_str(),
                Content::Image(_) => "<image>",
            })
            .collect()
    }

    fn image_content() -> Content {
        Content::Image(StoredImage {
            png: Arc::new(Vec::new()),
            thumbnail: Arc::new(Vec::new()),
            width: 1,
            height: 1,
        })
    }

    #[test]
    fn newest_item_comes_first() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        add_text(&mut history, "b", 2);
        assert_eq!(texts(&history), ["b", "a"]);
        assert_eq!(history.current_id, Some(history.items[0].id));
    }

    #[test]
    fn duplicate_moves_to_front_without_adding() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        add_text(&mut history, "b", 2);
        add_text(&mut history, "c", 3);
        let id_of_a = history.items[2].id;

        add_text(&mut history, "a", 4);

        assert_eq!(texts(&history), ["a", "c", "b"]);
        assert_eq!(history.items[0].id, id_of_a);
        assert_eq!(history.items[0].updated_at, 4);
    }

    #[test]
    fn promote_replaces_formats() {
        let mut history = History::default();
        let hash = hash_text("a");
        history.insert(
            hash,
            Content::Text("a".into()),
            vec!["HTML Format".into()],
            1,
        );
        let plain = vec!["CF_UNICODETEXT".to_string()];
        assert!(history.promote(hash, Some("a"), &plain, 2));
        assert_eq!(history.items[0].formats, plain);
    }

    #[test]
    fn oldest_item_is_dropped_over_the_limit() {
        let mut history = History::default();
        for i in 0..=HISTORY_MAX_ITEMS {
            add_text(&mut history, &i.to_string(), i as u64);
        }
        assert_eq!(history.items.len(), HISTORY_MAX_ITEMS);
        assert!(!texts(&history).contains(&"0"));
    }

    #[test]
    fn text_and_image_with_same_hash_are_distinct() {
        let mut history = History::default();
        let hash = hash_text("a");
        history.insert(hash, image_content(), Vec::new(), 1);
        assert!(!history.promote(hash, Some("a"), &[], 2));
        assert!(history.promote(hash, None, &[], 3));
    }

    #[test]
    fn status_clears_current_and_next_item_clears_status() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        history.set_status(Status::Empty);
        assert_eq!(history.current_id, None);
        assert_eq!(history.items.len(), 1);

        add_text(&mut history, "a", 2);
        assert!(history.status.is_none());
        assert_eq!(history.current_id, Some(history.items[0].id));
    }

    #[test]
    fn long_text_is_truncated_in_view() {
        let mut history = History::default();
        add_text(&mut history, &"あ".repeat(TEXT_PREVIEW_CHARS + 1), 1);
        let view = history.view();
        let item = &view.items[0];
        assert!(item.truncated);
        assert_eq!(item.char_count, Some(TEXT_PREVIEW_CHARS + 1));
        assert_eq!(
            item.text.as_ref().unwrap().chars().count(),
            TEXT_PREVIEW_CHARS
        );
    }
}

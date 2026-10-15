//! メモリー上の履歴。先頭が最新で、同じ内容は1件にまとめる。

use std::sync::Arc;

use serde::Serialize;

use crate::limits::{HISTORY_MAX_ITEMS, TEXT_PREVIEW_CHARS};

/// テキストと一緒に保存する書式付きデータ(HTMLやRTF)。形式名と中身をそのまま持つ。
pub struct RichFormat {
    pub name: String,
    pub data: Vec<u8>,
}

pub struct StoredImage {
    pub png: Arc<Vec<u8>>,
    pub thumbnail: Arc<Vec<u8>>,
    pub width: u32,
    pub height: u32,
    /// 寸法と画素から求めた重複判定用のハッシュ。
    pub hash: u64,
}

pub enum Content {
    Text {
        text: String,
        rich: Vec<RichFormat>,
    },
    Image(StoredImage),
    /// コピーされたファイルのフルパス。
    Files(Vec<String>),
}

/// 履歴の中から同じ内容の項目を探すための手がかり。
pub enum Probe<'a> {
    Text(&'a str),
    Image(u64),
    Files(&'a [String]),
}

pub struct Item {
    pub id: u64,
    pub content: Content,
    /// 最後に取得した時点でクリップボードにあった形式名。
    pub formats: Vec<String>,
    pub updated_at: u64,
}

impl Item {
    fn matches(&self, probe: &Probe) -> bool {
        match (&self.content, probe) {
            (Content::Text { text, .. }, Probe::Text(other)) => text == other,
            (Content::Image(image), Probe::Image(hash)) => image.hash == *hash,
            (Content::Files(paths), Probe::Files(other)) => paths == other,
            _ => false,
        }
    }
}

/// クリップボードが履歴に入らない状態のときの表示内容。
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Status {
    Empty,
    Unsupported { formats: Vec<String> },
    TooLarge { formats: Vec<String> },
    Error { message: String },
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
    paths: Option<Vec<String>>,
    formats: Vec<String>,
    /// 保存してある書式付きデータの形式名。再コピーで復元できるもの。
    stored_rich: Vec<String>,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateView {
    paused: bool,
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

impl History {
    /// 同じ内容の項目があれば先頭へ移動して `true` を返す。
    pub fn promote(&mut self, probe: &Probe, formats: &[String], now: u64) -> bool {
        let Some(index) = self.items.iter().position(|item| item.matches(probe)) else {
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
    pub fn insert(&mut self, content: Content, formats: Vec<String>, now: u64) {
        self.next_id += 1;
        let id = self.next_id;
        self.items.insert(
            0,
            Item {
                id,
                content,
                formats,
                updated_at: now,
            },
        );
        self.items.truncate(HISTORY_MAX_ITEMS);
        self.mark_current(id);
    }

    /// テキストを記録する。同じ文字列がすでにあれば先頭へ移動する。
    ///
    /// 書式付きデータは新しく取得できたときだけ差し替える。文字だけで
    /// コピーし直しても、保存済みの書式は残り、あとで書式付きに戻せる。
    pub fn record_text(
        &mut self,
        text: String,
        rich: Vec<RichFormat>,
        formats: Vec<String>,
        now: u64,
    ) {
        if !self.promote(&Probe::Text(&text), &formats, now) {
            self.insert(Content::Text { text, rich }, formats, now);
            return;
        }
        if rich.is_empty() {
            return;
        }
        if let Content::Text { rich: stored, .. } = &mut self.items[0].content {
            *stored = rich;
        }
    }

    /// クリップボードが履歴の項目と一致しなくなったことを記録する。
    pub fn set_status(&mut self, status: Status) {
        self.status = Some(status);
        self.current_id = None;
    }

    pub fn get(&self, id: u64) -> Option<&Item> {
        self.items.iter().find(|item| item.id == id)
    }

    /// 読み取り停止中は、表示がクリップボードと一致している保証がないので
    /// 「現在の項目」も状態も示さない。
    pub fn view(&self, paused: bool) -> StateView {
        StateView {
            paused,
            status: self.status.clone().filter(|_| !paused),
            current_id: self.current_id.filter(|_| !paused),
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
        paths: None,
        formats: item.formats.clone(),
        stored_rich: Vec::new(),
        updated_at: item.updated_at,
    };
    match &item.content {
        Content::Text { text, rich } => {
            let char_count = text.chars().count();
            view.text = Some(text.chars().take(TEXT_PREVIEW_CHARS).collect());
            view.char_count = Some(char_count);
            view.truncated = char_count > TEXT_PREVIEW_CHARS;
            view.stored_rich = rich.iter().map(|format| format.name.clone()).collect();
        }
        Content::Image(image) => {
            view.kind = "image";
            view.width = Some(image.width);
            view.height = Some(image.height);
        }
        Content::Files(paths) => {
            view.kind = "files";
            view.paths = Some(paths.clone());
        }
    }
    view
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = "HTML Format";

    fn add_text(history: &mut History, text: &str, now: u64) {
        history.record_text(text.to_string(), Vec::new(), Vec::new(), now);
    }

    fn html(data: &str) -> Vec<RichFormat> {
        vec![RichFormat {
            name: HTML.to_string(),
            data: data.as_bytes().to_vec(),
        }]
    }

    fn summary(history: &History) -> Vec<String> {
        history
            .items
            .iter()
            .map(|item| match &item.content {
                Content::Text { text, .. } => text.clone(),
                Content::Image(_) => "<image>".to_string(),
                Content::Files(paths) => paths.join("|"),
            })
            .collect()
    }

    fn stored_html(history: &History) -> Option<&[u8]> {
        match &history.items[0].content {
            Content::Text { rich, .. } => rich.first().map(|format| format.data.as_slice()),
            _ => None,
        }
    }

    fn image_content(hash: u64) -> Content {
        Content::Image(StoredImage {
            png: Arc::new(Vec::new()),
            thumbnail: Arc::new(Vec::new()),
            width: 1,
            height: 1,
            hash,
        })
    }

    #[test]
    fn newest_item_comes_first() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        add_text(&mut history, "b", 2);
        assert_eq!(summary(&history), ["b", "a"]);
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

        assert_eq!(summary(&history), ["a", "c", "b"]);
        assert_eq!(history.items[0].id, id_of_a);
        assert_eq!(history.items[0].updated_at, 4);
    }

    #[test]
    fn promote_replaces_formats() {
        let mut history = History::default();
        history.record_text("a".into(), Vec::new(), vec![HTML.into()], 1);
        let plain = vec!["CF_UNICODETEXT".to_string()];
        history.record_text("a".into(), Vec::new(), plain.clone(), 2);
        assert_eq!(history.items[0].formats, plain);
    }

    #[test]
    fn plain_recopy_keeps_stored_rich_data() {
        let mut history = History::default();
        history.record_text("a".into(), html("<b>a</b>"), Vec::new(), 1);
        history.record_text("a".into(), Vec::new(), Vec::new(), 2);
        assert_eq!(stored_html(&history), Some("<b>a</b>".as_bytes()));
        assert_eq!(history.view(false).items[0].stored_rich, [HTML]);
    }

    #[test]
    fn newer_rich_data_replaces_stored_one() {
        let mut history = History::default();
        history.record_text("a".into(), html("<b>a</b>"), Vec::new(), 1);
        history.record_text("a".into(), html("<i>a</i>"), Vec::new(), 2);
        assert_eq!(stored_html(&history), Some("<i>a</i>".as_bytes()));
        assert_eq!(history.items.len(), 1);
    }

    #[test]
    fn oldest_item_is_dropped_over_the_limit() {
        let mut history = History::default();
        for i in 0..=HISTORY_MAX_ITEMS {
            add_text(&mut history, &i.to_string(), i as u64);
        }
        assert_eq!(history.items.len(), HISTORY_MAX_ITEMS);
        assert!(!summary(&history).contains(&"0".to_string()));
    }

    #[test]
    fn different_kinds_never_match() {
        let mut history = History::default();
        history.insert(image_content(7), Vec::new(), 1);
        assert!(!history.promote(&Probe::Text("7"), &[], 2));
        assert!(!history.promote(&Probe::Image(8), &[], 2));
        assert!(history.promote(&Probe::Image(7), &[], 3));
    }

    #[test]
    fn same_files_move_to_front() {
        let mut history = History::default();
        let files = vec!["C:\\a.txt".to_string(), "C:\\b.txt".to_string()];
        history.insert(Content::Files(files.clone()), Vec::new(), 1);
        add_text(&mut history, "x", 2);

        assert!(history.promote(&Probe::Files(&files), &[], 3));
        assert!(!history.promote(&Probe::Files(&files[..1]), &[], 4));

        assert_eq!(summary(&history), ["C:\\a.txt|C:\\b.txt", "x"]);
        let view = history.view(false);
        assert_eq!(view.items[0].kind, "files");
        assert_eq!(view.items[0].paths.as_ref(), Some(&files));
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
    fn paused_view_hides_current_and_status() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        let view = history.view(true);
        assert!(view.paused);
        assert_eq!(view.current_id, None);
        assert_eq!(view.items.len(), 1);

        history.set_status(Status::Empty);
        assert!(history.view(true).status.is_none());
        assert!(history.view(false).status.is_some());
    }

    #[test]
    fn long_text_is_truncated_in_view() {
        let mut history = History::default();
        add_text(&mut history, &"あ".repeat(TEXT_PREVIEW_CHARS + 1), 1);
        let view = history.view(false);
        let item = &view.items[0];
        assert!(item.truncated);
        assert_eq!(item.char_count, Some(TEXT_PREVIEW_CHARS + 1));
        assert_eq!(
            item.text.as_ref().unwrap().chars().count(),
            TEXT_PREVIEW_CHARS
        );
    }
}

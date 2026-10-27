//! メモリー上の履歴。先頭が最新で、同じ内容は1件にまとめる。

use std::sync::Arc;

use serde::Serialize;

use crate::limits::{DEFAULT_HISTORY_MAX_ITEMS, HISTORY_MAX_ITEMS_LIMIT, TEXT_PREVIEW_CHARS};

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
    /// 固定した項目は件数の上限に数えず、捨てられない。
    pub pinned: bool,
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
    pub id: u64,
    pub kind: &'static str,
    pub text: Option<String>,
    pub char_count: Option<usize>,
    pub truncated: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub paths: Option<Vec<String>>,
    pub formats: Vec<String>,
    /// 保存してある書式付きデータの形式名。再コピーで復元できるもの。
    pub stored_rich: Vec<String>,
    pub pinned: bool,
    pub updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateView {
    pub paused: bool,
    pub status: Option<Status>,
    pub current_id: Option<u64>,
    pub items: Vec<ItemView>,
}

pub struct History {
    items: Vec<Item>,
    next_id: u64,
    current_id: Option<u64>,
    status: Option<Status>,
    /// 固定していない項目の上限。
    max_items: usize,
}

impl Default for History {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            next_id: 0,
            current_id: None,
            status: None,
            max_items: DEFAULT_HISTORY_MAX_ITEMS,
        }
    }
}

impl History {
    pub fn items(&self) -> &[Item] {
        &self.items
    }

    /// 固定していない項目の上限を変え、超えた分の古い項目を捨てる。
    pub fn set_max_items(&mut self, max_items: usize) {
        self.max_items = max_items.clamp(1, HISTORY_MAX_ITEMS_LIMIT);
        self.enforce_limit();
    }

    fn enforce_limit(&mut self) {
        let max_items = self.max_items;
        let mut unpinned = 0;
        self.items.retain(|item| {
            if item.pinned {
                return true;
            }
            unpinned += 1;
            unpinned <= max_items
        });
    }

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

    fn new_item(&mut self, content: Content, formats: Vec<String>, updated_at: u64) -> Item {
        self.next_id += 1;
        Item {
            id: self.next_id,
            content,
            formats,
            updated_at,
            pinned: false,
        }
    }

    /// 新しい項目を先頭に入れ、上限を超えた古い項目を捨てる。項目のIDを返す。
    pub fn insert(&mut self, content: Content, formats: Vec<String>, now: u64) -> u64 {
        let item = self.new_item(content, formats, now);
        let id = item.id;
        self.items.insert(0, item);
        self.enforce_limit();
        self.mark_current(id);
        id
    }

    /// ディスクから読み込んだ項目を末尾に足す。現在の項目にはしない。
    pub fn append_loaded(
        &mut self,
        content: Content,
        formats: Vec<String>,
        pinned: bool,
        updated_at: u64,
    ) {
        let mut item = self.new_item(content, formats, updated_at);
        item.pinned = pinned;
        self.items.push(item);
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

    /// 項目を削除する。現在の項目だった場合、どの行も先頭行の扱いにしない。
    pub fn remove(&mut self, id: u64) -> bool {
        let Some(index) = self.items.iter().position(|item| item.id == id) else {
            return false;
        };
        self.items.remove(index);
        if self.current_id == Some(id) {
            self.current_id = None;
        }
        true
    }

    /// 固定を切り替える。固定を外しても、次に項目が増えるまでは捨てない。
    pub fn set_pinned(&mut self, id: u64, pinned: bool) -> bool {
        let Some(item) = self.items.iter_mut().find(|item| item.id == id) else {
            return false;
        };
        item.pinned = pinned;
        true
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
        pinned: item.pinned,
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
        for i in 0..=DEFAULT_HISTORY_MAX_ITEMS {
            add_text(&mut history, &i.to_string(), i as u64);
        }
        assert_eq!(history.items.len(), DEFAULT_HISTORY_MAX_ITEMS);
        assert!(!summary(&history).contains(&"0".to_string()));
    }

    #[test]
    fn pinned_items_survive_the_limit_and_are_not_counted() {
        let mut history = History::default();
        history.set_max_items(2);
        add_text(&mut history, "keep", 1);
        let keep_id = history.items[0].id;
        assert!(history.set_pinned(keep_id, true));
        add_text(&mut history, "a", 2);
        add_text(&mut history, "b", 3);
        add_text(&mut history, "c", 4);
        assert_eq!(summary(&history), ["c", "b", "keep"]);
        assert!(history.view(false).items[2].pinned);

        // 固定を外しても、その場では捨てない
        assert!(history.set_pinned(keep_id, false));
        assert_eq!(history.items.len(), 3);
        add_text(&mut history, "d", 5);
        assert_eq!(summary(&history), ["d", "c"]);
        assert!(!history.set_pinned(999, true));
    }

    #[test]
    fn lowering_the_limit_drops_old_unpinned_items() {
        let mut history = History::default();
        for i in 0..5 {
            add_text(&mut history, &i.to_string(), i as u64);
        }
        let oldest = history.items[4].id;
        history.set_pinned(oldest, true);
        history.set_max_items(2);
        assert_eq!(summary(&history), ["4", "3", "0"]);
        history.set_max_items(0);
        assert_eq!(summary(&history), ["4", "0"]);
    }

    #[test]
    fn remove_clears_current_only_for_that_item() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        add_text(&mut history, "b", 2);
        let id_of_a = history.items[1].id;
        let id_of_b = history.items[0].id;
        assert!(history.remove(id_of_a));
        assert_eq!(history.current_id, Some(id_of_b));
        assert!(history.remove(id_of_b));
        assert_eq!(history.current_id, None);
        assert!(!history.remove(id_of_b));
        assert!(history.items.is_empty());
    }

    #[test]
    fn loaded_items_go_to_the_end_without_becoming_current() {
        let mut history = History::default();
        history.append_loaded(Content::Files(vec!["x".into()]), Vec::new(), true, 7);
        history.append_loaded(
            Content::Text {
                text: "t".into(),
                rich: Vec::new(),
            },
            Vec::new(),
            false,
            8,
        );
        assert_eq!(summary(&history), ["x", "t"]);
        assert_eq!(history.current_id, None);
        assert!(history.items[0].pinned);
        assert_ne!(history.items[0].id, history.items[1].id);

        // 読み込んだテキストと同じものをコピーすると、新しい行は増えない
        add_text(&mut history, "t", 9);
        assert_eq!(summary(&history), ["t", "x"]);
        assert_eq!(history.current_id, Some(history.items[0].id));
    }

    #[test]
    fn promote_and_recopy_keep_the_pinned_flag_and_rich_data() {
        let mut history = History::default();
        history.append_loaded(
            Content::Text {
                text: "a".into(),
                rich: html("<b>a</b>"),
            },
            Vec::new(),
            true,
            1,
        );
        add_text(&mut history, "b", 2);
        add_text(&mut history, "a", 3);
        assert_eq!(summary(&history), ["a", "b"]);
        assert!(history.items[0].pinned);
        assert_eq!(stored_html(&history), Some("<b>a</b>".as_bytes()));
    }

    #[test]
    fn pinned_items_can_be_removed() {
        let mut history = History::default();
        add_text(&mut history, "a", 1);
        let id = history.items[0].id;
        history.set_pinned(id, true);
        assert!(history.remove(id));
        assert!(history.items.is_empty());
    }

    #[test]
    fn limit_is_clamped_and_applies_to_loaded_items() {
        let mut history = History::default();
        history.set_max_items(HISTORY_MAX_ITEMS_LIMIT + 1);
        assert_eq!(history.max_items, HISTORY_MAX_ITEMS_LIMIT);
        for i in 0..4 {
            history.append_loaded(
                Content::Text {
                    text: i.to_string(),
                    rich: Vec::new(),
                },
                Vec::new(),
                i == 3,
                i,
            );
        }
        history.set_max_items(2);
        assert_eq!(summary(&history), ["0", "1", "3"]);
    }

    #[test]
    fn text_at_preview_limit_is_not_truncated() {
        let mut history = History::default();
        add_text(&mut history, &"あ".repeat(TEXT_PREVIEW_CHARS), 1);
        let view = history.view(false);
        let item = &view.items[0];
        assert!(!item.truncated);
        // 文字数はバイト数ではなく文字で数える
        assert_eq!(item.char_count, Some(TEXT_PREVIEW_CHARS));
        assert_eq!(
            item.text.as_ref().unwrap().chars().count(),
            TEXT_PREVIEW_CHARS
        );
    }

    #[test]
    fn network_file_paths_are_stored_verbatim_and_compared_as_a_whole() {
        // 共有サーバーのファイルをコピーしても中身は読まず、パスの文字列だけを持つ。
        // そのため接続が切れても履歴は壊れず、同じ並びのときだけ同一とみなす。
        let mut history = History::default();
        let unc = vec![
            "\\\\server\\share\\報告書.xlsx".to_string(),
            "\\\\server\\share\\a.txt".to_string(),
        ];
        history.insert(Content::Files(unc.clone()), Vec::new(), 1);
        // 別のサーバーや、一部だけでは一致しない
        assert!(!history.promote(
            &Probe::Files(&["\\\\other\\share\\a.txt".to_string()]),
            &[],
            2
        ));
        assert!(!history.promote(&Probe::Files(&unc[..1]), &[], 3));
        // まったく同じ並びなら先頭へ移動する
        add_text(&mut history, "x", 4);
        assert!(history.promote(&Probe::Files(&unc), &[], 5));
        let view = history.view(false);
        assert_eq!(view.items[0].kind, "files");
        assert_eq!(view.items[0].paths.as_ref(), Some(&unc));
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

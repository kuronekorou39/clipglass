//! クリップボードの変更通知を受け取り、履歴を更新するスレッド。
//! クリップボードへのアクセスは、書き戻しも含めてこのスレッドに集める。

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, GetClipboardSequenceNumber,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, RegisterClassW,
    SetTimer, TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
    WM_CLIPBOARDUPDATE, WM_TIMER, WNDCLASSW,
};

use crate::clipboard::{self, Payload};
use crate::history::{Content, History, Probe, RichFormat, Status, StoredImage};
use crate::imaging::{self, DecodeError, RawImage};
use crate::limits::CLIPBOARD_SETTLE_DELAY_MS;
use crate::{paste, AppState};
use image::RgbaImage;

/// 履歴の項目をクリップボードへ書き戻す要求。
/// wParamに項目ID、lParamに `copy_flags` の値(書式を落とすか、貼り付けるか)を入れる。
pub const WM_COPY_ITEM: u32 = WM_APP + 1;
/// 読み取りを再開する要求。停止中にコピーされた内容は読まない。
pub const WM_RESUME: u32 = WM_APP + 2;
/// `AppState::pending_text` の文字をクリップボードへ置く要求。プリセットとお気に入りの
/// コピーに使う。wParamが0以外なら、そのあと貼り付ける。
pub const WM_COPY_TEXT: u32 = WM_APP + 3;
/// `WM_COPY_ITEM` のlParamのビット。
const COPY_FLAG_PLAIN: isize = 1;
const COPY_FLAG_PASTE: isize = 2;

/// `WM_COPY_ITEM` のlParamを作る。`plain` は書式を付けない、`paste` はコピーのあと貼り付ける。
pub fn copy_flags(plain: bool, paste: bool) -> isize {
    let mut flags = 0;
    if plain {
        flags |= COPY_FLAG_PLAIN;
    }
    if paste {
        flags |= COPY_FLAG_PASTE;
    }
    flags
}
pub const STATE_EVENT: &str = "clipboard-state";
const READ_TIMER_ID: usize = 1;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// 最後に処理したシーケンス番号。通知が重なっても同じ内容を二度読まない。
static LAST_SEQUENCE: AtomicU32 = AtomicU32::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn set_status(app: &AppHandle, status: Status) {
    app.state::<AppState>()
        .history
        .lock()
        .unwrap()
        .set_status(status);
}

/// 読み取ったペイロードを履歴または状態へ反映する。OSにもAppHandleにも触れないので
/// 単体テストできる。呼び出し側が履歴のロックを渡す。
/// 取り込む準備ができたもの。履歴にもロックにも触れない純粋な結果。
/// 画像はここでデコードまで済ませ、重いPNG化はまだ行わない(ロックの外で行うため)。
enum Prepared {
    Status(Status),
    Text {
        text: String,
        rich: Vec<RichFormat>,
        formats: Vec<String>,
    },
    Files {
        paths: Vec<String>,
        formats: Vec<String>,
    },
    Image {
        image: RgbaImage,
        raw: RawImage,
        hash: u64,
        formats: Vec<String>,
    },
}

/// 読み取ったペイロードを、履歴へ入れる前の形に整える。OSにもロックにも触れない。
fn prepare(formats: Vec<String>, payload: Payload) -> Prepared {
    match payload {
        Payload::Empty => Prepared::Status(Status::Empty),
        Payload::Unsupported => Prepared::Status(Status::Unsupported { formats }),
        Payload::TooLarge => Prepared::Status(Status::TooLarge { formats }),
        Payload::Text { text, rich } => Prepared::Text {
            text,
            rich,
            formats,
        },
        Payload::Files(paths) => Prepared::Files { paths, formats },
        Payload::Image(raw) => match imaging::decode(&raw) {
            Ok(image) => {
                let hash = imaging::hash_image(&image);
                Prepared::Image {
                    image,
                    raw,
                    hash,
                    formats,
                }
            }
            Err(DecodeError::TooLarge) => Prepared::Status(Status::TooLarge { formats }),
            Err(DecodeError::Invalid(message)) => Prepared::Status(Status::Error { message }),
        },
    }
}

/// デコード済みの画像を、保存する形(PNG・サムネイル)に符号化する。重いのでロックの外で呼ぶ。
/// PNGとして受け取っていればそのまま使い、DIBのときだけPNGへ符号化する。
fn encode_image(raw: RawImage, image: &RgbaImage, hash: u64) -> Result<StoredImage, String> {
    let png = match raw {
        RawImage::Png(bytes) => bytes,
        RawImage::Dib(_) => imaging::encode_png(image)?,
    };
    let thumbnail = imaging::encode_png(&imaging::thumbnail(image))?;
    Ok(StoredImage {
        png: Arc::new(png),
        thumbnail: Arc::new(thumbnail),
        width: image.width(),
        height: image.height(),
        hash,
    })
}

/// 読み取った内容を履歴または状態へ反映する。重いPNG化は履歴のロックを持たずに行い、
/// ロックは「同じ画像かの確認」と「挿入・状態の更新」の一瞬だけ握る。
fn apply(history: &Mutex<History>, formats: Vec<String>, payload: Payload, now: u64) {
    match prepare(formats, payload) {
        Prepared::Status(status) => history.lock().unwrap().set_status(status),
        Prepared::Text {
            text,
            rich,
            formats,
        } => history
            .lock()
            .unwrap()
            .record_text(text, rich, formats, now),
        Prepared::Files { paths, formats } => {
            let mut history = history.lock().unwrap();
            if !history.promote(&Probe::Files(&paths), &formats, now) {
                history.insert(Content::Files(paths), formats, now);
            }
        }
        Prepared::Image {
            image,
            raw,
            hash,
            formats,
        } => {
            // 同じ画像なら、重いPNG化をせずに先頭へ移すだけ(ロックは一瞬)。
            if history
                .lock()
                .unwrap()
                .promote(&Probe::Image(hash), &formats, now)
            {
                return;
            }
            // PNG化とサムネイル生成はロックの外で行う。
            match encode_image(raw, &image, hash) {
                Ok(stored) => {
                    history
                        .lock()
                        .unwrap()
                        .insert(Content::Image(stored), formats, now);
                }
                Err(message) => history
                    .lock()
                    .unwrap()
                    .set_status(Status::Error { message }),
            }
        }
    }
}

pub fn emit_state(app: &AppHandle) {
    let view = crate::state_view(&app.state::<AppState>());
    let _ = app.emit(STATE_EVENT, view);
}

/// 現在のクリップボードを読み取り、履歴または状態へ反映してUIへ通知する。
fn refresh(app: &AppHandle, hwnd: HWND) {
    let state = app.state::<AppState>();
    match clipboard::read(hwnd) {
        Err(message) => state
            .history
            .lock()
            .unwrap()
            .set_status(Status::Error { message }),
        Ok(snapshot) => {
            LAST_SEQUENCE.store(snapshot.sequence, Ordering::Relaxed);
            apply(&state.history, snapshot.formats, snapshot.payload, now_ms());
        }
    }
    crate::history_changed(app);
}

/// 読み取りを再開する。今のクリップボードは読まず、処理済みの位置だけを進めるので、停止中の
/// コピーは記録されない。停止中に変わっていれば、先頭行はもうクリップボードと一致しない。
/// 読み取りのタイマーと同じスレッドで動くので、位置を進める前に停止が解けることはない。
fn resume(app: &AppHandle, sequence: u32) {
    let state = app.state::<AppState>();
    if LAST_SEQUENCE.swap(sequence, Ordering::Relaxed) != sequence {
        state.history.lock().unwrap().forget_current();
    }
    state.paused.store(false, Ordering::Relaxed);
    emit_state(app);
}

/// 履歴の項目を書き戻す。成功すれば変更通知が届き、通常の経路で先頭へ移動する。
/// `plain` が真なら、保存してある書式付きデータを付けずに文字だけを置く。
/// `paste_after` が真なら、書き戻したあと直前に使っていたウィンドウへ貼り付ける。
fn copy_item(app: &AppHandle, hwnd: HWND, id: u64, plain: bool, paste_after: bool) {
    let state = app.state::<AppState>();
    let result = {
        // 画像以外は小さいので、ロックしたまま書き戻す。
        let history = state.history.lock().unwrap();
        match history.get(id).map(|item| &item.content) {
            Some(Content::Text { text, rich }) => {
                let rich = if plain { &[][..] } else { rich.as_slice() };
                clipboard::write_text(hwnd, text, rich)
            }
            Some(Content::Files(paths)) => clipboard::write_files(hwnd, paths),
            Some(Content::Image(image)) => {
                let png = Arc::clone(&image.png);
                drop(history);
                match imaging::decode(&RawImage::Png(png.to_vec())) {
                    Ok(image) => clipboard::write_image(hwnd, &png, &imaging::to_dib(&image)),
                    Err(_) => Err("画像を変換できませんでした".to_string()),
                }
            }
            None => return,
        }
    };
    finish_copy(app, result, paste_after);
}

/// 書き戻しの結果を受けて、成功なら(求められていれば)貼り付け、失敗なら状態行に出す。
fn finish_copy(app: &AppHandle, result: Result<(), String>, paste_after: bool) {
    match result {
        Ok(()) if paste_after => paste::paste_into_last_window(),
        Ok(()) => {}
        Err(message) => {
            set_status(app, Status::Error { message });
            emit_state(app);
        }
    }
}

/// プリセットの文字を書き戻す。成功すれば変更通知が届き、通常の経路で履歴に入る。
fn copy_pending_text(app: &AppHandle, hwnd: HWND, paste_after: bool) {
    let text = app.state::<AppState>().pending_text.lock().unwrap().take();
    let Some(text) = text else {
        return;
    };
    finish_copy(app, clipboard::write_text(hwnd, &text, &[]), paste_after);
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let Some(app) = APP.get() else {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    };
    match message {
        WM_CLIPBOARDUPDATE => {
            // 連続した通知ではタイマーが掛け直され、最後の1回だけ読み取る。
            SetTimer(Some(hwnd), READ_TIMER_ID, CLIPBOARD_SETTLE_DELAY_MS, None);
            LRESULT(0)
        }
        WM_TIMER if wparam.0 == READ_TIMER_ID => {
            let _ = KillTimer(Some(hwnd), READ_TIMER_ID);
            // 停止中はクリップボードに一切触らない。
            let paused = app.state::<AppState>().paused.load(Ordering::Relaxed);
            if !paused && GetClipboardSequenceNumber() != LAST_SEQUENCE.load(Ordering::Relaxed) {
                refresh(app, hwnd);
            }
            LRESULT(0)
        }
        WM_RESUME => {
            resume(app, GetClipboardSequenceNumber());
            LRESULT(0)
        }
        WM_COPY_ITEM => {
            copy_item(
                app,
                hwnd,
                wparam.0 as u64,
                lparam.0 & COPY_FLAG_PLAIN != 0,
                lparam.0 & COPY_FLAG_PASTE != 0,
            );
            LRESULT(0)
        }
        WM_COPY_TEXT => {
            copy_pending_text(app, hwnd, wparam.0 != 0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

unsafe fn run(app: AppHandle) -> windows::core::Result<()> {
    let class_name = w!("ClipglassWatcher");
    let instance = GetModuleHandleW(None)?;
    RegisterClassW(&WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance.into(),
        lpszClassName: class_name,
        ..Default::default()
    });
    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        class_name,
        class_name,
        WINDOW_STYLE::default(),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        Some(instance.into()),
        None,
    )?;
    AddClipboardFormatListener(hwnd)?;
    // 貼り付け先を覚えるために、前面のウィンドウの切り替わりも同じスレッドで受ける
    paste::watch_foreground();
    app.state::<AppState>()
        .watcher_hwnd
        .store(hwnd.0 as isize, Ordering::Relaxed);

    refresh(&app, hwnd);
    let _ = APP.set(app);

    let mut message = MSG::default();
    while GetMessageW(&mut message, None, 0, 0).as_bool() {
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    Ok(())
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = unsafe { run(app.clone()) } {
            let message = format!(
                "クリップボードの監視を開始できませんでした: {}",
                e.message()
            );
            set_status(&app, Status::Error { message });
            emit_state(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::sync::Mutex;

    fn sample() -> RgbaImage {
        RgbaImage::from_pixel(2, 3, Rgba([10, 20, 30, 255]))
    }

    fn dib_payload() -> Payload {
        Payload::Image(RawImage::Dib(imaging::to_dib(&sample())))
    }

    #[test]
    fn copy_flags_pack_plain_and_paste_independently() {
        assert_eq!(copy_flags(false, false), 0);
        let both = copy_flags(true, true);
        assert_ne!(both & COPY_FLAG_PLAIN, 0);
        assert_ne!(both & COPY_FLAG_PASTE, 0);
        assert_eq!(copy_flags(true, false) & COPY_FLAG_PASTE, 0);
        assert_eq!(copy_flags(false, true) & COPY_FLAG_PLAIN, 0);
    }

    // --- prepare: OSにもロックにも触れない判定(デコードを含む) ---

    #[test]
    fn prepare_maps_each_payload() {
        assert!(matches!(
            prepare(vec![], Payload::Empty),
            Prepared::Status(Status::Empty)
        ));
        assert!(matches!(
            prepare(vec!["X".to_string()], Payload::Unsupported),
            Prepared::Status(Status::Unsupported { .. })
        ));
        assert!(matches!(
            prepare(vec![], Payload::TooLarge),
            Prepared::Status(Status::TooLarge { .. })
        ));
        assert!(matches!(
            prepare(
                vec![],
                Payload::Text {
                    text: "a".to_string(),
                    rich: vec![]
                }
            ),
            Prepared::Text { .. }
        ));
        assert!(matches!(
            prepare(vec![], Payload::Files(vec!["x".to_string()])),
            Prepared::Files { .. }
        ));
    }

    #[test]
    fn prepare_decodes_image_and_maps_errors() {
        // 正常な画像はデコードまで済ませ、ハッシュを持つ
        assert!(matches!(
            prepare(vec![], dib_payload()),
            Prepared::Image { .. }
        ));
        // 壊れた画像はエラー状態
        assert!(matches!(
            prepare(vec![], Payload::Image(RawImage::Png(vec![0u8; 16]))),
            Prepared::Status(Status::Error { .. })
        ));
        // 巨大な画像は「大きすぎ」状態(確保の前に弾く)
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&8000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&8000i32.to_le_bytes());
        assert!(matches!(
            prepare(vec![], Payload::Image(RawImage::Dib(dib))),
            Prepared::Status(Status::TooLarge { .. })
        ));
    }

    // --- encode_image: 重い符号化(ロックの外で呼ぶ純粋関数) ---

    #[test]
    fn encode_image_reuses_png_source_and_builds_thumbnail() {
        let image = sample();
        // PNGとして受け取ったらそのまま使う
        let stored = encode_image(RawImage::Png(vec![1, 2, 3]), &image, 42).unwrap();
        assert_eq!(stored.png.as_slice(), &[1, 2, 3]);
        assert!(!stored.thumbnail.is_empty());
        assert_eq!((stored.width, stored.height, stored.hash), (2, 3, 42));
        // DIBならPNGへ符号化する
        let stored = encode_image(RawImage::Dib(imaging::to_dib(&image)), &image, 7).unwrap();
        assert!(stored.png.as_slice().starts_with(&[0x89, b'P', b'N', b'G']));
    }

    // --- apply: ロックの外で符号化しつつ、履歴/状態へ反映する ---

    #[test]
    fn apply_records_image_with_dimensions_and_dedups() {
        let history = Mutex::new(History::default());
        apply(&history, vec![], dib_payload(), 1);
        {
            let view = history.lock().unwrap().view(false);
            assert_eq!(view.items[0].kind, "image");
            assert_eq!(
                (view.items[0].width, view.items[0].height),
                (Some(2), Some(3))
            );
        }
        // 同じ画像は増やさず、先頭へ移すだけ
        apply(&history, vec![], dib_payload(), 2);
        assert_eq!(history.lock().unwrap().view(false).items.len(), 1);
    }

    #[test]
    fn apply_records_text_files_and_status() {
        let history = Mutex::new(History::default());
        apply(
            &history,
            vec![],
            Payload::Text {
                text: "a".to_string(),
                rich: vec![],
            },
            1,
        );
        assert_eq!(history.lock().unwrap().view(false).items[0].kind, "text");

        apply(
            &history,
            vec![],
            Payload::Files(vec!["a.txt".to_string()]),
            2,
        );
        assert_eq!(history.lock().unwrap().view(false).items[0].kind, "files");

        apply(&history, vec![], Payload::Empty, 3);
        assert!(matches!(
            history.lock().unwrap().view(false).status,
            Some(Status::Empty)
        ));
    }

    #[test]
    fn apply_sets_error_for_corrupt_image() {
        let history = Mutex::new(History::default());
        apply(
            &history,
            vec![],
            Payload::Image(RawImage::Png(vec![0u8; 16])),
            1,
        );
        assert!(matches!(
            history.lock().unwrap().view(false).status,
            Some(Status::Error { .. })
        ));
    }

    #[test]
    fn copy_flags_values_are_distinct() {
        let all = [
            copy_flags(false, false),
            copy_flags(true, false),
            copy_flags(false, true),
            copy_flags(true, true),
        ];
        for (i, flags) in all.iter().enumerate() {
            assert!(!all[..i].contains(flags));
        }
    }

    #[test]
    fn now_ms_is_after_2020() {
        const JAN_2020_MS: u64 = 1_577_836_800_000;
        assert!(now_ms() > JAN_2020_MS);
    }

    #[test]
    fn prepare_keeps_formats_for_status_text_files_and_image() {
        let formats = || vec!["A".to_string(), "B".to_string()];
        assert!(matches!(
            prepare(formats(), Payload::Unsupported),
            Prepared::Status(Status::Unsupported { formats }) if formats == ["A", "B"]
        ));
        assert!(matches!(
            prepare(formats(), Payload::TooLarge),
            Prepared::Status(Status::TooLarge { formats }) if formats == ["A", "B"]
        ));
        assert!(matches!(
            prepare(formats(), Payload::Files(vec!["x".to_string()])),
            Prepared::Files { paths, formats } if paths == ["x"] && formats == ["A", "B"]
        ));
        assert!(matches!(
            prepare(
                formats(),
                Payload::Text { text: "t".to_string(), rich: vec![] }
            ),
            Prepared::Text { text, formats, .. } if text == "t" && formats == ["A", "B"]
        ));
        assert!(matches!(
            prepare(formats(), dib_payload()),
            Prepared::Image { formats, hash, .. }
                if formats == ["A", "B"] && hash == imaging::hash_image(&sample())
        ));
    }

    #[test]
    fn encode_image_thumbnail_is_limited_for_large_images() {
        let edge = crate::limits::THUMBNAIL_MAX_EDGE * 2;
        let image = RgbaImage::from_pixel(edge, edge / 2, Rgba([1, 2, 3, 255]));
        let stored = encode_image(RawImage::Dib(imaging::to_dib(&image)), &image, 1).unwrap();
        assert_eq!((stored.width, stored.height), (edge, edge / 2));
        let thumbnail = imaging::decode(&RawImage::Png(stored.thumbnail.to_vec())).unwrap();
        assert_eq!(thumbnail.width(), crate::limits::THUMBNAIL_MAX_EDGE);
    }

    #[test]
    fn apply_stores_png_source_bytes_unchanged() {
        let png = imaging::encode_png(&sample()).unwrap();
        let history = Mutex::new(History::default());
        apply(
            &history,
            vec![],
            Payload::Image(RawImage::Png(png.clone())),
            1,
        );
        let history = history.lock().unwrap();
        match &history.items()[0].content {
            Content::Image(image) => assert_eq!(*image.png, png),
            _ => panic!("画像になりませんでした"),
        }
    }

    #[test]
    fn apply_moves_same_files_to_top_without_adding() {
        let history = Mutex::new(History::default());
        let files = || Payload::Files(vec!["a.txt".to_string()]);
        apply(&history, vec![], files(), 1);
        apply(
            &history,
            vec![],
            Payload::Text {
                text: "b".to_string(),
                rich: vec![],
            },
            2,
        );
        apply(&history, vec!["CF_HDROP".to_string()], files(), 3);
        let view = history.lock().unwrap().view(false);
        assert_eq!(view.items.len(), 2);
        assert_eq!(view.items[0].kind, "files");
        assert_eq!(view.items[0].updated_at, 3);
        assert_eq!(view.items[0].formats, ["CF_HDROP"]);
    }

    #[test]
    fn apply_keeps_items_when_image_is_too_large() {
        let history = Mutex::new(History::default());
        apply(
            &history,
            vec![],
            Payload::Text {
                text: "残る".to_string(),
                rich: vec![],
            },
            1,
        );
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&8000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&8000i32.to_le_bytes());
        apply(&history, vec![], Payload::Image(RawImage::Dib(dib)), 2);
        let view = history.lock().unwrap().view(false);
        assert_eq!(view.items.len(), 1);
        assert!(matches!(view.status, Some(Status::TooLarge { .. })));
        // 状態行が出ている間は、どの行も現在の項目にしない
        assert_eq!(view.current_id, None);
    }

    #[test]
    fn apply_different_images_become_separate_items() {
        let history = Mutex::new(History::default());
        apply(&history, vec![], dib_payload(), 1);
        let other = RgbaImage::from_pixel(2, 3, Rgba([200, 20, 30, 255]));
        apply(
            &history,
            vec![],
            Payload::Image(RawImage::Dib(imaging::to_dib(&other))),
            2,
        );
        assert_eq!(history.lock().unwrap().view(false).items.len(), 2);
    }
}

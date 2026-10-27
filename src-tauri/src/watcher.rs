//! クリップボードの変更通知を受け取り、履歴を更新するスレッド。
//! クリップボードへのアクセスは、書き戻しも含めてこのスレッドに集める。

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
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
use crate::history::{Content, History, Probe, Status, StoredImage};
use crate::imaging::{self, DecodeError, RawImage};
use crate::limits::CLIPBOARD_SETTLE_DELAY_MS;
use crate::AppState;

/// 履歴の項目をクリップボードへ書き戻す要求。
/// wParamに項目ID、lParamに書式を落とすかどうか(0以外で文字だけ)を入れる。
pub const WM_COPY_ITEM: u32 = WM_APP + 1;
/// 現在のクリップボードを読み直す要求。読み取りの再開時に使う。
pub const WM_REFRESH: u32 = WM_APP + 2;
/// `AppState::pending_text` の文字をクリップボードへ置く要求。プリセットのコピーに使う。
pub const WM_COPY_TEXT: u32 = WM_APP + 3;
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
fn ingest(history: &mut History, formats: Vec<String>, payload: Payload, now: u64) {
    match payload {
        Payload::Empty => history.set_status(Status::Empty),
        Payload::Text { text, rich } => history.record_text(text, rich, formats, now),
        Payload::Files(paths) => {
            if !history.promote(&Probe::Files(&paths), &formats, now) {
                history.insert(Content::Files(paths), formats, now);
            }
        }
        Payload::Unsupported => history.set_status(Status::Unsupported { formats }),
        Payload::TooLarge => history.set_status(Status::TooLarge { formats }),
        Payload::Image(raw) => ingest_image(history, raw, formats, now),
    }
}

fn ingest_image(history: &mut History, raw: RawImage, formats: Vec<String>, now: u64) {
    let image = match imaging::decode(&raw) {
        Ok(image) => image,
        Err(DecodeError::TooLarge) => {
            history.set_status(Status::TooLarge { formats });
            return;
        }
        Err(DecodeError::Invalid(message)) => {
            history.set_status(Status::Error { message });
            return;
        }
    };
    let hash = imaging::hash_image(&image);
    // 同じ画像なら、重いPNG化をせずに先頭へ移すだけ。
    if history.promote(&Probe::Image(hash), &formats, now) {
        return;
    }
    let png = match raw {
        RawImage::Png(bytes) => bytes,
        RawImage::Dib(_) => match imaging::encode_png(&image) {
            Ok(png) => png,
            Err(message) => {
                history.set_status(Status::Error { message });
                return;
            }
        },
    };
    let thumbnail = match imaging::encode_png(&imaging::thumbnail(&image)) {
        Ok(thumbnail) => thumbnail,
        Err(message) => {
            history.set_status(Status::Error { message });
            return;
        }
    };
    history.insert(
        Content::Image(StoredImage {
            png: Arc::new(png),
            thumbnail: Arc::new(thumbnail),
            width: image.width(),
            height: image.height(),
            hash,
        }),
        formats,
        now,
    );
}

pub fn emit_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paused = state.paused.load(Ordering::Relaxed);
    let view = state.history.lock().unwrap().view(paused);
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
            ingest(
                &mut state.history.lock().unwrap(),
                snapshot.formats,
                snapshot.payload,
                now_ms(),
            );
        }
    }
    crate::history_changed(app);
}

/// 履歴の項目を書き戻す。成功すれば変更通知が届き、通常の経路で先頭へ移動する。
/// `plain` が真なら、保存してある書式付きデータを付けずに文字だけを置く。
fn copy_item(app: &AppHandle, hwnd: HWND, id: u64, plain: bool) {
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
    if let Err(message) = result {
        set_status(app, Status::Error { message });
        emit_state(app);
    }
}

/// プリセットの文字を書き戻す。成功すれば変更通知が届き、通常の経路で履歴に入る。
fn copy_pending_text(app: &AppHandle, hwnd: HWND) {
    let text = app.state::<AppState>().pending_text.lock().unwrap().take();
    let Some(text) = text else {
        return;
    };
    if let Err(message) = clipboard::write_text(hwnd, &text, &[]) {
        set_status(app, Status::Error { message });
        emit_state(app);
    }
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
        WM_REFRESH => {
            refresh(app, hwnd);
            LRESULT(0)
        }
        WM_COPY_ITEM => {
            copy_item(app, hwnd, wparam.0 as u64, lparam.0 != 0);
            LRESULT(0)
        }
        WM_COPY_TEXT => {
            copy_pending_text(app, hwnd);
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

    fn text(body: &str) -> Payload {
        Payload::Text {
            text: body.to_string(),
            rich: Vec::new(),
        }
    }

    #[test]
    fn text_is_recorded_and_duplicates_only_promote() {
        let mut history = History::default();
        ingest(&mut history, Vec::new(), text("a"), 1);
        ingest(&mut history, Vec::new(), text("a"), 2);
        let view = history.view(false);
        assert_eq!(view.items.len(), 1);
        assert_eq!(view.items[0].kind, "text");
    }

    #[test]
    fn files_are_recorded() {
        let mut history = History::default();
        ingest(
            &mut history,
            Vec::new(),
            Payload::Files(vec!["C:\\a.txt".to_string()]),
            1,
        );
        assert_eq!(history.view(false).items[0].kind, "files");
    }

    #[test]
    fn empty_unsupported_and_too_large_set_status() {
        let mut history = History::default();
        ingest(&mut history, Vec::new(), Payload::Empty, 1);
        assert!(matches!(history.view(false).status, Some(Status::Empty)));

        ingest(&mut history, vec!["X".to_string()], Payload::Unsupported, 2);
        assert!(matches!(
            history.view(false).status,
            Some(Status::Unsupported { .. })
        ));

        ingest(&mut history, Vec::new(), Payload::TooLarge, 3);
        assert!(matches!(
            history.view(false).status,
            Some(Status::TooLarge { .. })
        ));
    }

    #[test]
    fn valid_image_is_stored_with_dimensions_and_dedups() {
        let mut history = History::default();
        let image = RgbaImage::from_pixel(2, 3, Rgba([10, 20, 30, 255]));
        let dib = || Payload::Image(RawImage::Dib(imaging::to_dib(&image)));
        ingest(&mut history, Vec::new(), dib(), 1);
        let view = history.view(false);
        assert_eq!(view.items[0].kind, "image");
        assert_eq!(view.items[0].width, Some(2));
        assert_eq!(view.items[0].height, Some(3));
        // 同じ画像は増やさず、先頭へ移すだけ
        ingest(&mut history, Vec::new(), dib(), 2);
        assert_eq!(history.view(false).items.len(), 1);
    }

    #[test]
    fn oversized_image_sets_too_large_status() {
        let mut history = History::default();
        // BITMAPINFOHEADER(40バイト)に巨大な寸法を宣言したDIB
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&8000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&8000i32.to_le_bytes());
        ingest(
            &mut history,
            vec!["CF_DIB".to_string()],
            Payload::Image(RawImage::Dib(dib)),
            1,
        );
        assert!(matches!(
            history.view(false).status,
            Some(Status::TooLarge { .. })
        ));
    }

    #[test]
    fn corrupt_image_sets_error_status() {
        let mut history = History::default();
        ingest(
            &mut history,
            Vec::new(),
            Payload::Image(RawImage::Png(vec![0u8; 16])),
            1,
        );
        assert!(matches!(
            history.view(false).status,
            Some(Status::Error { .. })
        ));
    }
}

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
use crate::history::{hash_text, Content, Status, StoredImage};
use crate::imaging::{self, DecodeError, RawImage};
use crate::limits::CLIPBOARD_SETTLE_DELAY_MS;
use crate::AppState;

/// 履歴の項目をクリップボードへ書き戻す要求。wParamに項目IDを入れる。
pub const WM_COPY_ITEM: u32 = WM_APP + 1;
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

fn record_text(app: &AppHandle, text: String, formats: Vec<String>) {
    let hash = hash_text(&text);
    let now = now_ms();
    let state = app.state::<AppState>();
    let mut history = state.history.lock().unwrap();
    if !history.promote(hash, Some(&text), &formats, now) {
        history.insert(hash, Content::Text(text), formats, now);
    }
}

fn record_image(app: &AppHandle, raw: RawImage, formats: Vec<String>) -> Result<(), DecodeError> {
    let image = imaging::decode(&raw)?;
    let hash = imaging::hash_image(&image);
    let state = app.state::<AppState>();
    if state
        .history
        .lock()
        .unwrap()
        .promote(hash, None, &formats, now_ms())
    {
        return Ok(());
    }

    // PNG化とサムネイル生成は重いので、履歴のロックを持たずに行う。
    let png = match raw {
        RawImage::Png(bytes) => bytes,
        RawImage::Dib(_) => imaging::encode_png(&image).map_err(DecodeError::Invalid)?,
    };
    let thumbnail =
        imaging::encode_png(&imaging::thumbnail(&image)).map_err(DecodeError::Invalid)?;
    let content = Content::Image(StoredImage {
        png: Arc::new(png),
        thumbnail: Arc::new(thumbnail),
        width: image.width(),
        height: image.height(),
    });
    state
        .history
        .lock()
        .unwrap()
        .insert(hash, content, formats, now_ms());
    Ok(())
}

fn emit_state(app: &AppHandle) {
    let view = app.state::<AppState>().history.lock().unwrap().view();
    let _ = app.emit(STATE_EVENT, view);
}

/// 現在のクリップボードを読み取り、履歴または状態へ反映してUIへ通知する。
fn refresh(app: &AppHandle, hwnd: HWND) {
    match clipboard::read(hwnd) {
        Err(message) => set_status(app, Status::Error { message }),
        Ok(snapshot) => {
            LAST_SEQUENCE.store(snapshot.sequence, Ordering::Relaxed);
            let formats = snapshot.formats;
            match snapshot.payload {
                Payload::Empty => set_status(app, Status::Empty),
                Payload::Text(text) => record_text(app, text, formats),
                Payload::Image(raw) => match record_image(app, raw, formats.clone()) {
                    Ok(()) => {}
                    Err(DecodeError::TooLarge) => set_status(app, Status::TooLarge { formats }),
                    Err(DecodeError::Invalid(message)) => {
                        set_status(app, Status::Error { message })
                    }
                },
                Payload::Files(names) => set_status(app, Status::Files { names, formats }),
                Payload::Unsupported => set_status(app, Status::Unsupported { formats }),
                Payload::TooLarge => set_status(app, Status::TooLarge { formats }),
            }
        }
    }
    emit_state(app);
}

/// 履歴の項目を書き戻す。成功すれば変更通知が届き、通常の経路で先頭へ移動する。
fn copy_item(app: &AppHandle, hwnd: HWND, id: u64) {
    enum Source {
        Text(String),
        Png(Arc<Vec<u8>>),
    }
    let state = app.state::<AppState>();
    let source = {
        let history = state.history.lock().unwrap();
        match history.get(id).map(|item| &item.content) {
            Some(Content::Text(text)) => Source::Text(text.clone()),
            Some(Content::Image(image)) => Source::Png(Arc::clone(&image.png)),
            None => return,
        }
    };
    let result = match source {
        Source::Text(text) => clipboard::write_text(hwnd, &text),
        Source::Png(png) => match imaging::decode(&RawImage::Png(png.to_vec())) {
            Ok(image) => clipboard::write_image(hwnd, &png, &imaging::to_dib(&image)),
            Err(_) => Err("画像を変換できませんでした".to_string()),
        },
    };
    if let Err(message) = result {
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
            if GetClipboardSequenceNumber() != LAST_SEQUENCE.load(Ordering::Relaxed) {
                refresh(app, hwnd);
            }
            LRESULT(0)
        }
        WM_COPY_ITEM => {
            copy_item(app, hwnd, wparam.0 as u64);
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
            let message = format!("クリップボードの監視を開始できませんでした: {}", e.message());
            set_status(&app, Status::Error { message });
            emit_state(&app);
        }
    });
}

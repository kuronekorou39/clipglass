mod clipboard;
mod history;
mod imaging;
mod limits;
mod save;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::StateFlags;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, PostMessageW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE,
    LWA_ALPHA, WS_EX_LAYERED,
};

use history::{Content, History, StateView};

const MAIN_WINDOW: &str = "main";
/// 履歴の画像をUIへ渡すURLスキーム。`/full/<id>` と `/thumb/<id>` を返す。
const IMAGE_SCHEME: &str = "clipimg";

pub struct AppState {
    pub history: Mutex<History>,
    /// 監視スレッドのウィンドウ。書き戻しの要求を送る先。
    pub watcher_hwnd: AtomicIsize,
    saving: AtomicBool,
    /// 読み取り停止中かどうか。停止中は変更通知が来てもクリップボードを開かない。
    pub paused: AtomicBool,
    /// 現在の不透明度(0〜255)。スタイルが作り直されたときの掛け直しに使う。
    window_alpha: AtomicU8,
}

#[tauri::command]
fn get_state(state: State<AppState>) -> StateView {
    state
        .history
        .lock()
        .unwrap()
        .view(state.paused.load(Ordering::Relaxed))
}

#[tauri::command]
fn post_to_watcher(
    state: &AppState,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> Result<(), String> {
    let hwnd = HWND(state.watcher_hwnd.load(Ordering::Relaxed) as *mut _);
    unsafe { PostMessageW(Some(hwnd), message, WPARAM(wparam), LPARAM(lparam)) }
        .map_err(|e| e.message())
}

/// `plain` が真なら、書式付きデータを付けずに文字だけをコピーする。
#[tauri::command]
fn copy_item(state: State<AppState>, id: u64, plain: bool) -> Result<(), String> {
    post_to_watcher(
        &state,
        watcher::WM_COPY_ITEM,
        id as usize,
        isize::from(plain),
    )
}

#[tauri::command]
fn set_paused(app: AppHandle, state: State<AppState>, paused: bool) -> Result<(), String> {
    state.paused.store(paused, Ordering::Relaxed);
    if paused {
        watcher::emit_state(&app);
        Ok(())
    } else {
        // 再開したら、その時点の内容を読み直す。
        post_to_watcher(&state, watcher::WM_REFRESH, 0, 0)
    }
}

/// ウィンドウ全体に不透明度を掛ける。
///
/// taoは表示や最前面の切り替えのたびに拡張スタイルを作り直し、WS_EX_LAYEREDを
/// 落とす。そのため、スタイルが変わる操作の後は毎回これを呼び直す。
fn apply_window_alpha(window: &WebviewWindow, state: &AppState) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let alpha = state.window_alpha.load(Ordering::Relaxed);
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongW(hwnd, GWL_EXSTYLE, (ex_style | WS_EX_LAYERED.0) as i32);
        SetLayeredWindowAttributes(hwnd, Default::default(), alpha, LWA_ALPHA)
            .map_err(|e| e.message())
    }
}

#[tauri::command]
fn set_window_opacity(
    window: WebviewWindow,
    state: State<AppState>,
    opacity: f64,
) -> Result<(), String> {
    let alpha = (opacity.clamp(limits::MIN_WINDOW_OPACITY, 1.0) * f64::from(u8::MAX)) as u8;
    state.window_alpha.store(alpha, Ordering::Relaxed);
    apply_window_alpha(&window, &state)
}

#[tauri::command]
fn set_pinned(window: WebviewWindow, state: State<AppState>, pinned: bool) -> Result<(), String> {
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    apply_window_alpha(&window, &state)
}

#[tauri::command]
fn show_window(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    apply_window_alpha(&window, &state)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveOutcome {
    saved: bool,
    /// 次回の初期フォルダーとしてUIが記憶する。
    directory: Option<String>,
}

/// 保存処理が重ならないようにするフラグ。スコープを抜けると解除する。
struct SavingGuard<'a>(&'a AtomicBool);

impl<'a> SavingGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| Self(flag))
    }
}

impl Drop for SavingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn save_image(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    default_dir: Option<String>,
) -> Result<SaveOutcome, String> {
    let Some(_guard) = SavingGuard::acquire(&state.saving) else {
        return Err("保存処理中です".into());
    };

    // ダイアログを開く前に保存対象を固定する。
    let png = match state.history.lock().unwrap().get(id).map(|i| &i.content) {
        Some(Content::Image(image)) => Arc::clone(&image.png),
        _ => return Err("保存できる画像がありません".into()),
    };

    let directory = default_dir
        .map(PathBuf::from)
        .filter(|dir| dir.is_dir())
        .or_else(|| app.path().picture_dir().ok());
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("画像を保存")
        .set_file_name(save::default_file_name(chrono::Local::now().naive_local()))
        .add_filter("PNG画像", &["png"]);
    if let Some(directory) = directory {
        dialog = dialog.set_directory(directory);
    }

    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(SaveOutcome {
            saved: false,
            directory: None,
        });
    };

    let path = save::ensure_png_extension(picked.into_path().map_err(|e| e.to_string())?);
    save::write_atomically(&path, &png)?;
    Ok(SaveOutcome {
        saved: true,
        directory: path.parent().map(|dir| dir.to_string_lossy().into_owned()),
    })
}

fn image_response(app: &AppHandle, path: &str) -> Option<Vec<u8>> {
    let mut segments = path.trim_start_matches('/').split('/');
    let variant = segments.next()?;
    let id: u64 = segments.next()?.parse().ok()?;
    let state = app.state::<AppState>();
    let history = state.history.lock().unwrap();
    let Content::Image(image) = &history.get(id)?.content else {
        return None;
    };
    match variant {
        "full" => Some(image.png.to_vec()),
        "thumb" => Some(image.thumbnail.to_vec()),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = apply_window_alpha(&window, &app.state::<AppState>());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .manage(AppState {
            history: Mutex::new(History::default()),
            watcher_hwnd: AtomicIsize::new(0),
            saving: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            window_alpha: AtomicU8::new(u8::MAX),
        })
        .register_uri_scheme_protocol(IMAGE_SCHEME, |context, request| {
            let (status, body) = match image_response(context.app_handle(), request.uri().path()) {
                Some(bytes) => (StatusCode::OK, bytes),
                None => (StatusCode::NOT_FOUND, Vec::new()),
            };
            // コピー内容をWebViewのディスクキャッシュに残さない。
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "image/png")
                .header(header::CACHE_CONTROL, "no-store")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(body)
                .unwrap()
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            copy_item,
            set_paused,
            set_window_opacity,
            set_pinned,
            show_window,
            save_image,
        ])
        .setup(|app| {
            watcher::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

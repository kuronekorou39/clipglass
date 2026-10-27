mod clipboard;
mod config;
mod drag;
mod history;
mod imaging;
mod limits;
mod placement;
mod presets;
mod save;
mod store;
mod watcher;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::http::{header, Response, StatusCode};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_window_state::StateFlags;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, PostMessageW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE,
    LWA_ALPHA, WS_EX_LAYERED,
};

use config::Config;
use history::{Content, History, StateView};
use placement::{Corner, DragKind, Rect};
use presets::NodeView;
use store::Store;

const MAIN_WINDOW: &str = "main";
/// 履歴の画像をUIへ渡すURLスキーム。`/full/<id>` と `/thumb/<id>` を返す。
const IMAGE_SCHEME: &str = "clipimg";
/// 履歴の保存やショートカットの登録など、状態行に出さない通知をUIへ送るイベント。
const NOTICE_EVENT: &str = "notice";
const HISTORY_DIR: &str = "history";
const TRAY_SHOW: &str = "show";
const TRAY_QUIT: &str = "quit";
/// 画面の隅に置くときの、隅からの余白(論理ピクセル)。
const SNAP_MARGIN: f64 = 8.0;

/// データフォルダーの中の置き場所。`setup` で決まる。
struct Paths {
    data_dir: PathBuf,
    config_file: PathBuf,
    presets_file: PathBuf,
    store: Store,
}

pub struct AppState {
    pub history: Mutex<History>,
    /// 監視スレッドのウィンドウ。書き戻しの要求を送る先。
    pub watcher_hwnd: AtomicIsize,
    saving: AtomicBool,
    /// 読み取り停止中かどうか。停止中は変更通知が来てもクリップボードを開かない。
    pub paused: AtomicBool,
    /// 現在の不透明度(0〜255)。スタイルが作り直されたときの掛け直しに使う。
    window_alpha: AtomicU8,
    /// プリセットの文字をクリップボードへ置く要求。監視スレッドが取り出す。
    pub pending_text: Mutex<Option<String>>,
    config: Mutex<Config>,
    paths: OnceLock<Paths>,
    /// UIが起動する前に起きた問題。最初の設定の取得で渡す。
    startup_notices: Mutex<Vec<String>>,
}

impl AppState {
    fn paths(&self) -> &Paths {
        self.paths.get().expect("setup で初期化される")
    }
}

#[tauri::command]
fn get_state(state: State<AppState>) -> StateView {
    state
        .history
        .lock()
        .unwrap()
        .view(state.paused.load(Ordering::Relaxed))
}

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

#[tauri::command]
fn remove_item(app: AppHandle, state: State<AppState>, id: u64) {
    state.history.lock().unwrap().remove(id);
    history_changed(&app);
}

#[tauri::command]
fn set_item_pinned(app: AppHandle, state: State<AppState>, id: u64, pinned: bool) {
    state.history.lock().unwrap().set_pinned(id, pinned);
    history_changed(&app);
}

/// 履歴をディスクへ書く。失敗は状態行ではなく通知として知らせる。
fn persist_history(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(paths) = state.paths.get() else {
        return;
    };
    let persist_all = state.config.lock().unwrap().history.persist;
    let result = paths
        .store
        .save(&state.history.lock().unwrap(), persist_all);
    if let Err(message) = result {
        notify(app, format!("履歴を保存できませんでした: {message}"));
    }
}

/// 履歴の変更をディスクへ反映し、UIへ通知する。
pub fn history_changed(app: &AppHandle) {
    persist_history(app);
    watcher::emit_state(app);
}

fn notify(app: &AppHandle, message: String) {
    let _ = app.emit(NOTICE_EVENT, message);
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

fn physical_rect(rect: &tauri::PhysicalRect<i32, u32>) -> Rect {
    Rect {
        x: rect.position.x.into(),
        y: rect.position.y.into(),
        width: rect.size.width.into(),
        height: rect.size.height.into(),
    }
}

/// 今のウィンドウの位置と大きさ、今いるモニターの作業領域、すべての作業領域、
/// 最小サイズ(物理ピクセル)、表示倍率。
struct Placement {
    rect: Rect,
    current_area: Rect,
    areas: Vec<Rect>,
    min: (i64, i64),
    scale: f64,
}

fn window_config(app: &AppHandle) -> Option<&tauri::utils::config::WindowConfig> {
    app.config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW)
}

fn placement(window: &WebviewWindow) -> Result<Placement, String> {
    let error = |e: tauri::Error| e.to_string();
    let scale = window.scale_factor().map_err(error)?;
    let position = window.outer_position().map_err(error)?;
    let size = window.inner_size().map_err(error)?;
    let rect = Rect {
        x: position.x.into(),
        y: position.y.into(),
        width: size.width.into(),
        height: size.height.into(),
    };
    let monitor = window
        .current_monitor()
        .map_err(error)?
        .ok_or("ウィンドウのあるモニターが見つかりません")?;
    let areas = window
        .available_monitors()
        .map_err(error)?
        .iter()
        .map(|monitor| physical_rect(monitor.work_area()))
        .collect();
    let config = window_config(window.app_handle());
    let logical_min = (
        config.and_then(|c| c.min_width).unwrap_or_default(),
        config.and_then(|c| c.min_height).unwrap_or_default(),
    );
    Ok(Placement {
        rect,
        current_area: physical_rect(monitor.work_area()),
        areas,
        min: (
            (logical_min.0 * scale).round() as i64,
            (logical_min.1 * scale).round() as i64,
        ),
        scale,
    })
}

fn apply_rect(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
    window
        .set_size(tauri::PhysicalSize::new(
            rect.width as u32,
            rect.height as u32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(rect.x as i32, rect.y as i32))
        .map_err(|e| e.to_string())
}

/// タイトルバーや縁を押したときに、ボタンを離すまでの移動かサイズ変更を始める。
/// `kind` は `"move"` か、辺と隅の方角(`"n"`、`"se"` など)。
#[tauri::command]
fn begin_window_drag(window: WebviewWindow, kind: String) -> Result<(), String> {
    let kind = DragKind::parse(&kind).ok_or("ドラッグの種類が不正です")?;
    let current = placement(&window)?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    drag::start(hwnd, current.rect, kind, current.min);
    Ok(())
}

/// 位置と大きさを論理ピクセルで少しずつ変える。キーボード操作で使う。
#[tauri::command]
fn nudge_window(window: WebviewWindow, dx: f64, dy: f64, dw: f64, dh: f64) -> Result<(), String> {
    let current = placement(&window)?;
    let physical = |value: f64| (value * current.scale).round() as i64;
    let next = placement::nudge(
        current.rect,
        (physical(dx), physical(dy), physical(dw), physical(dh)),
        current.min,
        &current.areas,
        current.current_area,
    );
    apply_rect(&window, next)
}

/// 大きさを保ったまま、今いるモニターの隅に置く。
#[tauri::command]
fn snap_window(window: WebviewWindow, corner: String) -> Result<(), String> {
    let corner = Corner::parse(&corner).ok_or("隅の指定が不正です")?;
    let current = placement(&window)?;
    let margin = (SNAP_MARGIN * current.scale).round() as i64;
    let next = placement::snap(
        current.rect,
        corner,
        current.current_area,
        margin,
        current.min,
    );
    apply_rect(&window, next)
}

/// 大きさを初期値に戻す。位置は画面からはみ出さないように直す。
#[tauri::command]
fn reset_window_size(window: WebviewWindow) -> Result<(), String> {
    let current = placement(&window)?;
    let config = window_config(window.app_handle()).ok_or("ウィンドウの設定が見つかりません")?;
    let resized = Rect {
        width: (config.width * current.scale).round() as i64,
        height: (config.height * current.scale).round() as i64,
        ..current.rect
    };
    let next = placement::clamp_into(resized, current.current_area, current.min);
    apply_rect(&window, next)
}

/// 通知領域に残して、ウィンドウだけを隠す。
#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = apply_window_alpha(&window, &app.state::<AppState>());
}

/// ショートカットと通知領域のクリックで使う。前面にあれば隠し、そうでなければ前面に出す。
fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if in_front {
        let _ = window.hide();
    } else {
        show_main_window(app);
    }
}

/// ショートカットを登録し直す。空なら登録しない。
fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return Ok(());
    }
    shortcuts
        .on_shortcut(hotkey, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                toggle_main_window(app);
            }
        })
        .map_err(|e| format!("ショートカット「{hotkey}」を登録できませんでした: {e}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigView {
    history_max_items: usize,
    history_max_items_limit: usize,
    history_persist: bool,
    hotkey: String,
    autostart: bool,
    data_dir: String,
    /// 起動時に起きた問題。UIはこれを通知として表示する。
    notices: Vec<String>,
}

#[tauri::command]
fn get_config(app: AppHandle, state: State<AppState>) -> ConfigView {
    let config = state.config.lock().unwrap().clone();
    ConfigView {
        history_max_items: config.history.max_items,
        history_max_items_limit: limits::HISTORY_MAX_ITEMS_LIMIT,
        history_persist: config.history.persist,
        hotkey: config.hotkey,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        data_dir: state.paths().data_dir.to_string_lossy().into_owned(),
        notices: std::mem::take(&mut state.startup_notices.lock().unwrap()),
    }
}

/// 設定を書き換えて保存する。履歴のロックを持ったまま呼ばない。
fn update_config(state: &AppState, change: impl FnOnce(&mut Config)) -> Result<Config, String> {
    let mut config = state.config.lock().unwrap();
    change(&mut config);
    config::save(&state.paths().config_file, &config)?;
    Ok(config.clone())
}

#[tauri::command]
fn set_history_limit(
    app: AppHandle,
    state: State<AppState>,
    max_items: usize,
) -> Result<(), String> {
    let max_items = config::clamp_max_items(max_items);
    update_config(&state, |config| config.history.max_items = max_items)?;
    state.history.lock().unwrap().set_max_items(max_items);
    history_changed(&app);
    Ok(())
}

#[tauri::command]
fn set_history_persist(
    app: AppHandle,
    state: State<AppState>,
    persist: bool,
) -> Result<(), String> {
    update_config(&state, |config| config.history.persist = persist)?;
    // 無効にしたときは、固定していない項目をディスクから消す。
    persist_history(&app);
    Ok(())
}

#[tauri::command]
fn set_hotkey(app: AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    let hotkey = hotkey.trim().to_string();
    if let Err(message) = register_hotkey(&app, &hotkey) {
        // 失敗したら元のショートカットに戻す。
        let previous = state.config.lock().unwrap().hotkey.clone();
        let _ = register_hotkey(&app, &previous);
        return Err(message);
    }
    update_config(&state, |config| config.hotkey = hotkey)?;
    Ok(())
}

/// 設定でショートカットを記録するあいだ、今のショートカットを止める。
/// 止めないと、今と同じキーを押したときにウィンドウが隠れてしまう。
#[tauri::command]
fn suspend_hotkey(app: AppHandle, state: State<AppState>, suspended: bool) -> Result<(), String> {
    if suspended {
        return app
            .global_shortcut()
            .unregister_all()
            .map_err(|e| e.to_string());
    }
    let hotkey = state.config.lock().unwrap().hotkey.clone();
    register_hotkey(&app, &hotkey)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_presets(state: State<AppState>) -> Result<Vec<NodeView>, String> {
    let root = presets::load(&state.paths().presets_file)?;
    Ok(presets::view(&root))
}

#[tauri::command]
fn copy_preset(state: State<AppState>, path: Vec<String>) -> Result<(), String> {
    let root = presets::load(&state.paths().presets_file)?;
    let text = presets::find_text(&root, &path).ok_or("プリセットが見つかりません")?;
    *state.pending_text.lock().unwrap() = Some(text.to_string());
    post_to_watcher(&state, watcher::WM_COPY_TEXT, 0, 0)
}

/// プリセットのファイルを読み、書き換えて保存する。読めないファイルは書き直さない。
fn edit_presets<T>(
    state: &AppState,
    change: impl FnOnce(&mut presets::Root) -> Result<T, String>,
) -> Result<T, String> {
    let file = &state.paths().presets_file;
    let mut root = presets::load(file)?;
    let result = change(&mut root)?;
    presets::save(file, &root)?;
    Ok(result)
}

/// 履歴のテキストの項目を、先頭にそのまま登録する。名前は1行目から作り、重なれば番号を付ける。
/// UIには省略したテキストしか渡していないので、全文は履歴から取る。登録した名前を返す。
#[tauri::command]
fn add_preset_from_item(state: State<AppState>, id: u64) -> Result<String, String> {
    let text = match state
        .history
        .lock()
        .unwrap()
        .get(id)
        .map(|item| &item.content)
    {
        Some(Content::Text { text, .. }) => text.clone(),
        _ => return Err("文字の項目だけを登録できます".into()),
    };
    let name = presets::default_name(&text);
    let path = edit_presets(&state, |root| {
        presets::add_unique(root, &[], &name, presets::Node::Text(text))
    })?;
    Ok(path.last().cloned().unwrap_or_default())
}

/// `folder` の中にプリセットを作る。作った項目の `path` を返す。
#[tauri::command]
fn create_preset(
    state: State<AppState>,
    folder: Vec<String>,
    name: String,
    text: String,
) -> Result<Vec<String>, String> {
    edit_presets(&state, |root| {
        presets::add_unique(root, &folder, &name, presets::Node::Text(text))
    })
}

/// `folder` の中に空のフォルダーを作る。
#[tauri::command]
fn create_preset_folder(
    state: State<AppState>,
    folder: Vec<String>,
    name: String,
) -> Result<Vec<String>, String> {
    edit_presets(&state, |root| {
        presets::add_unique(root, &folder, &name, presets::Node::Folder(Vec::new()))
    })
}

/// 名前と文字(プリセットのとき)を書き換える。
#[tauri::command]
fn update_preset(
    state: State<AppState>,
    path: Vec<String>,
    name: String,
    text: Option<String>,
) -> Result<Vec<String>, String> {
    edit_presets(&state, |root| presets::update(root, &path, &name, text))
}

/// 別のフォルダーへ移す。
#[tauri::command]
fn move_preset(
    state: State<AppState>,
    path: Vec<String>,
    folder: Vec<String>,
) -> Result<Vec<String>, String> {
    edit_presets(&state, |root| presets::move_to(root, &path, &folder))
}

/// 同じフォルダーの中で並びを動かす(負で上へ)。
#[tauri::command]
fn reorder_preset(state: State<AppState>, path: Vec<String>, offset: i64) -> Result<(), String> {
    edit_presets(&state, |root| presets::reorder(root, &path, offset))
}

#[tauri::command]
fn remove_preset(state: State<AppState>, path: Vec<String>) -> Result<(), String> {
    edit_presets(&state, |root| presets::remove(root, &path))
}

#[tauri::command]
fn reveal_presets_file(state: State<AppState>) -> Result<(), String> {
    let file = &state.paths().presets_file;
    // なければ例を書いたファイルを作ってから表示する。壊れたファイルを直すためにも使うので、中身は読まない。
    presets::ensure_exists(file)?;
    tauri_plugin_opener::reveal_item_in_dir(file).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_data_dir(state: State<AppState>) -> Result<(), String> {
    tauri_plugin_opener::open_path(&state.paths().data_dir, None::<&str>).map_err(|e| e.to_string())
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

fn build_tray(app: &App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW, "表示", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Clipglass")
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW => show_main_window(app),
            TRAY_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// データフォルダーを決め、設定と保存してある履歴を読み込む。
fn setup(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let paths = Paths {
        config_file: data_dir.join(config::FILE_NAME),
        presets_file: data_dir.join(presets::FILE_NAME),
        store: Store::new(data_dir.join(HISTORY_DIR)),
        data_dir,
    };
    let state = app.state::<AppState>();
    let mut notices = Vec::new();

    let config = match config::load(&paths.config_file) {
        Ok(config) => config,
        Err(message) => {
            notices.push(format!(
                "設定を読めなかったので初期値で起動しました: {message}"
            ));
            Config::default()
        }
    };
    {
        let mut history = state.history.lock().unwrap();
        if let Err(message) = paths.store.load(&mut history) {
            notices.push(format!("保存してあった履歴を読めませんでした: {message}"));
        }
        history.set_max_items(config.history.max_items);
    }
    if let Err(message) = register_hotkey(app.handle(), &config.hotkey) {
        notices.push(message);
    }

    *state.config.lock().unwrap() = config;
    *state.startup_notices.lock().unwrap() = notices;
    let _ = state.paths.set(paths);

    build_tray(app)?;
    watcher::spawn(app.handle().clone());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
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
            pending_text: Mutex::new(None),
            config: Mutex::new(Config::default()),
            paths: OnceLock::new(),
            startup_notices: Mutex::new(Vec::new()),
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
            remove_item,
            set_item_pinned,
            set_window_opacity,
            set_pinned,
            show_window,
            hide_window,
            begin_window_drag,
            nudge_window,
            snap_window,
            reset_window_size,
            save_image,
            get_config,
            set_history_limit,
            set_history_persist,
            set_hotkey,
            suspend_hotkey,
            set_autostart,
            get_presets,
            copy_preset,
            add_preset_from_item,
            create_preset,
            create_preset_folder,
            update_preset,
            move_preset,
            reorder_preset,
            remove_preset,
            reveal_presets_file,
            open_data_dir,
        ])
        // 閉じるボタンや Alt+F4 では終了せず、通知領域に残す。終了は通知領域のメニューから。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| setup(app))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod archive;
mod clipboard;
mod config;
mod drag;
mod favorites;
mod history;
mod imaging;
mod limits;
mod paste;
mod placement;
mod presets;
mod save;
mod store;
mod watcher;

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::http::{header, Response, StatusCode};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    App, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_window_state::StateFlags;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, PostMessageW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE,
    LWA_ALPHA, WS_EX_LAYERED,
};

use archive::Archive;
use config::Config;
use history::{Content, History, StateView};
use placement::{Corner, DragKind, Rect};
use presets::NodeView;
use store::Store;

const MAIN_WINDOW: &str = "main";
/// プリセットとお気に入りを出す、本体の横の別ウィンドウ。一覧に重ねないために分けている。
const PANEL_WINDOW: &str = "panel";
/// 別ウィンドウに出せる中身。
const PANEL_KINDS: [&str; 2] = ["presets", "favorites"];
/// 別ウィンドウの中身が変わったこと(閉じたときは null)をUIへ伝えるイベント。
const PANEL_EVENT: &str = "panel";
/// 別ウィンドウの幅と最小の高さ、本体との間(論理ピクセル)。高さは本体に合わせる。
const PANEL_WIDTH: f64 = 380.0;
const PANEL_MIN_HEIGHT: f64 = 360.0;
const PANEL_GAP: f64 = 6.0;
/// 履歴の画像をUIへ渡すURLスキーム。`/full/<id>` と `/thumb/<id>` を返す。
const IMAGE_SCHEME: &str = "clipimg";
/// 履歴の保存やショートカットの登録など、状態行に出さない通知をUIへ送るイベント。
const NOTICE_EVENT: &str = "notice";
const HISTORY_DIR: &str = "history";
/// 画像のURLのうち、保管した項目のサムネイルを指す先頭の区切り(`/archive/<日>/<ハッシュ>`)。
const ARCHIVE_IMAGE_VARIANT: &str = "archive";
/// 設定の「情報」から開けるページ。UIからは名前で指定し、任意のURLは開かせない。
const LINKS: [(&str, &str); 3] = [
    ("repo", "https://github.com/kuronekorou39/clipglass"),
    (
        "releases",
        "https://github.com/kuronekorou39/clipglass/releases",
    ),
    ("site", "https://rou39.com"),
];
const TRAY_SHOW: &str = "show";
const TRAY_QUIT: &str = "quit";
/// 画面の隅に置くときの、隅からの余白(論理ピクセル)。
const SNAP_MARGIN: f64 = 8.0;

/// データフォルダーの中の置き場所。`setup` で決まる。
struct Paths {
    data_dir: PathBuf,
    config_file: PathBuf,
    presets_file: PathBuf,
    favorites_file: PathBuf,
    store: Store,
    archive: Archive,
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
    /// お気に入りの文字。新しいものが先頭。
    favorites: Mutex<Vec<String>>,
    config: Mutex<Config>,
    paths: OnceLock<Paths>,
    /// UIが起動する前に起きた問題。最初の設定の取得で渡す。
    startup_notices: Mutex<Vec<String>>,
    /// 横の別ウィンドウに出している中身(`PANEL_KINDS` のどれか)。閉じていれば None。
    panel: Mutex<Option<String>>,
}

impl AppState {
    fn paths(&self) -> &Paths {
        self.paths.get().expect("setup で初期化される")
    }
}

/// UIへ渡す履歴の状態。お気に入りに入っている文字の行には印を付ける。
/// お気に入りのロックは履歴のロックより先に取り、すぐに離す。
pub fn state_view(state: &AppState) -> StateView {
    let favorites: HashSet<String> = state.favorites.lock().unwrap().iter().cloned().collect();
    let paused = state.paused.load(Ordering::Relaxed);
    state
        .history
        .lock()
        .unwrap()
        .view_with(paused, &|text| favorites.contains(text))
}

#[tauri::command]
fn get_state(state: State<AppState>) -> StateView {
    state_view(&state)
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
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
/// `paste` が真なら、コピーしたあと直前に使っていたウィンドウへ貼り付ける。
#[tauri::command]
fn copy_item(state: State<AppState>, id: u64, plain: bool, paste: bool) -> Result<(), String> {
    post_to_watcher(
        &state,
        watcher::WM_COPY_ITEM,
        id as usize,
        watcher::copy_flags(plain, paste),
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

/// 履歴をディスクへ書く。失敗は状態行ではなく通知として知らせる。
fn persist_history(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(paths) = state.paths.get() else {
        return;
    };
    let persist = state.config.lock().unwrap().history.persist;
    let result = paths.store.save(&state.history.lock().unwrap(), persist);
    if let Err(message) = result {
        notify(app, format!("履歴を保存できませんでした: {message}"));
    }
}

/// 上限を超えて一覧から外れた項目を保管へ回す。保管しない設定なら、そのまま捨てる。
fn archive_evicted(app: &AppHandle) {
    let state = app.state::<AppState>();
    let evicted = state.history.lock().unwrap().take_evicted();
    let Some(paths) = state.paths.get() else {
        return;
    };
    let config = state.config.lock().unwrap().history.clone();
    if evicted.is_empty() || !config.archives() {
        return;
    }
    if let Err(message) = paths.archive.append(&evicted, now_ms()) {
        notify(app, format!("古い履歴を保管できませんでした: {message}"));
    }
    paths.archive.prune(
        config.archive_days,
        config.archive_max_bytes(),
        chrono::Local::now().date_naive(),
    );
}

/// 保管を今の設定に合わせる。保管しない設定なら消し、するなら期間と大きさで整理する。
fn tidy_archive(archive: &Archive, config: &config::HistoryConfig) -> Result<(), String> {
    if !config.archives() {
        return archive.clear();
    }
    archive.prune(
        config.archive_days,
        config.archive_max_bytes(),
        chrono::Local::now().date_naive(),
    );
    Ok(())
}

/// 履歴の変更をディスクへ反映し、UIへ通知する。
pub fn history_changed(app: &AppHandle) {
    archive_evicted(app);
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
fn hide_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    hide_panel(&app);
    window.hide().map_err(|e| e.to_string())
}

/// 横の別ウィンドウを本体の横へ置き直す。高さは本体に合わせる(低すぎるときは最小の高さ)。
fn place_panel(app: &AppHandle) -> Result<(), String> {
    let (Some(main), Some(panel)) = (
        app.get_webview_window(MAIN_WINDOW),
        app.get_webview_window(PANEL_WINDOW),
    ) else {
        return Ok(());
    };
    let current = placement(&main)?;
    let physical = |value: f64| (value * current.scale).round() as i64;
    let size = (
        physical(PANEL_WIDTH),
        current.rect.height.max(physical(PANEL_MIN_HEIGHT)),
    );
    let rect = placement::beside(
        current.rect,
        size,
        current.current_area,
        physical(PANEL_GAP),
    );
    apply_rect(&panel, rect)
}

/// 横の別ウィンドウ。初めて開くときに作り、閉じても破棄せず隠しておく。
fn panel_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PANEL_WINDOW) {
        return Ok(window);
    }
    WebviewWindowBuilder::new(app, PANEL_WINDOW, WebviewUrl::App("index.html".into()))
        .title("Clipglass")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

fn set_panel(app: &AppHandle, kind: Option<String>) {
    *app.state::<AppState>().panel.lock().unwrap() = kind.clone();
    let _ = app.emit(PANEL_EVENT, kind);
}

fn panel_open(app: &AppHandle) -> bool {
    app.state::<AppState>().panel.lock().unwrap().is_some()
}

fn hide_panel(app: &AppHandle) {
    if !panel_open(app) {
        return;
    }
    if let Some(window) = app.get_webview_window(PANEL_WINDOW) {
        let _ = window.hide();
    }
    set_panel(app, None);
}

/// 横の別ウィンドウで `kind` を開く。同じものが開いていれば閉じる。
/// Windows では同期のコマンドでウィンドウを作ると止まるため、非同期にしている。
#[tauri::command]
async fn toggle_panel(app: AppHandle, kind: String) -> Result<(), String> {
    if !PANEL_KINDS.contains(&kind.as_str()) {
        return Err(format!("開けない中身です: {kind}"));
    }
    let open = app.state::<AppState>().panel.lock().unwrap().clone();
    if open.as_deref() == Some(kind.as_str()) {
        hide_panel(&app);
        return Ok(());
    }
    let panel = panel_window(&app)?;
    set_panel(&app, Some(kind));
    place_panel(&app)?;
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_panel(app: AppHandle) {
    hide_panel(&app);
}

/// 横の別ウィンドウに出す中身。別ウィンドウのUIが起動したときに読む。
#[tauri::command]
fn get_panel(state: State<AppState>) -> Option<String> {
    state.panel.lock().unwrap().clone()
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
    // 横の別ウィンドウを操作中も、前面にあるとみなす
    let panel_focused = app
        .get_webview_window(PANEL_WINDOW)
        .is_some_and(|panel| panel.is_focused().unwrap_or(false));
    let in_front = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && (window.is_focused().unwrap_or(false) || panel_focused);
    if in_front {
        hide_panel(app);
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
    /// 一覧から外れた項目を保管する日数(0 なら保管しない)と、大きさの上限(MB)。
    archive_days: u64,
    archive_days_limit: u64,
    archive_max_mb: u64,
    /// 今、保管に使っている大きさ(バイト)。
    archive_bytes: u64,
    version: &'static str,
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
        archive_days: config.history.archive_days,
        archive_days_limit: limits::ARCHIVE_DAYS_LIMIT,
        archive_max_mb: config.history.archive_max_mb,
        archive_bytes: state.paths().archive.size(),
        version: env!("CARGO_PKG_VERSION"),
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
    let config = update_config(&state, |config| config.history.persist = persist)?;
    // 無効にしたときは、保存してある履歴と保管をディスクから消す。
    persist_history(&app);
    tidy_archive(&state.paths().archive, &config.history)
}

/// 保管する日数(0 で保管しない)と大きさの上限を変え、今ある保管をそれに合わせて整理する。
#[tauri::command]
fn set_archive(state: State<AppState>, days: u64, max_mb: u64) -> Result<(), String> {
    let config = update_config(&state, |config| {
        config.history.archive_days = config::clamp_archive_days(days);
        config.history.archive_max_mb = config::clamp_archive_max_mb(max_mb);
    })?;
    tidy_archive(&state.paths().archive, &config.history)
}

/// 保管してある項目を新しい順に返す。ファイルを読むので、UIを止めないスレッドで行う。
#[tauri::command(async)]
fn get_archive(
    state: State<AppState>,
    query: String,
    kinds: Vec<String>,
    offset: usize,
    limit: usize,
) -> archive::Page {
    let limit = limit.clamp(1, limits::ARCHIVE_PAGE_LIMIT);
    state.paths().archive.list(&query, &kinds, offset, limit)
}

/// 保管してある項目を一覧へ戻し、クリップボードへ書き戻す。
#[tauri::command]
fn restore_archived(
    app: AppHandle,
    state: State<AppState>,
    key: String,
    paste: bool,
) -> Result<(), String> {
    let (content, formats, updated_at) = state.paths().archive.take(&key)?;
    let id = state
        .history
        .lock()
        .unwrap()
        .restore(content, formats, updated_at);
    history_changed(&app);
    post_to_watcher(
        &state,
        watcher::WM_COPY_ITEM,
        id as usize,
        watcher::copy_flags(false, paste),
    )
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

/// 文字をプレーンテキストとしてクリップボードへ置く。`paste` が真なら、そのあと貼り付ける。
fn copy_text(state: &AppState, text: String, paste: bool) -> Result<(), String> {
    *state.pending_text.lock().unwrap() = Some(text);
    post_to_watcher(state, watcher::WM_COPY_TEXT, usize::from(paste), 0)
}

#[tauri::command]
fn copy_preset(state: State<AppState>, path: Vec<String>, paste: bool) -> Result<(), String> {
    let root = presets::load(&state.paths().presets_file)?;
    let text = presets::find_text(&root, &path).ok_or("プリセットが見つかりません")?;
    copy_text(&state, text.to_string(), paste)
}

/// 履歴の項目の全文。UIには省略したテキストしか渡していないので、登録のときは履歴から取る。
fn item_text(state: &AppState, id: u64) -> Result<String, String> {
    match state
        .history
        .lock()
        .unwrap()
        .get(id)
        .map(|item| &item.content)
    {
        Some(Content::Text { text, .. }) => Ok(text.clone()),
        _ => Err("文字の項目だけを登録できます".into()),
    }
}

#[tauri::command]
fn get_favorites(state: State<AppState>) -> Vec<String> {
    state.favorites.lock().unwrap().clone()
}

/// お気に入りを書き換えて保存し、一覧の星を付け直す。保存できなければ元のままにする。
fn edit_favorites<T>(
    app: &AppHandle,
    change: impl FnOnce(&mut Vec<String>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let result = {
        let mut favorites = state.favorites.lock().unwrap();
        let mut next = favorites.clone();
        let result = change(&mut next)?;
        favorites::save(&state.paths().favorites_file, &next)?;
        *favorites = next;
        result
    };
    watcher::emit_state(app);
    Ok(result)
}

/// お気に入りに加える。すでに入っていれば `false` を返す。
#[tauri::command]
fn add_favorite(app: AppHandle, text: String) -> Result<bool, String> {
    edit_favorites(&app, |list| favorites::add(list, text))
}

/// 履歴のテキストの項目を、全文でお気に入りに加える。
#[tauri::command]
fn add_favorite_from_item(app: AppHandle, state: State<AppState>, id: u64) -> Result<bool, String> {
    let text = item_text(&state, id)?;
    edit_favorites(&app, |list| favorites::add(list, text))
}

/// 履歴のテキストの項目と同じ文字を、お気に入りから外す。
#[tauri::command]
fn remove_favorite_of_item(
    app: AppHandle,
    state: State<AppState>,
    id: u64,
) -> Result<bool, String> {
    let text = item_text(&state, id)?;
    edit_favorites(&app, |list| Ok(favorites::remove(list, &text)))
}

#[tauri::command]
fn remove_favorite(app: AppHandle, text: String) -> Result<bool, String> {
    edit_favorites(&app, |list| Ok(favorites::remove(list, &text)))
}

#[tauri::command]
fn copy_favorite(state: State<AppState>, text: String, paste: bool) -> Result<(), String> {
    copy_text(&state, text, paste)
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

/// 履歴のテキストの項目を、選んだフォルダーの末尾に登録する。`new_folder` があれば、
/// 先にその名前のフォルダーを `folder` の中に作り、そこへ入れる。名前は1行目から作り、
/// 重なれば番号を付ける。登録した項目の `path` を返す。
#[tauri::command]
fn add_preset_from_item(
    state: State<AppState>,
    id: u64,
    folder: Vec<String>,
    new_folder: Option<String>,
) -> Result<Vec<String>, String> {
    let text = item_text(&state, id)?;
    let name = presets::default_name(&text);
    edit_presets(&state, |root| {
        let folder = match description(new_folder) {
            Some(new_folder) => presets::add_unique(
                root,
                &folder,
                new_folder.trim(),
                presets::Node::Folder(Vec::new()),
            )?,
            None => folder,
        };
        presets::add_unique(root, &folder, &name, presets::Node::Text(text))
    })
}

/// `folder` の中にプリセットを作る。作った項目の `path` を返す。
#[tauri::command]
fn create_preset(
    state: State<AppState>,
    folder: Vec<String>,
    name: Option<String>,
    text: String,
) -> Result<Vec<String>, String> {
    // 説明(名前)は任意。なければ文字から作る
    let name = description(name).unwrap_or_else(|| presets::default_name(&text));
    edit_presets(&state, |root| {
        presets::add_unique(root, &folder, &name, presets::Node::Text(text))
    })
}

/// 空白だけの説明は、説明なしとして扱う。
fn description(name: Option<String>) -> Option<String> {
    name.filter(|name| !name.trim().is_empty())
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

/// 名前と文字(プリセットのとき)を書き換える。プリセットの名前(説明)は任意で、
/// なければ文字から作る。フォルダーの名前は省けない。
#[tauri::command]
fn update_preset(
    state: State<AppState>,
    path: Vec<String>,
    name: Option<String>,
    text: Option<String>,
) -> Result<Vec<String>, String> {
    edit_presets(&state, |root| {
        let name = match (description(name), &text) {
            (Some(name), _) => name,
            (None, Some(text)) => presets::auto_name_at(root, &path, text)?,
            (None, None) => return Err("名前を入力してください".to_string()),
        };
        presets::update(root, &path, &name, text)
    })
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

/// 設定の「情報」にあるページを、既定のブラウザーで開く。
#[tauri::command]
fn open_link(target: String) -> Result<(), String> {
    let (_, url) = LINKS
        .iter()
        .find(|(name, _)| *name == target)
        .ok_or("開く先が不正です")?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
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
    let state = app.state::<AppState>();
    if variant == ARCHIVE_IMAGE_VARIANT {
        let (day, hash) = (segments.next()?, segments.next()?);
        return state.paths.get()?.archive.thumbnail(day, hash);
    }
    let id: u64 = segments.next()?.parse().ok()?;
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
    let history_dir = data_dir.join(HISTORY_DIR);
    let paths = Paths {
        config_file: data_dir.join(config::FILE_NAME),
        presets_file: data_dir.join(presets::FILE_NAME),
        favorites_file: data_dir.join(favorites::FILE_NAME),
        archive: Archive::new(history_dir.join(store::ARCHIVE_DIR)),
        store: Store::new(history_dir),
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
    let mut favorites = favorites::load(&paths.favorites_file).unwrap_or_else(|message| {
        notices.push(format!("お気に入りを読めませんでした: {message}"));
        Vec::new()
    });
    {
        let mut history = state.history.lock().unwrap();
        match paths.store.load(&mut history) {
            Ok(pinned_texts) => {
                // 0.7 までに固定してあった文字は、お気に入りへ移す
                let mut moved = false;
                for text in pinned_texts.into_iter().rev() {
                    moved |= favorites::add(&mut favorites, text).unwrap_or(false);
                }
                if moved {
                    if let Err(message) = favorites::save(&paths.favorites_file, &favorites) {
                        notices.push(format!("お気に入りを保存できませんでした: {message}"));
                    }
                }
            }
            Err(message) => {
                notices.push(format!("保存してあった履歴を読めませんでした: {message}"));
            }
        }
        // 上限から外れた分は、最初の読み取りのあとで保管へ回る
        history.set_max_items(config.history.max_items);
    }
    if let Err(message) = tidy_archive(&paths.archive, &config.history) {
        notices.push(format!("古い履歴を整理できませんでした: {message}"));
    }
    *state.favorites.lock().unwrap() = favorites;
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
                // 横の別ウィンドウは開くたびに本体の横へ置くので、位置を覚えない
                .with_denylist(&[PANEL_WINDOW])
                .build(),
        )
        .manage(AppState {
            history: Mutex::new(History::default()),
            watcher_hwnd: AtomicIsize::new(0),
            saving: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            window_alpha: AtomicU8::new(u8::MAX),
            pending_text: Mutex::new(None),
            favorites: Mutex::new(Vec::new()),
            config: Mutex::new(Config::default()),
            paths: OnceLock::new(),
            startup_notices: Mutex::new(Vec::new()),
            panel: Mutex::new(None),
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
            set_archive,
            get_archive,
            restore_archived,
            set_hotkey,
            suspend_hotkey,
            set_autostart,
            get_presets,
            copy_preset,
            get_favorites,
            add_favorite,
            add_favorite_from_item,
            remove_favorite_of_item,
            remove_favorite,
            copy_favorite,
            add_preset_from_item,
            create_preset,
            create_preset_folder,
            update_preset,
            move_preset,
            reorder_preset,
            remove_preset,
            reveal_presets_file,
            open_data_dir,
            open_link,
            toggle_panel,
            close_panel,
            get_panel,
        ])
        // 閉じるボタンや Alt+F4 では終了せず、通知領域に残す。終了は通知領域のメニューから。
        // 横の別ウィンドウも同じで、本体と一緒に隠す。本体を動かしたら別ウィンドウも付いていく。
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                hide_panel(window.app_handle());
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_)
                if window.label() == MAIN_WINDOW
                    && !window.is_minimized().unwrap_or(false)
                    && panel_open(window.app_handle()) =>
            {
                let _ = place_panel(window.app_handle());
            }
            _ => {}
        })
        .setup(|app| setup(app))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! 選んだ項目を、直前まで使っていたアプリのカーソル位置へ貼り付ける。
//!
//! Clipglass をクリックすると、入力していたアプリからフォーカスが外れる。そこで、前面に
//! なったウィンドウを見張って「直前に使っていたウィンドウ」を覚えておき、クリップボードへ
//! 書き戻したあとにそのウィンドウを前面へ戻して Ctrl+V を送る。

use std::sync::atomic::{AtomicIsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, IsWindow, SetForegroundWindow, EVENT_SYSTEM_FOREGROUND,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

/// 前面へ戻してから Ctrl+V を送るまでの待ち時間。フォーカスが移り終わる前に送ると、
/// キーが Clipglass 側に届いてしまう。
const FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);
/// 貼り付け先にしないウィンドウのクラス。通知領域のアイコンから Clipglass を出すと、
/// タスクバーが「直前に使っていたウィンドウ」になってしまうため。
const IGNORED_CLASSES: [&str; 4] = [
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
];
const CLASS_NAME_CAPACITY: usize = 128;
/// Ctrl+Shift+数字 などで選んだとき、Shift や Alt が離されるのを待つ上限。
/// 押されたまま送ると Ctrl+Shift+V のような別の操作になる。
const MODIFIER_RELEASE_TIMEOUT: Duration = Duration::from_millis(1500);
const MODIFIER_POLL: Duration = Duration::from_millis(10);
const OTHER_MODIFIERS: [VIRTUAL_KEY; 4] = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];

/// 直前に前面にあった、ほかのアプリのウィンドウ。なければ 0。
static LAST_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

fn is_ignored_class(name: &str) -> bool {
    IGNORED_CLASSES.contains(&name)
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; CLASS_NAME_CAPACITY];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

fn remember(hwnd: HWND) {
    if hwnd.0.is_null() || is_ignored_class(&class_name(hwnd)) {
        return;
    }
    LAST_FOREGROUND.store(hwnd.0 as isize, Ordering::Relaxed);
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    remember(hwnd);
    // 自分のウィンドウの通知は受けないので、届いたらほかのアプリが前面になったということ
    if let Some(app) = crate::watcher::app() {
        crate::foreground_left_app(app);
    }
}

/// 前面のウィンドウの切り替わりを見張り始める。通知は呼び出したスレッドのメッセージループに
/// 届くので、監視スレッドから呼ぶ。自分のウィンドウが前面になったときの通知は受けない。
pub fn watch_foreground() {
    unsafe {
        // 起動した時点で前面にあるウィンドウも候補にする(Clipglass は起動時にフォーカスを取らない)
        remember(GetForegroundWindow());
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
    }
}

fn key(virtual_key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}

/// Ctrl+V を押して離す入力の並び。
fn ctrl_v_inputs() -> [INPUT; 4] {
    let pressed = KEYBD_EVENT_FLAGS::default();
    [
        key(VK_CONTROL, pressed),
        key(VK_V, pressed),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ]
}

/// V だけを押して離す入力の並び。Ctrl が押されたままのときに使う(Ctrl を勝手に離さない)。
fn v_inputs() -> [INPUT; 2] {
    [
        key(VK_V, KEYBD_EVENT_FLAGS::default()),
        key(VK_V, KEYEVENTF_KEYUP),
    ]
}

fn is_down(virtual_key: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(i32::from(virtual_key.0)) < 0 }
}

/// Shift・Alt・Win が離されるまで待つ。上限までに離されなければ `false`。
fn wait_for_modifier_release() -> bool {
    let start = Instant::now();
    while OTHER_MODIFIERS.iter().any(|modifier| is_down(*modifier)) {
        if start.elapsed() >= MODIFIER_RELEASE_TIMEOUT {
            return false;
        }
        thread::sleep(MODIFIER_POLL);
    }
    true
}

/// 直前に使っていたウィンドウを前面に戻し、Ctrl+V を送る。ウィンドウがもうなければ何もしない
/// (クリップボードには入っているので、手で貼り付けられる)。
pub fn paste_into_last_window() {
    let target = LAST_FOREGROUND.load(Ordering::Relaxed);
    if target == 0 {
        return;
    }
    // 待つあいだ監視スレッドを止めないよう、別のスレッドで行う。HWND は数値にして渡す
    thread::spawn(move || unsafe {
        let hwnd = HWND(target as *mut _);
        if !IsWindow(Some(hwnd)).as_bool() {
            return;
        }
        // Clipglass はクリックでフォーカスを取らないので、ふつうは相手が前面のまま。
        // 前面にないプロセスからの切り替えは拒まれることがあるので、必要なときだけ行う
        if GetForegroundWindow() != hwnd && !SetForegroundWindow(hwnd).as_bool() {
            return;
        }
        thread::sleep(FOCUS_SETTLE_DELAY);
        if GetForegroundWindow() != hwnd {
            return;
        }
        // 届かなくてもクリップボードには入っているので、手で貼り付けられる
        if !wait_for_modifier_release() || GetForegroundWindow() != hwnd {
            return;
        }
        if is_down(VK_CONTROL) {
            SendInput(&v_inputs(), size_of::<INPUT>() as i32);
        } else {
            SendInput(&ctrl_v_inputs(), size_of::<INPUT>() as i32);
        }
    });
}

/// キーボードを受け取っていたあと、直前に使っていたウィンドウへ返す。
pub fn focus_last_window() {
    let target = LAST_FOREGROUND.load(Ordering::Relaxed);
    if target == 0 {
        return;
    }
    unsafe {
        let hwnd = HWND(target as *mut _);
        if IsWindow(Some(hwnd)).as_bool() {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taskbar_windows_are_not_paste_targets() {
        assert!(is_ignored_class("Shell_TrayWnd"));
        assert!(is_ignored_class("NotifyIconOverflowWindow"));
        assert!(!is_ignored_class("Notepad"));
        assert!(!is_ignored_class(""));
    }

    #[test]
    fn every_ignored_class_is_rejected_exactly() {
        for class in IGNORED_CLASSES {
            assert!(is_ignored_class(class));
            // 大文字小文字や一部だけの一致では除外しない
            assert!(!is_ignored_class(&class.to_lowercase()));
            assert!(!is_ignored_class(&class[1..]));
        }
    }

    #[test]
    fn key_builds_a_keyboard_input() {
        let input = key(VK_V, KEYEVENTF_KEYUP);
        assert_eq!(input.r#type, INPUT_KEYBOARD);
        let keyboard = unsafe { input.Anonymous.ki };
        assert_eq!(keyboard.wVk, VK_V);
        assert_eq!(keyboard.dwFlags, KEYEVENTF_KEYUP);
        assert_eq!(keyboard.wScan, 0);
        assert_eq!(keyboard.time, 0);
    }

    #[test]
    fn ctrl_v_presses_and_releases_in_nested_order() {
        let pressed = KEYBD_EVENT_FLAGS::default();
        let keys = ctrl_v_inputs().map(|input| {
            let keyboard = unsafe { input.Anonymous.ki };
            (keyboard.wVk, keyboard.dwFlags)
        });
        assert_eq!(
            keys,
            [
                (VK_CONTROL, pressed),
                (VK_V, pressed),
                (VK_V, KEYEVENTF_KEYUP),
                (VK_CONTROL, KEYEVENTF_KEYUP),
            ]
        );
    }

    #[test]
    fn null_window_is_not_remembered() {
        let before = LAST_FOREGROUND.load(Ordering::Relaxed);
        // null は OS へ問い合わせる前に弾かれる
        remember(HWND(std::ptr::null_mut()));
        assert_eq!(LAST_FOREGROUND.load(Ordering::Relaxed), before);
    }
}

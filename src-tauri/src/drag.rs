//! マウスでのウィンドウの移動とサイズ変更。
//!
//! Tauri の `startDragging` は OS の移動ループ(`WM_NCLBUTTONDOWN` を後から送る)を使う。
//! リモートデスクトップなどで遅延があると、ループが始まる前にボタンが離されてしまい、
//! 離した通知を待ったまま入力をつかみ続ける(Win+D などで別のウィンドウへ移るまで操作できない)。
//! ここではボタンの実際の状態を短い間隔で見て、離されたらすぐに終える。

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SetWindowPos, SM_SWAPBUTTON, SWP_NOACTIVATE, SWP_NOSIZE,
    SWP_NOZORDER,
};

use crate::placement::{self, DragKind, Rect};

/// ボタンとカーソルを見る間隔。画面の更新(60Hz)より少し細かくする。
const POLL_INTERVAL: Duration = Duration::from_millis(8);

/// 1つのドラッグが終わるまで、次のドラッグを始めない。
static DRAGGING: AtomicBool = AtomicBool::new(false);

/// 主ボタン(左右を入れ替えている設定なら右ボタン)が押されているか。
/// `GetAsyncKeyState` は入れ替え前の物理ボタンを返すので、入れ替えの設定を見て選ぶ。
fn primary_button_down() -> bool {
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let button = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    let state = unsafe { GetAsyncKeyState(button.0 as i32) };
    // 最上位ビットが立っていれば押されている
    state < 0
}

fn cursor() -> Option<(i64, i64)> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x as i64, point.y as i64))
}

/// ボタンが離されるまで、カーソルに合わせて位置か大きさを変える。座標は物理ピクセル。
/// 呼ばれた時点でボタンがもう離されていれば、何もせずに戻る。
pub fn start(hwnd: HWND, start: Rect, kind: DragKind, min: (i64, i64)) {
    if DRAGGING.swap(true, Ordering::AcqRel) {
        return;
    }
    // HWND はスレッドをまたげないので、数値にして渡す
    let hwnd_value = hwnd.0 as isize;
    thread::spawn(move || {
        let hwnd = HWND(hwnd_value as *mut _);
        if let Some(origin) = cursor() {
            follow(hwnd, start, kind, min, origin);
        }
        DRAGGING.store(false, Ordering::Release);
    });
}

fn follow(hwnd: HWND, start: Rect, kind: DragKind, min: (i64, i64), origin: (i64, i64)) {
    let mut last = origin;
    while primary_button_down() {
        thread::sleep(POLL_INTERVAL);
        let Some(now) = cursor() else { break };
        if now == last {
            continue;
        }
        last = now;
        let next = placement::drag(start, kind, (now.0 - origin.0, now.1 - origin.1), min);
        let mut flags = SWP_NOZORDER | SWP_NOACTIVATE;
        if kind.is_move() {
            flags |= SWP_NOSIZE;
        }
        let moved = unsafe {
            SetWindowPos(
                hwnd,
                None,
                next.x as i32,
                next.y as i32,
                next.width as i32,
                next.height as i32,
                flags,
            )
        };
        if moved.is_err() {
            break;
        }
    }
}

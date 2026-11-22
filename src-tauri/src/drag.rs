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
    GetCursorPos, GetSystemMetrics, SetWindowPos, SET_WINDOW_POS_FLAGS, SM_SWAPBUTTON,
    SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
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

/// カーソルが `last` から動いていれば、次の位置と大きさ、`SetWindowPos` のフラグを返す。
fn drag_step(
    start: Rect,
    kind: DragKind,
    min: (i64, i64),
    origin: (i64, i64),
    last: (i64, i64),
    now: (i64, i64),
) -> Option<(Rect, SET_WINDOW_POS_FLAGS)> {
    if now == last {
        return None;
    }
    let next = placement::drag(start, kind, (now.0 - origin.0, now.1 - origin.1), min);
    let mut flags = SWP_NOZORDER | SWP_NOACTIVATE;
    if kind.is_move() {
        flags |= SWP_NOSIZE;
    }
    Some((next, flags))
}

fn follow(hwnd: HWND, start: Rect, kind: DragKind, min: (i64, i64), origin: (i64, i64)) {
    let mut last = origin;
    while primary_button_down() {
        thread::sleep(POLL_INTERVAL);
        let Some(now) = cursor() else { break };
        let Some((next, flags)) = drag_step(start, kind, min, origin, last, now) else {
            continue;
        };
        last = now;
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

#[cfg(test)]
mod tests {
    use super::*;

    const START: Rect = Rect {
        x: 100,
        y: 200,
        width: 400,
        height: 300,
    };
    const MIN: (i64, i64) = (200, 150);
    const ORIGIN: (i64, i64) = (500, 500);

    fn kind(name: &str) -> DragKind {
        DragKind::parse(name).unwrap()
    }

    #[test]
    fn step_is_skipped_while_cursor_stays() {
        let last = (510, 520);
        assert!(drag_step(START, kind("move"), MIN, ORIGIN, last, last).is_none());
    }

    #[test]
    fn move_step_keeps_size_and_sets_no_size_flag() {
        let (next, flags) =
            drag_step(START, kind("move"), MIN, ORIGIN, ORIGIN, (530, 460)).unwrap();
        assert_eq!((next.x, next.y), (130, 160));
        assert_eq!((next.width, next.height), (400, 300));
        assert_ne!(flags.0 & SWP_NOSIZE.0, 0);
        assert_ne!(flags.0 & SWP_NOZORDER.0, 0);
        assert_ne!(flags.0 & SWP_NOACTIVATE.0, 0);
    }

    #[test]
    fn resize_step_changes_size_without_no_size_flag() {
        let (next, flags) = drag_step(START, kind("se"), MIN, ORIGIN, ORIGIN, (550, 540)).unwrap();
        assert_eq!((next.x, next.y), (100, 200));
        assert_eq!((next.width, next.height), (450, 340));
        assert_eq!(flags.0 & SWP_NOSIZE.0, 0);
        assert_ne!(flags.0 & SWP_NOACTIVATE.0, 0);
    }

    #[test]
    fn step_measures_from_origin_not_from_last_position() {
        // 途中の位置に関係なく、つかんだ位置からの移動量で決まる
        let (next, _) =
            drag_step(START, kind("move"), MIN, ORIGIN, (900, 900), (510, 500)).unwrap();
        assert_eq!((next.x, next.y), (110, 200));
    }

    #[test]
    fn resize_step_stops_at_minimum_and_keeps_opposite_edge() {
        let (next, _) = drag_step(START, kind("nw"), MIN, ORIGIN, ORIGIN, (2000, 2000)).unwrap();
        assert_eq!((next.width, next.height), MIN);
        assert_eq!(next.x + next.width, START.x + START.width);
        assert_eq!(next.y + next.height, START.y + START.height);
    }
}

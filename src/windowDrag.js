// タイトルバー・ツールバーでの移動と、縁の帯でのサイズ変更を始める。
// Tauri の startDragging / startResizeDragging は OS の移動ループを使い、リモートデスクトップの
// 遅延でボタンを離した通知を取りこぼすと入力をつかんだままになる。Rust 側でボタンの状態を見て動かす。
import { invoke } from "@tauri-apps/api/core";

/** この属性を付けた要素(子のボタンや入力欄を除く)を押すと、ウィンドウを移動する。 */
export const DRAG_REGION_ATTR = "data-drag-region";

/** 押した要素そのものが移動用の場所か。ボタンや検索欄を押したときは移動しない。 */
export function isDragRegion(target) {
  return Boolean(target?.hasAttribute?.(DRAG_REGION_ATTR));
}

/** 主ボタンで押されたときだけ、移動(`"move"`)か、辺・隅の方角(`"se"` など)でのサイズ変更を始める。 */
export function startWindowDrag(event, kind) {
  if (event.button !== 0) return false;
  event.preventDefault();
  invoke("begin_window_drag", { kind });
  return true;
}

export function onDragRegionMouseDown(event) {
  if (isDragRegion(event.target)) startWindowDrag(event, "move");
}

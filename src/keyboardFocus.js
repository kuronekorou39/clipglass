import { useEffect } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { isEditing } from "./windowKeys.js";
import { isDragRegion } from "./windowDrag.js";

// Clipglass のウィンドウは、クリックしてもフォーカスを取らない(入力中のアプリのカーソルを残す)。
// 文字を打つ場面でだけキーボードを受け取り、終わったら元のアプリへ返す。

const send = (command) => Promise.resolve(invoke(command)).catch(() => {});

/** `active` のあいだキーボードを受け取り、終わったら直前のアプリへ返す。 */
export function useKeyboard(active) {
  useEffect(() => {
    if (!active) return undefined;
    send("take_keyboard");
    return () => send("release_keyboard");
  }, [active]);
}

/** これより動いたら、クリックではなくウィンドウの移動とみなす(px)。 */
const CLICK_SLOP = 3;

/**
 * 入力欄を押すか、バーの空いた場所をクリックしたらキーボードを受け取る。
 * バーのクリックは Ctrl+F などのキー操作を使うため。動かしただけではフォーカスを取らない。
 */
export function watchEditableClicks(target = window) {
  let pressed = null;
  const onMouseDown = (event) => {
    pressed = isDragRegion(event.target) ? { x: event.screenX, y: event.screenY } : null;
    if (isEditing(event.target)) send("take_keyboard");
  };
  const onClick = (event) => {
    const still =
      pressed &&
      Math.abs(event.screenX - pressed.x) <= CLICK_SLOP &&
      Math.abs(event.screenY - pressed.y) <= CLICK_SLOP;
    pressed = null;
    if (still && isDragRegion(event.target)) send("take_keyboard");
  };
  target.addEventListener("mousedown", onMouseDown, true);
  target.addEventListener("click", onClick, true);
  return () => {
    target.removeEventListener("mousedown", onMouseDown, true);
    target.removeEventListener("click", onClick, true);
  };
}

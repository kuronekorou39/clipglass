// キーボードでのウィンドウの移動とサイズ変更。
// リモートデスクトップなど、マウスで枠をつかみにくいときの代わりに使う。

/** 1回のキー入力で動かす量(論理ピクセル)。押し続けると繰り返す。 */
export const WINDOW_STEP = 20;

const DIRECTIONS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const TEXT_INPUT_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

/** 文字入力中は Ctrl+Shift+矢印 を単語選択に使うので、横取りしない。 */
function isEditing(target) {
  return Boolean(target && (TEXT_INPUT_TAGS.includes(target.tagName) || target.isContentEditable));
}

/**
 * キー入力を、ウィンドウを動かす量に変える。対象外のキーなら null。
 * Ctrl+Shift+矢印 で移動、Ctrl+Shift+Alt+矢印 でサイズ変更(右と下に広がる)。
 */
export function windowKeyAction(event) {
  const direction = DIRECTIONS[event.key];
  if (!direction || !event.ctrlKey || !event.shiftKey || event.metaKey) return null;
  if (isEditing(event.target)) return null;
  const [x, y] = direction;
  if (event.altKey) {
    return { dx: 0, dy: 0, dw: x * WINDOW_STEP, dh: y * WINDOW_STEP };
  }
  return { dx: x * WINDOW_STEP, dy: y * WINDOW_STEP, dw: 0, dh: 0 };
}

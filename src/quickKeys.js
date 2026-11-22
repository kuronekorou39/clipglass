// 一覧の上から9件を貼り付ける、修飾キー+数字の組み合わせ。登録は Rust 側で行う。

export const DEFAULT_QUICK_KEYS = "ctrl";

/** 設定で選べる組み合わせ。左が保存する値、右が画面に出す名前。 */
export const QUICK_KEY_MODES = [
  ["ctrl", "Ctrl + 数字"],
  ["ctrl+shift", "Ctrl + Shift + 数字"],
  ["ctrl+alt", "Ctrl + Alt + 数字"],
  ["off", "使わない"],
];

const PREFIXES = { ctrl: "Ctrl + ", "ctrl+shift": "Ctrl + Shift + ", "ctrl+alt": "Ctrl + Alt + " };

/** 数字の前に付ける修飾キーの表記。使わない設定なら null。 */
export function quickKeyPrefix(mode) {
  return PREFIXES[mode ?? DEFAULT_QUICK_KEYS] ?? null;
}

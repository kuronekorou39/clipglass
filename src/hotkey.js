// ショートカットの記録。押したキーを、Rust 側(global-hotkey)が読める「Alt+Shift+Q」の形にする。

/** 修飾キー。並びは表示と保存の順。 */
const MODIFIERS = [
  ["ctrlKey", "Ctrl"],
  ["altKey", "Alt"],
  ["shiftKey", "Shift"],
  ["metaKey", "Super"],
];

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** global-hotkey が読めるキー(KeyboardEvent.code)。配列に依らない物理的な位置で決める。 */
const SUPPORTED_CODE =
  /^(Key[A-Z]|Digit\d|Numpad\d|F([1-9]|1[0-2])|Arrow(Up|Down|Left|Right)|Space|Enter|Tab|Backspace|Insert|Delete|Home|End|PageUp|PageDown|Pause|PrintScreen|Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|Minus|Period|Quote|Semicolon|Slash)$/;

/** 画面に出すときの名前。保存の形では Win は Super と書く。 */
const DISPLAY_NAMES = { Super: "Win" };

function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

/**
 * キーを押したときのイベントから、記録の結果を返す。
 * - `{ hotkey }`: 修飾キーと、ほかのキー1つがそろった
 * - `{ pending }`: 修飾キーだけが押されている(画面に途中の形を出す)
 * - `{ error }`: 使えない組み合わせ
 */
export function readHotkey(event) {
  const modifiers = MODIFIERS.filter(([flag]) => event[flag]).map(([, name]) => name);
  if (MODIFIER_CODES.test(event.code)) return { pending: modifiers };
  if (!SUPPORTED_CODE.test(event.code)) return { error: "このキーはショートカットに使えません" };
  if (modifiers.length === 0) {
    return { error: "Ctrl・Alt・Shift・Win のどれかと一緒に押してください" };
  }
  return { hotkey: [...modifiers, keyName(event.code)].join("+") };
}

/** 保存の形(「Alt+Shift+Q」)を、画面に出す形(「Alt + Shift + Q」)にする。 */
export function formatHotkey(hotkey) {
  if (!hotkey) return "";
  return hotkey
    .split("+")
    .map((part) => DISPLAY_NAMES[part] ?? part)
    .join(" + ");
}

// 色合い。色そのものは style.css の [data-theme="..."] にある。

/** 選べる色合いと表示名。先頭が初期値。 */
export const THEMES = [
  ["dark", "ダーク"],
  ["light", "ライト"],
  ["xp", "XP 風"],
  ["classic", "クラシック"],
  ["terminal", "ターミナル"],
];

export const DEFAULT_THEME = THEMES[0][0];

/** 保存してあった値が今の一覧になければ、初期値に戻す。 */
export function normalizeTheme(theme) {
  return THEMES.some(([id]) => id === theme) ? theme : DEFAULT_THEME;
}

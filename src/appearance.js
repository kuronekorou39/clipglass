import { backgroundAlpha } from "./settings.js";

/**
 * 色合い・文字サイズ・背景の透け具合を <html> に付ける。本体と横の別ウィンドウ
 * (プリセット・お気に入り)の両方で使い、同じ見た目にそろえる。
 */
export function applyAppearance(settings, root = document.documentElement) {
  root.dataset.theme = settings.theme;
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  // 背景だけを透かすときは背景色のアルファを下げ、文字は不透明のまま残す
  root.style.setProperty("--bg-alpha", String(backgroundAlpha(settings)));
}

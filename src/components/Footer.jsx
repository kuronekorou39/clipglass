import { useEffect, useRef } from "preact/hooks";
import { onDragRegionMouseDown } from "../windowDrag.js";

import { Icon } from "./Icon.jsx";

/** ボタンにマウスを乗せてから、横の別ウィンドウを開くまでの長さ(ms)。 */
export const PANEL_HOVER_DELAY_MS = 150;

/**
 * 下部のバー。プリセットとお気に入りを開くボタン、絞り込みの開閉、設定。空いているところで移動できる。
 * ウィンドウの幅が狭いときは、プリセットとお気に入りの文字を隠して記号だけにする(style.css)。
 */
export function Footer({
  presetsOpen,
  onPresetsToggle,
  favoritesOpen,
  onFavoritesToggle,
  onPanelHover,
  filterOpen,
  filtering,
  onFilterToggle,
  onSettingsOpen,
}) {
  // 通り過ぎただけでは開かないよう、少し留まってから開く
  const hoverTimer = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hover = (kind) => ({
    onMouseEnter: () => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => onPanelHover(kind), PANEL_HOVER_DELAY_MS);
    },
    onMouseLeave: () => clearTimeout(hoverTimer.current),
  });
  const click = (toggle) => () => {
    clearTimeout(hoverTimer.current);
    toggle();
  };

  return (
    <div id="footer" data-drag-region onMouseDown={onDragRegionMouseDown}>
      <button
        class={`footer-btn${presetsOpen ? " active" : ""}`}
        title="マウスを乗せると開く(クリックで開いたままにする)"
        aria-label="プリセット"
        aria-expanded={presetsOpen}
        aria-haspopup="dialog"
        onClick={click(onPresetsToggle)}
        {...hover("presets")}
      >
        <span aria-hidden="true">{"☰"}</span>
        <span class="footer-label">プリセット</span>
      </button>
      <button
        class={`footer-btn${favoritesOpen ? " active" : ""}`}
        title="マウスを乗せると開く(クリックで開いたままにする)"
        aria-label="お気に入り"
        aria-expanded={favoritesOpen}
        aria-haspopup="dialog"
        onClick={click(onFavoritesToggle)}
        {...hover("favorites")}
      >
        <Icon name="star" />
        <span class="footer-label">お気に入り</span>
      </button>
      <span class="footer-spacer" data-drag-region />
      <button
        class={`titlebar-btn${filterOpen ? " active" : ""}${filtering ? " filtering" : ""}`}
        title={filterOpen ? "絞り込みを閉じる" : "検索と絞り込み(Ctrl+F)"}
        aria-label="検索と絞り込み"
        aria-pressed={filterOpen}
        onClick={onFilterToggle}
      >
        {"⌕"}
      </button>
      <button class="titlebar-btn" title="設定" aria-label="設定" onClick={onSettingsOpen}>
        {"⚙"}
      </button>
    </div>
  );
}

import { onDragRegionMouseDown } from "../windowDrag.js";

import { Icon } from "./Icon.jsx";

/** 下部のバー。プリセットとお気に入りを開くボタン、絞り込みの開閉、設定。空いているところで移動できる。 */
export function Footer({
  presetsOpen,
  onPresetsToggle,
  favoritesOpen,
  onFavoritesToggle,
  filterOpen,
  filtering,
  onFilterToggle,
  onSettingsOpen,
}) {
  return (
    <div id="footer" data-drag-region onMouseDown={onDragRegionMouseDown}>
      <button
        class={`footer-btn${presetsOpen ? " active" : ""}`}
        title="プリセットを開く"
        aria-expanded={presetsOpen}
        aria-haspopup="dialog"
        onClick={onPresetsToggle}
      >
        {"☰ プリセット"}
      </button>
      <button
        class={`footer-btn${favoritesOpen ? " active" : ""}`}
        title="お気に入りを開く"
        aria-expanded={favoritesOpen}
        aria-haspopup="dialog"
        onClick={onFavoritesToggle}
      >
        <Icon name="star" />
        お気に入り
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

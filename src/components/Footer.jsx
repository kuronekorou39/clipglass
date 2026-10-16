import { onDragRegionMouseDown } from "../windowDrag.js";

/** 下部のバー。プリセットを開くボタン、絞り込みの開閉、設定。空いているところで移動できる。 */
export function Footer({ presetsOpen, onPresetsToggle, filterOpen, filtering, onFilterToggle, onSettingsOpen }) {
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

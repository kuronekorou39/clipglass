import { onDragRegionMouseDown } from "../windowDrag.js";
import { OPACITY_MAX, OPACITY_MIN, OPACITY_STEP } from "../settings.js";

/**
 * 文字サイズと折り返しは設定パネルにある。ここには頻繁に触るものだけを置く。
 * タスクバーに出さないので最小化は置かず、✕ で通知領域へ隠す。
 */
export function Titlebar({ pinned, opacity, paused, onPauseToggle, onPinToggle, onOpacityChange, onClose }) {
  return (
    <div id="titlebar" data-drag-region onMouseDown={onDragRegionMouseDown}>
      <span class="titlebar-title" data-drag-region>
        Clipglass
      </span>
      <div class="titlebar-buttons">
        <input
          type="range"
          id="opacity-slider"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={OPACITY_STEP}
          value={opacity}
          title={`ウィンドウの不透明度 ${opacity}%`}
          aria-label="ウィンドウの不透明度"
          onInput={(e) => onOpacityChange(parseInt(e.target.value))}
        />
        <button
          class={`titlebar-btn${paused ? " paused" : ""}`}
          title={paused ? "読み取りを再開する" : "読み取りを停止する"}
          aria-pressed={paused}
          onClick={onPauseToggle}
        >
          {paused ? "\u25B6\uFE0E" : "\u2016"}
        </button>
        <button
          class={`titlebar-btn${pinned ? " active" : ""}`}
          title={pinned ? "常に手前に表示しない" : "常に手前に表示する"}
          aria-pressed={pinned}
          onClick={onPinToggle}
        >
          {pinned ? "◆" : "◇"}
        </button>
        <button
          class="titlebar-btn btn-close"
          title="隠す(通知領域に残ります。終了は通知領域のメニューから)"
          onClick={onClose}
        >
          {"✕"}
        </button>
      </div>
    </div>
  );
}

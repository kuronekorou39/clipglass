import { onDragRegionMouseDown } from "../windowDrag.js";
import { OPACITY_MAX, OPACITY_MIN, OPACITY_STEP } from "../settings.js";

// 文字の記号(‖ や ─)は細くフォントでも形が変わるので、線の太さを決めて描く
const ICON = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "currentColor", "aria-hidden": true };

function PauseIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="2" width="3" height="10" rx="0.8" />
      <rect x="8" y="2" width="3" height="10" rx="0.8" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 2.2v9.6a.6.6 0 0 0 .9.5l7.4-4.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5z" />
    </svg>
  );
}

function HideIcon() {
  return (
    <svg {...ICON}>
      <rect x="2" y="9.5" width="10" height="2" rx="1" />
    </svg>
  );
}

/**
 * 文字サイズと折り返しは設定パネルにある。ここには頻繁に触るものだけを置く。
 * タスクバーに出さないので、最小化の形のボタンで通知領域へ隠す。終了は通知領域のメニューから。
 */
export function Titlebar({ pinned, opacity, paused, onPauseToggle, onPinToggle, onOpacityChange, onClose }) {
  return (
    <div id="titlebar" data-drag-region onMouseDown={onDragRegionMouseDown}>
      <span class="titlebar-title" data-drag-region>
        Clipglass
      </span>
      <div class="titlebar-buttons">
        <button
          class={`titlebar-btn${paused ? " paused" : ""}`}
          title={paused ? "読み取りを再開する" : "読み取りを停止する"}
          aria-pressed={paused}
          onClick={onPauseToggle}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <span class="titlebar-sep" role="separator" />
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
          class={`titlebar-btn${pinned ? " active" : ""}`}
          title={pinned ? "常に手前に表示しない" : "常に手前に表示する"}
          aria-pressed={pinned}
          onClick={onPinToggle}
        >
          {pinned ? "◆" : "◇"}
        </button>
        <button
          class="titlebar-btn"
          title="隠す(通知領域に残ります。終了は通知領域のメニューから)"
          aria-label="隠す"
          onClick={onClose}
        >
          <HideIcon />
        </button>
      </div>
    </div>
  );
}

import { getCurrentWindow } from "@tauri-apps/api/window";
import { OPACITY_MAX, OPACITY_MIN, OPACITY_STEP } from "../settings.js";

export function Titlebar({ pinned, opacity, wrap, onPinToggle, onOpacityChange, onWrapToggle }) {
  return (
    <div id="titlebar" data-tauri-drag-region>
      <span class="titlebar-title" data-tauri-drag-region>
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
          class={`titlebar-btn${wrap ? " active" : ""}`}
          title={wrap ? "テキストを折り返さない" : "テキストを折り返す"}
          aria-pressed={wrap}
          onClick={onWrapToggle}
        >
          {"↵"}
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
          class="titlebar-btn"
          title="最小化"
          onClick={() => getCurrentWindow().minimize()}
        >
          {"─"}
        </button>
        <button
          class="titlebar-btn btn-close"
          title="終了"
          onClick={() => getCurrentWindow().close()}
        >
          {"✕"}
        </button>
      </div>
    </div>
  );
}

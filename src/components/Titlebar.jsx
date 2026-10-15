import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
} from "../settings.js";

export function Titlebar({
  pinned,
  opacity,
  wrap,
  fontSize,
  paused,
  onPauseToggle,
  onPinToggle,
  onOpacityChange,
  onWrapToggle,
  onFontSizeStep,
}) {
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
          class="titlebar-btn font-smaller"
          title={`文字を小さく(現在 ${fontSize}px、Ctrl+-)`}
          aria-label="文字を小さく"
          disabled={fontSize <= FONT_SIZE_MIN}
          onClick={() => onFontSizeStep(-1)}
        >
          A
        </button>
        <button
          class="titlebar-btn font-larger"
          title={`文字を大きく(現在 ${fontSize}px、Ctrl++)`}
          aria-label="文字を大きく"
          disabled={fontSize >= FONT_SIZE_MAX}
          onClick={() => onFontSizeStep(1)}
        >
          A
        </button>
        <button
          class={`titlebar-btn${wrap ? " active" : ""}`}
          title={wrap ? "テキストを折り返さない" : "テキストを折り返す"}
          aria-pressed={wrap}
          onClick={onWrapToggle}
        >
          {"↵"}
        </button>
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

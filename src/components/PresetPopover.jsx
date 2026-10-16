import { useEffect, useRef } from "preact/hooks";
import { PresetTree } from "./PresetTree.jsx";

/** 下部のボタンから開くプリセットの一覧。外側を押すか Esc で閉じる。 */
export function PresetPopover({
  presets,
  visiblePresets,
  error,
  query,
  onQueryChange,
  onCopy,
  onRemove,
  onOpenFile,
  onReload,
  onClose,
}) {
  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div class="popover-backdrop" onMouseDown={onClose}>
      <div
        id="presets"
        class="popover"
        role="dialog"
        aria-label="プリセット"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={searchRef}
          class="popover-search"
          type="search"
          value={query}
          placeholder="プリセットを検索"
          aria-label="プリセットを検索"
          onInput={(e) => onQueryChange(e.target.value)}
        />
        <div class="popover-body">
          {error && <div class="status-row status-error">{error}</div>}
          <PresetTree nodes={visiblePresets} onCopy={onCopy} onRemove={onRemove} />
          {!error && presets.length === 0 && (
            <div class="empty-hint">
              プリセットがありません。履歴の「登録」か、「ファイルを開く」から追加できます
            </div>
          )}
          {presets.length > 0 && visiblePresets.length === 0 && (
            <div class="empty-hint">一致するプリセットがありません</div>
          )}
        </div>
        <div class="presets-footer">
          <button class="row-btn" onClick={onOpenFile}>
            ファイルを開く
          </button>
          <button class="row-btn" onClick={onReload}>
            再読み込み
          </button>
        </div>
      </div>
    </div>
  );
}

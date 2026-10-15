import { KINDS, toggleKind } from "../search.js";

/** 履歴とプリセットの切り替え、検索、種類の絞り込み、設定を開くボタン。 */
export function Toolbar({
  view,
  onViewChange,
  query,
  onQueryChange,
  kinds,
  onKindsChange,
  onSettingsOpen,
  searchRef,
}) {
  return (
    <div id="toolbar">
      <div class="tabs" role="tablist">
        <button
          class={`tab${view === "history" ? " active" : ""}`}
          role="tab"
          aria-selected={view === "history"}
          onClick={() => onViewChange("history")}
        >
          履歴
        </button>
        <button
          class={`tab${view === "presets" ? " active" : ""}`}
          role="tab"
          aria-selected={view === "presets"}
          onClick={() => onViewChange("presets")}
        >
          プリセット
        </button>
      </div>
      <input
        id="search"
        ref={searchRef}
        type="search"
        value={query}
        placeholder={view === "history" ? "履歴を検索(Ctrl+F)" : "プリセットを検索(Ctrl+F)"}
        aria-label="検索"
        onInput={(e) => onQueryChange(e.target.value)}
      />
      {view === "history" && (
        <div class="chips" aria-label="種類で絞り込む">
          {KINDS.map(([kind, label]) => (
            <button
              key={kind}
              class={`chip${kinds.includes(kind) ? " active" : ""}`}
              aria-pressed={kinds.includes(kind)}
              title={`${label}を表示する`}
              onClick={() => onKindsChange(toggleKind(kinds, kind))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <button class="titlebar-btn" title="設定" aria-label="設定" onClick={onSettingsOpen}>
        {"⚙"}
      </button>
    </div>
  );
}

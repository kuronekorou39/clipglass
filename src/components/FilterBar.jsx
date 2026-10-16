import { KINDS, toggleKind } from "../search.js";
import { onDragRegionMouseDown } from "../windowDrag.js";

/** 履歴の検索と種類の絞り込み。ふだんは閉じておき、下部のボタンか Ctrl+F で開く。 */
export function FilterBar({ query, onQueryChange, kinds, onKindsChange, onClose, searchRef }) {
  return (
    <div id="filter-bar" data-drag-region onMouseDown={onDragRegionMouseDown}>
      <input
        id="search"
        ref={searchRef}
        type="search"
        value={query}
        placeholder="履歴を検索(Ctrl+F)"
        aria-label="履歴を検索"
        onInput={(e) => onQueryChange(e.target.value)}
      />
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
      <button
        class="titlebar-btn"
        title="絞り込みを解除して閉じる(Esc)"
        aria-label="絞り込みを閉じる"
        onClick={onClose}
      >
        {"✕"}
      </button>
    </div>
  );
}

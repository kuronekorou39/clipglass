import { useEffect, useRef, useState } from "preact/hooks";
import { firstLine } from "../search.js";
import { Icon } from "./Icon.jsx";

/**
 * 下部のボタンから開くお気に入りの一覧。プリセットと違ってフォルダーも名前もなく、
 * 文字を新しい順に並べるだけ。クリックでコピーし、外側を押すか Esc で閉じる。
 */
export function FavoritesPopover({ closing, favorites, onCopy, onRemove, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = needle ? favorites.filter((text) => text.toLowerCase().includes(needle)) : favorites;

  const submit = async (e) => {
    e.preventDefault();
    if (draft.trim() === "") return;
    if (await onAdd(draft)) setDraft("");
  };

  return (
    <div class={`popover-backdrop${closing ? " closing" : ""}`} inert={closing} onMouseDown={onClose}>
      <div
        id="favorites"
        class="popover"
        role="dialog"
        aria-label="お気に入り"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={searchRef}
          class="popover-search"
          type="search"
          value={query}
          placeholder="お気に入りを検索"
          aria-label="お気に入りを検索"
          onInput={(e) => setQuery(e.target.value)}
        />
        <div class="popover-body">
          <div class="preset-tree">
            {visible.map((text) => (
              <div
                key={text}
                class="preset-leaf favorite-row"
                role="button"
                tabIndex={0}
                title={text}
                onClick={() => onCopy(text)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCopy(text);
                  }
                }}
              >
                <Icon name="star" size={12} />
                <span class="preset-text">{firstLine(text) || "(空)"}</span>
                <span class="row-tools">
                  <button
                    class="icon-btn"
                    title="お気に入りから外す"
                    aria-label="外す"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(text);
                    }}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
          {favorites.length === 0 && (
            <div class="empty-hint">履歴の行を右クリックして「お気に入りに追加」で入れられます</div>
          )}
          {favorites.length > 0 && visible.length === 0 && (
            <div class="empty-hint">一致するお気に入りがありません</div>
          )}
        </div>
        <form class="favorite-add" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            placeholder="文字を入力して追加"
            aria-label="追加する文字"
            onInput={(e) => setDraft(e.target.value)}
          />
          <button class="row-btn with-icon" type="submit" disabled={draft.trim() === ""}>
            <Icon name="plus" size={12} />
            追加
          </button>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import { firstLine } from "../search.js";
import { useKeyboard } from "../keyboardFocus.js";
import { Icon } from "./Icon.jsx";

/**
 * 下部のボタンから、本体の横の別ウィンドウ(Panel.jsx)に開くお気に入りの一覧。
 * プリセットと違ってフォルダーも名前もなく、文字を新しい順に並べるだけ。クリックでコピーする。
 * 検索と追加の入力欄はふだん隠し、開いたときだけキーボードを受け取る。
 */
export function FavoritesPopover({ favorites, onCopy, onRemove, onAdd }) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  // 開いている入力欄。"search" か "add"、なければ null
  const [field, setField] = useState(null);
  const fieldRef = useRef(null);
  useKeyboard(field !== null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, [field]);

  const toggleField = (name) => {
    setQuery("");
    setDraft("");
    setField(field === name ? null : name);
  };

  const needle = query.trim().toLowerCase();
  const visible = needle ? favorites.filter((text) => text.toLowerCase().includes(needle)) : favorites;

  const submit = async (e) => {
    e.preventDefault();
    if (draft.trim() === "") return;
    if (await onAdd(draft)) {
      setDraft("");
      setField(null);
    }
  };

  return (
    <div id="favorites" class="popover" role="dialog" aria-label="お気に入り">
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
      {field === "search" && (
        <input
          ref={fieldRef}
          class="popover-search"
          type="search"
          value={query}
          placeholder="お気に入りを検索"
          aria-label="お気に入りを検索"
          onInput={(e) => setQuery(e.target.value)}
        />
      )}
      {field === "add" && (
        <form class="favorite-add" onSubmit={submit}>
          <input
            ref={fieldRef}
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
      )}
      <div class="presets-footer">
        <button
          class="icon-btn"
          title={field === "search" ? "検索を閉じる" : "検索"}
          aria-label="検索"
          aria-pressed={field === "search"}
          onClick={() => toggleField("search")}
        >
          <Icon name="search" size={13} />
        </button>
        <button
          class="text-btn with-icon"
          aria-pressed={field === "add"}
          onClick={() => toggleField("add")}
        >
          <Icon name="plus" size={12} />
          お気に入り
        </button>
      </div>
    </div>
  );
}

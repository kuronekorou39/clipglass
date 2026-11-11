import { useEffect, useRef, useState } from "preact/hooks";
import { archiveImageUrl, formatDay, formatTime } from "../format.js";
import { FileNames } from "./HistoryItem.jsx";
import { Icon } from "./Icon.jsx";

/** 一度に読み込む件数。 */
const PAGE_SIZE = 50;
/** 検索語を打っているあいだ、読み直しを待つ長さ(ms)。 */
const SEARCH_DELAY_MS = 250;

function ArchivedItem({ item, onRestore }) {
  return (
    <div
      class="item archived"
      role="button"
      tabIndex={0}
      title="クリックで一覧に戻してコピー"
      onClick={onRestore}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRestore();
        }
      }}
    >
      <div class="item-body">
        {item.kind === "image" && (
          <div class="thumb">
            <img class="checker" src={archiveImageUrl(item.day, item.imageHash)} alt="保管した画像" />
          </div>
        )}
        {item.kind === "text" && <div class="item-text">{item.text}</div>}
        {item.kind === "files" && <FileNames paths={item.paths} limit={1} />}
        <span class="item-time">{formatTime(item.updatedAt)}</span>
      </div>
    </div>
  );
}

/**
 * 一覧の上限を超えて外れた項目(保管)を、一覧の下に日ごとに並べる。
 * ふだんは畳んでおき、開いたときだけディスクから読む。検索語と種類の絞り込みは保管にも掛ける。
 * `load({ query, kinds, offset, limit })` は `{ items, hasMore }` を返し、`onRestore(item)` は成否を返す。
 */
export function ArchiveList({ query, kinds, searching, load, onRestore }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState({ items: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  // 古い問い合わせの結果で、新しい結果を上書きしない
  const request = useRef(0);

  const fetchPage = async (offset) => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await load({ query, kinds, offset, limit: PAGE_SIZE });
      if (id !== request.current) return;
      setPage((prev) => (offset === 0 ? next : { items: [...prev.items, ...next.items], hasMore: next.hasMore }));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => fetchPage(0), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, query, kinds.join(",")]);

  const restore = async (item) => {
    if (!(await onRestore(item))) return;
    setPage((prev) => ({ ...prev, items: prev.items.filter((other) => other.key !== item.key) }));
  };

  if (!open) {
    return (
      <div class="archive">
        <div class="archive-toggle">
          <button class="text-btn with-icon" onClick={() => setOpen(true)}>
            <Icon name="archive" size={12} />
            {searching ? "過去の履歴も探す" : "過去の履歴を見る"}
          </button>
        </div>
      </div>
    );
  }

  const { items, hasMore } = page;
  return (
    <div class="archive" aria-label="過去の履歴">
      <div class="archive-toggle">
        <button class="text-btn with-icon" onClick={() => setOpen(false)}>
          <Icon name="archive" size={12} />
          過去の履歴を閉じる
        </button>
      </div>
      {items.flatMap((item, index) => {
        const row = <ArchivedItem key={item.key} item={item} onRestore={() => restore(item)} />;
        if (item.day === items[index - 1]?.day) return [row];
        // 日が変わるところに見出しを入れる
        const heading = (
          <div key={`day-${item.day}`} class="archive-day">
            {formatDay(item.day)}
          </div>
        );
        return [heading, row];
      })}
      {items.length === 0 && !loading && (
        <div class="empty-hint">
          {searching ? "過去の履歴に一致する項目はありません" : "過去の履歴はまだありません"}
        </div>
      )}
      {(hasMore || loading) && (
        <div class="archive-toggle">
          <button class="text-btn" disabled={loading} onClick={() => fetchPage(items.length)}>
            {loading ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </div>
  );
}

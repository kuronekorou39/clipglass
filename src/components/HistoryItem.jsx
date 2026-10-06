import { formatTime, imageUrl } from "../format.js";
import { FormatBadges, FormatList } from "./FormatBadges.jsx";

function SaveButton({ compact, disabled, onSave }) {
  return (
    <button
      class="save-btn"
      title="画像をPNGファイルとして保存"
      aria-label="画像を保存"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onSave();
      }}
    >
      {"↓"}
      {!compact && " 画像を保存"}
    </button>
  );
}

function detail(item) {
  if (item.kind === "image") return `${item.width} × ${item.height} px`;
  return `${item.charCount.toLocaleString()}文字${item.truncated ? "(一部のみ表示)" : ""}`;
}

export function HistoryItem({ item, current, wrap, saving, onCopy, onSave }) {
  const isImage = item.kind === "image";
  const meta = (
    <div class="item-meta">
      <FormatBadges formats={item.formats} />
      <span class="item-detail">{detail(item)}</span>
      <span class="item-time">{formatTime(item.updatedAt)}</span>
    </div>
  );
  // 行ごとに名前を付けると、並べ替えのときに行が元の位置から移動して見える。
  const style = { viewTransitionName: `item-${item.id}` };

  if (current) {
    return (
      <div class="item current" style={style}>
        {isImage ? (
          <div class="preview-image">
            <img class="checker" src={imageUrl("full", item.id)} alt="コピーした画像" />
          </div>
        ) : (
          <pre class={`preview-text${wrap ? " wrap" : ""}`}>{item.text}</pre>
        )}
        {meta}
        <div class="item-actions">
          <FormatList formats={item.formats} />
          {isImage && <SaveButton disabled={saving} onSave={onSave} />}
        </div>
      </div>
    );
  }

  return (
    <div
      class="item"
      style={style}
      role="button"
      tabIndex={0}
      title="クリックでコピー"
      onClick={onCopy}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCopy();
        }
      }}
    >
      <div class="item-body">
        {isImage ? (
          <div class="thumb">
            <img class="checker" src={imageUrl("thumb", item.id)} alt="コピーした画像" />
          </div>
        ) : (
          <div class="item-text">{item.text}</div>
        )}
        {isImage && <SaveButton compact disabled={saving} onSave={onSave} />}
      </div>
      {meta}
    </div>
  );
}

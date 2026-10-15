import { fileName, formatTime, imageUrl, richFormatLabels } from "../format.js";
import { FormatList, RichBadge } from "./FormatBadges.jsx";

const MAX_FILE_NAMES = 5;

function RowButton({ title, disabled, active, danger, onClick, children }) {
  const classes = ["row-btn", active && "active", danger && "danger"].filter(Boolean).join(" ");
  return (
    <button
      class={classes}
      title={title}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function SaveButton({ compact, disabled, onSave }) {
  return (
    <RowButton title="画像をPNGファイルとして保存" disabled={disabled} onClick={onSave}>
      {"↓"}
      {!compact && " 画像を保存"}
    </RowButton>
  );
}

/** 固定、プリセットへの登録、削除。どの行にも出す。 */
function ItemTools({ item, onPin, onRegister, onRemove }) {
  return (
    <span class="item-tools">
      <RowButton
        title={
          item.pinned
            ? "固定を外す"
            : "固定して、件数の上限で消えないようにする(次回の起動でも残る)"
        }
        active={item.pinned}
        onClick={() => onPin(!item.pinned)}
      >
        固定
      </RowButton>
      {item.kind === "text" && (
        <RowButton title="この文字をプリセットに登録" onClick={onRegister}>
          登録
        </RowButton>
      )}
      <RowButton title="履歴から削除" danger onClick={onRemove}>
        {"✕"}
      </RowButton>
    </span>
  );
}

function detail(item) {
  if (item.kind === "image") return `${item.width} × ${item.height} px`;
  if (item.kind === "files") return `ファイル ${item.paths.length}件`;
  return `${item.charCount.toLocaleString()}文字${item.truncated ? "(一部のみ表示)" : ""}`;
}

function FileNames({ paths, limit }) {
  const rest = paths.length - limit;
  return (
    <ul class="file-names">
      {paths.slice(0, limit).map((path) => (
        <li key={path} title={path}>
          {fileName(path)}
        </li>
      ))}
      {rest > 0 && <li class="file-rest">ほか {rest}件</li>}
    </ul>
  );
}

export function HistoryItem({
  item,
  current,
  wrap,
  saving,
  onCopy,
  onSave,
  onPin,
  onRegister,
  onRemove,
}) {
  const isImage = item.kind === "image";
  const hasStoredRich = item.storedRich.length > 0;
  // 先頭行は今のクリップボードの中身を、それ以外は選び直したときに入る中身を示す。
  const richFormats = current ? item.formats : item.storedRich;
  const tools = <ItemTools item={item} onPin={onPin} onRegister={onRegister} onRemove={onRemove} />;
  const meta = (
    <div class="item-meta">
      {item.pinned && <span class="badge-pinned">固定</span>}
      <RichBadge formats={richFormats} />
      <span class="item-detail">{detail(item)}</span>
      {!current && tools}
      <span class="item-time">{formatTime(item.updatedAt)}</span>
    </div>
  );
  // 行ごとに名前を付けると、並べ替えのときに行が元の位置から移動して見える。
  const style = { viewTransitionName: `item-${item.id}` };

  if (current) {
    const clipboardIsRich = richFormatLabels(item.formats).length > 0;
    return (
      <div class={`item current${item.pinned ? " pinned" : ""}`} style={style}>
        {isImage && (
          <div class="preview-image">
            <img class="checker" src={imageUrl("full", item.id)} alt="コピーした画像" />
          </div>
        )}
        {item.kind === "text" && (
          <pre class={`preview-text${wrap ? " wrap" : ""}`}>{item.text}</pre>
        )}
        {item.kind === "files" && <FileNames paths={item.paths} limit={MAX_FILE_NAMES} />}
        {meta}
        <div class="item-actions">
          <FormatList formats={item.formats} />
          {isImage && <SaveButton disabled={saving} onSave={onSave} />}
          {hasStoredRich && clipboardIsRich && (
            <RowButton title="書式を外し、文字だけをコピーし直す" onClick={() => onCopy(true)}>
              文字だけにする
            </RowButton>
          )}
          {hasStoredRich && !clipboardIsRich && (
            <RowButton title="元の書式を付けてコピーし直す" onClick={() => onCopy(false)}>
              書式付きに戻す
            </RowButton>
          )}
          {tools}
        </div>
      </div>
    );
  }

  return (
    <div
      class={`item${item.pinned ? " pinned" : ""}`}
      style={style}
      role="button"
      tabIndex={0}
      title={hasStoredRich ? "クリックで書式ごとコピー" : "クリックでコピー"}
      onClick={() => onCopy(false)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCopy(false);
        }
      }}
    >
      <div class="item-body">
        {isImage && (
          <div class="thumb">
            <img class="checker" src={imageUrl("thumb", item.id)} alt="コピーした画像" />
          </div>
        )}
        {item.kind === "text" && <div class="item-text">{item.text}</div>}
        {item.kind === "files" && <FileNames paths={item.paths} limit={1} />}
        {isImage && <SaveButton compact disabled={saving} onSave={onSave} />}
        {hasStoredRich && (
          <RowButton title="書式を外し、文字だけをコピー" onClick={() => onCopy(true)}>
            文字だけ
          </RowButton>
        )}
      </div>
      {meta}
    </div>
  );
}

import { fileName, formatTime, imageUrl, richFormatLabels } from "../format.js";
import { RichBadge } from "./FormatBadges.jsx";

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

function RegisterButton({ item, onRegister }) {
  if (item.kind !== "text") return null;
  return (
    <RowButton title="プリセットの先頭に登録" onClick={onRegister}>
      登録
    </RowButton>
  );
}

function detail(item) {
  if (item.kind === "image") return `${item.width} × ${item.height} px`;
  if (item.kind === "files") return `ファイル ${item.paths.length}件`;
  return `${item.charCount.toLocaleString()}文字${item.truncated ? "(一部のみ表示)" : ""}`;
}

/**
 * 大きさ・時刻・書式・形式。ふだんは見ないので「データ」にまとめて畳む。
 * 行のクリック(再コピー)にならないよう、開閉のクリックは行へ伝えない。
 */
function ItemData({ item, richFormats }) {
  return (
    <details class="item-data" onClick={(e) => e.stopPropagation()}>
      <summary>データ</summary>
      <dl>
        <dt>内容</dt>
        <dd>{detail(item)}</dd>
        <dt>時刻</dt>
        <dd>{formatTime(item.updatedAt)}</dd>
        {richFormats.length > 0 && (
          <>
            <dt>書式</dt>
            <dd>
              <RichBadge formats={richFormats} />
            </dd>
          </>
        )}
        <dt>形式</dt>
        <dd class="format-names">{item.formats.join("\n") || "なし"}</dd>
      </dl>
    </details>
  );
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

/** 固定と削除は行に出さず、右クリックのメニューから行う。 */
export function HistoryItem({ item, current, wrap, saving, onCopy, onSave, onRegister, onMenu }) {
  const isImage = item.kind === "image";
  const hasStoredRich = item.storedRich.length > 0;
  // 先頭行は今のクリップボードの中身を、それ以外は選び直したときに入る中身を示す。
  const richFormats = current ? item.formats : item.storedRich;
  const clipboardIsRich = richFormatLabels(item.formats).length > 0;
  // 行ごとに名前を付けると、並べ替えのときに行が元の位置から移動して見える。
  const style = { viewTransitionName: `item-${item.id}` };
  const classes = ["item", current && "current", item.pinned && "pinned"].filter(Boolean).join(" ");
  const onContextMenu = (e) => {
    e.preventDefault();
    onMenu({ x: e.clientX, y: e.clientY });
  };
  const footer = (
    <div class="item-meta">
      {item.pinned && <span class="badge-pinned">固定</span>}
      <ItemData item={item} richFormats={richFormats} />
      <span class="item-tools">
        {current && isImage && <SaveButton disabled={saving} onSave={onSave} />}
        {current && hasStoredRich && clipboardIsRich && (
          <RowButton title="書式を外し、文字だけをコピーし直す" onClick={() => onCopy(true)}>
            文字だけにする
          </RowButton>
        )}
        {current && hasStoredRich && !clipboardIsRich && (
          <RowButton title="元の書式を付けてコピーし直す" onClick={() => onCopy(false)}>
            書式付きに戻す
          </RowButton>
        )}
        <RegisterButton item={item} onRegister={onRegister} />
      </span>
    </div>
  );

  if (current) {
    return (
      <div class={classes} style={style} onContextMenu={onContextMenu}>
        {isImage && (
          <div class="preview-image">
            <img class="checker" src={imageUrl("full", item.id)} alt="コピーした画像" />
          </div>
        )}
        {item.kind === "text" && (
          <pre class={`preview-text${wrap ? " wrap" : ""}`}>{item.text}</pre>
        )}
        {item.kind === "files" && <FileNames paths={item.paths} limit={MAX_FILE_NAMES} />}
        {footer}
      </div>
    );
  }

  return (
    <div
      class={classes}
      style={style}
      role="button"
      tabIndex={0}
      title={hasStoredRich ? "クリックで書式ごとコピー(右クリックで固定・削除)" : "クリックでコピー(右クリックで固定・削除)"}
      onClick={() => onCopy(false)}
      onContextMenu={onContextMenu}
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
      {footer}
    </div>
  );
}

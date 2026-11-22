import { useState } from "preact/hooks";
import { fileName, formatTime, imageUrl, richFormatLabels } from "../format.js";
import { ROW_ATTR } from "../listMotion.js";
import { RichBadge } from "./FormatBadges.jsx";
import { Icon } from "./Icon.jsx";

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        class="item-data-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        データ
      </button>
      {open && (
        <dl class="item-data-list" onClick={(e) => e.stopPropagation()}>
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
      )}
    </>
  );
}

export function FileNames({ paths, limit }) {
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

/** 行の頭に置く、数字キーの印。先頭から9件だけに付け、ほかの行は同じ幅だけ空けて頭をそろえる。 */
function QuickKey({ number, prefix }) {
  return (
    <span class="item-key" aria-hidden={number ? undefined : true}>
      {number && <kbd title={`${prefix ?? ""}${number} で貼り付け`}>{number}</kbd>}
    </span>
  );
}

/**
 * お気に入り・プリセットへの追加・削除は行に出さず、右クリックのメニューから行う。
 * お気に入りに入っている文字の行には星を出す。`quickKey` は修飾キー+数字で選ぶときの番号(1〜9)、`quickPrefix` はその修飾キーの表記。
 * `onPick` は先頭行を選んだとき(今の書式のまま貼り付ける)。
 */
export function HistoryItem({ item, current, quickKey, quickPrefix, wrap, saving, onCopy, onPick, onSave, onMenu }) {
  const isImage = item.kind === "image";
  const hasStoredRich = item.storedRich.length > 0;
  // 先頭行は今のクリップボードの中身を、それ以外は選び直したときに入る中身を示す。
  const richFormats = current ? item.formats : item.storedRich;
  const clipboardIsRich = richFormatLabels(item.formats).length > 0;
  // 並べ替えのときに行を元の位置から滑らせるため、行にIDを付ける(listMotion.js)。
  const row = { [ROW_ATTR]: item.id };
  const classes = ["item", current && "current"].filter(Boolean).join(" ");
  const onContextMenu = (e) => {
    e.preventDefault();
    onMenu({ x: e.clientX, y: e.clientY });
  };
  const footer = (
    <div class="item-meta">
      {item.favorite && (
        <span class="badge-fav" title="お気に入り" aria-label="お気に入り">
          <Icon name="star" size={12} />
        </span>
      )}
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
      </span>
      <ItemData item={item} richFormats={richFormats} />
    </div>
  );
  const pickByKey = (pick) => (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick();
    }
  };

  if (current) {
    return (
      <div
        class={classes}
        {...row}
        role="button"
        tabIndex={0}
        title="クリックで貼り付け(右クリックでメニュー)"
        onClick={onPick}
        onContextMenu={onContextMenu}
        onKeyDown={pickByKey(onPick)}
      >
        <QuickKey number={quickKey} prefix={quickPrefix} />
        <div class="item-main">
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
      </div>
    );
  }

  return (
    <div
      class={classes}
      {...row}
      role="button"
      tabIndex={0}
      title={hasStoredRich ? "クリックで書式ごとコピー(右クリックでメニュー)" : "クリックでコピー(右クリックでメニュー)"}
      onClick={() => onCopy(false)}
      onContextMenu={onContextMenu}
      onKeyDown={pickByKey(() => onCopy(false))}
    >
      <QuickKey number={quickKey} prefix={quickPrefix} />
      <div class="item-main">
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
    </div>
  );
}

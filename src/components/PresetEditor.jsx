import { useEffect, useRef, useState } from "preact/hooks";
import {
  ROOT_FOLDER_KEY,
  folderChoices,
  folderKey,
  parentPath,
  parseFolderKey,
} from "../presets.js";

/**
 * プリセットかフォルダーの編集、または新規作成。ポップオーバーの中で一覧と入れ替えて出す。
 * `target` は `{ node }`(編集)か `{ isFolder, folder }`(新規、`folder` は作る場所)。
 */
export function PresetEditor({ target, folders, onSave, onRemove, onReorder, onCancel }) {
  const node = target.node ?? null;
  const isFolder = node ? Boolean(node.children) : target.isFolder;
  const [name, setName] = useState(node?.name ?? "");
  const [text, setText] = useState(node?.text ?? "");
  const [folder, setFolder] = useState(folderKey(node ? parentPath(node.path) : target.folder));
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const choices = folderChoices(folders, node && isFolder ? node.path : null);
  const title = `${isFolder ? "フォルダー" : "プリセット"}を${node ? "編集" : "作成"}`;

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name, text: isFolder ? undefined : text, folder: parseFolderKey(folder) });
  };

  return (
    <form class="preset-editor" aria-label={title} onSubmit={submit}>
      <div class="editor-title">{title}</div>
      <input
        ref={nameRef}
        type="text"
        value={name}
        placeholder="名前"
        aria-label="名前"
        required
        onInput={(e) => setName(e.target.value)}
      />
      {!isFolder && (
        <textarea
          value={text}
          placeholder="コピーする文字"
          aria-label="文字"
          rows={6}
          spellcheck={false}
          onInput={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 改行は Enter のまま入れ、Ctrl+Enter で保存する
            if (e.key === "Enter" && e.ctrlKey) submit(e);
          }}
        />
      )}
      <select value={folder} aria-label="入れる場所" onChange={(e) => setFolder(e.target.value)}>
        <option value={ROOT_FOLDER_KEY}>先頭</option>
        {choices.map((path) => (
          <option key={folderKey(path)} value={folderKey(path)}>
            {path.join(" / ")}
          </option>
        ))}
      </select>
      <div class="editor-actions">
        <button class="row-btn primary" type="submit" disabled={!name.trim()}>
          保存
        </button>
        <button class="row-btn" type="button" onClick={onCancel}>
          取消
        </button>
        {node && (
          <span class="editor-side">
            <button
              class="row-btn"
              type="button"
              title="上へ"
              aria-label="上へ"
              onClick={() => onReorder(node.path, -1)}
            >
              ↑
            </button>
            <button
              class="row-btn"
              type="button"
              title="下へ"
              aria-label="下へ"
              onClick={() => onReorder(node.path, 1)}
            >
              ↓
            </button>
            {confirming ? (
              <button class="row-btn danger" type="button" onClick={() => onRemove(node.path)}>
                {isFolder ? "中身ごと削除" : "削除する"}
              </button>
            ) : (
              <button class="row-btn" type="button" onClick={() => setConfirming(true)}>
                削除
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  );
}

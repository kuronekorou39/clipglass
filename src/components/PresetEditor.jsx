import { useEffect, useRef, useState } from "preact/hooks";
import {
  ROOT_FOLDER_KEY,
  folderChoices,
  folderKey,
  parentPath,
  parseFolderKey,
  presetDescription,
} from "../presets.js";
import { Icon } from "./Icon.jsx";

/**
 * プリセットかフォルダーの編集、または新規作成。ポップオーバーの一覧の下に出す。
 * `target` は `{ node }`(編集)か `{ isFolder, folder }`(新規、`folder` は作る場所)。
 * プリセットはコピーする文字が主で、説明は任意(なければ文字から名前を作る)。
 * フォルダーは名前だけを持つ。
 */
export function PresetEditor({ target, folders, onSave, onRemove, onReorder, onCancel }) {
  const node = target.node ?? null;
  const isFolder = node ? Boolean(node.children) : target.isFolder;
  const [name, setName] = useState(node ? presetDescription(node) : "");
  const [text, setText] = useState(node?.text ?? "");
  const [folder, setFolder] = useState(folderKey(node ? parentPath(node.path) : target.folder));
  const [confirming, setConfirming] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    if (isFolder) firstRef.current?.select();
  }, []);

  const choices = folderChoices(folders, node && isFolder ? node.path : null);
  const title = `${isFolder ? "フォルダー" : "プリセット"}を${node ? "編集" : "作成"}`;

  const placeField = (
    <label class="editor-place">
      <Icon name="folder" />
      <span class="editor-place-label">入れる場所</span>
      <select value={folder} aria-label="入れる場所" onChange={(e) => setFolder(e.target.value)}>
        <option value={ROOT_FOLDER_KEY}>先頭</option>
        {choices.map((path) => (
          <option key={folderKey(path)} value={folderKey(path)}>
            {path.join(" / ")}
          </option>
        ))}
      </select>
    </label>
  );
  const ready = isFolder ? name.trim() !== "" : text.trim() !== "";

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    onSave({ name, text: isFolder ? undefined : text, folder: parseFolderKey(folder) });
  };

  return (
    <form class="preset-editor" aria-label={title} onSubmit={submit}>
      <div class="editor-title">
        <Icon name={isFolder ? "folder" : "list"} />
        {title}
      </div>
      {/* 新しく作るときは、まず入れる場所を決める */}
      {!node && placeField}
      {isFolder ? (
        <input
          ref={firstRef}
          type="text"
          value={name}
          placeholder="フォルダーの名前"
          aria-label="名前"
          required
          onInput={(e) => setName(e.target.value)}
        />
      ) : (
        <>
          <textarea
            ref={firstRef}
            value={text}
            placeholder="コピーする文字"
            aria-label="文字"
            rows={4}
            spellcheck={false}
            onInput={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 改行は Enter のまま入れ、Ctrl+Enter で保存する
              if (e.key === "Enter" && e.ctrlKey) submit(e);
            }}
          />
          <input
            type="text"
            value={name}
            placeholder="説明(任意)"
            aria-label="説明"
            title="空なら、文字の1行目を名前にします"
            onInput={(e) => setName(e.target.value)}
          />
        </>
      )}
      {/* 編集では、値のあとに場所を置く */}
      {node && placeField}
      <div class="editor-actions">
        <button class="row-btn primary with-icon" type="submit" disabled={!ready}>
          <Icon name="check" />
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
              <Icon name="up" size={12} />
            </button>
            <button
              class="row-btn"
              type="button"
              title="下へ"
              aria-label="下へ"
              onClick={() => onReorder(node.path, 1)}
            >
              <Icon name="down" size={12} />
            </button>
            {confirming ? (
              <button class="row-btn danger" type="button" onClick={() => onRemove(node.path)}>
                {isFolder ? "中身ごと削除" : "削除する"}
              </button>
            ) : (
              <button
                class="row-btn"
                type="button"
                title="削除"
                aria-label="削除"
                onClick={() => setConfirming(true)}
              >
                <Icon name="trash" size={12} />
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  );
}

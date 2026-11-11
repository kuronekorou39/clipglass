import { useState } from "preact/hooks";
import { ROOT_FOLDER_KEY, folderKey, parseFolderKey } from "../presets.js";
import { firstLine } from "../search.js";
import { Icon } from "./Icon.jsx";

/**
 * 履歴の行をプリセットに加えるときに、入れるフォルダーを選ぶ。
 * 今あるフォルダーから選ぶか、新しいフォルダーの名前を入れて、選んだ場所の中に作る。
 * `onSubmit({ folder, newFolder })` の `newFolder` は、作らないとき null。
 */
export function AddPresetDialog({ closing, item, folders, error, onSubmit, onClose }) {
  const [folder, setFolder] = useState(ROOT_FOLDER_KEY);
  const [newFolder, setNewFolder] = useState("");

  const submit = (e) => {
    e.preventDefault();
    onSubmit({ folder: parseFolderKey(folder), newFolder: newFolder.trim() || null });
  };

  return (
    <div class={`overlay${closing ? " closing" : ""}`} inert={closing} onClick={onClose}>
      <form
        class="panel"
        role="dialog"
        aria-label="プリセットに追加"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div class="panel-title">
          プリセットに追加
          <button class="titlebar-btn" type="button" title="閉じる" aria-label="閉じる" onClick={onClose}>
            {"✕"}
          </button>
        </div>
        <div class="dialog-quote" title={item.text}>
          {firstLine(item.text) || "(空)"}
        </div>
        {error && <div class="status-error">{error}</div>}
        <label class="field">
          <span class="setting-label">
            <Icon name="folder" />
            入れる場所
          </span>
          <select value={folder} aria-label="入れる場所" onChange={(e) => setFolder(e.target.value)}>
            <option value={ROOT_FOLDER_KEY}>先頭</option>
            {folders.map((path) => (
              <option key={folderKey(path)} value={folderKey(path)}>
                {path.join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="setting-label" title="名前を入れると、上で選んだ場所の中にフォルダーを作って、そこへ入れます">
            <Icon name="plus" />
            新しいフォルダーを作る(任意)
          </span>
          <input
            type="text"
            value={newFolder}
            placeholder="フォルダーの名前"
            aria-label="新しいフォルダー"
            onInput={(e) => setNewFolder(e.target.value)}
          />
        </label>
        <div class="editor-actions">
          <button class="row-btn primary with-icon" type="submit" disabled={Boolean(error)}>
            <Icon name="check" />
            追加
          </button>
          <button class="row-btn" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

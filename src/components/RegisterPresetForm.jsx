import { useEffect, useRef, useState } from "preact/hooks";
import { firstLine } from "../search.js";

const ROOT = "";

/** 履歴のテキストをプリセットに登録するときの、名前とフォルダーの入力。 */
export function RegisterPresetForm({ item, folders, onSubmit, onCancel }) {
  const [name, setName] = useState(firstLine(item.text).slice(0, 20));
  const [folder, setFolder] = useState(ROOT);
  const [newFolder, setNewFolder] = useState("");
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const parent = folder === ROOT ? [] : folder.split("\u0000");
    const created = newFolder.trim() ? [newFolder.trim()] : [];
    onSubmit([...parent, ...created, name.trim()]);
  };

  return (
    <div class="overlay" onClick={onCancel}>
      <form
        class="panel"
        role="dialog"
        aria-label="プリセットに登録"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div class="panel-title">プリセットに登録</div>
        <pre class="register-preview">{item.text}</pre>
        <label class="field">
          <span>名前</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            required
            onInput={(e) => setName(e.target.value)}
          />
        </label>
        <label class="field">
          <span>フォルダー</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value={ROOT}>(先頭)</option>
            {folders.map((path) => (
              <option key={path.join("\u0000")} value={path.join("\u0000")}>
                {path.join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>新しいフォルダーを作って入れる(任意)</span>
          <input
            type="text"
            value={newFolder}
            placeholder="フォルダー名"
            onInput={(e) => setNewFolder(e.target.value)}
          />
        </label>
        <div class="field-row">
          <button class="row-btn primary" type="submit" disabled={!name.trim()}>
            登録
          </button>
          <button class="row-btn" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

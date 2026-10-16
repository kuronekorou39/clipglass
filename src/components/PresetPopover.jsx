import { useEffect, useRef, useState } from "preact/hooks";
import { presetChanges } from "../presets.js";
import { folderPaths } from "../search.js";
import { PresetEditor } from "./PresetEditor.jsx";
import { PresetTree } from "./PresetTree.jsx";

/**
 * 下部のボタンから開くプリセットの一覧。外側を押すか Esc で閉じる。
 * ✎ や「＋」で、一覧と入れ替えて編集画面を出す。
 * `call(command, args, message)` は失敗を通知にして `{ ok, value }` を返す。
 */
export function PresetPopover({
  presets,
  visiblePresets,
  error,
  query,
  onQueryChange,
  onCopy,
  call,
  onReload,
  onOpenFile,
  onClose,
}) {
  const [editing, setEditing] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!editing) searchRef.current?.focus();
  }, [editing]);

  const finish = () => {
    setEditing(null);
    onReload();
  };

  const save = async (values) => {
    const node = editing.node;
    if (!node) {
      const command = editing.isFolder ? "create_preset_folder" : "create_preset";
      const args = { folder: values.folder, name: values.name.trim() };
      if (!editing.isFolder) args.text = values.text;
      if ((await call(command, args, "作成しました")).ok) finish();
      return;
    }
    const change = presetChanges(node, values);
    let path = node.path;
    if (change.update) {
      const result = await call("update_preset", {
        path,
        name: change.name,
        text: values.text ?? null,
      });
      if (!result.ok) return;
      path = result.value;
    }
    if (change.moved && !(await call("move_preset", { path, folder: values.folder })).ok) {
      // 名前の変更までは済んでいるので、一覧は読み直す
      onReload();
      return;
    }
    finish();
  };

  const reorder = async (path, offset) => {
    await call("reorder_preset", { path, offset });
    onReload();
  };

  const remove = async (path) => {
    if ((await call("remove_preset", { path }, "削除しました")).ok) finish();
  };

  return (
    <div class="popover-backdrop" onMouseDown={onClose}>
      <div
        id="presets"
        class="popover"
        role="dialog"
        aria-label="プリセット"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {editing ? (
          <PresetEditor
            key={editing.node?.path.join("/") ?? "new"}
            target={editing}
            folders={folderPaths(presets)}
            onSave={save}
            onRemove={remove}
            onReorder={reorder}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <input
              ref={searchRef}
              class="popover-search"
              type="search"
              value={query}
              placeholder="プリセットを検索"
              aria-label="プリセットを検索"
              onInput={(e) => onQueryChange(e.target.value)}
            />
            <div class="popover-body">
              {error && <div class="status-row status-error">{error}</div>}
              <PresetTree
                nodes={visiblePresets}
                onCopy={onCopy}
                onEdit={(node) => setEditing({ node })}
              />
              {!error && presets.length === 0 && (
                <div class="empty-hint">履歴の「登録」か「＋ プリセット」で追加できます</div>
              )}
              {presets.length > 0 && visiblePresets.length === 0 && (
                <div class="empty-hint">一致するプリセットがありません</div>
              )}
            </div>
            <div class="presets-footer">
              <button
                class="row-btn"
                disabled={Boolean(error)}
                onClick={() => setEditing({ isFolder: false, folder: [] })}
              >
                ＋ プリセット
              </button>
              <button
                class="row-btn"
                disabled={Boolean(error)}
                onClick={() => setEditing({ isFolder: true, folder: [] })}
              >
                ＋ フォルダー
              </button>
              <button class="row-btn push-right" title="presets.yaml を開く" onClick={onOpenFile}>
                ファイル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

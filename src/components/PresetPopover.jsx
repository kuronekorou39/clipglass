import { useEffect, useRef, useState } from "preact/hooks";
import { presetChanges } from "../presets.js";
import { loadPresetView, savePresetView, setCollapsedMany, toggleCollapsed } from "../presetView.js";
import { folderPaths } from "../search.js";
import { PresetEditor } from "./PresetEditor.jsx";
import { PresetTree } from "./PresetTree.jsx";
import { Icon } from "./Icon.jsx";

/**
 * 下部のボタンから開くプリセットの一覧。外側を押すか Esc で閉じる。
 * ✎ や「＋」で、一覧の下に編集画面を出す。一覧は隠さず、編集中の行に印を付ける。
 * `call(command, args, message)` は失敗を通知にして `{ ok, value }` を返す。
 */
export function PresetPopover({
  closing,
  presets,
  visiblePresets,
  error,
  query,
  onQueryChange,
  onCopy,
  call,
  onReload,
  onRevealFile,
  onClose,
}) {
  const [editing, setEditing] = useState(null);
  // 閉じているフォルダーと、前回のスクロール位置を覚えておく
  const [collapsed, setCollapsed] = useState(() => loadPresetView(localStorage).collapsed);
  const searchRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!editing) searchRef.current?.focus();
  }, [editing]);

  // 開いたら、前回見ていた位置まで戻す
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = loadPresetView(localStorage).scroll;
  }, []);

  const toggleFolder = (key, open) => {
    setCollapsed((prev) => {
      const next = toggleCollapsed(prev, key, open);
      savePresetView(localStorage, { collapsed: next, scroll: bodyRef.current?.scrollTop ?? 0 });
      return next;
    });
  };

  // フォルダーの中の入れ子をまとめて開く・閉じる
  const setFolders = (keys, open) => {
    setCollapsed((prev) => {
      const next = setCollapsedMany(prev, keys, open);
      savePresetView(localStorage, { collapsed: next, scroll: bodyRef.current?.scrollTop ?? 0 });
      return next;
    });
  };

  const rememberScroll = (e) => {
    savePresetView(localStorage, { collapsed, scroll: e.target.scrollTop });
  };

  const finish = () => {
    setEditing(null);
    onReload();
  };

  const save = async (values) => {
    const node = editing.node;
    if (!node) {
      const command = editing.isFolder ? "create_preset_folder" : "create_preset";
      // プリセットの説明は任意。空なら null を送り、文字から名前を作らせる
      const args = { folder: values.folder, name: values.name.trim() || null };
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
    <div
      class={`popover-backdrop${closing ? " closing" : ""}`}
      inert={closing}
      onMouseDown={onClose}
    >
      <div
        id="presets"
        class="popover"
        role="dialog"
        aria-label="プリセット"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={searchRef}
          class="popover-search"
          type="search"
          value={query}
          placeholder="プリセットを検索"
          aria-label="プリセットを検索"
          onInput={(e) => onQueryChange(e.target.value)}
        />
        <div class="popover-body" ref={bodyRef} onScroll={rememberScroll}>
          {error && <div class="status-row status-error">{error}</div>}
          <PresetTree
            nodes={visiblePresets}
            editingPath={editing?.node?.path ?? null}
            collapsed={collapsed}
            forceOpen={query.trim() !== ""}
            onToggleFolder={toggleFolder}
            onSetFolders={setFolders}
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
        {editing ? (
          <PresetEditor
            key={editing.node?.path.join("/") ?? (editing.isFolder ? "new-folder" : "new")}
            target={editing}
            folders={folderPaths(presets)}
            onSave={save}
            onRemove={remove}
            onReorder={reorder}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div class="presets-footer">
            <button
              class="text-btn with-icon"
              disabled={Boolean(error)}
              onClick={() => setEditing({ isFolder: true, folder: [] })}
            >
              <Icon name="plus" size={12} />
              フォルダー
            </button>
            <button
              class="text-btn with-icon"
              disabled={Boolean(error)}
              onClick={() => setEditing({ isFolder: false, folder: [] })}
            >
              <Icon name="plus" size={12} />
              プリセット
            </button>
            <button
              class="text-btn with-icon push-right"
              title="presets.yaml の場所をエクスプローラーで表示"
              onClick={onRevealFile}
            >
              <Icon name="folderOpen" size={12} />
              場所
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

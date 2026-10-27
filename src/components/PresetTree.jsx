import { presetDescription } from "../presets.js";
import { pathKey } from "../presetView.js";
import { countLeaves, firstLine } from "../search.js";
import { Icon } from "./Icon.jsx";

function EditButton({ node, onEdit }) {
  return (
    <button
      class="icon-btn"
      title={node.children ? "フォルダーを編集" : "プリセットを編集"}
      aria-label="編集"
      onClick={(e) => {
        // フォルダーの開閉やコピーにならないようにする
        e.preventDefault();
        e.stopPropagation();
        onEdit(node);
      }}
    >
      {"✎"}
    </button>
  );
}

const samePath = (a, b) => a !== null && a.length === b.length && a.every((part, i) => part === b[i]);

function PresetNode({ node, editingPath, collapsed, forceOpen, onToggleFolder, onCopy, onEdit }) {
  const editing = samePath(editingPath, node.path) ? " editing" : "";
  if (node.children) {
    const key = pathKey(node.path);
    // 検索中は一致を隠さないよう開いておく。閉じていた記憶は検索の前後で保つ
    const open = forceOpen || !collapsed.has(key);
    return (
      <details
        class="preset-folder"
        open={open}
        onToggle={(e) => {
          if (!forceOpen && e.target.open !== open) onToggleFolder(key, e.target.open);
        }}
      >
        <summary class={editing}>
          <Icon name="folder" />
          <span class="preset-name">{node.name}</span>
          <span class="preset-count">{countLeaves(node.children)}件</span>
          <EditButton node={node} onEdit={onEdit} />
        </summary>
        <div class="preset-children">
          {node.children.map((child) => (
            <PresetNode
              key={child.name}
              node={child}
              editingPath={editingPath}
              collapsed={collapsed}
              forceOpen={forceOpen}
              onToggleFolder={onToggleFolder}
              onCopy={onCopy}
              onEdit={onEdit}
            />
          ))}
          {node.children.length === 0 && <div class="preset-empty">空のフォルダー</div>}
        </div>
      </details>
    );
  }
  const description = presetDescription(node);
  return (
    <div
      class={`preset-leaf${editing}`}
      role="button"
      tabIndex={0}
      title={node.text}
      onClick={() => onCopy(node.path)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCopy(node.path);
        }
      }}
    >
      {/* コピーする文字が主。説明は付けたときだけ添える */}
      <span class="preset-text">{firstLine(node.text) || "(空)"}</span>
      {description && <span class="preset-desc">{description}</span>}
      <EditButton node={node} onEdit={onEdit} />
    </div>
  );
}

/**
 * プリセットの木。フォルダーは折りたため、プリセットはクリックでコピーする。✎ で編集する。
 * プリセットの行はコピーする文字を先に出し、説明は付けたときだけ右に添える。
 */
export function PresetTree({
  nodes,
  editingPath = null,
  collapsed,
  forceOpen = false,
  onToggleFolder,
  onCopy,
  onEdit,
}) {
  return (
    <div class="preset-tree">
      {nodes.map((node) => (
        <PresetNode
          key={node.name}
          node={node}
          editingPath={editingPath}
          collapsed={collapsed}
          forceOpen={forceOpen}
          onToggleFolder={onToggleFolder}
          onCopy={onCopy}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

import { countLeaves, firstLine } from "../search.js";

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

function PresetNode({ node, onCopy, onEdit }) {
  if (node.children) {
    return (
      <details class="preset-folder" open>
        <summary>
          <span class="preset-name">{node.name}</span>
          <span class="preset-count">{countLeaves(node.children)}件</span>
          <EditButton node={node} onEdit={onEdit} />
        </summary>
        <div class="preset-children">
          {node.children.map((child) => (
            <PresetNode key={child.name} node={child} onCopy={onCopy} onEdit={onEdit} />
          ))}
          {node.children.length === 0 && <div class="preset-empty">空のフォルダー</div>}
        </div>
      </details>
    );
  }
  return (
    <div
      class="preset-leaf"
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
      <span class="preset-name">{node.name}</span>
      <span class="preset-text">{firstLine(node.text)}</span>
      <EditButton node={node} onEdit={onEdit} />
    </div>
  );
}

/** プリセットの木。フォルダーは折りたため、プリセットはクリックでコピーする。✎ で編集する。 */
export function PresetTree({ nodes, onCopy, onEdit }) {
  return (
    <div class="preset-tree">
      {nodes.map((node) => (
        <PresetNode key={node.name} node={node} onCopy={onCopy} onEdit={onEdit} />
      ))}
    </div>
  );
}

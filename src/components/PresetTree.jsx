import { useState } from "preact/hooks";
import { countLeaves, firstLine } from "../search.js";

const pathKey = (path) => path.join("\u0000");

function DeleteControl({ node, confirming, onConfirmRequest, onRemove }) {
  const isFolder = Boolean(node.children);
  if (confirming) {
    return (
      <span class="confirm" onClick={(e) => e.stopPropagation()}>
        <button class="row-btn danger" onClick={() => onRemove(node.path)}>
          {isFolder ? "中身ごと削除" : "削除"}
        </button>
        <button class="row-btn" onClick={() => onConfirmRequest(null)}>
          取消
        </button>
      </span>
    );
  }
  return (
    <button
      class="icon-btn"
      title={isFolder ? "このフォルダーを中身ごと削除" : "このプリセットを削除"}
      aria-label="削除"
      onClick={(e) => {
        e.stopPropagation();
        onConfirmRequest(pathKey(node.path));
      }}
    >
      {"✕"}
    </button>
  );
}

function PresetNode({ node, confirmKey, onConfirmRequest, onCopy, onRemove }) {
  const confirming = confirmKey === pathKey(node.path);
  const control = (
    <DeleteControl
      node={node}
      confirming={confirming}
      onConfirmRequest={onConfirmRequest}
      onRemove={onRemove}
    />
  );
  if (node.children) {
    return (
      <details class="preset-folder" open>
        <summary>
          <span class="preset-name">{node.name}</span>
          <span class="preset-count">{countLeaves(node.children)}件</span>
          {control}
        </summary>
        <div class="preset-children">
          {node.children.map((child) => (
            <PresetNode
              key={child.name}
              node={child}
              confirmKey={confirmKey}
              onConfirmRequest={onConfirmRequest}
              onCopy={onCopy}
              onRemove={onRemove}
            />
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
      {control}
    </div>
  );
}

/** プリセットの木。フォルダーは折りたため、プリセットはクリックでコピーする。 */
export function PresetTree({ nodes, onCopy, onRemove }) {
  const [confirmKey, setConfirmKey] = useState(null);
  const remove = (path) => {
    setConfirmKey(null);
    onRemove(path);
  };
  return (
    <div class="preset-tree">
      {nodes.map((node) => (
        <PresetNode
          key={node.name}
          node={node}
          confirmKey={confirmKey}
          onConfirmRequest={setConfirmKey}
          onCopy={onCopy}
          onRemove={remove}
        />
      ))}
    </div>
  );
}

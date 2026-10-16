/** 履歴の行の右クリックメニュー。ふだん使わない固定と削除をここに置く。 */
export function ItemMenu({ item, x, y, onPin, onRemove, onClose }) {
  // 画面の端で切れないよう、右と下に寄りすぎたら内側へ出す
  const style = {
    left: `min(${x}px, calc(100vw - 11em))`,
    top: `min(${y}px, calc(100vh - 5.5em))`,
  };
  const run = (action) => () => {
    action();
    onClose();
  };
  return (
    <div
      class="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div class="menu" role="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <button class="menu-item" role="menuitem" onClick={run(() => onPin(!item.pinned))}>
          {item.pinned ? "固定を外す" : "固定する(上限で消えず、次回も残る)"}
        </button>
        <button class="menu-item danger" role="menuitem" onClick={run(onRemove)}>
          履歴から削除
        </button>
      </div>
    </div>
  );
}

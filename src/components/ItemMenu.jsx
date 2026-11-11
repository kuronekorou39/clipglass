/**
 * 履歴の行の右クリックメニュー。お気に入りとプリセットへの追加、削除をここに置く。
 * お気に入りとプリセットは文字の項目だけが対象。
 */
export function ItemMenu({ item, x, y, onFavorite, onAddPreset, onRemove, onClose }) {
  const isText = item.kind === "text";
  // 画面の端で切れないよう、右と下に寄りすぎたら内側へ出す
  const style = {
    left: `min(${x}px, calc(100vw - 13em))`,
    top: `min(${y}px, calc(100vh - ${isText ? 8 : 3}em))`,
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
        {isText && (
          <>
            <button class="menu-item" role="menuitem" onClick={run(() => onFavorite(!item.favorite))}>
              {item.favorite ? "お気に入りから外す" : "お気に入りに追加"}
            </button>
            <button class="menu-item" role="menuitem" onClick={run(onAddPreset)}>
              プリセットに追加…
            </button>
          </>
        )}
        <button class="menu-item danger" role="menuitem" onClick={run(onRemove)}>
          履歴から削除
        </button>
      </div>
    </div>
  );
}

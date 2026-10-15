import { getCurrentWindow } from "@tauri-apps/api/window";

// 枠なしウィンドウの縁はOSの当たり判定が数ピクセルしかなく、リモートデスクトップでは
// つかみにくい。透明な帯を四辺と四隅に敷き、押したらOSのサイズ変更を始める。
const HANDLES = [
  ["n", "North"],
  ["s", "South"],
  ["e", "East"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
];

function startResize(event, direction) {
  if (event.button !== 0) return;
  event.preventDefault();
  getCurrentWindow().startResizeDragging(direction);
}

export function ResizeHandles() {
  return (
    <>
      {HANDLES.map(([edge, direction]) => (
        <div
          key={edge}
          class={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onMouseDown={(e) => startResize(e, direction)}
        />
      ))}
      <div
        class="resize-grip"
        title="ドラッグでサイズ変更(Ctrl+Shift+Alt+矢印でも変えられます)"
        aria-hidden="true"
        onMouseDown={(e) => startResize(e, "SouthEast")}
      />
    </>
  );
}

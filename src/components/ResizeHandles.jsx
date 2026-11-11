import { startWindowDrag } from "../windowDrag.js";

// 枠なしウィンドウの縁はOSの当たり判定が数ピクセルしかなく、リモートデスクトップでは
// つかみにくい。透明な帯を四辺と四隅に敷き、押したらボタンを離すまでサイズを変える。
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
// 見えるつまみは下の両方の角に置く。どちらの手元からでも大きさを変えられる。
const GRIPS = [
  ["left", "sw"],
  ["right", "se"],
];

export function ResizeHandles() {
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          class={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onMouseDown={(e) => startWindowDrag(e, edge)}
        />
      ))}
      {GRIPS.map(([side, edge]) => (
        <div
          key={side}
          class={`resize-grip ${side}`}
          title="ドラッグでサイズ変更(Ctrl+Shift+Alt+矢印でも変えられます)"
          aria-hidden="true"
          onMouseDown={(e) => startWindowDrag(e, edge)}
        />
      ))}
    </>
  );
}

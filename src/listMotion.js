// 履歴の行の並べ替えを、元の位置から滑らせて見せる(FLIP)。
// 描画の前後で行の位置を比べ、前の位置から今の位置まで transform で動かす。
// View Transitions は画面全体を一枚の絵にして重ねるので、背景を透かしていると
// 切り替えの一瞬だけ濃く見えた。行だけを直接動かす。

/** 行の移動にかける長さ(ms)。目で追える程度に取り、終わりをゆっくりにする。 */
export const MOVE_DURATION_MS = 320;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** 新しい行が上から入ってくる距離(px)。 */
const ENTER_OFFSET_PX = 14;
/** 行に付ける属性。値は項目のID。 */
export const ROW_ATTR = "data-item-id";
/** 先頭へ上がっていく行に、動いているあいだだけ付けるクラス。すれ違う行の手前に出す。 */
const LIFTING_CLASS = "lifting";

function rows(container) {
  return [...container.querySelectorAll(`[${ROW_ATTR}]`)];
}

/** 今の行の位置と高さを、IDごとに覚える。位置は一覧の中での位置(スクロールに左右されない)。 */
export function measureRows(container) {
  const rects = new Map();
  for (const row of rows(container)) {
    rects.set(row.getAttribute(ROW_ATTR), { top: row.offsetTop, height: row.offsetHeight });
  }
  return rects;
}

/**
 * 行ごとの動きを決める。`before` は前の位置、`after` は今の位置(どちらも measureRows の形)。
 * 動かない行は含めない。`dy` は今の位置から見た前の位置、`grow` は高さの増えた分。
 */
export function planMotion(before, after) {
  const plan = new Map();
  // 最初の表示では、全部の行を「新しい行」として動かさない
  if (before.size === 0) return plan;
  for (const [id, now] of after) {
    const prev = before.get(id);
    if (!prev) {
      plan.set(id, { enter: true });
      continue;
    }
    const dy = prev.top - now.top;
    const grow = now.height - prev.height;
    if (dy !== 0 || grow !== 0) plan.set(id, { enter: false, dy, grow });
  }
  return plan;
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `before`(前の描画での位置)から今の位置まで、行を滑らせる。 */
export function playListMotion(container, before) {
  if (typeof Element.prototype.animate !== "function" || reducedMotion()) return;
  const plan = planMotion(before, measureRows(container));
  if (plan.size === 0) return;
  const timing = { duration: MOVE_DURATION_MS, easing: EASING };
  const solid = getComputedStyle(container).getPropertyValue("--bg-solid").trim();
  for (const row of rows(container)) {
    const motion = plan.get(row.getAttribute(ROW_ATTR));
    if (!motion) continue;
    if (motion.enter) {
      row.animate(
        [
          { opacity: 0, transform: `translateY(-${ENTER_OFFSET_PX}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        timing,
      );
      continue;
    }
    const from = { transform: `translateY(${motion.dy}px)` };
    const to = { transform: "translateY(0)" };
    // 広がる行(先頭になって全文を見せる行)は、下から開いていくように見せる
    if (motion.grow > 0) {
      from.clipPath = `inset(0 0 ${motion.grow}px 0)`;
      to.clipPath = "inset(0 0 0 0)";
    }
    const lifting = motion.dy > 0;
    if (lifting) {
      // すれ違う行の文字と重ならないよう、動いているあいだは背景を透かさない
      if (solid) from.backgroundColor = solid;
      row.classList.add(LIFTING_CLASS);
    }
    const animation = row.animate([from, to], timing);
    if (lifting) {
      const done = () => row.classList.remove(LIFTING_CLASS);
      animation.finished.then(done, done);
    }
  }
}

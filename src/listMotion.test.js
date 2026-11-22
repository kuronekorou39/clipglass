import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOVE_DURATION_MS, ROW_ATTR, measureRows, planMotion, playListMotion } from "./listMotion.js";

const rects = (entries) => new Map(entries.map(([id, top, height]) => [id, { top, height }]));

/** jsdom はレイアウトを計算しないので、行の位置と高さを持たせる。 */
function makeList(entries) {
  const container = document.createElement("div");
  for (const [id, top, height] of entries) {
    const row = document.createElement("div");
    row.setAttribute(ROW_ATTR, id);
    Object.defineProperty(row, "offsetTop", { value: top });
    Object.defineProperty(row, "offsetHeight", { value: height });
    container.append(row);
  }
  document.body.append(container);
  return container;
}

const rowOf = (container, id) => container.querySelector(`[${ROW_ATTR}="${id}"]`);

describe("measureRows", () => {
  it("行の位置と高さをIDごとに覚え、IDのない要素は数えない", () => {
    const container = makeList([
      ["1", 0, 40],
      ["2", 40, 60],
    ]);
    container.append(document.createElement("div"));
    expect(measureRows(container)).toEqual(rects([["1", 0, 40], ["2", 40, 60]]));
    container.remove();
  });
});

describe("playListMotion", () => {
  let animate;
  let finish;
  let fail;
  let container;

  /** その行に渡された動きのキーフレーム。 */
  const framesOf = (id) => animate.mock.calls.find(([, , row]) => row === rowOf(container, id))?.[0];

  beforeEach(() => {
    const finished = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    animate = vi.fn();
    Element.prototype.animate = function (frames, timing) {
      animate(frames, timing, this);
      return { finished };
    };
  });

  afterEach(() => {
    delete Element.prototype.animate;
    vi.unstubAllGlobals();
    container?.remove();
  });

  it("新しい行は上から薄く入ってくる", () => {
    container = makeList([["1", 0, 40], ["9", 40, 40]]);
    playListMotion(container, rects([["1", 0, 40]]));
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, timing, row] = animate.mock.calls[0];
    expect(row).toBe(rowOf(container, "9"));
    expect(frames[0]).toEqual({ opacity: 0, transform: "translateY(-14px)" });
    expect(frames[1]).toEqual({ opacity: 1, transform: "translateY(0)" });
    expect(timing.duration).toBe(MOVE_DURATION_MS);
  });

  it("上がる行は手前に出し、背景を透かさず、動き終わると元に戻す", async () => {
    container = makeList([["3", 0, 40], ["1", 40, 40]]);
    container.style.setProperty("--bg-solid", " #123456 ");
    playListMotion(container, rects([["1", 0, 40], ["3", 40, 40]]));
    const lifted = rowOf(container, "3");
    expect(lifted.classList.contains("lifting")).toBe(true);
    expect(framesOf("3")[0]).toEqual({ transform: "translateY(40px)", backgroundColor: "#123456" });
    // 下がる行は手前に出さない
    expect(rowOf(container, "1").classList.contains("lifting")).toBe(false);
    expect(framesOf("1")[0]).toEqual({ transform: "translateY(-40px)" });
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(lifted.classList.contains("lifting")).toBe(false);
  });

  it("動きが途中で取り消されても、手前に出した印を残さない", async () => {
    container = makeList([["3", 0, 40], ["1", 40, 40]]);
    playListMotion(container, rects([["1", 0, 40], ["3", 40, 40]]));
    const lifted = rowOf(container, "3");
    fail(new Error("canceled"));
    await Promise.resolve();
    await Promise.resolve();
    expect(lifted.classList.contains("lifting")).toBe(false);
  });

  it("背景色の指定がなければ、背景は動きに含めない", () => {
    container = makeList([["3", 0, 40], ["1", 40, 40]]);
    playListMotion(container, rects([["1", 0, 40], ["3", 40, 40]]));
    expect(framesOf("3")[0]).not.toHaveProperty("backgroundColor");
  });

  it("広がる行は下から開き、縮む行は切り抜かない", () => {
    container = makeList([["3", 0, 100], ["1", 100, 40]]);
    playListMotion(container, rects([["1", 0, 100], ["3", 100, 40]]));
    expect(framesOf("3")[0].clipPath).toBe("inset(0 0 60px 0)");
    expect(framesOf("3")[1].clipPath).toBe("inset(0 0 0 0)");
    expect(framesOf("1")[0]).not.toHaveProperty("clipPath");
  });

  it("位置が変わらなければ何も動かさない", () => {
    container = makeList([["1", 0, 40]]);
    playListMotion(container, rects([["1", 0, 40]]));
    expect(animate).not.toHaveBeenCalled();
  });

  it("動きを減らす設定の環境では動かさない", () => {
    vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("reduce") }));
    container = makeList([["1", 40, 40]]);
    playListMotion(container, rects([["1", 0, 40]]));
    expect(animate).not.toHaveBeenCalled();
  });

  it("動きを減らす設定でなければ動かす", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    container = makeList([["1", 40, 40]]);
    playListMotion(container, rects([["1", 0, 40]]));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("アニメーションの機能がない環境でも例外を出さない", () => {
    delete Element.prototype.animate;
    container = makeList([["1", 40, 40]]);
    expect(() => playListMotion(container, rects([["1", 0, 40]]))).not.toThrow();
    expect(rowOf(container, "1").classList.contains("lifting")).toBe(false);
  });
});

describe("planMotion", () => {
  it("最初の表示では何も動かさない", () => {
    expect(planMotion(new Map(), rects([["1", 0, 40]])).size).toBe(0);
  });

  it("先頭へ移った行は下から上がり、広がった分を持つ。ほかの行は下へずれる", () => {
    const before = rects([
      ["1", 0, 100],
      ["2", 100, 40],
      ["3", 140, 40],
    ]);
    // 3 を選ぶと、3 が先頭で広がり、1 は畳まれて下へ行く
    const after = rects([
      ["3", 0, 100],
      ["1", 100, 40],
      ["2", 140, 40],
    ]);
    const plan = planMotion(before, after);
    expect(plan.get("3")).toEqual({ enter: false, dy: 140, grow: 60 });
    expect(plan.get("1")).toEqual({ enter: false, dy: -100, grow: -60 });
    expect(plan.get("2")).toEqual({ enter: false, dy: -40, grow: 0 });
  });

  it("新しい行は上から入り、動かない行は含めない", () => {
    const before = rects([
      ["1", 0, 40],
      ["2", 40, 40],
    ]);
    const after = rects([
      ["1", 0, 40],
      ["2", 40, 40],
      ["9", 80, 40],
    ]);
    const plan = planMotion(before, after);
    expect([...plan.keys()]).toEqual(["9"]);
    expect(plan.get("9")).toEqual({ enter: true });
  });
});

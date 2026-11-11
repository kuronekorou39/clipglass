import { describe, expect, it } from "vitest";
import { planMotion } from "./listMotion.js";

const rects = (entries) => new Map(entries.map(([id, top, height]) => [id, { top, height }]));

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

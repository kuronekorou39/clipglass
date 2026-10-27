import { describe, expect, it } from "vitest";
import { loadPresetView, pathKey, savePresetView, toggleCollapsed } from "./presetView.js";

function fakeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_, next) => {
      value = next;
    },
  };
}

describe("presetView", () => {
  it("閉じているフォルダーとスクロール位置を往復できる", () => {
    const storage = fakeStorage();
    savePresetView(storage, { collapsed: new Set([pathKey(["挨拶"]), pathKey(["仕事", "定型"])]), scroll: 120 });
    const view = loadPresetView(storage);
    expect(view.collapsed.has(pathKey(["挨拶"]))).toBe(true);
    expect(view.collapsed.has(pathKey(["仕事", "定型"]))).toBe(true);
    expect(view.collapsed.has(pathKey(["仕事"]))).toBe(false);
    expect(view.scroll).toBe(120);
  });

  it("記憶がない・壊れているときは初期値", () => {
    expect(loadPresetView(fakeStorage()).collapsed.size).toBe(0);
    expect(loadPresetView(fakeStorage("{壊れ")).scroll).toBe(0);
  });

  it("toggleCollapsed は元の集合を変えずに足し引きする", () => {
    const base = new Set(["a"]);
    const closed = toggleCollapsed(base, "b", false);
    expect([...closed].sort()).toEqual(["a", "b"]);
    expect(toggleCollapsed(closed, "a", true).has("a")).toBe(false);
    expect(base.has("b")).toBe(false);
  });
});

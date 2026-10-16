import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));

const { DRAG_REGION_ATTR, isDragRegion, onDragRegionMouseDown, startWindowDrag } = await import(
  "./windowDrag.js"
);

function mouseDown(target, button = 0) {
  return { target, button, preventDefault: vi.fn() };
}

function region() {
  const element = document.createElement("div");
  element.setAttribute(DRAG_REGION_ATTR, "");
  return element;
}

describe("windowDrag", () => {
  beforeEach(() => invoke.mockClear());

  it("移動用の場所そのものを押したときだけ移動する", () => {
    const bar = region();
    const button = document.createElement("button");
    bar.append(button);
    expect(isDragRegion(bar)).toBe(true);
    // 中のボタンを押しても移動しない(ボタンを押せなくなる)
    expect(isDragRegion(button)).toBe(false);
    expect(isDragRegion(null)).toBe(false);

    onDragRegionMouseDown(mouseDown(button));
    expect(invoke).not.toHaveBeenCalled();
    onDragRegionMouseDown(mouseDown(bar));
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "move" });
  });

  it("主ボタン以外では始めない", () => {
    const event = mouseDown(region(), 2);
    expect(startWindowDrag(event, "se")).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("サイズ変更は方角を渡し、文字の選択を始めない", () => {
    const event = mouseDown(region());
    expect(startWindowDrag(event, "se")).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "se" });
  });
});

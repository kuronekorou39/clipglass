import { describe, expect, it } from "vitest";
import { WINDOW_STEP, windowKeyAction } from "./windowKeys.js";

function key(name, modifiers = {}, target = document.body) {
  return { key: name, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, target, ...modifiers };
}

const MOVE = { ctrlKey: true, shiftKey: true };
const RESIZE = { ctrlKey: true, shiftKey: true, altKey: true };

describe("windowKeyAction", () => {
  it("Ctrl+Shift+矢印で移動する", () => {
    expect(windowKeyAction(key("ArrowLeft", MOVE))).toEqual({ dx: -WINDOW_STEP, dy: 0, dw: 0, dh: 0 });
    expect(windowKeyAction(key("ArrowDown", MOVE))).toEqual({ dx: 0, dy: WINDOW_STEP, dw: 0, dh: 0 });
  });

  it("Ctrl+Shift+Alt+矢印でサイズを変える", () => {
    expect(windowKeyAction(key("ArrowRight", RESIZE))).toEqual({ dx: 0, dy: 0, dw: WINDOW_STEP, dh: 0 });
    expect(windowKeyAction(key("ArrowUp", RESIZE))).toEqual({ dx: 0, dy: 0, dw: 0, dh: -WINDOW_STEP });
  });

  it("修飾キーが足りない、または矢印以外なら何もしない", () => {
    expect(windowKeyAction(key("ArrowLeft"))).toBe(null);
    expect(windowKeyAction(key("ArrowLeft", { ctrlKey: true }))).toBe(null);
    expect(windowKeyAction(key("ArrowLeft", { shiftKey: true }))).toBe(null);
    expect(windowKeyAction(key("a", MOVE))).toBe(null);
    expect(windowKeyAction(key("ArrowLeft", { ...MOVE, metaKey: true }))).toBe(null);
  });

  it("文字入力中は単語選択に譲る", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    expect(windowKeyAction(key("ArrowLeft", MOVE, input))).toBe(null);
    expect(windowKeyAction(key("ArrowLeft", RESIZE, textarea))).toBe(null);
    expect(windowKeyAction(key("ArrowLeft", MOVE, document.createElement("button")))).not.toBe(null);
  });
});

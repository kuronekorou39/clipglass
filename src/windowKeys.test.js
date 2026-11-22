import { describe, expect, it } from "vitest";
import { WINDOW_STEP, quickPickIndex, windowKeyAction } from "./windowKeys.js";

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

describe("quickPickIndex", () => {
  const digit = (code, modifiers = {}, target = document.body) => ({ ...key("", modifiers, target), code });

  it("1〜9 とテンキーの 1〜9 を、先頭からの位置にする", () => {
    expect(quickPickIndex(digit("Digit1"))).toBe(0);
    expect(quickPickIndex(digit("Digit9"))).toBe(8);
    expect(quickPickIndex(digit("Numpad3"))).toBe(2);
  });

  it("0 やほかのキー、修飾キーとの組み合わせは対象外", () => {
    expect(quickPickIndex(digit("Digit0"))).toBeNull();
    expect(quickPickIndex(digit("KeyA"))).toBeNull();
    expect(quickPickIndex(digit("Digit2", { ctrlKey: true }))).toBeNull();
    expect(quickPickIndex(digit("Digit2", { shiftKey: true }))).toBeNull();
  });

  it("押し続けて届く繰り返しは対象外", () => {
    expect(quickPickIndex(digit("Digit2", { repeat: true }))).toBeNull();
  });

  it("キーの位置の情報がないイベントは対象外", () => {
    expect(quickPickIndex(key("1"))).toBeNull();
  });

  it("文字の入力中は横取りしない", () => {
    expect(quickPickIndex(digit("Digit2", {}, document.createElement("input")))).toBeNull();
    expect(quickPickIndex(digit("Digit2", {}, document.createElement("textarea")))).toBeNull();
  });
});

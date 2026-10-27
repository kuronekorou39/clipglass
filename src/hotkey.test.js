import { describe, expect, it } from "vitest";
import { formatHotkey, readHotkey } from "./hotkey.js";

const press = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("readHotkey", () => {
  it("修飾キーとほかのキー1つで、保存の形にする", () => {
    expect(readHotkey(press("KeyQ", { altKey: true, shiftKey: true }))).toEqual({ hotkey: "Alt+Shift+Q" });
    expect(readHotkey(press("Digit1", { ctrlKey: true }))).toEqual({ hotkey: "Ctrl+1" });
    expect(readHotkey(press("F5", { metaKey: true, ctrlKey: true }))).toEqual({ hotkey: "Ctrl+Super+F5" });
  });

  it("修飾キーは押した順に関わらず Ctrl・Alt・Shift・Win の順に並べる", () => {
    expect(readHotkey(press("KeyV", { shiftKey: true, ctrlKey: true, altKey: true }))).toEqual({
      hotkey: "Ctrl+Alt+Shift+V",
    });
  });

  it("修飾キーだけのあいだは途中の形を返す", () => {
    expect(readHotkey(press("ShiftLeft", { shiftKey: true, altKey: true }))).toEqual({ pending: ["Alt", "Shift"] });
  });

  it("修飾キーなしや、使えないキーは理由を返す", () => {
    expect(readHotkey(press("KeyQ")).error).toContain("一緒に押して");
    expect(readHotkey(press("IntlRo", { ctrlKey: true })).error).toContain("使えません");
  });
});

describe("formatHotkey", () => {
  it("区切りに空白を入れ、Super は Win と出す", () => {
    expect(formatHotkey("Alt+Shift+Q")).toBe("Alt + Shift + Q");
    expect(formatHotkey("Ctrl+Super+F5")).toBe("Ctrl + Win + F5");
    expect(formatHotkey("")).toBe("");
  });
});

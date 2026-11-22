import { describe, expect, it } from "vitest";
import { QUICK_KEY_MODES, quickKeyPrefix } from "./quickKeys.js";

describe("quickKeyPrefix", () => {
  it("組み合わせごとの表記を返し、未設定なら初期値の Ctrl にする", () => {
    expect(quickKeyPrefix("ctrl")).toBe("Ctrl + ");
    expect(quickKeyPrefix("ctrl+shift")).toBe("Ctrl + Shift + ");
    expect(quickKeyPrefix("ctrl+alt")).toBe("Ctrl + Alt + ");
    expect(quickKeyPrefix(undefined)).toBe("Ctrl + ");
  });

  it("使わない設定では null を返す", () => {
    expect(quickKeyPrefix("off")).toBeNull();
  });

  it("選択肢の先頭は初期値で、使わない以外はすべて表記を持つ", () => {
    expect(QUICK_KEY_MODES[0][0]).toBe("ctrl");
    for (const [mode] of QUICK_KEY_MODES.filter(([mode]) => mode !== "off")) {
      expect(quickKeyPrefix(mode)).toBeTruthy();
    }
  });
});

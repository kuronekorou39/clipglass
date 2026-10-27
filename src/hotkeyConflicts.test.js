import { describe, expect, it } from "vitest";
import { hotkeyConflicts } from "./hotkeyConflicts.js";

describe("hotkeyConflicts", () => {
  it("よく知られた組み合わせは、どこで使われているかを返す", () => {
    expect(hotkeyConflicts("Ctrl+Shift+V")[0]).toContain("書式なしで貼り付け");
    expect(hotkeyConflicts("Super+V")[0]).toContain("クリップボード履歴");
  });

  it("Shift だけ・Ctrl だけ・Alt だけと文字の組み合わせは、ふつうの操作と被る", () => {
    expect(hotkeyConflicts("Shift+Q")[0]).toContain("文字の入力");
    expect(hotkeyConflicts("Ctrl+Q")[0]).toContain("基本操作");
    expect(hotkeyConflicts("Alt+Q")[0]).toContain("メニュー");
    expect(hotkeyConflicts("Super+Q")[0]).toContain("Windows");
  });

  it("既定の Alt+Shift+Q や、なしのときは何も出さない", () => {
    expect(hotkeyConflicts("Alt+Shift+Q")).toEqual([]);
    expect(hotkeyConflicts("Ctrl+Alt+Shift+F9")).toEqual([]);
    expect(hotkeyConflicts("")).toEqual([]);
  });
});

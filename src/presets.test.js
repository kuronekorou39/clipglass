import { describe, expect, it } from "vitest";
import { ROOT_FOLDER_KEY, buildPresetPath, defaultPresetName, folderKey } from "./presets.js";

describe("buildPresetPath", () => {
  it("先頭に登録する", () => {
    expect(buildPresetPath({ folderKey: ROOT_FOLDER_KEY, newFolder: "", name: "名前" })).toEqual([
      "名前",
    ]);
  });

  it("選んだフォルダーの下に登録する", () => {
    const key = folderKey(["挨拶", "深い"]);
    expect(buildPresetPath({ folderKey: key, newFolder: "", name: "夜" })).toEqual([
      "挨拶",
      "深い",
      "夜",
    ]);
  });

  it("新しいフォルダーを挟む", () => {
    expect(
      buildPresetPath({ folderKey: folderKey(["a"]), newFolder: " 新規 ", name: " x " }),
    ).toEqual(["a", "新規", "x"]);
  });

  it("名前が空なら登録先を作らない", () => {
    expect(buildPresetPath({ folderKey: ROOT_FOLDER_KEY, newFolder: "f", name: "  " })).toBe(
      null,
    );
  });

  it("フォルダー名にスラッシュや空白があっても区切りと混ざらない", () => {
    const key = folderKey(["a/b", "c d"]);
    expect(buildPresetPath({ folderKey: key, newFolder: "", name: "n" })).toEqual([
      "a/b",
      "c d",
      "n",
    ]);
  });
});

describe("defaultPresetName", () => {
  it("最初の空でない行を20文字まで使う", () => {
    expect(defaultPresetName("\n  \n こんにちは \n2行目")).toBe("こんにちは");
    expect(defaultPresetName("あ".repeat(30))).toBe("あ".repeat(20));
    expect(defaultPresetName("", 5)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  ROOT_FOLDER_KEY,
  folderChoices,
  folderKey,
  parentPath,
  parseFolderKey,
  presetChanges,
} from "./presets.js";

describe("folderKey", () => {
  it("フォルダーの並びと <select> の値を行き来できる", () => {
    for (const path of [[], ["挨拶"], ["挨拶", "深い / 名前"]]) {
      expect(parseFolderKey(folderKey(path))).toEqual(path);
    }
    expect(folderKey([])).toBe(ROOT_FOLDER_KEY);
  });

  it("区切りが名前に現れる文字と重ならない", () => {
    expect(folderKey(["a/b", "c"])).not.toBe(folderKey(["a", "b/c"]));
    expect(folderKey(["a b", "c"])).not.toBe(folderKey(["a", "b c"]));
  });
});

describe("parentPath", () => {
  it("項目の入っているフォルダーを返す", () => {
    expect(parentPath(["挨拶", "朝"])).toEqual(["挨拶"]);
    expect(parentPath(["朝"])).toEqual([]);
  });
});

describe("folderChoices", () => {
  const folders = [["a"], ["a", "b"], ["a", "b", "c"], ["ab"], ["d"]];

  it("プリセットはどのフォルダーへも移せる", () => {
    expect(folderChoices(folders, null)).toEqual(folders);
  });

  it("フォルダーは自分とその中へは移せない。名前の前方一致とは区別する", () => {
    expect(folderChoices(folders, ["a"])).toEqual([["ab"], ["d"]]);
    expect(folderChoices(folders, ["a", "b"])).toEqual([["a"], ["ab"], ["d"]]);
  });
});

describe("presetChanges", () => {
  const leaf = { name: "朝", path: ["挨拶", "朝"], text: "おはよう" };
  const folder = { name: "挨拶", path: ["挨拶"], children: [] };

  it("変えていなければ何もしない", () => {
    expect(presetChanges(leaf, { name: "朝", text: "おはよう", folder: ["挨拶"] })).toEqual({
      name: "朝",
      update: false,
      moved: false,
    });
  });

  it("名前の前後の空白は落とし、名前か文字が変われば書き換える", () => {
    expect(presetChanges(leaf, { name: " 朝 ", text: "おはよう", folder: ["挨拶"] }).update).toBe(false);
    expect(presetChanges(leaf, { name: "昼", text: "おはよう", folder: ["挨拶"] }).update).toBe(true);
    expect(presetChanges(leaf, { name: "朝", text: "こんにちは", folder: ["挨拶"] }).update).toBe(true);
  });

  it("フォルダーが変われば移す", () => {
    expect(presetChanges(leaf, { name: "朝", text: "おはよう", folder: [] }).moved).toBe(true);
    expect(presetChanges(folder, { name: "挨拶", text: undefined, folder: [] })).toEqual({
      name: "挨拶",
      update: false,
      moved: false,
    });
  });
});

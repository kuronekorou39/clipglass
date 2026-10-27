import { describe, expect, it } from "vitest";
import {
  ROOT_FOLDER_KEY,
  folderChoices,
  folderKey,
  parentPath,
  parseFolderKey,
  presetChanges,
  defaultName,
  presetDescription,
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

describe("defaultName と presetDescription", () => {
  it("文字の最初の空でない行の先頭20文字を名前にする", () => {
    expect(defaultName("\n  おはよう  \n二行目")).toBe("おはよう");
    expect(defaultName("あ".repeat(30))).toBe("あ".repeat(20));
    expect(defaultName(" \n ")).toBe("プリセット");
  });

  it("文字から作った名前は説明なし、それ以外は説明として扱う", () => {
    expect(presetDescription({ name: "おはよう", path: ["おはよう"], text: "おはよう" })).toBe("");
    expect(presetDescription({ name: "おはよう (2)", path: ["おはよう (2)"], text: "おはよう" })).toBe("");
    expect(presetDescription({ name: "朝", path: ["朝"], text: "おはよう" })).toBe("朝");
    expect(presetDescription({ name: "挨拶", path: ["挨拶"], children: [] })).toBe("挨拶");
  });
});

describe("presetChanges", () => {
  const leaf = { name: "朝", path: ["挨拶", "朝"], text: "おはよう" };
  const plain = { name: "おはよう", path: ["おはよう"], text: "おはよう" };
  const folder = { name: "挨拶", path: ["挨拶"], children: [] };

  it("変えていなければ何もしない", () => {
    expect(presetChanges(leaf, { name: "朝", text: "おはよう", folder: ["挨拶"] })).toEqual({
      name: "朝",
      update: false,
      moved: false,
    });
    expect(presetChanges(plain, { name: "", text: "おはよう", folder: [] }).update).toBe(false);
  });

  it("説明の前後の空白は落とし、説明か文字が変われば書き換える", () => {
    expect(presetChanges(leaf, { name: " 朝 ", text: "おはよう", folder: ["挨拶"] }).update).toBe(false);
    expect(presetChanges(leaf, { name: "昼", text: "おはよう", folder: ["挨拶"] }).update).toBe(true);
    expect(presetChanges(leaf, { name: "朝", text: "こんにちは", folder: ["挨拶"] }).update).toBe(true);
  });

  it("説明を消すと、名前は文字から作らせる(null を送る)", () => {
    expect(presetChanges(leaf, { name: "", text: "おはよう", folder: ["挨拶"] })).toEqual({
      name: null,
      update: true,
      moved: false,
    });
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

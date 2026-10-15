import { describe, expect, it } from "vitest";
import {
  countLeaves,
  filterItems,
  filterPresets,
  firstLine,
  folderPaths,
  matchesQuery,
} from "./search.js";

const text = { id: 1, kind: "text", text: "Hello World\n二行目" };
const image = { id: 2, kind: "image" };
const files = { id: 3, kind: "files", paths: ["C:\\work\\報告書.xlsx"] };
const items = [text, image, files];
const allKinds = ["text", "image", "files"];

describe("matchesQuery", () => {
  it("検索語が空なら何でも合う", () => {
    expect(items.every((item) => matchesQuery(item, "  "))).toBe(true);
  });

  it("大文字小文字を区別せずに文字を探す", () => {
    expect(matchesQuery(text, "world")).toBe(true);
    expect(matchesQuery(text, "二行")).toBe(true);
    expect(matchesQuery(text, "なし")).toBe(false);
  });

  it("ファイルはパスで探し、画像は検索語があれば外れる", () => {
    expect(matchesQuery(files, "報告書")).toBe(true);
    expect(matchesQuery(files, "work")).toBe(true);
    expect(matchesQuery(image, "a")).toBe(false);
  });
});

describe("filterItems", () => {
  it("種類と検索語の両方で絞り込む", () => {
    expect(filterItems(items, { query: "", kinds: allKinds })).toEqual(items);
    expect(filterItems(items, { query: "", kinds: ["image"] })).toEqual([image]);
    expect(filterItems(items, { query: "o", kinds: allKinds })).toEqual([text, files]);
    expect(filterItems(items, { query: "o", kinds: ["files"] })).toEqual([files]);
    expect(filterItems(items, { query: "", kinds: [] })).toEqual([]);
  });
});

const presets = [
  {
    name: "挨拶",
    path: ["挨拶"],
    children: [
      { name: "朝", path: ["挨拶", "朝"], text: "おはようございます" },
      {
        name: "深い",
        path: ["挨拶", "深い"],
        children: [{ name: "夜", path: ["挨拶", "深い", "夜"], text: "お疲れさまでした" }],
      },
    ],
  },
  { name: "メール", path: ["メール"], text: "example@example.com" },
];

describe("filterPresets", () => {
  it("検索語が空ならそのまま", () => {
    expect(filterPresets(presets, "")).toBe(presets);
  });

  it("名前が合うフォルダーは中身ごと残す", () => {
    expect(filterPresets(presets, "挨拶")).toEqual([presets[0]]);
  });

  it("中身が合うフォルダーは合う中身だけに絞る", () => {
    expect(filterPresets(presets, "疲れ")).toEqual([
      {
        ...presets[0],
        children: [
          {
            ...presets[0].children[1],
            children: [presets[0].children[1].children[0]],
          },
        ],
      },
    ]);
  });

  it("文字でも名前でも探せる", () => {
    expect(filterPresets(presets, "EXAMPLE")).toEqual([presets[1]]);
    expect(filterPresets(presets, "メール")).toEqual([presets[1]]);
    expect(filterPresets(presets, "なし")).toEqual([]);
  });
});

describe("folderPaths / countLeaves", () => {
  it("フォルダーの一覧を深さ優先で返す", () => {
    expect(folderPaths(presets)).toEqual([["挨拶"], ["挨拶", "深い"]]);
  });

  it("入れ子を含めてプリセットを数える", () => {
    expect(countLeaves(presets)).toBe(3);
    expect(countLeaves([])).toBe(0);
  });
});

describe("firstLine", () => {
  it("空でない最初の行を返す", () => {
    expect(firstLine("\n  \n 二行目 \n三行目")).toBe("二行目");
    expect(firstLine("")).toBe("");
  });
});

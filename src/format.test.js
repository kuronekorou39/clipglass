import { describe, expect, it } from "vitest";
import { fileName, formatTime, imageUrl, richFormatLabels } from "./format.js";

describe("richFormatLabels", () => {
  it("プレーンテキストだけなら空", () => {
    expect(richFormatLabels(["CF_UNICODETEXT", "CF_LOCALE", "CF_TEXT"])).toEqual([]);
  });

  it("HTMLとRTFを表示名で返す", () => {
    expect(richFormatLabels(["Rich Text Format", "CF_UNICODETEXT", "HTML Format"])).toEqual([
      "HTML",
      "RTF",
    ]);
  });

  it("画像やファイルは書式として扱わない", () => {
    expect(richFormatLabels(["PNG", "CF_DIB", "CF_HDROP", "XML Spreadsheet"])).toEqual([]);
  });
});

describe("fileName", () => {
  it("フルパスからファイル名を取り出す", () => {
    expect(fileName("C:\\work\\報告書.xlsx")).toBe("報告書.xlsx");
    expect(fileName("memo.txt")).toBe("memo.txt");
  });
});

describe("formatTime", () => {
  it("時分秒を2桁で返す", () => {
    expect(formatTime(new Date(2026, 9, 6, 9, 5, 3).getTime())).toBe("09:05:03");
  });
});

describe("imageUrl", () => {
  it("種類とIDからURLを作る", () => {
    expect(imageUrl("thumb", 7)).toBe("http://clipimg.localhost/thumb/7");
  });
});

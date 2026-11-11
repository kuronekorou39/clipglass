import { describe, expect, it } from "vitest";
import {
  archiveImageUrl,
  fileName,
  formatBytes,
  formatDay,
  formatTime,
  imageUrl,
  richFormatLabels,
} from "./format.js";

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

describe("保管した項目の表示", () => {
  it("サムネイルのURLは日とハッシュから作る", () => {
    expect(archiveImageUrl("2026-11-09", "00ab")).toBe("http://clipimg.localhost/archive/2026-11-09/00ab");
  });

  it("日の見出しに、今日からの隔たりと曜日を添える", () => {
    const today = new Date(2026, 10, 11, 23, 59);
    expect(formatDay("2026-11-11", today)).toBe("今日 2026/11/11(水)");
    expect(formatDay("2026-11-10", today)).toBe("昨日 2026/11/10(火)");
    expect(formatDay("2026-11-01", today)).toBe("10日前 2026/11/1(日)");
    // 月をまたいでも日数で数える
    expect(formatDay("2026-10-31", today)).toBe("11日前 2026/10/31(土)");
  });

  it("大きさは KB か MB で出す", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1500)).toBe("2 KB");
    expect(formatBytes(3.25 * 1024 * 1024)).toBe("3.3 MB");
  });
});

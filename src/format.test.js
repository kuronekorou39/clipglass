import { describe, expect, it } from "vitest";
import { formatTime, imageUrl, summarizeFormats } from "./format.js";

describe("summarizeFormats", () => {
  it("プレーンテキストだけなら書式なし", () => {
    expect(summarizeFormats(["CF_UNICODETEXT", "CF_LOCALE", "CF_TEXT", "CF_OEMTEXT"])).toEqual({
      badges: ["テキスト"],
      otherCount: 0,
      rich: false,
    });
  });

  it("HTMLがあれば書式付き", () => {
    const summary = summarizeFormats(["HTML Format", "CF_UNICODETEXT"]);
    expect(summary.badges).toEqual(["テキスト", "HTML"]);
    expect(summary.rich).toBe(true);
  });

  it("RTFだけでも書式付き", () => {
    expect(summarizeFormats(["Rich Text Format"]).rich).toBe(true);
  });

  it("未知の形式はその他として数える", () => {
    const summary = summarizeFormats(["CF_UNICODETEXT", "XML Spreadsheet", "Biff12", "CF_DIB"]);
    expect(summary.badges).toEqual(["テキスト", "画像"]);
    expect(summary.otherCount).toBe(2);
  });

  it("ファイルのコピーを判別する", () => {
    expect(summarizeFormats(["CF_HDROP", "FileNameW"]).badges).toEqual(["ファイル"]);
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

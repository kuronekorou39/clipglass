import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  loadSettings,
  saveSettings,
  stepFontSize,
} from "./settings.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("settings", () => {
  it("保存がなければ初期値を返す", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("保存した値を復元し、欠けた項目は初期値で補う", () => {
    const storage = memoryStorage();
    saveSettings(storage, { opacity: 80, pinned: false });
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, opacity: 80, pinned: false });
  });

  it("壊れた保存内容は初期値に戻す", () => {
    const storage = memoryStorage({ "clipglass-settings": "{broken" });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("stepFontSize", () => {
  it("1段階ずつ増減する", () => {
    expect(stepFontSize(14, 1)).toBe(16);
    expect(stepFontSize(14, -1)).toBe(12);
  });

  it("範囲の外には出ない", () => {
    expect(stepFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX);
    expect(stepFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings.js";

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

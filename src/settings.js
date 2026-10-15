const STORAGE_KEY = "clipglass-settings";

export const OPACITY_MIN = 20;
export const OPACITY_MAX = 100;
export const OPACITY_STEP = 5;

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 28;
export const FONT_SIZE_STEP = 2;

export const DEFAULT_SETTINGS = {
  pinned: true,
  opacity: 50,
  fontSize: 14,
  wrap: true,
  saveDir: null,
};

export function loadSettings(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 壊れた設定は初期値に戻す
  }
  return { ...DEFAULT_SETTINGS };
}

/** 文字サイズを `steps` 段階だけ変え、範囲内に収めて返す。 */
export function stepFontSize(fontSize, steps) {
  const next = fontSize + steps * FONT_SIZE_STEP;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next));
}

export function saveSettings(storage, settings) {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 設定パネルで入力した履歴の件数を整数にして 1〜`limit` に収める。
 * 数として読めない入力は null を返し、呼び出し側が元の値に戻す。
 */
export function parseHistoryLimit(value, limit) {
  const number = parseInt(value, 10);
  if (Number.isNaN(number)) return null;
  return Math.min(limit, Math.max(1, number));
}

const STORAGE_KEY = "clipglass-settings";

export const OPACITY_MIN = 20;
export const OPACITY_MAX = 100;
export const OPACITY_STEP = 5;

export const DEFAULT_SETTINGS = {
  pinned: true,
  opacity: 50,
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

export function saveSettings(storage, settings) {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

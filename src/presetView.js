// プリセットのポップオーバーを、前に開いていたときと同じ見た目で開き直すための記憶。
// どのフォルダーを閉じていたかと、一覧の縦スクロールの位置を localStorage に持つ。

import { folderKey } from "./presets.js";

const STORAGE_KEY = "clipglass-preset-view";

/** フォルダーの並びを、記憶のキー(文字列)にする。 */
export function pathKey(path) {
  return folderKey(path);
}

/** 閉じているフォルダーの集合と、スクロール位置を読み出す。壊れていれば初期値。 */
export function loadPresetView(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        collapsed: new Set(Array.isArray(parsed.collapsed) ? parsed.collapsed : []),
        scroll: Number(parsed.scroll) || 0,
      };
    }
  } catch {
    // 壊れた記憶は初期値に戻す
  }
  return { collapsed: new Set(), scroll: 0 };
}

export function savePresetView(storage, { collapsed, scroll }) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ collapsed: [...collapsed], scroll }));
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/** 集合に `key` を足した(open=false)、または除いた(open=true)新しい集合を返す。 */
export function toggleCollapsed(collapsed, key, open) {
  const next = new Set(collapsed);
  if (open) next.delete(key);
  else next.add(key);
  return next;
}

/** 集合に `keys` をまとめて足した(open=false)、または除いた(open=true)新しい集合を返す。 */
export function setCollapsedMany(collapsed, keys, open) {
  const next = new Set(collapsed);
  for (const key of keys) {
    if (open) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** フォルダー `node` の中にある、入れ子のフォルダー(自分は含まない)のキー。 */
export function innerFolderKeys(node) {
  const keys = [];
  const walk = (folder) => {
    for (const child of folder.children ?? []) {
      if (child.children) {
        keys.push(pathKey(child.path));
        walk(child);
      }
    }
  };
  walk(node);
  return keys;
}

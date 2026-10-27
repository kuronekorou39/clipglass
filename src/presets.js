// プリセットの編集画面の純粋な部分。

/** フォルダーの並びを <select> の値にするときの区切り。名前には現れない文字を使う。 */
const FOLDER_KEY_SEPARATOR = String.fromCharCode(0);

/** 先頭(フォルダーなし)を表す値。 */
export const ROOT_FOLDER_KEY = "";

/** フォルダーの並びを <select> の値に変える。 */
export function folderKey(path) {
  return path.join(FOLDER_KEY_SEPARATOR);
}

/** <select> の値をフォルダーの並びに戻す。 */
export function parseFolderKey(key) {
  return key === ROOT_FOLDER_KEY ? [] : key.split(FOLDER_KEY_SEPARATOR);
}

/** 項目の入っているフォルダー。 */
export function parentPath(path) {
  return path.slice(0, -1);
}

function startsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((name, i) => path[i] === name);
}

/**
 * 移し先に選べるフォルダー。フォルダーを編集しているときは、自分とその中は除く。
 * `editingFolder` はフォルダーを編集しているときのその `path`、それ以外は null。
 */
export function folderChoices(folders, editingFolder) {
  if (!editingFolder) return folders;
  return folders.filter((path) => !startsWith(path, editingFolder));
}

/** 説明を付けないプリセットの名前の長さ。Rust 側の presets::default_name と合わせる。 */
const DEFAULT_NAME_CHARS = 20;

/** 文字から作る名前。最初の空でない行の先頭で、なければ「プリセット」。Rust 側と同じ規則。 */
export function defaultName(text) {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find((part) => part !== "");
  if (line === undefined) return "プリセット";
  return Array.from(line).slice(0, DEFAULT_NAME_CHARS).join("").trim();
}

/**
 * プリセットの説明。名前が文字から作ったもの(「名前」「名前 (2)」)なら説明なしとして空を返す。
 * フォルダーは名前そのもの。
 */
export function presetDescription(node) {
  if (node.children) return node.name;
  const base = defaultName(node.text);
  if (node.name === base) return "";
  const suffix = node.name.startsWith(`${base} (`) ? node.name.slice(base.length + 2) : null;
  return suffix && /^\d+\)$/.test(suffix) ? "" : node.name;
}

/**
 * 編集の内容から、呼ぶ処理を決める。名前・文字の変更と、フォルダーの移動を分けて行う。
 * プリセットの `name` は説明で、空なら null(文字から名前を作る)にする。
 */
export function presetChanges(node, { name, text, folder }) {
  const trimmed = name.trim();
  const moved = folderKey(folder) !== folderKey(parentPath(node.path));
  if (node.children) return { name: trimmed, update: trimmed !== node.name, moved };
  const rewritten = text !== node.text;
  const described = trimmed !== presetDescription(node);
  return { name: trimmed || null, update: rewritten || described, moved };
}

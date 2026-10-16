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

/** 編集の内容から、呼ぶ処理を決める。名前・文字の変更と、フォルダーの移動を分けて行う。 */
export function presetChanges(node, { name, text, folder }) {
  const trimmed = name.trim();
  const renamed = trimmed !== node.name;
  const rewritten = !node.children && text !== node.text;
  const moved = folderKey(folder) !== folderKey(parentPath(node.path));
  return { name: trimmed, update: renamed || rewritten, moved };
}

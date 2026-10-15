// プリセットの登録先の組み立て。UIの純粋な部分だけを置く。

/** フォルダーの並びを <select> の値にするときの区切り。名前には現れない文字を使う。 */
const FOLDER_KEY_SEPARATOR = "\u0000";

/** 先頭(フォルダーなし)を表す値。 */
export const ROOT_FOLDER_KEY = "";

/** フォルダーの並びを <select> の値に変える。 */
export function folderKey(path) {
  return path.join(FOLDER_KEY_SEPARATOR);
}

/** 登録に使う名前の初期値。文字の最初の行から作る。 */
export function defaultPresetName(text, maxLength = 20) {
  const line = text.split(/\r?\n/).find((part) => part.trim() !== "") ?? "";
  return line.trim().slice(0, maxLength);
}

/**
 * 登録先の並びを作る。選んだフォルダーの下に、新しいフォルダー(任意)と名前を続ける。
 * 名前や新しいフォルダー名の前後の空白は落とす。名前が空なら null。
 */
export function buildPresetPath({ folderKey: key, newFolder, name }) {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const parent = key === ROOT_FOLDER_KEY ? [] : key.split(FOLDER_KEY_SEPARATOR);
  const created = newFolder.trim() ? [newFolder.trim()] : [];
  return [...parent, ...created, trimmedName];
}

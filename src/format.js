// 文字の色や太字などの書式情報を運ぶクリップボード形式と、その表示名。
const RICH_FORMATS = [
  ["HTML", "HTML Format"],
  ["RTF", "Rich Text Format"],
];

const IMAGE_URL_BASE = "http://clipimg.localhost";

/** コピーに含まれる書式付き形式の表示名を返す。なければ空の配列。 */
export function richFormatLabels(formats) {
  return RICH_FORMATS.filter(([, name]) => formats.includes(name)).map(([label]) => label);
}

/** フルパスからファイル名だけを取り出す。 */
export function fileName(path) {
  return path.split(/[\\/]/).pop();
}

export function formatTime(epochMs) {
  const date = new Date(epochMs);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** variant は "full"(元の寸法)または "thumb"(サムネイル)。 */
export function imageUrl(variant, id) {
  return `${IMAGE_URL_BASE}/${variant}/${id}`;
}

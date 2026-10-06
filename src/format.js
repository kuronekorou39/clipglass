// バッジごとの、対応するクリップボード形式名。
const BADGE_FORMATS = [
  ["テキスト", ["CF_UNICODETEXT", "CF_TEXT", "CF_OEMTEXT"]],
  ["HTML", ["HTML Format"]],
  ["RTF", ["Rich Text Format"]],
  ["画像", ["PNG", "CF_DIB", "CF_DIBV5", "CF_BITMAP"]],
  ["ファイル", ["CF_HDROP"]],
];
const RICH_BADGES = ["HTML", "RTF"];
// テキストに付随するだけの形式。「その他」には数えない。
const IGNORED_FORMATS = ["CF_LOCALE"];

const IMAGE_URL_BASE = "http://clipimg.localhost";

/** 形式名の一覧を、表示用のバッジ・その他の件数・書式の有無にまとめる。 */
export function summarizeFormats(formats) {
  const known = new Set(IGNORED_FORMATS);
  const badges = [];
  for (const [label, names] of BADGE_FORMATS) {
    names.forEach((name) => known.add(name));
    if (names.some((name) => formats.includes(name))) badges.push(label);
  }
  return {
    badges,
    otherCount: formats.filter((name) => !known.has(name)).length,
    rich: badges.some((label) => RICH_BADGES.includes(label)),
  };
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

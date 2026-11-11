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

/** 保管した項目のサムネイルのURL。`day` は保管した日、`hash` は画像のハッシュ(16進)。 */
export function archiveImageUrl(day, hash) {
  return `${IMAGE_URL_BASE}/archive/${day}/${hash}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 保管した日(`YYYY-MM-DD`)を見出しにする。`today` と同じ日は「今日」、前の日は「昨日」を添える。 */
export function formatDay(day, today = new Date()) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(year, month - 1, date);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = Math.round((base - target) / 86_400_000);
  const label = `${year}/${month}/${date}(${WEEKDAYS[target.getDay()]})`;
  if (daysAgo === 0) return `今日 ${label}`;
  if (daysAgo === 1) return `昨日 ${label}`;
  return daysAgo > 1 ? `${daysAgo}日前 ${label}` : label;
}

/** バイト数を、設定に出す短い表記にする。 */
export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

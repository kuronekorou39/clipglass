// 履歴とプリセットの絞り込み。表示用の純粋な関数だけを置く。

/** 絞り込める項目の種類と表示名。 */
export const KINDS = [
  ["text", "文字"],
  ["image", "画像"],
  ["files", "ファイル"],
];

function includes(haystack, needle) {
  return haystack.toLowerCase().includes(needle);
}

/** 履歴の項目が検索語に合うか。画像は文字を持たないので、検索語があるときは外れる。 */
export function matchesQuery(item, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (item.kind === "text") return includes(item.text, needle);
  if (item.kind === "files") return item.paths.some((path) => includes(path, needle));
  return false;
}

/** `kinds` に含まれる種類で、検索語に合う項目だけを返す。 */
export function filterItems(items, { query, kinds }) {
  return items.filter((item) => kinds.includes(item.kind) && matchesQuery(item, query));
}

/** プリセットの木を検索語で絞り込む。名前が合うフォルダーは中身ごと残す。 */
export function filterPresets(nodes, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    if (includes(node.name, needle)) return [node];
    if (node.children) {
      const children = filterPresets(node.children, query);
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    return includes(node.text, needle) ? [node] : [];
  });
}

/** プリセットのフォルダーの一覧。登録先の選択肢に使う。 */
export function folderPaths(nodes, prefix = []) {
  return nodes.flatMap((node) => {
    if (!node.children) return [];
    const path = [...prefix, node.name];
    return [path, ...folderPaths(node.children, path)];
  });
}

/** フォルダーの中のプリセットの数(入れ子を含む)。 */
export function countLeaves(nodes) {
  return nodes.reduce(
    (total, node) => total + (node.children ? countLeaves(node.children) : 1),
    0,
  );
}

/** 一覧に出す1行目。 */
export function firstLine(text) {
  const line = text.split(/\r?\n/).find((part) => part.trim() !== "") ?? "";
  return line.trim();
}

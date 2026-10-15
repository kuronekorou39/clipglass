import { richFormatLabels } from "../format.js";

/** 書式情報(HTML・RTF)を含むコピーにだけ表示する。 */
export function RichBadge({ formats }) {
  const labels = richFormatLabels(formats);
  if (labels.length === 0) return null;
  return (
    <span class="badge-rich" title="文字の色や太字などの書式情報も一緒にコピーされています">
      書式付き {labels.join("・")}
    </span>
  );
}

/** クリップボードが報告した形式名をそのまま並べる。 */
export function FormatList({ formats }) {
  return (
    <details class="format-list" onClick={(e) => e.stopPropagation()}>
      <summary>形式 {formats.length}件</summary>
      <ul>
        {formats.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </details>
  );
}

import { summarizeFormats } from "../format.js";

export function FormatBadges({ formats }) {
  const { badges, otherCount, rich } = summarizeFormats(formats);
  return (
    <span class="badges">
      {rich && <span class="badge badge-rich">書式付き</span>}
      {badges.map((label) => (
        <span class="badge" key={label}>
          {label}
        </span>
      ))}
      {otherCount > 0 && <span class="badge badge-other">その他 {otherCount}</span>}
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

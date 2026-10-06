import { FormatBadges, FormatList } from "./FormatBadges.jsx";

const MAX_FILE_NAMES = 5;

function fileName(path) {
  return path.split(/[\\/]/).pop();
}

export function StatusRow({ status }) {
  if (status.kind === "empty") {
    return <div class="status-row">クリップボードは空です</div>;
  }
  if (status.kind === "error") {
    return (
      <div class="status-row status-error">読み取りに失敗しました: {status.message}</div>
    );
  }

  const { names = [], formats } = status;
  return (
    <div class="status-row">
      {status.kind === "files" && (
        <div>
          <div>ファイル {names.length}件</div>
          <ul class="file-names">
            {names.slice(0, MAX_FILE_NAMES).map((path) => (
              <li key={path} title={path}>
                {fileName(path)}
              </li>
            ))}
            {names.length > MAX_FILE_NAMES && <li>ほか {names.length - MAX_FILE_NAMES}件</li>}
          </ul>
        </div>
      )}
      {status.kind === "unsupported" && <div>この内容はプレビューに対応していません</div>}
      {status.kind === "too_large" && <div>サイズが大きいため表示できません</div>}
      <div class="item-meta">
        <FormatBadges formats={formats} />
      </div>
      <FormatList formats={formats} />
    </div>
  );
}

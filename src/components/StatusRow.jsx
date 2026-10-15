import { FormatList } from "./FormatBadges.jsx";

const MESSAGES = {
  unsupported: "この内容はプレビューに対応していません",
  too_large: "サイズが大きいため表示できません",
};

export function StatusRow({ status }) {
  if (status.kind === "empty") {
    return <div class="status-row">クリップボードは空です</div>;
  }
  if (status.kind === "error") {
    return (
      <div class="status-row status-error">読み取りに失敗しました: {status.message}</div>
    );
  }
  return (
    <div class="status-row">
      <div>{MESSAGES[status.kind]}</div>
      <FormatList formats={status.formats} />
    </div>
  );
}

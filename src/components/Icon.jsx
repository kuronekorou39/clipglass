// ボタンや見出しに添える記号。文字の記号はフォントで形や太さが変わるので、線で描く。

const PATHS = {
  // 表示
  eye: "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z",
  // 履歴
  clock: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 1 0 8 1.8z M8 4.5V8l2.4 1.6",
  // 起動
  power: "M8 1.8v5.4 M4.6 4.2a5 5 0 1 0 6.8 0",
  // ウィンドウ
  window: "M2 3h12v10H2z M2 6h12",
  // 文字サイズ
  text: "M2.5 13l3.5-9 3.5 9 M3.8 10h4.4 M10.5 13l2-5 2 5 M11.1 11.6h2.8",
  // 折り返し
  wrap: "M2 4h12 M2 8h9.5a2 2 0 0 1 0 4H8 M9.5 10.2L7.8 12l1.7 1.8 M2 12h3",
  // 件数
  list: "M5.5 4h8.5 M5.5 8h8.5 M5.5 12h8.5 M2.2 4h.6 M2.2 8h.6 M2.2 12h.6",
  // 保存
  disk: "M2.5 2.5h9l2 2v9h-11z M5 2.5v3.5h5V2.5 M5 13.5V9.5h6v4",
  // キーボード
  keyboard: "M1.5 4h13v8h-13z M4 6.5h.5 M6.5 6.5h.5 M9 6.5h.5 M11.5 6.5h.5 M4.5 9.5h7",
  // フォルダーを開く
  folderOpen: "M1.8 12.5V3.5h4l1.5 1.5h5.4v2 M1.8 12.5l2-5.5h10.4l-2 5.5z",
  // 元に戻す
  undo: "M4.5 3L1.8 5.8l2.7 2.7 M2 5.8h7.5a4 4 0 0 1 0 8H6",
  // 大きさを戻す
  resize: "M9.5 2.5h4v4 M6.5 13.5h-4v-4 M13.5 2.5L9 7 M2.5 13.5L7 9",
  // 画面の隅へ(矢印の向きが隅)
  "top-left": "M12 12L4 4 M4 9.5V4h5.5",
  "top-right": "M4 12l8-8 M6.5 4H12v5.5",
  "bottom-left": "M12 4l-8 8 M4 6.5V12h5.5",
  "bottom-right": "M4 4l8 8 M12 6.5V12H6.5",
  // 使わない
  ban: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2z M3.8 3.8l8.4 8.4",
  // 追加
  plus: "M8 3v10 M3 8h10",
  // フォルダー
  folder: "M1.8 13V3.5h4.2l1.5 1.5h6.7v8z",
  // 保存する
  check: "M2.8 8.3l3.2 3.2 7.2-7.2",
  // 削除
  trash: "M2.5 4.5h11 M6 4.5V2.8h4v1.7 M3.8 4.5l.7 9h7l.7-9",
  // 上へ・下へ
  up: "M8 13V3 M4 7l4-4 4 4",
  down: "M8 3v10 M4 9l4 4 4-4",
};

/** `name` の記号を、文字と同じ色・高さで描く。 */
export function Icon({ name, size = 14 }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

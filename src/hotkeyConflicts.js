// ほかで使われていそうなショートカットの一覧。登録は止めず、注意として出すだけに使う。
// キーは保存の形(「Ctrl+Shift+V」。Win は Super)。

const KNOWN = {
  // Windows
  "Ctrl+Shift+Escape": "Windows のタスク マネージャー",
  "Ctrl+Escape": "Windows のスタート メニュー",
  "Alt+Tab": "Windows のウィンドウ切り替え",
  "Ctrl+Alt+Tab": "Windows のウィンドウ切り替え",
  "Alt+F4": "ウィンドウを閉じる",
  "Alt+Escape": "Windows のウィンドウ切り替え",
  "Alt+Space": "ウィンドウのメニュー、PowerToys Run",
  "Alt+Enter": "プロパティ、全画面の切り替え",
  "Alt+PrintScreen": "Windows のウィンドウのスクリーンショット",
  "Super+V": "Windows のクリップボード履歴",
  "Super+Shift+S": "Windows の画面の切り取り",
  "Super+Period": "Windows の絵文字パネル",
  "Super+Semicolon": "Windows の絵文字パネル",
  // ブラウザーやチャット
  "Ctrl+Shift+V": "書式なしで貼り付け(Chrome・Edge・Slack・Teams など)、ターミナルの貼り付け",
  "Ctrl+Shift+C": "開発者ツール(ブラウザー)、ターミナルのコピー",
  "Ctrl+Shift+I": "開発者ツール(ブラウザー)",
  "Ctrl+Shift+J": "コンソール(Chrome)",
  "Ctrl+Shift+N": "シークレット ウィンドウ(Chrome)、新しいフォルダー(エクスプローラー)",
  "Ctrl+Shift+T": "閉じたタブを開き直す(ブラウザー)",
  "Ctrl+Shift+B": "ブックマーク バー(ブラウザー)",
  "Ctrl+Shift+Delete": "閲覧データの削除(ブラウザー)",
  "Ctrl+Shift+Tab": "前のタブへ",
  "Ctrl+Tab": "次のタブへ",
  "Alt+ArrowLeft": "戻る(ブラウザー)",
  "Alt+ArrowRight": "進む(ブラウザー)",
  "Alt+Home": "ホーム(ブラウザー)",
  // エディター・Office
  "Ctrl+Shift+P": "コマンド パレット(VS Code)、プライベート ウィンドウ(Firefox)",
  "Ctrl+Shift+F": "全体を検索(VS Code)",
  "Ctrl+Shift+Z": "やり直し",
  "Ctrl+Backquote": "ターミナル(VS Code)",
  "Ctrl+Space": "入力候補(VS Code など)",
  "Ctrl+Shift+Space": "引数のヒント(VS Code)",
  "Alt+Shift+F": "コードの整形(VS Code)",
  "Alt+Shift+ArrowUp": "行の複製(VS Code)",
  "Alt+Shift+ArrowDown": "行の複製(VS Code)",
  "Alt+Shift+ArrowLeft": "選択範囲の縮小(VS Code)",
  "Alt+Shift+ArrowRight": "選択範囲の拡大(VS Code)",
  "Ctrl+Alt+V": "形式を選択して貼り付け(Excel・Word)",
};

/** 押したキーの組み合わせを、修飾キーの並びと残りのキーに分ける。 */
function split(hotkey) {
  const parts = hotkey.split("+");
  return { modifiers: parts.slice(0, -1), key: parts.at(-1) };
}

const isCharacterKey = (key) => /^([A-Z0-9]|Space|Backquote|Minus|Equal|Bracket\w+|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(key);

/** ほかで使われていそうな理由の一覧。なければ空。 */
export function hotkeyConflicts(hotkey) {
  if (!hotkey) return [];
  const reasons = [];
  if (KNOWN[hotkey]) reasons.push(KNOWN[hotkey]);
  const { modifiers, key } = split(hotkey);
  const only = (name) => modifiers.length === 1 && modifiers[0] === name;
  if (only("Shift") && isCharacterKey(key)) reasons.push("ふつうの文字の入力(大文字や記号)");
  if (only("Ctrl") && /^[A-Z0-9]$/.test(key)) reasons.push("多くのアプリの基本操作(Ctrl+C のコピーなど)");
  if (only("Alt") && /^[A-Z0-9]$/.test(key)) reasons.push("アプリのメニューを開く操作(Alt+F など)");
  if (modifiers.includes("Super") && !KNOWN[hotkey]) reasons.push("Windows のショートカット(Win を使う組み合わせの多くは予約済み)");
  return reasons;
}

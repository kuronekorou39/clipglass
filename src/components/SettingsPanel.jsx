import { useEffect, useState } from "preact/hooks";
import { formatBytes } from "../format.js";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, parseArchiveDays, parseHistoryLimit } from "../settings.js";
import { THEMES } from "../themes.js";
import { DEFAULT_QUICK_KEYS, QUICK_KEY_MODES, quickKeyPrefix } from "../quickKeys.js";
import { HotkeyRecorder } from "./HotkeyRecorder.jsx";
import { Icon } from "./Icon.jsx";

const TABS = [
  ["view", "表示", "eye"],
  ["history", "履歴", "clock"],
  ["startup", "起動", "power"],
  ["window", "ウィンドウ", "window"],
  ["about", "情報", "info"],
];

/** 使い方のうち、修飾キー+数字の行。頭に今の組み合わせを付けて見せる。 */
const QUICK_KEYS_ROW = "1 〜 9";

/** 「情報」に載せる使い方。まとまりごとに、左が操作、右がその結果。 */
const HELP = [
  [
    "貼り付ける",
    [
      ["行をクリック", "カーソル位置に貼り付ける"],
      [QUICK_KEYS_ROW, "その番号の行を貼り付ける"],
      ["行を右クリック", "お気に入り・プリセットに追加、削除"],
    ],
  ],
  [
    "プリセットとお気に入り",
    [
      ["ボタンにマウスを乗せる", "横に開く"],
      ["ボタンをクリック", "開いたままにする"],
      ["フォルダーにマウスを乗せる", "中を開く"],
    ],
  ],
  [
    "キー操作(バーの空いた場所をクリックしてから)",
    [
      ["Ctrl + F", "検索と絞り込み"],
      ["Ctrl + + / - / 0", "文字サイズ"],
      ["Ctrl + Shift + 矢印", "ウィンドウを動かす"],
      ["Ctrl + Shift + Alt + 矢印", "大きさを変える"],
      ["Esc", "開いているものを閉じる"],
    ],
  ],
];

/** 画面での並びどおり(左上・右上・左下・右下)に 2 × 2 で置く。 */
const CORNERS = [
  ["top-left", "左上"],
  ["top-right", "右上"],
  ["bottom-left", "左下"],
  ["bottom-right", "右下"],
];

/** 関係する項目のまとまり。 */
function Group({ title, children }) {
  return (
    <section class="setting-group">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

/** 項目の見出し。頭に記号を付ける。 */
function Label({ icon, title, children }) {
  return (
    <span class="setting-label" title={title}>
      <Icon name={icon} />
      {children}
    </span>
  );
}

/** オンとオフの切り替え。見出しを左、つまみを右に置く。 */
function Toggle({ icon, checked, onChange, title, children }) {
  return (
    <button
      type="button"
      class="setting-row toggle"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <Label icon={icon}>{children}</Label>
      <span class={`switch${checked ? " on" : ""}`} aria-hidden="true">
        <span class="switch-knob" />
      </span>
    </button>
  );
}

function ViewTab({ settings, onFontSizeStep, onWrapChange, onThemeChange }) {
  return (
    <>
      <Group title="色合い">
        <div class="theme-grid" role="group" aria-label="色合い">
          {THEMES.map(([id, label]) => (
            // 見本は、その色合いの色で描く
            <button
              key={id}
              type="button"
              class="theme-swatch"
              data-theme={id}
              aria-pressed={settings.theme === id}
              onClick={() => onThemeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="文字">
        <div class="setting-row">
          <Label icon="text" title="Ctrl と +/-/0、Ctrl とホイールでも変えられます">
            文字サイズ
          </Label>
          <div class="stepper">
            <button
              class="row-btn"
              aria-label="文字を小さく"
              disabled={settings.fontSize <= FONT_SIZE_MIN}
              onClick={() => onFontSizeStep(-1)}
            >
              −
            </button>
            <span class="stepper-value">{settings.fontSize}px</span>
            <button
              class="row-btn"
              aria-label="文字を大きく"
              disabled={settings.fontSize >= FONT_SIZE_MAX}
              onClick={() => onFontSizeStep(1)}
            >
              ＋
            </button>
          </div>
        </div>
        <Toggle icon="wrap" checked={settings.wrap} onChange={onWrapChange}>
          長い文を折り返す
        </Toggle>
      </Group>
    </>
  );
}

function HistoryTab({ config, settings, onApply, onOpenDataDir, onPasteChange }) {
  const [maxItems, setMaxItems] = useState(config.historyMaxItems);
  const [archiveDays, setArchiveDays] = useState(config.archiveDays);
  const [archiveMaxMb, setArchiveMaxMb] = useState(config.archiveMaxMb);
  useEffect(() => {
    setMaxItems(config.historyMaxItems);
    setArchiveDays(config.archiveDays);
    setArchiveMaxMb(config.archiveMaxMb);
  }, [config]);

  // 範囲に収めるのは Rust 側。ここでは数として読めるかだけを見る
  const commitArchive = () => {
    const days = parseArchiveDays(archiveDays, config.archiveDaysLimit);
    const maxMb = parseInt(archiveMaxMb, 10);
    if (days === null || Number.isNaN(maxMb)) {
      setArchiveDays(config.archiveDays);
      setArchiveMaxMb(config.archiveMaxMb);
      return;
    }
    // 30.9 のように入れても、実際に使う値を欄に見せる
    setArchiveDays(days);
    setArchiveMaxMb(maxMb);
    if (days !== config.archiveDays || maxMb !== config.archiveMaxMb) {
      onApply("set_archive", { days, maxMb });
    }
  };
  const blurOnEnter = (e) => e.key === "Enter" && e.target.blur();

  const commitMaxItems = () => {
    const value = parseHistoryLimit(maxItems, config.historyMaxItemsLimit);
    if (value === null) {
      setMaxItems(config.historyMaxItems);
      return;
    }
    setMaxItems(value);
    if (value !== config.historyMaxItems) onApply("set_history_limit", { maxItems: value });
  };

  return (
    <>
      <Group title="貼り付け">
        <Toggle
          icon="paste"
          checked={settings.pasteOnSelect}
          onChange={onPasteChange}
          title="一覧・プリセット・お気に入りから選ぶと、直前に使っていたアプリのカーソル位置へ貼り付けます。オフならコピーだけ"
        >
          選んだら貼り付ける
        </Toggle>
      </Group>
      <Group title="一覧">
        <label class="setting-row">
          <Label icon="list" title="一覧に残す件数。超えた分は「過去の履歴」に移ります">
            件数
          </Label>
          <input
            type="number"
            min={1}
            max={config.historyMaxItemsLimit}
            value={maxItems}
            onInput={(e) => setMaxItems(e.target.value)}
            onBlur={commitMaxItems}
            onKeyDown={blurOnEnter}
          />
        </label>
        <Toggle
          icon="disk"
          checked={config.historyPersist}
          onChange={(persist) => onApply("set_history_persist", { persist })}
          title="オフにすると、保存してある履歴と過去の履歴をディスクから消します"
        >
          次回の起動でも残す
        </Toggle>
      </Group>
      <Group title="過去の履歴">
        <div class="setting-row">
          <Label
            icon="archive"
            title="件数を超えて一覧から外れた項目を、この日数だけ残します。0 なら残しません。全体が上限の大きさを超えたら、古い日から消します"
          >
            残す範囲
          </Label>
          <span class="inline-fields">
            <input
              type="number"
              min={0}
              max={config.archiveDaysLimit}
              value={archiveDays}
              aria-label="過去の履歴を残す日数"
              disabled={!config.historyPersist}
              onInput={(e) => setArchiveDays(e.target.value)}
              onBlur={commitArchive}
              onKeyDown={blurOnEnter}
            />
            日 /
            <input
              type="number"
              min={1}
              value={archiveMaxMb}
              aria-label="過去の履歴の大きさの上限(MB)"
              disabled={!config.historyPersist}
              onInput={(e) => setArchiveMaxMb(e.target.value)}
              onBlur={commitArchive}
              onKeyDown={blurOnEnter}
            />
            MB まで
          </span>
        </div>
        <div class="setting-note">
          {config.historyPersist && config.archiveDays > 0
            ? `いま ${formatBytes(config.archiveBytes)} を保管中`
            : "過去の履歴は残しません"}
        </div>
      </Group>
      <Group title="データ">
        <button class="row-btn with-icon align-start" title={config.dataDir} onClick={onOpenDataDir}>
          <Icon name="folderOpen" />
          データフォルダーを開く
        </button>
      </Group>
    </>
  );
}

function StartupTab({ config, onApply, onSuspendHotkey }) {
  const quickKeys = config.quickKeys ?? DEFAULT_QUICK_KEYS;
  return (
    <>
      <Group title="出す/隠すショートカット">
        <HotkeyRecorder
          hotkey={config.hotkey}
          onChange={(hotkey) => onApply("set_hotkey", { hotkey })}
          onSuspend={onSuspendHotkey}
        />
      </Group>
      <Group title="数字で貼り付け">
        <label class="setting-row">
          <Label icon="keyboard" title="一覧の上から9件を、行の頭の番号で貼り付けます">
            組み合わせ
          </Label>
          <select
            aria-label="数字で貼り付ける組み合わせ"
            value={quickKeys}
            onChange={(e) => onApply("set_quick_keys", { mode: e.target.value })}
          >
            {QUICK_KEY_MODES.map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div class="setting-note">
          {quickKeys === "off"
            ? "行の頭の番号も出しません"
            : "ウィンドウを出している間は、ほかのアプリの同じキー操作より優先されます"}
        </div>
      </Group>
      <Group title="起動">
        <Toggle
          icon="power"
          checked={config.autostart}
          onChange={(enabled) => onApply("set_autostart", { enabled })}
          title="サインインしたときに起動し、通知領域に置きます"
        >
          Windows と一緒に起動
        </Toggle>
      </Group>
    </>
  );
}

function WindowTab({ onSnap, onResetSize }) {
  return (
    <>
      <Group title="画面の隅へ">
        <div class="corner-grid">
          {CORNERS.map(([corner, label]) => (
            <button key={corner} class={`row-btn with-icon ${corner}`} onClick={() => onSnap(corner)}>
              <Icon name={corner} />
              {label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="大きさ">
        <button class="row-btn with-icon align-start" onClick={onResetSize}>
          <Icon name="resize" />
          標準の大きさに戻す
        </button>
      </Group>
    </>
  );
}

function AboutTab({ config }) {
  const quickPrefix = quickKeyPrefix(config.quickKeys);
  return (
    <>
      <div class="about-version">
        Clipglass
        <span>バージョン {config.version}</span>
      </div>
      {HELP.map(([title, rows]) => (
        <Group key={title} title={title}>
          <dl class="help-list">
            {rows.flatMap(([keys, description]) => {
              // 数字の行は、選んでいる組み合わせで見せる。使わない設定なら載せない
              if (keys === QUICK_KEYS_ROW && quickPrefix === null) return [];
              const shown = keys === QUICK_KEYS_ROW ? `${quickPrefix}${keys}` : keys;
              return [<dt key={`key-${keys}`}>{shown}</dt>, <dd key={`desc-${keys}`}>{description}</dd>];
            })}
          </dl>
        </Group>
      ))}
    </>
  );
}

/** 設定。本体の横の別ウィンドウ(Panel.jsx)に出す。項目が多いので、タブで分けて説明はツールチップに回す。 */
export function SettingsPanel({
  config,
  settings,
  onFontSizeStep,
  onWrapChange,
  onThemeChange,
  onPasteChange,
  onClose,
  onApply,
  onSuspendHotkey,
  onOpenDataDir,
  onSnap,
  onResetSize,
}) {
  const [tab, setTab] = useState("view");

  return (
      <div class="panel" role="dialog" aria-label="設定">
        <div class="panel-title">
          設定
          <button class="titlebar-btn" title="閉じる" aria-label="閉じる" onClick={onClose}>
            {"✕"}
          </button>
        </div>
        <div class="panel-tabs" role="tablist">
          {TABS.map(([id, label, icon]) => (
            <button
              key={id}
              role="tab"
              class={tab === id ? "active" : ""}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </div>
        <div class="panel-body" role="tabpanel">
          {tab === "view" && (
            <ViewTab
              settings={settings}
              onFontSizeStep={onFontSizeStep}
              onWrapChange={onWrapChange}
              onThemeChange={onThemeChange}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              config={config}
              settings={settings}
              onApply={onApply}
              onOpenDataDir={onOpenDataDir}
              onPasteChange={onPasteChange}
            />
          )}
          {tab === "startup" && (
            <StartupTab config={config} onApply={onApply} onSuspendHotkey={onSuspendHotkey} />
          )}
          {tab === "window" && <WindowTab onSnap={onSnap} onResetSize={onResetSize} />}
          {tab === "about" && <AboutTab config={config} />}
        </div>
      </div>
  );
}

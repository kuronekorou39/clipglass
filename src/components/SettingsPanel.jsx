import { useEffect, useState } from "preact/hooks";
import { formatBytes } from "../format.js";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, parseArchiveDays, parseHistoryLimit } from "../settings.js";
import { THEMES } from "../themes.js";
import { HotkeyRecorder } from "./HotkeyRecorder.jsx";
import { Icon } from "./Icon.jsx";

const TABS = [
  ["view", "表示", "eye"],
  ["history", "履歴", "clock"],
  ["startup", "起動", "power"],
  ["window", "ウィンドウ", "window"],
  ["about", "情報", "info"],
];

/** 「情報」に載せる使い方。左が操作、右がその結果。 */
const HELP = [
  ["行をクリック", "その内容をコピーし、直前に使っていたアプリのカーソル位置へ貼り付ける(「履歴」で切り替え)"],
  ["行を右クリック", "お気に入りに追加、プリセットに追加、履歴から削除"],
  ["1 〜 9", "一覧の上から数えてその番号の行を選ぶ(行の頭の数字。検索欄に入力中は使えない)"],
  ["Ctrl + F", "検索と絞り込み。「過去の履歴」を開いていれば、そこからも探す"],
  ["Ctrl + + / - / 0", "文字サイズを変える・戻す(Ctrl + ホイールでも)"],
  ["Ctrl + Shift + 矢印", "ウィンドウを動かす"],
  ["Ctrl + Shift + Alt + 矢印", "ウィンドウの大きさを変える(下の両角のつまみでも)"],
  ["Esc", "開いているパネルやメニューを閉じる"],
];

/** 「情報」から開けるページ。開く先は Rust 側が名前で決める。 */
const LINKS = [
  ["repo", "GitHub"],
  ["releases", "更新を確認"],
  ["site", "作者のサイト"],
];

/** 画面での並びどおり(左上・右上・左下・右下)に 2 × 2 で置く。 */
const CORNERS = [
  ["top-left", "左上"],
  ["top-right", "右上"],
  ["bottom-left", "左下"],
  ["bottom-right", "右下"],
];

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
      <div class="field">
        <Label icon="palette">色合い</Label>
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
      </div>
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
      <Toggle
        icon="paste"
        checked={settings.pasteOnSelect}
        onChange={onPasteChange}
        title="一覧・プリセット・お気に入りから選ぶと、直前に使っていたアプリのカーソル位置へ貼り付けます。オフならコピーだけ"
      >
        選んだら貼り付ける
      </Toggle>
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
      <div class="setting-row">
        <Label
          icon="archive"
          title="件数を超えて一覧から外れた項目を、この日数だけ残します。0 なら残しません。全体が上限の大きさを超えたら、古い日から消します"
        >
          過去の履歴
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
      <button class="row-btn with-icon align-start" title={config.dataDir} onClick={onOpenDataDir}>
        <Icon name="folderOpen" />
        データフォルダーを開く
      </button>
    </>
  );
}

function StartupTab({ config, onApply, onSuspendHotkey }) {
  return (
    <>
      <div class="field">
        <Label icon="keyboard" title="枠をクリックして、使いたいキーを押します">
          出す/隠すショートカット
        </Label>
        <HotkeyRecorder
          hotkey={config.hotkey}
          onChange={(hotkey) => onApply("set_hotkey", { hotkey })}
          onSuspend={onSuspendHotkey}
        />
      </div>
      <Toggle
        icon="power"
        checked={config.autostart}
        onChange={(enabled) => onApply("set_autostart", { enabled })}
        title="サインインしたときに起動し、通知領域に置きます"
      >
        Windows と一緒に起動
      </Toggle>
    </>
  );
}

function WindowTab({ onSnap, onResetSize }) {
  return (
    <>
      <div class="field">
        <Label icon="window" title="Ctrl+Shift+矢印で移動、Ctrl+Shift+Alt+矢印で大きさを変えられます">
          画面の隅へ
        </Label>
        <div class="corner-grid">
          {CORNERS.map(([corner, label]) => (
            <button key={corner} class={`row-btn with-icon ${corner}`} onClick={() => onSnap(corner)}>
              <Icon name={corner} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <button class="row-btn with-icon align-start" onClick={onResetSize}>
        <Icon name="resize" />
        標準の大きさに戻す
      </button>
    </>
  );
}

function AboutTab({ config, onOpenLink }) {
  return (
    <>
      <div class="about-version">
        Clipglass
        <span>バージョン {config.version}</span>
      </div>
      <dl class="help-list">
        {HELP.flatMap(([keys, description]) => [
          <dt key={`key-${keys}`}>{keys}</dt>,
          <dd key={`desc-${keys}`}>{description}</dd>,
        ])}
      </dl>
      <div class="link-row">
        {LINKS.map(([target, label]) => (
          <button key={target} class="row-btn with-icon" onClick={() => onOpenLink(target)}>
            <Icon name="external" size={12} />
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

/** 設定。項目が多いので、タブで分けて説明はツールチップに回す。 */
export function SettingsPanel({
  closing,
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
  onOpenLink,
  onSnap,
  onResetSize,
}) {
  const [tab, setTab] = useState("view");

  return (
    <div class={`overlay${closing ? " closing" : ""}`} inert={closing} onClick={onClose}>
      <div class="panel" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
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
          {tab === "about" && <AboutTab config={config} onOpenLink={onOpenLink} />}
        </div>
      </div>
    </div>
  );
}

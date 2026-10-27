import { useEffect, useState } from "preact/hooks";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, parseHistoryLimit } from "../settings.js";
import { HotkeyRecorder } from "./HotkeyRecorder.jsx";
import { Icon } from "./Icon.jsx";

const TABS = [
  ["view", "表示", "eye"],
  ["history", "履歴", "clock"],
  ["startup", "起動", "power"],
  ["window", "ウィンドウ", "window"],
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

function ViewTab({ settings, onFontSizeStep, onWrapChange }) {
  return (
    <>
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

function HistoryTab({ config, onApply, onOpenDataDir }) {
  const [maxItems, setMaxItems] = useState(config.historyMaxItems);
  useEffect(() => setMaxItems(config.historyMaxItems), [config]);

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
      <label class="setting-row">
        <Label icon="list" title="固定した項目は数えません">
          件数
        </Label>
        <input
          type="number"
          min={1}
          max={config.historyMaxItemsLimit}
          value={maxItems}
          onInput={(e) => setMaxItems(e.target.value)}
          onBlur={commitMaxItems}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        />
      </label>
      <Toggle
        icon="disk"
        checked={config.historyPersist}
        onChange={(persist) => onApply("set_history_persist", { persist })}
        title="固定した項目は、この設定に関わらず保存します"
      >
        次回の起動でも残す
      </Toggle>
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

/** 設定。項目が多いので、タブで分けて説明はツールチップに回す。 */
export function SettingsPanel({
  closing,
  config,
  settings,
  onFontSizeStep,
  onWrapChange,
  onClose,
  onApply,
  onSuspendHotkey,
  onOpenDataDir,
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
            />
          )}
          {tab === "history" && (
            <HistoryTab config={config} onApply={onApply} onOpenDataDir={onOpenDataDir} />
          )}
          {tab === "startup" && (
            <StartupTab config={config} onApply={onApply} onSuspendHotkey={onSuspendHotkey} />
          )}
          {tab === "window" && <WindowTab onSnap={onSnap} onResetSize={onResetSize} />}
        </div>
      </div>
    </div>
  );
}

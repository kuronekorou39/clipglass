import { useEffect, useState } from "preact/hooks";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TRANSPARENCY_MODES,
  parseHistoryLimit,
} from "../settings.js";

const TABS = [
  ["view", "表示"],
  ["history", "履歴"],
  ["startup", "起動"],
  ["window", "ウィンドウ"],
];

/** 画面での並びどおり(左上・右上・左下・右下)に 2 × 2 で置く。 */
const CORNERS = [
  ["top-left", "左上"],
  ["top-right", "右上"],
  ["bottom-left", "左下"],
  ["bottom-right", "右下"],
];

function Check({ checked, onChange, title, children }) {
  return (
    <label class="field-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function ViewTab({ settings, onTransparencyChange, onFontSizeStep, onWrapChange }) {
  return (
    <>
      <div class="field">
        <span title="濃さはタイトルバーのつまみで変えます">透過</span>
        <div class="segmented">
          {TRANSPARENCY_MODES.map(([mode, label]) => (
            <button
              key={mode}
              class={settings.transparency === mode ? "active" : ""}
              aria-pressed={settings.transparency === mode}
              onClick={() => onTransparencyChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <span title="Ctrl と +/-/0、Ctrl とホイールでも変えられます">文字サイズ</span>
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
      <Check checked={settings.wrap} onChange={onWrapChange}>
        長い文を折り返す
      </Check>
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
      <label class="field-inline" title="固定した項目は数えません">
        <span>件数</span>
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
      <Check
        checked={config.historyPersist}
        onChange={(persist) => onApply("set_history_persist", { persist })}
        title="固定した項目は、この設定に関わらず保存します"
      >
        次回の起動でも残す
      </Check>
      <button class="row-btn align-start" title={config.dataDir} onClick={onOpenDataDir}>
        データフォルダーを開く
      </button>
    </>
  );
}

function StartupTab({ config, onApply }) {
  const [hotkey, setHotkey] = useState(config.hotkey);
  useEffect(() => setHotkey(config.hotkey), [config]);
  const commitHotkey = () => {
    if (hotkey.trim() !== config.hotkey) onApply("set_hotkey", { hotkey });
  };

  return (
    <>
      <label class="field" title="空にすると使いません">
        <span>出す/隠すショートカット</span>
        <div class="field-row">
          <input
            type="text"
            value={hotkey}
            placeholder="例: Ctrl+Shift+V"
            spellcheck={false}
            onInput={(e) => setHotkey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitHotkey()}
          />
          <button class="row-btn" onClick={commitHotkey}>
            適用
          </button>
        </div>
      </label>
      <Check
        checked={config.autostart}
        onChange={(enabled) => onApply("set_autostart", { enabled })}
      >
        Windows と一緒に起動
      </Check>
    </>
  );
}

function WindowTab({ onSnap, onResetSize }) {
  return (
    <>
      <div class="field">
        <span title="Ctrl+Shift+矢印で移動、Ctrl+Shift+Alt+矢印で大きさを変えられます">
          画面の隅へ
        </span>
        <div class="corner-grid">
          {CORNERS.map(([corner, label]) => (
            <button key={corner} class="row-btn" onClick={() => onSnap(corner)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <button class="row-btn align-start" onClick={onResetSize}>
        標準の大きさに戻す
      </button>
    </>
  );
}

/** 設定。項目が多いので、タブで分けて説明はツールチップに回す。 */
export function SettingsPanel({
  config,
  settings,
  onTransparencyChange,
  onFontSizeStep,
  onWrapChange,
  onClose,
  onApply,
  onOpenDataDir,
  onSnap,
  onResetSize,
}) {
  const [tab, setTab] = useState("view");

  return (
    <div class="overlay" onClick={onClose}>
      <div class="panel" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div class="panel-title">
          設定
          <button class="titlebar-btn" title="閉じる" aria-label="閉じる" onClick={onClose}>
            {"✕"}
          </button>
        </div>
        <div class="panel-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              class={tab === id ? "active" : ""}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="panel-body" role="tabpanel">
          {tab === "view" && (
            <ViewTab
              settings={settings}
              onTransparencyChange={onTransparencyChange}
              onFontSizeStep={onFontSizeStep}
              onWrapChange={onWrapChange}
            />
          )}
          {tab === "history" && (
            <HistoryTab config={config} onApply={onApply} onOpenDataDir={onOpenDataDir} />
          )}
          {tab === "startup" && <StartupTab config={config} onApply={onApply} />}
          {tab === "window" && <WindowTab onSnap={onSnap} onResetSize={onResetSize} />}
        </div>
      </div>
    </div>
  );
}

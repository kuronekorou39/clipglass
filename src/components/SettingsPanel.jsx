import { useEffect, useState } from "preact/hooks";
import { parseHistoryLimit } from "../settings.js";

/** 履歴の件数、ディスク保存、ショートカット、自動起動などRust側が持つ設定。 */
export function SettingsPanel({ config, onClose, onApply, onOpenPresets, onOpenDataDir }) {
  const [maxItems, setMaxItems] = useState(config.historyMaxItems);
  const [hotkey, setHotkey] = useState(config.hotkey);

  useEffect(() => {
    setMaxItems(config.historyMaxItems);
    setHotkey(config.hotkey);
  }, [config]);

  const commitMaxItems = () => {
    const value = parseHistoryLimit(maxItems, config.historyMaxItemsLimit);
    if (value === null) {
      setMaxItems(config.historyMaxItems);
      return;
    }
    setMaxItems(value);
    if (value !== config.historyMaxItems) onApply("set_history_limit", { maxItems: value });
  };

  const commitHotkey = () => {
    if (hotkey.trim() !== config.hotkey) onApply("set_hotkey", { hotkey });
  };

  return (
    <div class="overlay" onClick={onClose}>
      <div class="panel" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div class="panel-title">
          設定
          <button class="titlebar-btn" title="閉じる" aria-label="閉じる" onClick={onClose}>
            {"✕"}
          </button>
        </div>

        <label class="field">
          <span>履歴の件数(固定した項目は数えません)</span>
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

        <label class="field-check">
          <input
            type="checkbox"
            checked={config.historyPersist}
            onChange={(e) => onApply("set_history_persist", { persist: e.target.checked })}
          />
          <span>履歴をディスクに保存し、次回の起動で復元する</span>
        </label>
        <p class="hint">固定した項目はこの設定に関わらず保存します。保存先はこのPCのデータフォルダーです。</p>

        <label class="field">
          <span>ウィンドウを出す/隠すショートカット(空で無効)</span>
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

        <label class="field-check">
          <input
            type="checkbox"
            checked={config.autostart}
            onChange={(e) => onApply("set_autostart", { enabled: e.target.checked })}
          />
          <span>Windows にサインインしたときに自動で起動する</span>
        </label>

        <div class="field">
          <span>プリセット</span>
          <div class="field-row">
            <button class="row-btn" onClick={onOpenPresets}>
              ファイルを開く
            </button>
            <button class="row-btn" onClick={onOpenDataDir}>
              データフォルダーを開く
            </button>
          </div>
          <p class="hint">
            プリセットは presets.yaml に「名前: 文字」で書きます。入れ子にするとフォルダーになります。
          </p>
        </div>

        <p class="hint data-dir" title={config.dataDir}>
          {config.dataDir}
        </p>
      </div>
    </div>
  );
}

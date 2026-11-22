import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSettings, saveSettings, stepFontSize } from "../settings.js";
import { applyAppearance } from "../appearance.js";
import { usePresence } from "../presence.js";
import { filterPresets } from "../search.js";
import { PresetPopover } from "./PresetPopover.jsx";
import { FavoritesPopover } from "./FavoritesPopover.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";

/** 中身が変わった(閉じたときは null)ことを Rust から受け取るイベント。 */
const PANEL_EVENT = "panel";
const TOAST_DURATION_MS = 2500;

/**
 * 本体の横に出す別ウィンドウ。プリセット・お気に入り・設定を出し、本体の一覧には重ねない。
 * 閉じても破棄せず隠すだけなので、中身(`kind`)は Rust からのイベントで切り替える。
 * 設定は本体と同じ localStorage を読み、本体で変えたら storage イベントで追い付く。
 */
export function Panel() {
  const [kind, setKind] = useState(null);
  const [settings, setSettings] = useState(() => loadSettings(localStorage));
  const [presets, setPresets] = useState([]);
  const [presetsError, setPresetsError] = useState(null);
  const [presetQuery, setPresetQuery] = useState("");
  const [favorites, setFavorites] = useState([]);
  const [config, setConfig] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  // 閉じるときは中身を残してふわっと消す(ウィンドウは Rust がそのあと隠す)
  const presence = usePresence(kind !== null);
  const lastKind = useRef(null);
  if (kind) lastKind.current = kind;
  const shown = presence.mounted ? lastKind.current : null;

  const showToast = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  const close = useCallback(() => invoke("close_panel"), []);

  /** コマンドを呼び、失敗は通知にする。戻り値も使えるよう `{ ok, value }` で返す。 */
  const call = useCallback(async (command, args, successMessage) => {
    try {
      const value = await invoke(command, args);
      if (successMessage) showToast(successMessage);
      return { ok: true, value };
    } catch (error) {
      showToast(String(error), true);
      return { ok: false };
    }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      setPresets(await invoke("get_presets"));
      setPresetsError(null);
    } catch (error) {
      setPresetsError(String(error));
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(await invoke("get_favorites"));
    } catch (error) {
      showToast(String(error), true);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await invoke("get_config"));
    } catch (error) {
      showToast(String(error), true);
    }
  }, []);

  /** 設定を変えて保存する。本体は storage イベントで追い付く。 */
  const updateSettings = (patch) => {
    const next = { ...loadSettings(localStorage), ...patch };
    saveSettings(localStorage, next);
    setSettings(next);
  };

  /** Rust 側の設定を変え、失敗は通知にして、表示と本体を最新に合わせる。 */
  const applyConfig = async (command, args) => {
    await call(command, args);
    await loadConfig();
    invoke("notify_config_changed");
  };

  useEffect(() => {
    const unlisten = listen(PANEL_EVENT, (event) => setKind(event.payload));
    invoke("get_panel").then(setKind);
    const onStorage = () => setSettings(loadSettings(localStorage));
    window.addEventListener("storage", onStorage);
    return () => {
      unlisten.then((stop) => stop());
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => applyAppearance(settings), [settings]);

  // 検索欄はふだん隠れているので、前回の検索語で一覧が絞られたままにしない
  useEffect(() => {
    if (kind) setPresetQuery("");
  }, [kind]);

  useEffect(() => {
    document.documentElement.classList.toggle("panel-closing", presence.closing);
  }, [presence.closing]);

  // プリセットはファイルを直接編集できるので、開くたびと、マウスが戻ってくるたびに読み直す
  // (このウィンドウはクリックでフォーカスを取らないので、focus だけでは気づけない)
  useEffect(() => {
    if (kind === "presets") {
      const root = document.documentElement;
      loadPresets();
      window.addEventListener("focus", loadPresets);
      root.addEventListener("mouseenter", loadPresets);
      return () => {
        window.removeEventListener("focus", loadPresets);
        root.removeEventListener("mouseenter", loadPresets);
      };
    }
    if (kind === "favorites") loadFavorites();
    if (kind === "settings") loadConfig();
    return undefined;
  }, [kind]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * 選んだ内容をコピーする(設定によっては貼り付ける)。続けて選べるよう、開いたままにする。
   * コピーした内容は本体の一覧の先頭に来るので、成功の通知は出さない。
   */
  const pick = (command, args) => call(command, { ...args, paste: loadSettings(localStorage).pasteOnSelect });

  return (
    <>
      {shown === "presets" && (
        <PresetPopover
          presets={presets}
          visiblePresets={filterPresets(presets, presetQuery)}
          error={presetsError}
          query={presetQuery}
          onQueryChange={setPresetQuery}
          onCopy={(path) => pick("copy_preset", { path })}
          call={call}
          onReload={loadPresets}
          onRevealFile={() => call("reveal_presets_file")}
        />
      )}
      {shown === "favorites" && (
        <FavoritesPopover
          favorites={favorites}
          onCopy={(text) => pick("copy_favorite", { text })}
          onRemove={async (text) => {
            await call("remove_favorite", { text });
            loadFavorites();
          }}
          onAdd={async (text) => {
            const result = await call("add_favorite", { text });
            if (result.ok) loadFavorites();
            return result.ok;
          }}
        />
      )}
      {shown === "settings" && config && (
        <SettingsPanel
          config={config}
          settings={settings}
          onFontSizeStep={(steps) =>
            updateSettings({ fontSize: stepFontSize(loadSettings(localStorage).fontSize, steps) })
          }
          onWrapChange={(wrap) => updateSettings({ wrap })}
          onThemeChange={(theme) => updateSettings({ theme })}
          onPasteChange={(pasteOnSelect) => updateSettings({ pasteOnSelect })}
          onClose={close}
          onApply={applyConfig}
          onSuspendHotkey={(suspended) => call("suspend_hotkey", { suspended })}
          onOpenDataDir={() => call("open_data_dir")}
          onSnap={(corner) => call("snap_window", { corner })}
          onResetSize={() => call("reset_window_size")}
        />
      )}
      {toast && <div class={`toast${toast.isError ? " toast-error" : ""}`}>{toast.message}</div>}
    </>
  );
}

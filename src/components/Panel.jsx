import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSettings } from "../settings.js";
import { applyAppearance } from "../appearance.js";
import { filterPresets } from "../search.js";
import { PresetPopover } from "./PresetPopover.jsx";
import { FavoritesPopover } from "./FavoritesPopover.jsx";

/** 中身が変わった(閉じたときは null)ことを Rust から受け取るイベント。 */
const PANEL_EVENT = "panel";
const TOAST_DURATION_MS = 2500;

/**
 * 本体の横に出す別ウィンドウ。プリセットかお気に入りを出し、本体の一覧には重ねない。
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
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

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

  // プリセットはファイルを直接編集できるので、開くたびと、ウィンドウに戻るたびに読み直す
  useEffect(() => {
    if (kind === "presets") {
      loadPresets();
      window.addEventListener("focus", loadPresets);
      return () => window.removeEventListener("focus", loadPresets);
    }
    if (kind === "favorites") loadFavorites();
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
   * 選んだ内容をコピーし(設定によっては貼り付けて)閉じる。コピーした内容は本体の一覧の先頭に
   * 来るので、成功の通知は出さない。失敗したときは閉じずに知らせる。
   */
  const pick = async (command, args) => {
    const result = await call(command, { ...args, paste: loadSettings(localStorage).pasteOnSelect });
    if (result.ok) close();
  };

  return (
    <>
      {kind === "presets" && (
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
      {kind === "favorites" && (
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
      {toast && <div class={`toast${toast.isError ? " toast-error" : ""}`}>{toast.message}</div>}
    </>
  );
}

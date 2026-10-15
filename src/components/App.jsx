import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { flushSync } from "preact/compat";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, stepFontSize } from "../settings.js";
import { Titlebar } from "./Titlebar.jsx";
import { StatusRow } from "./StatusRow.jsx";
import { HistoryItem } from "./HistoryItem.jsx";

const STATE_EVENT = "clipboard-state";
const TOAST_DURATION_MS = 2500;
const EMPTY_STATE = { paused: false, status: null, currentId: null, items: [] };

export function App() {
  const [settings, setSettings] = useState(() => loadSettings(localStorage));
  const [clipboard, setClipboard] = useState(EMPTY_STATE);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(localStorage, next);
      return next;
    });
  }, []);

  const showToast = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  // 保存済みの設定を適用してからウィンドウを表示する
  useEffect(() => {
    (async () => {
      try {
        await invoke("set_window_opacity", { opacity: settings.opacity / 100 });
        await invoke("set_pinned", { pinned: settings.pinned });
      } finally {
        await invoke("show_window");
      }
    })();
  }, []);

  useEffect(() => {
    // 行の差し込みと並べ替えをアニメーションさせる
    const applyAnimated = (next) => {
      if (!document.startViewTransition) {
        setClipboard(next);
        return;
      }
      document.startViewTransition(() => flushSync(() => setClipboard(next)));
    };
    const unlisten = listen(STATE_EVENT, (event) => applyAnimated(event.payload));
    invoke("get_state").then(setClipboard);
    return () => unlisten.then((stop) => stop());
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${settings.fontSize}px`);
  }, [settings.fontSize]);

  const handleFontSizeStep = useCallback((steps) => {
    setSettings((prev) => {
      const next = { ...prev, fontSize: stepFontSize(prev.fontSize, steps) };
      saveSettings(localStorage, next);
      return next;
    });
  }, []);

  // Ctrl と +/-/0 またはホイールでも文字サイズを変えられる
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey) return;
      if (e.key === "+" || e.key === ";" || e.key === "=") handleFontSizeStep(1);
      else if (e.key === "-") handleFontSizeStep(-1);
      else if (e.key === "0") updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize });
      else return;
      e.preventDefault();
    };
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      handleFontSizeStep(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  const handlePinToggle = useCallback(async () => {
    const pinned = !settings.pinned;
    updateSettings({ pinned });
    await invoke("set_pinned", { pinned });
  }, [settings.pinned]);

  const handleOpacityChange = useCallback(async (opacity) => {
    updateSettings({ opacity });
    await invoke("set_window_opacity", { opacity: opacity / 100 });
  }, []);

  const handleSave = useCallback(
    async (id) => {
      if (saving) return;
      setSaving(true);
      try {
        const outcome = await invoke("save_image", { id, defaultDir: settings.saveDir });
        if (outcome.saved) {
          updateSettings({ saveDir: outcome.directory });
          showToast("保存しました");
        }
      } catch (error) {
        showToast(`保存できませんでした: ${error}`, true);
      } finally {
        setSaving(false);
      }
    },
    [saving, settings.saveDir],
  );

  const { paused, status, currentId, items } = clipboard;
  return (
    <>
      <Titlebar
        pinned={settings.pinned}
        opacity={settings.opacity}
        wrap={settings.wrap}
        fontSize={settings.fontSize}
        paused={paused}
        onPauseToggle={() => invoke("set_paused", { paused: !paused })}
        onFontSizeStep={handleFontSizeStep}
        onPinToggle={handlePinToggle}
        onOpacityChange={handleOpacityChange}
        onWrapToggle={() => updateSettings({ wrap: !settings.wrap })}
      />
      {paused && (
        <div class="status-row status-paused">
          読み取りを停止中です。コピーしても一覧は更新されません
        </div>
      )}
      {status && <StatusRow status={status} />}
      <div id="history">
        {items.map((item) => (
          <HistoryItem
            key={item.id}
            item={item}
            current={item.id === currentId}
            wrap={settings.wrap}
            saving={saving}
            onCopy={(plain) => invoke("copy_item", { id: item.id, plain })}
            onSave={() => handleSave(item.id)}
          />
        ))}
        {items.length === 0 && !status && !paused && <div class="empty-hint">コピーした内容がここに表示されます</div>}
      </div>
      {toast && <div class={`toast${toast.isError ? " toast-error" : ""}`}>{toast.message}</div>}
    </>
  );
}

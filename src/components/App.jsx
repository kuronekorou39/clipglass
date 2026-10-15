import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { flushSync } from "preact/compat";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, stepFontSize } from "../settings.js";
import { KINDS, filterItems, filterPresets, folderPaths } from "../search.js";
import { Titlebar } from "./Titlebar.jsx";
import { Toolbar } from "./Toolbar.jsx";
import { StatusRow } from "./StatusRow.jsx";
import { HistoryItem } from "./HistoryItem.jsx";
import { PresetTree } from "./PresetTree.jsx";
import { RegisterPresetForm } from "./RegisterPresetForm.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { ResizeHandles } from "./ResizeHandles.jsx";
import { windowKeyAction } from "../windowKeys.js";

const STATE_EVENT = "clipboard-state";
const NOTICE_EVENT = "notice";
const TOAST_DURATION_MS = 2500;
const EMPTY_STATE = { paused: false, status: null, currentId: null, items: [] };
const ALL_KINDS = KINDS.map(([kind]) => kind);

export function App() {
  const [settings, setSettings] = useState(() => loadSettings(localStorage));
  const [clipboard, setClipboard] = useState(EMPTY_STATE);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("history");
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState(ALL_KINDS);
  const [config, setConfig] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presets, setPresets] = useState([]);
  const [presetsError, setPresetsError] = useState(null);
  const [registering, setRegistering] = useState(null);
  const toastTimer = useRef(null);
  const searchRef = useRef(null);

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

  const loadConfig = useCallback(async () => {
    const next = await invoke("get_config");
    setConfig(next);
    if (next.notices.length > 0) showToast(next.notices.join(" / "), true);
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      setPresets(await invoke("get_presets"));
      setPresetsError(null);
    } catch (error) {
      setPresetsError(String(error));
    }
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
      loadConfig().catch((error) => showToast(String(error), true));
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
    const unlistenState = listen(STATE_EVENT, (event) => applyAnimated(event.payload));
    const unlistenNotice = listen(NOTICE_EVENT, (event) => showToast(event.payload, true));
    invoke("get_state").then(setClipboard);
    return () => {
      unlistenState.then((stop) => stop());
      unlistenNotice.then((stop) => stop());
    };
  }, []);

  // プリセットはファイルを直接編集できるので、表示するたびに読み直す
  useEffect(() => {
    if (view !== "presets") return;
    loadPresets();
    window.addEventListener("focus", loadPresets);
    return () => window.removeEventListener("focus", loadPresets);
  }, [view]);

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
      const nudge = windowKeyAction(e);
      if (nudge) {
        e.preventDefault();
        invoke("nudge_window", nudge);
        return;
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setRegistering(null);
        if (document.activeElement === searchRef.current) {
          setQuery("");
          searchRef.current.blur();
        }
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key === "f" || e.key === "F") {
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "+" || e.key === ";" || e.key === "=") handleFontSizeStep(1);
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

  /** 失敗を通知にして、設定の表示を最新に合わせる。 */
  const applyConfig = useCallback(async (command, args) => {
    try {
      await invoke(command, args);
    } catch (error) {
      showToast(String(error), true);
    }
    await loadConfig();
  }, []);

  const runOrToast = useCallback(async (action, successMessage) => {
    try {
      await action();
      if (successMessage) showToast(successMessage);
      return true;
    } catch (error) {
      showToast(String(error), true);
      return false;
    }
  }, []);

  const handleRegisterSubmit = async (path) => {
    const ok = await runOrToast(
      () => invoke("add_preset_from_item", { id: registering.id, path }),
      `「${path.join(" / ")}」に登録しました`,
    );
    if (ok) setRegistering(null);
  };

  const { paused, status, currentId, items } = clipboard;
  const filtering = query.trim() !== "" || kinds.length !== ALL_KINDS.length;
  const visibleItems = filtering ? filterItems(items, { query, kinds }) : items;
  const visiblePresets = filterPresets(presets, query);

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
        onClose={() => invoke("hide_window")}
      />
      <Toolbar
        view={view}
        onViewChange={setView}
        query={query}
        onQueryChange={setQuery}
        kinds={kinds}
        onKindsChange={setKinds}
        onSettingsOpen={() => setSettingsOpen(true)}
        searchRef={searchRef}
      />
      {view === "history" && (
        <>
          {paused && (
            <div class="status-row status-paused">
              読み取りを停止中です。コピーしても一覧は更新されません
            </div>
          )}
          {status && <StatusRow status={status} />}
          <div id="history">
            {visibleItems.map((item) => (
              <HistoryItem
                key={item.id}
                item={item}
                current={item.id === currentId}
                wrap={settings.wrap}
                saving={saving}
                onCopy={(plain) => invoke("copy_item", { id: item.id, plain })}
                onSave={() => handleSave(item.id)}
                onPin={(pinned) => invoke("set_item_pinned", { id: item.id, pinned })}
                onRegister={() => {
                  loadPresets();
                  setRegistering(item);
                }}
                onRemove={() => invoke("remove_item", { id: item.id })}
              />
            ))}
            {items.length === 0 && !status && !paused && (
              <div class="empty-hint">コピーした内容がここに表示されます</div>
            )}
            {items.length > 0 && visibleItems.length === 0 && (
              <div class="empty-hint">一致する項目がありません</div>
            )}
          </div>
        </>
      )}
      {view === "presets" && (
        <div id="presets">
          {presetsError && <div class="status-row status-error">{presetsError}</div>}
          <PresetTree
            nodes={visiblePresets}
            onCopy={(path) =>
              runOrToast(() => invoke("copy_preset", { path }), `「${path.at(-1)}」をコピーしました`)
            }
            onRemove={async (path) => {
              await runOrToast(() => invoke("remove_preset", { path }), "削除しました");
              loadPresets();
            }}
          />
          {!presetsError && presets.length === 0 && (
            <div class="empty-hint">
              プリセットがありません。履歴の「登録」か、設定の「ファイルを開く」から追加できます
            </div>
          )}
          {presets.length > 0 && visiblePresets.length === 0 && (
            <div class="empty-hint">一致するプリセットがありません</div>
          )}
          <div class="presets-footer">
            <button class="row-btn" onClick={() => runOrToast(() => invoke("open_presets_file"))}>
              ファイルを開く
            </button>
            <button class="row-btn" onClick={loadPresets}>
              再読み込み
            </button>
          </div>
        </div>
      )}
      {registering && (
        <RegisterPresetForm
          item={registering}
          folders={folderPaths(presets)}
          onSubmit={handleRegisterSubmit}
          onCancel={() => setRegistering(null)}
        />
      )}
      {settingsOpen && config && (
        <SettingsPanel
          config={config}
          onClose={() => setSettingsOpen(false)}
          onApply={applyConfig}
          onOpenPresets={() => runOrToast(() => invoke("open_presets_file"))}
          onOpenDataDir={() => runOrToast(() => invoke("open_data_dir"))}
          onSnap={(corner) => runOrToast(() => invoke("snap_window", { corner }))}
          onResetSize={() => runOrToast(() => invoke("reset_window_size"))}
        />
      )}
      {toast && <div class={`toast${toast.isError ? " toast-error" : ""}`}>{toast.message}</div>}
      <ResizeHandles />
    </>
  );
}

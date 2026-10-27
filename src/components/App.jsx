import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { flushSync } from "preact/compat";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  backgroundAlpha,
  saveSettings,
  stepFontSize,
} from "../settings.js";
import { KINDS, filterItems, filterPresets } from "../search.js";
import { Titlebar } from "./Titlebar.jsx";
import { FilterBar } from "./FilterBar.jsx";
import { Footer } from "./Footer.jsx";
import { StatusRow } from "./StatusRow.jsx";
import { HistoryItem } from "./HistoryItem.jsx";
import { PresetPopover } from "./PresetPopover.jsx";
import { ItemMenu } from "./ItemMenu.jsx";
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState(ALL_KINDS);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState("");
  const [config, setConfig] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presets, setPresets] = useState([]);
  const [presetsError, setPresetsError] = useState(null);
  const [menu, setMenu] = useState(null);
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
        // 以前の版の「ウィンドウ全体」の透過が残らないよう、ウィンドウは不透明に戻す
        await invoke("set_window_opacity", { opacity: 1 });
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

  // プリセットはファイルを直接編集できるので、開くたびに読み直す
  useEffect(() => {
    if (!presetsOpen) return;
    loadPresets();
    window.addEventListener("focus", loadPresets);
    return () => window.removeEventListener("focus", loadPresets);
  }, [presetsOpen]);

  // 開いたらすぐ打ち込めるようにする
  useEffect(() => {
    if (filterOpen) searchRef.current?.focus();
  }, [filterOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${settings.fontSize}px`);
  }, [settings.fontSize]);

  // 背景だけを透かすときは背景色のアルファを下げ、文字は不透明のまま残す
  useEffect(() => {
    const root = document.documentElement;
    document.documentElement.style.setProperty("--bg-alpha", String(backgroundAlpha(settings)));
  }, [settings.opacity]);

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
        setMenu(null);
        setPresetsOpen(false);
        if (document.activeElement === searchRef.current) closeFilter();
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key === "f" || e.key === "F") {
        setPresetsOpen(false);
        setFilterOpen(true);
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


  /** 絞り込みを閉じるときは条件も解く。隠れたまま一覧が絞られていると気づけないため。 */
  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    setQuery("");
    setKinds(ALL_KINDS);
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

  /** 押すだけで、プリセットの先頭に登録する。名前は1行目から作り、あとで編集できる。 */
  const handleRegister = async (item) => {
    const result = await call("add_preset_from_item", { id: item.id });
    if (result.ok) {
      showToast(`「${result.value}」をプリセットに登録しました`);
      if (presetsOpen) loadPresets();
    }
  };

  const { paused, status, currentId, items } = clipboard;
  const filtering = query.trim() !== "" || kinds.length !== ALL_KINDS.length;
  const visibleItems = filtering ? filterItems(items, { query, kinds }) : items;
  const visiblePresets = filterPresets(presets, presetQuery);

  return (
    <>
      <Titlebar
        pinned={settings.pinned}
        opacity={settings.opacity}
        paused={paused}
        onPauseToggle={() => invoke("set_paused", { paused: !paused })}
        onPinToggle={handlePinToggle}
        onOpacityChange={(opacity) => updateSettings({ opacity })}
        onClose={() => invoke("hide_window")}
      />
      {filterOpen && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          kinds={kinds}
          onKindsChange={setKinds}
          onClose={closeFilter}
          searchRef={searchRef}
        />
      )}
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
            onRegister={() => handleRegister(item)}
            onMenu={(position) => setMenu({ item, ...position })}
          />
        ))}
        {items.length === 0 && !status && !paused && (
          <div class="empty-hint">コピーした内容がここに表示されます</div>
        )}
        {items.length > 0 && visibleItems.length === 0 && (
          <div class="empty-hint">一致する項目がありません</div>
        )}
      </div>
      <Footer
        presetsOpen={presetsOpen}
        onPresetsToggle={() => setPresetsOpen((open) => !open)}
        filterOpen={filterOpen}
        filtering={filtering}
        onFilterToggle={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
        onSettingsOpen={() => setSettingsOpen(true)}
      />
      {presetsOpen && (
        <PresetPopover
          presets={presets}
          visiblePresets={visiblePresets}
          error={presetsError}
          query={presetQuery}
          onQueryChange={setPresetQuery}
          onCopy={async (path) => {
            const result = await call("copy_preset", { path }, `「${path.at(-1)}」をコピーしました`);
            if (result.ok) setPresetsOpen(false);
          }}
          call={call}
          onReload={loadPresets}
          onOpenFile={() => runOrToast(() => invoke("open_presets_file"))}
          onRevealFile={() => runOrToast(() => invoke("reveal_presets_file"))}
          onClose={() => setPresetsOpen(false)}
        />
      )}
      {menu && (
        <ItemMenu
          item={menu.item}
          x={menu.x}
          y={menu.y}
          onPin={(pinned) => call("set_item_pinned", { id: menu.item.id, pinned })}
          onRemove={() => call("remove_item", { id: menu.item.id })}
          onClose={() => setMenu(null)}
        />
      )}
      {settingsOpen && config && (
        <SettingsPanel
          config={config}
          settings={settings}
          onFontSizeStep={handleFontSizeStep}
          onWrapChange={(wrap) => updateSettings({ wrap })}
          onClose={() => setSettingsOpen(false)}
          onApply={applyConfig}
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

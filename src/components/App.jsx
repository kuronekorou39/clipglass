import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, stepFontSize } from "../settings.js";
import { applyAppearance } from "../appearance.js";
import { KINDS, filterItems, folderPaths } from "../search.js";
import { measureRows, playListMotion } from "../listMotion.js";
import { Titlebar } from "./Titlebar.jsx";
import { FilterBar } from "./FilterBar.jsx";
import { Footer } from "./Footer.jsx";
import { StatusRow } from "./StatusRow.jsx";
import { HistoryItem } from "./HistoryItem.jsx";
import { AddPresetDialog } from "./AddPresetDialog.jsx";
import { ArchiveList } from "./ArchiveList.jsx";
import { ItemMenu } from "./ItemMenu.jsx";
import { ResizeHandles } from "./ResizeHandles.jsx";
import { QUICK_PICK_COUNT, windowKeyAction } from "../windowKeys.js";
import { quickKeyPrefix } from "../quickKeys.js";
import { richFormatLabels } from "../format.js";
import { usePresence } from "../presence.js";
import { useKeyboard } from "../keyboardFocus.js";
import { Icon } from "./Icon.jsx";

const STATE_EVENT = "clipboard-state";
const NOTICE_EVENT = "notice";
/** 横の別ウィンドウ(プリセット・お気に入り)に出している中身。閉じたときは null。 */
const PANEL_EVENT = "panel";
/** 別ウィンドウの設定画面で設定を変えたことを受け取るイベント。 */
const CONFIG_EVENT = "config-changed";
/** 修飾キー+数字で選ばれた行の位置を受け取るイベント。 */
const QUICK_PICK_EVENT = "quick-pick";
const TOAST_DURATION_MS = 2500;
const EMPTY_STATE = { paused: false, status: null, currentId: null, items: [] };
const ALL_KINDS = KINDS.map(([kind]) => kind);
/** これより下までスクロールしたら、一番上へ戻るボタンを出す(px)。 */
const SCROLL_TOP_THRESHOLD = 200;

export function App() {
  const [settings, setSettings] = useState(() => loadSettings(localStorage));
  const [clipboard, setClipboard] = useState(EMPTY_STATE);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState(ALL_KINDS);
  // 横の別ウィンドウに出している中身("presets" か "favorites")。閉じていれば null
  const [panel, setPanel] = useState(null);
  const [config, setConfig] = useState(null);
  const [presets, setPresets] = useState([]);
  const [presetsError, setPresetsError] = useState(null);
  const [menu, setMenu] = useState(null);
  // プリセットに加えようとしている履歴の項目。入れる場所を選ぶあいだ持つ
  const [presetTarget, setPresetTarget] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  // 文字を打つ場面でだけキーボードを受け取る。ふだんは入力中のアプリのカーソルを奪わない
  useKeyboard(presetTarget !== null || filterOpen);
  const toastTimer = useRef(null);
  const searchRef = useRef(null);
  const historyRef = useRef(null);
  // 行を滑らせるための、前の描画での行の位置と、そのときの履歴
  const rowRects = useRef(new Map());
  const animatedState = useRef(clipboard);
  // 閉じるアニメーションのあいだも描画を残す
  const presetTargetPresence = usePresence(presetTarget !== null);
  // 閉じる途中も中身を描けるよう、最後に選んだ項目を残す
  const lastPresetTarget = useRef(null);
  if (presetTarget) lastPresetTarget.current = presetTarget;
  // 数字キーで一覧の項目を選ぶ処理。キーの処理は最初の描画で登録するので、
  // 今の一覧と画面の状態を使えるよう、描画のたびに差し替える
  const quickPick = useRef(() => false);

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
      // どれかが失敗しても、ウィンドウの表示と設定の読み込みまでは必ず進める
      // 以前の版の「ウィンドウ全体」の透過が残らないよう、ウィンドウは不透明に戻す
      await call("set_window_opacity", { opacity: 1 });
      await call("set_pinned", { pinned: settings.pinned });
      await call("show_window");
      loadConfig().catch((error) => showToast(String(error), true));
    })();
  }, []);

  useEffect(() => {
    const unlisteners = [
      listen(STATE_EVENT, (event) => setClipboard(event.payload)),
      listen(NOTICE_EVENT, (event) => showToast(event.payload, true)),
      listen(PANEL_EVENT, (event) => setPanel(event.payload)),
      listen(QUICK_PICK_EVENT, (event) => quickPick.current(event.payload)),
      listen(CONFIG_EVENT, () => loadConfig().catch((error) => showToast(String(error), true))),
    ];
    invoke("get_state").then(setClipboard);
    // 別ウィンドウの設定画面で変えた値に追い付く
    const onStorage = () => setSettings(loadSettings(localStorage));
    window.addEventListener("storage", onStorage);
    return () => {
      unlisteners.forEach((unlisten) => unlisten.then((stop) => stop()));
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 設定は範囲外のクリックで閉じる。本体はクリックでフォーカスを取らないので、ここで受ける
  useEffect(() => {
    if (panel !== "settings") return undefined;
    const onMouseDown = (e) => {
      // 設定ボタン自身は、クリックで開閉するので除く
      if (!e.target.closest?.('button[aria-label="設定"]')) invoke("close_panel");
    };
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [panel]);

  // 履歴が変わったら、行を前の位置から今の位置まで滑らせる。絞り込みで並びが変わっただけの
  // ときは動かさないので、位置は毎回覚え直し、動かすのは履歴が変わったときだけにする
  useLayoutEffect(() => {
    const container = historyRef.current;
    if (!container) return;
    if (animatedState.current !== clipboard) {
      animatedState.current = clipboard;
      playListMotion(container, rowRects.current);
    }
    rowRects.current = measureRows(container);
  });

  // 入れる場所の選択肢に、今のフォルダーを出す
  useEffect(() => {
    if (presetTarget) loadPresets();
  }, [presetTarget]);

  useEffect(() => applyAppearance(settings), [settings]);

  // 開いたらすぐ打ち込めるようにする
  useEffect(() => {
    if (filterOpen) searchRef.current?.focus();
  }, [filterOpen]);

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
        setMenu(null);
        invoke("close_panel");
        setPresetTarget(null);
        if (document.activeElement === searchRef.current) closeFilter();
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key === "f" || e.key === "F") {
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
    // 切り替えられたときだけ、画面と保存する値を変える
    if ((await call("set_pinned", { pinned })).ok) updateSettings({ pinned });
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

  /** 選んだフォルダー(または新しく作るフォルダー)に、履歴の項目をプリセットとして加える。 */
  const handleAddPreset = async ({ folder, newFolder }) => {
    const result = await call("add_preset_from_item", { id: presetTarget.id, folder, newFolder });
    if (!result.ok) return;
    const place = result.value.slice(0, -1).join(" / ") || "先頭";
    showToast(`「${result.value.at(-1)}」を ${place} に追加しました`);
    setPresetTarget(null);
  };

  const handleFavorite = async (item, favorite) => {
    const command = favorite ? "add_favorite_from_item" : "remove_favorite_of_item";
    const message = favorite ? "お気に入りに追加しました" : "お気に入りから外しました";
    await call(command, { id: item.id }, message);
  };

  const paste = settings.pasteOnSelect;
  const quickPrefix = quickKeyPrefix(config?.quickKeys);
  const { paused, status, currentId, items } = clipboard;
  // 一覧から外れた項目を保管する設定か。しないなら「過去の履歴」を出さない
  const archiving = Boolean(config?.historyPersist && config.archiveDays > 0);
  const filtering = query.trim() !== "" || kinds.length !== ALL_KINDS.length;
  const visibleItems = filtering ? filterItems(items, { query, kinds }) : items;

  const pickItem = (item) => {
    // 先頭は今のクリップボードの中身。「文字だけにする」で書式を外してあれば、そのまま文字だけで貼る
    const plain = item.id === currentId && item.storedRich.length > 0 && richFormatLabels(item.formats).length === 0;
    call("copy_item", { id: item.id, plain, paste });
  };

  quickPick.current = (index) => {
    // 設定やメニューを開いているあいだは、裏の一覧を選ばない
    if (panel === "settings" || menu || presetTarget) return false;
    const item = visibleItems[index];
    if (!item) return false;
    pickItem(item);
    return true;
  };

  const scrollToTop = () => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    historyRef.current.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

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
      {paused && (
        <div class="status-row status-paused">
          読み取りを停止中です。コピーしても一覧は更新されません
        </div>
      )}
      {status && <StatusRow status={status} />}
      <div
        id="history"
        ref={historyRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > SCROLL_TOP_THRESHOLD)}
      >
        {visibleItems.map((item, index) => (
          <HistoryItem
            key={item.id}
            item={item}
            current={item.id === currentId}
            quickKey={quickPrefix !== null && index < QUICK_PICK_COUNT ? index + 1 : null}
            quickPrefix={quickPrefix}
            wrap={settings.wrap}
            saving={saving}
            // 先頭行の「文字だけにする」は今の内容の入れ替えなので、貼り付けない
            onCopy={(plain) =>
              call("copy_item", { id: item.id, plain, paste: paste && item.id !== currentId })
            }
            onPick={() => pickItem(item)}
            onSave={() => handleSave(item.id)}
            onMenu={(position) => setMenu({ item, ...position })}
          />
        ))}
        {items.length === 0 && !status && !paused && (
          <div class="empty-hint">コピーした内容がここに表示されます</div>
        )}
        {items.length > 0 && visibleItems.length === 0 && (
          <div class="empty-hint">一致する項目がありません</div>
        )}
        {archiving && (
          <ArchiveList
            query={query}
            kinds={kinds}
            searching={filtering}
            load={(args) => invoke("get_archive", args)}
            onRestore={async (item) =>
              (await call("restore_archived", { key: item.key, paste })).ok
            }
            onRemove={async (item) => (await call("remove_archived", { key: item.key })).ok}
          />
        )}
        {scrolled && (
          <div class="scroll-top">
            <button class="icon-btn" title="一番上へ" aria-label="一番上へ" onClick={scrollToTop}>
              <Icon name="up" size={14} />
            </button>
          </div>
        )}
      </div>
      {/* 検索は、開くボタンのある下部に寄せて出す */}
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
      <Footer
        presetsOpen={panel === "presets"}
        onPresetsToggle={() => call("toggle_panel", { kind: "presets" })}
        favoritesOpen={panel === "favorites"}
        onFavoritesToggle={() => call("toggle_panel", { kind: "favorites" })}
        onPanelHover={(kind) => call("hover_panel", { kind })}
        filterOpen={filterOpen}
        filtering={filtering}
        onFilterToggle={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
        onSettingsOpen={() => call("toggle_panel", { kind: "settings" })}
      />
      {presetTargetPresence.mounted && lastPresetTarget.current && (
        <AddPresetDialog
          closing={presetTargetPresence.closing}
          item={lastPresetTarget.current}
          folders={folderPaths(presets)}
          error={presetsError}
          onSubmit={handleAddPreset}
          onClose={() => setPresetTarget(null)}
        />
      )}
      {menu && (
        <ItemMenu
          item={menu.item}
          x={menu.x}
          y={menu.y}
          onFavorite={(favorite) => handleFavorite(menu.item, favorite)}
          onAddPreset={() => setPresetTarget(menu.item)}
          onRemove={() => call("remove_item", { id: menu.item.id })}
          onClose={() => setMenu(null)}
        />
      )}
      {toast && <div class={`toast${toast.isError ? " toast-error" : ""}`}>{toast.message}</div>}
      <ResizeHandles />
    </>
  );
}

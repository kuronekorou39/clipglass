// アプリ全体を描画して、ボタンを押したときに画面が出るかを確かめる。
// 部品の描画で例外が出ると、それ以降は画面全体が更新されなくなる(0.3.5 までの登録フォーム)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

const CONFIG = {
  historyMaxItems: 10,
  historyMaxItemsLimit: 200,
  historyPersist: true,
  archiveDays: 30,
  archiveDaysLimit: 365,
  archiveMaxMb: 200,
  archiveBytes: 3 * 1024 * 1024,
  version: "9.9.9",
  hotkey: "Ctrl+Shift+V",
  autostart: false,
  dataDir: "C:/data",
  notices: [],
};

function textItem(id, text) {
  return {
    id,
    kind: "text",
    text,
    charCount: text.length,
    truncated: false,
    width: null,
    height: null,
    paths: null,
    formats: [],
    storedRich: [],
    favorite: false,
    updatedAt: 0,
  };
}

function archivedItem(key, day, text) {
  return {
    key: `${day}/${key}`,
    day,
    kind: "text",
    text,
    charCount: text.length,
    truncated: false,
    width: null,
    height: null,
    paths: null,
    imageHash: null,
    updatedAt: 0,
  };
}

const ARCHIVE = [archivedItem(2, "2026-11-09", "おとといの内容"), archivedItem(1, "2026-11-08", "もっと前の内容")];
const FAVORITES = ["よく使う文字", "2行ある\nお気に入り"];

const STATE = {
  paused: false,
  status: null,
  currentId: 1,
  items: [textItem(1, "いまの内容"), { ...textItem(2, "ひとつ前の内容"), favorite: true }, textItem(3, "もうひとつ前")],
};

const PRESETS = [{ name: "挨拶", path: ["挨拶"], children: [{ name: "朝", path: ["挨拶", "朝"], text: "おはようございます" }] }];

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
// Rust から届くイベントを、テストから送れるようにする
const listeners = new Map();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name, handler) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

async function fire(name, payload) {
  await act(async () => listeners.get(name)({ payload }));
}

const { App } = await import("./App.jsx");
const { EXIT_DURATION_MS } = await import("../presence.js");

let root;

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await act(async () => {});
}

/** 閉じるアニメーションが終わるまで待つ。 */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 20)));
}

async function key(init) {
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
}

async function type(element, value) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const $ = (selector) => root.querySelector(selector);
const dialog = (label) => $(`[role="dialog"][aria-label="${label}"]`);
const footerButton = (label) => [...root.querySelectorAll("#footer .footer-btn")].find((b) => b.textContent.includes(label));
const tab = (label) => [...root.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label);
const archiveButton = (label) => [...root.querySelectorAll(".archive button")].find((b) => b.textContent.trim() === label);

/** 行の右クリックのメニューを開く。 */
async function menuOf(row) {
  await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 })));
}

/** 過去の履歴は、検索語の入力が落ち着くのを少し待ってから読む。 */
async function archiveLoaded() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "get_config") return CONFIG;
    if (command === "get_state") return STATE;
    if (command === "get_presets") return PRESETS;
    if (command === "add_preset_from_item") return [...args.folder, ...(args.newFolder ? [args.newFolder] : []), "名前"];
    if (command === "get_favorites") return FAVORITES;
    if (command === "get_archive") {
      const items = ARCHIVE.filter((item) => item.text.includes(args.query));
      return { items: items.slice(args.offset, args.offset + 1), hasMore: args.offset + 1 < items.length };
    }
    if (command === "update_preset") return [...args.path.slice(0, -1), args.name ?? args.text];
    if (command === "move_preset") return [...args.folder, args.path.at(-1)];
    if (command === "create_preset" || command === "create_preset_folder") {
      return [...args.folder, args.name ?? args.text];
    }
    return null;
  });
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<App />, root));
  await act(async () => {});
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("App", () => {
  it("設定ボタンで設定パネルが開き、Esc で閉じる", async () => {
    await click($('button[aria-label="設定"]'));
    expect(dialog("設定")).toBeTruthy();
    await key({ key: "Escape" });
    // 閉じる途中は操作を受け付けず、アニメーションのあとに消える
    expect(dialog("設定").closest(".overlay").classList.contains("closing")).toBe(true);
    await settle();
    expect(dialog("設定")).toBeNull();
  });

  it("行に「登録」「固定」のボタンはなく、右クリックのメニューで行う", async () => {
    const row = root.querySelectorAll(".item")[2];
    expect(row.textContent).not.toContain("登録");
    expect(row.textContent).not.toContain("固定");
    expect(row.querySelector(".danger")).toBeNull();
    await menuOf(row);
    const labels = [...root.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(labels).toEqual(["お気に入りに追加", "プリセットに追加…", "履歴から削除"]);
    await click(root.querySelectorAll('[role="menuitem"]')[2]);
    expect(invoke).toHaveBeenCalledWith("remove_item", { id: 3 });
    expect($('[role="menu"]')).toBeNull();
  });

  it("お気に入りの文字の行には星が付き、メニューで追加と解除を切り替える", async () => {
    const [, starred, plain] = root.querySelectorAll(".item");
    expect(starred.querySelector('[aria-label="お気に入り"]')).toBeTruthy();
    expect(plain.querySelector('[aria-label="お気に入り"]')).toBeNull();
    await menuOf(plain);
    await click(root.querySelectorAll('[role="menuitem"]')[0]);
    expect(invoke).toHaveBeenCalledWith("add_favorite_from_item", { id: 3 });
    await menuOf(starred);
    const toggle = root.querySelectorAll('[role="menuitem"]')[0];
    expect(toggle.textContent).toBe("お気に入りから外す");
    await click(toggle);
    expect(invoke).toHaveBeenCalledWith("remove_favorite_of_item", { id: 2 });
  });

  it("プリセットへの追加は、入れる場所を選ぶか、フォルダーを作って入れる", async () => {
    await menuOf(root.querySelectorAll(".item")[2]);
    await click(root.querySelectorAll('[role="menuitem"]')[1]);
    const form = dialog("プリセットに追加");
    expect(form.textContent).toContain("もうひとつ前");
    // 今あるフォルダーが選択肢に出る
    expect([...form.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["先頭", "挨拶"]);
    // まだ登録しない
    expect(invoke).not.toHaveBeenCalledWith("add_preset_from_item", expect.anything());
    await act(async () => {
      const select = form.querySelector("select");
      select.value = "挨拶";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await type(form.querySelector('[aria-label="新しいフォルダー"]'), " 夜 ");
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("add_preset_from_item", { id: 3, folder: ["挨拶"], newFolder: "夜" });
    expect($(".toast").textContent).toContain("「名前」を 挨拶 / 夜 に追加しました");
    await settle();
    expect(dialog("プリセットに追加")).toBeNull();
    // そのあとも、ほかの操作が効く
    await click($('button[aria-label="設定"]'));
    expect(dialog("設定")).toBeTruthy();
  });

  it("フォルダーを作らなければ、選んだ場所にそのまま入れる", async () => {
    await menuOf(root.querySelectorAll(".item")[2]);
    await click(root.querySelectorAll('[role="menuitem"]')[1]);
    await act(async () => dialog("プリセットに追加").requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("add_preset_from_item", { id: 3, folder: [], newFolder: null });
    expect($(".toast").textContent).toContain("先頭 に追加しました");
  });

  it("2件目以降を選ぶとコピーして貼り付ける。設定で貼り付けを止められる", async () => {
    await click(root.querySelectorAll(".item")[1]);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 2, plain: false, paste: true });
    await click($('button[aria-label="設定"]'));
    await click(tab("履歴"));
    const toggle = [...root.querySelectorAll('[aria-label="設定"] [role="switch"]')].find((el) =>
      el.textContent.includes("選んだら貼り付ける"),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(JSON.parse(localStorage.getItem("clipglass-settings")).pasteOnSelect).toBe(false);
    await key({ key: "Escape" });
    await settle();
    await click(root.querySelectorAll(".item")[1]);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 2, plain: false, paste: false });
  });

  it("色合いは設定の「表示」で選び、<html> に付けて次回も使う", async () => {
    expect(document.documentElement.dataset.theme).toBe("dark");
    await click($('button[aria-label="設定"]'));
    const swatches = [...root.querySelectorAll(".theme-swatch")];
    expect(swatches.map((b) => b.textContent)).toEqual(["ダーク", "ライト", "XP 風", "クラシック", "ターミナル"]);
    // 見本は、その色合いの色で描く
    expect(swatches[2].dataset.theme).toBe("xp");
    expect(swatches[0].getAttribute("aria-pressed")).toBe("true");
    await click(swatches[2]);
    expect(document.documentElement.dataset.theme).toBe("xp");
    expect(swatches[2].getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem("clipglass-settings")).theme).toBe("xp");
  });

  it("大きさを変える見えるつまみは、左下と右下の両方にある", async () => {
    const grips = [...root.querySelectorAll(".resize-grip")];
    expect(grips.map((grip) => grip.className)).toEqual(["resize-grip left", "resize-grip right"]);
    const press = async (grip) =>
      act(async () => grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await press(grips[0]);
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "sw" });
    await press(grips[1]);
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "se" });
  });

  it("過去の履歴はふだん畳んであり、開くと日ごとに並ぶ。続きを読み込める", async () => {
    expect(invoke).not.toHaveBeenCalledWith("get_archive", expect.anything());
    await click(archiveButton("過去の履歴を見る"));
    await archiveLoaded();
    expect(invoke).toHaveBeenCalledWith("get_archive", {
      query: "",
      kinds: ["text", "image", "files"],
      offset: 0,
      limit: 50,
    });
    const section = $(".archive");
    expect(section.querySelectorAll(".item.archived").length).toBe(1);
    expect(section.querySelector(".archive-day").textContent).toContain("2026/11/9");
    await click(archiveButton("さらに読み込む"));
    expect(section.querySelectorAll(".item.archived").length).toBe(2);
    expect(section.querySelectorAll(".archive-day").length).toBe(2);
    expect(archiveButton("さらに読み込む")).toBeUndefined();
    // 保管した行は、一覧の行の並べ替えの対象にしない
    expect(section.querySelector("[data-item-id]")).toBeNull();
  });

  it("過去の履歴の行を選ぶと、一覧に戻してコピーし、過去の履歴からは消える", async () => {
    await click(archiveButton("過去の履歴を見る"));
    await archiveLoaded();
    await click($(".item.archived"));
    expect(invoke).toHaveBeenCalledWith("restore_archived", { key: "2026-11-09/2", paste: true });
    expect($(".item.archived")).toBeNull();
  });

  it("過去の履歴の ✕ は、一覧に戻さずその1件だけを消す", async () => {
    await click(archiveButton("過去の履歴を見る"));
    await archiveLoaded();
    await click($('.item.archived [aria-label="過去の履歴から削除"]'));
    expect(invoke).toHaveBeenCalledWith("remove_archived", { key: "2026-11-09/2" });
    expect(invoke).not.toHaveBeenCalledWith("restore_archived", expect.anything());
    expect($(".item.archived")).toBeNull();
  });

  it("検索語は過去の履歴にも掛かる", async () => {
    await click($('button[aria-label="検索と絞り込み"]'));
    await type($("#search"), "もっと前");
    await click(archiveButton("過去の履歴も探す"));
    await archiveLoaded();
    expect(invoke).toHaveBeenCalledWith("get_archive", expect.objectContaining({ query: "もっと前", offset: 0 }));
    expect($(".item.archived").textContent).toContain("もっと前の内容");
  });

  it("設定の「情報」に、バージョンと使い方とリンクがある", async () => {
    await click($('button[aria-label="設定"]'));
    await click(tab("情報"));
    const panel = dialog("設定");
    expect(panel.textContent).toContain("バージョン 9.9.9");
    expect(panel.querySelectorAll(".help-list dt").length).toBeGreaterThan(4);
    expect(panel.textContent).toContain("Ctrl + F");
    await click([...panel.querySelectorAll(".link-row button")].find((b) => b.textContent === "GitHub"));
    expect(invoke).toHaveBeenCalledWith("open_link", { target: "repo" });
  });

  it("過去の履歴を残す日数と大きさは「履歴」で変える。保存しない設定では出さない", async () => {
    await click($('button[aria-label="設定"]'));
    await click(tab("履歴"));
    const days = $('[aria-label="過去の履歴を残す日数"]');
    expect(days.value).toBe("30");
    expect(dialog("設定").textContent).toContain("いま 3.0 MB を保管中");
    await type(days, "7");
    await act(async () => days.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await act(async () => days.dispatchEvent(new FocusEvent("blur")));
    expect(invoke).toHaveBeenCalledWith("set_archive", { days: 7, maxMb: 200 });
  });

  it("形式・時刻・文字数は「データ」にまとめて畳む。開いても再コピーしない", async () => {
    const row = root.querySelectorAll(".item")[1];
    const data = row.querySelector("details.item-data");
    expect(data.open).toBe(false);
    expect(data.querySelector("summary").textContent).toBe("データ");
    expect(data.textContent).toContain("7文字");
    invoke.mockClear();
    await click(data.querySelector("summary"));
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
  });

  it("タイトルバーに文字サイズと折り返しのボタンはなく、設定の「表示」で変える", async () => {
    const titlebar = $("#titlebar");
    expect(titlebar.querySelector('[aria-label="文字を大きく"]')).toBeNull();
    expect(titlebar.textContent).not.toContain("↵");
    // タスクバーに出さないので、最小化もない
    expect(titlebar.querySelector('[title="最小化"]')).toBeNull();
    // 読み取りの停止は、区切り線をはさんで不透明度のつまみの左に置く
    const order = [...titlebar.querySelectorAll(".titlebar-buttons > *")];
    const pause = order.findIndex((el) => el.title === "読み取りを停止する");
    // 記号は文字ではなく、太さを決めた図で描く
    expect(order[pause].querySelector("svg")).toBeTruthy();
    // ✕ ではなく、最小化の形で「隠す」
    expect(titlebar.textContent).not.toContain("✕");
    expect(titlebar.querySelector('[aria-label="隠す"]')).toBeTruthy();
    expect(order[pause + 1].getAttribute("role")).toBe("separator");
    expect(order[pause + 2].id).toBe("opacity-slider");
    await click($('button[aria-label="設定"]'));
    await click($('[aria-label="設定"] [aria-label="文字を大きく"]'));
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px");
    const wrap = $('[aria-label="設定"] [role="switch"]');
    expect(wrap.getAttribute("aria-checked")).toBe("true");
    await click(wrap);
    expect(wrap.getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(localStorage.getItem("clipglass-settings")).wrap).toBe(false);
  });

  it("設定はタブで分かれ、隅への配置は 2 × 2 に並ぶ", async () => {
    await click($('button[aria-label="設定"]'));
    const tabs = [...root.querySelectorAll('[aria-label="設定"] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["表示", "履歴", "起動", "ウィンドウ", "情報"]);
    await click(tabs[3]);
    const corners = [...root.querySelectorAll(".corner-grid button")].map((b) => b.textContent);
    expect(corners).toEqual(["左上", "右上", "左下", "右下"]);
    await click(root.querySelectorAll(".corner-grid button")[3]);
    expect(invoke).toHaveBeenCalledWith("snap_window", { corner: "bottom-right" });
  });

  it("絞り込みはふだん閉じていて、開閉できる。閉じると条件も解く", async () => {
    expect($("#search")).toBeNull();
    await click($('button[aria-label="検索と絞り込み"]'));
    const search = $("#search");
    expect(search).toBeTruthy();
    await act(async () => {
      search.value = "ひとつ前の";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(root.querySelectorAll(".item").length).toBe(1);
    await click($('button[aria-label="絞り込みを閉じる"]'));
    expect($("#search")).toBeNull();
    expect(root.querySelectorAll(".item").length).toBe(3);
  });

  it("ショートカットはキーを押して記録し、記録のあいだは今のショートカットを止める", async () => {
    await click($('button[aria-label="設定"]'));
    await click([...root.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "起動"));
    const box = $('[aria-label="ショートカット"]');
    expect(box.textContent).toBe("Ctrl + Shift + V");
    expect(root.querySelector('[aria-label="設定"] input[type="text"]')).toBeNull();
    await click(box);
    expect(invoke).toHaveBeenCalledWith("suspend_hotkey", { suspended: true });
    const press = async (init) =>
      act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
    await press({ code: "AltLeft", key: "Alt", altKey: true });
    expect(box.textContent).toBe("Alt + …");
    // 修飾キーなしは記録しない
    await press({ code: "KeyQ", key: "q" });
    expect(root.textContent).toContain("一緒に押してください");
    await press({ code: "KeyQ", key: "Q", altKey: true, shiftKey: true });
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("set_hotkey", { hotkey: "Alt+Shift+Q" });
  });

  it("ほかで使われていそうな組み合わせには注意を出し、元に戻せる", async () => {
    await click($('button[aria-label="設定"]'));
    await click([...root.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "起動"));
    // テストの設定は Ctrl+Shift+V なので、最初から注意が出る
    expect($(".hotkey-warning").textContent).toContain("書式なしで貼り付け");
    const box = $('[aria-label="ショートカット"]');
    await click(box);
    await act(async () =>
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyQ", altKey: true, shiftKey: true })),
    );
    await act(async () => {});
    const undo = [...root.querySelectorAll(".hotkey button")].find((b) => b.textContent === "元に戻す");
    expect(undo.title).toBe("Ctrl + Shift + V に戻す");
    await click(undo);
    expect(invoke).toHaveBeenLastCalledWith("get_config");
    expect(invoke).toHaveBeenCalledWith("set_hotkey", { hotkey: "Ctrl+Shift+V" });
  });

  it("ショートカットの記録は Esc で取りやめ、元のショートカットに戻す", async () => {
    await click($('button[aria-label="設定"]'));
    await click([...root.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "起動"));
    await click($('[aria-label="ショートカット"]'));
    await act(async () =>
      $('[aria-label="ショートカット"]').dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape", key: "Escape" }),
      ),
    );
    expect(invoke).toHaveBeenCalledWith("suspend_hotkey", { suspended: false });
    expect(invoke).not.toHaveBeenCalledWith("set_hotkey", expect.anything());
    // Esc で設定パネルまで閉じない
    expect(dialog("設定").closest(".overlay").classList.contains("closing")).toBe(false);
  });

  it("Ctrl+F で絞り込みを開く", async () => {
    await key({ key: "f", ctrlKey: true });
    expect($("#search")).toBeTruthy();
  });

  it("透かすのは背景だけで、ウィンドウは不透明のまま。透過のしかたの選択はない", async () => {
    expect(invoke).toHaveBeenCalledWith("set_window_opacity", { opacity: 1 });
    expect(document.documentElement.style.getPropertyValue("--bg-alpha")).toBe("0.5");
    invoke.mockClear();
    await act(async () => {
      const slider = $('#titlebar input[type="range"]');
      slider.value = "30";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.documentElement.style.getPropertyValue("--bg-alpha")).toBe("0.3");
    expect(invoke).not.toHaveBeenCalledWith("set_window_opacity", expect.anything());
    await click($('button[aria-label="設定"]'));
    expect(root.textContent).not.toContain("ウィンドウ全体");
  });

  it("プリセットとお気に入りは本体の横の別ウィンドウで開き、一覧には重ねない", async () => {
    expect(root.textContent).not.toContain("履歴プリセット");
    expect($('[role="tab"]')).toBeNull();
    await click(footerButton("プリセット"));
    expect(invoke).toHaveBeenCalledWith("toggle_panel", { kind: "presets" });
    // 本体のウィンドウの中には出さない
    expect(dialog("プリセット")).toBeNull();
    // 開いている方のボタンに印を付ける
    await fire("panel", "presets");
    expect(footerButton("プリセット").getAttribute("aria-expanded")).toBe("true");
    expect(footerButton("お気に入り").getAttribute("aria-expanded")).toBe("false");
    await click(footerButton("お気に入り"));
    expect(invoke).toHaveBeenCalledWith("toggle_panel", { kind: "favorites" });
    await fire("panel", null);
    expect(footerButton("プリセット").getAttribute("aria-expanded")).toBe("false");
    // Esc で別ウィンドウも閉じる
    await key({ key: "Escape" });
    expect(invoke).toHaveBeenCalledWith("close_panel");
  });

  it("一覧の先頭から9件の頭に数字が付き、数字キーで選ぶと貼り付ける", async () => {
    const keys = [...root.querySelectorAll(".item .item-key")].map((el) => el.textContent);
    expect(keys).toEqual(["1", "2", "3"]);
    await key({ code: "Digit3", key: "3" });
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 3, plain: false, paste: true });
    // 先頭(今の中身)も選べる。テンキーでもよい
    await key({ code: "Numpad1", key: "1" });
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 1, plain: false, paste: true });
  });

  it("数字キーは、絞り込んだ一覧の並びで数え、文字の入力中や設定を開いているあいだは使わない", async () => {
    await click($('button[aria-label="検索と絞り込み"]'));
    await type($("#search"), "もうひとつ");
    expect([...root.querySelectorAll(".item .item-key")].map((el) => el.textContent)).toEqual(["1"]);
    // 検索欄では数字をそのまま打てる
    await act(async () =>
      $("#search").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Digit1", key: "1" })),
    );
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
    $("#search").blur();
    await key({ code: "Digit1", key: "1" });
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 3, plain: false, paste: true });
    invoke.mockClear();
    await click($('button[aria-label="設定"]'));
    await key({ code: "Digit2", key: "2" });
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
  });
});

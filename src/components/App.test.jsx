// アプリ全体を描画して、ボタンを押したときに画面が出るかを確かめる。
// 部品の描画で例外が出ると、それ以降は画面全体が更新されなくなる(0.3.5 までの登録フォーム)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

const CONFIG = {
  historyMaxItems: 10,
  historyMaxItemsLimit: 200,
  historyPersist: false,
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
    pinned: false,
    updatedAt: 0,
  };
}

const STATE = {
  paused: false,
  status: null,
  currentId: 1,
  items: [textItem(1, "いまの内容"), textItem(2, "ひとつ前の内容")],
};

const PRESETS = [{ name: "挨拶", path: ["挨拶"], children: [{ name: "朝", path: ["挨拶", "朝"], text: "おはようございます" }] }];

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ minimize() {} }) }));

const { App } = await import("./App.jsx");

let root;

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await act(async () => {});
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

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "get_config") return CONFIG;
    if (command === "get_state") return STATE;
    if (command === "get_presets") return PRESETS;
    if (command === "add_preset_from_item") return "いまの内容";
    if (command === "update_preset") return [...args.path.slice(0, -1), args.name];
    if (command === "move_preset") return [...args.folder, args.path.at(-1)];
    if (command === "create_preset" || command === "create_preset_folder") {
      return [...args.folder, args.name];
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
    expect(dialog("設定")).toBeNull();
  });

  it("登録は押すだけで済み、フォームを出さない。そのあとも設定が開ける", async () => {
    await click($('button[title="プリセットの先頭に登録"]'));
    expect(invoke).toHaveBeenCalledWith("add_preset_from_item", { id: 1 });
    expect($('[role="dialog"]')).toBeNull();
    expect($(".toast").textContent).toContain("「いまの内容」をプリセットに登録しました");
    await click($('button[aria-label="設定"]'));
    expect(dialog("設定")).toBeTruthy();
  });

  it("行には固定と削除のボタンを出さず、右クリックのメニューで行う", async () => {
    const row = root.querySelectorAll(".item")[1];
    expect(row.textContent).not.toContain("固定");
    expect(row.querySelector(".danger")).toBeNull();
    await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 })));
    const items = root.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
    await click(items[0]);
    expect(invoke).toHaveBeenCalledWith("set_item_pinned", { id: 2, pinned: true });
    expect($('[role="menu"]')).toBeNull();
    await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await click(root.querySelectorAll('[role="menuitem"]')[1]);
    expect(invoke).toHaveBeenCalledWith("remove_item", { id: 2 });
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
    await click($('button[aria-label="設定"]'));
    await click($('[aria-label="設定"] [aria-label="文字を大きく"]'));
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px");
    const wrap = $('[aria-label="設定"] input[type="checkbox"]');
    await click(wrap);
    expect(JSON.parse(localStorage.getItem("clipglass-settings")).wrap).toBe(false);
  });

  it("設定はタブで分かれ、隅への配置は 2 × 2 に並ぶ", async () => {
    await click($('button[aria-label="設定"]'));
    const tabs = [...root.querySelectorAll('[aria-label="設定"] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["表示", "履歴", "起動", "ウィンドウ"]);
    await click(tabs[3]);
    const corners = [...root.querySelectorAll(".corner-grid button")].map((b) => b.textContent);
    expect(corners).toEqual(["左上", "右上", "左下", "右下"]);
    await click(root.querySelectorAll(".corner-grid button")[3]);
    expect(invoke).toHaveBeenCalledWith("snap_window", { corner: "bottom-right" });
  });

  it("タブはなく、プリセットは下部のボタンからポップオーバーで開く", async () => {
    expect(root.textContent).not.toContain("履歴プリセット");
    expect($('[role="tab"]')).toBeNull();
    // 開いても履歴の一覧は残る
    await click($("#footer .footer-btn"));
    expect(dialog("プリセット")).toBeTruthy();
    expect($("#history")).toBeTruthy();
    expect(root.textContent).toContain("朝");
    await key({ key: "Escape" });
    expect(dialog("プリセット")).toBeNull();
  });

  it("プリセットをコピーするとポップオーバーを閉じる", async () => {
    await click($("#footer .footer-btn"));
    await click($(".preset-leaf"));
    expect(invoke).toHaveBeenCalledWith("copy_preset", { path: ["挨拶", "朝"] });
    expect(dialog("プリセット")).toBeNull();
  });

  it("絞り込みはふだん閉じていて、開閉できる。閉じると条件も解く", async () => {
    expect($("#search")).toBeNull();
    await click($('button[aria-label="検索と絞り込み"]'));
    const search = $("#search");
    expect(search).toBeTruthy();
    await act(async () => {
      search.value = "ひとつ";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(root.querySelectorAll(".item").length).toBe(1);
    await click($('button[aria-label="絞り込みを閉じる"]'));
    expect($("#search")).toBeNull();
    expect(root.querySelectorAll(".item").length).toBe(2);
  });

  it("プリセットを編集して、名前と文字の変更とフォルダーの移動を送る", async () => {
    await click($("#footer .footer-btn"));
    await click($('.preset-leaf [aria-label="編集"]'));
    // 編集を始めてもコピーしない
    expect(invoke).not.toHaveBeenCalledWith("copy_preset", expect.anything());
    const form = $('form[aria-label="プリセットを編集"]');
    await type(form.querySelector('[aria-label="名前"]'), "おはよう");
    await type(form.querySelector('[aria-label="文字"]'), "おはようございます!");
    await act(async () => {
      const select = form.querySelector("select");
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("update_preset", {
      path: ["挨拶", "朝"],
      name: "おはよう",
      text: "おはようございます!",
    });
    expect(invoke).toHaveBeenCalledWith("move_preset", { path: ["挨拶", "おはよう"], folder: [] });
    // 保存したら一覧に戻る(名前の変更と移動の2回を待つ)
    await act(async () => {});
    expect($("form.preset-editor")).toBeNull();
  });

  it("プリセットとフォルダーを新しく作れる", async () => {
    await click($("#footer .footer-btn"));
    await click([...root.querySelectorAll(".presets-footer button")].find((b) => b.textContent.includes("プリセット")));
    const form = $('form[aria-label="プリセットを作成"]');
    await type(form.querySelector('[aria-label="名前"]'), "署名");
    await type(form.querySelector('[aria-label="文字"]'), "山田\n太郎");
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("create_preset", { folder: [], name: "署名", text: "山田\n太郎" });

    await click([...root.querySelectorAll(".presets-footer button")].find((b) => b.textContent.includes("フォルダー")));
    const folderForm = $('form[aria-label="フォルダーを作成"]');
    expect(folderForm.querySelector("textarea")).toBeNull();
    await type(folderForm.querySelector('[aria-label="名前"]'), "仕事");
    await act(async () => folderForm.requestSubmit());
    expect(invoke).toHaveBeenCalledWith("create_preset_folder", { folder: [], name: "仕事" });
  });

  it("フォルダーは自分の中へ移す先を選べず、削除は確かめてから行う", async () => {
    await click($("#footer .footer-btn"));
    await click($('.preset-folder [aria-label="編集"]'));
    const form = $('form[aria-label="フォルダーを編集"]');
    expect([...form.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["先頭"]);
    await click([...form.querySelectorAll("button")].find((b) => b.textContent === "削除"));
    expect(invoke).not.toHaveBeenCalledWith("remove_preset", expect.anything());
    await click([...form.querySelectorAll("button")].find((b) => b.textContent === "中身ごと削除"));
    expect(invoke).toHaveBeenCalledWith("remove_preset", { path: ["挨拶"] });
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

  it("プリセットのファイルの場所をエクスプローラーで表示できる", async () => {
    await click($("#footer .footer-btn"));
    await click([...root.querySelectorAll(".presets-footer button")].find((b) => b.textContent === "場所"));
    expect(invoke).toHaveBeenCalledWith("reveal_presets_file");
  });
});

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

const $ = (selector) => root.querySelector(selector);
const dialog = (label) => $(`[role="dialog"][aria-label="${label}"]`);

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (command === "get_config") return CONFIG;
    if (command === "get_state") return STATE;
    if (command === "get_presets") return PRESETS;
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

  it("登録ボタンで登録フォームが開き、そのあとも設定が開ける", async () => {
    await click($('button[title="この文字をプリセットに登録"]'));
    expect(dialog("プリセットに登録")).toBeTruthy();
    await click($('[aria-label="プリセットに登録"] button[type="button"]'));
    expect(dialog("プリセットに登録")).toBeNull();
    await click($('button[aria-label="設定"]'));
    expect(dialog("設定")).toBeTruthy();
  });

  it("登録フォームはフォルダーと名前を並べて送る", async () => {
    await click($('button[title="この文字をプリセットに登録"]'));
    const select = $('[aria-label="プリセットに登録"] select');
    await act(async () => {
      select.value = "挨拶";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => $('[aria-label="プリセットに登録"]').requestSubmit());
    expect(invoke).toHaveBeenCalledWith("add_preset_from_item", { id: 1, path: ["挨拶", "いまの内容"] });
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

  it("Ctrl+F で絞り込みを開く", async () => {
    await key({ key: "f", ctrlKey: true });
    expect($("#search")).toBeTruthy();
  });

  it("背景だけの透過では、ウィンドウは不透明のまま背景色を薄くする", async () => {
    expect(invoke).toHaveBeenCalledWith("set_window_opacity", { opacity: 1 });
    expect(document.documentElement.style.getPropertyValue("--bg-alpha")).toBe("0.5");
    await click($('button[aria-label="設定"]'));
    const whole = [...root.querySelectorAll('input[name="transparency"]')][1];
    await click(whole);
    expect(invoke).toHaveBeenLastCalledWith("set_window_opacity", { opacity: 0.5 });
    expect(document.documentElement.style.getPropertyValue("--bg-alpha")).toBe("1");
  });
});

// App の操作のうち、失敗時の通知、キー操作、状態ごとの表示を確かめる。
// App.test.jsx と違い、テストごとに履歴と設定の中身を変えて描画する。
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
  archiveBytes: 1024,
  version: "9.9.9",
  hotkey: "Alt+Q",
  autostart: false,
  dataDir: "C:/data",
  notices: [],
};

function textItem(id, text, extra = {}) {
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
    ...extra,
  };
}

const imageItem = (id) => textItem(id, "", { kind: "image", text: null, width: 10, height: 20 });
const STATE = { paused: false, status: null, currentId: 1, items: [textItem(1, "いまの内容"), textItem(2, "前の内容")] };
const PRESETS = [{ name: "挨拶", path: ["挨拶"], children: [] }];

const invoke = vi.fn();
const listeners = new Map();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name, handler) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

const { App } = await import("./App.jsx");
const { EXIT_DURATION_MS } = await import("../presence.js");

let root;
/** コマンドごとの応答を差し替える。関数なら呼び、Error なら失敗させる。 */
let responses;

async function mount({ state = STATE, config = CONFIG, overrides = {} } = {}) {
  responses = { get_config: config, get_state: state, get_presets: PRESETS, ...overrides };
  invoke.mockImplementation(async (command, args) => {
    const response = responses[command];
    if (response instanceof Error) throw response.message;
    return typeof response === "function" ? response(args) : (response ?? null);
  });
  await act(async () => render(<App />, root));
  // 起動の処理は invoke を順に待つので、設定が届くまで何度か流す
  for (let i = 0; i < 5; i++) await act(async () => {});
}

const $ = (selector) => root.querySelector(selector);
const items = () => [...root.querySelectorAll("#history > .item")];
const toast = () => $(".toast");
const menuEntry = (label) => [...root.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.startsWith(label));
const titleButton = (title) => $(`#titlebar button[title^="${title}"]`);
const fontSize = () => document.documentElement.style.getPropertyValue("--font-size");
const saved = () => JSON.parse(localStorage.getItem("clipglass-settings"));

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await act(async () => {});
}

async function key(init) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => window.dispatchEvent(event));
  return event;
}

async function fire(name, payload) {
  await act(async () => listeners.get(name)({ payload }));
}

async function type(element, value) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function menuOf(row) {
  await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 2 })));
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 20)));
}

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  listeners.clear();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.useRealTimers();
  render(null, root);
  root.remove();
});

describe("App: タイトルバー", () => {
  it("読み取りを止めると案内が出て、再開すると消える", async () => {
    await mount();
    await click(titleButton("読み取りを停止する"));
    expect(invoke).toHaveBeenCalledWith("set_paused", { paused: true });
    await fire("clipboard-state", { ...STATE, paused: true });
    expect($(".status-paused").textContent).toContain("読み取りを停止中");
    await click(titleButton("読み取りを再開する"));
    expect(invoke).toHaveBeenCalledWith("set_paused", { paused: false });
    await fire("clipboard-state", STATE);
    expect($(".status-paused")).toBeNull();
  });

  it("手前に固定を切り替えると、Rust に送って次回のために覚える", async () => {
    await mount();
    await click(titleButton("常に手前に表示しない"));
    expect(invoke).toHaveBeenLastCalledWith("set_pinned", { pinned: false });
    expect(saved().pinned).toBe(false);
    expect(titleButton("常に手前に表示する").getAttribute("aria-pressed")).toBe("false");
  });

  it("手前に固定の切り替えに失敗したら、表示も保存も変えずに知らせる", async () => {
    await mount({ overrides: {} });
    responses.set_pinned = new Error("切り替えられません");
    await click(titleButton("常に手前に表示しない"));
    expect(toast().textContent).toBe("切り替えられません");
    expect(titleButton("常に手前に表示しない").getAttribute("aria-pressed")).toBe("true");
    expect(saved()?.pinned ?? true).toBe(true);
  });

  it.each(["set_window_opacity", "set_pinned"])("起動時に %s が失敗しても、表示して設定を読む", async (command) => {
    await mount({ overrides: { [command]: new Error("失敗") } });
    expect(invoke).toHaveBeenCalledWith("show_window", undefined);
    expect(invoke).toHaveBeenCalledWith("get_config");
    expect(toast().textContent).toBe("失敗");
  });

  it("行のクリックでのコピーが失敗したら知らせる", async () => {
    await mount({ overrides: { copy_item: new Error("書き込めません") } });
    await click(items()[1]);
    expect(toast().textContent).toBe("書き込めません");
  });

  it("数字キーでのコピーが失敗したら知らせる", async () => {
    await mount({ overrides: { copy_item: new Error("書き込めません") } });
    await fire("quick-pick", 1);
    await act(async () => {});
    expect(toast().textContent).toBe("書き込めません");
  });

  it("先頭行をクリックすると、今の書式のまま貼り付ける", async () => {
    await mount();
    await click(items()[0]);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 1, plain: false, paste: true });
  });

  it("「データ」を開いても、行は選ばれない", async () => {
    await mount();
    await click(items()[0].querySelector(".item-data-toggle"));
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
  });

  it("下へスクロールすると一番上へ戻るボタンが出て、押すとなめらかに戻る", async () => {
    await mount();
    const history = $("#history");
    history.scrollTo = vi.fn();
    expect($('[aria-label="一番上へ"]')).toBeNull();
    history.scrollTop = 500;
    await act(async () => history.dispatchEvent(new Event("scroll")));
    await click($('[aria-label="一番上へ"]'));
    expect(history.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    history.scrollTop = 0;
    await act(async () => history.dispatchEvent(new Event("scroll")));
    expect($('[aria-label="一番上へ"]')).toBeNull();
  });

  it("動きを減らす設定では、一番上へ一気に戻る", async () => {
    window.matchMedia = () => ({ matches: true });
    await mount();
    const history = $("#history");
    history.scrollTo = vi.fn();
    history.scrollTop = 500;
    await act(async () => history.dispatchEvent(new Event("scroll")));
    await click($('[aria-label="一番上へ"]'));
    delete window.matchMedia;
    expect(history.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("プリセットのボタンに少し留まると開き、通り過ぎただけでは開かない", async () => {
    await mount();
    vi.useFakeTimers();
    const button = $('#footer [aria-label="プリセット"]');
    await act(async () => button.dispatchEvent(new MouseEvent("mouseenter")));
    await act(async () => button.dispatchEvent(new MouseEvent("mouseleave")));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(invoke).not.toHaveBeenCalledWith("hover_panel", expect.anything());
    await act(async () => button.dispatchEvent(new MouseEvent("mouseenter")));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(invoke).toHaveBeenCalledWith("hover_panel", { kind: "presets" });
  });

  it("文字を打つ場面でだけキーボードを受け取り、終わったら返す", async () => {
    await mount();
    expect(invoke).not.toHaveBeenCalledWith("take_keyboard");
    await click($('#footer [aria-label="検索と絞り込み"]'));
    expect(invoke).toHaveBeenCalledWith("take_keyboard");
    expect(invoke).not.toHaveBeenCalledWith("release_keyboard");
    await click($('#footer [aria-label="検索と絞り込み"]'));
    expect(invoke).toHaveBeenCalledWith("release_keyboard");
  });

  it("組み合わせを「使わない」にすると、行の番号を出さない", async () => {
    await mount({ config: { ...CONFIG, quickKeys: "off" } });
    expect($(".item-key kbd")).toBeNull();
  });

  it("選んだ組み合わせを、番号のツールチップに出す", async () => {
    await mount({ config: { ...CONFIG, quickKeys: "ctrl+alt" } });
    expect($(".item-key kbd").title).toBe("Ctrl + Alt + 1 で貼り付け");
  });

  it("修飾キー+数字は Rust から届いて、その位置の行を貼り付ける", async () => {
    await mount();
    await fire("quick-pick", 1);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 2, plain: false, paste: true });
  });

  it("検索欄は下部のボタンの近くに出す", async () => {
    await mount();
    await click($('#footer [aria-label="検索と絞り込み"]'));
    const order = [...root.children].map((el) => el.id);
    expect(order.indexOf("filter-bar")).toBeGreaterThan(order.indexOf("history"));
    expect(order.indexOf("filter-bar")).toBeLessThan(order.indexOf("footer"));
  });

  it("隠すボタンでウィンドウを隠す", async () => {
    await mount();
    await click($('#titlebar [aria-label="隠す"]'));
    expect(invoke).toHaveBeenCalledWith("hide_window");
  });

  it("タイトルの文字を押すと移動を始め、ボタンを押しても移動しない", async () => {
    await mount();
    const press = (el) => act(async () => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await press(titleButton("読み取りを停止する"));
    expect(invoke).not.toHaveBeenCalledWith("begin_window_drag", expect.anything());
    await press($(".titlebar-title"));
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "move" });
  });

  it("縁の帯を主ボタンで押すと、その向きの大きさ変更を始める。右ボタンでは始めない", async () => {
    await mount();
    const press = (el, button) => act(async () => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button })));
    await press($(".resize-handle.resize-ne"), 2);
    expect(invoke).not.toHaveBeenCalledWith("begin_window_drag", expect.anything());
    await press($(".resize-handle.resize-ne"), 0);
    expect(invoke).toHaveBeenCalledWith("begin_window_drag", { kind: "ne" });
  });

  it("起動時に、保存してある固定の設定を Rust へ渡す", async () => {
    localStorage.setItem("clipglass-settings", JSON.stringify({ pinned: false }));
    await mount();
    expect(invoke).toHaveBeenCalledWith("set_pinned", { pinned: false });
    expect(invoke).toHaveBeenCalledWith("show_window", undefined);
  });
});

describe("App: 状態ごとの表示", () => {
  it("履歴がなければ案内を出す", async () => {
    await mount({ state: { ...STATE, currentId: null, items: [] } });
    expect($(".empty-hint").textContent).toBe("コピーした内容がここに表示されます");
  });

  it("クリップボードの状態があれば、空の案内の代わりにそれを出す", async () => {
    await mount({ state: { paused: false, status: { kind: "empty" }, currentId: null, items: [] } });
    expect($(".status-row").textContent).toBe("クリップボードは空です");
    expect($(".empty-hint")).toBeNull();
  });

  it("停止中は、空の案内を出さない", async () => {
    await mount({ state: { paused: true, status: null, currentId: null, items: [] } });
    expect($(".status-paused")).toBeTruthy();
    expect($(".empty-hint")).toBeNull();
  });

  it("Rust から届いた履歴で一覧が更新される", async () => {
    await mount();
    await fire("clipboard-state", { ...STATE, currentId: 3, items: [textItem(3, "新しい内容"), ...STATE.items] });
    expect(items().length).toBe(3);
    expect(items()[0].textContent).toContain("新しい内容");
    expect(items()[0].classList.contains("current")).toBe(true);
  });

  it("数字の印は先頭から9件までで、10件目には付かない", async () => {
    const many = Array.from({ length: 10 }, (_, i) => textItem(i + 1, `行${i + 1}`));
    await mount({ state: { ...STATE, items: many } });
    expect(items()[8].querySelector("kbd").textContent).toBe("9");
    expect(items()[9].querySelector("kbd")).toBeNull();
  });

  it.each([
    ["保存しない設定", { historyPersist: false }],
    ["日数が 0", { archiveDays: 0 }],
  ])("%sでは、過去の履歴を出さない", async (_, change) => {
    await mount({ config: { ...CONFIG, ...change } });
    expect($(".archive")).toBeNull();
  });

  it("起動時の知らせはエラーの通知で出す", async () => {
    await mount({ config: { ...CONFIG, notices: ["設定を読めません", "履歴を読めません"] } });
    expect(toast().textContent).toBe("設定を読めません / 履歴を読めません");
    expect(toast().classList.contains("toast-error")).toBe(true);
  });

  it("設定を読めなければ通知を出す", async () => {
    await mount({ overrides: { get_config: new Error("設定が壊れています") } });
    expect(toast().textContent).toBe("設定が壊れています");
  });

  it("通知は一定時間で消え、新しい通知が来たらその時間を数え直す", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await fire("notice", "最初の通知");
    expect(toast().classList.contains("toast-error")).toBe(true);
    await act(async () => vi.advanceTimersByTime(2000));
    await fire("notice", "次の通知");
    await act(async () => vi.advanceTimersByTime(2000));
    // 最初の通知の時間は過ぎたが、次の通知はまだ出ている
    expect(toast().textContent).toBe("次の通知");
    await act(async () => vi.advanceTimersByTime(500));
    expect(toast()).toBeNull();
  });
});

describe("App: 画像の保存", () => {
  const imageState = { ...STATE, currentId: 5, items: [imageItem(5)] };
  const saveButton = () => $('button[title="画像をPNGファイルとして保存"]');

  it("保存すると通知を出し、選んだ場所を次の既定にする", async () => {
    await mount({ state: imageState, overrides: { save_image: { saved: true, directory: "D:/pictures" } } });
    await click(saveButton());
    expect(invoke).toHaveBeenCalledWith("save_image", { id: 5, defaultDir: null });
    expect(toast().textContent).toBe("保存しました");
    expect(saved().saveDir).toBe("D:/pictures");
    await click(saveButton());
    expect(invoke).toHaveBeenLastCalledWith("save_image", { id: 5, defaultDir: "D:/pictures" });
  });

  it("保存の画面で取りやめたら、通知も既定の変更もしない", async () => {
    await mount({ state: imageState, overrides: { save_image: { saved: false } } });
    await click(saveButton());
    expect(toast()).toBeNull();
    expect(localStorage.getItem("clipglass-settings")).toBeNull();
    // 次の保存を押せる状態に戻る
    expect(saveButton().disabled).toBe(false);
  });

  it("保存に失敗したら理由を通知し、もう一度押せる", async () => {
    await mount({ state: imageState, overrides: { save_image: new Error("書き込めません") } });
    await click(saveButton());
    expect(toast().textContent).toBe("保存できませんでした: 書き込めません");
    expect(toast().classList.contains("toast-error")).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it("保存しているあいだはボタンを押せず、二重に保存しない", async () => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    await mount({ state: imageState, overrides: { save_image: () => pending } });
    const button = saveButton();
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(invoke.mock.calls.filter(([command]) => command === "save_image").length).toBe(1);
    await act(async () => finish({ saved: false }));
    await act(async () => {});
    expect(button.disabled).toBe(false);
  });
});

describe("App: 書式とコピー", () => {
  const RICH = ["HTML Format"];

  it("先頭行の「文字だけにする」は、今の内容の入れ替えなので貼り付けない", async () => {
    await mount({ state: { ...STATE, items: [textItem(1, "書式付き", { formats: RICH, storedRich: RICH })] } });
    await click($('button[title="書式を外し、文字だけをコピーし直す"]'));
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 1, plain: true, paste: false });
  });

  it("過去の行の「文字だけ」は、文字だけで貼り付ける", async () => {
    const state = { ...STATE, items: [STATE.items[0], textItem(2, "前", { formats: RICH, storedRich: RICH })] };
    await mount({ state });
    await click($('button[title="書式を外し、文字だけをコピー"]'));
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 2, plain: true, paste: true });
  });

  it("書式を外した先頭行を数字キーで選ぶと、文字だけのまま貼り付ける", async () => {
    await mount({ state: { ...STATE, items: [textItem(1, "外した", { formats: [], storedRich: RICH })] } });
    await fire("quick-pick", 0);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 1, plain: true, paste: true });
  });

  it("書式が残っている先頭行を数字キーで選ぶと、書式ごと貼り付ける", async () => {
    await mount({ state: { ...STATE, items: [textItem(1, "書式", { formats: RICH, storedRich: RICH })] } });
    await fire("quick-pick", 0);
    expect(invoke).toHaveBeenCalledWith("copy_item", { id: 1, plain: false, paste: true });
  });

  it("並んでいない番号の数字キーでは何もしない", async () => {
    await mount();
    await fire("quick-pick", 4);
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
  });

  it("メニューやダイアログを開いているあいだは、数字キーで裏の一覧を選ばない", async () => {
    await mount();
    await menuOf(items()[1]);
    await fire("quick-pick", 0);
    await click(menuEntry("プリセットに追加"));
    await fire("quick-pick", 0);
    expect(invoke).not.toHaveBeenCalledWith("copy_item", expect.anything());
  });
});

describe("App: キーボードとホイール", () => {
  it.each([
    ["+", 16],
    [";", 16],
    ["=", 16],
    ["-", 12],
  ])("Ctrl と %s で文字サイズを変える", async (name, size) => {
    await mount();
    const event = await key({ key: name, ctrlKey: true });
    expect(fontSize()).toBe(`${size}px`);
    expect(saved().fontSize).toBe(size);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+0 で文字サイズを標準に戻す", async () => {
    localStorage.setItem("clipglass-settings", JSON.stringify({ fontSize: 22 }));
    await mount();
    expect(fontSize()).toBe("22px");
    await key({ key: "0", ctrlKey: true });
    expect(fontSize()).toBe("14px");
  });

  it("関係のない Ctrl の組み合わせは横取りしない", async () => {
    await mount();
    const event = await key({ key: "c", ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(fontSize()).toBe("14px");
  });

  it("Ctrl+ホイールで文字サイズを変え、Ctrl なしのホイールはスクロールのまま", async () => {
    await mount();
    const wheel = async (init) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      await act(async () => window.dispatchEvent(event));
      return event;
    };
    expect((await wheel({ deltaY: -100 })).defaultPrevented).toBe(false);
    expect(fontSize()).toBe("14px");
    expect((await wheel({ deltaY: -100, ctrlKey: true })).defaultPrevented).toBe(true);
    expect(fontSize()).toBe("16px");
    await wheel({ deltaY: 100, ctrlKey: true });
    expect(fontSize()).toBe("14px");
  });

  it("Ctrl+Shift+矢印でウィンドウを動かす", async () => {
    await mount();
    const event = await key({ key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(invoke).toHaveBeenCalledWith("nudge_window", { dx: 20, dy: 0, dw: 0, dh: 0 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("開いている絞り込みでは、Ctrl+F で検索欄へ戻る", async () => {
    await mount();
    await key({ key: "F", ctrlKey: true });
    const search = $("#search");
    search.blur();
    await key({ key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("検索欄で Esc を押すと、絞り込みを閉じて条件も解く", async () => {
    await mount();
    await key({ key: "f", ctrlKey: true });
    await act(async () => {});
    await type($("#search"), "前の");
    expect(items().length).toBe(1);
    await key({ key: "Escape" });
    expect($("#search")).toBeNull();
    expect(items().length).toBe(2);
  });

  it("検索欄の外で Esc を押しても、絞り込みは開いたまま", async () => {
    await mount();
    await key({ key: "f", ctrlKey: true });
    await act(async () => {});
    $("#search").blur();
    await key({ key: "Escape" });
    expect($("#search")).toBeTruthy();
  });

  it("Esc で右クリックのメニューも閉じる", async () => {
    await mount();
    await menuOf(items()[1]);
    expect($('[role="menu"]')).toBeTruthy();
    await key({ key: "Escape" });
    expect($('[role="menu"]')).toBeNull();
  });

  it("画面を閉じたら、キーとホイールの処理を外す", async () => {
    await mount();
    render(null, root);
    invoke.mockClear();
    await key({ key: "Escape" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("App: 絞り込み", () => {
  const state = { ...STATE, items: [STATE.items[0], imageItem(2)] };

  it("種類を外すと一覧から消え、全部外すと一致なしと伝える", async () => {
    await mount({ state });
    await click($('button[aria-label="検索と絞り込み"]'));
    const chip = (label) => [...root.querySelectorAll(".chip")].find((el) => el.textContent === label);
    await click(chip("画像"));
    expect(chip("画像").getAttribute("aria-pressed")).toBe("false");
    expect(items().length).toBe(1);
    await click(chip("文字"));
    expect(items().length).toBe(0);
    expect($("#history .empty-hint").textContent).toBe("一致する項目がありません");
    // 絞っていることが下部のボタンでわかる
    expect($('button[aria-label="検索と絞り込み"]').classList.contains("filtering")).toBe(true);
  });

  it("下部のボタンでもう一度押すと閉じて、種類の条件も解く", async () => {
    await mount({ state });
    const toggle = $('button[aria-label="検索と絞り込み"]');
    await click(toggle);
    await click([...root.querySelectorAll(".chip")].find((el) => el.textContent === "画像"));
    expect(items().length).toBe(1);
    await click(toggle);
    expect($("#filter-bar")).toBeNull();
    expect(items().length).toBe(2);
  });
});

describe("App: メニューの結果", () => {
  it("お気に入りに入れると通知が出る", async () => {
    await mount();
    await menuOf(items()[1]);
    await click(menuEntry("お気に入りに追加"));
    expect(toast().textContent).toBe("お気に入りに追加しました");
    expect(toast().classList.contains("toast-error")).toBe(false);
  });

  it("お気に入りから外すと通知が出る", async () => {
    const state = { ...STATE, items: [STATE.items[0], textItem(2, "星", { favorite: true })] };
    await mount({ state });
    await menuOf(items()[1]);
    await click(menuEntry("お気に入りから外す"));
    expect(toast().textContent).toBe("お気に入りから外しました");
  });

  it("失敗はエラーの通知で知らせる", async () => {
    await mount({ overrides: { remove_item: new Error("消せません") } });
    await menuOf(items()[1]);
    await click(menuEntry("履歴から削除"));
    expect(toast().textContent).toBe("消せません");
    expect(toast().classList.contains("toast-error")).toBe(true);
  });

  it("プリセットへの追加に失敗したら、ダイアログを閉じずに知らせる", async () => {
    await mount({ overrides: { add_preset_from_item: new Error("追加できません") } });
    await menuOf(items()[1]);
    await click(menuEntry("プリセットに追加"));
    await act(async () => $('[aria-label="プリセットに追加"]').requestSubmit());
    await act(async () => {});
    expect(toast().textContent).toBe("追加できません");
    await settle();
    expect($('[aria-label="プリセットに追加"]')).toBeTruthy();
  });

  it("フォルダーを読めないときは、ダイアログに理由を出して追加させない", async () => {
    await mount({ overrides: { get_presets: new Error("presets.yaml が壊れています") } });
    await menuOf(items()[1]);
    await click(menuEntry("プリセットに追加"));
    const form = $('[aria-label="プリセットに追加"]');
    expect(form.querySelector(".status-error").textContent).toBe("presets.yaml が壊れています");
    expect(form.querySelector('button[type="submit"]').disabled).toBe(true);
  });

  it("ダイアログの取消で閉じる", async () => {
    await mount();
    await menuOf(items()[1]);
    await click(menuEntry("プリセットに追加"));
    await click([...root.querySelectorAll('[aria-label="プリセットに追加"] button')].find((b) => b.textContent === "取消"));
    await settle();
    expect($('[aria-label="プリセットに追加"]')).toBeNull();
  });

  it("お気に入りの別ウィンドウを開いているあいだは、下部のボタンに印が付く", async () => {
    await mount();
    await fire("panel", "favorites");
    const button = $('#footer [aria-label="お気に入り"]');
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.classList.contains("active")).toBe(true);
    expect($('#footer [aria-label="プリセット"]').classList.contains("active")).toBe(false);
  });

  it("下部のボタンで別ウィンドウを開けなければ知らせる", async () => {
    await mount({ overrides: { toggle_panel: new Error("開けません") } });
    await click($('#footer [aria-label="プリセット"]'));
    expect(toast().textContent).toBe("開けません");
  });
});

describe("App: 過去の履歴の失敗", () => {
  const ARCHIVED = {
    key: "2026-11-09/1",
    day: "2026-11-09",
    kind: "text",
    text: "保管した内容",
    charCount: 6,
    truncated: false,
    width: null,
    height: null,
    paths: null,
    imageHash: null,
    updatedAt: 0,
  };

  async function openArchive(overrides) {
    await mount({ overrides: { get_archive: { items: [ARCHIVED], hasMore: false }, ...overrides } });
    await click([...root.querySelectorAll(".archive button")].find((b) => b.textContent.includes("過去の履歴を見る")));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  }

  it("一覧に戻せなければ、行を残して知らせる", async () => {
    await openArchive({ restore_archived: new Error("戻せません") });
    await click($(".item.archived"));
    expect($(".item.archived")).toBeTruthy();
    expect(toast().textContent).toBe("戻せません");
  });

  it("消せなければ、行を残して知らせる", async () => {
    await openArchive({ remove_archived: new Error("消せません") });
    await click($('.item.archived [aria-label="過去の履歴から削除"]'));
    expect($(".item.archived")).toBeTruthy();
    expect(toast().textContent).toBe("消せません");
  });
});

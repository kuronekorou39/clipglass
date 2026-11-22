// 別ウィンドウに出す設定。本体とは localStorage と Rust のコマンドでつながる。
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

const invoke = vi.fn();
const listeners = new Map();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name, handler) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

const { Panel } = await import("./Panel.jsx");
const { EXIT_DURATION_MS } = await import("../presence.js");

let root;
let failures;

const $ = (selector) => root.querySelector(selector);
const settings = () => $('[role="dialog"][aria-label="設定"]');
const tab = (label) => [...root.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label);
const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.includes(label));
const toggle = (label) => [...root.querySelectorAll('[role="switch"]')].find((el) => el.textContent.includes(label));
const saved = () => JSON.parse(localStorage.getItem("clipglass-settings"));

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await act(async () => {});
}

async function show(kind) {
  await act(async () => listeners.get("panel")({ payload: kind }));
  await act(async () => {});
}

beforeEach(async () => {
  localStorage.clear();
  failures = {};
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (failures[command]) throw failures[command];
    if (command === "get_panel") return null;
    if (command === "get_config") return CONFIG;
    return null;
  });
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<Panel />, root));
  await act(async () => {});
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("Panel: 設定", () => {
  it("開くと設定を読み、閉じると消える", async () => {
    expect(settings()).toBeNull();
    await show("settings");
    expect(invoke).toHaveBeenCalledWith("get_config");
    expect([...root.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual([
      "表示", "履歴", "起動", "ウィンドウ", "情報",
    ]);
    await show(null);
    await act(() => new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 20)));
    expect(settings()).toBeNull();
  });

  it("設定を読めなければ知らせる", async () => {
    failures.get_config = "読めません";
    await show("settings");
    expect($(".toast").textContent).toBe("読めません");
    expect(settings()).toBeNull();
  });

  it("✕ と Esc で閉じる", async () => {
    await show("settings");
    await click($('[aria-label="閉じる"]'));
    expect(invoke).toHaveBeenCalledWith("close_panel");
    invoke.mockClear();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(invoke).toHaveBeenCalledWith("close_panel");
  });

  it("色合い・文字サイズ・折り返しは保存して、この窓にもすぐ反映する", async () => {
    await show("settings");
    const swatches = [...root.querySelectorAll(".theme-swatch")];
    expect(swatches.map((b) => b.textContent)).toEqual(["ダーク", "ライト", "XP 風", "クラシック", "ターミナル"]);
    await click(swatches[2]);
    expect(document.documentElement.dataset.theme).toBe("xp");
    expect(saved().theme).toBe("xp");
    const before = parseInt(document.documentElement.style.getPropertyValue("--font-size"), 10);
    await click($('[aria-label="文字を大きく"]'));
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe(`${before + 2}px`);
    const wrap = toggle("折り返す");
    const was = wrap.getAttribute("aria-checked") === "true";
    await click(wrap);
    expect(saved().wrap).toBe(!was);
  });

  it("選んだら貼り付けるの切り替えを保存する", async () => {
    await show("settings");
    await click(tab("履歴"));
    await click(toggle("選んだら貼り付ける"));
    expect(saved().pasteOnSelect).toBe(false);
  });

  it("Rust 側の設定を変えたら読み直し、本体にも知らせる", async () => {
    await show("settings");
    await click(tab("起動"));
    invoke.mockClear();
    await click(toggle("Windows と一緒に起動"));
    expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    expect(invoke).toHaveBeenCalledWith("get_config");
    expect(invoke).toHaveBeenLastCalledWith("notify_config_changed");
  });

  it("変更に失敗したら通知を出し、表示は読み直す", async () => {
    failures.set_autostart = "登録できません";
    await show("settings");
    await click(tab("起動"));
    invoke.mockClear();
    await click(toggle("Windows と一緒に起動"));
    expect($(".toast").textContent).toBe("登録できません");
    expect(invoke).toHaveBeenCalledWith("get_config");
  });

  it("隅への配置と大きさの復元は、本体に対して送る", async () => {
    await show("settings");
    await click(tab("ウィンドウ"));
    expect([...root.querySelectorAll(".corner-grid button")].map((b) => b.textContent)).toEqual(["左上", "右上", "左下", "右下"]);
    await click(root.querySelectorAll(".corner-grid button")[3]);
    expect(invoke).toHaveBeenCalledWith("snap_window", { corner: "bottom-right" });
    await click(button("標準の大きさに戻す"));
    expect(invoke).toHaveBeenCalledWith("reset_window_size", undefined);
  });

  it("データフォルダーを開く。開けなければ知らせる", async () => {
    await show("settings");
    await click(tab("履歴"));
    expect(settings().textContent).toContain("いま 3.0 MB を保管中");
    await click(button("データフォルダーを開く"));
    expect(invoke).toHaveBeenCalledWith("open_data_dir", undefined);
    failures.open_data_dir = "開けません";
    await click(button("データフォルダーを開く"));
    expect($(".toast").textContent).toBe("開けません");
  });

  it("「情報」にバージョンと使い方があり、外部へのリンクは置かない", async () => {
    await show("settings");
    await click(tab("情報"));
    expect(settings().textContent).toContain("バージョン 9.9.9");
    expect(root.querySelectorAll(".help-list dt").length).toBeGreaterThan(4);
    for (const word of ["GitHub", "更新", "作者"]) expect(settings().textContent).not.toContain(word);
    expect(root.querySelector(".link-row")).toBeNull();
  });

  it("ショートカットはキーを押して記録し、記録のあいだは止める", async () => {
    await show("settings");
    await click(tab("起動"));
    const box = $('[aria-label="ショートカット"]');
    expect(box.textContent).toBe("Ctrl + Shift + V");
    await click(box);
    expect(invoke).toHaveBeenCalledWith("suspend_hotkey", { suspended: true });
    await act(async () =>
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyQ", key: "Q", altKey: true, shiftKey: true })),
    );
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("set_hotkey", { hotkey: "Alt+Shift+Q" });
  });

  it("数字で貼り付ける組み合わせは Ctrl が初期値で、変えると保存して本体に知らせる", async () => {
    await show("settings");
    await click(tab("起動"));
    const select = $('[aria-label="数字で貼り付ける組み合わせ"]');
    expect(select.value).toBe("ctrl");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Ctrl + 数字", "Ctrl + Shift + 数字", "Ctrl + Alt + 数字", "使わない",
    ]);
    invoke.mockClear();
    await act(async () => {
      select.value = "ctrl+shift";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("set_quick_keys", { mode: "ctrl+shift" });
    expect(invoke).toHaveBeenLastCalledWith("notify_config_changed");
  });

  it("「情報」の数字の行は、今の組み合わせで見せ、使わないなら載せない", async () => {
    const configured = (quickKeys) =>
      invoke.mockImplementation(async (command) => {
        if (command === "get_panel") return null;
        return command === "get_config" ? { ...CONFIG, quickKeys } : null;
      });
    configured("ctrl+alt");
    await show("settings");
    await click(tab("情報"));
    expect(settings().textContent).toContain("Ctrl + Alt + 1 〜 9");
    configured("off");
    await show(null);
    await show("settings");
    await act(async () => {});
    expect(settings().textContent).not.toContain("1 〜 9");
  });

  it("使わない設定では、番号も出さないと説明する", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "get_panel") return null;
      return command === "get_config" ? { ...CONFIG, quickKeys: "off" } : null;
    });
    await show("settings");
    await click(tab("起動"));
    expect(settings().textContent).toContain("行の頭の番号も出しません");
  });

  it("記録の途中で設定が閉じたら、止めたショートカットを元に戻す", async () => {
    await show("settings");
    await click(tab("起動"));
    await click($('[aria-label="ショートカット"]'));
    invoke.mockClear();
    await show(null);
    await act(() => new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 20)));
    expect(invoke).toHaveBeenCalledWith("suspend_hotkey", { suspended: false });
  });

  it("記録を Esc で取りやめても、設定は閉じない", async () => {
    await show("settings");
    await click(tab("起動"));
    const box = $('[aria-label="ショートカット"]');
    await click(box);
    invoke.mockClear();
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Escape", key: "Escape" })));
    expect(invoke).toHaveBeenCalledWith("suspend_hotkey", { suspended: false });
    expect(invoke).not.toHaveBeenCalledWith("close_panel");
    expect(invoke.mock.calls.filter(([command]) => command === "suspend_hotkey").length).toBe(1);
  });
});

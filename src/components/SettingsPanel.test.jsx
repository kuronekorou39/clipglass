// 設定パネル。入力の確定で送るコマンドと、読めない入力を元に戻す動きを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN } from "../settings.js";
import { SettingsPanel } from "./SettingsPanel.jsx";

const CONFIG = {
  historyMaxItems: 10,
  historyMaxItemsLimit: 200,
  historyPersist: true,
  archiveDays: 30,
  archiveDaysLimit: 365,
  archiveMaxMb: 200,
  archiveBytes: 2048,
  version: "9.9.9",
  hotkey: "Alt+Q",
  autostart: false,
  dataDir: "C:/data",
  notices: [],
};

let root;
let handlers;

async function mount({ config = {}, settings = {}, closing = false } = {}) {
  await act(async () =>
    render(
      <SettingsPanel
        closing={closing}
        config={{ ...CONFIG, ...config }}
        settings={{ ...DEFAULT_SETTINGS, ...settings }}
        {...handlers}
      />,
      root,
    ),
  );
}

const $ = (selector) => root.querySelector(selector);
const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const toggle = (label) => [...root.querySelectorAll('[role="switch"]')].find((el) => el.textContent.includes(label));
const maxItems = () => $("label.setting-row input[type=number]");
const days = () => $('[aria-label="過去の履歴を残す日数"]');
const megabytes = () => $('[aria-label="過去の履歴の大きさの上限(MB)"]');

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}

async function openTab(label) {
  await click([...root.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label));
}

/** 値を打ち込んで、欄から離れる。 */
async function commit(input, value) {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent("blur")));
}

beforeEach(() => {
  handlers = {
    onFontSizeStep: vi.fn(),
    onWrapChange: vi.fn(),
    onThemeChange: vi.fn(),
    onPasteChange: vi.fn(),
    onClose: vi.fn(),
    onApply: vi.fn(),
    onSuspendHotkey: vi.fn(),
    onOpenDataDir: vi.fn(),
    onOpenLink: vi.fn(),
    onSnap: vi.fn(),
    onResetSize: vi.fn(),
  };
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("SettingsPanel", () => {
  it("外側か ✕ を押すと閉じ、パネルの中を押しても閉じない", async () => {
    await mount();
    await click($('[role="dialog"]'));
    expect(handlers.onClose).not.toHaveBeenCalled();
    await click($(".overlay"));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    await click($('[aria-label="閉じる"]'));
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it("閉じる途中は操作を受け付けない", async () => {
    await mount({ closing: true });
    expect($(".overlay").classList.contains("closing")).toBe(true);
    expect($(".overlay").hasAttribute("inert")).toBe(true);
  });

  it("選んでいるタブに印が付き、中身が切り替わる", async () => {
    await mount();
    await openTab("ウィンドウ");
    const selected = [...root.querySelectorAll('[role="tab"]')].filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected.map((el) => el.textContent)).toEqual(["ウィンドウ"]);
    expect($(".corner-grid")).toBeTruthy();
    expect($(".theme-grid")).toBeNull();
  });

  describe("表示", () => {
    it("文字サイズを1段ずつ変えられる", async () => {
      await mount();
      await click($('[aria-label="文字を小さく"]'));
      expect(handlers.onFontSizeStep).toHaveBeenLastCalledWith(-1);
      await click($('[aria-label="文字を大きく"]'));
      expect(handlers.onFontSizeStep).toHaveBeenLastCalledWith(1);
    });

    it("文字サイズの上限と下限では、その向きのボタンを押せない", async () => {
      await mount({ settings: { fontSize: FONT_SIZE_MIN } });
      expect($('[aria-label="文字を小さく"]').disabled).toBe(true);
      expect($('[aria-label="文字を大きく"]').disabled).toBe(false);
      await mount({ settings: { fontSize: FONT_SIZE_MAX } });
      expect($('[aria-label="文字を小さく"]').disabled).toBe(false);
      expect($('[aria-label="文字を大きく"]').disabled).toBe(true);
    });

    it("折り返しのスイッチは今と逆の値を渡す", async () => {
      await mount({ settings: { wrap: false } });
      await click(toggle("長い文を折り返す"));
      expect(handlers.onWrapChange).toHaveBeenCalledWith(true);
    });
  });

  describe("履歴", () => {
    it("件数は確定したときに送る", async () => {
      await mount();
      await openTab("履歴");
      await commit(maxItems(), "25");
      expect(handlers.onApply).toHaveBeenCalledWith("set_history_limit", { maxItems: 25 });
    });

    it("件数は上限に収めて送り、欄の表示も収めた値にする", async () => {
      await mount();
      await openTab("履歴");
      await commit(maxItems(), "9999");
      expect(handlers.onApply).toHaveBeenCalledWith("set_history_limit", { maxItems: 200 });
      expect(maxItems().value).toBe("200");
    });

    it("件数が読めなければ送らずに元へ戻す", async () => {
      await mount();
      await openTab("履歴");
      await commit(maxItems(), "");
      expect(handlers.onApply).not.toHaveBeenCalled();
      expect(maxItems().value).toBe("10");
    });

    it("件数が変わっていなければ送らない", async () => {
      await mount();
      await openTab("履歴");
      await commit(maxItems(), "10");
      expect(handlers.onApply).not.toHaveBeenCalled();
    });

    it("Enter で欄から離れて確定する。ほかのキーでは確定しない", async () => {
      await mount();
      await openTab("履歴");
      const input = maxItems();
      input.focus();
      await act(async () => {
        input.value = "33";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true })));
      expect(document.activeElement).toBe(input);
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(document.activeElement).not.toBe(input);
      expect(handlers.onApply).toHaveBeenCalledWith("set_history_limit", { maxItems: 33 });
    });

    it("過去の履歴の大きさを変えると、日数と一緒に送る", async () => {
      await mount();
      await openTab("履歴");
      await commit(megabytes(), "50");
      expect(handlers.onApply).toHaveBeenCalledWith("set_archive", { days: 30, maxMb: 50 });
    });

    it("過去の履歴の日数は上限に収めて送る", async () => {
      await mount();
      await openTab("履歴");
      await commit(days(), "5000");
      expect(handlers.onApply).toHaveBeenCalledWith("set_archive", { days: 365, maxMb: 200 });
    });

    it("小数を入れても、実際に使う整数を欄に出す", async () => {
      await mount();
      await openTab("履歴");
      await commit(days(), "30.9");
      expect(handlers.onApply).not.toHaveBeenCalled();
      expect(days().value).toBe("30");
      await commit(megabytes(), "200.5");
      expect(handlers.onApply).not.toHaveBeenCalled();
      expect(megabytes().value).toBe("200");
    });

    it.each([
      ["日数", days],
      ["大きさ", megabytes],
    ])("過去の履歴の%sが読めなければ、送らずに両方を元へ戻す", async (_, field) => {
      await mount();
      await openTab("履歴");
      await act(async () => {
        days().value = "12";
        days().dispatchEvent(new Event("input", { bubbles: true }));
      });
      await commit(field(), "");
      expect(handlers.onApply).not.toHaveBeenCalled();
      expect(days().value).toBe("30");
      expect(megabytes().value).toBe("200");
    });

    it("過去の履歴が変わっていなければ送らない", async () => {
      await mount();
      await openTab("履歴");
      await commit(days(), "30");
      await commit(megabytes(), "200");
      expect(handlers.onApply).not.toHaveBeenCalled();
    });

    it("過去の履歴の欄でも Enter で確定する", async () => {
      await mount();
      await openTab("履歴");
      for (const [input, value] of [
        [days(), "7"],
        [megabytes(), "100"],
      ]) {
        input.focus();
        await act(async () => {
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        expect(document.activeElement).not.toBe(input);
      }
      expect(handlers.onApply).toHaveBeenCalledWith("set_archive", { days: 7, maxMb: 200 });
      expect(handlers.onApply).toHaveBeenLastCalledWith("set_archive", { days: 7, maxMb: 100 });
    });

    it("「次回の起動でも残す」を切り替えられる", async () => {
      await mount();
      await openTab("履歴");
      await click(toggle("次回の起動でも残す"));
      expect(handlers.onApply).toHaveBeenCalledWith("set_history_persist", { persist: false });
    });

    it("保存しない設定では、過去の履歴の欄を押せず、残さないと伝える", async () => {
      await mount({ config: { historyPersist: false } });
      await openTab("履歴");
      expect(days().disabled).toBe(true);
      expect(megabytes().disabled).toBe(true);
      expect($(".setting-note").textContent).toBe("過去の履歴は残しません");
    });

    it("日数が 0 なら、保管中の大きさではなく、残さないと伝える", async () => {
      await mount({ config: { archiveDays: 0 } });
      await openTab("履歴");
      expect(days().disabled).toBe(false);
      expect($(".setting-note").textContent).toBe("過去の履歴は残しません");
    });

    it("設定が読み直されたら、欄も新しい値に追い付く", async () => {
      await mount();
      await openTab("履歴");
      await mount({ config: { historyMaxItems: 42, archiveDays: 9, archiveMaxMb: 77 } });
      await act(async () => {});
      expect(maxItems().value).toBe("42");
      expect(days().value).toBe("9");
      expect(megabytes().value).toBe("77");
    });

    it("データフォルダーを開ける。場所はツールチップで読める", async () => {
      await mount();
      await openTab("履歴");
      const open = button("データフォルダーを開く");
      expect(open.title).toBe("C:/data");
      await click(open);
      expect(handlers.onOpenDataDir).toHaveBeenCalledTimes(1);
    });

    it("貼り付けのスイッチは今と逆の値を渡す", async () => {
      await mount({ settings: { pasteOnSelect: false } });
      await openTab("履歴");
      await click(toggle("選んだら貼り付ける"));
      expect(handlers.onPasteChange).toHaveBeenCalledWith(true);
    });
  });

  describe("起動", () => {
    it("Windows と一緒に起動を切り替える", async () => {
      await mount({ config: { autostart: true } });
      await openTab("起動");
      await click(toggle("Windows と一緒に起動"));
      expect(handlers.onApply).toHaveBeenCalledWith("set_autostart", { enabled: false });
    });

    it("ショートカットを外すと set_hotkey を送る", async () => {
      await mount();
      await openTab("起動");
      await click(button("なし"));
      expect(handlers.onApply).toHaveBeenCalledWith("set_hotkey", { hotkey: "" });
    });
  });

  describe("ウィンドウと情報", () => {
    it("四隅のボタンはそれぞれの隅へ動かす", async () => {
      await mount();
      await openTab("ウィンドウ");
      for (const label of ["左上", "右上", "左下", "右下"]) await click(button(label));
      expect(handlers.onSnap.mock.calls.map(([corner]) => corner)).toEqual([
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]);
    });

    it("標準の大きさに戻せる", async () => {
      await mount();
      await openTab("ウィンドウ");
      await click(button("標準の大きさに戻す"));
      expect(handlers.onResetSize).toHaveBeenCalledTimes(1);
    });

    it("「情報」のリンクは、それぞれの行き先を開く", async () => {
      await mount();
      await openTab("情報");
      for (const label of ["GitHub", "更新を確認", "作者のサイト"]) await click(button(label));
      expect(handlers.onOpenLink.mock.calls.map(([target]) => target)).toEqual(["repo", "releases", "site"]);
    });
  });
});

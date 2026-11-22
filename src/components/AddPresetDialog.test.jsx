// 履歴の行をプリセットに加えるダイアログ。閉じ方と、読み込みに失敗したときの扱いを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { AddPresetDialog } from "./AddPresetDialog.jsx";

let root;
let onSubmit;
let onClose;

async function mount(props = {}) {
  await act(async () =>
    render(
      <AddPresetDialog
        closing={false}
        item={{ text: "\n1行目\n2行目" }}
        folders={[["挨拶"], ["挨拶", "朝"]]}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
        {...props}
      />,
      root,
    ),
  );
}

const $ = (selector) => root.querySelector(selector);
const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

beforeEach(() => {
  onSubmit = vi.fn();
  onClose = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("AddPresetDialog", () => {
  it("加える文字の最初の行を見せ、入れ子のフォルダーも選択肢に出す", async () => {
    await mount();
    expect($(".dialog-quote").textContent).toBe("1行目");
    expect([...root.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["先頭", "挨拶", "挨拶 / 朝"]);
  });

  it("文字が空なら(空)と出す", async () => {
    await mount({ item: { text: " " } });
    expect($(".dialog-quote").textContent).toBe("(空)");
  });

  it("入れ子のフォルダーを選ぶと、その並びで渡す", async () => {
    await mount();
    await act(async () => {
      const select = $("select");
      select.selectedIndex = 2;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => $("form").requestSubmit());
    expect(onSubmit).toHaveBeenCalledWith({ folder: ["挨拶", "朝"], newFolder: null });
  });

  it("新しいフォルダーの名前が空白だけなら、作らない", async () => {
    await mount();
    await act(async () => {
      const input = $('[aria-label="新しいフォルダー"]');
      input.value = "   ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => $("form").requestSubmit());
    expect(onSubmit).toHaveBeenCalledWith({ folder: [], newFolder: null });
  });

  it("✕・取消・外側のどれでも、追加せずに閉じる", async () => {
    await mount();
    await act(async () => $('[aria-label="閉じる"]').click());
    await act(async () => button("取消").click());
    await act(async () => $(".overlay").click());
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ダイアログの中を押しても閉じない", async () => {
    await mount();
    await act(async () => $(".dialog-quote").click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("フォルダーを読めなかったときは理由を出し、追加を押せない", async () => {
    await mount({ error: "読めません" });
    expect($(".status-error").textContent).toBe("読めません");
    expect(button("追加").disabled).toBe(true);
  });

  it("閉じる途中は操作を受け付けない", async () => {
    await mount({ closing: true });
    expect($(".overlay").classList.contains("closing")).toBe(true);
    expect($(".overlay").hasAttribute("inert")).toBe(true);
  });
});

// 行の右クリックメニュー。種類で出す項目が変わり、選ぶか外を押すと閉じる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ItemMenu } from "./ItemMenu.jsx";

let root;
let handlers;

async function mount(item) {
  await act(async () => render(<ItemMenu item={item} x={12} y={34} {...handlers} />, root));
}

const labels = () => [...root.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
const entry = (label) => [...root.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.startsWith(label));

beforeEach(() => {
  handlers = { onFavorite: vi.fn(), onAddPreset: vi.fn(), onRemove: vi.fn(), onClose: vi.fn() };
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("ItemMenu", () => {
  it.each(["image", "files"])("%s の行は、削除だけを出す", async (kind) => {
    await mount({ kind, favorite: false });
    expect(labels()).toEqual(["履歴から削除"]);
  });

  it("お気に入りの追加を選ぶと、追加して閉じる", async () => {
    await mount({ kind: "text", favorite: false });
    entry("お気に入りに追加").click();
    expect(handlers.onFavorite).toHaveBeenCalledWith(true);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("お気に入りの行では、外す操作になる", async () => {
    await mount({ kind: "text", favorite: true });
    entry("お気に入りから外す").click();
    expect(handlers.onFavorite).toHaveBeenCalledWith(false);
  });

  it("プリセットへの追加と削除も、実行してから閉じる", async () => {
    await mount({ kind: "text", favorite: false });
    entry("プリセットに追加").click();
    expect(handlers.onAddPreset).toHaveBeenCalledTimes(1);
    entry("履歴から削除").click();
    expect(handlers.onRemove).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it("メニューの外を押すと、何も実行せずに閉じる", async () => {
    await mount({ kind: "text", favorite: false });
    root.querySelector(".menu-backdrop").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it("メニューの中を押しただけでは閉じない", async () => {
    await mount({ kind: "text", favorite: false });
    root.querySelector(".menu").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("外を右クリックすると、既定のメニューを出さずに閉じる", async () => {
    await mount({ kind: "text", favorite: false });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.querySelector(".menu-backdrop").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("画面の端で切れないよう、位置に上限を付ける。項目の少ないメニューは下へ寄せられる", async () => {
    await mount({ kind: "text", favorite: false });
    const menu = () => root.querySelector(".menu").getAttribute("style");
    expect(menu()).toContain("12px");
    expect(menu()).toContain("8em");
    await mount({ kind: "image", favorite: false });
    expect(menu()).toContain("3em");
  });
});

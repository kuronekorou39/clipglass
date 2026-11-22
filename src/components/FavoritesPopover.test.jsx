// お気に入りの一覧。検索、キーボードでの選択、追加に失敗したときの入力の扱いを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { FavoritesPopover } from "./FavoritesPopover.jsx";

let root;
let onCopy;
let onRemove;
let onAdd;

async function mount(favorites = ["Hello World", "こんにちは", "\n"]) {
  await act(async () =>
    render(<FavoritesPopover favorites={favorites} onCopy={onCopy} onRemove={onRemove} onAdd={onAdd} />, root),
  );
}

const $ = (selector) => root.querySelector(selector);
const rows = () => [...root.querySelectorAll(".favorite-row")];

async function type(element, value) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  onCopy = vi.fn();
  onRemove = vi.fn();
  onAdd = vi.fn(async () => true);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("FavoritesPopover", () => {
  it("開いたら検索欄に入力できる。検索は大文字と小文字を区別しない", async () => {
    await mount();
    const search = $('[aria-label="お気に入りを検索"]');
    expect(document.activeElement).toBe(search);
    await type(search, "  hello ");
    expect(rows().map((row) => row.title)).toEqual(["Hello World"]);
  });

  it("一致しなければそう伝え、検索を消すと全部に戻る", async () => {
    await mount();
    const search = $('[aria-label="お気に入りを検索"]');
    await type(search, "ない言葉");
    expect($(".empty-hint").textContent).toBe("一致するお気に入りがありません");
    await type(search, "");
    expect(rows().length).toBe(3);
    expect($(".empty-hint")).toBeNull();
  });

  it("まだないときは入れ方を案内する", async () => {
    await mount([]);
    expect($(".empty-hint").textContent).toContain("お気に入りに追加");
  });

  it("空行だけの文字は(空)と出す", async () => {
    await mount(["\n"]);
    expect(rows()[0].querySelector(".preset-text").textContent).toBe("(空)");
  });

  it("Enter と Space で選び、ほかのキーでは選ばない", async () => {
    await mount();
    const row = rows()[1];
    for (const key of ["Enter", " ", "x"]) {
      await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(onCopy).toHaveBeenCalledTimes(2);
    expect(onCopy).toHaveBeenCalledWith("こんにちは");
  });

  it("外すボタンで Enter を押しても、コピーにならない", async () => {
    await mount();
    const remove = rows()[0].querySelector('[aria-label="外す"]');
    await act(async () => remove.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("空白だけの文字は追加しない", async () => {
    await mount();
    const form = $("form");
    await type(form.querySelector("input"), "   ");
    expect(form.querySelector("button").disabled).toBe(true);
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("追加に失敗したら、打った文字を残す", async () => {
    onAdd.mockResolvedValue(false);
    await mount();
    const form = $("form");
    await type(form.querySelector("input"), "残す文字");
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(onAdd).toHaveBeenCalledWith("残す文字");
    expect(form.querySelector("input").value).toBe("残す文字");
  });
});

// プリセットの一覧と編集。フォルダーの開閉の記憶と、保存に失敗したときの動きを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { folderKey } from "../presets.js";
import { pathKey } from "../presetView.js";
import { PresetPopover } from "./PresetPopover.jsx";

const VIEW_KEY = "clipglass-preset-view";
const WORK = ["仕事"];
const TEMPLATE = ["仕事", "定型"];
const EMPTY = ["仕事", "空"];

const TREE = [
  {
    name: "仕事",
    path: WORK,
    children: [
      {
        name: "定型",
        path: TEMPLATE,
        children: [{ name: "お礼", path: [...TEMPLATE, "お礼"], text: "ありがとうございます" }],
      },
      { name: "空", path: EMPTY, children: [] },
    ],
  },
  { name: "メモ", path: ["メモ"], text: "本文\n2行目" },
  { name: "そのまま", path: ["そのまま"], text: "そのまま" },
  { name: "プリセット", path: ["プリセット"], text: "   " },
];

let root;
let call;
let handlers;

async function mount(props = {}) {
  await act(async () =>
    render(
      <PresetPopover presets={TREE} visiblePresets={TREE} error={null} query="" call={call} {...handlers} {...props} />,
      root,
    ),
  );
  await act(async () => {});
}

const $ = (selector) => root.querySelector(selector);
const folder = (name) =>
  [...root.querySelectorAll("details.preset-folder")].find(
    (el) => el.querySelector(":scope > summary .preset-name").textContent === name,
  );
const leaf = (text) => [...root.querySelectorAll(".preset-leaf")].find((el) => el.textContent.includes(text));
const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const savedView = () => JSON.parse(localStorage.getItem(VIEW_KEY));

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await act(async () => {});
}

async function type(element, value) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(select, value) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submit(form) {
  await act(async () => form.requestSubmit());
  await act(async () => {});
}

/** 利用者が <summary> を押してフォルダーを開閉したときのように、toggle を起こす。 */
async function toggleFolder(element, open) {
  await act(async () => {
    element.open = open;
    element.dispatchEvent(new Event("toggle"));
  });
}

beforeEach(() => {
  localStorage.clear();
  call = vi.fn(async (command, args) => {
    if (command === "update_preset") return { ok: true, value: [...args.path.slice(0, -1), args.name ?? "自動"] };
    return { ok: true, value: null };
  });
  handlers = { onQueryChange: vi.fn(), onCopy: vi.fn(), onReload: vi.fn(), onRevealFile: vi.fn() };
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("PresetPopover: 一覧", () => {
  it("開いたら検索欄に入力でき、打った語を渡す", async () => {
    await mount();
    const search = $('[aria-label="プリセットを検索"]');
    expect(document.activeElement).toBe(search);
    await type(search, "お礼");
    expect(handlers.onQueryChange).toHaveBeenCalledWith("お礼");
  });

  it("行には文字を出し、説明は付けたときだけ添える。空の文字は(空)と出す", async () => {
    await mount();
    expect(leaf("本文").querySelector(".preset-text").textContent).toBe("本文");
    expect(leaf("本文").querySelector(".preset-desc").textContent).toBe("メモ");
    expect(leaf("そのまま").querySelector(".preset-desc")).toBeNull();
    expect(leaf("(空)")).toBeTruthy();
  });

  it("フォルダーには入れ子も含めた件数を出し、空のフォルダーはそう書く", async () => {
    await mount();
    expect(folder("仕事").querySelector(":scope > summary .preset-count").textContent).toBe("1件");
    expect(folder("空").querySelector(".preset-empty").textContent).toBe("空のフォルダー");
  });

  it("行はクリックと Enter と Space でコピーし、ほかのキーでは何もしない", async () => {
    await mount();
    const row = leaf("本文");
    await click(row);
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true })));
    expect(handlers.onCopy).toHaveBeenCalledTimes(3);
    expect(handlers.onCopy).toHaveBeenCalledWith(["メモ"]);
  });

  it("行の編集ボタンで Enter を押しても、コピーにならない", async () => {
    await mount();
    const edit = leaf("本文").querySelector('[aria-label="編集"]');
    await act(async () => edit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(handlers.onCopy).not.toHaveBeenCalled();
  });

  it("閉じたフォルダーを覚えて、開き直しても閉じたままにする", async () => {
    await mount();
    await toggleFolder(folder("定型"), false);
    expect(savedView().collapsed).toEqual([pathKey(TEMPLATE)]);
    render(null, root);
    await mount();
    expect(folder("定型").open).toBe(false);
    await toggleFolder(folder("定型"), true);
    expect(savedView().collapsed).toEqual([]);
  });

  it("中のフォルダーを全部閉じる・全部開く。親は開いたままで、コピーもしない", async () => {
    await mount();
    const tools = folder("仕事").querySelector(":scope > summary .row-tools");
    await click(tools.querySelector('[aria-label="全部閉じる"]'));
    expect(savedView().collapsed.sort()).toEqual([pathKey(TEMPLATE), pathKey(EMPTY)].sort());
    expect(folder("定型").open).toBe(false);
    expect(folder("仕事").open).toBe(true);
    await click(tools.querySelector('[aria-label="全部開く"]'));
    expect(savedView().collapsed).toEqual([]);
    expect(folder("定型").open).toBe(true);
    expect(handlers.onCopy).not.toHaveBeenCalled();
  });

  it("入れ子のないフォルダーには、全部開く・閉じるを出さない", async () => {
    await mount();
    expect(folder("定型").querySelector('[aria-label="全部開く"]')).toBeNull();
    expect(folder("定型").querySelector('[aria-label="編集"]')).toBeTruthy();
  });

  it("検索中は閉じたフォルダーも開いて見せ、閉じた記憶は変えない", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ collapsed: [pathKey(TEMPLATE)], scroll: 0 }));
    await mount({ query: "お礼" });
    expect(folder("定型").open).toBe(true);
    await toggleFolder(folder("定型"), false);
    expect(savedView().collapsed).toEqual([pathKey(TEMPLATE)]);
  });

  it("前回のスクロール位置へ戻し、動かしたら覚える", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ collapsed: [], scroll: 80 }));
    await mount();
    const body = $(".popover-body");
    expect(body.scrollTop).toBe(80);
    body.scrollTop = 150;
    await act(async () => body.dispatchEvent(new Event("scroll")));
    expect(savedView().scroll).toBe(150);
  });

  it("読み込みに失敗したら理由を出し、追加のボタンを押せなくする", async () => {
    await mount({ presets: [], visiblePresets: [], error: "読めません" });
    expect($(".status-error").textContent).toBe("読めません");
    expect(button("フォルダー").disabled).toBe(true);
    expect(button("プリセット").disabled).toBe(true);
    // 失敗を「まだない」と言わない
    expect($(".empty-hint")).toBeNull();
    // 場所は開ける
    expect(button("場所").disabled).toBe(false);
  });

  it("空のときは追加のしかたを、検索で外れたときはそのことを伝える", async () => {
    await mount({ presets: [], visiblePresets: [] });
    expect($(".empty-hint").textContent).toContain("追加できます");
    render(null, root);
    await mount({ visiblePresets: [], query: "ない" });
    expect($(".empty-hint").textContent).toBe("一致するプリセットがありません");
  });
});

describe("PresetPopover: 編集", () => {
  const editLeaf = async (text) => click(leaf(text).querySelector('[aria-label="編集"]'));
  const editor = () => $("form.preset-editor");

  it("取消で一覧に戻り、何も送らない", async () => {
    await mount();
    await editLeaf("本文");
    await click(button("取消"));
    expect(editor()).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(handlers.onReload).not.toHaveBeenCalled();
    // 検索欄へ戻す
    expect(document.activeElement).toBe($('[aria-label="プリセットを検索"]'));
  });

  it("上へ・下へで並びを変え、編集は開いたままにする", async () => {
    await mount();
    await editLeaf("本文");
    await click($('[aria-label="上へ"]'));
    expect(call).toHaveBeenLastCalledWith("reorder_preset", { path: ["メモ"], offset: -1 });
    await click($('[aria-label="下へ"]'));
    expect(call).toHaveBeenLastCalledWith("reorder_preset", { path: ["メモ"], offset: 1 });
    expect(handlers.onReload).toHaveBeenCalledTimes(2);
    expect(editor()).toBeTruthy();
  });

  it("何も変えずに保存したら、コマンドを送らず一覧に戻る", async () => {
    await mount();
    await editLeaf("本文");
    await submit(editor());
    expect(call).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
  });

  it("場所だけを変えたら、移動だけを送る", async () => {
    await mount();
    await editLeaf("本文");
    await choose(editor().querySelector("select"), folderKey(TEMPLATE));
    await submit(editor());
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("move_preset", { path: ["メモ"], folder: TEMPLATE });
    expect(editor()).toBeNull();
  });

  it("説明を消すと、名前を文字から作らせる(null を送る)", async () => {
    await mount();
    await editLeaf("本文");
    await type(editor().querySelector('[aria-label="説明"]'), "  ");
    await submit(editor());
    expect(call).toHaveBeenCalledWith("update_preset", { path: ["メモ"], name: null, text: "本文\n2行目" });
  });

  it("フォルダーの名前の変更では、文字を null で送る", async () => {
    await mount();
    await click(folder("定型").querySelector(':scope > summary [aria-label="編集"]'));
    await type(editor().querySelector('[aria-label="名前"]'), "定型文");
    await submit(editor());
    expect(call).toHaveBeenCalledWith("update_preset", { path: TEMPLATE, name: "定型文", text: null });
  });

  it("フォルダーの移し先に、自分とその中は出さない", async () => {
    await mount();
    await click(folder("仕事").querySelector(':scope > summary [aria-label="編集"]'));
    expect([...editor().querySelectorAll("option")].map((o) => o.textContent)).toEqual(["先頭"]);
  });

  it("保存に失敗したら、編集を閉じず読み直しもしない", async () => {
    call.mockResolvedValue({ ok: false });
    await mount();
    await editLeaf("本文");
    await type(editor().querySelector('[aria-label="文字"]'), "変更");
    await submit(editor());
    expect(call).not.toHaveBeenCalledWith("move_preset", expect.anything());
    expect(editor()).toBeTruthy();
    expect(handlers.onReload).not.toHaveBeenCalled();
  });

  it("名前は変わったのに移動に失敗したら、編集は残して一覧を読み直す", async () => {
    call.mockImplementation(async (command) =>
      command === "move_preset" ? { ok: false } : { ok: true, value: ["新しい説明"] },
    );
    await mount();
    await editLeaf("本文");
    await type(editor().querySelector('[aria-label="説明"]'), "新しい説明");
    await choose(editor().querySelector("select"), folderKey(TEMPLATE));
    await submit(editor());
    // 移動は、名前を変えたあとのパスで行う
    expect(call).toHaveBeenCalledWith("move_preset", { path: ["新しい説明"], folder: TEMPLATE });
    expect(editor()).toBeTruthy();
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
  });

  it("名前の変更後に移動だけ失敗したら、再保存は新しいパスで移動だけを送り、移す先も保つ", async () => {
    let moves = 0;
    call.mockImplementation(async (command) => {
      if (command === "move_preset") return { ok: ++moves > 1, value: [...TEMPLATE, "新しい説明"] };
      return { ok: true, value: ["新しい説明"] };
    });
    await mount();
    await editLeaf("本文");
    await type(editor().querySelector('[aria-label="説明"]'), "新しい説明");
    await choose(editor().querySelector("select"), folderKey(TEMPLATE));
    await submit(editor());
    expect(editor().querySelector("select").value).toBe(folderKey(TEMPLATE));
    call.mockClear();

    await submit(editor());

    expect(call).not.toHaveBeenCalledWith("update_preset", expect.anything());
    expect(call).toHaveBeenCalledWith("move_preset", { path: ["新しい説明"], folder: TEMPLATE });
    expect(editor()).toBeNull();
  });

  it("削除は確かめてから行い、終わったら一覧に戻る", async () => {
    await mount();
    await editLeaf("本文");
    await click($('[aria-label="削除"]'));
    expect(call).not.toHaveBeenCalled();
    await click(button("削除する"));
    expect(call).toHaveBeenCalledWith("remove_preset", { path: ["メモ"] }, "削除しました");
    expect(editor()).toBeNull();
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
  });

  it("削除に失敗したら、編集を閉じない", async () => {
    call.mockResolvedValue({ ok: false });
    await mount();
    await editLeaf("本文");
    await click($('[aria-label="削除"]'));
    await click(button("削除する"));
    expect(editor()).toBeTruthy();
    expect(handlers.onReload).not.toHaveBeenCalled();
  });

  it("作成に失敗したら、入力を残す", async () => {
    call.mockResolvedValue({ ok: false });
    await mount();
    await click(button("プリセット"));
    await type(editor().querySelector('[aria-label="文字"]'), "新しい文字");
    await submit(editor());
    expect(editor().querySelector('[aria-label="文字"]').value).toBe("新しい文字");
    expect(handlers.onReload).not.toHaveBeenCalled();
  });

  it("新しいプリセットは、選んだ場所に説明付きで作る", async () => {
    await mount();
    await click(button("プリセット"));
    await choose(editor().querySelector("select"), folderKey(TEMPLATE));
    await type(editor().querySelector('[aria-label="文字"]'), "本文");
    await type(editor().querySelector('[aria-label="説明"]'), " 説明 ");
    await submit(editor());
    expect(call).toHaveBeenCalledWith("create_preset", { folder: TEMPLATE, name: "説明", text: "本文" }, "作成しました");
  });

  it("文字欄の Enter は改行のままで、Ctrl+Enter で保存する", async () => {
    await mount();
    await click(button("プリセット"));
    const text = editor().querySelector('[aria-label="文字"]');
    await type(text, "本文");
    await act(async () => text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(call).not.toHaveBeenCalled();
    await act(async () =>
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })),
    );
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("create_preset", { folder: [], name: null, text: "本文" }, "作成しました");
  });

  it("文字が空のあいだは、Ctrl+Enter でも保存しない", async () => {
    await mount();
    await click(button("プリセット"));
    const text = editor().querySelector('[aria-label="文字"]');
    await type(text, "   ");
    expect(button("保存").disabled).toBe(true);
    await act(async () =>
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })),
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("「場所」でファイルの場所を開く", async () => {
    await mount();
    await click(button("場所"));
    expect(handlers.onRevealFile).toHaveBeenCalledTimes(1);
  });
});

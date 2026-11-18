// 本体の横の別ウィンドウ(プリセット・お気に入り)を描画して、操作で送るコマンドを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

const PRESETS = [{ name: "挨拶", path: ["挨拶"], children: [{ name: "朝", path: ["挨拶", "朝"], text: "おはようございます" }] }];
const FAVORITES = ["よく使う文字", "2行ある\nお気に入り"];

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

let root;

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

/** Rust が別ウィンドウの中身を切り替える(閉じるときは null)。 */
async function show(kind) {
  await act(async () => listeners.get("panel")({ payload: kind }));
  await act(async () => {});
}

const $ = (selector) => root.querySelector(selector);
const dialog = (label) => $(`[role="dialog"][aria-label="${label}"]`);
const presetsFooterButton = (label) =>
  [...root.querySelectorAll(".presets-footer button")].find((b) => b.textContent.includes(label));

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "get_panel") return null;
    if (command === "get_presets") return PRESETS;
    if (command === "get_favorites") return FAVORITES;
    if (command === "update_preset") return [...args.path.slice(0, -1), args.name ?? args.text];
    if (command === "move_preset") return [...args.folder, args.path.at(-1)];
    if (command === "create_preset" || command === "create_preset_folder") {
      return [...args.folder, args.name ?? args.text];
    }
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

describe("Panel", () => {
  it("中身は Rust からの知らせで切り替わり、閉じると消える", async () => {
    expect(invoke).toHaveBeenCalledWith("get_panel");
    expect(dialog("プリセット")).toBeNull();
    await show("presets");
    expect(dialog("プリセット")).toBeTruthy();
    expect(root.textContent).toContain("朝");
    await show("favorites");
    expect(dialog("プリセット")).toBeNull();
    expect(dialog("お気に入り")).toBeTruthy();
    await show(null);
    expect(dialog("お気に入り")).toBeNull();
  });

  it("Esc で閉じる", async () => {
    await show("presets");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(invoke).toHaveBeenCalledWith("close_panel");
  });

  it("本体と同じ色合いと文字サイズを使い、本体で変えたら追い付く", async () => {
    localStorage.setItem("clipglass-settings", JSON.stringify({ theme: "light", fontSize: 18 }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage")));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("18px");
  });

  it("お気に入りはフォルダーなしで並ぶ。選ぶとコピーして貼り付け、通知は出さずに閉じる", async () => {
    await show("favorites");
    const popover = dialog("お気に入り");
    const rows = [...popover.querySelectorAll(".favorite-row")];
    // 複数行の文字は1行目を出す
    expect(rows.map((row) => row.querySelector(".preset-text").textContent)).toEqual(["よく使う文字", "2行ある"]);
    expect(popover.querySelector("details")).toBeNull();
    await type(popover.querySelector('[aria-label="お気に入りを検索"]'), "2行");
    expect(popover.querySelectorAll(".favorite-row").length).toBe(1);
    await click(popover.querySelector(".favorite-row"));
    expect(invoke).toHaveBeenCalledWith("copy_favorite", { text: "2行ある\nお気に入り", paste: true });
    expect(invoke).toHaveBeenLastCalledWith("close_panel");
    expect($(".toast")).toBeNull();
  });

  it("設定で貼り付けを止めていれば、コピーだけにする", async () => {
    localStorage.setItem("clipglass-settings", JSON.stringify({ pasteOnSelect: false }));
    await show("presets");
    await click($(".preset-leaf"));
    expect(invoke).toHaveBeenCalledWith("copy_preset", { path: ["挨拶", "朝"], paste: false });
  });

  it("お気に入りは、その場で外したり、文字を入れて足したりできる", async () => {
    await show("favorites");
    const popover = dialog("お気に入り");
    await click(popover.querySelector('[aria-label="外す"]'));
    expect(invoke).toHaveBeenCalledWith("remove_favorite", { text: "よく使う文字" });
    // 外すボタンではコピーしない
    expect(invoke).not.toHaveBeenCalledWith("copy_favorite", expect.anything());
    const form = popover.querySelector("form");
    expect(form.querySelector("button").disabled).toBe(true);
    await type(form.querySelector("input"), "新しい文字");
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("add_favorite", { text: "新しい文字" });
    expect(form.querySelector("input").value).toBe("");
  });

  it("プリセットをコピーすると閉じる", async () => {
    await show("presets");
    await click($(".preset-leaf"));
    expect(invoke).toHaveBeenCalledWith("copy_preset", { path: ["挨拶", "朝"], paste: true });
    expect(invoke).toHaveBeenLastCalledWith("close_panel");
  });

  it("コピーに失敗したら閉じずに知らせる", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "get_presets") return PRESETS;
      if (command === "copy_preset") throw "書き込めません";
      return null;
    });
    await show("presets");
    await click($(".preset-leaf"));
    expect($(".toast").textContent).toBe("書き込めません");
    expect(invoke).not.toHaveBeenCalledWith("close_panel");
  });

  it("プリセットを編集して、名前と文字の変更とフォルダーの移動を送る", async () => {
    await show("presets");
    await click($('.preset-leaf [aria-label="編集"]'));
    // 編集を始めてもコピーしない
    expect(invoke).not.toHaveBeenCalledWith("copy_preset", expect.anything());
    const form = $('form[aria-label="プリセットを編集"]');
    // 編集中も一覧は見えていて、編集中の行に印が付く
    expect($(".preset-leaf.editing").textContent).toContain("朝");
    // 値(文字)が先で、説明はそのあと
    const fields = [...form.querySelectorAll("textarea, input")].map((el) => el.getAttribute("aria-label"));
    expect(fields.indexOf("文字")).toBeLessThan(fields.indexOf("説明"));
    await type(form.querySelector('[aria-label="説明"]'), "おはよう");
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
    await show("presets");
    // 下部は「フォルダー」が先、「プリセット」が後
    const footerLabels = [...root.querySelectorAll(".presets-footer button")].map((b) => b.textContent.trim());
    expect(footerLabels.indexOf("フォルダー")).toBeLessThan(footerLabels.indexOf("プリセット"));
    await click(presetsFooterButton("プリセット"));
    const form = $('form[aria-label="プリセットを作成"]');
    // 作成中も元のプリセットは隠れない
    expect($(".preset-leaf").textContent).toContain("朝");
    // 新規作成では入れる場所(フォルダー)が、文字より先に来る
    const order = [...form.querySelectorAll("select, textarea")].map((el) => el.getAttribute("aria-label"));
    expect(order.indexOf("入れる場所")).toBeLessThan(order.indexOf("文字"));
    // 説明は任意。文字だけで作れる
    await type(form.querySelector('[aria-label="文字"]'), "山田\n太郎");
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("create_preset", { folder: [], name: null, text: "山田\n太郎" });

    await act(async () => {});
    await click(presetsFooterButton("フォルダー"));
    const folderForm = $('form[aria-label="フォルダーを作成"]');
    expect(folderForm.querySelector("textarea")).toBeNull();
    await type(folderForm.querySelector('[aria-label="名前"]'), "仕事");
    await act(async () => folderForm.requestSubmit());
    expect(invoke).toHaveBeenCalledWith("create_preset_folder", { folder: [], name: "仕事" });
  });

  it("フォルダーは自分の中へ移す先を選べず、削除は確かめてから行う", async () => {
    await show("presets");
    await click($('.preset-folder [aria-label="編集"]'));
    const form = $('form[aria-label="フォルダーを編集"]');
    expect([...form.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["先頭"]);
    await click(form.querySelector('[aria-label="削除"]'));
    expect(invoke).not.toHaveBeenCalledWith("remove_preset", expect.anything());
    await click([...form.querySelectorAll("button")].find((b) => b.textContent === "中身ごと削除"));
    expect(invoke).toHaveBeenCalledWith("remove_preset", { path: ["挨拶"] });
  });

  it("プリセットのファイルの場所をエクスプローラーで表示できる", async () => {
    await show("presets");
    const buttons = [...root.querySelectorAll(".presets-footer button")];
    expect(buttons.map((b) => b.textContent)).not.toContain("ファイル");
    await click(buttons.find((b) => b.textContent === "場所"));
    expect(invoke).toHaveBeenCalledWith("reveal_presets_file", undefined);
  });
});

// 履歴の1行。種類と「今の中身かどうか」で出すものが変わるので、操作の結果を行ごとに確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { HistoryItem } from "./HistoryItem.jsx";

const RICH = ["HTML Format", "Rich Text Format", "CF_UNICODETEXT"];

const BASE = {
  id: 7,
  kind: "text",
  text: "本文",
  charCount: 1234,
  truncated: false,
  width: null,
  height: null,
  paths: null,
  formats: ["CF_UNICODETEXT"],
  storedRich: [],
  favorite: false,
  updatedAt: new Date(2026, 10, 9, 8, 5, 3).getTime(),
};

let root;
let onCopy;
let onSave;
let onMenu;

async function mount(item, props = {}) {
  await act(async () =>
    render(
      <HistoryItem
        item={{ ...BASE, ...item }}
        current={false}
        quickKey={null}
        wrap={false}
        saving={false}
        onCopy={onCopy}
        onSave={onSave}
        onMenu={onMenu}
        {...props}
      />,
      root,
    ),
  );
  return root.querySelector(".item");
}

const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.includes(label));
const dataText = () => root.querySelector("details.item-data").textContent;

beforeEach(() => {
  onCopy = vi.fn();
  onSave = vi.fn();
  onMenu = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("HistoryItem", () => {
  it("過去の行はクリックと Enter と Space でコピーし、ほかのキーでは何もしない", async () => {
    const row = await mount({});
    row.click();
    expect(onCopy).toHaveBeenLastCalledWith(false);
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      // Space でページが動かないよう、既定の動きを止める
      expect(event.defaultPrevented).toBe(true);
    }
    expect(onCopy).toHaveBeenCalledTimes(3);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(onCopy).toHaveBeenCalledTimes(3);
  });

  it("行の中の部品で Enter を押しても、行のコピーにならない", async () => {
    await mount({ storedRich: RICH });
    button("文字だけ").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("右クリックは既定のメニューを止めて、押した位置を渡す", async () => {
    const row = await mount({});
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onMenu).toHaveBeenCalledWith({ x: 30, y: 40 });
  });

  it("書式を持つ過去の行は「文字だけ」でコピーでき、行のクリックにはならない", async () => {
    const row = await mount({ storedRich: RICH });
    expect(row.title).toContain("書式ごとコピー");
    button("文字だけ").click();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(true);
  });

  it("書式を持たない行には「文字だけ」を出さない", async () => {
    const row = await mount({});
    expect(row.title).not.toContain("書式ごと");
    expect(button("文字だけ")).toBeUndefined();
  });

  it("今の中身の行は、クリックしてもコピーし直さず、全文を出す", async () => {
    const row = await mount({ text: "1行目\n2行目" }, { current: true, wrap: true });
    row.click();
    expect(onCopy).not.toHaveBeenCalled();
    expect(row.classList.contains("current")).toBe(true);
    const text = row.querySelector("pre.preview-text");
    expect(text.textContent).toBe("1行目\n2行目");
    expect(text.classList.contains("wrap")).toBe(true);
  });

  it("折り返さない設定では、今の中身の文を折り返さない", async () => {
    const row = await mount({}, { current: true, wrap: false });
    expect(row.querySelector("pre.preview-text").classList.contains("wrap")).toBe(false);
  });

  it("今の中身が書式付きなら「文字だけにする」、外したあとは「書式付きに戻す」を出す", async () => {
    await mount({ formats: RICH, storedRich: RICH }, { current: true });
    expect(button("書式付きに戻す")).toBeUndefined();
    button("文字だけにする").click();
    expect(onCopy).toHaveBeenLastCalledWith(true);

    await mount({ formats: ["CF_UNICODETEXT"], storedRich: RICH }, { current: true });
    expect(button("文字だけにする")).toBeUndefined();
    button("書式付きに戻す").click();
    expect(onCopy).toHaveBeenLastCalledWith(false);
  });

  it("今の中身の画像は全体を出し、保存できる。保存中は押せない", async () => {
    const row = await mount({ kind: "image", text: null, width: 640, height: 480 }, { current: true });
    expect(row.querySelector("img").getAttribute("src")).toBe("http://clipimg.localhost/full/7");
    button("画像を保存").click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(dataText()).toContain("640 × 480 px");
    await mount({ kind: "image", text: null, width: 640, height: 480 }, { current: true, saving: true });
    expect(button("画像を保存").disabled).toBe(true);
  });

  it("過去の画像はサムネイルで出し、保存を押しても行のコピーにならない", async () => {
    const row = await mount({ kind: "image", text: null, width: 10, height: 20 });
    expect(row.querySelector("img").getAttribute("src")).toBe("http://clipimg.localhost/thumb/7");
    const save = row.querySelector('button[title="画像をPNGファイルとして保存"]');
    // 狭い行では文字を省く
    expect(save.textContent).toBe("↓");
    save.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("今の中身のファイルは5件まで名前を出し、残りは件数にまとめる", async () => {
    const paths = ["a", "b", "c", "d", "e", "f", "g"].map((name) => `C:\\work\\${name}.txt`);
    const row = await mount({ kind: "files", text: null, paths }, { current: true });
    const names = [...row.querySelectorAll(".file-names li")].map((li) => li.textContent);
    expect(names).toEqual(["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "ほか 2件"]);
    // 全体のパスはツールチップで読める
    expect(row.querySelector(".file-names li").title).toBe("C:\\work\\a.txt");
    expect(dataText()).toContain("ファイル 7件");
  });

  it("過去のファイルの行は1件だけ名前を出す。1件なら「ほか」は出さない", async () => {
    let row = await mount({ kind: "files", text: null, paths: ["C:/x/one.txt", "C:/x/two.txt"] });
    expect([...row.querySelectorAll(".file-names li")].map((li) => li.textContent)).toEqual(["one.txt", "ほか 1件"]);
    row = await mount({ kind: "files", text: null, paths: ["C:/x/one.txt"] });
    expect(row.querySelector(".file-rest")).toBeNull();
  });

  it("「データ」に文字数と時刻を出し、一部だけのときはそう書く", async () => {
    await mount({ truncated: true });
    expect(dataText()).toContain(`${(1234).toLocaleString()}文字(一部のみ表示)`);
    expect(dataText()).toContain("08:05:03");
    expect(dataText()).toContain("CF_UNICODETEXT");
  });

  it("形式の情報がなければ「なし」と出す", async () => {
    await mount({ formats: [] });
    expect(root.querySelector(".format-names").textContent).toBe("なし");
  });

  it("書式の印は、今の行は今の形式、過去の行は選び直したときに入る形式で決める", async () => {
    await mount({ formats: ["CF_UNICODETEXT"], storedRich: ["HTML Format"] });
    expect(root.querySelector(".badge-rich").textContent).toBe("書式付き HTML");
    // 文字だけにしたあとの今の行には、書式の印を出さない
    await mount({ formats: ["CF_UNICODETEXT"], storedRich: ["HTML Format"] }, { current: true });
    expect(root.querySelector(".badge-rich")).toBeNull();
    await mount({ formats: RICH, storedRich: RICH }, { current: true });
    expect(root.querySelector(".badge-rich").textContent).toBe("書式付き HTML・RTF");
  });

  it("書式の項目は、書式を表す形式がないときは見出しごと出さない", async () => {
    await mount({ storedRich: ["CF_TEXT"] });
    const headings = [...root.querySelectorAll(".item-data dt")].map((dt) => dt.textContent);
    expect(headings).toContain("書式");
    expect(root.querySelector(".badge-rich")).toBeNull();
    await mount({ storedRich: [] });
    expect([...root.querySelectorAll(".item-data dt")].map((dt) => dt.textContent)).not.toContain("書式");
  });

  it("数字キーの印は番号があるときだけ出し、なければ幅だけ空ける", async () => {
    await mount({}, { quickKey: 3 });
    expect(root.querySelector(".item-key kbd").textContent).toBe("3");
    expect(root.querySelector(".item-key").getAttribute("aria-hidden")).toBeNull();
    await mount({}, { quickKey: null });
    expect(root.querySelector(".item-key kbd")).toBeNull();
    expect(root.querySelector(".item-key").getAttribute("aria-hidden")).toBe("true");
  });
});

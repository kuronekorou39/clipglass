// 過去の履歴。開いたときだけ読み、古い問い合わせの結果で新しい結果を上書きしない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ArchiveList } from "./ArchiveList.jsx";

const SEARCH_DELAY_MS = 250;
const KINDS = ["text", "image", "files"];

function archived(key, day, extra = {}) {
  return {
    key: `${day}/${key}`,
    day,
    kind: "text",
    text: `内容${key}`,
    charCount: 3,
    truncated: false,
    width: null,
    height: null,
    paths: null,
    imageHash: null,
    updatedAt: new Date(2026, 10, 9, 1, 2, 3).getTime(),
    ...extra,
  };
}

let root;
let load;
let onRestore;
let onRemove;

async function mount(props = {}) {
  await act(async () =>
    render(
      <ArchiveList
        query=""
        kinds={KINDS}
        searching={false}
        load={load}
        onRestore={onRestore}
        onRemove={onRemove}
        {...props}
      />,
      root,
    ),
  );
}

const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const rows = () => [...root.querySelectorAll(".item.archived")];
const texts = () => rows().map((row) => row.querySelector(".item-text").textContent);

/** 検索語の入力が落ち着くのを待って、読み込みまで済ませる。 */
async function wait(ms = SEARCH_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function open() {
  await act(async () => button("過去の履歴を見る").click());
  await wait();
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  load = vi.fn(async () => ({ items: [archived(1, "2026-11-09")], hasMore: false }));
  onRestore = vi.fn(async () => true);
  onRemove = vi.fn(async () => true);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

describe("ArchiveList", () => {
  it("閉じているあいだは読まず、検索中はボタンの文言が変わる", async () => {
    await mount({ searching: true });
    await wait();
    expect(load).not.toHaveBeenCalled();
    expect(button("過去の履歴も探す")).toBeTruthy();
  });

  it("閉じるボタンで畳むと、行が見えなくなる", async () => {
    await mount();
    await open();
    expect(rows().length).toBe(1);
    await act(async () => button("過去の履歴を閉じる").click());
    expect(rows().length).toBe(0);
    expect(button("過去の履歴を見る")).toBeTruthy();
  });

  it("同じ日の行には見出しを1つだけ入れる", async () => {
    load.mockResolvedValue({
      items: [archived(3, "2026-11-09"), archived(2, "2026-11-09"), archived(1, "2026-11-08")],
      hasMore: false,
    });
    await mount();
    await open();
    expect(root.querySelectorAll(".archive-day").length).toBe(2);
    expect(rows().length).toBe(3);
  });

  it("画像は保管した日とハッシュからサムネイルを出す", async () => {
    load.mockResolvedValue({
      items: [archived(1, "2026-11-09", { kind: "image", text: null, imageHash: "00ab" })],
      hasMore: false,
    });
    await mount();
    await open();
    expect(rows()[0].querySelector("img").getAttribute("src")).toBe(
      "http://clipimg.localhost/archive/2026-11-09/00ab",
    );
  });

  it("ファイルは先頭の名前と、残りの件数を出す", async () => {
    load.mockResolvedValue({
      items: [archived(1, "2026-11-09", { kind: "files", text: null, paths: ["C:/a/one.txt", "C:/a/two.txt"] })],
      hasMore: false,
    });
    await mount();
    await open();
    const names = [...rows()[0].querySelectorAll(".file-names li")].map((li) => li.textContent);
    expect(names).toEqual(["one.txt", "ほか 1件"]);
  });

  it("何もなければ、ふだんと検索中でそれぞれの案内を出す", async () => {
    load.mockResolvedValue({ items: [], hasMore: false });
    await mount();
    await open();
    expect(root.querySelector(".empty-hint").textContent).toBe("過去の履歴はまだありません");
    await mount({ searching: true, query: "x" });
    await wait();
    expect(root.querySelector(".empty-hint").textContent).toBe("過去の履歴に一致する項目はありません");
  });

  it("開いてから読み終わるまでは「まだありません」と出さない", async () => {
    const pending = deferred();
    load.mockReturnValue(pending.promise);
    await mount();
    await act(async () => button("過去の履歴を見る").click());
    expect(root.querySelector(".empty-hint")).toBeNull();
    await wait();
    expect(root.querySelector(".empty-hint")).toBeNull();
    await act(async () => pending.resolve({ items: [], hasMore: false }));
    expect(root.querySelector(".empty-hint").textContent).toBe("過去の履歴はまだありません");
  });

  it("読み込みに失敗したら理由を出し、「まだありません」とは言わない", async () => {
    load.mockRejectedValue("読めません");
    await mount();
    await open();
    expect(root.querySelector(".status-error").textContent).toContain("読めません");
    expect(root.querySelector(".empty-hint")).toBeNull();
    expect(button("読み込み中…")).toBeUndefined();
  });

  it("続きの読み込みに失敗しても、読めた行は残してもう一度試せる", async () => {
    load.mockResolvedValueOnce({ items: [archived(2, "2026-11-09")], hasMore: true });
    load.mockRejectedValueOnce("読めません");
    load.mockResolvedValueOnce({ items: [archived(1, "2026-11-09")], hasMore: false });
    await mount();
    await open();
    await act(async () => button("さらに読み込む").click());
    expect(root.querySelector(".status-error")).toBeTruthy();
    expect(rows().length).toBe(1);
    await act(async () => button("さらに読み込む").click());
    expect(root.querySelector(".status-error")).toBeNull();
    expect(rows().length).toBe(2);
  });

  it("Enter と Space で一覧に戻し、ほかのキーでは戻さない", async () => {
    load.mockResolvedValue({ items: [archived(2, "2026-11-09"), archived(1, "2026-11-09")], hasMore: false });
    await mount();
    await open();
    await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    expect(onRestore).not.toHaveBeenCalled();
    await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual(["内容1"]);
    await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(rows().length).toBe(0);
  });

  it("✕ で Enter を押しても、一覧に戻す操作にならない", async () => {
    await mount();
    await open();
    const remove = root.querySelector('[aria-label="過去の履歴から削除"]');
    await act(async () => remove.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("✕ は押した行だけを消し、ほかの行は残す", async () => {
    load.mockResolvedValue({ items: [archived(2, "2026-11-09"), archived(1, "2026-11-09")], hasMore: false });
    await mount();
    await open();
    await act(async () => rows()[1].querySelector('[aria-label="過去の履歴から削除"]').click());
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ key: "2026-11-09/1" }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(texts()).toEqual(["内容2"]);
  });

  it("戻すのに失敗したら、行を残す", async () => {
    onRestore.mockResolvedValue(false);
    await mount();
    await open();
    await act(async () => rows()[0].click());
    expect(rows().length).toBe(1);
  });

  it("消すのに失敗したら、行を残す", async () => {
    onRemove.mockResolvedValue(false);
    await mount();
    await open();
    await act(async () => root.querySelector('[aria-label="過去の履歴から削除"]').click());
    expect(rows().length).toBe(1);
  });

  it("続きは今の件数から読み、後ろに足す。読み込み中はもう一度押せない", async () => {
    load.mockResolvedValueOnce({ items: [archived(2, "2026-11-09")], hasMore: true });
    await mount();
    await open();
    const next = deferred();
    load.mockReturnValueOnce(next.promise);
    await act(async () => button("さらに読み込む").click());
    expect(load).toHaveBeenLastCalledWith({ query: "", kinds: KINDS, offset: 1, limit: 50 });
    expect(button("読み込み中…").disabled).toBe(true);
    await act(async () => next.resolve({ items: [archived(1, "2026-11-09")], hasMore: false }));
    expect(texts()).toEqual(["内容2", "内容1"]);
    expect(button("さらに読み込む")).toBeUndefined();
  });

  it("行を消したあとの続きは、減った件数から読む", async () => {
    load.mockResolvedValueOnce({ items: [archived(3, "2026-11-09"), archived(2, "2026-11-09")], hasMore: true });
    await mount();
    await open();
    await act(async () => rows()[0].querySelector('[aria-label="過去の履歴から削除"]').click());
    load.mockResolvedValueOnce({ items: [archived(1, "2026-11-09")], hasMore: false });
    await act(async () => button("さらに読み込む").click());
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }));
    expect(texts()).toEqual(["内容2", "内容1"]);
  });

  it("検索語を打っているあいだは待ち、最後の語で1回だけ読む", async () => {
    await mount({ query: "a" });
    await act(async () => button("過去の履歴を見る").click());
    await wait(SEARCH_DELAY_MS - 1);
    await mount({ query: "ab" });
    await wait(SEARCH_DELAY_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await wait(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ query: "ab", offset: 0 }));
  });

  it("種類の絞り込みを変えると、最初から読み直す", async () => {
    await mount();
    await open();
    await mount({ kinds: ["image"] });
    await wait();
    expect(load).toHaveBeenLastCalledWith({ query: "", kinds: ["image"], offset: 0, limit: 50 });
  });

  it("遅れて届いた古い検索の結果で、新しい結果を上書きしない", async () => {
    const slow = deferred();
    load.mockReturnValueOnce(slow.promise);
    await mount({ query: "古い" });
    await act(async () => button("過去の履歴を見る").click());
    await wait();
    load.mockResolvedValueOnce({ items: [archived(9, "2026-11-09")], hasMore: false });
    await mount({ query: "新しい" });
    await wait();
    expect(texts()).toEqual(["内容9"]);
    await act(async () => slow.resolve({ items: [archived(1, "2026-11-01")], hasMore: true }));
    expect(texts()).toEqual(["内容9"]);
    // 古い方の完了で、読み込み中の表示も変わらない
    expect(button("さらに読み込む")).toBeUndefined();
  });
});
